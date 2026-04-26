// GET/POST /api/wa-proxy?path=/clients
// Proxies requests to the self-hosted wa-service on Synology.
// The browser can't call the Synology directly (HTTP from HTTPS page = mixed content).
// This function holds WA_SERVICE_URL + WA_SERVICE_SECRET and forwards the request.

export const config = { maxDuration: 30 };

const WA_SERVICE_URL = (process.env.WA_SERVICE_URL || "").replace(/\/+$/, "");
const WA_SERVICE_SECRET = process.env.WA_SERVICE_SECRET || "";

export default async function handler(req, res) {
  if (!WA_SERVICE_URL) {
    return res.status(503).json({ ok: false, error: "wa_service_not_configured" });
  }

  // Allow browser to call this endpoint
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Path comes from query string: /api/wa-proxy?path=/clients/7563/logout
  const path = req.query.path || "/clients";
  const url = `${WA_SERVICE_URL}${path}`;

  const headers = { "Content-Type": "application/json" };
  if (WA_SERVICE_SECRET) headers["x-service-secret"] = WA_SERVICE_SECRET;

  try {
    const r = await fetch(url, {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.body ? JSON.stringify(req.body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    return res.status(r.status).json(data);
  } catch (err) {
    return res.status(502).json({ ok: false, error: String(err.message || err) });
  }
}
