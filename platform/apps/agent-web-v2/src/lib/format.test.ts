import { describe, expect, it } from "vitest";
import { formatArtifactKB, formatBytes, formatFullTime, formatListTime, formatShortTime } from "./format";

describe("format", () => {
  const iso = "2026-09-04T08:05:00.000Z";

  it("formats full time with locale medium date + short time", () => {
    const value = formatFullTime(iso, "en");
    expect(value).toContain("2026");
  });

  it("formats short time as two-digit hour and minute", () => {
    const value = formatShortTime(iso, "en");
    expect(value).toMatch(/\d{2}:\d{2}/);
  });

  it("formats list time as fixed MM-DD HH:mm", () => {
    expect(formatListTime(iso)).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("formats bytes as B / KB / MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("formats artifact size in KB with a 1 KB floor", () => {
    expect(formatArtifactKB(10)).toBe("1 KB");
    expect(formatArtifactKB(2048)).toBe("2 KB");
  });
});
