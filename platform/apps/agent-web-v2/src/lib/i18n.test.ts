import { describe, expect, it } from "vitest";
import zhCN from "./i18n/messages.zh-CN";
import en from "./i18n/messages.en";

function flatten(value: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === "string" ? [`${prefix}${key}`] : flatten(child as Record<string, unknown>, `${prefix}${key}.`),
  );
}

describe("i18n dictionaries", () => {
  it("zh-CN and en have identical key structure", () => {
    const zhKeys = flatten(zhCN as unknown as Record<string, unknown>).sort();
    const enKeys = flatten(en as unknown as Record<string, unknown>).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it("no empty messages", () => {
    for (const key of flatten(zhCN as unknown as Record<string, unknown>)) {
      let node: unknown = zhCN;
      for (const part of key.split(".")) node = (node as Record<string, unknown>)[part];
      expect(typeof node).toBe("string");
      expect((node as string).length).toBeGreaterThan(0);
    }
  });
});
