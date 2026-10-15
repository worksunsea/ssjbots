import { useEffect, useMemo, useState } from "react";
import postal from "../tools/data/postal.json";
import { zoneFor, normalizePincode } from "../api/_lib/addressParse";
import { pickBestAddress } from "./households";

// Merge several duplicate contacts into one in a single go, fixing the address
// on the same screen. The merge itself still follows the existing rule: managers
// queue a request per duplicate, a superadmin approves (and when a superadmin
// runs this, each request is approved straight away).

const CRM_SECRET = (import.meta.env.VITE_CRM_SECRET || "").trim();
const COLUMNS = "id,name,phone,mobile2,email,city,address_house,address_locality,address_state,address_pincode,address_zone,source,tags,created_at,extra_fields";
const ADDRESS_FIELDS = [
  ["address_house", "House / street"], ["address_locality", "Area"], ["city", "City"], ["address_state", "State"], ["address_pincode", "Pincode"],
];
const MANAGER_PLUS = ["superadmin", "admin", "manager"];

const filled = (c) => Object.values(c).filter((v) => (Array.isArray(v) ? v.length : String(v ?? "").trim())).length;
const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "24px 12px" };
const inp = { width: "100%", fontSize: 13, padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6, boxSizing: "border-box" };
const btn = (bg, off) => ({ padding: "9px 16px", fontSize: 14, fontWeight: 600, border: "none", borderRadius: 8, color: "#fff", background: off ? "#cbd5e1" : bg, cursor: off ? "default" : "pointer" });

async function post(body) {
  const res = await fetch("/api/demand-outcome", { method: "POST", headers: { "Content-Type": "application/json", "x-crm-secret": CRM_SECRET }, body: JSON.stringify(body) });
  return res.json().catch(() => ({ ok: false, error: "bad response" }));
}

