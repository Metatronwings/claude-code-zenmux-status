import { readFileSync, renameSync, mkdirSync, rmdirSync, statSync } from "node:fs";
import { tmpPath, atomicWriteJson } from "./utils.js";

interface CacheEntry {
  ts: number;   // Date.now() when cached
  out: string;  // formatted output
}

function cachePath(apiKey: string): string {
  return tmpPath("czs", apiKey, ".cache");
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
  atomicWriteJson(cachePath(apiKey), { ts: Date.now(), out });
}

/** Locks older than this are treated as stale (holder crashed) and reclaimed. */
const STALE_LOCK_MS = 10_000;

/** Acquire an inter-process lock. `mkdirSync` is atomic on all platforms. */
export function tryAcquireLock(apiKey: string): boolean {
  const dir = lockPath(apiKey);
  try {
    mkdirSync(dir);
    return true;
  } catch {
    // Lock exists. If it's stale (holder likely crashed), try to reclaim.
    try {
      const age = Date.now() - statSync(dir).mtimeMs;
      if (age > STALE_LOCK_MS) {
        // Atomically rename the stale lock dir to a unique name.
        // renameSync is atomic — only one process can move the dir.
        // Losers get ENOENT (dir already moved by winner) and fall through.
        const staleDir = dir + ".reap." + process.pid;
        renameSync(dir, staleDir);
        try { rmdirSync(staleDir); } catch { /* best-effort cleanup */ }
        // Create a fresh lock for ourselves
        mkdirSync(dir);
        return true;
      }
    } catch {
      // Lock vanished, race with another reclaimer, or rename failed.
    }
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
export async function waitForCache(apiKey: string, timeoutMs: number, ttlMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200));
    const out = readCache(apiKey, ttlMs);
    if (out !== null) return out;
  }
  return null;
}
