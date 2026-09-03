// Shared holiday/leave guards for the staff checklist & task reminder crons
// (morning-due-today-push, evening-completion-reminder, staff-task-reminders).
// A declared holiday skips the reminder for everyone that day; an approved
// leave (from the `leaves` table staff already file in ssj-hr) skips just
// that person.

export function todayIST() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}

export async function isHolidayToday(sb, tenantId, date = todayIST()) {
  const { data } = await sb
    .from("holidays")
    .select("id,name")
    .eq("tenant_id", tenantId)
    .eq("date", date)
    .maybeSingle();
  return data || null;
}

// Returns a Set of lowercased staff names who have an Approved leave
// covering `date` (defaults to today, IST).
export async function staffOnLeaveToday(sb, tenantId, date = todayIST()) {
  const { data } = await sb
    .from("leaves")
    .select("staff_name")
    .eq("tenant_id", tenantId)
    .eq("status", "Approved")
    .lte("from_date", date)
    .gte("to_date", date);
  return new Set((data || []).map((r) => String(r.staff_name || "").trim().toLowerCase()));
}
