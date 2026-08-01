import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { makeAttachmentStore } from "./AttachmentStore"

const onePixelPng = new Uint8Array(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
))

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
    expect(image.type).toBe("image")
    expect(["image/png", "image/jpeg"]).toContain(image.mimeType)
    expect(Buffer.from(image.data, "base64").length).toBeGreaterThan(0)
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
