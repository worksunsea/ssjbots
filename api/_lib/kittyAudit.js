// Shared audit-log writer for the kitty feature — every mutating action
// (admin or public) logs who/what/when. Never blocks the caller: an audit
// write failing shouldn't stop the actual operation from succeeding.
import { supa } from "./supabase.js";
import { TENANT_ID } from "./config.js";

export async function logKittyAudit({ entityType, entityId, action, actor, details }) {
  await supa().from("kitty_audit_log").insert({
    tenant_id: TENANT_ID, entity_type: entityType, entity_id: entityId || null,
    action, actor: actor || "unknown", details: details || null,
  }).catch(() => {});
}
