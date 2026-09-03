// Kitty Schemes Admin — staff CRUD for the MYNN Kitty gold-savings schemes
// (api/kitty.js, kitty_schemes/kitty_enrollments/kitty_installments/kitty_draws
// tables). Three sub-views: Schemes (define/edit perks, drives what shows on
// ssj.in), Enrollments (confirm signups, mark installments paid, record the
// monthly lucky draw), Legacy Members (hand-enter old paid-up-unclaimed
// members so kitty-cron.js starts reminding them to claim).

import { useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";

const API = "/api/kitty";

async function call(action, { method = "GET", body, crmSecret, params } = {}) {
  const qs = new URLSearchParams({ action, ...(params || {}) }).toString();
  const res = await fetch(`${API}?${qs}`, {
    method,
    cache: "no-store",
    headers: { "Content-Type": "application/json", "x-crm-secret": crmSecret },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

const emptyScheme = () => ({
  id: null, name: "", slug: "", monthlyAmount: "", durationMonths: 12, funnelId: "",
  perks: { lucky_draw: false, non_winner_benefit_amount: "", gold_coin_chance: false, gold_coin_weight_mg: "",
    free_installment_month: "", rate_lock_day: "", making_charge_discount_pct: "", redemption: "jewellery_only",
    unit: "rupees", weight_tiers_g: "", gullak_option: false },
  description: "", active: true, sortOrder: 0,
});

// Gold-tracked schemes: Gullak (unit:"grams", ad-hoc logged purchases, no
// fixed schedule) AND rate-lock rupee schemes like Golden Sparkle
// (redemption: "jewellery_or_raw_gold"/"sell_anytime_or_jewellery" — fixed
// monthly rupee installments that convert to grams via a per-entry locked
// rate). Both accumulate real gold; only the schedule shape differs. Grams
// aren't stored directly (kitty_installments has no grams column); they're
// always derived as paid amount / locked rate, same math the public
// "My Kitty" member view (api/kitty-client.js) already uses. Mirrors
// isGoldRedemptionScheme() in api/kitty.js — keep in sync if that changes.
const isGramScheme = (e) => {
  if (e.is_legacy) return false;
  const perks = e.scheme?.perks;
  return perks?.unit === "grams" || perks?.redemption === "jewellery_or_raw_gold" || perks?.redemption === "sell_anytime_or_jewellery";
};
// Only show grams for actually-settled rows (paid/free) — a "due" row can
// carry a stray paid_amount from data entry without being paid yet, and
// showing grams on it would look like it's already counted.
const gramsFor = (i) => (i.rate_locked && (i.status === "paid" || i.status === "free") ? Number(i.paid_amount ?? i.amount ?? 0) / Number(i.rate_locked) : null);
function enrollmentGrams(e) {
  const paid = (e.installments || []).filter((i) => i.status === "paid" || i.status === "free");
  return paid.reduce((sum, i) => (i.rate_locked ? sum + Number(i.paid_amount ?? i.amount ?? 0) / Number(i.rate_locked) : sum), 0);
}

export default function KittyAdminScreen({ sb, tenantId, crmSecret, staffName }) {
  const [tab, setTab] = useState("enrollments");
  const actor = staffName || "staff";
  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {[["overview", "Overview"], ["schemes", "Schemes"], ["enroll", "Enroll New Member"], ["enrollments", "Enrollments"], ["legacy", "Add Legacy Member"], ["activity", "Activity Log"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #d4af37",
              background: tab === k ? "#d4af37" : "transparent", color: tab === k ? "#fff" : "#d4af37", cursor: "pointer" }}>
            {l}
          </button>
        ))}
      </div>
      {tab === "overview" && <OverviewTab crmSecret={crmSecret} actor={actor} />}
      {tab === "schemes" && <SchemesTab sb={sb} tenantId={tenantId} crmSecret={crmSecret} actor={actor} />}
      {tab === "enroll" && <EnrollNewMemberTab crmSecret={crmSecret} actor={actor} />}
      {tab === "enrollments" && <EnrollmentsTab crmSecret={crmSecret} actor={actor} onNewEnroll={() => setTab("enroll")} />}
      {tab === "legacy" && <LegacyTab crmSecret={crmSecret} actor={actor} />}
      {tab === "activity" && <ActivityLogTab crmSecret={crmSecret} />}
    </div>
  );
}

// Per-scheme member/payment stats + a pending-payments worklist with
// on-demand WA reminders (the automatic kitty-cron.js reminder only fires
// 3 days before due — this is for staff working the list right now).
function OverviewTab({ crmSecret, actor }) {
  const [enrollments, setEnrollments] = useState(null);
  const [sendingId, setSendingId] = useState(null);

  const load = useCallback(async () => {
    const d = await call("admin-list-enrollments", { crmSecret });
    setEnrollments(d.ok ? d.enrollments : []);
  }, [crmSecret]);

  useEffect(() => { load(); }, [load]);

  if (enrollments === null) return <div>Loading…</div>;

  const today = new Date().toISOString().slice(0, 10);
  const live = enrollments.filter((e) => ["active", "completed", "redeemed"].includes(e.status));

  const GULLAK_STALE_DAYS = 45;
  const bySchemeName = new Map();
  const gullakStats = new Map();
  const pending = [];
  for (const e of live) {
    if (isGramScheme(e)) {
      // Gram-based (Gullak) enrollments never generate a "due" installment
      // schedule — every entry is an ad-hoc logged purchase, always
      // status:"paid". The paid/unpaid/overdue framing below is meaningless
      // for these (unpaid would always show 0) — track separately instead.
      const key = e.scheme?.name || "—";
      if (!gullakStats.has(key)) gullakStats.set(key, { members: 0, totalGrams: 0, stale: [] });
      const s = gullakStats.get(key);
      s.members++;
      s.totalGrams += enrollmentGrams(e);
      const paidDates = (e.installments || []).filter((i) => i.status === "paid" && i.paid_at).map((i) => i.paid_at.slice(0, 10));
      const lastPurchase = paidDates.sort().pop() || null;
      const daysSince = lastPurchase ? Math.floor((Date.now() - new Date(lastPurchase).getTime()) / 86400000) : null;
      if (daysSince === null || daysSince >= GULLAK_STALE_DAYS) {
        s.stale.push({ name: e.lead?.name, phone: e.lead?.phone, lastPurchase, daysSince });
      }
      continue;
    }
    const key = e.is_legacy ? `[Legacy] ${e.legacy_scheme_name}` : (e.scheme?.name || "—");
    if (!bySchemeName.has(key)) bySchemeName.set(key, { members: 0, paid: 0, unpaid: 0, overdue: 0, onTime: 0, late: 0 });
    const stat = bySchemeName.get(key);
    stat.members++;
    for (const i of e.installments || []) {
      if (i.status === "paid") {
        stat.paid++;
        if (i.paid_at && i.paid_at.slice(0, 10) > i.due_date) stat.late++; else stat.onTime++;
      } else if (i.status === "due") {
        // Only count as "unpaid" once its due date has actually arrived —
        // a month 11 installment sitting in the future isn't unpaid yet,
        // it just hasn't come due. Overdue is a subset (due date passed).
        if (i.due_date <= today) {
          stat.unpaid++;
          if (i.due_date < today) {
            stat.overdue++;
            pending.push({ enrollment: e, installment: i });
          }
        }
      }
    }
  }
  pending.sort((a, b) => a.installment.due_date.localeCompare(b.installment.due_date));
  const gullakStale = [...gullakStats.values()].flatMap((s) => s.stale).sort((a, b) => (b.daysSince ?? 99999) - (a.daysSince ?? 99999));

  const sendReminder = async (installmentId) => {
    setSendingId(installmentId);
    const d = await call("send-installment-reminder", { method: "POST", crmSecret, body: { installmentId, actor } });
    setSendingId(null);
    if (d.ok) { alert("Reminder sent."); load(); } else alert(d.error);
  };

  return (
    <div>
      <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Total active enrollments: {live.length}</p>
      <h4>Members & Payments per Kitty</h4>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 28, fontSize: 12.5 }}>
        <thead><tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
          <th>Scheme</th><th>Members</th><th>Paid</th><th>Unpaid (due)</th><th>Overdue</th><th>Paid on-time</th><th>Paid late</th>
        </tr></thead>
        <tbody>
          {[...bySchemeName.entries()].map(([name, s]) => (
            <tr key={name} style={{ borderBottom: "1px solid #eee" }}>
              <td>{name}</td><td>{s.members}</td><td>{s.paid}</td><td>{s.unpaid}</td>
              <td style={{ color: s.overdue ? "#B91C1C" : undefined }}>{s.overdue}</td>
              <td>{s.onTime}</td><td>{s.late}</td>
            </tr>
          ))}
          {!bySchemeName.size && <tr><td colSpan={7}>No active enrollments yet.</td></tr>}
        </tbody>
      </table>

      {gullakStats.size > 0 && (
        <>
          <h4>Gullak (Gram-Based) Holdings</h4>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 28, fontSize: 12.5 }}>
            <thead><tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
              <th>Scheme</th><th>Members</th><th>Total grams held</th>
            </tr></thead>
            <tbody>
              {[...gullakStats.entries()].map(([name, s]) => (
                <tr key={name} style={{ borderBottom: "1px solid #eee" }}>
                  <td>{name}</td><td>{s.members}</td><td>{s.totalGrams.toFixed(3)} g</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4>Gullak — Members Who Haven't Purchased in {GULLAK_STALE_DAYS}+ Days</h4>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 28, fontSize: 12.5 }}>
            <thead><tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
              <th>Name</th><th>Phone</th><th>Last purchase</th><th>Days since</th>
            </tr></thead>
            <tbody>
              {gullakStale.map((m, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid #eee" }}>
                  <td>{m.name || "—"}</td><td>{m.phone || "—"}</td>
                  <td>{m.lastPurchase || "never"}</td>
                  <td style={{ color: "#B91C1C" }}>{m.daysSince ?? "—"}</td>
                </tr>
              ))}
              {!gullakStale.length && <tr><td colSpan={4}>Everyone's current.</td></tr>}
            </tbody>
          </table>
        </>
      )}

      <h4>Pending Payments (overdue — due date already passed)</h4>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead><tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
          <th>Member</th><th>Scheme</th><th>Installment</th><th>Amount</th><th>Due</th><th>Days late</th><th></th>
        </tr></thead>
        <tbody>
          {pending.map(({ enrollment: e, installment: i }) => (
            <tr key={i.id} style={{ borderBottom: "1px solid #eee" }}>
              <td>{e.lead?.name} ({e.lead?.phone})</td>
              <td>{e.is_legacy ? e.legacy_scheme_name : e.scheme?.name}</td>
              <td>#{i.month_number}</td>
              <td>₹{i.amount}</td>
              <td>{i.due_date}</td>
              <td>{Math.floor((Date.now() - new Date(i.due_date).getTime()) / 86400000)}</td>
              <td>
                <button onClick={() => sendReminder(i.id)} disabled={sendingId === i.id}>
                  {sendingId === i.id ? "Sending…" : i.reminded_at ? "Send Again" : "Send Reminder"}
                </button>
              </td>
            </tr>
          ))}
          {!pending.length && <tr><td colSpan={7}>No overdue payments — everyone's current.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function ActivityLogTab({ crmSecret }) {
  const [log, setLog] = useState(null);
  const [entityType, setEntityType] = useState("");

  const load = useCallback(async () => {
    const d = await call("admin-list-audit-log", { crmSecret, params: entityType ? { entityType } : {} });
    setLog(d.ok ? d.log : []);
  }, [crmSecret, entityType]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <p>Every enrollment, payment, redemption, edit, and system action — who did it and when. Online (client-submitted) entries show as "online:&lt;phone&gt;"; automated rollovers show as "system:cron".</p>
      <select value={entityType} onChange={(e) => setEntityType(e.target.value)} style={{ marginBottom: 12 }}>
        <option value="">All types</option>
        <option value="scheme">Schemes</option>
        <option value="enrollment">Enrollments</option>
        <option value="installment">Installments</option>
        <option value="batch">Batches</option>
        <option value="legacy_name">Legacy names</option>
      </select>
      {log === null ? <div>Loading…</div> : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead><tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
            <th>When</th><th>Who</th><th>Action</th><th>What</th><th>Details</th>
          </tr></thead>
          <tbody>
            {log.map((row) => (
              <tr key={row.id} style={{ borderBottom: "1px solid #eee" }}>
                <td>{new Date(row.created_at).toLocaleString("en-IN")}</td>
                <td>{row.actor}</td>
                <td>{row.action}</td>
                <td>{row.entity_type}</td>
                <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={JSON.stringify(row.details)}>
                  {row.details ? JSON.stringify(row.details) : ""}
                </td>
              </tr>
            ))}
            {!log.length && <tr><td colSpan={5}>No activity yet.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

function emptyPaidMonth() { return { monthNumber: "", paidAt: "", amount: "", gramsPurchased: "", paymentMethod: "cash", paymentRemarks: "" }; }
const PAID_MONTH_PAYMENT_METHODS = ["cash", "upi", "bank_transfer", "card", "cheque", "other"];

// Shared "which months were already paid" widget — used both when
// enrolling a new member (backfilling months if they actually started
// earlier) and when hand-entering an old/legacy member's payment history.
// isGramBased shows the Grams field, needed for gullak/rate-lock schemes so
// the backfilled entries count toward gold weight, not just rupees paid.
function PaidMonthsEditor({ paidMonths, setPaidMonths, isGramBased }) {
  const setPaidMonth = (i, k, v) => setPaidMonths((p) => p.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));
  return (
    <div>
      <h4 style={{ marginTop: 16 }}>Backfill already-paid months</h4>
      <p style={{ fontSize: 12, color: "#666" }}>Optional — fill in if they actually started earlier and already paid some months in cash/UPI. "Installment #" is the payment sequence (1st, 2nd…) — NOT the calendar month. A member who started in December is still installment #1, not #12.</p>
      {paidMonths.map((m, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input type="number" placeholder="Installment # (1st, 2nd…)" value={m.monthNumber} onChange={(e) => setPaidMonth(i, "monthNumber", e.target.value)} style={{ width: 150 }} />
          <input type="date" placeholder="Paid on" value={m.paidAt} onChange={(e) => setPaidMonth(i, "paidAt", e.target.value)} />
          <input type="number" placeholder="Amount ₹" value={m.amount} onChange={(e) => setPaidMonth(i, "amount", e.target.value)} style={{ width: 100 }} />
          {isGramBased && (
            <input type="number" placeholder="Grams purchased" value={m.gramsPurchased} onChange={(e) => setPaidMonth(i, "gramsPurchased", e.target.value)} style={{ width: 130 }} />
          )}
          <select value={m.paymentMethod} onChange={(e) => setPaidMonth(i, "paymentMethod", e.target.value)}>
            {PAID_MONTH_PAYMENT_METHODS.map((pm) => <option key={pm} value={pm}>{pm}</option>)}
          </select>
          <input type="text" placeholder="Remarks (UPI ref / cash given to whom)" value={m.paymentRemarks} onChange={(e) => setPaidMonth(i, "paymentRemarks", e.target.value)} style={{ width: 220 }} />
          <button onClick={() => setPaidMonths((p) => p.filter((_, idx) => idx !== i))}>✕</button>
        </div>
      ))}
      <button onClick={() => setPaidMonths((p) => [...p, emptyPaidMonth()])} style={{ marginBottom: 16 }}>+ Add month</button>
    </div>
  );
}

function isGoldRedemptionScheme(perks) {
  return perks?.redemption === "jewellery_or_raw_gold" || perks?.redemption === "sell_anytime_or_jewellery";
}
const FLEXIBLE_AMOUNTS = Array.from({ length: 60 }, (_, i) => (i + 1) * 5000); // 5,000 .. 3,00,000

function EnrollNewMemberTab({ crmSecret, actor }) {
  const [schemes, setSchemes] = useState([]);
  const [f, setF] = useState({ name: "", phone: "", schemeId: "", startDate: new Date().toISOString().slice(0, 10), monthlyAmount: "" });
  const [paidMonths, setPaidMonths] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    call("admin-list-schemes", { crmSecret }).then((d) => setSchemes(d.ok ? d.schemes.filter((s) => s.active) : []));
  }, [crmSecret]);

  const selectedScheme = schemes.find((s) => s.id === f.schemeId);
  const isFlexible = selectedScheme && isGoldRedemptionScheme(selectedScheme.perks) && selectedScheme.perks?.unit !== "grams";
  const isGramBased = selectedScheme?.perks?.unit === "grams";

  const submit = async () => {
    if (!f.name || !f.phone || !f.schemeId || !f.startDate) return setMsg("Name, phone, scheme, and start date are all required.");
    setSaving(true);
    const cleanPaidMonths = paidMonths.filter((m) => m.monthNumber !== "").map((m) => ({
      monthNumber: Number(m.monthNumber), paidAt: m.paidAt || null, amount: m.amount === "" ? null : Number(m.amount),
      gramsPurchased: m.gramsPurchased === "" ? null : Number(m.gramsPurchased),
      paymentMethod: m.paymentMethod || null, paymentRemarks: m.paymentRemarks || null,
    }));
    const d = await call("enroll-new-member", { method: "POST", crmSecret, body: {
      ...f, monthlyAmount: isFlexible ? Number(f.monthlyAmount) : null, confirmedBy: actor, actor, paidMonths: cleanPaidMonths,
    } });
    setSaving(false);
    if (d.ok) { setMsg("Enrolled — active from " + f.startDate + "."); setF({ name: "", phone: "", schemeId: "", startDate: new Date().toISOString().slice(0, 10) }); setPaidMonths([]); }
    else setMsg(d.error || "Failed");
  };

  return (
    <div style={{ maxWidth: 480 }}>
      <p>Enroll someone directly (walk-in, phone call, etc.) — no need for them to have submitted the online interest form first.</p>
      <label>Name<input value={f.name} onChange={(e) => set("name", e.target.value)} style={{ display: "block", width: "100%" }} /></label>
      <label>Phone<input value={f.phone} onChange={(e) => set("phone", e.target.value)} style={{ display: "block", width: "100%" }} /></label>
      <label>Scheme
        <select value={f.schemeId} onChange={(e) => {
          const s = schemes.find((sc) => sc.id === e.target.value);
          set("schemeId", e.target.value);
          set("monthlyAmount", s && isGoldRedemptionScheme(s.perks) && s.perks?.unit !== "grams" ? s.monthly_amount : "");
        }} style={{ display: "block", width: "100%" }}>
          <option value="">— choose —</option>
          {schemes.map((s) => <option key={s.id} value={s.id}>{s.name}{s.monthly_amount ? ` — ₹${s.monthly_amount}/mo` : ""}</option>)}
        </select>
      </label>
      {isFlexible && (
        <label>Monthly amount (member's own choice, ₹5,000 steps up to ₹3,00,000)
          <select value={f.monthlyAmount} onChange={(e) => set("monthlyAmount", Number(e.target.value))} style={{ display: "block", width: "100%" }}>
            {FLEXIBLE_AMOUNTS.map((a) => <option key={a} value={a}>₹{a.toLocaleString("en-IN")}/month</option>)}
          </select>
        </label>
      )}
      <label>Start date (first/already-paid installment's month)<input type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} style={{ display: "block", width: "100%" }} /></label>

      <PaidMonthsEditor paidMonths={paidMonths} setPaidMonths={setPaidMonths} isGramBased={isGramBased} />

      {msg && <div style={{ margin: "8px 0" }}>{msg}</div>}
      <button onClick={submit} disabled={saving}>{saving ? "Enrolling…" : "Enroll Member"}</button>
    </div>
  );
}

function SchemesTab({ sb, tenantId, crmSecret, actor }) {
  const [schemes, setSchemes] = useState([]);
  const [funnels, setFunnels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await call("admin-list-schemes", { crmSecret });
    setSchemes(d.ok ? d.schemes : []);
    if (sb) {
      const { data } = await sb.from("funnels").select("id,name,kind").eq("tenant_id", tenantId).eq("active", true).order("name");
      setFunnels(data || []);
    }
    setLoading(false);
  }, [crmSecret, sb, tenantId]);

  useEffect(() => { load(); }, [load]);

  if (editing) return <SchemeEditor scheme={editing} funnels={funnels} crmSecret={crmSecret} actor={actor} onDone={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />;
  if (loading) return <div>Loading…</div>;

  return (
    <div>
      <button onClick={() => setEditing(emptyScheme())} style={{ marginBottom: 16, padding: "8px 16px" }}>+ New Scheme</button>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
          <th>Name</th><th>₹/month</th><th>Months</th><th>WA Funnel</th><th>Active</th><th></th>
        </tr></thead>
        <tbody>
          {schemes.map((s) => (
            <tr key={s.id} style={{ borderBottom: "1px solid #eee" }}>
              <td>{s.name}</td><td>₹{s.monthly_amount}</td><td>{s.duration_months}</td>
              <td>{funnels.find((f) => f.id === s.funnel_id)?.name || "—"}</td>
              <td>{s.active ? "✅" : "—"}</td>
              <td><button onClick={() => setEditing({
                id: s.id, name: s.name, slug: s.slug, monthlyAmount: s.monthly_amount ?? "", durationMonths: s.duration_months,
                funnelId: s.funnel_id || "",
                perks: {
                  ...emptyScheme().perks, ...(s.perks || {}),
                  weight_tiers_g: Array.isArray(s.perks?.weight_tiers_g) ? s.perks.weight_tiers_g.join(", ") : (s.perks?.weight_tiers_g || ""),
                },
                description: s.description || "", active: s.active, sortOrder: s.sort_order,
              })}>Edit</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SchemeEditor({ scheme, funnels, crmSecret, actor, onDone, onCancel }) {
  const [f, setF] = useState(scheme);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const setPerk = (k, v) => setF((p) => ({ ...p, perks: { ...p.perks, [k]: v } }));

  const save = async () => {
    setSaving(true);
    const cleanPerks = Object.fromEntries(
      Object.entries(f.perks).filter(([, v]) => v !== "" && v !== false).map(([k, v]) => {
        if (k === "weight_tiers_g") return [k, String(v).split(",").map((n) => Number(n.trim())).filter((n) => !isNaN(n) && n > 0)];
        return [k, typeof v === "boolean" ? v : (isNaN(Number(v)) ? v : Number(v))];
      })
    );
    const body = { ...f, perks: cleanPerks, actor };
    const d = await call(f.id ? "scheme-update" : "scheme-create", { method: "POST", crmSecret, body });
    setSaving(false);
    if (d.ok) onDone(); else alert(d.error || "Save failed");
  };

  const del = async () => {
    if (!f.id || !confirm(`Delete "${f.name}"? This cannot be undone.`)) return;
    const d = await call("scheme-delete", { method: "POST", crmSecret, body: { id: f.id, actor } });
    if (d.ok) onDone(); else alert(d.error || "Delete failed");
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <h3>{f.id ? "Edit" : "New"} Scheme</h3>
      <label>Name<input value={f.name} onChange={(e) => set("name", e.target.value)} style={{ display: "block", width: "100%" }} /></label>
      <label>Slug (url-safe)<input value={f.slug} onChange={(e) => set("slug", e.target.value)} style={{ display: "block", width: "100%" }} /></label>
      <label>Unit
        <select value={f.perks.unit} onChange={(e) => setPerk("unit", e.target.value)} style={{ display: "block", width: "100%" }}>
          <option value="rupees">Fixed ₹ / month</option>
          <option value="grams">Gram-based (gullak-style)</option>
        </select>
      </label>
      {f.perks.unit === "grams" ? (
        <label>Weight tiers, grams/month (comma-separated)<input value={f.perks.weight_tiers_g} onChange={(e) => setPerk("weight_tiers_g", e.target.value)} placeholder="1, 2, 5, 10" style={{ display: "block", width: "100%" }} /></label>
      ) : (
        <label>Monthly amount (₹)<input type="number" value={f.monthlyAmount} onChange={(e) => set("monthlyAmount", e.target.value)} style={{ display: "block", width: "100%" }} /></label>
      )}
      <label>Duration (months)<input type="number" value={f.durationMonths} onChange={(e) => set("durationMonths", e.target.value)} style={{ display: "block", width: "100%" }} /></label>
      <label>Description<textarea value={f.description} onChange={(e) => set("description", e.target.value)} style={{ display: "block", width: "100%" }} /></label>
      <label>WhatsApp funnel — sent automatically when a member enrolls or a new contact is created for this scheme
        <select value={f.funnelId} onChange={(e) => set("funnelId", e.target.value)} style={{ display: "block", width: "100%" }}>
          <option value="">— none —</option>
          {(funnels || []).map((fn) => <option key={fn.id} value={fn.id}>{fn.name}</option>)}
        </select>
      </label>

      <h4>Perks</h4>
      <label><input type="checkbox" checked={!!f.perks.lucky_draw} onChange={(e) => setPerk("lucky_draw", e.target.checked)} /> Monthly lucky draw</label><br />
      <label>Non-winner benefit (₹)<input type="number" value={f.perks.non_winner_benefit_amount} onChange={(e) => setPerk("non_winner_benefit_amount", e.target.value)} /></label><br />
      <label><input type="checkbox" checked={!!f.perks.gold_coin_chance} onChange={(e) => setPerk("gold_coin_chance", e.target.checked)} /> Monthly gold coin chance</label><br />
      <label>Gold coin weight (mg)<input type="number" value={f.perks.gold_coin_weight_mg} onChange={(e) => setPerk("gold_coin_weight_mg", e.target.value)} /></label><br />
      <label>Free installment — month # (blank = none)<input type="number" value={f.perks.free_installment_month} onChange={(e) => setPerk("free_installment_month", e.target.value)} /></label><br />
      <label>Rate-lock day of month (blank = none)<input type="number" value={f.perks.rate_lock_day} onChange={(e) => setPerk("rate_lock_day", e.target.value)} /></label><br />
      <label>Making charge discount % on completion<input type="number" value={f.perks.making_charge_discount_pct} onChange={(e) => setPerk("making_charge_discount_pct", e.target.value)} /></label><br />
      <label>Redemption
        <select value={f.perks.redemption} onChange={(e) => setPerk("redemption", e.target.value)}>
          <option value="jewellery_only">Jewellery only</option>
          <option value="jewellery_or_raw_gold">Jewellery or raw gold</option>
          <option value="sell_anytime_or_jewellery">Sell anytime or jewellery (gullak)</option>
        </select>
      </label><br />
      <label><input type="checkbox" checked={!!f.perks.gullak_option} onChange={(e) => setPerk("gullak_option", e.target.checked)} /> Offer physical gullak (savings box) option</label><br />
      <label><input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} /> Active (shows on ssj.in)</label>

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        <button onClick={onCancel}>Cancel</button>
        {f.id && <button onClick={del} style={{ marginLeft: "auto", color: "#B91C1C" }}>Delete</button>}
      </div>
    </div>
  );
}

function exportMonthlyExcel(enrollments, month) {
  const rows = [];
  for (const e of enrollments) {
    for (const i of e.installments || []) {
      if (!i.due_date || !i.due_date.startsWith(month)) continue;
      rows.push({
        "Client Name": e.lead?.name || "",
        "Phone": e.lead?.phone || "",
        "Scheme": e.is_legacy ? e.legacy_scheme_name : (e.scheme?.name || ""),
        "Enrollment Status": e.status,
        "Installment #": i.month_number,
        "Due Date": i.due_date,
        "Amount": i.amount,
        "Installment Status": i.status,
        "Paid Amount": i.paid_amount || "",
        "Paid At": i.paid_at ? i.paid_at.slice(0, 10) : "",
        "Payment Method": i.payment_method || "",
        "Payment Remarks": i.payment_remarks || "",
        "Claim Status": e.claim_status !== "not_applicable" ? e.claim_status : "",
      });
    }
  }
  if (!rows.length) { alert(`No installments due in ${month}.`); return; }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Kitty");
  XLSX.writeFile(wb, `kitty-installments-${month}.xlsx`);
}

function EnrollmentsTab({ crmSecret, actor, onNewEnroll }) {
  const [status, setStatus] = useState("");
  const [schemeFilter, setSchemeFilter] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [search, setSearch] = useState("");
  const [enrollments, setEnrollments] = useState([]);
  const [batches, setBatches] = useState([]);
  const [schemes, setSchemes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rateMonth, setRateMonth] = useState(new Date().toISOString().slice(0, 7)); // separate from Export month — used to backfill any past month's rate
  const [changingSchemeFor, setChangingSchemeFor] = useState(null); // enrollment id, or null
  const [pickedSchemeId, setPickedSchemeId] = useState("");
  const [goldRate, setGoldRate] = useState(null); // today's live 995/24kt rate — reference only, for gullak rate-cut entries

  useEffect(() => {
    fetch("/api/rates").then((r) => r.json()).then((d) => { if (d.ok) setGoldRate(d.rates?.spot?.gold24kt || null); }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [d, b, s] = await Promise.all([
      call("admin-list-enrollments", { crmSecret, params: status ? { status } : {} }),
      call("admin-list-batches", { crmSecret }),
      call("admin-list-schemes", { crmSecret }),
    ]);
    setEnrollments(d.ok ? d.enrollments : []);
    setBatches(b.ok ? b.batches : []);
    setSchemes(s.ok ? s.schemes : []);
    setLoading(false);
  }, [crmSecret, status]);

  useEffect(() => { load(); }, [load]);

  const visibleBatches = schemeFilter ? batches.filter((b) => b.scheme_id === schemeFilter) : batches;

  // Standing reference, not affected by the scheme/status/search filters
  // below — cross-scheme gold holdings per client (a client can have more
  // than one gullak-type enrollment).
  const gullakByPhone = new Map();
  for (const e of enrollments) {
    if (!isGramScheme(e) || !["active", "completed", "redeemed"].includes(e.status)) continue;
    const key = e.lead?.phone || "—";
    if (!gullakByPhone.has(key)) gullakByPhone.set(key, { name: e.lead?.name, phone: key, grams: 0, count: 0 });
    const rec = gullakByPhone.get(key);
    rec.grams += enrollmentGrams(e);
    rec.count++;
  }
  const gullakHoldings = [...gullakByPhone.values()].sort((a, b) => b.grams - a.grams);

  const searchNorm = search.trim().toLowerCase();
  const searchDigits = search.replace(/\D/g, "");
  const filteredEnrollments = enrollments.filter((e) => {
    if (schemeFilter && e.scheme_id !== schemeFilter) return false;
    if (batchFilter && e.batch_id !== batchFilter) return false;
    if (searchNorm) {
      const name = (e.lead?.name || "").toLowerCase();
      const phone = e.lead?.phone || "";
      const nameMatch = name.includes(searchNorm);
      const phoneMatch = searchDigits && phone.includes(searchDigits);
      if (!nameMatch && !phoneMatch) return false;
    }
    return true;
  });

  const recordDraw = async (batch) => {
    const drawMonth = prompt("Draw month (YYYY-MM-01)?", `${month}-01`);
    if (!drawMonth) return;
    const batchMembers = enrollments.filter((e) => e.batch_id === batch.id && e.status === "active");
    const winnerPhone = prompt(`Winner's phone? (members in this batch: ${batchMembers.map((e) => `${e.lead?.name} ${e.lead?.phone}`).join(", ") || "none loaded — try 'All statuses' filter"})`);
    const winner = batchMembers.find((e) => e.lead?.phone === winnerPhone?.replace(/\D/g, ""));
    if (winnerPhone && !winner) return alert("No active member in this batch with that phone.");
    const goldCoinPhone = prompt("Gold coin winner's phone (optional, Bloom only)?") || "";
    const goldCoinWinner = batchMembers.find((e) => e.lead?.phone === goldCoinPhone.replace(/\D/g, ""));
    const nonWinnerBenefitAmount = prompt("Non-winner benefit amount (₹, optional)?") || null;
    const d = await call("record-draw", { method: "POST", crmSecret, body: {
      schemeId: batch.scheme_id, batchId: batch.id, drawMonth,
      winnerEnrollmentId: winner?.id || null, goldCoinWinnerEnrollmentId: goldCoinWinner?.id || null,
      nonWinnerBenefitAmount, recordedBy: actor, actor,
    } });
    if (d.ok) { alert("Draw recorded."); load(); } else alert(d.error);
  };

  const confirm_ = async (id) => {
    const startDate = prompt("Start date for first installment (YYYY-MM-DD)?", new Date().toISOString().slice(0, 10));
    if (!startDate) return;
    const d = await call("confirm-enrollment", { method: "POST", crmSecret, body: { id, startDate, confirmedBy: actor, actor } });
    if (d.ok) load(); else alert(d.error);
  };
  const cancel_ = async (id) => {
    if (!confirm("Cancel this enrollment?")) return;
    const d = await call("cancel-enrollment", { method: "POST", crmSecret, body: { id, actor } });
    if (d.ok) load(); else alert(d.error);
  };
  // Corrects a wrongly-picked scheme. Only allowed pre-payment — the API
  // rejects it once any installment is marked paid (use cancel + re-enroll
  // instead in that case, to preserve payment history). Inline <select>
  // instead of a typed-ID prompt — staff shouldn't have to copy scheme IDs.
  const applyChangeScheme = async (e) => {
    if (!pickedSchemeId || pickedSchemeId === e.scheme_id) return setChangingSchemeFor(null);
    const match = schemes.find((s) => s.id === pickedSchemeId);
    if (!confirm(`Switch to "${match?.name}"? This rebuilds the installment schedule from scratch (only allowed since nothing's been paid yet).`)) return;
    const d = await call("change-scheme", { method: "POST", crmSecret, body: { id: e.id, newSchemeId: pickedSchemeId, actor } });
    setChangingSchemeFor(null);
    if (d.ok) load(); else alert(d.error);
  };
  // Hard delete — for genuine duplicate entries only (double-enrolled by
  // mistake). Blocked server-side once any installment is paid.
  const deleteEnrollment_ = async (e) => {
    const typed = prompt(`Type DELETE to permanently remove this duplicate enrollment for ${e.lead?.name || "this member"} (${e.is_legacy ? e.legacy_scheme_name : e.scheme?.name}). This cannot be undone.`);
    if (typed == null) return; // cancelled — no message needed
    if ((typed || "").trim().toUpperCase() !== "DELETE") return alert("Didn't match \"DELETE\" — nothing was deleted.");
    const d = await call("delete-enrollment", { method: "POST", crmSecret, body: { id: e.id, actor } });
    if (d.ok) return alert("Deleted."), load();
    if (d.error !== "has_paid_installments_cannot_delete_use_cancel") return alert(`Delete failed: ${d.error}`);
    // Blocked because installments are marked paid — ask staff to confirm
    // it's a data-entry duplicate, not real money collected twice, before
    // bypassing the guard.
    if (!confirm(`This enrollment has PAID installments recorded. Only force-delete if you're SURE this is a duplicate data entry and no real payment was actually collected twice.\n\nForce delete anyway?`)) return;
    const d2 = await call("delete-enrollment", { method: "POST", crmSecret, body: { id: e.id, actor, force: true } });
    if (d2.ok) { alert("Deleted (forced past paid-installment guard)."); load(); } else alert(`Delete failed: ${d2.error}`);
  };
  // Loops until a valid whole-number ₹/g rate is entered (or the user gives
  // up) — a decimal here is almost always a mistyped grams value (real
  // incident, 2026-08-26: Upasana Khanna's rate got entered as 0.1635
  // instead of ~₹152,900/g, inflating her computed gold holding 1000x).
  const promptRate = (label) => {
    while (true) {
      const raw = prompt(`${label}${goldRate ? ` [today's live 995 rate: ₹${Math.round(goldRate)}/g]` : ""}`);
      if (raw == null || raw.trim() === "") return null;
      const n = Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1000) {
        alert("Gold rate must be a whole number, ₹/g (e.g. 152900) — no decimals, and not a small number (that looks like a grams value). Try again.");
        continue;
      }
      return n;
    }
  };

  // Bulk-sets one gold rate for every ALREADY-PAID installment of the
  // selected kitty in the selected month — for rate-lock schemes like
  // Golden Sparkle, so staff enter the day's booked rate once instead of
  // re-typing it per person per payment. A wrong individual entry can still
  // be fixed afterward via the usual per-installment "Edit" (update-installment).
  const setMonthlyRate = async (schemeId, monthStr) => {
    const scheme = schemes.find((s) => s.id === schemeId);
    const rate = promptRate(`Booked gold rate (₹/g) for "${scheme?.name}" — ${monthStr}, applied to everyone who paid this month?`);
    if (rate == null) return;
    if (!confirm(`Apply ₹${rate.toLocaleString("en-IN")}/g to every payment already recorded for "${scheme?.name}" in ${monthStr}? This overwrites any rate already set on those installments.`)) return;
    const d = await call("set-monthly-rate", { method: "POST", crmSecret, body: { schemeId, month: monthStr, ratePerGram: rate, actor } });
    if (d.ok) { alert(`Rate applied to ${d.updated} payment${d.updated === 1 ? "" : "s"}.`); load(); } else alert(d.error);
  };

  const PAYMENT_METHODS = ["cash", "upi", "bank_transfer", "card", "cheque", "other"];
  const promptPaymentMethod = (current) => {
    while (true) {
      const raw = prompt(`Payment method? (${PAYMENT_METHODS.join(" / ")})`, current || "cash");
      if (raw == null) return null;
      const v = raw.trim().toLowerCase();
      if (!PAYMENT_METHODS.includes(v)) {
        alert(`Must be one of: ${PAYMENT_METHODS.join(", ")}`);
        continue;
      }
      return v;
    }
  };

  const INSTALLMENT_STATUSES = ["due", "paid", "free", "waived"];
  const promptStatus = (current) => {
    while (true) {
      const raw = prompt(`Status? (${INSTALLMENT_STATUSES.join(" / ")})`, current);
      if (raw == null) return null;
      const v = raw.trim().toLowerCase();
      if (!INSTALLMENT_STATUSES.includes(v)) {
        alert(`Must be one of: ${INSTALLMENT_STATUSES.join(", ")}`);
        continue;
      }
      return v;
    }
  };

  const markPaid = async (installmentId) => {
    const paidAmount = prompt("Amount received?");
    if (paidAmount == null) return;
    const paymentMethod = promptPaymentMethod();
    if (paymentMethod == null) return;
    const paymentRemarks = prompt("Remarks (UPI ref no. / transfer ref no. / cash given to whom)? Optional.") || null;
    let rateLocked;
    if (confirm("Is this a rate-lock scheme? Enter locked rate?")) rateLocked = promptRate("Locked gold rate (₹/g)?");
    const d = await call("mark-installment-paid", { method: "POST", crmSecret, body: { installmentId, paidAmount, paymentMethod, paymentRemarks, rateLocked, recordedBy: actor, actor } });
    if (d.ok) load(); else alert(d.error);
  };
  const editInstallment = async (i) => {
    const amount = prompt("Amount (₹)?", i.amount) ?? i.amount;
    const dueDate = prompt("Due date (YYYY-MM-DD)?", i.due_date) ?? i.due_date;
    const status = promptStatus(i.status) ?? i.status;
    const paymentMethod = promptPaymentMethod(i.payment_method) ?? i.payment_method ?? null;
    const paymentRemarks = prompt("Remarks (UPI ref no. / transfer ref no. / cash given to whom)?", i.payment_remarks || "") ?? i.payment_remarks;

    // Gold weight is stored as rate_locked (₹/g) — paid_amount / rate_locked
    // gives the grams. Wrong weight at entry couldn't be fixed before this,
    // since neither grams nor rate_locked were editable here at all. Sent as
    // gramsPurchased (not a pre-computed rateLocked) so the server derives
    // rate_locked the same way add-installment does — naturally fractional,
    // not subject to the whole-number typed-rate validation.
    const currentGrams = i.rate_locked ? Number(amount) / Number(i.rate_locked) : null;
    const gramsRaw = prompt(
      `Grams purchased (for gold-weight calc)? Leave blank to keep unchanged.${currentGrams ? ` Currently ~${currentGrams.toFixed(3)}g.` : ""}`,
      ""
    );
    let gramsPurchased;
    if (gramsRaw) {
      const grams = Math.round(Number(gramsRaw) * 1000) / 1000;
      if (!grams || !Number.isFinite(grams)) alert("Invalid grams value — gold weight left unchanged.");
      else gramsPurchased = grams;
    }

    const body = { id: i.id, amount, dueDate, status, paymentMethod, paymentRemarks, actor };
    if (gramsPurchased != null) body.gramsPurchased = gramsPurchased;
    const d = await call("update-installment", { method: "POST", crmSecret, body });
    if (d.ok) load(); else alert(d.error);
  };
  const editEnrollment = async (e) => {
    const startDate = prompt("Correct start date (YYYY-MM-DD)? Shifts all still-'due' installments' due dates to match — paid/free/waived ones are left as-is.", e.start_date || new Date().toISOString().slice(0, 10));
    if (!startDate) return;
    const d = await call("update-enrollment", { method: "POST", crmSecret, body: { id: e.id, startDate, actor } });
    if (d.ok) load(); else alert(d.error);
  };
  const updateClaim = async (id, claimStatus) => {
    const d = await call("update-claim-status", { method: "POST", crmSecret, body: { id, claimStatus, actor } });
    if (d.ok) load(); else alert(d.error);
  };
  const addInstallment = async (enrollmentId) => {
    const amount = prompt(`Amount received (₹)?${goldRate ? ` [today's live 995 rate: ₹${Math.round(goldRate)}/g]` : ""}`);
    if (!amount) return;
    // Grams are always entered/stored to 3 decimals (e.g. 1.635g) — round
    // here so the derived rate (amount / grams) doesn't drift on a stray
    // extra-precision entry.
    const gramsRaw = prompt("Grams purchased (leave blank if not gram-based / no rate lock)?");
    const gramsPurchased = gramsRaw ? (Math.round(Number(gramsRaw) * 1000) / 1000).toFixed(3) : null;
    const paymentMethod = promptPaymentMethod();
    if (paymentMethod == null) return;
    const paymentRemarks = prompt("Remarks (UPI ref no. / transfer ref no. / cash given to whom)? Optional.") || null;
    const d = await call("add-installment", { method: "POST", crmSecret, body: { enrollmentId, amount, gramsPurchased, paymentMethod, paymentRemarks, recordedBy: actor, actor } });
    if (d.ok) load(); else alert(d.error);
  };
  // Two-step: (1) initiate sends the member a WA code + what's being
  // redeemed, staff never sees the code; (2) staff asks the member to read
  // it out and enters it here to actually complete the redemption — proves
  // the member themselves requested it, not just whoever has CRM access.
  const redeem = async (e) => {
    const paidCount = (e.installments || []).filter((i) => i.status === "paid").length;
    const totalCount = (e.installments || []).length;
    const isEarly = e.status === "active";
    if (isEarly && !confirm(`Only ${paidCount}/${totalCount} installments paid — redeem now anyway?\n\nThis is an EARLY EXIT: completion-only perks (e.g. a making-charge discount) do NOT apply — only what they've actually paid in counts. Remaining due installments will be waived.`)) return;
    const redemptionType = prompt("Redemption type: jewellery / raw_gold / benefit / other", "jewellery");
    if (!redemptionType) return;
    const itemDescription = prompt("Item / benefit description?") || "";
    const value = prompt("Value (₹, optional)?") || null;
    const notes = prompt("Notes (optional)?") || "";
    const d = await call("initiate-redeem", { method: "POST", crmSecret, body: { id: e.id, redemptionType, itemDescription, value, notes, actor } });
    if (!d.ok) return alert(d.error);
    const code = prompt(`Code sent to ${d.codeSentTo} on WhatsApp. Ask ${e.lead?.name || "the member"} to read it out, then enter it here to confirm:`);
    if (!code) return;
    const d2 = await call("confirm-redeem", { method: "POST", crmSecret, body: { id: e.id, code, redeemedBy: actor, actor } });
    if (d2.ok) { alert("Redeemed — thank-you message sent."); load(); } else alert(d2.error);
  };

  return (
    <div>
      {goldRate && (
        <div style={{ marginBottom: 12, fontSize: 13, color: "#92400e", fontWeight: 600 }}>
          🪙 Today's live 24KT (995) rate: ₹{Math.round(goldRate).toLocaleString("en-IN")}/g — reference only, enter the actual rate you're cutting when logging a purchase.
        </div>
      )}
      {gullakHoldings.length > 0 && (
        <details style={{ marginBottom: 16, border: "1px solid #f0d9a0", borderRadius: 8, padding: "8px 12px", background: "#fffaf0" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, color: "#92400e" }}>Gullak Gold Holdings by Client ({gullakHoldings.length})</summary>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 8 }}>
            <thead><tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}><th>Name</th><th>Phone</th><th>Enrollments</th><th>Total grams</th></tr></thead>
            <tbody>
              {gullakHoldings.map((h) => (
                <tr key={h.phone} style={{ borderBottom: "1px solid #eee" }}>
                  <td>{h.name || "—"}</td><td>{h.phone}</td><td>{h.count}</td><td>{h.grams.toFixed(3)} g</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        {onNewEnroll && <button onClick={onNewEnroll} style={{ fontWeight: 600 }}>+ New Enroll</button>}
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending_confirmation">Pending confirmation</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={schemeFilter} onChange={(e) => { setSchemeFilter(e.target.value); setBatchFilter(""); }}>
          <option value="">All kitties</option>
          {schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {visibleBatches.length > 0 && (
          <select value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)}>
            <option value="">All batches</option>
            {visibleBatches.map((b) => <option key={b.id} value={b.id}>{b.batch_label}</option>)}
          </select>
        )}
        <input placeholder="Search name or mobile…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 180 }} />
        <label>Export month: <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        <button onClick={() => exportMonthlyExcel(filteredEnrollments, month)}>⬇ Download {month} Excel</button>
        {schemeFilter && (
          <span style={{ display: "flex", gap: 6, alignItems: "center", border: "1px solid #ddd", borderRadius: 6, padding: "2px 8px" }}>
            <label>Rate month: <input type="month" value={rateMonth} onChange={(e) => setRateMonth(e.target.value)} /></label>
            <button onClick={() => setMonthlyRate(schemeFilter, rateMonth)} title="Applies one ₹/g rate to everyone who already paid this scheme in the selected month — any past month works, not just current. Correct any individual entry later as usual">
              💰 Set {rateMonth} rate for this kitty
            </button>
          </span>
        )}
      </div>

      {visibleBatches.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h4>Lucky-Draw Batches (max 100/round — new round auto-opens when one fills or completes)</h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {visibleBatches.map((b) => (
              <div key={b.id} style={{ border: "1px solid #ddd", borderRadius: 6, padding: 10, fontSize: 12.5 }}>
                <b>{b.batch_label}</b><br />
                {b.member_count}/{b.max_members} members — {b.status} — started {b.start_date}
                <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                  {b.status !== "completed" && <button onClick={() => recordDraw(b)}>Record This Month's Draw</button>}
                  {(b.status === "open" || b.status === "full") && (
                    <button onClick={async () => { if (!confirm(`Close "${b.batch_label}" to further enrollments?`)) return; const d = await call("close-batch", { method: "POST", crmSecret, body: { id: b.id, actor } }); if (d.ok) load(); else alert(d.error); }}>
                      Close (no more enrollments)
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {loading ? <div>Loading…</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {filteredEnrollments.map((e) => (
            <div key={e.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
              <b>{e.lead?.name || "—"}</b> ({e.lead?.phone}) — {e.is_legacy ? e.legacy_scheme_name : e.scheme?.name}{e.member_number ? ` #${e.member_number}` : ""} — <i>{e.status}</i>
              {e.start_date && <span style={{ marginLeft: 8, fontSize: 11.5, color: "#666" }}>started {e.start_date}</span>}
              {isGramScheme(e) && (
                <div style={{ marginTop: 4, fontSize: 13, fontWeight: 600, color: "#92400e" }}>
                  Gold held: {enrollmentGrams(e).toFixed(3)} g
                </div>
              )}
              {!e.is_legacy && <button onClick={() => editEnrollment(e)} style={{ marginLeft: 8 }}>Edit Start Date</button>}
              {!e.is_legacy && (e.status === "pending_confirmation" || e.status === "active") && (
                changingSchemeFor === e.id ? (
                  <span style={{ marginLeft: 8 }}>
                    <select value={pickedSchemeId} onChange={(ev) => setPickedSchemeId(ev.target.value)} autoFocus>
                      <option value="">Pick scheme…</option>
                      {schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <button onClick={() => applyChangeScheme(e)} style={{ marginLeft: 4 }}>Apply</button>
                    <button onClick={() => setChangingSchemeFor(null)} style={{ marginLeft: 4 }}>Cancel</button>
                  </span>
                ) : (
                  <button onClick={() => { setChangingSchemeFor(e.id); setPickedSchemeId(e.scheme_id || ""); }} style={{ marginLeft: 8 }}>Change Scheme</button>
                )
              )}
              {e.status === "pending_confirmation" && <button onClick={() => confirm_(e.id)} style={{ marginLeft: 8 }}>Confirm & Start</button>}
              {(e.status === "pending_confirmation" || e.status === "active") && <button onClick={() => cancel_(e.id)} style={{ marginLeft: 8 }}>Cancel</button>}
              <button onClick={() => deleteEnrollment_(e)} style={{ marginLeft: 8, color: "#b91c1c" }}>Delete (duplicate)</button>
              {e.status === "active" && <button onClick={() => addInstallment(e.id)} style={{ marginLeft: 8 }}>+ Add Purchase/Installment</button>}
              {(e.status === "active" || e.status === "completed") && (
                <button onClick={() => redeem(e)} style={{ marginLeft: 8, fontWeight: 600 }}>
                  {e.status === "active" ? "Redeem Now (early)" : "Redeem"}
                </button>
              )}
              {e.claim_status && e.claim_status !== "not_applicable" && <span style={{ marginLeft: 8 }}>claim: {e.claim_status}</span>}
              {e.redemptions?.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 12, color: "#555" }}>
                  Redeemed: {e.redemptions.map((r) => `${r.redemption_type}${r.item_description ? ` — ${r.item_description}` : ""}${r.value ? ` (₹${r.value})` : ""}`).join("; ")}
                </div>
              )}
              {e.installments?.length > 0 && (
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {e.installments.sort((a, b) => a.month_number - b.month_number).map((i) => {
                    const g = gramsFor(i);
                    const rateTxt = i.rate_locked ? ` — rate ₹${Number(i.rate_locked).toLocaleString("en-IN")}/g` : "";
                    const gramsTxt = g ? ` — ${g.toFixed(3)}g` : "";
                    const payTxt = i.payment_method ? ` — paid via ${i.payment_method}${i.payment_remarks ? ` (${i.payment_remarks})` : ""}` : "";
                    return (
                      <span key={i.month_number} title={`Due ${i.due_date}${rateTxt}${gramsTxt}${payTxt} — click to mark paid, shift+click to edit`}
                        onClick={(ev) => { if (ev.shiftKey) editInstallment(i); else if (i.status === "due") markPaid(i.id); else editInstallment(i); }}
                        style={{ padding: "2px 8px", borderRadius: 4, fontSize: 12, cursor: "pointer",
                          background: i.status === "paid" ? "#d1fae5" : i.status === "due" ? "#fef3c7" : "#e5e7eb" }}>
                        #{i.month_number} {i.status}{i.rate_locked ? ` · ₹${Number(i.rate_locked).toLocaleString("en-IN")}/g` : ""}{g ? ` · ${g.toFixed(3)}g` : ""}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {!filteredEnrollments.length && <div>No enrollments match.</div>}
        </div>
      )}
    </div>
  );
}

function LegacyTab({ crmSecret, actor }) {
  const [f, setF] = useState({ name: "", phone: "", legacySchemeName: "", notes: "" });
  const [paidMonths, setPaidMonths] = useState([emptyPaidMonth()]);
  const [names, setNames] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const loadNames = useCallback(async () => {
    const d = await call("admin-list-legacy-names", { crmSecret });
    setNames(d.ok ? d.names : []);
  }, [crmSecret]);

  useEffect(() => { loadNames(); }, [loadNames]);

  const addNewName = async () => {
    const name = prompt("New old-kitty name (e.g. \"2023 Diwali Kitty\")?");
    if (!name) return;
    const d = await call("add-legacy-name", { method: "POST", crmSecret, body: { name, actor } });
    if (d.ok) { await loadNames(); set("legacySchemeName", d.legacyName.name); } else alert(d.error);
  };

  const submit = async () => {
    if (!f.name || !f.phone || !f.legacySchemeName) return setMsg("Name, phone, and old scheme name are required.");
    setSaving(true);
    const cleanPaidMonths = paidMonths.filter((m) => m.monthNumber !== "").map((m) => ({
      monthNumber: Number(m.monthNumber), paidAt: m.paidAt || null, amount: m.amount === "" ? null : Number(m.amount),
      gramsPurchased: m.gramsPurchased === "" ? null : Number(m.gramsPurchased),
      paymentMethod: m.paymentMethod || null, paymentRemarks: m.paymentRemarks || null,
    }));
    const d = await call("add-legacy-member", { method: "POST", crmSecret, body: { ...f, paidMonths: cleanPaidMonths, recordedBy: actor, actor } });
    setSaving(false);
    if (d.ok) { setMsg("Added — claim reminders will start automatically."); setF({ name: "", phone: "", legacySchemeName: "", notes: "" }); setPaidMonths([emptyPaidMonth()]); }
    else setMsg(d.error || "Failed");
  };

  return (
    <div style={{ maxWidth: 480 }}>
      <p>Enter old, already-paid-up members who haven't yet claimed their jewellery/benefit. They'll start receiving periodic WhatsApp claim reminders immediately.</p>
      <label>Name<input value={f.name} onChange={(e) => set("name", e.target.value)} style={{ display: "block", width: "100%" }} /></label>
      <label>Phone<input value={f.phone} onChange={(e) => set("phone", e.target.value)} style={{ display: "block", width: "100%" }} /></label>
      <label>Old kitty name
        <div style={{ display: "flex", gap: 6 }}>
          <select value={f.legacySchemeName} onChange={(e) => set("legacySchemeName", e.target.value)} style={{ flex: 1 }}>
            <option value="">— choose —</option>
            {names.map((n) => <option key={n.id} value={n.name}>{n.name}</option>)}
          </select>
          <button type="button" onClick={addNewName}>+ New</button>
        </div>
      </label>
      <label>Notes<textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} style={{ display: "block", width: "100%" }} /></label>

      <PaidMonthsEditor paidMonths={paidMonths} setPaidMonths={setPaidMonths} isGramBased />

      {msg && <div style={{ margin: "8px 0" }}>{msg}</div>}
      <button onClick={submit} disabled={saving}>{saving ? "Adding…" : "Add Legacy Member"}</button>
    </div>
  );
}
