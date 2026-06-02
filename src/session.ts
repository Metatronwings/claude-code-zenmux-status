import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { loadBaseline, saveBaseline } from "./baseline.js";

export interface SessionStats {
  model: string | null;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  contextPct: number | null;
  durationSec: number;
}

export function formatModelName(raw: string): string {
  const name = (raw.split("/").pop() ?? raw).replace(/^claude-/, "");
  const match = name.match(/^(\w+)-(\d+)[.-](\d+)/);
  if (!match) return name;
  const [, family, major, minor] = match;
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`;
}

interface SessionMeta {
  pid: number;
  sessionId: string;
  cwd: string;
  status: string;
}

/** Find the active session for `cwd` by reading ~/.claude/sessions/<pid>.json. */
function findActiveSession(cwd: string): string | null {
  try {
    const sessionsDir = join(homedir(), ".claude", "sessions");
    const files = readdirSync(sessionsDir).filter(f => f.endsWith(".json"));
    for (const f of files) {
      try {
        const meta: SessionMeta = JSON.parse(readFileSync(join(sessionsDir, f), "utf8"));
        if (meta.cwd !== cwd) continue;
        // Verify the process is still alive
        process.kill(meta.pid, 0);
        return meta.sessionId;
      } catch { /* stale or unreadable — skip */ }
    }
  } catch { /* sessions dir doesn't exist */ }
  return null;
}

export function getSessionStats(cwd: string): SessionStats {
  try {
    const projectKey = cwd.replace(/\//g, "-");
    const projectDir = join(homedir(), ".claude", "projects", projectKey);

    // Prefer the active session from ~/.claude/sessions/ over mtime-based selection.
    // This avoids reading the wrong session's JSONL when a new session starts.
    const activeSessionId = findActiveSession(cwd);
    let sessionFile: { path: string } | undefined;

    if (activeSessionId) {
      const activePath = join(projectDir, `${activeSessionId}.jsonl`);
      try {
        statSync(activePath);
        sessionFile = { path: activePath };
      } catch {
        // Active session exists but JSONL not written yet — return zeros
        // rather than falling back to an old session's stale data.
        return { model: null, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, contextPct: null, durationSec: 0 };
      }
    }

    if (!sessionFile) {
      sessionFile = readdirSync(projectDir)
        .filter(f => f.endsWith(".jsonl"))
        .flatMap(f => {
          try {
            return [{ path: join(projectDir, f), mtime: statSync(join(projectDir, f)).mtimeMs }];
          } catch {
            return []; // file disappeared between readdir and stat
          }
        })
        .sort((a, b) => b.mtime - a.mtime)[0];
    }

    if (!sessionFile) return { model: null, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, contextPct: null, durationSec: 0 };

    const lines = readFileSync(sessionFile.path, "utf8").trimEnd().split("\n");
    const stored = loadBaseline(sessionFile.path);
    const hasBaseline = stored != null && typeof stored.lineCount === "number" && stored.lineCount >= 0;

    const sessionId = basename(sessionFile.path, ".jsonl");

    let inputTokens = !hasBaseline ? 0 : (stored?.input ?? 0);
    let cacheReadTokens = !hasBaseline ? 0 : (stored?.cacheRead ?? 0);
    let outputTokens = !hasBaseline ? 0 : (stored?.output ?? 0);
    let model = !hasBaseline ? null : (stored?.model ?? null);
    let lastContextTokens = !hasBaseline ? null : (stored?.lastContextTokens ?? null);
    const startLine = !hasBaseline ? 0 : stored!.lineCount;

    let lastProcessedLine = startLine;
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
        lastProcessedLine = i + 1;
      } catch { /* skip malformed lines — don't advance lastProcessedLine */ }
    }

    if (model === null) {
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i]) continue;
        try {
          const m = JSON.parse(lines[i]).message?.model;
          if (m) { model = m; break; }
        } catch { /* skip */ }
      }
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const freshSession = !hasBaseline;
    const sessInput = freshSession ? inputTokens : (stored!.sessionInput ?? stored!.input);
    const sessCache = freshSession ? cacheReadTokens : (stored!.sessionCacheRead ?? stored!.cacheRead);
    const sessOutput = freshSession ? outputTokens : (stored!.sessionOutput ?? stored!.output);
    const startedAt = freshSession ? nowSec : (stored!.startedAt ?? nowSec);

    saveBaseline(sessionFile.path, {
      input: inputTokens,
      cacheRead: cacheReadTokens,
      output: outputTokens,
      sessionInput: sessInput,
      sessionCacheRead: sessCache,
      sessionOutput: sessOutput,
      startedAt,
      model,
      lastContextTokens,
      lineCount: lastProcessedLine,
      sessionId,
    });

    const contextPct = lastContextTokens != null ? Math.min(1, lastContextTokens / 1_000_000) : null;
    return {
      model,
      inputTokens: Math.max(0, inputTokens - sessInput),
      cacheReadTokens: Math.max(0, cacheReadTokens - sessCache),
      outputTokens: Math.max(0, outputTokens - sessOutput),
      contextPct,
      durationSec: nowSec - startedAt,
    };
  } catch {
    return { model: null, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, contextPct: null, durationSec: 0 };
  }
}
