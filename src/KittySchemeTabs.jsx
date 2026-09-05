// Cross-scheme Gold Tally — every gram-based kitty scheme's holdings
// consolidated in one place for daily physical-stock reconciliation.
// Per-scheme management (Gullak, Swarn Suraksha, Golden Sparkle) lives
// directly in KittyAdmin.jsx's EnrollmentsTab via its lockedSchemeSlug
// prop, not here — that reuses its full existing toolkit (confirm, mark
// paid, add/edit installment, redeem, cancel, merge, deliver coins)
// instead of a thinner parallel view.

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
