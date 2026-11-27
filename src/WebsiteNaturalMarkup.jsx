import React, { useEffect, useState } from "react";
import WebsiteStones from "./WebsiteStones.jsx";

// Superadmin control for the ssj.in natural-diamonds page: how many discount points we
// add on top of the supplier's discount (sell disc = supplier disc - markup). Saving
// re-prices every live natural stone straight away with today's USD/INR and Rapaport.
export default function WebsiteNaturalMarkup({ crmSecret }) {
  const [value, setValue] = useState("");
  const [usd, setUsd] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [showStones, setShowStones] = useState(false);
  const headers = { "Content-Type": "application/json", "x-crm-secret": crmSecret };

  useEffect(() => {
    fetch("/api/cvd-sync?action=settings", { headers })
      .then((r) => r.json())
      .then((d) => { if (d.ok) { setValue(String(d.markup_disc)); setUsd(d.usd_inr); } })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/cvd-sync?action=settings", { method: "POST", headers, body: JSON.stringify({ markup_disc: Number(value) }) });
      const d = await r.json();
      setMsg(d.ok ? `Saved. ${d.repriced?.changed ?? 0} of ${d.repriced?.stones ?? 0} natural stones re-priced.` : `Failed: ${d.error}`);
    } catch (e) { setMsg(`Failed: ${e.message}`); }
    setBusy(false);
  }

  return (
    <div style={{ fontSize: 12, color: "#888", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      Website natural diamonds: sell {" "}
      <input style={{ width: 60, padding: "4px 6px" }} type="number" step="0.5" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Website markup in discount points" />
      {" "}pts below supplier discount{usd ? ` (USD/INR ${usd})` : ""}
      <button type="button" disabled={busy || value === ""} onClick={save} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", background: "#f8f8f8", cursor: "pointer" }}>{busy ? "Saving..." : "Save & re-price"}</button>
      <button type="button" onClick={() => setShowStones(true)} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", background: "#f8f8f8", cursor: "pointer" }}>View website stones (cost & margin)</button>
      {msg && <span>{msg}</span>}
      {showStones && <WebsiteStones crmSecret={crmSecret} onClose={() => setShowStones(false)} />}
    </div>
  );
}
