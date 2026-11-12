import { useState, useEffect, useCallback } from "react";
import { secureImageUpload } from "./utils/imageUpload";
import { FIELD_DEFS, EXTRA_DEFS, buildLeadWrite, personProblems, inboxCounts } from "./inboxApply";

// 📥 Inbox — staff upload photos of handwritten forms from any phone. A scheduled
// Claude routine reads them (hourly) and saves a proposal here; a person reviews,
// edits and saves as final, which creates/updates the contacts. Table: doc_inbox.

const KINDS = [["vip_sheet", "VIP / gift sheet"], ["vendor_card", "Vendor card"], ["other", "Other document"]];
const box = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, marginBottom: 10 };
const inp = { fontSize: 13, border: "1px solid #ddd", borderRadius: 6, padding: "5px 8px", width: "100%", boxSizing: "border-box" };
const btn = (bg, disabled) => ({ fontSize: 12, padding: "6px 14px", borderRadius: 7, border: "none", background: disabled ? "#cbd5e1" : bg, color: "#fff", cursor: disabled ? "default" : "pointer", fontWeight: 600 });
const pill = (on) => ({ fontSize: 12, padding: "4px 11px", borderRadius: 14, cursor: "pointer", border: `1px solid ${on ? "#3b82f6" : "#ddd"}`, background: on ? "#3b82f6" : "#f3f4f6", color: on ? "#fff" : "#333" });

// Indian numbers are kept as 10 digits (same as the rest of the app); other lengths are kept as typed (international).
const cleanPhone = (v) => { const d = String(v || "").replace(/\D/g, "").replace(/^0+/, ""); return d.length === 12 && d.startsWith("91") ? d.slice(2) : d; };
const who = (u) => u?.name || u?.username || u?.email || "staff";

export default function DocInbox({ sb, tenantId, user }) {
  const [items, setItems] = useState([]);
  const [tab, setTab] = useState("proposed");
  const [openId, setOpenId] = useState(null);
  const [kind, setKind] = useState("vip_sheet");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error: err } = await sb.from("doc_inbox").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(150);
    if (err) setError(err.message); else setItems(data || []);
  }, [sb, tenantId]);
  useEffect(() => { load(); }, [load]);

  async function upload() {
    if (!files.length) return;
    setBusy("Uploading…"); setError(""); setMsg("");
    try {
      const urls = [];
      for (const f of files) urls.push((await secureImageUpload(f, sb, "doc-inbox", { maxDim: 2400, quality: 0.9, maxFileMB: 20 })).publicUrl);
      const { error: err } = await sb.from("doc_inbox").insert({ tenant_id: tenantId, kind, note: note.trim() || null, image_urls: urls, uploaded_by: who(user) });
      if (err) throw err;
      setFiles([]); setNote(""); setMsg("Uploaded. Claude reads new forms every hour; the result will appear under “To review”.");
      await load();
    } catch (e) { setError(e.message || "Upload failed"); }
    setBusy("");
  }

  const counts = inboxCounts(items);
  const shown = items.filter((i) => (tab === "done" ? ["final", "rejected"].includes(i.status) : i.status === tab));
  const open = items.find((i) => i.id === openId);

  return (
    <div>
      <div style={box}>
        <b style={{ fontSize: 14 }}>📥 Send a document to Claude</b>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...inp, width: "auto" }}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (e.g. Bhumi sheet, 5 Elements)" style={{ ...inp, flex: "1 1 200px", width: "auto" }} />
        </div>
        <input type="file" accept="image/*" multiple onChange={(e) => setFiles([...e.target.files])} />
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
          <button disabled={!files.length || !!busy} onClick={upload} style={btn("#16a34a", !files.length || !!busy)}>{busy || `Upload ${files.length || ""} photo${files.length === 1 ? "" : "s"}`}</button>
          {msg && <span style={{ fontSize: 12, color: "#166534" }}>{msg}</span>}
        </div>
      </div>
      {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 8, padding: "6px 10px", fontSize: 12, marginBottom: 8 }}>{error}</div>}

      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <button style={pill(tab === "proposed")} onClick={() => { setTab("proposed"); setOpenId(null); }}>To review ({counts.proposed})</button>
        <button style={pill(tab === "new")} onClick={() => { setTab("new"); setOpenId(null); }}>Waiting for Claude ({counts.new})</button>
        <button style={pill(tab === "done")} onClick={() => { setTab("done"); setOpenId(null); }}>Done ({counts.final + counts.rejected})</button>
        <button style={{ ...pill(false), marginLeft: "auto" }} onClick={load}>↻ Refresh</button>
      </div>

      {!open && shown.map((i) => (
        <div key={i.id} style={{ ...box, display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }} onClick={() => setOpenId(i.id)}>
          <img src={i.image_urls?.[0]} alt="" style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 6 }} />
          <div style={{ flex: 1, fontSize: 13 }}>
            <b>{KINDS.find((k) => k[0] === i.kind)?.[1] || i.kind}</b> · {i.image_urls?.length || 0} photo(s){i.note ? ` · ${i.note}` : ""}
            <div style={{ fontSize: 11, color: "#888" }}>{new Date(i.created_at).toLocaleString("en-IN")} · by {i.uploaded_by || "?"} · {i.status}{i.proposal?.people ? ` · ${i.proposal.people.length} people` : ""}</div>
          </div>
        </div>
      ))}
      {!open && shown.length === 0 && <div style={{ padding: 28, textAlign: "center", color: "#888" }}>Nothing here.</div>}

      {open && <Review key={open.id} sb={sb} tenantId={tenantId} item={open} user={user} onBack={() => setOpenId(null)} onChanged={async () => { setOpenId(null); await load(); }} />}
    </div>
  );
}

