const IMAGE_FILE_TAG = /<file\s+name=(['"])([\s\S]*?)\1\s*><\/file>/gi
const MARKDOWN_IMAGE_PATH = /!\[[^\]]*\]\(\s*((?:\/|[A-Za-z]:[\\/]|\\\\)(?:\\.|[^\s"'<>)]*))\s*\)/g
const IMAGE_PATH = /(?<![\w:/])((?:\/|[A-Za-z]:[\\/]|\\\\)(?:\\.|[^\s"'<>])*)/g
const TRAILING_PATH_PUNCTUATION = /[.,;:!?)]$/

export const safeImageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"] as const

export interface ImagePathReference {
  readonly path: string
  readonly raw: string
  readonly start: number
  readonly end: number
}

export interface TextImageSegment {
  readonly type: "text" | "image"
  readonly value: string
}

const decodeXml = (value: string): string => value
  .replaceAll("&quot;", '"')
  .replaceAll("&apos;", "'")
  .replaceAll("&gt;", ">")
  .replaceAll("&lt;", "<")
  .replaceAll("&amp;", "&")

/** Decode the shell escaping used by Pi's terminal path references. */
export const unescapeShellPath = (value: string): string => {
  let result = ""
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === "\\" && index + 1 < value.length) {
      const next = value[index + 1]
      if (next && " \t\n\\'\"()[]{}!#$&;|<>*?`".includes(next)) {
        result += next
        index += 1
      } else {
        result += character
      }
    } else if (character) {
      result += character
    }
  }
  return result
}

export const hasSafeImageExtension = (value: string): boolean => {
  const lower = value.toLocaleLowerCase()
  return safeImageExtensions.some((extension) => lower.endsWith(extension))
}

export const isSafeImagePath = (value: string): boolean => {
  const isLocalPath = value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")
  return isLocalPath && hasSafeImageExtension(value)
}

const trimPath = (value: string): string => {
  let candidate = value
  while (TRAILING_PATH_PUNCTUATION.test(candidate) && !isSafeImagePath(candidate)) {
    candidate = candidate.slice(0, -1)
  }
  return candidate
}

const toReference = (raw: string, start: number): ImagePathReference | undefined => {
  const cleanRaw = trimPath(raw)
  const path = unescapeShellPath(decodeXml(cleanRaw))
  return isSafeImagePath(path) ? { path, raw: cleanRaw, start, end: start + cleanRaw.length } : undefined
}

/**
 * Find Pi CLI image references in user-facing text.
 *
 * Pi's CLI emits `<file name="/absolute/path/image.png"></file>` and the
 * terminal commonly displays paths with shell-escaped spaces. Both forms are
 * normalized to the real local path here.
 */
export const parseImagePathReferences = (text: string): ReadonlyArray<ImagePathReference> => {
  const matches: ImagePathReference[] = []

  for (const match of text.matchAll(IMAGE_FILE_TAG)) {
    const raw = match[0]
    const pathValue = match[2]
    const start = match.index ?? -1
    if (!raw || pathValue === undefined || start < 0) continue
    const reference = toReference(pathValue, start)
    if (reference) matches.push({ ...reference, raw, end: start + raw.length })
  }

  for (const match of text.matchAll(MARKDOWN_IMAGE_PATH)) {
    const raw = match[0]
    const pathValue = match[1]
    const start = match.index ?? -1
    if (!raw || pathValue === undefined || start < 0) continue
    const pathStart = start + raw.indexOf(pathValue)
    const reference = toReference(pathValue, pathStart)
    if (reference) matches.push({ ...reference, raw, start, end: start + raw.length })
  }

  for (const match of text.matchAll(IMAGE_PATH)) {
    const raw = match[1]
    const start = match.index ?? -1
    if (!raw || start < 0) continue
    const reference = toReference(raw, start)
    if (reference) matches.push(reference)
  }

  matches.sort((left, right) => left.start - right.start || right.end - left.end)
  const nonOverlapping: ImagePathReference[] = []
  for (const match of matches) {
    const previous = nonOverlapping.at(-1)
    if (previous && match.start < previous.end) continue
    nonOverlapping.push(match)
  }
  return nonOverlapping
}

const escapeFileTagPath = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")

export const imageFileTag = (path: string): string => `<file name="${escapeFileTagPath(path)}"></file>`

/** Replace detected path text and append explicit attachments in Pi's CLI format. */
export const normalizeImageReferences = (text: string, attachmentPaths: ReadonlyArray<string> = []): string => {
  const references = parseImagePathReferences(text)
  const paths = new Set(references.map((reference) => reference.path))
  const uniqueAttachments = [...new Set(attachmentPaths)]
  let result = text
  for (const reference of [...references].reverse()) {
    result = `${result.slice(0, reference.start)}${imageFileTag(reference.path)}${result.slice(reference.end)}`
  }
  const missing = uniqueAttachments.filter((path) => !paths.has(path))
  if (missing.length === 0) return result
  const suffix = missing.map(imageFileTag).join("\n")
  return result.trim().length > 0 ? `${result.trimEnd()}\n${suffix}` : suffix
}

export const splitTextByImageReferences = (text: string): ReadonlyArray<TextImageSegment> => {
  const references = parseImagePathReferences(text)
  if (references.length === 0) return [{ type: "text", value: text }]

  const segments: TextImageSegment[] = []
  let cursor = 0
  for (const reference of references) {
    if (reference.start > cursor) segments.push({ type: "text", value: text.slice(cursor, reference.start) })
    segments.push({ type: "image", value: reference.path })
    cursor = reference.end
  }
  if (cursor < text.length) segments.push({ type: "text", value: text.slice(cursor) })
  return segments
}
