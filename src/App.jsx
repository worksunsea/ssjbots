import { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ── SUPABASE (shared Sun Sea project — same as ssj-hr / fms-tracker) ──
const SUPABASE_URL = "https://uppyxzellmuissdlxsmy.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwcHl4emVsbG11aXNzZGx4c215Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyODczNTMsImV4cCI6MjA5MTg2MzM1M30._eFep-C0IYuT-73AQU9oqE2k1bqneWZjsydUZGwt24E";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
const TENANT_ID = "a1b2c3d4-0000-0000-0000-000000000001";

// ── APPS SCRIPT (rates proxy — Google Sheet "new" tab) ──
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxGazdRhKxkjOLkqxN4kPoInDuBnlWy5Azmzq-FX9mt5OIfZLbhqfFEO0AufrOWE6n49Q/exec";

// ── UI CONSTANTS ──
const C = { green: "#27ae60", orange: "#e67e22", red: "#c0392b", blue: "#2980b9", gray: "#888", purple: "#8e44ad", pink: "#e84393", yellow: "#f39c12" };
const STAGES = ["greeting", "qualifying", "quoted", "objection", "closing", "handoff", "converted", "dead"];
const STAGE_C = { greeting: C.gray, qualifying: C.blue, quoted: C.purple, objection: C.orange, closing: C.yellow, handoff: C.red, converted: C.green, dead: "#999" };
const STATUSES = ["active", "handoff", "converted", "dead", "paused"];
const STATUS_C = { active: C.blue, handoff: C.red, converted: C.green, dead: "#999", paused: C.gray };
const PRODUCT_FOCUS = ["gold_bullion", "silver_coin", "coin_bar", "all"];
const ROLES = { superadmin: "Super Admin", admin: "Admin", manager: "Manager", staff: "Staff" };

// ── HELPERS ──
const normalizePhone = (p) => String(p || "").replace(/\D/g, "").replace(/^0+/, "").replace(/^91/, "");
const fmtD = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtDT = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtT = (d) => (d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "");
const saveLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const loadLocal = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } };
const loadUser = () => loadLocal("ssj_bullion_user", null);
const saveUser = (u) => saveLocal("ssj_bullion_user", u);

