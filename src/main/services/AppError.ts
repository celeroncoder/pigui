import { Schema } from "effect"

export class AppError extends Schema.TaggedErrorClass<AppError>()("AppError", {
  operation: Schema.String,
  message: Schema.String
}) {}

export const toAppError = (operation: string) => (cause: unknown) => AppError.make({
  operation,
  message: cause instanceof Error ? cause.message : String(cause)
})
