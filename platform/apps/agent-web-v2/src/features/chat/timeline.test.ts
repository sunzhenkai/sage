import { describe, expect, it } from "vitest";
import type { TimelineEvent, TimelinePayload } from "@sage/app-contracts";
import { buildTimelineTurns, hasTaskEvent, mergeTimelineEvents } from "./timeline";

function factory(sessionId = "s1") {
  let sequence = 0;
  return (runId: string, payload: TimelinePayload, explicitSequence?: number): TimelineEvent => ({
    schemaVersion: "1",
    sessionId,
    runId,
    sequence: explicitSequence ?? ++sequence,
    occurredAt: new Date(0).toISOString(),
    payload,
  });
}

describe("mergeTimelineEvents", () => {
  it("dedupes by sequence and sorts ascending", () => {
    const ev = factory();
    const a = ev("r1", { kind: "text", text: "a" }, 2);
    const b = ev("r1", { kind: "text", text: "b" }, 1);
    const c = ev("r1", { kind: "text", text: "c" }, 3);
    const dup = ev("r1", { kind: "text", text: "dup" }, 2);
    const merged = mergeTimelineEvents([a], [b, c, dup]);
    expect(merged.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(merged.find((event) => event.sequence === 2)?.payload).toEqual({ kind: "text", text: "a" });
  });
});

describe("buildTimelineTurns", () => {
  it("marks a text with promotionEligibility=explicit as the user message", () => {
    const ev = factory();
    const events = [
      ev("r1", { kind: "run", status: "active", attempt: 1 }, 1),
      ev("r1", { kind: "text", text: "do it", messageId: "m1", promotionEligibility: "explicit" }, 2),
      ev("r1", { kind: "text", text: "working on it" }, 3),
    ];
    const turns = buildTimelineTurns(events);
    expect(turns).toHaveLength(1);
    const turn = turns[0]!;
    expect(turn.userMessage?.text).toBe("do it");
    expect(turn.userMessage?.messageId).toBe("m1");
    expect(turn.items.map((event) => event.sequence)).toEqual([3]);
  });

  it("marks a text earlier than the first run event as the user message", () => {
    const ev = factory();
    const events = [
      ev("r1", { kind: "text", text: "hello", messageId: "m1" }, 1),
      ev("r1", { kind: "run", status: "active", attempt: 1 }, 2),
      ev("r1", { kind: "text", text: "hi there" }, 3),
    ];
    const [turn] = buildTimelineTurns(events);
    expect(turn?.userMessage?.text).toBe("hello");
    expect(turn?.items.map((event) => event.sequence)).toEqual([3]);
  });

  it("treats later text without eligibility as assistant text", () => {
    const ev = factory();
    const events = [
      ev("r1", { kind: "run", status: "succeeded", attempt: 1 }, 1),
      ev("r1", { kind: "text", text: "answer" }, 2),
    ];
    const [turn] = buildTimelineTurns(events);
    expect(turn?.userMessage).toBeNull();
    expect(turn?.items).toHaveLength(1);
  });

  it("merges non-run events with assistant text ordered by sequence", () => {
    const ev = factory();
    const events = [
      ev("r1", { kind: "run", status: "active", attempt: 1 }, 5),
      ev("r1", { kind: "tool", toolName: "read", status: "started" }, 2),
      ev("r1", { kind: "text", text: "user", promotionEligibility: "explicit" }, 1),
      ev("r1", { kind: "text", text: "partial" }, 4),
      ev("r1", { kind: "task", title: "T", status: "running" }, 3),
    ];
    const [turn] = buildTimelineTurns(events);
    expect(turn?.items.map((event) => event.sequence)).toEqual([2, 3, 4]);
  });

  it("uses the last run payload for status and attempt", () => {
    const ev = factory();
    const events = [
      ev("r1", { kind: "run", status: "active", attempt: 1 }, 1),
      ev("r1", { kind: "run", status: "succeeded", attempt: 2 }, 2),
    ];
    const [turn] = buildTimelineTurns(events);
    expect(turn?.status).toBe("succeeded");
    expect(turn?.attempt).toBe(2);
    expect(turn?.failed).toBe(false);
    expect(turn?.pending).toBe(false);
  });

  it("shows failed when an error exists and the last run is still active", () => {
    const ev = factory();
    const events = [
      ev("r1", { kind: "run", status: "active", attempt: 1 }, 1),
      ev("r1", { kind: "error", error: { code: "CHAT_AGENT_FAILED", message: "boom", retryable: false } }, 2),
    ];
    const [turn] = buildTimelineTurns(events);
    expect(turn?.failed).toBe(true);
    expect(turn?.status).toBe("failed");
    expect(turn?.pending).toBe(false);
  });

  it("shows failed when an error exists and no run event is present", () => {
    const ev = factory();
    const events = [ev("r1", { kind: "error", error: { code: "CHAT_AGENT_FAILED", message: "boom", retryable: true } }, 1)];
    const [turn] = buildTimelineTurns(events);
    expect(turn?.failed).toBe(true);
  });

  it("does not mark failed when the last run succeeded despite an error", () => {
    const ev = factory();
    const events = [
      ev("r1", { kind: "error", error: { code: "CHAT_AGENT_FAILED", message: "boom", retryable: false } }, 1),
      ev("r1", { kind: "run", status: "succeeded", attempt: 1 }, 2),
    ];
    const [turn] = buildTimelineTurns(events);
    expect(turn?.failed).toBe(false);
    expect(turn?.status).toBe("succeeded");
  });

  it("shows thinking pending while active without assistant text", () => {
    const ev = factory();
    const events = [
      ev("r1", { kind: "text", text: "q", promotionEligibility: "explicit" }, 1),
      ev("r1", { kind: "run", status: "active", attempt: 1 }, 2),
    ];
    const [turn] = buildTimelineTurns(events);
    expect(turn?.pending).toBe(true);
  });

  it("clears pending once assistant text arrives", () => {
    const ev = factory();
    const events = [
      ev("r1", { kind: "run", status: "active", attempt: 1 }, 1),
      ev("r1", { kind: "text", text: "answer" }, 2),
    ];
    const [turn] = buildTimelineTurns(events);
    expect(turn?.pending).toBe(false);
  });

  it("surfaces a retry entry on failure unless a retryable error row carries it", () => {
    const ev = factory();
    const withoutRetryable = buildTimelineTurns([
      ev("r1", { kind: "run", status: "active", attempt: 1 }, 1),
      ev("r1", { kind: "error", error: { code: "CHAT_AGENT_FAILED", message: "boom", retryable: false } }, 2),
    ]);
    expect(withoutRetryable[0]?.showRetryEntry).toBe(true);

    const ev2 = factory();
    const withRetryable = buildTimelineTurns([
      ev2("r1", { kind: "run", status: "active", attempt: 1 }, 1),
      ev2("r1", { kind: "error", error: { code: "CHAT_AGENT_FAILED", message: "boom", retryable: true } }, 2),
    ]);
    expect(withRetryable[0]?.showRetryEntry).toBe(false);
  });

  it("orders turns by first sequence across runs", () => {
    const ev = factory();
    const events = [
      ev("r2", { kind: "run", status: "succeeded", attempt: 1 }, 3),
      ev("r1", { kind: "run", status: "succeeded", attempt: 1 }, 1),
    ];
    const turns = buildTimelineTurns(events);
    expect(turns.map((turn) => turn.runId)).toEqual(["r1", "r2"]);
  });
});

describe("hasTaskEvent", () => {
  it("detects task payloads", () => {
    const ev = factory();
    expect(hasTaskEvent([ev("r1", { kind: "text", text: "a" })])).toBe(false);
    expect(hasTaskEvent([ev("r1", { kind: "task", title: "T", status: "routed" })])).toBe(true);
  });
});
