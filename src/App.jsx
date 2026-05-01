import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

// ── SUPABASE (shared Sun Sea project — same as ssj-hr / fms-tracker) ──
const SUPABASE_URL = "https://uppyxzellmuissdlxsmy.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwcHl4emVsbG11aXNzZGx4c215Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyODczNTMsImV4cCI6MjA5MTg2MzM1M30._eFep-C0IYuT-73AQU9oqE2k1bqneWZjsydUZGwt24E";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
// Default tenant (SSJ). Runtime tenant comes from the logged-in user.
const DEFAULT_TENANT_ID = "a1b2c3d4-0000-0000-0000-000000000001";
const getTenantId = () => loadUser()?.tenant_id || DEFAULT_TENANT_ID;

// ── APPS SCRIPT (rates proxy — Google Sheet "new" tab) ──
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxGazdRhKxkjOLkqxN4kPoInDuBnlWy5Azmzq-FX9mt5OIfZLbhqfFEO0AufrOWE6n49Q/exec";

// ── Internal API secret (set VITE_CRM_SECRET in Vercel env) ──
const CRM_SECRET = import.meta.env.VITE_CRM_SECRET || "";

// ── WA Service (Baileys on Synology) — public URL for QR iframes ──
// wa-service calls are proxied through /api/wa-proxy to avoid mixed-content issues
const WA_SERVICE_URL = "/api/wa-proxy?path=";

// ── UI CONSTANTS ──
const C = { green: "#27ae60", orange: "#e67e22", red: "#c0392b", blue: "#2980b9", gray: "#888", purple: "#8e44ad", pink: "#e84393", yellow: "#f39c12" };
const STAGES = ["greeting", "qualifying", "quoted", "objection", "closing", "handoff", "converted", "dead"];
const STAGE_C = { greeting: C.gray, qualifying: C.blue, quoted: C.purple, objection: C.orange, closing: C.yellow, handoff: C.red, converted: C.green, dead: "#999" };
const STATUSES = ["active", "handoff", "converted", "dead", "paused"];
const STATUS_C = { active: C.blue, handoff: C.red, converted: C.green, dead: "#999", paused: C.gray };
const PRODUCT_FOCUS = ["gold_bullion", "silver_coin", "coin_bar", "all"];
const ROLES = { superadmin: "Super Admin", admin: "Admin", manager: "Manager", staff: "Staff" };
const PRODUCT_CATEGORIES = ["gold", "silver", "diamond", "polki", "kundan", "gemstone", "solitaire", "lab_diamond", "other"];
const PRODUCT_TYPES = ["Chain", "Earrings", "Danglers", "Nosepin", "Necklace set", "Pendant", "P Set", "Bangles", "Bracelets", "Gents Jew", "Engagement ring", "Solitaires", "Wedding Accessories", "Gemstones", "Others"];
const DISCOVERY_SOURCES = ["Google search", "Instagram", "Facebook ad", "WhatsApp", "Walk past store", "Friend referral", "Family referral", "Existing customer", "Newspaper", "Hoarding / banner", "Website", "Other"];
const NOT_BOUGHT_REASONS = ["Bought ✓", "Product not available", "Variety less", "Designs not good", "Price too high", "Want to compare other shops", "Just browsing", "Not their style / taste", "Need to consult family", "Will return with spouse", "Wrong size / specification", "Going for second opinion", "Other"];
const OCCASION_TYPES = ["wedding", "anniversary", "birthday", "Diwali gifting", "corporate gift", "self purchase", "other"];
const FOR_WHOM_OPTIONS = ["self", "daughter", "son", "wife", "husband", "mother", "father", "sister", "brother", "other"];
const FMS_STEP_COLORS = { new: C.gray, bot_activated: C.blue, qualifying: C.purple, catalog_sent: C.orange, call_needed: C.red, quoted: C.yellow, negotiating: C.orange, order_confirmed: C.green, delivered: C.green, closed: "#999" };

// ── HELPERS ──
const normalizePhone = (p) => String(p || "").replace(/\D/g, "").replace(/^0+/, "").replace(/^91/, "");
// Demand temperature — drives the Demands list sort order so staff focus on
// hottest leads first. Buckets:
//   hot       — needs human now: handoff status, qualified non-gold, visit today/tomorrow
//   warm      — active conversation in last 24h, or visit within a week
//   cold      — open lead but silent > 24h, or new but no reply yet
//   converted — won
//   dead      — lost / closed / DND
function demandTemperature(d) {
  const lead = d?.lead || {};
  // Demand-level outcome is the source of truth once sales has marked it.
  if (d?.outcome === "converted") return "converted";
  if (d?.outcome === "lost" || d?.outcome === "junk") return "dead";
  if (lead.status === "converted") return "converted";
  if (lead.status === "dead") return "dead";
  if (d?.outcome === "not_interested") return "cold";
  // Manual override — set by sales team, beats all auto-logic below.
  if (d?.temperature_override) return d.temperature_override;
  const visitMs = d.visit_scheduled_at ? new Date(d.visit_scheduled_at) - new Date() : null;
  const lastMs  = lead.last_msg_at ? Date.now() - new Date(lead.last_msg_at) : Infinity;
  const ageMs   = d.created_at ? Date.now() - new Date(d.created_at) : Infinity;
  const callDueMs = d.next_call_at ? new Date(d.next_call_at) - new Date() : null;
  if (d.step?.step_type === "call" && callDueMs !== null && callDueMs <= 36 * 3600 * 1000) return "hot";
  if (lead.status === "handoff") return "hot";
  if (d.needs_qualified) return "hot";
  if (visitMs !== null && visitMs >= 0 && visitMs <= 36 * 3600 * 1000) return "hot";
  if (ageMs < 3600 * 1000) return "hot";                       // brand new — < 1 h
  if (visitMs !== null && visitMs > 36 * 3600 * 1000 && visitMs <= 7 * 86400 * 1000) return "warm";
  if (lastMs < 24 * 3600 * 1000) return "warm";
  if (ageMs < 24 * 3600 * 1000) return "warm";                 // newish
  // Old / returning clients: never fall to cold automatically — stay warm until manually overridden.
  const isReturning = lead.is_client || d?.crm_source === "old_client" || lead.source === "old_client";
  if (isReturning) return "warm";
  return "cold";
}
const tempRank = (t) => ({ hot: 0, warm: 1, cold: 2, converted: 3, dead: 4 }[t] ?? 5);
const tempMeta = (t) => ({
  hot:       { label: "🔥 Hot",       color: "#ef4444" },
  warm:      { label: "🌤 Warm",       color: "#f59e0b" },
  cold:      { label: "❄️ Cold",       color: "#3b82f6" },
  converted: { label: "✅ Converted",  color: "#16a085" },
  dead:      { label: "💀 Dead",       color: "#6b7280" },
}[t] || { label: t, color: "#999" });

// LID JIDs (e.g. "258802028912814@lid") are WA-internal identifiers, not real phone numbers.
// WA hides the real phone for some senders post-2024 privacy update — show a friendly label instead.
const isLid = (p) => typeof p === "string" && /@lid$/i.test(p);
const displayPhone = (p) => {
  const s = String(p || "");
  if (isLid(s)) return "WA hidden #";
  if (/@s\.whatsapp\.net$/i.test(s)) return s.replace(/@.*$/, "");
  return s;
};
const fmtD = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtDT = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtT = (d) => (d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "");
const saveLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const loadLocal = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } };
const loadUser = () => loadLocal("ssj_bullion_user", null);
const saveUser = (u) => saveLocal("ssj_bullion_user", u);

