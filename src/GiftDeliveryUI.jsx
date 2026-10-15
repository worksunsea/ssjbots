import { useEffect, useMemo, useState } from "react";
import { addressLine } from "./giftFilter";
import { STATUS_LABEL, UNASSIGNED, isoDate, tomorrowIso, buildDeliveryRows, groupByEmployee, giftTotals, buildDaySheetHtml } from "./giftSchedule";

// Scheduling gift deliveries and printing the day sheet each employee carries.

const LS_ITEM = "gift_last_item";
const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "24px 12px" };
const card = { background: "#fff", borderRadius: 12, padding: 18, width: "100%" };
const inp = { fontSize: 13, border: "1px solid #ddd", borderRadius: 6, padding: "6px 8px", boxSizing: "border-box" };
const btn = (bg, off) => ({ padding: "8px 14px", fontSize: 13, fontWeight: 600, border: "none", borderRadius: 8, color: "#fff", background: off ? "#cbd5e1" : bg, cursor: off ? "default" : "pointer" });
const ghost = { padding: "5px 10px", fontSize: 12, border: "1px solid #ddd", borderRadius: 7, background: "#fff", cursor: "pointer" };

const readLs = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const writeLs = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not persisted */ } };

function useStaffNames(sb, tenantId) {
  const [names, setNames] = useState([]);
  useEffect(() => {
    sb.from("staff").select("name,type").eq("tenant_id", tenantId).neq("type", "artisan").order("name")
      .then(({ data }) => setNames([...new Set((data || []).map((s) => s.name).filter(Boolean))]));
  }, [sb, tenantId]);
  return names;
}

function printHtml(html, onBlocked) {
  const win = window.open("", "_blank");
  if (!win) { onBlocked("Your browser blocked the print window — allow pop-ups for this site and try again."); return; }
  win.document.open(); win.document.write(html); win.document.close(); win.focus();
  setTimeout(() => win.print(), 300);
}

