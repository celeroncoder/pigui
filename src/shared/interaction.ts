import { Schema } from "effect"

export const AskUserOptionSchema = Schema.Struct({
  label: Schema.String,
  description: Schema.optionalKey(Schema.String)
})

export const AskUserInputSchema = Schema.Struct({
  question: Schema.String,
  options: Schema.Array(AskUserOptionSchema).check(Schema.isLengthBetween(2, 5))
})

export type AskUserOption = Schema.Schema.Type<typeof AskUserOptionSchema>
export type AskUserInput = Schema.Schema.Type<typeof AskUserInputSchema>

export const AskUserInteractionRequestSchema = Schema.Struct({
  requestId: Schema.String,
  toolCallId: Schema.String,
  question: Schema.String,
  options: Schema.Array(AskUserOptionSchema).check(Schema.isLengthBetween(2, 5))
})

export type AskUserInteractionRequest = Schema.Schema.Type<typeof AskUserInteractionRequestSchema>

export const AskUserInteractionAnswerSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("option"), optionIndex: Schema.Natural }),
  Schema.Struct({ kind: Schema.Literal("custom"), answer: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("dismissed") })
])

export type AskUserInteractionAnswer = Schema.Schema.Type<typeof AskUserInteractionAnswerSchema>