// Send via our own /api/send (Vercel Function → wa-service on Synology).
const sendWA = async ({ phone, message, leadId, funnelId, client }) => {
  try {
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-crm-secret": CRM_SECRET },
      body: JSON.stringify({ phone: normalizePhone(phone), message, leadId, funnelId, client }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

// ──────────────────────────────────────────────────────────
// LOGIN SCREEN — staff table (same pattern as ssj-hr)
// ──────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!u || !p) return;
    setLoading(true); setErr("");
    const { data, error } = await sb.from("staff").select("*").eq("tenant_id", getTenantId()).eq("username", u.trim()).eq("password", p).single();
    if (error || !data) { setErr("Incorrect username or password."); setLoading(false); return; }
    setLoading(false);
    onLogin(data);
  };

  return (
    <div style={{ maxWidth: 360, margin: "4rem auto", padding: "2rem", background: "#fff", border: "1px solid #e0e0e0", borderRadius: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 4px" }}>SSJ Jew CRM</h2>
      <p style={{ fontSize: 13, color: "#888", margin: "0 0 24px" }}>Leads · Funnels · Approvals · Analytics</p>
      <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>USERNAME</label>
      <input value={u} onChange={(e) => setU(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} style={{ width: "100%", fontSize: 14, marginBottom: 12, padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
      <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>PASSWORD</label>
      <input type="password" value={p} onChange={(e) => setP(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} style={{ width: "100%", fontSize: 14, marginBottom: 16, padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
      {err && <p style={{ fontSize: 12, color: C.red, margin: "0 0 12px" }}>{err}</p>}
      <button onClick={submit} disabled={loading} style={{ width: "100%", padding: 10, borderRadius: 8, border: "none", background: C.blue, color: "#fff", fontSize: 14, cursor: "pointer", fontWeight: 500 }}>{loading ? "Logging in..." : "Login"}</button>
      <p style={{ fontSize: 11, color: "#aaa", margin: "16px 0 0", textAlign: "center" }}>Uses your Sun Sea staff account.</p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// SMALL REUSABLE BITS
// ──────────────────────────────────────────────────────────
const Pill = ({ color, children, solid }) => (
  <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 10, background: solid ? color : "#f3f3f3", color: solid ? "#fff" : color, border: solid ? "none" : `1px solid ${color}33`, whiteSpace: "nowrap" }}>{children}</span>
);

const Btn = ({ color = C.blue, onClick, children, disabled, small, ghost, style }) => (
  <button onClick={onClick} disabled={disabled} style={{ fontSize: small ? 12 : 13, padding: small ? "5px 10px" : "7px 14px", borderRadius: 8, border: ghost ? `1px solid ${color}` : "none", background: ghost ? "transparent" : color, color: ghost ? color : "#fff", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, fontWeight: 500, ...style }}>{children}</button>
);

const Card = ({ children, style }) => (
  <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 12, padding: 14, ...style }}>{children}</div>
);

const Modal = ({ title, onClose, children, width = 560 }) => (
  <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 40, zIndex: 100 }}>
    <div onClick={(e) => e.stopPropagation()} style={{ width: "90%", maxWidth: width, background: "#fff", borderRadius: 14, padding: 20, maxHeight: "85vh", overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
        <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 22, color: "#888", cursor: "pointer", lineHeight: 1 }}>×</button>
      </div>
      {children}
    </div>
  </div>
);

const Field = ({ label, children, required }) => (
  <div style={{ marginBottom: 12 }}>
    <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>{label}{required && <span style={{ color: C.red }}> *</span>}</label>
    {children}
  </div>
);

const Input = (props) => <input {...props} style={{ width: "100%", fontSize: 13, padding: 8, borderRadius: 8, border: "1px solid #ddd", ...(props.style || {}) }} />;
const Select = (props) => <select {...props} style={{ width: "100%", fontSize: 13, padding: 8, borderRadius: 8, border: "1px solid #ddd", background: "#fff", ...(props.style || {}) }}>{props.children}</select>;
const Textarea = (props) => <textarea {...props} style={{ width: "100%", fontSize: 13, padding: 8, borderRadius: 8, border: "1px solid #ddd", fontFamily: "inherit", resize: "vertical", ...(props.style || {}) }} />;

function StageBar({ stage }) {
  const mainStages = ["greeting", "qualifying", "quoted", "objection", "closing"];
  const idx = mainStages.indexOf(stage);
  return (
    <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
      {mainStages.map((s, i) => (
        <span key={s} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 8, background: i <= idx && idx >= 0 ? STAGE_C[s] : "#eee", color: i <= idx && idx >= 0 ? "#fff" : "#999", fontWeight: s === stage ? 600 : 400 }}>{s}</span>
      ))}
      {["handoff", "converted", "dead"].includes(stage) && <Pill color={STAGE_C[stage]} solid>{stage}</Pill>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// LEADS SCREEN — list + conversation pane
// ──────────────────────────────────────────────────────────
function LeadsScreen({ funnels, allTags, viewMode = "leads" }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [filterFunnel, setFilterFunnel] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let q = sb.from("bullion_leads").select("*").eq("tenant_id", getTenantId()).order("updated_at", { ascending: false }).limit(1000);
    if (filterFunnel) q = q.eq("funnel_id", filterFunnel);
    if (filterStatus) q = q.eq("status", filterStatus);
    // "leads" (Conversations) = only leads that have at least one demand (bot was manually activated).
    // "contacts" = full contact directory.
    if (viewMode === "leads") {
      q = q.in("status", ["active", "handoff"]).not("last_msg_at", "is", null);
    }
    const { data } = await q;
    if (data) setLeads(data);
    setLoading(false);
  }, [filterFunnel, filterStatus, viewMode]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    if (!search) return leads;
    const s = search.toLowerCase();
    return leads.filter((l) => (l.phone || "").toLowerCase().includes(s) || (l.name || "").toLowerCase().includes(s) || (l.last_msg || "").toLowerCase().includes(s));
  }, [leads, search]);

  const selected = leads.find((l) => l.id === selectedId) || null;
  const selectedFunnel = selected ? funnels.find((f) => f.id === selected.funnel_id) : null;

  return (
    <div style={{ display: "block" }}>
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <Input placeholder="Search name/phone/msg" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: "1 1 180px" }} />
          <Select value={filterFunnel} onChange={(e) => setFilterFunnel(e.target.value)} style={{ width: 150 }}>
            <option value="">All funnels</option>
            {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select>
          <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ width: 130 }}>
            <option value="">All status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Btn ghost small color={C.gray} onClick={load}>↻</Btn>
          <Btn small color={C.blue} onClick={() => setAdding(true)}>+ Add</Btn>
        </div>

        {adding && <ManualLeadForm funnels={funnels} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}

        <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
          {loading ? "Loading…" : `${filtered.length} lead${filtered.length === 1 ? "" : "s"}`}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.map((l) => {
            const f = funnels.find((ff) => ff.id === l.funnel_id);
            const sel = l.id === selectedId;
            return (
              <React.Fragment key={l.id}>
                <div onClick={() => setSelectedId(sel ? null : l.id)} style={{ padding: 10, background: sel ? "#eef5ff" : "#fff", border: `1px solid ${sel ? C.blue : "#eee"}`, borderRadius: 10, cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <strong style={{ fontSize: 13 }}>{l.name || (isLid(l.phone) ? (l.wa_display_name || displayPhone(l.phone)) : l.phone)}</strong>
                    <div style={{ display: "flex", gap: 4 }}>
                      {l.dnd && <Pill color={C.red} solid>DND</Pill>}
                      <Pill color={STATUS_C[l.status] || C.gray} solid>{l.status}</Pill>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{displayPhone(l.phone)} · {f?.name || l.funnel_id || "—"}{l.source ? ` · ${l.source}` : ""}</div>
                  {l.last_msg && <div style={{ fontSize: 12, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.last_msg}</div>}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                    <StageBar stage={l.stage} />
                    <span style={{ fontSize: 10, color: "#aaa" }}>{fmtDT(l.updated_at)}</span>
                  </div>
                </div>
                {sel && selected && <ConversationPane lead={selected} funnel={selectedFunnel} onClose={() => setSelectedId(null)} onChanged={load} allTags={allTags} />}
              </React.Fragment>
            );
          })}
          {!filtered.length && !loading && <div style={{ padding: 20, textAlign: "center", color: "#aaa", fontSize: 13 }}>No leads yet.</div>}
        </div>
      </div>
    </div>
  );
}

function VisitRescheduleButton({ demandId, onRescheduled }) {
  const [open, setOpen] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [saving, setSaving] = useState(false);

  const reschedule = async () => {
    if (!newDate) return;
    setSaving(true);
    const visitTs = new Date(newDate).getTime();
    const visitTime = new Date(visitTs).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
    const visitDateStr = new Date(visitTs).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

    // Get current demand info
    const { data: demand } = await sb.from("bullion_demands").select("*").eq("id", demandId).single();
    if (!demand) { setSaving(false); return; }

    // Cancel old visit reminders
    await sb.from("bullion_scheduled_messages")
      .update({ status: "canceled", canceled_reason: "rescheduled_manual" })
      .eq("lead_id", demand.lead_id)
      .in("message_type", ["visit_reminder", "visit_day"])
      .eq("status", "pending");

    // Get lead name
    const { data: lead } = await sb.from("bullion_leads").select("name,phone").eq("id", demand.lead_id).single();
    const clientName = lead?.name ? lead.name.trim().split(/\s+/)[0] : "";

    // Schedule new reminders
    const d1ts = visitTs - 24 * 60 * 60 * 1000;
    if (d1ts > Date.now()) {
      await sb.from("bullion_scheduled_messages").insert({
        tenant_id: demand.tenant_id, lead_id: demand.lead_id, funnel_id: demand.funnel_id,
        send_at: new Date(d1ts).toISOString(),
        body: `Hi ${clientName}, just confirming your visit to Sun Sea Jewellers tomorrow (${visitDateStr}) at ${visitTime}. Looking forward to meeting you! Please reply YES to confirm. 🙏`,
        status: "pending", message_type: "visit_reminder",
      });
    }
    const visitDay9am = new Date(visitTs);
    visitDay9am.setUTCHours(3, 30, 0, 0);
    if (visitDay9am > new Date()) {
      await sb.from("bullion_scheduled_messages").insert({
        tenant_id: demand.tenant_id, lead_id: demand.lead_id, funnel_id: demand.funnel_id,
        send_at: visitDay9am.toISOString(),
        body: `Good morning ${clientName}! 🙏 A warm reminder — your visit to Sun Sea Jewellers is today at ${visitTime}, Karol Bagh. We look forward to welcoming you!`,
        status: "pending", message_type: "visit_day",
      });
    }

    // Update demand
    await sb.from("bullion_demands").update({
      visit_scheduled_at: new Date(visitTs).toISOString(),
      visit_confirmed: false,
      visit_rescheduled_count: (demand.visit_rescheduled_count || 0) + 1,
    }).eq("id", demandId);

    setSaving(false);
    setOpen(false);
    onRescheduled && onRescheduled();
  };

  if (!open) {
    return <Btn small ghost color={C.orange} onClick={() => setOpen(true)}>Reschedule</Btn>;
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <Input type="datetime-local" value={newDate} onChange={(e) => setNewDate(e.target.value)} style={{ fontSize: 11, padding: "3px 6px", width: 170 }} />
      <Btn small color={C.green} onClick={reschedule} disabled={saving || !newDate}>{saving ? "…" : "Confirm"}</Btn>
      <Btn small ghost color={C.gray} onClick={() => setOpen(false)}>✕</Btn>
    </span>
  );
}

function ConversationPane({ lead, funnel, onClose, onChanged, allTags, demand, onAdvanceStep, onRollbackStep, onMergeDuplicate }) {
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [logCallOpen, setLogCallOpen] = useState(false);
  const [outcomeBusy, setOutcomeBusy] = useState(false);
  const [lostModalOpen, setLostModalOpen] = useState(false);
  const [funnelSteps, setFunnelSteps] = useState([]);
  const [staff, setStaff] = useState([]);
  const [allFunnels, setAllFunnels] = useState([]);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignBusy, setReassignBusy] = useState(false);
  const [funnelBusy, setFunnelBusy] = useState(false);

  useEffect(() => {
    sb.from("funnels").select("id,name,kind,active").eq("tenant_id", getTenantId()).order("active", { ascending: false }).order("id")
      .then(({ data }) => setAllFunnels(data || []));
  }, []);

  const changeFunnel = async (newFunnelId) => {
    if (!demand?.id || !newFunnelId || newFunnelId === demand.funnel_id) return;
    if (!window.confirm("Move this demand to a different funnel? Pending drip messages will be cancelled and the bot will enrol the new funnel's steps on its next reply.")) return;
    setFunnelBusy(true);
    // 1) Update demand row.
    await sb.from("bullion_demands").update({
      funnel_id: newFunnelId,
      fms_step_id: null, // reset so first step of new funnel applies
      updated_at: new Date().toISOString(),
    }).eq("id", demand.id);
    // 2) Update lead's funnel_id (so drip routing matches).
    await sb.from("bullion_leads").update({ funnel_id: newFunnelId }).eq("id", lead.id);
    // 3) Cancel any pending drips queued under the old funnel.
    await sb.from("bullion_scheduled_messages")
      .update({ status: "canceled", canceled_reason: "manual_funnel_change" })
      .eq("lead_id", lead.id).eq("status", "pending");
    setFunnelBusy(false);
    onChanged && onChanged();
  };

  // Load the funnel's step list so we can show "current → next" flow.
  // Self-heal: if the demand has no fms_step_id but the funnel has steps,
  // pin it to step 1 so the cadence/flow render correctly.
  useEffect(() => {
    if (!demand?.funnel_id) { setFunnelSteps([]); return; }
    sb.from("bullion_funnel_steps")
      .select("id,step_order,name,step_type,delay_minutes,active")
      .eq("tenant_id", getTenantId())
      .eq("funnel_id", demand.funnel_id)
      .eq("active", true)
      .order("step_order")
      .then(async ({ data }) => {
        const steps = data || [];
        setFunnelSteps(steps);
        if (steps.length && demand?.id && !demand.fms_step_id) {
          await sb.from("bullion_demands")
            .update({ fms_step_id: steps[0].id })
            .eq("id", demand.id);
          onChanged && onChanged();
        }
      });
  }, [demand?.funnel_id, demand?.id, demand?.fms_step_id]);

  useEffect(() => {
    sb.from("staff").select("id,name,username,role,app_permissions")
      .eq("tenant_id", getTenantId())
      .order("name")
      .then(({ data }) => setStaff(data || []));
  }, []);

  // Past call attempts for the cadence strip (read-only; logging happens in modal).
  const [callLogs, setCallLogs] = useState([]);
  const [cadenceMinutes, setCadenceMinutes] = useState([]);
  const [stepDetails, setStepDetails] = useState(null); // includes no_answer_template
  const [sendingNoAnswer, setSendingNoAnswer] = useState(false);
  const [editLeadOpen, setEditLeadOpen] = useState(false);

  useEffect(() => {
    if (!demand?.fms_step_id) { setStepDetails(null); return; }
    sb.from("bullion_funnel_steps")
      .select("id,name,step_type,no_answer_template,message_template")
      .eq("id", demand.fms_step_id).maybeSingle()
      .then(({ data }) => setStepDetails(data || null));
  }, [demand?.fms_step_id]);

  const sendTriedToCallWA = async () => {
    if (!stepDetails?.no_answer_template) {
      alert("No 'tried to call' WA template configured on this step. Edit the funnel step in Funnels → Steps to add one.");
      return;
    }
    if (isLid(lead.phone) || !lead.phone) {
      alert("Phone hidden / missing — can't send WA. Add a real number first.");
      return;
    }
    const me = loadUser();
    const message = String(stepDetails.no_answer_template)
      .replace(/\{\{\s*name\s*\}\}/g, lead.name || "ji")
      .replace(/\{\{\s*phone\s*\}\}/g, lead.phone || "")
      .replace(/\{\{\s*staff_name\s*\}\}/g, me?.name || me?.username || "")
      .replace(/\{\{\s*funnel_name\s*\}\}/g, funnel?.name || "")
      .replace(/\{\{\s*goal\s*\}\}/g, funnel?.goal || "");
    if (!window.confirm(`Send this WA to ${lead.name || lead.phone}?\n\n${message}`)) return;
    setSendingNoAnswer(true);
    const r = await sendWA({ phone: lead.phone, message, leadId: lead.id, funnelId: demand.funnel_id, client: funnel?.wbiztool_client });
    setSendingNoAnswer(false);
    if (!r.ok) { alert(`Failed: ${r.error || "unknown"}`); return; }
    alert("✅ WA sent.");
    onChanged && onChanged();
  };
  useEffect(() => {
    if (!demand?.id) { setCallLogs([]); return; }
    sb.from("bullion_call_logs")
      .select("attempt_no,called_at,disposition,notes,staff_id,next_callback_at")
      .eq("demand_id", demand.id)
      .order("attempt_no")
      .then(({ data }) => setCallLogs(data || []));
  }, [demand?.id]);
  useEffect(() => {
    sb.from("bullion_dropdowns")
      .select("value,sort_order")
      .eq("tenant_id", getTenantId())
      .eq("field", "telecaller_cadence_minutes")
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => setCadenceMinutes((data || []).map((r) => Number(r.value) || 0).filter((n) => n > 0)));
  }, []);

  const reassign = async (staffId) => {
    if (!demand?.id) return;
    setReassignBusy(true);
    const picked = staff.find((s) => s.id === staffId);
    const { error } = await sb.from("bullion_demands").update({
      assigned_staff_id: staffId || null,
      assigned_to: picked?.name || picked?.username || null,
      updated_at: new Date().toISOString(),
    }).eq("id", demand.id);
    setReassignBusy(false);
    if (error) { alert(`Failed: ${error.message}`); return; }
    setReassignOpen(false);
    onChanged && onChanged();
  };

  const markOutcome = async (outcome) => {
    if (!demand?.id) { alert("No active demand on this lead — can't mark outcome."); return; }
    if (!window.confirm(`Mark this demand as "${outcome}"? Lead will move to the configured follow-up funnel.`)) return;
    setOutcomeBusy(true);
    const r = await fetch("/api/demand-outcome", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-crm-secret": window.__CRM_SECRET__ || "" },
      body: JSON.stringify({ demandId: demand.id, outcome, staffId: loadUser()?.id || null }),
    });
    const data = await r.json().catch(() => ({}));
    setOutcomeBusy(false);
    if (!data.ok) { alert(`Failed: ${data.error || "unknown"}`); return; }
    onChanged && onChanged();
  };

  const loadMsgs = useCallback(async () => {
    const { data } = await sb.from("bullion_messages").select("*").eq("tenant_id", getTenantId()).eq("lead_id", lead.id).order("created_at", { ascending: true });
    if (data) setMessages(data);
  }, [lead.id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadMsgs(); }, [loadMsgs]);
  useEffect(() => {
    const t = setInterval(loadMsgs, 10000);
    return () => clearInterval(t);
  }, [loadMsgs]);

  const sendManual = async () => {
    if (!reply.trim()) return;
    setSending(true);
    const res = await sendWA({
      phone: lead.phone,
      message: reply.trim(),
      leadId: lead.id,
      funnelId: lead.funnel_id,
    });
    if (res.ok) {
      setReply("");
      await loadMsgs();
      onChanged && onChanged();
    } else {
      alert("Send failed: " + (res.error || "unknown"));
    }
    setSending(false);
  };

  const setStatus = async (status, extra = {}) => {
    setBusy(true);
    await sb.from("bullion_leads").update({ status, ...extra }).eq("id", lead.id);
    setBusy(false);
    onChanged && onChanged();
  };

  const toggleBot = async () => {
    setBusy(true);
    await sb.from("bullion_leads").update({ bot_paused: !lead.bot_paused }).eq("id", lead.id);
    setBusy(false);
    onChanged && onChanged();
  };

  const setTempOverride = async (val) => {
    if (!demand?.id) return;
    await sb.from("bullion_demands").update({ temperature_override: val || null, updated_at: new Date().toISOString() }).eq("id", demand.id);
    onChanged && onChanged();
  };

  const optOut = async () => {
    const name = lead.name || lead.wa_display_name || "this contact";
    if (!window.confirm(`Block ${name} from all calls and messages? This cannot be undone.`)) return;
    setBusy(true);
    await sb.from("bullion_leads").update({
      dnd: true, dnd_at: new Date().toISOString(), dnd_reason: "opt_out_manual",
      status: "dead", bot_paused: true,
    }).eq("id", lead.id);
    await sb.from("bullion_scheduled_messages")
      .update({ status: "canceled", canceled_reason: "opt_out" })
      .eq("lead_id", lead.id).eq("status", "pending");
    setBusy(false);
    onChanged && onChanged();
  };

  return (
    <Card style={{ display: "flex", flexDirection: "column", height: "78vh", padding: 0 }}>
      {/* Header */}
      <div style={{ padding: 14, borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <strong style={{ fontSize: 14 }}>{lead.name || (isLid(lead.phone) ? (lead.wa_display_name || displayPhone(lead.phone)) : lead.phone)}</strong>
            <Pill color={STATUS_C[lead.status]} solid>{lead.status}</Pill>
            {lead.bot_paused && <Pill color={C.orange}>bot paused</Pill>}
          </div>
          <div style={{ fontSize: 11, color: "#888" }}>{displayPhone(lead.phone)} · {funnel?.name || lead.funnel_id} · {lead.exchanges_count || 0} exchanges</div>
          <div style={{ fontSize: 11, color: "#888", marginTop: 3 }}>
            {lead.city && <span>📍 {lead.city} · </span>}
            {lead.email && <span>✉️ {lead.email} · </span>}
            {lead.bday && <span>🎂 {lead.bday} · </span>}
            {lead.anniversary && <span>💍 {lead.anniversary}</span>}
            {!lead.city && !lead.email && !lead.bday && !lead.anniversary && <em>(name/city/bday/anniv not captured yet)</em>}
          </div>
          <div style={{ marginTop: 6 }}><StageBar stage={lead.stage} /></div>
          {isLid(lead.phone) && (
            <div style={{ marginTop: 6, padding: "6px 8px", background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 6, fontSize: 11, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#c2410c" }}>⚠️ This is a WA-hidden (LID) sender. Real phone unknown.</span>
              <Btn small color={C.blue} onClick={() => setLinkOpen(true)}>🔗 Link to existing contact</Btn>
            </div>
          )}
        </div>
        <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 20, color: "#888", cursor: "pointer" }}>×</button>
      </div>
      {linkOpen && (
        <LinkLidModal
          lead={lead}
          onClose={() => setLinkOpen(false)}
          onLinked={() => { setLinkOpen(false); onClose(); onChanged && onChanged(); }}
        />
      )}
      {editLeadOpen && (
        <ContactEditModal
          contact={lead}
          allTags={allTags || []}
          onClose={() => setEditLeadOpen(false)}
          onSaved={() => { setEditLeadOpen(false); onChanged && onChanged(); }}
        />
      )}

      {/* Old / returning client VIP banner */}
      {demand && (lead.is_client || demand.crm_source === "old_client" || lead.source === "old_client") && (
        <div style={{ padding: "6px 14px", background: "#fef9c3", borderBottom: "1px solid #fde047", fontSize: 12, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontWeight: 700, color: "#854d0e" }}>⭐ Returning client</span>
          <span style={{ color: "#92400e" }}>— known customer, treat as priority. Confirm their previous purchase preference before calling.</span>
          {(lead.tags || []).length > 0 && (
            <span style={{ color: "#78350f" }}>Tags: {(lead.tags || []).slice(0, 5).join(", ")}{(lead.tags || []).length > 5 ? ` +${(lead.tags || []).length - 5}` : ""}</span>
          )}
        </div>
      )}

      {/* Demand context strip */}
      {demand && (
        <div style={{ padding: "6px 14px", borderBottom: "1px solid #eee", background: "#fffbf0", fontSize: 11 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Pill color={C.purple}>{demand.product_category}</Pill>
            {demand.description && <span style={{ color: "#555" }}>{demand.description.slice(0, 80)}</span>}
            {demand.for_whom && <span style={{ color: "#888" }}>for {demand.for_whom}</span>}
            {demand.budget && <Pill color={C.gray}>₹{Number(demand.budget).toLocaleString("en-IN")}</Pill>}
            {demand.occasion && <Pill color={C.orange}>{demand.occasion}</Pill>}
            {demand.occasion_date && <span style={{ color: C.red, fontWeight: 500 }}>{fmtD(demand.occasion_date)}</span>}
            {demand.ai_summary && <span style={{ color: C.blue, fontStyle: "italic" }}>"{demand.ai_summary}"</span>}
            {demand.needs_qualified && <Pill color={C.green} solid>✓ Qualified</Pill>}
            {demand.assigned_to
              ? <Pill color={C.blue} solid>👤 {demand.assigned_to}</Pill>
              : <Pill color={C.gray}>👤 unassigned</Pill>}
            {/* Manual temperature override */}
            <div style={{ marginLeft: "auto", display: "flex", gap: 3, alignItems: "center" }}>
              <span style={{ color: "#aaa", fontSize: 10 }}>temp:</span>
              {[["hot","🔥"],["warm","🌤"],["cold","❄️"]].map(([val, icon]) => (
                <button key={val} type="button" onClick={() => setTempOverride(demand.temperature_override === val ? null : val)}
                  title={demand.temperature_override === val ? `Remove override (back to auto)` : `Pin as ${val}`}
                  style={{ padding: "2px 6px", fontSize: 11, borderRadius: 6, cursor: "pointer",
                    border: `1px solid ${demand.temperature_override === val ? "#555" : "#ddd"}`,
                    background: demand.temperature_override === val ? "#333" : "transparent",
                    color: demand.temperature_override === val ? "#fff" : "#555" }}>
                  {icon}
                </button>
              ))}
              {demand.temperature_override && <span style={{ fontSize: 9, color: "#888" }}>pinned</span>}
            </div>
          </div>
          {demand.visit_scheduled_at && (
            <div style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: C.green, fontWeight: 500 }}>🏪 Visit: {fmtDT(demand.visit_scheduled_at)}</span>
              {demand.visit_confirmed
                ? <Pill color={C.green} solid>✓ Confirmed</Pill>
                : <Pill color={C.orange}>Not confirmed</Pill>}
              {demand.visit_rescheduled_count > 0 && <span style={{ color: "#aaa" }}>rescheduled {demand.visit_rescheduled_count}×</span>}
              <VisitRescheduleButton demandId={demand.id} onRescheduled={onChanged} />
            </div>
          )}
          {/* Jewelry + Exchange inline display */}
          {(demand.metal || demand.stone || demand.item_category || demand.has_exchange) && (
            <div style={{ marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {(demand.metal || demand.stone || demand.item_category) && (
                <span style={{ color: "#555" }}>
                  💎 {[
                    demand.metal?.replace(/_/g, " "),
                    demand.stone,
                    demand.item_category,
                    demand.ring_size ? `size ${demand.ring_size}` : null,
                    demand.purity,
                  ].filter(Boolean).join(" · ")}
                </span>
              )}
              {demand.has_exchange && (
                <Pill color={C.orange}>🔄 Exchange{demand.exchange_value ? ` ₹${Number(demand.exchange_value).toLocaleString("en-IN")}` : ""}</Pill>
              )}
            </div>
          )}
        </div>
      )}

      {/* Funnel flow strip — what step is current, what comes next */}
      {demand && funnelSteps.length > 0 && (
        <div style={{ padding: "8px 14px", borderBottom: "1px solid #eee", background: "#f0f9ff", fontSize: 11 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#1e3a8a", letterSpacing: 0.4 }}>🛤 FUNNEL:</span>
            <Select
              value={demand.funnel_id || ""}
              onChange={(e) => changeFunnel(e.target.value)}
              disabled={funnelBusy}
              style={{ fontSize: 11, padding: "2px 6px", height: 22, minWidth: 180, flex: "0 1 auto" }}
            >
              {allFunnels.filter((f) => f.active).map((f) => <option key={f.id} value={f.id}>{f.name} ({f.kind || "sales"})</option>)}
              {allFunnels.find((f) => f.id === demand.funnel_id && !f.active) && (
                <option value={demand.funnel_id}>{demand.funnel_id} (inactive — currently set)</option>
              )}
            </Select>
            {funnelBusy && <span style={{ fontSize: 10, color: "#92400e" }}>updating…</span>}
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
            {funnelSteps.map((s, i) => {
              const isCurrent = s.id === demand.fms_step_id;
              const curIdx = funnelSteps.findIndex((x) => x.id === demand.fms_step_id);
              const isPast = curIdx >= 0 && i < curIdx;
              const isFuture = curIdx >= 0 && i > curIdx;
              const stepIcon = s.step_type === "call" ? "📞" : "💬";
              return (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <span style={{
                    fontSize: 10,
                    padding: "2px 7px",
                    borderRadius: 10,
                    background: isCurrent ? C.blue : isPast ? "#d1fae5" : "#e5e7eb",
                    color: isCurrent ? "#fff" : isPast ? "#065f46" : "#6b7280",
                    fontWeight: isCurrent ? 600 : 400,
                    textDecoration: isPast ? "line-through" : "none",
                  }}>
                    {isPast ? "✓" : isCurrent ? "▶" : stepIcon} {s.name || `Step ${s.step_order}`}
                  </span>
                  {i < funnelSteps.length - 1 && <span style={{ color: "#cbd5e1" }}>→</span>}
                </div>
              );
            })}
          </div>
          {(() => {
            const curIdx = funnelSteps.findIndex((x) => x.id === demand.fms_step_id);
            const next = curIdx >= 0 && curIdx + 1 < funnelSteps.length ? funnelSteps[curIdx + 1] : null;
            const cur = curIdx >= 0 ? funnelSteps[curIdx] : null;
            if (!cur && demand.fms_step_id == null) {
              return <div style={{ marginTop: 4, color: "#666" }}>⚠ No step set yet — bot will assign first step automatically when it replies.</div>;
            }
            if (next) {
              return <div style={{ marginTop: 4, color: "#475569" }}>Next: <strong>{next.step_type === "call" ? "📞 " : "💬 "}{next.name}</strong>{next.delay_minutes ? ` · fires ~${next.delay_minutes < 60 ? `${next.delay_minutes}m` : next.delay_minutes < 1440 ? `${Math.round(next.delay_minutes/60)}h` : `${Math.round(next.delay_minutes/1440)}d`} after current`: ""}</div>;
            }
            if (cur && curIdx === funnelSteps.length - 1) {
              return <div style={{ marginTop: 4, color: "#16a085" }}>🏁 Last step — funnel complete after this.</div>;
            }
            return null;
          })()}
        </div>
      )}

      {/* Call cadence strip — only for call-step demands */}
      {demand && demand.step?.step_type === "call" && (() => {
        const max = cadenceMinutes.length || 6;
        const used = demand.call_attempts || 0;
        const remaining = Math.max(0, max - used);
        const dots = "●".repeat(used) + "○".repeat(remaining);
        const nextDueMs = demand.next_call_at ? new Date(demand.next_call_at) - new Date() : null;
        let nextDueLabel;
        if (nextDueMs == null) nextDueLabel = used === 0 ? "due now" : "—";
        else if (nextDueMs <= 0) nextDueLabel = "OVERDUE";
        else if (nextDueMs < 60 * 60_000) nextDueLabel = `in ${Math.round(nextDueMs / 60_000)} min`;
        else if (nextDueMs < 24 * 3600_000) nextDueLabel = `in ${Math.round(nextDueMs / 3600_000)} h`;
        else nextDueLabel = `in ${Math.round(nextDueMs / 86400_000)} d`;
        return (
          <div style={{ padding: "8px 14px", borderBottom: "1px solid #eee", background: "#fef3c7", fontSize: 11 }}>
            <div style={{ fontWeight: 600, color: "#92400e", marginBottom: 4 }}>
              📞 CALL CADENCE — Attempt {used + 1} of {max}
            </div>
            <div style={{ color: "#78350f" }}>
              <span style={{ fontFamily: "monospace", letterSpacing: 2 }}>[ {dots} ]</span>
              {"  "}{used} used · {remaining} left
              {"  ·  "}Next due: <strong>{nextDueLabel}</strong>
              {used >= max && <span style={{ color: C.red }}>{"  ·  "}🛑 cadence exhausted — will auto-transition to cold_revive</span>}
              {used < max && <span style={{ color: "#78350f" }}>{"  ·  "}After {max} unanswered → cold_revive</span>}
            </div>
            {callLogs.length > 0 && (
              <div style={{ marginTop: 6, paddingTop: 4, borderTop: "1px dashed #fcd34d" }}>
                <div style={{ fontWeight: 600, marginBottom: 3, color: "#92400e" }}>Past attempts:</div>
                {callLogs.map((c) => {
                  const who = staff.find((s) => s.id === c.staff_id);
                  return (
                    <div key={c.attempt_no} style={{ color: "#78350f", lineHeight: 1.5 }}>
                      #{c.attempt_no} · {fmtDT(c.called_at)} · <strong>{c.disposition}</strong>
                      {who ? ` (${who.name || who.username})` : ""}
                      {c.notes ? ` — "${c.notes}"` : ""}
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Btn small color="#16a085" onClick={sendTriedToCallWA} disabled={sendingNoAnswer || !stepDetails?.no_answer_template || isLid(lead.phone) || !lead.phone}
                title={!stepDetails?.no_answer_template ? "Add 'tried to call' template on this funnel step first" : (isLid(lead.phone) || !lead.phone) ? "Phone hidden — can't send" : ""}>
                {sendingNoAnswer ? "Sending…" : "📲 Send 'tried to call' WA"}
              </Btn>
            </div>
          </div>
        );
      })()}

      {/* Actions */}
      <div style={{ padding: "8px 14px", borderBottom: "1px solid #eee", display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Btn small ghost color={lead.bot_paused ? C.green : C.orange} onClick={toggleBot} disabled={busy}>{lead.bot_paused ? "Resume bot" : "Pause bot"}</Btn>
        <Btn small ghost color={C.red} onClick={optOut} disabled={busy} title="Block from all calls and messages (DNC)">🚫 Opt Out</Btn>
        {onMergeDuplicate && <Btn small ghost color={C.orange} onClick={onMergeDuplicate} title="Merge this with a duplicate lead record">⊕ Merge duplicate</Btn>}
        <Btn small ghost color={C.green} onClick={() => setEditLeadOpen(true)}>✏️ Edit contact</Btn>
        {demand?.id && (
          <>
            <Btn small color={C.green} onClick={() => markOutcome("converted")} disabled={outcomeBusy}>✅ Converted</Btn>
            <Btn small color={C.red} onClick={() => setLostModalOpen(true)} disabled={outcomeBusy}>❌ Lost</Btn>
            <Btn small ghost color={C.orange} onClick={() => markOutcome("not_interested")} disabled={outcomeBusy}>🤔 Not interested</Btn>
            <Btn small ghost color={C.gray} onClick={() => markOutcome("junk")} disabled={outcomeBusy}>🗑 Junk</Btn>
            <Btn small ghost color={C.purple} onClick={() => markOutcome("supplier")} disabled={outcomeBusy}>🏷 Supplier</Btn>
            <Btn small ghost color={C.blue} onClick={() => setReassignOpen((v) => !v)}>🔁 Reassign</Btn>
            <Btn small ghost color={C.blue} onClick={() => setLogCallOpen(true)} disabled={isLid(lead.phone) || !lead.phone} title={isLid(lead.phone) || !lead.phone ? "Phone hidden — link to existing contact or add a real number first" : ""}>📝 Log call</Btn>
            {onAdvanceStep && (
              <Btn small ghost color={C.green} onClick={onAdvanceStep}>✓ Mark step complete</Btn>
            )}
            {onRollbackStep && funnelSteps.length > 0 && funnelSteps.findIndex((s) => s.id === demand.fms_step_id) > 0 && (
              <Btn small ghost color={C.gray} onClick={onRollbackStep}>↶ Undo last step</Btn>
            )}
          </>
        )}
        <Btn small ghost color={C.red} onClick={() => setStatus("handoff", { stage: "handoff", bot_paused: true })} disabled={busy}>Handoff</Btn>
        <Btn small ghost color={C.gray} onClick={() => setStatus("dead", { stage: "dead" })} disabled={busy}>Dead</Btn>
      </div>
      {logCallOpen && demand && (
        <LogCallModal
          demand={demand}
          lead={lead}
          funnel={funnel}
          onClose={() => setLogCallOpen(false)}
          onSaved={() => { setLogCallOpen(false); onChanged && onChanged(); }}
        />
      )}
      {lostModalOpen && demand && (
        <LostReasonModal
          demand={demand}
          lead={lead}
          onClose={() => setLostModalOpen(false)}
          onLost={() => { setLostModalOpen(false); onChanged && onChanged(); }}
        />
      )}

      {/* Reassign panel — visible inline when toggled */}
      {reassignOpen && demand && (
        <div style={{ padding: "10px 14px", borderBottom: "1px solid #eee", background: "#fef3c7", fontSize: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <strong style={{ color: "#92400e" }}>🔁 Reassign to:</strong>
            <Select
              value={demand.assigned_staff_id || ""}
              onChange={(e) => reassign(e.target.value)}
              disabled={reassignBusy}
              style={{ flex: 1 }}
            >
              <option value="">— unassigned —</option>
              <optgroup label="Telecallers (round-robin pool)">
                {staff.filter((s) => (s.app_permissions?.fms || []).includes("telecaller"))
                  .map((s) => <option key={s.id} value={s.id}>{s.name || s.username} · @{s.username} {(s.app_permissions?.fms || []).includes("telecaller") ? "📞" : ""}</option>)}
              </optgroup>
              <optgroup label="All staff">
                {staff.filter((s) => !(s.app_permissions?.fms || []).includes("telecaller"))
                  .map((s) => <option key={s.id} value={s.id}>{s.name || s.username} · @{s.username} ({s.role})</option>)}
              </optgroup>
            </Select>
            <Btn small ghost color={C.gray} onClick={() => setReassignOpen(false)}>Close</Btn>
          </div>
        </div>
      )}

      {/* Tags + Family + Visits */}
      <TagEditor leadId={lead.id} allTags={allTags || []} onReload={onChanged} />
      <FamilyMembersSection leadId={lead.id} tenantId={lead.tenant_id || getTenantId()} />
      <VisitsSection leadId={lead.id} />

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: 14, background: "#f6f7f9" }}>
        {messages.map((m) => {
          const out = m.direction === "out";
          return (
            <div key={m.id} style={{ display: "flex", justifyContent: out ? "flex-end" : "flex-start", marginBottom: 8 }}>
              <div style={{ maxWidth: "75%", padding: "8px 12px", borderRadius: 12, background: out ? "#dcf8c6" : "#fff", border: "1px solid #eee", whiteSpace: "pre-wrap", fontSize: 13 }}>
                {m.body}
                <div style={{ fontSize: 10, color: "#888", marginTop: 4, display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                  {m.claude_action && <span style={{ color: C.purple }}>{m.claude_action}</span>}
                  {m.status && m.status !== "sent" && <span style={{ color: m.status === "failed" ? C.red : "#888" }}>{m.status}</span>}
                  <span>{fmtT(m.created_at)}</span>
                </div>
              </div>
            </div>
          );
        })}
        {!messages.length && <div style={{ textAlign: "center", color: "#aaa", fontSize: 12, padding: 30 }}>No messages yet.</div>}
      </div>

      {/* Reply */}
      <div style={{ padding: 10, borderTop: "1px solid #eee", display: "flex", gap: 8 }}>
        <Textarea rows={2} placeholder="Type message (sending here pauses the bot)" value={reply} onChange={(e) => setReply(e.target.value)} style={{ flex: 1 }} />
        <Btn color={C.green} onClick={sendManual} disabled={sending || !reply.trim()}>{sending ? "…" : "Send"}</Btn>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────
// DEMANDS SCREEN — staff primary view
// ──────────────────────────────────────────────────────────
function DemandsScreen({ funnels, allTags }) {
  const [demands, setDemands] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [selectedDemand, setSelectedDemand] = useState(null);
  const [filterStep, setFilterStep] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [filterSource, setFilterSource] = useState(""); // "" | "walk_in" | "wa_bot"
  const [filterTemp, setFilterTemp] = useState(""); // "" | hot|warm|cold|converted|dead
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [addingWalkin, setAddingWalkin] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkStaffId, setBulkStaffId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkStaff, setBulkStaff] = useState([]);
  const [mergeModal, setMergeModal] = useState(null); // { primaryId, secondaryId }
  useEffect(() => {
    sb.from("staff").select("id,name,username,role,app_permissions").eq("tenant_id", getTenantId()).order("name")
      .then(({ data }) => setBulkStaff(data || []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    let q = sb
      .from("bullion_demands")
      .select("*, lead:bullion_leads(id,name,phone,wa_display_name,status,bot_paused,funnel_id,stage,last_msg,last_msg_at,updated_at,source,is_client,tags), step:bullion_funnel_steps(id,name,step_type)")
      .eq("tenant_id", getTenantId())
      .order("occasion_date", { ascending: true, nullsFirst: false });
    if (filterStep) q = q.eq("fms_step_id", filterStep);
    if (filterCat) q = q.eq("product_category", filterCat);
    const { data, error } = await q;
    if (error) { console.error("demands load error", error); }
    // Sort by temperature bucket: hot → warm → cold → converted → dead
    // Within each bucket, prefer urgent occasion dates and most recent activity.
    const sorted = (data || []).sort((a, b) => {
      const ta = tempRank(demandTemperature(a));
      const tb = tempRank(demandTemperature(b));
      if (ta !== tb) return ta - tb;
      const da = a.occasion_date ? new Date(a.occasion_date) - new Date() : Infinity;
      const db = b.occasion_date ? new Date(b.occasion_date) - new Date() : Infinity;
      if (da !== db) return da - db;
      return new Date(b.updated_at) - new Date(a.updated_at);
    });
    setDemands(sorted);
    setLoading(false);
  }, [filterStep, filterCat]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const filtered = useMemo(() => {
    // Supplier / vendor / karigar messages are inbound to your WA but they
    // aren't sales enquiries — exclude them from the Demands list always.
    const SUPPLIER_SOURCES = new Set(["seller_enquiry", "supplier", "vendor", "karigar", "wholesale", "kariger"]);
    let rows = demands.filter((d) => !SUPPLIER_SOURCES.has(d.lead?.source));
    // Hide closed demands by default (unless temp filter explicitly asks for converted/dead).
    // Old demands have outcome=null but lead.status='converted'/'dead' — check both signals.
    if (!["converted", "dead"].includes(filterTemp)) {
      rows = rows.filter((d) =>
        !["converted", "lost", "junk"].includes(d.outcome) &&
        !["converted", "dead"].includes(d.lead?.status)
      );
    }
    if (filterSource === "walk_in") {
      rows = rows.filter((d) => d.lead?.source === "walk_in");
    } else if (filterSource === "wa_bot") {
      rows = rows.filter((d) => d.lead?.source !== "walk_in");
    }
    if (filterTemp) rows = rows.filter((d) => demandTemperature(d) === filterTemp);
    if (!search) return rows;
    const s = search.toLowerCase();
    return rows.filter((d) =>
      (d.lead?.name || "").toLowerCase().includes(s) ||
      (d.lead?.wa_display_name || "").toLowerCase().includes(s) ||
      (d.lead?.phone || "").includes(s) ||
      (d.description || "").toLowerCase().includes(s) ||
      (d.ai_summary || "").toLowerCase().includes(s) ||
      (d.occasion || "").toLowerCase().includes(s)
    );
  }, [demands, search, filterSource, filterTemp]);

  const selectedLead = selectedLeadId ? demands.find((d) => d.lead?.id === selectedLeadId)?.lead : null;
  const selectedFunnel = selectedLead ? funnels.find((f) => f.id === selectedLead.funnel_id) : null;

  const urgencyBorder = (d) => {
    if (!d.occasion_date) return "#eee";
    const days = Math.round((new Date(d.occasion_date) - new Date()) / 86400000);
    if (days < 0) return C.gray;
    if (days < 7) return C.red;
    if (days < 30) return C.orange;
    return "#eee";
  };

  const urgencyLabel = (d) => {
    if (!d.occasion_date) return null;
    const days = Math.round((new Date(d.occasion_date) - new Date()) / 86400000);
    if (days < 0) return { text: "Overdue", color: C.gray };
    if (days === 0) return { text: "Today!", color: C.red };
    if (days < 7) return { text: `${days}d left`, color: C.red };
    if (days < 30) return { text: `${days}d`, color: C.orange };
    return { text: `${days}d`, color: C.gray };
  };

  const bulkReassign = async () => {
    if (!bulkStaffId || bulkSelected.size === 0) return;
    setBulkBusy(true);
    const picked = bulkStaff.find((s) => s.id === bulkStaffId);
    const ids = [...bulkSelected];
    await sb.from("bullion_demands").update({
      assigned_staff_id: bulkStaffId,
      assigned_to: picked?.name || picked?.username || null,
      updated_at: new Date().toISOString(),
    }).in("id", ids);
    setBulkSelected(new Set());
    setBulkStaffId("");
    setBulkBusy(false);
    load();
  };

  const advanceStep = async (demand) => {
    const funnelId = demand.funnel_id;
    if (!funnelId) return;
    const { data: steps } = await sb
      .from("bullion_funnel_steps")
      .select("id,name,step_order,step_type")
      .eq("funnel_id", funnelId)
      .eq("tenant_id", getTenantId())
      .eq("active", true)
      .order("step_order", { ascending: true });
    if (!steps?.length) return;
    const curIdx = steps.findIndex((s) => s.id === demand.fms_step_id);
    const nextStep = steps[curIdx + 1] || null;
    if (nextStep) {
      await sb.from("bullion_demands").update({ fms_step_id: nextStep.id, updated_at: new Date().toISOString() }).eq("id", demand.id);
      load();
    }
  };

  // Roll back to the previous active step. Cancels any pending drip messages
  // queued for the step we're leaving so they don't fire after the rollback.
  // Call logs are kept intact (audit history).
  const rollbackStep = async (demand) => {
    const funnelId = demand.funnel_id;
    if (!funnelId) return;
    const { data: steps } = await sb
      .from("bullion_funnel_steps")
      .select("id,name,step_order,step_type")
      .eq("funnel_id", funnelId)
      .eq("tenant_id", getTenantId())
      .eq("active", true)
      .order("step_order", { ascending: true });
    if (!steps?.length) return;
    const curIdx = steps.findIndex((s) => s.id === demand.fms_step_id);
    if (curIdx <= 0) { alert("Already on the first step — nothing to roll back."); return; }
    if (!window.confirm("Roll back to the previous step? Pending drip messages for the current step will be cancelled. Call logs are kept.")) return;
    const prevStep = steps[curIdx - 1];
    await sb.from("bullion_demands").update({ fms_step_id: prevStep.id, updated_at: new Date().toISOString() }).eq("id", demand.id);
    // Cancel any pending drip rows so the just-abandoned step doesn't keep firing.
    await sb.from("bullion_scheduled_messages")
      .update({ status: "canceled", canceled_reason: "step_rollback" })
      .eq("lead_id", demand.lead_id).eq("status", "pending");
    load();
  };

  return (
    <div style={{ display: "block" }}>
      {mergeModal && (
        <MergeLeadsModal
          primaryId={mergeModal.primaryId}
          secondaryId={mergeModal.secondaryId}
          onClose={() => setMergeModal(null)}
          onMerged={() => { setMergeModal(null); load(); }}
        />
      )}
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <Input placeholder="Search name / phone / description" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: "1 1 180px" }} />
          <Select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} style={{ width: 130 }}>
            <option value="">All products</option>
            {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select value={filterSource} onChange={(e) => setFilterSource(e.target.value)} style={{ width: 130 }}>
            <option value="">All sources</option>
            <option value="walk_in">🏪 Walk-ins only</option>
            <option value="wa_bot">📱 WA / other</option>
          </Select>
          <Select value={filterTemp} onChange={(e) => setFilterTemp(e.target.value)} style={{ width: 130 }}>
            <option value="">All temps</option>
            <option value="hot">🔥 Hot</option>
            <option value="warm">🌤 Warm</option>
            <option value="cold">❄️ Cold</option>
            <option value="converted">✅ Converted</option>
            <option value="dead">💀 Dead</option>
          </Select>
          <Btn ghost small color={C.gray} onClick={load}>↻</Btn>
          <Btn small color="#16a085" onClick={() => setAddingWalkin(true)} style={{ color: "#fff" }}>+ Walk-in</Btn>
          <Btn small color={C.blue} onClick={() => setAdding(true)}>+ New Demand</Btn>
        </div>

        {adding && (
          <DemandEntryModal
            funnels={funnels}
            onClose={() => setAdding(false)}
            onSaved={() => { setAdding(false); load(); }}
          />
        )}
        {addingWalkin && (
          <WalkinEntryModal
            funnels={funnels}
            allTags={allTags}
            onClose={() => setAddingWalkin(false)}
            onSaved={() => { setAddingWalkin(false); load(); }}
          />
        )}

        <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
          {loading ? "Loading…" : `${filtered.length} demand${filtered.length === 1 ? "" : "s"}`}
        </div>

        {/* Bulk reassign floating bar */}
        {bulkSelected.size > 0 && (
          <div style={{ position: "sticky", top: 0, zIndex: 20, background: "#1e3a8a", color: "#fff", borderRadius: 10, padding: "10px 14px", marginBottom: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", boxShadow: "0 4px 12px rgba(0,0,0,0.2)" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>☑ {bulkSelected.size} selected</span>
            <select value={bulkStaffId} onChange={(e) => setBulkStaffId(e.target.value)}
              style={{ flex: 1, minWidth: 140, borderRadius: 6, padding: "4px 8px", fontSize: 12, border: "none" }}>
              <option value="">— assign to —</option>
              {bulkStaff.filter((s) => s.role === "telecaller" || (s.app_permissions?.fms || []).includes("telecaller"))
                .map((s) => <option key={s.id} value={s.id}>{s.name || s.username}</option>)}
              {bulkStaff.filter((s) => s.role !== "telecaller" && !(s.app_permissions?.fms || []).includes("telecaller"))
                .map((s) => <option key={s.id} value={s.id}>{s.name || s.username} ({s.role})</option>)}
            </select>
            <Btn small color={C.green} onClick={bulkReassign} disabled={!bulkStaffId || bulkBusy}>{bulkBusy ? "Assigning…" : "Assign all"}</Btn>
            <Btn small ghost color="#fff" onClick={() => setBulkSelected(new Set())}>✕ Clear</Btn>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.map((d) => {
            const urg = urgencyLabel(d);
            const sel = d.lead?.id === selectedLeadId;
            const isBulkChecked = bulkSelected.has(d.id);
            const isVip = d.lead?.is_client || d.crm_source === "old_client" || d.lead?.source === "old_client";
            const stepName = d.step?.name || "—";
            const isCallStep = d.step?.step_type === "call";
            const attempts = d.call_attempts || 0;
            const cadenceColor = attempts >= 5 ? C.red : attempts >= 4 ? C.orange : C.gray;
            const overdue = d.next_call_at && new Date(d.next_call_at) < new Date();
            return (
              <React.Fragment key={d.id}>
                <div style={{ position: "relative" }}>
                {/* Bulk-select checkbox */}
                <input type="checkbox" checked={isBulkChecked}
                  onChange={(e) => { e.stopPropagation(); setBulkSelected((prev) => { const next = new Set(prev); e.target.checked ? next.add(d.id) : next.delete(d.id); return next; }); }}
                  style={{ position: "absolute", top: 10, left: 8, zIndex: 2, width: 15, height: 15, cursor: "pointer" }} />
                <div
                  onClick={() => {
                    if (sel) { setSelectedLeadId(null); setSelectedDemand(null); }
                    else { setSelectedLeadId(d.lead?.id || null); setSelectedDemand(d); }
                  }}
                  style={{
                    padding: 10,
                    paddingLeft: 28,
                    background: sel ? "#eef5ff" : isBulkChecked ? "#f0f7ff" : "#fff",
                    border: `2px solid ${sel ? C.blue : isBulkChecked ? C.blue : urgencyBorder(d)}`,
                    borderRadius: 10,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <strong style={{ fontSize: 13 }}>{d.lead?.name || (isLid(d.lead?.phone) ? (d.lead?.wa_display_name || displayPhone(d.lead?.phone)) : d.lead?.phone) || "Unknown"}</strong>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {(() => { const t = demandTemperature(d); const m = tempMeta(t); return <Pill color={m.color} solid>{m.label}{d.temperature_override ? " 📌" : ""}</Pill>; })()}
                      {isVip && <Pill color="#d97706" solid>⭐ VIP</Pill>}
                      {(d.lead?.source === "walk_in") && <Pill color="#16a085" solid>🏪 Walk-in</Pill>}
                      {urg && <Pill color={urg.color} solid>{urg.text}</Pill>}
                      {isCallStep && <Pill color={overdue ? C.red : cadenceColor} solid>📞 {overdue ? "OVERDUE " : ""}{attempts}/6</Pill>}
                      {!isCallStep && <Pill color={C.blue}>🤖 Bot</Pill>}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "#555", marginBottom: 3 }}>
                    {d.description || "(no description)"}
                    {d.for_whom ? <span style={{ color: "#888" }}> · for {d.for_whom}</span> : ""}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Pill color={C.purple}>{d.product_category || "?"}</Pill>
                      {d.occasion && <Pill color={C.orange}>{d.occasion}</Pill>}
                      {d.budget && <Pill color={C.gray}>₹{Number(d.budget).toLocaleString("en-IN")}</Pill>}
                      {d.visit_scheduled_at && (() => {
                        const vdays = Math.round((new Date(d.visit_scheduled_at) - new Date()) / 86400000);
                        const color = vdays < 0 ? "#999" : vdays === 0 ? C.red : vdays <= 2 ? C.orange : C.green;
                        const label = vdays < 0 ? "Visit passed" : vdays === 0 ? "Visit TODAY" : `Visit in ${vdays}d`;
                        return <Pill color={color} solid>🏪 {label}{d.visit_confirmed ? " ✓" : ""}</Pill>;
                      })()}
                    </div>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      {d.assigned_to && <Pill color={C.blue}>👤 {d.assigned_to}</Pill>}
                      <span style={{ fontSize: 11, color: C.gray }}>{stepName}</span>
                      <span style={{ fontSize: 10, color: "#aaa" }}>{fmtDT(d.updated_at)}</span>
                    </div>
                  </div>
                </div>
                </div>{/* end position:relative wrapper */}
                {sel && selectedLead && selectedDemand?.id === d.id && (
                  <ConversationPane
                    lead={selectedLead}
                    funnel={selectedFunnel}
                    onClose={() => { setSelectedLeadId(null); setSelectedDemand(null); }}
                    onChanged={load}
                    allTags={allTags}
                    demand={selectedDemand}
                    onAdvanceStep={d.step?.step_type !== "call" ? () => advanceStep(d) : null}
                    onRollbackStep={() => rollbackStep(d)}
                    onMergeDuplicate={() => {
                      const secId = window.prompt("Enter the duplicate lead ID to merge into this record (find it in Contacts tab):");
                      if (secId?.trim()) setMergeModal({ primaryId: d.lead?.id, secondaryId: secId.trim() });
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}
          {!filtered.length && !loading && (
            <div style={{ padding: 20, textAlign: "center", color: "#aaa", fontSize: 13 }}>
              No active demands. Click "+ New Demand" to add one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// DEMAND ENTRY MODAL — create new demand + activate bot
// ──────────────────────────────────────────────────────────
function DemandEntryModal({ funnels, onClose, onSaved }) {
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedContact, setSelectedContact] = useState(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activateBot, setActivateBot] = useState(true);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [staff, setStaff] = useState([]);
  useEffect(() => {
    sb.from("staff").select("id,name,username,role")
      .eq("tenant_id", getTenantId())
      .order("name")
      .then(({ data }) => setStaff(data || []));
  }, []);

  const [jewExpanded, setJewExpanded] = useState(false);
  const [exExpanded, setExExpanded] = useState(false);
  const [form, setForm] = useState({
    phone: "", name: "",
    description: "", productCategory: "gold", productTypes: [],
    estimate: "", occasion: "", occasionDate: "", forWhom: "",
    visitScheduledAt: "",
    funnelId: "",
    crmSource: "",
    assignedStaffId: loadUser()?.id || "",
    // Jewelry fields
    metal: "", stone: "", itemCategory: "", ringSize: "", purity: "", hallmarkPref: "",
    // Exchange
    hasExchange: false, exchangeDesc: "", exchangeValue: "",
  });

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const toggleProductType = (t) => setForm((s) => ({ ...s, productTypes: s.productTypes.includes(t) ? s.productTypes.filter((x) => x !== t) : [...s.productTypes, t] }));

  const doSearch = useCallback(async (q) => {
    if (!q || q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const isPhone = /^\d+$/.test(q);
    let query = sb.from("bullion_leads").select("id,name,phone,city,client_rating,last_msg_at").eq("tenant_id", getTenantId());
    if (isPhone) {
      query = query.ilike("phone", `%${q}%`);
    } else {
      query = query.ilike("name", `%${q}%`);
    }
    const { data } = await query.limit(5);
    setSearchResults(data || []);
    setSearching(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => doSearch(searchQ), 300);
    return () => clearTimeout(t);
  }, [searchQ, doSearch]);

  const pickContact = (c) => {
    setSelectedContact(c);
    setForm((s) => ({ ...s, phone: c.phone, name: c.name || "" }));
    setSearchQ("");
    setSearchResults([]);
  };

  const walkinFunnel = funnels.find((f) => f.active && (/walk[\s_-]?in/i.test(f.id) || /walk[\s_-]?in/i.test(f.name || "")));

  const autoFunnel = () => {
    return walkinFunnel?.id
      || funnels.find((f) => f.active)?.id
      || funnels[0]?.id
      || "";
  };

  // Pre-select walk-in funnel as soon as funnels load
  useEffect(() => {
    if (!form.funnelId && funnels.length) set("funnelId", autoFunnel());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funnels.length]);

  const handleCatChange = (cat) => {
    set("productCategory", cat);
  };

  const save = async () => {
    setErr("");
    const phone = String(form.phone || "").replace(/\D/g, "").replace(/^0+/, "").replace(/^91/, "");
    if (!phone) return setErr("Phone number is required.");
    if (!form.description) return setErr("Description is required.");
    setSaving(true);
    try {
      const res = await fetch("/api/demand", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-crm-secret": CRM_SECRET },
        body: JSON.stringify({
          phone,
          name: form.name || null,
          description: form.description,
          productCategory: form.productCategory,
          productTypes: form.productTypes,
          budget: form.estimate ? Number(form.estimate) : null,
          occasion: form.occasion || null,
          occasionDate: form.occasionDate || null,
          forWhom: form.forWhom || null,
          visitScheduledAt: form.visitScheduledAt ? new Date(form.visitScheduledAt).toISOString() : null,
          funnelId: form.funnelId || autoFunnel(form.productCategory),
          leadId: selectedContact?.id || null,
          assignedStaffId: form.assignedStaffId || null,
          assignedTo: form.assignedStaffId
            ? (staff.find((s) => s.id === form.assignedStaffId)?.name || null)
            : null,
          crmSource: form.crmSource || null,
          createdBy: loadUser()?.name || loadUser()?.username || null,
          tenantId: getTenantId(),
          skipBot: !activateBot,
          allowDuplicate: allowDuplicate || false,
          metal: form.metal || null,
          stone: form.stone || null,
          itemCategory: form.itemCategory || null,
          ringSize: form.ringSize || null,
          purity: form.purity || null,
          hallmarkPref: form.hallmarkPref || null,
          hasExchange: form.hasExchange || false,
          exchangeDesc: form.exchangeDesc || null,
          exchangeValue: form.exchangeValue ? Number(form.exchangeValue) : null,
        }),
      });
      const data = await res.json();
      if (!data.ok && data.error === "duplicate_demand") {
        setErr("This contact already has an active demand open. Close or deactivate the existing demand first, or tick \"Allow duplicate\" to create another.");
        setSaving(false);
        return;
      }
      if (!data.ok) { setErr(data.error || "Failed to create demand."); setSaving(false); return; }
      if (activateBot && data.waError) {
        setToast(`Demand saved but WA send failed: ${data.waError}. Number: ${data.waNumber || "unknown"}`);
      } else {
        let msg = activateBot ? `Demand created. Opening message sent from ${data.waNumber || "WA"}.` : "Demand saved.";
        if (data.duplicateLeadWarning) msg += ` ⚠️ Another record exists for this phone (${data.duplicateLeadWarning.existingName}) — consider merging from Contacts.`;
        setToast(msg);
      }
      setTimeout(() => { onSaved(); }, 3000);
    } catch (e) {
      setErr(String(e));
      setSaving(false);
    }
  };

  return (
    <Modal title="New Demand" onClose={onClose} width={600}>
      {toast ? (
        <div style={{ padding: 20, textAlign: "center", color: C.green, fontSize: 14 }}>
          ✅ {toast}
        </div>
      ) : (
        <>
          {/* Contact search */}
          <Field label="Search client by name or phone">
            <div style={{ position: "relative" }}>
              <Input
                value={selectedContact ? `${selectedContact.name || selectedContact.phone} · ${selectedContact.phone}` : searchQ}
                onChange={(e) => { if (selectedContact) { setSelectedContact(null); setForm((s) => ({ ...s, phone: "", name: "" })); } setSearchQ(e.target.value); }}
                onKeyDown={(e) => { if (e.key === "Escape" || e.key === "Enter" || e.key === "Tab") setSearchResults([]); }}
                onBlur={() => setTimeout(() => setSearchResults([]), 150)}
                placeholder="Type name or 10-digit phone..."
              />
              {selectedContact && (
                <button onClick={() => { setSelectedContact(null); setSearchQ(""); setForm((s) => ({ ...s, phone: "", name: "" })); }}
                  style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", color: C.red, cursor: "pointer", fontSize: 16 }}>×</button>
              )}
              {searchResults.length > 0 && !selectedContact && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #ddd", borderRadius: 8, zIndex: 10, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                  {searchResults.map((c) => (
                    <div key={c.id} onMouseDown={() => pickContact(c)} style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid #f0f0f0" }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "#f5f5f5"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                      <strong>{c.name || "(no name)"}</strong> · {c.phone}
                      {c.city && <span style={{ color: "#888" }}> · {c.city}</span>}
                    </div>
                  ))}
                  <div style={{ padding: "8px 12px", fontSize: 12, color: "#888" }}>Not found above? Fill phone manually below.</div>
                </div>
              )}
              {searching && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#aaa" }}>searching…</span>}
            </div>
          </Field>

          {!selectedContact && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Phone" required><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="9876543210" /></Field>
              <Field label="Name"><Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Client name" /></Field>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Product category" required>
              <Select value={form.productCategory} onChange={(e) => handleCatChange(e.target.value)}>
                {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="For whom">
              <Select value={form.forWhom} onChange={(e) => set("forWhom", e.target.value)}>
                <option value="">— select —</option>
                {FOR_WHOM_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            </Field>
          </div>

          <Field label="Description — what exactly are they looking for?" required>
            <Textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)}
              placeholder="e.g. Polki necklace set for wedding, traditional Rajasthani style..." />
          </Field>

          <Field label="Product type — pick all that apply">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 0" }}>
              {PRODUCT_TYPES.map((p) => {
                const active = form.productTypes.includes(p);
                return (
                  <button key={p} type="button" onClick={() => toggleProductType(p)}
                    style={{ padding: "4px 12px", borderRadius: 16, fontSize: 12, cursor: "pointer",
                             border: `1px solid ${active ? C.blue : "#ddd"}`,
                             background: active ? C.blue : "transparent",
                             color: active ? "#fff" : "#555",
                             fontWeight: active ? 600 : 400 }}>
                    {p}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Jewelry details — collapsible */}
          <div style={{ border: "1px solid #eee", borderRadius: 8, marginBottom: 8 }}>
            <button type="button" onClick={() => setJewExpanded((v) => !v)}
              style={{ width: "100%", padding: "8px 12px", background: "#fafafa", border: "none", borderRadius: 8, textAlign: "left", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#555" }}>
              💎 Jewelry Details {jewExpanded ? "▲" : "▼"}
            </button>
            {jewExpanded && (
              <div style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <Field label="Metal">
                  <Select value={form.metal} onChange={(e) => set("metal", e.target.value)}>
                    <option value="">—</option>
                    <option value="gold_22k">Gold 22k</option>
                    <option value="gold_18k">Gold 18k</option>
                    <option value="gold_14k">Gold 14k</option>
                    <option value="white_gold">White Gold</option>
                    <option value="platinum">Platinum</option>
                    <option value="silver">Silver</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
                <Field label="Stone">
                  <Select value={form.stone} onChange={(e) => set("stone", e.target.value)}>
                    <option value="">—</option>
                    <option value="none">None</option>
                    <option value="diamond">Diamond</option>
                    <option value="ruby">Ruby</option>
                    <option value="emerald">Emerald</option>
                    <option value="sapphire">Sapphire</option>
                    <option value="pearl">Pearl</option>
                    <option value="kundan">Kundan</option>
                    <option value="polki">Polki</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
                <Field label="Category">
                  <Select value={form.itemCategory} onChange={(e) => set("itemCategory", e.target.value)}>
                    <option value="">—</option>
                    <option value="ring">Ring</option>
                    <option value="necklace">Necklace</option>
                    <option value="earrings">Earrings</option>
                    <option value="bangles">Bangles</option>
                    <option value="bracelet">Bracelet</option>
                    <option value="pendant">Pendant</option>
                    <option value="set">Set</option>
                    <option value="anklet">Anklet</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
                {form.itemCategory === "ring" && (
                  <Field label="Ring size">
                    <Input value={form.ringSize} onChange={(e) => set("ringSize", e.target.value)} placeholder="e.g. 6, 6.5, 7" />
                  </Field>
                )}
                <Field label="Purity">
                  <Select value={form.purity} onChange={(e) => set("purity", e.target.value)}>
                    <option value="">—</option>
                    <option value="916">916 (22k)</option>
                    <option value="750">750 (18k)</option>
                    <option value="585">585 (14k)</option>
                    <option value="925">925 (Silver)</option>
                    <option value="999">999 (Fine)</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
                <Field label="Hallmark pref">
                  <Select value={form.hallmarkPref} onChange={(e) => set("hallmarkPref", e.target.value)}>
                    <option value="">—</option>
                    <option value="bis_hallmark">BIS Hallmark</option>
                    <option value="none">None</option>
                    <option value="client_choice">Client's choice</option>
                  </Select>
                </Field>
              </div>
            )}
          </div>

          {/* Exchange / trade-in — collapsible */}
          <div style={{ border: "1px solid #eee", borderRadius: 8, marginBottom: 8 }}>
            <button type="button" onClick={() => setExExpanded((v) => !v)}
              style={{ width: "100%", padding: "8px 12px", background: "#fafafa", border: "none", borderRadius: 8, textAlign: "left", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#555" }}>
              🔄 Trade-In / Exchange {exExpanded ? "▲" : "▼"}
            </button>
            {exExpanded && (
              <div style={{ padding: "10px 12px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={form.hasExchange} onChange={(e) => set("hasExchange", e.target.checked)} />
                  <span>Client has old jewelry to exchange / trade in</span>
                </label>
                {form.hasExchange && (
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
                    <Field label="Describe old item (type, weight, condition)">
                      <Textarea rows={2} value={form.exchangeDesc} onChange={(e) => set("exchangeDesc", e.target.value)}
                        placeholder="e.g. 22k gold chain ~15g, good condition" />
                    </Field>
                    <Field label="Estimated value (₹)">
                      <Input type="number" value={form.exchangeValue} onChange={(e) => set("exchangeValue", e.target.value)} placeholder="45000" />
                    </Field>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Occasion">
              <Select value={form.occasion} onChange={(e) => set("occasion", e.target.value)}>
                <option value="">— select —</option>
                {OCCASION_TYPES.map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            </Field>
            <Field label="Occasion date (when needed by)">
              <Input type="date" value={form.occasionDate} onChange={(e) => set("occasionDate", e.target.value)} />
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Estimate (₹)">
              <Input type="number" value={form.estimate} onChange={(e) => set("estimate", e.target.value)} placeholder="150000" />
            </Field>
            <Field label="Funnel">
              <Select value={form.funnelId || autoFunnel(form.productCategory)} onChange={(e) => set("funnelId", e.target.value)}>
                {funnels.filter((f) => f.active).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
              {(() => {
                const fid = form.funnelId || autoFunnel(form.productCategory);
                const f = funnels.find((x) => x.id === fid);
                return f?.wa_number ? <div style={{ fontSize: 11, color: "#555", marginTop: 3 }}>📱 Sends from: <strong>{f.wa_number}</strong></div> : null;
              })()}
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Attended by (salesperson)">
              <Select value={form.assignedStaffId} onChange={(e) => set("assignedStaffId", e.target.value)}>
                <option value="">— select salesperson —</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name || s.username} · @{s.username}</option>)}
              </Select>
            </Field>
            <Field label="CRM source (how did they find us?)">
              <Select value={form.crmSource} onChange={(e) => set("crmSource", e.target.value)}>
                <option value="">— select source —</option>
                <option value="online_google">🔍 Google / SEO</option>
                <option value="online_instagram">📸 Instagram</option>
                <option value="online_other">🌐 Other online</option>
                <option value="walkin">🏪 Walk-in</option>
                <option value="referral">🤝 Referral</option>
                <option value="old_client">⭐ Old client</option>
                <option value="exhibition">🎪 Exhibition / event</option>
                <option value="broadcast">📢 Broadcast</option>
                <option value="other">❓ Other</option>
              </Select>
            </Field>
          </div>

          <Field label="Showroom visit scheduled (if client has given a date/time)">
            <Input type="datetime-local" value={form.visitScheduledAt} onChange={(e) => set("visitScheduledAt", e.target.value)} />
          </Field>

          {err && <p style={{ fontSize: 12, color: C.red, margin: "0 0 12px" }}>{err}</p>}

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={activateBot} onChange={(e) => setActivateBot(e.target.checked)} />
            <span>Send opening WhatsApp message & activate bot</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 12, cursor: "pointer", color: "#888" }}>
            <input type="checkbox" checked={allowDuplicate} onChange={(e) => setAllowDuplicate(e.target.checked)} />
            <span>Allow duplicate (contact already has an open demand)</span>
          </label>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <Btn ghost color={C.gray} onClick={onClose}>Cancel</Btn>
            <Btn color={C.blue} onClick={save} disabled={saving}>{saving ? "Creating…" : activateBot ? "Save & Activate Bot" : "Save Demand"}</Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────
// WALK-IN ENTRY MODAL — full contact details + optional demand
// Saves contact (bullion_leads) with source=walk_in + tag walk_in,
// then optionally records a demand. Bot is OFF by default (client is in store).
// ──────────────────────────────────────────────────────────
function WalkinEntryModal({ funnels, allTags = [], onClose, onSaved }) {
  const sourceTags = allTags.filter((t) => t.category === "source").map((t) => t.name);
  const otherTags = allTags.filter((t) => t.category !== "source").map((t) => t.name);

  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedContact, setSelectedContact] = useState(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createDemand, setCreateDemand] = useState(true);
  const [activateBot, setActivateBot] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [dupContact, setDupContact] = useState(null); // existing contact with same phone
  const [editingContact, setEditingContact] = useState(null); // when user wants to fix the dup contact's name/details

  const walkinFunnel = funnels.find((f) => f.active && (/walk[\s_-]?in/i.test(f.id) || /walk[\s_-]?in/i.test(f.name || "")));

  const [staff, setStaff] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [refImageUrl, setRefImageUrl] = useState("");

  useEffect(() => {
    sb.from("staff").select("id,name,username,role")
      .eq("tenant_id", getTenantId())
      .order("name")
      .then(({ data }) => setStaff(data || []));
  }, []);

  const [form, setForm] = useState({
    // contact
    name: "", phone: "", city: "", email: "",
    bday: "", anniversary: "", client_rating: "",
    is_client: false, wedding_date: "", wedding_family_member: "",
    source: "walk_in", tags: ["walk_in"], discoverySource: "",
    // demand (optional)
    description: "", productCategory: "gold", productTypes: [],
    estimate: "", occasion: "", occasionDate: "", forWhom: "",
    visitScheduledAt: "", funnelId: walkinFunnel?.id || "",
    assignedStaffId: "",
    // visit tracking
    partySize: "", inTime: "", outTime: "",
    itemsSeen: [], priceQuoted: "",
    notBoughtReason: "", notBoughtNotes: "",
    competitorMentioned: "", followupRequired: false,
    // Jewelry fields
    metal: "", stone: "", itemCategory: "", ringSize: "", purity: "", hallmarkPref: "",
    // Exchange
    hasExchange: false, exchangeDesc: "", exchangeValue: "",
  });

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const toggleTag = (tag) => setForm((s) => ({ ...s, tags: s.tags.includes(tag) ? s.tags.filter((t) => t !== tag) : [...s.tags, tag] }));
  const toggleProductType = (t) => setForm((s) => ({ ...s, productTypes: s.productTypes.includes(t) ? s.productTypes.filter((x) => x !== t) : [...s.productTypes, t] }));
  const toggleItemSeen = (t) => setForm((s) => ({ ...s, itemsSeen: s.itemsSeen.includes(t) ? s.itemsSeen.filter((x) => x !== t) : [...s.itemsSeen, t] }));

  const uploadDesignRef = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const path = `walkin-refs/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await sb.storage.from("media").upload(path, file, { upsert: true });
      if (error) { alert(`Upload failed: ${error.message}`); setUploading(false); return; }
      const { data: pub } = sb.storage.from("media").getPublicUrl(path);
      setRefImageUrl(pub.publicUrl);
    } finally {
      setUploading(false);
    }
  };

  // pre-pick walk-in funnel once funnels load
  useEffect(() => {
    if (!form.funnelId && walkinFunnel?.id) set("funnelId", walkinFunnel.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funnels.length]);

  const doSearch = useCallback(async (q) => {
    if (!q || q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const isPhone = /^\d+$/.test(q);
    let query = sb.from("bullion_leads").select("id,name,phone,city,client_rating,last_msg_at,source,tags").eq("tenant_id", getTenantId());
    query = isPhone ? query.ilike("phone", `%${q}%`) : query.ilike("name", `%${q}%`);
    const { data } = await query.limit(5);
    setSearchResults(data || []);
    setSearching(false);
  }, []);

  useEffect(() => { const t = setTimeout(() => doSearch(searchQ), 300); return () => clearTimeout(t); }, [searchQ, doSearch]);

  const pickContact = (c) => {
    setSelectedContact(c);
    setForm((s) => ({
      ...s,
      name: c.name || "", phone: c.phone || "", city: c.city || "",
      client_rating: c.client_rating || "",
      tags: Array.from(new Set([...(c.tags || []), "walk_in"])),
      source: c.source || "walk_in",
    }));
    setSearchQ(""); setSearchResults([]);
  };

  const save = async () => {
    setErr("");
    setDupContact(null);
    const phone = String(form.phone || "").replace(/\D/g, "").replace(/^0+/, "").replace(/^91/, "");
    if (!phone) return setErr("Phone number is required.");
    if (createDemand && !form.description) return setErr("Description is required when creating a demand.");
    setSaving(true);

    try {
      // 1) Upsert contact (bullion_leads)
      const tenantId = getTenantId();
      const tags = Array.from(new Set([...(form.tags || []), "walk_in"]));
      const contactPayload = {
        tenant_id: tenantId,
        phone,
        name: form.name || null,
        city: form.city || null,
        email: form.email || null,
        bday: form.bday || null,
        anniversary: form.anniversary || null,
        client_rating: form.client_rating ? Number(form.client_rating) : null,
        is_client: !!form.is_client,
        wedding_date: form.wedding_date || null,
        wedding_family_member: form.wedding_family_member || null,
        source: form.source || "walk_in",
        tags,
        updated_at: new Date().toISOString(),
      };

      let leadId = selectedContact?.id || null;
      if (leadId) {
        const { error } = await sb.from("bullion_leads").update(contactPayload).eq("id", leadId);
        if (error) { setErr(error.message); setSaving(false); return; }
      } else {
        // Block on duplicate phone — force user to pick the existing contact
        const { data: existing } = await sb.from("bullion_leads")
          .select("id,name,phone,city,client_rating,source,tags")
          .eq("tenant_id", tenantId).eq("phone", phone).maybeSingle();
        if (existing?.id) {
          setDupContact(existing);
          setSaving(false);
          return;
        }
        {
          const { data: ins, error } = await sb.from("bullion_leads")
            .insert({ ...contactPayload, status: "new", funnel_id: form.funnelId || walkinFunnel?.id || "bullion" })
            .select("id").single();
          if (error) { setErr(error.message); setSaving(false); return; }
          leadId = ins.id;
        }
      }

      // 2) Optionally create demand
      if (createDemand) {
        const res = await fetch("/api/demand", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-crm-secret": CRM_SECRET },
          body: JSON.stringify({
            phone, name: form.name || null,
            description: form.description,
            productCategory: form.productCategory,
            productTypes: form.productTypes,
            budget: form.estimate ? Number(form.estimate) : null,
            occasion: form.occasion || null,
            occasionDate: form.occasionDate || null,
            forWhom: form.forWhom || null,
            visitScheduledAt: form.visitScheduledAt ? new Date(form.visitScheduledAt).toISOString() : null,
            funnelId: form.funnelId || walkinFunnel?.id,
            leadId,
            assignedStaffId: form.assignedStaffId || null,
            assignedTo: form.assignedStaffId
              ? (staff.find((s) => s.id === form.assignedStaffId)?.name || null)
              : null,
            imageUrls: refImageUrl ? [refImageUrl] : [],
            discoverySource: form.discoverySource || null,
            partySize: form.partySize ? Number(form.partySize) : null,
            inTime: form.inTime || null,
            outTime: form.outTime || null,
            itemsSeen: form.itemsSeen,
            priceQuoted: form.priceQuoted ? Number(form.priceQuoted) : null,
            notBoughtReason: form.notBoughtReason || null,
            notBoughtNotes: form.notBoughtNotes || null,
            competitorMentioned: form.competitorMentioned || null,
            followupRequired: !!form.followupRequired,
            createdBy: loadUser()?.name || loadUser()?.username || null,
            tenantId,
            skipBot: !activateBot,
            allowDuplicate: true,
            metal: form.metal || null,
            stone: form.stone || null,
            itemCategory: form.itemCategory || null,
            ringSize: form.ringSize || null,
            purity: form.purity || null,
            hallmarkPref: form.hallmarkPref || null,
            hasExchange: form.hasExchange || false,
            exchangeDesc: form.exchangeDesc || null,
            exchangeValue: form.exchangeValue ? Number(form.exchangeValue) : null,
          }),
        });
        const data = await res.json();
        if (!data.ok) { setErr(data.error || "Demand create failed."); setSaving(false); return; }
      }

      setToast(createDemand ? "Walk-in saved with demand." : "Walk-in contact saved.");
      setTimeout(() => onSaved(), 1500);
    } catch (e) {
      setErr(String(e)); setSaving(false);
    }
  };

  return (
    <Modal title="Walk-in Client Entry" onClose={onClose} width={680}>
      {toast ? (
        <div style={{ padding: 20, textAlign: "center", color: C.green, fontSize: 14 }}>✅ {toast}</div>
      ) : (
        <>
          <Field label="Search existing client by name or phone">
            <div style={{ position: "relative" }}>
              <Input
                value={selectedContact ? `${selectedContact.name || selectedContact.phone} · ${selectedContact.phone}` : searchQ}
                onChange={(e) => { if (selectedContact) setSelectedContact(null); setSearchQ(e.target.value); }}
                onBlur={() => setTimeout(() => setSearchResults([]), 150)}
                placeholder="Type name or 10-digit phone — leave blank to add new"
              />
              {selectedContact && (
                <button onClick={() => { setSelectedContact(null); setSearchQ(""); }}
                  style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", color: C.red, cursor: "pointer", fontSize: 16 }}>×</button>
              )}
              {searchResults.length > 0 && !selectedContact && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #ddd", borderRadius: 8, zIndex: 10, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                  {searchResults.map((c) => (
                    <div key={c.id} onMouseDown={() => pickContact(c)} style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid #f0f0f0" }}>
                      <strong>{c.name || "(no name)"}</strong> · {c.phone}
                      {c.city && <span style={{ color: "#888" }}> · {c.city}</span>}
                    </div>
                  ))}
                </div>
              )}
              {searching && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#aaa" }}>searching…</span>}
            </div>
          </Field>

          <div style={{ fontSize: 12, color: "#666", margin: "10px 0 6px", fontWeight: 600 }}>👤 Contact Details</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Name"><Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Full name" /></Field>
            <Field label="Phone" required><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="9876543210" /></Field>
            <Field label="City"><Input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Delhi" /></Field>
            <Field label="Email"><Input value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="email@example.com" /></Field>
            <Field label="Birthday"><Input type="date" value={form.bday} onChange={(e) => set("bday", e.target.value)} /></Field>
            <Field label="Anniversary"><Input type="date" value={form.anniversary} onChange={(e) => set("anniversary", e.target.value)} /></Field>
            <Field label="Wedding date"><Input type="date" value={form.wedding_date} onChange={(e) => set("wedding_date", e.target.value)} /></Field>
            <Field label="Wedding (family member)"><Input value={form.wedding_family_member} onChange={(e) => set("wedding_family_member", e.target.value)} placeholder="daughter Priya" /></Field>
            <Field label="Rating">
              <Select value={form.client_rating} onChange={(e) => set("client_rating", e.target.value)}>
                <option value="">—</option>
                {[1,2,3,4,5].map((n) => <option key={n} value={n}>{"★".repeat(n)} {n}</option>)}
              </Select>
            </Field>
            <Field label="Source">
              <Select value={form.source} onChange={(e) => set("source", e.target.value)}>
                <option value="walk_in">walk_in</option>
                {sourceTags.filter((s) => s !== "walk_in").map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
          </div>

          {otherTags.length > 0 && (
            <Field label="Tags" style={{ marginTop: 8 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {otherTags.map((tag) => {
                  const active = form.tags.includes(tag);
                  const meta = allTags.find((t) => t.name === tag);
                  return (
                    <button key={tag} onClick={() => toggleTag(tag)} style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, cursor: "pointer", border: `1px solid ${active ? (meta?.color || C.blue) : "#ddd"}`, background: active ? (meta?.color || C.blue) : "transparent", color: active ? "#fff" : "#555", fontWeight: active ? 600 : 400 }}>
                      {tag}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, margin: "8px 0", cursor: "pointer" }}>
            <input type="checkbox" checked={form.is_client} onChange={(e) => set("is_client", e.target.checked)} />
            Mark as known client (has purchased before)
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, margin: "14px 0 6px", cursor: "pointer", fontWeight: 600, color: "#444" }}>
            <input type="checkbox" checked={createDemand} onChange={(e) => setCreateDemand(e.target.checked)} />
            🛒 Also record a demand (purchase enquiry)
          </label>

          {createDemand && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Product category" required>
                  <Select value={form.productCategory} onChange={(e) => set("productCategory", e.target.value)}>
                    {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </Field>
                <Field label="For whom">
                  <Select value={form.forWhom} onChange={(e) => set("forWhom", e.target.value)}>
                    <option value="">— select —</option>
                    {FOR_WHOM_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="Description — what they're looking for" required>
                <Textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)}
                  placeholder="e.g. Wedding necklace set in polki, around 5 lakhs..." />
              </Field>
              <Field label="Product type — pick all that apply">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 0" }}>
                  {PRODUCT_TYPES.map((p) => {
                    const active = form.productTypes.includes(p);
                    return (
                      <button key={p} type="button" onClick={() => toggleProductType(p)}
                        style={{ padding: "4px 12px", borderRadius: 16, fontSize: 12, cursor: "pointer",
                                 border: `1px solid ${active ? C.blue : "#ddd"}`,
                                 background: active ? C.blue : "transparent",
                                 color: active ? "#fff" : "#555",
                                 fontWeight: active ? 600 : 400 }}>
                        {p}
                      </button>
                    );
                  })}
                </div>
              </Field>

              {/* Jewelry details */}
              <div style={{ border: "1px solid #eee", borderRadius: 8, marginBottom: 8 }}>
                <button type="button" onClick={() => set("_jewExp", !form._jewExp)}
                  style={{ width: "100%", padding: "8px 12px", background: "#fafafa", border: "none", borderRadius: 8, textAlign: "left", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#555" }}>
                  💎 Jewelry Details {form._jewExp ? "▲" : "▼"}
                </button>
                {form._jewExp && (
                  <div style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    <Field label="Metal">
                      <Select value={form.metal} onChange={(e) => set("metal", e.target.value)}>
                        <option value="">—</option>
                        <option value="gold_22k">Gold 22k</option><option value="gold_18k">Gold 18k</option>
                        <option value="gold_14k">Gold 14k</option><option value="white_gold">White Gold</option>
                        <option value="platinum">Platinum</option><option value="silver">Silver</option>
                        <option value="other">Other</option>
                      </Select>
                    </Field>
                    <Field label="Stone">
                      <Select value={form.stone} onChange={(e) => set("stone", e.target.value)}>
                        <option value="">—</option>
                        <option value="none">None</option><option value="diamond">Diamond</option>
                        <option value="ruby">Ruby</option><option value="emerald">Emerald</option>
                        <option value="sapphire">Sapphire</option><option value="pearl">Pearl</option>
                        <option value="kundan">Kundan</option><option value="polki">Polki</option>
                        <option value="other">Other</option>
                      </Select>
                    </Field>
                    <Field label="Category">
                      <Select value={form.itemCategory} onChange={(e) => set("itemCategory", e.target.value)}>
                        <option value="">—</option>
                        <option value="ring">Ring</option><option value="necklace">Necklace</option>
                        <option value="earrings">Earrings</option><option value="bangles">Bangles</option>
                        <option value="bracelet">Bracelet</option><option value="pendant">Pendant</option>
                        <option value="set">Set</option><option value="anklet">Anklet</option>
                        <option value="other">Other</option>
                      </Select>
                    </Field>
                    {form.itemCategory === "ring" && (
                      <Field label="Ring size"><Input value={form.ringSize} onChange={(e) => set("ringSize", e.target.value)} placeholder="e.g. 6, 6.5, 7" /></Field>
                    )}
                    <Field label="Purity">
                      <Select value={form.purity} onChange={(e) => set("purity", e.target.value)}>
                        <option value="">—</option>
                        <option value="916">916 (22k)</option><option value="750">750 (18k)</option>
                        <option value="585">585 (14k)</option><option value="925">925 Silver</option>
                        <option value="999">999 Fine</option><option value="other">Other</option>
                      </Select>
                    </Field>
                    <Field label="Hallmark pref">
                      <Select value={form.hallmarkPref} onChange={(e) => set("hallmarkPref", e.target.value)}>
                        <option value="">—</option>
                        <option value="bis_hallmark">BIS Hallmark</option>
                        <option value="none">None</option><option value="client_choice">Client's choice</option>
                      </Select>
                    </Field>
                  </div>
                )}
              </div>

              {/* Exchange / trade-in */}
              <div style={{ border: "1px solid #eee", borderRadius: 8, marginBottom: 8 }}>
                <button type="button" onClick={() => set("_exExp", !form._exExp)}
                  style={{ width: "100%", padding: "8px 12px", background: "#fafafa", border: "none", borderRadius: 8, textAlign: "left", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#555" }}>
                  🔄 Trade-In / Exchange {form._exExp ? "▲" : "▼"}
                </button>
                {form._exExp && (
                  <div style={{ padding: "10px 12px" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 8, cursor: "pointer" }}>
                      <input type="checkbox" checked={form.hasExchange} onChange={(e) => set("hasExchange", e.target.checked)} />
                      <span>Client has old jewelry to exchange / trade in</span>
                    </label>
                    {form.hasExchange && (
                      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
                        <Field label="Describe old item">
                          <Textarea rows={2} value={form.exchangeDesc} onChange={(e) => set("exchangeDesc", e.target.value)} placeholder="e.g. 22k gold chain ~15g" />
                        </Field>
                        <Field label="Est. value (₹)">
                          <Input type="number" value={form.exchangeValue} onChange={(e) => set("exchangeValue", e.target.value)} placeholder="45000" />
                        </Field>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Occasion">
                  <Select value={form.occasion} onChange={(e) => set("occasion", e.target.value)}>
                    <option value="">— select —</option>
                    {OCCASION_TYPES.map((o) => <option key={o} value={o}>{o}</option>)}
                  </Select>
                </Field>
                <Field label="Occasion date"><Input type="date" value={form.occasionDate} onChange={(e) => set("occasionDate", e.target.value)} /></Field>
                <Field label="Estimate (₹)"><Input type="number" value={form.estimate} onChange={(e) => set("estimate", e.target.value)} placeholder="150000" /></Field>
                <Field label="Funnel">
                  <Select value={form.funnelId} onChange={(e) => set("funnelId", e.target.value)}>
                    {funnels.filter((f) => f.active).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </Select>
                </Field>
                <Field label="Attended by">
                  <Select value={form.assignedStaffId} onChange={(e) => set("assignedStaffId", e.target.value)}>
                    <option value="">— select salesperson —</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.name || s.username} · @{s.username}</option>)}
                  </Select>
                </Field>
                <Field label="Where did you find us?">
                  <Select value={form.discoverySource} onChange={(e) => set("discoverySource", e.target.value)}>
                    <option value="">— select —</option>
                    {DISCOVERY_SOURCES.map((d) => <option key={d} value={d}>{d}</option>)}
                  </Select>
                </Field>
              </div>

              <Field label="Design reference (image)">
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="file" accept="image/*" onChange={(e) => uploadDesignRef(e.target.files?.[0])} disabled={uploading}
                    style={{ fontSize: 12, color: "#555" }} />
                  {uploading && <span style={{ fontSize: 11, color: "#888" }}>uploading…</span>}
                  {refImageUrl && (
                    <a href={refImageUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.green }}>
                      ✓ uploaded — preview
                    </a>
                  )}
                </div>
              </Field>

              <Field label="Visit / next appointment">
                <Input type="datetime-local" value={form.visitScheduledAt} onChange={(e) => set("visitScheduledAt", e.target.value)} />
              </Field>

              <div style={{ fontSize: 12, color: "#666", margin: "14px 0 6px", fontWeight: 600 }}>🏪 Visit tracking</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <Field label="No. of people">
                  <Input type="number" min="1" value={form.partySize} onChange={(e) => set("partySize", e.target.value)} placeholder="2" />
                </Field>
                <Field label="In time">
                  <Input type="datetime-local" value={form.inTime} onChange={(e) => set("inTime", e.target.value)} />
                </Field>
                <Field label="Out time">
                  <Input type="datetime-local" value={form.outTime} onChange={(e) => set("outTime", e.target.value)} />
                </Field>
              </div>

              <Field label="Items seen — pick all">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 0" }}>
                  {PRODUCT_TYPES.map((p) => {
                    const active = form.itemsSeen.includes(p);
                    return (
                      <button key={p} type="button" onClick={() => toggleItemSeen(p)}
                        style={{ padding: "4px 12px", borderRadius: 16, fontSize: 12, cursor: "pointer",
                                 border: `1px solid ${active ? C.purple : "#ddd"}`,
                                 background: active ? C.purple : "transparent",
                                 color: active ? "#fff" : "#555",
                                 fontWeight: active ? 600 : 400 }}>
                        {p}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Price quoted (₹)">
                  <Input type="number" value={form.priceQuoted} onChange={(e) => set("priceQuoted", e.target.value)} placeholder="225000" />
                </Field>
                <Field label="Outcome / reason">
                  <Select value={form.notBoughtReason} onChange={(e) => set("notBoughtReason", e.target.value)}>
                    <option value="">— select —</option>
                    {NOT_BOUGHT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </Select>
                </Field>
              </div>

              <Field label="Notes (optional — anything specific they said)">
                <Textarea rows={2} value={form.notBoughtNotes} onChange={(e) => set("notBoughtNotes", e.target.value)}
                  placeholder="e.g. wanted lighter weight chains, kept asking about HUID, wife liked the pearl set" />
              </Field>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Competitor mentioned">
                  <Input value={form.competitorMentioned} onChange={(e) => set("competitorMentioned", e.target.value)} placeholder="Tanishq / PNG / Khazana / Tribhovandas" />
                </Field>
                <Field label="Follow-up required?">
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "6px 0", cursor: "pointer" }}>
                    <input type="checkbox" checked={form.followupRequired} onChange={(e) => set("followupRequired", e.target.checked)} />
                    Yes — needs WA follow-up
                  </label>
                </Field>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, margin: "6px 0", cursor: "pointer", color: "#666" }}>
                <input type="checkbox" checked={activateBot} onChange={(e) => setActivateBot(e.target.checked)} />
                Send WhatsApp opening message & activate bot (usually OFF for walk-ins)
              </label>
            </>
          )}

          {err && <p style={{ fontSize: 12, color: C.red, margin: "8px 0" }}>{err}</p>}

          {dupContact && (
            <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: 12, margin: "10px 0", fontSize: 13 }}>
              <div style={{ fontWeight: 600, color: "#c2410c", marginBottom: 4 }}>⚠️ Phone already exists</div>
              <div style={{ color: "#555", marginBottom: 8 }}>
                <strong>{dupContact.name || "(no name)"}</strong> · {dupContact.phone}
                {dupContact.city ? ` · ${dupContact.city}` : ""}
                {dupContact.source ? ` · source: ${dupContact.source}` : ""}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <Btn small color={C.blue} onClick={() => { pickContact(dupContact); setDupContact(null); }}>Use existing contact</Btn>
                <Btn small ghost color={C.green} onClick={() => setEditingContact(dupContact)}>✏️ Edit existing (fix name/details)</Btn>
                <Btn small ghost color={C.gray} onClick={() => { setDupContact(null); set("phone", ""); }}>Change phone</Btn>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <Btn ghost color={C.gray} onClick={onClose}>Cancel</Btn>
            <Btn color={C.blue} onClick={save} disabled={saving || !!dupContact}>{saving ? "Saving…" : "Save Walk-in"}</Btn>
          </div>
        </>
      )}

      {editingContact && (
        <ContactEditModal
          contact={editingContact}
          allTags={allTags}
          onClose={() => setEditingContact(null)}
          onSaved={async () => {
            // Refresh dup info after edit so the panel shows updated name.
            const { data: refreshed } = await sb.from("bullion_leads")
              .select("id,name,phone,city,client_rating,source,tags").eq("id", editingContact.id).maybeSingle();
            setDupContact(refreshed || null);
            setEditingContact(null);
          }}
        />
      )}
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────
// LINK LID → EXISTING CONTACT
// Folds a LID-only lead into an existing real-phone contact: moves messages
// and demands over, registers an alias so future LID inbound routes correctly,
// then deletes the LID stub row.
// ──────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────
// LOG CALL MODAL — telecaller logs call attempt + result
// Shows the right script (S1/S2/S3) based on attempt #, plus an objections cheat-sheet.
// On save, POSTs to /api/log-call which advances cadence / transitions funnel.
// ──────────────────────────────────────────────────────────
const DISPOSITION_LABELS = {
  answered_interested: "✅ Answered — interested (advance to messaging)",
  answered_not_now: "🕒 Answered — not now (callback)",
  answered_not_interested: "❌ Answered — not interested",
  no_answer: "🔕 No answer",
  busy: "📞 Busy (retry in 15 min)",
  voicemail_left: "📩 Voicemail left",
  callback_requested: "📅 Callback requested",
  wrong_number: "🚫 Wrong number",
  dnc: "⛔ Do not call (DNC)",
};

function LogCallModal({ demand, lead, funnel, onClose, onSaved }) {
  const tenantId = getTenantId();
  const attemptNo = (demand?.call_attempts || 0) + 1;
  const openedAtRef = useRef(Date.now()); // timestamp when modal mounted = when telecaller started dialling
  const [scripts, setScripts] = useState({ s1: "", s2: "", s3: "" });
  const [objections, setObjections] = useState([]);
  const [disposition, setDisposition] = useState("answered_interested");
  const [notes, setNotes] = useState("");
  const [nextCallback, setNextCallback] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [showScript, setShowScript] = useState(true);
  const [elapsedSec, setElapsedSec] = useState(0);

  // Live timer so telecaller can see how long the call has been running
  useEffect(() => {
    const t = setInterval(() => setElapsedSec(Math.round((Date.now() - openedAtRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await sb.from("bullion_dropdowns")
        .select("field,value,sort_order")
        .eq("tenant_id", tenantId)
        .in("field", ["telecaller_script_s1","telecaller_script_s2","telecaller_script_s3","telecaller_objection"])
        .eq("active", true)
        .order("sort_order");
      const s = { s1: "", s2: "", s3: "" };
      const obj = [];
      for (const row of data || []) {
        if (row.field === "telecaller_script_s1") s.s1 = row.value;
        else if (row.field === "telecaller_script_s2") s.s2 = row.value;
        else if (row.field === "telecaller_script_s3") s.s3 = row.value;
        else if (row.field === "telecaller_objection") obj.push(row.value);
      }
      setScripts(s);
      setObjections(obj);
    })();
  }, [tenantId]);

  const scriptKey = attemptNo === 1 ? "s1" : attemptNo >= 6 ? "s3" : "s2";
  const scriptRaw = scripts[scriptKey] || "";
  const me = loadUser();
  const fillScript = (str) => str
    .replace(/\{name\}/g, lead?.name || "ji")
    .replace(/\{staff_name\}/g, me?.name || me?.username || "")
    .replace(/\{product_category\}/g, demand?.product_category || "jewellery");
  const scriptFilled = fillScript(scriptRaw);

  const save = async () => {
    setErr("");
    if (!disposition) { setErr("Pick a disposition."); return; }
    if ((disposition === "answered_not_now" || disposition === "callback_requested") && !nextCallback) {
      setErr("Set a callback time for this disposition.");
      return;
    }
    setSaving(true);
    try {
      const durationSec = Math.round((Date.now() - openedAtRef.current) / 1000);
      const r = await fetch("/api/log-call", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-crm-secret": window.__CRM_SECRET__ || "" },
        body: JSON.stringify({
          demandId: demand.id,
          staffId: me?.id || null,
          disposition,
          notes: notes || null,
          durationSec,
          openedAt: new Date(openedAtRef.current).toISOString(),
          nextCallbackAt: nextCallback ? new Date(nextCallback).toISOString() : null,
        }),
      });
      const data = await r.json();
      setSaving(false);
      if (!data.ok) { setErr(data.error || "Failed to log call"); return; }
      onSaved && onSaved(data);
    } catch (e) { setErr(String(e)); setSaving(false); }
  };

  return (
    <Modal title={`📝 Log call — attempt #${attemptNo} · ${lead?.name || lead?.phone || ""}`} onClose={onClose} width={760}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 14 }}>
        <div>
          <Field label="Disposition" required>
            <Select value={disposition} onChange={(e) => setDisposition(e.target.value)}>
              {Object.entries(DISPOSITION_LABELS).map(([k,l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>

          {(disposition === "answered_not_now" || disposition === "callback_requested") && (
            <Field label="Callback at" required>
              <Input type="datetime-local" value={nextCallback} onChange={(e) => setNextCallback(e.target.value)} />
            </Field>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Duration (auto-tracked)">
              <div style={{ padding: "8px 10px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 7, fontSize: 13, fontVariantNumeric: "tabular-nums", color: "#0369a1", fontWeight: 600 }}>
                ⏱ {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, "0")}
                <span style={{ fontSize: 11, fontWeight: 400, color: "#0284c7", marginLeft: 8 }}>(saved on submit)</span>
              </div>
            </Field>
            <Field label="Phone">
              <Input value={displayPhone(lead?.phone || "")} readOnly style={{ background: "#f5f5f5" }} />
            </Field>
          </div>

          <Field label="Notes">
            <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Conversation notes — what they said, next action…" />
          </Field>

          {err && <p style={{ fontSize: 12, color: C.red, margin: "8px 0" }}>{err}</p>}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <Btn ghost color={C.gray} onClick={onClose}>Cancel</Btn>
            <Btn color={C.blue} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save call log"}</Btn>
          </div>
        </div>

        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 10, fontSize: 12, lineHeight: 1.5 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <strong style={{ fontSize: 12 }}>📜 Script {scriptKey.toUpperCase()} (attempt #{attemptNo})</strong>
            <button onClick={() => setShowScript((v) => !v)} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 11, color: "#3b82f6" }}>{showScript ? "hide" : "show"}</button>
          </div>
          {showScript && <div style={{ whiteSpace: "pre-wrap", color: "#334155", marginBottom: 10 }}>{scriptFilled || "(no script configured)"}</div>}

          {objections.length > 0 && (
            <>
              <strong style={{ fontSize: 12, display: "block", marginTop: 8, marginBottom: 6 }}>💬 Objections</strong>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {objections.map((line, i) => {
                  const [q, a] = line.split("|||").map((s) => s.trim());
                  return (
                    <div key={i} style={{ borderLeft: "3px solid #cbd5e1", paddingLeft: 8 }}>
                      <div style={{ fontWeight: 600, color: "#475569" }}>"{q}"</div>
                      <div style={{ color: "#334155" }}>{a}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────
// LOST REASON MODAL — structured reason before marking a demand lost
// ──────────────────────────────────────────────────────────
const LOST_REASONS = [
  { value: "LOST_PRICE",          label: "💰 Price too high",           color: "#dc2626" },
  { value: "LOST_TIMING",         label: "⏰ Bad timing / not ready",    color: "#ea580c" },
  { value: "LOST_COMPETITOR",     label: "🏪 Went to competitor",        color: "#7c3aed" },
  { value: "LOST_NOT_INTERESTED", label: "🚫 Not interested at all",     color: "#6b7280" },
  { value: "LOST_BUDGET",         label: "💸 Budget too low",            color: "#b45309" },
  { value: "LOST_NO_SHOW",        label: "👻 No show / ghosted",         color: "#0891b2" },
  { value: "LOST_JUNK",           label: "🗑 Junk / wrong number",       color: "#9ca3af" },
];

function LostReasonModal({ demand, lead, onClose, onLost }) {
  const [reason, setReason] = useState("");
  const [lostNotes, setLostNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const confirm = async () => {
    if (!reason) { setErr("Please pick a reason."); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/demand-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-crm-secret": window.__CRM_SECRET__ || "" },
        body: JSON.stringify({
          demandId: demand.id,
          outcome: "lost",
          lostReason: reason,
          notes: lostNotes || null,
          staffId: loadUser()?.id || null,
        }),
      });
      const data = await r.json().catch(() => ({}));
      setSaving(false);
      if (!data.ok) { setErr(data.error || "Failed to mark lost"); return; }
      onLost && onLost(reason);
    } catch (e) { setErr(String(e)); setSaving(false); }
  };

  return (
    <Modal title={`❌ Mark as Lost — ${lead?.name || lead?.phone || ""}`} onClose={onClose} width={480}>
      <div style={{ fontSize: 13, color: "#555", marginBottom: 14 }}>
        Pick the main reason this demand is being closed as lost. This helps us improve follow-up strategies.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        {LOST_REASONS.map((r) => (
          <label key={r.value} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 8, border: `2px solid ${reason === r.value ? r.color : "#e5e7eb"}`, background: reason === r.value ? r.color + "12" : "#fff", cursor: "pointer", transition: "all 0.15s" }}>
            <input type="radio" name="lostReason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} style={{ accentColor: r.color }} />
            <span style={{ fontSize: 13, fontWeight: reason === r.value ? 600 : 400, color: reason === r.value ? r.color : "#374151" }}>{r.label}</span>
          </label>
        ))}
      </div>
      <Field label="Notes (optional)">
        <Textarea rows={2} value={lostNotes} onChange={(e) => setLostNotes(e.target.value)} placeholder="Any extra context — e.g. competitor name, price they got elsewhere…" />
      </Field>
      {err && <p style={{ fontSize: 12, color: C.red, margin: "4px 0 8px" }}>{err}</p>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        <Btn ghost color={C.gray} onClick={onClose}>Cancel</Btn>
        <Btn color={C.red} onClick={confirm} disabled={saving || !reason}>{saving ? "Saving…" : "Confirm — Mark Lost"}</Btn>
      </div>
    </Modal>
  );
}

function LinkLidModal({ lead, onClose, onLinked }) {
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const doSearch = useCallback(async (q) => {
    if (!q || q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const isPhone = /^\d+$/.test(q);
    let query = sb.from("bullion_leads")
      .select("id,name,phone,city,client_rating")
      .eq("tenant_id", getTenantId())
      .neq("id", lead.id);
    query = isPhone ? query.ilike("phone", `%${q}%`) : query.ilike("name", `%${q}%`);
    const { data } = await query.limit(8);
    // Hide other LID rows from picker
    setSearchResults((data || []).filter((c) => !/@lid$/i.test(c.phone || "")));
    setSearching(false);
  }, [lead.id]);

  useEffect(() => { const t = setTimeout(() => doSearch(searchQ), 300); return () => clearTimeout(t); }, [searchQ, doSearch]);

  const link = async () => {
    if (!target) return setErr("Pick a contact to link to.");
    setErr(""); setBusy(true);
    try {
      const tenantId = getTenantId();
      // 1) Register alias (LID phone → real lead)
      const { error: aliasErr } = await sb.from("bullion_lead_aliases").insert({
        tenant_id: tenantId,
        alias_phone: lead.phone,
        lead_id: target.id,
        created_by: loadUser()?.name || loadUser()?.username || null,
      });
      if (aliasErr && !String(aliasErr.message || "").includes("duplicate")) {
        setErr(aliasErr.message); setBusy(false); return;
      }
      // 2) Move messages
      await sb.from("bullion_messages").update({ lead_id: target.id, phone: target.phone }).eq("lead_id", lead.id);
      // 3) Move demands
      await sb.from("bullion_demands").update({ lead_id: target.id }).eq("lead_id", lead.id);
      // 4) Move scheduled messages
      await sb.from("bullion_scheduled_messages").update({ lead_id: target.id }).eq("lead_id", lead.id);
      // 5) Delete LID stub lead
      await sb.from("bullion_leads").delete().eq("id", lead.id);
      onLinked && onLinked();
    } catch (e) {
      setErr(String(e)); setBusy(false);
    }
  };

  return (
    <Modal title="Link LID conversation to existing contact" onClose={onClose} width={520}>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>
        WA hides the real phone for some senders. Pick the actual client below — all messages and demands from this LID conversation will be moved to that contact, and any future inbound from this LID will route to them automatically.
      </div>

      <Field label="Search by name or phone">
        <div style={{ position: "relative" }}>
          <Input
            value={target ? `${target.name || target.phone} · ${target.phone}` : searchQ}
            onChange={(e) => { if (target) setTarget(null); setSearchQ(e.target.value); }}
            onBlur={() => setTimeout(() => setSearchResults([]), 150)}
            placeholder="Type at least 2 chars…"
          />
          {target && (
            <button onClick={() => { setTarget(null); setSearchQ(""); }}
              style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", color: C.red, cursor: "pointer", fontSize: 16 }}>×</button>
          )}
          {searchResults.length > 0 && !target && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #ddd", borderRadius: 8, zIndex: 10, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
              {searchResults.map((c) => (
                <div key={c.id} onMouseDown={() => { setTarget(c); setSearchQ(""); setSearchResults([]); }}
                  style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid #f0f0f0" }}>
                  <strong>{c.name || "(no name)"}</strong> · {c.phone}
                  {c.city && <span style={{ color: "#888" }}> · {c.city}</span>}
                </div>
              ))}
            </div>
          )}
          {searching && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#aaa" }}>searching…</span>}
        </div>
      </Field>

      {err && <p style={{ fontSize: 12, color: C.red, margin: "8px 0" }}>{err}</p>}

      <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 6, padding: 10, fontSize: 11, color: "#7c2d12", margin: "8px 0" }}>
        ⚠️ This will move all messages, demands, and scheduled drips from <code>{lead.phone}</code> into the chosen contact, then delete the LID stub. Cannot be undone.
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
        <Btn ghost color={C.gray} onClick={onClose}>Cancel</Btn>
        <Btn color={C.blue} onClick={link} disabled={busy || !target}>{busy ? "Linking…" : "Link & merge"}</Btn>
      </div>
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────
// FUNNELS SCREEN
// ──────────────────────────────────────────────────────────
function FunnelsScreen({ funnels, personas, onReload }) {
  const [editing, setEditing] = useState(null);
  const [stepsFor, setStepsFor] = useState(null);
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    fetch(`${WA_SERVICE_URL}/clients`)
      .then((r) => r.json())
      .then((d) => setSessions(d?.clients || []))
      .catch(() => {});
  }, []);

  const disconnectedFunnels = funnels.filter((f) => {
    if (!f.active || !f.wbiztool_client) return false;
    const s = sessions.find((ss) => ss.client_id === f.wbiztool_client);
    return s && !s.connected;
  });

  const toggleActive = async (f) => {
    await sb.from("funnels").update({ active: !f.active }).eq("id", f.id);
    onReload();
  };

  return (
    <div>
      {disconnectedFunnels.length > 0 && (
        <div style={{ background: "#fff3cd", border: "1px solid #ffc107", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#856404" }}>
          ⚠️ <strong>Disconnected sessions:</strong> {disconnectedFunnels.map((f) => `${f.name} (${f.wbiztool_client})`).join(", ")} — bot cannot send replies. Go to <strong>Connections</strong> tab to re-pair.
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "#666" }}>Each funnel has its own description, persona, WhatsApp number, and goal. Edit or clone to spin up a new campaign without code.</div>
        <Btn color={C.blue} onClick={() => setEditing("new")}>+ New funnel</Btn>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
        {funnels.map((f) => {
          const p = personas.find((pp) => pp.id === f.persona_id);
          return (
            <Card key={f.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{f.name}</div>
                  <div style={{ fontSize: 11, color: "#888" }}>id: {f.id} · {f.product_focus}</div>
                </div>
                <Pill color={f.active ? C.green : C.gray} solid>{f.active ? "active" : "off"}</Pill>
              </div>
              <div style={{ fontSize: 12, color: "#555", marginBottom: 10, lineHeight: 1.4 }}>{f.description}</div>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>WA: {f.wa_number || "—"} · session: {f.wbiztool_client || "not set"}</div>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>Persona: {p?.name || "—"}</div>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 10 }}>Goal: {f.goal || "—"}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Btn small ghost color={C.blue} onClick={() => setEditing(f)}>Edit</Btn>
                <Btn small ghost color={C.pink} onClick={() => setStepsFor(f)}>Steps</Btn>
                <Btn small ghost color={f.active ? C.orange : C.green} onClick={() => toggleActive(f)}>{f.active ? "Disable" : "Enable"}</Btn>
                <Btn small ghost color={C.purple} onClick={() => setEditing({ ...f, id: "", name: f.name + " (copy)" })}>Clone</Btn>
              </div>
            </Card>
          );
        })}
      </div>

      {editing && <FunnelForm funnel={editing === "new" ? null : editing} personas={personas} funnels={funnels} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onReload(); }} />}
      {stepsFor && <FunnelStepsEditor funnel={stepsFor} onClose={() => setStepsFor(null)} />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// FUNNEL STEPS EDITOR — drip campaign sequence per funnel
// ──────────────────────────────────────────────────────────
function FunnelStepsEditor({ funnel, onClose }) {
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await sb
      .from("bullion_funnel_steps")
      .select("*")
      .eq("tenant_id", getTenantId())
      .eq("funnel_id", funnel.id)
      .order("step_order", { ascending: true });
    setSteps(data || []);
    setLoading(false);
  }, [funnel.id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const addStep = () => {
    const next = steps.length + 1;
    const isCalendar = funnel.kind === "birthday" || funnel.kind === "anniversary";
    setSteps((s) => [...s, {
      _new: true,
      tenant_id: getTenantId(),
      funnel_id: funnel.id,
      step_order: next,
      name: `Step ${next}`,
      // Calendar funnels: offset in days from event date (stored as days × 1440 minutes).
      // Sales funnels: step 1 fires 2h after enrollment; subsequent steps 1 day after previous.
      delay_minutes: isCalendar ? 0 : (next === 1 ? 120 : 1440),
      trigger_type: isCalendar ? "calendar_event" : (next === 1 ? "after_enrollment" : "after_prev_step"),
      trigger_at: null,
      condition: "always",
      message_template: isCalendar ? "" : "Just checking in — any questions about your earlier enquiry?",
      active: true,
      step_type: "message",
      use_ai_message: isCalendar,
    }]);
  };

  const updateStep = (idx, key, value) => {
    setSteps((s) => s.map((row, i) => i === idx ? { ...row, [key]: value, _dirty: true } : row));
  };

  const removeStep = async (idx) => {
    const row = steps[idx];
    if (row.id) await sb.from("bullion_funnel_steps").delete().eq("id", row.id);
    setSteps((s) => s.filter((_, i) => i !== idx));
  };

  // Swap two adjacent steps' step_order. Persist immediately so the order
  // change survives navigating away without clicking Save All.
  const moveStep = async (idx, direction) => {
    const target = idx + direction;
    if (target < 0 || target >= steps.length) return;
    const a = steps[idx];
    const b = steps[target];
    const aOrder = a.step_order;
    const bOrder = b.step_order;
    setSteps((s) => {
      const next = [...s];
      next[idx] = { ...a, step_order: bOrder };
      next[target] = { ...b, step_order: aOrder };
      // Re-sort so visual order matches
      return next.sort((x, y) => (x.step_order || 0) - (y.step_order || 0));
    });
    // Persist if both rows have ids
    if (a.id) await sb.from("bullion_funnel_steps").update({ step_order: bOrder }).eq("id", a.id);
    if (b.id) await sb.from("bullion_funnel_steps").update({ step_order: aOrder }).eq("id", b.id);
  };

  const saveAll = async () => {
    setSaving(true);
    for (const row of steps) {
      if (row._new || row._dirty) {
        const { _new, _dirty, ...clean } = row;
        if (row.id) {
          await sb.from("bullion_funnel_steps").update(clean).eq("id", row.id);
        } else {
          await sb.from("bullion_funnel_steps").insert(clean);
        }
      }
    }
    await load();
    setSaving(false);
  };

  const fmtDelay = (mins, triggerType) => {
    if (triggerType === "calendar_event") {
      const days = Math.round(mins / 1440);
      if (days === 0) return "on event day";
      if (days < 0) return `${Math.abs(days)} days before event`;
      return `${days} days after event`;
    }
    if (mins < 0) return `${Math.round(mins / 1440)}d before`;
    if (mins < 60) return `${mins}m`;
    if (mins < 60 * 24) return `${Math.round(mins / 60 * 10) / 10}h`;
    return `${Math.round(mins / 60 / 24 * 10) / 10}d`;
  };

  return (
    <Modal title={`Follow-up sequence · ${funnel.name}`} onClose={onClose} width={780}>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 12, lineHeight: 1.5 }}>
        Drip messages fire automatically when a lead in this funnel goes cold after a quote. If the lead replies during the sequence, pending messages cancel and the lead is flagged for agent follow-up. Placeholders: <code>{"{{name}}"}</code>, <code>{"{{phone}}"}</code>, <code>{"{{funnel_name}}"}</code>, <code>{"{{goal}}"}</code>.
      </div>

      {loading && <div style={{ color: "#888", fontSize: 13 }}>Loading…</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "55vh", overflowY: "auto" }}>
        {steps.map((row, idx) => {
          const tt = row.trigger_type || "after_prev_step";
          const showDelay = tt !== "specific_datetime";
          const showDatetime = tt === "specific_datetime";
          return (
            <Card key={row.id || `new-${idx}`} style={{ padding: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "70px 36px 1fr 90px auto", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <div style={{ display: "flex", gap: 2 }}>
                  <Btn small ghost color={C.gray} onClick={() => moveStep(idx, -1)} disabled={idx === 0} style={{ padding: "2px 6px", fontSize: 14 }}>↑</Btn>
                  <Btn small ghost color={C.gray} onClick={() => moveStep(idx, 1)} disabled={idx === steps.length - 1} style={{ padding: "2px 6px", fontSize: 14 }}>↓</Btn>
                </div>
                <div style={{ fontSize: 13, color: "#666", textAlign: "center", fontWeight: 600 }}>#{row.step_order}</div>
                <Input value={row.name || ""} onChange={(e) => updateStep(idx, "name", e.target.value)} placeholder="Step name" />
                <Select value={row.active ? "on" : "off"} onChange={(e) => updateStep(idx, "active", e.target.value === "on")}>
                  <option value="on">active</option>
                  <option value="off">off</option>
                </Select>
                <Btn small ghost color={C.red} onClick={() => removeStep(idx)}>×</Btn>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <Field label="Trigger">
                  <Select value={tt} onChange={(e) => updateStep(idx, "trigger_type", e.target.value)}>
                    <option value="after_prev_step">After previous step</option>
                    <option value="after_enrollment">After enrollment</option>
                    <option value="after_last_inbound">After lead's last inbound</option>
                    <option value="after_last_purchase">After lead's last purchase</option>
                    <option value="specific_datetime">On specific date + time</option>
                    <option value="calendar_event">📅 Days from birthday/anniversary</option>
                  </Select>
                </Field>
                {showDelay && (
                  <Field label={tt === "calendar_event" ? `Offset days (negative = before event) — ${fmtDelay(row.delay_minutes || 0, tt)}` : `Delay (minutes) — ${fmtDelay(row.delay_minutes || 0, tt)}`}>
                    {tt === "calendar_event"
                      ? <Input type="number" value={Math.round((row.delay_minutes || 0) / 1440)} onChange={(e) => updateStep(idx, "delay_minutes", Number(e.target.value) * 1440)} placeholder="-20 = 20 days before, 0 = event day, 5 = 5 days after" />
                      : <Input type="number" value={row.delay_minutes || 0} onChange={(e) => updateStep(idx, "delay_minutes", Number(e.target.value))} />}
                  </Field>
                )}
                {showDatetime && (
                  <Field label="Send at (exact date + time, IST)">
                    <Input type="datetime-local" value={row.trigger_at ? String(row.trigger_at).slice(0, 16) : ""} onChange={(e) => updateStep(idx, "trigger_at", e.target.value ? new Date(e.target.value).toISOString() : null)} />
                  </Field>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <Field label="Step type">
                  <Select
                    value={row.step_type || "message"}
                    onChange={(e) => updateStep(idx, "step_type", e.target.value)}
                    style={{ borderColor: row.step_type === "call" ? C.red : "#ddd" }}
                  >
                    <option value="message">💬 Message (bot sends)</option>
                    <option value="call">📞 Call (staff must call)</option>
                  </Select>
                </Field>
                <Field label="Message writing">
                  <Select value={row.use_ai_message ? "ai" : "template"} onChange={(e) => updateStep(idx, "use_ai_message", e.target.value === "ai")}>
                    <option value="template">📝 Use template below</option>
                    <option value="ai">🤖 AI generates personalized message</option>
                  </Select>
                </Field>
              </div>
              {row.step_type === "call" && (
                <div style={{ padding: "6px 10px", background: "#fff5f5", borderRadius: 6, fontSize: 11, color: C.red, marginBottom: 8 }}>
                  📞 Call step — bot will NOT auto-send. Demand will stay here until staff marks it done.
                </div>
              )}
              {row.use_ai_message && (
                <div style={{ padding: "6px 10px", background: "#f0f8ff", borderRadius: 6, fontSize: 11, color: C.blue, marginBottom: 8 }}>
                  🤖 AI will write a personalized message at send time. Template below is used as inspiration.
                </div>
              )}
              <Textarea
                rows={3}
                value={row.message_template || ""}
                onChange={(e) => updateStep(idx, "message_template", e.target.value)}
                placeholder="Message text or context hint for AI. Placeholders: {{name}} {{city}} {{phone}} {{funnel_name}} {{goal}}"
              />

              {row.step_type === "call" && (
                <div style={{ marginTop: 8 }}>
                  <Field label={`📲 "Tried to call" WA fallback (sent from demand detail when call doesn't connect)`}>
                    <Textarea
                      rows={2}
                      value={row.no_answer_template || ""}
                      onChange={(e) => updateStep(idx, "no_answer_template", e.target.value)}
                      placeholder='Hi {{name}}, just tried calling you about your enquiry — call back when free or reply here. Placeholders: {{name}} {{phone}} {{staff_name}} {{funnel_name}}'
                    />
                  </Field>
                </div>
              )}

              {/* Link attachment */}
              <div style={{ marginTop: 8, padding: "10px 12px", background: "#f9fafb", borderRadius: 8, border: "1px solid #e5e7eb" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8 }}>🔗 Attach link to this message</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <Field label="Link type">
                    <Select value={row.link_type || "none"} onChange={(e) => updateStep(idx, "link_type", e.target.value)}>
                      <option value="none">— No link —</option>
                      <option value="save_contact">💾 Save our number (1-tap contact save)</option>
                      <option value="profile_update">📋 Customer profile update</option>
                      <option value="google_review">⭐ Google review</option>
                      <option value="instagram">📸 Instagram follow</option>
                      <option value="whatsapp_catalog">🛒 WhatsApp catalog</option>
                      <option value="custom">🔗 Custom link</option>
                    </Select>
                  </Field>
                  {row.link_type && row.link_type !== "none" && row.link_type !== "profile_update" && (
                    <Field label="URL">
                      <Input value={row.link_url || ""} onChange={(e) => updateStep(idx, "link_url", e.target.value)} placeholder="https://..." />
                    </Field>
                  )}
                </div>
                {row.link_type && row.link_type !== "none" && (
                  <Field label="How to introduce it (Claude uses this)">
                    <Input
                      value={row.link_label || ""}
                      onChange={(e) => updateStep(idx, "link_label", e.target.value)}
                      placeholder={
                        row.link_type === "profile_update" ? "e.g. confirm your details and add family birthdays" :
                        row.link_type === "google_review" ? "e.g. share a quick review if you have a moment" :
                        row.link_type === "instagram" ? "e.g. follow us on Instagram for new designs" :
                        "e.g. browse our latest collection"
                      }
                    />
                  </Field>
                )}
                {row.link_type === "save_contact" && (
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                    💾 Sends <code>ssjbot.gemtre.in/contact.vcf</code> — when tapped on mobile, opens the phone's "Add Contact" screen with Sun Sea Jewellers pre-filled. One tap saves. No typing needed.
                  </div>
                )}
                {row.link_type === "profile_update" && (
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                    ℹ️ A unique link is generated per customer — Claude will include it naturally in the message.
                  </div>
                )}
              </div>
            </Card>
          );
        })}
        {!steps.length && !loading && (
          <div style={{ padding: 20, textAlign: "center", color: "#aaa", fontSize: 13 }}>
            No steps yet. Add a first follow-up.
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 14 }}>
        <Btn ghost color={C.blue} small onClick={addStep}>+ Add step</Btn>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn ghost color={C.gray} onClick={onClose}>Close</Btn>
          <Btn color={C.blue} onClick={saveAll} disabled={saving}>{saving ? "Saving…" : "Save all"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

function FunnelForm({ funnel, personas, funnels = [], onClose, onSaved }) {
  const isNew = !funnel?.id;
  const [form, setForm] = useState(funnel || { id: "", name: "", description: "", wa_number: "", wbiztool_client: "", product_focus: "gold_bullion", persona_id: personas[0]?.id || null, active: true, goal: "", max_exchanges_before_handoff: 3 });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    fetch(`${WA_SERVICE_URL}/clients`)
      .then((r) => r.json())
      .then((d) => setSessions(d?.clients || []))
      .catch(() => {});
  }, []);

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  // When a session is picked, auto-fill wa_number from the paired phone
  const pickSession = (clientId) => {
    const s = sessions.find((ss) => ss.client_id === clientId);
    setForm((prev) => ({
      ...prev,
      wbiztool_client: clientId,
      wa_number: s?.me ? normalizePhone(s.me.replace(/@.*/, "")) : prev.wa_number,
    }));
  };

  const selectedSession = sessions.find((s) => s.client_id === form.wbiztool_client);

  const save = async () => {
    setErr("");
    if (!form.id) return setErr("id is required (short slug like f1, akshaya_gold_2026)");
    if (!form.name) return setErr("name is required");
    if (!form.description) return setErr("description is required — it's the bot's context for this funnel");
    if (!form.wbiztool_client) return setErr("WhatsApp session is required — pick one from the dropdown");
    setSaving(true);
    const payload = { ...form, tenant_id: getTenantId() };
    const { error } = await sb.from("funnels").upsert(payload).select().single();
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onSaved();
  };

  return (
    <Modal title={isNew ? "New funnel" : `Edit funnel · ${funnel.id}`} onClose={onClose} width={620}>
      <Field label="Slug (id)" required>
        <Input value={form.id} onChange={(e) => set("id", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} placeholder="f1, akshaya_gold_2026, ..." disabled={!isNew && funnel?.id} />
      </Field>
      <Field label="Name" required><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
      <Field label="Description — purpose, audience, tone hints (injected into bot prompt)" required>
        <Textarea rows={4} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. Meta ads targeting gold coins / bars for Akshaya Tritiya. Audience: Delhi, 30–55, mid-high income…" />
      </Field>
      <Field label="Match keywords — comma-separated phrases from your ad's prefilled WhatsApp message">
        <Textarea rows={2} value={form.match_keywords || ""} onChange={(e) => set("match_keywords", e.target.value)} placeholder="gold, gold coin, AKT-GOLD, sona, ginni — the first inbound is matched case-insensitive; best-match funnel wins" />
      </Field>
      <Field label="Source label — auto-tagged on every new lead from this funnel">
        <Select value={form.source_label || ""} onChange={(e) => set("source_label", e.target.value)}>
          <option value="">— none (don't auto-tag) —</option>
          <option value="fb_ads">📘 fb_ads</option>
          <option value="insta_ads">📸 insta_ads</option>
          <option value="google_ads">🔎 google_ads</option>
          <option value="wa_organic">💬 wa_organic</option>
          <option value="walk_in">🏪 walk_in</option>
          <option value="referral">🤝 referral</option>
          <option value="exotel">📞 exotel</option>
          <option value="seller_enquiry">🏷️ seller_enquiry</option>
        </Select>
      </Field>
      <Field label="WhatsApp session — each funnel must have its own session" required>
        <Select value={form.wbiztool_client || ""} onChange={(e) => pickSession(e.target.value)}>
          <option value="">— choose a paired WA session —</option>
          {sessions.map((s) => (
            <option key={s.client_id} value={s.client_id}>
              {s.connected ? `✅ ${s.me || s.client_id}` : `⚠️ ${s.client_id} (disconnected)`}
            </option>
          ))}
          {form.wbiztool_client && !sessions.find((s) => s.client_id === form.wbiztool_client) && (
            <option value={form.wbiztool_client}>{form.wbiztool_client} — session not found in wa-service</option>
          )}
        </Select>
        {selectedSession && !selectedSession.connected && (
          <div style={{ marginTop: 4, fontSize: 12, color: C.red }}>⚠️ This session is disconnected — go to Connections tab to re-pair it.</div>
        )}
        {selectedSession?.connected && (
          <div style={{ marginTop: 4, fontSize: 12, color: "#16a34a" }}>✅ Paired as {selectedSession.me} · Messages will send from this number.</div>
        )}
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Product focus">
          <Select value={form.product_focus || ""} onChange={(e) => set("product_focus", e.target.value)}>
            {PRODUCT_FOCUS.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        <Field label="Persona">
          <Select value={form.persona_id || ""} onChange={(e) => set("persona_id", e.target.value || null)}>
            <option value="">— none —</option>
            {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
      </div>
      <Field label={(form.kind === "birthday" || form.kind === "anniversary") ? "Offer text (used by AI in birthday/anniversary messages)" : "Goal"}>
        <Input value={form.goal || ""} onChange={(e) => set("goal", e.target.value)} placeholder={(form.kind === "birthday" || form.kind === "anniversary") ? "e.g. Free gift on store visit + 70% off making charges this month" : "Book a showroom visit within 48 hours"} />
        {(form.kind === "birthday" || form.kind === "anniversary") && (
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>This is what the AI includes as the offer in pre/post event messages. It also appears in approval message previews.</div>
        )}
      </Field>
      <div style={{ fontSize: 12, color: "#666", margin: "12px 0 4px", fontWeight: 600 }}>📤 Post-outcome routing — when sales marks the demand, lead auto-moves to the chosen funnel</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <Field label="✅ next_on_convert">
          <Select value={form.next_on_convert || ""} onChange={(e) => set("next_on_convert", e.target.value || null)}>
            <option value="">— none —</option>
            {funnels.filter((f) => f.id !== form.id && f.active).map((f) => <option key={f.id} value={f.id}>{f.name} ({f.kind || "sales"})</option>)}
          </Select>
        </Field>
        <Field label="❌ next_on_lost">
          <Select value={form.next_on_lost || ""} onChange={(e) => set("next_on_lost", e.target.value || null)}>
            <option value="">— none —</option>
            {funnels.filter((f) => f.id !== form.id && f.active).map((f) => <option key={f.id} value={f.id}>{f.name} ({f.kind || "sales"})</option>)}
          </Select>
        </Field>
        <Field label="🤔 next_on_not_interested">
          <Select value={form.next_on_not_interested || ""} onChange={(e) => set("next_on_not_interested", e.target.value || null)}>
            <option value="">— none —</option>
            {funnels.filter((f) => f.id !== form.id && f.active).map((f) => <option key={f.id} value={f.id}>{f.name} ({f.kind || "sales"})</option>)}
          </Select>
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <Field label="Funnel type (kind)">
          <Select value={form.kind || "sales"} onChange={(e) => set("kind", e.target.value)}>
            <option value="sales">Sales / enquiry</option>
            <option value="acquisition">🎯 Acquisition (new leads)</option>
            <option value="hot_followup">🔥 Hot follow-up (re-engage)</option>
            <option value="nurture">🌱 Nurture (long-term)</option>
            <option value="cold_revive">❄️ Cold revive (lost leads)</option>
            <option value="after_sales">✅ After-sales (post-purchase)</option>
            <option value="birthday">🎂 Birthday wishes</option>
            <option value="anniversary">💍 Anniversary wishes</option>
            <option value="lifecycle">Lifecycle / post-event</option>
            <option value="followup">Follow-up</option>
            <option value="broadcast">📢 Broadcast (festival / occasion)</option>
          </Select>
        </Field>
        <Field label="Max exchanges before handoff"><Input type="number" value={form.max_exchanges_before_handoff || 3} onChange={(e) => set("max_exchanges_before_handoff", Number(e.target.value) || 3)} /></Field>
        <Field label="Active"><Select value={form.active ? "yes" : "no"} onChange={(e) => set("active", e.target.value === "yes")}><option value="yes">yes</option><option value="no">no</option></Select></Field>
      </div>
      {err && <p style={{ fontSize: 12, color: C.red, margin: "0 0 12px" }}>{err}</p>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        <Btn ghost color={C.gray} onClick={onClose}>Cancel</Btn>
        <Btn color={C.blue} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save funnel"}</Btn>
      </div>
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────
// PERSONAS SCREEN
// ──────────────────────────────────────────────────────────
function PersonasScreen({ personas, onReload }) {
  const [editing, setEditing] = useState(null);

  const setDefault = async (p) => {
    await sb.from("personas").update({ is_default: false }).eq("tenant_id", getTenantId()).neq("id", p.id);
    await sb.from("personas").update({ is_default: true }).eq("id", p.id);
    onReload();
  };

  const remove = async (p) => {
    if (!confirm(`Delete persona "${p.name}"? Funnels using it will fall back to the default.`)) return;
    await sb.from("personas").delete().eq("id", p.id);
    onReload();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "#666" }}>Personas are reusable bot voices. Pick one per funnel. The default persona is used when a funnel has none set.</div>
        <Btn color={C.blue} onClick={() => setEditing("new")}>+ New persona</Btn>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
        {personas.map((p) => (
          <Card key={p.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
              {p.is_default && <Pill color={C.green} solid>default</Pill>}
            </div>
            {p.description && <div style={{ fontSize: 12, color: "#666", marginBottom: 6, lineHeight: 1.4 }}>{p.description}</div>}
            {p.tone && <div style={{ fontSize: 11, color: "#888", marginBottom: 8, fontStyle: "italic" }}>Tone: {p.tone}</div>}
            <div style={{ fontSize: 11, color: "#aaa", marginBottom: 10 }}>{(p.system_prompt || "").slice(0, 140)}…</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Btn small ghost color={C.blue} onClick={() => setEditing(p)}>Edit</Btn>
              {!p.is_default && <Btn small ghost color={C.green} onClick={() => setDefault(p)}>Set default</Btn>}
              <Btn small ghost color={C.red} onClick={() => remove(p)}>Delete</Btn>
            </div>
          </Card>
        ))}
      </div>

      {editing && <PersonaForm persona={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onReload(); }} />}
    </div>
  );
}

function PersonaForm({ persona, onClose, onSaved }) {
  const isNew = !persona;
  const [form, setForm] = useState(persona || { name: "", description: "", tone: "", system_prompt: "", is_default: false });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setErr("");
    if (!form.name) return setErr("name is required");
    if (!form.system_prompt) return setErr("system_prompt is required — the bot's actual instructions");
    setSaving(true);
    const payload = { ...form, tenant_id: getTenantId() };
    const { error } = await sb.from("personas").upsert(payload).select().single();
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onSaved();
  };

  return (
    <Modal title={isNew ? "New persona" : `Edit persona · ${persona.name}`} onClose={onClose} width={640}>
      <Field label="Name" required><Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Rajesh Bhai — 40yr veteran" /></Field>
      <Field label="Description (internal note)">
        <Input value={form.description || ""} onChange={(e) => set("description", e.target.value)} placeholder="Warm, relationship-first, Hinglish" />
      </Field>
      <Field label="Tone (short)"><Input value={form.tone || ""} onChange={(e) => set("tone", e.target.value)} placeholder="Hinglish, uses bhai/ji, non-pushy" /></Field>
      <Field label="System prompt — the actual instructions sent to Claude" required>
        <Textarea rows={14} value={form.system_prompt} onChange={(e) => set("system_prompt", e.target.value)} placeholder="You are Rajesh Bhai…" style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 12 }} />
      </Field>
      <Field label="Default persona">
        <Select value={form.is_default ? "yes" : "no"} onChange={(e) => set("is_default", e.target.value === "yes")}><option value="no">no</option><option value="yes">yes</option></Select>
      </Field>
      {err && <p style={{ fontSize: 12, color: C.red, margin: "0 0 12px" }}>{err}</p>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn ghost color={C.gray} onClick={onClose}>Cancel</Btn>
        <Btn color={C.blue} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save persona"}</Btn>
      </div>
    </Modal>
  );
}

// ── QR Pairing Modal — polls status, renders QR as <img> (no iframe needed) ──
function QrPairingModal({ clientId, onClose }) {
  const [state, setState] = useState({ has_qr: false, qr_data_url: null, connected: false });

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const r = await fetch(`${WA_SERVICE_URL}/clients/${encodeURIComponent(clientId)}/status`);
        const d = await r.json();
        if (!active) return;
        setState(d);
        if (d.connected) { setTimeout(onClose, 1000); return; }
      } catch { /* ignore */ }
      if (active) setTimeout(poll, 3000);
    };
    poll();
    return () => { active = false; };
  }, [clientId, onClose]);

  return (
    <Modal title={`Pair WhatsApp · ${clientId}`} onClose={onClose} width={380}>
      <p style={{ fontSize: 12, color: "#888", margin: "0 0 12px" }}>
        Open WhatsApp → Settings → Linked Devices → Link a device → scan the QR.
      </p>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 16, background: "#fff", border: "1px solid #eee", borderRadius: 10 }}>
        {state.connected ? (
          <div style={{ fontSize: 14, color: C.green, padding: 24 }}>✅ Connected! Closing…</div>
        ) : state.qr_data_url ? (
          <img src={state.qr_data_url} alt="Scan QR" style={{ width: 280, height: 280, borderRadius: 8 }} />
        ) : (
          <div style={{ fontSize: 13, color: "#aaa", padding: 40 }}>⏳ Generating QR…</div>
        )}
      </div>
      <div style={{ fontSize: 11, color: "#aaa", textAlign: "center", marginTop: 8 }}>
        {state.connected ? "Connected" : "Auto-closes when paired · refreshes every 3s"}
      </div>
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────
// CONNECTIONS SCREEN — pair WhatsApp numbers via QR from the CRM
// ──────────────────────────────────────────────────────────
function ConnectionsScreen() {
  const [clients, setClients] = useState([]);
  const [funnels, setFunnels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pairing, setPairing] = useState(null); // client_id being paired, null | string
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${WA_SERVICE_URL}/clients`);
      const data = await r.json();
      setClients(data?.clients || []);
    } catch {
      setClients([]);
    }
    const { data: fdata } = await sb.from("funnels").select("id,name,wbiztool_client,active").eq("tenant_id", getTenantId());
    setFunnels(fdata || []);
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!pairing) return;
    // Poll every 4s while modal is open; close it once connected
    const t = setInterval(async () => {
      try {
        const r = await fetch(`${WA_SERVICE_URL}/clients/${encodeURIComponent(pairing)}/status`);
        const s = await r.json();
        if (s?.connected) {
          setPairing(null);
          load();
        }
      } catch { /* ignore */ }
    }, 4000);
    return () => clearInterval(t);
  }, [pairing, load]);

  const startPair = async () => {
    const id = newId.trim().replace(/[^a-zA-Z0-9_-]/g, "");
    if (!id) return;
    setPairing(id);
    setAdding(false);
    setNewId("");
    // Trigger the session to boot and generate a QR
    try { await fetch(`${WA_SERVICE_URL}/clients/${id}/status`); } catch { /* ignore */ }
    setTimeout(load, 2000);
  };

  const rePair = async (clientId) => {
    if (!confirm(`Re-pair session "${clientId}"? This unlinks the current WhatsApp session.`)) return;
    try { await fetch(`${WA_SERVICE_URL}/clients/${clientId}/logout`, { method: "POST" }); } catch { /* ignore */ }
    setTimeout(() => { setPairing(clientId); load(); }, 1500);
  };

  const disconnect = async (clientId) => {
    if (!confirm(`Disconnect "${clientId}"? The WA session will be logged out. You can re-pair it later.`)) return;
    try { await fetch(`${WA_SERVICE_URL}/clients/${clientId}/logout`, { method: "POST" }); } catch { /* ignore */ }
    setTimeout(load, 1000);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "#666", flex: 1 }}>
          WhatsApp sessions paired with your Synology Baileys service. Each session can back one or more funnels — match a funnel's <em>WA session id</em> to one of these.
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Btn ghost small color={C.gray} onClick={load}>↻</Btn>
          <Btn color={C.blue} onClick={() => setAdding(true)}>+ Add connection</Btn>
        </div>
      </div>

      {/* Warn if two sessions share the same phone number */}
      {(() => {
        const meMap = {};
        clients.forEach((c) => { if (c.me && c.connected) { meMap[c.me] = (meMap[c.me] || []).concat(c.client_id); } });
        const dupes = Object.entries(meMap).filter(([, ids]) => ids.length > 1);
        return dupes.length > 0 ? (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#991b1b" }}>
            ⚠️ <strong>Duplicate pairing detected:</strong> {dupes.map(([me, ids]) => `${me} is paired to both: ${ids.join(" and ")}`).join(". ")} — disconnect one and pair it to a different WA number, otherwise both sessions send from the same phone and messages may misfire.
          </div>
        ) : null;
      })()}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {clients.map((c) => {
          const linked = funnels.filter((f) => f.wbiztool_client === c.client_id);
          const phone = c.me ? c.me.replace(/@.*/, "").replace(/^91/, "") : null;
          return (
          <Card key={c.client_id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{c.client_id}</div>
              {c.connected
                ? <Pill color={C.green} solid>connected</Pill>
                : c.has_qr ? <Pill color={C.orange} solid>awaiting scan</Pill> : <Pill color={C.gray} solid>offline</Pill>}
            </div>
            <div style={{ fontSize: 12, color: "#555", marginBottom: 6, wordBreak: "break-all" }}>
              {phone ? <>📱 <strong>{phone}</strong></> : <span style={{ color: "#aaa" }}>Not yet paired</span>}
            </div>
            {linked.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>Funnels using this session:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {linked.map((f) => (
                    <span key={f.id} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: f.active ? "#dbeafe" : "#f3f4f6", color: f.active ? "#1d4ed8" : "#888" }}>{f.name}{!f.active ? " (off)" : ""}</span>
                  ))}
                </div>
              </div>
            )}
            {linked.length === 0 && <div style={{ fontSize: 11, color: "#aaa", marginBottom: 10 }}>No funnels linked to this session</div>}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {!c.connected && <Btn small color={C.blue} onClick={() => setPairing(c.client_id)}>Pair QR</Btn>}
              {c.connected && <Btn small ghost color={C.orange} onClick={() => rePair(c.client_id)}>Re-pair</Btn>}
              {c.connected && <Btn small ghost color={C.red} onClick={() => disconnect(c.client_id)}>Disconnect</Btn>}
            </div>
          </Card>
          );
        })}
        {!clients.length && !loading && (
          <div style={{ color: "#aaa", fontSize: 13 }}>No sessions yet. Click "+ Add connection" to pair a WhatsApp number.</div>
        )}
      </div>

      {adding && (
        <Modal title="Add a new WhatsApp connection" onClose={() => setAdding(false)} width={480}>
          <Field label="Session id (short slug — letters/numbers/dash/underscore)">
            <Input value={newId} onChange={(e) => setNewId(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))} placeholder="ssj-prod, bullion-2026, gift-wa" autoFocus />
          </Field>
          <p style={{ fontSize: 12, color: "#888", margin: "0 0 12px" }}>Use this id on the matching funnel's <em>WA session id</em> field.</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn ghost color={C.gray} onClick={() => setAdding(false)}>Cancel</Btn>
            <Btn color={C.blue} onClick={startPair} disabled={!newId.trim()}>Continue to QR</Btn>
          </div>
        </Modal>
      )}

      {pairing && <QrPairingModal clientId={pairing} onClose={() => { setPairing(null); load(); }} />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// MANUAL LEAD ENTRY — for walk-ins, imports, hand-fed leads
// ──────────────────────────────────────────────────────────
function ManualLeadForm({ funnels, onClose, onSaved }) {
  const [form, setForm] = useState({
    phone: "",
    name: "",
    city: "",
    email: "",
    bday: "",
    anniversary: "",
    source: "Manual entry",
    funnel_id: funnels.find((f) => f.kind === "acquisition")?.id || funnels[0]?.id || "",
    enroll: false,
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setErr("");
    const phone = String(form.phone || "").replace(/\D/g, "").replace(/^0+/, "").replace(/^91/, "");
    if (!phone) return setErr("Phone is required.");
    setSaving(true);
    const payload = {
      tenant_id: getTenantId(),
      phone,
      name: form.name || null,
      city: form.city || null,
      email: form.email || null,
      bday: form.bday || null,
      anniversary: form.anniversary || null,
      source: form.source || null,
      funnel_id: form.funnel_id || null,
      notes: form.notes || null,
      status: "active",
      stage: "greeting",
    };
    const { error } = await sb.from("bullion_leads").upsert(payload, { onConflict: "tenant_id,phone" });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onSaved();
  };

  return (
    <Modal title="Add lead manually" onClose={onClose} width={560}>
      <Field label="Phone (10-digit, no country code)" required>
        <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="9876543210" />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Name"><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="City"><Input value={form.city} onChange={(e) => set("city", e.target.value)} /></Field>
      </div>
      <Field label="Email"><Input value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Birthday (MM-DD or YYYY-MM-DD)"><Input value={form.bday} onChange={(e) => set("bday", e.target.value)} placeholder="04-21 or 1990-04-21" /></Field>
        <Field label="Anniversary"><Input value={form.anniversary} onChange={(e) => set("anniversary", e.target.value)} placeholder="06-15" /></Field>
      </div>
      <Field label="Source (where did this lead come from?)">
        <Input value={form.source} onChange={(e) => set("source", e.target.value)} placeholder="Walk-in · Meta ad · Google ad · Referral — Rajesh · CSV import" />
      </Field>
      <Field label="Funnel">
        <Select value={form.funnel_id} onChange={(e) => set("funnel_id", e.target.value)}>
          {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
      </Field>
      <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      {err && <p style={{ fontSize: 12, color: C.red, margin: "0 0 12px" }}>{err}</p>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn ghost color={C.gray} onClick={onClose}>Cancel</Btn>
        <Btn color={C.blue} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save lead"}</Btn>
      </div>
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────
// FAQs SCREEN — owner-editable Q&A the bot consults
// ──────────────────────────────────────────────────────────
function FaqsScreen() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await sb
      .from("bullion_faqs")
      .select("*")
      .eq("tenant_id", getTenantId())
      .order("sort_order", { ascending: true });
    setRows(data || []);
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const add = () => {
    const nextSort = (rows[rows.length - 1]?.sort_order || 0) + 10;
    setRows((r) => [...r, {
      _new: true,
      tenant_id: getTenantId(),
      keywords: "",
      answer: "",
      active: true,
      sort_order: nextSort,
    }]);
  };

  const update = (idx, key, value) => {
    setRows((r) => r.map((row, i) => i === idx ? { ...row, [key]: value, _dirty: true } : row));
  };

  const remove = async (idx) => {
    const row = rows[idx];
    if (row.id) {
      if (!confirm(`Delete FAQ "${row.keywords.slice(0, 40)}…"?`)) return;
      await sb.from("bullion_faqs").delete().eq("id", row.id);
    }
    setRows((r) => r.filter((_, i) => i !== idx));
  };

  const saveAll = async () => {
    setSaving(true);
    for (const row of rows) {
      if (!row._new && !row._dirty) continue;
      if (!row.keywords || !row.answer) continue; // skip empty rows
      const { _new, _dirty, ...clean } = row;
      if (row.id) {
        await sb.from("bullion_faqs").update(clean).eq("id", row.id);
      } else {
        await sb.from("bullion_faqs").insert(clean);
      }
    }
    await load();
    setSaving(false);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10 }}>
        <div style={{ fontSize: 13, color: "#666", flex: 1, lineHeight: 1.5 }}>
          The bot consults these FAQs when replying. Column 1 = keywords/phrases to match (comma-separated). Column 2 = the exact answer to incorporate. Cached 60s on the server — changes reflect in ~1 min.
        </div>
        <Btn color={C.blue} onClick={add}>+ Add FAQ</Btn>
      </div>

      <Card style={{ padding: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f7f7f7" }}>
                <th style={{ padding: 10, textAlign: "left", fontSize: 11, color: "#888", borderBottom: "1px solid #eee", width: "30%" }}>KEYWORDS</th>
                <th style={{ padding: 10, textAlign: "left", fontSize: 11, color: "#888", borderBottom: "1px solid #eee" }}>ANSWER</th>
                <th style={{ padding: 10, textAlign: "center", fontSize: 11, color: "#888", borderBottom: "1px solid #eee", width: 60 }}>#</th>
                <th style={{ padding: 10, textAlign: "center", fontSize: 11, color: "#888", borderBottom: "1px solid #eee", width: 80 }}>ACTIVE</th>
                <th style={{ padding: 10, width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.id || `new-${idx}`} style={{ borderBottom: "1px solid #f5f5f5", verticalAlign: "top" }}>
                  <td style={{ padding: 8 }}>
                    <Textarea rows={3} value={row.keywords || ""} onChange={(e) => update(idx, "keywords", e.target.value)} placeholder="comma, separated, keywords" />
                  </td>
                  <td style={{ padding: 8 }}>
                    <Textarea rows={3} value={row.answer || ""} onChange={(e) => update(idx, "answer", e.target.value)} placeholder="The exact answer the bot should use…" />
                  </td>
                  <td style={{ padding: 8, textAlign: "center" }}>
                    <Input type="number" value={row.sort_order || 0} onChange={(e) => update(idx, "sort_order", Number(e.target.value))} style={{ width: 50, padding: 4 }} />
                  </td>
                  <td style={{ padding: 8, textAlign: "center" }}>
                    <Select value={row.active ? "on" : "off"} onChange={(e) => update(idx, "active", e.target.value === "on")}>
                      <option value="on">on</option>
                      <option value="off">off</option>
                    </Select>
                  </td>
                  <td style={{ padding: 8, textAlign: "center" }}>
                    <Btn small ghost color={C.red} onClick={() => remove(idx)}>×</Btn>
                  </td>
                </tr>
              ))}
              {!rows.length && !loading && (
                <tr><td colSpan={5} style={{ padding: 20, color: "#aaa", textAlign: "center" }}>No FAQs yet. Click "+ Add FAQ" to start.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <Btn ghost color={C.gray} onClick={load}>↻ Reload</Btn>
        <Btn color={C.blue} onClick={saveAll} disabled={saving}>{saving ? "Saving…" : "Save all"}</Btn>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// RATES SCREEN — pulls from Apps Script
// ──────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────
// MEDIA ASSETS SCREEN — authority building PDF/video/links
// ──────────────────────────────────────────────────────────
function MediaAssetsScreen() {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null); // null | 'new' | asset object
  const [form, setForm] = useState({ title: "", asset_type: "image", url: "", caption: "", send_to_new_leads: true, active: true, sort_order: 1 });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    setLoading(true);
    const { data } = await sb.from("bullion_media_assets").select("*").eq("tenant_id", getTenantId()).order("sort_order").order("created_at");
    setAssets(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const setF = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const startNew = () => { setForm({ title: "", asset_type: "pdf", url: "", caption: "", send_to_new_leads: true, active: true, sort_order: (assets.length + 1) }); setEditing("new"); setErr(""); };
  const startEdit = (a) => { setForm({ ...a }); setEditing(a); setErr(""); };

  const uploadFile = async (file) => {
    if (!file) return;
    setUploading(true); setErr("");
    const type = file.type.startsWith("video") ? "video" : file.type === "application/pdf" ? "pdf" : "image";
    const path = `media-assets/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error: upErr } = await sb.storage.from("media").upload(path, file, { upsert: true });
    if (upErr) { setErr(`Upload failed: ${upErr.message}`); setUploading(false); return; }
    const { data: pub } = sb.storage.from("media").getPublicUrl(path);
    setForm((s) => ({ ...s, url: pub.publicUrl, asset_type: type }));
    setUploading(false);
  };

  const save = async () => {
    setErr("");
    if (!form.title) return setErr("Title is required.");
    if (!form.url) return setErr("Upload a file or paste a URL.");
    setSaving(true);
    const payload = { ...form, tenant_id: getTenantId() };
    let error;
    if (editing === "new") {
      ({ error } = await sb.from("bullion_media_assets").insert(payload));
    } else {
      ({ error } = await sb.from("bullion_media_assets").update(payload).eq("id", editing.id));
    }
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setEditing(null);
    load();
  };

  const del = async (id) => {
    if (!confirm("Delete this asset?")) return;
    await sb.from("bullion_media_assets").delete().eq("id", id);
    load();
  };

  const toggle = async (a) => {
    await sb.from("bullion_media_assets").update({ active: !a.active }).eq("id", a.id);
    load();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "#666" }}>
          Authority building assets sent to new leads automatically after the first message. Add your brochure PDF, intro video link, catalogue, etc.
        </div>
        <Btn color={C.blue} onClick={startNew}>+ Add asset</Btn>
      </div>

      {loading && <div style={{ color: "#888", fontSize: 13 }}>Loading…</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
        {assets.map((a) => (
          <Card key={a.id} style={{ opacity: a.active ? 1 : 0.5 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{a.title}</div>
                <div style={{ fontSize: 11, color: "#888" }}>{a.asset_type} · sort {a.sort_order}</div>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {a.send_to_new_leads && <Pill color={C.green} solid>auto-send</Pill>}
                <Pill color={a.active ? C.blue : C.gray} solid>{a.active ? "on" : "off"}</Pill>
              </div>
            </div>
            <div style={{ fontSize: 12, color: C.blue, marginBottom: 4, wordBreak: "break-all" }}>
              <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ color: C.blue }}>{a.url.slice(0, 60)}{a.url.length > 60 ? "…" : ""}</a>
            </div>
            {a.caption && <div style={{ fontSize: 12, color: "#555", marginBottom: 8, fontStyle: "italic" }}>"{a.caption}"</div>}
            <div style={{ display: "flex", gap: 6 }}>
              <Btn small ghost color={C.blue} onClick={() => startEdit(a)}>Edit</Btn>
              <Btn small ghost color={a.active ? C.orange : C.green} onClick={() => toggle(a)}>{a.active ? "Disable" : "Enable"}</Btn>
              <Btn small ghost color={C.red} onClick={() => del(a.id)}>Delete</Btn>
            </div>
          </Card>
        ))}
        {!assets.length && !loading && (
          <div style={{ padding: 20, color: "#aaa", fontSize: 13 }}>No assets yet. Add your first brochure or intro video link.</div>
        )}
      </div>

      {editing !== null && (
        <Modal title={editing === "new" ? "Add media asset" : "Edit asset"} onClose={() => setEditing(null)} width={560}>
          <Field label="Title" required><Input value={form.title} onChange={(e) => setF("title", e.target.value)} placeholder="SSJ Brochure 2026" /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Type">
              <Select value={form.asset_type} onChange={(e) => setF("asset_type", e.target.value)}>
                <option value="pdf">PDF</option>
                <option value="video">Video</option>
                <option value="image">Image</option>
                <option value="link">Link</option>
              </Select>
            </Field>
            <Field label="Sort order">
              <Input type="number" value={form.sort_order} onChange={(e) => setF("sort_order", Number(e.target.value))} />
            </Field>
          </div>
          <Field label="File">
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexDirection: "column" }}>
              <label style={{ fontSize: 13, padding: "6px 14px", borderRadius: 7, border: "1px solid #3b82f6", color: "#3b82f6", cursor: "pointer" }}>
                {uploading ? "Uploading…" : "📤 Upload from computer"}
                <input type="file" accept="image/*,video/*,.pdf" style={{ display: "none" }} onChange={(e) => uploadFile(e.target.files[0])} disabled={uploading} />
              </label>
              {form.url && form.asset_type === "image" && <img src={form.url} alt="" style={{ maxHeight: 100, maxWidth: 200, borderRadius: 6, objectFit: "cover", border: "1px solid #e5e7eb" }} />}
              {form.url && form.asset_type !== "image" && <a href={form.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: C.blue }}>View uploaded file ↗</a>}
              <div style={{ fontSize: 12, color: "#888" }}>Or paste a public URL:</div>
              <Input value={form.url} onChange={(e) => setF("url", e.target.value)} placeholder="https://..." />
            </div>
          </Field>
          <Field label="Caption (message text sent with the link)">
            <Textarea rows={2} value={form.caption} onChange={(e) => setF("caption", e.target.value)} placeholder="Here's our jewellery catalogue — take a look at our collection!" />
          </Field>
          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={form.send_to_new_leads} onChange={(e) => setF("send_to_new_leads", e.target.checked)} />
              Auto-send to every new lead (after first message)
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setF("active", e.target.checked)} />
              Active
            </label>
          </div>
          {err && <p style={{ fontSize: 12, color: C.red, margin: "0 0 12px" }}>{err}</p>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn ghost color={C.gray} onClick={() => setEditing(null)}>Cancel</Btn>
            <Btn color={C.blue} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// CONTACTS SCREEN — master client database
// ──────────────────────────────────────────────────────────
function ContactsScreen({ funnels }) {
  const [contacts, setContacts] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [sending, setSending] = useState(null);
  const [showLid, setShowLid] = useState(false); // hide WA-hidden (LID) leads by default

  const loadTags = useCallback(async () => {
    const { data } = await sb.from("bullion_tags").select("name,category,color")
      .eq("tenant_id", getTenantId()).order("sort_order");
    setAllTags(data || []);
  }, []);

  const load = useCallback(async (q = "") => {
    setLoading(true);
    let query = sb.from("bullion_leads")
      .select("*")
      .eq("tenant_id", getTenantId())
      .order("name", { ascending: true, nullsFirst: false })
      .limit(200);
    if (q) {
      query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%,city.ilike.%${q}%`);
    }
    const { data } = await query;
    setContacts(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); loadTags(); }, [load, loadTags]);

  // Debounce search → server-side query
  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
  }, [search, load]);

  const filtered = useMemo(
    () => showLid ? contacts : contacts.filter((c) => !isLid(c.phone)),
    [contacts, showLid]
  );
  const lidCount = contacts.filter((c) => isLid(c.phone)).length;

  // Unique WA numbers from funnels for the sender chooser
  const waNumbers = useMemo(() => {
    const seen = new Set();
    return (funnels || []).filter((f) => f.wa_number && !seen.has(f.wa_number) && seen.add(f.wa_number))
      .map((f) => ({ number: f.wa_number, client: f.wbiztool_client, label: f.wa_number }));
  }, [funnels]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Input placeholder="Search name / phone / email / city…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: "1 1 220px" }} />
        <Btn ghost small color={C.gray} onClick={load}>↻</Btn>
        <Btn small color={C.blue} onClick={() => setEditing({})}>+ Add Contact</Btn>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#666", cursor: "pointer" }}>
          <input type="checkbox" checked={showLid} onChange={(e) => setShowLid(e.target.checked)} />
          Show WA-hidden ({lidCount})
        </label>
        <span style={{ fontSize: 11, color: "#888" }}>{loading ? "Loading…" : `${filtered.length} contacts`}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
        {filtered.map((c) => (
          <ContactCard key={c.id} contact={c} onEdit={() => setEditing(c)} onSendWA={() => setSending(c)} />
        ))}
        {!filtered.length && !loading && (
          <div style={{ gridColumn: "1/-1", padding: 40, textAlign: "center", color: "#aaa", fontSize: 13 }}>No contacts yet.</div>
        )}
      </div>

      {editing !== null && (
        <ContactEditModal
          contact={editing}
          allTags={allTags}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      {sending && (
        <SendWAModal
          contact={sending}
          waNumbers={waNumbers}
          onClose={() => setSending(null)}
        />
      )}
    </div>
  );
}

function ContactCard({ contact: c, onEdit, onSendWA }) {
  const stars = c.client_rating ? "★".repeat(Math.min(5, c.client_rating)) + "☆".repeat(5 - Math.min(5, c.client_rating)) : null;
  return (
    <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name || c.phone || <span style={{ color: "#aaa" }}>(no name)</span>}</div>
          <div style={{ fontSize: 12, color: "#555" }}>{c.phone}</div>
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {c.is_client && <Pill color={C.blue} solid>Client</Pill>}
          {c.dnd && <Pill color={C.red} solid>DND</Pill>}
        </div>
      </div>

      {(c.city || c.email) && (
        <div style={{ fontSize: 12, color: "#777" }}>
          {[c.city, c.email].filter(Boolean).join(" · ")}
        </div>
      )}

      {(c.bday || c.anniversary) && (
        <div style={{ fontSize: 12, color: "#888" }}>
          {c.bday && <span>🎂 {c.bday}</span>}
          {c.bday && c.anniversary && <span style={{ margin: "0 6px" }}>·</span>}
          {c.anniversary && <span>💍 {c.anniversary}</span>}
        </div>
      )}

      {c.wedding_date && (
        <div style={{ fontSize: 12, color: "#a855f7" }}>💒 {c.wedding_family_member || "Wedding"}: {c.wedding_date}</div>
      )}

      {stars && <div style={{ fontSize: 12, color: "#f59e0b", letterSpacing: 1 }}>{stars}</div>}

      {Array.isArray(c.tags) && c.tags.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
          {c.tags.map((t) => <Pill key={t} color={C.blue}>{t}</Pill>)}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <Btn ghost small color={C.blue} onClick={onEdit}>✏️ Edit</Btn>
        <Btn small color="#25d366" onClick={onSendWA} style={{ color: "#fff" }}>📱 Send WA</Btn>
      </div>
    </div>
  );
}

function ContactEditModal({ contact, allTags = [], onClose, onSaved }) {
  const isNew = !contact.id;
  const sourceTags = allTags.filter((t) => t.category === "source").map((t) => t.name);
  const otherTags = allTags.filter((t) => t.category !== "source").map((t) => t.name);

  const [form, setForm] = useState({
    name: contact.name || "",
    phone: contact.phone || "",
    city: contact.city || "",
    email: contact.email || "",
    bday: contact.bday || "",
    anniversary: contact.anniversary || "",
    client_rating: contact.client_rating || "",
    is_client: contact.is_client || false,
    wedding_date: contact.wedding_date || "",
    wedding_family_member: contact.wedding_family_member || "",
    source: contact.source || "",
    tags: Array.isArray(contact.tags) ? contact.tags : [],
    partner_lead_id: contact.partner_lead_id || null,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [partnerInfo, setPartnerInfo] = useState(null);
  const [partnerSearch, setPartnerSearch] = useState("");
  const [partnerResults, setPartnerResults] = useState([]);

  // Resolve current partner info for display
  useEffect(() => {
    if (!form.partner_lead_id) { setPartnerInfo(null); return; }
    sb.from("bullion_leads").select("id,name,phone").eq("id", form.partner_lead_id).maybeSingle()
      .then(({ data }) => setPartnerInfo(data || null));
  }, [form.partner_lead_id]);

  // Search for partner candidates
  useEffect(() => {
    if (!partnerSearch || partnerSearch.length < 2) { setPartnerResults([]); return; }
    const t = setTimeout(async () => {
      const isPhone = /^\d+$/.test(partnerSearch);
      let q = sb.from("bullion_leads").select("id,name,phone,city")
        .eq("tenant_id", getTenantId())
        .neq("id", contact.id || "00000000-0000-0000-0000-000000000000");
      q = isPhone ? q.ilike("phone", `%${partnerSearch}%`) : q.ilike("name", `%${partnerSearch}%`);
      const { data } = await q.limit(6);
      setPartnerResults(data || []);
    }, 250);
    return () => clearTimeout(t);
  }, [partnerSearch, contact.id]);

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const toggleTag = (tag) => {
    setForm((s) => ({
      ...s,
      tags: s.tags.includes(tag) ? s.tags.filter((t) => t !== tag) : [...s.tags, tag],
    }));
  };

  const save = async () => {
    setErr("");
    if (!form.phone) return setErr("Phone is required.");
    setSaving(true);
    const payload = {
      tenant_id: getTenantId(),
      phone: String(form.phone).replace(/\D/g, "").replace(/^0+/, "").replace(/^91/, ""),
      name: form.name || null,
      city: form.city || null,
      email: form.email || null,
      bday: form.bday || null,
      anniversary: form.anniversary || null,
      client_rating: form.client_rating ? Number(form.client_rating) : null,
      is_client: form.is_client,
      wedding_date: form.wedding_date || null,
      wedding_family_member: form.wedding_family_member || null,
      source: form.source || null,
      tags: form.tags,
      partner_lead_id: form.partner_lead_id || null,
      updated_at: new Date().toISOString(),
    };
    let error;
    let savedId = contact.id;
    if (isNew) {
      const { data, error: e } = await sb.from("bullion_leads")
        .insert({ ...payload, status: "new", funnel_id: "bullion" })
        .select("id").single();
      error = e; savedId = data?.id;
    } else {
      ({ error } = await sb.from("bullion_leads").update(payload).eq("id", contact.id));
    }
    if (error) { setSaving(false); return setErr(error.message); }
    // Bidirectional partner link — if A points at B, also point B at A.
    // (And clear stale partner link on B if A's link was just removed.)
    if (form.partner_lead_id && savedId) {
      await sb.from("bullion_leads").update({ partner_lead_id: savedId }).eq("id", form.partner_lead_id);
    }
    if (!form.partner_lead_id && contact.partner_lead_id && savedId) {
      // Was linked, now unlinked — clear the other side too.
      await sb.from("bullion_leads").update({ partner_lead_id: null })
        .eq("id", contact.partner_lead_id).eq("partner_lead_id", savedId);
    }
    setSaving(false);
    onSaved();
  };

  return (
    <Modal title={isNew ? "Add Contact" : `Edit — ${contact.name || contact.phone}`} onClose={onClose} width={540}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Name"><Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Full name" /></Field>
        <Field label="Phone" required><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="9876543210" /></Field>
        <Field label="City"><Input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Delhi" /></Field>
        <Field label="Email"><Input value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="email@example.com" /></Field>
        <Field label="Birthday (YYYY-MM-DD)"><Input value={form.bday} onChange={(e) => set("bday", e.target.value)} placeholder="1985-03-15" /></Field>
        <Field label="Anniversary (YYYY-MM-DD)"><Input value={form.anniversary} onChange={(e) => set("anniversary", e.target.value)} placeholder="2010-11-20" /></Field>
        <Field label="Rating">
          <Select value={form.client_rating} onChange={(e) => set("client_rating", e.target.value)}>
            <option value="">—</option>
            {[1,2,3,4,5].map((n) => <option key={n} value={n}>{"★".repeat(n)} {n} star{n > 1 ? "s" : ""}</option>)}
          </Select>
        </Field>
        <Field label="Source">
          <Select value={form.source} onChange={(e) => set("source", e.target.value)}>
            <option value="">— select source —</option>
            {sourceTags.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Wedding date"><Input value={form.wedding_date} onChange={(e) => set("wedding_date", e.target.value)} placeholder="2025-11-15" /></Field>
        <Field label="Wedding (family member)"><Input value={form.wedding_family_member} onChange={(e) => set("wedding_family_member", e.target.value)} placeholder="daughter Priya" /></Field>
      </div>

      <Field label="Tags" style={{ marginTop: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 0" }}>
          {otherTags.map((tag) => {
            const active = form.tags.includes(tag);
            const tagMeta = allTags.find((t) => t.name === tag);
            return (
              <button key={tag} onClick={() => toggleTag(tag)} style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, cursor: "pointer", border: `1px solid ${active ? (tagMeta?.color || C.blue) : "#ddd"}`, background: active ? (tagMeta?.color || C.blue) : "transparent", color: active ? "#fff" : "#555", fontWeight: active ? 600 : 400 }}>
                {tag}
              </button>
            );
          })}
          {otherTags.length === 0 && <span style={{ fontSize: 12, color: "#aaa" }}>No tags configured yet</span>}
        </div>
      </Field>

      <Field label="🔗 Linked partner / spouse / family member" style={{ marginTop: 10 }}>
        {partnerInfo ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "6px 10px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 6 }}>
            <span style={{ fontSize: 13, color: "#0c4a6e", flex: 1 }}>
              <strong>{partnerInfo.name || "(no name)"}</strong> · {partnerInfo.phone}
            </span>
            <Btn small ghost color={C.red} onClick={() => set("partner_lead_id", null)}>× Unlink</Btn>
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <Input value={partnerSearch} onChange={(e) => setPartnerSearch(e.target.value)}
              placeholder="Search by name or phone to link spouse / family — leave empty if none" />
            {partnerResults.length > 0 && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #ddd", borderRadius: 6, zIndex: 10, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
                {partnerResults.map((p) => (
                  <div key={p.id} onMouseDown={() => { set("partner_lead_id", p.id); setPartnerSearch(""); setPartnerResults([]); }}
                    style={{ padding: "6px 10px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid #f0f0f0" }}>
                    <strong>{p.name || "(no name)"}</strong> · {p.phone}{p.city ? ` · ${p.city}` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Field>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, margin: "10px 0", cursor: "pointer" }}>
        <input type="checkbox" checked={form.is_client} onChange={(e) => set("is_client", e.target.checked)} />
        Mark as known client (has purchased before)
      </label>
      {err && <p style={{ fontSize: 12, color: C.red, margin: "4px 0" }}>{err}</p>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <Btn ghost color={C.gray} onClick={onClose}>Cancel</Btn>
        <Btn color={C.blue} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Contact"}</Btn>
      </div>
    </Modal>
  );
}

function SendWAModal({ contact, waNumbers = [], onClose, initialMsgType }) {
  const [msgType, setMsgType] = useState(initialMsgType || "custom");
  const [message, setMessage] = useState("");
  const [fromClient, setFromClient] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [liveSessions, setLiveSessions] = useState([]);

  const name = contact.name ? contact.name.trim().split(/\s+/)[0] : "";

  // Load connected sessions from wa-service
  useEffect(() => {
    fetch(`${WA_SERVICE_URL}/clients`)
      .then((r) => r.json())
      .then((d) => {
        const connected = (d?.clients || []).filter((c) => c.connected);
        setLiveSessions(connected);
        if (connected.length > 0 && !fromClient) setFromClient(connected[0].client_id);
      })
      .catch(() => {
        // Fallback to funnel numbers if wa-service unreachable
        if (waNumbers.length > 0 && !fromClient) setFromClient(waNumbers[0]?.client || "");
      });
  }, []);

  // Build merged options: live sessions + funnel numbers (dedupe by client id)
  const sessionOptions = useMemo(() => {
    const map = new Map();
    liveSessions.forEach((s) => {
      map.set(s.client_id, { client: s.client_id, label: `${s.me || s.client_id} ✅ connected` });
    });
    waNumbers.forEach((w) => {
      if (!map.has(w.client)) map.set(w.client, { client: w.client, label: `${w.number} (${w.client})` });
    });
    return [...map.values()];
  }, [liveSessions, waNumbers]);

  const templates = {
    bday: name ? `Wishing you a very Happy Birthday ${name}! 🎂🎉 May this special day bring you joy and wonderful memories. Warm regards from Sun Sea Jewellers, Karol Bagh. 🙏` : `Wishing you a very Happy Birthday! 🎂🎉 May this special day bring you joy and wonderful memories. Warm regards from Sun Sea Jewellers, Karol Bagh. 🙏`,
    anniv: name ? `Wishing you a very Happy Anniversary ${name}! 💍✨ May your bond grow stronger with each passing year. Warm wishes from Sun Sea Jewellers. 🙏` : `Wishing you a very Happy Anniversary! 💍✨ May your bond grow stronger with each passing year. Warm wishes from Sun Sea Jewellers. 🙏`,
  };

  useEffect(() => {
    if (msgType === "bday") setMessage(templates.bday);
    else if (msgType === "anniv") setMessage(templates.anniv);
    else if (msgType === "custom") setMessage("");
  }, [msgType]);

  const send = async () => {
    if (!message.trim()) return;
    setSending(true);
    const res = await sendWA({ phone: contact.phone, message, leadId: contact.id, client: fromClient || undefined });
    setSending(false);
    setResult(res.ok ? "sent" : (res.error || "failed"));
  };

  return (
    <Modal title={`Send WA — ${name} · ${contact.phone}`} onClose={onClose} width={500}>
      {result ? (
        <div style={{ padding: 24, textAlign: "center", fontSize: 14, color: result === "sent" ? C.green : C.red }}>
          {result === "sent" ? "✅ Message sent!" : `❌ Failed: ${result}`}
          <div style={{ marginTop: 12 }}><Btn ghost color={C.gray} onClick={onClose}>Close</Btn></div>
        </div>
      ) : (
        <>
          <Field label="Send from">
            <Select value={fromClient} onChange={(e) => setFromClient(e.target.value)}>
              {sessionOptions.map((w) => (
                <option key={w.client} value={w.client}>{w.label}</option>
              ))}
              {!sessionOptions.length && <option value="">— no sessions found —</option>}
            </Select>
          </Field>

          <Field label="Message type">
            <div style={{ display: "flex", gap: 8 }}>
              {[["custom", "✏️ Custom"], ["bday", "🎂 Birthday"], ["anniv", "💍 Anniversary"]].map(([k, l]) => (
                <button key={k} onClick={() => setMsgType(k)} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${msgType === k ? C.blue : "#ddd"}`, background: msgType === k ? C.blue : "transparent", color: msgType === k ? "#fff" : "#333", cursor: "pointer", fontSize: 13 }}>{l}</button>
              ))}
            </div>
          </Field>

          <Field label="Message">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              style={{ width: "100%", fontSize: 13, padding: 8, borderRadius: 8, border: "1px solid #ddd", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }}
              placeholder="Type your message…"
            />
            <div style={{ fontSize: 11, color: "#aaa", textAlign: "right" }}>{message.length} chars</div>
          </Field>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <Btn ghost color={C.gray} onClick={onClose}>Cancel</Btn>
            <Btn color="#25d366" onClick={send} disabled={sending || !message.trim()} style={{ color: "#fff" }}>
              {sending ? "Sending…" : "📱 Send"}
            </Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

function RatesScreen() {
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    setLoading(true); setErr("");
    try {
      const res = await fetch(`${APPS_SCRIPT_URL}?action=rates`);
      const data = await res.json();
      // Apps Script returns either {ok, rates:[]} (new) or {rows:[]} (old).
      const rows = data.rates || data.rows || [];
      if (rows.length) setRates(rows);
      else setErr(data.error || "No rates returned");
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  const headers = rates.length ? Object.keys(rates[0]) : [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "#666" }}>Live rates from Google Sheet "new" tab via Apps Script. The bot fetches this on every reply.</div>
        <Btn ghost color={C.blue} onClick={load} disabled={loading}>↻ {loading ? "Loading…" : "Refresh"}</Btn>
      </div>
      {err && <p style={{ fontSize: 12, color: C.red }}>{err}</p>}
      {rates.length > 0 && (
        <div style={{ overflowX: "auto", background: "#fff", border: "1px solid #eee", borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f7f7f7" }}>
                {headers.map((h) => <th key={h} style={{ padding: 8, textAlign: "left", borderBottom: "1px solid #eee", textTransform: "uppercase", fontSize: 10, color: "#888", letterSpacing: 0.5 }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rates.map((r, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  {headers.map((h) => <td key={h} style={{ padding: 8 }}>{String(r[h] ?? "")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!rates.length && !loading && !err && <div style={{ padding: 20, color: "#aaa", textAlign: "center" }}>No rates loaded.</div>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// APPROVALS SCREEN — review & approve scheduled drip messages
// ──────────────────────────────────────────────────────────
function ApprovalsScreen({ funnels }) {
  const [rows, setRows] = useState([]);
  const [calRows, setCalRows] = useState([]); // birthday/anniversary messages always loaded 40d ahead
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState("calendar"); // "calendar" | "drip"
  const [groupBy, setGroupBy] = useState("person"); // "person" | "date"
  const [editing, setEditing] = useState({});
  const [editingName, setEditingName] = useState({});
  const [saving, setSaving] = useState(new Set());
  const [expanded, setExpanded] = useState(new Set()); // expanded person/date groups

  const load = useCallback(async () => {
    setLoading(true);
    // Calendar messages: always load 40 days ahead (birthday/anniversary funnels)
    const calUntil = new Date(Date.now() + 40 * 86400000).toISOString();
    const { data: calData } = await sb.from("bullion_scheduled_messages")
      .select("id,lead_id,funnel_id,body,edited_body,send_at,approved,approved_at,status,step:bullion_funnel_steps(id,name,step_order,use_ai_message),lead:bullion_leads(id,name,phone),funnel:funnels(id,name,kind)")
      .eq("tenant_id", getTenantId())
      .eq("status", "pending")
      .lte("send_at", calUntil)
      .in("funnel_id", funnels.filter((f) => f.kind === "birthday" || f.kind === "anniversary").map((f) => f.id))
      .order("send_at", { ascending: true })
      .limit(300);
    setCalRows(calData || []);

    // Regular drip messages: use the days filter
    const until = new Date(Date.now() + days * 86400000).toISOString();
    const calIds = funnels.filter((f) => f.kind === "birthday" || f.kind === "anniversary").map((f) => f.id);
    let dripQuery = sb.from("bullion_scheduled_messages")
      .select("id,lead_id,funnel_id,body,edited_body,send_at,approved,approved_at,status,step:bullion_funnel_steps(id,name,step_order,use_ai_message),lead:bullion_leads(id,name,phone),funnel:funnels(id,name,kind)")
      .eq("tenant_id", getTenantId())
      .eq("status", "pending")
      .lte("send_at", until)
      .order("send_at", { ascending: true })
      .limit(300);
    if (calIds.length) dripQuery = dripQuery.not("funnel_id", "in", `(${calIds.map((id) => `"${id}"`).join(",")})`);
    const { data: dripData } = await dripQuery;
    setRows(dripData || []);

    setExpanded(new Set());
    setLoading(false);
  }, [days, funnels]);

  useEffect(() => { load(); }, [load]);

  const setSav = (id, on) => setSaving((s) => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n; });

  async function approve(id) {
    setSav(id, true);
    const body = editing[id];
    const upd = { approved: true, approved_at: new Date().toISOString(), approved_by: loadUser()?.name || "admin" };
    if (body !== undefined) upd.edited_body = body;
    await sb.from("bullion_scheduled_messages").update(upd).eq("id", id);
    setRows((r) => r.map((m) => m.id === id ? { ...m, ...upd } : m));
    setSav(id, false);
  }

  async function reject(id) {
    setSav(id, true);
    await sb.from("bullion_scheduled_messages").update({ status: "canceled", canceled_reason: "rejected_in_approval" }).eq("id", id);
    setRows((r) => r.filter((m) => m.id !== id));
    setSav(id, false);
  }

  async function approveAll(ids) {
    for (const id of ids) await approve(id);
  }

  async function saveName(leadId, name) {
    if (!name?.trim()) return;
    setSav(leadId, true);
    await sb.from("bullion_leads").update({ name: name.trim() }).eq("id", leadId);
    setRows((r) => r.map((m) => m.lead_id === leadId ? { ...m, lead: { ...m.lead, name: name.trim() } } : m));
    setEditingName((e) => { const n = { ...e }; delete n[leadId]; return n; });
    setSav(leadId, false);
  }

  const activeRows = tab === "calendar" ? calRows : rows;

  const grouped = useMemo(() => {
    const map = new Map();
    for (const r of activeRows) {
      const key = groupBy === "person"
        ? (r.lead_id || r.lead?.phone)
        : new Date(r.send_at).toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, { label: groupBy === "person" ? (r.lead?.name || r.lead?.phone) : new Date(r.send_at).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }), rows: [], phone: r.lead?.phone, leadId: r.lead_id });
      map.get(key).rows.push(r);
    }
    return [...map.values()].sort((a, b) => groupBy === "person" ? (a.label||"").localeCompare(b.label||"") : a.rows[0].send_at.localeCompare(b.rows[0].send_at));
  }, [activeRows, groupBy]);

  const pendingCount = activeRows.filter((r) => !r.approved).length;
  const approvedCount = activeRows.filter((r) => r.approved).length;
  const calPendingCount = calRows.filter((r) => !r.approved).length;
  const toggleExpand = (key) => setExpanded((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const fmtSendAt = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", { weekday:"short", day:"numeric", month:"short" }) + " · " + d.toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit" });
  };

  const MessageCard = ({ r }) => {
    const body = editing[r.id] ?? (r.edited_body || r.body || "");
    const nameVal = editingName[r.lead_id] ?? r.lead?.name ?? "";
    const isSav = saving.has(r.id) || saving.has(r.lead_id);
    const funnelName = funnels.find((f) => f.id === r.funnel_id)?.name || r.funnel?.name || r.funnel_id;
    const stepName = r.step?.name || `Step ${r.step?.step_order || ""}`;

    return (
      <div style={{ background: r.approved ? "#f0fdf4" : "#fff", border: `1px solid ${r.approved ? "#86efac" : "#e5e7eb"}`, borderRadius: 10, padding: "12px 14px", marginBottom: 6 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          {groupBy === "date" && (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              {editingName[r.lead_id] !== undefined
                ? <input value={nameVal} onChange={(e) => setEditingName((x) => ({ ...x, [r.lead_id]: e.target.value }))} onBlur={() => saveName(r.lead_id, nameVal)} onKeyDown={(e) => e.key === "Enter" && saveName(r.lead_id, nameVal)} autoFocus style={{ fontSize: 13, fontWeight: 600, border: "1px solid #3b82f6", borderRadius: 5, padding: "2px 6px", width: 150 }} />
                : <span style={{ fontWeight: 600, fontSize: 13 }}>{r.lead?.name || r.lead?.phone}</span>}
              <button onClick={() => setEditingName((x) => x[r.lead_id] !== undefined ? (({ [r.lead_id]: _, ...rest }) => rest)(x) : { ...x, [r.lead_id]: r.lead?.name || "" })} style={{ fontSize: 11, padding: "1px 5px", borderRadius: 4, border: "1px solid #ddd", background: "#f9fafb", cursor: "pointer" }}>✏️</button>
              <span style={{ fontSize: 11, color: "#888" }}>{r.lead?.phone}</span>
            </div>
          )}
          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: "#f3f4f6", color: "#555" }}>{funnelName}</span>
          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: "#ede9fe", color: "#5b21b6", fontWeight: 600 }}>{stepName}</span>
          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: "#fef9c3", color: "#713f12" }}>📅 {fmtSendAt(r.send_at)}</span>
          {r.approved && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: "#dcfce7", color: "#166534", fontWeight: 600 }}>✅ Approved</span>}
          {r.step?.use_ai_message && <span style={{ fontSize: 10, color: r.edited_body ? "#6d28d9" : "#9ca3af" }}>{r.edited_body ? "🤖 AI" : "⏳ generating…"}</span>}
        </div>

        <textarea value={body} onChange={(e) => setEditing((x) => ({ ...x, [r.id]: e.target.value }))}
          rows={Math.max(3, Math.min(8, (body.match(/\n/g) || []).length + 2))}
          style={{ width: "100%", fontSize: 13, lineHeight: 1.5, border: "1px solid #e5e7eb", borderRadius: 7, padding: "8px 10px", resize: "vertical", boxSizing: "border-box", background: r.approved ? "#f0fdf4" : "#fafafa", fontFamily: "inherit" }} />

        {!r.approved && (
          <div style={{ display: "flex", gap: 6, marginTop: 7 }}>
            <button onClick={() => approve(r.id)} disabled={isSav} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 6, border: "none", background: "#16a34a", color: "#fff", cursor: "pointer", fontWeight: 600 }}>{isSav ? "…" : "✅ Approve"}</button>
            <button onClick={() => reject(r.id)} disabled={isSav} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 6, border: "1px solid #f87171", background: "#fff", color: "#dc2626", cursor: "pointer" }}>❌ Reject</button>
          </div>
        )}
        {r.approved && (
          <div style={{ display: "flex", gap: 6, marginTop: 7, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#16a34a" }}>✅ Will send {fmtSendAt(r.send_at)}</span>
            <button onClick={async () => { await sb.from("bullion_scheduled_messages").update({ approved: false }).eq("id", r.id); setRows((x) => x.map((m) => m.id === r.id ? { ...m, approved: false } : m)); }} style={{ fontSize: 11, padding: "2px 7px", borderRadius: 5, border: "1px solid #ddd", background: "#fff", cursor: "pointer", color: "#666" }}>Undo</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Tab switcher — Birthday/Anniversary vs regular drip */}
      <div style={{ display: "flex", gap: 0, marginBottom: 14, borderBottom: "2px solid #e5e7eb" }}>
        {[
          ["calendar", `🎂 Birthday & Anniversary${calPendingCount > 0 ? ` · ${calPendingCount} pending` : ""}`],
          ["drip", "💬 Regular Drip"],
        ].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ fontSize: 13, padding: "8px 18px", border: "none", borderBottom: tab === k ? "2px solid #3b82f6" : "2px solid transparent", marginBottom: -2, background: "transparent", color: tab === k ? "#1d4ed8" : "#555", fontWeight: tab === k ? 600 : 400, cursor: "pointer" }}>{l}</button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", borderRadius: 7, border: "1px solid #ddd", overflow: "hidden" }}>
          {[["person","👤 By Person"],["date","📅 By Date"]].map(([k,l]) => (
            <button key={k} onClick={() => setGroupBy(k)} style={{ fontSize: 12, padding: "5px 12px", border: "none", background: groupBy === k ? "#1d4ed8" : "#fff", color: groupBy === k ? "#fff" : "#555", cursor: "pointer" }}>{l}</button>
          ))}
        </div>
        {tab === "drip" && (
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ fontSize: 13, border: "1px solid #ddd", borderRadius: 6, padding: "5px 8px" }}>
            {[7,14,30,60].map((d) => <option key={d} value={d}>Next {d} days</option>)}
          </select>
        )}
        {tab === "calendar" && (
          <span style={{ fontSize: 12, color: "#888" }}>Showing next 40 days — approve at least 15 days before event</span>
        )}
        <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 10, background: "#fef9c3", color: "#713f12" }}>⏳ {pendingCount} pending</span>
        <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 10, background: "#dcfce7", color: "#166534" }}>✅ {approvedCount} approved</span>
        <button onClick={load} style={{ fontSize: 12, padding: "5px 10px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>↻ Refresh</button>
      </div>

      {loading && <div style={{ padding: 32, textAlign: "center", color: "#888" }}>Loading…</div>}
      {!loading && activeRows.length === 0 && <div style={{ padding: 32, textAlign: "center", color: "#888" }}>{tab === "calendar" ? "No birthday/anniversary messages in the next 40 days." : `No scheduled messages in the next ${days} days.`}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {grouped.map((g) => {
          const key = g.leadId || g.label;
          const isOpen = expanded.has(key);
          const unapproved = g.rows.filter((r) => !r.approved);
          const allApproved = unapproved.length === 0;

          return (
            <div key={key} style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
              {/* Group header */}
              <div onClick={() => toggleExpand(key)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: allApproved ? "#f0fdf4" : "#f9fafb", cursor: "pointer", userSelect: "none" }}>
                <span style={{ fontSize: 14 }}>{isOpen ? "▼" : "▶"}</span>
                {groupBy === "person" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {editingName[g.leadId] !== undefined
                      ? <input value={editingName[g.leadId]} onChange={(e) => setEditingName((x) => ({ ...x, [g.leadId]: e.target.value }))} onBlur={() => saveName(g.leadId, editingName[g.leadId])} onKeyDown={(e) => e.key === "Enter" && saveName(g.leadId, editingName[g.leadId])} onClick={(e) => e.stopPropagation()} autoFocus style={{ fontSize: 14, fontWeight: 600, border: "1px solid #3b82f6", borderRadius: 5, padding: "2px 6px", width: 160 }} />
                      : <span style={{ fontSize: 14, fontWeight: 600 }}>{g.label}</span>}
                    <button onClick={(e) => { e.stopPropagation(); setEditingName((x) => x[g.leadId] !== undefined ? (({ [g.leadId]: _, ...rest }) => rest)(x) : { ...x, [g.leadId]: g.label }); }} style={{ fontSize: 11, padding: "1px 5px", borderRadius: 4, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>✏️ name</button>
                    <span style={{ fontSize: 12, color: "#888" }}>{g.phone}</span>
                  </div>
                )}
                {groupBy === "date" && <span style={{ fontSize: 14, fontWeight: 600 }}>{g.label}</span>}
                <span style={{ fontSize: 12, color: "#888", marginLeft: 4 }}>{g.rows.length} message{g.rows.length > 1 ? "s" : ""}</span>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {g.rows.map((r) => (
                    <span key={r.id} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 8, background: r.approved ? "#dcfce7" : "#fef9c3", color: r.approved ? "#166534" : "#713f12" }}>
                      {r.step?.name || "Step"} · {new Date(r.send_at).toLocaleDateString("en-IN", { day:"numeric", month:"short" })}
                      {r.approved ? " ✅" : " ⏳"}
                    </span>
                  ))}
                </div>
                {unapproved.length > 0 && (
                  <button onClick={(e) => { e.stopPropagation(); approveAll(unapproved.map((r) => r.id)); }} style={{ marginLeft: "auto", fontSize: 12, padding: "3px 12px", borderRadius: 6, border: "1px solid #16a34a", background: "#f0fdf4", color: "#166534", cursor: "pointer", whiteSpace: "nowrap" }}>✅ Approve all {unapproved.length}</button>
                )}
              </div>

              {/* Messages — shown when expanded */}
              {isOpen && (
                <div style={{ padding: "10px 14px", background: "#fff" }}>
                  {g.rows.map((r) => <MessageCard key={r.id} r={r} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// MESSAGE HISTORY SCREEN — all bot/manual messages sent
// ──────────────────────────────────────────────────────────
function MessageHistoryScreen({ funnels }) {
  const [msgs, setMsgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [filterDir, setFilterDir] = useState("out");
  const [filterFunnel, setFilterFunnel] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - days * 86400000).toISOString();
    let q = sb.from("bullion_messages")
      .select("id,direction,body,status,claude_action,created_at,phone,funnel_id,lead:bullion_leads(name,phone)")
      .eq("tenant_id", getTenantId())
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    if (filterDir) q = q.eq("direction", filterDir);
    if (filterFunnel) q = q.eq("funnel_id", filterFunnel);
    const { data } = await q;
    setMsgs(data || []);
    setLoading(false);
  }, [days, filterDir, filterFunnel]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!search) return msgs;
    const s = search.toLowerCase();
    return msgs.filter((m) =>
      (m.lead?.name || "").toLowerCase().includes(s) ||
      (m.phone || "").includes(s) ||
      (m.body || "").toLowerCase().includes(s)
    );
  }, [msgs, search]);

  const dirIcon = (d) => d === "out" ? "→" : "←";
  const dirColor = (d) => d === "out" ? "#1d4ed8" : "#16a34a";
  const actionBadge = (a) => {
    if (!a) return null;
    const colors = { CONTINUE: "#dbeafe", HANDOFF: "#fef9c3", CONVERTED: "#dcfce7", DND: "#fee2e2", DRIP: "#ede9fe" };
    return <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: colors[a] || "#f3f4f6", color: "#333" }}>{a}</span>;
  };

  // Group by lead for cleaner view
  const grouped = useMemo(() => {
    const map = new Map();
    for (const m of filtered) {
      const key = m.phone;
      if (!map.has(key)) map.set(key, { name: m.lead?.name || m.phone, phone: m.phone, msgs: [] });
      map.get(key).msgs.push(m);
    }
    return [...map.values()];
  }, [filtered]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}
          style={{ fontSize: 13, border: "1px solid #ddd", borderRadius: 6, padding: "5px 8px" }}>
          {[1,3,7,14,30].map((d) => <option key={d} value={d}>Last {d} day{d>1?"s":""}</option>)}
        </select>
        <select value={filterDir} onChange={(e) => setFilterDir(e.target.value)}
          style={{ fontSize: 13, border: "1px solid #ddd", borderRadius: 6, padding: "5px 8px" }}>
          <option value="">All directions</option>
          <option value="out">→ Sent (bot/manual)</option>
          <option value="in">← Received (customer)</option>
        </select>
        <select value={filterFunnel} onChange={(e) => setFilterFunnel(e.target.value)}
          style={{ fontSize: 13, border: "1px solid #ddd", borderRadius: 6, padding: "5px 8px" }}>
          <option value="">All funnels</option>
          {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name / phone / message…"
          style={{ fontSize: 13, border: "1px solid #ddd", borderRadius: 6, padding: "5px 10px", flex: 1, minWidth: 180 }} />
        <span style={{ fontSize: 12, color: "#888" }}>{filtered.length} messages · {grouped.length} contacts</span>
        <button onClick={load} style={{ fontSize: 12, padding: "5px 10px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>↻</button>
      </div>

      {loading && <div style={{ padding: 32, textAlign: "center", color: "#888" }}>Loading…</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {grouped.map((g) => (
          <div key={g.phone} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "8px 14px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{g.name}</span>
                <span style={{ fontSize: 12, color: "#888", marginLeft: 8 }}>{g.phone}</span>
              </div>
              <span style={{ fontSize: 12, color: "#888" }}>{g.msgs.length} message{g.msgs.length > 1 ? "s" : ""}</span>
            </div>
            <div style={{ padding: "6px 14px" }}>
              {g.msgs.map((m) => (
                <div key={m.id} style={{ padding: "7px 0", borderBottom: "1px solid #f3f4f6", display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: dirColor(m.direction), minWidth: 16 }}>{dirIcon(m.direction)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, lineHeight: 1.4, color: "#1a1a1a", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 3, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, color: "#9ca3af" }}>{new Date(m.created_at).toLocaleString("en-IN", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" })}</span>
                      {m.funnel_id && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "#f3f4f6", color: "#555" }}>{funnels.find((f) => f.id === m.funnel_id)?.name || m.funnel_id}</span>}
                      {actionBadge(m.claude_action)}
                      {m.status === "failed" && <span style={{ fontSize: 10, color: "#dc2626" }}>❌ failed</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!loading && grouped.length === 0 && <div style={{ padding: 32, textAlign: "center", color: "#888" }}>No messages found.</div>}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// UPCOMING EVENTS SCREEN — birthdays & anniversaries
// ──────────────────────────────────────────────────────────
function UpcomingEventsScreen() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [err, setErr] = useState(null);
  const [sendTarget, setSendTarget] = useState(null); // { contact, msgType }

  useEffect(() => {
    load();
  }, [days]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const [{ data, error }, { data: scheduled }] = await Promise.all([
        sb.from("bullion_leads")
          .select("id,name,phone,city,bday,anniversary")
          .eq("tenant_id", getTenantId())
          .or("bday.not.is.null,anniversary.not.is.null"),
        sb.from("bullion_scheduled_messages")
          .select("lead_id,send_at,status,funnel_id")
          .eq("tenant_id", getTenantId())
          .in("funnel_id", ["birthday","anniversary"])
          .in("status", ["pending","sent"])
          .gte("created_at", new Date(Date.now() - 335 * 86400000).toISOString()),
      ]);
      if (error) { setErr(error.message); setLoading(false); return; }

      // Build map: lead_id → array of scheduled messages
      const schedMap = {};
      for (const s of (scheduled || [])) {
        if (!schedMap[s.lead_id]) schedMap[s.lead_id] = [];
        schedMap[s.lead_id].push(s);
      }

      const today = new Date(); today.setHours(0,0,0,0);
      const pastCutoff = -7 * 86400000;  // 7 days ago
      const futureCutoff = days * 86400000;
      const rows = [];

      for (const c of (data || [])) {
        for (const [field, icon, msgType, label] of [
          ["bday","🎂","bday","Birthday"],
          ["anniversary","💍","anniv","Anniversary"],
        ]) {
          const raw = c[field];
          if (!raw) continue;
          const p = raw.split("-");
          let m, d;
          if (p.length === 3) {
            const a = parseInt(p[1],10), b2 = parseInt(p[2],10);
            if (a >= 1 && a <= 12) { m = a - 1; d = b2; }
            else { m = b2 - 1; d = a; }
          } else if (p.length === 2) {
            const a = parseInt(p[0],10), b2 = parseInt(p[1],10);
            if (a >= 1 && a <= 12) { m = a - 1; d = b2; }
            else { m = b2 - 1; d = a; }
          } else continue;
          if (isNaN(m) || isNaN(d) || m < 0 || m > 11 || d < 1 || d > 31) continue;

          // Check this year occurrence
          const thisYear = new Date(today.getFullYear(), m, d);
          const diffThis = thisYear - today;

          let occurrence;
          if (diffThis >= pastCutoff && diffThis <= futureCutoff) {
            occurrence = thisYear;
          } else if (diffThis > futureCutoff) {
            // Not in range this year — skip
            continue;
          } else {
            // Already passed this year — check if within past 7 days
            if (diffThis >= pastCutoff) {
              occurrence = thisYear;
            } else {
              // Next year occurrence
              const nextYear = new Date(today.getFullYear() + 1, m, d);
              const diffNext = nextYear - today;
              if (diffNext <= futureCutoff) occurrence = nextYear;
              else continue;
            }
          }

          const daysUntil = Math.round((occurrence - today) / 86400000);
          const msgs = schedMap[c.id] || [];
          const pending = msgs.filter((m) => m.status === "pending");
          const sent = msgs.filter((m) => m.status === "sent");
          const nextSend = pending.length ? new Date(pending.sort((a,b) => new Date(a.send_at)-new Date(b.send_at))[0].send_at) : null;
          rows.push({ contact: { id: c.id, name: c.name, phone: c.phone, city: c.city }, icon, msgType, label, date: occurrence, daysUntil, pendingCount: pending.length, sentCount: sent.length, nextSend });
        }
      }
      // Past events first (most recent first), then future (soonest first)
      rows.sort((a,b) => {
        if (a.daysUntil < 0 && b.daysUntil < 0) return b.daysUntil - a.daysUntil;
        if (a.daysUntil < 0) return -1;
        if (b.daysUntil < 0) return 1;
        return a.daysUntil - b.daysUntil;
      });
      setEvents(rows);
    } catch(e) {
      setErr(e.message);
    }
    setLoading(false);
  }

  const urgencyColor = (d) => d < 0 ? "#9333ea" : d === 0 ? "#dc2626" : d <= 7 ? "#ea580c" : d <= 14 ? "#d97706" : "#555";
  const urgencyBg = (d) => d < 0 ? "#faf5ff" : d === 0 ? "#fef2f2" : d <= 7 ? "#fff7ed" : d <= 14 ? "#fffbeb" : "#fff";
  const daysLabel = (d) => d < 0 ? `${Math.abs(d)}d ago` : d === 0 ? "Today! 🎉" : d === 1 ? "Tomorrow" : `${d} days`;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Upcoming Events</h3>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}
          style={{ fontSize: 13, border: "1px solid #ddd", borderRadius: 6, padding: "4px 8px" }}>
          {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>Next {d} days</option>)}
        </select>
        <span style={{ fontSize: 13, color: "#888" }}>{events.length} events</span>
      </div>

      {loading && <div style={{ color: "#888", padding: 32, textAlign: "center" }}>Loading…</div>}
      {err && <div style={{ color: "#dc2626", padding: 16, background: "#fef2f2", borderRadius: 8, fontSize: 13 }}>Error: {err}</div>}
      {!loading && !err && events.length === 0 && (
        <div style={{ color: "#888", padding: 32, textAlign: "center" }}>No birthdays or anniversaries in next {days} days.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {events.map((ev, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: urgencyBg(ev.daysUntil), border: `1px solid ${urgencyColor(ev.daysUntil)}`, borderRadius: 10 }}>
            <div style={{ fontSize: 22, width: 32, textAlign: "center" }}>{ev.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{ev.contact.name || ev.contact.phone}</div>
              <div style={{ fontSize: 12, color: "#666" }}>{ev.contact.phone}{ev.contact.city ? ` · ${ev.contact.city}` : ""}</div>
              <div style={{ marginTop: 3, display: "flex", gap: 5, flexWrap: "wrap" }}>
                {ev.sentCount > 0 && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "#dcfce7", color: "#166534" }}>✅ {ev.sentCount} sent</span>}
                {ev.pendingCount > 0 && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "#dbeafe", color: "#1d4ed8" }}>📅 {ev.pendingCount} queued{ev.nextSend ? ` · next ${ev.nextSend.toLocaleDateString("en-IN", { day:"numeric", month:"short" })} ${ev.nextSend.toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit" })}` : ""}</span>}
                {ev.sentCount === 0 && ev.pendingCount === 0 && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "#fef9c3", color: "#713f12" }}>⚠️ not enrolled</span>}
              </div>
            </div>
            <div style={{ textAlign: "right", minWidth: 90 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: urgencyColor(ev.daysUntil) }}>{daysLabel(ev.daysUntil)}</div>
              <div style={{ fontSize: 11, color: "#888" }}>{ev.label} · {ev.date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>
            </div>
            <button onClick={() => setSendTarget({ contact: ev.contact, msgType: ev.msgType })}
              style={{ fontSize: 12, padding: "5px 12px", borderRadius: 7, border: "1px solid #22c55e", background: "#f0fdf4", color: "#166534", cursor: "pointer", whiteSpace: "nowrap" }}>
              💬 Wish
            </button>
          </div>
        ))}
      </div>

      {sendTarget && (
        <SendWAModal
          contact={sendTarget.contact}
          initialMsgType={sendTarget.msgType}
          onClose={() => setSendTarget(null)}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// CONTACTS DB SCREEN — spreadsheet view with inline editing
// ──────────────────────────────────────────────────────────
function ContactsDBScreen() {
  const [contacts, setContacts] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterTags, setFilterTags] = useState([]);
  const [filterSource, setFilterSource] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [filterRating, setFilterRating] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [bulkTag, setBulkTag] = useState("");
  const [editingTagsFor, setEditingTagsFor] = useState(null); // contact id
  const [saving, setSaving] = useState(null);

  const [allLeadTags, setAllLeadTags] = useState([]); // distinct tags actually used on leads

  // Load tags from registry + discover all tags actually used on leads
  useEffect(() => {
    sb.from("bullion_tags").select("name,category,color")
      .eq("tenant_id", getTenantId()).order("sort_order")
      .then(({ data }) => setAllTags(data || []));
    // Fetch a sample of leads to discover tags actually in use (covers import-added tags
    // that may not have been registered in bullion_tags yet)
    sb.from("bullion_leads").select("tags,source")
      .eq("tenant_id", getTenantId()).not("tags", "is", null).limit(1000)
      .then(({ data }) => {
        const seen = new Set();
        (data || []).forEach((r) => {
          (r.tags || []).forEach((t) => seen.add(t));
          if (r.source) seen.add(r.source);
        });
        setAllLeadTags([...seen].sort());
      });
  }, []);

  // Server-side filtered query — runs when any filter changes (debounced for search)
  const load = useCallback(async (sq, src, city, rating, tags) => {
    setLoading(true);
    try {
      let q = sb.from("bullion_leads").select("*")
        .eq("tenant_id", getTenantId())
        .order("name", { ascending: true, nullsFirst: false })
        .limit(500);
      if (sq) q = q.or(`name.ilike.%${sq}%,phone.ilike.%${sq}%,mobile2.ilike.%${sq}%,email.ilike.%${sq}%,city.ilike.%${sq}%,client_code.ilike.%${sq}%,company.ilike.%${sq}%`);
      // Source: check both the source column (manually set) AND tags array (set by import script).
      // Imported contacts store source in tags (e.g. "sanjeevji"), not in the source column.
      if (src) q = q.or(`source.ilike.${src},tags.cs.{"${src}"}`);
      if (city) q = q.ilike("city", `%${city}%`);
      if (rating) q = q.eq("client_rating", Number(rating));
      if (tags.length > 0) q = q.contains("tags", tags);
      const { data, error } = await q;
      if (error) console.error("DB query error", error);
      setContacts(data || []);
    } catch(e) { console.error(e); }
    setLoading(false);
  }, []);

  // Initial load
  useEffect(() => { load("", "", "", "", []); }, [load]);

  // Debounce search, instant for other filters
  useEffect(() => {
    const t = setTimeout(() => load(search, filterSource, filterCity, filterRating, filterTags), search ? 400 : 0);
    return () => clearTimeout(t);
  }, [search, filterSource, filterCity, filterRating, filterTags, load]);

  // Source dropdown: tags marked category=source in registry PLUS any source-like tags
  // actually found on leads (covers import-added sources not yet in bullion_tags)
  const registeredSourceTags = allTags.filter((t) => t.category === "source").map((t) => t.name);
  const sourceTags = [...new Set([...registeredSourceTags, ...allLeadTags.filter((t) =>
    // include a lead tag in source dropdown if it looks like a source (in registry or not a common segment tag)
    registeredSourceTags.includes(t) ||
    ["master_client_list","signup_form","fb_bday","google_csv","saurav_phone","shivani",
     "customer_is_king_form","sunseaclientcombined","exhibition_sheet","customer_enquiry_form",
     "walk_in","sanjeevji","wbiztool_drip","bday_xls","customer_xls"].includes(t)
  )])].sort();
  const otherTags = allTags.filter((t) => t.category !== "source");

  const filtered = contacts; // already filtered server-side

  const toggleSelect = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(selected.size === contacts.length ? new Set() : new Set(contacts.map((c) => c.id)));

  async function saveField(id, field, value) {
    setSaving(id);
    await sb.from("bullion_leads").update({ [field]: value }).eq("id", id);
    setContacts((prev) => prev.map((c) => c.id === id ? { ...c, [field]: value } : c));
    setSaving(null);
  }

  async function toggleTag(contactId, tag) {
    const c = contacts.find((x) => x.id === contactId);
    if (!c) return;
    const tags = c.tags || [];
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    await saveField(contactId, "tags", next);
  }

  async function applyBulkTag() {
    if (!bulkTag || selected.size === 0) return;
    setSaving("bulk");
    for (const id of selected) {
      const c = contacts.find((x) => x.id === id);
      if (!c) continue;
      const tags = c.tags || [];
      if (!tags.includes(bulkTag)) {
        await sb.from("bullion_leads").update({ tags: [...tags, bulkTag] }).eq("id", id);
        setContacts((prev) => prev.map((x) => x.id === id ? { ...x, tags: [...(x.tags||[]), bulkTag] } : x));
      }
    }
    setSaving(null);
    setBulkTag("");
  }

  function exportCSV() {
    const rows = selected.size > 0 ? filtered.filter((c) => selected.has(c.id)) : filtered;
    const headers = ["Name","Phone","Email","City","Source","Tags","Rating","Birthday","Anniversary","Client","Last Message","Joined"];
    const lines = [headers.join(","), ...rows.map((c) => [
      `"${(c.name||"").replace(/"/g,'""')}"`,
      c.phone||"",
      c.email||"",
      c.city||"",
      c.source||"",
      `"${(c.tags||[]).join("; ")}"`,
      c.client_rating||"",
      c.bday||"",
      c.anniversary||"",
      "",
      c.last_msg_at ? new Date(c.last_msg_at).toLocaleDateString("en-IN") : "",
      c.created_at ? new Date(c.created_at).toLocaleDateString("en-IN") : "",
    ].join(","))];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `ssj-contacts-${new Date().toISOString().slice(0,10)}.csv`; a.click();
  }

  const tagColor = (name) => allTags.find((t) => t.name === name)?.color || "#e5e7eb";

  return (
    <div>
      {/* Filters row */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name / phone / mobile2 / email / city / company / code…"
          style={{ fontSize: 13, border: "1px solid #ddd", borderRadius: 6, padding: "5px 10px", minWidth: 260 }} />
        <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)}
          style={{ fontSize: 13, border: "1px solid #ddd", borderRadius: 6, padding: "5px 8px" }}>
          <option value="">All sources</option>
          {sourceTags.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input value={filterCity} onChange={(e) => setFilterCity(e.target.value)} placeholder="City…"
          style={{ fontSize: 13, border: "1px solid #ddd", borderRadius: 6, padding: "5px 8px", width: 100 }} />
        <select value={filterRating} onChange={(e) => setFilterRating(e.target.value)}
          style={{ fontSize: 13, border: "1px solid #ddd", borderRadius: 6, padding: "5px 8px" }}>
          <option value="">Any rating</option>
          {[5,4,3,2,1].map((r) => <option key={r} value={r}>{"★".repeat(r)}</option>)}
        </select>
        {/* Tag filters — all tags shown */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {otherTags.map((t) => (
            <button key={t.name} onClick={() => setFilterTags((prev) => prev.includes(t.name) ? prev.filter((x) => x !== t.name) : [...prev, t.name])}
              style={{ fontSize: 11, padding: "3px 8px", borderRadius: 12, border: `1px solid ${filterTags.includes(t.name) ? "#3b82f6" : "#ddd"}`, background: filterTags.includes(t.name) ? "#3b82f6" : (t.color || "#f3f4f6"), color: filterTags.includes(t.name) ? "#fff" : "#333", cursor: "pointer" }}>
              {t.name}
            </button>
          ))}
          {filterTags.length > 0 && <button onClick={() => setFilterTags([])} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 12, border: "1px solid #f87171", background: "#fef2f2", color: "#dc2626", cursor: "pointer" }}>✕ clear</button>}
        </div>
        <span style={{ fontSize: 12, color: "#888", marginLeft: "auto" }}>{filtered.length} contacts</span>
        <button onClick={exportCSV} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 7, border: "1px solid #16a34a", background: "#f0fdf4", color: "#166534", cursor: "pointer" }}>
          ⬇ Export CSV {selected.size > 0 ? `(${selected.size})` : ""}
        </button>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1d4ed8" }}>{selected.size} selected</span>
          <select value={bulkTag} onChange={(e) => setBulkTag(e.target.value)}
            style={{ fontSize: 13, border: "1px solid #ddd", borderRadius: 6, padding: "4px 8px" }}>
            <option value="">Add tag…</option>
            {allTags.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
          <button onClick={applyBulkTag} disabled={!bulkTag || saving === "bulk"}
            style={{ fontSize: 12, padding: "5px 12px", borderRadius: 7, border: "1px solid #3b82f6", background: "#3b82f6", color: "#fff", cursor: "pointer" }}>
            {saving === "bulk" ? "Applying…" : "Apply to selected"}
          </button>
          <button onClick={() => setSelected(new Set())} style={{ fontSize: 12, padding: "5px 10px", borderRadius: 7, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>Deselect all</button>
        </div>
      )}

      {loading && <div style={{ padding: 32, textAlign: "center", color: "#888" }}>Loading {contacts.length > 0 ? `${contacts.length}+` : ""}…</div>}
      {!loading && <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>Loaded {contacts.length} total · showing {filtered.length}</div>}

      {/* Table */}
      {!loading && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                <th style={{ padding: "8px 10px", textAlign: "left", width: 32 }}>
                  <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} />
                </th>
                {["Name","Phone","City","Source","Tags","Rating","Birthday","Anniversary","DND"].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#374151", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} style={{ borderBottom: "1px solid #f3f4f6", background: selected.has(c.id) ? "#eff6ff" : "transparent" }}
                  onMouseEnter={(e) => { if (!selected.has(c.id)) e.currentTarget.style.background = "#fafafa"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = selected.has(c.id) ? "#eff6ff" : "transparent"; }}>
                  <td style={{ padding: "6px 10px" }}>
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} />
                  </td>
                  <td style={{ padding: "6px 10px", fontWeight: 500, whiteSpace: "nowrap" }}>
                    {c.name || <em style={{ color: "#aaa" }}>—</em>}
                  </td>
                  <td style={{ padding: "6px 10px", color: "#555" }}>{c.phone}</td>
                  <td style={{ padding: "6px 10px", color: "#555" }}>{c.city || <em style={{ color: "#ccc" }}>—</em>}</td>
                  {/* Source — shows source column OR source tags from tags array */}
                  <td style={{ padding: "6px 10px", minWidth: 120 }}>
                    {(() => {
                      const tagSources = (c.tags || []).filter((t) => sourceTags.includes(t));
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <select value={c.source || ""} onChange={(e) => saveField(c.id, "source", e.target.value)}
                            style={{ fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 5, padding: "2px 6px", background: "transparent", maxWidth: 140 }}>
                            <option value="">—</option>
                            {sourceTags.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                          {tagSources.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                              {tagSources.map((t) => (
                                <span key={t} style={{ fontSize: 10, padding: "1px 5px", borderRadius: 8, background: "#dbeafe", color: "#1d4ed8" }}>{t}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  {/* Tags — inline chips + add */}
                  <td style={{ padding: "6px 10px", minWidth: 160 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center", position: "relative" }}>
                      {(c.tags || []).map((t) => (
                        <span key={t} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 10, background: tagColor(t), cursor: "pointer", whiteSpace: "nowrap" }}
                          onClick={() => toggleTag(c.id, t)} title="Click to remove">
                          {t} ×
                        </span>
                      ))}
                      <button onClick={() => setEditingTagsFor(editingTagsFor === c.id ? null : c.id)}
                        style={{ fontSize: 11, padding: "2px 7px", borderRadius: 10, border: "1px dashed #9ca3af", background: "transparent", cursor: "pointer", color: "#6b7280" }}>
                        +
                      </button>
                      {editingTagsFor === c.id && (
                        <div style={{ position: "absolute", zIndex: 50, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,.1)", padding: 8, display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 260 }}>
                          {otherTags.map((t) => (
                            <button key={t.name} onClick={() => { toggleTag(c.id, t.name); }}
                              style={{ fontSize: 11, padding: "3px 8px", borderRadius: 10, border: `1px solid ${(c.tags||[]).includes(t.name) ? "#3b82f6" : "#ddd"}`, background: (c.tags||[]).includes(t.name) ? "#3b82f6" : (t.color||"#f3f4f6"), color: (c.tags||[]).includes(t.name) ? "#fff" : "#333", cursor: "pointer" }}>
                              {t.name}
                            </button>
                          ))}
                          <button onClick={() => setEditingTagsFor(null)} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 10, border: "1px solid #f87171", background: "#fef2f2", color: "#dc2626", cursor: "pointer" }}>done</button>
                        </div>
                      )}
                    </div>
                  </td>
                  {/* Rating */}
                  <td style={{ padding: "6px 10px" }}>
                    <select value={c.client_rating || ""} onChange={(e) => saveField(c.id, "client_rating", e.target.value ? Number(e.target.value) : null)}
                      style={{ fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 5, padding: "2px 4px", background: "transparent" }}>
                      <option value="">—</option>
                      {[5,4,3,2,1].map((r) => <option key={r} value={r}>{"★".repeat(r)}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "6px 10px", color: "#555", whiteSpace: "nowrap" }}>{c.bday || <em style={{ color: "#ccc" }}>—</em>}</td>
                  <td style={{ padding: "6px 10px", color: "#555", whiteSpace: "nowrap" }}>{c.anniversary || <em style={{ color: "#ccc" }}>—</em>}</td>
                  <td style={{ padding: "6px 10px", textAlign: "center" }}>
                    <button onClick={() => saveField(c.id, "dnd", !c.dnd)}
                      title={c.dnd ? "DND on — click to remove" : "Click to add DND"}
                      style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, border: `1px solid ${c.dnd ? "#dc2626" : "#e5e7eb"}`, background: c.dnd ? "#fef2f2" : "transparent", color: c.dnd ? "#dc2626" : "#9ca3af", cursor: "pointer", fontWeight: c.dnd ? 600 : 400 }}>
                      {c.dnd ? "🚫 DND" : "—"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div style={{ padding: 32, textAlign: "center", color: "#888" }}>No contacts match the filters.</div>}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// ANALYTICS SCREEN — per-funnel metrics
// ──────────────────────────────────────────────────────────
function AnalyticsScreen({ funnels }) {
  const [metrics, setMetrics] = useState([]);
  const [stageCounts, setStageCounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Pipeline dashboard
  const [pipeline, setPipeline] = useState({ hot: { count: 0, budget: 0 }, warm: { count: 0, budget: 0 }, cold: { count: 0, budget: 0 }, converted: { count: 0, budget: 0 } });

  // Manager call performance (today)
  const [callPerf, setCallPerf] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [targets, setTargets] = useState({});  // staffId → { target_calls, target_conversions, target_revenue }
  const [lbExpanded, setLbExpanded] = useState(false);
  const [staffList, setStaffList] = useState([]);

  // Config editor
  const [configRows, setConfigRows] = useState([]);
  const [configSaving, setConfigSaving] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    const tid = getTenantId();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

    const [m, leads, demands, callsToday, callsMonth, staffData, targetsData, configData] = await Promise.all([
      sb.from("bullion_funnel_metrics").select("*").eq("tenant_id", tid),
      sb.from("bullion_leads").select("funnel_id,stage,status,created_at").eq("tenant_id", tid).gte("created_at", fromDate).lte("created_at", toDate + "T23:59:59"),
      sb.from("bullion_demands").select("id,budget,outcome,created_at,next_call_at,occasion_date,visit_scheduled_at,is_callback_promised,lead:bullion_leads(status,last_msg_at)").eq("tenant_id", tid).is("outcome", null).limit(500),
      sb.from("bullion_call_logs").select("staff_id,disposition,lag_bucket,talk_bucket,is_suspicious,duration_sec").eq("tenant_id", tid).gte("called_at", todayStart.toISOString()),
      sb.from("bullion_call_logs").select("staff_id,disposition,duration_sec").eq("tenant_id", tid).gte("called_at", monthStart.toISOString()),
      sb.from("staff").select("id,name,username").eq("tenant_id", tid),
      sb.from("staff_targets").select("*").eq("tenant_id", tid).eq("month", monthStart.toISOString().slice(0, 10)),
      sb.from("bullion_dropdowns").select("id,field,value").eq("tenant_id", tid).in("field", ["google_review_link","post_sale_day3","post_sale_day7","post_sale_day30","missed_call_auto_reply"]).eq("active", true).order("sort_order"),
    ]);

    if (m.data) setMetrics(m.data);
    if (configData.data) setConfigRows(configData.data);
    if (staffData.data) setStaffList(staffData.data);

    if (leads.data) {
      const counts = {};
      leads.data.forEach((l) => {
        const k = l.funnel_id || "—";
        if (!counts[k]) counts[k] = { funnel_id: k, ...Object.fromEntries(STAGES.map((s) => [s, 0])), total: 0 };
        counts[k][l.stage] = (counts[k][l.stage] || 0) + 1;
        counts[k].total += 1;
      });
      setStageCounts(Object.values(counts));
    }

    // Pipeline buckets — use demandTemperature-equivalent logic
    if (demands.data) {
      const buckets = { hot: { count: 0, budget: 0 }, warm: { count: 0, budget: 0 }, cold: { count: 0, budget: 0 }, converted: { count: 0, budget: 0 } };
      demands.data.forEach((d) => {
        const temp = demandTemperature(d);
        const bucket = (temp === "converted" || temp === "dead") ? "converted" : (temp || "cold");
        if (!buckets[bucket]) return;
        buckets[bucket].count += 1;
        buckets[bucket].budget += Number(d.budget || 0);
      });
      setPipeline(buckets);
    }

    // Call performance today
    if (callsToday.data && staffData.data) {
      const byStaff = {};
      callsToday.data.forEach((c) => {
        if (!c.staff_id) return;
        if (!byStaff[c.staff_id]) byStaff[c.staff_id] = { calls: 0, lags: [], suspicious: 0, connects: 0 };
        byStaff[c.staff_id].calls += 1;
        if (c.lag_bucket) byStaff[c.staff_id].lags.push(c.lag_bucket);
        if (c.is_suspicious) byStaff[c.staff_id].suspicious += 1;
        if (["answered_interested","answered_not_now","answered_not_interested","callback_requested"].includes(c.disposition))
          byStaff[c.staff_id].connects += 1;
      });
      const ANSWERED_DISPOSITIONS = new Set(["answered_interested","answered_not_now","answered_not_interested","callback_requested"]);
      const perf = Object.entries(byStaff).map(([sid, v]) => {
        const staff = staffData.data.find((s) => s.id === sid);
        const instantCount = v.lags.filter((l) => l === "INSTANT").length;
        const missedCount = v.lags.filter((l) => l === "MISSED").length;
        return {
          staffId: sid, name: staff?.name || staff?.username || sid,
          calls: v.calls, connects: v.connects,
          instantPct: v.lags.length ? Math.round(instantCount * 100 / v.lags.length) : null,
          missedPct: v.lags.length ? Math.round(missedCount * 100 / v.lags.length) : null,
          suspicious: v.suspicious,
          connectsPct: v.calls ? Math.round(v.connects * 100 / v.calls) : 0,
        };
      }).sort((a, b) => b.calls - a.calls);
      setCallPerf(perf);
    }

    // Leaderboard this month
    if (callsMonth.data && staffData.data) {
      const byStaff = {};
      callsMonth.data.forEach((c) => {
        if (!c.staff_id) return;
        if (!byStaff[c.staff_id]) byStaff[c.staff_id] = { calls: 0, talkSec: 0 };
        byStaff[c.staff_id].calls += 1;
        byStaff[c.staff_id].talkSec += Number(c.duration_sec || 0);
      });
      const lb = Object.entries(byStaff).map(([sid, v]) => {
        const staff = staffData.data.find((s) => s.id === sid);
        return { staffId: sid, name: staff?.name || staff?.username || sid, calls: v.calls, talkSec: v.talkSec };
      }).sort((a, b) => b.calls - a.calls);
      setLeaderboard(lb);
    }

    // Targets map
    if (targetsData.data) {
      const t = {};
      targetsData.data.forEach((r) => { t[r.staff_id] = r; });
      setTargets(t);
    }

    setLoading(false);
  }, [fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const saveTarget = async (staffId, field, value) => {
    const tid = getTenantId();
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const month = monthStart.toISOString().slice(0, 10);
    const existing = targets[staffId] || {};
    const patch = { tenant_id: tid, staff_id: staffId, month, target_calls: 0, target_conversions: 0, target_revenue: 0, ...existing, [field]: Number(value) || 0 };
    delete patch.id; delete patch.created_at;
    await sb.from("staff_targets").upsert(patch, { onConflict: "staff_id,month" });
    setTargets((t) => ({ ...t, [staffId]: { ...existing, [field]: Number(value) || 0 } }));
  };

  const saveConfig = async (row, newVal) => {
    setConfigSaving((s) => ({ ...s, [row.id]: true }));
    await sb.from("bullion_dropdowns").update({ value: newVal }).eq("id", row.id);
    setConfigRows((rows) => rows.map((r) => r.id === row.id ? { ...r, value: newVal } : r));
    setConfigSaving((s) => ({ ...s, [row.id]: false }));
  };

  const fmtLakh = (n) => {
    if (!n) return "₹—";
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)} Cr`;
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)} L`;
    return `₹${Number(n).toLocaleString("en-IN")}`;
  };

  const fmtTalk = (sec) => {
    const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const pipeTiles = [
    { key: "hot", label: "🔥 Hot", color: "#e53e3e" },
    { key: "warm", label: "🌤 Warm", color: "#dd6b20" },
    { key: "cold", label: "❄️ Cold", color: "#3182ce" },
    { key: "converted", label: "✅ Conv.", color: "#38a169" },
  ];

  return (
    <div>
      {/* Pipeline Overview */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#333" }}>📊 Pipeline Overview</div>
          <div style={{ fontSize: 11, color: "#888" }}>
            Total: <strong>{fmtLakh(pipeTiles.reduce((s, t) => s + pipeline[t.key].budget, 0))}</strong>
            {" · "}{pipeTiles.reduce((s, t) => s + pipeline[t.key].count, 0)} open demands
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {pipeTiles.map((t) => (
            <div key={t.key} style={{ background: "#fafafa", borderRadius: 8, padding: "12px 10px", textAlign: "center", borderTop: `3px solid ${t.color}` }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.color, marginBottom: 4 }}>{t.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#333" }}>{fmtLakh(pipeline[t.key].budget)}</div>
              <div style={{ fontSize: 11, color: "#888" }}>{pipeline[t.key].count} lead{pipeline[t.key].count !== 1 ? "s" : ""}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Manager Call Performance — Today */}
      {callPerf.length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#333", marginBottom: 10 }}>📞 Call Performance — Today</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f7f7f7" }}>
                  {["Telecaller","Calls","Connects","INSTANT%","MISSED%","Suspicious","Connect%"].map((h) => (
                    <th key={h} style={{ padding: "6px 10px", textAlign: h === "Telecaller" ? "left" : "center", fontSize: 10, color: "#888", fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {callPerf.map((r) => (
                  <tr key={r.staffId} style={{ borderTop: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "6px 10px", fontWeight: 500 }}>{r.name}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>{r.calls}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center", color: C.green }}>{r.connects}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center", color: r.instantPct != null ? C.green : "#ccc" }}>{r.instantPct != null ? `${r.instantPct}%` : "—"}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center", color: r.missedPct > 30 ? C.red : "#555" }}>{r.missedPct != null ? `${r.missedPct}%` : "—"}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center", color: r.suspicious > 0 ? C.red : "#ccc" }}>{r.suspicious > 0 ? `⚠️ ${r.suspicious}` : "—"}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center", color: r.connectsPct >= 40 ? C.green : r.connectsPct >= 20 ? C.orange : C.red }}>{r.connectsPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Leaderboard — This Month */}
      {leaderboard.length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <button type="button" onClick={() => setLbExpanded((v) => !v)}
            style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#333" }}>🏆 Leaderboard — This Month</span>
            <span style={{ fontSize: 11, color: "#aaa" }}>{lbExpanded ? "▲" : "▼"}</span>
          </button>
          {lbExpanded && (
            <div style={{ marginTop: 10, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f7f7f7" }}>
                    {["Telecaller","Calls","Talk time","Target calls","Target conv."].map((h) => (
                      <th key={h} style={{ padding: "6px 10px", textAlign: h === "Telecaller" ? "left" : "center", fontSize: 10, color: "#888", fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((r, i) => {
                    const tgt = targets[r.staffId] || {};
                    const callPct = tgt.target_calls ? Math.min(100, Math.round(r.calls * 100 / tgt.target_calls)) : null;
                    return (
                      <tr key={r.staffId} style={{ borderTop: "1px solid #f0f0f0" }}>
                        <td style={{ padding: "6px 10px", fontWeight: 500 }}>
                          {i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : ""}{r.name}
                        </td>
                        <td style={{ padding: "6px 10px", textAlign: "center" }}>
                          {r.calls}
                          {callPct !== null && (
                            <div style={{ height: 3, background: "#eee", borderRadius: 2, marginTop: 2 }}>
                              <div style={{ height: 3, width: `${callPct}%`, background: callPct >= 80 ? C.green : callPct >= 50 ? C.orange : C.red, borderRadius: 2 }} />
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "6px 10px", textAlign: "center", color: "#666" }}>{fmtTalk(r.talkSec)}</td>
                        <TargetCell staffId={r.staffId} field="target_calls" value={tgt.target_calls || ""} onSave={saveTarget} />
                        <TargetCell staffId={r.staffId} field="target_conversions" value={tgt.target_conversions || ""} onSave={saveTarget} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 6 }}>Click any target number to edit inline.</div>
            </div>
          )}
        </Card>
      )}

      {/* Funnel conversion (existing) */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "#666", flex: 1 }}>Conversion % and stage drop-off per funnel.</div>
        <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ width: 150 }} />
        <span style={{ color: "#888" }}>→</span>
        <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ width: 150 }} />
        <Btn ghost small color={C.gray} onClick={load} disabled={loading}>↻ Refresh all</Btn>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginBottom: 20 }}>
        {metrics.map((m) => (
          <Card key={m.funnel_id || "none"}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{m.funnel_name || m.funnel_id || "—"}</div>
            <div style={{ display: "flex", gap: 12, alignItems: "baseline", marginBottom: 8 }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: C.green }}>{m.conversion_pct ?? 0}%</div>
              <div style={{ fontSize: 11, color: "#888" }}>conversion</div>
            </div>
            <div style={{ fontSize: 11, color: "#666", lineHeight: 1.8 }}>
              <div>Total leads: <strong>{m.total_leads}</strong></div>
              <div>Converted: <span style={{ color: C.green }}>{m.converted}</span> · Handoff: <span style={{ color: C.red }}>{m.handoff}</span> · Active: <span style={{ color: C.blue }}>{m.active}</span></div>
              <div>Avg exchanges: {m.avg_exchanges ?? "—"}</div>
            </div>
          </Card>
        ))}
        {!metrics.length && !loading && <div style={{ color: "#aaa", fontSize: 13 }}>No leads yet.</div>}
      </div>

      {stageCounts.length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Stage drop-off · {fmtD(fromDate)} → {fmtD(toDate)}</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f7f7f7" }}>
                  <th style={{ padding: 8, textAlign: "left", fontSize: 10, color: "#888" }}>FUNNEL</th>
                  {STAGES.map((s) => <th key={s} style={{ padding: 8, textAlign: "center", fontSize: 10, color: STAGE_C[s] }}>{s.toUpperCase()}</th>)}
                  <th style={{ padding: 8, textAlign: "center", fontSize: 10, color: "#888" }}>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {stageCounts.map((r) => {
                  const f = funnels.find((ff) => ff.id === r.funnel_id);
                  return (
                    <tr key={r.funnel_id} style={{ borderTop: "1px solid #f0f0f0" }}>
                      <td style={{ padding: 8, fontWeight: 500 }}>{f?.name || r.funnel_id}</td>
                      {STAGES.map((s) => <td key={s} style={{ padding: 8, textAlign: "center", color: r[s] ? STAGE_C[s] : "#ccc" }}>{r[s] || 0}</td>)}
                      <td style={{ padding: 8, textAlign: "center", fontWeight: 600 }}>{r.total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Config editor */}
      {configRows.length > 0 && (
        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#333", marginBottom: 10 }}>⚙️ Config — WA Templates & Links</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {configRows.map((row) => (
              <ConfigRow key={row.id} row={row} saving={!!configSaving[row.id]} onSave={saveConfig} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function TargetCell({ staffId, field, value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(value || ""));
  const commit = () => { setEditing(false); onSave(staffId, field, val); };
  if (editing) {
    return (
      <td style={{ padding: "4px 10px", textAlign: "center" }}>
        <input autoFocus type="number" value={val} onChange={(e) => setVal(e.target.value)}
          onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          style={{ width: 60, textAlign: "center", border: "1px solid #aaa", borderRadius: 4, padding: "2px 4px", fontSize: 12 }} />
      </td>
    );
  }
  return (
    <td style={{ padding: "6px 10px", textAlign: "center", cursor: "pointer", color: value ? "#333" : "#aaa" }}
      onClick={() => setEditing(true)} title="Click to edit">
      {value || "set →"}
    </td>
  );
}

const CONFIG_LABELS = {
  google_review_link: "Google Review Link",
  post_sale_day3: "Post-Sale Day 3 WA",
  post_sale_day7: "Post-Sale Day 7 WA (Review)",
  post_sale_day30: "Post-Sale Day 30 WA",
  missed_call_auto_reply: "Missed Call Auto-Reply",
};

function ConfigRow({ row, saving, onSave }) {
  const [val, setVal] = useState(row.value || "");
  const [dirty, setDirty] = useState(false);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr auto", gap: 8, alignItems: "start" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#555", paddingTop: 6 }}>{CONFIG_LABELS[row.field] || row.field}</div>
      <Textarea rows={2} value={val} onChange={(e) => { setVal(e.target.value); setDirty(true); }}
        style={{ fontSize: 12, resize: "vertical" }} />
      <Btn small color={dirty ? C.blue : C.gray} disabled={!dirty || saving} onClick={() => { onSave(row, val); setDirty(false); }}>
        {saving ? "…" : "Save"}
      </Btn>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// TAG HELPERS
// ──────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────
// MERGE LEADS MODAL — combine two records for the same person
// ──────────────────────────────────────────────────────────────────────────
function MergeLeadsModal({ primaryId, secondaryId, onClose, onMerged }) {
  const [primary, setPrimary] = useState(null);
  const [secondary, setSecondary] = useState(null);
  const [primaryDemands, setPrimaryDemands] = useState([]);
  const [secondaryDemands, setSecondaryDemands] = useState([]);
  const [swapped, setSwapped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const pid = swapped ? secondaryId : primaryId;
  const sid = swapped ? primaryId : secondaryId;

  useEffect(() => {
    Promise.all([
      sb.from("bullion_leads").select("id,name,phone,city,source,tags,created_at,last_msg_at").eq("id", primaryId).single(),
      sb.from("bullion_leads").select("id,name,phone,city,source,tags,created_at,last_msg_at").eq("id", secondaryId).single(),
      sb.from("bullion_demands").select("id,product_category,description,created_at,outcome").eq("lead_id", primaryId).limit(5),
      sb.from("bullion_demands").select("id,product_category,description,created_at,outcome").eq("lead_id", secondaryId).limit(5),
    ]).then(([p, s, pd, sd]) => {
      setPrimary(p.data); setSecondary(s.data);
      setPrimaryDemands(pd.data || []); setSecondaryDemands(sd.data || []);
    });
  }, [primaryId, secondaryId]);

  const doMerge = async () => {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/merge-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-crm-secret": CRM_SECRET },
        body: JSON.stringify({ primaryLeadId: pid, secondaryLeadId: sid }),
      });
      const data = await r.json();
      if (!data.ok) { setErr(data.error || "Merge failed"); setBusy(false); return; }
      onMerged && onMerged(pid);
    } catch (e) { setErr(String(e)); setBusy(false); }
  };

  const LeadCard = ({ lead, demands, label, isPrimary }) => (
    <div style={{ flex: 1, border: `2px solid ${isPrimary ? C.green : "#ddd"}`, borderRadius: 10, padding: 14, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: isPrimary ? C.green : "#888", marginBottom: 6, textTransform: "uppercase" }}>
        {isPrimary ? "✓ PRIMARY (keep)" : "Secondary (merge in)"}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{lead?.name || "(no name)"}</div>
      <div style={{ fontSize: 12, color: "#555", fontFamily: "monospace" }}>📱 {lead?.phone}</div>
      {lead?.city && <div style={{ fontSize: 12, color: "#888" }}>📍 {lead.city}</div>}
      {lead?.source && <div style={{ fontSize: 11, color: "#888" }}>Source: {lead.source}</div>}
      <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Joined: {lead?.created_at ? new Date(lead.created_at).toLocaleDateString("en-IN") : "—"}</div>
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#555", marginBottom: 4 }}>Demands ({demands.length})</div>
        {demands.map((d) => (
          <div key={d.id} style={{ fontSize: 11, color: "#555", padding: "2px 0" }}>
            · {d.product_category} — {(d.description || "").slice(0, 40)} {d.outcome ? `[${d.outcome}]` : ""}
          </div>
        ))}
        {!demands.length && <div style={{ fontSize: 11, color: "#aaa" }}>No demands</div>}
      </div>
    </div>
  );

  if (!primary || !secondary) return (
    <Modal title="Merge Leads" onClose={onClose} width={680}>
      <div style={{ padding: 30, textAlign: "center", color: "#888" }}>Loading…</div>
    </Modal>
  );

  const p = swapped ? secondary : primary;
  const s = swapped ? primary : secondary;
  const pd = swapped ? secondaryDemands : primaryDemands;
  const sd = swapped ? primaryDemands : secondaryDemands;

  return (
    <Modal title="Merge Leads — same person, two records" onClose={onClose} width={680}>
      <div style={{ fontSize: 13, color: "#555", marginBottom: 14 }}>
        All demands, messages and call history from the <strong>secondary</strong> will move to the <strong>primary</strong>. Secondary is then archived. This cannot be undone.
      </div>
      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <LeadCard lead={p} demands={pd} label="primary" isPrimary={true} />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>
          <button onClick={() => setSwapped((v) => !v)}
            style={{ padding: "6px 10px", background: "#f0f0f0", border: "1px solid #ddd", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
            title="Swap which is primary">⇄</button>
        </div>
        <LeadCard lead={s} demands={sd} label="secondary" isPrimary={false} />
      </div>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
        ↑ Use ⇄ to swap which record becomes the primary (kept) one. Choose the one with the real phone number you want to keep.
      </div>
      {err && <div style={{ color: C.red, fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn ghost color={C.gray} onClick={onClose}>Cancel</Btn>
        <Btn color={C.red} onClick={doMerge} disabled={busy}>{busy ? "Merging…" : "✓ Merge — keep primary"}</Btn>
      </div>
    </Modal>
  );
}

function TagChip({ tag, onRemove, small }) {
  if (!tag) return null;
  const color = tag.color || "#888";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: small ? 10 : 11, padding: small ? "2px 6px" : "3px 8px",
      borderRadius: 10, background: color + "22", color: color,
      border: `1px solid ${color}55`, marginRight: 4, marginBottom: 4,
      whiteSpace: "nowrap",
    }}>
      {tag.name}
      {onRemove && (
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{ background: "transparent", border: "none", color: color, cursor: "pointer", padding: 0, marginLeft: 2, fontSize: 12 }}>×</button>
      )}
    </span>
  );
}

function TagEditor({ leadId, allTags, onReload }) {
  const [attached, setAttached] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await sb.from("bullion_lead_tags").select("tag_id").eq("lead_id", leadId);
    setAttached((data || []).map((r) => r.tag_id));
    setLoading(false);
  }, [leadId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const toggle = async (tagId) => {
    if (attached.includes(tagId)) {
      await sb.from("bullion_lead_tags").delete().eq("lead_id", leadId).eq("tag_id", tagId);
    } else {
      await sb.from("bullion_lead_tags").insert({ lead_id: leadId, tag_id: tagId });
    }
    await load();
    onReload && onReload();
  };

  const byCategory = useMemo(() => {
    const groups = { flag: [], segment: [], source: [], custom: [] };
    for (const t of allTags || []) {
      (groups[t.category] || groups.custom).push(t);
    }
    return groups;
  }, [allTags]);

  const attachedTags = (allTags || []).filter((t) => attached.includes(t.id));

  return (
    <div style={{ padding: 10, borderBottom: "1px solid #eee", background: "#fafbfc" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "#666", fontWeight: 500 }}>Tags:</span>
        {attachedTags.map((t) => (
          <TagChip key={t.id} tag={t} onRemove={() => toggle(t.id)} small />
        ))}
        <button onClick={() => setOpen(!open)} style={{
          fontSize: 10, padding: "2px 8px", borderRadius: 10, border: `1px dashed ${C.gray}`,
          background: "transparent", cursor: "pointer", color: C.gray,
        }}>{open ? "–" : "+"} add</button>
      </div>
      {open && (
        <div style={{ marginTop: 8, padding: 8, background: "#fff", border: "1px solid #eee", borderRadius: 8, maxHeight: 220, overflowY: "auto" }}>
          {["flag", "segment", "source", "custom"].map((cat) => {
            const list = byCategory[cat] || [];
            if (!list.length) return null;
            return (
              <div key={cat} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", marginBottom: 4 }}>{cat}</div>
                <div>
                  {list.map((t) => {
                    const on = attached.includes(t.id);
                    return (
                      <span key={t.id} onClick={() => toggle(t.id)} style={{
                        display: "inline-block", fontSize: 10, padding: "2px 8px", borderRadius: 10,
                        background: on ? (t.color || "#888") : (t.color || "#888") + "15",
                        color: on ? "#fff" : (t.color || "#888"),
                        border: `1px solid ${(t.color || "#888")}55`,
                        marginRight: 4, marginBottom: 4, cursor: "pointer", userSelect: "none",
                      }}>
                        {on ? "✓ " : ""}{t.name}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {loading && <span style={{ fontSize: 10, color: "#aaa" }}>…</span>}
    </div>
  );
}

function FamilyMembersSection({ leadId, tenantId }) {
  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ relationship: "son", name: "", dob: "", mobile: "" });

  const load = useCallback(async () => {
    const { data } = await sb.from("bullion_family_members").select("*").eq("lead_id", leadId).order("created_at");
    setRows(data || []);
  }, [leadId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.name && !form.dob) return;
    await sb.from("bullion_family_members").insert({ tenant_id: tenantId, lead_id: leadId, ...form });
    setForm({ relationship: "son", name: "", dob: "", mobile: "" });
    setAdding(false);
    await load();
  };
  const remove = async (id) => {
    if (!confirm("Remove this family member?")) return;
    await sb.from("bullion_family_members").delete().eq("id", id);
    await load();
  };

  return (
    <div style={{ padding: 10, borderBottom: "1px solid #eee", background: "#fafbfc" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: "#666", fontWeight: 500 }}>👨‍👩‍👧 Family ({rows.length})</span>
        <button onClick={() => setAdding(!adding)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, border: `1px solid ${C.blue}`, background: "transparent", color: C.blue, cursor: "pointer" }}>{adding ? "cancel" : "+ add"}</button>
      </div>
      {rows.map((r) => (
        <div key={r.id} style={{ fontSize: 11, color: "#555", marginBottom: 3, display: "flex", justifyContent: "space-between" }}>
          <span>{r.relationship} · {r.name || "(no name)"} {r.dob && `· 🎂 ${r.dob}`} {r.mobile && `· 📞 ${r.mobile}`}</span>
          <button onClick={() => remove(r.id)} style={{ background: "transparent", border: "none", color: C.red, cursor: "pointer", fontSize: 11 }}>×</button>
        </div>
      ))}
      {adding && (
        <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 110px 130px auto", gap: 4, marginTop: 6 }}>
          <Select value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })}>
            {["spouse","son","daughter","father","mother","sibling","other"].map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
          <Input placeholder="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="MM-DD" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
          <Input placeholder="mobile" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          <Btn small color={C.blue} onClick={save}>save</Btn>
        </div>
      )}
    </div>
  );
}

function VisitsSection({ leadId }) {
  const [rows, setRows] = useState([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    (async () => {
      const { data } = await sb.from("bullion_visits").select("*").eq("lead_id", leadId).order("visited_at", { ascending: false });
      setRows(data || []);
    })();
  }, [expanded, leadId]);

  return (
    <div style={{ padding: 10, borderBottom: "1px solid #eee", background: "#fafbfc" }}>
      <div onClick={() => setExpanded(!expanded)} style={{ cursor: "pointer", fontSize: 11, color: "#666", fontWeight: 500 }}>
        {expanded ? "▼" : "▶"} Visit history
      </div>
      {expanded && (
        <div style={{ maxHeight: 200, overflowY: "auto", marginTop: 6 }}>
          {rows.length === 0 && <div style={{ fontSize: 11, color: "#aaa" }}>No visits recorded.</div>}
          {rows.map((v) => (
            <div key={v.id} style={{ fontSize: 10, color: "#555", marginBottom: 3, padding: 4, background: "#fff", borderRadius: 4 }}>
              <div><strong>{v.visited_at ? new Date(v.visited_at).toLocaleDateString("en-IN") : "—"}</strong> · {v.counter || "—"} · {v.staff || "—"} {v.sale && <span style={{ color: C.green, fontWeight: 600 }}>✓ sale</span>}</div>
              {v.items_seen && <div style={{ color: "#888" }}>items: {v.items_seen}</div>}
              {v.purpose && <div style={{ color: "#888" }}>note: {v.purpose}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// TAGS ADMIN SCREEN
// ──────────────────────────────────────────────────────────
function TagsScreen({ onReload }) {
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await sb.from("bullion_tags").select("*").eq("tenant_id", getTenantId()).order("category").order("sort_order");
    setRows(data || []);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const add = () => setRows((r) => [...r, { _new: true, tenant_id: getTenantId(), name: "", category: "custom", color: "#888", sort_order: 500 }]);
  const update = (idx, k, v) => setRows((r) => r.map((row, i) => i === idx ? { ...row, [k]: v, _dirty: true } : row));
  const remove = async (idx) => {
    const row = rows[idx];
    if (row.id && !confirm(`Delete tag "${row.name}"? This will untag it from all leads.`)) return;
    if (row.id) await sb.from("bullion_tags").delete().eq("id", row.id);
    setRows((r) => r.filter((_, i) => i !== idx));
  };
  const saveAll = async () => {
    setSaving(true);
    for (const row of rows) {
      if (!row._new && !row._dirty) continue;
      if (!row.name) continue;
      const { _new, _dirty, ...clean } = row;
      if (row.id) await sb.from("bullion_tags").update(clean).eq("id", row.id);
      else await sb.from("bullion_tags").insert(clean);
    }
    await load();
    setSaving(false);
    onReload && onReload();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 13, color: "#666" }}>Tags = flexible labels on leads. Flag = checkbox. Segment = audience. Source = which sheet it came from. Custom = anything you add.</div>
        <div style={{ display: "flex", gap: 6 }}>
          <Btn ghost small color={C.gray} onClick={load}>↻</Btn>
          <Btn small color={C.blue} onClick={add}>+ Add</Btn>
        </div>
      </div>
      <Card style={{ padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#f7f7f7" }}>
            <th style={{ padding: 8, textAlign: "left", fontSize: 10, color: "#888" }}>NAME</th>
            <th style={{ padding: 8, textAlign: "left", fontSize: 10, color: "#888" }}>CATEGORY</th>
            <th style={{ padding: 8, textAlign: "left", fontSize: 10, color: "#888" }}>COLOR</th>
            <th style={{ padding: 8, textAlign: "center", fontSize: 10, color: "#888" }}>ORDER</th>
            <th style={{ padding: 8, textAlign: "center", width: 60 }}></th>
          </tr></thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.id || `new-${idx}`} style={{ borderTop: "1px solid #f5f5f5" }}>
                <td style={{ padding: 6 }}><Input value={row.name || ""} onChange={(e) => update(idx, "name", e.target.value)} /></td>
                <td style={{ padding: 6 }}>
                  <Select value={row.category} onChange={(e) => update(idx, "category", e.target.value)}>
                    <option value="flag">flag</option><option value="segment">segment</option><option value="source">source</option><option value="custom">custom</option>
                  </Select>
                </td>
                <td style={{ padding: 6 }}>
                  <Input type="color" value={row.color || "#888"} onChange={(e) => update(idx, "color", e.target.value)} style={{ width: 50, padding: 2, height: 30 }} />
                </td>
                <td style={{ padding: 6, textAlign: "center" }}>
                  <Input type="number" value={row.sort_order || 0} onChange={(e) => update(idx, "sort_order", Number(e.target.value))} style={{ width: 60, padding: 4 }} />
                </td>
                <td style={{ padding: 6, textAlign: "center" }}>
                  <Btn small ghost color={C.red} onClick={() => remove(idx)}>×</Btn>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} style={{ padding: 20, textAlign: "center", color: "#aaa" }}>No tags.</td></tr>}
          </tbody>
        </table>
      </Card>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <Btn color={C.blue} onClick={saveAll} disabled={saving}>{saving ? "Saving…" : "Save all"}</Btn>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// IMPORTS SCREEN (read-only log)
// ──────────────────────────────────────────────────────────
function ImportsScreen() {
  const [rows, setRows] = useState([]);
  const load = useCallback(async () => {
    const { data } = await sb.from("bullion_imports").select("*").eq("tenant_id", getTenantId()).order("started_at", { ascending: false }).limit(50);
    setRows(data || []);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 13, color: "#666" }}>History of data imports from external sheets / CSV files.</div>
        <Btn ghost small color={C.gray} onClick={load}>↻</Btn>
      </div>
      <Card style={{ padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "#f7f7f7" }}>
            <th style={{ padding: 8, textAlign: "left", fontSize: 10, color: "#888" }}>FINISHED</th>
            <th style={{ padding: 8, textAlign: "left", fontSize: 10, color: "#888" }}>FILE</th>
            <th style={{ padding: 8, textAlign: "right", fontSize: 10, color: "#888" }}>IN</th>
            <th style={{ padding: 8, textAlign: "right", fontSize: 10, color: "#888" }}>CREATED</th>
            <th style={{ padding: 8, textAlign: "right", fontSize: 10, color: "#888" }}>MERGED</th>
            <th style={{ padding: 8, textAlign: "right", fontSize: 10, color: "#888" }}>SKIPPED</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid #f5f5f5" }}>
                <td style={{ padding: 8 }}>{r.finished_at ? fmtDT(r.finished_at) : "(running)"}</td>
                <td style={{ padding: 8 }}>{r.file}</td>
                <td style={{ padding: 8, textAlign: "right" }}>{r.rows_in}</td>
                <td style={{ padding: 8, textAlign: "right", color: C.green }}>{r.rows_created}</td>
                <td style={{ padding: 8, textAlign: "right", color: C.blue }}>{r.rows_merged}</td>
                <td style={{ padding: 8, textAlign: "right", color: C.red }}>{r.rows_skipped}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "#aaa" }}>No imports yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// CUSTOMER PROFILE UPDATE FORM — /update?t=TOKEN (no login)
// ──────────────────────────────────────────────────────────
function ContactUpdateForm({ token }) {
  const [lead, setLead] = useState(null);
  const [family, setFamily] = useState([]);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [deletedIds, setDeletedIds] = useState([]);

  useEffect(() => {
    fetch(`/api/contact-update?t=${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) { setErr("This link is invalid or expired."); setLoading(false); return; }
        setLead(d.lead);
        setForm({ name: d.lead.name || "", email: d.lead.email || "", city: d.lead.city || "", bday: d.lead.bday || "", anniversary: d.lead.anniversary || "" });
        setFamily(d.family || []);
        setLoading(false);
      })
      .catch(() => { setErr("Something went wrong. Please try again."); setLoading(false); });
  }, [token]);

  const setF = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const setMember = (i, k, v) => setFamily((p) => p.map((m, idx) => idx === i ? { ...m, [k]: v } : m));
  const addMember = () => setFamily((p) => [...p, { relationship: "spouse", name: "", dob: "", mobile: "" }]);
  const removeMember = (i) => {
    const m = family[i];
    if (m.id) setDeletedIds((p) => [...p, m.id]);
    setFamily((p) => p.filter((_, idx) => idx !== i));
  };

  const save = async () => {
    setSaving(true); setErr("");
    const r = await fetch(`/api/contact-update?t=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, family, deletedFamilyIds: deletedIds }),
    });
    const d = await r.json();
    setSaving(false);
    if (d.ok) setDone(true);
    else setErr("Failed to save. Please try again.");
  };

  const S = { fontFamily: "system-ui, sans-serif", maxWidth: 480, margin: "0 auto", padding: "24px 16px", color: "#1a1a1a" };
  const label = { fontSize: 12, color: "#666", display: "block", marginBottom: 4, marginTop: 12 };
  const input = { width: "100%", fontSize: 14, padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8, boxSizing: "border-box", outline: "none" };
  const btn = { width: "100%", padding: "12px", fontSize: 15, fontWeight: 600, border: "none", borderRadius: 10, background: "#1a1a1a", color: "#fff", cursor: "pointer", marginTop: 20 };

  if (loading) return <div style={S}><p style={{ color: "#888", textAlign: "center", marginTop: 60 }}>Loading your details…</p></div>;
  if (err && !lead) return <div style={S}><p style={{ color: "#dc2626", textAlign: "center", marginTop: 60 }}>{err}</p></div>;

  if (done) return (
    <div style={{ ...S, textAlign: "center", paddingTop: 60 }}>
      <div style={{ fontSize: 48 }}>🙏</div>
      <h2 style={{ fontSize: 20, margin: "16px 0 8px" }}>Thank you, {lead?.name?.split(" ")[0] || ""}!</h2>
      <p style={{ color: "#555", fontSize: 14 }}>Your details have been updated. We look forward to seeing you at Sun Sea Jewellers!</p>
    </div>
  );

  return (
    <div style={S}>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 32 }}>💎</div>
        <h2 style={{ fontSize: 18, margin: "8px 0 4px" }}>Sun Sea Jewellers</h2>
        <p style={{ fontSize: 13, color: "#666", margin: 0 }}>Please confirm your details so we can serve you better</p>
      </div>

      <div style={{ background: "#f9fafb", borderRadius: 12, padding: 16 }}>
        <h3 style={{ fontSize: 14, margin: "0 0 12px", color: "#374151" }}>Your Details</h3>
        <span style={label}>Name</span>
        <input style={input} value={form.name} onChange={(e) => setF("name", e.target.value)} placeholder="Your full name" />
        <span style={label}>Phone</span>
        <input style={{ ...input, background: "#f3f4f6", color: "#888" }} value={lead?.phone || ""} disabled />
        <span style={label}>Email</span>
        <input style={input} value={form.email} onChange={(e) => setF("email", e.target.value)} placeholder="your@email.com" type="email" />
        <span style={label}>City</span>
        <input style={input} value={form.city} onChange={(e) => setF("city", e.target.value)} placeholder="Delhi" />
        <span style={label}>Your Birthday (DD-MM or YYYY-MM-DD)</span>
        <input style={input} value={form.bday} onChange={(e) => setF("bday", e.target.value)} placeholder="25-04 or 1985-04-25" />
        <span style={label}>Your Anniversary (DD-MM or YYYY-MM-DD)</span>
        <input style={input} value={form.anniversary} onChange={(e) => setF("anniversary", e.target.value)} placeholder="15-11 or 2005-11-15" />
      </div>

      <div style={{ background: "#f9fafb", borderRadius: 12, padding: 16, marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, margin: 0, color: "#374151" }}>Family Members</h3>
          <button onClick={addMember} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>+ Add</button>
        </div>
        <p style={{ fontSize: 12, color: "#888", margin: "0 0 12px" }}>Help us wish your family on their special days too 🎂</p>
        {family.length === 0 && <p style={{ fontSize: 13, color: "#aaa", textAlign: "center" }}>No family members added yet</p>}
        {family.map((m, i) => (
          <div key={i} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <select value={m.relationship} onChange={(e) => setMember(i, "relationship", e.target.value)}
                style={{ fontSize: 13, border: "1px solid #ddd", borderRadius: 6, padding: "4px 8px" }}>
                {["spouse","son","daughter","mother","father","brother","sister","other"].map((r) => <option key={r}>{r}</option>)}
              </select>
              <button onClick={() => removeMember(i)} style={{ fontSize: 12, color: "#dc2626", border: "none", background: "none", cursor: "pointer" }}>Remove</button>
            </div>
            <span style={label}>Name</span>
            <input style={input} value={m.name} onChange={(e) => setMember(i, "name", e.target.value)} placeholder="Name" />
            <span style={label}>Birthday (DD-MM or YYYY-MM-DD)</span>
            <input style={input} value={m.dob} onChange={(e) => setMember(i, "dob", e.target.value)} placeholder="25-04 or 1985-04-25" />
            <span style={label}>Mobile (optional)</span>
            <input style={input} value={m.mobile || ""} onChange={(e) => setMember(i, "mobile", e.target.value)} placeholder="9810XXXXXX" />
          </div>
        ))}
      </div>

      {err && <p style={{ color: "#dc2626", fontSize: 13, marginTop: 8 }}>{err}</p>}
      <button style={btn} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save My Details ✓"}</button>
      <p style={{ fontSize: 11, color: "#aaa", textAlign: "center", marginTop: 12 }}>Sun Sea Jewellers · Karol Bagh, New Delhi</p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────
// BROADCASTS SCREEN — festival / occasion bulk messages
// Write one message → pick audience → schedule → cron sends all.
// No per-message approval: the review happens once before you hit Schedule.
// ──────────────────────────────────────────────────────────
const PRODUCT_INTERESTS = ["24K","22K","silver","gold_coin","silver_coin","ginni","bar","polki","kundan","diamond","gemstone","unknown"];
const LEAD_STATUSES = ["active","handoff","converted","new"];

function BroadcastsScreen({ allTags }) {
  const [broadcasts, setBroadcasts] = useState([]);
  const [sendHistory, setSendHistory] = useState([]); // from bullion_broadcast_sends
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [scheduling, setScheduling] = useState(null);
  const [tab, setTab] = useState("broadcasts"); // "broadcasts" | "history"

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await sb.from("funnels")
      .select("*, step:bullion_funnel_steps(id,message_template,use_ai_message,step_order,active)")
      .eq("tenant_id", getTenantId()).eq("kind", "broadcast").order("created_at", { ascending: false });

    if (data?.length) {
      const ids = data.map((f) => f.id);
      const { data: msgs } = await sb.from("bullion_scheduled_messages")
        .select("funnel_id, status").in("funnel_id", ids);
      const counts = {};
      for (const m of msgs || []) {
        if (!counts[m.funnel_id]) counts[m.funnel_id] = { pending: 0, sent: 0, failed: 0 };
        counts[m.funnel_id][m.status] = (counts[m.funnel_id][m.status] || 0) + 1;
      }
      setBroadcasts((data || []).map((f) => ({ ...f, _counts: counts[f.id] || {} })));
    } else { setBroadcasts([]); }

    // Load send history
    const { data: hist } = await sb.from("bullion_broadcast_sends")
      .select("*, funnel:funnels(name)")
      .eq("tenant_id", getTenantId())
      .order("created_at", { ascending: false }).limit(100);
    setSendHistory(hist || []);

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #e5e7eb" }}>
          {[["broadcasts","📢 Broadcasts"],["history","📋 Send History"]].map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ fontSize: 13, padding: "8px 18px", border: "none", borderBottom: tab === k ? "2px solid #3b82f6" : "2px solid transparent", marginBottom: -2, background: "transparent", color: tab === k ? "#1d4ed8" : "#555", fontWeight: tab === k ? 600 : 400, cursor: "pointer" }}>{l}</button>
          ))}
        </div>
        {tab === "broadcasts" && <Btn color={C.blue} onClick={() => setCreating(true)}>+ New broadcast</Btn>}
      </div>

      {loading && <div style={{ color: "#888", fontSize: 13 }}>Loading…</div>}

      {/* ── Send History tab ── */}
      {!loading && tab === "history" && (
        <div>
          {sendHistory.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "#aaa", fontSize: 13 }}>No broadcasts sent yet.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {sendHistory.map((h) => (
              <Card key={h.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{h.funnel?.name || h.funnel_id}</div>
                    <div style={{ fontSize: 11, color: "#888" }}>{new Date(h.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}{h.created_by ? ` · by ${h.created_by}` : ""}</div>
                  </div>
                  <div style={{ display: "flex", gap: 10, fontSize: 13, fontWeight: 600 }}>
                    <span style={{ color: C.green }}>✅ {h.recipient_count}</span>
                    {h.skipped_count > 0 && <span style={{ color: "#888" }}>⤵ {h.skipped_count} skipped</span>}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "#555", background: "#f9fafb", padding: "8px 10px", borderRadius: 8, borderLeft: "3px solid #3b82f6", whiteSpace: "pre-wrap", lineHeight: 1.5, marginBottom: 8 }}>
                  {h.message_text || "(no message)"}
                </div>
                {h.media_url && (
                  <div style={{ fontSize: 11, color: "#888" }}>📎 {h.media_type || "media"} attached: <a href={h.media_url} target="_blank" rel="noreferrer" style={{ color: C.blue }}>view file</a></div>
                )}
                {h.filter_json && (
                  <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
                    Audience: {h.filter_json.includeAll ? "everyone" : `status: ${(h.filter_json.statuses||[]).join(", ") || "all"}`}
                    {h.filter_json.city ? ` · city: ${h.filter_json.city}` : ""}
                    {(h.filter_json.tags||[]).length > 0 ? ` · tags: ${h.filter_json.tags.join(", ")}` : ""}
                    {` · pace: ${h.filter_json.pace || "safe"}`}
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ── Broadcasts tab ── */}
      {!loading && tab === "broadcasts" && broadcasts.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "#aaa", fontSize: 13, border: "2px dashed #e5e7eb", borderRadius: 12 }}>
          No broadcasts yet. Create one for Diwali, Akshaya Tritiya, Dhanteras, etc.
        </div>
      )}

      {tab === "broadcasts" && <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {broadcasts.map((b) => {
          const step = (b.step || []).sort((a, z) => a.step_order - z.step_order)[0];
          const c = b._counts || {};
          const total = (c.pending || 0) + (c.sent || 0) + (c.failed || 0);
          return (
            <Card key={b.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{b.name}</div>
                  <div style={{ fontSize: 12, color: "#555", marginBottom: 8, whiteSpace: "pre-wrap", lineHeight: 1.5, background: "#f9fafb", padding: "8px 10px", borderRadius: 8, borderLeft: "3px solid #3b82f6" }}>
                    {step?.message_template || "(no message set — edit steps)"}
                  </div>
                  <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#888" }}>
                    {total > 0 && <span>Total scheduled: <strong>{total}</strong></span>}
                    {c.sent > 0 && <span style={{ color: C.green }}>✅ Sent: {c.sent}</span>}
                    {c.pending > 0 && <span style={{ color: C.orange }}>⏳ Pending: {c.pending}</span>}
                    {c.failed > 0 && <span style={{ color: C.red }}>❌ Failed: {c.failed}</span>}
                    {total === 0 && <span style={{ color: "#aaa" }}>Not sent yet</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <Btn small ghost color={C.blue} onClick={() => setScheduling(b)}>📤 Send to audience</Btn>
                </div>
              </div>
            </Card>
          );
        })}
      </div>}

      {creating && (
        <BroadcastCreateModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />
      )}
      {scheduling && (
        <BroadcastSendModal broadcast={scheduling} allTags={allTags} onClose={() => setScheduling(null)} onSent={() => { setScheduling(null); load(); }} />
      )}
    </div>
  );
}

function BroadcastCreateModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    name: "", message: "", waSession: "", aiMessage: false,
    addIntro: true,      // prepend "Sun Sea Jewellers here" line
    addSaveLink: true,   // append 1-tap save contact link
    addStop: true,       // append "Reply STOP to unsubscribe"
  });
  const [sessions, setSessions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`${WA_SERVICE_URL}/clients`).then((r) => r.json()).then((d) => setSessions(d?.clients || [])).catch(() => {});
  }, []);

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  // Build the final template with intro/save lines wrapped around the user's message
  const buildTemplate = () => {
    const parts = [];
    if (form.addIntro) parts.push("Hi {{name}}, *Sun Sea Jewellers* here (Karol Bagh) 🙏");
    parts.push(form.message.trim());
    if (form.addSaveLink) parts.push("💾 Save our number in one tap:\nhttps://ssjbot.gemtre.in/contact.vcf");
    if (form.addStop) parts.push("_Reply STOP anytime to stop receiving messages from us._");
    return parts.join("\n\n");
  };

  const save = async () => {
    if (!form.name.trim()) return setErr("Name is required");
    if (!form.message.trim()) return setErr("Message text is required");
    if (!form.waSession) return setErr("Choose a WA session to send from");
    setSaving(true); setErr("");

    const funnelId = "bc_" + Date.now();
    const sess = sessions.find((s) => s.client_id === form.waSession);
    const { error: fe } = await sb.from("funnels").insert({
      id: funnelId,
      tenant_id: getTenantId(),
      name: form.name.trim(),
      description: form.name.trim(),
      kind: "broadcast",
      active: true,
      wbiztool_client: form.waSession,
      wa_number: sess?.me ? normalizePhone(sess.me.replace(/@.*/, "")) : "",
    });
    if (fe) { setErr(fe.message); setSaving(false); return; }

    const { error: se } = await sb.from("bullion_funnel_steps").insert({
      tenant_id: getTenantId(),
      funnel_id: funnelId,
      step_order: 1,
      name: "Message",
      delay_minutes: 0,
      trigger_type: "after_enrollment",
      message_template: buildTemplate(),
      use_ai_message: form.aiMessage,
      active: true,
      step_type: "message",
    });
    if (se) { setErr(se.message); setSaving(false); return; }

    setSaving(false);
    onSaved();
  };

  return (
    <Modal title="New broadcast" onClose={onClose} width={580}>
      <Field label="Broadcast name" required>
        <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Diwali 2026, Akshaya Tritiya, Dhanteras…" />
      </Field>
      <Field label="WA session to send from" required>
        <Select value={form.waSession} onChange={(e) => set("waSession", e.target.value)}>
          <option value="">— choose session —</option>
          {sessions.map((s) => (
            <option key={s.client_id} value={s.client_id}>
              {s.connected ? `✅ ${s.me || s.client_id}` : `⚠️ ${s.client_id} (disconnected)`}
            </option>
          ))}
        </Select>
        <div style={{ fontSize: 11, color: "#e67e22", marginTop: 4 }}>
          ⚠️ Use the SAME number your customers already know. A number they haven't heard from = higher chance of "Report Spam".
        </div>
      </Field>

      {/* Anti-ban intro options */}
      <div style={{ background: "#fef9f0", border: "1px solid #fde8c0", borderRadius: 8, padding: "10px 14px", marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#92400e", marginBottom: 8 }}>🛡️ Anti-ban protection — strongly recommended</div>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={form.addIntro} onChange={(e) => set("addIntro", e.target.checked)} style={{ marginTop: 2 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 500 }}>Add "Sun Sea Jewellers here, save this number" intro</div>
            <div style={{ fontSize: 11, color: "#888" }}>Prepends: <em>Hi {"{{name}}"}, Sun Sea Jewellers here (Karol Bagh). Please save this number for future updates 📱</em></div>
          </div>
        </label>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", marginBottom: 6 }}>
          <input type="checkbox" checked={form.addSaveLink} onChange={(e) => set("addSaveLink", e.target.checked)} style={{ marginTop: 2 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 500 }}>Add 1-tap "Save our number" link at the end</div>
            <div style={{ fontSize: 11, color: "#888" }}>Customer taps → phone opens "Add Contact" pre-filled → one tap saves.</div>
          </div>
        </label>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={form.addStop} onChange={(e) => set("addStop", e.target.checked)} style={{ marginTop: 2 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 500 }}>Add "Reply STOP to unsubscribe" line</div>
            <div style={{ fontSize: 11, color: "#888" }}>If they reply STOP, the bot automatically marks them DND and never messages again. Strongly recommended for cold contacts.</div>
          </div>
        </label>
      </div>

      <Field label="Your message (the actual festival content)">
        <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>Use {"{{name}}"} for customer name, {"{{city}}"} for city.</div>
        <Textarea rows={4} value={form.message} onChange={(e) => set("message", e.target.value)} placeholder={"Happy Diwali! ✨ Visit us this festive season — exclusive jewellery, best rates, free gift on purchase.\n- Sun Sea Jewellers, Karol Bagh"} />
      </Field>

      {/* Live preview of what recipient actually receives */}
      {form.message.trim() && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>📱 What the customer receives:</div>
          <div style={{ fontSize: 12, whiteSpace: "pre-wrap", lineHeight: 1.7, padding: "10px 14px", background: "#f0fdf4", borderRadius: 8, border: "1px solid #86efac", color: "#166534" }}>
            {buildTemplate().replace(/\{\{name\}\}/g, "Ramesh").replace(/\{\{city\}\}/g, "Delhi")}
          </div>
        </div>
      )}

      <Field label="Personalisation">
        <Select value={form.aiMessage ? "ai" : "fixed"} onChange={(e) => set("aiMessage", e.target.value === "ai")}>
          <option value="fixed">📝 Same message to everyone</option>
          <option value="ai">🤖 AI adds a personal touch per customer (uses template as base)</option>
        </Select>
      </Field>

      {err && <p style={{ fontSize: 12, color: C.red, margin: "8px 0 0" }}>{err}</p>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <Btn ghost color={C.gray} onClick={onClose}>Cancel</Btn>
        <Btn color={C.blue} onClick={save} disabled={saving}>{saving ? "Creating…" : "Create broadcast"}</Btn>
      </div>
    </Modal>
  );
}

const PACE_OPTIONS = [
  { k: "safe",   label: "🐢 Safe — 1 per 12s (~5/min)", intervalS: 12, note: "Recommended for numbers under 3 months old" },
  { k: "normal", label: "🚶 Normal — 1 per 8s (~7/min)",  intervalS: 8,  note: "Good for established numbers (6+ months)" },
  { k: "fast",   label: "🏃 Fast — 1 per 5s (~12/min)",  intervalS: 5,  note: "Only for WhatsApp Business API numbers" },
];

function BroadcastSendModal({ broadcast, allTags, onClose, onSent }) {
  const step = (broadcast.step || []).sort((a, z) => a.step_order - z.step_order)[0];
  const [filter, setFilter] = useState({ tags: [], city: "", statuses: ["active", "handoff", "converted", "new"], productInterest: [] });
  const [includeAll, setIncludeAll] = useState(false);
  const [pace, setPace] = useState("safe");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState("image");
  const [uploading, setUploading] = useState(false);
  const [sendAt, setSendAt] = useState(() => {
    const d = new Date(); d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d.toISOString().slice(0, 16);
  });
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null);
  const [err, setErr] = useState("");

  const uploadMedia = async (file) => {
    if (!file) return;
    setUploading(true); setErr("");
    const ext = file.name.split(".").pop().toLowerCase();
    const type = file.type.startsWith("video") ? "video" : file.type === "application/pdf" ? "document" : "image";
    const path = `broadcasts/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { data, error } = await sb.storage.from("media").upload(path, file, { upsert: true });
    if (error) { setErr(`Upload failed: ${error.message}`); setUploading(false); return; }
    const { data: pub } = sb.storage.from("media").getPublicUrl(path);
    setMediaUrl(pub.publicUrl);
    setMediaType(type);
    setUploading(false);
  };

  const setF = (k, v) => { setFilter((s) => ({ ...s, [k]: v })); setPreview(null); };

  const previewCount = async () => {
    setPreviewing(true); setPreview(null); setErr("");
    let q = sb.from("bullion_leads")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", getTenantId())
      .eq("dnd", false)
      .neq("status", "dead")
      .not("phone", "is", null);
    if (filter.tags.length) q = q.overlaps("tags", filter.tags);
    if (filter.city.trim()) q = q.ilike("city", `%${filter.city.trim()}%`);
    if (!includeAll && filter.statuses.length) q = q.in("status", filter.statuses);
    if (filter.productInterest.length) q = q.in("product_interest", filter.productInterest);
    const { count, error } = await q;
    if (error) { setErr(error.message); setPreviewing(false); return; }
    setPreview(count);
    setPreviewing(false);
  };

  const send = async () => {
    if (!sendAt) return setErr("Choose a send date and time");
    if (preview === null) return setErr("Click Preview first to count recipients");
    if (preview === 0) return setErr("No contacts match the selected filters");
    setSending(true); setErr("");
    const r = await fetch("/api/broadcast-send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-crm-secret": window.__CRM_SECRET__ || "" },
      body: JSON.stringify({ funnelId: broadcast.id, sendAt: new Date(sendAt).toISOString(), pace, includeAll, filter, mediaUrl: mediaUrl || null, mediaType: mediaUrl ? mediaType : null, createdBy: loadUser()?.name || null }),
    });
    const data = await r.json();
    setSending(false);
    if (!data.ok) { setErr(data.error || "Send failed"); return; }
    setSent(data);
  };

  const tagOptions = (allTags || []).map((t) => t.name || t.tag).filter(Boolean);

  return (
    <Modal title={`Send · ${broadcast.name}`} onClose={onClose} width={600}>
      {/* Message preview */}
      <div style={{ marginBottom: 16, padding: "10px 14px", background: "#f0f9ff", borderRadius: 8, borderLeft: "3px solid #3b82f6" }}>
        <div style={{ fontSize: 11, color: "#3b82f6", fontWeight: 600, marginBottom: 6 }}>MESSAGE PREVIEW</div>
        <div style={{ fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{step?.message_template || "(no message)"}</div>
        {step?.use_ai_message && <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>🤖 AI will personalise this for each recipient</div>}
      </div>

      {/* Audience filters */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Audience filters</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="City (leave blank = all cities)">
            <Input value={filter.city} onChange={(e) => setF("city", e.target.value)} placeholder="Delhi, Noida…" />
          </Field>
          <Field label="Tags (any — leave empty = all)">
            <Select value="" onChange={(e) => { if (e.target.value && !filter.tags.includes(e.target.value)) setF("tags", [...filter.tags, e.target.value]); }}>
              <option value="">+ Add tag filter</option>
              {tagOptions.filter((t) => !filter.tags.includes(t)).map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
            {filter.tags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                {filter.tags.map((t) => (
                  <span key={t} onClick={() => setF("tags", filter.tags.filter((x) => x !== t))} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: "#dbeafe", color: "#1d4ed8", cursor: "pointer" }}>{t} ×</span>
                ))}
              </div>
            )}
          </Field>
        </div>
        <Field label="Who to include">
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 12px", borderRadius: 8, border: `1px solid ${includeAll ? C.blue : "#ddd"}`, background: includeAll ? "#eff6ff" : "#fff", cursor: "pointer", marginBottom: 8 }}>
            <input type="checkbox" checked={includeAll} onChange={(e) => { setIncludeAll(e.target.checked); setPreview(null); }} style={{ marginTop: 2 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Everyone (including cold contacts who've never messaged us)</div>
              <div style={{ fontSize: 11, color: "#888" }}>All contacts in the DB except DND and dead — best for festival blasts since we're sending the save-contact link anyway</div>
            </div>
          </label>
          {!includeAll && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {LEAD_STATUSES.map((s) => (
                <label key={s} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, padding: "3px 10px", borderRadius: 8, border: `1px solid ${filter.statuses.includes(s) ? C.blue : "#ddd"}`, background: filter.statuses.includes(s) ? "#eff6ff" : "#fff", cursor: "pointer" }}>
                  <input type="checkbox" checked={filter.statuses.includes(s)} onChange={() => { setF("statuses", filter.statuses.includes(s) ? filter.statuses.filter((x) => x !== s) : [...filter.statuses, s]); }} style={{ margin: 0 }} />
                  {s}
                </label>
              ))}
            </div>
          )}
        </Field>
      </div>

      {/* Media attachment — for this send only, not saved to Media tab */}
      <Field label="Attach image / video / PDF (optional — for this broadcast only)">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 13, padding: "6px 14px", borderRadius: 7, border: "1px solid #3b82f6", color: "#3b82f6", cursor: "pointer", whiteSpace: "nowrap" }}>
            {uploading ? "Uploading…" : mediaUrl ? "Change file" : "📎 Attach file"}
            <input type="file" accept="image/*,video/*,.pdf" style={{ display: "none" }} onChange={(e) => uploadMedia(e.target.files[0])} disabled={uploading} />
          </label>
          {mediaUrl && (
            <div style={{ flex: 1, fontSize: 12, color: "#16a34a" }}>
              ✅ {mediaType} attached
              {mediaType === "image" && <img src={mediaUrl} alt="" style={{ display: "block", maxHeight: 80, maxWidth: 120, borderRadius: 6, marginTop: 4, objectFit: "cover" }} />}
              <button onClick={() => setMediaUrl("")} style={{ marginLeft: 8, fontSize: 11, color: C.red, background: "none", border: "none", cursor: "pointer" }}>✕ remove</button>
            </div>
          )}
        </div>
        <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>File is uploaded to Supabase Storage and sent as a WA media message with the text as caption. Not saved to the Media tab.</div>
      </Field>

      {/* Pace selector */}
      <Field label="Send pace — controls time gap between messages to avoid WA ban">
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
          {PACE_OPTIONS.map((p) => (
            <label key={p.k} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 12px", borderRadius: 8, border: `1px solid ${pace === p.k ? C.blue : "#ddd"}`, background: pace === p.k ? "#eff6ff" : "#fff", cursor: "pointer" }}>
              <input type="radio" name="pace" value={p.k} checked={pace === p.k} onChange={() => { setPace(p.k); setPreview(null); }} style={{ marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: pace === p.k ? 600 : 400 }}>{p.label}</div>
                <div style={{ fontSize: 11, color: "#888" }}>{p.note}
                  {preview > 0 && ` · ${Math.ceil(preview * p.intervalS / 60)} min total for ${preview} contacts`}
                </div>
              </div>
            </label>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "#e67e22", marginTop: 8, padding: "6px 10px", background: "#fef9f0", borderRadius: 6 }}>
          ⚠️ Messages stagger automatically so WA doesn't detect bulk sending. First message goes at your chosen time; rest follow at the pace above. All stay within 9 AM–8 PM IST.
        </div>
      </Field>

      {/* Send date */}
      <Field label="First message sends at (IST)">
        <Input type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
        {preview > 0 && sendAt && (() => {
          const paceObj = PACE_OPTIONS.find((p) => p.k === pace);
          const endMs = new Date(sendAt).getTime() + preview * paceObj.intervalS * 1000;
          return <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Last message ~{new Date(endMs).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</div>;
        })()}
      </Field>

      {/* Preview + Send */}
      {err && <p style={{ fontSize: 12, color: C.red, margin: "8px 0" }}>{err}</p>}

      {sent ? (
        <div style={{ padding: "14px 16px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#166534", marginBottom: 4 }}>✅ Scheduled!</div>
          <div style={{ fontSize: 13, color: "#166534" }}>{sent.created} messages scheduled · {sent.skipped || 0} already enrolled (skipped)</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 6 }}>Cron will send them at {new Date(sendAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</div>
          <Btn color={C.blue} onClick={onSent} style={{ marginTop: 12 }}>Done</Btn>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Btn ghost color={C.blue} onClick={previewCount} disabled={previewing}>{previewing ? "Counting…" : "👁 Preview audience"}</Btn>
            {preview !== null && (
              <span style={{ fontSize: 13, fontWeight: 600, color: preview > 0 ? C.green : C.red }}>
                {preview > 0 ? `${preview} contacts will receive this` : "No contacts match"}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn ghost color={C.gray} onClick={onClose}>Cancel</Btn>
            <Btn color={C.blue} onClick={send} disabled={sending || preview === null || preview === 0}>
              {sending ? "Scheduling…" : `📤 Schedule${preview !== null && preview > 0 ? ` for ${preview}` : ""}`}
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

// MAIN APP — tabbed interface, tabs filtered by app_permissions (set in SSJ HR → People → Permissions)
// ──────────────────────────────────────────────────────────
// TELECALLER QUEUE SCREEN — mobile-first one-card-at-a-time call queue
// Shows the highest-priority call task, with full script + objection cheat-sheet.
// After logging a call the next card loads automatically.
// ──────────────────────────────────────────────────────────
function TelecallerQueueScreen({ funnels }) {
  const me = loadUser();
  const [demands, setDemands] = useState([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [logCallOpen, setLogCallOpen] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!me?.id) return;
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`/api/demand-queue?staffId=${me.id}&limit=50`, {
        headers: { "x-crm-secret": CRM_SECRET },
      });
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch { setErr(`Server error (${r.status}). Check Vercel logs.`); setLoading(false); return; }
      if (!data.ok) { setErr(data.error || "Failed to load queue"); setLoading(false); return; }
      setDemands(data.demands || []);
      setIdx(0);
    } catch (e) {
      setErr(String(e));
    }
    setLoading(false);
  }, [me?.id]);

  useEffect(() => { load(); }, [load]);

  const demand = demands[idx] || null;
  const lead = demand?.lead || null;
  const funnel = demand ? funnels.find((f) => f.id === demand.funnel_id) : null;
  const total = demands.length;

  // Temperature + urgency display
  const temp = demand?.temperature || "warm";
  const tempInfo = tempMeta(temp);

  // Next call due label
  const nextCallLabel = (() => {
    if (!demand?.next_call_at) return "Due now";
    const ms = new Date(demand.next_call_at) - Date.now();
    if (ms <= 0) return "OVERDUE";
    if (ms < 60 * 60_000) return `In ${Math.round(ms / 60_000)} min`;
    if (ms < 24 * 3600_000) return `In ${Math.round(ms / 3600_000)} h`;
    return `In ${Math.round(ms / 86400_000)} d`;
  })();

  const skipToNext = () => {
    if (idx < total - 1) setIdx((i) => i + 1);
    else load(); // reached the end — reload
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 480, margin: "0 auto", padding: 20, textAlign: "center", color: "#888", paddingTop: 60 }}>
        <div style={{ fontSize: 24, marginBottom: 12 }}>📞</div>
        Loading your queue…
      </div>
    );
  }

  if (err) {
    return (
      <div style={{ maxWidth: 480, margin: "0 auto", padding: 20 }}>
        <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 10, padding: 14, fontSize: 13, color: "#991b1b" }}>
          {err}
          <br /><Btn small color={C.blue} onClick={load} style={{ marginTop: 8 }}>Retry</Btn>
        </div>
      </div>
    );
  }

  if (!demand) {
    return (
      <div style={{ maxWidth: 480, margin: "0 auto", padding: 20, textAlign: "center", paddingTop: 60 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#16a085", marginBottom: 6 }}>Queue empty!</div>
        <div style={{ fontSize: 13, color: "#888", marginBottom: 20 }}>All calls for now are done. Great work!</div>
        <Btn color={C.blue} onClick={load}>↻ Refresh</Btn>
      </div>
    );
  }

  const priorityColor = temp === "hot" ? "#ef4444" : temp === "warm" ? "#f59e0b" : "#3b82f6";

  return (
    <div style={{ maxWidth: 520, margin: "0 auto" }}>
      {/* Queue progress */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: "#888" }}>
          📋 {idx + 1} of {total} calls in queue
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Btn small ghost color={C.gray} onClick={load}>↻ Reload</Btn>
          {idx > 0 && <Btn small ghost color={C.gray} onClick={() => setIdx((i) => i - 1)}>← Prev</Btn>}
          {idx < total - 1 && <Btn small ghost color={C.gray} onClick={skipToNext}>Skip →</Btn>}
        </div>
      </div>

      {/* Priority bar */}
      <div style={{ height: 6, background: "#e5e7eb", borderRadius: 4, marginBottom: 12, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(100, demand.priority_score)}%`, background: priorityColor, borderRadius: 4, transition: "width 0.3s" }} />
      </div>

      {/* Main call card */}
      {(() => {
        // Request browser notification permission once if callback-promised demand in queue
        const hasCallback = demands.some((d) => d.is_callback_promised && d.next_call_at && new Date(d.next_call_at) <= new Date());
        if (hasCallback && typeof Notification !== "undefined" && Notification.permission === "default") {
          Notification.requestPermission().then((p) => {
            if (p === "granted") new Notification("Promised callback due", { body: `${lead?.name || "A client"} asked you to call now!` });
          });
        }
        return null;
      })()}
      {demand.is_callback_promised && demand.next_call_at && new Date(demand.next_call_at) <= new Date() && (
        <div style={{ background: "#e53e3e", color: "#fff", padding: "8px 14px", borderRadius: 8, marginBottom: 8, fontSize: 13, fontWeight: 600, textAlign: "center" }}>
          ⚡ PROMISED CALLBACK — {lead?.name || "Client"} asked you to call right now!
        </div>
      )}
      <Card style={{ padding: 0, overflow: "hidden", border: demand.is_callback_promised && demand.next_call_at && new Date(demand.next_call_at) <= new Date() ? "2px solid #e53e3e" : undefined }}>
        {/* Card header */}
        <div style={{ padding: "14px 16px", background: `linear-gradient(135deg, ${priorityColor}18 0%, #fff 100%)`, borderBottom: "1px solid #eee" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#111", marginBottom: 4 }}>
                {lead?.name || displayPhone(lead?.phone || "")}
              </div>
              <div style={{ fontSize: 13, color: "#555", fontFamily: "monospace" }}>
                📱 {displayPhone(lead?.phone || "—")}
              </div>
              {lead?.city && <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>📍 {lead.city}</div>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
              <Pill color={tempInfo.color} solid>{tempInfo.label}</Pill>
              <Pill color={demand.priority_score >= 60 ? C.red : demand.priority_score >= 35 ? C.orange : C.gray}>
                🎯 Score {demand.priority_score}
              </Pill>
            </div>
          </div>
        </div>

        {/* Demand details */}
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #f0f0f0", background: "#fffbf0" }}>
          <div style={{ fontSize: 13, color: "#374151", fontWeight: 500, marginBottom: 6 }}>
            {demand.description || "(no description)"}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Pill color={C.purple}>{demand.product_category || "?"}</Pill>
            {demand.occasion && <Pill color={C.orange}>{demand.occasion}</Pill>}
            {demand.budget && <Pill color={C.gray}>₹{Number(demand.budget).toLocaleString("en-IN")}</Pill>}
            {demand.for_whom && <Pill color={C.blue}>for {demand.for_whom}</Pill>}
          </div>
        </div>

        {/* Call status */}
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #f0f0f0", fontSize: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span style={{ color: "#6b7280" }}>
            📞 Attempt <strong>{(demand.call_attempts || 0) + 1}</strong> of 6
          </span>
          <span style={{ color: demand.next_call_at && new Date(demand.next_call_at) < new Date() ? C.red : "#16a085", fontWeight: 600 }}>
            ⏰ {nextCallLabel}
          </span>
          {demand.is_callback_promised && (
            <Pill color={C.red} solid>📅 Callback promised</Pill>
          )}
          {demand.crm_source && (
            <span style={{ color: "#6b7280" }}>
              🔍 {demand.crm_source.replace(/_/g, " ")}
            </span>
          )}
          {demand.visit_scheduled_at && (
            <span style={{ color: C.green, fontWeight: 500 }}>
              🏪 Visit: {fmtDT(demand.visit_scheduled_at)}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ padding: "12px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn
            color={C.blue}
            onClick={() => setLogCallOpen(true)}
            style={{ flex: 1, minWidth: 140, textAlign: "center" }}
          >
            📝 Log Call
          </Btn>
          {idx < total - 1 && (
            <Btn ghost color={C.gray} onClick={skipToNext} style={{ minWidth: 80 }}>
              Skip →
            </Btn>
          )}
        </div>
      </Card>

      {/* AI summary if available */}
      {demand.ai_summary && (
        <div style={{ marginTop: 10, padding: "10px 14px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, fontSize: 12, color: "#0369a1", fontStyle: "italic" }}>
          💡 {demand.ai_summary}
        </div>
      )}

      {/* Funnel context */}
      {demand.step_name && (
        <div style={{ marginTop: 8, padding: "8px 12px", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, fontSize: 11, color: "#92400e" }}>
          🛤 Current step: <strong>{demand.step_name}</strong>
          {funnel?.name && <span> in <strong>{funnel.name}</strong></span>}
        </div>
      )}

      {logCallOpen && demand && (
        <LogCallModal
          demand={{ ...demand, lead: { id: lead?.id, name: lead?.name, phone: lead?.phone } }}
          lead={lead}
          funnel={funnel}
          onClose={() => setLogCallOpen(false)}
          onSaved={() => {
            setLogCallOpen(false);
            // Move to next demand after logging
            if (idx < total - 1) setIdx((i) => i + 1);
            else load();
          }}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────

export default function App() {
  // Customer profile update form — no login needed
  const profileToken = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("t") : null;
  if (profileToken) return <ContactUpdateForm token={profileToken} />;

  const [user, setUser] = useState(loadUser);
  const isTelecallerUser = (() => {
    if (!user) return false;
    if (user.role === "telecaller") return true;
    const p = user.app_permissions;
    if (!p || typeof p !== "object") return false;
    return Object.values(p).some((v) => Array.isArray(v) && v.includes("telecaller"));
  })();
  const [screen, setScreen] = useState(isTelecallerUser ? "queue" : "demands");
  const [funnels, setFunnels] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [allTags, setAllTags] = useState([]);

  const login = (u) => { saveUser(u); setUser(u); };
  const logout = () => { saveUser(null); setUser(null); };

  // SSO via postMessage — when iframed inside fms.gemtre.in, the parent sends
  // the logged-in user object so this app inherits the session without a
  // second login (mobile browsers partition iframe localStorage by parent).
  useEffect(() => {
    const handler = (e) => {
      const allowed = ["https://fms.gemtre.in", "https://fms-tracker.vercel.app"];
      if (!allowed.includes(e.origin) && !/^https:\/\/fms-tracker-.*\.vercel\.app$/.test(e.origin)) return;
      if (e.data?.type === "sso-login" && e.data.user) {
        saveUser(e.data.user);
        setUser(e.data.user);
      }
      if (e.data?.type === "sso-logout") {
        saveUser(null);
        setUser(null);
      }
    };
    window.addEventListener("message", handler);
    // Tell the parent we're ready so it can replay the user payload.
    try { window.parent?.postMessage({ type: "sso-ready" }, "*"); } catch { /* ignore */ }
    return () => window.removeEventListener("message", handler);
  }, []);

  // Refresh app_permissions from DB every time the app gets focus (tab switch, window focus).
  // This means if an admin changes someone's permissions in SSJ HR, it takes effect next
  // time that person switches back to the SSJBot tab — no logout required.
  useEffect(() => {
    if (!user?.id) return;
    const refresh = async () => {
      const { data } = await sb.from("staff").select("app_permissions").eq("id", user.id).maybeSingle();
      if (data && JSON.stringify(data.app_permissions) !== JSON.stringify(user.app_permissions)) {
        const updated = { ...user, app_permissions: data.app_permissions };
        saveUser(updated);
        setUser(updated);
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
    return () => { window.removeEventListener("focus", refresh); };
  }, [user?.id]); // eslint-disable-line

  const loadFunnels = useCallback(async () => {
    const { data } = await sb.from("funnels").select("*").eq("tenant_id", getTenantId()).order("active", { ascending: false }).order("id");
    if (data) setFunnels(data);
  }, []);
  const loadPersonas = useCallback(async () => {
    const { data } = await sb.from("personas").select("*").eq("tenant_id", getTenantId()).order("is_default", { ascending: false }).order("name");
    if (data) setPersonas(data);
  }, []);
  const loadTags = useCallback(async () => {
    const { data } = await sb.from("bullion_tags").select("*").eq("tenant_id", getTenantId()).order("category").order("sort_order");
    if (data) setAllTags(data);
  }, []);

  useEffect(() => {
    if (!user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFunnels();
    loadPersonas();
    loadTags();
  }, [user, loadFunnels, loadPersonas, loadTags]);

  if (!user) return <LoginScreen onLogin={login} />;

  const header = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 2px" }}>SSJ Jew CRM</h2>
        <p style={{ fontSize: 12, color: "#888", margin: 0 }}>{ROLES[user.role] || user.role} · {user.name}</p>
      </div>
      <button onClick={logout} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 7, border: "1px solid #ddd", background: "transparent", cursor: "pointer" }}>Logout</button>
    </div>
  );

  // Tabs filtered by app_permissions (set in SSJ HR → People → Permissions tab)
  const ALL_TABS = [
    { k: "queue",      l: "My Queue",    icon: "📞" },
    { k: "approvals",  l: "Approvals",   icon: "✅" },
    { k: "demands",    l: "Demands",     icon: "🎯" },
    { k: "contacts",   l: "Contacts",    icon: "📇" },
    { k: "contactsdb", l: "DB",          icon: "📋" },
    { k: "upcoming",   l: "Upcoming",    icon: "🎂" },
    { k: "messages",   l: "Messages",    icon: "💬" },
    { k: "funnels",    l: "Funnels",     icon: "🔀" },
    { k: "personas",   l: "Personas",    icon: "🎭" },
    { k: "faqs",       l: "FAQs",        icon: "❓" },
    { k: "tags",       l: "Tags",        icon: "🏷️" },
    { k: "imports",    l: "Imports",     icon: "📥" },
    { k: "broadcasts",  l: "Broadcasts",  icon: "📢" },
    { k: "connections",l: "Connections", icon: "📱" },
    { k: "media",      l: "Media",       icon: "📎" },
    { k: "rates",      l: "Rates",       icon: "📈" },
    { k: "analytics",  l: "Analytics",   icon: "📊" },
  ];

  // Role-based defaults when app_permissions.crm is not set
  const ROLE_DEFAULT_TABS = {
    superadmin: ALL_TABS.map((t) => t.k),
    admin:      ALL_TABS.map((t) => t.k),
    manager:    ["demands", "contacts", "contactsdb", "upcoming", "analytics"],
    staff:      ["demands", "contacts", "upcoming"],
    telecaller: ["queue", "demands"],
  };

  const crmPerms = user?.app_permissions?.crm;
  const allowedKeys = crmPerms
    ? (crmPerms.includes("all") ? ALL_TABS.map((t) => t.k) : crmPerms)
    : (ROLE_DEFAULT_TABS[user?.role] || ["demands"]);

  const tabs = ALL_TABS.filter((t) => allowedKeys.includes(t.k));
  // If current screen was removed from permissions (e.g. after re-login as different role),
  // silently redirect to the first allowed tab.
  const activeScreen = tabs.find((t) => t.k === screen) ? screen : (tabs[0]?.k || "demands");

  // Embed mode (iframed from fms-tracker): hide outer header/tabs, render only
  // the requested screen. Keeps login chrome out of the embedded view.
  const embedScreen = (() => {
    try {
      const p = new URLSearchParams(window.location.search);
      return p.get("embed");
    } catch { return null; }
  })();
  if (embedScreen) {
    return (
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0.5rem" }}>
        {embedScreen === "demands"  && <DemandsScreen funnels={funnels} allTags={allTags} />}
        {embedScreen === "contacts" && <ContactsScreen funnels={funnels} />}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "1rem" }}>
      {header}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, borderBottom: "1px solid #eee", paddingBottom: 10, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button key={t.k} onClick={() => setScreen(t.k)} style={{ fontSize: 13, padding: "6px 14px", borderRadius: 8, border: `1px solid ${activeScreen === t.k ? C.blue : "#ddd"}`, background: activeScreen === t.k ? C.blue : "transparent", color: activeScreen === t.k ? "#fff" : "#333", cursor: "pointer" }}>{t.icon} {t.l}</button>
        ))}
      </div>

      {activeScreen === "queue" && <TelecallerQueueScreen funnels={funnels} />}
      {activeScreen === "approvals" && <ApprovalsScreen funnels={funnels} />}
      {activeScreen === "demands" && <DemandsScreen funnels={funnels} allTags={allTags} />}
      {activeScreen === "contacts" && <ContactsScreen funnels={funnels} />}
      {activeScreen === "contactsdb" && <ContactsDBScreen />}
      {activeScreen === "upcoming" && <UpcomingEventsScreen />}
      {activeScreen === "messages" && <MessageHistoryScreen funnels={funnels} />}
      {activeScreen === "funnels" && <FunnelsScreen funnels={funnels} personas={personas} onReload={loadFunnels} />}
      {activeScreen === "personas" && <PersonasScreen personas={personas} onReload={loadPersonas} />}
      {activeScreen === "faqs" && <FaqsScreen />}
      {activeScreen === "tags" && <TagsScreen onReload={loadTags} />}
      {activeScreen === "imports" && <ImportsScreen />}
      {activeScreen === "connections" && <ConnectionsScreen />}
      {activeScreen === "media" && <MediaAssetsScreen />}
      {activeScreen === "rates" && <RatesScreen />}
      {activeScreen === "broadcasts" && <BroadcastsScreen allTags={allTags} />}
      {activeScreen === "analytics" && <AnalyticsScreen funnels={funnels} />}
    </div>
  );
}