/** Book the selected clients for a day, an employee and a gift. */
export function ScheduleModal({ sb, tenantId, user, leads, onClose, onDone }) {
  const staff = useStaffNames(sb, tenantId);
  const [date, setDate] = useState(tomorrowIso());
  const [employee, setEmployee] = useState("");
  const [giftItem, setGiftItem] = useState(() => readLs(LS_ITEM, "Diwali gift"));
  const [perItem, setPerItem] = useState({});
  const [rebook, setRebook] = useState(false);
  const [booked, setBooked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    sb.from("gift_deliveries").select("lead_id").eq("tenant_id", tenantId).in("status", ["planned", "delivered"]).in("lead_id", leads.map((l) => l.id))
      .then(({ data }) => setBooked(new Set((data || []).map((r) => r.lead_id))));
  }, [sb, tenantId, leads]);

  const plan = useMemo(() => buildDeliveryRows({ leads, date, employee, giftItem, tenantId, createdBy: user?.name, perLeadItem: perItem, alreadyBooked: booked, rebook }), [leads, date, employee, giftItem, tenantId, user, perItem, booked, rebook]);

  async function save() {
    setBusy(true); setErr("");
    const { error } = await sb.from("gift_deliveries").insert(plan.rows);
    if (error) { setErr(error.message); setBusy(false); return; }
    writeLs(LS_ITEM, giftItem);
    onDone(plan.rows.length, date);
  }

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ ...card, maxWidth: 680 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>📅 Schedule gift delivery — {leads.length} clients</h3>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 12 }}>
          <label style={{ fontSize: 11, color: "#666" }}>Delivery date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inp, width: "100%" }} /></label>
          <label style={{ fontSize: 11, color: "#666" }}>Employee
            <select value={employee} onChange={(e) => setEmployee(e.target.value)} style={{ ...inp, width: "100%" }}>
              <option value="">— assign later —</option>
              {staff.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 11, color: "#666" }}>Gift (all clients)<input value={giftItem} onChange={(e) => setGiftItem(e.target.value)} placeholder="e.g. Silver coin 10 g + sweets" style={{ ...inp, width: "100%" }} /></label>
        </div>
        {plan.skipped.length > 0 && (
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "6px 10px", marginTop: 10 }}>
            <input type="checkbox" checked={rebook} onChange={(e) => setRebook(e.target.checked)} />
            {plan.skipped.length} client(s) already have a delivery planned or done and will be skipped. Tick to book them again anyway.
          </label>
        )}
        <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 10, border: "1px solid #eee", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ background: "#f9fafb", textAlign: "left" }}><th style={{ padding: 6 }}>Client</th><th style={{ padding: 6 }}>Address</th><th style={{ padding: 6 }}>Different gift? (optional)</th></tr></thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} style={{ borderTop: "1px solid #f1f1f1", opacity: booked.has(l.id) && !rebook ? 0.45 : 1 }}>
                  <td style={{ padding: 6 }}><b>{l.name || "—"}</b><br />{l.phone}</td>
                  <td style={{ padding: 6, color: "#555" }}>{addressLine(l) || <em>no address</em>}</td>
                  <td style={{ padding: 6 }}><input value={perItem[l.id] ?? ""} onChange={(e) => setPerItem((p) => ({ ...p, [l.id]: e.target.value }))} placeholder={giftItem} style={{ ...inp, width: "100%" }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {err && <p style={{ color: "#b91c1c", fontSize: 12 }}>{err}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button style={btn("#8e44ad", busy || !plan.rows.length || !date)} disabled={busy || !plan.rows.length || !date} onClick={save}>{busy ? "Saving…" : `Schedule ${plan.rows.length}`}</button>
          <button style={ghost} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/** The day's plan: per employee, mark delivered, reassign, reschedule, print. */
export function DaySheets({ sb, tenantId, initialDate, onClose, onDelivered }) {
  const staff = useStaffNames(sb, tenantId);
  const [date, setDate] = useState(initialDate || isoDate());
  const [rows, setRows] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await sb.from("gift_deliveries")
      .select("id,lead_id,gift_item,planned_date,assigned_to,status,notes,delivered_at,lead:bullion_leads(id,name,phone,address_house,address_locality,city,address_state,address_pincode,tags)")
      .eq("tenant_id", tenantId).eq("planned_date", date).order("created_at");
    if (error) setErr(error.message);
    setRows(data || []);
    const { data: up } = await sb.from("gift_deliveries").select("planned_date").eq("tenant_id", tenantId).eq("status", "planned").gte("planned_date", isoDate()).order("planned_date").limit(2000);
    const counts = new Map();
    (up || []).forEach((r) => counts.set(r.planned_date, (counts.get(r.planned_date) || 0) + 1));
    setUpcoming([...counts.entries()]);
    setLoading(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [date]);

  const groups = useMemo(() => groupByEmployee(rows), [rows]);

  async function patch(row, changes) {
    setErr("");
    const { error } = await sb.from("gift_deliveries").update({ ...changes, updated_at: new Date().toISOString() }).eq("id", row.id);
    if (error) { setErr(error.message); return; }
    if (changes.status === "delivered" && row.lead) onDelivered?.(row.lead);
    await load();
  }
  const setStatus = (row, status) => patch(row, { status, delivered_at: status === "delivered" ? new Date().toISOString() : null });
  const remove = async (row) => {
    if (!window.confirm(`Remove ${row.lead?.name || "this client"} from the schedule?`)) return;
    const { error } = await sb.from("gift_deliveries").delete().eq("id", row.id);
    if (error) setErr(error.message); else load();
  };
  const print = (list) => printHtml(buildDaySheetHtml(list, { date }), setErr);
  const open = rows.filter((r) => r.status === "planned").length;

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ ...card, maxWidth: 980 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>📅 Day sheets — who gives what to whom</h3>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "10px 0" }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inp} />
          <button style={ghost} onClick={() => setDate(isoDate())}>Today</button>
          <button style={ghost} onClick={() => setDate(tomorrowIso())}>Tomorrow</button>
          {upcoming.map(([d, n]) => <button key={d} onClick={() => setDate(d)} style={{ ...ghost, background: d === date ? "#8e44ad" : "#faf5ff", color: d === date ? "#fff" : "#6b21a8" }}>{new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} · {n}</button>)}
          <span style={{ marginLeft: "auto", fontSize: 12, color: "#666" }}>{rows.length} stops · {open} still to deliver</span>
          <button style={btn("#8e44ad", !rows.length)} disabled={!rows.length} onClick={() => print(groups)}>🖨 Print all employees</button>
        </div>
        {err && <p style={{ color: "#b91c1c", fontSize: 12 }}>{err}</p>}
        {loading && <p style={{ color: "#888" }}>Loading…</p>}
        {!loading && !rows.length && <p style={{ color: "#888", textAlign: "center", padding: 24 }}>Nothing is scheduled for this day. Tick clients on the Gifts list and use “📅 Schedule delivery”.</p>}

        {groups.map((g) => (
          <div key={g.employee} style={{ border: "1px solid #e5e7eb", borderRadius: 10, marginBottom: 12, overflow: "hidden" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", background: "#faf5ff", padding: "8px 12px", flexWrap: "wrap" }}>
              <b>{g.employee === UNASSIGNED ? "⚠ Not assigned to anyone" : `👤 ${g.employee}`}</b>
              <span style={{ fontSize: 12, color: "#666" }}>{g.stops.length} stops · Pack: {giftTotals(g.stops)}</span>
              <button style={{ ...ghost, marginLeft: "auto" }} onClick={() => print([g])}>🖨 Print this sheet</button>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <tbody>
                {g.stops.map((s, i) => (
                  <tr key={s.id} style={{ borderTop: "1px solid #f1f1f1", verticalAlign: "top", background: s.status === "delivered" ? "#f0fdf4" : "transparent" }}>
                    <td style={{ padding: "6px 8px", width: 24 }}>{i + 1}</td>
                    <td style={{ padding: "6px 8px", minWidth: 140 }}><b>{s.lead?.name || "—"}</b><br /><span style={{ color: "#666" }}>{s.lead?.phone}</span></td>
                    <td style={{ padding: "6px 8px", color: "#555", minWidth: 200 }}>{addressLine(s.lead || {}) || <em>no address</em>}</td>
                    <td style={{ padding: "6px 8px" }}><b>{s.gift_item || "—"}</b></td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                      <select value={s.status} onChange={(e) => setStatus(s, e.target.value)} style={{ ...inp, padding: "3px 6px" }}>
                        {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <select value={s.assigned_to || ""} onChange={(e) => patch(s, { assigned_to: e.target.value || null })} style={{ ...inp, padding: "3px 6px", maxWidth: 120 }} title="Reassign">
                        <option value="">unassigned</option>
                        {staff.map((n) => <option key={n}>{n}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "6px 8px" }}><input type="date" value={s.planned_date} onChange={(e) => e.target.value && patch(s, { planned_date: e.target.value })} style={{ ...inp, padding: "3px 6px" }} title="Move to another day" /></td>
                    <td style={{ padding: "6px 8px" }}><button onClick={() => remove(s)} style={{ border: "none", background: "none", color: "#c0392b", cursor: "pointer", fontSize: 16 }} title="Remove">×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
