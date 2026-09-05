// /mission100 — public, no login required to browse/join/start a group.
// Login (phone OTP) is only asked for at the "Buy Now" moment, since real
// payment needs to know who's receiving the gold. Path-checked directly in
// App.jsx (no router), same convention as /corporategiftingcoins and
// /solitairejewellery.

import { useState, useEffect, useCallback } from "react";

const API = "/api/mission100";
const PAYMENT_API = "/api/mission100-payment";
const AUTH_API = "/api/client-auth";

async function call(base, action, { method = "GET", body, token, params } = {}) {
  const qs = new URLSearchParams({ action, ...(params || {}) }).toString();
  const res = await fetch(`${base}?${qs}`, {
    method, cache: "no-store",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

function memberStorageKey(inviteCode) { return `mission100_member_${inviteCode}`; }
function getSavedMember(inviteCode) {
  try { return JSON.parse(localStorage.getItem(memberStorageKey(inviteCode)) || "null"); } catch { return null; }
}
function saveMember(inviteCode, data) {
  try { localStorage.setItem(memberStorageKey(inviteCode), JSON.stringify(data)); } catch {}
}
function getClientToken() {
  try { return localStorage.getItem("mission100_client_token") || null; } catch { return null; }
}
function saveClientToken(token) {
  try { localStorage.setItem("mission100_client_token", token); } catch {}
}

function ProgressBar({ grams }) {
  const pct = Math.min(100, (grams / 100) * 100);
  return (
    <div style={{ background: "#eee", borderRadius: 6, height: 10, overflow: "hidden", width: "100%" }}>
      <div style={{ width: `${pct}%`, background: "linear-gradient(90deg,#d4af37,#9C6B1F)", height: "100%" }} />
    </div>
  );
}

function OtpLogin({ onLoggedIn, onCancel }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const requestOtp = async () => {
    if (!phone.trim()) return;
    setBusy(true);
    const d = await call(AUTH_API, "request-otp", { method: "POST", body: { phone, name } });
    setBusy(false);
    if (d.ok) setSent(true); else alert(d.error || "Could not send OTP");
  };
  const verify = async () => {
    setBusy(true);
    const d = await call(AUTH_API, "verify-otp", { method: "POST", body: { phone, code } });
    setBusy(false);
    if (d.ok) { saveClientToken(d.token); onLoggedIn(d.token); } else alert(d.error || "Invalid code");
  };

  return (
    <div style={{ border: "1px solid #d4af37", borderRadius: 8, padding: 16, background: "#fffaf0" }}>
      <b>Verify your phone to buy online</b>
      <p style={{ fontSize: 12.5, color: "#666" }}>A quick one-time code — not a full account signup.</p>
      {!sent ? (
        <>
          <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} style={{ display: "block", width: "100%", marginBottom: 8 }} />
          <input placeholder="Mobile number" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ display: "block", width: "100%", marginBottom: 8 }} />
          <button onClick={requestOtp} disabled={busy}>{busy ? "Sending…" : "Send OTP"}</button>
        </>
      ) : (
        <>
          <input placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} style={{ display: "block", width: "100%", marginBottom: 8 }} />
          <button onClick={verify} disabled={busy}>{busy ? "Verifying…" : "Verify & Continue"}</button>
        </>
      )}
      <button onClick={onCancel} style={{ marginLeft: 8 }}>Cancel</button>
    </div>
  );
}