export default function MultiMerge({ sb, ids, user, onClose, onDone }) {
  const [leads, setLeads] = useState(null);
  const [primaryId, setPrimaryId] = useState("");
  const [addr, setAddr] = useState({});
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const canMerge = MANAGER_PLUS.includes(user?.role);
  const isSuper = user?.role === "superadmin";

  useEffect(() => {
    sb.from("bullion_leads").select(COLUMNS).in("id", ids).then(({ data, error }) => {
      if (error || !data?.length) { setErr(error?.message || "Could not load these contacts"); return; }
      const best = [...data].sort((a, b) => filled(b) - filled(a) || String(a.created_at).localeCompare(String(b.created_at)))[0];
      setLeads(data); setPrimaryId(best.id);
      setAddr(Object.fromEntries(ADDRESS_FIELDS.map(([k]) => [k, pickBestAddress(data)[k] || ""])));
    });
  }, [sb, ids]);

  const primary = leads?.find((l) => l.id === primaryId);
  const others = useMemo(() => (leads || []).filter((l) => l.id !== primaryId), [leads, primaryId]);
  const useAddressOf = (l) => setAddr(Object.fromEntries(ADDRESS_FIELDS.map(([k]) => [k, l[k] || ""])));

  async function run() {
    setBusy(true); setErr("");
    try {
      const pin = normalizePincode(addr.address_pincode) || String(addr.address_pincode || "").trim();
      const patch = { ...addr, address_pincode: pin };
      const zone = zoneFor(addr.city, postal[pin]?.district);
      if (zone) patch.address_zone = zone;
      const changed = ADDRESS_FIELDS.some(([k]) => String(patch[k] || "") !== String(primary[k] || ""));
      if (changed) {
        const { error } = await sb.from("bullion_leads").update({
          ...patch,
          extra_fields: { ...(primary.extra_fields || {}), address_edited_in_merge: { at: new Date().toISOString(), by: user?.name || null, previous: Object.fromEntries(ADDRESS_FIELDS.map(([k]) => [k, primary[k] ?? null])) } },
        }).eq("id", primary.id);
        if (error) throw new Error(`Address not saved: ${error.message}`);
      }
      let queued = 0; let merged = 0; const problems = [];
      for (const other of others) {
        const q = await post({ action: "merge", primaryLeadId: primary.id, secondaryLeadId: other.id, actor: user?.name, actorRole: user?.role });
        if (!q.ok) { problems.push(`${other.name || other.phone}: ${q.error}`); continue; }
        queued += 1;
        if (isSuper) {
          const a = await post({ action: "approve-merge", requestId: q.requestId, actor: user?.name, actorRole: user?.role });
          if (a.ok) merged += 1; else problems.push(`${other.name || other.phone}: ${a.error}`);
        }
      }
      setResult({ queued, merged, problems, addressChanged: changed });
      onDone?.();
    } catch (e) { setErr(e.message || "Merge failed"); }
    setBusy(false);
  }

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 18, width: "100%", maxWidth: 760 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>🔗 Merge {ids.length} contacts into one</h3>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer" }}>×</button>
        </div>
        {!canMerge && <p style={{ color: "#b91c1c", fontSize: 13 }}>Only managers and admins can merge contacts.</p>}
        {!leads && !err && <p style={{ color: "#888" }}>Loading…</p>}
        {err && <p style={{ color: "#b91c1c", fontSize: 13 }}>{err}</p>}

        {leads && !result && (
          <>
            <p style={{ fontSize: 12, color: "#666", margin: "8px 0" }}>Pick the record to keep. Everything (messages, demands, calls, Kitty) from the others moves onto it, and their phone numbers stay searchable. Different values are never thrown away — they are saved on the kept contact for you to check.</p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead><tr style={{ background: "#f9fafb", textAlign: "left" }}>{["Keep", "Name", "Phone", "Email", "Address", ""].map((h) => <th key={h} style={{ padding: "6px 8px" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.id} style={{ borderTop: "1px solid #eee", background: l.id === primaryId ? "#f0fdf4" : "transparent", verticalAlign: "top" }}>
                      <td style={{ padding: "6px 8px" }}><input type="radio" name="keep" checked={l.id === primaryId} onChange={() => setPrimaryId(l.id)} /></td>
                      <td style={{ padding: "6px 8px", fontWeight: 600 }}>{l.name || "(no name)"}</td>
                      <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{l.phone}{l.mobile2 ? <div style={{ color: "#888" }}>{l.mobile2}</div> : null}</td>
                      <td style={{ padding: "6px 8px" }}>{l.email || "—"}</td>
                      <td style={{ padding: "6px 8px", color: "#555" }}>{[l.address_house, l.address_locality, l.city, l.address_pincode].filter(Boolean).join(", ") || "—"}</td>
                      <td style={{ padding: "6px 8px" }}><button onClick={() => useAddressOf(l)} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer", whiteSpace: "nowrap" }}>use this address</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h4 style={{ margin: "14px 0 6px", fontSize: 14 }}>Address for the merged contact</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
              {ADDRESS_FIELDS.map(([k, label]) => (
                <label key={k} style={{ fontSize: 11, color: "#666" }}>{label}
                  <input style={inp} value={addr[k] || ""} onChange={(e) => setAddr((a) => ({ ...a, [k]: e.target.value }))} />
                </label>
              ))}
            </div>

            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginTop: 14, background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "8px 10px" }}>
              <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} style={{ marginTop: 3 }} />
              <span>These are the <b>same person</b> (duplicates). Family members who just share a house should be linked as a household instead — not merged.</span>
            </label>
            <p style={{ fontSize: 12, color: "#666", margin: "8px 0 0" }}>
              {isSuper ? `You are a superadmin, so ${others.length} duplicate(s) will be merged immediately.` : `This sends ${others.length} merge request(s) to a superadmin to approve. Your address edit is saved now.`}
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button style={btn("#8e44ad", busy || !sure || !canMerge)} disabled={busy || !sure || !canMerge} onClick={run}>{busy ? "Working…" : `Merge ${others.length} into ${primary?.name || primary?.phone || "selected"}`}</button>
              <button style={{ ...btn("#fff"), color: "#333", border: "1px solid #ccc" }} onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {result && (
          <div style={{ padding: "16px 4px" }}>
            <p style={{ fontSize: 14 }}>
              {isSuper ? `✅ ${result.merged} contact(s) merged into ${primary?.name || primary?.phone}.` : `📝 ${result.queued} merge request(s) sent for approval.`}
              {result.addressChanged ? " Address updated." : ""}
            </p>
            {result.problems.length > 0 && <div style={{ color: "#b91c1c", fontSize: 12 }}>{result.problems.map((p) => <div key={p}>⚠ {p}</div>)}</div>}
            <button style={btn("#2980b9")} onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
