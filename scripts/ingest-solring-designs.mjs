// One-time ingestion: "solring" batch of 113 real (non-AI-generated) solitaire
// ring CAD designs into solitaire_designs / solitaire_design_variants.
// Run: node scripts/ingest-solring-designs.mjs [--limit N] [--only 01,04,45]
//
// Source: C:\Users\NUC\Downloads\solring\SOLITER RINGS\part {1..6}\{NN}\...
// Each design folder has:
//   - one CAD spec-sheet image (filename inconsistent — see findSpecImage) with
//     diamond shape/mm/pcs/carat, 14KT + 18KT gold weight, US ring size
//   - a photo subfolder (naming inconsistent — see findPhotoFolder) with 6-12
//     studio stills already covering multiple gold colours, plus a few
//     "model (n).jpg" lifestyle worn-on-hand shots (included in the gallery)
//   - raw CAD source (.3dm/.stl) — intentionally NEVER touched by this script
//
// Per design: one vision call extracts spec-sheet data + suggests a name,
// one vision call classifies every photo's gold colour. Images are resized
// to 1600px longest side and re-encoded before upload — the site must never
// see the 12GB of raw source material.

import fs from "fs";
import path from "path";
import sharp from "sharp";
import { supa } from "../api/_lib/supabase.js";
import { OPENAI_API_KEY, OPENAI_MODEL, TENANT_ID } from "../api/_lib/config.js";

const ROOT = "C:\\Users\\NUC\\Downloads\\solring\\SOLITER RINGS";
const PARTS = ["part 1", "part 2 (2)", "part 3", "part 4", "part 5", "part 6"];
const GOLD_COLORS = ["yellow", "rose", "white"];
const MAX_DIM = 1600;
const JPEG_QUALITY = 78;

const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
const LIMIT = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;
const onlyArg = args.indexOf("--only");
const ONLY = onlyArg >= 0 ? new Set(args[onlyArg + 1].split(",").map((s) => s.trim())) : null;

function log(...a) { console.log(new Date().toISOString().slice(11, 19), ...a); }

// ── Folder discovery ────────────────────────────────────────────────────

function listDesignFolders() {
  const out = [];
  for (const part of PARTS) {
    const partDir = path.join(ROOT, part);
    for (const name of fs.readdirSync(partDir)) {
      const full = path.join(partDir, name);
      if (fs.statSync(full).isDirectory()) out.push({ number: name, dir: full });
    }
  }
  return out.sort((a, b) => Number(a.number) - Number(b.number));
}

// Spec sheet: prefer NN.jpg/NN.png at top level (with/without leading zero),
// else a nested subfolder of the same name containing it, else the one
// stray top-level image that isn't the photo subfolder.
function findSpecImage(dir, number) {
  const bare = String(Number(number)); // "01" -> "1"
  const entries = fs.readdirSync(dir);
  const isImg = (f) => /\.(jpe?g|png)$/i.test(f);
  const matchesNumber = (f) => {
    const base = f.replace(/\.(jpe?g|png)$/i, "");
    return base === number || base === bare || base.replace(/^0+/, "") === bare;
  };

  const direct = entries.find((f) => isImg(f) && matchesNumber(f));
  if (direct) return path.join(dir, direct);

  // Nested subfolder named after the design (e.g. part 2/31/31/31.jpg)
  const nested = entries.find((f) => f === number && fs.statSync(path.join(dir, f)).isDirectory());
  if (nested) {
    const nestedDir = path.join(dir, nested);
    const nestedFile = fs.readdirSync(nestedDir).find((f) => isImg(f) && matchesNumber(f));
    if (nestedFile) return path.join(nestedDir, nestedFile);
  }

  // Stray top-level image (vendor batch code filename e.g. BMLR2936.jpg) —
  // any image directly in `dir` that isn't inside a photo/video subfolder.
  const strayImgs = entries.filter((f) => isImg(f) && fs.statSync(path.join(dir, f)).isFile());
  if (strayImgs.length === 1) return path.join(dir, strayImgs[0]);
  if (strayImgs.length > 1) return path.join(dir, strayImgs[0]); // best-effort, flagged by caller reviewing output

  return null;
}

// Photo folder name is wildly inconsistent — fuzzy-match "photo(s)" +
// "video(s)"/"vidio(s)" with any spacing/case/ampersand/"and". Some designs
// have no "photo"-named folder at all — the photos just sit in a subfolder
// bare-named after the design number (e.g. part 6/113/113/*.jpg) — fall back
// to that if the fuzzy match finds nothing.
function findPhotoFolder(dir, number) {
  const bare = String(Number(number));
  const entries = fs.readdirSync(dir);
  const re = /photo/i;
  const candidates = entries.filter((f) => re.test(f) && fs.statSync(path.join(dir, f)).isDirectory());
  if (candidates.length) return path.join(dir, candidates[0]);

  const numberedDir = entries.find((f) => (f === number || f === bare) && fs.statSync(path.join(dir, f)).isDirectory());
  if (numberedDir) return path.join(dir, numberedDir);

  return null;
}

