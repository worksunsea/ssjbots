import { useState, useEffect, useMemo, useCallback } from "react";
import { applyGiftFilters, editTags, giftCsv, addressLine, hasCompleteAddress, DEFAULT_SENT_TAG, DEFAULT_PICK_TAG } from "./giftFilter";
import { DEFAULT_ZONES, groupByZone, buildTrips, buildRoutePrintHtml, parsePincodes } from "./giftZones";

// 🎁 Gifts — pick who gets a festival gift. Filter the client database, see the
// list, edit tags right on the page (one contact or many at once), mark gifts
// sent, export the address list. All state lives in bullion_leads.tags, so the
// rest of the CRM (Contacts, Broadcasts, DB) sees the same tags.

const PAGE_SIZE = 100;
const FETCH_PAGE = 1000;
const FETCH_CAP = 10000;
const LS_SENT = "gift_sent_tag";
const LS_PICK = "gift_pick_tag";

const readLs = (k, fallback) => { try { return localStorage.getItem(k) || fallback; } catch { return fallback; } };
const writeLs = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked — setting just won't persist */ } };

const box = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 };
const inp = { fontSize: 13, border: "1px solid #ddd", borderRadius: 6, padding: "5px 9px" };
const pill = (on, color = "#3b82f6") => ({ fontSize: 11, padding: "3px 9px", borderRadius: 12, cursor: "pointer", border: `1px solid ${on ? color : "#ddd"}`, background: on ? color : "#f3f4f6", color: on ? "#fff" : "#333" });
const actionBtn = (bg, disabled) => ({ fontSize: 12, padding: "5px 12px", borderRadius: 7, border: "none", background: disabled ? "#cbd5e1" : bg, color: "#fff", cursor: disabled ? "default" : "pointer", fontWeight: 600 });

/** Search + multi-toggle tag chooser; typing a new name offers to create it. */
function TagPicker({ label, allTags, selected, onToggle, onCreate, color = "#3b82f6", width = 260 }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const names = useMemo(() => allTags.map((t) => t.name), [allTags]);
  const shown = names.filter((n) => n.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 60);
  const canCreate = onCreate && q.trim() && !names.some((n) => n.toLowerCase() === q.trim().toLowerCase());
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button onClick={() => setOpen((o) => !o)} style={{ ...pill(selected.length > 0, color), padding: "4px 11px", fontSize: 12 }}>
        {label}{selected.length ? ` (${selected.length})` : ""} ▾
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 41, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,.15)", padding: 8, width }}>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or type a new tag…" style={{ ...inp, width: "100%", boxSizing: "border-box", marginBottom: 6 }}
              onKeyDown={(e) => { if (e.key === "Enter" && canCreate) { onCreate(q.trim()); setQ(""); } }} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 220, overflowY: "auto" }}>
              {shown.map((n) => <button key={n} onClick={() => onToggle(n)} style={pill(selected.includes(n), color)}>{selected.includes(n) ? "✓ " : ""}{n}</button>)}
              {shown.length === 0 && !canCreate && <span style={{ fontSize: 12, color: "#999" }}>No tags</span>}
            </div>
            {canCreate && <button onClick={() => { onCreate(q.trim()); setQ(""); }} style={{ ...actionBtn("#16a34a"), marginTop: 6, width: "100%" }}>＋ Create "{q.trim()}"</button>}
            <button onClick={() => setOpen(false)} style={{ ...pill(false), marginTop: 6, width: "100%" }}>Done</button>
          </div>
        </>
      )}
    </span>
  );
}

