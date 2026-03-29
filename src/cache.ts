import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface CacheEntry {
  ts: number;   // Date.now() when cached
  out: string;  // formatted output
}

function cachePath(apiKey: string): string {
  const hash = createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
  return join(tmpdir(), `czs-${hash}.cache`);
}

export function readCache(apiKey: string, ttlMs: number): string | null {
  try {
    const raw = readFileSync(cachePath(apiKey), "utf8");
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.ts < ttlMs) return entry.out;
  } catch {
    // cache miss or corrupt — ignore
  }
  return null;
}

export function writeCache(apiKey: string, out: string): void {
  try {
    const entry: CacheEntry = { ts: Date.now(), out };
    writeFileSync(cachePath(apiKey), JSON.stringify(entry), "utf8");
  } catch {
    // non-fatal — status bar still works without cache
  }
}
