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

export default function KittyAdminScreen({ sb, tenantId, crmSecret }) {
  const [tab, setTab] = useState("schemes");
  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {[["schemes", "Schemes"], ["enrollments", "Enrollments"], ["legacy", "Add Legacy Member"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #d4af37",
              background: tab === k ? "#d4af37" : "transparent", color: tab === k ? "#fff" : "#d4af37", cursor: "pointer" }}>
            {l}
          </button>
        ))}
      </div>
      {tab === "schemes" && <SchemesTab sb={sb} tenantId={tenantId} crmSecret={crmSecret} />}
      {tab === "enrollments" && <EnrollmentsTab crmSecret={crmSecret} />}
      {tab === "legacy" && <LegacyTab crmSecret={crmSecret} />}
    </div>
  );
}

function SchemesTab({ sb, tenantId, crmSecret }) {
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

  if (editing) return <SchemeEditor scheme={editing} funnels={funnels} crmSecret={crmSecret} onDone={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />;
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

function SchemeEditor({ scheme, funnels, crmSecret, onDone, onCancel }) {
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
    const body = { ...f, perks: cleanPerks };
    const d = await call(f.id ? "scheme-update" : "scheme-create", { method: "POST", crmSecret, body });
    setSaving(false);
    if (d.ok) onDone(); else alert(d.error || "Save failed");
  };

  const del = async () => {
    if (!f.id || !confirm(`Delete "${f.name}"? This cannot be undone.`)) return;
    const d = await call("scheme-delete", { method: "POST", crmSecret, body: { id: f.id } });
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

function EnrollmentsTab({ crmSecret }) {
  const [status, setStatus] = useState("");
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  const load = useCallback(async () => {
    setLoading(true);
    const d = await call("admin-list-enrollments", { crmSecret, params: status ? { status } : {} });
    setEnrollments(d.ok ? d.enrollments : []);
    setLoading(false);
  }, [crmSecret, status]);

  useEffect(() => { load(); }, [load]);

  const confirm_ = async (id) => {
    const startDate = prompt("Start date for first installment (YYYY-MM-DD)?", new Date().toISOString().slice(0, 10));
    if (!startDate) return;
    const d = await call("confirm-enrollment", { method: "POST", crmSecret, body: { id, startDate, confirmedBy: "staff" } });
    if (d.ok) load(); else alert(d.error);
  };
  const cancel_ = async (id) => {
    if (!confirm("Cancel this enrollment?")) return;
    const d = await call("cancel-enrollment", { method: "POST", crmSecret, body: { id } });
    if (d.ok) load(); else alert(d.error);
  };
  const markPaid = async (installmentId) => {
    const paidAmount = prompt("Amount received?");
    if (paidAmount == null) return;
    let rateLocked;
    if (confirm("Is this a rate-lock scheme? Enter locked rate?")) rateLocked = prompt("Locked gold rate (₹/g)?");
    const d = await call("mark-installment-paid", { method: "POST", crmSecret, body: { installmentId, paidAmount, rateLocked, recordedBy: "staff" } });
    if (d.ok) load(); else alert(d.error);
  };
  const updateClaim = async (id, claimStatus) => {
    const d = await call("update-claim-status", { method: "POST", crmSecret, body: { id, claimStatus } });
    if (d.ok) load(); else alert(d.error);
  };
  const addInstallment = async (enrollmentId) => {
    const amount = prompt("Amount received (₹)?");
    if (!amount) return;
    const gramsPurchased = prompt("Grams purchased (leave blank if not gram-based / no rate lock)?") || null;
    const d = await call("add-installment", { method: "POST", crmSecret, body: { enrollmentId, amount, gramsPurchased, recordedBy: "staff" } });
    if (d.ok) load(); else alert(d.error);
  };
  const redeem = async (e) => {
    const paidCount = (e.installments || []).filter((i) => i.status === "paid").length;
    const totalCount = (e.installments || []).length;
    const isEarly = e.status === "active";
    if (isEarly && !confirm(`Only ${paidCount}/${totalCount} installments paid — redeem now anyway? Remaining due installments will be waived (member exits early).`)) return;
    const redemptionType = prompt("Redemption type: jewellery / raw_gold / benefit / other", "jewellery");
    if (!redemptionType) return;
    const itemDescription = prompt("Item / benefit description?") || "";
    const value = prompt("Value (₹, optional)?") || null;
    const notes = prompt("Notes (optional)?") || "";
    const d = await call("redeem-enrollment", { method: "POST", crmSecret, body: { id: e.id, redemptionType, itemDescription, value, notes, redeemedBy: "staff" } });
    if (d.ok) load(); else alert(d.error);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending_confirmation">Pending confirmation</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <label>Export month: <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        <button onClick={() => exportMonthlyExcel(enrollments, month)}>⬇ Download {month} Excel</button>
      </div>
      {loading ? <div>Loading…</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {enrollments.map((e) => (
            <div key={e.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
              <b>{e.lead?.name || "—"}</b> ({e.lead?.phone}) — {e.is_legacy ? e.legacy_scheme_name : e.scheme?.name} — <i>{e.status}</i>
              {e.status === "pending_confirmation" && <button onClick={() => confirm_(e.id)} style={{ marginLeft: 8 }}>Confirm & Start</button>}
              {(e.status === "pending_confirmation" || e.status === "active") && <button onClick={() => cancel_(e.id)} style={{ marginLeft: 8 }}>Cancel</button>}
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
                  {e.installments.sort((a, b) => a.month_number - b.month_number).map((i) => (
                    <span key={i.month_number} title={i.due_date}
                      onClick={() => i.status === "due" && markPaid(i.id)}
                      style={{ padding: "2px 8px", borderRadius: 4, fontSize: 12, cursor: i.status === "due" ? "pointer" : "default",
                        background: i.status === "paid" ? "#d1fae5" : i.status === "due" ? "#fef3c7" : "#e5e7eb" }}>
                      #{i.month_number} {i.status}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {!enrollments.length && <div>No enrollments.</div>}
        </div>
      )}
    </div>
  );
}

function emptyPaidMonth() { return { monthNumber: "", paidAt: "", amount: "" }; }

function LegacyTab({ crmSecret }) {
  const [f, setF] = useState({ name: "", phone: "", legacySchemeName: "", notes: "" });
  const [paidMonths, setPaidMonths] = useState([emptyPaidMonth()]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const setPaidMonth = (i, k, v) => setPaidMonths((p) => p.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));

  const submit = async () => {
    if (!f.name || !f.phone || !f.legacySchemeName) return setMsg("Name, phone, and old scheme name are required.");
    setSaving(true);
    const cleanPaidMonths = paidMonths.filter((m) => m.monthNumber !== "").map((m) => ({
      monthNumber: Number(m.monthNumber), paidAt: m.paidAt || null, amount: m.amount === "" ? null : Number(m.amount),
    }));
    const d = await call("add-legacy-member", { method: "POST", crmSecret, body: { ...f, paidMonths: cleanPaidMonths } });
    setSaving(false);
    if (d.ok) { setMsg("Added — claim reminders will start automatically."); setF({ name: "", phone: "", legacySchemeName: "", notes: "" }); setPaidMonths([emptyPaidMonth()]); }
    else setMsg(d.error || "Failed");
  };

  return (
    <div style={{ maxWidth: 480 }}>
      <p>Enter old, already-paid-up members who haven't yet claimed their jewellery/benefit. They'll start receiving periodic WhatsApp claim reminders immediately.</p>
      <label>Name<input value={f.name} onChange={(e) => set("name", e.target.value)} style={{ display: "block", width: "100%" }} /></label>
      <label>Phone<input value={f.phone} onChange={(e) => set("phone", e.target.value)} style={{ display: "block", width: "100%" }} /></label>
      <label>Old scheme name / description<input value={f.legacySchemeName} onChange={(e) => set("legacySchemeName", e.target.value)} style={{ display: "block", width: "100%" }} /></label>
      <label>Notes<textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} style={{ display: "block", width: "100%" }} /></label>

      <h4 style={{ marginTop: 16 }}>Which months were paid?</h4>
      <p style={{ fontSize: 12, color: "#666" }}>Optional but recommended — gives a real record of how many installments they paid and which months, instead of just "completed".</p>
      {paidMonths.map((m, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          <input type="number" placeholder="Month #" value={m.monthNumber} onChange={(e) => setPaidMonth(i, "monthNumber", e.target.value)} style={{ width: 80 }} />
          <input type="date" placeholder="Paid on" value={m.paidAt} onChange={(e) => setPaidMonth(i, "paidAt", e.target.value)} />
          <input type="number" placeholder="Amount ₹" value={m.amount} onChange={(e) => setPaidMonth(i, "amount", e.target.value)} style={{ width: 100 }} />
          <button onClick={() => setPaidMonths((p) => p.filter((_, idx) => idx !== i))}>✕</button>
        </div>
      ))}
      <button onClick={() => setPaidMonths((p) => [...p, emptyPaidMonth()])} style={{ marginBottom: 16 }}>+ Add month</button>

      {msg && <div style={{ margin: "8px 0" }}>{msg}</div>}
      <button onClick={submit} disabled={saving}>{saving ? "Adding…" : "Add Legacy Member"}</button>
    </div>
  );
}
