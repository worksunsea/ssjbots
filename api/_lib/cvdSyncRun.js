// Orchestrates one CVD sync run. All I/O is injected so the guard rules are
// unit-testable: { listFiles, download, usdInr, store }.
//   store.loadExisting(kind) -> [{sku,status,price_inr}]
//   store.upsert(rows)        -> persists stones (insert or update by sku)
//   store.delist(skus)        -> marks stones delisted
// Each file kind (white / fancy) is reconciled independently, so one bad
// file never wipes or blocks the other.
import { pickLatestFiles, workbookToTable, buildStones, planReconcile } from "./cvdStock.js";

const KINDS = ["white", "fancy"];

async function syncKind(kind, file, deps, dry) {
  const note = { kind, name: file.name, drive_id: file.id, modified: file.modifiedTime };
  let table;
  try { table = workbookToTable(await deps.download(file)); } catch (e) { return { ...note, status: "error", error: `download/parse failed: ${e.message}` }; }
  if (table.error) return { ...note, status: "error", error: table.error };

  const { stones, skipped, countMismatch } = buildStones(table, kind, deps.usdInr);
  note.rows = table.rows.length; note.stones = stones.length; note.skipped = skipped;
  // The sheet's own totals row must match the data rows, else the file is half-written.
  if (countMismatch) return { ...note, status: "error", error: `row count ${table.rows.length} != totals row ${table.totalsCount}` };

  const existing = await deps.store.loadExisting(kind);
  const plan = planReconcile(existing, stones);
  // Shrunk-file guard: refuse to delist on a suspiciously small file; still safe to add/update.
  const delistOk = !plan.shrunk;
  note.added = plan.added.length; note.returned = plan.returned.length;
  note.price_changed = plan.priceChanged.length; note.delisted = delistOk ? plan.gone.length : 0;
  if (!delistOk) note.error = `file has ${stones.length} stones vs ${plan.liveStored} stored — delisting skipped`;

  if (!dry) {
    await deps.store.upsert(stones);
    if (delistOk && plan.gone.length) await deps.store.delist(plan.gone.map((s) => s.sku));
  }
  return { ...note, status: delistOk ? "ok" : "partial", sampleAdded: plan.added.slice(0, 3).map((s) => s.sku), sampleGone: plan.gone.slice(0, 3).map((s) => s.sku) };
}

export async function runCvdSync({ listFiles, download, usdInr, store, dry = false }) {
  if (!usdInr || usdInr < 50 || usdInr > 200) return { status: "error", error: `USD/INR rate unavailable or out of range (${usdInr})`, files: [] };
  const latest = pickLatestFiles(await listFiles());
  const files = [];
  for (const kind of KINDS) {
    if (!latest[kind]) { files.push({ kind, status: "error", error: "no stock file found in folder" }); continue; }
    files.push(await syncKind(kind, latest[kind], { download, usdInr, store }, dry));
  }
  const sum = (k) => files.reduce((a, f) => a + (f[k] || 0), 0);
  const failed = files.filter((f) => f.status === "error").length;
  const status = failed === files.length ? "error" : failed || files.some((f) => f.status === "partial") ? "partial" : "ok";
  return { status, usd_inr: usdInr, files, added: sum("added") + sum("returned"), delisted: sum("delisted"), price_changed: sum("price_changed"), dry };
}

export function summaryLine(r) {
  const head = r.status === "ok" ? "CVD stock sync OK" : r.status === "partial" ? "CVD stock sync PARTIAL" : "CVD stock sync FAILED";
  const problems = r.files.filter((f) => f.error).map((f) => `${f.kind}: ${f.error}`).join("; ");
  return `${head} — +${r.added || 0} added, ${r.delisted || 0} removed, ${r.price_changed || 0} price changes.${problems ? ` Issues: ${problems}` : ""}`;
}
