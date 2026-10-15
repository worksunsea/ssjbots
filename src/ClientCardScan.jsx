import { useRef, useState } from "react";

// Contacts -> "Scan client card": photo of a handwritten Client Details Card ->
// AI reads it -> staff correct anything -> saved through /api/contact-update
// (new clients are created; existing clients' changes wait in Profile Edit Requests).

const CRM_SECRET = (import.meta.env.VITE_CRM_SECRET || "").trim();
const RELATIONS = ["spouse", "son", "daughter", "mother", "father", "brother", "sister", "other"];
const MAX_DIM = 1800;

const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "24px 12px" },
  card: { background: "#fff", borderRadius: 12, padding: 18, width: "100%", maxWidth: 640 },
  label: { fontSize: 11, color: "#666", display: "block", marginBottom: 3, marginTop: 10 },
  input: { width: "100%", fontSize: 14, padding: "7px 9px", border: "1px solid #ddd", borderRadius: 7, boxSizing: "border-box" },
  btn: (bg, ghost) => ({ padding: "9px 16px", fontSize: 14, fontWeight: 600, borderRadius: 8, cursor: "pointer", border: ghost ? "1px solid #ccc" : "none", background: ghost ? "#fff" : bg, color: ghost ? "#333" : "#fff" }),
  grid2: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 },
};

