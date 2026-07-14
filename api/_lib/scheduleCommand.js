// WhatsApp free-text -> schedule_events row (ssj-hr's Calendar tab, same
// shared Supabase project). Owner-only, same as taskCommand.js.

import { TENANT_ID, sanitizeErrorForWA } from "./config.js";

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export async function executeScheduleAdd(sb, { title, date, time }) {
  if (!title) return "What's the event? e.g. \"schedule call with Rohit tomorrow 4pm\".";
  const row = {
    tenant_id: TENANT_ID,
    title,
    event_date: date || todayIST(),
    event_time: time || null,
    created_by: "Saurav",
  };
  const { data, error } = await sb.from("schedule_events").insert(row).select().single();
  if (error) return `Couldn't add that — ${sanitizeErrorForWA(error)}`;
  return `📅 Scheduled: "${title}" on ${fmtDate(data.event_date)}${time ? ` at ${time}` : ""}.`;
}

// query: "today" | "upcoming" (next 7 days) | omit (defaults to upcoming)
export async function executeScheduleList(sb, query) {
  const today = todayIST();
  let q = sb.from("schedule_events").select("id,title,event_date,event_time").eq("tenant_id", TENANT_ID).order("event_date", { ascending: true }).order("event_time", { ascending: true });
  if (query === "today") {
    q = q.eq("event_date", today);
  } else {
    const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    q = q.gte("event_date", today).lte("event_date", in7);
  }
  const { data, error } = await q.limit(30);
  if (error) return `Couldn't load your schedule — ${sanitizeErrorForWA(error)}`;
  if (!data?.length) return query === "today" ? "Nothing scheduled today." : "Nothing scheduled in the next 7 days.";
  const lines = data.map((e) => `- ${e.title} — ${fmtDate(e.event_date)}${e.event_time ? ` ${e.event_time.slice(0, 5)}` : ""}`);
  return `📅 ${query === "today" ? "Today's schedule" : "Next 7 days"}:\n${lines.join("\n")}`;
}

// query: free text matched against title (ILIKE) — deletes the single best
// match; if several match, lists them instead of guessing.
export async function executeScheduleDelete(sb, query) {
  if (!query) return "Which event? Give me part of the title.";
  const { data, error } = await sb
    .from("schedule_events")
    .select("id,title,event_date,event_time")
    .eq("tenant_id", TENANT_ID)
    .ilike("title", `%${query}%`)
    .order("event_date", { ascending: true });
  if (error) return `Couldn't search your schedule — ${sanitizeErrorForWA(error)}`;
  if (!data?.length) return `No scheduled event matching "${query}".`;
  if (data.length > 1) {
    const lines = data.map((e) => `- ${e.title} — ${fmtDate(e.event_date)}${e.event_time ? ` ${e.event_time.slice(0, 5)}` : ""}`);
    return `Found ${data.length} matches for "${query}" — be more specific:\n${lines.join("\n")}`;
  }
  const ev = data[0];
  await sb.from("schedule_events").delete().eq("id", ev.id);
  return `🗑️ Deleted: "${ev.title}" (${fmtDate(ev.event_date)}).`;
}
