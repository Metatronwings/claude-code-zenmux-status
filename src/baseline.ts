import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BASELINE_FILE = join(tmpdir(), "czs-baselines.json");

interface Baseline {
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
}

type Baselines = Record<string, Baseline>;

function load(): Baselines {
  try { return JSON.parse(readFileSync(BASELINE_FILE, "utf8")); }
  catch { return {}; }
}

function save(b: Baselines): void {
  try { writeFileSync(BASELINE_FILE, JSON.stringify(b)); }
  catch { /* ignore */ }
}

export function loadBaseline(filePath: string): Baseline | null {
  const baselines = load();
  let changed = false;
  for (const key of Object.keys(baselines)) {
    if (!existsSync(key)) {
      delete baselines[key];
      changed = true;
    }
  }
  if (changed) save(baselines);
  return baselines[filePath] ?? null;
}

export function saveBaseline(filePath: string, b: Baseline): void {
  const baselines = load();
  baselines[filePath] = b;
  save(baselines);
}
