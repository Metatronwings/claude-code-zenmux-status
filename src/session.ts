import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
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

// Same hardening as git.ts: block system config and read-only locks so the
// status bar never executes a repo's .git/config hooks (e.g. core.fsmonitor).
const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0" };

/**
 * Derive the main worktree root (the repo's primary working tree) from `cwd`.
 *
 * Claude Code writes a session's JSONL under the project key of the cwd where
 * the session *started*. When the session later moves into a git worktree
 * (Claude Code's EnterWorktree), the JSONL stays put — it is NOT re-filed under
 * the worktree's path. So a status bar running in a worktree must look up the
 * *main* worktree root, not `cwd`.
 *
 * `git rev-parse --git-common-dir` gives us that: in a worktree it returns the
 * absolute path to the main repo's `.git`; in the main worktree it returns
 * `.git` (relative), which resolves to `cwd` itself. Stripping the trailing
 * `.git` yields the main worktree root. Returns null outside a git repo.
 */
function gitMainWorktreeRoot(cwd: string): string | null {
  try {
    let common = execSync("git rev-parse --git-common-dir", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
      env: GIT_ENV,
    }).toString().trim();
    if (!common) return null;
    // Main worktree returns a relative ".git" — resolve against cwd.
    if (!common.startsWith("/")) common = join(cwd, common);
    // common is <root>/.git. (A submodule's .git is a file — bail out there.)
    if (basename(common) !== ".git") return null;
    return dirname(common);
  } catch {
    return null;
  }
}

function projectKeyFor(path: string): string {
  return path.replace(/\//g, "-");
}

/**
 * Candidate `~/.claude/projects/<key>` directories to search for session JSONL,
 * in priority order: the current cwd first (covers the main worktree and the
 * non-git case), then the main worktree root (covers worktrees). Deduped so the
 * common "cwd is already the repo root" case costs nothing extra.
 */
function resolveProjectDirs(cwd: string, mainRoot: string | null): string[] {
  const projectsRoot = join(homedir(), ".claude", "projects");
  const dirs: string[] = [];
  const seen = new Set<string>();
  const add = (p: string) => {
    if (!seen.has(p)) { seen.add(p); dirs.push(join(projectsRoot, projectKeyFor(p))); }
  };
  add(cwd);
  if (mainRoot) add(mainRoot);
  return dirs;
}

/**
 * Candidate cwds for matching the `cwd` field in ~/.claude/sessions/<pid>.json.
 * Claude Code may record either the worktree path (after EnterWorktree) or the
 * original main-worktree cwd, so we accept a match against either.
 */
function resolveSessionCwds(cwd: string, mainRoot: string | null): string[] {
  const cwds: string[] = [];
  const seen = new Set<string>();
  const add = (p: string) => { if (!seen.has(p)) { seen.add(p); cwds.push(p); } };
  add(cwd);
  if (mainRoot) add(mainRoot);
  return cwds;
}

/** Find the active session for any of `cwds` by reading ~/.claude/sessions/<pid>.json. */
function findActiveSession(cwds: string[]): string | null {
  if (cwds.length === 0) return null;
  const cwdSet = new Set(cwds);
  try {
    const sessionsDir = join(homedir(), ".claude", "sessions");
    const files = readdirSync(sessionsDir).filter(f => f.endsWith(".json"));
    for (const f of files) {
      try {
        const meta: SessionMeta = JSON.parse(readFileSync(join(sessionsDir, f), "utf8"));
        if (!cwdSet.has(meta.cwd)) continue;
        // Verify the process is still alive
        process.kill(meta.pid, 0);
        return meta.sessionId;
      } catch { /* stale or unreadable — skip */ }
    }
  } catch { /* sessions dir doesn't exist */ }
  return null;
}

export function getSessionStats(
  cwd: string,
  hint?: { transcriptPath?: string; sessionId?: string }
): SessionStats {
  try {
    let sessionFile: { path: string } | undefined;

    // Claude Code's statusLine stdin hands us the current session's transcript
    // path directly. Trust it over any cwd/worktree inference — it always points
    // at the *current* session, fixing "shows the wrong model" when the status bar
    // runs in a subdirectory or worktree whose cwd doesn't match the session cwd.
    if (hint?.transcriptPath) {
      try {
        statSync(hint.transcriptPath);
        sessionFile = { path: hint.transcriptPath };
      } catch { /* stale/unreadable — fall through to inference */ }
    }

    if (!sessionFile) {
      // In a worktree, Claude Code still files the session JSONL under the main
      // worktree root's project key, so search every candidate project dir.
      const mainRoot = gitMainWorktreeRoot(cwd);
      const projectDirs = resolveProjectDirs(cwd, mainRoot);
      const activeSessionId = hint?.sessionId ?? findActiveSession(resolveSessionCwds(cwd, mainRoot));

      if (activeSessionId) {
        // Search candidate project dirs for the active session's JSONL.
        for (const dir of projectDirs) {
          const activePath = join(dir, `${activeSessionId}.jsonl`);
          try {
            statSync(activePath);
            sessionFile = { path: activePath };
            break;
          } catch { /* not in this candidate — try the next */ }
        }
        if (!sessionFile) {
          // Active session exists but its JSONL isn't in any candidate dir yet —
          // return zeros rather than falling back to a stale session's data.
          return { model: null, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, contextPct: null, durationSec: 0 };
        }
      }

      if (!sessionFile) {
        // Fallback: pick the most recently modified .jsonl across candidate dirs.
        let best: { path: string; mtime: number } | undefined;
        for (const dir of projectDirs) {
          let files: string[];
          try {
            files = readdirSync(dir);
          } catch {
            continue; // candidate project dir doesn't exist
          }
          for (const f of files) {
            if (!f.endsWith(".jsonl")) continue;
            try {
              const p = join(dir, f);
              const mtime = statSync(p).mtimeMs;
              if (!best || mtime > best.mtime) best = { path: p, mtime };
            } catch { /* file disappeared between readdir and stat */ }
          }
        }
        if (best) sessionFile = { path: best.path };
      }
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
