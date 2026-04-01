import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface SessionStats {
  model: string | null;
  inputTokens: number;
  outputTokens: number;
}

export function formatModelName(raw: string): string {
  const name = (raw.split("/").pop() ?? raw).replace(/^claude-/, "");
  // "sonnet-4.6" → "Sonnet 4.6"  "opus-4-6" → "Opus 4.6"  "haiku-4-5-20251001" → "Haiku 4.5"
  const match = name.match(/^(\w+)-(\d+)[.-](\d+)/);
  if (!match) return name;
  const [, family, major, minor] = match;
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`;
}

export function getSessionStats(cwd: string): SessionStats {
  try {
    const projectKey = cwd.replace(/\//g, "-");
    const projectDir = join(homedir(), ".claude", "projects", projectKey);

    // Most recently modified top-level .jsonl = current session
    const sessionFile = readdirSync(projectDir)
      .filter(f => f.endsWith(".jsonl"))
      .map(f => ({ path: join(projectDir, f), mtime: statSync(join(projectDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0];

    if (!sessionFile) return { model: null, inputTokens: 0, outputTokens: 0 };

    const lines = readFileSync(sessionFile.path, "utf8").split("\n");
    let inputTokens = 0, outputTokens = 0, model: string | null = null;

    for (const line of lines) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === "assistant" && entry.message?.usage) {
          const u = entry.message.usage;
          // Count all input: direct + cache creation + cache reads
          inputTokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
          outputTokens += u.output_tokens ?? 0;
          if (entry.message.model) model = entry.message.model;
        }
      } catch { /* skip malformed lines */ }
    }

    return { model, inputTokens, outputTokens };
  } catch {
    return { model: null, inputTokens: 0, outputTokens: 0 };
  }
}