// Some designs bury the spec-sheet image inside the photo folder itself
// (e.g. part 5/100/100 photo and video/100.jpg) instead of at the design's
// top level — search there as a last resort.
function findSpecImageInPhotoFolder(photoDir, number) {
  if (!photoDir) return null;
  const bare = String(Number(number));
  const isImg = (f) => /\.(jpe?g|png)$/i.test(f);
  const matchesNumber = (f) => {
    const base = f.replace(/\.(jpe?g|png)$/i, "");
    return base === number || base === bare || base.replace(/^0+/, "") === bare;
  };
  const entries = fs.readdirSync(photoDir);
  const match = entries.find((f) => isImg(f) && matchesNumber(f));
  return match ? path.join(photoDir, match) : null;
}

function listPhotos(photoDir) {
  if (!photoDir) return [];
  return fs.readdirSync(photoDir)
    .filter((f) => /\.(jpe?g|png)$/i.test(f) && !/thumbs\.db/i.test(f))
    .map((f) => path.join(photoDir, f));
}

// ── Vision calls ────────────────────────────────────────────────────────

function b64OfFile(filePath) {
  return fs.readFileSync(filePath).toString("base64");
}
function dataUri(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${b64OfFile(filePath)}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function visionCall({ text, images, maxTokens = 400 }) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{
          role: "user",
          content: [
            { type: "text", text },
            ...images.map((uri) => ({ type: "image_url", image_url: { url: uri } })),
          ],
        }],
        max_tokens: maxTokens,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data?.choices?.[0]?.message?.content?.trim() || "";
    }
    if (res.status === 429 && attempt < 5) {
      const backoffMs = 3000 * (attempt + 1);
      await sleep(backoffMs);
      continue;
    }
    throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  throw new Error("OpenAI 429: retries exhausted");
}

function parseJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

async function extractSpecAndName(specImagePath) {
  const prompt = `This is a jewellery CAD spec sheet for a solitaire engagement ring. Read the diagram and tables and return ONLY JSON (no markdown, no explanation) with this exact shape:
{"shape": "Round|Oval|Cushion|Pear|Emerald|Marquise|Asscher|Radiant|Heart|Princess", "stoneCount": <number of center+accent stones from the "PCS" row>, "totalCaratWeight": <number, from DIA WT total>, "goldWeight14kt": <number in grams>, "goldWeight18kt": <number in grams>, "usSize": "<e.g. 7>", "name": "<a short elegant 3-5 word product name for this ring, jewellery-catalogue style, no quotes, reflecting its shape and stone count e.g. a 3-stone round ring might be 'Trinity Round Solitaire Ring'>"}
If a field truly can't be read, use null for numbers or "Round" as a safe default for shape.`;
  const text = await visionCall({ text: prompt, images: [dataUri(specImagePath)], maxTokens: 300 });
  return parseJson(text);
}

async function classifyPhotoColors(photoPaths) {
  // Ask in one call, referencing photos by index, to keep call count low.
  const prompt = `These are ${photoPaths.length} product photos of the SAME gold ring, numbered 1 to ${photoPaths.length} in the order given. Each photo shows the ring in yellow gold, rose gold, or white gold (or is a lifestyle/hand-worn shot — still classify by the ring's visible metal colour). Return ONLY JSON: {"colors": ["yellow"|"rose"|"white", ...]} with exactly ${photoPaths.length} entries in order.`;
  const text = await visionCall({ text: prompt, images: photoPaths.map(dataUri), maxTokens: 200 });
  const parsed = parseJson(text);
  if (!parsed?.colors || parsed.colors.length !== photoPaths.length) return null;
  return parsed.colors.map((c) => (GOLD_COLORS.includes(c) ? c : "yellow"));
}

// ── Image processing ────────────────────────────────────────────────────

