import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BASELINE_FILE = join(tmpdir(), "czs-baselines.json");

interface TokenCounts { input: number; output: number }
type Baselines = Record<string, TokenCounts>;

function load(): Baselines {
  try { return JSON.parse(readFileSync(BASELINE_FILE, "utf8")); }
  catch { return {}; }
}

function save(b: Baselines): void {
  try { writeFileSync(BASELINE_FILE, JSON.stringify(b)); }
  catch { /* ignore */ }
}

/**
 * Returns the baseline counts for a session file.
 * On first call for a given path, records `current` as the baseline (delta = 0).
 */
export function getBaseline(filePath: string, current: TokenCounts): TokenCounts {
  const baselines = load();
  if (!(filePath in baselines)) {
    baselines[filePath] = current;
    save(baselines);
    return current;
  }
  return baselines[filePath];
}
