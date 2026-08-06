import { describe, expect, it } from "vitest"
import { buildVirtualLayout, calculateVirtualRange, initialHistoryStart, nextHistoryStart } from "./timelineVirtualization"

describe("timeline virtualization", () => {
  it("caps the initial timeline at the newest history page", () => {
    expect(initialHistoryStart(72, 100)).toBe(0)
    expect(initialHistoryStart(260, 100)).toBe(160)
    expect(nextHistoryStart(160, 100)).toBe(60)
    expect(nextHistoryStart(60, 100)).toBe(0)
  })

  it("uses measured row sizes when laying out the virtual surface", () => {
    const layout = buildVirtualLayout(["one", "two", "three"], new Map([["two", 240]]), 100)

    expect(layout.items).toEqual([
      { id: "one", index: 0, start: 0, size: 100 },
      { id: "two", index: 1, start: 100, size: 240 },
      { id: "three", index: 2, start: 340, size: 100 }
    ])
    expect(layout.totalSize).toBe(440)
  })

  it("mounts only rows intersecting the viewport and overscan", () => {
    const layout = buildVirtualLayout(Array.from({ length: 20 }, (_, index) => `item-${index}`), new Map(), 100)

    expect(calculateVirtualRange(layout, 800, 300, 100)).toEqual({ start: 6, end: 12 })
    expect(calculateVirtualRange(layout, 0, 300, 0)).toEqual({ start: 0, end: 3 })
  })
})
