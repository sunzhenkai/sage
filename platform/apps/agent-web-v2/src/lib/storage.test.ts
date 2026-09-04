import { describe, expect, it } from "vitest";
import { readStorage, removeStorage, writeStorage } from "./storage";

describe("storage helpers", () => {
  it("round-trips values", () => {
    writeStorage("sage.test", "1");
    expect(readStorage("sage.test")).toBe("1");
    removeStorage("sage.test");
    expect(readStorage("sage.test")).toBeNull();
  });

  it("degrades silently when storage throws", () => {
    const original = window.localStorage;
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    Object.defineProperty(window, "localStorage", { value: broken, configurable: true });
    expect(readStorage("x")).toBeNull();
    expect(() => writeStorage("x", "y")).not.toThrow();
    expect(() => removeStorage("x")).not.toThrow();
    Object.defineProperty(window, "localStorage", { value: original, configurable: true });
  });
});
