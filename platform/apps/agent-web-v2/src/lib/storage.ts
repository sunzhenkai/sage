/**
 * Fault-tolerant localStorage access. All browser persistence must go through
 * these helpers so privacy mode / storage failures degrade silently (spec §12).
 */
export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage unavailable — silently degrade
  }
}

export function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // storage unavailable — silently degrade
  }
}