async function compressToBuffer(filePath) {
  return sharp(filePath)
    .rotate()
    .resize({ width: MAX_DIM, height: MAX_DIM, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}

// ── Naming/SKU ───────────────────────────────────────────────────────────

function skuFor(number) {
  return `SSJ-SOL-${String(Number(number)).padStart(3, "0")}`;
}

// ── Main ────────────────────────────────────────────────────────────────

async function ingestOne(sb, { number, dir }) {
  const photoDir = findPhotoFolder(dir, number);
  const specImage = findSpecImage(dir, number) || findSpecImageInPhotoFolder(photoDir, number);
  const photos = listPhotos(photoDir).filter((p) => p !== specImage);

  if (!photos.length) return { number, ok: false, reason: "no_photos_found" };

  // A few designs ship with no rendered spec sheet at all (CAD .3dm only) —
  // ingest anyway with safe defaults rather than drop a real, photographed
  // design; specs can be corrected manually later once available.
  const spec = specImage ? await extractSpecAndName(specImage) : { shape: "Round", stoneCount: 1, name: null };
  if (!spec) return { number, ok: false, reason: "spec_extraction_failed" };

  const colors = await classifyPhotoColors(photos);
  if (!colors) return { number, ok: false, reason: "color_classification_failed" };

  const byColor = {};
  photos.forEach((p, i) => { (byColor[colors[i]] ||= []).push(p); });

  const sku = skuFor(number);
  const name = spec.name || `Solitaire ${spec.shape || "Round"} Ring`;
  const goldWeightG = spec.goldWeight18kt ?? spec.goldWeight14kt ?? null; // 18kt used as the reference casting weight

  const { data: design, error: designErr } = await sb.from("solitaire_designs").insert({
    tenant_id: TENANT_ID,
    category: "ring",
    design_number: Number(number),
    name: `${name} (${sku})`,
    concept_prompt: `Sourced from real CAD render batch, spec sheet design #${number}.`,
    has_side_diamonds: (spec.stoneCount || 1) > 1,
    side_diamond_weight_ct: (spec.stoneCount || 1) > 1 ? spec.totalCaratWeight : null,
    active: true,
  }).select("id").single();
  if (designErr) return { number, ok: false, reason: `design_insert_failed: ${designErr.message}` };

  let variantsCreated = 0;
  for (const color of GOLD_COLORS) {
    const group = byColor[color];
    if (!group?.length) continue;

    const urls = [];
    for (let i = 0; i < group.length; i++) {
      const buf = await compressToBuffer(group[i]);
      const uploadPath = `uploads/solitaire-designs/${design.id}/${color}/photo-${i + 1}.jpg`;
      const { error: upErr } = await sb.storage.from("media").upload(uploadPath, buf, { contentType: "image/jpeg", upsert: true });
      if (upErr) continue;
      const { data: pub } = sb.storage.from("media").getPublicUrl(uploadPath);
      urls.push(pub.publicUrl);
    }
    if (!urls.length) continue;

    // The storefront (SolitaireJewelleryScreen.jsx) only recognizes
    // front/angle/worn keys — map the uploaded set onto those, same as
    // _fix-ring-view-image-keys.mjs used to repair the first import pass.
    const viewImages = { front: urls[0] };
    if (urls.length === 2) viewImages.worn = urls[1];
    if (urls.length >= 3) { viewImages.angle = urls[Math.floor(urls.length / 2)]; viewImages.worn = urls[urls.length - 1]; }

    const { error: variantErr } = await sb.from("solitaire_design_variants").insert({
      tenant_id: TENANT_ID,
      design_id: design.id,
      gold_color: color,
      diamond_shape: spec.shape || "Round",
      carat_size: spec.totalCaratWeight || null,
      view_images: viewImages,
      est_gold_weight_g: goldWeightG,
      generated_by: "solring_batch_import",
      status: "approved",
    });
    if (!variantErr) variantsCreated++;
  }

  if (!variantsCreated) return { number, ok: false, reason: "no_variants_created" };
  return { number, ok: true, designId: design.id, sku, name, variantsCreated, colorsFound: Object.keys(byColor) };
}

async function main() {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing — set it in the environment before running");
  const sb = supa();
  let folders = listDesignFolders();
  if (ONLY) folders = folders.filter((f) => ONLY.has(f.number));
  folders = folders.slice(0, LIMIT);

  const { data: existing } = await sb.from("solitaire_designs")
    .select("design_number").eq("tenant_id", TENANT_ID).eq("category", "ring");
  const alreadyDone = new Set((existing || []).map((d) => d.design_number));
  const skipped = folders.filter((f) => alreadyDone.has(Number(f.number)));
  folders = folders.filter((f) => !alreadyDone.has(Number(f.number)));
  if (skipped.length) log(`Skipping ${skipped.length} already-ingested: ${skipped.map((f) => f.number).join(",")}`);

  log(`Ingesting ${folders.length} designs...`);
  const results = [];
  for (const folder of folders) {
    try {
      const r = await ingestOne(sb, folder);
      results.push(r);
      log(r.ok ? `✅ ${r.number} -> ${r.sku} "${r.name}" (${r.variantsCreated} variants: ${r.colorsFound.join(",")})` : `❌ ${r.number} -- ${r.reason}`);
    } catch (e) {
      results.push({ number: folder.number, ok: false, reason: String(e.message || e) });
      log(`❌ ${folder.number} -- exception: ${e.message || e}`);
    }
    await sleep(10000); // deliberately slow — shares OPENAI_API_KEY's TPM pool with live chatbot/corp-gifting traffic
  }

  const okCount = results.filter((r) => r.ok).length;
  log(`\nDone. ${okCount}/${results.length} ingested cleanly.`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    log(`Flagged for manual review (${failed.length}):`);
    failed.forEach((r) => log(`  ${r.number}: ${r.reason}`));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
