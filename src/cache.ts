import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, rmdirSync } from "node:fs";
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

function lockPath(apiKey: string): string {
  return cachePath(apiKey) + ".lock";
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
  const target = cachePath(apiKey);
  const tmp = target + ".tmp." + process.pid;
  try {
    const entry: CacheEntry = { ts: Date.now(), out };
    writeFileSync(tmp, JSON.stringify(entry), "utf8");
    renameSync(tmp, target);
  } catch {
    try { unlinkSync(tmp); } catch { /* best-effort cleanup */ }
  }
}

/** Acquire an inter-process lock. `mkdirSync` is atomic on all platforms. */
export function tryAcquireLock(apiKey: string): boolean {
  try {
    mkdirSync(lockPath(apiKey));
    return true;
  } catch {
    return false;
  }
}

export function releaseLock(apiKey: string): void {
  try { rmdirSync(lockPath(apiKey)); } catch { /* already released */ }
}

/**
 * Wait for another process (that holds the lock) to populate the cache.
 * Returns the cached string, or null if timed out.
 */
export async function waitForCache(apiKey: string, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200));
    const out = readCache(apiKey, 60_000);
    if (out !== null) return out;
  }
  return null;
}
