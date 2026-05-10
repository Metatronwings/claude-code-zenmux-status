import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface Baseline {
  input: number;
  cacheRead: number;
  output: number;
  sessionInput: number;
  sessionCacheRead: number;
  sessionOutput: number;
  startedAt: number;
  model: string | null;
  lastContextTokens: number | null;
  lineCount: number;
  sessionId?: string;
}

function baselinePath(filePath: string): string {
  const hash = createHash("sha256").update(filePath).digest("hex").slice(0, 16);
  return join(tmpdir(), `czs-bl-${hash}.json`);
}

export function loadBaseline(filePath: string): Baseline | null {
  try {
    return JSON.parse(readFileSync(baselinePath(filePath), "utf8"));
  } catch {
    return null;
  }
}

export function saveBaseline(filePath: string, b: Baseline): void {
  const target = baselinePath(filePath);
  const tmp = target + ".tmp." + process.pid;
  try {
    writeFileSync(tmp, JSON.stringify(b), "utf8");
    renameSync(tmp, target);
  } catch {
    try { unlinkSync(tmp); } catch { /* best-effort cleanup */ }
  }
}
