import React, { useEffect, useMemo, useState } from "react";

// Superadmin view of the stones on the website with OUR side of the numbers: supplier Rap, the discount we get,
// what we pay, the discount we sell at, the selling price and the margin. Same maths as the Calculator's solitaire
// tab: price/ct = Rap x (1 - disc/100) x USD/INR.
const usd = (n) => (n == null || !Number.isFinite(n) ? "-" : `$${Math.round(n).toLocaleString("en-US")}`);
const inr = (n) => (n == null || !Number.isFinite(n) ? "-" : `₹${Math.round(n).toLocaleString("en-IN")}`);
const pct = (n) => (n == null || !Number.isFinite(n) ? "-" : `${Number(n).toFixed(1)}%`);
const th = { padding: "6px 8px", fontSize: 11, color: "#666", position: "sticky", top: 0, background: "#f5f5f5", whiteSpace: "nowrap" };
const td = { padding: "5px 8px", textAlign: "right", fontSize: 12, whiteSpace: "nowrap", borderBottom: "1px solid #eee" };
const HEADS = ["Stone", "Shape", "Ct", "Col", "Clar", "Rap $/ct", "Buy disc", "Buy $/ct", "Buy $ total", "Buy ₹", "Sell disc", "Sell $/ct", "Sell ₹ (ex-GST)", "Margin ₹", "Margin %"];

export default function WebsiteStones({ crmSecret, onClose }) {
  const [type, setType] = useState("natural");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    setData(null); setErr("");
    fetch(`/api/cvd-sync?action=stones&type=${type}`, { headers: { "x-crm-secret": crmSecret } })
      .then((r) => r.json()).then((d) => (d.ok ? setData(d) : setErr(d.error || "failed"))).catch((e) => setErr(e.message));
  }, [type, crmSecret]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.stones || [])
      .filter((s) => !term || `${s.sku} ${s.stock_no} ${s.color} ${s.clarity} ${s.shape}`.toLowerCase().includes(term))
      .map((s) => {
        const ct = Number(s.carat), nat = s.stone_type === "natural";
        const buyUsdTotal = Number(s.purchase_usd);
        const rap = Number(s.rap_used_usd || s.rap_usd) || null;
        const sellDisc = Number(s.sell_disc_pct);
        const buyInr = Number(s.purchase_inr), sell = Number(s.price_inr);
        return {
          ...s, ct, nat, rap, buyDisc: Number(s.supplier_disc_pct), sellDisc, buyInr, sell, buyUsdTotal,
          buyUsdPerCt: buyUsdTotal / ct, margin: sell - buyInr, marginPct: buyInr ? ((sell - buyInr) / buyInr) * 100 : null,
          sellUsdPerCt: rap && Number.isFinite(sellDisc) ? rap * (1 - sellDisc / 100) : null,
        };
      });
  }, [data, q]);

  const tot = rows.reduce((a, r) => ({ buy: a.buy + (r.buyInr || 0), sell: a.sell + (r.sell || 0) }), { buy: 0, sell: 0 });
  const summary = data
    ? `${rows.length} stones · USD/INR ${data.usd_inr ?? "-"}${type === "natural" ? ` · markup ${data.markup_disc} pts` : ""} · buy ${inr(tot.buy)} → sell ${inr(tot.sell)} (margin ${inr(tot.sell - tot.buy)})`
    : err ? `Failed: ${err}` : "Loading...";

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 16, width: "100%", maxWidth: 1250, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <b style={{ fontSize: 15 }}>Website stones - cost, discount and margin</b>
          {["natural", "labgrown"].map((t) => (
            <button key={t} type="button" onClick={() => setType(t)} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #ccc", background: type === t ? "#222" : "#fff", color: type === t ? "#fff" : "#222", cursor: "pointer", fontSize: 12 }}>{t === "natural" ? "Natural" : "Lab-grown"}</button>
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stone / colour / clarity" style={{ padding: "4px 8px", fontSize: 12, minWidth: 190 }} />
          <span style={{ fontSize: 12, color: "#666" }}>{summary}</span>
          <button type="button" onClick={onClose} style={{ marginLeft: "auto", padding: "4px 12px", cursor: "pointer" }}>Close</button>
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>{HEADS.map((h, i) => <th key={h} style={{ ...th, textAlign: i < 5 ? "left" : "right" }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku}>
                  <td style={{ ...td, textAlign: "left" }}>{r.stock_no || r.sku}{r.status === "reserved" ? " (hold)" : ""}</td>
                  <td style={{ ...td, textAlign: "left" }}>{r.shape}</td>
                  <td style={td}>{r.ct.toFixed(2)}</td>
                  <td style={{ ...td, textAlign: "left" }}>{r.color || "fancy"}</td>
                  <td style={{ ...td, textAlign: "left" }}>{r.clarity}</td>
                  <td style={td}>{r.nat ? usd(r.rap) : "-"}</td>
                  <td style={td}>{r.nat ? pct(r.buyDisc) : "-"}</td>
                  <td style={td}>{usd(r.buyUsdPerCt)}</td>
                  <td style={td}>{usd(r.buyUsdTotal)}</td>
                  <td style={td}>{inr(r.buyInr)}</td>
                  <td style={td}>{r.nat ? pct(r.sellDisc) : "-"}</td>
                  <td style={td}>{r.nat ? usd(r.sellUsdPerCt) : "-"}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{inr(r.sell)}</td>
                  <td style={{ ...td, color: r.margin < 0 ? "#b00020" : "#1b7a1b" }}>{inr(r.margin)}</td>
                  <td style={td}>{pct(r.marginPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
