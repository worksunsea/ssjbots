import React, { useEffect, useMemo, useState } from "react";

// Superadmin view of the stones on the website with OUR side of the numbers: supplier Rap, the discount we get,
// what we pay, the discount we sell at, the selling price and the margin. Same maths as the Calculator's solitaire
// tab: price/ct = Rap x (1 - disc/100) x USD/INR.
const usd = (n) => (n == null || !Number.isFinite(n) ? "-" : `$${Math.round(n).toLocaleString("en-US")}`);
const inr = (n) => (n == null || !Number.isFinite(n) ? "-" : `₹${Math.round(n).toLocaleString("en-IN")}`);
const pct = (n) => (n == null || !Number.isFinite(n) ? "-" : `${Number(n).toFixed(1)}%`);
const th = { padding: "6px 8px", fontSize: 11, color: "#666", position: "sticky", top: 0, background: "#f5f5f5", whiteSpace: "nowrap" };
const td = { padding: "5px 8px", textAlign: "right", fontSize: 12, whiteSpace: "nowrap", borderBottom: "1px solid #eee" };
const HEADS = ["", "Stone", "Shape", "Ct", "Col", "Clar", "Rap $/ct", "Buy disc", "Buy $/ct", "Buy $ total", "Buy ₹", "Sell disc", "Sell $/ct", "Sell ₹ (ex-GST)", "Margin ₹", "Margin %"];

