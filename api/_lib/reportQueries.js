// Shared, no-AI data queries backing both the scheduled digest-ping and the
// on-demand "give me reporting" WhatsApp command. Every function returns
// plain rows/counts — formatting into WhatsApp text happens in the caller.

import { TENANT_ID } from "./config.js";

const nameEq = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}
function istMidnightOffset(daysAgo) {
  const now = new Date(Date.now() + 5.5 * 3600000);
  now.setUTCHours(0, 0, 0, 0);
  now.setUTCDate(now.getUTCDate() - daysAgo);
  return new Date(now.getTime() - 5.5 * 3600000).toISOString();
}

export async function getOverdueDelegations(sb) {
  const { data } = await sb
    .from("tasks")
    .select("title,assigned_to,due_date")
    .eq("tenant_id", TENANT_ID)
    .eq("task_type", "one-time") // KRAs (recurring) are not delegations, even if admin-assigned
    .ilike("assigned_by", "Saurav")
    .not("assigned_to", "ilike", "Saurav")
    .in("status", ["Pending", "In Progress", "Pending Approval"])
    .lt("due_date", todayIST())
    .order("due_date", { ascending: true });
  return data || [];
}

export async function getMyTasks(sb) {
  return getStaffTasks(sb, "Saurav");
}

// Any named staff member's pending tasks — "Naveen's pending tasks" etc.
// staffName should already be resolved to the exact roster spelling.
export async function getStaffTasks(sb, staffName) {
  const { data } = await sb
    .from("tasks")
    .select("title,assigned_by,task_type,due_date,status")
    .eq("tenant_id", TENANT_ID)
    .ilike("assigned_to", staffName)
    .in("status", ["Pending", "In Progress"])
    .order("due_date", { ascending: true });
  return data || [];
}

export async function getOpenHelpSlips(sb) {
  const { data } = await sb
    .from("help_slips")
    .select("description,category,urgency,raised_by,created_at")
    .eq("tenant_id", TENANT_ID)
    .ilike("assigned_to", "Saurav")
    .neq("status", "Resolved")
    .order("created_at", { ascending: false });
  return data || [];
}

export async function getPendingLeaves(sb) {
  const { data } = await sb
    .from("leaves")
    .select("staff_name,leave_type,from_date,to_date,half_day,days")
    .eq("tenant_id", TENANT_ID)
    .eq("status", "Pending")
    .gte("from_date", todayIST()) // only upcoming — not stale past-dated pending requests
    .order("from_date", { ascending: true });
  return data || [];
}

export async function getPendingPettyCash(sb) {
  const { data, count } = await sb
    .from("petty_cash_txns")
    .select("amount,note,created_at", { count: "exact" })
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  return { rows: data || [], count: count || 0 };
}

export async function getWalkinStats(sb) {
  const todayStart = istMidnightOffset(0), yestStart = istMidnightOffset(1);
  // Counts come from bullion_visits (every walk-in form entry) — bullion_demands
  // only gets a row when staff also ticked "create demand" with a description,
  // which under-counted actual walk-in traffic.
  const [{ count: today }, { count: yesterday }, { data: recent }] = await Promise.all([
    sb.from("bullion_visits").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).gte("visited_at", todayStart),
    sb.from("bullion_visits").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).gte("visited_at", yestStart).lt("visited_at", todayStart),
    sb.from("bullion_demands").select("outcome").eq("tenant_id", TENANT_ID).eq("crm_source", "walkin").gte("created_at", yestStart),
  ]);
  const converted = (recent || []).filter((r) => r.outcome === "converted").length;
  const notConverted = (recent || []).filter((r) => r.outcome === "lost" || r.outcome === "junk").length;
  return { today: today || 0, yesterday: yesterday || 0, converted, notConverted };
}

export async function getPendingDemands(sb) {
  const { data } = await sb
    .from("bullion_demands")
    .select("description,product_category,budget,created_at,lead:bullion_leads(name,phone)")
    .eq("tenant_id", TENANT_ID)
    .is("outcome", null)
    .order("created_at", { ascending: true })
    .limit(50);
  return data || [];
}

