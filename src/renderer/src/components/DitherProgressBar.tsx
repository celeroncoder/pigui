import { useEffect, useRef } from "react"
import { BAYER4 } from "./dither-kit/pixel"
import { rgb, type Rgb } from "./dither-kit/palette"
import type { ContextUsageTone } from "./contextUsage"
import styles from "./DitherProgressBar.module.css"

interface DitherProgressBarProps {
  readonly value: number
  readonly tone: ContextUsageTone
}

const HEIGHT = 10

const fillByTone: Record<ContextUsageTone, Rgb> = {
  default: [123, 141, 128],
  warning: [211, 154, 103],
  critical: [223, 137, 128],
  unknown: [119, 119, 115]
}

/** A compact ordered-dither fill using the repository's dither-kit canvas primitive. */
export function DitherProgressBar({ value, tone }: DitherProgressBarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const paint = () => {
      const width = Math.max(1, Math.floor(canvas.clientWidth))
      const density = window.devicePixelRatio || 1
      canvas.width = Math.ceil(width * density)
      canvas.height = Math.ceil(HEIGHT * density)

      const context = canvas.getContext("2d")
      if (!context) return
      context.setTransform(density, 0, 0, density, 0, 0)
      context.clearRect(0, 0, width, HEIGHT)
      context.fillStyle = "#323436"
      context.fillRect(0, 0, width, HEIGHT)

      const filledWidth = Math.round(width * Math.min(100, Math.max(0, value)) / 100)
      const fill = fillByTone[tone]
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < filledWidth; x++) {
          const threshold = BAYER4[y % 4]?.[x % 4] ?? 0
          context.fillStyle = rgb(fill, 1, 0.32 + (1 - threshold) * 0.46)
          context.fillRect(x, y, 1, 1)
        }
      }
    }

    paint()
    const observer = new ResizeObserver(paint)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [tone, value])

  return (
    <span className={styles.root} aria-hidden="true">
      <canvas ref={canvasRef} />
    </span>
  )
}
