// Solitaire jewellery designer module — /solitairejewellery (public, like
// /corporategiftingcoins) plus an admin-only AI Design Generator panel used
// from within the main app. Kept in its own file rather than folded into
// App.jsx (16k+ lines, flagged stable) to keep this feature's blast radius
// contained — see SSJ_STABLE_FEATURES.md before touching App.jsx itself.
//
// Public-facing visual theme intentionally matches the corporate-gifting /
// public-catalogue pages: Cormorant (display) + Montserrat (body), white
// background, gold accent — see CATALOGUE_FONTS_CSS in App.jsx for the
// original theme this mirrors.

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  GOLD_PURITIES, DIAMOND_SHAPES, LABGROWN_CARAT_SIZES, computeSolitairePrice,
} from "./utils/solitairePricing";
import { secureImageUpload } from "./utils/imageUpload";
import { createClient } from "@supabase/supabase-js";

const CRM_SECRET = (import.meta.env.VITE_CRM_SECRET || "").trim();
const API = "/api/solitaire-designs";
const SUPABASE_URL = "https://uppyxzellmuissdlxsmy.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwcHl4emVsbG11aXNzZGx4c215Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyODczNTMsImV4cCI6MjA5MTg2MzM1M30._eFep-C0IYuT-73AQU9oqE2k1bqneWZjsydUZGwt24E";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
const categoryCoverUrl = (key) => `${SUPABASE_URL}/storage/v1/object/public/media/uploads/solitaire-designs/category-covers/${key}.png`;
const CATEGORIES = [
  { key: "ring", label: "Rings", icon: "\u{1F48D}", cover: categoryCoverUrl("ring") },
  { key: "gents_ring", label: "Gents Rings", icon: "\u{1F48D}", cover: categoryCoverUrl("gents_ring") },
  { key: "pendant", label: "Pendants", icon: "\u{1F4FF}", cover: categoryCoverUrl("pendant") },
  { key: "earring", label: "Earrings", icon: "\u{1F440}", cover: categoryCoverUrl("earring") },
];
const GOLD_COLORS = ["yellow", "white", "rose"];

const loadLocal = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } };
const saveLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const loadStaffUser = () => loadLocal("ssj_bullion_user", null);

