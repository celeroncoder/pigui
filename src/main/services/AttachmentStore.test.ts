import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { makeAttachmentStore } from "./AttachmentStore"

const onePixelPng = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
])

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("AttachmentStore", () => {
  it("persists validated image bytes and exposes safe previews", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-desktop-attachments-"))
    temporaryDirectories.push(directory)
    const store = makeAttachmentStore(directory)

    const saved = await Effect.runPromise(store.save(onePixelPng, "Screenshot.png", "image/png"))
    expect(saved.path).toBe(join(directory, `${saved.id}.png`))
    expect(new Uint8Array(await readFile(saved.path))).toEqual(onePixelPng)

    const preview = await Effect.runPromise(store.preview(saved.path))
    expect(preview.mimeType).toBe("image/png")
    expect(preview.dataUrl).toBe("data:image/png;base64," + Buffer.from(onePixelPng).toString("base64"))

    const image = await Effect.runPromise(store.readForPi(saved.path))
    expect(image).toEqual({ type: "image", mimeType: "image/png", data: Buffer.from(onePixelPng).toString("base64") })
  })

  it("rejects unsupported bytes even when a safe name is supplied", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-desktop-attachments-"))
    temporaryDirectories.push(directory)
    const store = makeAttachmentStore(directory)

    await expect(Effect.runPromise(store.save(Uint8Array.from([1, 2, 3]), "not-really.png", "image/png"))).rejects.toMatchObject({
      _tag: "AttachmentError"
    })
  })
})
