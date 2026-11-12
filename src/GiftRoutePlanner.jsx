import { useEffect, useMemo, useState } from "react";
import { planDays, buildRoutePrintHtml } from "./giftZones";
import { buildDeliveryRows, tomorrowIso } from "./giftSchedule";

// 🗓 Plan the whole drive day by day: neighbouring houses share a day, one area per day,
// Sundays skipped. Optionally books every day in gift_deliveries (so Day sheets work) and
// prints all days in one go.

const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "24px 12px" };
const inp = { fontSize: 13, border: "1px solid #ddd", borderRadius: 6, padding: "6px 8px", boxSizing: "border-box", width: "100%" };
const btn = (bg, off) => ({ padding: "8px 14px", fontSize: 13, fontWeight: 600, border: "none", borderRadius: 8, color: "#fff", background: off ? "#cbd5e1" : bg, cursor: off ? "default" : "pointer" });
const fmtDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });

export default function GiftRoutePlanner({ sb, tenantId, user, groups, onClose, onDone }) {
  const [perDay, setPerDay] = useState(25);
  const [start, setStart] = useState(tomorrowIso());
  const [skipSundays, setSkipSundays] = useState(true);
  const [employee, setEmployee] = useState("");
  const [staff, setStaff] = useState([]);
  const [giftItem, setGiftItem] = useState("Diwali gift");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    sb.from("staff").select("name,type").eq("tenant_id", tenantId).neq("type", "artisan").order("name")
      .then(({ data }) => setStaff([...new Set((data || []).map((s) => s.name).filter(Boolean))]));
  }, [sb, tenantId]);

  const days = useMemo(() => planDays(groups, { perDay, startIso: start, skipSundays }), [groups, perDay, start, skipSundays]);
  const total = days.reduce((n, d) => n + d.rows.length, 0);
  const pins = (rows) => { const p = [...new Set(rows.map((r) => r.address_pincode).filter(Boolean))]; return p.length > 3 ? `${p[0]} … ${p[p.length - 1]}` : p.join(", "); };

  function print() {
    const trips = days.map((d, i) => ({ zone: d.zone, trip: d.day, trips: d.days, rows: d.rows, title: `Day ${i + 1} — ${d.zone} (${d.day}/${d.days})`, dateLabel: fmtDay(d.date) }));
    const win = window.open("", "_blank");
    if (!win) { setErr("Your browser blocked the print window — allow pop-ups for this site and try again."); return; }
    win.document.open(); win.document.write(buildRoutePrintHtml(trips, { title: "Gift delivery plan" })); win.document.close(); win.focus();
    setTimeout(() => win.print(), 300);
  }

  async function book() {
    setBusy(true); setErr("");
    const ids = days.flatMap((d) => d.rows.map((r) => r.id));
    const { data: ex } = await sb.from("gift_deliveries").select("lead_id").eq("tenant_id", tenantId).in("status", ["planned", "delivered"]).in("lead_id", ids);
    const booked = new Set((ex || []).map((r) => r.lead_id));
    const rows = days.flatMap((d) => buildDeliveryRows({ leads: d.rows, date: d.date, employee, giftItem, tenantId, createdBy: user?.name, alreadyBooked: booked }).rows);
    if (!rows.length) { setErr("Everyone here already has a delivery planned or done."); setBusy(false); return; }
    const { error } = await sb.from("gift_deliveries").insert(rows);
    if (error) { setErr(error.message); setBusy(false); return; }
    onDone(rows.length, days.length);
  }

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 18, width: "100%", maxWidth: 720 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>🗓 Plan routes by day — {total} stops</h3>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer" }}>×</button>
        </div>
        <p style={{ fontSize: 12, color: "#666", margin: "6px 0 10px" }}>Houses close to each other (same pincode, then same colony) share a day. One area per day. Change the numbers and the plan below updates.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
          <label style={{ fontSize: 11, color: "#666" }}>First day<input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={inp} /></label>
          <label style={{ fontSize: 11, color: "#666" }}>Stops per day<input type="number" min={5} max={100} value={perDay} onChange={(e) => setPerDay(Number(e.target.value) || 25)} style={inp} /></label>
          <label style={{ fontSize: 11, color: "#666" }}>Employee
            <select value={employee} onChange={(e) => setEmployee(e.target.value)} style={inp}><option value="">— assign later —</option>{staff.map((n) => <option key={n}>{n}</option>)}</select></label>
          <label style={{ fontSize: 11, color: "#666" }}>Gift<input value={giftItem} onChange={(e) => setGiftItem(e.target.value)} style={inp} /></label>
        </div>
        <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", margin: "8px 0" }}><input type="checkbox" checked={skipSundays} onChange={(e) => setSkipSundays(e.target.checked)} /> Skip Sundays</label>
        <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid #eee", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ background: "#f9fafb", textAlign: "left" }}><th style={{ padding: 6 }}>Day</th><th style={{ padding: 6 }}>Date</th><th style={{ padding: 6 }}>Area</th><th style={{ padding: 6 }}>Pincodes</th><th style={{ padding: 6 }}>Stops</th></tr></thead>
            <tbody>{days.map((d, i) => (
              <tr key={i} style={{ borderTop: "1px solid #f1f1f1" }}><td style={{ padding: 6 }}>{i + 1}</td><td style={{ padding: 6 }}>{fmtDay(d.date)}</td><td style={{ padding: 6 }}>{d.zone} {d.days > 1 ? `(${d.day}/${d.days})` : ""}</td><td style={{ padding: 6 }}>{pins(d.rows)}</td><td style={{ padding: 6 }}>{d.rows.length}</td></tr>
            ))}</tbody>
          </table>
          {!days.length && <div style={{ padding: 16, color: "#888", textAlign: "center" }}>No clients with a usable address in the current list.</div>}
        </div>
        {err && <div style={{ color: "#b91c1c", fontSize: 12, marginTop: 8 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button disabled={!days.length} onClick={print} style={btn("#8e44ad", !days.length)}>🖨 Print all {days.length} days</button>
          <button disabled={!days.length || busy} onClick={book} style={btn("#16a34a", !days.length || busy)}>{busy ? "Booking…" : `📅 Book all ${days.length} days`}</button>
          <button onClick={onClose} style={{ ...btn("#64748b"), marginLeft: "auto" }}>Close</button>
        </div>
      </div>
    </div>
  );
}
