import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadBaseline, saveBaseline } from "./baseline.js";

export interface SessionStats {
  model: string | null;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  contextPct: number | null;
}

export function formatModelName(raw: string): string {
  const name = (raw.split("/").pop() ?? raw).replace(/^claude-/, "");
  const match = name.match(/^(\w+)-(\d+)[.-](\d+)/);
  if (!match) return name;
  const [, family, major, minor] = match;
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`;
}

export function getSessionStats(cwd: string): SessionStats {
  try {
    const projectKey = cwd.replace(/\//g, "-");
    const projectDir = join(homedir(), ".claude", "projects", projectKey);

    const sessionFile = readdirSync(projectDir)
      .filter(f => f.endsWith(".jsonl"))
      .map(f => ({ path: join(projectDir, f), mtime: statSync(join(projectDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0];

    if (!sessionFile) return { model: null, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, contextPct: null };

    const lines = readFileSync(sessionFile.path, "utf8").trimEnd().split("\n");
    const stored = loadBaseline(sessionFile.path);
    const hasBaseline = stored != null && typeof stored.lineCount === "number" && stored.lineCount >= 0;

    let inputTokens = stored?.input ?? 0;
    let cacheReadTokens = stored?.cacheRead ?? 0;
    let outputTokens = stored?.output ?? 0;
    let model = stored?.model ?? null;
    let lastContextTokens = stored?.lastContextTokens ?? null;
    const startLine = hasBaseline ? stored!.lineCount : 0;

    const seenIds = new Set<string>();
    for (let i = startLine; i < lines.length; i++) {
      if (!lines[i]) continue;
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type === "assistant" && entry.message?.usage) {
          const msgId = entry.message.id;
          if (!msgId || seenIds.has(msgId)) continue;
          seenIds.add(msgId);

          const u = entry.message.usage;
          const nc = u.input_tokens ?? 0;
          const cr = u.cache_read_input_tokens ?? 0;
          inputTokens += nc;
          cacheReadTokens += cr;
          outputTokens += u.output_tokens ?? 0;
          if (entry.message.model) model = entry.message.model;
          lastContextTokens = nc + cr;
        }
      } catch { /* skip malformed lines */ }
    }

    // Session-start totals: set once, used for cumulative delta display
    const sessInput = hasBaseline ? (stored.sessionInput ?? stored.input) : inputTokens;
    const sessCache = hasBaseline ? (stored.sessionCacheRead ?? stored.cacheRead) : cacheReadTokens;
    const sessOutput = hasBaseline ? (stored.sessionOutput ?? stored.output) : outputTokens;

    saveBaseline(sessionFile.path, {
      input: inputTokens,
      cacheRead: cacheReadTokens,
      output: outputTokens,
      sessionInput: sessInput,
      sessionCacheRead: sessCache,
      sessionOutput: sessOutput,
      model,
      lastContextTokens,
      lineCount: lines.length,
    });

    const contextPct = lastContextTokens != null ? Math.min(1, lastContextTokens / 1_000_000) : null;
    return {
      model,
      inputTokens: Math.max(0, inputTokens - sessInput),
      cacheReadTokens: Math.max(0, cacheReadTokens - sessCache),
      outputTokens: Math.max(0, outputTokens - sessOutput),
      contextPct,
    };
  } catch {
    return { model: null, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, contextPct: null };
  }
}
