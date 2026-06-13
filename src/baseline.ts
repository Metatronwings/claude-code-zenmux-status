import { readFileSync } from "node:fs";
import { tmpPath, atomicWriteJson } from "./utils.js";

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
  return tmpPath("czs-bl", filePath, ".json");
}

export function loadBaseline(filePath: string): Baseline | null {
  try {
    return JSON.parse(readFileSync(baselinePath(filePath), "utf8"));
  } catch {
    return null;
  }
}

export function saveBaseline(filePath: string, b: Baseline): void {
  atomicWriteJson(baselinePath(filePath), b);
}
