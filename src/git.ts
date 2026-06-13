import { execSync } from "child_process";

// Prevent git config from executing external commands (e.g. core.fsmonitor).
// GIT_CONFIG_NOSYSTEM blocks system-level config; GIT_OPTIONAL_LOCKS=0
// avoids unnecessary lock contention in read-only operations.
const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0" };

function getGitBranch(): string | null {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
      env: GIT_ENV,
    }).toString().trim();
    return branch === "HEAD" ? null : branch;
  } catch {
    return null;
  }
}

function getGitStatus(): { counts: string; isDirty: boolean } {
  try {
    // -c core.fsmonitor= disables file-system monitor hook that could exec
    // arbitrary commands in a malicious repo's .git/config.
    const out = execSync("git -c core.fsmonitor= status --porcelain", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
      env: GIT_ENV,
    }).toString();
    const lines = out.split("\n").filter(l => l.length > 0);
    let added = 0, modified = 0, deleted = 0, untracked = 0;
    for (const line of lines) {
      const s = line.slice(0, 2);
      if (s === "??")                     untracked++;
      else if (s[0] === "A")               added++;
      else if (s[0] === "D" || s[1] === "D") deleted++;
      else                                 modified++;
    }
    const parts: string[] = [];
    if (added > 0)     parts.push(`\x1b[32m+${added}\x1b[0m`);
    if (modified > 0)  parts.push(`\x1b[33m~${modified}\x1b[0m`);
    if (deleted > 0)   parts.push(`\x1b[31m-${deleted}\x1b[0m`);
    if (untracked > 0) parts.push(`\x1b[31m?${untracked}\x1b[0m`);
    const isDirty = added + modified + deleted + untracked > 0;
    return { counts: parts.join(" "), isDirty };
  } catch {
    return { counts: "", isDirty: false };
  }
}

export function buildGitLine(): string {
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
