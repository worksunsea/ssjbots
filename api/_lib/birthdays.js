// Today's + next-2-days birthdays/anniversaries, from bullion_leads (same
// data cron.js already uses for calendar funnels). No AI — plain date match.

import { TENANT_ID } from "./config.js";

// Mirrors cron.js's parseEventDate heuristic: bday/anniversary are stored as
// "MM-DD", "DD-MM", or "YYYY-MM-DD" — figure out month/day regardless of order.
function parseMonthDay(raw) {
  if (!raw) return null;
  const p = String(raw).split("-");
  let m, d;
  if (p.length === 3) {
    const a = parseInt(p[1], 10), b = parseInt(p[2], 10);
    if (a >= 1 && a <= 12) { m = a; d = b; } else { m = b; d = a; }
  } else if (p.length === 2) {
    const a = parseInt(p[0], 10), b = parseInt(p[1], 10);
    if (a >= 1 && a <= 12) { m = a; d = b; } else { m = b; d = a; }
  }
  if (!m || !d || isNaN(m) || isNaN(d)) return null;
  return { month: m, day: d };
}

function nextDaysMonthDay(n) {
  const nowIST = new Date(Date.now() + 5.5 * 3600000);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const d = new Date(Date.UTC(nowIST.getUTCFullYear(), nowIST.getUTCMonth(), nowIST.getUTCDate() + i));
    out.push({ month: d.getUTCMonth() + 1, day: d.getUTCDate(), offset: i });
  }
  return out;
}

// Returns [{ name, kind: "birthday"|"anniversary", offset: 0|1|2 }], offset 0 = today.
export async function getUpcomingEvents(sb, days = 2) {
  const { data: leads } = await sb
    .from("bullion_leads")
    .select("name,phone,bday,anniversary")
    .eq("tenant_id", TENANT_ID)
    .eq("dnd", false)
    .or("bday.not.is.null,anniversary.not.is.null")
    .limit(1000);

  const targets = nextDaysMonthDay(days);
  const events = [];
  for (const lead of leads || []) {
    for (const [field, kind] of [["bday", "birthday"], ["anniversary", "anniversary"]]) {
      const parsed = parseMonthDay(lead[field]);
      if (!parsed) continue;
      const hit = targets.find((t) => t.month === parsed.month && t.day === parsed.day);
      if (hit) events.push({ name: lead.name || lead.phone || "Unknown", kind, offset: hit.offset });
    }
  }
  return events;
}

export function formatEventsLine(events) {
  const today = events.filter((e) => e.offset === 0);
  const upcoming = events.filter((e) => e.offset > 0);
  const lines = [];
  if (today.length) lines.push(`🎂 Today: ${today.map((e) => `${e.name} (${e.kind})`).join(", ")}`);
  if (upcoming.length) lines.push(`📅 Coming up: ${upcoming.map((e) => `${e.name} (${e.kind}, in ${e.offset}d)`).join(", ")}`);
  return lines.join("\n");
}