function BuyNow({ enrollmentId, onDone }) {
  const [grams, setGrams] = useState(1);
  const [quote, setQuote] = useState(null);
  const [needsLogin, setNeedsLogin] = useState(!getClientToken());
  const [busy, setBusy] = useState(false);

  const fetchQuote = useCallback(async (g) => {
    const token = getClientToken();
    if (!token) return;
    const d = await call(PAYMENT_API, "quote", { token, params: { grams: g } });
    if (d.ok) setQuote(d);
  }, []);

  useEffect(() => { if (!needsLogin) fetchQuote(grams); }, [grams, needsLogin, fetchQuote]);

  const pay = async () => {
    const token = getClientToken();
    if (!token) { setNeedsLogin(true); return; }
    setBusy(true);
    const order = await call(PAYMENT_API, "create-order", { method: "POST", token, body: { enrollmentId, grams } });
    setBusy(false);
    if (!order.ok) { alert(order.error || "Could not start payment"); return; }

    const openCheckout = () => {
      const rzp = new window.Razorpay({
        key: order.razorpayKeyId, amount: order.amountPaise, currency: "INR", order_id: order.orderId,
        name: "Sun Sea Jewellers", description: `Mission 100 — ${grams}g`,
        handler: () => { alert("Payment received! Your gram total will update within a minute — refresh to see it."); onDone && onDone(); },
        theme: { color: "#9C6B1F" },
      });
      rzp.open();
    };
    if (window.Razorpay) { openCheckout(); return; }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = openCheckout;
    document.body.appendChild(script);
  };

  if (needsLogin) return <OtpLogin onLoggedIn={() => setNeedsLogin(false)} onCancel={() => setNeedsLogin(true)} />;

  return (
    <div style={{ border: "1px solid #d4af37", borderRadius: 8, padding: 16, background: "#fffaf0" }}>
      <b>Buy gold coins now</b>
      <div style={{ display: "flex", gap: 8, margin: "10px 0" }}>
        {[1, 2, 5, 10].map((g) => (
          <button key={g} onClick={() => setGrams(g)} style={{ fontWeight: grams === g ? 700 : 400, border: grams === g ? "2px solid #d4af37" : "1px solid #ccc" }}>{g}g</button>
        ))}
      </div>
      {quote && <p style={{ fontSize: 13 }}>Rate ₹{Math.round(quote.ratePerGram).toLocaleString("en-IN")}/g — total ₹{quote.amount.toLocaleString("en-IN")}</p>}
      <button onClick={pay} disabled={busy} style={{ fontWeight: 700 }}>{busy ? "Starting payment…" : `Pay & Buy ${grams}g`}</button>
    </div>
  );
}

function StartOrJoinForm({ mode, inviteCode, refMemberId, onSuccess }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");
  const [size, setSize] = useState(20);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || !phone.trim()) { alert("Name and phone required"); return; }
    setBusy(true);
    const d = mode === "start"
      ? await call(API, "start-group", { method: "POST", body: { name, phone, groupLabel: label || `${name}'s Mission 100`, size: Number(size) } })
      : await call(API, "join-group", { method: "POST", body: { name, phone, inviteCode, refMemberId } });
    setBusy(false);
    if (!d.ok) { alert(d.error || "Something went wrong"); return; }
    saveMember(d.inviteCode, { enrollmentId: d.enrollmentId, memberId: d.memberId });
    onSuccess(d.inviteCode);
  };

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, maxWidth: 400 }}>
      <h4>{mode === "start" ? "Start Your Mission 100 Group" : "Join This Group"}</h4>
      <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} style={{ display: "block", width: "100%", marginBottom: 8 }} />
      <input placeholder="Mobile number" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ display: "block", width: "100%", marginBottom: 8 }} />
      {mode === "start" && (
        <>
          <input placeholder="Group name (optional)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ display: "block", width: "100%", marginBottom: 8 }} />
          <select value={size} onChange={(e) => setSize(e.target.value)} style={{ display: "block", width: "100%", marginBottom: 8 }}>
            <option value={10}>10 friends — domestic-tier group</option>
            <option value={20}>20 friends</option>
          </select>
        </>
      )}
      <button onClick={submit} disabled={busy} style={{ fontWeight: 700 }}>{busy ? "Please wait…" : mode === "start" ? "Start Group" : "Join Group"}</button>
    </div>
  );
}

