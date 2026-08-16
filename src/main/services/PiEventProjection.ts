import { Schema } from "effect"

const TextContentBlockSchema = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String
})

const ToolContentRecordSchema = Schema.Struct({
  content: Schema.Array(
    Schema.Union([
      TextContentBlockSchema,
      Schema.Struct({
        type: Schema.optionalKey(Schema.String),
        text: Schema.optionalKey(Schema.String)
      })
    ])
  )
})

const isString = Schema.is(Schema.String)
const decodeToolContent = Schema.decodeUnknownOption(ToolContentRecordSchema)

export type ToolOutputContentBlock = {
  readonly type?: string
  readonly text?: string
}

export type ToolOutputRecord = {
  readonly content?: ReadonlyArray<ToolOutputContentBlock>
  readonly details?: Record<string, string | number | boolean | null | undefined>
}

export type ToolOutputPayload =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<ToolOutputContentBlock>
  | ToolOutputRecord

const stringify = (payload: ToolOutputPayload): string => {
  if (isString(payload)) return payload
  try {
    return JSON.stringify(payload, null, 2) ?? String(payload)
  } catch {
    return String(payload)
  }
}

export const projectToolOutput = (payload: ToolOutputPayload): string => {
  if (payload === null || payload === undefined) return ""
  if (isString(payload)) return payload
  const decoded = decodeToolContent(payload)
  if (decoded._tag === "None") return stringify(payload)
  const lines = decoded.value.content.flatMap((item) =>
    item.type === "text" && item.text ? [item.text] : []
  )
  return lines.length > 0 ? lines.join("\n") : ""
}
