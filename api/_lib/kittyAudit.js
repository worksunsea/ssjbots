// Shared audit-log writer for the kitty feature — every mutating action
// (admin or public) logs who/what/when. Never blocks the caller: an audit
// write failing shouldn't stop the actual operation from succeeding.
import { supa } from "./supabase.js";
import { TENANT_ID } from "./config.js";

export async function logKittyAudit({ entityType, entityId, action, actor, details }) {
  // supabase-js query builders only implement .then(), not .catch()/.finally() —
  // chaining .catch() directly on one throws a *synchronous* TypeError instead
  // of a caught rejection, which crashed every caller of this function with a
  // 500 before it could ever respond (confirmed live, 2026-08-25 — e.g.
  // delete-enrollment's DB delete had already committed, but the response
  // never reached the frontend, looking like "nothing happened until refresh").
  // try/catch around a real await is the correct way to swallow errors here.
  try {
    await supa().from("kitty_audit_log").insert({
      tenant_id: TENANT_ID, entity_type: entityType, entity_id: entityId || null,
      action, actor: actor || "unknown", details: details || null,
    });
  } catch {}
}
