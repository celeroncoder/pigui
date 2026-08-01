import { randomUUID } from "node:crypto"
import type { QueueDelivery, QueuedMessage } from "../../shared/contracts"

export interface NativePromptQueue {
  readonly steering: ReadonlyArray<string>
  readonly followUp: ReadonlyArray<string>
}

const queueKey = (delivery: QueueDelivery, text: string) => JSON.stringify([delivery, text])

const reconcileDelivery = (
  previous: ReadonlyArray<QueuedMessage>,
  texts: ReadonlyArray<string>,
  delivery: QueueDelivery,
  createId: () => string
): ReadonlyArray<QueuedMessage> => {
  if (texts.length < previous.length) {
    // Pi drains each native queue from the head. Match a shrinking queue from
    // the tail so duplicate prompts retain the identity of the still-pending
    // item rather than inheriting the attachment state of the delivered one.
    const reusable = [...previous]
    const result = new Array<QueuedMessage>(texts.length)
    for (let index = texts.length - 1; index >= 0; index -= 1) {
      const text = texts[index]
      if (text === undefined) continue
      const previousIndex = reusable.findLastIndex((message) => message.text === text)
      const matched = previousIndex >= 0 ? reusable.splice(previousIndex, 1)[0] : undefined
      result[index] = { id: matched?.id ?? createId(), delivery, text }
    }
    return result
  }

  const reusableIds = new Map<string, Array<string>>()
  for (const message of previous) {
    const key = queueKey(delivery, message.text)
    const ids = reusableIds.get(key)
    if (ids) ids.push(message.id)
    else reusableIds.set(key, [message.id])
  }
  return texts.map((text) => ({ id: reusableIds.get(queueKey(delivery, text))?.shift() ?? createId(), delivery, text }))
}

/**
 * Mirrors Pi's runtime queues while retaining stable UI IDs for identical items.
 * Pi exposes queue contents as text arrays, so IDs are deliberately UI-only and
 * are reconciled from the SDK's authoritative queue_update snapshots.
 */
export const reconcileQueuedMessages = (
  previous: ReadonlyArray<QueuedMessage>,
  native: NativePromptQueue,
  createId: () => string = randomUUID
): ReadonlyArray<QueuedMessage> => {
  const steering = reconcileDelivery(previous.filter((message) => message.delivery === "steer"), native.steering, "steer", createId)
  const followUps = reconcileDelivery(previous.filter((message) => message.delivery === "follow-up"), native.followUp, "follow-up", createId)
  return [...steering, ...followUps]
}

export const sameQueuedMessages = (left: ReadonlyArray<QueuedMessage>, right: ReadonlyArray<QueuedMessage>): boolean =>
  left.length === right.length && left.every((message, index) => {
    const candidate = right[index]
    return candidate?.id === message.id && candidate.delivery === message.delivery && candidate.text === message.text
  })

export const updateQueuedMessageText = (
  messages: ReadonlyArray<QueuedMessage>,
  id: string,
  text: string
): ReadonlyArray<QueuedMessage> => messages.map((message) => message.id === id ? { ...message, text } : message)

export const removeQueuedMessage = (messages: ReadonlyArray<QueuedMessage>, id: string): ReadonlyArray<QueuedMessage> =>
  messages.filter((message) => message.id !== id)

/**
 * Pi drains steering before follow-up messages. Rebuilding with the selected
 * item first makes "Steer now" the next native steering message without
 * inventing a client-side interrupt.
 */
export const prioritizeQueuedMessageForSteering = (
  messages: ReadonlyArray<QueuedMessage>,
  id: string
): ReadonlyArray<QueuedMessage> => {
  const selected = messages.find((message) => message.id === id)
  if (!selected) return messages

  const steering = messages.filter((message) => message.delivery === "steer" && message.id !== id)
  const followUps = messages.filter((message) => message.delivery === "follow-up" && message.id !== id)
  return [{ ...selected, delivery: "steer" }, ...steering, ...followUps]
}