function Leaderboard({ inviteCode, refMemberId }) {
  const saved = getSavedMember(inviteCode);
  const [data, setData] = useState(null);
  const [showJoin, setShowJoin] = useState(!saved);
  const [showBuy, setShowBuy] = useState(false);

  const load = useCallback(async () => {
    const d = await call(API, "leaderboard", { params: { inviteCode, ...(saved?.memberId ? { viewerMemberId: saved.memberId } : {}) } });
    setData(d.ok ? d : null);
  }, [inviteCode, saved?.memberId]);

  useEffect(() => { load(); }, [load]);

  if (data === null) return <div>Loading…</div>;
  const { group, members } = data;
  const viewer = members.find((m) => m.isViewer);

  return (
    <div style={{ maxWidth: 600 }}>
      <h2>{group.label}</h2>
      <p style={{ fontSize: 13, color: "#666" }}>
        {group.memberCount}/{group.size} joined — status: <b>{group.status}</b>
        {group.tripPrizeDescription && <> · Prize: <b>{group.tripPrizeDescription}</b></>}
      </p>

      {group.status === "forming" && group.memberCount < group.size && (
        <p style={{ fontSize: 13 }}>
          Share this link to fill your group: <code>{window.location.origin}/mission100?g={inviteCode}</code>
        </p>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 12 }}>
        <thead><tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}><th>Rank</th><th>Who</th><th>Progress</th></tr></thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.memberId} style={{ borderBottom: "1px solid #eee", background: m.isViewer ? "#fffaf0" : "transparent" }}>
              <td>#{m.rank}</td>
              <td>{m.isViewer ? `${m.name || "You"} (you)` : `${m.initial}.`}{m.inactive && " 💤"}{m.finished && " ✅"}</td>
              <td style={{ width: 160 }}>
                {m.isViewer ? <ProgressBar grams={m.totalGrams} /> : <span style={{ fontSize: 11, color: "#999" }}>—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {viewer && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13 }}>
            Your referral link: <code>{window.location.origin}/mission100?g={inviteCode}&ref={saved.memberId}</code>
          </div>
          {!showBuy ? <button onClick={() => setShowBuy(true)} style={{ fontWeight: 700 }}>Buy Gold Coins Now</button>
            : <BuyNow enrollmentId={saved.enrollmentId} onDone={load} />}
        </div>
      )}

      {showJoin && !viewer && (
        <div style={{ marginTop: 16 }}>
          <StartOrJoinForm mode="join" inviteCode={inviteCode} refMemberId={refMemberId} onSuccess={() => { setShowJoin(false); load(); }} />
        </div>
      )}
    </div>
  );
}

export default function Mission100Screen() {
  const params = new URLSearchParams(window.location.search);
  const inviteCode = params.get("g");
  const refMemberId = params.get("ref");
  const [mode, setMode] = useState(null); // null | 'start' | 'join'

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: 24, fontFamily: "sans-serif" }}>
      <h1 style={{ marginBottom: 4 }}>🏆 Mission 100</h1>
      <p style={{ color: "#666", marginBottom: 20 }}>
        Race your friend group (10 or 20) to 100 grams of gold. Checkpoints every 25g win bonus coins — first to 100g
        wins a couple's trip. Everyone who finishes gets a bonus coin, no matter their rank.
      </p>

      {inviteCode ? (
        <Leaderboard inviteCode={inviteCode} refMemberId={refMemberId} />
      ) : mode ? (
        <StartOrJoinForm mode={mode} onSuccess={(code) => { window.location.search = `?g=${code}`; }} />
      ) : (
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => setMode("start")} style={{ fontWeight: 700, padding: "10px 20px" }}>Start a Group</button>
          <button onClick={() => { const code = prompt("Enter invite code"); if (code) window.location.search = `?g=${code.trim().toUpperCase()}`; }} style={{ padding: "10px 20px" }}>Join with a Code</button>
        </div>
      )}
    </div>
  );
}
