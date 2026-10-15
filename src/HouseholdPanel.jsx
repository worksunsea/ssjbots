import { useMemo, useState } from "react";
import { suggestHouseholds } from "./households";
import { addressLine } from "./giftFilter";

// Suggested households: people who share an address (or are spouses) but have
// their own phone numbers. Staff confirm each link; "Not a household" hides a
// suggestion on this browser.

const LS_DISMISSED = "household_dismissed";
const read = () => { try { return new Set(JSON.parse(localStorage.getItem(LS_DISMISSED) || "[]")); } catch { return new Set(); } };
const write = (s) => { try { localStorage.setItem(LS_DISMISSED, JSON.stringify([...s])); } catch { /* not persisted */ } };
const signature = (g) => [...g.ids].sort().join(",");

const ghost = { padding: "4px 10px", fontSize: 12, border: "1px solid #ddd", borderRadius: 7, background: "#fff", cursor: "pointer" };

export default function HouseholdPanel({ contacts, onLink, onClose }) {
  const [dismissed, setDismissed] = useState(read);
  const [busy, setBusy] = useState("");
  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const groups = useMemo(() => suggestHouseholds(contacts).filter((g) => !dismissed.has(signature(g))), [contacts, dismissed]);

  const hide = (g) => { const next = new Set(dismissed).add(signature(g)); write(next); setDismissed(next); };
  const link = async (g) => { setBusy(signature(g)); await onLink(g.ids, g.existingHouseholdId); setBusy(""); };

  return (
    <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: 12, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b style={{ fontSize: 14 }}>🏠 Suggested households ({groups.length})</b>
        <button style={ghost} onClick={onClose}>Close</button>
      </div>
      <p style={{ fontSize: 12, color: "#555", margin: "4px 0 8px" }}>People who live at the same address or are linked as spouses, but have their own contact details. Linking keeps every record separate — the Gifts print list can then show one stop per household.</p>
      {groups.length === 0 && <p style={{ fontSize: 13, color: "#888" }}>No new suggestions in the contacts currently loaded.</p>}
      <div style={{ maxHeight: 360, overflowY: "auto" }}>
        {groups.slice(0, 80).map((g) => (
          <div key={signature(g)} style={{ background: "#fff", border: "1px solid #e0f2fe", borderRadius: 8, padding: 8, marginBottom: 6, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 240, fontSize: 12.5 }}>
              {g.ids.map((id) => { const c = byId.get(id); return <div key={id}><b>{c.name || "—"}</b> · {c.phone}</div>; })}
              <div style={{ color: "#777", marginTop: 2 }}>{addressLine(byId.get(g.ids[0])) || "no address"} · <i>{g.reasons.join(", ")}</i></div>
            </div>
            <button disabled={busy === signature(g)} onClick={() => link(g)} style={{ ...ghost, background: "#0284c7", color: "#fff", border: "none" }}>{g.existingHouseholdId ? "Add to household" : "🏠 Link as household"}</button>
            <button onClick={() => hide(g)} style={ghost}>Not a household</button>
          </div>
        ))}
        {groups.length > 80 && <p style={{ fontSize: 12, color: "#888" }}>Showing the first 80 — link these and the rest will follow.</p>}
      </div>
    </div>
  );
}
