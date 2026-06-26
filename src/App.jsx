import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { secureImageUpload, secureNonImageUpload } from "./utils/imageUpload";

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
const CRM_SECRET = (import.meta.env.VITE_CRM_SECRET || "").trim();

// ── WA Service (Baileys on Synology) — public URL for QR iframes ──
// wa-service calls are proxied through /api/wa-proxy to avoid mixed-content issues
const WA_SERVICE_URL = "/api/wa-proxy?path=";

// ── UI CONSTANTS ──
const C = { green: "#27ae60", orange: "#e67e22", red: "#c0392b", blue: "#2980b9", gray: "#888", purple: "#8e44ad", pink: "#e84393", yellow: "#f39c12" };
const CF_DB_FIELD = "contact_custom_fields";
const FO_DB_FIELD = "contact_field_order";
const FIXED_CONTACT_FIELDS = [
  { key: "name",                 label: "Name",                     fixed: true },
  { key: "phone",                label: "Phone",                    fixed: true, required: true },
  { key: "mobile2",              label: "Phone 2",                  fixed: true },
  { key: "spouse_mobile",        label: "Phone 3 / Spouse",         fixed: true },
  { key: "salutation",           label: "Salutation",               fixed: true },
  { key: "city",                 label: "City",                     fixed: true },
  { key: "address_house",        label: "House / Flat No.",         fixed: true },
  { key: "address_locality",     label: "Locality / Society",       fixed: true },
  { key: "address_state",        label: "State",                    fixed: true },
  { key: "address_pincode",      label: "PIN Code",                 fixed: true },
  { key: "address_country",      label: "Country",                  fixed: true },
  { key: "email",                label: "Email",                    fixed: true },
  { key: "profession",           label: "Profession",               fixed: true },
  { key: "industry",             label: "Industry",                 fixed: true },
  { key: "company",              label: "Company / Firm",           fixed: true },
  { key: "client_code",          label: "Client Code / Ref",        fixed: true },
  { key: "bday",                 label: "Birthday (YYYY-MM-DD)",    fixed: true },
  { key: "anniversary",          label: "Anniversary (YYYY-MM-DD)", fixed: true },
  { key: "spouse_name",          label: "Spouse Name",              fixed: true },
  { key: "spouse_dob",           label: "Spouse Birthday (YYYY-MM-DD)", fixed: true },
  { key: "wedding_date",         label: "Wedding Date (YYYY-MM-DD)",fixed: true },
  { key: "wedding_family_member",label: "Wedding (family member)",  fixed: true },
  { key: "client_rating",        label: "VIP Score",                fixed: true },
  { key: "source",               label: "Source",                   fixed: true },
];
const _upsertDropdown = async (field, value) => {
  const tid = getTenantId();
  const { data: ex } = await sb.from("bullion_dropdowns").select("id").eq("tenant_id", tid).eq("field", field).maybeSingle();
  if (ex?.id) await sb.from("bullion_dropdowns").update({ value, active: true }).eq("id", ex.id);
  else await sb.from("bullion_dropdowns").insert({ tenant_id: tid, field, value, active: true, sort_order: 0 });
};

// Fetch field defs from DB. Returns { customFields, fieldOrder }.
const fetchContactFieldDefs = async () => {
  try {
    const tid = getTenantId();
    const { data } = await sb.from("bullion_dropdowns")
      .select("field,value").eq("tenant_id", tid).in("field", [CF_DB_FIELD, FO_DB_FIELD]);
    let customFields = [], fieldOrder = null;
    (data || []).forEach(r => {
      try {
        if (r.field === CF_DB_FIELD) customFields = JSON.parse(r.value);
        else fieldOrder = JSON.parse(r.value);
      } catch {}
    });
    return { customFields, fieldOrder };
  } catch { return { customFields: [], fieldOrder: null }; }
};

const saveCustomFieldDefs = (list) => _upsertDropdown(CF_DB_FIELD, JSON.stringify(list)).catch(() => {});
const saveFieldOrder = (order) => _upsertDropdown(FO_DB_FIELD, JSON.stringify(order)).catch(() => {});

// React context — source of truth for custom field definitions across the whole app.
const ContactFieldsContext = React.createContext({ customFields: [], fieldOrder: null, setCustomFields: () => {}, setFieldOrder: () => {}, reload: async () => {} });

// Merge fixed + custom fields in stored order (or default order if none saved)
const getAllFieldsOrdered = (customFields, fieldOrder) => {
  const all = [...FIXED_CONTACT_FIELDS, ...customFields.map(f => ({ ...f, fixed: false }))];
  if (!fieldOrder) return all;
  const map = Object.fromEntries(all.map(f => [f.key, f]));
  const ordered = fieldOrder.map(k => map[k]).filter(Boolean);
  all.forEach(f => { if (!fieldOrder.includes(f.key)) ordered.push(f); });
  return ordered;
};
const STAGES = ["greeting", "qualifying", "quoted", "objection", "closing", "handoff", "converted", "dead"];
const STAGE_C = { greeting: C.gray, qualifying: C.blue, quoted: C.purple, objection: C.orange, closing: C.yellow, handoff: C.red, converted: C.green, dead: "#999" };
const STATUSES = ["active", "handoff", "converted", "dead", "paused"];
const STATUS_C = { active: C.blue, handoff: C.red, converted: C.green, dead: "#999", paused: C.gray };
const PRODUCT_FOCUS = ["gold_bullion", "silver_coin", "coin_bar", "all"];
const ROLES = { superadmin: "Super Admin", admin: "Admin", manager: "Manager", staff: "Staff" };
// Returns true if a staff row is in the telecaller rotation pool
const isTelecallerStaff = (s) => {
  if (!s) return false;
  if (s.role === "telecaller") return true;
  const p = s.app_permissions;
  if (!p || typeof p !== "object") return false;
  return Object.values(p).some((v) => Array.isArray(v) && v.includes("telecaller"));
};
// Returns true if the user can perform write actions on a given CRM tab key.
// If crm_write is not set in app_permissions, defaults to full write on all visible tabs.
const canWriteTab = (user, tabKey) => {
  if (!user) return false;
  if (user.role === "superadmin" || user.role === "admin") return true;
  const crmWrite = user.app_permissions?.crm_write;
  if (!crmWrite) return true;
  if (crmWrite.includes("all")) return true;
  return crmWrite.includes(tabKey);
};
const PRODUCT_CATEGORIES = ["gold", "silver", "diamond", "polki", "kundan", "gemstone", "solitaire", "lab_diamond", "other"];
const PRODUCT_TYPES = ["Chain", "Earrings", "Danglers", "Nosepin", "Necklace set", "Pendant", "P Set", "Bangles", "Bracelets", "Gents Jew", "Engagement ring", "Solitaires", "Wedding Accessories", "Gemstones", "Others"];
const DISCOVERY_SOURCES = ["Google search", "Instagram", "Facebook ad", "WhatsApp", "Walk past store", "Friend referral", "Family referral", "Existing customer", "Newspaper", "Hoarding / banner", "Website", "Other"];
const NOT_BOUGHT_REASONS = ["Bought ✓", "Product not available", "Variety less", "Designs not good", "Price too high", "Want to compare other shops", "Just browsing", "Not their style / taste", "Need to consult family", "Will return with spouse", "Wrong size / specification", "Going for second opinion", "Other"];
const OCCASION_TYPES = ["wedding", "anniversary", "birthday", "Diwali gifting", "corporate gift", "self purchase", "other"];
const FOR_WHOM_OPTIONS = ["self", "daughter", "son", "wife", "husband", "mother", "father", "sister", "brother", "other"];
const FMS_STEP_COLORS = { new: C.gray, bot_activated: C.blue, qualifying: C.purple, catalog_sent: C.orange, call_needed: C.red, quoted: C.yellow, negotiating: C.orange, order_confirmed: C.green, delivered: C.green, closed: "#999" };
const CRM_ALL_TABS = [
  { k: "queue",       l: "My Queue",    icon: "📞" },
  { k: "approvals",   l: "Approvals",   icon: "✅" },
  { k: "demands",     l: "Demands",     icon: "🎯" },
  { k: "contacts",    l: "Contacts",    icon: "📇" },
  { k: "contactsdb",  l: "DB",          icon: "📋" },
  { k: "upcoming",    l: "Upcoming",    icon: "🎂" },
  { k: "messages",    l: "Messages",    icon: "💬" },
  { k: "funnels",     l: "Funnels",     icon: "🔀" },
  { k: "personas",    l: "Personas",    icon: "🎭" },
  { k: "faqs",        l: "FAQs",        icon: "❓" },
  { k: "tags",        l: "Tags",        icon: "🏷️" },
  { k: "imports",     l: "Imports",     icon: "📥" },
  { k: "broadcasts",  l: "Broadcasts",  icon: "📢" },
  { k: "connections", l: "Connections", icon: "📱" },
  { k: "media",       l: "Media",       icon: "📎" },
  { k: "rates",       l: "Rates",       icon: "📈" },
  { k: "analytics",   l: "Analytics",   icon: "📊" },
  { k: "leadsources", l: "Lead Sources",icon: "🌐" },
  { k: "formbuilder", l: "Form Builder",icon: "🛠️" },
  { k: "staff",       l: "Staff & Access",icon: "👥" },
];
const CRM_ROLE_DEFAULT_TABS = {
  superadmin: CRM_ALL_TABS.map((t) => t.k),
  admin:      CRM_ALL_TABS.map((t) => t.k),
  manager:    ["demands", "contacts", "contactsdb", "upcoming", "analytics", "formbuilder"],
  staff:      ["demands", "contacts", "upcoming"],
  telecaller: ["queue", "demands"],
};

// ── HELPERS ──
// WA JID localparts look like "918860866000:19" — strip the device-index suffix before normalizing.
const normalizePhone = (p) => String(p || "").replace(/:\d+$/, "").replace(/\D/g, "").replace(/^0+/, "").replace(/^91/, "");
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
      <p style={{ fontSize: 13, color: "#888", margin: "0 0 24px" }}>Leads · Funnels · Approvals · Analytics</p>
      <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>USERNAME</label>
      <input value={u} onChange={(e) => setU(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} style={{ width: "100%", fontSize: 14, marginBottom: 12, padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
      <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>PASSWORD</label>
      <input type="password" value={p} onChange={(e) => setP(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} style={{ width: "100%", fontSize: 14, marginBottom: 16, padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
      {err && <p style={{ fontSize: 12, color: C.red, margin: "0 0 12px" }}>{err}</p>}
      <button onClick={submit} disabled={loading} style={{ width: "100%", padding: 10, borderRadius: 8, border: "none", background: C.blue, color: "#fff", fontSize: 14, cursor: "pointer", fontWeight: 500 }}>{loading ? "Logging in..." : "Login"}</button>
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
  const [todayVisits, setTodayVisits] = useState([]);
  const [walkinPanelOpen, setWalkinPanelOpen] = useState(true);
  const [assigningVisit, setAssigningVisit] = useState(null); // visit id being assigned to funnel

  const load = useCallback(async () => {
    setLoading(true);
    let q = sb.from("bullion_leads").select("*").eq("tenant_id", getTenantId()).is("deleted_at", null).order("updated_at", { ascending: false }).limit(1000);
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

  // Today's walk-in sessions
  const loadTodayVisits = useCallback(async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data } = await sb.from("bullion_visits")
      .select("id,visited_at,time_out,outcome,temperature,price_quoted,staff,items_seen,notes,bullion_leads(id,name,phone),bullion_estimates(id,mode,total_amount)")
      .eq("tenant_id", getTenantId())
      .gte("visited_at", today.toISOString())
      .order("visited_at", { ascending: false });
    if (data) setTodayVisits(data);
  }, []);
  useEffect(() => { loadTodayVisits(); }, [loadTodayVisits]);

  const assignVisitToFunnel = async (visit, label) => {
    const lead = visit.bullion_leads;
    if (!lead?.id) return;
    const funnelMap = { hot: "hot", warm: "warm", cold: "cold" };
    const matchedFunnel = funnels.find(f => f.name?.toLowerCase().includes(funnelMap[label]) || f.id?.toLowerCase().includes(funnelMap[label])) || funnels[0];
    if (!matchedFunnel?.id) return;
    await fetch("/api/demand", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-crm-secret": CRM_SECRET },
      body: JSON.stringify({
        phone: lead.phone,
        name: lead.name || null,
        description: `Walk-in ${label} follow-up — ${visit.items_seen || "items shown"}`,
        funnel_id: matchedFunnel.id,
        tenant_id: getTenantId(),
      }),
    });
    setAssigningVisit(null);
  };

  const filtered = useMemo(() => {
    if (!search) return leads;
    const s = search.toLowerCase();
    return leads.filter((l) => (l.phone || "").toLowerCase().includes(s) || (l.name || "").toLowerCase().includes(s) || (l.last_msg || "").toLowerCase().includes(s));
  }, [leads, search]);

  const selected = leads.find((l) => l.id === selectedId) || null;
  const selectedFunnel = selected ? funnels.find((f) => f.id === selected.funnel_id) : null;

  return (
    <div style={{ display: "block" }}>
      {/* ── Today's Walk-in Sessions ── */}
      <div style={{ marginBottom: 14 }}>
        <div
          onClick={() => setWalkinPanelOpen(o => !o)}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", padding: "6px 0", borderBottom: "1px solid #eee", marginBottom: walkinPanelOpen ? 10 : 0 }}
        >
          <span style={{ fontWeight: 600, fontSize: 13 }}>🏪 Today's Walk-ins <span style={{ fontWeight: 400, color: "#888", fontSize: 12 }}>({todayVisits.length})</span></span>
          <span style={{ fontSize: 11, color: "#aaa" }}>{walkinPanelOpen ? "▲ hide" : "▼ show"}</span>
        </div>
        {walkinPanelOpen && (
          todayVisits.length === 0 ? (
            <div style={{ fontSize: 12, color: "#aaa", padding: "8px 0" }}>No walk-ins recorded today. Use 🏪 Walk-in button in the Calculator to start a session.</div>
          ) : (
            <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6 }}>
              {todayVisits.map(v => {
                const lead = v.bullion_leads || {};
                const ests = v.bullion_estimates || [];
                const estCount = ests.length;
                const estTotal = ests.reduce((s, e) => s + (e.total_amount || 0), 0);
                const timeIn = v.visited_at ? new Date(v.visited_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";
                const timeOut = v.time_out ? new Date(v.time_out).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "still here";
                const tempColors = { hot: { bg: "#fff3e0", border: "#ffb74d", icon: "🔥" }, warm: { bg: "#fff8e1", border: "#ffd54f", icon: "♨️" }, cold: { bg: "#e3f2fd", border: "#90caf9", icon: "🧊" } };
                const tc = tempColors[v.temperature] || { bg: "#f9f9f9", border: "#ddd", icon: "👣" };
                return (
                  <div key={v.id} style={{ minWidth: 200, maxWidth: 240, background: tc.bg, border: `1px solid ${tc.border}`, borderRadius: 10, padding: "10px 12px", flexShrink: 0, fontSize: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{tc.icon} {lead.name || lead.phone || "Unknown"}</div>
                    {lead.phone && <div style={{ color: "#666", marginBottom: 4 }}>{lead.phone}</div>}
                    <div style={{ color: "#555", marginBottom: 4 }}>⏰ {timeIn} → {timeOut}</div>
                    {estCount > 0 && <div style={{ color: "#1565c0", fontWeight: 500, marginBottom: 4 }}>📋 {estCount} estimate{estCount > 1 ? "s" : ""}{estTotal > 0 ? ` · ₹${Math.round(estTotal).toLocaleString("en-IN")}` : ""}</div>}
                    {v.outcome && <div style={{ color: "#388e3c", marginBottom: 4 }}>✓ {v.outcome}</div>}
                    <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                      {lead.id && <button onClick={() => setSelectedId(lead.id)} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "1px solid #bbb", background: "#fff", cursor: "pointer" }}>👁 View</button>}
                      {assigningVisit === v.id ? (
                        <>
                          <button onClick={() => assignVisitToFunnel(v, "hot")} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, border: "1px solid #ff9800", background: "#fff3e0", cursor: "pointer" }}>🔥 Hot</button>
                          <button onClick={() => assignVisitToFunnel(v, "warm")} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, border: "1px solid #ffc107", background: "#fff8e1", cursor: "pointer" }}>♨️ Warm</button>
                          <button onClick={() => assignVisitToFunnel(v, "cold")} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, border: "1px solid #90caf9", background: "#e3f2fd", cursor: "pointer" }}>🧊 Cold</button>
                          <button onClick={() => setAssigningVisit(null)} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>✕</button>
                        </>
                      ) : (
                        <button onClick={() => setAssigningVisit(v.id)} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "1px solid #bbb", background: "#fff", cursor: "pointer" }}>➡️ Funnel</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

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
  const { customFields, fieldOrder } = React.useContext(ContactFieldsContext);
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
  const [scheduleVisitOpen, setScheduleVisitOpen] = useState(false);
  const [sendDesignOpen, setSendDesignOpen] = useState(false);

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
      .eq("tenant_id", getTenantId()).neq("type", "artisan")
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
    const newName = picked?.name || picked?.username || null;
    const { error } = await sb.from("bullion_demands").update({
      assigned_staff_id: staffId || null,
      assigned_to: newName,
      updated_at: new Date().toISOString(),
    }).eq("id", demand.id);
    setReassignBusy(false);
    if (error) { alert(`Failed: ${error.message}`); return; }
    setReassignOpen(false);
    // Optimistic update — reflect new name immediately without waiting for reload
    if (demand) { demand.assigned_to = newName; demand.assigned_staff_id = staffId || null; }
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
    if ((status === "converted" || status === "dead") && demand?.id) {
      await sb.from("bullion_demands")
        .update({ outcome: status === "converted" ? "converted" : "lost", bot_active: false, updated_at: new Date().toISOString() })
        .eq("id", demand.id)
        .is("outcome", null);
    }
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
            {Object.entries(lead.extra_fields || {}).filter(([,v]) => v).map(([k, v]) => {
              const label = customFields.find(f => f.key === k)?.label || k;
              return <span key={k}> · {label}: <strong>{v}</strong></span>;
            })}
            {!lead.city && !lead.email && !lead.bday && !lead.anniversary && !Object.values(lead.extra_fields || {}).some(Boolean) && <em>(name/city/bday/anniv not captured yet)</em>}
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
          customFields={customFields}
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
          {demand.design_notes && (
            <div style={{ marginTop: 6, padding: "6px 10px", background: "#fdf4ff", border: "1px solid #e9d5ff", borderRadius: 6, fontSize: 12, color: "#6b21a8", whiteSpace: "pre-wrap" }}>
              📐 {demand.design_notes}
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
            <Btn small ghost color={C.green} onClick={() => setScheduleVisitOpen(true)}>📅 Schedule visit</Btn>
            <Btn small ghost color={C.purple} onClick={() => setSendDesignOpen(true)} disabled={isLid(lead.phone) || !lead.phone}>📤 Send design</Btn>
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
      {scheduleVisitOpen && demand && (
        <ScheduleVisitModal
          demand={demand}
          onClose={() => setScheduleVisitOpen(false)}
          onSaved={() => { setScheduleVisitOpen(false); onChanged && onChanged(); }}
        />
      )}
      {sendDesignOpen && demand && (
        <SendDesignModal
          demand={demand}
          lead={lead}
          onClose={() => setSendDesignOpen(false)}
          onSent={() => { setSendDesignOpen(false); onChanged && onChanged(); }}
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
  const [showClosed, setShowClosed] = useState(false);
  useEffect(() => {
    sb.from("staff").select("id,name,username,role,app_permissions").eq("tenant_id", getTenantId()).neq("type", "artisan").order("name")
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

  const closedFiltered = useMemo(() => {
    const SUPPLIER_SOURCES = new Set(["seller_enquiry", "supplier", "vendor", "karigar", "wholesale", "kariger"]);
    let rows = demands.filter((d) => !SUPPLIER_SOURCES.has(d.lead?.source));
    rows = rows.filter((d) =>
      ["converted", "lost", "junk"].includes(d.outcome) ||
      ["converted", "dead"].includes(d.lead?.status)
    );
    if (filterSource === "walk_in") rows = rows.filter((d) => d.lead?.source === "walk_in");
    else if (filterSource === "wa_bot") rows = rows.filter((d) => d.lead?.source !== "walk_in");
    if (!search) return rows;
    const s = search.toLowerCase();
    return rows.filter((d) =>
      (d.lead?.name || "").toLowerCase().includes(s) ||
      (d.lead?.phone || "").includes(s) ||
      (d.description || "").toLowerCase().includes(s)
    );
  }, [demands, search, filterSource]);

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

          {/* ── Closed / Converted section ── */}
          {closedFiltered.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <button
                onClick={() => setShowClosed((v) => !v)}
                style={{ width: "100%", padding: "8px 14px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>
                <span>✅ Closed / Converted ({closedFiltered.length})</span>
                <span>{showClosed ? "▲ hide" : "▼ show"}</span>
              </button>
              {showClosed && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                  {closedFiltered.map((d) => {
                    const sel = d.lead?.id === selectedLeadId;
                    const outcome = d.outcome || (d.lead?.status === "dead" ? "lost" : "converted");
                    const outcomeColor = outcome === "converted" ? "#16a085" : "#6b7280";
                    const outcomeLabel = outcome === "converted" ? "✅ Converted" : outcome === "lost" ? "❌ Lost" : outcome === "junk" ? "🗑 Junk" : "💀 Dead";
                    return (
                      <React.Fragment key={d.id}>
                        <div
                          onClick={() => {
                            if (sel) { setSelectedLeadId(null); setSelectedDemand(null); }
                            else { setSelectedLeadId(d.lead?.id || null); setSelectedDemand(d); }
                          }}
                          style={{ padding: "8px 12px", background: sel ? "#f0fdf4" : "#fafafa", border: `1px solid ${sel ? "#86efac" : "#e5e7eb"}`, borderRadius: 8, cursor: "pointer", opacity: 0.85 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <strong style={{ fontSize: 13, color: "#374151" }}>{d.lead?.name || d.lead?.phone || "Unknown"}</strong>
                            <div style={{ display: "flex", gap: 4 }}>
                              <Pill color={outcomeColor} solid>{outcomeLabel}</Pill>
                              {d.lead?.phone && <span style={{ fontSize: 11, color: "#9ca3af" }}>{d.lead.phone}</span>}
                            </div>
                          </div>
                          <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2, display: "flex", justifyContent: "space-between" }}>
                            <span>{d.description || "(no description)"}</span>
                            <span>{fmtDT(d.updated_at)}</span>
                          </div>
                        </div>
                        {sel && selectedLead && selectedDemand?.id === d.id && (
                          <ConversationPane
                            lead={selectedLead}
                            funnel={selectedFunnel}
                            onClose={() => { setSelectedLeadId(null); setSelectedDemand(null); }}
                            onChanged={load}
                            allTags={allTags}
                            demand={selectedDemand}
                            onAdvanceStep={null}
                            onRollbackStep={null}
                            onMergeDuplicate={null}
                          />
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
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
  const [extraSalesNames, setExtraSalesNames] = useState([]);
  useEffect(() => {
    const tid = getTenantId();
    Promise.all([
      sb.from("staff").select("id,name,username,role").eq("tenant_id", tid).neq("type", "artisan").order("name"),
      sb.from("bullion_dropdowns").select("value").eq("tenant_id", tid).eq("field", "extra_salesperson").eq("active", true).order("sort_order"),
    ]).then(([s, e]) => {
      setStaff(s.data || []);
      setExtraSalesNames((e.data || []).map((r) => r.value));
    });
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
    assignedStaffId: "",
    // Jewelry fields
    metal: "", stone: "", itemCategory: "", ringSize: "", purity: "", hallmarkPref: "",
    // Exchange
    hasExchange: false, exchangeDesc: "", exchangeValue: "",
    // Design notes
    designNotes: "",
  });

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const toggleProductType = (t) => setForm((s) => ({ ...s, productTypes: s.productTypes.includes(t) ? s.productTypes.filter((x) => x !== t) : [...s.productTypes, t] }));

  const doSearch = useCallback(async (q) => {
    if (!q || q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const isPhone = /^\d+$/.test(q);
    let query = sb.from("bullion_leads").select("id,name,phone,city,client_rating,last_msg_at").eq("tenant_id", getTenantId()).is("deleted_at", null);
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

  const [funnelFirstStep, setFunnelFirstStep] = useState(null);

  // Pre-select walk-in funnel as soon as funnels load
  useEffect(() => {
    if (!form.funnelId && funnels.length) set("funnelId", autoFunnel());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funnels.length]);

  // Fetch first step of selected funnel to show preview
  useEffect(() => {
    const fid = form.funnelId;
    if (!fid) { setFunnelFirstStep(null); return; }
    sb.from("bullion_funnel_steps")
      .select("id,name,step_type,delay_minutes,message_template")
      .eq("funnel_id", fid)
      .eq("tenant_id", getTenantId())
      .eq("active", true)
      .order("step_order", { ascending: true })
      .limit(1)
      .then(({ data }) => setFunnelFirstStep(data?.[0] || null));
  }, [form.funnelId]);

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
          assignedStaffId: form.assignedStaffId?.startsWith("extra:") ? null : (form.assignedStaffId || null),
          assignedTo: form.assignedStaffId?.startsWith("extra:")
            ? form.assignedStaffId.slice(6)
            : (form.assignedStaffId ? (staff.find((s) => s.id === form.assignedStaffId)?.name || null) : null),
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
          designNotes: form.designNotes || null,
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
              {funnelFirstStep && (
                <div style={{ marginTop: 5, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "5px 8px", fontSize: 11, color: "#15803d" }}>
                  <strong>First action:</strong> {funnelFirstStep.step_type === "call" ? "📞 Call" : "💬 WA message"} · {funnelFirstStep.name}
                  {funnelFirstStep.delay_minutes > 0 && <span style={{ color: "#16a34a" }}> · in {funnelFirstStep.delay_minutes < 60 ? `${funnelFirstStep.delay_minutes}m` : `${Math.round(funnelFirstStep.delay_minutes / 60)}h`}</span>}
                  {funnelFirstStep.delay_minutes === 0 && <span style={{ color: "#dc2626" }}> · immediately</span>}
                </div>
              )}
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Attended by (salesperson)">
              <Select value={form.assignedStaffId} onChange={(e) => set("assignedStaffId", e.target.value)}>
                <option value="">— select salesperson —</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name || s.username} · @{s.username}</option>)}
                {extraSalesNames.length > 0 && <optgroup label="Part-time / Extra">
                  {extraSalesNames.map((n) => <option key={`extra:${n}`} value={`extra:${n}`}>{n}</option>)}
                </optgroup>}
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

          <Field label="Design notes (designs shown / sent, references, client preferences)">
            <Textarea rows={2} value={form.designNotes} onChange={(e) => set("designNotes", e.target.value)}
              placeholder="e.g. Sent 3 bracelet designs on WhatsApp — she liked the polki one. Wants antique finish." />
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
function WalkinEntryModal({ funnels, allTags = [], onClose, onSaved, prefill = null }) {
  const { customFields } = React.useContext(ContactFieldsContext);
  const sourceTags = allTags.filter((t) => t.category === "source").map((t) => t.name);
  const otherTags = allTags.filter((t) => t.category !== "source").map((t) => t.name);
  const [pastEstimates, setPastEstimates] = useState([]);

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
  const [extraSalesNames, setExtraSalesNames] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [refImageUrl, setRefImageUrl] = useState("");

  useEffect(() => {
    const tid = getTenantId();
    Promise.all([
      sb.from("staff").select("id,name,username,role").eq("tenant_id", tid).neq("type", "artisan").order("name"),
      sb.from("bullion_dropdowns").select("value").eq("tenant_id", tid).eq("field", "extra_salesperson").eq("active", true).order("sort_order"),
    ]).then(([s, e]) => {
      setStaff(s.data || []);
      setExtraSalesNames((e.data || []).map((r) => r.value));
    });
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

  // Pre-fill from calculator prefill prop
  useEffect(() => {
    if (!prefill) return;
    const { contact, estimateSummary } = prefill;
    // Pre-fill estimate-derived fields
    if (estimateSummary) {
      const category = estimateSummary.mode === "jewellery" ? "gold" : "diamond";
      const seen = estimateSummary.itemName ? [estimateSummary.itemName] : [];
      const quoted = estimateSummary.total ? String(Math.round(estimateSummary.total)) : "";
      setForm(s => ({ ...s, productCategory: category, itemsSeen: seen, priceQuoted: quoted, estimate: quoted }));
    }
    if (!contact?.id) {
      // Pre-fill basic name/phone if available
      if (contact?.name || contact?.phone) {
        setForm(s => ({ ...s, name: contact.name || "", phone: contact.phone || "" }));
        if (contact.name || contact.phone) setSearchQ((contact.name || contact.phone || "").substring(0, 20));
      }
      return;
    }
    // Returning client — fetch full profile + past estimates
    const tid = getTenantId();
    sb.from("bullion_leads").select("*").eq("id", contact.id).maybeSingle().then(({ data: lead }) => {
      if (!lead) return;
      setSelectedContact(lead);
      setForm(s => ({
        ...s,
        name: lead.name || "",
        phone: lead.phone || "",
        city: lead.city || "",
        email: lead.email || "",
        bday: lead.bday || "",
        anniversary: lead.anniversary || "",
        client_rating: lead.client_rating != null ? String(lead.client_rating) : "",
        is_client: !!lead.is_client,
        wedding_date: lead.wedding_date || "",
        wedding_family_member: lead.wedding_family_member || "",
        tags: lead.tags?.length ? lead.tags : s.tags,
      }));
    });
    sb.from("bullion_estimates").select("id,mode,total_amount,created_at,items,metadata").eq("lead_id", contact.id).order("created_at", { ascending: false }).limit(10).then(({ data }) => setPastEstimates(data || []));
  }, []); // eslint-disable-line

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const toggleTag = (tag) => setForm((s) => ({ ...s, tags: s.tags.includes(tag) ? s.tags.filter((t) => t !== tag) : [...s.tags, tag] }));
  const toggleProductType = (t) => setForm((s) => ({ ...s, productTypes: s.productTypes.includes(t) ? s.productTypes.filter((x) => x !== t) : [...s.productTypes, t] }));
  const toggleItemSeen = (t) => setForm((s) => ({ ...s, itemsSeen: s.itemsSeen.includes(t) ? s.itemsSeen.filter((x) => x !== t) : [...s.itemsSeen, t] }));

  const uploadDesignRef = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const { publicUrl } = await secureImageUpload(file, sb, "walkin-refs", { maxDim: 1200 });
      setRefImageUrl(publicUrl);
    } catch (e) {
      alert(e.message);
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
    // Load full profile + past estimates for returning client
    sb.from("bullion_leads").select("*").eq("id", c.id).maybeSingle().then(({ data: lead }) => {
      if (!lead) return;
      setForm(s => ({
        ...s,
        email: lead.email || s.email,
        bday: lead.bday || s.bday,
        anniversary: lead.anniversary || s.anniversary,
        wedding_date: lead.wedding_date || s.wedding_date,
        wedding_family_member: lead.wedding_family_member || s.wedding_family_member,
        is_client: !!lead.is_client,
      }));
    });
    sb.from("bullion_estimates").select("id,mode,total_amount,created_at,items,metadata").eq("lead_id", c.id).order("created_at", { ascending: false }).limit(10).then(({ data }) => setPastEstimates(data || []));
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

      // 2) Create visit session record
      let visitId = null;
      {
        const visitPayload = {
          tenant_id: tenantId,
          lead_id: leadId,
          visited_at: new Date().toISOString(),
          staff: form.assignedStaffId || null,
          party_size: form.partySize ? Number(form.partySize) : null,
          notes: form.description || null,
          followup_required: !!form.followupRequired,
          price_quoted: form.priceQuoted ? Number(form.priceQuoted) : null,
          items_seen: form.itemsSeen?.join(", ") || null,
        };
        const { data: vdata } = await sb.from("bullion_visits").insert(visitPayload).select("id").single();
        if (vdata?.id) visitId = vdata.id;
      }

      // 3) Optionally create demand
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
            assignedStaffId: form.assignedStaffId?.startsWith("extra:") ? null : (form.assignedStaffId || null),
            assignedTo: form.assignedStaffId?.startsWith("extra:")
              ? form.assignedStaffId.slice(6)
              : (form.assignedStaffId ? (staff.find((s) => s.id === form.assignedStaffId)?.name || null) : null),
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
      setTimeout(() => onSaved({ id: leadId, name: form.name || null, phone, visitId }), 1500);
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

          {/* ── Estimate summary panel (from calculator) ── */}
          {prefill?.estimateSummary && (() => {
            const es = prefill.estimateSummary;
            return (
              <div style={{ background: "#f0f7ff", border: "1px solid #bbdefb", borderRadius: 8, padding: "10px 14px", margin: "0 0 12px", display: "flex", gap: 12, alignItems: "center" }}>
                {es.itemImage && <img src={es.itemImage} alt="" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, border: "1px solid #ddd", flexShrink: 0 }} />}
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>📋 Shown on counter: {es.itemName || es.mode}</div>
                  <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>
                    {es.mode === "jewellery" ? "💍 Jewellery" : es.mode === "solitaire" ? "💎 Solitaire" : "📋 Quotation"}
                    {es.purity ? ` · ${es.purity}` : ""}
                    {es.total > 0 ? ` · ₹${Math.round(es.total).toLocaleString("en-IN")}` : ""}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── Returning client — past visit history ── */}
          {selectedContact && pastEstimates.length > 0 && (
            <div style={{ background: "#f9f9f9", border: "1px solid #eee", borderRadius: 8, padding: "10px 14px", margin: "0 0 12px" }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: "#555", marginBottom: 8 }}>🕐 Previous visits ({pastEstimates.length})</div>
              <div style={{ display: "grid", gap: 6 }}>
                {pastEstimates.slice(0, 5).map((pe) => {
                  const pit = (pe.items || [])[0] || {};
                  const itemLabel = pit.itemName || pit.shape || pe.mode || "—";
                  const editCount = pe.metadata?.changes?.length || 0;
                  return (
                    <div key={pe.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "4px 0", borderBottom: "1px solid #f0f0f0" }}>
                      <div>
                        <span style={{ fontWeight: 500 }}>{itemLabel}</span>
                        <span style={{ color: "#888", marginLeft: 8 }}>{new Date(pe.created_at).toLocaleDateString("en-IN")}</span>
                        {editCount > 0 && <span style={{ color: "#e67e22", marginLeft: 6, fontSize: 10 }}>edited {editCount}×</span>}
                      </div>
                      {pe.total_amount && <span style={{ fontWeight: 600, color: "#1565c0" }}>₹{Math.round(pe.total_amount).toLocaleString("en-IN")}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {selectedContact && pastEstimates.length === 0 && (
            <div style={{ background: "#f0fff4", border: "1px solid #c8e6c9", borderRadius: 8, padding: "8px 14px", margin: "0 0 12px", fontSize: 12, color: "#2e7d32" }}>
              ✨ Returning client — no saved estimates on file
            </div>
          )}

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
                    {extraSalesNames.length > 0 && <optgroup label="Part-time / Extra">
                      {extraSalesNames.map((n) => <option key={`extra:${n}`} value={`extra:${n}`}>{n}</option>)}
                    </optgroup>}
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
          customFields={customFields}
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

// ── Schedule Visit Modal ──────────────────────────────────────────────────
// Sets next_call_at on a demand so it surfaces in the telecaller queue on that day.
function ScheduleVisitModal({ demand, onClose, onSaved }) {
  const nextSat = (() => {
    const d = new Date();
    const day = d.getDay(); // 0=Sun,6=Sat
    const daysUntilSat = ((6 - day) + 7) % 7 || 7;
    d.setDate(d.getDate() + daysUntilSat);
    d.setHours(10, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  })();
  const [dt, setDt] = useState(nextSat);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!dt) { setErr("Pick a date and time."); return; }
    setSaving(true);
    const updates = {
      next_call_at: new Date(dt).toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (note) updates.design_notes = (demand.design_notes ? demand.design_notes + "\n" : "") + `📅 Visit scheduled ${new Date(dt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}: ${note}`;
    const { error } = await sb.from("bullion_demands").update(updates).eq("id", demand.id);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onSaved && onSaved();
  };

  return (
    <Modal title="📅 Schedule Visit" onClose={onClose} width={400}>
      <div style={{ fontSize: 13, color: "#555", marginBottom: 14 }}>
        Set when the client is coming to the shop. The demand will appear in the telecaller queue on that date.
      </div>
      <Field label="Visit date & time" required>
        <Input type="datetime-local" value={dt} onChange={(e) => setDt(e.target.value)} />
      </Field>
      <Field label="Note (optional — e.g. 'coming with husband, wants to see polki set')">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Any context for the visit…" />
      </Field>
      {err && <p style={{ fontSize: 12, color: C.red, margin: "4px 0 8px" }}>{err}</p>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <Btn ghost color={C.gray} onClick={onClose}>Cancel</Btn>
        <Btn color={C.green} onClick={save} disabled={saving}>{saving ? "Saving…" : "✅ Schedule Visit"}</Btn>
      </div>
    </Modal>
  );
}

// ── Send Design Modal ─────────────────────────────────────────────────────
// Sends an image/doc to the client via WhatsApp and logs it in design_notes.
function SendDesignModal({ demand, lead, onClose, onSent }) {
  const [mediaUrl, setMediaUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [connectedClient, setConnectedClient] = useState(null);
  const [clientsLoading, setClientsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/wa-proxy?path=/clients")
      .then((r) => r.json())
      .then((data) => {
        const connected = (data.clients || []).find((c) => c.connected);
        setConnectedClient(connected || null);
        setClientsLoading(false);
      })
      .catch(() => setClientsLoading(false));
  }, []);

  const send = async () => {
    if (!mediaUrl) { setErr("Paste an image/file URL first."); return; }
    if (!connectedClient) { setErr("No WhatsApp session connected."); return; }
    setSending(true);
    setErr("");
    try {
      const r = await fetch(`/api/wa-proxy?path=/clients/${encodeURIComponent(connectedClient.client_id)}/send-media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: lead.phone, mediaUrl, mediaType: "image", caption }),
      });
      const data = await r.json().catch(() => ({}));
      if (!data.ok) { setErr(data.error || "Send failed"); setSending(false); return; }

      const logLine = `📤 Design sent ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}: ${note || caption || mediaUrl}`;
      const newNotes = (demand.design_notes ? demand.design_notes + "\n" : "") + logLine;
      await sb.from("bullion_demands").update({ design_notes: newNotes, updated_at: new Date().toISOString() }).eq("id", demand.id);
      setSending(false);
      onSent && onSent();
    } catch (e) { setErr(String(e)); setSending(false); }
  };

  return (
    <Modal title="📤 Send Design via WhatsApp" onClose={onClose} width={480}>
      {clientsLoading ? (
        <div style={{ padding: 20, textAlign: "center", color: "#888" }}>Checking WA connection…</div>
      ) : !connectedClient ? (
        <div style={{ padding: 20, textAlign: "center", color: C.red, fontSize: 13 }}>
          No WhatsApp session connected. Connect a session in the Connections tab first.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: "#555", marginBottom: 12, padding: "6px 10px", background: "#f0fdf4", borderRadius: 6 }}>
            Sending from: <strong>{connectedClient.me || connectedClient.client_id}</strong> → to <strong>{lead.phone}</strong>
          </div>
          <Field label="Image or file URL (paste a link — Google Drive 'anyone with link', Dropbox, Supabase storage, etc.)" required>
            <Input value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="https://drive.google.com/uc?id=…  or  https://…/bracelet.jpg" />
          </Field>
          <Field label="Caption (sent with the image)">
            <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. 3 bracelet options as discussed — please check and let us know which you prefer 🙏" />
          </Field>
          <Field label="Internal note (saved in design notes, not sent to client)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Sent 3 polki bracelet designs, she liked option 2" />
          </Field>
          {err && <p style={{ fontSize: 12, color: C.red, margin: "4px 0 8px" }}>{err}</p>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <Btn ghost color={C.gray} onClick={onClose}>Cancel</Btn>
            <Btn color={C.purple} onClick={send} disabled={sending || !mediaUrl}>{sending ? "Sending…" : "📤 Send on WhatsApp"}</Btn>
          </div>
        </>
      )}
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
      wa_number: s?.me ? normalizePhone(s.me.replace(/[:@].*/, "")) : prev.wa_number,
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
  const [testPhone, setTestPhone] = useState({}); // clientId → phone
  const [testing, setTesting] = useState(new Set());
  const [testResult, setTestResult] = useState({}); // clientId → { ok, msg }

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

  const deleteSession = async (clientId) => {
    const linked = funnels.filter((f) => f.wbiztool_client === clientId);
    const msg = linked.length > 0
      ? `Delete session "${clientId}"? It is linked to ${linked.length} funnel(s): ${linked.map((f) => f.name).join(", ")}.\n\nThose funnels will be unlinked (no WA session) — reassign them after.`
      : `Delete session "${clientId}"? This cannot be undone.`;
    if (!confirm(msg)) return;
    // Kill QR modal if open for this session — its status poll recreates the session
    setPairing((p) => p === clientId ? null : p);
    // Optimistically remove from UI immediately so card disappears at once
    setClients((prev) => prev.filter((c) => c.client_id !== clientId));
    // Remove from wa-service
    try { await fetch(`${WA_SERVICE_URL}/clients/${clientId}/logout`, { method: "POST" }); } catch { /* ignore */ }
    try { await fetch(`${WA_SERVICE_URL}/clients/${clientId}`, { method: "DELETE" }); } catch { /* ignore */ }
    // Clear from funnels so they don't reference a dead session
    if (linked.length > 0) {
      await sb.from("funnels").update({ wbiztool_client: null }).in("id", linked.map((f) => f.id));
    }
    load();
  };

  const sendTest = async (clientId) => {
    const raw = testPhone[clientId] ?? "8860866000";
    const phone = raw.replace(/\D/g, "").replace(/^0+/, "").replace(/^91/, "");
    if (!phone) { alert("Enter a phone number to test"); return; }
    setTesting((s) => { const n = new Set(s); n.add(clientId); return n; });
    setTestResult((x) => ({ ...x, [clientId]: null }));
    try {
      const r = await fetch(`${WA_SERVICE_URL}/clients/${encodeURIComponent(clientId)}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, message: `✅ Test from Sun Sea Jewellers CRM — session: ${clientId} — ${new Date().toLocaleTimeString("en-IN")}` }),
      });
      const data = await r.json().catch(() => ({}));
      setTestResult((x) => ({ ...x, [clientId]: data.ok ? { ok: true, msg: "Sent!" } : { ok: false, msg: data.error || "Failed" } }));
    } catch (e) {
      setTestResult((x) => ({ ...x, [clientId]: { ok: false, msg: String(e.message) } }));
    }
    setTesting((s) => { const n = new Set(s); n.delete(clientId); return n; });
  };

  const moveFunnels = async (fromClientId, toClientId) => {
    const linked = funnels.filter((f) => f.wbiztool_client === fromClientId);
    if (linked.length === 0) { alert("No funnels linked to this session."); return; }
    const target = clients.find((c) => c.client_id === toClientId);
    if (!confirm(`Move ${linked.length} funnel(s) from "${fromClientId}" → "${toClientId}" (${target?.me?.replace(/@.*/, "") || toClientId})?`)) return;
    await sb.from("funnels").update({ wbiztool_client: toClientId }).in("id", linked.map((f) => f.id));
    load();
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
              {/* Move funnels to another connected session */}
              {linked.length > 0 && (() => {
                const others = clients.filter((o) => o.connected && o.client_id !== c.client_id);
                if (!others.length) return null;
                return (
                  <select defaultValue="" onChange={(e) => { if (e.target.value) moveFunnels(c.client_id, e.target.value); e.target.value = ""; }}
                    style={{ fontSize: 11, padding: "2px 6px", borderRadius: 6, border: "1px solid #ddd", cursor: "pointer" }}>
                    <option value="">Move funnels →</option>
                    {others.map((o) => <option key={o.client_id} value={o.client_id}>{o.client_id} ({o.me?.replace(/@.*/, "") || "?"})</option>)}
                  </select>
                );
              })()}
              {/* Delete session — always visible so zombie sessions can be cleared */}
              <Btn small ghost color={C.red} onClick={() => deleteSession(c.client_id)}>🗑 Delete</Btn>
            </div>
            {c.connected && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f0f0f0" }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    value={testPhone[c.client_id] ?? "8860866000"}
                    onChange={(e) => setTestPhone((x) => ({ ...x, [c.client_id]: e.target.value }))}
                    placeholder="Phone to test (10 digits)"
                    style={{ fontSize: 12, flex: 1, border: "1px solid #ddd", borderRadius: 6, padding: "4px 8px" }}
                    onKeyDown={(e) => e.key === "Enter" && sendTest(c.client_id)}
                  />
                  <Btn small color={C.blue} disabled={testing.has(c.client_id)} onClick={() => sendTest(c.client_id)}>
                    {testing.has(c.client_id) ? "…" : "Send Test"}
                  </Btn>
                </div>
                {testResult[c.client_id] && (
                  <div style={{ fontSize: 11, marginTop: 4, color: testResult[c.client_id].ok ? "#16a34a" : "#dc2626" }}>
                    {testResult[c.client_id].ok ? "✅ " : "❌ "}{testResult[c.client_id].msg}
                  </div>
                )}
              </div>
            )}
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
    try {
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      const isPdf = file.type === "application/pdf";
      let publicUrl;
      if (isImage) {
        ({ publicUrl } = await secureImageUpload(file, sb, "media-assets"));
      } else if (isVideo || isPdf) {
        const allowed = ["application/pdf", "video/mp4", "video/quicktime", "video/webm", "video/3gpp"];
        ({ publicUrl } = await secureNonImageUpload(file, sb, "media-assets", allowed, 100));
      } else {
        throw new Error("Only images, videos, and PDFs are allowed.");
      }
      const type = isVideo ? "video" : isPdf ? "pdf" : "image";
      setForm((s) => ({ ...s, url: publicUrl, asset_type: type }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setUploading(false);
    }
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
function TrashBin({ onRestore }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    const { data } = await sb.from("bullion_leads").select("id,name,phone,city,deleted_at,deleted_by")
      .eq("tenant_id", getTenantId()).not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(200);
    setRows(data || []);
    setLoading(false);
  };
  useEffect(() => { if (open) load(); }, [open]);
  const restore = async (id) => {
    await sb.from("bullion_leads").update({ deleted_at: null, deleted_by: null }).eq("id", id);
    setRows(r => r.filter(x => x.id !== id));
    onRestore();
  };
  const wipe = async (id, name) => {
    if (!confirm(`Permanently delete ${name}? Cannot be undone.`)) return;
    await sb.from("bullion_leads").delete().eq("id", id);
    setRows(r => r.filter(x => x.id !== id));
  };
  return (
    <div style={{ marginTop: 24 }}>
      <button onClick={() => setOpen(v => !v)} style={{ fontSize: 12, color: C.red, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
        🗑 {open ? "Hide" : "Show"} Trash {rows.length > 0 && open ? `(${rows.length})` : ""}
      </button>
      {open && (
        <div style={{ marginTop: 8, background: "#fff5f5", border: `1px solid ${C.red}33`, borderRadius: 10, padding: 12 }}>
          <p style={{ fontSize: 11, color: C.red, fontWeight: 600, margin: "0 0 10px" }}>🗑 Deleted Contacts — superadmin only</p>
          {loading && <p style={{ fontSize: 12, color: "#aaa" }}>Loading…</p>}
          {!loading && rows.length === 0 && <p style={{ fontSize: 12, color: "#aaa" }}>Trash is empty.</p>}
          {rows.map(r => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #fee2e2", gap: 8, flexWrap: "wrap" }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>{r.name || "(no name)"} · {r.phone}</p>
                <p style={{ margin: 0, fontSize: 11, color: "#aaa" }}>
                  Deleted by <strong>{r.deleted_by || "unknown"}</strong> on {new Date(r.deleted_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <Btn small color={C.green} onClick={() => restore(r.id)}>↩ Restore</Btn>
                <Btn small ghost color={C.red} onClick={() => wipe(r.id, r.name || r.phone)}>× Wipe</Btn>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ContactsScreen({ funnels }) {
  const [contacts, setContacts] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [sending, setSending] = useState(null);
  const [showLid, setShowLid] = useState(false); // hide WA-hidden (LID) leads by default
  const { customFields, fieldOrder, setCustomFields, setFieldOrder } = React.useContext(ContactFieldsContext);
  const [showFieldMgr, setShowFieldMgr] = useState(false);
  const [filterTags, setFilterTags] = useState([]);
  const [tagLogic, setTagLogic] = useState("AND"); // AND = must have all, OR = any
  const isSA = loadUser()?.role === "superadmin";
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [bulkTagAdd, setBulkTagAdd] = useState("");
  const [bulkTagRemove, setBulkTagRemove] = useState("");
  const [bulkWorking, setBulkWorking] = useState(false);
  const toggleSelect = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setSelected(new Set(filtered.map(c => c.id)));
  const clearSel = () => setSelected(new Set());
  const exitBulk = () => { setBulkMode(false); clearSel(); };
  const [viewMode, setViewMode] = useState("list"); // "card" | "list"
  const [sortCol, setSortCol] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [colFilters, setColFilters] = useState({});
  const setColFilter = (col, val) => setColFilters(f => ({ ...f, [col]: val }));
  const clearColFilters = () => setColFilters({});
  const toggleSort = (col) => { if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortCol(col); setSortDir("asc"); } };
  const [tagPopOpen, setTagPopOpen] = useState(false);
  const [showTagFilter, setShowTagFilter] = useState(false);

  const loadTags = useCallback(async () => {
    const { data } = await sb.from("bullion_tags").select("name,category,color")
      .eq("tenant_id", getTenantId()).order("sort_order");
    setAllTags(data || []);
  }, []);

  const PAGE = 200;
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  const load = useCallback(async (q = "", tags = [], logic = "AND", pg = 0, cf = {}) => {
    setLoading(true);
    const from = pg * PAGE, to = from + PAGE - 1;
    let query = sb.from("bullion_leads")
      .select("*", { count: "exact" })
      .eq("tenant_id", getTenantId())
      .is("deleted_at", null)
      .order("name", { ascending: true, nullsFirst: false })
      .range(from, to);
    if (q.trim()) {
      // Use RPC function that searches extra_fields JSONB too
      const { data: rpcData } = await sb.rpc("search_leads", { p_tenant_id: getTenantId(), p_term: q.trim() });
      let results = rpcData || [];
      // Apply tag filters client-side on RPC results
      if (tags.length > 0) {
        if (logic === "AND") results = results.filter(r => tags.every(t => (r.tags || []).includes(t)));
        else results = results.filter(r => tags.some(t => (r.tags || []).includes(t)));
      }
      setContacts(results);
      setTotal(results.length);
      setLoading(false);
      return;
    }
    if (tags.length > 0) {
      if (logic === "AND") tags.forEach(t => { query = query.contains("tags", [t]); });
      else query = query.overlaps("tags", tags);
    }
    // Server-side column filters
    if (cf.name) query = query.ilike("name", `%${cf.name}%`);
    if (cf.phone) query = query.or(`phone.ilike.%${cf.phone}%,mobile2.ilike.%${cf.phone}%,spouse_mobile.ilike.%${cf.phone}%`);
    if (cf.mobile2) query = query.ilike("mobile2", `%${cf.mobile2}%`);
    if (cf.spouse_mobile) query = query.ilike("spouse_mobile", `%${cf.spouse_mobile}%`);
    if (cf.city) query = query.ilike("city", `%${cf.city}%`);
    if (cf.email) query = query.ilike("email", `%${cf.email}%`);
    if (cf.bday) query = query.ilike("bday", `%${cf.bday}%`);
    if (cf.anniversary) query = query.ilike("anniversary", `%${cf.anniversary}%`);
    if (cf.client_rating) query = query.eq("client_rating", Number(cf.client_rating));
    if (cf.source) query = query.eq("source", cf.source);
    if (cf.tags) query = query.contains("tags", [cf.tags]);
    const { data, count } = await query;
    setContacts(data || []);
    setTotal(count || 0);
    setLoading(false);
  }, []);

  // Reload when search/tags/page change (debounce search)
  useEffect(() => { loadTags(); }, [loadTags]);
  useEffect(() => { setPage(0); }, [search, filterTags, tagLogic, colFilters]);
  useEffect(() => {
    const t = setTimeout(() => load(search, filterTags, tagLogic, page, colFilters), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [search, filterTags, tagLogic, page, colFilters, load]);

  const filtered = useMemo(() => {
    // Client-side extra_fields search on top of server results
    if (!search.trim()) return showLid ? contacts : contacts.filter(c => !isLid(c.phone));
    const q = search.trim().toLowerCase();
    return (showLid ? contacts : contacts.filter(c => !isLid(c.phone))).filter(c => {
      const extraVals = Object.values(c.extra_fields || {}).join(" ").toLowerCase();
      const tgs = (c.tags || []).join(" ").toLowerCase();
      return [c.name, c.phone, c.mobile2, c.spouse_mobile, c.email, c.city, c.source, c.bday, c.anniversary,
              extraVals, tgs]
        .some(v => v && String(v).toLowerCase().includes(q));
    });
  }, [contacts, showLid, search]);
  const lidCount = contacts.filter(c => isLid(c.phone)).length;
  const totalPages = Math.ceil(total / PAGE);

  // List view: apply column filters + sort on top of page results
  const listReady = useMemo(() => {
    let list = [...filtered];
    // Only client-side: custom field (extra_fields) filters — regular columns are server-side
    Object.entries(colFilters).forEach(([col, val]) => {
      if (!val || !col.startsWith("cf_")) return;
      const key = col.slice(3);
      const q = val.toLowerCase();
      list = list.filter(c => String(c.extra_fields?.[key] || "").toLowerCase().includes(q));
    });
    // Sort
    list.sort((a, b) => {
      let av, bv;
      if (sortCol.startsWith("cf_")) {
        const k = sortCol.slice(3);
        av = String(a.extra_fields?.[k] || "").toLowerCase();
        bv = String(b.extra_fields?.[k] || "").toLowerCase();
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      av = a[sortCol] ?? ""; bv = b[sortCol] ?? "";
      if (sortCol === "client_rating") { av = Number(av || 0); bv = Number(bv || 0); return sortDir === "asc" ? av - bv : bv - av; }
      av = String(av).toLowerCase(); bv = String(bv).toLowerCase();
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return list;
  }, [filtered, colFilters, sortCol, sortDir]);

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
        <Btn ghost small color={C.gray} onClick={() => load(search, filterTags, tagLogic, page)}>↻</Btn>
        <Btn small color={C.blue} onClick={() => setEditing({})}>+ Add Contact</Btn>
        <Btn ghost small color={C.orange} onClick={() => setShowFieldMgr(v => !v)}>⚙ Fields</Btn>
        <Btn ghost small color={bulkMode ? C.purple : C.gray} onClick={() => bulkMode ? exitBulk() : setBulkMode(true)}>{bulkMode ? "✕ Cancel" : "☑ Bulk"}</Btn>
        <Btn ghost small color={C.gray} onClick={() => setViewMode(v => v === "card" ? "list" : "card")}>{viewMode === "card" ? "☰ List" : "⊞ Cards"}</Btn>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#666", cursor: "pointer" }}>
          <input type="checkbox" checked={showLid} onChange={(e) => setShowLid(e.target.checked)} />
          Show WA-hidden ({lidCount})
        </label>
        <span style={{ fontSize: 11, color: "#888" }}>{loading ? "Loading…" : `${total.toLocaleString()} contacts`}</span>
      </div>

      {showFieldMgr && <CustomFieldsManager fields={customFields} />}

      {bulkMode && (
        <div style={{ background: "#f0f0ff", border: "1px solid #c4b5fd", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.purple }}>{selected.size} selected</span>
            <Btn ghost small color={C.gray} onClick={selectAll}>Select all ({filtered.length})</Btn>
            {selected.size > 0 && <Btn ghost small color={C.gray} onClick={clearSel}>Clear</Btn>}
            <div style={{ flex: 1 }} />
            {/* Add tag */}
            <select value={bulkTagAdd} onChange={e => setBulkTagAdd(e.target.value)} style={{ fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid #ddd" }}>
              <option value="">+ Add tag…</option>
              {allTags.filter(t => t.category !== "source").map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
            <Btn small color={C.green} disabled={!bulkTagAdd || !selected.size || bulkWorking} onClick={async () => {
              setBulkWorking(true);
              const ids = [...selected];
              const toUpdate = filtered.filter(c => ids.includes(c.id));
              await Promise.all(toUpdate.map(c => {
                const tags = [...new Set([...(c.tags || []), bulkTagAdd])];
                return sb.from("bullion_leads").update({ tags }).eq("id", c.id);
              }));
              setBulkTagAdd(""); clearSel(); setBulkWorking(false);
              load(search, filterTags, tagLogic, page);
            }}>{bulkWorking ? "…" : "Apply"}</Btn>
            {/* Remove tag */}
            <select value={bulkTagRemove} onChange={e => setBulkTagRemove(e.target.value)} style={{ fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid #ddd" }}>
              <option value="">− Remove tag…</option>
              {allTags.filter(t => t.category !== "source").map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
            <Btn small color={C.orange} disabled={!bulkTagRemove || !selected.size || bulkWorking} onClick={async () => {
              setBulkWorking(true);
              const ids = [...selected];
              const toUpdate = filtered.filter(c => ids.includes(c.id));
              await Promise.all(toUpdate.map(c => {
                const tags = (c.tags || []).filter(t => t !== bulkTagRemove);
                return sb.from("bullion_leads").update({ tags }).eq("id", c.id);
              }));
              setBulkTagRemove(""); clearSel(); setBulkWorking(false);
              load(search, filterTags, tagLogic, page);
            }}>{bulkWorking ? "…" : "Remove"}</Btn>
            {/* Bulk delete — SA only */}
            {isSA && selected.size > 0 && (
              <Btn small color={C.red} disabled={bulkWorking} onClick={async () => {
                if (!confirm(`Move ${selected.size} contacts to Trash?`)) return;
                setBulkWorking(true);
                const by = loadUser()?.name || loadUser()?.username || "admin";
                await sb.from("bullion_leads").update({ deleted_at: new Date().toISOString(), deleted_by: by }).in("id", [...selected]);
                clearSel(); setBulkWorking(false);
                load(search, filterTags, tagLogic, page);
              }}>{bulkWorking ? "…" : `🗑 Delete ${selected.size}`}</Btn>
            )}
          </div>
        </div>
      )}

      {allTags.filter(t => t.category !== "source").length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => setShowTagFilter(v => !v)}
              style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, cursor: "pointer", border: `1px solid ${filterTags.length ? C.purple : "#ddd"}`, background: filterTags.length ? C.purple+"22" : "transparent", color: filterTags.length ? C.purple : "#888", fontWeight: filterTags.length ? 600 : 400 }}>
              🏷 Tags {filterTags.length ? `(${filterTags.length} active)` : ""} {showTagFilter ? "▲" : "▼"}
            </button>
            {filterTags.length > 0 && <button onClick={() => setFilterTags([])} style={{ fontSize: 11, color: C.red, background: "none", border: "none", cursor: "pointer" }}>✕ clear</button>}
          </div>
          {showTagFilter && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, padding: "10px 12px", background: "#fafafa", borderRadius: 8, border: "1px solid #eee" }}>
              {allTags.filter(t => t.category !== "source").map(t => {
                const active = filterTags.includes(t.name);
                return (
                  <button key={t.name} onClick={() => setFilterTags(s => active ? s.filter(x => x !== t.name) : [...s, t.name])}
                    style={{ fontSize: 11, padding: "2px 10px", borderRadius: 20, cursor: "pointer", border: `1px solid ${active ? (t.color || C.blue) : "#ddd"}`, background: active ? (t.color || C.blue) : "#fff", color: active ? "#fff" : "#555", fontWeight: active ? 600 : 400 }}>
                    {t.name}
                  </button>
                );
              })}
              {filterTags.length > 1 && (
                <button onClick={() => setTagLogic(l => l === "AND" ? "OR" : "AND")}
                  style={{ fontSize: 11, padding: "2px 10px", borderRadius: 20, border: `1px solid ${C.purple}`, background: C.purple, color: "#fff", cursor: "pointer", fontWeight: 600 }}>
                  {tagLogic}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {viewMode === "card" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
          {filtered.map((c) => (
            <div key={c.id} style={{ position: "relative" }}>
              {bulkMode && <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)}
                style={{ position: "absolute", top: 10, left: 10, width: 16, height: 16, zIndex: 2, cursor: "pointer", accentColor: C.purple }} />}
              <div onClick={bulkMode ? () => toggleSelect(c.id) : undefined}
                style={{ cursor: bulkMode ? "pointer" : "default", opacity: bulkMode && !selected.has(c.id) ? 0.7 : 1, outline: bulkMode && selected.has(c.id) ? `2px solid ${C.purple}` : "none", borderRadius: 12 }}>
                <ContactCard contact={c} onEdit={bulkMode ? undefined : () => setEditing(c)} onSendWA={bulkMode ? undefined : () => setSending(c)}
                  onDelete={!bulkMode && isSA ? async () => {
                    if (!confirm(`Move ${c.name || c.phone} to Trash?`)) return;
                    const by = loadUser()?.name || loadUser()?.username || "admin";
                    await sb.from("bullion_leads").update({ deleted_at: new Date().toISOString(), deleted_by: by }).eq("id", c.id);
                    load(search, filterTags, tagLogic, page);
                  } : undefined} />
              </div>
            </div>
          ))}
          {!filtered.length && !loading && <div style={{ gridColumn: "1/-1", padding: 40, textAlign: "center", color: "#aaa", fontSize: 13 }}>No contacts found.</div>}
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 10, overflow: "hidden" }}>
          {Object.values(colFilters).some(Boolean) && (
            <div style={{ padding: "6px 12px", background: "#fffbeb", borderBottom: "1px solid #fde68a", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: C.orange }}>Column filters active</span>
              <button onClick={clearColFilters} style={{ fontSize: 11, color: C.red, background: "none", border: "none", cursor: "pointer" }}>✕ Clear all</button>
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                {/* Sort row */}
                <tr style={{ background: "#f7f7f7", borderBottom: "1px solid #eee" }}>
                  {bulkMode && <th style={{ padding: "8px 10px", width: 36 }}>
                    <input type="checkbox" checked={selected.size === listReady.length && listReady.length > 0}
                      onChange={() => selected.size === listReady.length ? clearSel() : setSelected(new Set(listReady.map(c=>c.id)))}
                      style={{ width: 14, height: 14, cursor: "pointer", accentColor: C.purple }} />
                  </th>}
                  {[["name","Name"],["phone","Phone"],["mobile2","Phone 2"],["spouse_mobile","Phone 3"],["city","City"],["email","Email"],["bday","Birthday"],["anniversary","Anniversary"],["client_rating","VIP Score"],["source","Source"],["tags","Tags"],
                    ...customFields.map(f => [`cf_${f.key}`, f.label]),
                    ["",""]].map(([col,h]) => (
                    <th key={col||"actions"} onClick={col && col!=="tags" ? ()=>toggleSort(col) : undefined}
                      style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, color: sortCol===col?"#2980b9":"#888", fontWeight: 600, whiteSpace: "nowrap", cursor: col&&col!=="tags"?"pointer":"default", userSelect:"none" }}>
                      {h}{sortCol===col ? (sortDir==="asc"?" ▲":" ▼") : ""}
                    </th>
                  ))}
                </tr>
                {/* Filter row */}
                <tr style={{ background: "#fafafa", borderBottom: "2px solid #eee" }}>
                  {bulkMode && <th />}
                  {[
                    ["name","text"],["phone","text"],["mobile2","text"],["spouse_mobile","text"],
                    ["city","text"],["email","text"],["bday","text"],["anniversary","text"],
                    ["client_rating","rating"],["source","source"],["tags","tagpop"],
                    ...customFields.map(f => [`cf_${f.key}`, "text"]),
                    ["",""]
                  ].map(([col, type], i) => {
                    if (!col || type==="") return <th key={i} />;
                    const val = colFilters[col] || "";
                    const inp = (style={}) => <input value={val} onChange={e=>setColFilter(col,e.target.value)} placeholder="Filter…" style={{ width:"100%",fontSize:11,padding:"2px 4px",border:"1px solid #ddd",borderRadius:4,boxSizing:"border-box",...style }}/>;
                    if (type==="text") return <th key={col} style={{padding:"3px 6px"}}>{inp()}</th>;
                    if (type==="rating") return <th key={col} style={{padding:"3px 6px"}}>
                      <select value={val} onChange={e=>setColFilter(col,e.target.value)} style={{fontSize:11,width:"100%",border:"1px solid #ddd",borderRadius:4,padding:"2px 2px"}}>
                        <option value="">All</option>
                        {[1,2,3,4,5].map(n=><option key={n} value={n}>{"★".repeat(n)}</option>)}
                      </select></th>;
                    if (type==="source") return <th key={col} style={{padding:"3px 6px"}}>
                      <select value={val} onChange={e=>setColFilter(col,e.target.value)} style={{fontSize:11,width:"100%",border:"1px solid #ddd",borderRadius:4,padding:"2px 2px"}}>
                        <option value="">All</option>
                        {allTags.filter(t=>t.category==="source").map(t=><option key={t.name} value={t.name}>{t.name}</option>)}
                      </select></th>;
                    if (type==="tagpop") return <th key={col} style={{padding:"3px 6px", position:"relative"}}>
                      <button onClick={()=>setTagPopOpen(v=>!v)}
                        style={{fontSize:11,width:"100%",border:`1px solid ${val?"#6366f1":"#ddd"}`,borderRadius:4,background:val?"#eef2ff":"#fff",cursor:"pointer",padding:"2px 6px",textAlign:"left",color:val?"#4338ca":"#888",fontWeight:val?600:400}}>
                        {val || "Tag ▾"}
                        {val && <span onClick={e=>{e.stopPropagation();setColFilter("tags","");setTagPopOpen(false);}} style={{float:"right",color:"#999",fontWeight:400}}>×</span>}
                      </button>
                      {tagPopOpen && (
                        <div style={{position:"absolute",top:"100%",left:0,zIndex:200,background:"#fff",border:"1px solid #ddd",borderRadius:8,boxShadow:"0 6px 20px #0002",minWidth:180,maxHeight:260,overflowY:"auto"}}>
                          <div onClick={()=>{setColFilter("tags","");setTagPopOpen(false);}} style={{padding:"7px 12px",fontSize:12,cursor:"pointer",color:"#888",borderBottom:"1px solid #f0f0f0"}}>— All tags</div>
                          {allTags.filter(t=>t.category!=="source").map(t=>(
                            <div key={t.name} onClick={()=>{setColFilter("tags",t.name);setTagPopOpen(false);}}
                              style={{padding:"7px 12px",fontSize:12,cursor:"pointer",background:val===t.name?"#f0f0ff":"transparent",display:"flex",alignItems:"center",gap:6}}>
                              <span style={{width:8,height:8,borderRadius:"50%",background:t.color||"#888",flexShrink:0}} />
                              {t.name}
                            </div>
                          ))}
                        </div>
                      )}
                    </th>;
                    return <th key={i} />;
                  })}
                </tr>
              </thead>
              <tbody>
                {listReady.map((c) => {
                  const sel = selected.has(c.id);
                  return (
                    <tr key={c.id} onClick={bulkMode ? () => toggleSelect(c.id) : undefined}
                      style={{ borderBottom: "1px solid #f5f5f5", background: sel ? "#f5f0ff" : "transparent", cursor: bulkMode ? "pointer" : "default" }}>
                      {bulkMode && <td style={{ padding: "6px 10px" }}>
                        <input type="checkbox" checked={sel} onChange={() => toggleSelect(c.id)} style={{ width: 14, height: 14, cursor: "pointer", accentColor: C.purple }} />
                      </td>}
                      <td style={{ padding: "6px 10px", fontWeight: 500, whiteSpace: "nowrap" }}>
                        {c.name || <span style={{ color: "#aaa" }}>(no name)</span>}
                        {c.is_client && <span style={{ marginLeft: 4, fontSize: 10, padding: "1px 5px", borderRadius: 4, background: C.blue+"22", color: C.blue }}>Client</span>}
                      </td>
                      <td style={{ padding: "6px 10px", color: "#555", whiteSpace: "nowrap" }}>{c.phone}</td>
                      <td style={{ padding: "6px 10px", color: "#555", whiteSpace: "nowrap" }}>{c.mobile2 || "—"}</td>
                      <td style={{ padding: "6px 10px", color: "#555", whiteSpace: "nowrap" }}>{c.spouse_mobile || "—"}</td>
                      <td style={{ padding: "6px 10px", color: "#555" }}>{c.city || "—"}</td>
                      <td style={{ padding: "6px 10px", color: "#555" }}>{c.email || "—"}</td>
                      <td style={{ padding: "6px 10px", color: "#555", whiteSpace: "nowrap" }}>{c.bday || "—"}</td>
                      <td style={{ padding: "6px 10px", color: "#555", whiteSpace: "nowrap" }}>{c.anniversary || "—"}</td>
                      <td style={{ padding: "6px 10px", color: "#f59e0b" }}>{c.client_rating ? "★".repeat(c.client_rating) : "—"}</td>
                      <td style={{ padding: "6px 10px", color: "#555" }}>{c.source || "—"}</td>
                      <td style={{ padding: "6px 10px" }}>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {(c.tags || []).map(t => <span key={t} style={{ fontSize: 11, padding: "1px 6px", borderRadius: 10, background: "#e0e7ff", color: "#3730a3" }}>{t}</span>)}
                        </div>
                      </td>
                      {customFields.map(f => (
                        <td key={f.key} style={{ padding: "6px 10px", color: "#555", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.extra_fields?.[f.key] || "—"}
                        </td>
                      ))}
                      <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                        {!bulkMode && <>
                          <button onClick={() => setEditing(c)} style={{ fontSize: 11, border: "none", background: "none", cursor: "pointer", color: C.blue, padding: "2px 4px" }}>✏️</button>
                          <button onClick={() => setSending(c)} style={{ fontSize: 11, border: "none", background: "none", cursor: "pointer", color: "#25d366", padding: "2px 4px" }}>📱</button>
                          {isSA && <button onClick={async () => {
                            if (!confirm(`Move ${c.name||c.phone} to Trash?`)) return;
                            const by = loadUser()?.name || loadUser()?.username || "admin";
                            await sb.from("bullion_leads").update({ deleted_at: new Date().toISOString(), deleted_by: by }).eq("id", c.id);
                            load(search, filterTags, tagLogic, page);
                          }} style={{ fontSize: 11, border: "none", background: "none", cursor: "pointer", color: C.red, padding: "2px 4px" }}>🗑</button>}
                        </>}
                      </td>
                    </tr>
                  );
                })}
                {!listReady.length && !loading && <tr><td colSpan={12 + customFields.length + (bulkMode ? 2 : 1)} style={{ padding: 40, textAlign: "center", color: "#aaa" }}>No contacts found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 16 }}>
          <Btn ghost small color={C.gray} onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>← Prev</Btn>
          <span style={{ fontSize: 12, color: "#888" }}>Page {page + 1} of {totalPages} · {total.toLocaleString()} total</span>
          <Btn ghost small color={C.gray} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>Next →</Btn>
        </div>
      )}

      {isSA && <TrashBin onRestore={() => load(search, filterTags, tagLogic, page)} />}

      {editing !== null && (
        <ContactEditModal
          contact={editing}
          allTags={allTags}
          customFields={customFields}
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

function ContactCard({ contact: c, onEdit, onSendWA, onDelete }) {
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
        {onDelete && <Btn ghost small color={C.red} onClick={onDelete}>🗑</Btn>}
      </div>
    </div>
  );
}

function CustomFieldsManager({ fields }) {
  const { setCustomFields, setFieldOrder: setCtxFieldOrder } = React.useContext(ContactFieldsContext);
  const [newLabel, setNewLabel] = useState("");
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const [editingKey, setEditingKey] = useState(null);
  const [editingLabel, setEditingLabel] = useState("");
  const { fieldOrder } = React.useContext(ContactFieldsContext);
  const allFields = getAllFieldsOrdered(fields, fieldOrder);

  const persistCustom = (next) => { setCustomFields(next); saveCustomFieldDefs(next); };
  const persistOrder = (nextAll) => { const order = nextAll.map(f => f.key); setCtxFieldOrder(order); saveFieldOrder(order); };
  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    const key = label.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    if (!key || allFields.find(f => f.key === key)) return;
    const nextCustom = [...fields, { key, label }];
    const nextAll = [...allFields, { key, label, fixed: false }];
    persistCustom(nextCustom);
    persistOrder(nextAll);
    setNewLabel("");
  };
  const remove = (key) => {
    const nextCustom = fields.filter(f => f.key !== key);
    const nextAll = allFields.filter(f => f.key !== key);
    persistCustom(nextCustom);
    persistOrder(nextAll);
  };
  const rename = (key) => {
    const label = editingLabel.trim();
    if (!label) { setEditingKey(null); return; }
    const nextCustom = fields.map(f => f.key === key ? { ...f, label } : f);
    persistCustom(nextCustom);
    setEditingKey(null);
  };
  const onDrop = (e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setOverIdx(null); return; }
    const next = [...allFields];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(idx, 0, moved);
    const nextCustom = next.filter(f => !f.fixed);
    persistCustom(nextCustom);
    persistOrder(next);
    setDragIdx(null); setOverIdx(null);
  };

  return (
    <div style={{ background: "#fff8f0", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: C.orange, margin: "0 0 8px" }}>⚙ Form Fields — drag ⠿ to reorder · 🔒 = built-in (can move, can't delete)</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 4, marginBottom: 10 }}>
        {allFields.map((f, i) => (
          <div key={f.key}
            draggable
            onDragStart={() => setDragIdx(i)}
            onDragOver={e => { e.preventDefault(); setOverIdx(i); }}
            onDrop={e => onDrop(e, i)}
            onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "5px 8px", borderRadius: 6, background: overIdx === i ? "#fef3c7" : dragIdx === i ? "#fffbeb" : f.fixed ? "#f0f9ff" : "#fff", border: `1px solid ${overIdx === i ? C.orange : f.fixed ? "#bae6fd" : "#ddd"}`, cursor: "grab", userSelect: "none" }}>
            <span style={{ color: "#bbb", fontSize: 14, flexShrink: 0 }}>⠿</span>
            {!f.fixed && editingKey === f.key
              ? <input autoFocus value={editingLabel} onChange={e => setEditingLabel(e.target.value)}
                  onBlur={() => rename(f.key)} onKeyDown={e => { if(e.key==="Enter") rename(f.key); if(e.key==="Escape") setEditingKey(null); }}
                  style={{ flex: 1, fontSize: 12, border: "none", outline: "1px solid #93c5fd", borderRadius: 4, padding: "1px 4px", minWidth: 0 }} />
              : <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  onDoubleClick={!f.fixed ? () => { setEditingKey(f.key); setEditingLabel(f.label); } : undefined}
                  title={!f.fixed ? "Double-click to rename" : ""}>{f.label}</span>
            }
            {f.fixed
              ? <span style={{ fontSize: 10, color: "#93c5fd", flexShrink: 0 }}>🔒</span>
              : <button onClick={() => remove(f.key)} style={{ border: "none", background: "none", color: C.red, cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
            }
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input value={newLabel} onChange={e => setNewLabel(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder="Add new field (e.g. GST No, Pincode)…" style={{ flex: 1, fontSize: 12, padding: "5px 8px", borderRadius: 6, border: "1px solid #ddd" }} />
        <button onClick={add} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 6, border: "1px dashed #ddd", background: "transparent", color: "#555", cursor: "pointer" }}>+ Add</button>
      </div>
    </div>
  );
}

function ContactEditModal({ contact, allTags = [], customFields = [], onClose, onSaved }) {
  const { fieldOrder } = React.useContext(ContactFieldsContext);
  const isNew = !contact.id;
  const sourceTags = allTags.filter((t) => t.category === "source").map((t) => t.name);
  const otherTags = allTags.filter((t) => t.category !== "source").map((t) => t.name);

  const [form, setForm] = useState({
    name: contact.name || "",
    phone: contact.phone || "",
    mobile2: contact.mobile2 || "",
    spouse_mobile: contact.spouse_mobile || "",
    salutation: contact.salutation || "",
    city: contact.city || "",
    address_house: contact.address_house || "",
    address_locality: contact.address_locality || "",
    address_state: contact.address_state || "",
    address_pincode: contact.address_pincode || "",
    address_country: contact.address_country || "India",
    email: contact.email || "",
    profession: contact.profession || "",
    industry: contact.industry || "",
    company: contact.company || "",
    client_code: contact.client_code || "",
    bday: contact.bday || "",
    anniversary: contact.anniversary || "",
    spouse_name: contact.spouse_name || "",
    spouse_dob: contact.spouse_dob || "",
    wedding_date: contact.wedding_date || "",
    wedding_family_member: contact.wedding_family_member || "",
    client_rating: contact.client_rating || "",
    is_client: contact.is_client || false,
    source: contact.source || "",
    tags: Array.isArray(contact.tags) ? contact.tags : [],
    partner_lead_id: contact.partner_lead_id || null,
    extra_fields: contact.extra_fields || {},
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
      mobile2: form.mobile2 || null,
      spouse_mobile: form.spouse_mobile || null,
      salutation: form.salutation || null,
      city: form.city || null,
      address_house: form.address_house || null,
      address_locality: form.address_locality || null,
      address_state: form.address_state || null,
      address_pincode: form.address_pincode || null,
      address_country: form.address_country || null,
      email: form.email || null,
      profession: form.profession || null,
      industry: form.industry || null,
      company: form.company || null,
      client_code: form.client_code || null,
      bday: form.bday || null,
      anniversary: form.anniversary || null,
      client_rating: form.client_rating ? Number(form.client_rating) : null,
      is_client: form.is_client,
      spouse_name: form.spouse_name || null,
      spouse_dob: form.spouse_dob || null,
      wedding_date: form.wedding_date || null,
      wedding_family_member: form.wedding_family_member || null,
      source: form.source || null,
      tags: form.tags,
      partner_lead_id: form.partner_lead_id || null,
      extra_fields: form.extra_fields || {},
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

  const orderedFields = getAllFieldsOrdered(customFields, fieldOrder);
  const renderFormField = (f) => {
    if (f.key === "client_rating") return (
      <Field key={f.key} label={f.label}>
        <Select value={form.client_rating} onChange={e => set("client_rating", e.target.value)}>
          <option value="">—</option>
          {[1,2,3,4,5].map(n => <option key={n} value={n}>{"★".repeat(n)} {n} star{n>1?"s":""}</option>)}
        </Select>
      </Field>
    );
    if (f.key === "source") return (
      <Field key={f.key} label={f.label}>
        <Select value={form.source} onChange={e => set("source", e.target.value)}>
          <option value="">— select source —</option>
          {sourceTags.map(s => <option key={s} value={s}>{s}</option>)}
        </Select>
      </Field>
    );
    if (f.fixed) {
      const placeholders = { name:"Full name", phone:"9876543210", salutation:"Mr. / Mrs. / Dr.", city:"Delhi", address_house:"Flat 4B", address_locality:"Connaught Place", address_state:"Delhi", address_pincode:"110001", address_country:"India", email:"email@example.com", profession:"Doctor", industry:"Healthcare", company:"Sun Sea Jewellers", client_code:"SSJ-001", bday:"1985-03-15", anniversary:"2010-11-20", spouse_name:"Priya Sharma", spouse_dob:"1988-06-20", wedding_date:"2025-11-15", wedding_family_member:"daughter Priya" };
      return (
        <Field key={f.key} label={f.label} required={f.required}>
          <Input value={form[f.key] || ""} onChange={e => set(f.key, e.target.value)} placeholder={placeholders[f.key] || ""} />
        </Field>
      );
    }
    return (
      <Field key={f.key} label={f.label}>
        <Input value={form.extra_fields[f.key] || ""} onChange={e => set("extra_fields", { ...form.extra_fields, [f.key]: e.target.value })} placeholder={f.label} />
      </Field>
    );
  };

  return (
    <Modal title={isNew ? "Add Contact" : `Edit — ${contact.name || contact.phone}`} onClose={onClose} width={540}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {orderedFields.map(f => renderFormField(f))}
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
function ApprovalsScreen({ funnels, canApprove = true }) {
  const { customFields } = React.useContext(ContactFieldsContext);
  const [rows, setRows] = useState([]);
  const [calRows, setCalRows] = useState([]); // birthday/anniversary messages always loaded 40d ahead
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState("calendar"); // "calendar" | "drip"
  const [groupBy, setGroupBy] = useState("person"); // "person" | "date"
  const [editing, setEditing] = useState({});
  const [saving, setSaving] = useState(new Set());
  const [editContact, setEditContact] = useState(null); // full lead object for ContactEditModal
  const [editContactTags, setEditContactTags] = useState([]);
  const [expanded, setExpanded] = useState(new Set()); // expanded person/date groups
  const [cronRunning, setCronRunning] = useState(false);
  const [cronResult, setCronResult] = useState(null);
  const [genningIds, setGenningIds] = useState(new Set());

  const regenOne = async (id) => {
    setGenningIds((s) => new Set([...s, id]));
    try {
      await fetch(`/api/cron?gen_id=${id}`, { headers: { "x-crm-secret": CRM_SECRET } });
      const { data } = await sb.from("bullion_scheduled_messages").select("edited_body").eq("id", id).maybeSingle();
      if (data?.edited_body) {
        setCalRows((r) => r.map((m) => m.id === id ? { ...m, edited_body: data.edited_body } : m));
        setRows((r) => r.map((m) => m.id === id ? { ...m, edited_body: data.edited_body } : m));
      }
    } catch {}
    setGenningIds((s) => { const n = new Set(s); n.delete(id); return n; });
  };

  const runCron = async () => {
    setCronRunning(true);
    setCronResult(null);
    try {
      const r = await fetch("/api/cron", {
        headers: { "x-crm-secret": CRM_SECRET },
      });
      const data = await r.json();
      setCronResult(data);
      if (data.ok) await load(); // reload approvals after cron
    } catch (e) {
      setCronResult({ ok: false, error: String(e) });
    }
    setCronRunning(false);
  };

  const load = useCallback(async () => {
    setLoading(true);
    // Calendar messages: always load 40 days ahead (birthday/anniversary funnels)
    const calUntil = new Date(Date.now() + 40 * 86400000).toISOString();
    const { data: calData } = await sb.from("bullion_scheduled_messages")
      .select("id,lead_id,funnel_id,body,edited_body,media_url,media_type,send_at,approved,approved_at,status,step:bullion_funnel_steps(id,name,step_order,use_ai_message),lead:bullion_leads(id,name,phone),funnel:funnels(id,name,kind)")
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
      .select("id,lead_id,funnel_id,body,edited_body,media_url,media_type,send_at,approved,approved_at,status,step:bullion_funnel_steps(id,name,step_order,use_ai_message),lead:bullion_leads(id,name,phone),funnel:funnels(id,name,kind)")
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

  const openContactEdit = async (leadId) => {
    const [{ data: lead }, { data: tags }] = await Promise.all([
      sb.from("bullion_leads").select("*").eq("id", leadId).maybeSingle(),
      sb.from("bullion_tags").select("name,category,color").eq("tenant_id", getTenantId()).order("sort_order"),
    ]);
    if (lead) { setEditContact(lead); setEditContactTags(tags || []); }
  };

  const onContactSaved = async () => {
    const leadId = editContact?.id;
    setEditContact(null);
    if (!leadId) return;
    const { data } = await sb.from("bullion_leads").select("id,name,phone").eq("id", leadId).maybeSingle();
    if (data) {
      const patch = (arr) => arr.map((m) => m.lead_id === leadId ? { ...m, lead: { ...m.lead, name: data.name, phone: data.phone } } : m);
      setCalRows(patch);
      setRows(patch);
    }
  };

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
    const isSav = saving.has(r.id) || saving.has(r.lead_id);
    const isGenning = genningIds.has(r.id);
    const funnelName = funnels.find((f) => f.id === r.funnel_id)?.name || r.funnel?.name || r.funnel_id;
    const stepName = r.step?.name || `Step ${r.step?.step_order || ""}`;
    const stepMedia = r.media_url || null;
    const stepMediaType = r.media_type || "image";

    return (
      <div style={{ background: r.approved ? "#f0fdf4" : "#fff", border: `1px solid ${r.approved ? "#86efac" : "#e5e7eb"}`, borderRadius: 10, padding: "12px 14px", marginBottom: 6 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          {groupBy === "date" && (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{r.lead?.name || r.lead?.phone}</span>
                  <button onClick={() => openContactEdit(r.lead_id)} title="Edit contact" style={{ fontSize: 11, padding: "1px 5px", borderRadius: 4, border: "1px solid #ddd", background: "#f9fafb", cursor: "pointer" }}>✏️</button>
                </>
              <span style={{ fontSize: 11, color: "#888" }}>{r.lead?.phone}</span>
            </div>
          )}
          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: "#f3f4f6", color: "#555" }}>{funnelName}</span>
          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: "#ede9fe", color: "#5b21b6", fontWeight: 600 }}>{stepName}</span>
          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: "#fef9c3", color: "#713f12" }}>📅 {fmtSendAt(r.send_at)}</span>
          {r.approved && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: "#dcfce7", color: "#166534", fontWeight: 600 }}>✅ Approved</span>}
          {r.step?.use_ai_message && r.edited_body && <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 6, background: "#ede9fe", color: "#6d28d9" }}>🤖 AI</span>}
        </div>

        <textarea value={body} onChange={(e) => setEditing((x) => ({ ...x, [r.id]: e.target.value }))}
          rows={Math.max(3, Math.min(8, (body.match(/\n/g) || []).length + 2))}
          style={{ width: "100%", fontSize: 13, lineHeight: 1.5, border: `1px solid ${r.step?.use_ai_message && !r.edited_body ? "#fbbf24" : "#e5e7eb"}`, borderRadius: 7, padding: "8px 10px", resize: "vertical", boxSizing: "border-box", background: r.approved ? "#f0fdf4" : "#fafafa", fontFamily: "inherit" }} />

        {stepMedia && (
          <div style={{ marginTop: 6, padding: "7px 10px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 7, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12 }}>{stepMediaType === "image" ? "🖼️" : stepMediaType === "video" ? "🎥" : "📄"}</span>
            <span style={{ fontSize: 12, color: "#0369a1", flex: 1 }}>Attachment: {stepMediaType}</span>
            <a href={stepMedia} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#0284c7", textDecoration: "none" }}>View ↗</a>
          </div>
        )}

        {!r.approved && (
          <div style={{ display: "flex", gap: 6, marginTop: 7, alignItems: "center", flexWrap: "wrap" }}>
            {!canApprove && <span style={{ fontSize: 11, color: "#888", fontStyle: "italic" }}>👁️ View only — no approve access</span>}
            {canApprove && <button onClick={() => approve(r.id)} disabled={isSav || isGenning} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 6, border: "none", background: "#16a34a", color: "#fff", cursor: "pointer", fontWeight: 600 }}>{isSav ? "…" : "✅ Approve"}</button>}
            {canApprove && <button onClick={() => reject(r.id)} disabled={isSav || isGenning} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 6, border: "1px solid #f87171", background: "#fff", color: "#dc2626", cursor: "pointer" }}>❌ Reject</button>}
            {r.step?.use_ai_message && (
              <button onClick={() => regenOne(r.id)} disabled={isGenning} title="Re-generate AI message" style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid #8b5cf6", background: isGenning ? "#ede9fe" : "#fff", color: "#7c3aed", cursor: isGenning ? "not-allowed" : "pointer" }}>
                {isGenning ? "⏳ Generating…" : r.edited_body ? "🔄 Regen AI" : "🤖 Generate AI"}
              </button>
            )}
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
      {editContact && (
        <ContactEditModal
          contact={editContact}
          allTags={editContactTags}
          customFields={customFields}
          onClose={() => setEditContact(null)}
          onSaved={() => onContactSaved(editContact.id, editContact.name)}
        />
      )}
      {/* Generate Previews — top banner */}
      <div style={{ background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "#3730a3", flex: 1 }}>
          ⚡ <strong>Generate Previews</strong> — runs the cron now to create AI message previews for pending birthday/anniversary messages.
        </span>
        <button
          onClick={runCron}
          disabled={cronRunning}
          style={{ fontSize: 13, padding: "7px 18px", borderRadius: 8, border: "none", background: cronRunning ? "#a5b4fc" : "#4f46e5", color: "#fff", cursor: cronRunning ? "not-allowed" : "pointer", fontWeight: 600, whiteSpace: "nowrap" }}
        >
          {cronRunning ? "⏳ Running…" : "⚡ Run Now"}
        </button>
        {cronResult && (
          <span style={{ fontSize: 12, color: cronResult.ok ? "#166534" : "#dc2626", fontWeight: 500 }}>
            {cronResult.ok
              ? `✅ Done — sent: ${cronResult.stats?.sent || 0}, enrolled: ${cronResult.stats?.calendarEnrolled || 0}, previewed: ${cronResult.stats?.previewsGenerated || 0}`
              : `❌ ${cronResult.error}`}
          </span>
        )}
      </div>

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
        <button onClick={runCron} disabled={cronRunning} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 6, border: "1px solid #6366f1", background: cronRunning ? "#e0e7ff" : "#6366f1", color: cronRunning ? "#6366f1" : "#fff", cursor: cronRunning ? "not-allowed" : "pointer", fontWeight: 600 }}>
          {cronRunning ? "⏳ Running…" : "⚡ Generate Previews"}
        </button>
        {cronResult && (
          <span style={{ fontSize: 11, color: cronResult.ok ? "#166534" : "#dc2626" }}>
            {cronResult.ok ? `✅ Done — sent:${cronResult.stats?.sent||0} enrolled:${cronResult.stats?.calendarEnrolled||0}` : `❌ ${cronResult.error}`}
          </span>
        )}
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
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    <>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{g.label}</span>
                        <button onClick={() => openContactEdit(g.leadId)} title="Edit contact" style={{ fontSize: 11, padding: "1px 5px", borderRadius: 4, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>✏️ Edit</button>
                      </>
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
                {unapproved.length > 0 && canApprove && (
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
  const [enrolling, setEnrolling] = useState(new Set()); // "leadId-funnelType" keys
  const [enrolled, setEnrolled] = useState(new Set()); // successfully enrolled this session

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

  const enrollInFunnel = async (leadId, funnelType) => {
    const key = `${leadId}-${funnelType}`;
    setEnrolling((s) => new Set([...s, key]));
    try {
      const res = await fetch(`/api/cron?action=enroll_calendar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-crm-secret": CRM_SECRET },
        body: JSON.stringify({ leadId, funnelType }),
      });
      const j = await res.json();
      if (j.ok) {
        setEnrolled((s) => new Set([...s, key]));
        await load();
      } else {
        alert(`Enroll failed: ${j.error || "unknown error"}`);
      }
    } catch (e) { alert(`Enroll error: ${e.message}`); }
    setEnrolling((s) => { const n = new Set(s); n.delete(key); return n; });
  };

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
                {ev.sentCount === 0 && ev.pendingCount === 0 && (
                  <>
                    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "#fef9c3", color: "#713f12" }}>⚠️ not enrolled</span>
                    <button
                      disabled={enrolling.has(`${ev.contact.id}-${ev.msgType === "bday" ? "birthday" : "anniversary"}`)}
                      onClick={() => enrollInFunnel(ev.contact.id, ev.msgType === "bday" ? "birthday" : "anniversary")}
                      style={{ fontSize: 10, padding: "1px 8px", borderRadius: 8, border: "1px solid #6366f1", background: "#eef2ff", color: "#3730a3", cursor: "pointer" }}>
                      {enrolling.has(`${ev.contact.id}-${ev.msgType === "bday" ? "birthday" : "anniversary"}`) ? "Enrolling…" : "🎯 Enroll"}
                    </button>
                  </>
                )}
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
// BULK IMPORT — helpers + modal
// ──────────────────────────────────────────────────────────

function normPhoneJS(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") raw = String(Math.round(raw));
  let s = String(raw).trim();
  if (!s || s.toLowerCase() === "nan" || s.toLowerCase() === "none") return null;
  if (s.endsWith(".0")) s = s.slice(0, -2);
  let d = s.replace(/\D/g, "").replace(/^0+/, "");
  if (d.length >= 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 10 && "6789".includes(d[0])) return d;
  return null;
}

function cleanNameJS(raw) {
  if (!raw) return null;
  const SALUTS = new Set(["mr","mrs","ms","miss","dr","sh","shri","smt","sri","ji","bhai","sir","mam"]);
  const s = String(raw).trim();
  const filtered = s.split(/[\s,]+/).filter(t => !SALUTS.has(t.toLowerCase().replace(/\.$/, "")));
  const name = filtered.join(" ").trim().replace(/\s+/g, " ");
  return name.length >= 2 ? name : null;
}

function parseDateJS(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!s) return null;
  const m1 = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})/);
  if (m1) {
    let [, d, mo, y] = m1;
    if (y.length === 2) y = parseInt(y) > 30 ? "19" + y : "20" + y;
    return `${y.padStart(4, "0")}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const m2 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m2) return `${m2[1]}-${m2[2].padStart(2, "0")}-${m2[3].padStart(2, "0")}`;
  return null;
}

const IMPORT_DB_FIELDS = [
  { key: "skip", label: "— skip column —" },
  { key: "phone", label: "Phone (required)" },
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "mobile2", label: "Phone 2 / Alt" },
  { key: "salutation", label: "Salutation" },
  { key: "bday", label: "Birthday" },
  { key: "anniversary", label: "Anniversary" },
  { key: "address_house", label: "Address / House No" },
  { key: "address_locality", label: "Locality / Society" },
  { key: "city", label: "City" },
  { key: "address_state", label: "State" },
  { key: "address_pincode", label: "PIN Code" },
  { key: "profession", label: "Profession" },
  { key: "company", label: "Company" },
  { key: "client_code", label: "Client Code" },
  { key: "client_rating", label: "Rating (1–5)" },
  { key: "tags", label: "Tags (comma-separated)" },
  { key: "source", label: "Source" },
];

const HEADER_DETECT_RULES = [
  [/^(phone|mobile|mob|number|contact|ph|cell)[\s_-]*(1|no\.?)?$/i, "phone"],
  [/^(name|full.?name|client.?name|customer.?name|proper.?name)$/i, "name"],
  [/^(email|e-?mail|mail|email.?id|mail.?id)$/i, "email"],
  [/^(mobile2?|alt(ernate)?[\s_]*(mobile|phone|no)?|number[\s_]*2|contact[\s_]*2|mob2|ph2)$/i, "mobile2"],
  [/^(salutation|sal|title|prefix|des\.?)$/i, "salutation"],
  [/^(bday|birthday|birth[\s_]?date|dob|date[\s_]of[\s_]birth|b\.day)$/i, "bday"],
  [/^(anniversary|anniv|ann|wedding[\s_]?date|wed)$/i, "anniversary"],
  [/^(address[\s_]house|house[\s_]no|hno|flat|door|h\.no|address1?|add1?)$/i, "address_house"],
  [/^(locality|society|colony|area|sector|street|add2|address[\s_]2)$/i, "address_locality"],
  [/^(city|location|town)$/i, "city"],
  [/^(state|province)$/i, "address_state"],
  [/^(pin|pin[\s_]?code|postal|zipcode|zip)$/i, "address_pincode"],
  [/^(profession|job|occupation|business)$/i, "profession"],
  [/^(company|firm|organization|org|organisation|employer|company[\s_]name)$/i, "company"],
  [/^(client[\s_]code|code|cust[\s_]id|acc(ount)?)$/i, "client_code"],
  [/^(rating|client[\s_]rating|stars?)$/i, "client_rating"],
  [/^(tags?|label|segment|category)$/i, "tags"],
  [/^(source)$/i, "source"],
  // Google Contacts format
  [/^first[\s_]name$/i, "name"],
  [/^phone[\s_]\d+[\s_]-[\s_]value$/i, "phone"],
  [/^e-?mail[\s_]\d+[\s_]-[\s_]value$/i, "email"],
  [/^address[\s_]\d+[\s_]-[\s_]city$/i, "city"],
  [/^address[\s_]\d+[\s_]-[\s_]region$/i, "address_state"],
  [/^address[\s_]\d+[\s_]-[\s_]postal[\s_]code$/i, "address_pincode"],
  [/^birthday$/i, "bday"],
  [/^organization[\s_]name$/i, "company"],
];

function autoDetectMapping(headers) {
  const map = {};
  const used = new Set();
  for (const h of headers) {
    for (const [pat, field] of HEADER_DETECT_RULES) {
      if (pat.test(h.trim()) && !used.has(field)) {
        map[h] = field;
        used.add(field);
        break;
      }
    }
  }
  return map;
}

function BulkImportModal({ onClose, onDone }) {
  const [step, setStep] = useState(1);
  const [rawRows, setRawRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const isGoogleContacts = headers.some(h => /^first[\s_]name$/i.test(h)) &&
    headers.some(h => /^phone[\s_]\d+[\s_]-[\s_]value$/i.test(h));

  function getMappedRow(raw) {
    const out = {};
    for (const [hdr, field] of Object.entries(mapping)) {
      if (!field || field === "skip") continue;
      const val = raw[hdr];
      if (val == null || val === "") continue;
      if (out[field]) continue;
      out[field] = val;
    }
    if (isGoogleContacts && !out.name) {
      const parts = ["First Name", "Middle Name", "Last Name"].map(k => raw[k] || "").filter(Boolean);
      if (parts.length) out.name = parts.join(" ").trim();
    }
    return out;
  }

  async function handleFile(file) {
    setFileName(file.name);
    setParseError("");
    const ext = file.name.split(".").pop().toLowerCase();
    try {
      let rows = [], hdrs = [];
      if (ext === "csv") {
        const Papa = (await import("papaparse")).default;
        const text = await file.text();
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        if (parsed.errors.length && !parsed.data.length) throw new Error(parsed.errors[0].message);
        hdrs = parsed.meta.fields || [];
        rows = parsed.data;
      } else {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
        hdrs = rows.length ? Object.keys(rows[0]) : [];
      }
      setHeaders(hdrs);
      setRawRows(rows);
      setMapping(autoDetectMapping(hdrs));
      setStep(2);
    } catch (e) {
      setParseError("Could not parse file: " + e.message);
    }
  }

  const previewRows = rawRows.slice(0, 10).map(getMappedRow);
  const hasPhoneMapped = Object.values(mapping).includes("phone");
  const eligibleCount = rawRows.filter(r => normPhoneJS(getMappedRow(r).phone)).length;

  async function runImport() {
    setImporting(true);
    setStep(4);
    const tenantId = getTenantId();
    const BATCH = 50;
    let created = 0;
    const errors = [];
    const eligible = rawRows.filter(r => normPhoneJS(getMappedRow(r).phone));
    setProgress({ done: 0, total: eligible.length });

    for (let i = 0; i < eligible.length; i += BATCH) {
      const batch = eligible.slice(i, i + BATCH);
      const records = batch.map(r => {
        const m = getMappedRow(r);
        const phone = normPhoneJS(m.phone);
        if (!phone) return null;
        const rec = {
          tenant_id: tenantId,
          phone,
          name: cleanNameJS(m.name) || null,
          email: m.email ? String(m.email).trim() : null,
          mobile2: normPhoneJS(m.mobile2) || null,
          salutation: m.salutation ? String(m.salutation).trim() : null,
          bday: parseDateJS(m.bday) || null,
          anniversary: parseDateJS(m.anniversary) || null,
          address_house: m.address_house ? String(m.address_house).trim() : null,
          address_locality: m.address_locality ? String(m.address_locality).trim() : null,
          city: m.city ? String(m.city).trim() : null,
          address_state: m.address_state ? String(m.address_state).trim() : null,
          address_pincode: m.address_pincode ? String(m.address_pincode).trim() : null,
          profession: m.profession ? String(m.profession).trim() : null,
          company: m.company ? String(m.company).trim() : null,
          client_code: m.client_code ? String(m.client_code).trim() : null,
          client_rating: m.client_rating ? parseInt(m.client_rating) || null : null,
          source: m.source ? String(m.source).trim() : null,
          tags: m.tags ? String(m.tags).split(/[,;]+/).map(t => t.trim()).filter(Boolean) : null,
        };
        return Object.fromEntries(Object.entries(rec).filter(([, v]) => v != null));
      }).filter(Boolean);

      if (!records.length) continue;
      const { error } = await sb.from("bullion_leads")
        .upsert(records, { onConflict: "tenant_id,phone", ignoreDuplicates: false });
      if (error) errors.push(error.message);
      else created += records.length;
      setProgress(p => ({ ...p, done: Math.min(i + BATCH, eligible.length) }));
    }

    const skipped = rawRows.length - eligible.length;
    await sb.from("bullion_imports").insert({
      tenant_id: tenantId,
      finished_at: new Date().toISOString(),
      file: fileName,
      rows_in: rawRows.length,
      rows_created: created,
      rows_merged: 0,
      rows_skipped: skipped,
      errors,
      summary: { source: "bulk_upload_ui" },
    });

    setResult({ created, skipped, errors, total: rawRows.length });
    setImporting(false);
    if (typeof onDone === "function") onDone();
  }

  const STEP_LABELS = ["Upload file", "Map columns", "Preview", "Import"];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 12, width: 700, maxWidth: "95vw", maxHeight: "92vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.25)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid #e5e7eb" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>⬆ Bulk Import Contacts</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 1 }}>{STEP_LABELS[step - 1]}</div>
          </div>
          <div style={{ display: "flex", gap: 5 }}>
            {[1,2,3,4].map(s => (
              <div key={s} style={{ width: 28, height: 5, borderRadius: 3, background: s <= step ? "#3b82f6" : "#e5e7eb", transition: "background 0.3s" }} />
            ))}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9ca3af", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 20 }}>
          {/* Step 1 — Upload */}
          {step === 1 && (
            <div>
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                onClick={() => fileRef.current?.click()}
                style={{ border: "2px dashed #cbd5e1", borderRadius: 10, padding: "44px 20px", textAlign: "center", cursor: "pointer", background: "#f8fafc" }}>
                <div style={{ fontSize: 44, marginBottom: 10 }}>📂</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#334155" }}>Drop file here or click to browse</div>
                <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>Accepts .csv · .xlsx · .xls</div>
                <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </div>
              {parseError && <div style={{ marginTop: 10, color: "#dc2626", fontSize: 13 }}>⚠ {parseError}</div>}
              <div style={{ marginTop: 14, background: "#f0f9ff", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#0369a1" }}>
                <strong>Google Contacts?</strong> Open contacts.google.com → Export → Google CSV → upload here. Columns auto-mapped.
              </div>
            </div>
          )}

          {/* Step 2 — Map columns */}
          {step === 2 && (
            <div>
              <div style={{ fontSize: 13, color: "#555", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <span><strong>{fileName}</strong> · {rawRows.length} rows · {headers.length} columns</span>
                {isGoogleContacts && <span style={{ background: "#dcfce7", color: "#166534", padding: "2px 8px", borderRadius: 10, fontSize: 11 }}>✓ Google Contacts detected</span>}
              </div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>Green rows = auto-detected. Adjust if wrong.</div>
              <div style={{ maxHeight: 360, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb", position: "sticky", top: 0 }}>
                      {["Column in file", "Sample value", "Map to field"].map(h => (
                        <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {headers.map(h => {
                      const autoMap = autoDetectMapping([h])[h];
                      const isAuto = autoMap && autoMap === mapping[h] && autoMap !== "skip";
                      const sample = rawRows[0]?.[h];
                      return (
                        <tr key={h} style={{ borderBottom: "1px solid #f3f4f6", background: isAuto ? "#f0fdf4" : "transparent" }}>
                          <td style={{ padding: "6px 12px", fontWeight: 500 }}>{h}</td>
                          <td style={{ padding: "6px 12px", color: "#888", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {sample != null && sample !== "" ? String(sample).slice(0, 50) : <em style={{ color: "#ccc" }}>—</em>}
                          </td>
                          <td style={{ padding: "6px 12px" }}>
                            <select value={mapping[h] || "skip"}
                              onChange={e => setMapping(m => ({ ...m, [h]: e.target.value }))}
                              style={{ fontSize: 12, border: `1px solid ${isAuto ? "#86efac" : "#d1d5db"}`, borderRadius: 5, padding: "3px 6px", background: isAuto ? "#f0fdf4" : "#fff" }}>
                              {IMPORT_DB_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!hasPhoneMapped && (
                <div style={{ marginTop: 10, color: "#dc2626", fontSize: 13 }}>⚠ Map at least one column to <strong>Phone (required)</strong></div>
              )}
              <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setStep(1)} style={{ padding: "8px 16px", borderRadius: 7, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 13 }}>← Back</button>
                <button onClick={() => setStep(3)} disabled={!hasPhoneMapped}
                  style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: hasPhoneMapped ? "#3b82f6" : "#e5e7eb", color: "#fff", cursor: hasPhoneMapped ? "pointer" : "default", fontSize: 13, fontWeight: 600 }}>
                  Preview →
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — Preview */}
          {step === 3 && (
            <div>
              <div style={{ fontSize: 13, color: "#555", marginBottom: 10 }}>
                Showing first {previewRows.length} rows · <strong style={{ color: "#16a34a" }}>{eligibleCount} have valid phone numbers</strong> and will be imported
              </div>
              <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 8, maxHeight: 300, overflowY: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 500, width: "100%" }}>
                  <thead>
                    <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                      {["Phone","Name","Email","City","Birthday","Tags"].map(h => (
                        <th key={h} style={{ padding: "7px 10px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap", position: "sticky", top: 0, background: "#f9fafb" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, i) => {
                      const phone = normPhoneJS(r.phone);
                      return (
                        <tr key={i} style={{ borderBottom: "1px solid #f3f4f6", background: !phone ? "#fff7f7" : "transparent" }}>
                          <td style={{ padding: "5px 10px", color: phone ? "#059669" : "#dc2626", fontWeight: 500 }}>{phone || r.phone || <em style={{ color: "#ccc" }}>—</em>}</td>
                          <td style={{ padding: "5px 10px" }}>{cleanNameJS(r.name) || <em style={{ color: "#ccc" }}>—</em>}</td>
                          <td style={{ padding: "5px 10px", color: "#666" }}>{r.email || "—"}</td>
                          <td style={{ padding: "5px 10px", color: "#666" }}>{r.city || "—"}</td>
                          <td style={{ padding: "5px 10px", color: "#666" }}>{parseDateJS(r.bday) || "—"}</td>
                          <td style={{ padding: "5px 10px", color: "#666" }}>{r.tags || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 12, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
                ⚡ Contacts are <strong>upserted by phone number</strong> — existing contacts updated, new ones created. No duplicates.
              </div>
              <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setStep(2)} style={{ padding: "8px 16px", borderRadius: 7, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 13 }}>← Back</button>
                <button onClick={runImport}
                  style={{ padding: "8px 22px", borderRadius: 7, border: "none", background: "#16a34a", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                  Import {eligibleCount} contacts →
                </button>
              </div>
            </div>
          )}

          {/* Step 4 — Progress / Done */}
          {step === 4 && (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              {importing ? (
                <>
                  <div style={{ fontSize: 44, marginBottom: 12 }}>⏳</div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>Importing contacts…</div>
                  <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>{progress.done} / {progress.total}</div>
                  <div style={{ width: "100%", height: 8, background: "#e5e7eb", borderRadius: 4, marginTop: 16 }}>
                    <div style={{ height: 8, background: "#3b82f6", borderRadius: 4, transition: "width 0.3s", width: `${progress.total ? (progress.done / progress.total * 100) : 0}%` }} />
                  </div>
                </>
              ) : result && (
                <>
                  <div style={{ fontSize: 50, marginBottom: 12 }}>✅</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#15803d" }}>Import Complete!</div>
                  <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 16 }}>
                    <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "12px 22px", minWidth: 90 }}>
                      <div style={{ fontSize: 30, fontWeight: 700, color: "#15803d" }}>{result.created}</div>
                      <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>contacts saved</div>
                    </div>
                    <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: 8, padding: "12px 22px", minWidth: 90 }}>
                      <div style={{ fontSize: 30, fontWeight: 700, color: "#a16207" }}>{result.skipped}</div>
                      <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>skipped (no phone)</div>
                    </div>
                    {result.errors.length > 0 && (
                      <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "12px 22px", minWidth: 90 }}>
                        <div style={{ fontSize: 30, fontWeight: 700, color: "#dc2626" }}>{result.errors.length}</div>
                        <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>errors</div>
                      </div>
                    )}
                  </div>
                  {result.errors.length > 0 && (
                    <div style={{ marginTop: 12, background: "#fef2f2", borderRadius: 8, padding: 10, textAlign: "left", fontSize: 12, color: "#dc2626", maxHeight: 100, overflowY: "auto" }}>
                      {result.errors.slice(0, 5).map((e, i) => <div key={i}>• {e}</div>)}
                    </div>
                  )}
                  <button onClick={onClose} style={{ marginTop: 20, padding: "10px 30px", borderRadius: 8, border: "none", background: "#3b82f6", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
                    Done
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
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
  const [showBulkImport, setShowBulkImport] = useState(false);

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
        .is("deleted_at", null)
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
        <button onClick={() => setShowBulkImport(true)} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 7, border: "1px solid #7c3aed", background: "#f5f3ff", color: "#6d28d9", cursor: "pointer", fontWeight: 600 }}>
          ⬆ Bulk Upload
        </button>
      </div>
      {showBulkImport && (
        <BulkImportModal
          onClose={() => setShowBulkImport(false)}
          onDone={() => { setShowBulkImport(false); load(search, filterSource, filterCity, filterRating, filterTags); }}
        />
      )}

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

  // Rotation pool + extra salesperson names
  const [rotationStaff, setRotationStaff] = useState([]);
  const [rotationSaving, setRotationSaving] = useState(new Set());
  const [extraSalesRows, setExtraSalesRows] = useState([]); // bullion_dropdowns rows field='extra_salesperson'
  const [newSalesName, setNewSalesName] = useState("");
  const [salesNameSaving, setSalesNameSaving] = useState(false);
  const [pageAccessSaving, setPageAccessSaving] = useState(new Set());
  const [expandedStaffId, setExpandedStaffId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const tid = getTenantId();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

    const [m, leads, demands, callsToday, callsMonth, staffData, targetsData, configData, rotData, extraSalesData] = await Promise.all([
      sb.from("bullion_funnel_metrics").select("*").eq("tenant_id", tid),
      sb.from("bullion_leads").select("funnel_id,stage,status,created_at").eq("tenant_id", tid).gte("created_at", fromDate).lte("created_at", toDate + "T23:59:59"),
      sb.from("bullion_demands").select("id,budget,outcome,created_at,next_call_at,occasion_date,visit_scheduled_at,is_callback_promised,lead:bullion_leads(status,last_msg_at)").eq("tenant_id", tid).is("outcome", null).limit(500),
      sb.from("bullion_call_logs").select("staff_id,disposition,lag_bucket,talk_bucket,is_suspicious,duration_sec").eq("tenant_id", tid).gte("called_at", todayStart.toISOString()),
      sb.from("bullion_call_logs").select("staff_id,disposition,duration_sec").eq("tenant_id", tid).gte("called_at", monthStart.toISOString()),
      sb.from("staff").select("id,name,username,role,app_permissions").eq("tenant_id", tid).neq("type", "artisan").order("name"),
      sb.from("staff_targets").select("*").eq("tenant_id", tid).eq("month", monthStart.toISOString().slice(0, 10)),
      sb.from("bullion_dropdowns").select("id,field,value").eq("tenant_id", tid).in("field", ["google_review_link","post_sale_day3","post_sale_day7","post_sale_day30","missed_call_auto_reply","bot_numbers"]).eq("active", true).order("sort_order"),
      sb.from("staff").select("id,name,username,role,app_permissions").eq("tenant_id", tid).neq("type", "artisan").order("name"),
      sb.from("bullion_dropdowns").select("id,value,sort_order").eq("tenant_id", tid).eq("field", "extra_salesperson").eq("active", true).order("sort_order"),
    ]);

    if (m.data) setMetrics(m.data);
    if (staffData.data) setStaffList(staffData.data);
    if (rotData.data) setRotationStaff(rotData.data);
    if (extraSalesData.data) setExtraSalesRows(extraSalesData.data);
    let cfgRows = configData.data || [];
    // Auto-create bot_numbers row if it doesn't exist yet
    if (!cfgRows.find((r) => r.field === "bot_numbers")) {
      const { data: inserted } = await sb.from("bullion_dropdowns").insert({
        tenant_id: tid, field: "bot_numbers", value: "8860866000", active: true, sort_order: 0,
      }).select("id,field,value").single();
      if (inserted) cfgRows = [...cfgRows, inserted];
    }
    setConfigRows(cfgRows);

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

  // Toggle a staff member in/out of the telecaller rotation pool
  const toggleRotation = async (s) => {
    const inPool = isTelecallerStaff(s);
    setRotationSaving((prev) => new Set([...prev, s.id]));
    const perms = s.app_permissions || {};
    const fms = Array.isArray(perms.fms) ? [...perms.fms] : [];
    let newFms;
    if (inPool) {
      newFms = fms.filter((v) => v !== "telecaller");
    } else {
      newFms = [...fms, "telecaller"];
    }
    const newPerms = { ...perms, fms: newFms };
    await sb.from("staff").update({ app_permissions: newPerms }).eq("id", s.id);
    setRotationStaff((prev) => prev.map((r) => r.id === s.id ? { ...r, app_permissions: newPerms } : r));
    setRotationSaving((prev) => { const n = new Set(prev); n.delete(s.id); return n; });
  };

  const addExtraSalesName = async () => {
    const name = newSalesName.trim();
    if (!name) return;
    setSalesNameSaving(true);
    const tid = getTenantId();
    const { data } = await sb.from("bullion_dropdowns").insert({
      tenant_id: tid, field: "extra_salesperson", value: name, active: true, sort_order: extraSalesRows.length,
    }).select("id,value,sort_order").single();
    if (data) setExtraSalesRows((r) => [...r, data]);
    setNewSalesName("");
    setSalesNameSaving(false);
  };

  const removeExtraSalesName = async (id) => {
    await sb.from("bullion_dropdowns").update({ active: false }).eq("id", id);
    setExtraSalesRows((r) => r.filter((x) => x.id !== id));
  };

  const toggleCrmTab = async (s, tabKey) => {
    setPageAccessSaving((prev) => new Set([...prev, s.id]));
    const perms = s.app_permissions || {};
    let crm = Array.isArray(perms.crm) ? [...perms.crm] : [];
    crm = crm.filter((k) => k !== "all");
    if (crm.includes(tabKey)) {
      crm = crm.filter((k) => k !== tabKey);
    } else {
      crm = [...crm, tabKey];
    }
    const newPerms = { ...perms, crm };
    await sb.from("staff").update({ app_permissions: newPerms }).eq("id", s.id);
    setRotationStaff((prev) => prev.map((r) => r.id === s.id ? { ...r, app_permissions: newPerms } : r));
    setPageAccessSaving((prev) => { const n = new Set(prev); n.delete(s.id); return n; });
  };

  const grantAllCrm = async (s) => {
    setPageAccessSaving((prev) => new Set([...prev, s.id]));
    const newPerms = { ...(s.app_permissions || {}), crm: ["all"] };
    await sb.from("staff").update({ app_permissions: newPerms }).eq("id", s.id);
    setRotationStaff((prev) => prev.map((r) => r.id === s.id ? { ...r, app_permissions: newPerms } : r));
    setPageAccessSaving((prev) => { const n = new Set(prev); n.delete(s.id); return n; });
  };

  const resetCrmAccess = async (s) => {
    setPageAccessSaving((prev) => new Set([...prev, s.id]));
    const { crm: _removed, ...rest } = s.app_permissions || {};
    await sb.from("staff").update({ app_permissions: rest }).eq("id", s.id);
    setRotationStaff((prev) => prev.map((r) => r.id === s.id ? { ...r, app_permissions: rest } : r));
    setPageAccessSaving((prev) => { const n = new Set(prev); n.delete(s.id); return n; });
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

      {/* Rotation Pool */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#333", marginBottom: 10 }}>📞 Telecaller Rotation Pool</div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>Toggle who is in the auto-assignment round-robin pool. New demands are assigned to the person with lowest open-demand load from this pool.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rotationStaff.map((s) => {
            const inPool = isTelecallerStaff(s);
            const busy = rotationSaving.has(s.id);
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 8, background: inPool ? "#f0fdf4" : "#f9fafb", border: `1px solid ${inPool ? "#86efac" : "#e5e7eb"}` }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: inPool ? 600 : 400 }}>{s.name || s.username}</span>
                {inPool && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "#dcfce7", color: "#166534" }}>📞 In pool</span>}
                <button disabled={busy} onClick={() => toggleRotation(s)}
                  style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: `1px solid ${inPool ? "#fca5a5" : "#86efac"}`, background: inPool ? "#fef2f2" : "#f0fdf4", color: inPool ? "#991b1b" : "#166534", cursor: busy ? "default" : "pointer" }}>
                  {busy ? "…" : inPool ? "Remove" : "Add to pool"}
                </button>
              </div>
            );
          })}
          {!rotationStaff.length && <div style={{ color: "#aaa", fontSize: 12 }}>No staff found.</div>}
        </div>
      </Card>

      {/* CRM Page Access */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#333", marginBottom: 6 }}>🔐 CRM Page Access</div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>Control which CRM pages each staff member can access. Role defaults are always included — you can only add extra tabs, never remove role defaults here. Click a staff member to expand.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rotationStaff.map((s) => {
            const busy = pageAccessSaving.has(s.id);
            const isExpanded = expandedStaffId === s.id;
            const crm = s.app_permissions?.crm;
            const isFullByRole = s.role === "superadmin" || s.role === "admin";
            const hasAll = isFullByRole || (Array.isArray(crm) && crm.includes("all"));
            const roleDefaults = CRM_ROLE_DEFAULT_TABS[s.role] || ["demands"];
            const extraCrm = Array.isArray(crm) ? crm.filter((k) => k !== "all") : [];
            const allowedKeys = hasAll ? CRM_ALL_TABS.map((t) => t.k) : [...new Set([...roleDefaults, ...extraCrm])];
            const extraGranted = extraCrm.filter((k) => !roleDefaults.includes(k));
            const accessLabel = hasAll ? "Full access" : `${allowedKeys.length} tab${allowedKeys.length !== 1 ? "s" : ""}`;
            return (
              <div key={s.id}>
                <div
                  onClick={() => !busy && setExpandedStaffId(isExpanded ? null : s.id)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: isExpanded ? "8px 8px 0 0" : 8, background: isExpanded ? "#eff6ff" : "#f9fafb", border: `1px solid ${isExpanded ? "#93c5fd" : "#e5e7eb"}`, cursor: busy ? "default" : "pointer" }}
                >
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{s.name || s.username}</span>
                  <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 6, background: "#e5e7eb", color: "#555" }}>{s.role}</span>
                  {hasAll && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 6, background: "#dcfce7", color: "#166534" }}>🔓 Full access</span>}
                  {!hasAll && extraGranted.length > 0 && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 6, background: "#fef3c7", color: "#92400e" }}>+{extraGranted.length} extra</span>}
                  <span style={{ fontSize: 11, color: "#888" }}>{accessLabel}</span>
                  <span style={{ fontSize: 11, color: "#aaa" }}>{isExpanded ? "▲" : "▼"}</span>
                </div>
                {isExpanded && (
                  <div style={{ padding: "10px 12px", background: "#f0f9ff", border: "1px solid #93c5fd", borderTop: "none", borderRadius: "0 0 8px 8px" }}>
                    <div style={{ fontSize: 11, color: "#555", marginBottom: 8 }}>
                      <span style={{ fontWeight: 600 }}>Tab access</span>
                      <span style={{ color: "#888" }}> — 🔵 role default (always on) · 🟢 extra granted · ⚪ not granted</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                      {CRM_ALL_TABS.map((tab) => {
                        const isDefault = roleDefaults.includes(tab.k);
                        const isGranted = allowedKeys.includes(tab.k);
                        const canToggle = !isDefault && !isFullByRole && !busy;
                        return (
                          <button
                            key={tab.k}
                            disabled={!canToggle}
                            onClick={() => canToggle && toggleCrmTab(s, tab.k)}
                            title={isDefault ? "Included by role — cannot remove" : isGranted ? "Click to revoke access" : "Click to grant access"}
                            style={{
                              fontSize: 11, padding: "3px 8px", borderRadius: 12,
                              border: `1px solid ${isDefault ? "#93c5fd" : isGranted ? "#86efac" : "#e5e7eb"}`,
                              background: isDefault ? "#dbeafe" : isGranted ? "#dcfce7" : "#f9fafb",
                              color: isDefault ? "#1d4ed8" : isGranted ? "#166534" : "#9ca3af",
                              cursor: canToggle ? "pointer" : "default",
                              opacity: busy ? 0.6 : 1,
                            }}
                          >
                            {tab.icon} {tab.l}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {!isFullByRole && !hasAll && (
                        <button disabled={busy} onClick={() => grantAllCrm(s)}
                          style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid #6366f1", background: "#eef2ff", color: "#3730a3", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
                          🔓 Grant all tabs
                        </button>
                      )}
                      {!isFullByRole && (hasAll || extraGranted.length > 0) && (
                        <button disabled={busy} onClick={() => resetCrmAccess(s)}
                          style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fef2f2", color: "#991b1b", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
                          🔒 Reset to role default
                        </button>
                      )}
                      {busy && <span style={{ fontSize: 11, color: "#888" }}>Saving…</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!rotationStaff.length && <div style={{ color: "#aaa", fontSize: 12 }}>No staff found.</div>}
        </div>
      </Card>

      {/* Extra Salesperson Names */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#333", marginBottom: 6 }}>🧑‍💼 Extra Salesperson Names</div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>Names added here appear in the "Attended by" dropdown on demand forms. Use for part-time or occasional salespeople not in the staff list.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {extraSalesRows.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", borderRadius: 6, background: "#f9fafb", border: "1px solid #e5e7eb" }}>
              <span style={{ flex: 1, fontSize: 13 }}>{r.value}</span>
              <button onClick={() => removeExtraSalesName(r.id)} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 5, border: "1px solid #fca5a5", background: "#fef2f2", color: "#991b1b", cursor: "pointer" }}>Remove</button>
            </div>
          ))}
          {!extraSalesRows.length && <div style={{ color: "#aaa", fontSize: 12 }}>No extra names added yet.</div>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={newSalesName} onChange={(e) => setNewSalesName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addExtraSalesName(); }}
            placeholder="Enter name (e.g. Nitin, Kavya…)"
            style={{ flex: 1, fontSize: 13, padding: "5px 10px", border: "1px solid #ddd", borderRadius: 6 }} />
          <button disabled={salesNameSaving || !newSalesName.trim()} onClick={addExtraSalesName}
            style={{ fontSize: 12, padding: "5px 14px", borderRadius: 6, border: "1px solid #6366f1", background: "#eef2ff", color: "#3730a3", cursor: "pointer" }}>
            {salesNameSaving ? "Adding…" : "Add"}
          </button>
        </div>
      </Card>

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
  bot_numbers: "🤖 Bot Numbers (auto-reply) — comma separated, no country code",
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
      const r = await fetch("/api/demand-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-crm-secret": CRM_SECRET },
        body: JSON.stringify({ action: "merge", primaryLeadId: pid, secondaryLeadId: sid }),
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
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  const load = useCallback(async () => {
    const { data } = await sb.from("bullion_tags").select("*").eq("tenant_id", getTenantId()).order("category").order("sort_order");
    setRows(data || []);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const add = () => setRows((r) => [...r, { _new: true, _dirty: true, tenant_id: getTenantId(), name: "", category: "custom", color: "#888", sort_order: (r.length + 1) * 10 }]);
  const update = (idx, k, v) => setRows((r) => r.map((row, i) => i === idx ? { ...row, [k]: v, _dirty: true } : row));
  const remove = async (idx) => {
    const row = rows[idx];
    if (row.id && !confirm(`Delete tag "${row.name}"? This will untag it from all leads.`)) return;
    if (row.id) await sb.from("bullion_tags").delete().eq("id", row.id);
    setRows((r) => r.filter((_, i) => i !== idx));
  };

  const onDragStart = (idx) => setDragIdx(idx);
  const onDragOver = (e, idx) => { e.preventDefault(); setOverIdx(idx); };
  const onDrop = (e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setOverIdx(null); return; }
    const next = [...rows];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(idx, 0, moved);
    // Reassign sort_order by position, mark all dirty
    setRows(next.map((r, i) => ({ ...r, sort_order: (i + 1) * 10, _dirty: true })));
    setDragIdx(null); setOverIdx(null);
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
        <div style={{ fontSize: 13, color: "#666" }}>Tags = flexible labels on leads. Drag ⠿ to reorder. Order shown here = order on contact form.</div>
        <div style={{ display: "flex", gap: 6 }}>
          <Btn ghost small color={C.gray} onClick={load}>↻</Btn>
          <Btn small color={C.blue} onClick={add}>+ Add</Btn>
        </div>
      </div>
      <Card style={{ padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#f7f7f7" }}>
            <th style={{ padding: 8, width: 28 }}></th>
            <th style={{ padding: 8, textAlign: "left", fontSize: 10, color: "#888" }}>NAME</th>
            <th style={{ padding: 8, textAlign: "left", fontSize: 10, color: "#888" }}>CATEGORY</th>
            <th style={{ padding: 8, textAlign: "left", fontSize: 10, color: "#888" }}>COLOR</th>
            <th style={{ padding: 8, textAlign: "center", width: 60 }}></th>
          </tr></thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.id || `new-${idx}`}
                draggable
                onDragStart={() => onDragStart(idx)}
                onDragOver={(e) => onDragOver(e, idx)}
                onDrop={(e) => onDrop(e, idx)}
                onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                style={{ borderTop: "1px solid #f5f5f5", background: overIdx === idx ? "#f0f7ff" : dragIdx === idx ? "#fffbeb" : "transparent", transition: "background 0.1s" }}>
                <td style={{ padding: "6px 4px", textAlign: "center", cursor: "grab", color: "#bbb", fontSize: 16, userSelect: "none" }}>⠿</td>
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
// LEAD SOURCES — webhook-based auto-import from portals
// IndiaMART, JustDial, 99acres, Facebook Lead Ads, etc.
// Each source gets a unique token → POST /api/inbound?token=XXX
// ──────────────────────────────────────────────────────────

const SOURCE_TYPES = [
  { k: "indiamart",   l: "IndiaMART",              defaultMap: { SENDER_MOBILE: "phone", SENDER_NAME: "name", SENDER_EMAIL: "email", SENDER_CITY: "city" } },
  { k: "justdial",    l: "JustDial",                defaultMap: { phone: "phone", name: "name", city: "city", email: "email" } },
  { k: "99acres",     l: "99acres",                 defaultMap: { mobile: "phone", name: "name", city: "city", email: "email" } },
  { k: "housing",     l: "Housing.com",             defaultMap: { mobile: "phone", name: "name", city: "city", email: "email" } },
  { k: "sulekha",     l: "Sulekha",                 defaultMap: { mobile: "phone", name: "name", city: "city", email: "email" } },
  { k: "magicbricks", l: "MagicBricks",             defaultMap: { mobile: "phone", name: "name", city: "city", email: "email" } },
  { k: "facebook",    l: "Facebook Lead Ads",       defaultMap: {} },
  { k: "instagram",   l: "Instagram Lead Ads",      defaultMap: {} },
  { k: "googleads",   l: "Google Ads Lead Form",    defaultMap: {} },
  { k: "generic",     l: "Generic / Zapier / Make", defaultMap: {} },
];

const OUR_LEAD_FIELDS = ["phone", "name", "email", "city", "bday", "anniversary", "source", "notes"];

const INBOUND_BASE = "https://ssjbot.gemtre.in/api/lead";

function genToken() {
  return (crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "")).slice(0, 32);
}

function LeadSourcesScreen({ funnels }) {
  const [sources, setSources] = useState([]);
  const [editing, setEditing] = useState(null); // null=closed, {}=new, obj=edit

  const load = useCallback(async () => {
    const { data } = await sb.from("bullion_lead_sources").select("*").eq("tenant_id", getTenantId()).order("created_at", { ascending: false });
    setSources(data || []);
  }, []);

  useEffect(() => { load(); }, [load]); // eslint-disable-line

  const toggleActive = async (src) => {
    await sb.from("bullion_lead_sources").update({ active: !src.active, updated_at: new Date().toISOString() }).eq("id", src.id);
    load();
  };

  const del = async (src) => {
    if (!confirm(`Delete "${src.name}"? This will break any active webhook pointing to it.`)) return;
    await sb.from("bullion_lead_sources").delete().eq("id", src.id);
    load();
  };

  const typeLabel = (k) => SOURCE_TYPES.find((t) => t.k === k)?.l || k;
  const typeBadgeColor = (k) => ({
    facebook: "#1877f2", indiamart: "#e37222", justdial: "#ff6600",
    "99acres": "#c00", housing: "#f57c00", sulekha: "#009933",
    magicbricks: "#e52d27", generic: "#6b7280",
  }[k] || "#6b7280");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "#666" }}>Auto-import leads from portals via webhook. Each source gets a unique URL to paste into the portal&apos;s webhook settings.</div>
        <Btn small color={C.blue} onClick={() => setEditing({})}>+ Add Source</Btn>
      </div>

      {sources.length === 0 && (
        <Card style={{ padding: 32, textAlign: "center", color: "#aaa", fontSize: 14 }}>
          No lead sources configured yet. Add one to start auto-importing leads.
        </Card>
      )}

      {sources.map((src) => {
        const webhookUrl = `${INBOUND_BASE}?token=${src.webhook_token}`;
        return (
          <Card key={src.id} style={{ marginBottom: 10, padding: "12px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{src.name}</span>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: typeBadgeColor(src.source_type), color: "#fff" }}>{typeLabel(src.source_type)}</span>
                  {!src.active && <span style={{ fontSize: 11, color: "#999", border: "1px solid #ddd", borderRadius: 10, padding: "1px 7px" }}>inactive</span>}
                </div>
                <div style={{ fontSize: 12, color: "#555", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <code style={{ background: "#f3f4f6", padding: "2px 6px", borderRadius: 4, fontSize: 11, wordBreak: "break-all" }}>{webhookUrl}</code>
                  <button onClick={() => { navigator.clipboard?.writeText(webhookUrl); }} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 5, border: "1px solid #ddd", background: "transparent", cursor: "pointer" }}>Copy</button>
                </div>
                {src.default_funnel_id && (
                  <div style={{ fontSize: 11, color: "#888", marginTop: 3 }}>
                    Funnel: {funnels.find((f) => f.id === src.default_funnel_id)?.name || src.default_funnel_id}
                    {src.enroll_drip ? " · auto-enroll ✓" : ""}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <Btn ghost small color={src.active ? C.green : C.gray} onClick={() => toggleActive(src)}>{src.active ? "Active" : "Off"}</Btn>
                <Btn ghost small color={C.blue} onClick={() => setEditing(src)}>Edit</Btn>
                <Btn ghost small color={C.red} onClick={() => del(src)}>✕</Btn>
              </div>
            </div>
          </Card>
        );
      })}

      {editing !== null && (
        <LeadSourceModal
          source={editing?.id ? editing : null}
          funnels={funnels}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function LeadSourceModal({ source, funnels, onClose, onSaved }) {
  const isNew = !source?.id;
  const initialToken = source?.webhook_token || genToken();
  const initialType = source?.source_type || "generic";
  const getDefaultMap = (type) => SOURCE_TYPES.find((t) => t.k === type)?.defaultMap || {};

  const [form, setForm] = useState({
    name: source?.name || "",
    source_type: initialType,
    default_funnel_id: source?.default_funnel_id || "",
    enroll_drip: source?.enroll_drip ?? true,
    active: source?.active ?? true,
    webhook_token: initialToken,
    field_map: source?.field_map && Object.keys(source.field_map).length ? source.field_map : getDefaultMap(initialType),
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(!isNew);
  const [err, setErr] = useState("");

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onTypeChange = (type) => {
    setForm((f) => ({ ...f, source_type: type, field_map: getDefaultMap(type) }));
  };

  // Field map editing (array of [theirKey, ourKey] pairs)
  const mapRows = Object.entries(form.field_map);
  const setMapRow = (i, theirKey, ourKey) => {
    const rows = [...mapRows];
    rows[i] = [theirKey, ourKey];
    set("field_map", Object.fromEntries(rows.filter(([k]) => k.trim())));
  };
  const addMapRow = () => {
    const rows = [...mapRows, ["", "phone"]];
    set("field_map", Object.fromEntries(rows.filter(([k]) => k.trim())));
  };
  const removeMapRow = (i) => {
    const rows = mapRows.filter((_, idx) => idx !== i);
    set("field_map", Object.fromEntries(rows.filter(([k]) => k.trim())));
  };

  const save = async () => {
    if (!form.name.trim()) { setErr("Name is required"); return; }
    if (!form.source_type) { setErr("Source type is required"); return; }
    setSaving(true); setErr("");
    const payload = {
      tenant_id: getTenantId(),
      name: form.name.trim(),
      source_type: form.source_type,
      webhook_token: form.webhook_token,
      field_map: form.field_map,
      default_funnel_id: form.default_funnel_id || null,
      enroll_drip: form.enroll_drip,
      active: form.active,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (isNew) {
      ({ error } = await sb.from("bullion_lead_sources").insert(payload));
    } else {
      ({ error } = await sb.from("bullion_lead_sources").update(payload).eq("id", source.id));
    }
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setSaved(true);
    onSaved();
  };

  const webhookUrl = `${INBOUND_BASE}?token=${form.webhook_token}`;
  const noFieldMap = ["facebook", "instagram", "googleads"].includes(form.source_type);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 24, width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{isNew ? "Add Lead Source" : "Edit Lead Source"}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#888" }}>✕</button>
        </div>

        <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>Source Name</label>
        <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. IndiaMART Portal, FB Jewellery Ads" style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, marginBottom: 12, boxSizing: "border-box" }} />

        <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>Source Type</label>
        <select value={form.source_type} onChange={(e) => onTypeChange(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, marginBottom: 12 }}>
          {SOURCE_TYPES.map((t) => <option key={t.k} value={t.k}>{t.l}</option>)}
        </select>

        <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>Default Funnel (optional)</label>
        <select value={form.default_funnel_id} onChange={(e) => set("default_funnel_id", e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, marginBottom: 8 }}>
          <option value="">— No funnel —</option>
          {funnels.filter((f) => f.active).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>

        {form.default_funnel_id && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={form.enroll_drip} onChange={(e) => set("enroll_drip", e.target.checked)} />
            Auto-enroll lead in funnel drip
          </label>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 16, cursor: "pointer" }}>
          <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
          Active (accept webhook calls)
        </label>

        {!noFieldMap && (
          <>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Field Mapping <span style={{ color: "#aaa" }}>(portal field → our field)</span></div>
            <div style={{ border: "1px solid #eee", borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
              {mapRows.map(([theirKey, ourKey], i) => (
                <div key={i} style={{ display: "flex", gap: 6, padding: "6px 8px", borderBottom: i < mapRows.length - 1 ? "1px solid #f5f5f5" : "none", alignItems: "center" }}>
                  <input value={theirKey} onChange={(e) => setMapRow(i, e.target.value, ourKey)} placeholder="their field name" style={{ flex: 1, padding: "4px 8px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12 }} />
                  <span style={{ color: "#aaa", fontSize: 12 }}>→</span>
                  <select value={ourKey} onChange={(e) => setMapRow(i, theirKey, e.target.value)} style={{ flex: 1, padding: "4px 8px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12 }}>
                    {OUR_LEAD_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <button onClick={() => removeMapRow(i)} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 14, padding: "0 4px" }}>✕</button>
                </div>
              ))}
              <div style={{ padding: "6px 8px" }}>
                <button onClick={addMapRow} style={{ fontSize: 12, color: C.blue, background: "none", border: "none", cursor: "pointer" }}>+ Add row</button>
              </div>
            </div>
          </>
        )}

        {err && <p style={{ color: "#dc2626", fontSize: 12, margin: "0 0 10px" }}>{err}</p>}

        <Btn color={C.blue} onClick={save} disabled={saving} style={{ width: "100%" }}>{saving ? "Saving…" : isNew ? "Create Source" : "Save Changes"}</Btn>

        {saved && (
          <div style={{ marginTop: 16 }}>
            {/* Webhook URL */}
            <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: 14, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#166534", marginBottom: 6 }}>Webhook URL</div>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                <code style={{ flex: 1, fontSize: 11, wordBreak: "break-all", background: "#dcfce7", padding: "6px 8px", borderRadius: 6, color: "#166534", display: "block" }}>{webhookUrl}</code>
                <button onClick={() => navigator.clipboard?.writeText(webhookUrl)} style={{ flexShrink: 0, padding: "6px 12px", borderRadius: 7, border: "1px solid #86efac", background: "#fff", fontSize: 12, cursor: "pointer", color: "#166534" }}>Copy</button>
              </div>
              {(form.source_type === "facebook" || form.source_type === "instagram") && (
                <div style={{ fontSize: 11, color: "#166534", marginTop: 8 }}>
                  <strong>Meta Developer Portal</strong> → Your App → Webhooks → Subscribe to <em>leadgen</em> field on your Page.<br />
                  Set <strong>Callback URL</strong> to the above and <strong>Verify Token</strong> to <code style={{ background: "#bbf7d0", padding: "1px 4px", borderRadius: 3 }}>{form.webhook_token}</code>.<br />
                  Instagram Lead Ads use the same Meta webhook — one setup covers both.
                </div>
              )}
              {form.source_type === "googleads" && (
                <div style={{ fontSize: 11, color: "#166534", marginTop: 8 }}>
                  <strong>Google Ads</strong> → Assets → Lead forms → select form → <em>Webhook delivery</em> → paste URL above. No GET verification needed.
                </div>
              )}
              {!["facebook","instagram","googleads"].includes(form.source_type) && (
                <div style={{ fontSize: 11, color: "#166534", marginTop: 6 }}>
                  Paste into {SOURCE_TYPES.find((t) => t.k === form.source_type)?.l || "the portal"}&apos;s webhook settings.
                </div>
              )}
            </div>

            {/* Embed snippet */}
            {(() => {
              const embedSnippet = `<script src="https://ssjbot.gemtre.in/embed.js?token=${form.webhook_token}&label=Enquire+Now" defer></script>`;
              return (
                <div style={{ background: "#eff6ff", border: "1px solid #93c5fd", borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#1e40af", marginBottom: 4 }}>Embed on any website</div>
                  <div style={{ fontSize: 11, color: "#1e40af", marginBottom: 8 }}>Paste this one tag into Wix / WordPress / Shopify — adds a floating enquiry button.</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <code style={{ flex: 1, fontSize: 10, wordBreak: "break-all", background: "#dbeafe", padding: "6px 8px", borderRadius: 6, color: "#1e3a8a", display: "block" }}>{embedSnippet}</code>
                    <button onClick={() => navigator.clipboard?.writeText(embedSnippet)} style={{ flexShrink: 0, padding: "6px 12px", borderRadius: 7, border: "1px solid #93c5fd", background: "#fff", fontSize: 12, cursor: "pointer", color: "#1e40af" }}>Copy</button>
                  </div>
                  <div style={{ fontSize: 10, color: "#3b82f6", marginTop: 6 }}>Tip: change <code>label=</code> to customise the button text, e.g. <code>label=Book+Appointment</code></div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// FORM BUILDER — configure fields for CRM / HR forms
// ──────────────────────────────────────────────────────────

const SSJ_FORM_DEFS = [
  {
    id: "walkin",
    label: "Walk-in / New Demand",
    icon: "🏪",
    desc: "Fields on the New Demand form (walk-in and phone enquiries).",
    defaultSpec: {
      tabs: [{k:"basic",l:"Basic Info"},{k:"jewelry",l:"Jewellery"},{k:"exchange",l:"Exchange"}],
      required: ["phone","description"],
      fields: {
        basic: [
          ["Phone *","phone","tel",null,true],
          ["Name","name","text",null,true],
          ["Requirement *","description","textarea",null,true],
          ["Product Category","productCategory","select",["gold","silver","diamond","polki","kundan","gemstone","solitaire","lab_diamond","other"],true],
          ["Product Types (multi)","productTypes","multiselect",["Chain","Earrings","Danglers","Nosepin","Necklace set","Pendant","P Set","Bangles","Bracelets","Gents Jew","Engagement ring","Solitaires","Wedding Accessories","Gemstones","Others"],true],
          ["Occasion","occasion","select",["wedding","anniversary","birthday","Diwali gifting","corporate gift","self purchase","other"],true],
          ["Occasion Date","occasionDate","date",null,true],
          ["For Whom","forWhom","select",["self","daughter","son","wife","husband","mother","father","sister","brother","other"],true],
          ["Estimate (₹)","estimate","number",null,true],
          ["Visit Date/Time","visitScheduledAt","datetime",null,true],
          ["Attended by","assignedStaffId","select",null,true],
          ["CRM Source","crmSource","select",["walkin","referral","old_client","online_google","online_instagram","online_other","exhibition","broadcast","other"],true],
          ["Design Notes","designNotes","textarea",null,true],
        ],
        jewelry: [
          ["Metal","metal","select",["gold_22k","gold_18k","gold_14k","white_gold","platinum","silver","other"],true],
          ["Stone","stone","select",["none","diamond","ruby","emerald","sapphire","pearl","kundan","polki","other"],true],
          ["Item Category","itemCategory","select",["ring","necklace","earrings","bangles","bracelet","pendant","set","anklet","other"],true],
          ["Purity","purity","select",["916 (22k)","750 (18k)","585 (14k)","925 (Silver)","999 (Fine)","other"],true],
          ["Hallmark Pref","hallmarkPref","select",["bis_hallmark","none","client_choice"],true],
          ["Ring Size","ringSize","text",null,true],
        ],
        exchange: [
          ["Has Exchange Item","hasExchange","checkbox",null,true],
          ["Exchange Description","exchangeDesc","textarea",null,true],
          ["Exchange Value (₹)","exchangeValue","number",null,true],
        ]
      }
    }
  },
  {
    id: "lead_entry",
    label: "Lead / Contact Entry",
    icon: "👤",
    desc: "Fields on the manual lead entry and contact edit forms.",
    defaultSpec: {
      tabs: [{k:"basic",l:"Basic Info"},{k:"extra",l:"Extra Fields"}],
      required: ["phone"],
      fields: {
        basic: [
          ["Phone *","phone","tel",null,true],
          ["Name","name","text",null,true],
          ["Phone 2","mobile2","tel",null,true],
          ["City","city","text",null,true],
          ["Email","email","email",null,true],
          ["Birthday","bday","date",null,true],
          ["Anniversary","anniversary","date",null,true],
          ["Source","source","text",null,true],
          ["Tags","tags","text",null,true],
        ],
        extra: []
      }
    }
  },
  {
    id: "lead_import",
    label: "Lead CSV / Excel Import",
    icon: "📥",
    desc: "Column mappings and extra fields for the bulk CSV/Excel import flow.",
    defaultSpec: {
      tabs: [{k:"columns",l:"Column Names"},{k:"extra",l:"Extra Fields"}],
      required: ["phone"],
      fields: {
        columns: [
          ["Phone column","phone","text",null,true],
          ["Name column","name","text",null,true],
          ["City column","city","text",null,true],
          ["Email column","email","text",null,true],
          ["Birthday column","bday","text",null,true],
          ["Anniversary column","anniversary","text",null,true],
          ["Source column","source","text",null,true],
          ["Tags column","tags","text",null,true],
        ],
        extra: []
      }
    }
  }
];

const SSJ_FIELD_TYPES = [
  ["text","Text"],["tel","Phone"],["email","Email"],["number","Number"],
  ["currency","Currency (₹)"],["date","Date"],["datetime","Date + Time"],["textarea","Long Text"],
  ["checkbox","Checkbox"],["select","Dropdown"],["multiselect","Multi-Select"],
];

function SsjFormFieldEditor({ spec, onChange, onReset }) {
  const tabs = spec?.tabs || [];
  const fields = spec?.fields || {};
  const required = spec?.required || [];

  const update = (updater) => onChange(updater(JSON.parse(JSON.stringify(spec || {tabs:[],fields:{},required:[]}))));

  const addTab = () => {
    const k = prompt("Tab key (e.g. 'shipping')");
    if (!k?.trim()) return;
    const l = prompt("Tab label", k) || k;
    update(s => {
      if ((s.tabs||[]).some(t => t.k === k.trim())) return s;
      s.tabs = [...(s.tabs||[]), {k:k.trim(),l}];
      s.fields = {...(s.fields||{}), [k.trim()]:[]};
      return s;
    });
  };
  const renameTab = (k,nl) => update(s => { s.tabs=s.tabs.map(t=>t.k===k?{...t,l:nl}:t); return s; });
  const deleteTab = (k) => {
    if (!confirm(`Delete tab "${k}" and all its fields?`)) return;
    update(s => { s.tabs=s.tabs.filter(t=>t.k!==k); const nf={...s.fields}; delete nf[k]; s.fields=nf; return s; });
  };
  const moveTab = (idx,d) => update(s => {
    const a=[...s.tabs]; if(idx+d<0||idx+d>=a.length) return s;
    [a[idx],a[idx+d]]=[a[idx+d],a[idx]]; s.tabs=a; return s;
  });
  const addField = (tabK) => update(s => {
    const arr=[...(s.fields[tabK]||[])];
    arr.push(["New field","field_"+Date.now().toString(36),"text",null,false]);
    s.fields={...s.fields,[tabK]:arr}; return s;
  });
  const updateField = (tabK,idx,patch) => update(s => {
    const arr=[...(s.fields[tabK]||[])];
    const cur=arr[idx]||["","","text",null,false];
    arr[idx]=[
      patch.label!==undefined?patch.label:cur[0],
      patch.key!==undefined?patch.key:cur[1],
      patch.type!==undefined?patch.type:cur[2],
      patch.optsKey!==undefined?patch.optsKey:cur[3],
      cur[4],
    ];
    s.fields={...s.fields,[tabK]:arr}; return s;
  });
  const deleteField = (tabK,idx) => update(s => {
    const arr=[...(s.fields[tabK]||[])];
    const[,key]=arr[idx]||[];
    arr.splice(idx,1);
    s.fields={...s.fields,[tabK]:arr};
    if(key) s.required=(s.required||[]).filter(r=>r!==key);
    return s;
  });
  const moveField = (tabK,idx,d) => update(s => {
    const arr=[...(s.fields[tabK]||[])];
    if(idx+d<0||idx+d>=arr.length) return s;
    [arr[idx],arr[idx+d]]=[arr[idx+d],arr[idx]];
    s.fields={...s.fields,[tabK]:arr}; return s;
  });
  const toggleRequired = (key,on) => update(s => {
    const r=new Set(s.required||[]);
    if(on) r.add(key); else r.delete(key);
    s.required=[...r]; return s;
  });
  const setOpts = (tabK,idx,opts) => update(s => {
    const arr=[...(s.fields[tabK]||[])];
    if(arr[idx]) arr[idx]=[arr[idx][0],arr[idx][1],arr[idx][2],opts.length?opts:null,arr[idx][4]];
    s.fields={...s.fields,[tabK]:arr}; return s;
  });

  return (
    <div style={{background:"#f8f9fa",borderRadius:10,padding:14}}>
      <p style={{fontSize:12,color:"#888",margin:"0 0 10px"}}>⚙ = system field (maps to a DB column, key/type locked). Custom fields you add will appear in the form as extra inputs.</p>
      {tabs.map((t,ti) => {
        const arr=fields[t.k]||[];
        return (
          <div key={t.k} style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:10,marginBottom:10,padding:"10px 12px"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
              <span style={{fontSize:11,color:"#888",fontWeight:500}}>TAB:</span>
              <input value={t.l} onChange={e=>renameTab(t.k,e.target.value)} style={{fontSize:13,fontWeight:500,padding:"3px 8px",borderRadius:6,border:"1px solid #e5e7eb",flex:1,minWidth:120}}/>
              <span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:"#f3f4f6",color:"#888",fontFamily:"monospace"}}>{t.k}</span>
              <button onClick={()=>moveTab(ti,-1)} disabled={ti===0} style={{border:"none",background:"none",cursor:ti===0?"default":"pointer",color:ti===0?"#ddd":"#555",fontSize:14}}>↑</button>
              <button onClick={()=>moveTab(ti,1)} disabled={ti===tabs.length-1} style={{border:"none",background:"none",cursor:ti===tabs.length-1?"default":"pointer",color:ti===tabs.length-1?"#ddd":"#555",fontSize:14}}>↓</button>
              <button onClick={()=>deleteTab(t.k)} style={{border:"none",background:"none",cursor:"pointer",color:C.red,fontSize:12,padding:"2px 6px"}}>Delete tab</button>
            </div>
            {arr.length===0&&<p style={{fontSize:12,color:"#aaa",margin:"4px 0 8px",textAlign:"center",fontStyle:"italic"}}>No fields yet.</p>}
            {arr.map((f,fi) => {
              const[lbl,key,ftype,optsKey,isFixed]=f;
              const req=required.includes(key);
              const hasOpts=["select","multiselect"].includes(ftype);
              return (
                <div key={fi} style={{padding:"8px 0",borderTop:fi>0?"1px dashed #f0f0f0":"none"}}>
                  <div style={{display:"grid",gridTemplateColumns:"2fr 1.5fr 1fr auto",gap:6,alignItems:"center"}}>
                    <div style={{display:"flex",alignItems:"center",gap:4}}>
                      {isFixed&&<span title="System field — key is locked" style={{fontSize:10,color:"#aaa",flexShrink:0}}>⚙</span>}
                      <input value={lbl} onChange={e=>updateField(t.k,fi,{label:e.target.value})} placeholder="Label" style={{flex:1,fontSize:12,padding:"4px 6px",borderRadius:5,border:"1px solid #e5e7eb"}}/>
                    </div>
                    <input value={key} onChange={e=>!isFixed&&updateField(t.k,fi,{key:e.target.value})} placeholder="field_key" readOnly={isFixed} style={{fontSize:12,padding:"4px 6px",borderRadius:5,border:"1px solid #e5e7eb",fontFamily:"monospace",opacity:isFixed?0.5:1,background:isFixed?"#f3f4f6":"#fff"}}/>
                    <select value={ftype||"text"} onChange={e=>updateField(t.k,fi,{type:e.target.value})} style={{fontSize:12,padding:"3px 6px",borderRadius:5}}>
                      {SSJ_FIELD_TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                    </select>
                    <div style={{display:"flex",gap:2,alignItems:"center"}}>
                      <label title="Required" style={{display:"flex",alignItems:"center",gap:2,fontSize:11,color:req?C.red:"#aaa",cursor:"pointer",padding:"2px 4px",borderRadius:4,background:req?"#c0392b11":"transparent"}}>
                        <input type="checkbox" checked={req} onChange={e=>toggleRequired(key,e.target.checked)} style={{width:12,height:12}}/>req
                      </label>
                      <button onClick={()=>moveField(t.k,fi,-1)} disabled={fi===0} style={{border:"none",background:"none",cursor:fi===0?"default":"pointer",color:fi===0?"#ddd":"#555",fontSize:13,padding:"0 2px"}}>↑</button>
                      <button onClick={()=>moveField(t.k,fi,1)} disabled={fi===arr.length-1} style={{border:"none",background:"none",cursor:fi===arr.length-1?"default":"pointer",color:fi===arr.length-1?"#ddd":"#555",fontSize:13,padding:"0 2px"}}>↓</button>
                      {!isFixed&&<button onClick={()=>deleteField(t.k,fi)} style={{border:"none",background:"none",cursor:"pointer",color:C.red,fontSize:13,padding:"0 2px"}}>✕</button>}
                    </div>
                  </div>
                  {hasOpts&&(
                    <div style={{background:"#f8fafc",border:"1px solid #e5e7eb",borderRadius:7,padding:"8px 10px",marginTop:4}}>
                      <div style={{fontSize:10,color:"#888",fontWeight:500,marginBottom:6}}>OPTIONS</div>
                      {(Array.isArray(optsKey)?optsKey:[]).map((opt,oi)=>{
                        const optArr=Array.isArray(optsKey)?optsKey:[];
                        return (
                          <div key={oi} style={{display:"flex",gap:4,marginBottom:4,alignItems:"center"}}>
                            <input value={opt} onChange={e=>{const n=[...optArr];n[oi]=e.target.value;setOpts(t.k,fi,n);}} placeholder={`Option ${oi+1}`} style={{flex:1,fontSize:12,padding:"4px 6px",borderRadius:5,border:"1px solid #e5e7eb"}}/>
                            <button onClick={()=>{if(oi===0)return;const n=[...optArr];[n[oi],n[oi-1]]=[n[oi-1],n[oi]];setOpts(t.k,fi,n);}} disabled={oi===0} style={{border:"none",background:"none",cursor:oi===0?"default":"pointer",color:oi===0?"#ddd":"#555",fontSize:13,padding:"0 2px"}}>↑</button>
                            <button onClick={()=>{if(oi>=optArr.length-1)return;const n=[...optArr];[n[oi],n[oi+1]]=[n[oi+1],n[oi]];setOpts(t.k,fi,n);}} disabled={oi>=optArr.length-1} style={{border:"none",background:"none",cursor:oi>=optArr.length-1?"default":"pointer",color:oi>=optArr.length-1?"#ddd":"#555",fontSize:13,padding:"0 2px"}}>↓</button>
                            <button onClick={()=>{const n=optArr.filter((_,i)=>i!==oi);setOpts(t.k,fi,n);}} style={{border:"none",background:"none",cursor:"pointer",color:C.red,fontSize:13}}>✕</button>
                          </div>
                        );
                      })}
                      <button onClick={()=>{const n=[...(Array.isArray(optsKey)?optsKey:[]),""];setOpts(t.k,fi,n);}} style={{fontSize:11,padding:"3px 10px",borderRadius:5,border:"1px dashed #e5e7eb",background:"transparent",color:"#888",cursor:"pointer"}}>+ Add option</button>
                    </div>
                  )}
                </div>
              );
            })}
            <button onClick={()=>addField(t.k)} style={{fontSize:12,padding:"4px 12px",borderRadius:7,border:"1px dashed #e5e7eb",background:"transparent",color:"#888",cursor:"pointer",marginTop:6}}>+ Add custom field to "{t.l}"</button>
          </div>
        );
      })}
      <div style={{display:"flex",gap:8,marginTop:8}}>
        <button onClick={addTab} style={{fontSize:12,padding:"5px 14px",borderRadius:8,border:"1px dashed #e5e7eb",background:"transparent",color:"#888",cursor:"pointer"}}>+ Add tab</button>
        <button onClick={onReset} style={{fontSize:12,padding:"5px 14px",borderRadius:8,border:`1px solid ${C.orange}`,background:"transparent",color:C.orange,cursor:"pointer"}}>Reset to defaults</button>
      </div>
    </div>
  );
}

function FormBuilderScreen() {
  const [selected, setSelected] = useState(SSJ_FORM_DEFS[0]?.id || "");
  const [specs, setSpecs] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const tid = getTenantId();
    sb.from("bullion_dropdowns")
      .select("field,value")
      .eq("tenant_id", tid)
      .like("field", "form_spec_%")
      .then(({ data }) => {
        const loaded = {};
        (data||[]).forEach(r => {
          try { loaded[r.field.replace("form_spec_","")] = JSON.parse(r.value); } catch {}
        });
        setSpecs(loaded);
        setLoading(false);
      });
  }, []);

  const currentDef = SSJ_FORM_DEFS.find(d => d.id === selected);
  const currentSpec = specs[selected] || currentDef?.defaultSpec;

  const handleChange = (next) => setSpecs(s => ({...s,[selected]:next}));

  const handleReset = () => {
    if (!confirm(`Reset "${currentDef?.label}" to defaults? Custom changes will be discarded.`)) return;
    setSpecs(s => { const n={...s}; delete n[selected]; return n; });
  };

  const handleSave = async () => {
    setSaving(true); setSaved(false);
    const tid = getTenantId();
    const field = `form_spec_${selected}`;
    const value = JSON.stringify(specs[selected] || currentDef?.defaultSpec || {});
    const { data: existing } = await sb.from("bullion_dropdowns")
      .select("id").eq("tenant_id", tid).eq("field", field).maybeSingle();
    if (existing?.id) {
      await sb.from("bullion_dropdowns").update({ value, active: true }).eq("id", existing.id);
    } else {
      await sb.from("bullion_dropdowns").insert({ tenant_id: tid, field, value, active: true, sort_order: 0 });
    }
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (loading) return <div style={{padding:30,textAlign:"center",color:"#888"}}>Loading…</div>;

  return (
    <div style={{display:"grid",gridTemplateColumns:"220px 1fr",gap:0,minHeight:"60vh",border:"1px solid #e5e7eb",borderRadius:12,overflow:"hidden"}}>
      <div style={{borderRight:"1px solid #e5e7eb",background:"#f9fafb"}}>
        <div style={{padding:"10px 12px",borderBottom:"1px solid #f0f0f0"}}>
          <p style={{fontSize:13,fontWeight:600,margin:0}}>Form Templates</p>
          <p style={{fontSize:11,color:"#888",margin:"2px 0 0"}}>Select a form to configure</p>
        </div>
        {SSJ_FORM_DEFS.map(def => (
          <button key={def.id} onClick={()=>setSelected(def.id)} style={{width:"100%",textAlign:"left",padding:"10px 12px",border:"none",borderBottom:"1px solid #f0f0f0",background:selected===def.id?"#fff":"transparent",cursor:"pointer",borderLeft:`3px solid ${selected===def.id?C.blue:"transparent"}`}}>
            <div style={{fontSize:16}}>{def.icon}</div>
            <div style={{fontSize:13,fontWeight:selected===def.id?600:400,marginTop:2}}>{def.label}</div>
            {specs[def.id]&&<div style={{fontSize:10,color:C.purple,marginTop:1}}>● customised</div>}
          </button>
        ))}
      </div>
      {currentDef ? (
        <div style={{padding:16,overflowY:"auto"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
            <div>
              <h3 style={{margin:0,fontSize:15,fontWeight:600}}>{currentDef.icon} {currentDef.label}</h3>
              <p style={{margin:"3px 0 0",fontSize:12,color:"#888"}}>{currentDef.desc}</p>
              {!specs[selected]&&<p style={{margin:"4px 0 0",fontSize:11,color:C.orange}}>Showing defaults — add custom fields or edit to create a custom version.</p>}
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
              {saved&&<span style={{fontSize:12,color:C.green}}>✓ Saved</span>}
              <button onClick={handleSave} disabled={saving} style={{padding:"7px 18px",borderRadius:8,border:"none",background:saving?"#aaa":C.blue,color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer"}}>{saving?"Saving…":"Save changes"}</button>
            </div>
          </div>
          <SsjFormFieldEditor spec={currentSpec||currentDef.defaultSpec} onChange={handleChange} onReset={handleReset}/>
          <p style={{fontSize:11,color:"#aaa",marginTop:10}}>Hit "Save changes" to persist. Custom fields (non-⚙) added here will appear as extra inputs in the corresponding form.</p>
        </div>
      ) : (
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",color:"#aaa",fontSize:13}}>Select a form on the left.</div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// SHARED: App store links + referral section (used by profile forms)
// ──────────────────────────────────────────────────────────

const APP_ANDROID_URL = "https://ssjbot.gemtre.in/app";
const APP_IOS_URL     = "https://ssjbot.gemtre.in/ios";

function AppDownloadLinks() {
  const S = { fontFamily: "system-ui, sans-serif" };
  return (
    <div style={{ ...S, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: 16, marginTop: 20, textAlign: "center" }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>🥇</div>
      <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 4px", color: "#14532d" }}>Download Sun Sea Jewellers App</p>
      <p style={{ fontSize: 12, color: "#166534", margin: "0 0 12px" }}>Track your gold, access exclusive offers, and claim your birthday gift!</p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        <a href={APP_ANDROID_URL} target="_blank" rel="noreferrer"
          style={{ display: "inline-block", padding: "8px 18px", background: "#16a34a", color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
          📱 Android
        </a>
        <a href={APP_IOS_URL} target="_blank" rel="noreferrer"
          style={{ display: "inline-block", padding: "8px 18px", background: "#1d4ed8", color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
          🍎 iOS
        </a>
      </div>
    </div>
  );
}

function ReferralSection({ leadId, leadName, token, phone }) {
  const S = { fontFamily: "system-ui, sans-serif" };
  const input = { width: "100%", fontSize: 14, padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8, boxSizing: "border-box", outline: "none" };
  const label = { fontSize: 12, color: "#666", display: "block", marginBottom: 4, marginTop: 10 };
  const [refs, setRefs] = useState([{ phone: "", name: "" }]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  const addRef = () => setRefs((r) => [...r, { phone: "", name: "" }]);
  const setRef = (i, k, v) => setRefs((r) => r.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
  const removeRef = (i) => setRefs((r) => r.filter((_, idx) => idx !== i));

  const send = async () => {
    const valid = refs.filter((r) => r.phone.replace(/\D/g, "").length >= 10);
    if (!valid.length) { setErr("Enter at least one valid phone number."); return; }
    setSending(true); setErr("");
    try {
      const url = token ? `/api/contact-update?t=${token}` : "/api/contact-update";
      const body = token ? { referrals: valid } : { phone, referrals: valid };
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.ok) { setSent(true); }
      else { setErr("Failed to send. Please try again."); }
    } catch { setErr("Network error. Please try again."); }
    setSending(false);
  };

  if (sent) return (
    <div style={{ ...S, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: 16, marginTop: 20, textAlign: "center" }}>
      <div style={{ fontSize: 28 }}>🎁</div>
      <p style={{ fontSize: 14, fontWeight: 600, color: "#78350f", margin: "8px 0 4px" }}>Gift messages sent!</p>
      <p style={{ fontSize: 12, color: "#92400e", margin: 0 }}>Your friends will receive a WhatsApp message with their 50mg gold gift from you.</p>
    </div>
  );

  return (
    <div style={{ ...S, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: 16, marginTop: 20 }}>
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 24 }}>🎁</div>
        <p style={{ fontSize: 14, fontWeight: 600, color: "#78350f", margin: "6px 0 2px" }}>Gift a Friend 50mg Free Gold</p>
        <p style={{ fontSize: 12, color: "#92400e", margin: 0 }}>Enter their number — we'll WhatsApp them your gift. You get 50mg gold for every friend who joins! 🥇</p>
      </div>
      {refs.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-end", marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <span style={label}>Friend's Mobile</span>
            <input style={input} value={r.phone} onChange={(e) => setRef(i, "phone", e.target.value)} placeholder="9810XXXXXX" type="tel" />
          </div>
          <div style={{ flex: 1 }}>
            <span style={label}>Friend's Name (optional)</span>
            <input style={input} value={r.name} onChange={(e) => setRef(i, "name", e.target.value)} placeholder="Rahul" />
          </div>
          {refs.length > 1 && <button onClick={() => removeRef(i)} style={{ fontSize: 18, color: "#dc2626", border: "none", background: "none", cursor: "pointer", paddingBottom: 8 }}>×</button>}
        </div>
      ))}
      <button onClick={addRef} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 8, border: "1px solid #d97706", background: "#fff", color: "#92400e", cursor: "pointer", marginBottom: 12 }}>+ Add another friend</button>
      {err && <p style={{ color: "#dc2626", fontSize: 12, margin: "0 0 8px" }}>{err}</p>}
      <button onClick={send} disabled={sending} style={{ width: "100%", padding: "10px", fontSize: 14, fontWeight: 600, border: "none", borderRadius: 10, background: "#d97706", color: "#fff", cursor: sending ? "not-allowed" : "pointer" }}>
        {sending ? "Sending gifts…" : "🎁 Send Gold Gift to Friends"}
      </button>
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
  const [refs, setRefs] = useState([{ phone: "", name: "" }]);
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
        setForm({ name: d.lead.name || "", email: d.lead.email || "", city: d.lead.city || "", address_house: d.lead.address_house || "", address_locality: d.lead.address_locality || "", address_state: d.lead.address_state || "", address_pincode: d.lead.address_pincode || "", address_country: d.lead.address_country || "India", bday: d.lead.bday || "", anniversary: d.lead.anniversary || "" });
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
    const validRefs = refs.filter((r) => r.phone.replace(/\D/g, "").length >= 10);
    const r = await fetch(`/api/contact-update?t=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, family, deletedFamilyIds: deletedIds, referrals: validRefs }),
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
    <div style={S}>
      <div style={{ textAlign: "center", paddingTop: 40 }}>
        <div style={{ fontSize: 48 }}>🙏</div>
        <h2 style={{ fontSize: 20, margin: "16px 0 8px" }}>Thank you, {lead?.name?.split(" ")[0] || ""}!</h2>
        <p style={{ color: "#555", fontSize: 14 }}>Your details have been updated. We look forward to seeing you at Sun Sea Jewellers!</p>
      </div>
      <ReferralSection leadId={lead?.id} leadName={lead?.name} token={token} />
      <AppDownloadLinks />
    </div>
  );

  return (
    <div style={S}>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 32 }}>💎</div>
        <p style={{ fontSize: 13, color: "#666", margin: 0 }}>Please confirm your details so we can serve you better</p>
      </div>

      {/* Personal details */}
      <div style={{ background: "#f9fafb", borderRadius: 12, padding: 16 }}>
        <h3 style={{ fontSize: 14, margin: "0 0 12px", color: "#374151" }}>Your Details</h3>
        <span style={label}>Name</span>
        <input style={input} value={form.name} onChange={(e) => setF("name", e.target.value)} placeholder="Your full name" />
        <span style={label}>Phone</span>
        <input style={{ ...input, background: "#f3f4f6", color: "#888" }} value={lead?.phone || ""} disabled />
        <span style={label}>Email Address</span>
        <input style={input} value={form.email} onChange={(e) => setF("email", e.target.value)} placeholder="your@email.com" type="email" />
        <span style={label}>Your Birthday (DD-MM or YYYY-MM-DD)</span>
        <input style={input} value={form.bday} onChange={(e) => setF("bday", e.target.value)} placeholder="25-04 or 1985-04-25" />
        <span style={label}>Your Anniversary (DD-MM or YYYY-MM-DD)</span>
        <input style={input} value={form.anniversary} onChange={(e) => setF("anniversary", e.target.value)} placeholder="15-11 or 2005-11-15" />
      </div>

      {/* Full postal address */}
      <div style={{ background: "#fff9f0", border: "1px solid #fed7aa", borderRadius: 12, padding: 16, marginTop: 14 }}>
        <h3 style={{ fontSize: 14, margin: "0 0 6px", color: "#92400e" }}>📦 Complete Postal Address</h3>
        <p style={{ fontSize: 12, color: "#78350f", margin: "0 0 12px" }}>Please provide your complete and correct postal address so that our gifts and deliveries can reach you.</p>
        <span style={label}>House / Flat / Shop No. &amp; Street</span>
        <input style={input} value={form.address_house || ""} onChange={(e) => setF("address_house", e.target.value)} placeholder="B-12, Sector 5 / Flat 304, XYZ Apartments" />
        <span style={label}>Area / Locality / Colony</span>
        <input style={input} value={form.address_locality || ""} onChange={(e) => setF("address_locality", e.target.value)} placeholder="Karol Bagh / Lajpat Nagar" />
        <span style={label}>City</span>
        <input style={input} value={form.city} onChange={(e) => setF("city", e.target.value)} placeholder="New Delhi" />
        <span style={label}>State</span>
        <input style={input} value={form.address_state || ""} onChange={(e) => setF("address_state", e.target.value)} placeholder="Delhi" />
        <span style={label}>Pincode</span>
        <input style={input} value={form.address_pincode || ""} onChange={(e) => setF("address_pincode", e.target.value)} placeholder="110005" type="tel" maxLength={6} />
        <span style={label}>Country</span>
        <input style={input} value={form.address_country || "India"} onChange={(e) => setF("address_country", e.target.value)} placeholder="India" />
      </div>

      {/* Family members */}
      <div style={{ background: "#f9fafb", borderRadius: 12, padding: 16, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, margin: 0, color: "#374151" }}>👨‍👩‍👧 Family Members</h3>
          <button onClick={addMember} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>+ Add</button>
        </div>
        <p style={{ fontSize: 12, color: "#888", margin: "0 0 12px" }}>Help us wish your family on their special days too 🎂</p>
        {family.length === 0 && <p style={{ fontSize: 13, color: "#aaa", textAlign: "center" }}>Add your spouse, kids, parents</p>}
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

      {/* Refer a friend */}
      <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: 16, marginTop: 14 }}>
        <h3 style={{ fontSize: 14, margin: "0 0 4px", color: "#78350f" }}>🎁 Refer a Friend — Gift Them 50mg Free Gold</h3>
        <p style={{ fontSize: 12, color: "#92400e", margin: "0 0 12px" }}>Enter your friend or family member's number. We'll WhatsApp them your gift. You earn *50mg gold for every friend who joins!* 🥇</p>
        {refs.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-end", marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <span style={label}>Mobile</span>
              <input style={input} value={r.phone} onChange={(e) => setRefs((p) => p.map((x, idx) => idx === i ? { ...x, phone: e.target.value } : x))} placeholder="9810XXXXXX" type="tel" />
            </div>
            <div style={{ flex: 1 }}>
              <span style={label}>Name (optional)</span>
              <input style={input} value={r.name} onChange={(e) => setRefs((p) => p.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} placeholder="Rahul" />
            </div>
            {refs.length > 1 && <button onClick={() => setRefs((p) => p.filter((_, idx) => idx !== i))} style={{ fontSize: 20, color: "#dc2626", border: "none", background: "none", cursor: "pointer", paddingBottom: 6 }}>×</button>}
          </div>
        ))}
        <button onClick={() => setRefs((p) => [...p, { phone: "", name: "" }])} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 8, border: "1px solid #d97706", background: "#fff", color: "#92400e", cursor: "pointer" }}>+ Add another</button>
      </div>

      {err && <p style={{ color: "#dc2626", fontSize: 13, marginTop: 8 }}>{err}</p>}
      <button style={btn} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Details & Send Gifts ✓"}</button>
      <p style={{ fontSize: 11, color: "#aaa", textAlign: "center", marginTop: 12 }}>Sun Sea Jewellers · Karol Bagh, New Delhi</p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// GENERIC PROFILE PAGE — /profile (no token, phone-based)
// ──────────────────────────────────────────────────────────
function GenericProfileForm() {
  const S = { fontFamily: "system-ui, sans-serif", maxWidth: 480, margin: "0 auto", padding: "24px 16px", color: "#1a1a1a" };
  const label = { fontSize: 12, color: "#666", display: "block", marginBottom: 4, marginTop: 12 };
  const input = { width: "100%", fontSize: 14, padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8, boxSizing: "border-box", outline: "none" };
  const btn = { width: "100%", padding: "12px", fontSize: 15, fontWeight: 600, border: "none", borderRadius: 10, background: "#1a1a1a", color: "#fff", cursor: "pointer", marginTop: 20 };

  const referralId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("ref") : null;
  const [step, setStep] = useState("phone"); // "phone" | "form" | "done"
  const [rawPhone, setRawPhone] = useState("");
  const [lead, setLead] = useState(null);
  const [family, setFamily] = useState([]);
  const [refs, setRefs] = useState([{ phone: "", name: "" }]);
  const [form, setForm] = useState({ name: "", email: "", city: "", address_house: "", address_locality: "", address_state: "", address_pincode: "", address_country: "India", bday: "", anniversary: "" });
  const [deletedIds, setDeletedIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const normalised = rawPhone.replace(/\D/g, "").replace(/^0+/, "").replace(/^91/, "");

  const lookup = async () => {
    if (normalised.length < 10) { setErr("Enter a valid 10-digit mobile number."); return; }
    setErr(""); setLoading(true);
    try {
      const r = await fetch(`/api/contact-update?phone=${normalised}`);
      const d = await r.json();
      if (d.ok) {
        setLead(d.lead || null);
        setFamily(d.family || []);
        if (d.lead) {
          setForm({ name: d.lead.name || "", email: d.lead.email || "", city: d.lead.city || "", address_house: d.lead.address_house || "", address_locality: d.lead.address_locality || "", address_state: d.lead.address_state || "", address_pincode: d.lead.address_pincode || "", address_country: d.lead.address_country || "India", bday: d.lead.bday || "", anniversary: d.lead.anniversary || "" });
        }
        setStep("form");
      } else { setErr("Something went wrong. Try again."); }
    } catch { setErr("Network error. Try again."); }
    setLoading(false);
  };

  const setF = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const setMember = (i, k, v) => setFamily((p) => p.map((m, idx) => idx === i ? { ...m, [k]: v } : m));
  const addMember = () => setFamily((p) => [...p, { relationship: "spouse", name: "", dob: "", mobile: "" }]);
  const removeMember = (i) => { const m = family[i]; if (m.id) setDeletedIds((p) => [...p, m.id]); setFamily((p) => p.filter((_, idx) => idx !== i)); };

  const save = async () => {
    setSaving(true); setErr("");
    try {
      const validRefs = refs.filter((r) => r.phone.replace(/\D/g, "").length >= 10);
      const r = await fetch("/api/contact-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalised, ...form, family, deletedFamilyIds: deletedIds, referrals: validRefs, ...(referralId ? { referralId } : {}) }),
      });
      const d = await r.json();
      if (d.ok) { setStep("done"); }
      else { setErr("Failed to save. Try again."); }
    } catch { setErr("Network error. Try again."); }
    setSaving(false);
  };

  if (step === "phone") return (
    <div style={S}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 36 }}>💎</div>
        <p style={{ fontSize: 13, color: "#666" }}>Enter your mobile number to update your details or register as a new client</p>
      </div>
      <span style={label}>Mobile Number</span>
      <input style={input} value={rawPhone} onChange={(e) => setRawPhone(e.target.value)}
        placeholder="9810XXXXXX" type="tel" autoFocus
        onKeyDown={(e) => e.key === "Enter" && lookup()} />
      {err && <p style={{ color: "#dc2626", fontSize: 13, marginTop: 6 }}>{err}</p>}
      <button style={btn} onClick={lookup} disabled={loading}>{loading ? "Looking up…" : "Continue →"}</button>
      <p style={{ fontSize: 11, color: "#aaa", textAlign: "center", marginTop: 14 }}>Sun Sea Jewellers · Karol Bagh, New Delhi</p>
    </div>
  );

  if (step === "done") return (
    <div style={S}>
      <div style={{ textAlign: "center", paddingTop: 32 }}>
        <div style={{ fontSize: 48 }}>🙏</div>
        <h2 style={{ fontSize: 20, margin: "16px 0 8px" }}>Thank you, {form.name?.split(" ")[0] || ""}!</h2>
        <p style={{ color: "#555", fontSize: 14 }}>{lead ? "Your details have been updated." : "You've been registered!"} We look forward to seeing you at Sun Sea Jewellers!</p>
      </div>
      <ReferralSection phone={normalised} />
      <AppDownloadLinks />
    </div>
  );

  // step === "form"
  const addRef = () => setRefs((r) => [...r, { phone: "", name: "" }]);
  const setRef = (i, k, v) => setRefs((r) => r.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
  const removeRef = (i) => setRefs((r) => r.filter((_, idx) => idx !== i));

  return (
    <div style={S}>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 32 }}>💎</div>
        <p style={{ fontSize: 13, color: lead ? "#16a34a" : "#666", margin: 0 }}>
          {lead ? `Welcome back! Updating details for ${rawPhone}` : `Registering new client: ${rawPhone}`}
        </p>
      </div>

      {/* Personal details */}
      <div style={{ background: "#f9fafb", borderRadius: 12, padding: 16 }}>
        <h3 style={{ fontSize: 14, margin: "0 0 12px", color: "#374151" }}>Your Details</h3>
        <span style={label}>Name *</span>
        <input style={input} value={form.name} onChange={(e) => setF("name", e.target.value)} placeholder="Your full name" />
        <span style={label}>Phone</span>
        <input style={{ ...input, background: "#f3f4f6", color: "#888" }} value={rawPhone} disabled />
        <span style={label}>Email Address</span>
        <input style={input} value={form.email} onChange={(e) => setF("email", e.target.value)} placeholder="your@email.com" type="email" />
        <span style={label}>Your Birthday (DD-MM or YYYY-MM-DD)</span>
        <input style={input} value={form.bday} onChange={(e) => setF("bday", e.target.value)} placeholder="25-04 or 1985-04-25" />
        <span style={label}>Your Anniversary (DD-MM or YYYY-MM-DD)</span>
        <input style={input} value={form.anniversary} onChange={(e) => setF("anniversary", e.target.value)} placeholder="15-11 or 2005-11-15" />
      </div>

      {/* Full postal address */}
      <div style={{ background: "#fff9f0", border: "1px solid #fed7aa", borderRadius: 12, padding: 16, marginTop: 14 }}>
        <h3 style={{ fontSize: 14, margin: "0 0 6px", color: "#92400e" }}>📦 Complete Postal Address</h3>
        <p style={{ fontSize: 12, color: "#78350f", margin: "0 0 12px" }}>Please provide your complete and correct postal address so that our gifts and deliveries can reach you.</p>
        <span style={label}>House / Flat / Shop No. &amp; Street</span>
        <input style={input} value={form.address_house} onChange={(e) => setF("address_house", e.target.value)} placeholder="B-12, Sector 5 / Flat 304, XYZ Apartments" />
        <span style={label}>Area / Locality / Colony</span>
        <input style={input} value={form.address_locality} onChange={(e) => setF("address_locality", e.target.value)} placeholder="Karol Bagh / Lajpat Nagar / Dwarka" />
        <span style={label}>City</span>
        <input style={input} value={form.city} onChange={(e) => setF("city", e.target.value)} placeholder="New Delhi" />
        <span style={label}>State</span>
        <input style={input} value={form.address_state} onChange={(e) => setF("address_state", e.target.value)} placeholder="Delhi" />
        <span style={label}>Pincode</span>
        <input style={input} value={form.address_pincode} onChange={(e) => setF("address_pincode", e.target.value)} placeholder="110005" type="tel" maxLength={6} />
        <span style={label}>Country</span>
        <input style={input} value={form.address_country} onChange={(e) => setF("address_country", e.target.value)} placeholder="India" />
      </div>

      {/* Family members */}
      <div style={{ background: "#f9fafb", borderRadius: 12, padding: 16, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, margin: 0, color: "#374151" }}>👨‍👩‍👧 Family Members</h3>
          <button onClick={addMember} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>+ Add</button>
        </div>
        <p style={{ fontSize: 12, color: "#888", margin: "0 0 12px" }}>Help us wish your family on their special days too 🎂</p>
        {family.length === 0 && <p style={{ fontSize: 13, color: "#aaa", textAlign: "center" }}>No family members yet — add your spouse, kids, parents</p>}
        {family.map((m, i) => (
          <div key={i} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <select value={m.relationship} onChange={(e) => setMember(i, "relationship", e.target.value)}
                style={{ fontSize: 13, border: "1px solid #ddd", borderRadius: 6, padding: "4px 8px" }}>
                {["spouse","son","daughter","mother","father","brother","sister","other"].map((r) => <option key={r}>{r}</option>)}
              </select>
              <button onClick={() => removeMember(i)} style={{ fontSize: 12, color: "#dc2626", border: "none", background: "none", cursor: "pointer" }}>Remove</button>
            </div>
            <span style={label}>Name</span>
            <input style={input} value={m.name || ""} onChange={(e) => setMember(i, "name", e.target.value)} placeholder="Name" />
            <span style={label}>Birthday (DD-MM or YYYY-MM-DD)</span>
            <input style={input} value={m.dob || ""} onChange={(e) => setMember(i, "dob", e.target.value)} placeholder="25-04" />
            <span style={label}>Mobile (optional)</span>
            <input style={input} value={m.mobile || ""} onChange={(e) => setMember(i, "mobile", e.target.value)} placeholder="9810XXXXXX" />
          </div>
        ))}
      </div>

      {/* Refer a friend */}
      <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: 16, marginTop: 14 }}>
        <h3 style={{ fontSize: 14, margin: "0 0 4px", color: "#78350f" }}>🎁 Refer a Friend — Gift Them 50mg Free Gold</h3>
        <p style={{ fontSize: 12, color: "#92400e", margin: "0 0 12px" }}>Enter your friend or family member's number. We'll WhatsApp them your gift. You earn *50mg gold for every friend who joins!* 🥇</p>
        {refs.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-end", marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <span style={label}>Friend's Mobile</span>
              <input style={input} value={r.phone} onChange={(e) => setRef(i, "phone", e.target.value)} placeholder="9810XXXXXX" type="tel" />
            </div>
            <div style={{ flex: 1 }}>
              <span style={label}>Friend's Name</span>
              <input style={input} value={r.name} onChange={(e) => setRef(i, "name", e.target.value)} placeholder="Rahul (optional)" />
            </div>
            {refs.length > 1 && <button onClick={() => removeRef(i)} style={{ fontSize: 20, color: "#dc2626", border: "none", background: "none", cursor: "pointer", paddingBottom: 6 }}>×</button>}
          </div>
        ))}
        <button onClick={addRef} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 8, border: "1px solid #d97706", background: "#fff", color: "#92400e", cursor: "pointer" }}>+ Add another friend</button>
      </div>

      {err && <p style={{ color: "#dc2626", fontSize: 13, marginTop: 8 }}>{err}</p>}
      <button style={btn} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Details & Send Gifts ✓"}</button>
      <p style={{ fontSize: 11, color: "#aaa", textAlign: "center", marginTop: 12 }}>Sun Sea Jewellers · Karol Bagh, New Delhi</p>
    </div>
  );
}

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
      wa_number: sess?.me ? normalizePhone(sess.me.replace(/[:@].*/, "")) : "",
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
    try {
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      const isPdf = file.type === "application/pdf";
      let publicUrl;
      if (isImage) {
        ({ publicUrl } = await secureImageUpload(file, sb, "broadcasts"));
      } else if (isVideo || isPdf) {
        const allowed = ["application/pdf", "video/mp4", "video/quicktime", "video/webm", "video/3gpp"];
        ({ publicUrl } = await secureNonImageUpload(file, sb, "broadcasts", allowed, 100));
      } else {
        throw new Error("Only images, videos, and PDFs are allowed.");
      }
      const type = isVideo ? "video" : isPdf ? "document" : "image";
      setMediaUrl(publicUrl);
      setMediaType(type);
    } catch (e) {
      setErr(e.message);
    } finally {
      setUploading(false);
    }
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

// ──────────────────────────────────────────────────────────
// STAFF & ACCESS CONTROL SCREEN — SA/admin only
// Manage which CRM pages each staff member can see and write
// ──────────────────────────────────────────────────────────
function StaffAccessScreen() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(new Set());
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    setLoading(true);
    sb.from("staff")
      .select("id,name,username,role,app_permissions")
      .eq("tenant_id", getTenantId())
      .neq("type", "artisan")
      .order("name")
      .then(({ data }) => { setStaff(data || []); setLoading(false); });
  }, []);

  const persist = async (s, newPerms) => {
    setSaving((p) => new Set([...p, s.id]));
    await sb.from("staff").update({ app_permissions: newPerms }).eq("id", s.id);
    setStaff((prev) => prev.map((r) => r.id === s.id ? { ...r, app_permissions: newPerms } : r));
    setSaving((p) => { const n = new Set(p); n.delete(s.id); return n; });
  };

  // Returns "none" | "read" | "write" for a staff + tab
  const getTabLevel = (s, tabKey) => {
    if (s.role === "superadmin" || s.role === "admin") return "write";
    const crm = s.app_permissions?.crm;
    const crmWrite = s.app_permissions?.crm_write;
    const roleDefaults = CRM_ROLE_DEFAULT_TABS[s.role] || ["demands"];
    // If crm explicitly set, it's authoritative (role defaults can be overridden)
    const canView = Array.isArray(crm)
      ? (crm.includes("all") || crm.includes(tabKey))
      : roleDefaults.includes(tabKey);
    if (!canView) return "none";
    if (!crmWrite) return "write";
    const canWrite = crmWrite.includes("all") || crmWrite.includes(tabKey);
    return canWrite ? "write" : "read";
  };

  // Cycle: none → write → read → none (all tabs including role defaults)
  const cycleTabLevel = async (s, tabKey) => {
    if (s.role === "superadmin" || s.role === "admin") return;
    const current = getTabLevel(s, tabKey);
    const next = current === "none" ? "write" : current === "write" ? "read" : "none";

    const perms = s.app_permissions || {};
    const roleDefaults = CRM_ROLE_DEFAULT_TABS[s.role] || ["demands"];
    // Expand to explicit lists so we can mutate safely
    let crm = Array.isArray(perms.crm) && !perms.crm.includes("all") ? [...perms.crm] : [...roleDefaults];
    const curVisibleKeys = Array.isArray(perms.crm) && perms.crm.includes("all")
      ? CRM_ALL_TABS.map((t) => t.k)
      : [...new Set([...roleDefaults, ...crm])];
    let crmWrite = Array.isArray(perms.crm_write) ? [...perms.crm_write] : [...curVisibleKeys];

    if (next === "none") {
      crm = crm.filter((k) => k !== tabKey);
      crmWrite = crmWrite.filter((k) => k !== tabKey);
    } else if (next === "write") {
      if (!crm.includes(tabKey)) crm = [...crm, tabKey];
      if (!crmWrite.includes(tabKey)) crmWrite = [...crmWrite, tabKey];
    } else {
      if (!crm.includes(tabKey)) crm = [...crm, tabKey];
      crmWrite = crmWrite.filter((k) => k !== tabKey);
    }
    await persist(s, { ...perms, crm, crm_write: crmWrite });
  };

  const grantAll = async (s, level) => {
    if (s.role === "superadmin" || s.role === "admin") return;
    const perms = s.app_permissions || {};
    if (level === "write") {
      await persist(s, { ...perms, crm: ["all"], crm_write: ["all"] });
    } else {
      await persist(s, { ...perms, crm: ["all"], crm_write: [] });
    }
  };

  const resetAccess = async (s) => {
    if (s.role === "superadmin" || s.role === "admin") return;
    const { crm: _c, crm_write: _w, ...rest } = s.app_permissions || {};
    await persist(s, rest);
  };

  const LEVEL_STYLE = {
    none:  { bg: "#f3f4f6", color: "#9ca3af", border: "#e5e7eb", icon: "—" },
    read:  { bg: "#dbeafe", color: "#1d4ed8", border: "#93c5fd", icon: "👁️" },
    write: { bg: "#dcfce7", color: "#166534", border: "#86efac", icon: "✏️" },
  };

  if (loading) return <div style={{ color: "#aaa", fontSize: 13, padding: 20 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 14, padding: "8px 12px", background: "#f0f9ff", borderRadius: 8, border: "1px solid #bae6fd" }}>
        Click any staff member to expand. For each CRM page, click the chip to cycle access:
        {" "}<span style={{ padding: "1px 7px", borderRadius: 10, background: "#f3f4f6", color: "#9ca3af", fontSize: 11 }}>— No access</span>
        {" → "}<span style={{ padding: "1px 7px", borderRadius: 10, background: "#dcfce7", color: "#166534", fontSize: 11 }}>✏️ Write</span>
        {" → "}<span style={{ padding: "1px 7px", borderRadius: 10, background: "#dbeafe", color: "#1d4ed8", fontSize: 11 }}>👁️ Read only</span>
        {" → "} No access. <strong>Bold chips</strong> = role default tab.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {staff.map((s) => {
          const isExpanded = expandedId === s.id;
          const busy = saving.has(s.id);
          const isSA = s.role === "superadmin" || s.role === "admin";
          const roleDefaults = CRM_ROLE_DEFAULT_TABS[s.role] || ["demands"];
          const crm = s.app_permissions?.crm;
          const hasAll = isSA || (Array.isArray(crm) && crm.includes("all"));
          const crmWrite = s.app_permissions?.crm_write;
          const visibleCount = hasAll ? CRM_ALL_TABS.length : [...new Set([...roleDefaults, ...(Array.isArray(crm) ? crm.filter((k) => k !== "all") : [])])].length;
          const summaryLabel = isSA
            ? "Full access by role"
            : hasAll
              ? (!crmWrite || crmWrite.includes("all") ? "All tabs — full write" : "All tabs — some read-only")
              : `${visibleCount} of ${CRM_ALL_TABS.length} tabs`;

          return (
            <div key={s.id}>
              <div
                onClick={() => !busy && setExpandedId(isExpanded ? null : s.id)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: isExpanded ? "8px 8px 0 0" : 8, background: isExpanded ? "#eff6ff" : "#fafafa", border: `1px solid ${isExpanded ? "#93c5fd" : "#e5e7eb"}`, cursor: busy ? "default" : "pointer", userSelect: "none" }}
              >
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{s.name || s.username}</span>
                  <span style={{ fontSize: 11, color: "#aaa", marginLeft: 6 }}>@{s.username}</span>
                </div>
                <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 6, background: "#e5e7eb", color: "#555", fontWeight: 600, textTransform: "uppercase" }}>{s.role}</span>
                <span style={{ fontSize: 11, color: isSA ? "#166534" : "#555" }}>{summaryLabel}</span>
                {busy && <span style={{ fontSize: 11, color: "#888" }}>Saving…</span>}
                <span style={{ fontSize: 11, color: "#aaa" }}>{isExpanded ? "▲" : "▼"}</span>
              </div>
              {isExpanded && (
                <div style={{ padding: "14px", background: "#f8faff", border: "1px solid #93c5fd", borderTop: "none", borderRadius: "0 0 8px 8px" }}>
                  {isSA ? (
                    <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>
                      Superadmin / Admin always has full access to all pages and cannot be restricted.
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
                        {CRM_ALL_TABS.map((tab) => {
                          const level = getTabLevel(s, tab.k);
                          const isDefault = roleDefaults.includes(tab.k);
                          const st = LEVEL_STYLE[level];
                          return (
                            <button
                              key={tab.k}
                              disabled={busy}
                              onClick={() => cycleTabLevel(s, tab.k)}
                              title={`${tab.l}${isDefault ? " (role default)" : ""} — click to cycle: no access → write → read only → no access`}
                              style={{
                                fontSize: 11, padding: "4px 10px", borderRadius: 12,
                                border: `1.5px solid ${st.border}`,
                                background: st.bg, color: st.color,
                                cursor: busy ? "default" : "pointer",
                                opacity: busy ? 0.6 : 1,
                                fontWeight: isDefault ? 700 : 400,
                              }}
                            >
                              {st.icon} {tab.l}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button disabled={busy} onClick={() => grantAll(s, "write")}
                          style={{ fontSize: 11, padding: "4px 12px", borderRadius: 6, border: "1px solid #6366f1", background: "#eef2ff", color: "#3730a3", cursor: busy ? "default" : "pointer" }}>
                          ✏️ Grant all write
                        </button>
                        <button disabled={busy} onClick={() => grantAll(s, "read")}
                          style={{ fontSize: 11, padding: "4px 12px", borderRadius: 6, border: "1px solid #93c5fd", background: "#dbeafe", color: "#1d4ed8", cursor: busy ? "default" : "pointer" }}>
                          👁️ All read only
                        </button>
                        <button disabled={busy} onClick={() => resetAccess(s)}
                          style={{ fontSize: 11, padding: "4px 12px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fef2f2", color: "#991b1b", cursor: busy ? "default" : "pointer" }}>
                          🔒 Reset to role default
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!staff.length && !loading && <div style={{ color: "#aaa", fontSize: 13 }}>No staff found.</div>}
      </div>
    </div>
  );
}

// MAIN APP — tabbed interface, tabs filtered by app_permissions
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
  const [err, setErr] = useState("");
  const [hasCalled, setHasCalled] = useState(false);
  const [addingWalkin, setAddingWalkin] = useState(false);
  const [scripts, setScripts] = useState({ s1: "", s2: "", s3: "" });
  const [objections, setObjections] = useState([]);
  const [showScript, setShowScript] = useState(false);
  const [allTags, setAllTags] = useState([]);
  const [fullLead, setFullLead] = useState(null); // full lead row for ConversationPane
  const [fullDemand, setFullDemand] = useState(null); // full demand row with step
  const [addingDemand, setAddingDemand] = useState(false);

  useEffect(() => {
    sb.from("bullion_dropdowns").select("field,value,sort_order")
      .eq("tenant_id", getTenantId())
      .in("field", ["telecaller_script_s1","telecaller_script_s2","telecaller_script_s3","telecaller_objection"])
      .eq("active", true).order("sort_order")
      .then(({ data }) => {
        const s = { s1: "", s2: "", s3: "" }; const obj = [];
        for (const row of data || []) {
          if (row.field === "telecaller_script_s1") s.s1 = row.value;
          else if (row.field === "telecaller_script_s2") s.s2 = row.value;
          else if (row.field === "telecaller_script_s3") s.s3 = row.value;
          else if (row.field === "telecaller_objection") obj.push(row.value);
        }
        setScripts(s); setObjections(obj);
      });
    sb.from("bullion_tags").select("*").eq("tenant_id", getTenantId()).order("sort_order")
      .then(({ data }) => setAllTags(data || []));
  }, []);

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
      setFullLead(null); setFullDemand(null);
    } catch (e) {
      setErr(String(e));
    }
    setLoading(false);
  }, [me?.id]);

  useEffect(() => { load(); }, [load]);

  const demand = demands[idx] || null;
  const lead = demand?.lead || null;

  // When selected demand changes, load full lead + demand rows for ConversationPane
  useEffect(() => {
    if (!demand?.lead_id) { setFullLead(null); setFullDemand(null); return; }
    Promise.all([
      sb.from("bullion_leads").select("*").eq("id", demand.lead_id).single(),
      sb.from("bullion_demands").select("*, lead:bullion_leads(id,name,phone,wa_display_name,status,bot_paused,funnel_id,stage,last_msg,last_msg_at,updated_at,source,is_client,tags), step:bullion_funnel_steps(id,name,step_type)").eq("id", demand.id).single(),
    ]).then(([{ data: l }, { data: d }]) => {
      setFullLead(l);
      setFullDemand(d);
    });
  }, [demand?.id]);
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
    setShowContext(false); setMessages([]);
    if (idx < total - 1) setIdx((i) => i + 1);
    else load();
  };

  const goTo = (i) => { setHasCalled(false); setShowScript(false); setIdx(i); };

  const loadMessages = async (leadId) => {
    if (!leadId) return;
    setMsgsLoading(true);
    const { data } = await sb.from("bullion_messages")
      .select("id,direction,body,created_at,stage")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(20);
    setMessages((data || []).reverse());
    setMsgsLoading(false);
  };

  const toggleContext = () => {
    const next = !showContext;
    setShowContext(next);
    if (next && messages.length === 0 && demand?.lead_id) loadMessages(demand.lead_id);
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
      <div style={{ maxWidth: 540, margin: "0 auto", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 6 }}>
          <Btn color={C.blue} onClick={load}>↻ Refresh</Btn>
          <div style={{ display: "flex", gap: 6 }}>
            <Btn color={C.green} onClick={() => setAddingDemand(true)}>+ New Demand</Btn>
            <Btn color="#16a085" onClick={() => setAddingWalkin(true)}>🏪 Walk-in</Btn>
          </div>
        </div>
        <div style={{ textAlign: "center", paddingTop: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#16a085", marginBottom: 6 }}>Queue empty!</div>
          <div style={{ fontSize: 13, color: "#888" }}>All calls done. Great work!</div>
        </div>
        {addingDemand && <DemandEntryModal funnels={funnels} onClose={() => setAddingDemand(false)} onSaved={() => { setAddingDemand(false); load(); }} />}
        {addingWalkin && <WalkinEntryModal funnels={funnels} allTags={allTags} onClose={() => setAddingWalkin(false)} onSaved={() => { setAddingWalkin(false); load(); }} />}
      </div>
    );
  }

  const priorityColor = temp === "hot" ? "#ef4444" : temp === "warm" ? "#f59e0b" : "#3b82f6";
  const dueNow = demands.filter((d) => !d.next_call_at || new Date(d.next_call_at) <= new Date());
  const upcoming = demands.filter((d) => d.next_call_at && new Date(d.next_call_at) > new Date());

  return (
    <div style={{ maxWidth: 540, margin: "0 auto" }}>
      {/* Header with action buttons */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>📋 Your calls — {total}</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <Btn small color={C.green} onClick={() => setAddingDemand(true)}>+ New Demand</Btn>
          <Btn small color="#16a085" onClick={() => setAddingWalkin(true)}>🏪 Walk-in</Btn>
          <Btn small ghost color={C.gray} onClick={load}>↻</Btn>
        </div>
      </div>
      {addingDemand && <DemandEntryModal funnels={funnels} onClose={() => setAddingDemand(false)} onSaved={() => { setAddingDemand(false); load(); }} />}
      {addingWalkin && <WalkinEntryModal funnels={funnels} allTags={allTags} onClose={() => setAddingWalkin(false)} onSaved={() => { setAddingWalkin(false); load(); }} />}

      {/* Due now list */}
      {dueNow.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.red, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
            🔴 Call now ({dueNow.length})
          </div>
          {dueNow.map((d, i) => {
            const globalIdx = demands.indexOf(d);
            const isCurrent = globalIdx === idx;
            const t = tempMeta(d.temperature || "warm");
            return (
              <div key={d.id} onClick={() => goTo(globalIdx)}
                style={{ padding: "8px 12px", marginBottom: 4, borderRadius: 8, cursor: "pointer",
                  border: `2px solid ${isCurrent ? C.blue : "#e5e7eb"}`,
                  background: isCurrent ? "#eef5ff" : d.is_callback_promised ? "#fff7ed" : "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{d.lead?.name || d.lead?.phone || "Unknown"}</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    {d.is_callback_promised && <Pill color={C.red} solid>📅 Callback</Pill>}
                    <Pill color={t.color} solid>{t.label}</Pill>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>
                  {d.description?.slice(0, 60) || d.product_category} · Attempt {(d.call_attempts || 0) + 1}/6
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upcoming list */}
      {upcoming.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
            🕐 Scheduled ({upcoming.length})
          </div>
          {upcoming.map((d) => {
            const globalIdx = demands.indexOf(d);
            const isCurrent = globalIdx === idx;
            const ms = new Date(d.next_call_at) - Date.now();
            const dueLabel = ms < 3600000 ? `in ${Math.round(ms/60000)}m` : ms < 86400000 ? `in ${Math.round(ms/3600000)}h` : `in ${Math.round(ms/86400000)}d`;
            return (
              <div key={d.id} onClick={() => goTo(globalIdx)}
                style={{ padding: "8px 12px", marginBottom: 4, borderRadius: 8, cursor: "pointer",
                  border: `2px solid ${isCurrent ? C.blue : "#e5e7eb"}`,
                  background: isCurrent ? "#eef5ff" : "#fafafa" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{d.lead?.name || d.lead?.phone || "Unknown"}</span>
                  <span style={{ fontSize: 11, color: "#888" }}>⏰ {dueLabel}</span>
                </div>
                <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                  {d.description?.slice(0, 60) || d.product_category}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Big Call button — always visible above the detail card */}
      <div style={{ marginBottom: 10 }}>
        {!hasCalled ? (
          <a href={`tel:+91${(lead?.phone || "").replace(/\D/g, "")}`}
            onClick={() => setHasCalled(true)}
            style={{ display: "block", textAlign: "center", padding: "14px", borderRadius: 12, background: C.green, color: "#fff", fontSize: 17, fontWeight: 700, textDecoration: "none", boxShadow: "0 2px 8px rgba(56,161,105,0.3)" }}>
            📞 Call {lead?.name || "client"} · {displayPhone(lead?.phone || "")}
          </a>
        ) : (
          <div style={{ background: "#f0fff4", border: `1px solid ${C.green}`, borderRadius: 12, padding: "10px 14px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: C.green, fontWeight: 700, flex: 1 }}>✅ Call started — log what happened below</span>
            <button onClick={() => setHasCalled(false)} style={{ background: "none", border: "none", color: "#aaa", fontSize: 11, cursor: "pointer" }}>← Not called yet</button>
          </div>
        )}
      </div>

      {/* Script panel */}
      {(() => {
        const attemptNo = (demand.call_attempts || 0) + 1;
        const scriptKey = attemptNo === 1 ? "s1" : attemptNo >= 6 ? "s3" : "s2";
        const raw = scripts[scriptKey] || "";
        const filled = raw.replace(/\{name\}/g, lead?.name || "ji").replace(/\{staff_name\}/g, me?.name || me?.username || "").replace(/\{product_category\}/g, demand.product_category || "jewellery");
        if (!filled && objections.length === 0) return null;
        return (
          <div style={{ marginBottom: 10, borderRadius: 10, overflow: "hidden", border: "1px solid #fde68a" }}>
            <button type="button" onClick={() => setShowScript(v => !v)}
              style={{ width: "100%", padding: "8px 14px", background: "#fef9c3", border: "none", textAlign: "left", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#854d0e", display: "flex", justifyContent: "space-between" }}>
              <span>📜 Script — Attempt {attemptNo} {attemptNo === 1 ? "(first contact)" : attemptNo >= 6 ? "(final)" : "(follow-up)"}</span>
              <span>{showScript ? "▲" : "▼ Show"}</span>
            </button>
            {showScript && (
              <div style={{ padding: "10px 14px", background: "#fffbeb" }}>
                {filled && <div style={{ fontSize: 13, color: "#333", lineHeight: 1.7, whiteSpace: "pre-wrap", marginBottom: objections.length ? 12 : 0 }}>{filled}</div>}
                {objections.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#92400e", marginBottom: 6 }}>OBJECTIONS</div>
                    {objections.map((o, i) => {
                      const [q, a] = o.includes("→") ? o.split("→") : [o, ""];
                      return (
                        <div key={i} style={{ marginBottom: 6, fontSize: 12 }}>
                          <div style={{ fontWeight: 600, color: "#374151" }}>{q.trim()}</div>
                          {a && <div style={{ color: "#16a085", marginLeft: 10 }}>→ {a.trim()}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Full ConversationPane — all buttons, temp override, WA thread, convert/lost etc. */}
      {fullLead && fullDemand ? (
        <ConversationPane
          lead={fullLead}
          funnel={funnel}
          demand={fullDemand}
          onClose={() => {}}
          onChanged={() => { load(); }}
          allTags={allTags}
          onAdvanceStep={fullDemand.step?.step_type !== "call" ? undefined : null}
          onRollbackStep={undefined}
        />
      ) : (
        <div style={{ textAlign: "center", padding: 20, color: "#aaa", fontSize: 13 }}>Loading details…</div>
      )}

    </div>
  );
}

// ──────────────────────────────────────────────────────────

export default function App() {
  // Customer-facing pages — no login needed
  const profileToken = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("t") : null;
  if (profileToken) return <ContactUpdateForm token={profileToken} />;
  const isProfilePage = typeof window !== "undefined" && window.location.pathname === "/profile";
  if (isProfilePage) return <GenericProfileForm />;

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
      const allowed = ["https://fms.gemtre.in", "https://fms-tracker.vercel.app", "https://jewelbos.vercel.app", "https://jewelbos.com"];
      if (!allowed.includes(e.origin) && !/^https:\/\/(fms-tracker|jewelbos)-.*\.vercel\.app$/.test(e.origin)) return;
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

  // Contact field definitions — loaded from DB, shared across all screens via context.
  const [cfCustomFields, setCfCustomFields] = React.useState([]);
  const [cfFieldOrder, setCfFieldOrder] = React.useState(null);
  const reloadCfDefs = React.useCallback(async () => {
    const { customFields, fieldOrder } = await fetchContactFieldDefs();
    setCfCustomFields(customFields);
    setCfFieldOrder(fieldOrder);
  }, []);
  useEffect(() => { if (user?.id) reloadCfDefs(); }, [user?.id, reloadCfDefs]); // eslint-disable-line

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
    { k: "leadsources",l: "Lead Sources", icon: "🌐" },
    { k: "formbuilder",l: "Form Builder", icon: "🛠️" },
    { k: "calculator", l: "Calculator",    icon: "💎" },
    { k: "staff",      l: "Staff & Access", icon: "👥" },
  ];

  // Role-based defaults when app_permissions.crm is not set
  const ROLE_DEFAULT_TABS = {
    superadmin: ALL_TABS.map((t) => t.k),
    admin:      ALL_TABS.map((t) => t.k),
    manager:    ["demands", "contacts", "contactsdb", "upcoming", "analytics", "formbuilder", "calculator"],
    staff:      ["demands", "contacts", "upcoming", "calculator"],
    telecaller: ["queue", "demands"],
  };

  const crmPerms = user?.app_permissions?.crm;
  const roleDefault = ROLE_DEFAULT_TABS[user?.role] || ["demands"];
  // If crm explicitly set, it's authoritative (SA can restrict below role defaults too)
  const allowedKeys = crmPerms
    ? (crmPerms.includes("all") ? ALL_TABS.map((t) => t.k) : crmPerms)
    : roleDefault;

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
  const cfCtx = {
    customFields: cfCustomFields,
    fieldOrder: cfFieldOrder,
    setCustomFields: setCfCustomFields,
    setFieldOrder: setCfFieldOrder,
    reload: reloadCfDefs,
  };

  if (embedScreen) {
    return (
      <ContactFieldsContext.Provider value={cfCtx}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0.5rem" }}>
          {embedScreen === "demands"  && <DemandsScreen funnels={funnels} allTags={allTags} />}
          {embedScreen === "queue"    && <TelecallerQueueScreen funnels={funnels} />}
          {embedScreen === "contacts" && <ContactsScreen funnels={funnels} />}
        </div>
      </ContactFieldsContext.Provider>
    );
  }

  return (
    <ContactFieldsContext.Provider value={cfCtx}>
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "1rem" }}>
      {header}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, borderBottom: "1px solid #eee", paddingBottom: 10, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button key={t.k} onClick={() => setScreen(t.k)} style={{ fontSize: 13, padding: "6px 14px", borderRadius: 8, border: `1px solid ${activeScreen === t.k ? C.blue : "#ddd"}`, background: activeScreen === t.k ? C.blue : "transparent", color: activeScreen === t.k ? "#fff" : "#333", cursor: "pointer" }}>{t.icon} {t.l}</button>
        ))}
      </div>

      {activeScreen === "queue" && <TelecallerQueueScreen funnels={funnels} />}
      {activeScreen === "approvals" && <ApprovalsScreen funnels={funnels} canApprove={canWriteTab(user, "approvals")} />}
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
      {activeScreen === "leadsources" && <LeadSourcesScreen funnels={funnels} />}
      {activeScreen === "formbuilder" && <FormBuilderScreen />}
      {activeScreen === "calculator" && <CalculatorScreen funnels={funnels} allTags={allTags} />}
      {activeScreen === "staff" && <StaffAccessScreen />}
    </div>
    </ContactFieldsContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CALCULATOR SCREEN — jewellery estimate + solitaire (Rapaport) + quotation sheet
// ─────────────────────────────────────────────────────────────────────────────

// Rapaport lookup tables — June 19, 2026
// Structure: { rounds: { "0.30": [[10 rows × 11 cols]], ... }, fancy: { ... } }
// Rows (clarities): IF, VVS1, VVS2, VS1, VS2, SI1, SI2, I1, I2, I3
// Cols (colors):    D, E, F, G, H, I, J, K, L, M, N
// Values in hundreds of $/ct — multiply by 100 to get $/ct
const RAP_CLARITIES = ["IF","VVS1","VVS2","VS1","VS2","SI1","SI2","I1","I2","I3"];
const RAP_COLORS    = ["D","E","F","G","H","I","J","K","L","M","N"];
const RAP_WEIGHT_RANGES = ["0.30","0.40","0.50","0.70","0.90","1.00","1.50","2.00","3.00","4.00","5.00","10.00"];
const RAP_RANGE_MINS = [0.30,0.40,0.50,0.70,0.90,1.00,1.50,2.00,3.00,4.00,5.00,10.00];

const RAP_SEED = {
  date: "2026-06-19",
  rounds: {
    "0.30": [[27,22,19,17,15,14,13,12,11,10,7],[23,20,17,15,14,13,12,11,10,9,6],[20,18,16,14,13,12,11,10,10,9,6],[18,16,14,13,12,12,11,10,9,8,5],[15,14,13,12,11,11,10,9,8,7,5],[13,12,11,11,10,10,9,8,7,6,5],[12,11,10,10,9,9,8,7,6,6,4],[11,10,9,9,8,8,7,6,5,5,4],[10,9,8,8,7,7,6,6,5,5,3],[9,8,8,7,7,7,6,5,5,4,3]],
    "0.40": [[31,25,21,20,18,16,15,14,13,11,8],[26,22,19,18,17,15,14,13,12,10,7],[23,20,18,17,16,14,13,12,11,10,7],[21,18,17,16,15,13,12,11,10,9,6],[18,16,15,14,13,12,11,10,9,8,6],[16,14,13,12,12,11,10,9,8,7,6],[14,13,12,11,11,10,10,9,8,7,5],[13,12,11,10,10,9,9,8,7,6,5],[12,11,10,9,9,8,8,7,6,5,4],[11,10,9,8,8,8,7,6,5,5,4]],
    "0.50": [[47,37,29,25,22,19,16,15,14,13,11],[37,32,26,23,20,17,15,14,13,12,10],[32,28,24,21,19,16,14,13,12,11,10],[27,24,21,19,18,15,13,12,11,10,9],[23,21,19,17,16,14,12,11,10,10,8],[20,18,16,15,14,13,11,10,9,9,8],[17,15,14,13,12,12,11,10,9,9,7],[15,14,13,12,11,11,10,9,8,8,7],[14,13,12,11,10,10,9,9,8,7,6],[13,12,11,10,9,9,8,8,8,6,5]],
    "0.70": [[64,51,41,35,30,26,23,21,19,17,12],[52,45,38,33,28,24,21,19,17,16,11],[45,40,34,30,26,22,19,17,16,15,11],[38,33,30,27,24,20,17,16,15,14,10],[31,28,25,23,21,18,16,15,14,14,9],[26,23,21,20,18,16,15,14,13,13,9],[22,20,19,18,16,15,14,13,12,12,8],[20,18,17,16,15,14,13,12,11,10,8],[18,16,15,14,13,12,11,11,11,8,7],[16,14,13,12,11,11,10,10,10,7,6]],
    "0.90": [[96,82,62,53,45,36,29,26,25,20,15],[83,71,57,48,41,32,26,24,23,19,14],[73,63,52,44,38,30,24,22,21,18,13],[59,52,45,40,35,28,23,21,20,17,12],[47,43,39,34,31,26,22,20,19,16,12],[41,37,34,30,28,24,20,19,18,15,11],[35,32,29,26,24,21,19,18,17,14,10],[30,27,25,23,21,19,17,16,15,13,9],[26,23,21,20,18,16,15,15,14,12,8],[23,20,18,17,16,15,14,14,13,10,7]],
    "1.00": [[150,118,89,76,63,48,37,32,30,23,16],[115,102,81,69,57,44,34,30,28,22,15],[96,87,74,63,52,41,32,28,26,21,14],[75,68,62,54,47,37,30,26,24,20,13],[58,53,49,45,42,34,28,25,23,19,13],[48,44,41,38,35,31,26,24,22,18,12],[40,36,33,31,29,26,23,21,20,17,12],[34,31,29,27,25,23,21,20,19,16,11],[29,27,25,23,21,19,18,17,16,15,10],[25,23,22,21,19,17,16,15,14,14,10]],
    "1.50": [[200,178,146,127,114,88,71,63,52,33,18],[179,164,136,116,105,82,65,57,49,31,17],[156,145,125,108,98,77,61,54,47,30,16],[129,120,108,94,85,71,57,51,44,29,15],[103,95,86,77,70,63,52,48,40,28,15],[83,77,69,65,60,53,48,44,37,26,14],[70,64,58,54,50,46,41,37,33,25,14],[60,53,48,45,42,38,35,32,29,23,13],[50,45,41,38,36,33,31,29,28,22,12],[44,39,37,34,32,30,29,27,26,21,12]],
    "2.00": [[330,275,235,205,175,141,113,95,80,41,19],[270,245,210,190,160,132,105,88,76,39,18],[245,220,195,175,150,123,98,83,72,37,17],[205,185,165,150,135,112,92,77,68,35,16],[165,150,135,125,115,104,86,71,65,33,15],[135,120,110,100,93,86,78,66,61,31,15],[109,99,91,84,76,69,63,57,54,29,14],[91,83,76,70,63,57,53,50,47,28,14],[78,71,66,61,54,50,46,43,40,27,13],[68,63,57,54,48,45,42,40,38,26,13]],
    "3.00": [[550,460,410,350,295,235,200,139,103,49,21],[450,420,370,320,265,210,185,131,98,47,20],[405,375,335,295,245,195,170,124,93,45,19],[335,315,280,245,210,180,155,112,87,43,18],[270,250,225,205,185,160,135,101,82,41,17],[220,205,190,175,160,140,120,92,77,38,16],[175,165,150,140,130,120,110,84,71,35,15],[145,135,125,120,110,103,97,76,62,33,15],[117,111,107,103,95,90,82,65,55,31,14],[95,91,87,83,79,75,67,58,47,30,14]],
    "4.00": [[745,645,585,495,415,315,255,155,111,54,23],[625,585,525,450,390,295,240,145,106,52,22],[565,520,475,410,355,275,225,138,101,50,21],[465,430,395,360,315,245,200,127,95,47,20],[360,335,315,295,260,215,180,114,90,44,19],[280,260,245,230,210,190,160,105,86,41,18],[225,210,195,185,170,155,140,95,75,39,17],[185,175,160,150,140,130,120,83,66,36,17],[150,140,130,120,115,105,100,73,59,34,16],[125,115,105,100,95,90,80,65,50,32,16]],
    "5.00": [[1000,855,770,690,580,430,315,175,125,60,25],[835,750,670,595,520,395,295,170,120,57,23],[730,670,595,540,465,360,280,160,115,54,22],[605,555,505,460,395,320,260,150,110,51,21],[480,445,400,360,325,265,225,140,100,48,21],[365,345,315,290,255,225,195,130,95,46,20],[280,260,240,220,205,195,170,120,88,43,19],[220,210,195,180,170,165,150,110,81,41,18],[180,165,155,150,140,135,125,100,69,37,17],[150,140,130,125,120,110,100,80,60,34,16]],
    "10.00": [[1400,1300,1200,1070,900,635,465,250,140,66,27],[1270,1160,1030,930,820,585,430,235,135,63,26],[1110,1040,930,835,715,535,400,220,130,60,25],[930,865,785,715,610,485,370,205,125,57,24],[750,695,630,565,500,405,325,185,120,55,23],[570,535,495,460,405,340,275,170,115,52,22],[440,405,375,350,325,285,235,150,110,49,21],[345,325,300,275,255,235,200,135,100,47,20],[270,255,240,225,210,195,165,120,85,45,19],[225,210,195,185,175,165,140,105,75,43,18]],
  },
  fancy: {
    "0.30": [[23,21,19,17,16,15,13,11,9,7,6],[21,19,17,16,15,14,12,10,8,7,5],[19,17,16,15,14,13,11,9,7,6,5],[17,16,15,14,13,12,10,8,7,6,4],[16,15,14,13,12,11,9,7,6,5,4],[15,14,13,12,11,10,8,7,6,5,4],[13,12,11,10,9,8,7,6,5,5,3],[11,10,9,8,8,7,7,6,5,5,3],[10,9,8,7,7,7,6,5,5,4,2],[9,8,8,7,7,6,6,5,4,3,2]],
    "0.40": [[26,24,22,20,18,17,15,13,11,8,7],[24,22,20,18,17,16,14,12,10,8,6],[23,21,19,17,16,15,13,11,9,7,5],[21,19,17,16,15,14,12,10,9,7,5],[19,17,16,15,14,13,11,9,8,6,5],[17,16,15,14,13,12,10,9,7,6,4],[15,14,13,12,11,10,9,8,6,5,4],[13,12,11,10,10,9,8,7,6,5,4],[12,11,10,9,9,8,7,6,5,5,3],[11,10,9,8,8,7,6,5,5,4,3]],
    "0.50": [[30,28,26,24,22,20,18,17,15,12,9],[28,26,24,23,21,19,17,16,14,11,8],[26,24,23,22,20,18,16,15,13,10,7],[24,22,21,20,19,17,15,14,12,9,7],[22,20,19,18,17,16,14,13,11,8,7],[20,18,17,16,15,14,13,12,10,8,6],[18,17,16,15,14,13,12,11,9,7,6],[16,15,14,13,12,11,10,9,8,6,6],[14,13,12,11,11,10,9,8,7,6,5],[13,12,11,10,10,9,8,7,6,5,4]],
    "0.70": [[43,40,37,34,31,26,22,20,18,16,10],[40,37,35,32,29,24,20,18,16,15,9],[37,35,33,30,27,22,18,16,15,14,9],[34,32,30,28,25,21,17,15,15,14,8],[31,29,27,25,23,19,16,15,14,13,8],[29,27,25,23,20,18,15,14,13,12,8],[24,23,21,19,17,16,15,14,12,11,7],[20,19,18,17,16,15,14,13,11,10,7],[18,17,16,16,15,14,13,12,10,8,6],[16,15,14,14,13,12,11,10,8,7,5]],
    "0.90": [[62,58,52,48,41,34,30,27,24,18,11],[59,52,48,45,39,32,28,25,23,17,10],[52,49,46,43,37,30,26,23,22,16,10],[49,47,44,41,35,29,24,22,21,16,9],[46,43,40,37,32,27,23,21,20,15,9],[39,37,35,32,29,25,21,19,18,14,9],[34,32,30,28,25,22,19,17,16,13,8],[28,26,24,22,21,19,17,15,14,12,8],[22,21,20,18,17,16,15,14,13,10,7],[19,18,17,16,15,14,13,12,11,9,7]],
    "1.00": [[93,82,76,67,57,46,39,35,31,21,13],[82,75,69,62,54,43,37,33,29,20,12],[74,68,64,58,51,40,35,31,28,20,11],[66,62,58,54,48,38,33,29,26,19,10],[56,52,49,46,42,36,31,27,24,18,10],[47,44,42,39,37,32,28,24,22,17,10],[40,38,36,34,32,29,25,22,19,15,9],[34,32,30,28,26,24,22,19,17,14,9],[29,27,25,23,22,20,19,18,16,12,9],[25,23,21,20,19,18,17,16,13,10,8]],
    "1.50": [[141,132,125,116,99,81,67,59,51,27,15],[132,124,116,108,93,76,63,55,48,26,14],[123,115,108,102,88,72,60,51,45,25,13],[109,105,100,93,82,67,56,48,42,24,12],[92,88,84,79,71,62,52,45,39,23,11],[79,75,72,68,63,56,48,42,36,22,11],[64,61,58,55,52,48,44,38,33,20,11],[49,47,45,43,41,39,37,33,29,18,10],[41,39,37,36,34,32,30,28,26,16,10],[35,33,32,31,29,27,25,24,22,15,10]],
    "2.00": [[215,200,185,175,160,135,103,82,69,30,16],[200,185,170,160,150,125,96,78,64,29,15],[185,170,160,150,140,117,91,74,59,28,14],[170,160,150,140,130,107,86,70,55,27,13],[135,125,120,115,110,99,82,64,51,25,12],[108,104,99,95,90,85,75,57,48,24,12],[88,84,81,77,74,70,63,51,45,22,12],[70,66,63,60,58,55,51,43,37,21,11],[54,51,49,47,45,43,41,36,33,19,11],[45,42,40,38,36,35,33,29,27,18,10]],
    "3.00": [[420,355,325,300,270,230,180,122,86,36,17],[365,325,295,275,250,215,170,112,80,33,16],[325,295,270,250,230,200,160,104,74,30,15],[290,265,245,225,210,185,150,95,67,29,15],[240,225,210,195,185,165,140,88,62,27,14],[195,185,175,165,155,145,125,81,57,26,14],[154,142,135,127,121,111,102,71,54,25,13],[119,111,105,100,94,88,82,61,50,24,13],[89,83,79,75,71,66,62,53,44,23,12],[67,63,60,57,54,49,46,41,36,21,11]],
    "4.00": [[535,460,435,405,375,280,210,137,92,39,19],[460,420,400,375,345,265,200,129,88,37,17],[420,390,370,345,315,250,190,119,82,35,16],[375,340,320,300,275,235,180,109,77,32,16],[305,285,270,255,235,205,170,103,72,29,15],[250,235,220,205,190,175,150,95,66,28,15],[195,185,175,165,155,145,125,81,61,26,14],[158,148,139,132,123,115,105,70,56,25,14],[113,106,100,95,90,84,77,58,48,24,13],[81,77,74,71,68,64,61,47,39,22,12]],
    "5.00": [[750,635,600,570,490,375,270,146,105,43,20],[630,580,550,525,455,350,250,139,95,40,18],[565,535,510,485,430,320,235,129,89,38,17],[500,470,445,425,365,295,220,124,84,36,17],[420,385,365,335,300,250,205,118,81,33,16],[325,300,275,255,235,210,180,107,77,30,16],[250,230,215,200,185,175,160,97,70,28,15],[195,185,175,165,155,145,135,88,65,27,15],[150,140,135,130,125,120,110,71,56,24,14],[115,110,105,95,90,85,80,61,46,23,13]],
    "10.00": [[1320,1075,990,920,795,575,410,205,124,53,23],[1070,965,905,835,725,535,390,195,117,50,22],[945,885,835,765,665,495,365,185,111,48,21],[790,745,695,650,575,460,340,170,106,46,20],[655,610,570,530,465,395,305,160,101,44,19],[510,475,440,405,370,330,260,150,97,42,18],[395,370,345,315,285,255,220,135,91,40,17],[315,295,275,250,230,210,185,120,86,38,16],[230,215,205,190,175,160,140,105,77,36,16],[175,165,155,145,135,125,115,90,64,33,15]],
  },
};

function rapLookup(rapData, weight, color, clarity, isRound) {
  const tables = isRound ? rapData.rounds : rapData.fancy;
  if (!tables) return null;
  const effectiveWeight = Math.min(weight, 5.0); // 5ct+ capped at 5ct pricing
  let bracket = RAP_WEIGHT_RANGES[0];
  for (let i = 0; i < RAP_RANGE_MINS.length; i++) {
    if (effectiveWeight >= RAP_RANGE_MINS[i]) bracket = RAP_WEIGHT_RANGES[i];
  }
  const table = tables[bracket];
  if (!table) return null;
  // FL maps to IF row
  const clar = clarity === "FL" ? "IF" : clarity;
  const ci = RAP_CLARITIES.indexOf(clar);
  const ki = RAP_COLORS.indexOf(color);
  if (ci < 0 || ki < 0 || !table[ci]) return null;
  return (table[ci][ki] ?? null);
}

const FANCY_SHAPES = ["Oval","Princess","Cushion","Pear","Marquise","Emerald","Radiant","Asscher","Heart","Trillion","Baguette","Tapered Baguette","Rose Cut","Old Mine Cut","Old European Cut","Briolette","Bullet","Half Moon","Kite","Shield","Trapezoid"];
const ALL_SHAPES = ["Round", ...FANCY_SHAPES];
// Purity options — rateKey maps to live rate field; null = manual
const PURITIES = [
  { l: "22kt (91.6%)", rateKey: "g22" },
  { l: "18kt (75%)",   rateKey: "g18" },
  { l: "14kt (58.5%)", rateKey: "g14" },
  { l: "9kt (37.5%)",  rateKey: "g9"  },
  { l: "24kt (99.5%)", rateKey: "g24" },
  { l: "Custom ₹/g",   rateKey: null  },
];

// Parse per-gram gold rates + USD from live rates sheet.
// Sheet columns: row.gold = col A, row.estimated = col B, row[""] = col C
// Gold rates in col B. USD/INR: label "USD" in col C (C36), live value in col C next row (C37).
function parseLiveRatesForCalc(rows) {
  const out = { g24: null, g22: null, g18: null, g14: null, g9: null, usd: null };
  const isNum = v => typeof v === "number" && !isNaN(v);
  let nextColCisUSD = false;
  for (const r of rows) {
    const lbl = String(r.gold || "").trim();
    const est = r.estimated;
    const colC = r[""];
    if (lbl === "24KT 995" && isNum(est)) { out.g24 = est; nextColCisUSD = false; continue; }
    if (lbl === "22 KT"    && isNum(est)) { out.g22 = est; nextColCisUSD = false; continue; }
    if (lbl === "18KT"     && isNum(est)) { out.g18 = est; nextColCisUSD = false; continue; }
    if (lbl === "14KT"     && isNum(est)) { out.g14 = est; nextColCisUSD = false; continue; }
    if (lbl === "9 KT"     && isNum(est)) { out.g9  = est; nextColCisUSD = false; continue; }
    // C36 = "USD" label → C37 = live rate (next row, same col C)
    if (nextColCisUSD && isNum(colC) && colC > 50 && colC < 200) {
      out.usd = colC;
      nextColCisUSD = false;
      continue;
    }
    nextColCisUSD = /usd/i.test(String(colC || ""));
  }
  return out;
}

function newSolRow() {
  return { id: Date.now() + Math.random(), cert: "IGI", color: "H", shape: "Round", clarity: "VS1", cut: "Excellent", weight: "", buyDisc: "", sellDisc: "", vendorCode: "", purchasePrice: "", notes: "", manualPrice: "" };
}

function CalculatorScreen({ funnels = [], allTags = [] }) {
  const [tab, setTab] = useState("jewellery");
  const [rapData, setRapData] = useState(RAP_SEED);
  const [rapAge, setRapAge] = useState(null);
  const [liveRates, setLiveRates] = useState({ g24: null, g22: null, g18: null, g14: null, g9: null, usd: null });
  const [usdInr, setUsdInr] = useState("");
  const [spread, setSpread] = useState(() => { try { return Number(localStorage.getItem("rap_spread") || 8); } catch { return 8; } });
  const [makingMode, setMakingMode] = useState(() => { try { return localStorage.getItem("making_mode") || "per_g"; } catch { return "per_g"; } });
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveModal, setSaveModal] = useState(false);
  const [editingEstId, setEditingEstId] = useState(null);
  const [editingEstOrig, setEditingEstOrig] = useState(null);
  const [walkinOpen, setWalkinOpen] = useState(false);
  const [walkinPrefill, setWalkinPrefill] = useState(null);
  const [activeVisitId, setActiveVisitId] = useState(null);
  const [activeVisitClient, setActiveVisitClient] = useState(null);
  const [activeVisitTime, setActiveVisitTime] = useState(null);
  const [saveContact, setSaveContact] = useState(() => { try { const s = localStorage.getItem("calc_active_contact"); return s ? JSON.parse(s) : null; } catch { return null; } });
  const [contactSearch, setContactSearch] = useState(() => { try { const s = localStorage.getItem("calc_active_contact"); if (s) { const c = JSON.parse(s); return c.name + (c.phone ? ` (${c.phone})` : ""); } } catch {} return ""; });
  const [contactResults, setContactResults] = useState([]);
  const [recentEstimates, setRecentEstimates] = useState([]);
  const [clientHistory, setClientHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [pendingFollowups, setPendingFollowups] = useState([]);
  const [addClientMode, setAddClientMode] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [syncPending, setSyncPending] = useState(0);
  const user = loadUser();

  const EST_QUEUE = "calc_est_queue";
  const queueEstimate = (payload) => {
    try {
      const q = JSON.parse(localStorage.getItem(EST_QUEUE) || "[]");
      const item = { ...payload, _qid: Date.now() + "_" + Math.random().toString(36).slice(2), _synced: false, _queuedAt: new Date().toISOString() };
      localStorage.setItem(EST_QUEUE, JSON.stringify([...q, item]));
      setSyncPending(q.filter(e => !e._synced).length + 1);
      return item._qid;
    } catch { return null; }
  };
  const syncQueue = async () => {
    try {
      const q = JSON.parse(localStorage.getItem(EST_QUEUE) || "[]");
      const unsynced = q.filter(e => !e._synced);
      if (!unsynced.length) return;
      let updated = [...q];
      for (const item of unsynced) {
        const { _qid, _synced, _queuedAt, ...payload } = item;
        const { error } = await sb.from("bullion_estimates").insert(payload);
        if (!error) updated = updated.map(e => e._qid === _qid ? { ...e, _synced: true } : e);
      }
      const keep = updated.filter(e => !e._synced).concat(updated.filter(e => e._synced).slice(-100));
      localStorage.setItem(EST_QUEUE, JSON.stringify(keep));
      setSyncPending(keep.filter(e => !e._synced).length);
    } catch {}
  };

  // Jewellery state
  const [jw, setJw] = useState({
    itemImage: "", itemName: "", vendorCode: "", grossWt: "", purityIdx: 2, customPurity: "", goldRateOverride: "", applyGst: true,
    makingRatePg: "1500", makingRatePct: "15", dia1Wt: "", dia1Unit: "ct", dia1Rate: "",
    dia2Wt: "", dia2Unit: "ct", dia2Rate: "",
    stoneWt: "", stoneUnit: "ct", stoneRate: "",
    misc1Lbl: "Gemstone", misc1Wt: "", misc1Unit: "g", misc1Rate: "", misc1Deduct: true,
    misc2Lbl: "Mala",     misc2Wt: "", misc2Unit: "g", misc2Rate: "", misc2Deduct: false,
    misc3Lbl: "Lakh",     misc3Wt: "", misc3Unit: "g", misc3Rate: "", misc3Deduct: false,
  });

  // Solitaire (single stone) state
  const [sol, setSol] = useState({ ...newSolRow(), includeGold: false, goldGrossWt: "", goldPurityIdx: 2, goldCustomPurity: "", goldRateOverride: "", goldMakingRatePg: "1500", goldMakingRatePct: "15", settingDiaWt: "", settingDiaRate: "", settingGemVal: "", applyGst: true });

  // Quotation sheet (multi-stone) state
  const [rows, setRows] = useState([newSolRow()]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  // Load Rapaport from DB
  useEffect(() => {
    sb.from("bullion_dropdowns").select("value,updated_at").eq("field", "rapaport_data").maybeSingle().then(({ data }) => {
      if (data?.value) {
        try {
          const parsed = JSON.parse(data.value);
          setRapData(parsed);
          const updated = new Date(data.updated_at || parsed.updated_at || 0);
          const ageDays = Math.floor((Date.now() - updated.getTime()) / 86400000);
          setRapAge(ageDays);
        } catch { /* use seed */ }
      }
    });
    // Load live rates
    fetch(`${APPS_SCRIPT_URL}?action=rates`).then(r => r.json()).then(d => {
      const rows2 = d.rates || d.rows || [];
      const parsed = parseLiveRatesForCalc(rows2);
      setLiveRates(parsed);
      if (parsed.usd) setUsdInr(String(parsed.usd));
    }).catch(() => {});
    // Load recent estimates
    sb.from("bullion_estimates").select("id,mode,total_amount,created_at,items,lead_id,metadata,bullion_leads(name,phone)").order("created_at", { ascending: false }).limit(8).then(({ data }) => setRecentEstimates(data || []));
    // Load pending follow-ups (estimates with linked contact, last 30 days)
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    sb.from("bullion_estimates").select("id,mode,total_amount,created_at,lead_id,items,bullion_leads(name,phone)").not("lead_id", "is", null).gte("created_at", since).order("created_at", { ascending: false }).limit(60).then(({ data }) => setPendingFollowups(data || []));
    // Sync any locally queued estimates that failed to reach DB
    try {
      const q = JSON.parse(localStorage.getItem("calc_est_queue") || "[]");
      setSyncPending(q.filter(e => !e._synced).length);
    } catch {}
    syncQueue();
    // Load store staff for "attended by" dropdown
    sb.from("staff").select("id,name").order("name").then(({ data }) => setCalcStaff(data || []));
  }, []);

  const saveSpread = (v) => { setSpread(v); try { localStorage.setItem("rap_spread", v); } catch { } };
  const saveMakingMode = (v) => { setMakingMode(v); try { localStorage.setItem("making_mode", v); } catch { } };

  // ── Jewellery calculations ──
  const ctToG = (w, unit) => unit === "ct" ? parseFloat(w || 0) * 0.2 : parseFloat(w || 0);
  // Get per-gram gold rate for current purity — live rate is already purity-adjusted
  const getGoldRatePg = (purityIdx, override) => {
    if (override) return parseFloat(override);
    const key = PURITIES[purityIdx]?.rateKey;
    return key ? (liveRates[key] || 0) : 0;
  };

  const jwCalc = (() => {
    const gross = parseFloat(jw.grossWt || 0);
    const gRate = getGoldRatePg(jw.purityIdx, jw.goldRateOverride);
    const d1g = ctToG(jw.dia1Wt, jw.dia1Unit);
    const d2g = ctToG(jw.dia2Wt, jw.dia2Unit);
    const stg = ctToG(jw.stoneWt, jw.stoneUnit);
    const misc1g = jw.misc1Deduct ? ctToG(jw.misc1Wt, jw.misc1Unit) : 0;
    const misc2g = jw.misc2Deduct ? ctToG(jw.misc2Wt, jw.misc2Unit) : 0;
    const misc3g = jw.misc3Deduct ? ctToG(jw.misc3Wt, jw.misc3Unit) : 0;
    const netGold = Math.max(0, gross - d1g - d2g - stg - misc1g - misc2g - misc3g);
    const goldVal = netGold * gRate;
    const makingR = makingMode === "per_g" ? parseFloat(jw.makingRatePg || 0) : parseFloat(jw.makingRatePct || 0);
    const making = makingMode === "per_g" ? netGold * makingR : goldVal * (makingR / 100);
    const d1raw = parseFloat(jw.dia1Wt || 0);
    const d2raw = parseFloat(jw.dia2Wt || 0);
    const straw = parseFloat(jw.stoneWt || 0);
    const diaTotal = d1raw * parseFloat(jw.dia1Rate || 0) + d2raw * parseFloat(jw.dia2Rate || 0) + straw * parseFloat(jw.stoneRate || 0);
    const miscVal = (wt, rate) => { const w = parseFloat(wt || 0), r = parseFloat(rate || 0); return w > 0 ? w * r : r; };
    const misc1Val = miscVal(jw.misc1Wt, jw.misc1Rate);
    const misc2Val = miscVal(jw.misc2Wt, jw.misc2Rate);
    const misc3Val = miscVal(jw.misc3Wt, jw.misc3Rate);
    const miscTotal = misc1Val + misc2Val + misc3Val;
    const subTotal = goldVal + making + diaTotal + miscTotal;
    const gst = jw.applyGst ? subTotal * 0.03 : 0;
    return { gross, gRate, netGold, goldVal, making, diaTotal, miscTotal, subTotal, gst, total: subTotal + gst };
  })();

  // ── Solitaire calculation ──
  const solCalc = (stone) => {
    const w = parseFloat(stone.weight || 0);
    if (stone.cert === "Non-Cert") {
      const manualPrice = parseFloat(stone.manualPrice || 0) || null;
      return { w, rap100: null, rapInrPerCt: null, buyDisc: null, sellDisc: null, buyPpc: null, sellPpc: null, buyTotal: null, sellTotal: manualPrice };
    }
    const usd = parseFloat(usdInr || 0);
    const isRound = stone.shape === "Round";
    const rap100 = rapLookup(rapData, w, stone.color, stone.clarity, isRound);
    const rapInrPerCt = rap100 !== null ? rap100 * 100 * usd : null;
    const buyDisc = parseFloat(stone.buyDisc || 0);
    const sellDisc = parseFloat(stone.sellDisc !== "" ? stone.sellDisc : (buyDisc - spread));
    const buyPpc = rapInrPerCt !== null ? rapInrPerCt * (1 - buyDisc / 100) : null;
    const sellPpc = rapInrPerCt !== null ? rapInrPerCt * (1 - sellDisc / 100) : null;
    return { w, rap100, rapInrPerCt, buyDisc, sellDisc, buyPpc, sellPpc, buyTotal: buyPpc !== null ? buyPpc * w : null, sellTotal: sellPpc !== null ? sellPpc * w : null };
  };

  const solGoldCalc = (() => {
    if (!sol.includeGold) return null;
    const gross = parseFloat(sol.goldGrossWt || 0);
    const gRate = getGoldRatePg(sol.goldPurityIdx, sol.goldRateOverride);
    const goldVal = gross * gRate;
    const solMakingR = makingMode === "per_g" ? parseFloat(sol.goldMakingRatePg || 0) : parseFloat(sol.goldMakingRatePct || 0);
    const making = makingMode === "per_g" ? gross * solMakingR : goldVal * (solMakingR / 100);
    const diaInShank = parseFloat(sol.settingDiaWt || 0) * parseFloat(sol.settingDiaRate || 0);
    const gemVal = parseFloat(sol.settingGemVal || 0);
    return { goldVal, making, diaInShank, gemVal, total: goldVal + making + diaInShank + gemVal };
  })();

  const solResult = solCalc(sol);
  const solGrandTotal = solResult.sellTotal != null
    ? solResult.sellTotal + (solGoldCalc?.total || 0)
    : null;
  const solStoneGst = sol.applyGst && solResult.sellTotal ? solResult.sellTotal * 0.015 : 0;
  const solGoldGst = sol.applyGst && sol.includeGold && solGoldCalc ? solGoldCalc.total * 0.03 : 0;
  const solTotalGst = solStoneGst + solGoldGst;
  const solFinalTotal = solGrandTotal != null ? solGrandTotal + solTotalGst : null;

  // Load history when active client changes
  useEffect(() => {
    if (!saveContact?.id) { setClientHistory([]); return; }
    sb.from("bullion_estimates").select("id,mode,total_amount,created_at,items").eq("lead_id", saveContact.id).order("created_at", { ascending: false }).limit(20).then(({ data }) => setClientHistory(data || []));
  }, [saveContact?.id]);

  // ── Search contacts for save ──
  useEffect(() => {
    if (contactSearch.length < 2) { setContactResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await sb.from("bullion_leads").select("id,name,phone").or(`name.ilike.%${contactSearch}%,phone.ilike.%${contactSearch}%`).limit(8);
      setContactResults(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [contactSearch]);

  const [attendedBy, setAttendedBy] = useState(() => localStorage.getItem("calc_attended_by") || "");
  const [calcStaff, setCalcStaff] = useState([]);

  const refreshEstLists = () => {
    sb.from("bullion_estimates").select("id,mode,total_amount,created_at,items,lead_id,metadata,bullion_leads(name,phone)").order("created_at", { ascending: false }).limit(8).then(({ data }) => setRecentEstimates(data || []));
    if (saveContact?.id) sb.from("bullion_estimates").select("id,mode,total_amount,created_at,items").eq("lead_id", saveContact.id).order("created_at", { ascending: false }).limit(20).then(({ data }) => setClientHistory(data || []));
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    sb.from("bullion_estimates").select("id,mode,total_amount,created_at,lead_id,items,bullion_leads(name,phone)").not("lead_id", "is", null).gte("created_at", since).order("created_at", { ascending: false }).limit(60).then(({ data }) => setPendingFollowups(data || []));
  };

  const saveEstimate = async () => {
    setSaving(true);
    try {
      let items = [], total = 0, mode = tab;
      if (tab === "jewellery") {
        items = [{ ...jw, ...jwCalc }];
        total = jwCalc.total;
      } else if (tab === "solitaire") {
        items = [{ ...sol, ...solResult }];
        total = solFinalTotal || solResult.sellTotal || 0;
      } else {
        items = rows.map(r => ({ ...r, ...solCalc(r) }));
        total = null;
      }

      if (editingEstId) {
        // UPDATE existing estimate + append audit log
        const origIt = (editingEstOrig?.items || [])[0] || {};
        const newIt = items[0] || {};
        const auditFields = [];
        const trackFields = ["making","goldVal","gRate","dia1Rate","dia2Rate","stoneRate","total","sellTotal","makingRatePg","makingRatePct"];
        trackFields.forEach(f => {
          const ov = origIt[f], nv = newIt[f];
          if (ov != null && nv != null && Math.round(Number(ov)) !== Math.round(Number(nv))) auditFields.push({ f, old: Math.round(Number(ov)), new: Math.round(Number(nv)) });
        });
        const existingChanges = editingEstOrig?.metadata?.changes || [];
        const newMeta = { ...(editingEstOrig?.metadata || {}), attended_by: attendedBy || null, changes: auditFields.length > 0 ? [...existingChanges, { ts: new Date().toISOString(), by: user?.name || user?.email || "unknown", fields: auditFields }] : existingChanges };
        const { error } = await sb.from("bullion_estimates").update({ items, total_amount: total || null, lead_id: saveContact?.id || editingEstOrig?.lead_id || null, metadata: newMeta }).eq("id", editingEstId);
        if (error) { showToast("❌ Update failed: " + error.message); }
        else {
          showToast("✓ Estimate updated");
          setSaveModal(false);
          setEditingEstId(null);
          setEditingEstOrig(null);
          refreshEstLists();
        }
      } else {
        // INSERT new estimate
        const payload = { lead_id: saveContact?.id || null, created_by: user?.name || user?.email, mode, items, total_amount: total || null, metadata: { attended_by: attendedBy || null }, visit_id: activeVisitId || null };
        queueEstimate(payload);
        showToast("✅ Estimate saved");
        setSaveModal(false);
        const { error: insErr } = await sb.from("bullion_estimates").insert(payload);
        if (insErr) { showToast("⚠️ Local only — will sync later"); }
        else {
          try {
            const q = JSON.parse(localStorage.getItem(EST_QUEUE) || "[]");
            const last = q[q.length - 1];
            if (last) { const updated = q.map((e, i) => i === q.length - 1 ? { ...e, _synced: true } : e); localStorage.setItem(EST_QUEUE, JSON.stringify(updated)); setSyncPending(updated.filter(e => !e._synced).length); }
          } catch {}
          refreshEstLists();
        }
      }
    } catch (e) { showToast("❌ " + e.message); }
    setSaving(false);
  };

  const sendWA = (phone, text) => {
    fetch(`${WA_SERVICE_URL}/clients/8860866000/send`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phone.replace(/\D/g, "").replace(/^0+/, "").replace(/^91/, ""), message: text }),
    }).then(r => r.json()).then(d => showToast(d.ok ? "✅ Sent on WhatsApp" : "❌ " + (d.error || "WA failed"))).catch(e => showToast("❌ " + e.message));
  };

  const fmt = (n) => n == null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN");
  const inp = { padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, width: "100%", boxSizing: "border-box" };
  const lbl = { fontSize: 11, color: "#888", marginBottom: 3, display: "block" };
  const card = { background: "#fff", border: "1px solid #eee", borderRadius: 10, padding: "16px", marginBottom: 12 };
  const tabBtn = (k, ico, txt) => (
    <button key={k} onClick={() => setTab(k)} style={{ padding: "7px 18px", borderRadius: 8, border: `1px solid ${tab === k ? C.blue : "#ddd"}`, background: tab === k ? C.blue : "#fff", color: tab === k ? "#fff" : "#333", fontWeight: tab === k ? 600 : 400, cursor: "pointer", fontSize: 13 }}>{ico} {txt}</button>
  );

  const resultRow = (label, val, highlight) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #f5f5f5", fontWeight: highlight ? 700 : 400, color: highlight ? C.blue : "#333" }}>
      <span style={{ fontSize: 13, color: highlight ? C.blue : "#666" }}>{label}</span>
      <span style={{ fontSize: 13 }}>{val}</span>
    </div>
  );

  // ── JEWELLERY TAB ──
  const [jwImgUploading, setJwImgUploading] = useState(false);
  const jwImgRef = useRef();

  const handleJwImagePick = async (file) => {
    if (!file) return;
    setJwImgUploading(true);
    try {
      const { publicUrl } = await secureImageUpload(file, sb, "estimates", { maxDim: 800, quality: 0.6 });
      setJw(p => ({ ...p, itemImage: publicUrl }));
    } catch (e) {
      alert(e.message);
    } finally {
      setJwImgUploading(false);
    }
  };

  const handleJwPrint = () => {
    const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
    const purityLabel = PURITIES[jw.purityIdx]?.l || "Custom";
    const rows = [];
    const row = (label, value) => `<tr><td style="padding:3px 6px;color:#444;font-size:13px;">${label}</td><td style="padding:3px 6px;text-align:right;font-size:13px;">${value}</td></tr>`;

    rows.push(row("Purity", purityLabel));
    rows.push(row("Gross Weight", `${parseFloat(jw.grossWt||0).toFixed(3)} g`));
    rows.push(row("Net Gold Weight", `${jwCalc.netGold.toFixed(3)} g`));
    rows.push(row("Gold Rate", `₹${Math.round(jwCalc.gRate).toLocaleString("en-IN")}/g`));
    rows.push(row("Gold Value", fmt(jwCalc.goldVal)));
    rows.push(row(`Making`, fmt(jwCalc.making)));
    if (parseFloat(jw.dia1Wt||0)) rows.push(row(`Diamond 1 (${parseFloat(jw.dia1Wt)}${jw.dia1Unit} @ ₹${jw.dia1Rate})`, fmt(parseFloat(jw.dia1Wt||0)*parseFloat(jw.dia1Rate||0))));
    if (parseFloat(jw.dia2Wt||0)) rows.push(row(`Diamond 2 (${parseFloat(jw.dia2Wt)}${jw.dia2Unit} @ ₹${jw.dia2Rate})`, fmt(parseFloat(jw.dia2Wt||0)*parseFloat(jw.dia2Rate||0))));
    if (parseFloat(jw.stoneWt||0)) rows.push(row(`Stone (${parseFloat(jw.stoneWt)}${jw.stoneUnit} @ ₹${jw.stoneRate})`, fmt(parseFloat(jw.stoneWt||0)*parseFloat(jw.stoneRate||0))));
    [["misc1","misc1Lbl","misc1Wt","misc1Unit","misc1Rate"],["misc2","misc2Lbl","misc2Wt","misc2Unit","misc2Rate"],["misc3","misc3Lbl","misc3Wt","misc3Unit","misc3Rate"]].forEach(([,lk,wk,uk,rk]) => {
      const mw = parseFloat(jw[wk]||0), mr = parseFloat(jw[rk]||0);
      if (!mr) return;
      const mv = mw > 0 ? mw * mr : mr;
      const mlabel = mw > 0 ? `${jw[lk]||"Misc"} (${mw}${jw[uk]})` : (jw[lk]||"Misc");
      rows.push(row(mlabel, fmt(mv)));
    });

    const clientName = saveContact?.name || saveContact?.phone || "";
    const html = `<!DOCTYPE html><html><head><title>Estimate</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Georgia', serif; background: #fff; color: #222; }
  @page { size: A5 portrait; margin: 15mm; }
  .wrap { max-width: 400px; margin: 0 auto; }
  .om { font-size: 32px; color: #8b6914; text-align: center; margin-bottom: 4px; }
  .title { font-size: 20px; letter-spacing: 3px; text-align: center; font-weight: bold; margin-bottom: 2px; }
  .date { font-size: 12px; color: #666; text-align: center; margin-bottom: 4px; }
  .client { font-size: 13px; color: #333; text-align: center; margin-bottom: 10px; font-style: italic; }
  .item-header { display: flex; align-items: center; gap: 10px; margin: 8px 0 6px; }
  .item-img { width: 52px; height: 52px; object-fit: cover; border-radius: 5px; cursor: pointer; border: 1px solid #ddd; flex-shrink: 0; }
  .item-name { font-size: 15px; font-weight: bold; }
  hr { border: none; border-top: 1px solid #bbb; margin: 8px 0; }
  hr.thick { border-top: 2px solid #333; }
  table { width: 100%; border-collapse: collapse; }
  .total-row td { padding: 5px 6px; font-size: 16px; font-weight: bold; border-top: 2px solid #333; }
  .disclaimer { font-size: 10px; color: #888; text-align: center; margin-top: 14px; line-height: 1.7; }
</style>
<script>
  function expandImg(src) {
    var w=window.open('','_blank','width=600,height=600');
    w.document.write('<body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="'+src+'" style="max-width:100%;max-height:100vh;object-fit:contain"/></body>');
    w.document.close();
  }
</script>
</head><body>
<div class="wrap">
  <div class="om">ॐ</div>
  <div class="title">ESTIMATE</div>
  <div class="date">${today}</div>
  ${clientName ? `<div class="client">Prepared for: ${clientName}</div>` : ""}
  <hr class="thick"/>
  <div class="item-header">
    ${jw.itemImage ? `<img class="item-img" src="${jw.itemImage}" alt="item" onclick="expandImg('${jw.itemImage}')"/>` : ""}
    ${jw.itemName ? `<div class="item-name">${jw.itemName}</div>` : ""}
  </div>
  <table>${rows.join("")}
  ${jw.applyGst ? `<tr><td style="padding:3px 6px;font-size:13px;color:#555;">GST @ 3%</td><td style="padding:3px 6px;text-align:right;font-size:13px;">${fmt(jwCalc.gst)}</td></tr>` : ""}
  <tr class="total-row"><td>GRAND TOTAL</td><td style="text-align:right;">${fmt(jwCalc.total)}</td></tr>
  </table>
  <div class="disclaimer">This is an estimate only · Gold rates apply on full payment · Not a final bill
  </div>
</div>
</body></html>`;

    const win = window.open("", "_blank", "width=600,height=800");
    win.document.write(html);
    win.document.close();
    win.onload = () => { win.print(); win.close(); };
  };

  const handleSolPrint = () => {
    const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
    const clientName = saveContact?.name || saveContact?.phone || "";
    const row = (label, value) => `<tr><td style="padding:3px 6px;color:#444;font-size:13px;">${label}</td><td style="padding:3px 6px;text-align:right;font-size:13px;">${value}</td></tr>`;
    const rows = [];
    rows.push(row("Shape", sol.shape));
    rows.push(row("Weight", `${sol.weight} ct`));
    rows.push(row("Colour / Clarity", `${sol.color} / ${sol.clarity}`));
    rows.push(row("Cut", sol.cut));
    rows.push(row("Certificate", sol.cert));
    if (solResult.sellPpc != null) rows.push(row("Sell Price/ct", fmt(solResult.sellPpc)));
    rows.push(row("Stone Total", solResult.sellTotal != null ? fmt(solResult.sellTotal) : "—"));
    if (sol.includeGold && solGoldCalc) {
      rows.push(row("Gold + Making", fmt(solGoldCalc.goldVal + solGoldCalc.making)));
      if (solGoldCalc.diaInShank > 0) rows.push(row("Diamond in Shank", fmt(solGoldCalc.diaInShank)));
      if (solGoldCalc.gemVal > 0) rows.push(row("Gemstone / Other", fmt(solGoldCalc.gemVal)));
      rows.push(row("Setting Total", fmt(solGoldCalc.total)));
    }
    const html = `<!DOCTYPE html><html><head><title>Estimate</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Georgia', serif; background: #fff; color: #222; }
  @page { size: A5 portrait; margin: 15mm; }
  .wrap { max-width: 400px; margin: 0 auto; }
  .om { font-size: 32px; color: #8b6914; text-align: center; margin-bottom: 4px; }
  .title { font-size: 20px; letter-spacing: 3px; text-align: center; font-weight: bold; margin-bottom: 2px; }
  .date { font-size: 12px; color: #666; text-align: center; margin-bottom: 4px; }
  .client { font-size: 13px; color: #333; text-align: center; margin-bottom: 10px; font-style: italic; }
  hr { border: none; border-top: 1px solid #bbb; margin: 8px 0; }
  hr.thick { border-top: 2px solid #333; }
  table { width: 100%; border-collapse: collapse; }
  .total-row td { padding: 5px 6px; font-size: 16px; font-weight: bold; border-top: 2px solid #333; }
  .disclaimer { font-size: 10px; color: #888; text-align: center; margin-top: 14px; line-height: 1.7; }
</style></head><body>
<div class="wrap">
  <div class="om">ॐ</div>
  <div class="title">ESTIMATE</div>
  <div class="date">${today}</div>
  ${clientName ? `<div class="client">Prepared for: ${clientName}</div>` : ""}
  <hr class="thick"/>
  <table>${rows.join("")}
  ${sol.applyGst && solResult.sellTotal != null ? `<tr><td style="padding:3px 6px;font-size:13px;color:#555;">GST @ 1.5% (stone)</td><td style="padding:3px 6px;text-align:right;font-size:13px;">${fmt(solStoneGst)}</td></tr>` : ""}
  ${sol.applyGst && sol.includeGold && solGoldCalc ? `<tr><td style="padding:3px 6px;font-size:13px;color:#555;">GST @ 3% (gold setting)</td><td style="padding:3px 6px;text-align:right;font-size:13px;">${fmt(solGoldGst)}</td></tr>` : ""}
  <tr class="total-row"><td>GRAND TOTAL</td><td style="text-align:right;">${fmt(solFinalTotal)}</td></tr>
  </table>
  <div class="disclaimer">This is an estimate only · Gold rates apply on full payment · Not a final bill
  </div>
</div>
</body></html>`;
    const win = window.open("", "_blank", "width=600,height=800");
    win.document.write(html);
    win.document.close();
    win.onload = () => { win.print(); win.close(); };
  };

  const handleQuotPrint = () => {
    const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
    const clientName = saveContact?.name || saveContact?.phone || "";
    const stoneRows = rows.map((r, i) => {
      const sc = solCalc(r);
      return `<tr style="border-bottom:1px solid #eee;">
        <td style="padding:4px 6px;font-size:12px;color:#888;">${i + 1}</td>
        <td style="padding:4px 6px;font-size:12px;">${r.shape}</td>
        <td style="padding:4px 6px;font-size:12px;">${r.weight} ct</td>
        <td style="padding:4px 6px;font-size:12px;">${r.color} / ${r.clarity}</td>
        <td style="padding:4px 6px;font-size:12px;">${r.cert}</td>
        <td style="padding:4px 6px;font-size:12px;text-align:right;font-weight:600;">${sc.sellTotal != null ? fmt(sc.sellTotal) : "—"}</td>
      </tr>`;
    }).join("");
    const html = `<!DOCTYPE html><html><head><title>Quotation</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Georgia', serif; background: #fff; color: #222; }
  @page { size: A5 portrait; margin: 12mm; }
  .wrap { max-width: 500px; margin: 0 auto; }
  .om { font-size: 28px; color: #8b6914; text-align: center; margin-bottom: 4px; }
  .title { font-size: 18px; letter-spacing: 3px; text-align: center; font-weight: bold; margin-bottom: 2px; }
  .date { font-size: 12px; color: #666; text-align: center; margin-bottom: 4px; }
  .client { font-size: 13px; color: #333; text-align: center; margin-bottom: 10px; font-style: italic; }
  hr { border: none; border-top: 1px solid #bbb; margin: 8px 0; }
  hr.thick { border-top: 2px solid #333; }
  table { width: 100%; border-collapse: collapse; }
  th { padding: 5px 6px; font-size: 11px; color: #555; text-align: left; border-bottom: 2px solid #333; font-weight: 600; }
  th:last-child { text-align: right; }
  .disclaimer { font-size: 10px; color: #888; text-align: center; margin-top: 14px; line-height: 1.7; }
</style></head><body>
<div class="wrap">
  <div class="om">ॐ</div>
  <div class="title">QUOTATION</div>
  <div class="date">${today}</div>
  ${clientName ? `<div class="client">Prepared for: ${clientName}</div>` : ""}
  <hr class="thick"/>
  <table>
    <thead><tr>
      <th>#</th><th>Shape</th><th>Weight</th><th>Colour/Clarity</th><th>Cert</th><th style="text-align:right;">Price</th>
    </tr></thead>
    <tbody>${stoneRows}</tbody>
  </table>
  <div class="disclaimer">This is an estimate only · Prices subject to change · Not a final bill</div>
</div>
</body></html>`;
    const win = window.open("", "_blank", "width=600,height=800");
    win.document.write(html);
    win.document.close();
    win.onload = () => { win.print(); win.close(); };
  };

  const loadEstimateForEdit = (est) => {
    const it = (est.items || [])[0] || {};
    if (est.mode === "jewellery") {
      setJw({
        itemImage: it.itemImage || "", itemName: it.itemName || "", vendorCode: it.vendorCode || "",
        grossWt: it.grossWt || "", purityIdx: it.purityIdx ?? 2, customPurity: it.customPurity || "",
        goldRateOverride: it.gRate ? String(Math.round(it.gRate)) : "",
        applyGst: it.applyGst !== false,
        makingRatePg: it.makingRatePg || "1500", makingRatePct: it.makingRatePct || "15",
        dia1Wt: it.dia1Wt || "", dia1Unit: it.dia1Unit || "ct", dia1Rate: it.dia1Rate || "",
        dia2Wt: it.dia2Wt || "", dia2Unit: it.dia2Unit || "ct", dia2Rate: it.dia2Rate || "",
        stoneWt: it.stoneWt || "", stoneUnit: it.stoneUnit || "ct", stoneRate: it.stoneRate || "",
        misc1Lbl: it.misc1Lbl || "Gemstone", misc1Wt: it.misc1Wt || "", misc1Unit: it.misc1Unit || "g", misc1Rate: it.misc1Rate || "", misc1Deduct: it.misc1Deduct !== false,
        misc2Lbl: it.misc2Lbl || "Mala",     misc2Wt: it.misc2Wt || "", misc2Unit: it.misc2Unit || "g", misc2Rate: it.misc2Rate || "", misc2Deduct: it.misc2Deduct !== false,
        misc3Lbl: it.misc3Lbl || "Lakh",     misc3Wt: it.misc3Wt || "", misc3Unit: it.misc3Unit || "g", misc3Rate: it.misc3Rate || "", misc3Deduct: it.misc3Deduct !== false,
      });
      setTab("jewellery");
    } else if (est.mode === "solitaire") {
      setSol({
        cert: it.cert || "IGI", color: it.color || "H", shape: it.shape || "Round",
        clarity: it.clarity || "VS1", cut: it.cut || "Excellent", weight: it.weight || "",
        buyDisc: it.buyDisc || "", sellDisc: it.sellDisc || "",
        vendorCode: it.vendorCode || "", purchasePrice: it.purchasePrice || "",
        notes: it.notes || "", manualPrice: it.manualPrice || "",
        includeGold: it.includeGold || false,
        goldGrossWt: it.goldGrossWt || "", goldPurityIdx: it.goldPurityIdx ?? 2,
        goldCustomPurity: it.goldCustomPurity || "",
        goldRateOverride: it.gRate ? String(Math.round(it.gRate)) : "",
        goldMakingRatePg: it.goldMakingRatePg || "1500", goldMakingRatePct: it.goldMakingRatePct || "15",
        settingDiaWt: it.settingDiaWt || "", settingDiaRate: it.settingDiaRate || "",
        settingGemVal: it.settingGemVal || "", applyGst: it.applyGst !== false,
      });
      setTab("solitaire");
    } else {
      setRows((est.items || []).map(r => ({ ...newSolRow(), ...r })));
      setTab("quotation");
    }
    if (est.bullion_leads) {
      const c = { id: est.lead_id, name: est.bullion_leads.name, phone: est.bullion_leads.phone };
      setSaveContact(c);
      setContactSearch(c.name + (c.phone ? ` (${c.phone})` : ""));
      try { localStorage.setItem("calc_active_contact", JSON.stringify(c)); } catch {}
    }
    if (est.metadata?.attended_by) setAttendedBy(est.metadata.attended_by);
    setEditingEstId(est.id);
    setEditingEstOrig(est);
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast("✏️ Estimate loaded — make changes and tap Update");
  };

  const openEstimateSlip = (est) => {
    const it = (est.items || [])[0] || {};
    const clientName = est.bullion_leads?.name || est._clientName || "";
    const date = new Date(est.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
    const fmtN = (n) => n != null ? `₹${Math.round(n).toLocaleString("en-IN")}` : "—";
    const row = (label, value) => `<tr><td style="padding:3px 6px;color:#444;font-size:13px;">${label}</td><td style="padding:3px 6px;text-align:right;font-size:13px;">${value}</td></tr>`;
    const CSS = `* { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Georgia', serif; background: #fff; color: #222; }
  @page { size: A5 portrait; margin: 15mm; }
  .wrap { max-width: 400px; margin: 0 auto; padding: 12px; }
  .om { font-size: 32px; color: #8b6914; text-align: center; margin-bottom: 4px; }
  .title { font-size: 20px; letter-spacing: 3px; text-align: center; font-weight: bold; margin-bottom: 2px; }
  .date { font-size: 12px; color: #666; text-align: center; margin-bottom: 4px; }
  .client { font-size: 13px; color: #333; text-align: center; margin-bottom: 10px; font-style: italic; }
  .item-header { display: flex; align-items: center; gap: 10px; margin: 8px 0 6px; }
  .item-img { width: 52px; height: 52px; object-fit: cover; border-radius: 5px; cursor: pointer; border: 1px solid #ddd; flex-shrink: 0; }
  .item-name { font-size: 15px; font-weight: bold; }
  hr { border: none; border-top: 1px solid #bbb; margin: 8px 0; }
  hr.thick { border-top: 2px solid #333; }
  table { width: 100%; border-collapse: collapse; }
  th { padding: 5px 6px; font-size: 11px; color: #555; text-align: left; border-bottom: 2px solid #333; font-weight: 600; }
  th:last-child { text-align: right; }
  .total-row td { padding: 5px 6px; font-size: 16px; font-weight: bold; border-top: 2px solid #333; }
  .disclaimer { font-size: 10px; color: #888; text-align: center; margin-top: 14px; }
  .btnrow { display: flex; gap: 8px; margin-top: 12px; justify-content: center; flex-wrap: wrap; }
  .printbtn { padding: 8px 20px; background: #333; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .recalcbtn { padding: 8px 20px; background: #1565c0; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; }
  @media print { .btnrow { display: none; } }`;
    let body = "";
    let extraScript = "";
    if (est.mode === "jewellery") {
      const todayRate = Math.round(liveRates[PURITIES[it.purityIdx]?.rateKey] || 0);
      const netGold = parseFloat(it.netGold || 0);
      const making = parseFloat(it.making || 0);
      const diaTotal = parseFloat(it.diaTotal || 0);
      const miscTotal = parseFloat(it.miscTotal || 0);
      const applyGst = it.applyGst ? 1 : 0;
      const dRows = [];
      dRows.push(row("Purity", PURITIES[it.purityIdx]?.l || "Custom"));
      if (it.grossWt) dRows.push(row("Gross Weight", `${parseFloat(it.grossWt||0).toFixed(3)} g`));
      if (it.netGold != null) dRows.push(row("Net Gold Weight", `${netGold.toFixed(3)} g`));
      if (it.gRate > 0) dRows.push(row("Gold Rate", `₹${Math.round(it.gRate).toLocaleString("en-IN")}/g`));
      if (it.goldVal > 0) dRows.push(row("Gold Value", fmtN(it.goldVal)));
      if (making > 0) dRows.push(row("Making", fmtN(making)));
      if (parseFloat(it.dia1Wt||0) > 0 && it.dia1Rate > 0) dRows.push(row(`Diamond 1 (${parseFloat(it.dia1Wt)}${it.dia1Unit} @ ₹${it.dia1Rate})`, fmtN(parseFloat(it.dia1Wt||0)*parseFloat(it.dia1Rate||0))));
      if (parseFloat(it.dia2Wt||0) > 0 && it.dia2Rate > 0) dRows.push(row(`Diamond 2 (${parseFloat(it.dia2Wt)}${it.dia2Unit} @ ₹${it.dia2Rate})`, fmtN(parseFloat(it.dia2Wt||0)*parseFloat(it.dia2Rate||0))));
      if (parseFloat(it.stoneWt||0) > 0 && it.stoneRate > 0) dRows.push(row(`Stone (${parseFloat(it.stoneWt)}${it.stoneUnit} @ ₹${it.stoneRate})`, fmtN(parseFloat(it.stoneWt||0)*parseFloat(it.stoneRate||0))));
      [["misc1Lbl","misc1Wt","misc1Unit","misc1Rate"],["misc2Lbl","misc2Wt","misc2Unit","misc2Rate"],["misc3Lbl","misc3Wt","misc3Unit","misc3Rate"]].forEach(([lk,wk,uk,rk]) => {
        const mr = parseFloat(it[rk]||0); if (!mr) return;
        const mw = parseFloat(it[wk]||0);
        dRows.push(row(mw > 0 ? `${it[lk]||"Misc"} (${mw}${it[uk]})` : (it[lk]||"Misc"), fmtN(mw > 0 ? mw*mr : mr)));
      });
      const recalcBtnHtml = todayRate > 0 ? `<button class="recalcbtn" onclick="recalcToday()">📊 New estimate — today's rate (₹${todayRate.toLocaleString("en-IN")}/g)</button>` : "";
      body = `<div class="om">ॐ</div><div class="title">ESTIMATE</div><div class="date">${date}</div>${clientName ? `<div class="client">Prepared for: ${clientName}</div>` : ""}<hr class="thick"/>
      <div class="item-header">${it.itemImage ? `<img class="item-img" src="${it.itemImage}" alt="item" onclick="expandImg('${it.itemImage}')"/>` : ""}${it.itemName ? `<div class="item-name">${it.itemName}</div>` : ""}</div>
      <table>${dRows.join("")}${it.applyGst && it.gst > 0 ? row("GST @ 3%", fmtN(it.gst)) : ""}<tr class="total-row"><td>GRAND TOTAL</td><td style="text-align:right;">${fmtN(est.total_amount)}</td></tr></table>
      <div class="disclaimer">This is an estimate only · Gold rates apply on full payment · Not a final bill</div>
      <div class="btnrow"><button class="printbtn" onclick="window.print()">🖨️ Print</button>${recalcBtnHtml}</div>`;
      extraScript = `
var TODAY_RATE=${todayRate},NET_GOLD=${netGold},MAKING=${making},DIA_TOTAL=${diaTotal},MISC_TOTAL=${miscTotal},APPLY_GST=${applyGst};
var CLIENT="${clientName.replace(/"/g,"'")}",IMG="${(it.itemImage||"").replace(/"/g,"'")}",INAME="${(it.itemName||"").replace(/"/g,"'")}",PURITY="${(PURITIES[it.purityIdx]?.l||"Custom").replace(/"/g,"'")}",GWGT="${(it.grossWt||"").toString().replace(/"/g,"'")}",NGWGT="${netGold.toFixed(3)}";
var MAKING_LBL="Making",DIA1="${it.dia1Wt||""}",DIA1U="${it.dia1Unit||""}",DIA1R="${it.dia1Rate||""}",DIA2="${it.dia2Wt||""}",DIA2U="${it.dia2Unit||""}",DIA2R="${it.dia2Rate||""}",STW="${it.stoneWt||""}",STU="${it.stoneUnit||""}",STR="${it.stoneRate||""}";
function fmtR(n){return n==null?"—":"₹"+Math.round(n).toLocaleString("en-IN");}
function recalcToday(){
  if(!TODAY_RATE){alert("Live rate not loaded");return;}
  var newGoldVal=NET_GOLD*TODAY_RATE,subT=newGoldVal+MAKING+DIA_TOTAL+MISC_TOTAL,newGst=APPLY_GST?subT*0.03:0,newTotal=subT+newGst;
  var td=new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"long",year:"numeric"});
  var r=function(l,v){return "<tr><td style='padding:3px 6px;color:#444;font-size:13px;'>"+l+"</td><td style='padding:3px 6px;text-align:right;font-size:13px;'>"+v+"</td></tr>";};
  var rows=[r("Purity",PURITY)];
  if(GWGT)rows.push(r("Gross Weight",parseFloat(GWGT).toFixed(3)+" g"));
  rows.push(r("Net Gold Weight",NGWGT+" g"));
  rows.push(r("Gold Rate","₹"+TODAY_RATE.toLocaleString("en-IN")+"/g (today)"));
  rows.push(r("Gold Value",fmtR(newGoldVal)));
  if(MAKING>0)rows.push(r(MAKING_LBL,fmtR(MAKING)));
  if(parseFloat(DIA1)>0&&DIA1R)rows.push(r("Diamond 1 ("+parseFloat(DIA1)+DIA1U+" @ ₹"+DIA1R+")",fmtR(parseFloat(DIA1)*parseFloat(DIA1R))));
  if(parseFloat(DIA2)>0&&DIA2R)rows.push(r("Diamond 2 ("+parseFloat(DIA2)+DIA2U+" @ ₹"+DIA2R+")",fmtR(parseFloat(DIA2)*parseFloat(DIA2R))));
  if(parseFloat(STW)>0&&STR)rows.push(r("Stone ("+parseFloat(STW)+STU+" @ ₹"+STR+")",fmtR(parseFloat(STW)*parseFloat(STR))));
  var gstRow=APPLY_GST&&newGst>0?r("GST @ 3%",fmtR(newGst)):"";
  var h='<!DOCTYPE html><html><head><title>Estimate</title><style>'+document.head.querySelector("style").textContent+'<\/style><\/head><body><div class="wrap"><div class="om">ॐ<\/div><div class="title">ESTIMATE<\/div><div class="date">'+td+'<\/div>'+(CLIENT?'<div class="client">Prepared for: '+CLIENT+'<\/div>':'')+'<hr class="thick"\/><div class="item-header">'+(IMG?'<img class="item-img" src="'+IMG+'" alt="item"\/>':"")+(INAME?'<div class="item-name">'+INAME+'<\/div>':"")+
  '<\/div><table>'+rows.join("")+gstRow+'<tr class="total-row"><td>GRAND TOTAL<\/td><td style="text-align:right;">'+fmtR(newTotal)+'<\/td><\/tr><\/table><div class="disclaimer">This is an estimate only · Gold rates apply on full payment · Not a final bill<\/div><div class="btnrow"><button class="printbtn" onclick="window.print()">🖨️ Print<\/button><\/div><\/div><\/body><\/html>';
  var w=window.open("","_blank","width=500,height=750");if(w){w.document.write(h);w.document.close();}
}`;
    } else if (est.mode === "solitaire") {
      const dRows = [];
      if (it.shape) dRows.push(row("Shape", it.shape));
      if (it.weight) dRows.push(row("Weight", `${it.weight} ct`));
      if (it.color || it.clarity) dRows.push(row("Colour / Clarity", `${it.color||"—"} / ${it.clarity||"—"}`));
      if (it.cut) dRows.push(row("Cut", it.cut));
      if (it.cert) dRows.push(row("Certificate", it.cert));
      if (it.sellPpc != null) dRows.push(row("Sell Price/ct", fmtN(it.sellPpc)));
      if (it.sellTotal != null) dRows.push(row("Stone Total", fmtN(it.sellTotal)));
      if (it.includeGold && (it.goldVal||0) + (it.making||0) > 0) dRows.push(row("Gold + Making", fmtN((it.goldVal||0)+(it.making||0))));
      const stoneGst = it.applyGst && it.sellTotal ? it.sellTotal * 0.015 : 0;
      const goldGst = it.applyGst && it.includeGold && it.goldVal ? ((it.goldVal||0)+(it.making||0)) * 0.03 : 0;
      body = `<div class="om">ॐ</div><div class="title">ESTIMATE</div><div class="date">${date}</div>${clientName ? `<div class="client">Prepared for: ${clientName}</div>` : ""}<hr class="thick"/>
      <table>${dRows.join("")}${stoneGst > 0 ? row("GST @ 1.5% (stone)", fmtN(stoneGst)) : ""}${goldGst > 0 ? row("GST @ 3% (gold setting)", fmtN(goldGst)) : ""}<tr class="total-row"><td>GRAND TOTAL</td><td style="text-align:right;">${fmtN(est.total_amount)}</td></tr></table>
      <div class="disclaimer">This is an estimate only · Gold rates apply on full payment · Not a final bill</div>
      <div class="btnrow"><button class="printbtn" onclick="window.print()">🖨️ Print</button></div>`;
    } else {
      const stoneRows = (est.items||[]).map((r, i) => `<tr style="border-bottom:1px solid #eee;"><td style="padding:4px 6px;font-size:12px;color:#888;">${i+1}</td><td style="padding:4px 6px;font-size:12px;">${r.shape||"—"}</td><td style="padding:4px 6px;font-size:12px;">${r.weight||"—"} ct</td><td style="padding:4px 6px;font-size:12px;">${r.color||"—"} / ${r.clarity||"—"}</td><td style="padding:4px 6px;font-size:12px;">${r.cert||"—"}</td><td style="padding:4px 6px;font-size:12px;text-align:right;font-weight:600;">${r.sellTotal != null ? fmtN(r.sellTotal) : "—"}</td></tr>`).join("");
      body = `<div class="om">ॐ</div><div class="title">QUOTATION</div><div class="date">${date}</div>${clientName ? `<div class="client">Prepared for: ${clientName}</div>` : ""}<hr class="thick"/>
      <table><thead><tr><th>#</th><th>Shape</th><th>Weight</th><th>Colour/Clarity</th><th>Cert</th><th style="text-align:right;">Price</th></tr></thead><tbody>${stoneRows}</tbody></table>
      <div class="disclaimer">This is an estimate only · Prices subject to change · Not a final bill</div>
      <div class="btnrow"><button class="printbtn" onclick="window.print()">🖨️ Print</button></div>`;
    }
    const prevChanges = est.metadata?.changes || [];
    const changeHistoryHtml = prevChanges.length > 0 ? `<div style="margin-top:12px;border-top:1px solid #eee;padding-top:8px;"><div style="font-size:10px;font-weight:600;color:#888;margin-bottom:4px;">Edit history</div>${prevChanges.map(ch => `<div style="font-size:10px;color:#666;margin-bottom:3px;background:#fafafa;border-radius:3px;padding:3px 6px;"><strong>${ch.by||"?"}</strong> · ${new Date(ch.ts).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})} — ${(ch.fields||[]).map(f=>`${f.f}: ₹${Math.round(f.old||0).toLocaleString("en-IN")} → ₹${Math.round(f.new||0).toLocaleString("en-IN")}`).join(", ")}</div>`).join("")}</div>` : "";
    body = body.replace(`<div class="btnrow">`, changeHistoryHtml + `<div class="btnrow">`);
    const html = `<!DOCTYPE html><html><head><title>Estimate</title><style>${CSS}</style><script>function expandImg(src){var w=window.open('','_blank','width=600,height=600');w.document.write('<body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="'+src+'" style="max-width:100%;max-height:100vh;object-fit:contain"/></body>');w.document.close();}${extraScript}<\/script></head><body><div class="wrap">${body}</div></body></html>`;
    const win = window.open("", "_blank", "width=500,height=750");
    if (win) { win.document.write(html); win.document.close(); }
  };

  const jewelleryTab = (
    <div>
      {/* Item image */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div
          onClick={() => jwImgRef.current?.click()}
          style={{ width: 72, height: 72, borderRadius: 8, border: "2px dashed #ccc", cursor: "pointer", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#fafafa" }}
        >
          {jw.itemImage
            ? <img src={jw.itemImage} alt="item" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <span style={{ fontSize: 28 }}>{jwImgUploading ? "⏳" : "📷"}</span>}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Item Photo (optional)</div>
          <button style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1px solid #ccc", background: "#fff", cursor: "pointer" }} onClick={() => jwImgRef.current?.click()} disabled={jwImgUploading}>
            {jwImgUploading ? "Uploading…" : jw.itemImage ? "Change Photo" : "Add Photo"}
          </button>
          {jw.itemImage && <button style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid #fcc", background: "#fff8f8", cursor: "pointer", marginLeft: 6 }} onClick={() => setJw(p => ({ ...p, itemImage: "" }))}>✕</button>}
        </div>
        <input ref={jwImgRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleJwImagePick(e.target.files?.[0])} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div><label style={lbl}>Item Name / Tag</label><input style={inp} value={jw.itemName} onChange={e => setJw(p => ({ ...p, itemName: e.target.value }))} placeholder="e.g. Necklace S-204" /></div>
        <div><label style={lbl}>Vendor Code</label><input style={inp} value={jw.vendorCode} onChange={e => setJw(p => ({ ...p, vendorCode: e.target.value }))} placeholder="VC-123" /></div>
        <div><label style={lbl}>Gross Weight (g)</label><input style={inp} type="number" step="0.01" value={jw.grossWt} onChange={e => setJw(p => ({ ...p, grossWt: e.target.value }))} placeholder="0.00" /></div>
        <div>
          <label style={lbl}>Purity</label>
          <select style={inp} value={jw.purityIdx} onChange={e => { const idx = Number(e.target.value); setJw(p => ({ ...p, purityIdx: idx })); saveMakingMode(idx === 0 ? "pct" : "per_g"); }}>
            {PURITIES.map((p2, i) => <option key={i} value={i}>{p2.l}</option>)}
          </select>
        </div>
        {PURITIES[jw.purityIdx]?.rateKey === null && <div><label style={lbl}>Custom Rate ₹/g</label><input style={inp} type="number" step="0.01" value={jw.goldRateOverride} onChange={e => setJw(p => ({ ...p, goldRateOverride: e.target.value }))} placeholder="e.g. 13000" /></div>}
        <div>
          <label style={lbl}>
            Gold Rate ₹/g — live: {(() => { const k = PURITIES[jw.purityIdx]?.rateKey; return k && liveRates[k] ? <span style={{ color: C.green, fontWeight: 600 }}>₹{Math.round(liveRates[k]).toLocaleString("en-IN")}</span> : <span style={{ color: C.orange }}>loading…</span>; })()}
          </label>
          <input style={{ ...inp, background: jw.goldRateOverride ? "#fffbe6" : "#fff" }} type="number" step="1" value={jw.goldRateOverride} onChange={e => setJw(p => ({ ...p, goldRateOverride: e.target.value }))} placeholder={(() => { const k = PURITIES[jw.purityIdx]?.rateKey; return k && liveRates[k] ? String(Math.round(liveRates[k])) : "e.g. 13346"; })()} />
          {jw.goldRateOverride && <div style={{ fontSize: 11, color: C.orange, marginTop: 2 }}>⚠ Override active — clear to use live rate</div>}
        </div>
        <div>
          <label style={lbl}>Making Charges — mode: <button onClick={() => saveMakingMode(makingMode === "per_g" ? "pct" : "per_g")} style={{ fontSize: 11, padding: "2px 8px", border: "1px solid #ddd", borderRadius: 4, cursor: "pointer", background: "#f5f5f5" }}>{makingMode === "per_g" ? "₹/g ↔" : "% ↔"}</button></label>
          {makingMode === "per_g"
            ? <input style={inp} type="number" value={jw.makingRatePg} onChange={e => setJw(p => ({ ...p, makingRatePg: e.target.value }))} placeholder="1500" />
            : <input style={inp} type="number" value={jw.makingRatePct} onChange={e => setJw(p => ({ ...p, makingRatePct: e.target.value }))} placeholder="15" />
          }
        </div>
      </div>

      {/* Diamonds & Stone */}
      {[
        { key: "dia1", label: "Diamond 1", wtK: "dia1Wt", unitK: "dia1Unit", rateK: "dia1Rate" },
        { key: "dia2", label: "Diamond 2", wtK: "dia2Wt", unitK: "dia2Unit", rateK: "dia2Rate" },
        { key: "stone", label: "Stone", wtK: "stoneWt", unitK: "stoneUnit", rateK: "stoneRate" },
      ].map(({ key, label, wtK, unitK, rateK }) => (
        <div key={key} style={{ display: "grid", gridTemplateColumns: "1fr 80px 1fr", gap: 8, marginBottom: 8, alignItems: "end" }}>
          <div><label style={lbl}>{label} Weight</label><input style={inp} type="number" step="0.001" value={jw[wtK]} onChange={e => setJw(p => ({ ...p, [wtK]: e.target.value }))} placeholder="0.000" /></div>
          <div><label style={lbl}>Unit</label><select style={inp} value={jw[unitK]} onChange={e => setJw(p => ({ ...p, [unitK]: e.target.value }))}><option value="ct">ct</option><option value="g">g</option></select></div>
          <div><label style={lbl}>{label} Rate (₹/g)</label><input style={inp} type="number" value={jw[rateK]} onChange={e => setJw(p => ({ ...p, [rateK]: e.target.value }))} placeholder="0" /></div>
        </div>
      ))}

      {/* Misc deductions */}
      {[
        { lblK: "misc1Lbl", wtK: "misc1Wt", unitK: "misc1Unit", rateK: "misc1Rate", dK: "misc1Deduct", def: "Gemstone" },
        { lblK: "misc2Lbl", wtK: "misc2Wt", unitK: "misc2Unit", rateK: "misc2Rate", dK: "misc2Deduct", def: "Mala" },
        { lblK: "misc3Lbl", wtK: "misc3Wt", unitK: "misc3Unit", rateK: "misc3Rate", dK: "misc3Deduct", def: "Lakh" },
      ].map(({ lblK, wtK, unitK, rateK, dK, def }) => (
        <div key={wtK} style={{ marginBottom: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
            <div><label style={lbl}>Label</label><input style={inp} value={jw[lblK]} onChange={e => setJw(p => ({ ...p, [lblK]: e.target.value }))} placeholder={def} /></div>
            <div>
              <label style={lbl}>Weight</label>
              <div style={{ display: "flex", gap: 4 }}>
                <input style={{ ...inp, flex: 1 }} type="number" step="0.001" value={jw[wtK]} onChange={e => setJw(p => ({ ...p, [wtK]: e.target.value }))} placeholder="0.00" />
                <button style={{ ...inp, width: 40, cursor: "pointer", background: "#f0f0f0", fontWeight: 600, padding: "0 4px" }} onClick={() => setJw(p => ({ ...p, [unitK]: p[unitK] === "ct" ? "g" : "ct" }))}>{jw[unitK]}</button>
              </div>
            </div>
            <div><label style={lbl}>Rate (₹)</label><input style={inp} type="number" step="1" value={jw[rateK]} onChange={e => setJw(p => ({ ...p, [rateK]: e.target.value }))} placeholder="0" /></div>
            <div style={{ paddingBottom: 6 }}><label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Deduct</label><input type="checkbox" checked={jw[dK]} onChange={e => setJw(p => ({ ...p, [dK]: e.target.checked }))} /></div>
          </div>
        </div>
      ))}

      {/* Results */}
      <div style={{ ...card, background: "#f8faff", marginTop: 8 }}>
        {resultRow("Net Gold Weight", `${jwCalc.netGold.toFixed(3)} g`)}
        {resultRow("Gold Value", fmt(jwCalc.goldVal))}
        {resultRow(`Making (${makingMode === "per_g" ? "₹/g" : "%"})`, fmt(jwCalc.making))}
        {resultRow("Diamond / Stone Total", fmt(jwCalc.diaTotal))}
        {jwCalc.miscTotal > 0 && resultRow("Misc Total", fmt(jwCalc.miscTotal))}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={jw.applyGst} onChange={e => setJw(p => ({ ...p, applyGst: e.target.checked }))} />
            GST @ 3%
          </label>
          <span style={{ fontSize: 13 }}>{jw.applyGst ? fmt(jwCalc.gst) : "—"}</span>
        </div>
        {resultRow("GRAND TOTAL", fmt(jwCalc.total), true)}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Btn small color={editingEstId ? C.orange : C.blue} onClick={() => setSaveModal(true)}>{editingEstId ? "💾 Update Estimate" : "💾 Save Estimate"}</Btn>
        <Btn small ghost color={C.blue} onClick={handleJwPrint}>🖨️ Print</Btn>
        {saveContact && <Btn small ghost color={C.green} onClick={() => {
          const lines = [
            `*ESTIMATE — Sun Sea Jewellers*`,
            jw.itemName ? `\n*Item:* ${jw.itemName}` : "",
            `\n*Gold (${PURITIES[jw.purityIdx]?.l || "Custom"}):* ${fmt(jwCalc.goldVal)}`,
            `*Making:* ${fmt(jwCalc.making)}`,
            jwCalc.diaTotal > 0 ? `*Diamond/Stone:* ${fmt(jwCalc.diaTotal)}` : "",
            jwCalc.miscTotal > 0 ? `*Misc:* ${fmt(jwCalc.miscTotal)}` : "",
            jw.applyGst ? `*GST (3%):* ${fmt(jwCalc.gst)}` : "",
            `\n*Total: ${fmt(jwCalc.total)}*`,
            `\n_Sun Sea Jewellers, Mumbai_`
          ].filter(Boolean).join("\n");
          sendWA(saveContact.phone, lines);
        }}>📱 Send WA</Btn>}
        <Btn small ghost color={C.gray} onClick={() => { setJw({ itemImage: "", itemName: "", vendorCode: "", grossWt: "", purityIdx: 2, customPurity: "", goldRateOverride: "", applyGst: true, makingRatePg: "1500", makingRatePct: "15", dia1Wt: "", dia1Unit: "ct", dia1Rate: "", dia2Wt: "", dia2Unit: "ct", dia2Rate: "", stoneWt: "", stoneUnit: "ct", stoneRate: "", misc1Lbl: "Gemstone", misc1Wt: "", misc1Unit: "g", misc1Rate: "", misc1Deduct: true, misc2Lbl: "Mala", misc2Wt: "", misc2Unit: "g", misc2Rate: "", misc2Deduct: false, misc3Lbl: "Lakh", misc3Wt: "", misc3Unit: "g", misc3Rate: "", misc3Deduct: false }); setSaveContact(null); setContactSearch(""); setActiveVisitId(null); setActiveVisitClient(null); setActiveVisitTime(null); try { localStorage.removeItem("calc_active_contact"); } catch {} }}>🔄 New</Btn>
      </div>
    </div>
  );



  // ── SOLITAIRE TAB ──
  const solForm = (stone, onChange, showInternal = true) => {
    const isNonCert = stone.cert === "Non-Cert";
    const isRound = stone.shape === "Round";
    const buyDiscV = parseFloat(stone.buyDisc || 0);
    const autoSell = buyDiscV - spread;
    const usd = parseFloat(usdInr || 0);
    const rap100 = !isNonCert && stone.weight && stone.color && stone.clarity ? rapLookup(rapData, parseFloat(stone.weight), stone.color, stone.clarity, isRound) : null;
    const rapInrPc = rap100 !== null && usd ? rap100 * 100 * usd : null;

    return (
      <div>
        {/* Top row — always visible */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div><label style={lbl}>Shape</label>
            <select style={inp} value={stone.shape} onChange={e => onChange("shape", e.target.value)}>
              {ALL_SHAPES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Weight (ct)</label><input style={inp} type="number" step="0.01" value={stone.weight} onChange={e => onChange("weight", e.target.value)} placeholder="1.00" /></div>
          <div><label style={lbl}>Certificate</label>
            <select style={inp} value={stone.cert} onChange={e => onChange("cert", e.target.value)}>
              {["IGI","GIA","HRD","Non-Cert"].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Non-Cert: manual sell price + internal fields */}
        {isNonCert ? (
          <>
            <div style={{ marginBottom: 10 }}>
              <label style={lbl}>Sell Price ₹ (total)</label>
              <input style={inp} type="number" value={stone.manualPrice} onChange={e => onChange("manualPrice", e.target.value)} placeholder="e.g. 250000" />
            </div>
            {showInternal && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div><label style={{ ...lbl, color: C.orange }}>Vendor Code (internal)</label><input style={inp} value={stone.vendorCode} onChange={e => onChange("vendorCode", e.target.value)} placeholder="VC-123" /></div>
                <div><label style={{ ...lbl, color: C.orange }}>Purchase Price ₹ (internal)</label><input style={inp} type="number" value={stone.purchasePrice} onChange={e => onChange("purchasePrice", e.target.value)} placeholder="0" /></div>
                <div><label style={{ ...lbl, color: C.orange }}>Notes (internal)</label><input style={inp} value={stone.notes} onChange={e => onChange("notes", e.target.value)} placeholder="..." /></div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Colour / Clarity / Cut */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div><label style={lbl}>Colour</label>
                <select style={inp} value={stone.color} onChange={e => onChange("color", e.target.value)}>
                  {RAP_COLORS.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Clarity</label>
                <select style={inp} value={stone.clarity} onChange={e => onChange("clarity", e.target.value)}>
                  {["FL","IF","VVS1","VVS2","VS1","VS2","SI1","SI2","I1","I2"].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Cut</label>
                <select style={inp} value={stone.cut} onChange={e => onChange("cut", e.target.value)}>
                  {["Excellent","Very Good","Good","Fair","None"].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {/* RAP row */}
            <div style={{ ...card, background: "#f8faff", padding: 10, marginBottom: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, alignItems: "end" }}>
                <div><label style={lbl}>USD/INR — live</label><input style={inp} type="number" value={usdInr} onChange={e => setUsdInr(e.target.value)} placeholder="e.g. 85" /></div>
                {user?.role === "superadmin" && <div><label style={lbl}>Spread (buy−sell gap)</label><input style={inp} type="number" value={spread} onChange={e => saveSpread(Number(e.target.value))} /></div>}
                <div><label style={lbl}>Buy Disc %</label><input style={inp} type="number" step="0.1" value={stone.buyDisc} onChange={e => onChange("buyDisc", e.target.value)} placeholder="e.g. 43" /></div>
                <div><label style={lbl}>Sell Disc % (auto {autoSell.toFixed(1)})</label><input style={{ ...inp, background: stone.sellDisc === "" ? "#fffbe6" : "#fff" }} type="number" step="0.1" value={stone.sellDisc} onChange={e => onChange("sellDisc", e.target.value)} placeholder={String(autoSell.toFixed(1))} /></div>
              </div>
              {rap100 !== null ? (
                <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>
                  Rap: <strong>${rap100 * 100}/ct</strong> × USD/INR {usd || "?"} = <strong>{rapInrPc ? "₹" + Math.round(rapInrPc).toLocaleString("en-IN") + "/ct" : "set USD/INR ↑"}</strong>
                  {rapAge !== null && rapAge > 7 && <span style={{ color: C.orange, marginLeft: 8 }}>⚠️ Rapaport {rapAge}d old</span>}
                </div>
              ) : stone.weight ? <div style={{ fontSize: 12, color: C.orange, marginTop: 8 }}>⚠️ Weight {parseFloat(stone.weight || 0) < 0.30 ? "< 0.30ct — manual pricing only" : "out of table range"}</div> : null}
            </div>

            {showInternal && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div><label style={{ ...lbl, color: C.orange }}>Vendor Code (internal)</label><input style={inp} value={stone.vendorCode} onChange={e => onChange("vendorCode", e.target.value)} placeholder="VC-123" /></div>
                <div><label style={{ ...lbl, color: C.orange }}>Purchase Price ₹ (internal)</label><input style={inp} type="number" value={stone.purchasePrice} onChange={e => onChange("purchasePrice", e.target.value)} placeholder="0" /></div>
                <div><label style={{ ...lbl, color: C.orange }}>Notes (internal)</label><input style={inp} value={stone.notes} onChange={e => onChange("notes", e.target.value)} placeholder="..." /></div>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  const solitaireTab = (
    <div>
      {solForm(sol, (k, v) => setSol(p => ({ ...p, [k]: v })))}

      {/* Gold setting toggle */}
      <div style={{ marginBottom: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
          <input type="checkbox" checked={sol.includeGold} onChange={e => setSol(p => ({ ...p, includeGold: e.target.checked }))} />
          Include Gold Setting
        </label>
      </div>
      {sol.includeGold && (
        <div style={{ ...card, background: "#fffbe6", marginBottom: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, alignItems: "end" }}>
            <div><label style={lbl}>Gold Gross Weight (g)</label><input style={inp} type="number" step="0.01" value={sol.goldGrossWt} onChange={e => setSol(p => ({ ...p, goldGrossWt: e.target.value }))} /></div>
            <div><label style={lbl}>Purity</label><select style={inp} value={sol.goldPurityIdx} onChange={e => { const idx = Number(e.target.value); setSol(p => ({ ...p, goldPurityIdx: idx })); saveMakingMode(idx === 0 ? "pct" : "per_g"); }}>{PURITIES.map((p2, i) => <option key={i} value={i}>{p2.l}</option>)}</select></div>
            {PURITIES[sol.goldPurityIdx]?.rateKey === null && <div><label style={lbl}>Custom Rate ₹/g</label><input style={inp} type="number" step="0.01" value={sol.goldRateOverride} onChange={e => setSol(p => ({ ...p, goldRateOverride: e.target.value }))} placeholder="e.g. 13000" /></div>}
            <div><label style={lbl}>Gold Rate ₹/g {(() => { const k = PURITIES[sol.goldPurityIdx]?.rateKey; return k && liveRates[k] ? <span style={{ color: C.green }}>₹{Math.round(liveRates[k]).toLocaleString("en-IN")}</span> : null; })()}</label><input style={{ ...inp, background: sol.goldRateOverride ? "#fffbe6" : "#fff" }} type="number" step="1" value={sol.goldRateOverride} onChange={e => setSol(p => ({ ...p, goldRateOverride: e.target.value }))} placeholder={(() => { const k = PURITIES[sol.goldPurityIdx]?.rateKey; return k && liveRates[k] ? String(Math.round(liveRates[k])) : "e.g. 13346"; })()} /></div>
            <div><label style={lbl}>Making — <button onClick={() => saveMakingMode(makingMode === "per_g" ? "pct" : "per_g")} style={{ fontSize: 11, padding: "2px 8px", border: "1px solid #ddd", borderRadius: 4, cursor: "pointer", background: "#f5f5f5" }}>{makingMode === "per_g" ? "₹/g ↔" : "% ↔"}</button></label>
              {makingMode === "per_g"
                ? <input style={inp} type="number" value={sol.goldMakingRatePg} onChange={e => setSol(p => ({ ...p, goldMakingRatePg: e.target.value }))} placeholder="1500" />
                : <input style={inp} type="number" value={sol.goldMakingRatePct} onChange={e => setSol(p => ({ ...p, goldMakingRatePct: e.target.value }))} placeholder="15" />
              }
            </div>
          </div>
          {/* Misc stones in setting */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10, alignItems: "end" }}>
            <div><label style={lbl}>Diamond in Shank (ct)</label><input style={inp} type="number" step="0.001" value={sol.settingDiaWt} onChange={e => setSol(p => ({ ...p, settingDiaWt: e.target.value }))} placeholder="0.00" /></div>
            <div><label style={lbl}>Diamond Rate (₹/ct)</label><input style={inp} type="number" value={sol.settingDiaRate} onChange={e => setSol(p => ({ ...p, settingDiaRate: e.target.value }))} placeholder="e.g. 25000" /></div>
            <div><label style={lbl}>Gemstone / Other ₹</label><input style={inp} type="number" value={sol.settingGemVal} onChange={e => setSol(p => ({ ...p, settingGemVal: e.target.value }))} placeholder="direct value" /></div>
          </div>
          {(parseFloat(sol.settingDiaWt) > 0 || parseFloat(sol.settingGemVal) > 0) && (
            <div style={{ fontSize: 12, color: "#555", marginTop: 6 }}>
              {parseFloat(sol.settingDiaWt) > 0 && <span>Dia in shank: ₹{Math.round(parseFloat(sol.settingDiaWt||0)*parseFloat(sol.settingDiaRate||0)).toLocaleString("en-IN")} </span>}
              {parseFloat(sol.settingGemVal) > 0 && <span>Gemstone: ₹{Math.round(parseFloat(sol.settingGemVal||0)).toLocaleString("en-IN")}</span>}
            </div>
          )}
        </div>
      )}

      {/* Results */}
      <div style={{ ...card, background: "#f8faff" }}>
        {resultRow("Weight", `${solResult.w} ct`)}
        {solResult.rap100 !== null && resultRow("Rap (before disc)", `$${solResult.rap100 * 100}/ct = ${solResult.rapInrPerCt ? "₹" + Math.round(solResult.rapInrPerCt).toLocaleString("en-IN") + "/ct" : "set USD/INR"}`)}
        {sol.cert !== "Non-Cert" && resultRow(`Buy Price/ct (${solResult.buyDisc}% disc)`, solResult.buyPpc !== null ? fmt(solResult.buyPpc) : "—")}
        {sol.cert !== "Non-Cert" && resultRow(`Sell Price/ct (${(sol.sellDisc !== "" ? parseFloat(sol.sellDisc) : solResult.buyDisc - spread).toFixed(1)}% disc)`, solResult.sellPpc !== null ? fmt(solResult.sellPpc) : "—")}
        {resultRow("Sell Total (stone)", solResult.sellTotal !== null ? fmt(solResult.sellTotal) : "—")}
        {sol.includeGold && solGoldCalc && resultRow("Gold + Making", fmt(solGoldCalc.goldVal + solGoldCalc.making))}
        {sol.includeGold && solGoldCalc && solGoldCalc.diaInShank > 0 && resultRow("Diamond in Shank", fmt(solGoldCalc.diaInShank))}
        {sol.includeGold && solGoldCalc && solGoldCalc.gemVal > 0 && resultRow("Gemstone / Other", fmt(solGoldCalc.gemVal))}
        {sol.includeGold && solGoldCalc && resultRow("Setting Total", fmt(solGoldCalc.total))}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={sol.applyGst} onChange={e => setSol(p => ({ ...p, applyGst: e.target.checked }))} />
            GST
          </label>
        </div>
        {sol.applyGst && solResult.sellTotal != null && resultRow("GST @ 1.5% (stone)", fmt(solStoneGst))}
        {sol.applyGst && sol.includeGold && solGoldCalc && resultRow("GST @ 3% (gold setting)", fmt(solGoldGst))}
        {resultRow("GRAND TOTAL", fmt(solFinalTotal), true)}
        {user?.role === "superadmin" && solResult.buyTotal !== null && solResult.sellTotal !== null && (
          <div style={{ fontSize: 11, color: "#888", marginTop: 6, paddingTop: 6, borderTop: "1px solid #eee" }}>
            Margin: {fmt(solResult.sellTotal - solResult.buyTotal)} ({solResult.buyTotal > 0 ? ((solResult.sellTotal - solResult.buyTotal) / solResult.buyTotal * 100).toFixed(1) + "%" : "—"}) · Spread: {spread}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Btn small color={editingEstId ? C.orange : C.blue} onClick={() => setSaveModal(true)}>{editingEstId ? "💾 Update Estimate" : "💾 Save Estimate"}</Btn>
        <Btn small ghost color={C.blue} onClick={handleSolPrint}>🖨️ Print</Btn>
        {saveContact && <Btn small ghost color={C.green} onClick={() => {
          const sc = solCalc(sol);
          const txt = `*ESTIMATE — Sun Sea Jewellers*\n\n*Stone:* ${sol.shape} ${sol.weight}ct ${sol.color}/${sol.clarity} ${sol.cut}\n*Certificate:* ${sol.cert}\n\n*Sell Price:* ${fmt(sc.sellTotal)}\n${sol.includeGold && solGoldCalc ? `*Setting:* ${fmt(solGoldCalc.total)}\n` : ""}*Total:* ${fmt(solGrandTotal)}\n\n_Sun Sea Jewellers, Mumbai_`;
          sendWA(saveContact.phone, txt);
        }}>📱 Send WA</Btn>}
      </div>
    </div>
  );

  // ── QUOTATION SHEET TAB ──
  const quotationTab = (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f7f7f7", borderBottom: "2px solid #eee" }}>
              {["#","Shape","Wt (ct)","Colour","Clarity","Cut","Cert","Rap INR/ct","Sell Disc%","Sell Price",""].map(h => (
                <th key={h} style={{ padding: "7px 8px", textAlign: "left", fontWeight: 600, color: "#555", fontSize: 11, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const isRound = row.shape === "Round";
              const rc = solCalc(row);
              const sellDiscVal = row.sellDisc !== "" ? parseFloat(row.sellDisc) : rc.buyDisc - spread;
              return (
                <tr key={row.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "4px 8px", color: "#888", fontWeight: 600 }}>{idx + 1}</td>
                  <td style={{ padding: "4px 4px" }}>
                    <select style={{ ...inp, padding: "4px 6px", fontSize: 11 }} value={row.shape} onChange={e => setRows(p => p.map((r, i) => i === idx ? { ...r, shape: e.target.value } : r))}>
                      {ALL_SHAPES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "4px 4px" }}><input style={{ ...inp, width: 68, padding: "4px 6px", fontSize: 11 }} type="number" step="0.01" value={row.weight} onChange={e => setRows(p => p.map((r, i) => i === idx ? { ...r, weight: e.target.value } : r))} placeholder="1.00" /></td>
                  <td style={{ padding: "4px 4px" }}>
                    <select style={{ ...inp, padding: "4px 6px", fontSize: 11 }} value={row.color} onChange={e => setRows(p => p.map((r, i) => i === idx ? { ...r, color: e.target.value } : r))}>
                      {RAP_COLORS.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "4px 4px" }}>
                    <select style={{ ...inp, padding: "4px 6px", fontSize: 11 }} value={row.clarity} onChange={e => setRows(p => p.map((r, i) => i === idx ? { ...r, clarity: e.target.value } : r))}>
                      {["FL","IF","VVS1","VVS2","VS1","VS2","SI1","SI2","I1","I2"].map(c => <option key={c}>{c}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "4px 4px" }}>
                    <select style={{ ...inp, padding: "4px 6px", fontSize: 11 }} value={row.cut} onChange={e => setRows(p => p.map((r, i) => i === idx ? { ...r, cut: e.target.value } : r))}>
                      {["Excellent","Very Good","Good","Fair","None"].map(c => <option key={c}>{c}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "4px 4px" }}>
                    <select style={{ ...inp, padding: "4px 6px", fontSize: 11 }} value={row.cert} onChange={e => setRows(p => p.map((r, i) => i === idx ? { ...r, cert: e.target.value } : r))}>
                      {["IGI","GIA","HRD","Non-Cert"].map(c => <option key={c}>{c}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "4px 8px", fontSize: 11, color: rc.rapInrPerCt != null ? "#333" : "#ccc" }}>
                    {rc.rapInrPerCt != null ? "₹" + Math.round(rc.rapInrPerCt).toLocaleString("en-IN") : "—"}
                  </td>
                  <td style={{ padding: "4px 4px" }}>
                    <input style={{ ...inp, width: 60, padding: "4px 6px", fontSize: 11, background: row.sellDisc === "" ? "#fffbe6" : "#fff" }} type="number" step="0.1" value={row.sellDisc} onChange={e => setRows(p => p.map((r, i) => i === idx ? { ...r, sellDisc: e.target.value } : r))} placeholder={String((rc.buyDisc - spread).toFixed(1))} />
                  </td>
                  <td style={{ padding: "4px 8px", fontWeight: 600, color: C.blue, whiteSpace: "nowrap" }}>
                    {rc.sellPpc != null ? "₹" + Math.round(rc.sellPpc * parseFloat(row.weight || 0)).toLocaleString("en-IN") : "—"}
                  </td>
                  <td style={{ padding: "4px 4px" }}>
                    <button onClick={() => setRows(p => p.filter((_, i) => i !== idx))} style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 16 }}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontSize: 12, color: "#888" }}>Buy disc default: <input style={{ ...inp, width: 60, display: "inline-block", padding: "4px 6px" }} type="number" value={spread} onChange={e => saveSpread(Number(e.target.value))} /> % spread from sell</div>
        <div style={{ fontSize: 12, color: "#888" }}>USD/INR: <input style={{ ...inp, width: 70, display: "inline-block", padding: "4px 6px" }} type="number" value={usdInr} onChange={e => setUsdInr(e.target.value)} /></div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <Btn small color={C.green} onClick={() => setRows(p => [...p, newSolRow()])}>+ Add Stone</Btn>
        <Btn small color={C.blue} onClick={() => setSaveModal(true)}>💾 Save</Btn>
        <Btn small ghost color={C.blue} onClick={handleQuotPrint}>🖨️ Print</Btn>
        {saveContact && <Btn small ghost color={C.green} onClick={() => {
          const lines = rows.map((r, i) => { const sc = solCalc(r); return `${i+1}. ${r.shape} ${r.weight}ct ${r.color}/${r.clarity} ${r.cert} — ${sc.sellTotal != null ? fmt(sc.sellTotal) : "—"}`; });
          sendWA(saveContact.phone, `*QUOTATION — Sun Sea Jewellers*\n\n${lines.join("\n")}\n\n_Sun Sea Jewellers, Mumbai_`);
        }}>📱 Send WA</Btn>}
      </div>
    </div>
  );

  const addNewClient = async () => {
    if (!newClientName.trim() && !newClientPhone.trim()) return;
    const { data, error } = await sb.from("bullion_leads").insert({ name: newClientName.trim() || null, phone: newClientPhone.trim() || null, source: "walk_in" }).select("id,name,phone").single();
    if (error) { showToast("❌ Add failed: " + error.message); return; }
    setSaveContact(data); setContactSearch(data.name + (data.phone ? ` (${data.phone})` : ""));
    try { localStorage.setItem("calc_active_contact", JSON.stringify(data)); } catch {}
    setAddClientMode(false); setNewClientName(""); setNewClientPhone("");
    showToast("✅ New client added");
  };

  // ── SAVE MODAL ──
  const saveModalEl = saveModal && (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 440, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 14 }}>{editingEstId ? "💾 Update Estimate" : "💾 Save Estimate"}</div>

        {/* Salesperson */}
        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Attended by (salesperson)</label>
          <select style={inp} value={attendedBy} onChange={e => { setAttendedBy(e.target.value); try { localStorage.setItem("calc_attended_by", e.target.value); } catch {} }}>
            <option value="">— Select staff —</option>
            {calcStaff.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>

        {/* Contact search */}
        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Link to Client</label>
          <input style={inp} value={contactSearch} onChange={e => { setContactSearch(e.target.value); setSaveContact(null); setAddClientMode(false); try { localStorage.removeItem("calc_active_contact"); } catch {} }} placeholder="Search by name or phone…" />
          {contactResults.length > 0 && (
            <div style={{ border: "1px solid #eee", borderRadius: 6, marginTop: 4, maxHeight: 150, overflowY: "auto" }}>
              {contactResults.map(c => (
                <div key={c.id} onClick={() => { if (activeVisitClient && c.id !== activeVisitClient.id) { setActiveVisitId(null); setActiveVisitClient(null); setActiveVisitTime(null); } setSaveContact(c); setContactSearch(c.name + (c.phone ? ` (${c.phone})` : "")); setContactResults([]); try { localStorage.setItem("calc_active_contact", JSON.stringify(c)); } catch {} }} style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid #f0f0f0" }}>
                  {c.name} {c.phone && <span style={{ color: "#888" }}>{c.phone}</span>}
                </div>
              ))}
            </div>
          )}
          {/* Not found flow */}
          {contactSearch.length >= 2 && contactResults.length === 0 && !saveContact && (
            <div style={{ marginTop: 8, padding: "10px 12px", background: "#fffbe6", borderRadius: 6, border: "1px solid #ffe082" }}>
              <div style={{ fontSize: 13, marginBottom: 6 }}>No client found for "<strong>{contactSearch}</strong>"</div>
              {!addClientMode ? (
                <>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn small color={C.green} onClick={() => { setNewClientName(contactSearch.replace(/^\d+$/, "")); setNewClientPhone(/^\d+$/.test(contactSearch) ? contactSearch : ""); setAddClientMode(true); }}>➕ Add as new client</Btn>
                  </div>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>💡 Also ask if registered under a family member's number</div>
                </>
              ) : (
                <div style={{ marginTop: 4 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <div><label style={{ ...lbl, fontSize: 11 }}>Name</label><input style={inp} value={newClientName} onChange={e => setNewClientName(e.target.value)} placeholder="Full name" /></div>
                    <div><label style={{ ...lbl, fontSize: 11 }}>Phone</label><input style={inp} value={newClientPhone} onChange={e => setNewClientPhone(e.target.value)} placeholder="Mobile number" /></div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn small color={C.green} onClick={addNewClient}>✓ Add & Select</Btn>
                    <Btn small ghost color={C.gray} onClick={() => setAddClientMode(false)}>Cancel</Btn>
                  </div>
                </div>
              )}
            </div>
          )}
          {saveContact && <div style={{ fontSize: 12, color: C.green, marginTop: 6 }}>✓ {saveContact.name}{saveContact.phone ? ` · ${saveContact.phone}` : ""}</div>}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn ghost color={C.gray} onClick={() => { setSaveModal(false); setAddClientMode(false); }}>Cancel</Btn>
          <Btn color={C.blue} onClick={saveEstimate} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
        </div>
      </div>
    </div>
  );

  // ── PRINT STYLES ──
  const printStyle = `@media print{.no-print{display:none!important}.print-only{display:block!important}body{font-size:12pt}@page{margin:1.5cm}}`;

  return (
    <div>
      <style>{printStyle}</style>
      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, background: "#333", color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 13, zIndex: 9999 }}>{toast}</div>}
      {saveModalEl}

      {/* Walk-in modal — standalone via header button only */}
      {walkinOpen && (
        <WalkinEntryModal
          funnels={funnels}
          allTags={allTags}
          prefill={walkinPrefill}
          onClose={() => setWalkinOpen(false)}
          onSaved={(lead) => {
            setWalkinOpen(false);
            if (lead?.visitId) {
              setActiveVisitId(lead.visitId);
              setActiveVisitTime(new Date().toISOString());
              setActiveVisitClient(lead?.id ? { id: lead.id, name: lead.name, phone: lead.phone } : null);
            }
            if (lead?.id && !saveContact?.id) {
              const c = { id: lead.id, name: lead.name, phone: lead.phone };
              setSaveContact(c);
              setContactSearch(c.name + (c.phone ? ` (${c.phone})` : ""));
              try { localStorage.setItem("calc_active_contact", JSON.stringify(c)); } catch {}
            }
          }}
        />
      )}

      {/* Visit session banner */}
      {activeVisitId && (
        <div className="no-print" style={{ background: "#e8f5e9", border: "1px solid #81c784", borderRadius: 8, padding: "8px 14px", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
          <span>📋 <strong>Active visit session</strong> · {activeVisitClient?.name || "Client"} · started {activeVisitTime ? new Date(activeVisitTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : ""} · new estimates will link to this visit</span>
          <button onClick={() => { setActiveVisitId(null); setActiveVisitClient(null); setActiveVisitTime(null); }} style={{ background: "none", border: "1px solid #81c784", borderRadius: 4, padding: "2px 10px", cursor: "pointer", fontSize: 12 }}>End session</button>
        </div>
      )}

      {/* Editing banner */}
      {editingEstId && editingEstOrig && (
        <div className="no-print" style={{ background: "#fff3e0", border: "1px solid #ffb74d", borderRadius: 8, padding: "8px 14px", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
          <span>✏️ <strong>Editing estimate</strong> from {new Date(editingEstOrig.created_at).toLocaleDateString("en-IN")} · {editingEstOrig.bullion_leads?.name || "No client"} · was ₹{Math.round(editingEstOrig.total_amount || 0).toLocaleString("en-IN")}</span>
          <button onClick={() => { setEditingEstId(null); setEditingEstOrig(null); showToast("Edit cancelled"); }} style={{ background: "none", border: "1px solid #ffb74d", borderRadius: 4, padding: "2px 10px", cursor: "pointer", fontSize: 12 }}>✕ Cancel edit</button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }} className="no-print">
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>💎 Jewellery Calculator</div>
          {rapAge != null && rapAge > 7 && <div style={{ fontSize: 12, color: C.orange, marginTop: 2 }}>⚠️ Rapaport data {rapAge} days old — run sync to update</div>}
          {rapAge != null && rapAge <= 7 && <div style={{ fontSize: 11, color: C.green, marginTop: 2 }}>✓ Rapaport {rapData.date || ""}</div>}
        </div>
        <div style={{ display: "flex", gap: 8 }} className="no-print">
          <Btn small color="#16a085" onClick={() => { setWalkinPrefill({ contact: saveContact, estimateSummary: null }); setWalkinOpen(true); }} style={{ color: "#fff" }}>🏪 Walk-in</Btn>
          <Btn small ghost color={C.blue} onClick={async () => {
            showToast("Syncing Rapaport…");
            const r = await fetch("/api/rapaport-sync", { headers: { "x-crm-secret": CRM_SECRET } });
            const d = await r.json().catch(() => ({}));
            if (d.ok) { showToast("✅ Synced: " + (d.date || "")); setRapAge(0); } else showToast("❌ " + (d.error || "Sync failed"));
          }}>🔄 Sync Rapaport</Btn>
        </div>
      </div>

      {/* Sync pending badge */}
      {syncPending > 0 && (
        <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fff8e1", border: "1px solid #ffe082", borderRadius: 8, padding: "6px 12px", marginBottom: 8, fontSize: 12 }}>
          <span>⚠️ {syncPending} estimate{syncPending > 1 ? "s" : ""} saved locally, not yet synced to cloud</span>
          <Btn small ghost color={C.orange} onClick={async () => { await syncQueue(); showToast("✅ Sync done"); }}>Sync now</Btn>
        </div>
      )}

      {/* Active client banner */}
      {saveContact && (
        <div className="no-print" style={{ background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 8, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#2e7d32" }}>
              👤 {saveContact.name}{saveContact.phone ? ` · ${saveContact.phone}` : ""}
              {attendedBy && <span style={{ fontWeight: 400, fontSize: 12, color: "#555", marginLeft: 8 }}>· Attended by {attendedBy}</span>}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {clientHistory.length > 0 && (
                <button onClick={() => setShowHistory(h => !h)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#2e7d32", fontWeight: 600 }}>
                  {showHistory ? "▲ Hide" : `📋 ${clientHistory.length} past estimate${clientHistory.length > 1 ? "s" : ""}`}
                </button>
              )}
              <button onClick={() => { setSaveContact(null); setContactSearch(""); setClientHistory([]); setShowHistory(false); try { localStorage.removeItem("calc_active_contact"); } catch {} }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#555" }}>✕ Change</button>
            </div>
          </div>
          {/* Client history panel */}
          {showHistory && clientHistory.length > 0 && (
            <div style={{ borderTop: "1px solid #a5d6a7", padding: "10px 14px" }}>
              <div style={{ fontSize: 11, color: "#555", marginBottom: 6, fontWeight: 600 }}>PREVIOUS VISITS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {clientHistory.map(e => {
                  const item = e.items?.[0] || {};
                  const label = e.mode === "jewellery" ? (item.itemName || "Jewellery") : e.mode === "solitaire" ? `${item.shape || ""} ${item.weight || ""}ct ${item.color || ""}/${item.clarity || ""}`.trim() : "Quotation";
                  return (
                    <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "4px 0", borderBottom: "1px solid #c8e6c9" }}>
                      <div>
                        <span style={{ textTransform: "capitalize", fontWeight: 600 }}>{e.mode}</span>
                        {label && <span style={{ color: "#555", marginLeft: 6 }}>{label}</span>}
                        <span style={{ color: "#888", marginLeft: 8, fontSize: 11 }}>{new Date(e.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
                      </div>
                      {e.total_amount && <span style={{ fontWeight: 700, color: "#1565c0" }}>₹{Math.round(e.total_amount).toLocaleString("en-IN")}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mode tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }} className="no-print">
        {tabBtn("jewellery", "💍", "Jewellery")}
        {tabBtn("solitaire", "💎", "Solitaire")}
        {tabBtn("quotation", "📋", "Quotation Sheet")}
      </div>

      {/* Print header (hidden on screen) */}
      <div style={{ display: "none" }} className="print-only">
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>ESTIMATE</div>
          <div style={{ fontSize: 13, color: "#888" }}>Sun Sea Jewellers</div>
          {saveContact && <div style={{ fontSize: 13 }}>{saveContact.name} {saveContact.phone && `· ${saveContact.phone}`}</div>}
          <div style={{ fontSize: 12, color: "#aaa" }}>{new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</div>
        </div>
      </div>

      {/* Main content */}
      <div style={card}>
        {tab === "jewellery" && jewelleryTab}
        {tab === "solitaire" && solitaireTab}
        {tab === "quotation" && quotationTab}
      </div>

      {/* Recent estimates */}
      {recentEstimates.length > 0 && (
        <div className="no-print" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: "#555" }}>Recent Estimates</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
            {recentEstimates.map(e => {
              const it = (e.items || [])[0] || {};
              const clientName = e.bullion_leads?.name || "";
              const itemName = it.itemName || it.shape || "";
              return (
                <div key={e.id} style={{ ...card, padding: "10px 12px", fontSize: 12, border: e.id === editingEstId ? "2px solid #ffb74d" : "1px solid #eee", display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    {it.itemImage && <img src={it.itemImage} alt="" style={{ width: 42, height: 42, objectFit: "cover", borderRadius: 5, border: "1px solid #eee", flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{itemName || <span style={{ color: "#aaa", fontStyle: "italic" }}>No item name</span>}</div>
                      {clientName && <div style={{ color: "#555", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>👤 {clientName}</div>}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                        <span style={{ color: "#888", fontSize: 11 }}>{new Date(e.created_at).toLocaleDateString("en-IN")} · {e.mode}</span>
                        {e.metadata?.changes?.length ? <span style={{ fontSize: 9, color: C.orange }}>edited {e.metadata.changes.length}×</span> : null}
                      </div>
                    </div>
                  </div>
                  {e.total_amount && <div style={{ color: C.blue, fontWeight: 700, fontSize: 14 }}>₹{Math.round(e.total_amount).toLocaleString("en-IN")}</div>}
                  <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                    <button onClick={() => openEstimateSlip(e)} style={{ flex: 1, padding: "3px 0", background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>👁 View</button>
                    <button onClick={() => loadEstimateForEdit(e)} style={{ flex: 1, padding: "3px 0", background: "#fff8e1", border: "1px solid #ffe082", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>✏️ Edit</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pending follow-ups marketing section */}
      {pendingFollowups.length > 0 && (
        <div className="no-print" style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, color: "#555", display: "flex", alignItems: "center", gap: 8 }}>
            📣 Follow-up List — last 30 days
            <span style={{ fontSize: 11, fontWeight: 400, color: "#888" }}>({pendingFollowups.length} estimates with linked clients)</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f7f7f7", borderBottom: "2px solid #eee" }}>
                  {["Client", "Phone", "Type", "What they saw", "Amount", "Date", "Follow-up", ""].map(h => (
                    <th key={h} style={{ padding: "7px 10px", textAlign: "left", fontWeight: 600, color: "#555", fontSize: 11, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pendingFollowups.map(e => {
                  const client = e.bullion_leads;
                  const item = e.items?.[0] || {};
                  const what = e.mode === "jewellery"
                    ? (item.itemName || `${item.purityIdx != null ? (["24kt","22kt","18kt","14kt","9kt"][item.purityIdx] || "Gold") : "Gold"} jewellery`)
                    : e.mode === "solitaire"
                    ? `${item.shape || ""} ${item.weight || ""}ct ${item.color || ""}/${item.clarity || ""}`.trim()
                    : `Quotation (${e.items?.length || 0} stones)`;
                  const waMsg = `Hello ${client?.name || ""},\n\nThank you for visiting Sun Sea Jewellers! You had enquired about *${what}*${e.total_amount ? ` (est. ₹${Math.round(e.total_amount).toLocaleString("en-IN")})` : ""}.\n\nWould you like to proceed or have any questions? We're happy to help you make the right choice.\n\n_Sun Sea Jewellers, Mumbai_`;
                  return (
                    <tr key={e.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "6px 10px", fontWeight: 600 }}>{client?.name || "—"}</td>
                      <td style={{ padding: "6px 10px", color: "#555" }}>{client?.phone || "—"}</td>
                      <td style={{ padding: "6px 10px", textTransform: "capitalize", color: "#888" }}>{e.mode}</td>
                      <td style={{ padding: "6px 10px", color: "#333", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{what}</td>
                      <td style={{ padding: "6px 10px", fontWeight: 600, color: C.blue }}>{e.total_amount ? `₹${Math.round(e.total_amount).toLocaleString("en-IN")}` : "—"}</td>
                      <td style={{ padding: "6px 10px", color: "#888", whiteSpace: "nowrap" }}>{new Date(e.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</td>
                      <td style={{ padding: "6px 10px" }}>
                        {client?.phone ? (
                          <Btn small ghost color={C.green} onClick={() => sendWA(client.phone, waMsg)}>📱 Send WA</Btn>
                        ) : <span style={{ color: "#ccc", fontSize: 11 }}>No phone</span>}
                      </td>
                      <td style={{ padding: "6px 10px" }}>
                        <Btn small ghost color={C.blue} onClick={() => openEstimateSlip({ ...e, _clientName: client?.name })}>👁 View</Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PETTY CASH — uses the shared sb client (SUPABASE_URL / SUPABASE_ANON above)
// ─────────────────────────────────────────────────────────────────────────────

function makePCClient() {
  const url = SUPABASE_URL;
  const key = SUPABASE_ANON;
  const headers = {
    "Content-Type": "application/json",
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
  const base = `${url}/rest/v1`;

  const buildSelect = (table, cols, filters, order) => {
    let q = `${base}/${table}?select=${cols}`;
    if (filters.length) q += "&" + filters.join("&");
    if (order) q += `&order=${order}`;
    return q;
  };

  return {
    from: (table) => ({
      select: (cols = "*") => {
        const state = { _cols: cols, _filters: [], _order: null };
        const chain = {
          eq(col, val) { state._filters.push(`${col}=eq.${encodeURIComponent(val)}`); return chain; },
          order(col, { ascending = true } = {}) { state._order = `${col}.${ascending ? "asc" : "desc"}`; return chain; },
          async execute() {
            const q = buildSelect(table, state._cols, state._filters, state._order);
            const r = await fetch(q, { headers: { ...headers, Prefer: "return=representation" } });
            const data = await r.json();
            return { data: Array.isArray(data) ? data : [], error: r.ok ? null : data };
          },
        };
        return chain;
      },
      insert: (rows) => ({
        async execute() {
          const r = await fetch(`${base}/${table}`, {
            method: "POST",
            headers: { ...headers, Prefer: "return=representation" },
            body: JSON.stringify(rows),
          });
          const data = await r.json();
          return { data, error: r.ok ? null : data };
        },
      }),
      update: (vals) => {
        const state = { _filters: [] };
        const chain = {
          eq(col, val) { state._filters.push(`${col}=eq.${encodeURIComponent(val)}`); return chain; },
          async execute() {
            const q = `${base}/${table}?` + state._filters.join("&");
            const r = await fetch(q, {
              method: "PATCH",
              headers: { ...headers, Prefer: "return=representation" },
              body: JSON.stringify(vals),
            });
            const data = await r.json();
            return { data, error: r.ok ? null : data };
          },
        };
        return chain;
      },
      delete: () => {
        const state = { _filters: [] };
        const chain = {
          eq(col, val) { state._filters.push(`${col}=eq.${encodeURIComponent(val)}`); return chain; },
          async execute() {
            const q = `${base}/${table}?` + state._filters.join("&");
            const r = await fetch(q, { method: "DELETE", headers });
            return { error: r.ok ? null : await r.json() };
          },
        };
        return chain;
      },
    }),
  };
}

const PC_HEADS_DEFAULT = [
  { id: "h1", name: "किराना / दैनिक सामान", emoji: "🛒" },
  { id: "h2", name: "यात्रा / ऑटो / कैब",   emoji: "🚗" },
  { id: "h3", name: "खाना / कैंटीन",         emoji: "🍱" },
  { id: "h4", name: "कार्यालय सामग्री",       emoji: "🖨️" },
  { id: "h5", name: "मरम्मत / रखरखाव",       emoji: "🔧" },
  { id: "h6", name: "कूरियर / डिलीवरी",      emoji: "📦" },
  { id: "h7", name: "अन्य / विविध",           emoji: "🌐" },
];
const PC_STORE_HEADS   = "pc_heads";
const PC_STORE_BUDGETS = "pc_budgets";
const PC_STORE_ROLE    = "pc_role";
const PC_STORE_USER    = "pc_user";
const PC_STAFF_TABLE   = "staff";

function PettyCash() {
  const db = makePCClient();

  const [staff,       setStaff]       = useState([]);
  const [role,        setRole]        = useState(() => localStorage.getItem(PC_STORE_ROLE) || null);
  const [currentUser, setCurrentUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PC_STORE_USER)); } catch { return null; }
  });
  const [view,    setView]    = useState("dashboard");
  const [heads,   setHeads]   = useState(() => {
    try { return JSON.parse(localStorage.getItem(PC_STORE_HEADS)) || PC_HEADS_DEFAULT; } catch { return PC_HEADS_DEFAULT; }
  });
  const [budgets, setBudgets] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PC_STORE_BUDGETS)) || {}; } catch { return {}; }
  });
  const [txns,     setTxns]     = useState([]);
  const [balances, setBalances] = useState({});
  const [loading,  setLoading]  = useState(false);

  useEffect(() => { localStorage.setItem(PC_STORE_HEADS,   JSON.stringify(heads));   }, [heads]);
  useEffect(() => { localStorage.setItem(PC_STORE_BUDGETS, JSON.stringify(budgets)); }, [budgets]);

  useEffect(() => {
    (async () => {
      const { data } = await db.from(PC_STAFF_TABLE).select("id,name").execute();
      setStaff(data || []);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTxns = useCallback(async () => {
    setLoading(true);
    const { data } = await db.from("petty_cash_txns")
      .select("*")
      .order("created_at", { ascending: false })
      .execute();
    const rows = data || [];
    setTxns(rows);
    const bal = {};
    rows.forEach(t => {
      if (!bal[t.runner_id]) bal[t.runner_id] = 0;
      bal[t.runner_id] += t.type === "credit" ? +t.amount : -t.amount;
    });
    setBalances(bal);
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (role) loadTxns(); }, [role, loadTxns]);

  function pcLogin(r, u) {
    setRole(r); setCurrentUser(u);
    localStorage.setItem(PC_STORE_ROLE, r);
    localStorage.setItem(PC_STORE_USER, JSON.stringify(u));
    setView(r === "admin" ? "dashboard" : "runner");
  }
  function pcLogout() {
    setRole(null); setCurrentUser(null);
    localStorage.removeItem(PC_STORE_ROLE);
    localStorage.removeItem(PC_STORE_USER);
  }

  if (!role) return <PCRoleSelect staff={staff} onSelect={pcLogin} />;

  return (
    <div style={{ minHeight: "100vh", background: "#f4f6fb", fontFamily: "sans-serif", margin: "-1rem" }}>
      <PCTopBar role={role} user={currentUser} view={view} setView={setView} onLogout={pcLogout} loading={loading} />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 12px" }}>
        {role === "admin" && view === "dashboard"    && <PCAdminDashboard txns={txns} heads={heads} budgets={budgets} staff={staff} balances={balances} db={db} onRefresh={loadTxns} />}
        {role === "admin" && view === "transactions" && <PCAllTransactions txns={txns} heads={heads} staff={staff} db={db} onRefresh={loadTxns} />}
        {role === "admin" && view === "settings"     && <PCSettings heads={heads} setHeads={setHeads} budgets={budgets} setBudgets={setBudgets} />}
        {role === "runner" && currentUser            && <PCRunnerPanel user={currentUser} txns={txns.filter(t => String(t.runner_id) === String(currentUser.id))} heads={heads} balance={balances[String(currentUser.id)] || 0} db={db} onRefresh={loadTxns} />}
      </div>
    </div>
  );
}

function PCRoleSelect({ staff, onSelect }) {
  const [sel, setSel] = useState("");
  return (
    <div style={{ minHeight: "60vh", background: "linear-gradient(135deg,#1a1a2e,#16213e)", display: "flex", alignItems: "center", justifyContent: "center", margin: "-1rem" }}>
      <div style={pcCard({ width: 340 })}>
        <h2 style={{ margin: "0 0 4px", color: "#1a1a2e" }}>💰 Petty Cash</h2>
        <p style={{ margin: "0 0 20px", color: "#888", fontSize: 13 }}>Login करें</p>
        <button style={{ ...pcBtn(), width: "100%", marginBottom: 16 }} onClick={() => onSelect("admin", { id: "admin", name: "Admin" })}>
          🔐 Admin Login
        </button>
        <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "0 0 16px" }} />
        <p style={{ margin: "0 0 8px", fontSize: 13, color: "#555", fontWeight: 600 }}>Runner Login</p>
        <select style={pcInp()} value={sel} onChange={e => setSel(e.target.value)}>
          <option value="">-- अपना नाम चुनें --</option>
          {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button style={{ ...pcBtn({ bg: "#e67e22" }), width: "100%" }} disabled={!sel}
          onClick={() => onSelect("runner", staff.find(s => String(s.id) === sel))}>
          🏃 Runner के रूप में जारी रखें
        </button>
      </div>
    </div>
  );
}

function PCTopBar({ role, user, view, setView, onLogout, loading }) {
  const tabs = [
    { k: "dashboard",    l: "📊 Dashboard"   },
    { k: "transactions", l: "📋 Transactions" },
    { k: "settings",     l: "⚙️ Settings"    },
  ];
  return (
    <div style={{ background: "#1a1a2e", color: "#fff", padding: "0 16px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minHeight: 52 }}>
      <span style={{ fontWeight: 700, fontSize: 16, marginRight: 8 }}>💰 Petty Cash</span>
      {role === "admin" && tabs.map(t => (
        <button key={t.k} onClick={() => setView(t.k)}
          style={{ background: view === t.k ? "#e67e22" : "transparent", color: "#fff", border: "none", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
          {t.l}
        </button>
      ))}
      {loading && <span style={{ fontSize: 12, opacity: 0.6, marginLeft: 4 }}>⏳</span>}
      <span style={{ marginLeft: "auto", fontSize: 13, opacity: 0.8 }}>
        {role === "admin" ? "🔐 Admin" : `🏃 ${user?.name}`}
      </span>
      <button onClick={onLogout} style={{ background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
        Logout
      </button>
    </div>
  );
}

function PCAdminDashboard({ txns, heads, budgets, staff, balances, db, onRefresh }) {
  const [showGive, setShowGive] = useState(false);
  const [giveForm, setGiveForm] = useState({ runner_id: "", amount: "", note: "" });
  const [saving,   setSaving]   = useState(false);

  const thisMonth   = new Date().toISOString().slice(0, 7);
  const monthDebits = txns.filter(t => t.created_at?.startsWith(thisMonth) && t.type === "debit");
  const headTotals  = Object.fromEntries(heads.map(h => [h.id, 0]));
  monthDebits.forEach(t => { if (headTotals[t.head_id] !== undefined) headTotals[t.head_id] += +t.amount; });

  const totalGiven = txns.filter(t => t.type === "credit").reduce((s, t) => s + +t.amount, 0);
  const totalSpent = txns.filter(t => t.type === "debit" ).reduce((s, t) => s + +t.amount, 0);

  async function giveCash() {
    if (!giveForm.runner_id || !giveForm.amount) return;
    setSaving(true);
    await db.from("petty_cash_txns").insert({
      runner_id: giveForm.runner_id, type: "credit",
      amount: +giveForm.amount, head_id: null,
      note: giveForm.note || "Cash दिया",
      created_at: new Date().toISOString(),
    }).execute();
    setGiveForm({ runner_id: "", amount: "", note: "" });
    setShowGive(false);
    await onRefresh();
    setSaving(false);
  }

  const summaryCards = [
    { l: "कुल दिया गया",  v: totalGiven,              c: "#27ae60" },
    { l: "कुल खर्च",      v: totalSpent,              c: "#e74c3c" },
    { l: "बचा हुआ (सभी)", v: totalGiven - totalSpent, c: "#2980b9" },
    { l: "इस महीने खर्च", v: monthDebits.reduce((s,t)=>s+ +t.amount,0), c: "#e67e22" },
  ];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 20 }}>
        {summaryCards.map(c => (
          <div key={c.l} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", boxShadow: pcShadow, borderLeft: `4px solid ${c.c}` }}>
            <div style={{ fontSize: 12, color: "#888" }}>{c.l}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: c.c }}>₹{c.v.toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: pcShadow }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>🏃 Runner Balances</h3>
          <button style={{ ...pcBtn(), fontSize: 12, padding: "6px 12px" }} onClick={() => setShowGive(true)}>+ Cash दें</button>
        </div>
        {staff.filter(s => s.id !== "admin").map(s => {
          const bal = balances[String(s.id)] || 0;
          return (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f0f0f0" }}>
              <span style={{ fontWeight: 500 }}>{s.name}</span>
              <span style={{ fontWeight: 700, color: bal >= 0 ? "#27ae60" : "#e74c3c", fontSize: 16 }}>₹{bal.toLocaleString()}</span>
            </div>
          );
        })}
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: 16, boxShadow: pcShadow }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>📊 इस महीने — Head-wise खर्च</h3>
        {heads.map(h => {
          const spent  = headTotals[h.id] || 0;
          const budget = budgets[h.id]    || 0;
          const pct    = budget ? Math.min(100, (spent / budget) * 100) : 0;
          const over   = budget && spent > budget;
          const warn   = budget && !over && pct > 80;
          return (
            <div key={h.id} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span>{h.emoji} {h.name}</span>
                <span style={{ color: over ? "#e74c3c" : "#333", fontWeight: over ? 700 : 400 }}>
                  ₹{spent.toLocaleString()}
                  {budget ? ` / ₹${budget.toLocaleString()}` : ""}
                  {over && " ⚠️ Budget पार!"}
                  {warn && " 🔶 80% पहुंच गया"}
                </span>
              </div>
              {budget > 0 && (
                <div style={{ height: 6, background: "#f0f0f0", borderRadius: 3 }}>
                  <div style={{ height: 6, borderRadius: 3, width: `${pct}%`, background: over ? "#e74c3c" : warn ? "#e67e22" : "#27ae60", transition: "width 0.4s" }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showGive && (
        <PCModal title="💵 Cash दें" onClose={() => setShowGive(false)}>
          <label style={pcLbl}>Runner चुनें</label>
          <select style={pcInp()} value={giveForm.runner_id} onChange={e => setGiveForm(f => ({ ...f, runner_id: e.target.value }))}>
            <option value="">-- Runner --</option>
            {staff.filter(s => s.id !== "admin").map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <label style={pcLbl}>Amount (₹)</label>
          <input style={pcInp()} type="number" placeholder="0" value={giveForm.amount} onChange={e => setGiveForm(f => ({ ...f, amount: e.target.value }))} />
          <label style={pcLbl}>Note</label>
          <input style={pcInp()} placeholder="कारण..." value={giveForm.note} onChange={e => setGiveForm(f => ({ ...f, note: e.target.value }))} />
          <button style={{ ...pcBtn(), width: "100%", marginTop: 8 }} onClick={giveCash} disabled={saving}>
            {saving ? "Saving..." : "✅ Confirm दें"}
          </button>
        </PCModal>
      )}
    </div>
  );
}

function PCAllTransactions({ txns, heads, staff, db, onRefresh }) {
  const [filter, setFilter] = useState("all");
  const staffMap = Object.fromEntries((staff || []).map(s => [String(s.id), s.name]));
  const headMap  = Object.fromEntries(heads.map(h => [h.id, h]));
  const rows     = filter === "all" ? txns : txns.filter(t => String(t.runner_id) === filter);

  async function deleteTxn(id) {
    if (!window.confirm("यह transaction delete करें?")) return;
    await db.from("petty_cash_txns").delete().eq("id", id).execute();
    onRefresh();
  }

  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 16, boxShadow: pcShadow }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>📋 सभी Transactions</h3>
        <select style={{ ...pcInp(), width: "auto", margin: 0 }} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">सभी Runner</option>
          {staff.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
        </select>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f8f8f8" }}>
              {["Date","Runner","Type","Head","Amount","Note",""].map(h => (
                <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#555", fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(t => {
              const head = headMap[t.head_id];
              return (
                <tr key={t.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={pcTd}>{t.created_at?.slice(0, 10)}</td>
                  <td style={pcTd}>{staffMap[String(t.runner_id)] || t.runner_id}</td>
                  <td style={pcTd}>
                    <span style={{ background: t.type === "credit" ? "#d5f5e3" : "#fde8e8", color: t.type === "credit" ? "#27ae60" : "#e74c3c", borderRadius: 4, padding: "2px 8px", fontSize: 11 }}>
                      {t.type === "credit" ? "💵 Credit" : "💸 Debit"}
                    </span>
                  </td>
                  <td style={pcTd}>{head ? `${head.emoji} ${head.name}` : t.head_id === "return" ? "💵 Return" : "—"}</td>
                  <td style={{ ...pcTd, fontWeight: 600, color: t.type === "credit" ? "#27ae60" : "#e74c3c" }}>₹{(+t.amount).toLocaleString()}</td>
                  <td style={{ ...pcTd, color: "#888" }}>{t.note || "—"}</td>
                  <td style={pcTd}>
                    <button onClick={() => deleteTxn(t.id)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#e74c3c", fontSize: 16 }}>🗑</button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "#aaa" }}>कोई transaction नहीं</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PCSettings({ heads, setHeads, budgets, setBudgets }) {
  const [newHead, setNewHead] = useState({ name: "", emoji: "📌" });

  function addHead() {
    if (!newHead.name.trim()) return;
    setHeads(h => [...h, { id: "h_" + Date.now(), name: newHead.name.trim(), emoji: newHead.emoji }]);
    setNewHead({ name: "", emoji: "📌" });
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 16, boxShadow: pcShadow }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>🗂️ Expense Heads + Monthly Budget</h3>
        {heads.map(h => (
          <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
            <span style={{ fontSize: 20 }}>{h.emoji}</span>
            <span style={{ flex: 1, fontSize: 13 }}>{h.name}</span>
            <input type="number" placeholder="Budget ₹" value={budgets[h.id] || ""}
              onChange={e => setBudgets(b => ({ ...b, [h.id]: +e.target.value }))}
              style={{ width: 100, ...pcInp(), margin: 0, padding: "4px 8px" }} />
            <button onClick={() => setHeads(hds => hds.filter(x => x.id !== h.id))}
              style={{ background: "transparent", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: 18 }}>✕</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input style={{ width: 44, ...pcInp(), margin: 0, padding: "6px 8px", textAlign: "center" }}
            value={newHead.emoji} onChange={e => setNewHead(n => ({ ...n, emoji: e.target.value }))} />
          <input style={{ flex: 1, ...pcInp(), margin: 0 }} placeholder="नया head नाम (हिंदी में)"
            value={newHead.name} onChange={e => setNewHead(n => ({ ...n, name: e.target.value }))} />
          <button style={{ ...pcBtn(), padding: "6px 14px" }} onClick={addHead}>+ Add</button>
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: 16, boxShadow: pcShadow }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>🛠️ Supabase Table (one-time setup)</h3>
        <p style={{ fontSize: 12, color: "#666", margin: "0 0 8px" }}>Supabase SQL Editor में एक बार run करें:</p>
        <pre style={{ background: "#f4f6fb", padding: 12, borderRadius: 8, fontSize: 11, overflowX: "auto", color: "#1a1a2e", lineHeight: 1.6 }}>{
`CREATE TABLE IF NOT EXISTS petty_cash_txns (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  runner_id  TEXT        NOT NULL,
  type       TEXT        NOT NULL CHECK (type IN ('credit','debit')),
  amount     NUMERIC     NOT NULL,
  head_id    TEXT,
  note       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE petty_cash_txns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON petty_cash_txns FOR ALL USING (true);`
        }</pre>
      </div>
    </div>
  );
}

function PCRunnerPanel({ user, txns, heads, balance, db, onRefresh }) {
  const [form,       setForm]       = useState({ amount: "", head_id: "", note: "" });
  const [returnForm, setReturnForm] = useState({ amount: "", note: "" });
  const [saving,     setSaving]     = useState(false);
  const [tab,        setTab]        = useState("log");

  async function logExpense() {
    if (!form.amount || !form.head_id) return;
    setSaving(true);
    await db.from("petty_cash_txns").insert({
      runner_id: String(user.id), type: "debit",
      amount: +form.amount, head_id: form.head_id,
      note: form.note, created_at: new Date().toISOString(),
    }).execute();
    setForm({ amount: "", head_id: "", note: "" });
    await onRefresh();
    setSaving(false);
  }

  async function returnCash() {
    if (!returnForm.amount) return;
    setSaving(true);
    await db.from("petty_cash_txns").insert({
      runner_id: String(user.id), type: "debit",
      amount: +returnForm.amount, head_id: "return",
      note: returnForm.note || "Cash वापस किया",
      created_at: new Date().toISOString(),
    }).execute();
    setReturnForm({ amount: "", note: "" });
    await onRefresh();
    setSaving(false);
  }

  return (
    <div>
      <div style={{ background: "linear-gradient(135deg,#1a1a2e,#2c3e50)", color: "#fff", borderRadius: 16, padding: "28px 20px", marginBottom: 16, textAlign: "center" }}>
        <div style={{ fontSize: 14, opacity: 0.7 }}>नमस्ते, {user.name} 👋</div>
        <div style={{ fontSize: 12, opacity: 0.5, margin: "4px 0 8px" }}>आपके पास अभी</div>
        <div style={{ fontSize: 44, fontWeight: 800, color: balance >= 0 ? "#2ecc71" : "#e74c3c" }}>
          ₹{balance.toLocaleString()}
        </div>
        <div style={{ fontSize: 12, opacity: 0.5, marginTop: 4 }}>बचा हुआ balance</div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[["log","💸 खर्च डालें"],["return","💵 वापस करें"],["history","📜 History"]].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ flex: 1, padding: "10px 4px", borderRadius: 8, border: "none", cursor: "pointer",
              fontWeight: 600, fontSize: 12, background: tab === k ? "#e67e22" : "#fff",
              color: tab === k ? "#fff" : "#333", boxShadow: pcShadow }}>
            {l}
          </button>
        ))}
      </div>

      {tab === "log" && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 16, boxShadow: pcShadow }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>💸 खर्च डालें</h3>
          <label style={pcLbl}>Expense Head चुनें</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, marginBottom: 12 }}>
            {heads.map(h => (
              <button key={h.id} onClick={() => setForm(f => ({ ...f, head_id: h.id }))}
                style={{ padding: "10px 8px", borderRadius: 8, textAlign: "left", cursor: "pointer", fontSize: 12, fontWeight: 500,
                  border: `2px solid ${form.head_id === h.id ? "#e67e22" : "#e0e0e0"}`,
                  background: form.head_id === h.id ? "#fff3e8" : "#fafafa" }}>
                {h.emoji} {h.name}
              </button>
            ))}
          </div>
          <label style={pcLbl}>Amount (₹)</label>
          <input style={pcInp()} type="number" placeholder="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
          <label style={pcLbl}>Note / विवरण</label>
          <input style={pcInp()} placeholder="क्या खरीदा? कहाँ गए?" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
          <button
            style={{ ...pcBtn({ bg: balance < +form.amount ? "#e74c3c" : "#27ae60" }), width: "100%", marginTop: 4 }}
            onClick={logExpense} disabled={saving || !form.amount || !form.head_id}>
            {saving ? "Saving..." : balance < +form.amount ? "⚠️ Balance कम — फिर भी Save?" : "✅ खर्च Save करें"}
          </button>
        </div>
      )}

      {tab === "return" && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 16, boxShadow: pcShadow }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>💵 Cash वापस करना है?</h3>
          <label style={pcLbl}>Amount (₹)</label>
          <input style={pcInp()} type="number" placeholder="0" value={returnForm.amount} onChange={e => setReturnForm(f => ({ ...f, amount: e.target.value }))} />
          <label style={pcLbl}>Note</label>
          <input style={pcInp()} placeholder="Note..." value={returnForm.note} onChange={e => setReturnForm(f => ({ ...f, note: e.target.value }))} />
          <button style={{ ...pcBtn({ bg: "#2980b9" }), width: "100%", marginTop: 4 }} onClick={returnCash} disabled={saving || !returnForm.amount}>
            {saving ? "Saving..." : "✅ Return Confirm करें"}
          </button>
        </div>
      )}

      {tab === "history" && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 16, boxShadow: pcShadow }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>📜 मेरा History</h3>
          {txns.length === 0 && <p style={{ color: "#aaa", textAlign: "center", padding: 20 }}>कोई record नहीं</p>}
          {txns.map(t => {
            const head = heads.find(h => h.id === t.head_id);
            return (
              <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f0f0f0" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    {head ? `${head.emoji} ${head.name}` : t.head_id === "return" ? "💵 Return" : "💰 Cash मिला"}
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>{t.note || "—"} · {t.created_at?.slice(0, 10)}</div>
                </div>
                <span style={{ fontWeight: 700, fontSize: 15, color: t.type === "credit" ? "#27ae60" : "#e74c3c" }}>
                  {t.type === "credit" ? "+" : "−"}₹{(+t.amount).toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PCModal({ onClose, title, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
      <div style={pcCard({ width: 340 })}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 20, cursor: "pointer", color: "#888" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const pcShadow = "0 2px 8px rgba(0,0,0,0.08)";
const pcTd     = { padding: "8px 10px" };
const pcLbl    = { display: "block", fontSize: 12, color: "#555", marginBottom: 4, fontWeight: 600 };
const pcInp    = () => ({ display: "block", width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, marginBottom: 10, boxSizing: "border-box", outline: "none" });
const pcBtn    = ({ bg = "#1a1a2e" } = {}) => ({ background: bg, color: "#fff", border: "none", padding: "10px 18px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 });
const pcCard   = ({ width = 360 } = {}) => ({ background: "#fff", borderRadius: 16, padding: 28, width, maxWidth: "90vw", boxShadow: "0 8px 32px rgba(0,0,0,0.15)", fontFamily: "sans-serif" });
