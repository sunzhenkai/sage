import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import type { ManifestSummary } from "@/types/packages";
import {
  APP_ID_PATTERN,
  MAX_ARCHIVE_BYTES,
  buildCreateAppBody,
  buildRunRequest,
  buildUploadFormData,
  isAlreadyExistsError,
  isEnumInput,
  toPackageSummary,
  validateCreateAppForm,
  validateUploadFile,
} from "./logic";

describe("toPackageSummary (spec §9.1)", () => {
  it("maps appId to packageId and keeps populated fields", () => {
    const view = toPackageSummary({
      appId: "my-app",
      name: "My App",
      description: "desc",
      releaseCount: 3,
      latestVersion: "2.0.0",
      latestContentDigest: "sha256:abc",
      updatedAt: "2026-09-01T10:00:00Z",
      createdAt: "2026-08-01T10:00:00Z",
    });
    expect(view).toEqual({
      packageId: "my-app",
      name: "My App",
      description: "desc",
      releaseCount: 3,
      latestVersion: "2.0.0",
      latestContentDigest: "sha256:abc",
      updatedAt: "2026-09-01T10:00:00Z",
    });
  });

  it("falls back when latestVersion / latestContentDigest / updatedAt are missing", () => {
    const view = toPackageSummary({
      appId: "empty-app",
      releaseCount: 0,
      createdAt: "2026-08-01T10:00:00Z",
    });
    expect(view.name).toBe("empty-app");
    expect(view.latestVersion).toBeNull();
    expect(view.latestContentDigest).toBe("");
    expect(view.updatedAt).toBe("2026-08-01T10:00:00Z");
  });
});

describe("validateCreateAppForm (spec §9.2)", () => {
  it("accepts a valid form", () => {
    expect(validateCreateAppForm({ appId: "my-app", name: "My App", description: "" })).toEqual([]);
  });

  it("rejects empty / trimmed-empty appId and name", () => {
    expect(validateCreateAppForm({ appId: "   ", name: "  ", description: "" })).toEqual(["appId", "name"]);
  });

  it("enforces the appId pattern", () => {
    for (const bad of ["-lead", "trail-", "Upper", "with_underscore", "a b"]) {
      expect(validateCreateAppForm({ appId: bad, name: "n", description: "" })).toContain("appId");
    }
    expect(APP_ID_PATTERN.test("a")).toBe(true);
    expect(APP_ID_PATTERN.test("a-b-c1")).toBe(true);
  });

  it("enforces maxlength 128 for appId and name", () => {
    const long = "a".repeat(129);
    const errors = validateCreateAppForm({ appId: long, name: long, description: "" });
    expect(errors).toEqual(expect.arrayContaining(["appId", "name"]));
  });

  it("enforces the 2048 description cap", () => {
    expect(validateCreateAppForm({ appId: "ok", name: "ok", description: "d".repeat(2049) })).toEqual(["description"]);
    expect(validateCreateAppForm({ appId: "ok", name: "ok", description: "d".repeat(2048) })).toEqual([]);
  });
});

describe("buildCreateAppBody (spec §9.2)", () => {
  it("trims fields and omits an empty description", () => {
    expect(buildCreateAppBody({ appId: " my-app ", name: " My App ", description: "   " })).toEqual({
      appId: "my-app",
      name: "My App",
    });
    expect(buildCreateAppBody({ appId: "a", name: "b", description: " d " })).toEqual({
      appId: "a",
      name: "b",
      description: "d",
    });
  });
});

