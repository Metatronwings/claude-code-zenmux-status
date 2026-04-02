import { execSync } from "child_process";
import { fetchDetail } from "./api.js";
import { formatStatus } from "./format.js";
import { readCache, writeCache } from "./cache.js";
import { getSessionStats, formatModelName } from "./session.js";

function getGitBranch(): string | null {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    return branch === "HEAD" ? null : branch;
  } catch {
    return null;
  }
}

function getGitStatus(): { counts: string; isDirty: boolean } {
  try {
    const out = execSync("git status --porcelain", {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    const lines = out.split("\n").filter(l => l.length > 0);
    let added = 0, modified = 0, untracked = 0;
    for (const line of lines) {
      if (line[0] === "?" && line[1] === "?") untracked++;
      else if (line[0] === "A")               added++;
      else                                    modified++;
    }
    const parts: string[] = [];
    if (added > 0)     parts.push(`\x1b[32m+${added}\x1b[0m`);
    if (modified > 0)  parts.push(`\x1b[33m~${modified}\x1b[0m`);
    if (untracked > 0) parts.push(`\x1b[31m?${untracked}\x1b[0m`);
    const isDirty = added + modified + untracked > 0;
    return { counts: parts.join(" "), isDirty };
  } catch {
    return { counts: "", isDirty: false };
  }
}

function buildGitLine(): string {
  const home = process.env.HOME ?? "";
  const cwd = process.cwd();
  const shortCwd = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;

  const branch = getGitBranch();
  const { counts, isDirty } = getGitStatus();

  const parts: string[] = [`📁${shortCwd}`];
  if (branch) parts.push(`🌿(${branch})`);
  if (isDirty) parts.push(`\x1b[31m✗\x1b[0m ${counts}`);

  return parts.join(" ");
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

const apiKey = process.env.ZENMUX_MANAGEMENT_API_KEY;

if (!apiKey) {
  process.stderr.write("ZENMUX_MANAGEMENT_API_KEY must be set\n");
  process.exit(1);
}

const ttlMs = Number(process.env.ZENMUX_CACHE_TTL ?? 60) * 1000;
const useBar = process.env.ZENMUX_PROGRESS_BAR === "1";
const hide7dBelow70 = process.env.ZENMUX_HIDE_7D_BELOW_70 === "1";

// Session stats and git line are always fresh — never cached
const cwd = process.cwd();
const session = useBar ? getSessionStats(cwd) : null;
const modelPrefix = session?.model ? `[${formatModelName(session.model)}] ` : "";
const tokenSuffix = session ? ` | ↑${fmtK(session.inputTokens)} ↓${fmtK(session.outputTokens)}` : "";
const gitLine = buildGitLine();

// Include useBar in cache key so toggling the option doesn't serve wrong-format cache
const cacheKey = apiKey + (useBar ? ":bar" : "");

const cached = readCache(cacheKey, ttlMs);
if (cached !== null) {
  process.stdout.write(modelPrefix + cached + tokenSuffix + "\n" + gitLine + "\n");
  process.exit(0);
}

try {
  const { detail, serverNowMs } = await fetchDetail(apiKey);
  const out = formatStatus(detail, serverNowMs, useBar, hide7dBelow70);
  writeCache(cacheKey, out);
  process.stdout.write(modelPrefix + out + tokenSuffix + "\n" + gitLine + "\n");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stdout.write(`⚡ ERR: ${msg}\n` + gitLine + "\n");
  process.exit(0);
}
