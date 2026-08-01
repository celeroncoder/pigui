import { describe, expect, it } from "vitest"
import { normalizeImageReferences, parseImagePathReferences, splitTextByImageReferences } from "./attachments"

describe("Pi image path references", () => {
  it("reads Pi file tags and shell-escaped paths", () => {
    const text = 'Compare <file name="/tmp/first.png"></file> with /var/log/Screenshot\\ 2026\\ 04.png.'
    expect(parseImagePathReferences(text).map((reference) => reference.path)).toEqual([
      "/tmp/first.png",
      "/var/log/Screenshot 2026 04.png"
    ])
  })

  it("ignores unsafe extensions and remote URLs", () => {
    expect(parseImagePathReferences("/tmp/secret.txt /tmp/vector.svg /tmp/okay.webp https://example.com/image.png <file name=\"https://example.com/other.png\"></file>").map((reference) => reference.path)).toEqual(["/tmp/okay.webp"])
  })

  it("keeps markdown text around attachment cards", () => {
    expect(splitTextByImageReferences("**Before** /tmp/example.jpg after")).toEqual([
      { type: "text", value: "**Before** " },
      { type: "image", value: "/tmp/example.jpg" },
      { type: "text", value: " after" }
    ])
    expect(splitTextByImageReferences("Before ![screen](/tmp/example.jpg) after")).toEqual([
      { type: "text", value: "Before " },
      { type: "image", value: "/tmp/example.jpg" },
      { type: "text", value: " after" }
    ])
  })

  it("normalizes attachments into Pi's CLI file-tag form", () => {
    expect(normalizeImageReferences("Please inspect", ["/tmp/pasted image.png"])).toBe("Please inspect\n<file name=\"/tmp/pasted image.png\"></file>")
    expect(normalizeImageReferences("See /tmp/image.png", ["/tmp/image.png"])).toBe("See <file name=\"/tmp/image.png\"></file>")
  })
})
