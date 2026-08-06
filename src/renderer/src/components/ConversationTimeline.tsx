import { CircleDashed } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import type { AttachmentPreview } from "../../../shared/contracts"
import { ActivityGroup } from "./ActivityGroup"
import { MessagePreviewRail } from "./MessagePreviewRail"
import { MessageView } from "./MessageView"
import type { ConversationItem, MessagePreviewLandmark } from "../lib/conversation"
import { buildVirtualLayout, calculateVirtualRange, ESTIMATED_TIMELINE_ITEM_HEIGHT, initialHistoryStart, nextHistoryStart } from "../lib/timelineVirtualization"

type ConversationTimelineProps = {
  readonly items: ReadonlyArray<ConversationItem>
  readonly landmarks: ReadonlyArray<MessagePreviewLandmark>
  readonly previewLandmarks: ReadonlyArray<MessagePreviewLandmark>
  readonly previewTotalCount: number
  readonly isStreaming: boolean
  readonly liveStatus?: string
  readonly onOpenImage: (preview: AttachmentPreview) => void
}

type PendingScroll = { readonly type: "target"; readonly id: string }
type ScrollAnchor = { readonly id: string; readonly viewportOffset: number }

const setScrollTopImmediately = (root: HTMLDivElement, top: number) => {
  const previousBehavior = root.style.scrollBehavior
  root.style.scrollBehavior = "auto"
  root.scrollTop = top
  root.style.scrollBehavior = previousBehavior
}