/** Shrinks a phone photo so the request stays well under the 4.5 MB serverless body limit. */
function imageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not open that image")); };
    img.src = url;
  });
}

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div>
      <span style={s.label}>{label}</span>
      <input style={s.input} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export default function ClientCardScan({ onClose, onSaved }) {
  const fileRef = useRef(null);
  const [step, setStep] = useState("pick"); // pick | review | done
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [form, setForm] = useState({});
  const [family, setFamily] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [sendGifts, setSendGifts] = useState(false);
  const [result, setResult] = useState(null);

  const setF = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const setMember = (i, k, v) => setFamily((p) => p.map((m, idx) => (idx === i ? { ...m, [k]: v } : m)));
  const setRef = (i, k, v) => setReferrals((p) => p.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));

  const reset = () => { setStep("pick"); setErr(""); setPreview(""); setWarnings([]); setForm({}); setFamily([]); setReferrals([]); setSendGifts(false); setResult(null); };

  async function handlePick(file) {
    if (!file) return;
    setErr(""); setBusy(true);
    try {
      const dataUrl = await imageToDataUrl(file);
      setPreview(dataUrl);
      const res = await fetch("/api/contact-card-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-crm-secret": CRM_SECRET },
        body: JSON.stringify({ imageDataUrl: dataUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw new Error(data.error || "Could not read the card — try a clearer, well-lit photo.");
      setForm(data.fields || {});
      setFamily(data.family || []);
      setReferrals(data.referrals || []);
      setWarnings(data.warnings || []);
      setStep("review");
    } catch (e) {
      setErr(e.message || "Scan failed");
    }
    setBusy(false);
  }

  async function save() {
    if (!/^[6-9]\d{9}$/.test(String(form.phone || ""))) { setErr("Enter a valid 10-digit mobile number first."); return; }
    setErr(""); setBusy(true);
    try {
      const { phone, ...rest } = form;
      const fields = Object.fromEntries(Object.entries(rest).filter(([, v]) => String(v || "").trim()));
      const res = await fetch("/api/contact-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone, ...fields, source: "client_card",
          family: family.filter((m) => m.name || m.dob || m.mobile),
          referrals: sendGifts ? referrals.filter((r) => r.phone) : [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw new Error(data.error || "Save failed");
      setResult(data);
      setStep("done");
      onSaved?.();
    } catch (e) {
      setErr(e.message || "Save failed");
    }
    setBusy(false);
  }

  return (
    <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={s.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>📇 Scan client card</h3>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer" }}>×</button>
        </div>

        {step === "pick" && (
          <div style={{ textAlign: "center", padding: "28px 8px" }}>
            <p style={{ color: "#555", fontSize: 14, margin: "0 0 16px" }}>
              Take a clear, well-lit photo of the filled card (whole sheet in frame). You can correct anything before it is saved.
            </p>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => handlePick(e.target.files?.[0])} />
            <button style={s.btn("#2980b9")} disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Reading card…" : "📷 Take photo / choose image"}</button>
            {err && <p style={{ color: "#c0392b", fontSize: 13, marginTop: 12 }}>{err}</p>}
          </div>
        )}

        {step === "review" && (
          <div>
            {warnings.length > 0 && (
              <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", marginTop: 12, fontSize: 12, color: "#92400e" }}>
                {warnings.map((w) => <div key={w}>⚠ {w}</div>)}
              </div>
            )}
            <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
              {preview && <img src={preview} alt="card" style={{ width: 120, borderRadius: 8, border: "1px solid #ddd", alignSelf: "flex-start" }} />}
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={s.grid2}>
                  <Field label="Name" value={form.name || ""} onChange={(v) => setF("name", v)} />
                  <Field label="Mobile *" value={form.phone || ""} onChange={(v) => setF("phone", v.replace(/\D/g, "").slice(0, 10))} type="tel" />
                  <Field label="Email" value={form.email || ""} onChange={(v) => setF("email", v)} />
                  <Field label="Birthday (DD-MM or YYYY-MM-DD)" value={form.bday || ""} onChange={(v) => setF("bday", v)} />
                  <Field label="Anniversary (DD-MM or YYYY-MM-DD)" value={form.anniversary || ""} onChange={(v) => setF("anniversary", v)} />
                  <Field label="Pincode" value={form.address_pincode || ""} onChange={(v) => setF("address_pincode", v.replace(/\D/g, "").slice(0, 6))} type="tel" />
                </div>
                <Field label="House / street" value={form.address_house || ""} onChange={(v) => setF("address_house", v)} />
                <div style={s.grid2}>
                  <Field label="Area / locality" value={form.address_locality || ""} onChange={(v) => setF("address_locality", v)} />
                  <Field label="City" value={form.city || ""} onChange={(v) => setF("city", v)} />
                  <Field label="State" value={form.address_state || ""} onChange={(v) => setF("address_state", v)} />
                </div>
              </div>
            </div>

            <h4 style={{ margin: "16px 0 4px", fontSize: 14 }}>Family members</h4>
            {family.length === 0 && <p style={{ fontSize: 12, color: "#999", margin: 0 }}>None found on the card.</p>}
            {family.map((m, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "110px 1fr 120px 120px 28px", gap: 6, alignItems: "end", marginTop: 6 }}>
                <select style={s.input} value={m.relationship} onChange={(e) => setMember(i, "relationship", e.target.value)}>
                  {RELATIONS.map((r) => <option key={r}>{r}</option>)}
                </select>
                <input style={s.input} placeholder="Name" value={m.name} onChange={(e) => setMember(i, "name", e.target.value)} />
                <input style={s.input} placeholder="Birthday" value={m.dob} onChange={(e) => setMember(i, "dob", e.target.value)} />
                <input style={s.input} placeholder="Mobile" value={m.mobile} onChange={(e) => setMember(i, "mobile", e.target.value.replace(/\D/g, "").slice(0, 10))} />
                <button onClick={() => setFamily((p) => p.filter((_, idx) => idx !== i))} style={{ border: "none", background: "none", color: "#c0392b", fontSize: 18, cursor: "pointer" }}>×</button>
              </div>
            ))}
            <button style={{ ...s.btn("#fff", true), padding: "4px 10px", fontSize: 12, marginTop: 8 }} onClick={() => setFamily((p) => [...p, { relationship: "spouse", name: "", dob: "", mobile: "" }])}>+ Add member</button>

            {referrals.length > 0 && (
              <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: 10, marginTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#78350f" }}>🎁 Friends to gift ({referrals.length})</div>
                {referrals.map((r, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 6, marginTop: 6 }}>
                    <input style={s.input} placeholder="Name" value={r.name} onChange={(e) => setRef(i, "name", e.target.value)} />
                    <input style={s.input} placeholder="Mobile" value={r.phone} onChange={(e) => setRef(i, "phone", e.target.value.replace(/\D/g, "").slice(0, 10))} />
                  </div>
                ))}
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, marginTop: 8, color: "#92400e" }}>
                  <input type="checkbox" checked={sendGifts} onChange={(e) => setSendGifts(e.target.checked)} />
                  Send the gift WhatsApp to these friends now (check the numbers first — it goes out immediately)
                </label>
              </div>
            )}

            {err && <p style={{ color: "#c0392b", fontSize: 13, marginTop: 10 }}>{err}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button style={s.btn("#27ae60")} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save to contacts"}</button>
              <button style={s.btn("#fff", true)} disabled={busy} onClick={reset}>Scan again</button>
            </div>
            <p style={{ fontSize: 11, color: "#999", margin: "8px 0 0" }}>The photo itself is not stored — keep the paper card.</p>
          </div>
        )}

        {step === "done" && (
          <div style={{ textAlign: "center", padding: "24px 8px" }}>
            <div style={{ fontSize: 40 }}>{result?.staged ? "📝" : "✅"}</div>
            <p style={{ fontSize: 14, color: "#333" }}>
              {result?.staged
                ? "This client already exists, so the changes are waiting in Profile Edit Requests for approval. Nothing saved earlier was overwritten."
                : "New client added to Contacts."}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
              <button style={s.btn("#2980b9")} onClick={reset}>Scan next card</button>
              <button style={s.btn("#fff", true)} onClick={onClose}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
