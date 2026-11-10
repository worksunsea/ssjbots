import { useState, useEffect, useMemo } from "react";
import { allColumns, PRESETS, buildTable, toCsv, toPrintHtml } from "./contactExport";

// 🖨 Export / Print — pick tags (everyone with them is ticked), untick people,
// choose columns, then print or download CSV. Reads bullion_leads only.

const FETCH_PAGE = 1000;
const FETCH_CAP = 10000;
const LS_COLS = "contacts_export_cols";
const DEFAULT_KEYS = ["name", "phone", "address"];

const readLs = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const writeLs = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked — choice just won't persist */ } };

const btn = (bg, disabled) => ({ fontSize: 12, padding: "6px 14px", borderRadius: 7, border: "none", background: disabled ? "#cbd5e1" : bg, color: "#fff", cursor: disabled ? "default" : "pointer", fontWeight: 600 });
const chip = (on, color = "#3b82f6") => ({ fontSize: 11, padding: "3px 9px", borderRadius: 12, cursor: "pointer", border: `1px solid ${on ? color : "#ddd"}`, background: on ? color : "#f3f4f6", color: on ? "#fff" : "#333" });

export default function ContactsExport({ sb, tenantId, initialTags = [], initialLogic = "OR", onClose }) {
  const [tagNames, setTagNames] = useState([]);
  const [customFields, setCustomFields] = useState([]);
  const [tags, setTags] = useState(initialTags);
  const [logic, setLogic] = useState(initialLogic);
  const [contacts, setContacts] = useState([]);
  const [ticked, setTicked] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [keys, setKeys] = useState(() => readLs(LS_COLS) || DEFAULT_KEYS);
  const [tick, setTick] = useState(false);
  const [sign, setSign] = useState(false);
  const [tagSearch, setTagSearch] = useState("");

  const columns = useMemo(() => allColumns(customFields), [customFields]);

  useEffect(() => {
    (async () => {
      const [t, d] = await Promise.all([
        sb.from("bullion_tags").select("name,category").eq("tenant_id", tenantId).order("sort_order"),
        sb.from("bullion_dropdowns").select("value").eq("tenant_id", tenantId).eq("field", "contact_custom_fields").maybeSingle(),
      ]);
      setTagNames((t.data || []).filter((x) => x.category !== "source").map((x) => x.name));
      try { setCustomFields(JSON.parse(d.data?.value || "[]")); } catch { setCustomFields([]); }
    })();
  }, [sb, tenantId]);

  // Load everyone with the chosen tags (past the 200-per-page limit) and tick them all.
  useEffect(() => {
    if (!tags.length) { setContacts([]); setTicked(new Set()); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setError("");
      const all = [];
      for (let from = 0; from < FETCH_CAP; from += FETCH_PAGE) {
        let q = sb.from("bullion_leads").select("*").eq("tenant_id", tenantId).is("deleted_at", null)
          .order("name", { ascending: true, nullsFirst: false }).range(from, from + FETCH_PAGE - 1);
        q = logic === "AND" ? q.contains("tags", tags) : q.overlaps("tags", tags);
        const { data, error: err } = await q;
        if (cancelled) return;
        if (err) { setError("Could not load contacts — try again."); break; }
        all.push(...(data || []));
        if ((data || []).length < FETCH_PAGE) break;
      }
      if (cancelled) return;
      setContacts(all); setTicked(new Set(all.map((c) => c.id))); setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sb, tenantId, tags, logic]);

  const chosen = contacts.filter((c) => ticked.has(c.id));
  const toggleTag = (n) => setTags((l) => (l.includes(n) ? l.filter((x) => x !== n) : [...l, n]));
  const toggleKey = (k) => setKeys((l) => { const n = l.includes(k) ? l.filter((x) => x !== k) : [...l, k]; writeLs(LS_COLS, n); return n; });
  const setPreset = (p) => { const n = p.keys.filter((k) => columns.some((c) => c.key === k)); setKeys(n); writeLs(LS_COLS, n); };
  const toggleOne = (id) => setTicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const table = () => buildTable(chosen, columns, keys, { tick, sign });
  const title = tags.length ? tags.join(" + ") : "Contacts";

  function doPrint() {
    const win = window.open("", "_blank");
    if (!win) { setError("Pop-up blocked — allow pop-ups for this site and press Print again."); return; }
    win.document.write(toPrintHtml(title, table())); win.document.close();
  }
  function doCsv() {
    const url = URL.createObjectURL(new Blob([toCsv(table())], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const shownTags = tagNames.filter((n) => n.toLowerCase().includes(tagSearch.trim().toLowerCase()));
  const canOutput = chosen.length > 0 && keys.length > 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div style={{ background: "#fff", borderRadius: 12, width: "min(900px,100%)", maxHeight: "92vh", overflowY: "auto", padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <b style={{ fontSize: 16 }}>🖨 Export / Print contacts</b>
          <button onClick={onClose} style={{ marginLeft: "auto", border: "none", background: "none", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>1. Who — pick tag(s)</div>
        <input value={tagSearch} onChange={(e) => setTagSearch(e.target.value)} placeholder="Search tags…" style={{ fontSize: 12, border: "1px solid #ddd", borderRadius: 6, padding: "4px 8px", marginBottom: 6 }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, maxHeight: 90, overflowY: "auto", marginBottom: 6 }}>
          {shownTags.map((n) => <button key={n} onClick={() => toggleTag(n)} style={chip(tags.includes(n), "#8e44ad")}>{tags.includes(n) ? "✓ " : ""}{n}</button>)}
        </div>
        {tags.length > 1 && (
          <button onClick={() => setLogic((l) => (l === "AND" ? "OR" : "AND"))} style={{ ...chip(true, "#8e44ad"), marginBottom: 6 }}>
            {logic === "AND" ? "Must have ALL tags" : "Has ANY tag"} (tap to switch)
          </button>
        )}

        <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0" }}>
          <span style={{ fontSize: 12, color: "#555" }}>{loading ? "Loading…" : `${chosen.length} of ${contacts.length} ticked`}</span>
          <button onClick={() => setTicked(new Set(contacts.map((c) => c.id)))} style={chip(false)}>Tick all</button>
          <button onClick={() => setTicked(new Set())} style={chip(false)}>Untick all</button>
        </div>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, maxHeight: 200, overflowY: "auto", marginBottom: 12 }}>
          {!tags.length && <div style={{ padding: 12, fontSize: 12, color: "#999" }}>Pick a tag above to load its contacts.</div>}
          {contacts.map((c) => (
            <label key={c.id} style={{ display: "flex", gap: 8, padding: "4px 10px", fontSize: 12, borderBottom: "1px solid #f3f3f3", cursor: "pointer" }}>
              <input type="checkbox" checked={ticked.has(c.id)} onChange={() => toggleOne(c.id)} />
              <span style={{ fontWeight: 500 }}>{c.name || "(no name)"}</span><span style={{ color: "#888" }}>{c.phone}</span>
            </label>
          ))}
        </div>

        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>2. Columns</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
          {PRESETS.map((p) => <button key={p.label} onClick={() => setPreset(p)} style={chip(false)}>{p.label}</button>)}
          <button onClick={() => { const n = columns.map((c) => c.key); setKeys(n); writeLs(LS_COLS, n); }} style={chip(false)}>All</button>
          <button onClick={() => { setKeys([]); writeLs(LS_COLS, []); }} style={chip(false)}>None</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginBottom: 8 }}>
          {columns.map((c) => (
            <label key={c.key} style={{ fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={keys.includes(c.key)} onChange={() => toggleKey(c.key)} /> {c.label}
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: 14, marginBottom: 12 }}>
          <label style={{ fontSize: 12 }}><input type="checkbox" checked={tick} onChange={(e) => setTick(e.target.checked)} /> Add blank "Done" tick column</label>
          <label style={{ fontSize: 12 }}><input type="checkbox" checked={sign} onChange={(e) => setSign(e.target.checked)} /> Add blank "Signature" column</label>
        </div>

        {error && <div style={{ color: "#dc2626", fontSize: 12, marginBottom: 6 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button disabled={!canOutput} onClick={doPrint} style={btn("#8e44ad", !canOutput)}>🖨 Print</button>
          <button disabled={!canOutput} onClick={doCsv} style={btn("#16a34a", !canOutput)}>⬇ Download CSV (Excel)</button>
        </div>
      </div>
    </div>
  );
}
