// Shared, no-AI data queries backing both the scheduled digest-ping and the
// on-demand "give me reporting" WhatsApp command. Every function returns
// plain rows/counts — formatting into WhatsApp text happens in the caller.

import { TENANT_ID } from "./config.js";
import { getActiveStaff } from "./taskCommand.js";
import { getUpcomingEvents, formatEventsLine } from "./birthdays.js";

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

// Matches the app's own "Walk-ins" screen (WalkinDashboardScreen, App.jsx):
// a client counts as seen if they have a bullion_visits row OR a
// bullion_estimates row in the window, deduped by lead_id — NOT a raw row
// count, which double-counts repeat visits and misses estimate-only walk-ins.
async function countWalkinClients(sb, sinceISO, untilISO) {
  let vq = sb.from("bullion_visits").select("lead_id").eq("tenant_id", TENANT_ID).gte("visited_at", sinceISO);
  if (untilISO) vq = vq.lt("visited_at", untilISO);
  let eq = sb.from("bullion_estimates").select("lead_id").eq("tenant_id", TENANT_ID).not("lead_id", "is", null).gte("created_at", sinceISO);
  if (untilISO) eq = eq.lt("created_at", untilISO);
  const [{ data: visits }, { data: ests }] = await Promise.all([vq, eq]);
  const ids = new Set();
  for (const v of visits || []) if (v.lead_id) ids.add(v.lead_id);
  for (const e of ests || []) if (e.lead_id) ids.add(e.lead_id);
  return ids.size;
}

export async function getWalkinStats(sb) {
  const todayStart = istMidnightOffset(0), yestStart = istMidnightOffset(1);
  const [today, yesterday, { data: recent }] = await Promise.all([
    countWalkinClients(sb, todayStart, null),
    countWalkinClients(sb, yestStart, todayStart),
    sb.from("bullion_demands").select("outcome").eq("tenant_id", TENANT_ID).eq("crm_source", "walkin").gte("created_at", yestStart),
  ]);
  const converted = (recent || []).filter((r) => r.outcome === "converted").length;
  const notConverted = (recent || []).filter((r) => r.outcome === "lost" || r.outcome === "junk").length;
  return { today, yesterday, converted, notConverted };
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
  // "running"/"delayed" mirror fms-tracker's own getStatus() (App.jsx): a
  // job is running unless cancelled or every step is complete; delayed is
  // running + current step's planDate has passed. That logic only exists
  // client-side, so this calls matching server-side RPCs rather than
  // re-deriving it with a plain count query, which previously only counted
  // jobs *created today* — massively undercounting "how many orders are running".
  const [{ count: todayJobs }, { count: editApprovals }, { data: runningCount }, { data: delayedCount }] = await Promise.all([
    sb.from("jobs").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).gte("created_at", todayStart),
    sb.from("job_edit_approvals").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).eq("status", "pending"),
    sb.rpc("fms_running_job_count", { p_tenant_id: TENANT_ID }),
    sb.rpc("fms_delayed_job_count", { p_tenant_id: TENANT_ID }),
  ]);
  return { todayJobs: todayJobs || 0, editApprovals: editApprovals || 0, running: runningCount || 0, delayed: delayedCount || 0 };
}

// Find a specific order by serial number or client name — mirrors the
// dashboard search box (App.jsx: ilike on serial/client_name/item_name/contact_no).
export async function findFmsJobs(sb, query) {
  const q = `%${String(query || "").trim()}%`;
  const { data } = await sb
    .from("jobs")
    .select("serial,client_name,item_name,current_step,steps,cancelled,delivery_date")
    .eq("tenant_id", TENANT_ID)
    .or(`serial.ilike.${q},client_name.ilike.${q},item_name.ilike.${q},contact_no.ilike.${q}`)
    .limit(5);
  return (data || []).map((j) => {
    const steps = Array.isArray(j.steps) ? j.steps : [];
    let status;
    if (j.cancelled) status = "Cancelled";
    else if (j.current_step >= steps.length) status = "Done";
    else {
      const cur = steps[j.current_step];
      if (!cur) status = "Pending";
      else status = cur.planDate && new Date() > new Date(cur.planDate) ? "Delayed" : "In Progress";
    }
    const curStepName = !j.cancelled && j.current_step < steps.length ? steps[j.current_step]?.stepName : null;
    return { serial: j.serial, clientName: j.client_name, itemName: j.item_name, status, curStepName, deliveryDate: j.delivery_date };
  });
}

