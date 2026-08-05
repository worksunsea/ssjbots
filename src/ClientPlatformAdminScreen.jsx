// Client Platform admin — staff view for everything the ssj.in client +
// associate platform feeds into: Clients, New Signups, Associates (approve
// applicants), Kitty Scheme interest, and Rate Subscribers/Alerts.
//
// Reads bullion_leads directly via the shared `sb` client (same pattern as
// ContactsDBScreen); associate approval goes through api/associates.js
// (staff-secret gated) since it also has to generate a referral code and
// insert into bullion_associates.

import { useState, useEffect, useCallback } from "react";

const SUB_TABS = [
  { k: "clients", l: "Clients" },
  { k: "signups", l: "New Signups" },
  { k: "associates", l: "Associates" },
  { k: "commissions", l: "Commissions" },
  { k: "kitty", l: "Kitty Interest" },
  { k: "rates", l: "Rate Subscribers & Alerts" },
];

export default function ClientPlatformAdminScreen({ sb, tenantId, crmSecret }) {
  const [tab, setTab] = useState("clients");

  return (
    <div style={{ padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>Client Platform</h2>
      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        {SUB_TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            padding: "7px 14px", borderRadius: 6, border: "1px solid #ddd", cursor: "pointer",
            background: tab === t.k ? "#111" : "#fff", color: tab === t.k ? "#fff" : "#111", fontSize: 12.5,
          }}>{t.l}</button>
        ))}
      </div>
      {tab === "clients" && <ClientsTab sb={sb} tenantId={tenantId} />}
      {tab === "signups" && <SignupsTab sb={sb} tenantId={tenantId} />}
      {tab === "associates" && <AssociatesTab crmSecret={crmSecret} />}
      {tab === "commissions" && <CommissionsTab sb={sb} tenantId={tenantId} crmSecret={crmSecret} />}
      {tab === "kitty" && <KittyTab sb={sb} tenantId={tenantId} />}
      {tab === "rates" && <RatesSubscribersTab sb={sb} tenantId={tenantId} />}
    </div>
  );
}

