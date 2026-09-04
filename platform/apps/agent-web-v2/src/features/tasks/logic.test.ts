import { describe, expect, it } from "vitest";
import type { TaskArtifactView, TaskRunLogEventView, TaskViewModel } from "@/types/tasks";
import {
  appendRunLogEvents,
  artifactHref,
  buildRunLogsPath,
  buildTaskListPath,
  controlAvailability,
  filterTasks,
  findPreviewableArtifact,
  payloadScalarSummary,
  runLogEventVariant,
  taskStatusKey,
} from "./logic";

function task(overrides: Partial<TaskViewModel> = {}): TaskViewModel {
  return {
    taskId: "task-1",
    taskType: "sage.agent-task.v1",
    workflowId: "wf-1",
    targetId: "target-1",
    attempt: 1,
    status: "running",
    revision: 1,
    projectionUpdatedAt: new Date(0).toISOString(),
    freshness: "fresh",
    targetSnapshot: { targetId: "target-1", environment: "development", namespace: "ns", taskQueue: "queue" },
    ...overrides,
  };
}

function artifact(overrides: Partial<TaskArtifactView> = {}): TaskArtifactView {
  return { artifactId: "a1", artifactRef: "artifact://a1", name: "output.md", mediaType: "text/markdown", ...overrides };
}

function event(eventId: string, sequence: number): TaskRunLogEventView {
  return { eventId, sequence, type: "model.completed" };
}

describe("buildTaskListPath", () => {
  it("omits the status parameter for `all` (spec §7.1)", () => {
    expect(buildTaskListPath("all")).toBe("/tasks");
  });

  it("passes the status parameter for concrete filters", () => {
    expect(buildTaskListPath("running")).toBe("/tasks?status=running");
    expect(buildTaskListPath("cancelled")).toBe("/tasks?status=cancelled");
  });
});

describe("filterTasks", () => {
  const tasks = [
    task({ taskId: "Alpha-Task", taskType: "sage.agent-task.v1" }),
    task({ taskId: "beta-task", taskType: "sage.release.v1" }),
    task({ taskId: "gamma", targetSnapshot: { targetId: "Prod-Cluster", environment: "production", namespace: "ns", taskQueue: "q" } }),
  ];

  it("matches case-insensitive substrings of taskId, taskType and target", () => {
    expect(filterTasks(tasks, "ALPHA").map((t) => t.taskId)).toEqual(["Alpha-Task"]);
    expect(filterTasks(tasks, "release").map((t) => t.taskId)).toEqual(["beta-task"]);
    expect(filterTasks(tasks, "prod-cluster").map((t) => t.taskId)).toEqual(["gamma"]);
  });

  it("returns everything for a blank query", () => {
    expect(filterTasks(tasks, "   ")).toHaveLength(3);
  });
});

describe("controlAvailability (spec §7.3)", () => {
  it.each([
    ["running", { pause: true, resume: false, cancel: true, retry: false }],
    ["paused", { pause: false, resume: true, cancel: true, retry: false }],
    ["failed", { pause: false, resume: false, cancel: true, retry: true }],
    ["succeeded", { pause: false, resume: false, cancel: false, retry: false }],
    ["cancelled", { pause: false, resume: false, cancel: false, retry: false }],
    ["effect_unknown", { pause: false, resume: false, cancel: false, retry: false }],
    ["mystery_status", { pause: false, resume: false, cancel: true, retry: false }],
  ])("status %s", (status, expected) => {
    expect(controlAvailability(status)).toEqual(expected);
  });
});

describe("taskStatusKey", () => {
  it("maps known statuses and returns null for unknown ones", () => {
    expect(taskStatusKey("running")).toBe("chat.taskStatus.running");
    expect(taskStatusKey("effect_unknown")).toBe("chat.taskStatus.effect_unknown");
    expect(taskStatusKey("mystery")).toBeNull();
  });
});

describe("appendRunLogEvents", () => {
  it("appends new events and dedupes by eventId (spec §7.5.1)", () => {
    const merged = appendRunLogEvents([event("e1", 1), event("e2", 2)], [event("e2", 2), event("e3", 3)]);
    expect(merged.map((e) => e.eventId)).toEqual(["e1", "e2", "e3"]);
  });
});

describe("payloadScalarSummary", () => {
  it("keeps only scalar values", () => {
    expect(
      payloadScalarSummary({ model: "gpt", tokens: 42, ok: true, none: null, nested: { a: 1 }, list: [1] }),
    ).toBe("model=gpt, tokens=42, ok=true, none=null");
  });

  it("handles a missing payload", () => {
    expect(payloadScalarSummary(undefined)).toBe("");
  });
});

describe("runLogEventVariant (spec §7.5.6)", () => {
  it.each([
    ["run.completed", "success"],
    ["run.failed", "destructive"],
    ["checkpoint.sealed", "warning"],
    ["model.completed", "info"],
    ["tool.completed", "info"],
    ["anything.else", "secondary"],
  ] as const)("%s → %s", (type, variant) => {
    expect(runLogEventVariant(type)).toBe(variant);
  });
});

describe("artifactHref (spec §7.6)", () => {
  it("always downloads the package artifact", () => {
    expect(artifactHref("/v1", "t1", artifact({ name: "output.tar.gz", mediaType: "application/gzip" }))).toBe(
      "/v1/tasks/t1/artifacts/a1?download=1",
    );
  });

  it("opens text-like artifacts inline and downloads the rest", () => {
    expect(artifactHref("/v1", "t1", artifact({ mediaType: "application/json" }))).toBe("/v1/tasks/t1/artifacts/a1");
    expect(artifactHref("/v1", "t1", artifact({ mediaType: "text/plain" }))).toBe("/v1/tasks/t1/artifacts/a1");
    expect(artifactHref("/v1", "t1", artifact({ mediaType: "image/png" }))).toBe("/v1/tasks/t1/artifacts/a1?download=1");
  });
});

describe("findPreviewableArtifact", () => {
  it("returns the first text-like non-package artifact", () => {
    const artifacts = [
      artifact({ artifactId: "pkg", name: "output.tar.gz", mediaType: "application/gzip" }),
      artifact({ artifactId: "bin", mediaType: "application/octet-stream" }),
      artifact({ artifactId: "txt", mediaType: "text/markdown" }),
    ];
    expect(findPreviewableArtifact(artifacts)?.artifactId).toBe("txt");
    expect(findPreviewableArtifact([artifacts[0]!, artifacts[1]!])).toBeUndefined();
  });
});

describe("buildRunLogsPath", () => {
  it("builds attempt switch and load-more paths (spec §7.5)", () => {
    expect(buildRunLogsPath("t1")).toBe("/tasks/t1/run-logs");
    expect(buildRunLogsPath("t1", { runId: "r1", attemptId: "a2" })).toBe("/tasks/t1/run-logs?runId=r1&attemptId=a2");
    expect(buildRunLogsPath("t1", { runId: "r1", attemptId: "a2" }, 7)).toBe(
      "/tasks/t1/run-logs?runId=r1&attemptId=a2&fromSequence=7",
    );
  });
});
