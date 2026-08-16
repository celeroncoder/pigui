import { useEffect, useRef, useState, type RefObject } from "react"
import { createPortal } from "react-dom"
import type { MessagePreviewLandmark } from "../lib/conversation"
import styles from "./MessagePreviewRail.module.css"
export type { MessagePreviewLandmark } from "../lib/conversation"

type MessagePreviewRailProps = {
  readonly landmarks: ReadonlyArray<MessagePreviewLandmark>
  readonly totalCount?: number
  readonly scrollRootRef: RefObject<HTMLDivElement | null>
  readonly onNavigate?: (landmark: MessagePreviewLandmark) => void
  readonly activeLandmarkId?: string | null
}

const kindLabel = {
  user: "Prompt",
  assistant: "Pi",
  activity: "Activity",
  compaction: "Context"
} satisfies Record<MessagePreviewLandmark["kind"], string>

export function MessagePreviewRail({ landmarks, totalCount, scrollRootRef, onNavigate, activeLandmarkId }: MessagePreviewRailProps) {
  const [activeId, setActiveId] = useState(landmarks[0]?.id ?? null)
  const [preview, setPreview] = useState<{
    readonly landmark: MessagePreviewLandmark
    readonly top: number
    readonly left: number
  } | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const landmarkKey = landmarks.map((landmark) => landmark.id).join("|")

  useEffect(() => {
    setActiveId((current) => landmarks.some((landmark) => landmark.id === current) ? current : (landmarks[0]?.id ?? null))
  }, [landmarkKey])

  useEffect(() => {
    let frame = 0
    const root = scrollRootRef.current
    if (!root || landmarks.length === 0 || activeLandmarkId !== undefined) return

    const updateActive = () => {
      frame = 0
      const rootTop = root.getBoundingClientRect().top + Math.min(112, root.clientHeight * 0.18)
      let nextId = landmarks[0]?.id ?? null
      for (const landmark of landmarks) {
        const target = document.getElementById(landmark.targetId)
        if (target && target.getBoundingClientRect().top <= rootTop) nextId = landmark.id
      }
      setActiveId((current) => current === nextId ? current : nextId)
    }

    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(updateActive)
    }

    updateActive()
    root.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll, { passive: true })
    return () => {
      root.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [activeLandmarkId, landmarkKey, landmarks, scrollRootRef])

  const resolvedActiveId = activeLandmarkId === undefined ? activeId : activeLandmarkId

  useEffect(() => {
    const track = trackRef.current
    const list = listRef.current
    if (!track || !list || !resolvedActiveId) return

    const activeItem = Array.from(list.children).find(
      (item): item is HTMLElement => item instanceof HTMLElement && item.dataset.landmarkId === resolvedActiveId
    )
    if (!activeItem) return

    const itemTop = activeItem.offsetTop
    const itemBottom = itemTop + activeItem.offsetHeight
    if (itemTop < track.scrollTop) track.scrollTo({ top: itemTop, behavior: "smooth" })
    else if (itemBottom > track.scrollTop + track.clientHeight) {
      track.scrollTo({ top: itemBottom - track.clientHeight, behavior: "smooth" })
    }
  }, [landmarkKey, resolvedActiveId])

  if (landmarks.length === 0) return null

  const showPreview = (landmark: MessagePreviewLandmark, target: HTMLElement) => {
    const bounds = target.getBoundingClientRect()
    setPreview({
      landmark,
      top: Math.max(54, Math.min(window.innerHeight - 54, bounds.top + bounds.height / 2)),
      left: Math.max(8, bounds.left - 227)
    })
  }

  return (
    <aside className="preview-rail" aria-label="Conversation preview rail">
      <div className="preview-rail-header">
        <span className="preview-rail-kicker">Trace</span>
        <span className="preview-rail-count">{String(totalCount ?? landmarks.length).padStart(2, "0")}</span>
      </div>
      <div className="preview-rail-track" ref={trackRef} onScroll={() => setPreview(null)}>
        <ol className="preview-rail-list" ref={listRef}>
          {landmarks.map((landmark) => {
            const isActive = resolvedActiveId === landmark.id
            return (
              <li
                className={`preview-rail-item ${isActive ? "active" : ""}`}
                data-kind={landmark.kind}
                data-landmark-id={landmark.id}
                key={landmark.id}
              >
                <button
                  type="button"
                  className="preview-rail-button"
                  aria-current={isActive ? "location" : undefined}
                  aria-label={`Jump to ${kindLabel[landmark.kind].toLowerCase()}: ${landmark.label}`}
                  title={landmark.label}
                  onMouseEnter={(event) => showPreview(landmark, event.currentTarget)}
                  onMouseLeave={() => setPreview(null)}
                  onFocus={(event) => showPreview(landmark, event.currentTarget)}
                  onBlur={() => setPreview(null)}
                  onClick={() => {
                    if (onNavigate) {
                      setActiveId(landmark.id)
                      onNavigate(landmark)
                      return
                    }
                    const target = document.getElementById(landmark.targetId)
                    if (!target) return
                    setActiveId(landmark.id)
                    target.scrollIntoView({
                      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                      block: "start"
                    })
                  }}
                >
                  <span className="preview-rail-node" aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ol>
      </div>
      {preview && createPortal(
        <div
          className={styles.card}
          style={{ top: preview.top, left: preview.left }}
          aria-hidden="true"
        >
          <span className={styles.label}>{preview.landmark.label}</span>
        </div>,
        document.body
      )}
    </aside>
  )
}