function Review({ sb, tenantId, item, user, onBack, onChanged }) {
  const readOnly = item.status !== "proposed";
  const [people, setPeople] = useState(() => structuredClone((readOnly ? item.final_data?.people : item.proposal?.people) || []));
  const [existing, setExisting] = useState({});
  const [zoom, setZoom] = useState(null);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState([]);

  useEffect(() => {
    const ids = [...new Set(people.map((p) => p.match_id).filter(Boolean))];
    if (!ids.length) return;
    sb.from("bullion_leads").select("*").in("id", ids).then(({ data }) => setExisting(Object.fromEntries((data || []).map((c) => [c.id, c]))));
  }, [sb]); // eslint-disable-line react-hooks/exhaustive-deps

  const setP = (i, fn) => setPeople((l) => l.map((p, j) => (j === i ? fn(p) : p)));
  const setField = (i, grp, k, v) => setP(i, (p) => ({ ...p, [grp]: { ...(p[grp] || {}), [k]: v } }));
  const problems = people.map((p) => personProblems(p, existing[p.match_id]));
  const blocked = problems.some((x) => x.length);

  async function saveFinal() {
    setSaving(true); setResults([]);
    const out = []; let failed = false;
    for (const p of people) {
      if (p.skip) { out.push(`${p.fields?.name || "?"}: skipped`); continue; }
      const fields = { ...p.fields, phone: cleanPhone(p.fields?.phone), mobile2: cleanPhone(p.fields?.mobile2), spouse_mobile: cleanPhone(p.fields?.spouse_mobile) };
      const w = buildLeadWrite({ ...p, fields }, existing[p.match_id], tenantId);
      const { error: err } = w.action === "update" ? await sb.from("bullion_leads").update(w.row).eq("id", w.id) : await sb.from("bullion_leads").insert(w.row);
      const label = fields.name || fields.phone;
      if (err) { failed = true; out.push(`${label}: FAILED — ${err.message}`); } else out.push(`${label}: ${w.action === "update" ? "updated" : "created"}`);
    }
    setResults(out);
    if (!failed) {
      await sb.from("doc_inbox").update({ status: "final", final_data: { people }, reviewed_by: who(user), reviewed_at: new Date().toISOString() }).eq("id", item.id);
      setTimeout(onChanged, 1200);
    }
    setSaving(false);
  }
  async function setStatus(status, extra = {}) {
    await sb.from("doc_inbox").update({ status, reviewed_by: who(user), reviewed_at: new Date().toISOString(), ...extra }).eq("id", item.id);
    onChanged();
  }

  return (
    <div>
      <button onClick={onBack} style={{ ...pill(false), marginBottom: 8 }}>← Back</button>
      <div style={{ ...box, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {item.image_urls?.map((u) => <img key={u} src={u} alt="" onClick={() => setZoom(u)} style={{ height: 90, borderRadius: 6, cursor: "zoom-in" }} />)}
        {item.note && <div style={{ fontSize: 12, color: "#555", width: "100%" }}>Note: {item.note}</div>}
        {item.proposal?.notes && <div style={{ fontSize: 12, color: "#92400e", width: "100%" }}>Claude: {item.proposal.notes}</div>}
      </div>
      {zoom && <div onClick={() => setZoom(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 2000, overflow: "auto" }}><img src={zoom} alt="" style={{ width: "100%", maxWidth: 1200, display: "block", margin: "0 auto" }} /></div>}

      {item.status === "new" && <div style={{ ...box, color: "#92400e", background: "#fffbeb" }}>Waiting for Claude’s next hourly read. Nothing to review yet.</div>}
      {people.map((p, i) => {
        const ex = existing[p.match_id];
        return (
          <div key={i} style={{ ...box, opacity: p.skip ? 0.5 : 1, borderColor: problems[i].length ? "#fca5a5" : "#e5e7eb" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
              <b style={{ fontSize: 13 }}>{p.fields?.name || "(no name)"}</b>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: p.match_id ? "#dbeafe" : "#dcfce7" }}>{p.match_id ? `Updates existing: ${ex?.name || p.match_label || p.match_id}` : "New contact"}</span>
              {!readOnly && <label style={{ fontSize: 12, marginLeft: "auto" }}><input type="checkbox" checked={!!p.skip} onChange={(e) => setP(i, (x) => ({ ...x, skip: e.target.checked }))} /> Skip</label>}
            </div>
            {(p.questions || []).map((q, k) => <div key={k} style={{ fontSize: 12, color: "#b45309", background: "#fffbeb", borderRadius: 6, padding: "3px 8px", marginBottom: 4 }}>❓ {q}</div>)}
            {problems[i].map((q, k) => <div key={k} style={{ fontSize: 12, color: "#b91c1c" }}>⚠ {q}</div>)}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 6 }}>
              {FIELD_DEFS.map(([k, l]) => (
                <label key={k} style={{ fontSize: 10, color: "#666" }}>{l}{ex && ex[k] && ex[k] !== p.fields?.[k] ? <span style={{ color: "#b45309" }}> (was: {String(ex[k]).slice(0, 24)})</span> : null}
                  <input disabled={readOnly} value={p.fields?.[k] ?? ""} onChange={(e) => setField(i, "fields", k, e.target.value)} style={inp} /></label>
              ))}
              {EXTRA_DEFS.map(([k, l]) => (
                <label key={k} style={{ fontSize: 10, color: "#666" }}>{l}
                  <input disabled={readOnly} value={p.extra?.[k] ?? ""} onChange={(e) => setField(i, "extra", k, e.target.value)} style={inp} /></label>
              ))}
              <label style={{ fontSize: 10, color: "#666" }}>Tags (comma separated)
                <input disabled={readOnly} value={(p.tags || []).join(", ")} onChange={(e) => setP(i, (x) => ({ ...x, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) }))} style={inp} /></label>
            </div>
          </div>
        );
      })}
      {results.length > 0 && <div style={{ ...box, fontSize: 12 }}>{results.map((r, i) => <div key={i} style={{ color: r.includes("FAILED") ? "#b91c1c" : "#166534" }}>{r}</div>)}</div>}
      {item.status === "proposed" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button disabled={blocked || saving} onClick={saveFinal} style={btn("#16a34a", blocked || saving)}>{saving ? "Saving…" : "✅ Save as final (update contacts)"}</button>
          <button disabled={saving} onClick={() => setStatus("new", { proposal: null })} style={btn("#d97706", saving)}>↩ Ask Claude to read again</button>
          <button disabled={saving} onClick={() => setStatus("rejected")} style={btn("#64748b", saving)}>Reject</button>
        </div>
      )}
      {readOnly && item.status !== "new" && <div style={{ fontSize: 12, color: "#666" }}>{item.status === "final" ? `Saved as final by ${item.reviewed_by || "?"}` : `Rejected by ${item.reviewed_by || "?"}`}</div>}
    </div>
  );
}
