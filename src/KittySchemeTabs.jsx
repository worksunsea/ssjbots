// Per-scheme admin views — Gullak, Swarn Suraksha (and any other gram-based
// kitty scheme) each get their own self-contained tab: own member list, own
// total-grams-per-member, own with-company/with-client split — plus a
// cross-scheme Gold Tally tab so all schemes can be consolidated and
// checked against physical stock on a daily basis. Mission 100 has its own
// richer admin (groups/leaderboard, not a flat member list) in
// src/Mission100Admin.jsx — not duplicated here.

import { useState, useEffect, useCallback } from "react";

const API = "/api/kitty";

async function call(action, { method = "GET", body, crmSecret, params } = {}) {
  const qs = new URLSearchParams({ action, ...(params || {}) }).toString();
  const res = await fetch(`${API}?${qs}`, {
    method, cache: "no-store",
    headers: { "Content-Type": "application/json", "x-crm-secret": crmSecret },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

// Same grams-derivation formula used everywhere in this codebase — settled
// (paid/free) installments only, grams = paid_amount / rate_locked.
function gramsFor(installments, possessionFilter) {
  const settled = (installments || []).filter((i) => (i.status === "paid" || i.status === "free") && (!possessionFilter || (i.possession || "with_company") === possessionFilter));
  return settled.reduce((sum, i) => (i.rate_locked ? sum + Number(i.paid_amount ?? i.amount ?? 0) / Number(i.rate_locked) : sum), 0);
}

// One self-contained member-list view for a single gram-based scheme,
// identified by slug — reused for Gullak and Swarn Suraksha (structurally
// identical: enrollments + installments + grams + possession split).
export function SchemeMembersTab({ crmSecret, schemeSlug, actor }) {
  const [scheme, setScheme] = useState(null);
  const [enrollments, setEnrollments] = useState(null);
  const [selected, setSelected] = useState([]); // up to 2 enrollment ids, for merge

  const load = useCallback(async () => {
    const s = await call("admin-list-schemes", { crmSecret });
    const found = (s.ok ? s.schemes : []).find((sc) => sc.slug === schemeSlug);
    setScheme(found || null);
    if (!found) { setEnrollments([]); return; }
    const e = await call("admin-list-enrollments", { crmSecret, params: { schemeId: found.id } });
    setEnrollments(e.ok ? e.enrollments : []);
  }, [crmSecret, schemeSlug]);

  useEffect(() => { load(); }, [load]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id]; // keep it to the last 2 clicked
      return [...prev, id];
    });
  };

  const mergeSelected = async (rows) => {
    if (selected.length !== 2) return;
    const [a, b] = selected.map((id) => rows.find((r) => r.e.id === id));
    if (!a || !b) return;
    // Default: keep whichever has more history (more grams), merge the other in.
    const [keep, merge] = a.total >= b.total ? [a, b] : [b, a];
    if (!confirm(`Merge "${merge.e.lead?.name || merge.e.id}" (${merge.total.toFixed(3)}g) into "${keep.e.lead?.name || keep.e.id}" (${keep.total.toFixed(3)}g)?\n\nAll of ${merge.e.lead?.name || "the merged member"}'s installment history moves onto ${keep.e.lead?.name || "the kept member"}. The merged-away enrollment is cancelled, not deleted.`)) return;
    const d = await call("merge-enrollments", { method: "POST", crmSecret, body: { keepEnrollmentId: keep.e.id, mergeEnrollmentId: merge.e.id, actor } });
    if (d.ok) { setSelected([]); load(); } else alert(d.error);
  };

  if (enrollments === null) return <div style={{ padding: 20 }}>Loading…</div>;
  if (!scheme) return <div style={{ padding: 20 }}>Scheme not found — has the seed migration run?</div>;

  const live = enrollments.filter((e) => ["active", "completed", "redeemed"].includes(e.status));
  const rows = live.map((e) => ({
    e,
    total: gramsFor(e.installments),
    withCompany: gramsFor(e.installments, "with_company"),
    withClient: gramsFor(e.installments, "with_client"),
  })).sort((a, b) => b.total - a.total);

  const totals = rows.reduce((acc, r) => ({ total: acc.total + r.total, withCompany: acc.withCompany + r.withCompany, withClient: acc.withClient + r.withClient }), { total: 0, withCompany: 0, withClient: 0 });

  return (
    <div style={{ padding: 20 }}>
      <h3 style={{ marginBottom: 4 }}>{scheme.name}</h3>
      <p style={{ color: "#666", fontSize: 13, maxWidth: 700, marginBottom: 16 }}>{scheme.description}</p>

      <div style={{ display: "flex", gap: 20, marginBottom: 16, fontSize: 13, alignItems: "center" }}>
        <div><b>{rows.length}</b> live members</div>
        <div><b>{totals.total.toFixed(3)} g</b> total held</div>
        <div style={{ color: "#92400e" }}>🏬 <b>{totals.withCompany.toFixed(3)} g</b> with company</div>
        <div style={{ color: "#065f46" }}>🤝 <b>{totals.withClient.toFixed(3)} g</b> with client</div>
        {selected.length === 2 && <button onClick={() => mergeSelected(rows)} style={{ fontWeight: 700 }}>Merge Selected Two →</button>}
      </div>
      {selected.length > 0 && selected.length < 2 && <p style={{ fontSize: 12, color: "#666" }}>Pick one more member to merge with.</p>}

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead><tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
          <th></th><th>Name</th><th>Phone</th><th>Status</th><th>Total g</th><th>🏬 With company</th><th>🤝 With client</th>
          {schemeSlug === "swarn-suraksha" && <th>Auto-debit</th>}
        </tr></thead>
        <tbody>
          {rows.map(({ e, total, withCompany, withClient }) => (
            <tr key={e.id} style={{ borderBottom: "1px solid #eee", background: selected.includes(e.id) ? "#fffaf0" : "transparent" }}>
              <td><input type="checkbox" checked={selected.includes(e.id)} onChange={() => toggleSelect(e.id)} /></td>
              <td>{e.lead?.name || "—"}</td><td>{e.lead?.phone || "—"}</td><td>{e.status}</td>
              <td>{total.toFixed(3)}</td><td>{withCompany.toFixed(3)}</td><td>{withClient.toFixed(3)}</td>
              {schemeSlug === "swarn-suraksha" && (
                <td>{e.razorpay_subscription_id ? `${e.swarn_frequency || "monthly"} — ₹${e.monthly_amount_override || "—"}` : "—"}{e.frozen_at ? " (frozen)" : ""}</td>
              )}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={schemeSlug === "swarn-suraksha" ? 8 : 7}>No live members yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// Cross-scheme consolidated gold tally — every gram-based kitty scheme,
// subtotaled, plus a grand total split by possession, for a daily physical
// stock reconciliation against what the system says should be with the
// company vs. already handed to clients.
export function GoldTallyTab({ crmSecret }) {
  const [schemes, setSchemes] = useState(null);
  const [enrollments, setEnrollments] = useState(null);

  const load = useCallback(async () => {
    const [s, e] = await Promise.all([
      call("admin-list-schemes", { crmSecret }),
      call("admin-list-enrollments", { crmSecret }),
    ]);
    setSchemes(s.ok ? s.schemes : []);
    setEnrollments(e.ok ? e.enrollments : []);
  }, [crmSecret]);

  useEffect(() => { load(); }, [load]);

  if (enrollments === null || schemes === null) return <div style={{ padding: 20 }}>Loading…</div>;

  const gramSchemes = schemes.filter((s) => s.perks?.unit === "grams" || s.perks?.redemption === "jewellery_or_raw_gold" || s.perks?.redemption === "sell_anytime_or_jewellery");
  const live = enrollments.filter((e) => ["active", "completed", "redeemed"].includes(e.status));

  const bySchemeName = new Map();
  for (const scheme of gramSchemes) bySchemeName.set(scheme.name, { total: 0, withCompany: 0, withClient: 0, members: 0 });
  for (const e of live) {
    const name = e.scheme?.name;
    if (!name || !bySchemeName.has(name)) continue;
    const rec = bySchemeName.get(name);
    rec.total += gramsFor(e.installments);
    rec.withCompany += gramsFor(e.installments, "with_company");
    rec.withClient += gramsFor(e.installments, "with_client");
    rec.members++;
  }

  const grand = [...bySchemeName.values()].reduce((acc, r) => ({ total: acc.total + r.total, withCompany: acc.withCompany + r.withCompany, withClient: acc.withClient + r.withClient, members: acc.members + r.members }), { total: 0, withCompany: 0, withClient: 0, members: 0 });

  return (
    <div style={{ padding: 20 }}>
      <h3 style={{ marginBottom: 4 }}>Gold Tally — Consolidated Across All Schemes</h3>
      <p style={{ color: "#666", fontSize: 13, marginBottom: 16 }}>Daily reconciliation view — total gold the system says is outstanding, split by whether it's still with the company (bought but not handed over) or already with the client.</p>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 16 }}>
        <thead><tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
          <th>Scheme</th><th>Members</th><th>Total g</th><th>🏬 With company</th><th>🤝 With client</th>
        </tr></thead>
        <tbody>
          {[...bySchemeName.entries()].map(([name, r]) => (
            <tr key={name} style={{ borderBottom: "1px solid #eee" }}>
              <td>{name}</td><td>{r.members}</td><td>{r.total.toFixed(3)}</td><td>{r.withCompany.toFixed(3)}</td><td>{r.withClient.toFixed(3)}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700, borderTop: "2px solid #333" }}>
            <td>TOTAL</td><td>{grand.members}</td><td>{grand.total.toFixed(3)}</td><td>{grand.withCompany.toFixed(3)}</td><td>{grand.withClient.toFixed(3)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
