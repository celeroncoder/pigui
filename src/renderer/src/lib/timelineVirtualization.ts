export const INITIAL_HISTORY_ITEM_LIMIT = 100
export const HISTORY_PAGE_ITEM_LIMIT = 100
export const TIMELINE_OVERSCAN_PX = 640
export const ESTIMATED_TIMELINE_ITEM_HEIGHT = 132

export type VirtualItemLayout = {
  readonly id: string
  readonly index: number
  readonly start: number
  readonly size: number
}

export type VirtualLayout = {
  readonly items: ReadonlyArray<VirtualItemLayout>
  readonly totalSize: number
}

export type VirtualRange = {
  readonly start: number
  readonly end: number
}

export const initialHistoryStart = (itemCount: number, limit = INITIAL_HISTORY_ITEM_LIMIT): number =>
  Math.max(0, itemCount - limit)

export const nextHistoryStart = (currentStart: number, pageSize = HISTORY_PAGE_ITEM_LIMIT): number =>
  Math.max(0, currentStart - pageSize)

export const buildVirtualLayout = (
  ids: ReadonlyArray<string>,
  measuredSizes: ReadonlyMap<string, number>,
  estimatedSize = ESTIMATED_TIMELINE_ITEM_HEIGHT
): VirtualLayout => {
  const items: VirtualItemLayout[] = []
  let start = 0
  for (const [index, id] of ids.entries()) {
    const measured = measuredSizes.get(id)
    const size = measured !== undefined && measured > 0 ? measured : estimatedSize
    items.push({ id, index, start, size })
    start += size
  }
  return { items, totalSize: start }
}

export const calculateVirtualRange = (
  layout: VirtualLayout,
  scrollOffset: number,
  viewportSize: number,
  overscan = TIMELINE_OVERSCAN_PX
): VirtualRange => {
  if (layout.items.length === 0) return { start: 0, end: 0 }

  const rangeStart = Math.max(0, scrollOffset - overscan)
  const rangeEnd = Math.max(rangeStart, scrollOffset + viewportSize + overscan)
  let startLow = 0
  let startHigh = layout.items.length
  while (startLow < startHigh) {
    const middle = Math.floor((startLow + startHigh) / 2)
    const item = layout.items[middle]
    if (item && item.start + item.size < rangeStart) startLow = middle + 1
    else startHigh = middle
  }
  const start = Math.min(startLow, layout.items.length - 1)

  let endLow = start
  let endHigh = layout.items.length
  while (endLow < endHigh) {
    const middle = Math.floor((endLow + endHigh) / 2)
    const item = layout.items[middle]
    if (item && item.start < rangeEnd) endLow = middle + 1
    else endHigh = middle
  }
  return { start, end: Math.min(layout.items.length, Math.max(start + 1, endLow)) }
}
