import { describe, it, expect, vi } from "vitest";
import { toIngestPayload, feedEnabled, pushToDiapriApp } from "../../api/_lib/diapriFeed.js";

const stored = { date: "2026-10-09", rounds: { "1.00": [[1]] }, fancy: { "1.00": [[2]] }, updated_at: "x", source: "drive", rounds_ranges: [] };
const env = { DIAPRI_FEED_ENABLED: "true", DIAPRI_APP_URL: "https://app.example.com/", DIAPRI_INGEST_SECRET: "s3cret" };

describe("toIngestPayload", () => {
  it("keeps only date, rounds and fancy", () => {
    expect(toIngestPayload(stored)).toEqual({ date: "2026-10-09", rounds: stored.rounds, fancy: stored.fancy });
  });
  it("works without fancy and refuses incomplete data", () => {
    expect(toIngestPayload({ date: "2026-10-09", rounds: {} })).toEqual({ date: "2026-10-09", rounds: {} });
    expect(toIngestPayload({ rounds: {} })).toBeNull();
    expect(toIngestPayload(null)).toBeNull();
  });
});

describe("feedEnabled", () => {
  it("needs the flag, the app URL and the secret", () => {
    expect(feedEnabled(env)).toBe(true);
    expect(feedEnabled({ ...env, DIAPRI_FEED_ENABLED: "false" })).toBe(false);
    expect(feedEnabled({ ...env, DIAPRI_APP_URL: "" })).toBe(false);
    expect(feedEnabled({ ...env, DIAPRI_INGEST_SECRET: "" })).toBe(false);
    expect(feedEnabled({})).toBe(false);
  });
});

describe("pushToDiapriApp", () => {
  it("does nothing while the feed is off", async () => {
    const f = vi.fn();
    expect(await pushToDiapriApp(stored, {}, f)).toEqual({ pushed: false, reason: "feed disabled" });
    expect(f).not.toHaveBeenCalled();
  });
  it("posts the plain payload with the secret to the ingest endpoint", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true });
    expect(await pushToDiapriApp(stored, env, f)).toEqual({ pushed: true });
    const [url, opts] = f.mock.calls[0];
    expect(url).toBe("https://app.example.com/api/ingest-diapri");
    expect(opts.headers["x-ingest-secret"]).toBe("s3cret");
    expect(JSON.parse(opts.body)).toEqual({ date: "2026-10-09", rounds: stored.rounds, fancy: stored.fancy });
  });
  it("reports a rejection or an outage without throwing", async () => {
    expect((await pushToDiapriApp(stored, env, vi.fn().mockResolvedValue({ ok: false, status: 400 }))).reason).toMatch(/400/);
    expect((await pushToDiapriApp(stored, env, vi.fn().mockRejectedValue(new Error("down")))).reason).toBe("app unreachable");
  });
});
