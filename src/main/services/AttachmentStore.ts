import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, isAbsolute, join } from "node:path"
import { app } from "electron"
import { convertToPng, resizeImage } from "@earendil-works/pi-coding-agent"
import { Context, Effect, Layer, Schema } from "effect"
import type { AttachmentPreview, ImageAttachment } from "../../shared/contracts"
import { hasSafeImageExtension, isSafeImagePath, safeImageExtensions } from "../../shared/attachments"

const MAX_IMAGE_BYTES = 25 * 1024 * 1024

interface DetectedImage {
  readonly mimeType: string
  readonly extension: (typeof safeImageExtensions)[number]
}

export interface PiImageAttachment {
  readonly type: "image"
  readonly data: string
  readonly mimeType: string
}

export class AttachmentError extends Schema.TaggedErrorClass<AttachmentError>()("AttachmentError", {
  operation: Schema.String,
  message: Schema.String
}) {}

const failure = (operation: string, message: string): AttachmentError => AttachmentError.make({ operation, message })

const startsWithAscii = (bytes: Uint8Array, offset: number, value: string): boolean => {
  if (bytes.length < offset + value.length) return false
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false
  }
  return true
}

const detectImage = (bytes: Uint8Array): DetectedImage | undefined => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mimeType: "image/jpeg", extension: ".jpg" }
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return { mimeType: "image/png", extension: ".png" }
  if (startsWithAscii(bytes, 0, "GIF87a") || startsWithAscii(bytes, 0, "GIF89a")) return { mimeType: "image/gif", extension: ".gif" }
  if (startsWithAscii(bytes, 0, "RIFF") && startsWithAscii(bytes, 8, "WEBP")) return { mimeType: "image/webp", extension: ".webp" }
  if (startsWithAscii(bytes, 0, "BM")) return { mimeType: "image/bmp", extension: ".bmp" }
  return undefined
}

const base64DataUrl = (bytes: Uint8Array, mimeType: string): string => `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`

const readBytes = (path: string) => Effect.tryPromise({
  try: () => readFile(path),
  catch: (cause) => failure("read image", cause instanceof Error ? cause.message : String(cause))
})

const validateExistingPath = (path: string): Effect.Effect<{ readonly path: string; readonly bytes: Uint8Array; readonly image: DetectedImage }, AttachmentError> => {
  if (!isAbsolute(path)) return Effect.fail(failure("read image", "Image paths must be absolute"))
  if (!isSafeImagePath(path)) return Effect.fail(failure("read image", "Only png, jpg, jpeg, gif, webp, and bmp files are supported"))

  return readBytes(path).pipe(
    Effect.flatMap((bytes) => {
      if (bytes.length === 0) return Effect.fail(failure("read image", "The image file is empty"))
      if (bytes.length > MAX_IMAGE_BYTES) return Effect.fail(failure("read image", "The image file is too large"))
      const image = detectImage(bytes)
      return image
        ? Effect.succeed({ path, bytes, image })
        : Effect.fail(failure("read image", "The file is not a supported image"))
    })
  )
}

const safeDisplayName = (name: string | undefined, extension: string): string => {
  const candidate = basename(name ?? "pasted-image").replaceAll("\u0000", "").trim()
  if (candidate.length === 0 || !hasSafeImageExtension(candidate)) return `pasted-image${extension}`
  return candidate
}

export const makeAttachmentStore = (root: string) => ({
  save: Effect.fn("AttachmentStore.save")(function*(bytes: Uint8Array, name?: string, _mimeType?: string) {
    if (bytes.length === 0) return yield* Effect.fail(failure("save image", "The pasted image is empty"))
    if (bytes.length > MAX_IMAGE_BYTES) return yield* Effect.fail(failure("save image", "The pasted image is too large"))
    const image = detectImage(bytes)
    if (!image) return yield* Effect.fail(failure("save image", "Only supported local image files can be attached"))

    const id = randomUUID()
    const path = join(root, `${id}${image.extension}`)
    yield* Effect.tryPromise({
      try: () => writeFile(path, bytes),
      catch: (cause) => failure("save image", cause instanceof Error ? cause.message : String(cause))
    })
    return {
      id,
      path,
      name: safeDisplayName(name, image.extension),
      mimeType: image.mimeType,
      dataUrl: base64DataUrl(bytes, image.mimeType)
    } satisfies ImageAttachment
  }),
  preview: Effect.fn("AttachmentStore.preview")(function*(path: string) {
    const result = yield* validateExistingPath(path)
    return {
      name: basename(result.path),
      mimeType: result.image.mimeType,
      dataUrl: base64DataUrl(result.bytes, result.image.mimeType)
    } satisfies AttachmentPreview
  }),
  readForPi: Effect.fn("AttachmentStore.readForPi")(function*(path: string) {
    const result = yield* validateExistingPath(path)
    const processed = yield* Effect.tryPromise({
      try: async () => {
        let data = Buffer.from(result.bytes).toString("base64")
        let mimeType = result.image.mimeType
        if (mimeType === "image/bmp") {
          const converted = await convertToPng(data, mimeType)
          if (!converted) throw new Error("The image could not be converted to a provider-compatible format")
          data = converted.data
          mimeType = converted.mimeType
        }
        const resized = await resizeImage(Buffer.from(data, "base64"), mimeType)
        if (!resized) throw new Error("The image could not be resized below Pi's inline image limit")
        return resized
      },
      catch: (cause) => failure("prepare image for Pi", cause instanceof Error ? cause.message : String(cause))
    })
    return {
      type: "image",
      data: processed.data,
      mimeType: processed.mimeType
    } satisfies PiImageAttachment
  })
})

type AttachmentStoreService = ReturnType<typeof makeAttachmentStore>

export class AttachmentStore extends Context.Service<AttachmentStore, AttachmentStoreService>()("AttachmentStore") {}

export const AttachmentStoreLive = Layer.effect(AttachmentStore)(Effect.gen(function*() {
  const root = yield* Effect.try({
    try: () => join(app.getPath("userData"), "attachments"),
    catch: (cause) => failure("initialize image attachments", cause instanceof Error ? cause.message : String(cause))
  })
  yield* Effect.tryPromise({
    try: () => mkdir(root, { recursive: true }),
    catch: (cause) => failure("initialize image attachments", cause instanceof Error ? cause.message : String(cause))
  })
  return makeAttachmentStore(root)
}))