// Active staff not present today and not on approved leave today — since
// attendance rows only exist for people who actually punched in (no explicit
// "Absent" status), absence is derived by exclusion.
export async function getAbsentToday(sb) {
  const today = todayIST();
  const [{ data: staff }, { data: attendanceToday }, { data: leavesToday }] = await Promise.all([
    sb.from("staff").select("name").eq("tenant_id", TENANT_ID).eq("active", true),
    sb.from("attendance").select("staff_name").eq("tenant_id", TENANT_ID).eq("date", today),
    sb.from("leaves").select("staff_name").eq("tenant_id", TENANT_ID).eq("status", "Approved").lte("from_date", today).gte("to_date", today),
  ]);
  const present = new Set((attendanceToday || []).map((r) => r.staff_name?.toLowerCase()));
  const onLeave = new Set((leavesToday || []).map((r) => r.staff_name?.toLowerCase()));
  return (staff || [])
    .filter((s) => !present.has(s.name?.toLowerCase()) && !onLeave.has(s.name?.toLowerCase()))
    .map((s) => s.name);
}

export async function getLowStock(sb) {
  const { data } = await sb
    .from("low_stock_view")
    .select("name,current_stock,min_level")
    .eq("tenant_id", TENANT_ID)
    .order("current_stock", { ascending: true })
    .limit(30);
  return data || [];
}

export async function getFmsJobStats(sb) {
  const todayStart = istMidnightOffset(0);
  const [{ count: todayJobs }, { count: editApprovals }] = await Promise.all([
    sb.from("jobs").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).gte("created_at", todayStart),
    sb.from("job_edit_approvals").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).eq("status", "pending"),
  ]);
  return { todayJobs: todayJobs || 0, editApprovals: editApprovals || 0 };
}

// A named staff member's open (not-yet-closed) CRM demands.
export async function getStaffDemands(sb, staffName) {
  const { data } = await sb
    .from("bullion_demands")
    .select("description,product_category,budget,created_at,lead:bullion_leads(name,phone)")
    .eq("tenant_id", TENANT_ID)
    .ilike("assigned_to", staffName)
    .is("outcome", null)
    .order("created_at", { ascending: true })
    .limit(30);
  return data || [];
}

// Free-text customer lookup by name or phone.
export async function findLeads(sb, query) {
  const cleaned = String(query || "").replace(/[,()]/g, " ").trim();
  const q = `%${cleaned}%`;
  const { data } = await sb
    .from("bullion_leads")
    .select("name,phone,city,status,last_msg,last_msg_at")
    .eq("tenant_id", TENANT_ID)
    .or(`name.ilike.${q},phone.ilike.${q}`)
    .limit(15);
  return data || [];
}

// Same lookup as findLeads but returns the fields needed to send an
// edit-contact form link (id, form_token) instead of a display summary.
export async function findLeadsForForm(sb, query) {
  const cleaned = String(query || "").replace(/[,()]/g, " ").trim();
  const q = `%${cleaned}%`;
  const { data } = await sb
    .from("bullion_leads")
    .select("id,name,phone,form_token")
    .eq("tenant_id", TENANT_ID)
    .or(`name.ilike.${q},phone.ilike.${q}`)
    .is("deleted_at", null)
    .limit(10);
  return data || [];
}

// A named staff member's phone/role — "what's Priya's number".
export async function getStaffContact(sb, staffName) {
  const { data } = await sb
    .from("staff")
    .select("name,phone,role,staff_role")
    .eq("tenant_id", TENANT_ID)
    .ilike("name", staffName)
    .maybeSingle();
  return data || null;
}

// Business docs expiring within 30 days — same window as the app's own banner.
export async function getExpiringDocs(sb) {
  const { data } = await sb
    .from("business_docs")
    .select("title,expiry_date")
    .eq("tenant_id", TENANT_ID)
    .not("expiry_date", "is", null)
    .lte("expiry_date", istMidnightOffset(-30).slice(0, 10))
    .order("expiry_date", { ascending: true });
  return data || [];
}

// Tasks completed today (any assignee) — "what's gotten done today".
export async function getRecentCompletions(sb) {
  const { data } = await sb
    .from("tasks")
    .select("title,assigned_to,completed_at")
    .eq("tenant_id", TENANT_ID)
    .gte("completed_at", istMidnightOffset(0))
    .order("completed_at", { ascending: false })
    .limit(30);
  return data || [];
}