// Send via our own /api/send (Vercel Function → wa-service on Synology).
const sendWA = async ({ phone, message, leadId, funnelId }) => {
  try {
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: normalizePhone(phone), message, leadId, funnelId }),
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
    const { data, error } = await sb.from("staff").select("*").eq("tenant_id", TENANT_ID).eq("username", u.trim()).eq("password", p).single();
    if (error || !data) { setErr("Incorrect username or password."); setLoading(false); return; }
    if (!["superadmin", "admin"].includes(data.role)) { setErr("Access restricted to admins."); setLoading(false); return; }
    setLoading(false);
    onLogin(data);
  };

  return (
    <div style={{ maxWidth: 360, margin: "4rem auto", padding: "2rem", background: "#fff", border: "1px solid #e0e0e0", borderRadius: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 4px" }}>SSJ Bullion Bot</h2>
      <p style={{ fontSize: 13, color: "#888", margin: "0 0 24px" }}>Admin · CRM · Funnels · Personas</p>
      <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>USERNAME</label>
      <input value={u} onChange={(e) => setU(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} style={{ width: "100%", fontSize: 14, marginBottom: 12, padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
      <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>PASSWORD</label>
      <input type="password" value={p} onChange={(e) => setP(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} style={{ width: "100%", fontSize: 14, marginBottom: 16, padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
      {err && <p style={{ fontSize: 12, color: C.red, margin: "0 0 12px" }}>{err}</p>}
      <button onClick={submit} disabled={loading} style={{ width: "100%", padding: 10, borderRadius: 8, border: "none", background: C.blue, color: "#fff", fontSize: 14, cursor: "pointer", fontWeight: 500 }}>{loading ? "Logging in..." : "Login"}</button>
      <p style={{ fontSize: 11, color: "#aaa", margin: "16px 0 0", textAlign: "center" }}>Uses your Sun Sea staff account (superadmin/admin).</p>
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
function LeadsScreen({ funnels }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [filterFunnel, setFilterFunnel] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    let q = sb.from("bullion_leads").select("*").eq("tenant_id", TENANT_ID).order("updated_at", { ascending: false }).limit(500);
    if (filterFunnel) q = q.eq("funnel_id", filterFunnel);
    if (filterStatus) q = q.eq("status", filterStatus);
    const { data } = await q;
    if (data) setLeads(data);
    setLoading(false);
  }, [filterFunnel, filterStatus]);

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
    <div style={{ display: "grid", gridTemplateColumns: selected ? "380px 1fr" : "1fr", gap: 14 }}>
      {/* List */}
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
        </div>

        <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
          {loading ? "Loading…" : `${filtered.length} lead${filtered.length === 1 ? "" : "s"}`}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "75vh", overflowY: "auto" }}>
          {filtered.map((l) => {
            const f = funnels.find((ff) => ff.id === l.funnel_id);
            const sel = l.id === selectedId;
            return (
              <div key={l.id} onClick={() => setSelectedId(l.id)} style={{ padding: 10, background: sel ? "#eef5ff" : "#fff", border: `1px solid ${sel ? C.blue : "#eee"}`, borderRadius: 10, cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <strong style={{ fontSize: 13 }}>{l.name || l.phone}</strong>
                  <Pill color={STATUS_C[l.status] || C.gray} solid>{l.status}</Pill>
                </div>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{l.phone} · {f?.name || l.funnel_id || "—"}</div>
                {l.last_msg && <div style={{ fontSize: 12, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.last_msg}</div>}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                  <StageBar stage={l.stage} />
                  <span style={{ fontSize: 10, color: "#aaa" }}>{fmtDT(l.updated_at)}</span>
                </div>
              </div>
            );
          })}
          {!filtered.length && !loading && <div style={{ padding: 20, textAlign: "center", color: "#aaa", fontSize: 13 }}>No leads yet.</div>}
        </div>
      </div>

      {/* Conversation pane */}
      {selected && <ConversationPane lead={selected} funnel={selectedFunnel} onClose={() => setSelectedId(null)} onChanged={load} />}
    </div>
  );
}

function ConversationPane({ lead, funnel, onClose, onChanged }) {
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadMsgs = useCallback(async () => {
    const { data } = await sb.from("bullion_messages").select("*").eq("tenant_id", TENANT_ID).eq("lead_id", lead.id).order("created_at", { ascending: true });
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

  return (
    <Card style={{ display: "flex", flexDirection: "column", height: "78vh", padding: 0 }}>
      {/* Header */}
      <div style={{ padding: 14, borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <strong style={{ fontSize: 14 }}>{lead.name || lead.phone}</strong>
            <Pill color={STATUS_C[lead.status]} solid>{lead.status}</Pill>
            {lead.bot_paused && <Pill color={C.orange}>bot paused</Pill>}
          </div>
          <div style={{ fontSize: 11, color: "#888" }}>{lead.phone} · {funnel?.name || lead.funnel_id} · {lead.exchanges_count || 0} exchanges</div>
          <div style={{ fontSize: 11, color: "#888", marginTop: 3 }}>
            {lead.city && <span>📍 {lead.city} · </span>}
            {lead.email && <span>✉️ {lead.email} · </span>}
            {lead.bday && <span>🎂 {lead.bday} · </span>}
            {lead.anniversary && <span>💍 {lead.anniversary}</span>}
            {!lead.city && !lead.email && !lead.bday && !lead.anniversary && <em>(name/city/bday/anniv not captured yet)</em>}
          </div>
          <div style={{ marginTop: 6 }}><StageBar stage={lead.stage} /></div>
        </div>
        <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 20, color: "#888", cursor: "pointer" }}>×</button>
      </div>

      {/* Actions */}
      <div style={{ padding: "8px 14px", borderBottom: "1px solid #eee", display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Btn small ghost color={lead.bot_paused ? C.green : C.orange} onClick={toggleBot} disabled={busy}>{lead.bot_paused ? "Resume bot" : "Pause bot"}</Btn>
        <Btn small ghost color={C.green} onClick={() => setStatus("converted", { stage: "converted" })} disabled={busy}>Mark converted</Btn>
        <Btn small ghost color={C.red} onClick={() => setStatus("handoff", { stage: "handoff", bot_paused: true })} disabled={busy}>Handoff</Btn>
        <Btn small ghost color={C.gray} onClick={() => setStatus("dead", { stage: "dead" })} disabled={busy}>Dead</Btn>
      </div>

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
// FUNNELS SCREEN
// ──────────────────────────────────────────────────────────
function FunnelsScreen({ funnels, personas, onReload }) {
  const [editing, setEditing] = useState(null); // null | 'new' | funnel object
  const [stepsFor, setStepsFor] = useState(null); // funnel or null — opens steps editor

  const toggleActive = async (f) => {
    await sb.from("funnels").update({ active: !f.active }).eq("id", f.id);
    onReload();
  };

  return (
    <div>
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
              <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>WA: {f.wa_number} (client {f.wbiztool_client || "?"})</div>
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

      {editing && <FunnelForm funnel={editing === "new" ? null : editing} personas={personas} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onReload(); }} />}
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
      .eq("tenant_id", TENANT_ID)
      .eq("funnel_id", funnel.id)
      .order("step_order", { ascending: true });
    setSteps(data || []);
    setLoading(false);
  }, [funnel.id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const addStep = () => {
    const next = steps.length + 1;
    setSteps((s) => [...s, {
      _new: true,
      tenant_id: TENANT_ID,
      funnel_id: funnel.id,
      step_order: next,
      name: `Step ${next}`,
      delay_minutes: next === 1 ? 120 : 1440, // 2h, then 1 day
      trigger_type: next === 1 ? "after_enrollment" : "after_prev_step",
      trigger_at: null,
      condition: "always",
      message_template: "Hi Sir/Ma'am {{name}}, just checking in — any questions about your earlier enquiry?",
      active: true,
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

  const fmtDelay = (mins) => {
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
              <div style={{ display: "grid", gridTemplateColumns: "50px 1fr 90px auto", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <Input type="number" value={row.step_order} onChange={(e) => updateStep(idx, "step_order", Number(e.target.value))} style={{ padding: 4 }} />
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
                    <option value="after_enrollment">After enrollment (first enroll)</option>
                    <option value="after_last_inbound">After lead's last inbound message</option>
                    <option value="after_last_purchase">After lead's last purchase</option>
                    <option value="specific_datetime">On specific date + time</option>
                  </Select>
                </Field>
                {showDelay && (
                  <Field label={`Delay (minutes) — current: ${fmtDelay(row.delay_minutes || 0)}`}>
                    <Input type="number" value={row.delay_minutes || 0} onChange={(e) => updateStep(idx, "delay_minutes", Number(e.target.value))} />
                  </Field>
                )}
                {showDatetime && (
                  <Field label="Send at (exact date + time, IST)">
                    <Input type="datetime-local" value={row.trigger_at ? String(row.trigger_at).slice(0, 16) : ""} onChange={(e) => updateStep(idx, "trigger_at", e.target.value ? new Date(e.target.value).toISOString() : null)} />
                  </Field>
                )}
              </div>
              <Textarea
                rows={3}
                value={row.message_template || ""}
                onChange={(e) => updateStep(idx, "message_template", e.target.value)}
                placeholder="Message text. Placeholders: {{name}} {{city}} {{phone}} {{funnel_name}} {{goal}}"
              />
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

function FunnelForm({ funnel, personas, onClose, onSaved }) {
  const isNew = !funnel?.id;
  const [form, setForm] = useState(funnel || { id: "", name: "", description: "", wa_number: "8860866000", wbiztool_client: "7560", product_focus: "gold_bullion", persona_id: personas[0]?.id || null, active: true, goal: "", max_exchanges_before_handoff: 3 });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setErr("");
    if (!form.id) return setErr("id is required (short slug like f1, akshaya_gold_2026)");
    if (!form.name) return setErr("name is required");
    if (!form.description) return setErr("description is required — it's the bot's context for this funnel");
    if (!form.wa_number) return setErr("WhatsApp number is required");
    setSaving(true);
    const payload = { ...form, tenant_id: TENANT_ID };
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="WhatsApp number" required><Input value={form.wa_number} onChange={(e) => set("wa_number", e.target.value)} placeholder="8860866000" /></Field>
        <Field label="WbizTool whatsapp_client id"><Input value={form.wbiztool_client || ""} onChange={(e) => set("wbiztool_client", e.target.value)} placeholder="7560" /></Field>
      </div>
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
      <Field label="Goal"><Input value={form.goal || ""} onChange={(e) => set("goal", e.target.value)} placeholder="Book a showroom visit within 48 hours" /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
    await sb.from("personas").update({ is_default: false }).eq("tenant_id", TENANT_ID).neq("id", p.id);
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
    const payload = { ...form, tenant_id: TENANT_ID };
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
      .eq("tenant_id", TENANT_ID)
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
      tenant_id: TENANT_ID,
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
// ANALYTICS SCREEN — per-funnel metrics
// ──────────────────────────────────────────────────────────
function AnalyticsScreen({ funnels }) {
  const [metrics, setMetrics] = useState([]);
  const [stageCounts, setStageCounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    const [m, leads] = await Promise.all([
      sb.from("bullion_funnel_metrics").select("*").eq("tenant_id", TENANT_ID),
      sb.from("bullion_leads").select("funnel_id,stage,status,created_at").eq("tenant_id", TENANT_ID).gte("created_at", fromDate).lte("created_at", toDate + "T23:59:59"),
    ]);
    if (m.data) setMetrics(m.data);
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
    setLoading(false);
  }, [fromDate, toDate]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "#666", flex: 1 }}>Conversion % and stage drop-off per funnel.</div>
        <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ width: 150 }} />
        <span style={{ color: "#888" }}>→</span>
        <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ width: 150 }} />
        <Btn ghost small color={C.gray} onClick={load} disabled={loading}>↻</Btn>
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
        <Card>
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
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// MAIN APP
// ──────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(loadUser);
  const [screen, setScreen] = useState("leads");
  const [funnels, setFunnels] = useState([]);
  const [personas, setPersonas] = useState([]);

  const login = (u) => { saveUser(u); setUser(u); };
  const logout = () => { saveUser(null); setUser(null); };

  const loadFunnels = useCallback(async () => {
    const { data } = await sb.from("funnels").select("*").eq("tenant_id", TENANT_ID).order("active", { ascending: false }).order("id");
    if (data) setFunnels(data);
  }, []);
  const loadPersonas = useCallback(async () => {
    const { data } = await sb.from("personas").select("*").eq("tenant_id", TENANT_ID).order("is_default", { ascending: false }).order("name");
    if (data) setPersonas(data);
  }, []);

  useEffect(() => {
    if (!user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFunnels();
    loadPersonas();
  }, [user, loadFunnels, loadPersonas]);

  if (!user) return <LoginScreen onLogin={login} />;

  const tabs = [
    { k: "leads", l: "Leads", icon: "💬" },
    { k: "funnels", l: "Funnels", icon: "🎯" },
    { k: "personas", l: "Personas", icon: "🎭" },
    { k: "faqs", l: "FAQs", icon: "❓" },
    { k: "rates", l: "Rates", icon: "📈" },
    { k: "analytics", l: "Analytics", icon: "📊" },
  ];

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "1rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 2px" }}>Sun Sea Jewellers — Bullion Bot</h2>
          <p style={{ fontSize: 12, color: "#888", margin: 0 }}>{ROLES[user.role] || user.role} · {user.name}</p>
        </div>
        <button onClick={logout} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 7, border: "1px solid #ddd", background: "transparent", cursor: "pointer" }}>Logout</button>
      </div>

      {/* Navigation */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, borderBottom: "1px solid #eee", paddingBottom: 10, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button key={t.k} onClick={() => setScreen(t.k)} style={{ fontSize: 13, padding: "6px 14px", borderRadius: 8, border: `1px solid ${screen === t.k ? C.blue : "#ddd"}`, background: screen === t.k ? C.blue : "transparent", color: screen === t.k ? "#fff" : "#333", cursor: "pointer" }}>{t.icon} {t.l}</button>
        ))}
      </div>

      {/* Screens */}
      {screen === "leads" && <LeadsScreen funnels={funnels} />}
      {screen === "funnels" && <FunnelsScreen funnels={funnels} personas={personas} onReload={loadFunnels} />}
      {screen === "personas" && <PersonasScreen personas={personas} onReload={loadPersonas} />}
      {screen === "faqs" && <FaqsScreen />}
      {screen === "rates" && <RatesScreen />}
      {screen === "analytics" && <AnalyticsScreen funnels={funnels} />}
    </div>
  );
}
