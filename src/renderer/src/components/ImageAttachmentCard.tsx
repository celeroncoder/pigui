import { FileImage, LoaderCircle, X } from "lucide-react"
import { useEffect, useState } from "react"
import type { AttachmentPreview, ImageAttachment } from "../../../shared/contracts"
import { desktopApi } from "../lib/api"

interface ImageAttachmentCardProps {
  readonly path?: string
  readonly attachment?: ImageAttachment
  readonly onOpen: (preview: AttachmentPreview) => void
  readonly onRemove?: () => void
  readonly compact?: boolean
}

const displayName = (path: string): string => path.split(/[\\/]/).at(-1) || "Image attachment"

export function ImageAttachmentCard({ path, attachment, onOpen, onRemove, compact = false }: ImageAttachmentCardProps) {
  const [preview, setPreview] = useState<AttachmentPreview | null>(attachment
    ? { name: attachment.name, mimeType: attachment.mimeType, dataUrl: attachment.dataUrl }
    : null)
  const [loading, setLoading] = useState(!attachment)
  const [error, setError] = useState(false)
  const requestedPath = attachment?.path ?? path

  useEffect(() => {
    if (attachment || !path) return
    let mounted = true
    setLoading(true)
    setError(false)
    void desktopApi.attachments.preview(path).then((nextPreview) => {
      if (!mounted) return
      setPreview(nextPreview)
      setLoading(false)
    }).catch(() => {
      if (!mounted) return
      setError(true)
      setLoading(false)
    })
    return () => {
      mounted = false
    }
  }, [attachment, path])

  const name = preview?.name ?? (requestedPath ? displayName(requestedPath) : "Image attachment")
  const buttonLabel = preview ? `Open image ${name}` : `Image attachment ${name}`

  return (
    <div className={`image-attachment-card ${compact ? "compact" : ""} ${error ? "unavailable" : ""}`}>
      <button
        type="button"
        className="image-attachment-preview"
        aria-label={buttonLabel}
        disabled={!preview}
        onClick={() => preview && onOpen(preview)}
      >
        {preview ? <img src={preview.dataUrl} alt={name} /> : loading ? <LoaderCircle size={18} aria-hidden="true" /> : <FileImage size={19} aria-hidden="true" />}
      </button>
      <div className="image-attachment-footer">
        <span className="image-attachment-name" title={name}><FileImage size={12} aria-hidden="true" />{name}</span>
        {onRemove && <button type="button" className="image-attachment-remove" aria-label={`Remove ${name}`} onClick={onRemove}><X size={14} /></button>}
      </div>
    </div>
  )
}