// A named staff member's approved leave days this quarter — mirrors the
// quarterDays calc in ssj-hr's App.jsx (LeavesScreen).
export async function getLeaveBalance(sb, staffName) {
  const now = new Date(Date.now() + 5.5 * 3600000);
  const qStart = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1)).toISOString().slice(0, 10);
  const { data } = await sb
    .from("leaves")
    .select("leave_type,days,half_day,from_date")
    .eq("tenant_id", TENANT_ID)
    .ilike("staff_name", staffName)
    .eq("status", "Approved")
    .eq("unsanctioned", false)
    .gte("from_date", qStart);
  const totalDays = (data || []).reduce((sum, l) => sum + (l.half_day ? 0.5 : l.days), 0);
  return { rows: data || [], totalDays, quarterStart: qStart };
}

// ── WhatsApp text formatting for the on-demand "get report" command ────────
function fmtList(items, empty) {
  return items.length ? items.join("\n") : empty;
}

export async function buildReportText(sb, topic, opts = {}) {
  switch (topic) {
    case "delegations": {
      const rows = await getOverdueDelegations(sb);
      return `📊 Overdue delegations (${rows.length}):\n` + fmtList(
        rows.slice(0, 20).map((r) => `- ${r.title} → ${r.assigned_to} (due ${r.due_date})`),
        "None overdue. 🎉"
      );
    }
    case "my_tasks": {
      const rows = await getMyTasks(sb);
      return `✅ Your own pending tasks (${rows.length}):\n` + fmtList(
        rows.map((r) => `- ${r.title} (due ${r.due_date})`),
        "Nothing pending. 🎉"
      );
    }
    case "staff_tasks": {
      if (!opts.staffName) return "Couldn't match that name against the staff list. Check the spelling?";
      const rows = await getStaffTasks(sb, opts.staffName);
      // KRAs (recurring) never show who assigned them — only one-time delegations do.
      return `📋 ${opts.staffName}'s pending tasks (${rows.length}):\n` + fmtList(
        rows.map((r) => `- ${r.title} (due ${r.due_date}${r.task_type === "recurring" ? "" : `, from ${r.assigned_by}`})`),
        "Nothing pending. 🎉"
      );
    }
    case "help_slips": {
      const rows = await getOpenHelpSlips(sb);
      return `🎫 Open help slips assigned to you (${rows.length}):\n` + fmtList(
        rows.map((r) => `- [${r.urgency}] ${r.description} (from ${r.raised_by})`),
        "None open. 🎉"
      );
    }
    case "leaves": {
      const rows = await getPendingLeaves(sb);
      return `📅 Leaves pending approval (${rows.length}):\n` + fmtList(
        rows.map((r) => `- ${r.staff_name}: ${r.leave_type}${r.half_day ? " (half day)" : ""} ${r.from_date}${!r.half_day && r.to_date !== r.from_date ? " → " + r.to_date : ""} (${r.days}d)`),
        "None pending."
      );
    }
    case "petty_cash": {
      const { rows, count } = await getPendingPettyCash(sb);
      return `💵 Petty cash pending (${count}):\n` + fmtList(
        rows.slice(0, 20).map((r) => `- ₹${r.amount} — ${r.note || "no note"}`),
        "None pending."
      );
    }
    case "walkins": {
      const s = await getWalkinStats(sb);
      return `🏪 Walk-ins: ${s.today} today, ${s.yesterday} yesterday.\nLast 2 days: ${s.converted} converted, ${s.notConverted} not converted.`;
    }
    case "demands": {
      const rows = await getPendingDemands(sb);
      return `📇 Open demands (${rows.length}):\n` + fmtList(
        rows.slice(0, 15).map((r) => `- ${r.lead?.name || r.lead?.phone || "Unknown"}: ${r.description || r.product_category || "demand"}${r.budget ? " (₹" + Math.round(r.budget).toLocaleString("en-IN") + ")" : ""}`),
        "None open. 🎉"
      );
    }
    case "staff_demands": {
      if (!opts.staffName) return "Couldn't match that name against the staff list. Check the spelling?";
      const rows = await getStaffDemands(sb, opts.staffName);
      return `📇 ${opts.staffName}'s open demands (${rows.length}):\n` + fmtList(
        rows.map((r) => `- ${r.lead?.name || r.lead?.phone || "Unknown"}: ${r.description || r.product_category || "demand"}${r.budget ? " (₹" + Math.round(r.budget).toLocaleString("en-IN") + ")" : ""}`),
        "None open. 🎉"
      );
    }
    case "attendance_today": {
      const absent = await getAbsentToday(sb);
      return `🧑‍🤝‍🧑 Absent today (${absent.length}):\n` + fmtList(
        absent.map((n) => `- ${n}`),
        "Everyone's present or on approved leave. 🎉"
      );
    }
    case "low_stock": {
      const rows = await getLowStock(sb);
      return `📦 Low stock (${rows.length}):\n` + fmtList(
        rows.map((r) => `- ${r.name}: ${r.current_stock}/${r.min_level}`),
        "Nothing below minimum. 🎉"
      );
    }
    case "fms_jobs": {
      const s = await getFmsJobStats(sb);
      return `⚙️ FMS: ${s.todayJobs} jobs today, ${s.editApprovals} edit approval${s.editApprovals === 1 ? "" : "s"} pending.`;
    }
    case "staff_contact": {
      if (!opts.staffName) return "Couldn't match that name against the staff list. Check the spelling?";
      const s = await getStaffContact(sb, opts.staffName);
      if (!s) return `Couldn't find ${opts.staffName} in staff.`;
      return `📞 ${s.name}: ${s.phone || "no phone on file"}${s.staff_role ? ` (${s.staff_role})` : ""}`;
    }
    case "expiring_docs": {
      const rows = await getExpiringDocs(sb);
      return `📄 Business docs expiring within 30 days (${rows.length}):\n` + fmtList(
        rows.map((r) => `- ${r.title} — ${r.expiry_date}`),
        "None expiring soon. 🎉"
      );
    }
    case "recent_completions": {
      const rows = await getRecentCompletions(sb);
      return `✅ Completed today (${rows.length}):\n` + fmtList(
        rows.map((r) => `- ${r.title} by ${r.assigned_to}`),
        "Nothing marked done yet today."
      );
    }
    case "leave_balance": {
      if (!opts.staffName) return "Couldn't match that name against the staff list. Check the spelling?";
      const { totalDays, quarterStart } = await getLeaveBalance(sb, opts.staffName);
      return `📅 ${opts.staffName} has taken ${totalDays} day${totalDays === 1 ? "" : "s"} of approved leave since ${quarterStart} (this quarter).`;
    }
    case "lead_lookup": {
      if (!opts.query) return "What name or phone number should I look up?";
      const rows = await findLeads(sb, opts.query);
      return `🔍 Matches for "${opts.query}" (${rows.length}):\n` + fmtList(
        rows.map((r) => `- ${r.name || "Unknown"} · ${r.phone || "no phone"} · ${r.city || ""} · status: ${r.status}${r.last_msg ? `\n  last: "${r.last_msg.slice(0, 60)}"` : ""}`),
        "No matching customer found."
      );
    }
    case "full":
    default: {
      const [deleg, mine, slips, leaves, petty, walkins, absent] = await Promise.all([
        getOverdueDelegations(sb), getMyTasks(sb), getOpenHelpSlips(sb),
        getPendingLeaves(sb), getPendingPettyCash(sb), getWalkinStats(sb), getAbsentToday(sb),
      ]);
      return [
        `📊 Quick report:`,
        `- Overdue delegations: ${deleg.length}`,
        `- Your pending tasks: ${mine.length}`,
        `- Open help slips: ${slips.length}`,
        `- Leaves pending: ${leaves.length}`,
        `- Petty cash pending: ${petty.count}`,
        `- Absent today: ${absent.length}${absent.length ? " (" + absent.slice(0, 5).join(", ") + (absent.length > 5 ? "…" : "") + ")" : ""}`,
        `- Walk-ins: ${walkins.today} today, ${walkins.yesterday} yesterday`,
        // Cache-busting date param — WhatsApp caches link previews per exact
        // URL, so a static link kept showing the stale first-ever preview
        // (the page's "Loading…" skeleton, scraped before og tags existed).
        `Full detail: https://hr.gemtre.in/reporting?d=${todayIST()}`,
      ].join("\n");
    }
  }
}
