import { createHash } from "node:crypto";
import { writeFileSync, renameSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Derive a stable temp-file path from a key, scoped by namespace. */
export function tmpPath(namespace: string, key: string, ext: string): string {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return join(tmpdir(), `${namespace}-${hash}${ext}`);
}

/** Atomically write JSON data to `filePath` (write-to-tmp + rename). */
export function atomicWriteJson<T>(filePath: string, data: T): void {
  const tmp = filePath + ".tmp." + process.pid;
  try {
    writeFileSync(tmp, JSON.stringify(data), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, filePath);
  } catch {
    try { unlinkSync(tmp); } catch { /* best-effort cleanup */ }
  }
}

/** ANSI color escape for a 0–1 usage rate. */
export function pctColor(rate: number): string {
  if (rate > 0.80) return "\x1b[31m";
  if (rate > 0.50) return "\x1b[33m";
  return "\x1b[32m";
}

/** Parse a numeric env var. Treats empty string and NaN/Infinity/negative as default. */
export function safeNum(raw: string | undefined, defaultVal: number): number {
  if (raw === undefined || raw === "") return defaultVal;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : defaultVal;
}