// Mirrors the dashboard's Due filter exactly (App.jsx filterDue: today /
// rolling-7-day / overdue-but-still-running) via a matching server-side RPC
// (needs the same jsonb steps traversal as running/delayed counts).
export async function getFmsDeliveryStats(sb) {
  const { data } = await sb.rpc("fms_delivery_stats", { p_tenant_id: TENANT_ID }).maybeSingle();
  return data || { due_today: 0, due_week: 0, overdue: 0 };
}

// Gold melting workflow snapshot — mirrors GoldMelting.jsx's own Dashboard
// tab math (goldMeltingMath.js): pool = unbatched intake, pending = batches
// not yet melted, awaiting_close = melted/exchanged but not posted, aging =
// pool items or pending batches sitting 30+ days.
export async function getGoldMeltingStats(sb) {
  const aging30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const [{ count: pool }, { count: pendingBatches }, { count: awaitingClose }, { count: pendingApprovals }, { count: agingPool }, { count: agingBatches }] = await Promise.all([
    sb.from("melting_items").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).is("batch_id", null),
    sb.from("melting_batches").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).eq("status", "pending"),
    sb.from("melting_batches").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).in("status", ["melted", "exchanged"]),
    sb.from("melting_edit_approvals").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).eq("status", "pending"),
    sb.from("melting_items").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).is("batch_id", null).lt("created_at", aging30),
    sb.from("melting_batches").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).eq("status", "pending").lt("created_at", aging30),
  ]);
  return {
    pool: pool || 0, pendingBatches: pendingBatches || 0, awaitingClose: awaitingClose || 0,
    pendingApprovals: pendingApprovals || 0, aging: (agingPool || 0) + (agingBatches || 0),
  };
}