export default function GiftList({ sb, tenantId }) {
  const [registry, setRegistry] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(0);
  const [sentTag, setSentTag] = useState(() => readLs(LS_SENT, DEFAULT_SENT_TAG));
  const [pickTag, setPickTag] = useState(() => readLs(LS_PICK, DEFAULT_PICK_TAG));

  const [search, setSearch] = useState("");
  const [includeTags, setIncludeTags] = useState([]);
  const [matchAll, setMatchAll] = useState(true);
  const [excludeTags, setExcludeTags] = useState([]);
  const [city, setCity] = useState("");
  const [pincodePrefix, setPincodePrefix] = useState("");
  const [minRating, setMinRating] = useState("");
  const [clientsOnly, setClientsOnly] = useState(false);
  const [address, setAddress] = useState("any");
  const [gift, setGift] = useState("any");
  const [hideDnd, setHideDnd] = useState(false);

  const [bulkAdd, setBulkAdd] = useState([]);
  const [bulkRemove, setBulkRemove] = useState([]);

  // Area-wise printing
  const [zones, setZones] = useState(DEFAULT_ZONES);
  const [showPrint, setShowPrint] = useState(false);
  const [pickedZones, setPickedZones] = useState(null); // null = all
  const [tripSize, setTripSize] = useState(25);
  const [skipIncomplete, setSkipIncomplete] = useState(true);
  const [editZones, setEditZones] = useState(null); // draft [{name, text}] while editing

  useEffect(() => {
    sb.from("bullion_dropdowns").select("value").eq("tenant_id", tenantId).eq("field", "gift_zones").maybeSingle()
      .then(({ data }) => {
        try {
          const parsed = data?.value ? JSON.parse(data.value) : null;
          if (Array.isArray(parsed) && parsed.length) setZones(parsed);
        } catch { /* bad saved value — keep the starter zones */ }
      });
  }, [sb, tenantId]);

  async function saveZones(draft) {
    const next = draft.map((z) => ({ name: z.name.trim(), pincodes: parsePincodes(z.text) })).filter((z) => z.name);
    const value = JSON.stringify(next);
    const { data: ex } = await sb.from("bullion_dropdowns").select("id").eq("tenant_id", tenantId).eq("field", "gift_zones").maybeSingle();
    const { error: err } = ex?.id
      ? await sb.from("bullion_dropdowns").update({ value, active: true }).eq("id", ex.id)
      : await sb.from("bullion_dropdowns").insert({ tenant_id: tenantId, field: "gift_zones", value, active: true, sort_order: 0 });
    if (err) { setError(`Could not save zones: ${err.message}`); return; }
    setZones(next); setPickedZones(null); setEditZones(null);
  }

  const loadRegistry = useCallback(async () => {
    const { data } = await sb.from("bullion_tags").select("name,category,color").eq("tenant_id", tenantId).order("sort_order");
    setRegistry(data || []);
  }, [sb, tenantId]);
  useEffect(() => { loadRegistry(); }, [loadRegistry]);

  // Server-side part of the filters; the rest (exclude, address, gift status…) runs in the browser.
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const term = search.trim().replace(/[,()%]/g, " ");
    const rows = [];
    let hitCap = false;
    try {
      for (let from = 0; ; from += FETCH_PAGE) {
        let q = sb.from("bullion_leads")
          .select("id,name,phone,city,tags,source,client_rating,is_client,dnd,address_house,address_locality,address_state,address_pincode,address_zone,household_id")
          .eq("tenant_id", tenantId).is("deleted_at", null)
          .order("name", { ascending: true, nullsFirst: false })
          .range(from, from + FETCH_PAGE - 1);
        if (term) q = q.or(`name.ilike.%${term}%,phone.ilike.%${term}%,city.ilike.%${term}%,email.ilike.%${term}%`);
        if (includeTags.length) q = matchAll ? q.contains("tags", includeTags) : q.overlaps("tags", includeTags);
        if (city.trim()) q = q.ilike("city", `%${city.trim()}%`);
        if (minRating) q = q.gte("client_rating", Number(minRating));
        if (clientsOnly) q = q.eq("is_client", true);
        const { data, error: err } = await q;
        if (err) throw err;
        rows.push(...(data || []));
        if ((data || []).length < FETCH_PAGE) break;
        if (rows.length >= FETCH_CAP) { hitCap = true; break; }
      }
      setContacts(rows); setTruncated(hitCap);
    } catch (e) {
      setError(e.message || "Could not load contacts");
    }
    setLoading(false);
  }, [sb, tenantId, search, includeTags, matchAll, city, minRating, clientsOnly]);

  useEffect(() => {
    const t = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const visible = useMemo(
    () => applyGiftFilters(contacts, { excludeTags, pincodePrefix, address, gift, sentTag, hideDnd }),
    [contacts, excludeTags, pincodePrefix, address, gift, sentTag, hideDnd],
  );
  useEffect(() => { setPage(0); setSelected(new Set()); }, [visible.length, search, includeTags, excludeTags, address, gift]);

  // Registry tags plus any tag that exists on loaded contacts but was never registered.
  const allTags = useMemo(() => {
    const known = new Map(registry.map((t) => [t.name, t]));
    contacts.forEach((c) => (c.tags || []).forEach((t) => { if (!known.has(t)) known.set(t, { name: t, category: "custom", color: "#e5e7eb" }); }));
    [sentTag, pickTag].forEach((t) => { if (t && !known.has(t)) known.set(t, { name: t, category: "custom", color: "#fde68a" }); });
    return [...known.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [registry, contacts, sentTag, pickTag]);
  const tagColor = (n) => allTags.find((t) => t.name === n)?.color || "#e5e7eb";

  async function ensureTag(name) {
    if (registry.some((t) => t.name === name)) return;
    const sortOrder = (registry.reduce((m, t) => Math.max(m, t.sort_order || 0), 0)) + 10;
    const { error: err } = await sb.from("bullion_tags").insert({ tenant_id: tenantId, name, category: "custom", color: "#fde68a", sort_order: sortOrder });
    if (err) { setError(`Could not create tag "${name}": ${err.message}`); return; }
    setRegistry((r) => [...r, { name, category: "custom", color: "#fde68a", sort_order: sortOrder }]);
  }

  async function saveTags(contact, nextTags) {
    const before = contact.tags || [];
    setContacts((l) => l.map((c) => (c.id === contact.id ? { ...c, tags: nextTags } : c)));
    const { error: err } = await sb.from("bullion_leads").update({ tags: nextTags }).eq("id", contact.id);
    if (err) {
      setContacts((l) => l.map((c) => (c.id === contact.id ? { ...c, tags: before } : c)));
      setError(`Could not save tags for ${contact.name || contact.phone}: ${err.message}`);
    }
  }

  async function bulkEdit(edit, what) {
    const targets = contacts.filter((c) => selected.has(c.id));
    if (!targets.length) return;
    if (!window.confirm(`${what} for ${targets.length} contact${targets.length > 1 ? "s" : ""}?`)) return;
    setBusy(what); setError("");
    for (const tag of edit.add || []) await ensureTag(tag);
    const failed = [];
    for (let i = 0; i < targets.length; i += 20) {
      const chunk = targets.slice(i, i + 20);
      const results = await Promise.all(chunk.map(async (c) => {
        const next = editTags(c.tags, edit);
        const { error: err } = await sb.from("bullion_leads").update({ tags: next }).eq("id", c.id);
        return err ? { c } : { c, next };
      }));
      const done = new Map(results.filter((r) => r.next).map((r) => [r.c.id, r.next]));
      failed.push(...results.filter((r) => !r.next).map((r) => r.c));
      setContacts((l) => l.map((c) => (done.has(c.id) ? { ...c, tags: done.get(c.id) } : c)));
    }
    if (failed.length) setError(`${failed.length} contact(s) could not be updated — try again.`);
    else { setBulkAdd([]); setBulkRemove([]); }
    setBusy("");
  }

  function exportCsv() {
    const rows = selected.size ? visible.filter((c) => selected.has(c.id)) : visible;
    const url = URL.createObjectURL(new Blob([giftCsv(rows, sentTag)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `gift-list-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // Rows going on the area-wise sheets: the ticked rows if any, else everything the filters show.
  const printScope = useMemo(() => {
    const base = selected.size ? visible.filter((c) => selected.has(c.id)) : visible;
    return skipIncomplete ? base.filter(hasCompleteAddress) : base;
  }, [visible, selected, skipIncomplete]);
  const zoneGroups = useMemo(() => groupByZone(printScope, zones), [printScope, zones]);
  const chosenGroups = zoneGroups.filter((g) => !pickedZones || pickedZones.includes(g.zone));
  const chosenCount = chosenGroups.reduce((n, g) => n + g.rows.length, 0);

  function printRoutes() {
    const trips = buildTrips(chosenGroups, tripSize);
    const win = window.open("", "_blank");
    if (!win) { setError("Your browser blocked the print window — allow pop-ups for this site and try again."); return; }
    win.document.open();
    win.document.write(buildRoutePrintHtml(trips, { title: "Gift delivery list" }));
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }

  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageRows = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const allOnPage = pageRows.length > 0 && pageRows.every((c) => selected.has(c.id));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const togglePage = () => setSelected((s) => { const n = new Set(s); pageRows.forEach((c) => (allOnPage ? n.delete(c.id) : n.add(c.id))); return n; });
  const flip = (list, setList) => (name) => setList(list.includes(name) ? list.filter((t) => t !== name) : [...list, name]);
  const stats = useMemo(() => ({
    complete: visible.filter(hasCompleteAddress).length,
    sent: visible.filter((c) => (c.tags || []).includes(sentTag)).length,
  }), [visible, sentTag]);
  const clearFilters = () => { setSearch(""); setIncludeTags([]); setExcludeTags([]); setCity(""); setPincodePrefix(""); setMinRating(""); setClientsOnly(false); setAddress("any"); setGift("any"); setHideDnd(false); };

  return (
    <div>
      {/* Filters */}
      <div style={{ ...box, marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name / phone / city / email…" style={{ ...inp, flex: "1 1 220px" }} />
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" style={{ ...inp, width: 100 }} />
          <input value={pincodePrefix} onChange={(e) => setPincodePrefix(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="Pincode starts" style={{ ...inp, width: 110 }} />
          <select value={minRating} onChange={(e) => setMinRating(e.target.value)} style={inp}>
            <option value="">Any rating</option>
            {[5, 4, 3, 2].map((r) => <option key={r} value={r}>{"★".repeat(r)} and above</option>)}
          </select>
          <select value={address} onChange={(e) => setAddress(e.target.value)} style={inp}>
            <option value="any">Address: any</option>
            <option value="complete">Address complete</option>
            <option value="incomplete">Address missing / incomplete</option>
          </select>
          <select value={gift} onChange={(e) => setGift(e.target.value)} style={inp}>
            <option value="any">Gift: any</option>
            <option value="unsent">Gift not sent yet</option>
            <option value="sent">Gift sent</option>
          </select>
          <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={clientsOnly} onChange={(e) => setClientsOnly(e.target.checked)} /> Clients only</label>
          <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={hideDnd} onChange={(e) => setHideDnd(e.target.checked)} /> Hide DND</label>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          <TagPicker label="Must have tags" allTags={allTags} selected={includeTags} onToggle={flip(includeTags, setIncludeTags)} />
          <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center" }}>
            <select value={matchAll ? "all" : "any"} onChange={(e) => setMatchAll(e.target.value === "all")} style={{ ...inp, padding: "3px 6px" }}>
              <option value="all">match ALL</option><option value="any">match ANY</option>
            </select>
          </label>
          <TagPicker label="Without tags" allTags={allTags} selected={excludeTags} onToggle={flip(excludeTags, setExcludeTags)} color="#dc2626" />
          {includeTags.map((t) => <span key={t} style={{ ...pill(true), cursor: "pointer" }} onClick={() => flip(includeTags, setIncludeTags)(t)}>{t} ×</span>)}
          {excludeTags.map((t) => <span key={t} style={{ ...pill(true, "#dc2626"), cursor: "pointer" }} onClick={() => flip(excludeTags, setExcludeTags)(t)}>not {t} ×</span>)}
          <button onClick={clearFilters} style={{ ...pill(false), marginLeft: "auto" }}>✕ Clear filters</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8, fontSize: 11, color: "#666" }}>
          Gift tags — list:
          <select value={pickTag} onChange={(e) => { setPickTag(e.target.value); writeLs(LS_PICK, e.target.value); }} style={{ ...inp, padding: "2px 6px", fontSize: 11 }}>
            {allTags.map((t) => <option key={t.name}>{t.name}</option>)}
          </select>
          sent:
          <select value={sentTag} onChange={(e) => { setSentTag(e.target.value); writeLs(LS_SENT, e.target.value); }} style={{ ...inp, padding: "2px 6px", fontSize: 11 }}>
            {allTags.map((t) => <option key={t.name}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {/* Summary + actions */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <b style={{ fontSize: 14 }}>{loading ? "Loading…" : `${visible.length.toLocaleString()} contacts`}</b>
        <span style={{ fontSize: 12, color: "#16a34a" }}>📦 {stats.complete} with full address</span>
        <span style={{ fontSize: 12, color: "#b45309" }}>⚠ {visible.length - stats.complete} need address</span>
        <span style={{ fontSize: 12, color: "#2563eb" }}>🎁 {stats.sent} sent</span>
        <span style={{ fontSize: 12, color: "#888" }}>{selected.size} selected</span>
        {truncated && <span style={{ fontSize: 12, color: "#dc2626" }}>Showing the first {FETCH_CAP.toLocaleString()} — narrow the filters.</span>}
        <button onClick={() => setShowPrint((v) => !v)} style={{ ...actionBtn("#8e44ad"), marginLeft: "auto" }}>🖨 Print by area</button>
        <button onClick={exportCsv} style={actionBtn("#16a34a")}>⬇ Export {selected.size ? `${selected.size} selected` : "list"} (CSV)</button>
      </div>

      {/* Area-wise delivery sheets */}
      {showPrint && (
        <div style={{ ...box, background: "#faf5ff", border: "1px solid #e9d5ff", marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <b style={{ fontSize: 14 }}>🖨 Delivery sheets by area</b>
            <button onClick={() => setShowPrint(false)} style={pill(false)}>Close</button>
          </div>
          <p style={{ fontSize: 12, color: "#666", margin: "4px 0 8px" }}>
            Uses {selected.size ? `the ${selected.size} ticked clients` : `all ${visible.length} clients in the current filters`}. Each sheet lists name, phone and address, ordered by pincode then area, with a tick box and remarks column.
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            <button onClick={() => setPickedZones(null)} style={pill(!pickedZones, "#8e44ad")}>All areas ({printScope.length})</button>
            {zoneGroups.map((g) => {
              const on = !pickedZones || pickedZones.includes(g.zone);
              return (
                <button key={g.zone} style={pill(on && !!pickedZones, "#8e44ad")}
                  onClick={() => setPickedZones((cur) => {
                    const base = cur || [];
                    return base.includes(g.zone) ? base.filter((z) => z !== g.zone) : [...base, g.zone];
                  })}>
                  {g.zone} ({g.rows.length})
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
            <label>Stops per trip <input type="number" min={5} max={100} value={tripSize} onChange={(e) => setTripSize(Number(e.target.value) || 25)} style={{ ...inp, width: 64 }} /></label>
            <label style={{ display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={skipIncomplete} onChange={(e) => setSkipIncomplete(e.target.checked)} /> Skip clients with incomplete address</label>
            <button disabled={!chosenCount} onClick={printRoutes} style={actionBtn("#8e44ad", !chosenCount)}>Print {chosenCount} stops</button>
            <button onClick={() => setEditZones(zones.map((z) => ({ name: z.name, text: z.pincodes.join(", ") })))} style={pill(false)}>✎ Edit areas &amp; pincodes</button>
          </div>
          {editZones && (
            <div style={{ marginTop: 10, borderTop: "1px solid #e9d5ff", paddingTop: 8 }}>
              <p style={{ fontSize: 12, color: "#666", margin: "0 0 6px" }}>One line per area: a name and its 6-digit pincodes. Clients whose pincode is in no area appear as “Other / not in a zone”. Saved for everyone.</p>
              {editZones.map((z, i) => (
                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "flex-start" }}>
                  <input value={z.name} onChange={(e) => setEditZones((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} style={{ ...inp, width: 170 }} />
                  <textarea value={z.text} rows={2} onChange={(e) => setEditZones((l) => l.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} style={{ ...inp, flex: 1, fontFamily: "inherit" }} />
                  <button onClick={() => setEditZones((l) => l.filter((_, j) => j !== i))} style={{ ...pill(false), color: "#c0392b" }}>×</button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setEditZones((l) => [...l, { name: "", text: "" }])} style={pill(false)}>+ Add area</button>
                <button onClick={() => saveZones(editZones)} style={actionBtn("#16a34a")}>Save areas</button>
                <button onClick={() => setEditZones(null)} style={pill(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
      {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 8, padding: "6px 10px", fontSize: 12, marginBottom: 8 }}>{error}</div>}

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div style={{ ...box, background: "#eff6ff", border: "1px solid #bfdbfe", marginBottom: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <b style={{ fontSize: 13, color: "#1d4ed8" }}>{selected.size} selected</b>
          {selected.size < visible.length && <button onClick={() => setSelected(new Set(visible.map((c) => c.id)))} style={pill(false)}>Select all {visible.length}</button>}
          <button onClick={() => setSelected(new Set())} style={pill(false)}>Clear</button>
          <span style={{ borderLeft: "1px solid #bfdbfe", height: 20 }} />
          <button disabled={!!busy} onClick={() => bulkEdit({ add: [pickTag] }, `Add to gift list ("${pickTag}")`)} style={actionBtn("#8e44ad", !!busy)}>＋ Add to gift list</button>
          <button disabled={!!busy} onClick={() => bulkEdit({ add: [sentTag] }, `Mark gift sent ("${sentTag}")`)} style={actionBtn("#2563eb", !!busy)}>🎁 Mark sent</button>
          <button disabled={!!busy} onClick={() => bulkEdit({ remove: [sentTag] }, `Unmark gift sent`)} style={actionBtn("#64748b", !!busy)}>↩ Unmark sent</button>
          <span style={{ borderLeft: "1px solid #bfdbfe", height: 20 }} />
          <TagPicker label="Add tags" allTags={allTags} selected={bulkAdd} onToggle={flip(bulkAdd, setBulkAdd)} onCreate={(n) => { ensureTag(n); setBulkAdd((l) => [...l, n]); }} color="#16a34a" />
          <button disabled={!bulkAdd.length || !!busy} onClick={() => bulkEdit({ add: bulkAdd }, `Add ${bulkAdd.length} tag(s)`)} style={actionBtn("#16a34a", !bulkAdd.length || !!busy)}>Apply</button>
          <TagPicker label="Remove tags" allTags={allTags} selected={bulkRemove} onToggle={flip(bulkRemove, setBulkRemove)} color="#e67e22" />
          <button disabled={!bulkRemove.length || !!busy} onClick={() => bulkEdit({ remove: bulkRemove }, `Remove ${bulkRemove.length} tag(s)`)} style={actionBtn("#e67e22", !bulkRemove.length || !!busy)}>Remove</button>
          {busy && <span style={{ fontSize: 12, color: "#666" }}>Working…</span>}
        </div>
      )}

      {/* List */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
              <th style={{ padding: "8px 10px", width: 30 }}><input type="checkbox" checked={allOnPage} onChange={togglePage} /></th>
              {["Client", "Address", "Tags", "Gift"].map((h) => <th key={h} style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((c) => {
              const tags = c.tags || [];
              const isSent = tags.includes(sentTag);
              return (
                <tr key={c.id} style={{ borderBottom: "1px solid #f3f4f6", background: selected.has(c.id) ? "#eff6ff" : "transparent", verticalAlign: "top" }}>
                  <td style={{ padding: "7px 10px" }}><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                  <td style={{ padding: "7px 10px", minWidth: 150 }}>
                    <div style={{ fontWeight: 600 }}>{c.name || <em style={{ color: "#aaa" }}>no name</em>}{c.dnd ? " 🚫" : ""}</div>
                    <div style={{ fontSize: 12, color: "#666" }}>{c.phone}</div>
                  </td>
                  <td style={{ padding: "7px 10px", minWidth: 190, fontSize: 12, color: hasCompleteAddress(c) ? "#333" : "#b45309" }}>
                    {addressLine(c) || <em>no address</em>}
                    {!hasCompleteAddress(c) && <div style={{ fontSize: 11 }}>⚠ needs street, city &amp; 6-digit pincode</div>}
                  </td>
                  <td style={{ padding: "7px 10px", minWidth: 220 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center" }}>
                      {tags.map((t) => (
                        <span key={t} onClick={() => saveTags(c, editTags(tags, { remove: [t] }))} title="Click to remove"
                          style={{ fontSize: 11, padding: "2px 7px", borderRadius: 10, background: tagColor(t), cursor: "pointer", whiteSpace: "nowrap" }}>{t} ×</span>
                      ))}
                      <TagPicker label="＋" allTags={allTags} selected={tags} width={240}
                        onToggle={(n) => saveTags(c, tags.includes(n) ? editTags(tags, { remove: [n] }) : editTags(tags, { add: [n] }))}
                        onCreate={async (n) => { await ensureTag(n); saveTags(c, editTags(tags, { add: [n] })); }} />
                    </div>
                  </td>
                  <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>
                    <button onClick={() => saveTags(c, isSent ? editTags(tags, { remove: [sentTag] }) : editTags(tags, { add: [sentTag] }))}
                      style={{ ...pill(isSent, "#2563eb"), fontWeight: 600 }}>{isSent ? "🎁 Sent" : "Mark sent"}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && visible.length === 0 && <div style={{ padding: 32, textAlign: "center", color: "#888" }}>No contacts match these filters.</div>}
      </div>

      {pages > 1 && (
        <div style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center", marginTop: 12 }}>
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} style={pill(false)}>← Prev</button>
          <span style={{ fontSize: 12 }}>Page {page + 1} of {pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} style={pill(false)}>Next →</button>
        </div>
      )}
    </div>
  );
}
