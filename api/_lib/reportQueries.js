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
    .ilike("assigned_by", "Saurav")
    .not("assigned_to", "ilike", "Saurav")
    .in("status", ["Pending", "In Progress", "Pending Approval"])
    .lt("due_date", todayIST())
    .order("due_date", { ascending: true });
  return data || [];
}

export async function getMyTasks(sb) {
  const { data } = await sb
    .from("tasks")
    .select("title,assigned_by,due_date,status")
    .eq("tenant_id", TENANT_ID)
    .ilike("assigned_to", "Saurav")
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
  const [{ count: today }, { count: yesterday }, { data: recent }] = await Promise.all([
    sb.from("bullion_demands").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).eq("crm_source", "walkin").gte("created_at", todayStart),
    sb.from("bullion_demands").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).eq("crm_source", "walkin").gte("created_at", yestStart).lt("created_at", todayStart),
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

// ── WhatsApp text formatting for the on-demand "get report" command ────────
function fmtList(items, empty) {
  return items.length ? items.join("\n") : empty;
}

export async function buildReportText(sb, topic) {
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
    case "full":
    default: {
      const [deleg, mine, slips, leaves, petty, walkins] = await Promise.all([
        getOverdueDelegations(sb), getMyTasks(sb), getOpenHelpSlips(sb),
        getPendingLeaves(sb), getPendingPettyCash(sb), getWalkinStats(sb),
      ]);
      return [
        `📊 Quick report:`,
        `- Overdue delegations: ${deleg.length}`,
        `- Your pending tasks: ${mine.length}`,
        `- Open help slips: ${slips.length}`,
        `- Leaves pending: ${leaves.length}`,
        `- Petty cash pending: ${petty.count}`,
        `- Walk-ins: ${walkins.today} today, ${walkins.yesterday} yesterday`,
        `Full detail: https://hr.gemtre.in/reporting`,
      ].join("\n");
    }
  }
}
