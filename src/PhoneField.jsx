import React, { useState, useEffect } from "react";
import { COUNTRY_CODES, DEFAULT_CC, split, join, validate, normalizePhone } from "./phoneIntl.js";

const OTHER = "other";
const box = { fontSize: 13, padding: 8, borderRadius: 8, border: "1px solid #ddd", background: "#fff" };

const toState = (stored) => {
  const { cc, national } = split(stored);
  const known = COUNTRY_CODES.some((c) => c.cc && c.cc === cc);
  return known ? { sel: cc, other: "", national } : { sel: OTHER, other: cc, national };
};

/**
 * Country-code dropdown (default +91) + national number.
 * `value` / `onChange` use the STORED format (see phoneIntl.js): Indian = 10 digits,
 * international = full digits with country code. Indian entry works exactly as before:
 * just type the 10 digits. Pasting "+971 50 123 4567" auto-switches the code.
 */
export default function PhoneField({ value, onChange, placeholder = "9876543210", style }) {
  const [st, setSt] = useState(() => toState(value));
  const cc = st.sel === OTHER ? st.other : st.sel;

  // Re-sync when the parent loads a different contact.
  useEffect(() => {
    if (String(value || "") !== join(cc, st.national)) setSt(toState(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const push = (next) => { setSt(next); onChange(join(next.sel === OTHER ? next.other : next.sel, next.national)); };

  const onNational = (raw) => {
    if (String(raw).trim().startsWith("+")) {
      const next = toState(normalizePhone(raw));
      if (next.national) return push(next);
    }
    let n = String(raw).replace(/\D/g, "");
    if (cc === DEFAULT_CC && n.length === 12 && n.startsWith("91")) n = n.slice(2);
    push({ ...st, national: n });
  };

  const err = st.national ? validate(cc, st.national) : "";
  return (
    <div style={style}>
      <div style={{ display: "flex", gap: 6 }}>
        <select value={st.sel} onChange={(e) => push({ ...st, sel: e.target.value })} aria-label="Country code" style={{ ...box, width: 112, flexShrink: 0 }}>
          {COUNTRY_CODES.map((c) => (
            <option key={c.cc || OTHER} value={c.cc || OTHER}>{c.cc ? `+${c.cc}` : "Other"}</option>
          ))}
        </select>
        {st.sel === OTHER && (
          <input value={st.other} inputMode="numeric" placeholder="Code" aria-label="Custom country code"
            onChange={(e) => push({ ...st, other: e.target.value.replace(/\D/g, "").slice(0, 3) })} style={{ ...box, width: 64, flexShrink: 0 }} />
        )}
        <input type="tel" value={st.national} onChange={(e) => onNational(e.target.value)} placeholder={placeholder} style={{ ...box, width: "100%", minWidth: 0 }} />
      </div>
      {err && <div style={{ fontSize: 11, color: "#b45309", marginTop: 3 }}>{err}</div>}
    </div>
  );
}