// Today's net revenue — mirrors SalesDashboard's kpis reducer (App.jsx):
// jobs (excluding cancelled + GemTre NDR returns, net-of-discount amount)
// UNIONED with fms_submissions (external sales forms) — querying jobs alone
// undercounts vs what the Sales screen shows if submissions exist that day.
export async function getFmsRevenueToday(sb) {
  const todayStart = istMidnightOffset(0);
  const [{ data: jobs }, { data: submissions }] = await Promise.all([
    sb.from("jobs").select("total_amount,estimate_amount,advance,after_discount_value,cancelled,type").eq("tenant_id", TENANT_ID).gte("created_at", todayStart),
    sb.from("fms_submissions").select("revenue_total,fulfillment_status").eq("tenant_id", TENANT_ID).gte("submitted_at", todayStart),
  ]);
  const jobsRevenue = (jobs || []).reduce((sum, j) => {
    if (j.cancelled || j.type === "GemTre NDR") return sum;
    const netAmt = parseFloat(j.after_discount_value || j.total_amount || j.estimate_amount || j.advance || 0);
    return sum + netAmt;
  }, 0);
  const submissionsRevenue = (submissions || []).reduce((sum, s) => {
    if (s.fulfillment_status === "cancelled") return sum;
    return sum + parseFloat(s.revenue_total || 0);
  }, 0);
  return { jobsRevenue, submissionsRevenue, total: jobsRevenue + submissionsRevenue, jobsCount: (jobs || []).length, submissionsCount: (submissions || []).length };
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

// Warnings per staff (all-time, all severities) — mirrors the People screen's
// roster badge (App.jsx: warnings.filter(w=>w.staff_name===s.name).length).
// NOTE: the app has no "recent"/"active" concept for warnings at all — this
// is genuinely all-time, matching the app, not a limitation of this query.
export async function getWarningsSummary(sb) {
  const { data } = await sb
    .from("warnings")
    .select("staff_name,warning_type,created_at")
    .eq("tenant_id", TENANT_ID)
    .order("created_at", { ascending: false });
  const byStaff = {};
  for (const w of data || []) {
    const k = w.staff_name || "Unknown";
    if (!byStaff[k]) byStaff[k] = { count: 0, latest: w.created_at, types: {} };
    byStaff[k].count++;
    byStaff[k].types[w.warning_type] = (byStaff[k].types[w.warning_type] || 0) + 1;
  }
  return Object.entries(byStaff)
    .map(([staffName, v]) => ({ staffName, ...v }))
    .sort((a, b) => b.count - a.count);
}

// Company assets not yet returned — mirrors People screen's exact filter
// (App.jsx: assets.filter(a=>a.staff_name===s.name&&!a.returned)). `returned`
// is never explicitly set false on insert, only set true on return — treat
// NULL the same as false, matching the app's JS truthiness check.
export async function getPendingAssets(sb) {
  const { data } = await sb
    .from("company_assets")
    .select("staff_name,asset_name,issued_date")
    .eq("tenant_id", TENANT_ID)
    .or("returned.eq.false,returned.is.null")
    .order("issued_date", { ascending: true });
  return data || [];
}

// Staff docs uploaded (App.jsx DOC_FIELDS, 8 columns) — every column here
// must be a real base64/image column on employee_docs, not the stale
// aadhar_url/pan_url names from older docs.
const DOC_FIELDS = ["aadhaar_front", "aadhaar_back", "pan_card", "photo", "cross_cheque", "last_salary_slip", "driving_license", "police_verification_form"];
const DOC_CHECKS = ["police_verification_done", "home_visit_done", "nda_signed", "rules_acknowledged"];

// Staff with incomplete onboarding — mirrors the exact hasDocGap logic used
// for both the own-profile banner and the People-screen roster badge
// (App.jsx: missing any of the 8 DOC_FIELDS or any of the 4 DOC_CHECKS).
export async function getIncompleteProfiles(sb, activeStaffNames) {
  const { data: docs } = await sb.from("employee_docs").select("*").eq("tenant_id", TENANT_ID);
  const byName = {};
  for (const d of docs || []) byName[(d.staff_name || "").trim().toLowerCase()] = d;
  const out = [];
  for (const name of activeStaffNames) {
    const d = byName[name.trim().toLowerCase()];
    const missingDocs = DOC_FIELDS.filter((f) => !d?.[f]);
    const missingChecks = DOC_CHECKS.filter((f) => !d?.[f]);
    if (missingDocs.length || missingChecks.length) {
      out.push({ name, missingDocsCount: missingDocs.length, missingChecksCount: missingChecks.length });
    }
  }
  return out;
}

// Training completion — per-staff if staffName given, else company-wide
// top-5 leaderboard by xp (mirrors the admin Staff Progress tab's grouping,
// App.jsx, but joins staff.name where the app itself only shows a raw id).
export async function getTrainingStatus(sb, staffName, totalModules) {
  if (staffName) {
    const staff = await sb.from("staff").select("id").eq("tenant_id", TENANT_ID).ilike("name", staffName).maybeSingle();
    if (!staff.data) return null;
    const { data } = await sb.from("training_progress").select("completed").eq("staff_id", staff.data.id);
    const completed = (data || []).filter((r) => r.completed).length;
    const inProgress = (data || []).filter((r) => !r.completed).length;
    return { staffName, completed, inProgress, notStarted: Math.max(0, totalModules - (data || []).length) };
  }
  const { data } = await sb.from("training_progress").select("staff_id,xp,completed");
  const map = {};
  for (const r of data || []) {
    if (!map[r.staff_id]) map[r.staff_id] = { xp: 0, modules: 0 };
    map[r.staff_id].xp += r.xp || 0;
    if (r.completed) map[r.staff_id].modules++;
  }
  const ids = Object.keys(map);
  if (!ids.length) return { leaderboard: [] };
  const { data: staffRows } = await sb.from("staff").select("id,name").in("id", ids);
  const nameById = Object.fromEntries((staffRows || []).map((s) => [s.id, s.name]));
  const leaderboard = ids
    .map((id) => ({ name: nameById[id] || `Staff #${id}`, xp: map[id].xp, modules: map[id].modules }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 5);
  return { leaderboard };
}

// Per-funnel lead breakdown — reads the bullion_funnel_metrics SQL view
// directly (already does the GROUP BY tenant/funnel/status server-side) so
// this doesn't need to re-derive the grouping client-side.
export async function getFunnelBreakdown(sb) {
  const { data } = await sb.from("bullion_funnel_metrics").select("*").eq("tenant_id", TENANT_ID).order("total_leads", { ascending: false });
  return data || [];
}

// Drip campaign backlog — mirrors the Approvals screen's pending queue plus
// today's sent/failed counts. `canceled` is expected/benign (lead replied or
// converted) and is deliberately NOT counted as a problem here.
export async function getDripStatus(sb) {
  const todayStart = istMidnightOffset(0);
  const [{ count: pending }, { count: sentToday }, { count: failed }] = await Promise.all([
    sb.from("bullion_scheduled_messages").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).eq("status", "pending"),
    sb.from("bullion_scheduled_messages").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).eq("status", "sent").gte("sent_at", todayStart),
    sb.from("bullion_scheduled_messages").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).eq("status", "failed"),
  ]);
  return { pending: pending || 0, sentToday: sentToday || 0, failed: failed || 0 };
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
      return `⚙️ FMS: ${s.running} order${s.running === 1 ? "" : "s"} running (${s.delayed} delayed), ${s.todayJobs} new today, ${s.editApprovals} edit approval${s.editApprovals === 1 ? "" : "s"} pending.`;
    }
    case "job_lookup": {
      if (!opts.query) return "Which order? Give me a serial number or client name.";
      const rows = await findFmsJobs(sb, opts.query);
      return `🔎 Orders matching "${opts.query}" (${rows.length}):\n` + fmtList(
        rows.map((r) => `- #${r.serial} ${r.clientName || ""} — ${r.itemName || ""} — ${r.status}${r.curStepName ? ` (${r.curStepName})` : ""}${r.deliveryDate ? `, due ${r.deliveryDate.slice(0, 10)}` : ""}`),
        "No matching order found."
      );
    }
    case "deliveries_due": {
      const s = await getFmsDeliveryStats(sb);
      return `📦 Deliveries: ${s.due_today} due today, ${s.due_week} due within 7 days, ${s.overdue} overdue (still running).`;
    }
    case "gold_melting": {
      const s = await getGoldMeltingStats(sb);
      return `🔥 Gold melting: ${s.pool} item${s.pool === 1 ? "" : "s"} in pool (unbatched), ${s.pendingBatches} batch${s.pendingBatches === 1 ? "" : "es"} pending melt, ${s.awaitingClose} awaiting close, ${s.pendingApprovals} edit approval${s.pendingApprovals === 1 ? "" : "s"} pending${s.aging ? `, ⚠️ ${s.aging} sitting 30+ days` : ""}.`;
    }
    case "fms_revenue": {
      const s = await getFmsRevenueToday(sb);
      return `💰 Today's revenue: ₹${Math.round(s.total).toLocaleString("en-IN")} (${s.jobsCount} orders + ${s.submissionsCount} sales forms). Note: excludes cancelled orders/returns.`;
    }
    case "warnings": {
      const rows = await getWarningsSummary(sb);
      return `⚠️ Staff with warnings on file (${rows.length}), all-time:\n` + fmtList(
        rows.slice(0, 15).map((r) => `- ${r.staffName}: ${r.count} (${Object.entries(r.types).map(([t, c]) => `${c} ${t}`).join(", ")})`),
        "No warnings on file. 🎉"
      );
    }
    case "pending_assets": {
      const rows = await getPendingAssets(sb);
      return `📋 Company assets not yet returned (${rows.length}):\n` + fmtList(
        rows.map((r) => `- ${r.asset_name} → ${r.staff_name} (issued ${r.issued_date})`),
        "All assets returned. 🎉"
      );
    }
    case "incomplete_profiles": {
      const activeStaff = await getActiveStaff(sb);
      const rows = await getIncompleteProfiles(sb, activeStaff.map((s) => s.name));
      return `📁 Staff with incomplete onboarding docs (${rows.length}):\n` + fmtList(
        rows.map((r) => `- ${r.name}: ${r.missingDocsCount} doc(s), ${r.missingChecksCount} check(s) missing`),
        "Everyone's docs are complete. 🎉"
      );
    }
    case "training_status": {
      const { count: totalModules } = await sb.from("training_modules").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID);
      const s = await getTrainingStatus(sb, opts.staffName, totalModules || 28);
      if (opts.staffName) {
        if (!s) return `Couldn't find ${opts.staffName} in staff.`;
        return `🎓 ${s.staffName}: ${s.completed} completed, ${s.inProgress} in progress, ${s.notStarted} not started.`;
      }
      if (!s.leaderboard.length) return "No training activity logged yet.";
      return `🎓 Training leaderboard (top 5 by XP):\n` + s.leaderboard.map((r, i) => `${i + 1}. ${r.name} — ${r.xp} XP, ${r.modules} modules done`).join("\n");
    }
    case "funnel_breakdown": {
      const rows = await getFunnelBreakdown(sb);
      return `🔀 Funnel breakdown:\n` + fmtList(
        rows.map((r) => `- ${r.funnel_name || "Unassigned"}: ${r.total_leads} leads — ${r.active} active, ${r.handoff} handoff, ${r.converted} converted (${r.conversion_pct || 0}%), ${r.dead} dead`),
        "No leads in any funnel yet."
      );
    }
    case "drip_status": {
      const s = await getDripStatus(sb);
      return `📨 Drip campaigns: ${s.pending} pending, ${s.sentToday} sent today${s.failed ? `, ⚠️ ${s.failed} failed` : ""}.`;
    }
    case "upcoming_events": {
      const events = await getUpcomingEvents(sb, opts.query && /\d+/.test(opts.query) ? parseInt(opts.query, 10) : 7);
      if (!events.length) return "No birthdays or anniversaries coming up in this window.";
      const text = formatEventsLine(events);
      return `🎉 Upcoming events:\n${text}`;
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
