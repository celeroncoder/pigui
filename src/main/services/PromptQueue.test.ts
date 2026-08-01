import { describe, expect, it } from "vitest"
import type { QueuedMessage } from "../../shared/contracts"
import {
  prioritizeQueuedMessageForSteering,
  reconcileQueuedMessages,
  removeQueuedMessage,
  updateQueuedMessageText
} from "./PromptQueue"

const ids = (...values: ReadonlyArray<string>) => {
  let index = 0
  return () => values[index++] ?? `generated-${index}`
}

const queued = (...messages: ReadonlyArray<QueuedMessage>): ReadonlyArray<QueuedMessage> => messages

describe("Pi prompt queue reconciliation", () => {
  it("keeps IDs stable across native queue_update snapshots, including duplicate text", () => {
    const initial = reconcileQueuedMessages([], {
      steering: ["Stop and inspect the failing test"],
      followUp: ["Summarize the changes", "Summarize the changes"]
    }, ids("steer-1", "follow-1", "follow-2"))

    const reconciled = reconcileQueuedMessages(initial, {
      steering: ["Stop and inspect the failing test"],
      followUp: ["Summarize the changes", "Summarize the changes"]
    }, ids("unexpected"))

    expect(reconciled).toEqual(initial)
  })

  it("keeps the remaining duplicate's ID when Pi drains the first queued copy", () => {
    const current = queued(
      { id: "image-1", delivery: "follow-up", text: "Review this image" },
      { id: "image-2", delivery: "follow-up", text: "Review this image" }
    )

    const reconciled = reconcileQueuedMessages(current, {
      steering: [],
      followUp: ["Review this image"]
    }, ids("unexpected"))

    expect(reconciled).toEqual([
      { id: "image-2", delivery: "follow-up", text: "Review this image" }
    ])
  })

  it("drops delivered native messages instead of retaining an optimistic duplicate", () => {
    const current = queued(
      { id: "steer-1", delivery: "steer", text: "Inspect the failing test" },
      { id: "follow-1", delivery: "follow-up", text: "Summarize the changes" }
    )

    const reconciled = reconcileQueuedMessages(current, {
      steering: [],
      followUp: ["Summarize the changes"]
    }, ids("new"))

    expect(reconciled).toEqual([
      { id: "follow-1", delivery: "follow-up", text: "Summarize the changes" }
    ])
  })

  it("edits, removes, and promotes a selected follow-up without duplicating its queue entry", () => {
    const current = queued(
      { id: "steer-1", delivery: "steer", text: "Current steering instruction" },
      { id: "follow-1", delivery: "follow-up", text: "Later request" },
      { id: "follow-2", delivery: "follow-up", text: "Keep this request" }
    )

    const edited = updateQueuedMessageText(current, "follow-1", "Do this instead")
    const promoted = prioritizeQueuedMessageForSteering(edited, "follow-1")
    const remaining = removeQueuedMessage(promoted, "follow-2")

    expect(remaining).toEqual([
      { id: "follow-1", delivery: "steer", text: "Do this instead" },
      { id: "steer-1", delivery: "steer", text: "Current steering instruction" }
    ])
  })
})