export default function WebsiteStones({ crmSecret, onClose }) {
  const [type, setType] = useState("natural");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [view, setView] = useState("stones");
  const [chosen, setChosen] = useState(() => new Set());
  const [form, setForm] = useState({ name: "", phone: "", max: 2, note: "" });
  const [made, setMade] = useState(null);
  const [sels, setSels] = useState(null);
  const [busy, setBusy] = useState(false);
  const hdr = { "Content-Type": "application/json", "x-crm-secret": crmSecret };

  useEffect(() => {
    setData(null); setErr("");
    fetch(`/api/cvd-sync?action=stones&type=${type}`, { headers: { "x-crm-secret": crmSecret } })
      .then((r) => r.json()).then((d) => (d.ok ? setData(d) : setErr(d.error || "failed"))).catch((e) => setErr(e.message));
  }, [type, crmSecret]);

  const loadSels = () => fetch("/api/stone-selection?action=list", { headers: hdr }).then((r) => r.json()).then((d) => setSels(d.ok ? d.selections : [])).catch(() => setSels([]));
  useEffect(() => { if (view === "selections") loadSels(); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (sku) => setChosen((c) => { const n = new Set(c); if (n.has(sku)) n.delete(sku); else n.add(sku); return n; });
  async function create() {
    setBusy(true);
    try {
      const r = await fetch("/api/stone-selection", { method: "POST", headers: hdr, body: JSON.stringify({ action: "create", client_name: form.name, client_phone: form.phone, note: form.note, max_picks: Number(form.max), skus: [...chosen] }) });
      const d = await r.json();
      setMade(d.ok ? { ...d, name: form.name, phone: form.phone } : { error: d.error });
      if (d.ok) setChosen(new Set());
    } catch (e) { setMade({ error: e.message }); }
    setBusy(false);
  }
  async function change(action, id) {
    if (action === "delete" && !window.confirm("Delete this selection link?")) return;
    await fetch("/api/stone-selection", { method: "POST", headers: hdr, body: JSON.stringify({ action, id }) });
    loadSels();
  }
  const waLink = (name, phone, url) => {
    const digits = String(phone || "").replace(/[^0-9]/g, "");
    const num = digits.length === 10 ? `91${digits}` : digits;
    return `https://wa.me/${num}?text=${encodeURIComponent(`Hi ${name}, please view your personal diamond selection and choose your pieces: ${url}`)}`;
  };

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
          {["stones", "selections"].map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #ccc", background: view === v ? "#7a5200" : "#fff", color: view === v ? "#fff" : "#222", cursor: "pointer", fontSize: 12 }}>{v === "stones" ? "Stones" : "Client selections"}</button>
          ))}
          <span style={{ fontSize: 12, color: "#666" }}>{summary}</span>
          <button type="button" onClick={onClose} style={{ marginLeft: "auto", padding: "4px 12px", cursor: "pointer" }}>Close</button>
        </div>
        {view === "stones" && chosen.size > 0 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: 8, marginBottom: 8, background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, fontSize: 12 }}>
            <b>{chosen.size} selected</b>
            <input placeholder="Client name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ padding: "4px 8px", width: 150 }} />
            <input placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={{ padding: "4px 8px", width: 130 }} />
            <label>Client picks <input type="number" min="1" max={chosen.size} value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} style={{ width: 48, padding: "4px 6px" }} /> pcs</label>
            <input placeholder="Note to client (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={{ padding: "4px 8px", width: 200 }} />
            <button type="button" disabled={busy || !form.name.trim()} onClick={create} style={{ padding: "4px 12px", cursor: "pointer" }}>{busy ? "Creating..." : "Create client link"}</button>
            <button type="button" onClick={() => setChosen(new Set())} style={{ padding: "4px 10px", cursor: "pointer" }}>Clear</button>
          </div>
        )}
        {made && (
          <div style={{ padding: 8, marginBottom: 8, background: made.error ? "#fdecea" : "#e8f5e9", borderRadius: 8, fontSize: 12, wordBreak: "break-all" }}>
            {made.error ? `Failed: ${made.error}` : (
              <>Link for <b>{made.name}</b>: <a href={made.url} target="_blank" rel="noreferrer">{made.url}</a>{" "}
                <button type="button" onClick={() => navigator.clipboard?.writeText(made.url)} style={{ padding: "2px 8px", cursor: "pointer" }}>Copy</button>{" "}
                <a href={waLink(made.name, made.phone, made.url)} target="_blank" rel="noreferrer">Send on WhatsApp</a></>
            )}
            <button type="button" onClick={() => setMade(null)} style={{ marginLeft: 8, cursor: "pointer" }}>x</button>
          </div>
        )}
        {view === "selections" && (
          <div style={{ overflow: "auto", flex: 1, fontSize: 12 }}>
            {sels === null ? "Loading..." : sels.length === 0 ? "No client selections yet. Tick stones on the Stones view and create a client link." : sels.map((x) => (
              <div key={x.id} style={{ padding: "8px 4px", borderBottom: "1px solid #eee" }}>
                <b>{x.client_name}</b>{x.google_email ? ` (${x.google_name || ""} ${x.google_email})` : " (not signed in yet)"} · {x.status === "finalised" ? <span style={{ color: "#1b7a1b", fontWeight: 600 }}>FINALISED {new Date(x.finalised_at).toLocaleString("en-IN")}</span> : <span>open</span>} · picks {x.picked_skus.length}/{x.max_picks} · {x.skus.length} offered · viewed {x.view_count}x{x.last_viewed_at ? ` (last ${new Date(x.last_viewed_at).toLocaleString("en-IN")})` : ""}
                <div>Picked: {x.picked_skus.length ? x.picked_skus.join(", ") : "-"}</div>
                <div style={{ color: "#666" }}>Offered: {x.skus.join(", ")}</div>
                <a href={x.url} target="_blank" rel="noreferrer">Open link</a>{" · "}
                <a href={waLink(x.client_name, x.client_phone, x.url)} target="_blank" rel="noreferrer">WhatsApp</a>{" · "}
                <button type="button" onClick={() => navigator.clipboard?.writeText(x.url)} style={{ cursor: "pointer" }}>Copy link</button>
                {x.status === "finalised" && <>{" · "}<button type="button" onClick={() => change("reopen", x.id)} style={{ cursor: "pointer" }}>Reopen</button></>}
                {x.google_email && <>{" · "}<button type="button" onClick={() => change("unlink", x.id)} style={{ cursor: "pointer" }}>Unlink Google</button></>}{" · "}<button type="button" onClick={() => change("delete", x.id)} style={{ cursor: "pointer", color: "#b00020" }}>Delete</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ overflow: "auto", flex: 1, display: view === "stones" ? "block" : "none" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>{HEADS.map((h, i) => <th key={h || "sel"} style={{ ...th, textAlign: i < 6 ? "left" : "right" }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku}>
                  <td style={td}><input type="checkbox" aria-label={`Select ${r.stock_no || r.sku}`} checked={chosen.has(r.sku)} onChange={() => toggle(r.sku)} /></td>
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