export function ConversationTimeline({ items, landmarks, previewLandmarks, previewTotalCount, isStreaming, liveStatus, onOpenImage }: ConversationTimelineProps) {
  const [historyStart, setHistoryStart] = useState(() => initialHistoryStart(items.length))
  const [viewport, setViewport] = useState({ top: 0, height: 0 })
  const [measurementVersion, setMeasurementVersion] = useState(0)
  const scrollRootRef = useRef<HTMLDivElement>(null)
  const virtualSurfaceRef = useRef<HTMLDivElement>(null)
  const measuredSizesRef = useRef(new Map<string, number>())
  const rowNodesRef = useRef(new Map<string, HTMLElement>())
  const rowObserverRef = useRef<ResizeObserver | null>(null)
  const pendingScrollRef = useRef<PendingScroll | null>(null)
  const scrollAnchorRef = useRef<ScrollAnchor | null>(null)
  const stickToBottomRef = useRef(true)
  const initializedRef = useRef(false)

  const clampedHistoryStart = Math.min(historyStart, Math.max(0, items.length - 1))
  const loadedItems = useMemo(() => items.slice(clampedHistoryStart), [clampedHistoryStart, items])
  const loadedLandmarks = useMemo(() => landmarks.slice(clampedHistoryStart), [clampedHistoryStart, landmarks])
  const layout = useMemo(
    () => buildVirtualLayout(loadedItems.map((item) => item.id), measuredSizesRef.current),
    [loadedItems, measurementVersion]
  )
  const layoutById = useMemo(() => new Map(layout.items.map((item) => [item.id, item])), [layout])
  const layoutByIdRef = useRef(layoutById)
  layoutByIdRef.current = layoutById
  const virtualRange = calculateVirtualRange(layout, viewport.top, viewport.height)
  const virtualItems = layout.items.slice(virtualRange.start, virtualRange.end)
  const scrollAnchorItem = scrollAnchorRef.current ? layoutById.get(scrollAnchorRef.current.id) : undefined
  const renderedVirtualItems = scrollAnchorItem && !virtualItems.some((item) => item.id === scrollAnchorItem.id)
    ? [...virtualItems, scrollAnchorItem].sort((left, right) => left.index - right.index)
    : virtualItems
  const topRange = calculateVirtualRange(layout, viewport.top, 1, 0)
  const topAbsoluteIndex = clampedHistoryStart + topRange.start
  const landmarkIndexByTarget = useMemo(() => new Map(landmarks.map((landmark, index) => [landmark.targetId, index])), [landmarks])
  const activePreviewLandmark = previewLandmarks.findLast((landmark) => (landmarkIndexByTarget.get(landmark.targetId) ?? -1) <= topAbsoluteIndex)
  const lastActivityIndex = items.findLastIndex((item) => item.type === "activity")
  const hasOlderHistory = clampedHistoryStart > 0

  useEffect(() => {
    const root = scrollRootRef.current
    if (!root) return
    const updateViewport = () => {
      const distanceFromBottom = root.scrollHeight - root.scrollTop - root.clientHeight
      stickToBottomRef.current = distanceFromBottom <= 80
      setViewport((current) => current.top === root.scrollTop && current.height === root.clientHeight
        ? current
        : { top: root.scrollTop, height: root.clientHeight })
    }
    const releaseScrollAnchor = () => {
      scrollAnchorRef.current = null
      stickToBottomRef.current = false
    }
    updateViewport()
    root.addEventListener("scroll", updateViewport, { passive: true })
    root.addEventListener("pointerdown", releaseScrollAnchor, { passive: true })
    root.addEventListener("touchstart", releaseScrollAnchor, { passive: true })
    root.addEventListener("wheel", releaseScrollAnchor, { passive: true })
    const resizeObserver = new ResizeObserver(updateViewport)
    resizeObserver.observe(root)
    return () => {
      root.removeEventListener("scroll", updateViewport)
      root.removeEventListener("pointerdown", releaseScrollAnchor)
      root.removeEventListener("touchstart", releaseScrollAnchor)
      root.removeEventListener("wheel", releaseScrollAnchor)
      resizeObserver.disconnect()
    }
  }, [])

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const root = scrollRootRef.current
      let changed = false
      let correction = 0
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.timelineId
        if (!id) continue
        const nextSize = entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height
        const previousSize = measuredSizesRef.current.get(id)
        const previousLayoutSize = previousSize ?? ESTIMATED_TIMELINE_ITEM_HEIGHT
        if (Math.abs(previousLayoutSize - nextSize) < 0.5) continue
        const itemLayout = layoutByIdRef.current.get(id)
        const surfaceTop = virtualSurfaceRef.current?.offsetTop ?? 0
        if (root && itemLayout && surfaceTop + itemLayout.start < root.scrollTop) correction += nextSize - previousLayoutSize
        measuredSizesRef.current.set(id, nextSize)
        changed = true
      }
      if (!changed) return
      if (root && correction !== 0 && !stickToBottomRef.current) setScrollTopImmediately(root, root.scrollTop + correction)
      setMeasurementVersion((current) => current + 1)
    })
    rowObserverRef.current = observer
    for (const node of rowNodesRef.current.values()) observer.observe(node)
    return () => {
      observer.disconnect()
      rowObserverRef.current = null
    }
  }, [])

  const setRowNode = useCallback((id: string, node: HTMLElement | null) => {
    const previous = rowNodesRef.current.get(id)
    if (previous) rowObserverRef.current?.unobserve(previous)
    if (node) {
      rowNodesRef.current.set(id, node)
      rowObserverRef.current?.observe(node)
    } else {
      rowNodesRef.current.delete(id)
    }
  }, [])

  useLayoutEffect(() => {
    const root = scrollRootRef.current
    if (!root) return
    const pending = pendingScrollRef.current
    pendingScrollRef.current = null
    const surfaceTop = virtualSurfaceRef.current?.offsetTop ?? 0
    const scrollAnchor = scrollAnchorRef.current
    if (!scrollAnchor && pending?.type === "target") {
      const target = layoutById.get(pending.id)
      if (target) setScrollTopImmediately(root, surfaceTop + target.start)
    } else if (!initializedRef.current || stickToBottomRef.current) {
      setScrollTopImmediately(root, root.scrollHeight)
    }
    initializedRef.current = true
    setViewport((current) => current.top === root.scrollTop && current.height === root.clientHeight
      ? current
      : { top: root.scrollTop, height: root.clientHeight })
  }, [items.length, layout.totalSize, layoutById])

  useEffect(() => {
    const root = scrollRootRef.current
    const scrollAnchor = scrollAnchorRef.current
    if (!root || !scrollAnchor) return
    const anchorNode = rowNodesRef.current.get(scrollAnchor.id)
    if (!anchorNode) return
    setScrollTopImmediately(root, root.scrollTop + anchorNode.getBoundingClientRect().top - root.getBoundingClientRect().top - scrollAnchor.viewportOffset)
    setViewport((current) => current.top === root.scrollTop && current.height === root.clientHeight
      ? current
      : { top: root.scrollTop, height: root.clientHeight })
  }, [clampedHistoryStart, layout.totalSize, measurementVersion])

  useEffect(() => {
    const scrollAnchor = scrollAnchorRef.current
    if (!scrollAnchor) return
    let frame = 0
    let remainingFrames = 20
    const restoreAnchor = () => {
      if (scrollAnchorRef.current !== scrollAnchor) return
      const root = scrollRootRef.current
      const anchorNode = rowNodesRef.current.get(scrollAnchor.id)
      if (root && anchorNode) {
        setScrollTopImmediately(root, root.scrollTop + anchorNode.getBoundingClientRect().top - root.getBoundingClientRect().top - scrollAnchor.viewportOffset)
      }
      remainingFrames -= 1
      if (remainingFrames > 0) frame = window.requestAnimationFrame(restoreAnchor)
    }
    frame = window.requestAnimationFrame(restoreAnchor)
    return () => window.cancelAnimationFrame(frame)
  }, [clampedHistoryStart])

  const loadOlderHistory = () => {
    const root = scrollRootRef.current
    let anchor: ScrollAnchor | undefined
    if (root) {
      const rootTop = root.getBoundingClientRect().top
      const candidates = [...rowNodesRef.current.entries()]
        .map(([id, node]) => ({ id, top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom }))
        .sort((left, right) => left.top - right.top)
      const anchorCandidate = candidates.find((candidate) => candidate.top >= rootTop - 1)
        ?? candidates.find((candidate) => candidate.bottom > rootTop)
      if (anchorCandidate) {
        anchor = { id: anchorCandidate.id, viewportOffset: anchorCandidate.top - rootTop }
        scrollAnchorRef.current = anchor
      }
    }
    stickToBottomRef.current = false
    flushSync(() => setHistoryStart((current) => nextHistoryStart(current)))
    if (root && anchor) {
      const anchorNode = rowNodesRef.current.get(anchor.id)
      if (anchorNode) setScrollTopImmediately(root, root.scrollTop + anchorNode.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.viewportOffset)
    }
  }

  const navigateToLandmark = (landmark: MessagePreviewLandmark) => {
    const targetIndex = landmarks.findIndex((candidate) => candidate.targetId === landmark.targetId)
    if (targetIndex < 0) return
    scrollAnchorRef.current = null
    stickToBottomRef.current = false
    if (targetIndex < clampedHistoryStart) {
      pendingScrollRef.current = { type: "target", id: items[targetIndex]?.id ?? "" }
      setHistoryStart(Math.max(0, targetIndex - 4))
      return
    }
    const target = layoutById.get(items[targetIndex]?.id ?? "")
    if (target && scrollRootRef.current) setScrollTopImmediately(scrollRootRef.current, (virtualSurfaceRef.current?.offsetTop ?? 0) + target.start)
  }

  return (
    <div className="message-scroll-shell">
      <MessagePreviewRail landmarks={previewLandmarks} totalCount={previewTotalCount} scrollRootRef={scrollRootRef} onNavigate={navigateToLandmark} activeLandmarkId={activePreviewLandmark?.id ?? previewLandmarks[0]?.id ?? null} />
      <div className="message-scroll" ref={scrollRootRef}>
        <div className="message-list">
          {hasOlderHistory && (
            <div className="history-pagination">
              <button type="button" onClick={loadOlderHistory}>Load older history</button>
              <span>{clampedHistoryStart} earlier {clampedHistoryStart === 1 ? "item" : "items"}</span>
            </div>
          )}
          <div className="virtual-message-list" ref={virtualSurfaceRef} style={{ height: layout.totalSize }} role="feed" aria-label="Conversation history">
            {renderedVirtualItems.map((virtualItem) => {
              const item = loadedItems[virtualItem.index]
              const landmark = loadedLandmarks[virtualItem.index]
              if (!item) return null
              const absoluteIndex = clampedHistoryStart + virtualItem.index
              return (
                <div
                  className="virtual-message-row"
                  data-timeline-id={item.id}
                  key={item.id}
                  ref={(node) => setRowNode(item.id, node)}
                  role="presentation"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  {item.type === "message"
                    ? <MessageView message={item.message} anchorId={landmark?.targetId} onOpenImage={onOpenImage} />
                    : <ActivityGroup messages={item.messages} anchorId={landmark?.targetId} isLive={isStreaming && absoluteIndex === lastActivityIndex} onOpenImage={onOpenImage} />}
                </div>
              )
            })}
          </div>
          {isStreaming && (
            <div className="live-status" role="status" aria-live="polite">
              <CircleDashed size={14} />
              <span>{liveStatus ?? "Thinking"}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