function LeadTable({ rows, loading, emptyText, extraCol }) {
  if (loading) return <div style={{ color: "#888", fontSize: 13 }}>Loading…</div>;
  if (!rows.length) return <div style={{ color: "#888", fontSize: 13 }}>{emptyText}</div>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
          <th style={{ padding: "6px 8px" }}>Name</th>
          <th style={{ padding: "6px 8px" }}>Phone</th>
          <th style={{ padding: "6px 8px" }}>Source</th>
          <th style={{ padding: "6px 8px" }}>Created</th>
          {extraCol && <th style={{ padding: "6px 8px" }}>{extraCol.label}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
            <td style={{ padding: "6px 8px" }}>{r.name || "—"}</td>
            <td style={{ padding: "6px 8px" }}>{r.phone}</td>
            <td style={{ padding: "6px 8px" }}>{r.source || "—"}</td>
            <td style={{ padding: "6px 8px" }}>{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</td>
            {extraCol && <td style={{ padding: "6px 8px" }}>{extraCol.render(r)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ClientsTab({ sb, tenantId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    sb.from("bullion_leads").select("id,name,phone,source,created_at")
      .eq("tenant_id", tenantId).eq("ever_bought", true)
      .order("created_at", { ascending: false }).limit(200)
      .then(({ data }) => { setRows(data || []); setLoading(false); });
  }, [sb, tenantId]);
  return <LeadTable rows={rows} loading={loading} emptyText="No clients marked ever_bought yet." />;
}

function SignupsTab({ sb, tenantId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    sb.from("bullion_leads").select("id,name,phone,source,created_at")
      .eq("tenant_id", tenantId)
      .in("source", ["ssj_website_login", "ssj_website_rate_subscribe", "associate_recruitment", "ssj_website_wa"])
      .order("created_at", { ascending: false }).limit(200)
      .then(({ data }) => { setRows(data || []); setLoading(false); });
  }, [sb, tenantId]);
  return <LeadTable rows={rows} loading={loading} emptyText="No website signups yet." />;
}

function KittyTab({ sb, tenantId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    sb.from("bullion_leads").select("id,name,phone,source,created_at")
      .eq("tenant_id", tenantId).eq("extra_fields->>kitty_interest", "true")
      .order("created_at", { ascending: false }).limit(200)
      .then(({ data }) => { setRows(data || []); setLoading(false); });
  }, [sb, tenantId]);
  return <LeadTable rows={rows} loading={loading} emptyText="No Kitty Scheme interest yet (page ships in Phase 6)." />;
}

function RatesSubscribersTab({ sb, tenantId }) {
  const [rows, setRows] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([
      sb.from("bullion_leads").select("id,name,phone,source,created_at")
        .eq("tenant_id", tenantId).eq("extra_fields->>daily_rate_subscriber", "true")
        .order("created_at", { ascending: false }).limit(200),
      sb.from("bullion_price_alerts").select("id,metal,direction,target_rate,status,triggered_at,created_at,lead:bullion_leads(name,phone)")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(200),
    ]).then(([subs, al]) => {
      setRows(subs.data || []);
      setAlerts(al.data || []);
      setLoading(false);
    });
  }, [sb, tenantId]);

  return (
    <div>
      <h4 style={{ marginTop: 0 }}>Daily Rate Subscribers</h4>
      <div style={{ fontSize: 11.5, color: "#888", marginBottom: 10 }}>
        These are tagged in the CRM — still need to be added to the external Google Sheet/WA broadcast tool manually until that's integrated.
      </div>
      <LeadTable rows={rows} loading={loading} emptyText="No subscribers yet." />

      <h4 style={{ marginTop: 28 }}>Price Alerts</h4>
      {loading ? <div style={{ color: "#888", fontSize: 13 }}>Loading…</div> : !alerts.length ? (
        <div style={{ color: "#888", fontSize: 13 }}>No price alerts set yet.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: "6px 8px" }}>Client</th>
              <th style={{ padding: "6px 8px" }}>Metal</th>
              <th style={{ padding: "6px 8px" }}>Target</th>
              <th style={{ padding: "6px 8px" }}>Status</th>
              <th style={{ padding: "6px 8px" }}>Set</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "6px 8px" }}>{a.lead?.name || a.lead?.phone || "—"}</td>
                <td style={{ padding: "6px 8px" }}>{a.metal}</td>
                <td style={{ padding: "6px 8px" }}>{a.direction === "buy_below" ? "≤" : "≥"} ₹{a.target_rate}/g</td>
                <td style={{ padding: "6px 8px" }}>{a.status}</td>
                <td style={{ padding: "6px 8px" }}>{new Date(a.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const NEXT_STATUS = { pending: "approved", approved: "paid" };
const STATUS_COLOR = { pending: "#b45309", approved: "#2563eb", paid: "#16a34a" };

function CommissionsTab({ crmSecret }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/associates?action=commissions", { headers: { "x-crm-secret": crmSecret } });
      const d = await res.json();
      setRows(d.ok ? d.commissions : []);
    } catch { setRows([]); }
    setLoading(false);
  }, [crmSecret]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (commissionId, status) => {
    setUpdating(commissionId);
    try {
      const res = await fetch("/api/associates?action=set-commission-status", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-crm-secret": crmSecret },
        body: JSON.stringify({ commissionId, status }),
      });
      const d = await res.json();
      if (!d.ok) window.alert(d.error || "Could not update.");
      else load();
    } catch { window.alert("Network error."); }
    setUpdating(null);
  };

  if (loading) return <div style={{ color: "#888", fontSize: 13 }}>Loading…</div>;
  if (!rows.length) return <div style={{ color: "#888", fontSize: 13 }}>No commissions yet.</div>;

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
          <th style={{ padding: "6px 8px" }}>Associate</th>
          <th style={{ padding: "6px 8px" }}>Referred client</th>
          <th style={{ padding: "6px 8px" }}>Order ref</th>
          <th style={{ padding: "6px 8px" }}>Amount</th>
          <th style={{ padding: "6px 8px" }}>Status</th>
          <th style={{ padding: "6px 8px" }}>Created</th>
          <th style={{ padding: "6px 8px" }}></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
            <td style={{ padding: "6px 8px" }}>{c.associate?.display_name || c.associate?.phone || "—"}</td>
            <td style={{ padding: "6px 8px" }}>{c.lead?.name || c.lead?.phone || "—"}</td>
            <td style={{ padding: "6px 8px" }}>{c.order_reference || "—"}</td>
            <td style={{ padding: "6px 8px" }}>{c.amount != null ? `₹${c.amount}` : "—"}</td>
            <td style={{ padding: "6px 8px", color: STATUS_COLOR[c.status] || "#111", fontWeight: 600 }}>{c.status}</td>
            <td style={{ padding: "6px 8px" }}>{new Date(c.created_at).toLocaleDateString()}</td>
            <td style={{ padding: "6px 8px" }}>
              {NEXT_STATUS[c.status] && (
                <button onClick={() => setStatus(c.id, NEXT_STATUS[c.status])} disabled={updating === c.id} style={{ padding: "4px 12px", borderRadius: 5, border: "1px solid #111", background: "#111", color: "#fff", fontSize: 11.5, cursor: "pointer" }}>
                  {updating === c.id ? "Updating…" : `Mark ${NEXT_STATUS[c.status]}`}
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AssociatesTab({ crmSecret }) {
  const [applicants, setApplicants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/associates?action=applicants", { headers: { "x-crm-secret": crmSecret } });
      const d = await res.json();
      setApplicants(d.ok ? d.applicants : []);
    } catch { setApplicants([]); }
    setLoading(false);
  }, [crmSecret]);

  useEffect(() => { load(); }, [load]);

  const approve = async (a) => {
    const displayName = window.prompt("Display name for this associate?", a.name || "");
    if (!displayName) return;
    setApproving(a.id);
    try {
      const res = await fetch("/api/associates?action=approve", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-crm-secret": crmSecret },
        body: JSON.stringify({ leadId: a.id, displayName }),
      });
      const d = await res.json();
      if (!d.ok) window.alert(d.error || "Could not approve.");
      else load();
    } catch { window.alert("Network error."); }
    setApproving(null);
  };

  if (loading) return <div style={{ color: "#888", fontSize: 13 }}>Loading…</div>;
  if (!applicants.length) return <div style={{ color: "#888", fontSize: 13 }}>No pending associate applicants.</div>;

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
          <th style={{ padding: "6px 8px" }}>Name</th>
          <th style={{ padding: "6px 8px" }}>Phone</th>
          <th style={{ padding: "6px 8px" }}>Applied</th>
          <th style={{ padding: "6px 8px" }}></th>
        </tr>
      </thead>
      <tbody>
        {applicants.map((a) => (
          <tr key={a.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
            <td style={{ padding: "6px 8px" }}>{a.name || "—"}</td>
            <td style={{ padding: "6px 8px" }}>{a.phone}</td>
            <td style={{ padding: "6px 8px" }}>{new Date(a.created_at).toLocaleDateString()}</td>
            <td style={{ padding: "6px 8px" }}>
              <button onClick={() => approve(a)} disabled={approving === a.id} style={{ padding: "4px 12px", borderRadius: 5, border: "1px solid #16a34a", background: "#16a34a", color: "#fff", fontSize: 11.5, cursor: "pointer" }}>
                {approving === a.id ? "Approving…" : "Approve as Associate"}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
