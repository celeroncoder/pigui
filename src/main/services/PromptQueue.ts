import { randomUUID } from "node:crypto"
import type { QueueDelivery, QueuedMessage } from "../../shared/contracts"

export interface NativePromptQueue {
  readonly steering: ReadonlyArray<string>
  readonly followUp: ReadonlyArray<string>
}

interface NativeQueueItem {
  readonly delivery: QueueDelivery
  readonly text: string
}

const queueKey = (delivery: QueueDelivery, text: string) => JSON.stringify([delivery, text])

const nativeItems = (queue: NativePromptQueue): ReadonlyArray<NativeQueueItem> => [
  ...queue.steering.map((text): NativeQueueItem => ({ delivery: "steer", text })),
  ...queue.followUp.map((text): NativeQueueItem => ({ delivery: "follow-up", text }))
]

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
  const reusableIds = new Map<string, Array<string>>()
  for (const message of previous) {
    const key = queueKey(message.delivery, message.text)
    const ids = reusableIds.get(key)
    if (ids) ids.push(message.id)
    else reusableIds.set(key, [message.id])
  }

  return nativeItems(native).map((message) => {
    const ids = reusableIds.get(queueKey(message.delivery, message.text))
    const id = ids?.shift() ?? createId()
    return { id, delivery: message.delivery, text: message.text }
  })
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
