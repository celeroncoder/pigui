import { describe, expect, it } from "vitest"
import { providerLogoUrl } from "./ProviderLogo"

describe("Logo.dev provider URLs", () => {
  it("maps Pi provider identifiers to their company domains", () => {
    expect(providerLogoUrl("openai-codex", 20)).toContain("img.logo.dev/openai.com")
    expect(providerLogoUrl("xai", 20)).toContain("img.logo.dev/x.ai")
  })

  it("uses Logo.dev name lookup and cacheable image parameters for unknown providers", () => {
    const url = providerLogoUrl("example-ai", 24)
    expect(url).toContain("img.logo.dev/name/example%20ai")
    expect(url).toContain("size=24")
    expect(url).toContain("format=webp")
    expect(url).toContain("retina=true")
    expect(url).toContain("fallback=monogram")
  })
})