describe("validateUploadFile (spec §9.4)", () => {
  it("requires a selected file", () => {
    expect(validateUploadFile(null)).toBe("missing");
    expect(validateUploadFile(undefined)).toBe("missing");
  });

  it("rejects files over 8 MiB", () => {
    expect(validateUploadFile({ name: "a.tar.gz", size: MAX_ARCHIVE_BYTES + 1 })).toBe("tooLarge");
    expect(validateUploadFile({ name: "a.tar.gz", size: MAX_ARCHIVE_BYTES })).toBeNull();
  });

  it("enforces the allowed extensions", () => {
    for (const ok of ["a.tar.gz", "a.tgz", "a.tar", "a.zip", "a.gz", "A.TAR.GZ"]) {
      expect(validateUploadFile({ name: ok, size: 1 })).toBeNull();
    }
    for (const bad of ["a.txt", "a.tar.gz.txt", "a"]) {
      expect(validateUploadFile({ name: bad, size: 1 })).toBe("badExtension");
    }
  });
});

describe("buildUploadFormData (spec §9.4)", () => {
  it("attaches the archive under the `file` field", () => {
    const file = new File(["x"], "pkg.tar.gz", { type: "application/gzip" });
    const formData = buildUploadFormData(file);
    const sent = formData.get("file");
    expect(sent).toBeInstanceOf(File);
    expect((sent as File).name).toBe("pkg.tar.gz");
  });
});

describe("isAlreadyExistsError (spec §9.5)", () => {
  it("treats 409 and APP_ALREADY_EXISTS as non-failures", () => {
    expect(isAlreadyExistsError(new ApiError(409, undefined))).toBe(true);
    expect(isAlreadyExistsError(new ApiError(400, { code: "APP_ALREADY_EXISTS" }))).toBe(true);
    expect(isAlreadyExistsError(new ApiError(500, { code: "OTHER" }))).toBe(false);
    expect(isAlreadyExistsError(new Error("nope"))).toBe(false);
  });
});

const manifest: ManifestSummary = {
  id: "demo",
  version: "1.0.0",
  description: "",
  entry: "prompts/system.md",
  modelRoute: { provider: "p", model: "m" },
  skillRefs: [],
  capabilityRefs: [],
  inputs: [
    { name: "topic", type: "string", required: true },
    { name: "limit", type: "number", default: 10 },
    { name: "lang", type: "enum", enum: ["zh", "en"], default: "zh" },
  ],
  tasks: [
    { name: "task-a", entry: "prompts/system.md" },
    { name: "task-b", entry: "prompts/system.md" },
  ],
};

describe("buildRunRequest (spec §9.7)", () => {
  it("omits blank fields and sends declared params", () => {
    const built = buildRunRequest(manifest, { topic: " ai ", limit: "", lang: "en" }, "task-a");
    expect(built).toEqual({ ok: true, body: { task: "task-a", params: { topic: "ai", lang: "en" } } });
  });

  it("converts number inputs to JS numbers", () => {
    const built = buildRunRequest(manifest, { topic: "", limit: "42", lang: "" }, "task-a");
    expect(built.ok && built.body.params).toEqual({ limit: 42 });
  });

  it("rejects non-finite numbers as a param error", () => {
    const built = buildRunRequest(manifest, { topic: "", limit: "abc", lang: "" }, "task-a");
    expect(built).toEqual({ ok: false, error: { kind: "nonFiniteNumber", name: "limit" } });
  });

  it("defaults to the first task when more than one task exists", () => {
    const built = buildRunRequest(manifest, {}, "");
    expect(built.ok && built.body.task).toBe("task-a");
  });

  it("omits task and params when a single-task manifest has no values", () => {
    const single: ManifestSummary = { ...manifest, tasks: [{ name: "only", entry: "prompts/system.md" }] };
    const built = buildRunRequest(single, {}, undefined);
    expect(built).toEqual({ ok: true, body: {} });
  });
});

describe("isEnumInput (spec §9.7)", () => {
  it("detects enum inputs by type or enum list", () => {
    expect(isEnumInput({ type: "enum" })).toBe(true);
    expect(isEnumInput({ type: "string", enum: ["a"] })).toBe(true);
    expect(isEnumInput({ type: "string" })).toBe(false);
  });
});