async function apiGet(action, params = {}, staffOnly = false) {
  try {
    const qs = new URLSearchParams({ action, ...params }).toString();
    const headers = staffOnly ? { "x-crm-secret": CRM_SECRET } : undefined;
    const r = await fetch(`${API}?${qs}`, headers ? { headers } : undefined);
    return await r.json();
  } catch (e) {
    return { ok: false, error: "network_error", detail: String(e.message || e) };
  }
}
async function apiPost(action, body, staffOnly = false) {
  try {
    const headers = { "Content-Type": "application/json" };
    if (staffOnly) headers["x-crm-secret"] = CRM_SECRET;
    const r = await fetch(`${API}?action=${action}`, { method: "POST", headers, body: JSON.stringify(body) });
    return await r.json();
  } catch (e) {
    return { ok: false, error: "network_error", detail: String(e.message || e) };
  }
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Theme — matches CATALOGUE_FONTS_CSS ("Luxury Serif") from App.jsx,
// forced light/white per Saurav's request (no dark-mode variant here). ────
const FONT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant:wght@400;500;600;700&family=Montserrat:wght@300;400;500;600;700&display=swap');
.sol-page * { box-sizing: border-box; }
.sol-card { transition: border-color 200ms ease, box-shadow 200ms ease; }
.sol-card:hover { border-color: #CA8A04; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
`;

const THEME = {
  bg: "#FFFFFF",
  surface: "#FFFFFF",
  text: "#1C1917",
  muted: "#57534E",
  border: "#E7E5E4",
  gold: "#CA8A04",
  goldSoft: "#FEF3C7",
};

const page = { minHeight: "100vh", background: THEME.bg, color: THEME.text, fontFamily: "Montserrat, sans-serif" };
const heading = { fontFamily: "Cormorant, serif", fontWeight: 600, letterSpacing: 0.3 };
const btnPrimary = { background: THEME.gold, color: "#FFFFFF", border: "none", borderRadius: 2, padding: "12px 28px", fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: "Montserrat, sans-serif" };
const btnGhost = { background: "transparent", color: THEME.text, border: `1px solid ${THEME.border}`, borderRadius: 2, padding: "10px 22px", fontSize: 13, letterSpacing: "0.06em", cursor: "pointer", fontFamily: "Montserrat, sans-serif" };

// ── Lead capture popup ───────────────────────────────────────────────────
function LeadPopup({ onDone }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    if (!name.trim()) return setErr("Please enter your name");
    if (!/^\d{10}$/.test(phone.trim())) return setErr("Enter a valid 10-digit phone number");
    setBusy(true);
    const res = await apiPost("lead", { name, phone, email });
    setBusy(false);
    if (!res.ok) return setErr(res.error || "Something went wrong");
    saveLocal("solitaire_lead_done", true);
    saveLocal("solitaire_lead_id", res.leadId);
    onDone(res.leadId);
  };

  return (
    <div className="sol-page" style={page}>
      <style>{FONT_CSS}</style>
      <div style={{ position: "fixed", inset: 0, background: "rgba(28,25,23,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
        <div style={{ background: THEME.surface, border: `1px solid ${THEME.border}`, borderRadius: 4, padding: 32, maxWidth: 400, width: "100%" }}>
          <div style={{ ...heading, fontSize: 24, color: THEME.text, marginBottom: 4 }}>Sun Sea Jewellers</div>
          <div style={{ width: 40, height: 2, background: THEME.gold, margin: "10px 0 16px" }} />
          <div style={{ fontSize: 13, color: THEME.muted, marginBottom: 24 }}>Design your own solitaire piece. Tell us a little about you to begin.</div>
          <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          <input placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} style={inputStyle} />
          <input placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
          {err && <div style={{ color: "#B91C1C", fontSize: 12, marginBottom: 10 }}>{err}</div>}
          <button style={{ ...btnPrimary, width: "100%", marginTop: 8 }} disabled={busy} onClick={submit}>
            {busy ? "Please wait…" : "Begin Designing"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle = { width: "100%", boxSizing: "border-box", background: "#FFFFFF", border: `1px solid ${THEME.border}`, color: THEME.text, padding: "12px 14px", marginBottom: 12, borderRadius: 2, fontSize: 14, fontFamily: "Montserrat, sans-serif" };

// ── Design gallery ───────────────────────────────────────────────────────
function DesignGallery({ category, onSelect, onBack }) {
  const [designs, setDesigns] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    apiGet("designs", { category }).then((r) => {
      if (r.ok) { setDesigns(r.designs); setErr(""); }
      else { setDesigns([]); setErr(r.error || "Couldn't load designs — please try again."); }
    });
  }, [category]);

  if (designs === null) return <Loading label="Loading designs…" />;

  const sellable = designs.filter((d) => d.variants.length > 0);

  return (
    <div style={{ padding: "40px 24px", maxWidth: 1100, margin: "0 auto" }}>
      <button style={{ ...btnGhost, marginBottom: 24 }} onClick={onBack}>&larr; Back</button>
      <h2 style={{ ...heading, fontSize: 28, color: THEME.text, marginBottom: 8 }}>
        {CATEGORIES.find((c) => c.key === category)?.label}
      </h2>
      <div style={{ color: THEME.muted, fontSize: 13, marginBottom: 32 }}>Choose a design to begin configuring.</div>

      {err && <div style={{ color: "#B91C1C", fontSize: 13, marginBottom: 16 }}>{err}</div>}
      {!err && !sellable.length && (
        <div style={{ color: THEME.muted, fontSize: 14 }}>No designs are ready to view yet in this category — please check back soon.</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 20 }}>
        {sellable.map((d) => {
          const cover = d.variants[0]?.viewImages?.front || d.variants[0]?.viewImages?.worn;
          return (
            <div key={d.id} className="sol-card" onClick={() => onSelect(d)} style={{ cursor: "pointer", background: THEME.surface, border: `1px solid ${THEME.border}`, borderRadius: 4, overflow: "hidden" }}>
              <div style={{ aspectRatio: "1 / 1", background: "#F5F5F4", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {cover ? <img src={cover} alt={d.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ color: THEME.muted, fontSize: 12 }}>Image pending</span>}
              </div>
              <div style={{ padding: "12px 14px" }}>
                <div style={{ fontSize: 14 }}>{d.name}</div>
                <div style={{ fontSize: 11, color: THEME.muted, marginTop: 2 }}>{d.variants.length} option{d.variants.length !== 1 ? "s" : ""} available</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Loading({ label }) {
  return <div style={{ padding: 60, textAlign: "center", color: THEME.muted, fontSize: 14 }}>{label}</div>;
}

// Category picker tile — attractive editorial cover photo (see
// action=generate-category-cover) with a gradient + label overlay. Falls
// back to a plain emoji tile if the cover hasn't been generated yet (404).
function CategoryTile({ category: c, onClick }) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <div className="sol-card" onClick={onClick} style={{ cursor: "pointer", width: 240, height: 280, position: "relative", overflow: "hidden", background: THEME.surface, border: `1px solid ${THEME.border}`, borderRadius: 4 }}>
      {imgOk ? (
        <>
          <img src={c.cover} alt={c.label} onError={() => setImgOk(false)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(28,25,23,0) 45%, rgba(28,25,23,0.78) 100%)" }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 20, textAlign: "center" }}>
            <div style={{ ...heading, fontSize: 20, color: "#FFFFFF" }}>{c.label}</div>
          </div>
        </>
      ) : (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{c.icon}</div>
          <div style={{ ...heading, fontSize: 18 }}>{c.label}</div>
        </div>
      )}
    </div>
  );
}

// ── Configurator ─────────────────────────────────────────────────────────
function Configurator({ design, leadId, staffUser, onBack }) {
  const goldColors = [...new Set(design.variants.map((v) => v.goldColor))];
  const shapesFor = (gc) => [...new Set(design.variants.filter((v) => v.goldColor === gc).map((v) => v.diamondShape))];

  const [goldColor, setGoldColor] = useState(goldColors[0]);
  const [shape, setShape] = useState(shapesFor(goldColors[0])[0]);
  const [caratSize, setCaratSize] = useState(LABGROWN_CARAT_SIZES[4]); // 1ct default
  const [diamondSource, setDiamondSource] = useState("labgrown");
  const [diamondColor, setDiamondColor] = useState("G");
  const [diamondClarity, setDiamondClarity] = useState("VS1");
  const [purityKey, setPurityKey] = useState("18kt");

  const [rates, setRates] = useState(null);
  const [rapData, setRapData] = useState(null);
  const [labgrownPrices, setLabgrownPrices] = useState(null);
  const [pricingConfig, setPricingConfig] = useState(null);

  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(null);
  const [showTryOn, setShowTryOn] = useState(false);
  const [tryonUrl, setTryonUrl] = useState(null);
  const [activeView, setActiveView] = useState("front");
  const [showSizeChart, setShowSizeChart] = useState(false);

  useEffect(() => {
    apiGet("rates").then((r) => setRates(r.ok ? r.rates : null));
    apiGet("labgrown-prices").then((r) => setLabgrownPrices(r.ok ? r.prices : []));
    apiGet("pricing-config").then((r) => setPricingConfig(r.ok ? r : { makingChargePerGram: 350, sellDiscPct: 30 }));
    // Rapaport table lives in bullion_dropdowns, same source the Calculator uses.
    sb.from("bullion_dropdowns").select("value,updated_at").eq("field", "rapaport_data")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => { if (data?.value) { try { setRapData(JSON.parse(data.value)); } catch { /* ignore */ } } });
  }, []);

  const variant = design.variants.find((v) => v.goldColor === goldColor && v.diamondShape === shape) || null;
  const usdInr = rates?.usdInr;

  // Reset the active image view when the selected variant changes — adjusting
  // state during render (not an effect) per React's recommended pattern for
  // resetting derived state on a prop/computed-value change.
  const [prevVariantId, setPrevVariantId] = useState(variant?.id);
  if (variant?.id !== prevVariantId) { setPrevVariantId(variant?.id); setActiveView("front"); }

  const price = variant && rates && pricingConfig
    ? computeSolitairePrice({
        rates, rapData, usdInr, labgrownPrices,
        diamondSource, caratSize, shape, diamondColor, diamondClarity, sellDiscPct: pricingConfig.sellDiscPct,
        purityKey, estGoldWeightG: variant.estGoldWeightG, makingChargePerGram: pricingConfig.makingChargePerGram,
        sideDiamondWeightCt: design.hasSideDiamonds ? design.sideDiamondWeightCt : 0,
        sideDiamondPricePerCt: pricingConfig.sideDiamondPricePerCt,
      })
    : { priceable: false };

  const save = async () => {
    setSaving(true);
    const res = await apiPost("save-selection", {
      leadId: leadId || null,
      createdBy: staffUser?.name || null,
      designId: design.id,
      variantId: variant.id,
      category: design.category,
      shape, caratSize, diamondSource, diamondColor, diamondClarity,
      goldKarat: purityKey, goldPurityPct: GOLD_PURITIES.find((p) => p.key === purityKey)?.pct,
      goldColor,
      priceBreakdown: price,
      tryonImageUrl: tryonUrl,
    });
    setSaving(false);
    if (res.ok) setSavedId(res.selection.id);
  };

  return (
    <div style={{ padding: "40px 24px", maxWidth: 1000, margin: "0 auto" }}>
      <button style={{ ...btnGhost, marginBottom: 24 }} onClick={onBack}>&larr; Back to designs</button>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40 }}>
        <div>
          <div style={{ aspectRatio: "1 / 1", background: "#F5F5F4", border: `1px solid ${THEME.border}`, borderRadius: 4, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {variant?.viewImages?.[activeView] || variant?.viewImages?.front
              ? <img src={variant.viewImages[activeView] || variant.viewImages.front} alt={design.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <span style={{ color: THEME.muted, fontSize: 12 }}>This combination isn't available yet</span>}
          </div>
          {variant?.viewImages && Object.keys(variant.viewImages).length > 1 && (
            <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
              {["front", "angle", "worn"].filter((k) => variant.viewImages[k]).map((k) => (
                <img key={k} src={variant.viewImages[k]} alt={k} onClick={() => setActiveView(k)}
                  style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 4, cursor: "pointer", border: `2px solid ${activeView === k ? THEME.gold : THEME.border}` }} />
              ))}
            </div>
          )}
          <button style={{ ...btnGhost, marginTop: 16 }} onClick={() => setShowTryOn(true)}>Try It On</button>
        </div>

        <div>
          <h2 style={{ ...heading, fontSize: 26, color: THEME.text, marginBottom: 20 }}>{design.name}</h2>

          <Field label="Gold Colour">
            <Choices options={goldColors} value={goldColor} onChange={(v) => { setGoldColor(v); const s = shapesFor(v); if (!s.includes(shape)) setShape(s[0]); }} render={(o) => o[0].toUpperCase() + o.slice(1)} />
          </Field>
          <Field label="Diamond Shape">
            <Choices options={shapesFor(goldColor)} value={shape} onChange={setShape} />
          </Field>
          <Field label="Diamond Size (carat)">
            <select style={selectStyle} value={caratSize} onChange={(e) => setCaratSize(Number(e.target.value))}>
              {LABGROWN_CARAT_SIZES.map((c) => <option key={c} value={c}>{c} ct</option>)}
            </select>
            {design.sizeChartImageUrl && (
              <button onClick={() => setShowSizeChart(true)} style={{ ...btnGhost, marginTop: 8, padding: "6px 12px", fontSize: 12 }}>
                See size comparison (.30ct–5ct)
              </button>
            )}
          </Field>
          <Field label="Diamond Type">
            <Choices options={["labgrown", "natural"]} value={diamondSource} onChange={setDiamondSource} render={(o) => (o === "labgrown" ? "Lab-Grown" : "Natural")} />
          </Field>
          {diamondSource === "natural" && (
            <div style={{ display: "flex", gap: 12 }}>
              <Field label="Colour"><select style={selectStyle} value={diamondColor} onChange={(e) => setDiamondColor(e.target.value)}>{["D","E","F","G","H","I","J"].map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Clarity"><select style={selectStyle} value={diamondClarity} onChange={(e) => setDiamondClarity(e.target.value)}>{["FL","VVS1","VVS2","VS1","VS2","SI1","SI2"].map((c) => <option key={c}>{c}</option>)}</select></Field>
            </div>
          )}
          <Field label="Gold Purity">
            <select style={selectStyle} value={purityKey} onChange={(e) => setPurityKey(e.target.value)}>
              {GOLD_PURITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </Field>

          <div style={{ marginTop: 24, padding: 20, background: "#FAFAF9", border: `1px solid ${THEME.border}`, borderRadius: 4 }}>
            {!variant && <div style={{ color: THEME.muted, fontSize: 13 }}>Choose a gold colour + shape combination that's available above.</div>}
            {variant && !price.priceable && <div style={{ color: THEME.muted, fontSize: 13 }}>Price unavailable for this exact combination — our team will confirm it for you.</div>}
            {variant && price.priceable && (
              <>
                <Row label="Gold value" value={price.goldValue} />
                <Row label="Diamond value" value={price.diamondValue} />
                {price.sideDiamondValue > 0 && <Row label={`Side diamonds (${design.sideDiamondWeightCt}ct)`} value={price.sideDiamondValue} />}
                <Row label="Making charges" value={price.making} />
                <div style={{ borderTop: `1px solid ${THEME.border}`, marginTop: 10, paddingTop: 10, display: "flex", justifyContent: "space-between" }}>
                  <span style={{ ...heading, fontSize: 17 }}>Total</span>
                  <span style={{ ...heading, fontSize: 22, color: THEME.gold }}>₹{price.total.toLocaleString("en-IN")}</span>
                </div>
              </>
            )}
          </div>

          {savedId
            ? <div style={{ marginTop: 16, color: "#15803D", fontSize: 13 }}>Saved! Our team will follow up with you shortly.</div>
            : <button style={{ ...btnPrimary, width: "100%", marginTop: 16 }} disabled={!variant || !price.priceable || saving} onClick={save}>
                {saving ? "Saving…" : "Save This Design"}
              </button>}
        </div>
      </div>

      {showTryOn && (
        <TryOnModal jewelleryImageUrl={variant?.viewImages?.worn || variant?.viewImages?.front} category={design.category}
          onClose={() => setShowTryOn(false)}
          onSaved={(url) => { setTryonUrl(url); setShowTryOn(false); }} />
      )}

      {showSizeChart && design.sizeChartImageUrl && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(28,25,23,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: 16 }}
          onClick={() => setShowSizeChart(false)}>
          <div style={{ background: THEME.surface, border: `1px solid ${THEME.border}`, borderRadius: 4, padding: 16, maxWidth: 900, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ ...heading, fontSize: 16, marginBottom: 10 }}>Size Comparison — .30ct to 5ct</div>
            <img src={design.sizeChartImageUrl} alt="size comparison" style={{ width: "100%", borderRadius: 4 }} />
            <button style={{ ...btnGhost, marginTop: 12 }} onClick={() => setShowSizeChart(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return <div style={{ marginBottom: 16, flex: 1 }}><div style={{ fontSize: 11, color: THEME.muted, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>{children}</div>;
}
function Choices({ options, value, onChange, render }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} style={{
          padding: "8px 14px", fontSize: 13, borderRadius: 2, cursor: "pointer", fontFamily: "Montserrat, sans-serif",
          background: value === o ? THEME.gold : "transparent",
          color: value === o ? "#FFFFFF" : THEME.text,
          border: `1px solid ${value === o ? THEME.gold : THEME.border}`,
        }}>{render ? render(o) : o}</button>
      ))}
    </div>
  );
}
const selectStyle = { ...inputStyle, marginBottom: 0, cursor: "pointer" };
function Row({ label, value }) {
  return <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: THEME.muted, marginBottom: 6 }}><span>{label}</span><span>₹{Number(value || 0).toLocaleString("en-IN")}</span></div>;
}

// ── Try It On — client-side face landmark overlay (face-api.js, browser-only) ──
function TryOnModal({ jewelleryImageUrl, category, onClose, onSaved }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let stream;
    (async () => {
      try {
        const faceapi = await import("face-api.js");
        const MODEL_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights";
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        setModelsLoaded(true);
      } catch {
        setErr("Live guide unavailable — you can still upload a photo.");
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        if (videoRef.current) { videoRef.current.srcObject = stream; setReady(true); }
      } catch {
        // camera denied/unavailable — user can still use file upload below
      }
    })();
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const capture = async (sourceEl, isVideo) => {
    setBusy(true);
    setErr("");
    try {
      const canvas = canvasRef.current;
      const w = isVideo ? sourceEl.videoWidth : sourceEl.naturalWidth;
      const h = isVideo ? sourceEl.videoHeight : sourceEl.naturalHeight;
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(sourceEl, 0, 0, w, h);

      const isGentsRing = category === "ring" || category === "gents_ring";
      let anchor = { x: w / 2, y: h * (isGentsRing ? 0.7 : 0.35) };
      if (modelsLoaded) {
        const faceapi = await import("face-api.js");
        const det = await faceapi.detectSingleFace(sourceEl, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks();
        if (det) {
          const jaw = det.landmarks.getJawOutline();
          const nose = det.landmarks.getNose();
          if (category === "earring") {
            anchor = { x: jaw[0].x - 10, y: jaw[3].y }; // left ear approx
          } else if (category === "pendant") {
            anchor = { x: nose[3].x, y: jaw[8].y + 40 }; // below chin, on the neck/chest
          }
        }
      }

      if (jewelleryImageUrl) {
        const jImg = new Image();
        jImg.crossOrigin = "anonymous";
        await new Promise((resolve, reject) => { jImg.onload = resolve; jImg.onerror = reject; jImg.src = jewelleryImageUrl; });
        const size = w * 0.16;
        ctx.globalAlpha = 0.92;
        ctx.drawImage(jImg, anchor.x - size / 2, anchor.y - size / 2, size, size);
        ctx.globalAlpha = 1;
      }

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      const file = new File([blob], "tryon.jpg", { type: "image/jpeg" });
      const { publicUrl } = await secureImageUpload(file, sb, "solitaire-tryon");
      onSaved(publicUrl);
    } catch {
      setErr("Couldn't process that photo — please try again.");
    }
    setBusy(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,25,23,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: 16 }}>
      <div style={{ background: THEME.surface, border: `1px solid ${THEME.border}`, borderRadius: 4, padding: 24, maxWidth: 480, width: "100%" }}>
        <div style={{ ...heading, fontSize: 20, color: THEME.text, marginBottom: 12 }}>Try It On</div>
        <div style={{ fontSize: 12, color: THEME.muted, marginBottom: 12 }}>
          {(category === "ring" || category === "gents_ring") ? "Hold your hand up in frame." : category === "earring" ? "Face the camera, ears visible." : "Face the camera, neck/collar visible."}
        </div>
        {ready
          ? <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", borderRadius: 4, background: "#000" }} />
          : <div style={{ padding: 30, textAlign: "center", color: THEME.muted, fontSize: 13, border: `1px solid ${THEME.border}`, borderRadius: 4 }}>Camera not available — upload a photo instead.</div>}
        <canvas ref={canvasRef} style={{ display: "none" }} />
        {err && <div style={{ color: "#B91C1C", fontSize: 12, marginTop: 8 }}>{err}</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          {ready && <button style={btnPrimary} disabled={busy} onClick={() => capture(videoRef.current, true)}>{busy ? "Processing…" : "Capture"}</button>}
          <button style={btnGhost} onClick={() => fileRef.current?.click()}>Upload Photo</button>
          <button style={btnGhost} onClick={onClose}>Cancel</button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0]; if (!f) return;
            const img = new Image();
            img.onload = () => capture(img, false);
            img.src = URL.createObjectURL(f);
          }} />
      </div>
    </div>
  );
}

// ── Top-level public screen ──────────────────────────────────────────────
export function SolitaireJewelleryScreen() {
  const staffUser = loadStaffUser();
  const [leadDone, setLeadDone] = useState(() => staffUser != null || !!loadLocal("solitaire_lead_done", false));
  const [leadId] = useState(() => loadLocal("solitaire_lead_id", null));
  const [category, setCategory] = useState(null);
  const [design, setDesign] = useState(null);

  if (!leadDone) return <LeadPopup onDone={() => setLeadDone(true)} />;

  return (
    <div className="sol-page" style={page}>
      <style>{FONT_CSS}</style>
      <div style={{ textAlign: "center", padding: "48px 20px 20px" }}>
        <div style={{ fontFamily: "Montserrat, sans-serif", fontSize: 13, letterSpacing: "0.3em", color: THEME.muted, textTransform: "uppercase" }}>Sun Sea Jewellers</div>
        <div style={{ ...heading, fontSize: 40, color: THEME.text, marginTop: 8 }}>Design Your Solitaire</div>
        <div style={{ width: 48, height: 2, background: THEME.gold, margin: "16px auto" }} />
      </div>

      {!category && (
        <div style={{ display: "flex", justifyContent: "center", gap: 24, flexWrap: "wrap", padding: "20px 24px 60px" }}>
          {CATEGORIES.map((c) => <CategoryTile key={c.key} category={c} onClick={() => setCategory(c.key)} />)}
        </div>
      )}

      {category && !design && (
        <DesignGallery category={category} onSelect={setDesign} onBack={() => setCategory(null)} />
      )}

      {design && (
        <Configurator design={design} leadId={leadId} staffUser={staffUser} onBack={() => setDesign(null)} />
      )}
    </div>
  );
}

// ── Admin: AI Design Generator ───────────────────────────────────────────
// Staff-only screen (mount from App.jsx's admin/calculator tab area, gated
// to superadmin/admin) for generating + approving design variants. Uses
// action=admin-designs (not action=designs) so generated-but-not-yet-approved
// variants are visible for review — action=designs is approved-only, which
// is correct for the public page but would hide new work from this screen.
export function SolitaireAdminGenerator() {
  const [category, setCategory] = useState("ring");
  const [designs, setDesigns] = useState([]);
  const [designId, setDesignId] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [goldColor, setGoldColor] = useState("yellow");
  const [shape, setShape] = useState("Round");
  const [caratSize, setCaratSize] = useState("");
  const [promptOverride, setPromptOverride] = useState("");
  const [refImageFile, setRefImageFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [cascade, setCascade] = useState(null); // { done, total } while auto-generating remaining combos
  const [usdInr, setUsdInr] = useState(null);
  const [prices, setPrices] = useState([]);
  const [pricingConfig, setPricingConfig] = useState(null);
  const [gridExpanded, setGridExpanded] = useState(false);
  const [suggestingName, setSuggestingName] = useState(false);
  const [suggestedName, setSuggestedName] = useState("");
  const [nameKey, setNameKey] = useState(0);

  const loadDesigns = useCallback((selectId) => {
    apiGet("admin-designs", { category }, true).then((r) => {
      if (r.ok) { setDesigns(r.designs); setLoadErr(""); setDesignId((cur) => (selectId || (r.designs.some((d) => d.id === cur) ? cur : r.designs[0]?.id || ""))); }
      else { setDesigns([]); setLoadErr(r.error || "Couldn't load designs."); }
    });
  }, [category]);

  useEffect(() => { loadDesigns(); }, [loadDesigns]);
  const [prevDesignId, setPrevDesignId] = useState(designId);
  if (designId !== prevDesignId) { setPrevDesignId(designId); setGridExpanded(false); setSuggestedName(""); }
  useEffect(() => {
    apiGet("rates").then((r) => r.ok && setUsdInr(r.rates?.usdInr ?? null));
    apiGet("labgrown-prices").then((r) => r.ok && setPrices(r.prices));
    apiGet("pricing-config").then((r) => r.ok && setPricingConfig(r));
  }, []);

  const currentDesign = designs.find((d) => d.id === designId) || null;
  const variants = currentDesign?.variants || [];

  const generateOne = async ({ designId: dId, goldColor: gc, diamondShape: sh, caratSize: cs, promptOverride: po, referenceImageBase64: ref, includeWorn = true, viewKeys }) => {
    return apiPost("generate-variant", {
      designId: dId, goldColor: gc, diamondShape: sh, caratSize: cs ? Number(cs) : null,
      generatedBy: loadStaffUser()?.name, promptOverride: po || null, referenceImageBase64: ref || null,
      includeWorn, viewKeys, quality: pricingConfig?.imageQuality || "low",
    }, true);
  };

  // "Create N New Designs to Review" — genuinely NEW sibling designs (own
  // name/concept, e.g. "Classic Solitaire Ring 2"), each with one cheap
  // preview image, inactive until approved. This is the "5 different
  // designs, not variations of the same one" flow.
  const [pendingDesigns, setPendingDesigns] = useState([]);
  const [candidateProgress, setCandidateProgress] = useState(null);

  // Cascade queue — approving 2+ candidate designs used to fire their
  // cascades concurrently (racing each other on the same shared "cascade"
  // progress state and OpenAI rate limit, with no visible per-design
  // status). Now every cascade goes through this queue and runs strictly
  // one design at a time, with a visible card per design regardless of
  // which design happens to be selected in the main dropdown.
  const cascadeJobsRef = useRef([]); // [{ id, design, referenceVariant }] — processing source of truth
  const processingRef = useRef(false);
  const [queueStatus, setQueueStatus] = useState([]); // [{ id, name, done, total, status }] — render-only mirror

  const updateQueueItem = (id, patch) => {
    setQueueStatus((qs) => qs.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  };

  const processCascadeQueue = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    while (cascadeJobsRef.current.length) {
      const job = cascadeJobsRef.current[0];
      updateQueueItem(job.id, { status: "generating" });
      await cascadeRemaining(job.design, job.referenceVariant, (p) => {
        updateQueueItem(job.id, p ? { done: p.done, total: p.total } : {});
      });
      updateQueueItem(job.id, { status: "done" });
      if (job.onDone) await job.onDone();
      cascadeJobsRef.current.shift();
    }
    processingRef.current = false;
  };

  const enqueueCascade = (design, referenceVariant, onDone) => {
    cascadeJobsRef.current.push({ id: design.id, design, referenceVariant, onDone });
    setQueueStatus((qs) => [...qs, { id: design.id, name: design.name, done: 0, total: null, status: "queued" }]);
    processCascadeQueue();
  };

  const loadPendingDesigns = useCallback(() => {
    apiGet("pending-designs", { category }, true).then((r) => { if (r.ok) setPendingDesigns(r.designs); });
  }, [category]);

  useEffect(() => { loadPendingDesigns(); }, [loadPendingDesigns]);

  const createDesignCandidates = async (count = 5) => {
    if (!currentDesign) { setMsg("⚠️ Select a design to base new ones on first."); return; }
    setMsg(""); setCandidateProgress({ done: 0, total: count });
    let failures = 0;
    for (let i = 0; i < count; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1500));
      const res = await apiPost("generate-design-candidates", { baseDesignId: currentDesign.id, quality: pricingConfig?.imageQuality || "low" }, true);
      if (!res.ok) failures++;
      setCandidateProgress({ done: i + 1, total: count });
      loadPendingDesigns();
    }
    setCandidateProgress(null);
    setMsg(failures
      ? `Created ${count - failures}/${count} new designs to review (${failures} failed).`
      : `Created ${count} new designs — review and approve/reject below.`);
  };

  const approveDesignCandidate = async (candidate) => {
    const res = await apiPost("approve-design-candidate", { designId: candidate.id }, true);
    if (!res.ok) { setMsg(`⚠️ Failed to approve: ${res.error}`); return; }
    setPendingDesigns((ds) => ds.filter((d) => d.id !== candidate.id));
    setMsg(`Approved "${candidate.name}" — queued for its remaining gold-colour/shape combinations (see the queue below).`);
    // Keep whatever design was already selected in view — approving a
    // candidate shouldn't yank the admin away to look at it (that's what
    // read as "the old design vanished"). It'll show up in the dropdown
    // once loadDesigns() below refreshes the list.
    loadDesigns();
    // Queued, not awaited directly — approving a second candidate while the
    // first's cascade is still running now queues behind it instead of
    // firing concurrently (which raced on OpenAI's rate limit and on the
    // shared progress display with no way to tell which design was doing what).
    const variant = candidate.variants?.[0];
    if (variant) {
      enqueueCascade(
        { id: candidate.id, name: candidate.name, variants: [{ goldColor: variant.goldColor, diamondShape: variant.diamondShape }] },
        { caratSize: null, promptOverride: null, estGoldWeightG: variant.estGoldWeightG || null }
      );
    }
  };

  const rejectDesignCandidate = async (candidate) => {
    const res = await apiPost("delete-design", { designId: candidate.id }, true);
    if (!res.ok) { setMsg(`⚠️ Failed to reject: ${res.error}`); return; }
    setPendingDesigns((ds) => ds.filter((d) => d.id !== candidate.id));
  };

  const generate = async () => {
    setBusy(true); setMsg("");
    const refBase64 = refImageFile ? await fileToBase64(refImageFile) : null;
    // Manual single-variant generation includes the "worn on hand" shot —
    // this is the one variant an admin deliberately reviews by hand.
    const res = await generateOne({ designId, goldColor, diamondShape: shape, caratSize, promptOverride, referenceImageBase64: refBase64, includeWorn: true });
    setBusy(false);
    if (!res.ok) return setMsg(`Failed: ${res.error}${res.detail ? ` — ${res.detail}` : ""}`);
    setMsg("Generated — review below and approve.");
    loadDesigns();
  };

  // Approving the first variant for a design auto-generates + auto-approves
  // every remaining gold-colour x shape combo for that same design, using
  // the just-approved variant's est_gold_weight_g as the starting estimate
  // (admin can still edit each one individually afterward). Sequential
  // (not parallel) to stay within OpenAI rate limits and keep progress visible.
  const cascadeRemaining = async (design, referenceVariant, onProgress = (p) => setCascade(p)) => {
    const have = new Set(design.variants.map((v) => `${v.goldColor}|${v.diamondShape}`));
    const missing = [];
    for (const gc of GOLD_COLORS) {
      for (const sh of DIAMOND_SHAPES) {
        const key = `${gc}|${sh}`;
        if (!have.has(key)) missing.push({ goldColor: gc, diamondShape: sh });
      }
    }
    if (!missing.length) return;
    onProgress({ done: 0, total: missing.length });
    const failed = [];
    let firstFailureDetail = "";
    for (let i = 0; i < missing.length; i++) {
      const combo = missing[i];
      // Small pacing gap between combos on top of the server's own 429
      // retry/backoff — a design's full cascade can be 20-30 back-to-back
      // generations, which alone is enough to trip OpenAI's per-minute
      // image rate limit even with server-side retries.
      if (i > 0) await new Promise((r) => setTimeout(r, 1500));
      // Cascade-filled combos skip the "worn" shot (front+angle only) —
      // it's the priciest of the 3 views to generate 29 times over for
      // combos that mostly exist for the client gallery, not hero review.
      const res = await generateOne({
        designId: design.id, goldColor: combo.goldColor, diamondShape: combo.diamondShape,
        caratSize: referenceVariant.caratSize, promptOverride: referenceVariant.promptOverride,
        includeWorn: false,
      });
      if (res.ok && res.variant) {
        await apiPost("update-variant", { variantId: res.variant.id, estGoldWeightG: referenceVariant.estGoldWeightG, status: "approved" }, true);
      } else {
        failed.push(`${combo.goldColor}/${combo.diamondShape}`);
        if (!firstFailureDetail) firstFailureDetail = res.detail || res.error || "unknown error";
      }
      onProgress({ done: i + 1, total: missing.length });
    }
    onProgress(null);
    const succeeded = missing.length - failed.length;
    setMsg(
      failed.length
        ? `Generated ${succeeded}/${missing.length} remaining combinations for "${design.name}". Failed: ${failed.join(", ")}. First error: ${firstFailureDetail} — click "Fill Remaining Combinations" again to retry just these.`
        : `Auto-generated and approved ${missing.length} remaining combination${missing.length !== 1 ? "s" : ""} for "${design.name}".`
    );
    loadDesigns();
  };

  const updateVariant = async (variantId, patch) => {
    await apiPost("update-variant", { variantId, ...patch }, true);
    loadDesigns();
  };

  // Gold weight is the same setting for every gold-colour/shape/carat combo
  // of a design — entering it once here applies to ALL of that design's
  // variants (past and future), not just the one being edited.
  const setDesignGoldWeight = async (weight) => {
    if (!currentDesign || weight === "" || weight == null) return;
    await apiPost("set-design-gold-weight", { designId: currentDesign.id, estGoldWeightG: Number(weight) }, true);
    loadDesigns();
  };

  const approveAndCascade = async (variant) => {
    const wasFirstApproval = !variants.some((v) => v.id !== variant.id && v.status === "approved");
    await apiPost("update-variant", { variantId: variant.id, status: "approved" }, true);
    loadDesigns();
    if (wasFirstApproval && currentDesign) {
      // Queued rather than awaited directly — keeps this in the same
      // one-at-a-time line as candidate-design approvals instead of
      // racing them on OpenAI's rate limit.
      enqueueCascade(currentDesign, { ...variant, estGoldWeightG: variant.estGoldWeightG }, async () => {
        if (!currentDesign.sizeChartImageUrl) await generateSizeChart(currentDesign.id);
      });
    }
  };

  // .30ct-5ct size-comparison image, one per design — generated automatically
  // the first time a design's first variant is approved (same moment the
  // combo cascade kicks off), and also available as a manual button below
  // for designs made before this existed.
  const [chartBusy, setChartBusy] = useState(null); // designId currently generating
  const generateSizeChart = async (designId) => {
    setChartBusy(designId);
    const res = await apiPost("generate-size-chart", { designId }, true);
    setChartBusy(null);
    if (!res.ok) setMsg(`Size chart failed: ${res.error}${res.detail ? ` — ${res.detail}` : ""}`);
    loadDesigns();
  };

  // Manual retry/complete — independent of the auto-cascade-on-first-approval
  // above, for when generation partially failed or more shapes/colours were
  // added later. Uses the best available variant (approved, else any with a
  // gold weight set, else the first) as the reference to copy from.
  const fillRemaining = async () => {
    if (!currentDesign) return;
    const reference = variants.find((v) => v.status === "approved" && v.estGoldWeightG)
      || variants.find((v) => v.estGoldWeightG)
      || variants[0];
    if (!reference) { setMsg("Generate at least one variant for this design first."); return; }
    await cascadeRemaining(currentDesign, reference);
  };

  const savePrice = async (cs, price) => {
    await apiPost("update-labgrown-price", { caratSize: cs, pricePerCt: price, updatedBy: loadStaffUser()?.name }, true);
  };

  const savePricingConfig = async (patch) => {
    const res = await apiPost("update-pricing-config", patch, true);
    if (res.ok) setPricingConfig((c) => ({ ...c, ...patch }));
    setMsg(res.ok ? "Pricing settings updated." : `Failed to update pricing settings: ${res.error}`);
  };

  // Design names are AI-suggested (or admin-typed) at creation but always
  // renameable afterward, same for the side-diamond flag/weight.
  const updateDesignField = async (patch) => {
    if (!currentDesign) return;
    await apiPost("update-design", { designId: currentDesign.id, ...patch }, true);
    setSuggestedName(""); // whatever was suggested is now moot — reflect the real saved name next load
    loadDesigns(currentDesign.id);
  };

  // Looks at the design's actual generated image (not just the text prompt)
  // and proposes a name — dropped into the (still-editable) name field, NOT
  // auto-saved, so the admin reviews/edits before it's committed.
  const suggestName = async () => {
    if (!currentDesign) return;
    setSuggestingName(true);
    const res = await apiPost("suggest-design-name", { designId: currentDesign.id }, true);
    setSuggestingName(false);
    if (!res.ok) { setMsg(`⚠️ Couldn't suggest a name: ${res.error}${res.detail ? ` — ${res.detail}` : ""}`); return; }
    setSuggestedName(res.name);
    setNameKey((k) => k + 1);
    setMsg(`Suggested "${res.name}" — edit if needed, it saves when you click away from the field.`);
  };

  // Re-roll — generates a fresh alternate "take" of the SAME combo (design x
  // gold-colour x shape x carat) so the admin can pick a favourite before
  // approving. Approving any one automatically rejects its siblings
  // server-side (see api/solitaire-designs.js action=update-variant).
  const regenerateVariant = async (v) => {
    setBusy(true); setMsg("");
    const res = await generateOne({ designId, goldColor: v.goldColor, diamondShape: v.diamondShape, caratSize: v.caratSize, promptOverride: v.promptOverride });
    setBusy(false);
    if (!res.ok) return setMsg(`Failed: ${res.error}${res.detail ? ` — ${res.detail}` : ""}`);
    setMsg("New version generated — review below and approve your favourite.");
    loadDesigns();
  };

  // Group variants by combo (gold-colour x shape x carat) so alternate
  // "takes" of the same combo sit together instead of looking like
  // unrelated extra options.
  const comboGroups = {};
  for (const v of variants) {
    const key = `${v.goldColor}|${v.diamondShape}|${v.caratSize ?? ""}`;
    (comboGroups[key] ||= []).push(v);
  }
  const primaryVariant = variants.find((v) => v.status === "approved") || variants[0] || null;

  return (
    <div style={{ padding: 20, maxWidth: 960 }}>
      <h3>Solitaire Jewellery — AI Design Generator</h3>

      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select value={designId} onChange={(e) => setDesignId(e.target.value)} style={{ minWidth: 240 }} disabled={!designs.length}>
          {!designs.length && <option value="">No designs in this category</option>}
          {designs.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.variants.length} variants)</option>)}
        </select>
        <select value={goldColor} onChange={(e) => setGoldColor(e.target.value)}>
          <option value="yellow">Yellow Gold</option><option value="white">White Gold</option><option value="rose">Rose Gold</option>
        </select>
        <select value={shape} onChange={(e) => setShape(e.target.value)}>
          {DIAMOND_SHAPES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input placeholder="carat (optional)" value={caratSize} onChange={(e) => setCaratSize(e.target.value)} style={{ width: 100 }} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <textarea
          placeholder="Describe or refine the image prompt for this design (optional — overrides/extends the base design concept)"
          value={promptOverride} onChange={(e) => setPromptOverride(e.target.value)}
          rows={3} style={{ width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: 13, padding: 8 }}
        />
        {currentDesign?.conceptPrompt && <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Base concept: {currentDesign.conceptPrompt}</div>}
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
          A. Images of THIS ONE design — {currentDesign?.name || "selected design"} (gold-colour x shape combos)
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 13 }}>
            Reference image (optional):{" "}
            <input type="file" accept="image/*" onChange={(e) => setRefImageFile(e.target.files?.[0] || null)} />
          </label>
          {refImageFile && <button onClick={() => setRefImageFile(null)}>Clear</button>}
          <button disabled={busy || !designId || !!cascade} onClick={generate}>{busy ? "Generating…" : "Generate Variant"}</button>
          <button disabled={!designId || !!cascade || !variants.length} onClick={fillRemaining}>Fill Remaining Combinations</button>
        </div>
      </div>

      <div style={{ border: "2px solid #2980b9", borderRadius: 6, padding: 10, marginBottom: 16, background: "#eaf3fa" }}>
        <div style={{ fontSize: 11, color: "#2980b9", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, fontWeight: 700 }}>
          B. Brand new, DIFFERENT designs (not this one)
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button disabled={!designId || !!candidateProgress} onClick={() => createDesignCandidates(5)} style={{ fontWeight: 700 }}>
            {candidateProgress ? `Creating new designs… ${candidateProgress.done}/${candidateProgress.total}` : "★ Create 5 New Designs to Review"}
          </button>
          <span style={{ fontSize: 12, color: "#555" }}>Whole new sibling products (own name + concept), inspired by but NOT variants of {currentDesign?.name || "the selected design"} — review and approve/reject below.</span>
        </div>
      </div>

      {!!pendingDesigns.length && (
        <div style={{ marginBottom: 24 }}>
          <h4>New Designs Pending Review ({pendingDesigns.length})</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            {pendingDesigns.map((d) => (
              <div key={d.id} style={{ border: "1px solid #ddd", borderRadius: 4, padding: 8 }}>
                {d.variants?.[0]?.viewImages?.front && <img src={d.variants[0].viewImages.front} alt="" style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover" }} />}
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>{d.name}</div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{d.conceptPrompt}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <button style={{ flex: 1 }} onClick={() => approveDesignCandidate(d)}>Approve</button>
                  <button style={{ flex: 1 }} onClick={() => rejectDesignCandidate(d)}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {currentDesign && (
        <div style={{ marginBottom: 12, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: 13 }}>
            Product name:{" "}
            <input key={`${currentDesign.id}-${nameKey}`} type="text" defaultValue={suggestedName || currentDesign.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== currentDesign.name && updateDesignField({ name: e.target.value.trim() })} style={{ width: 220 }} />
          </label>
          <button disabled={suggestingName || !primaryVariant} onClick={suggestName} style={{ fontSize: 12 }}>
            {suggestingName ? "Looking at image…" : "✨ Suggest Name from Image"}
          </button>
          <label style={{ fontSize: 13 }}>
            <input type="checkbox" checked={!!currentDesign.hasSideDiamonds} onChange={(e) => updateDesignField({ hasSideDiamonds: e.target.checked })} /> Has side diamonds
          </label>
          {currentDesign.hasSideDiamonds && (
            <label style={{ fontSize: 13 }}>
              Side diamond weight (ct total):{" "}
              <input key={`sd-${currentDesign.id}`} type="number" placeholder="e.g. 0.25" defaultValue={currentDesign.sideDiamondWeightCt || ""}
                onBlur={(e) => e.target.value !== "" && updateDesignField({ sideDiamondWeightCt: Number(e.target.value) })} style={{ width: 90 }} />
            </label>
          )}
        </div>
      )}

      {currentDesign && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 13 }}>
            Gold weight for this whole design (g) — applies to every gold-colour/shape combo:{" "}
            <input type="number" placeholder="e.g. 3.2"
              defaultValue={variants.find((v) => v.estGoldWeightG)?.estGoldWeightG || ""}
              onBlur={(e) => setDesignGoldWeight(e.target.value)} style={{ width: 100 }} />
          </label>
        </div>
      )}

      {currentDesign && (
        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
          {currentDesign.sizeChartImageUrl && (
            <img src={currentDesign.sizeChartImageUrl} alt="size chart" style={{ width: 220, height: "auto", border: "1px solid #ddd", borderRadius: 4 }} />
          )}
          <button disabled={chartBusy === currentDesign.id} onClick={() => generateSizeChart(currentDesign.id)}>
            {chartBusy === currentDesign.id ? "Generating…" : currentDesign.sizeChartImageUrl ? "Regenerate Size Chart (.30ct–5ct)" : "Generate Size Chart (.30ct–5ct)"}
          </button>
        </div>
      )}

      {loadErr && <div style={{ marginBottom: 12, fontSize: 13, color: "#c0392b" }}>{loadErr}</div>}
      {msg && <div style={{ marginBottom: 12, fontSize: 13, fontWeight: msg.startsWith("⚠️") ? 600 : 400, color: msg.startsWith("⚠️") ? "#c0392b" : msg.startsWith("✅") ? "#27ae60" : "inherit" }}>{msg}</div>}
      {cascade && <div style={{ marginBottom: 12, fontSize: 13, color: "#2980b9" }}>Auto-generating remaining combinations… {cascade.done}/{cascade.total}</div>}

      {/* Always visible regardless of which design is selected in the
          dropdown above — this is what was missing: approving a candidate
          design's cascade had NO visible progress unless you happened to
          still be looking at that exact design. Runs strictly one design
          at a time (see cascadeJobsRef/processCascadeQueue). */}
      {!!queueStatus.length && (
        <div style={{ border: "1px solid #ddd", borderRadius: 4, padding: 10, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <strong style={{ fontSize: 13 }}>Generation Queue</strong>
            <button style={{ fontSize: 11 }} onClick={() => setQueueStatus((qs) => qs.filter((q) => q.status !== "done"))}>Clear completed</button>
          </div>
          {queueStatus.map((q) => (
            <div key={q.id} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
              <span>{q.name}</span>
              <span style={{ color: q.status === "done" ? "#27ae60" : q.status === "generating" ? "#2980b9" : "#888" }}>
                {q.status === "queued" && "waiting…"}
                {q.status === "generating" && (q.total ? `generating ${q.done}/${q.total}` : "starting…")}
                {q.status === "done" && "✓ done"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Always-visible basic summary — shows the DESIGN as one product, not
          whichever variant happened to be picked as "primary". No more
          "nothing shown until expanded" confusion either. */}
      {currentDesign && (
        primaryVariant ? (
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8, padding: 8, border: "1px solid #ddd", borderRadius: 4 }}>
            {primaryVariant.viewImages?.front && <img src={primaryVariant.viewImages.front} alt="" style={{ width: 70, height: 70, objectFit: "cover", borderRadius: 4 }} />}
            <div style={{ fontSize: 13 }}>
              <div><strong>{currentDesign.name}</strong></div>
              <div style={{ color: "#888" }}>{variants.filter((v) => v.status === "approved").length} approved · {variants.length} variant{variants.length !== 1 ? "s" : ""} generated</div>
            </div>
            <button style={{ marginLeft: "auto" }} onClick={() => setGridExpanded((v) => !v)}>
              {gridExpanded ? "Hide" : "Show"} all {variants.length} variant{variants.length !== 1 ? "s" : ""} {gridExpanded ? "▲" : "▼"}
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "#888", marginBottom: 8 }}>No variants generated yet for this design — use "Generate Variant" above.</div>
        )
      )}
      {/* One flat wrapping grid (minimal vertical space) rather than a
          separate full-width block per combo — alternates for the same
          combo just sit next to each other in iteration order, labelled
          "v2"/"v3" on the card instead of a separate group header. */}
      {gridExpanded && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, marginBottom: 24 }}>
          {Object.values(comboGroups).flatMap((group) => group.map((v, i) => (
            <div key={v.id} style={{ border: "1px solid #ddd", borderRadius: 4, padding: 6 }}>
              {v.viewImages?.front && <img src={v.viewImages.front} alt="" style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover" }} />}
              <div style={{ fontSize: 10, color: "#888", marginTop: 4 }}>
                {v.goldColor} / {v.diamondShape}{v.caratSize ? ` / ${v.caratSize}ct` : ""}{group.length > 1 ? ` · v${i + 1}` : ""}
              </div>
              <div style={{ fontSize: 10, color: v.status === "approved" ? "#27ae60" : v.status === "rejected" ? "#c0392b" : "#888" }}>{v.status}</div>
              <input type="number" placeholder="gold weight (g)" defaultValue={v.estGoldWeightG || ""} onBlur={(e) => setDesignGoldWeight(e.target.value)} style={{ width: "100%", marginTop: 4, fontSize: 11, padding: 3 }} />
              {v.status !== "approved"
                ? <button style={{ marginTop: 4, width: "100%", fontSize: 11 }} disabled={!!cascade} onClick={() => approveAndCascade(v)}>Approve</button>
                : <button style={{ marginTop: 4, width: "100%", fontSize: 11 }} onClick={() => updateVariant(v.id, { status: "rejected" })}>Reject</button>}
              <button style={{ marginTop: 2, width: "100%", fontSize: 11 }} disabled={busy} onClick={() => regenerateVariant(v)}>New Version</button>
            </div>
          )))}
        </div>
      )}

      <h4>Lab-Grown Diamond Price Grid (₹/ct)</h4>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 8, marginBottom: 20 }}>
        {LABGROWN_CARAT_SIZES.map((cs) => {
          const row = prices.find((p) => p.carat_size === cs && !p.shape);
          return (
            <div key={cs}>
              <div style={{ fontSize: 11 }}>{cs} ct</div>
              <input type="number" defaultValue={row?.price_per_ct || 0} onBlur={(e) => savePrice(cs, Number(e.target.value))} style={{ width: "100%" }} />
            </div>
          );
        })}
      </div>

      <h4>Pricing Settings</h4>
      <div style={{ display: "flex", gap: 20, marginBottom: 20, flexWrap: "wrap" }}>
        <label style={{ fontSize: 13 }}>
          Making charge (₹/g):{" "}
          <input type="number" defaultValue={pricingConfig?.makingChargePerGram ?? ""} onBlur={(e) => savePricingConfig({ makingChargePerGram: Number(e.target.value) })} style={{ width: 90 }} />
        </label>
        <label style={{ fontSize: 13 }}>
          Natural diamond sell discount (%):{" "}
          <input type="number" defaultValue={pricingConfig?.sellDiscPct ?? ""} onBlur={(e) => savePricingConfig({ sellDiscPct: Number(e.target.value) })} style={{ width: 90 }} />
        </label>
        <label style={{ fontSize: 13 }}>
          Side diamond price (₹/ct):{" "}
          <input type="number" defaultValue={pricingConfig?.sideDiamondPricePerCt ?? ""} onBlur={(e) => savePricingConfig({ sideDiamondPricePerCt: Number(e.target.value) })} style={{ width: 90 }} />
        </label>
        <label style={{ fontSize: 13 }}>
          AI image quality (cost lever — low ≈ ¼ the cost of medium):{" "}
          <select value={pricingConfig?.imageQuality || "low"} onChange={(e) => savePricingConfig({ imageQuality: e.target.value })}>
            <option value="low">Low (cheapest — try this first)</option>
            <option value="medium">Medium (current default before)</option>
            <option value="high">High (most expensive)</option>
          </select>
        </label>
        <div style={{ fontSize: 13 }}>USD/INR (live): {usdInr != null ? `₹${usdInr} per $1 — from the Rates sheet` : "unavailable — check the Rates sheet's USD row"}</div>
      </div>

      <CategoryCoversPanel />
    </div>
  );
}

