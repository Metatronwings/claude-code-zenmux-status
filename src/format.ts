import type { SubscriptionDetail, QuotaWindow } from "./api.js";

const STATUS_BADGE: Record<string, string> = {
  monitored: " [monitored]",
  abusive:   " [abusive]",
  suspended: " [suspended]",
  banned:    " [banned]",
};

const TIER_EMOJI: Record<string, string> = {
  ultra: "💎",
  max:   "🔥",
  pro:   "⭐",
  free:  "🌱",
};

const BAR_WIDTH = 10;

function renderGradientBar(rate: number): string {
  const pos = rate * BAR_WIDTH;
  const full = Math.floor(pos);
  const frac = pos - full;

  let bar = "█".repeat(full);
  if (full < BAR_WIDTH) {
    if (frac >= 0.75)      bar += "▓";
    else if (frac >= 0.50) bar += "▒";
    else if (frac >= 0.25) bar += "░";
    bar = bar.padEnd(BAR_WIDTH, "░");
  }

  const color = rate > 0.80 ? "\x1b[31m" : rate > 0.50 ? "\x1b[33m" : "\x1b[32m";
  return color + bar + "\x1b[0m";
}

/**
 * Bar mode:   returns "<tierEmoji> <gradBar> <pct>% [| 7d <gradBar> <pct>%]"
 *             — model name and token counts are prepended/appended by index.ts
 * Non-bar mode: returns "<tierEmoji> <tier> | 5h <pct>% $x/$y ↻t [| 7d ...]"
 */
export function formatStatus(detail: SubscriptionDetail, serverNowMs: number, useBar: boolean, hide7dBelow70 = false): string {
  const { plan, account_status, quota_7_day, quota_5_hour } = detail;
  const badge = STATUS_BADGE[account_status] ?? "";
  const emoji = TIER_EMOJI[plan.tier] ?? "⚡";
  const show7d = !hide7dBelow70 || quota_7_day.usage_percentage > 0.70;

  if (useBar) {
    const parts: string[] = [
      `${emoji} ${renderGradientBar(quota_5_hour.usage_percentage)} ${pct(quota_5_hour.usage_percentage)} ${resetStr(quota_5_hour, serverNowMs)}`.trimEnd(),
    ];
    if (show7d) {
      parts.push(`7d ${renderGradientBar(quota_7_day.usage_percentage)} ${pct(quota_7_day.usage_percentage)} ${resetStr(quota_7_day, serverNowMs)}`.trimEnd());
    }
    if (badge) parts.unshift(badge.trim());
    return parts.join(" | ");
  }

  // Non-bar mode: full detail with dollar amounts and countdowns
  const parts: string[] = [
    `${emoji} ${plan.tier}${badge}`,
    formatWindow("5h", quota_5_hour, serverNowMs),
  ];
  if (show7d) {
    parts.push(formatWindow("7d", quota_7_day, serverNowMs));
  }
  return parts.join(" | ");
}

function resetStr(q: QuotaWindow, nowMs: number): string {
  if (q.resets_at === null) return "(inactive)";
  const left = timeUntil(parseUTC(q.resets_at), nowMs);
  return left !== null ? `↻${left}` : "↻?";
}

function formatWindow(label: string, q: QuotaWindow, nowMs: number): string {
  const usagePct = pct(q.usage_percentage);
  const dollars = `$${q.used_value_usd.toFixed(2)}/$${q.max_value_usd.toFixed(2)}`;

  if (q.resets_at === null) {
    return `${label} ${usagePct} ${dollars} (inactive)`;
  }

  const left = timeUntil(parseUTC(q.resets_at), nowMs);
  const reset = left !== null ? `↻${left}` : `↻?`;
  return `${label} ${usagePct} ${dollars} ${reset}`;
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function parseUTC(iso: string): number {
  const hasOffset = iso.endsWith("Z") || /[+-]\d\d:\d\d$/.test(iso);
  return new Date(hasOffset ? iso : iso + "Z").getTime();
}

function timeUntil(epochMs: number, nowMs: number): string | null {
  const ms = epochMs - nowMs;
  if (ms <= 0) return null;
  return formatDuration(ms);
}

function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
