// Orchestrates one CVD sync run. All I/O is injected so the guard rules are
// unit-testable: { listFiles, download, usdInr, store }.
//   store.loadExisting(kind, prefix) -> [{sku,status,price_inr}]  (kind null = any)
//   store.loadReportNos(prefix)       -> Set of report numbers already held under that SKU prefix (optional)
//   store.upsert(rows)        -> persists stones (insert or update by sku)
//   store.delist(skus)        -> marks stones delisted
// Each main file kind (white / fancy) is reconciled independently, so one bad
// file never wipes or blocks the other. The second supplier, Vibgyor (SKU VIB-),
// is one group of its own (its fancy file also holds some white stones, so
// both files are reconciled together); it is optional and a problem in it never
// touches the main stock. A certificate that the main stock already lists wins.
import { pickLatestFiles, pickLatestVibFiles, workbookToTable, buildStones, planReconcile, VIB_PREFIX, MAIN_PREFIX } from "./cvdStock.js";

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

  stones.forEach((s) => deps.reportNos?.add(s.report_no));
  const existing = await deps.store.loadExisting(kind, MAIN_PREFIX);
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

// Vibgyor: parse every Vibgyor file found, merge, reconcile VIB- stones only.
async function syncVib(vibFiles, deps, dry) {
  const kinds = Object.keys(vibFiles);
  const note = { kind: "vib", name: kinds.map((k) => vibFiles[k].name).join(" + "), files: kinds.map((k) => ({ kind: k, name: vibFiles[k].name, drive_id: vibFiles[k].id, modified: vibFiles[k].modifiedTime })) };
  const merged = new Map();
  let rows = 0, skipped = 0;
  for (const kind of kinds) {
    let table;
    try { table = workbookToTable(await deps.download(vibFiles[kind])); } catch (e) { return { ...note, status: "error", error: `${vibFiles[kind].name}: download/parse failed: ${e.message}` }; }
    if (table.error) return { ...note, status: "error", error: `${vibFiles[kind].name}: ${table.error}` };
    const built = buildStones(table, kind, deps.usdInr, { supplier: "vib" });
    rows += table.rows.length; skipped += built.skipped;
    for (const s of built.stones) { if (merged.has(s.sku)) skipped++; else merged.set(s.sku, s); }
  }
  // Certificates the main stock already carries (this run or stored) stay under their CVD- SKU.
  const mainReports = new Set([...(deps.reportNos || []), ...(deps.store.loadReportNos ? await deps.store.loadReportNos(MAIN_PREFIX) : [])]);
  const stones = [...merged.values()].filter((s) => !mainReports.has(s.report_no));
  note.rows = rows; note.stones = stones.length; note.skipped = skipped; note.overlap_with_main = merged.size - stones.length;

  const existing = await deps.store.loadExisting(null, VIB_PREFIX);
  const plan = planReconcile(existing, stones);
  const delistOk = !plan.shrunk;
  note.added = plan.added.length; note.returned = plan.returned.length;
  note.price_changed = plan.priceChanged.length; note.delisted = delistOk ? plan.gone.length : 0;
  if (!delistOk) note.error = `files have ${stones.length} stones vs ${plan.liveStored} stored — delisting skipped`;
  if (!dry) {
    await deps.store.upsert(stones);
    if (delistOk && plan.gone.length) await deps.store.delist(plan.gone.map((s) => s.sku));
  }
  return { ...note, status: delistOk ? "ok" : "partial", sampleAdded: plan.added.slice(0, 3).map((s) => s.sku), sampleGone: plan.gone.slice(0, 3).map((s) => s.sku) };
}

export async function runCvdSync({ listFiles, download, usdInr, store, dry = false }) {
  if (!usdInr || usdInr < 50 || usdInr > 200) return { status: "error", error: `USD/INR rate unavailable or out of range (${usdInr})`, files: [] };
  const listing = await listFiles();
  const latest = pickLatestFiles(listing);
  const files = [];
  const reportNos = new Set();
  for (const kind of KINDS) {
    if (!latest[kind]) { files.push({ kind, status: "error", error: "no stock file found in folder" }); continue; }
    files.push(await syncKind(kind, latest[kind], { download, usdInr, store, reportNos }, dry));
  }
  const vibFiles = pickLatestVibFiles(listing);
  if (Object.keys(vibFiles).length) {
    try { files.push(await syncVib(vibFiles, { download, usdInr, store, reportNos }, dry)); }
    catch (e) { files.push({ kind: "vib", status: "error", error: `vibgyor sync failed: ${e.message}` }); }
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