// One-off generator for the public landing page's category-picker hero
// images (see action=generate-category-cover). Deterministic path, upsert —
// re-running just replaces the image.
function CategoryCoversPanel() {
  const [busyKey, setBusyKey] = useState(null);
  const [results, setResults] = useState({});
  // Freshly generated URLs come back cache-busted from the server (?v=timestamp)
  // — used here so the admin's own preview updates immediately. The static
  // categoryCoverUrl() (no bust) is only a fallback for "never generated yet".
  const [freshUrls, setFreshUrls] = useState({});

  const generate = async (categoryKey) => {
    setBusyKey(categoryKey);
    const res = await apiPost("generate-category-cover", { category: categoryKey }, true);
    setBusyKey(null);
    if (res.ok) setFreshUrls((u) => ({ ...u, [categoryKey]: res.imageUrl }));
    setResults((r) => ({ ...r, [categoryKey]: res.ok ? "done" : `failed: ${res.error}` }));
  };

  return (
    <div>
      <h4>Category Picker Cover Images</h4>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>Attractive hero photos shown on the public landing page's category tiles (Rings / Gents Rings / Pendants / Earrings). Generate once, or regenerate anytime to replace — the public page picks up the new image on a fresh page load.</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {CATEGORIES.map((c) => (
          <div key={c.key} style={{ textAlign: "center" }}>
            <img src={freshUrls[c.key] || categoryCoverUrl(c.key)} alt={c.label} style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 4, border: "1px solid #ddd", display: "block", marginBottom: 4 }} onError={(e) => { e.target.style.visibility = "hidden"; }} />
            <button disabled={busyKey === c.key} onClick={() => generate(c.key)} style={{ fontSize: 11 }}>
              {busyKey === c.key ? "Generating…" : `${c.label}`}
            </button>
            {results[c.key] && <div style={{ fontSize: 10, color: results[c.key] === "done" ? "#27ae60" : "#c0392b" }}>{results[c.key]}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
