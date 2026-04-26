// Gemtre Media Server — runs on Synology NAS
// Accepts image/video uploads, serves them publicly via Cloudflare tunnel
// Exposed as: https://media.gemtre.in
//
// Routes:
//   POST /upload          — upload file (multipart/form-data), returns public URL
//   GET  /files           — list all files (optional ?folder=social)
//   DELETE /files/:name   — delete a file
//   GET  /health          — liveness check
//   Static files served from AUTH_DIR/gemtre-media/

import Fastify from "fastify";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import cors from "@fastify/cors";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { exec } from "child_process";
import { promisify } from "util";
import crypto from "crypto";

const execAsync = promisify(exec);

const PORT = Number(process.env.PORT || 3022);
const MEDIA_DIR = process.env.MEDIA_DIR || "/volume1/gemtre-media";
const SERVICE_SECRET = process.env.SERVICE_SECRET || "";
const PUBLIC_URL = (process.env.PUBLIC_URL || "https://media.gemtre.in").replace(/\/$/, "");

// Ensure base folders exist
const FOLDERS = ["social", "ads", "videos", "blog", "misc"];
for (const f of FOLDERS) fs.mkdirSync(path.join(MEDIA_DIR, f), { recursive: true });

const app = Fastify({ logger: { level: "warn" } });

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } }); // 200MB max
await app.register(staticPlugin, { root: MEDIA_DIR, prefix: "/media/" });

function requireSecret(req, reply) {
  if (!SERVICE_SECRET) return;
  const h = req.headers["x-service-secret"] || req.query?.secret;
  if (h !== SERVICE_SECRET) {
    reply.code(401).send({ ok: false, error: "unauthorized" });
    return reply;
  }
}

// ── Health ─────────────────────────────────────────────────────────────────
app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

// ── Upload ─────────────────────────────────────────────────────────────────
app.post("/upload", async (req, reply) => {
  if (requireSecret(req, reply)?.sent) return;

  const data = await req.file();
  if (!data) return reply.code(400).send({ ok: false, error: "no file" });

  const folder = req.query?.folder || "misc";
  const allowedFolders = ["social", "ads", "videos", "blog", "misc"];
  const safeFolder = allowedFolders.includes(folder) ? folder : "misc";

  const ext = path.extname(data.filename || "file.jpg").toLowerCase() || ".jpg";
  const name = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  const destPath = path.join(MEDIA_DIR, safeFolder, name);

  await pipeline(data.file, fs.createWriteStream(destPath));

  const url = `${PUBLIC_URL}/media/${safeFolder}/${name}`;
  return reply.send({ ok: true, url, folder: safeFolder, name, path: destPath });
});

// ── Upload from URL (fetch remote image, save locally) ────────────────────
app.post("/upload-url", async (req, reply) => {
  if (requireSecret(req, reply)?.sent) return;

  const { url: sourceUrl, folder = "misc", filename } = req.body || {};
  if (!sourceUrl) return reply.code(400).send({ ok: false, error: "url required" });

  const allowedFolders = ["social", "ads", "videos", "blog", "misc"];
  const safeFolder = allowedFolders.includes(folder) ? folder : "misc";

  const res = await fetch(sourceUrl);
  if (!res.ok) return reply.code(502).send({ ok: false, error: `fetch failed: ${res.status}` });

  const contentType = res.headers.get("content-type") || "image/jpeg";
  const ext = contentType.includes("video") ? ".mp4" : contentType.includes("png") ? ".png" : contentType.includes("webp") ? ".webp" : ".jpg";
  const name = filename || `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  const destPath = path.join(MEDIA_DIR, safeFolder, name);

  const fileStream = fs.createWriteStream(destPath);
  await pipeline(res.body, fileStream);

  const publicUrl = `${PUBLIC_URL}/media/${safeFolder}/${name}`;
  return reply.send({ ok: true, url: publicUrl, folder: safeFolder, name });
});

// ── List files ─────────────────────────────────────────────────────────────
app.get("/files", async (req, reply) => {
  if (requireSecret(req, reply)?.sent) return;

  const folder = req.query?.folder;
  const results = [];

  const folders = folder ? [folder] : FOLDERS;
  for (const f of folders) {
    const dir = path.join(MEDIA_DIR, f);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(n => !n.startsWith("."));
    for (const name of files) {
      const stat = fs.statSync(path.join(dir, name));
      results.push({
        name, folder: f,
        url: `${PUBLIC_URL}/media/${f}/${name}`,
        size: stat.size,
        created_at: stat.birthtime,
      });
    }
  }

  results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return reply.send({ ok: true, files: results, total: results.length });
});

// ── Delete file ────────────────────────────────────────────────────────────
app.delete("/files/:folder/:name", async (req, reply) => {
  if (requireSecret(req, reply)?.sent) return;

  const { folder, name } = req.params;
  const filePath = path.join(MEDIA_DIR, folder, name);
  if (!fs.existsSync(filePath)) return reply.code(404).send({ ok: false, error: "not found" });

  fs.unlinkSync(filePath);
  return reply.send({ ok: true });
});

// ── Ken Burns video from image (zoom + pan, perfect for Reels/Stories) ────
// POST /make-video { image_url, style, duration, format, caption_text }
// style: "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "float"
// format: "reel" (1080x1920) | "feed" (1080x1080) | "story" (1080x1920) | "landscape" (1920x1080)
app.post("/make-video", async (req, reply) => {
  if (requireSecret(req, reply)?.sent) return;

  const {
    image_url,
    style = "zoom_in",
    duration = 15,
    format = "reel",
    caption_text = "",
    output_name,
  } = req.body || {};

  if (!image_url) return reply.code(400).send({ ok: false, error: "image_url required" });

  const id = crypto.randomBytes(6).toString("hex");
  const tmpImg = path.join(MEDIA_DIR, "misc", `tmp-${id}.jpg`);
  const outName = output_name || `video-${id}.mp4`;
  const outPath = path.join(MEDIA_DIR, "videos", outName);

  // Download source image
  const imgRes = await fetch(image_url);
  if (!imgRes.ok) return reply.code(502).send({ ok: false, error: "failed to fetch image" });
  await pipeline(imgRes.body, fs.createWriteStream(tmpImg));

  // Output resolution
  const resolutions = {
    reel: { w: 1080, h: 1920 },
    story: { w: 1080, h: 1920 },
    feed: { w: 1080, h: 1080 },
    landscape: { w: 1920, h: 1080 },
  };
  const { w, h } = resolutions[format] || resolutions.reel;

  // Ken Burns zoom/pan filter — smooth cinematic motion
  const zoompanFilters = {
    zoom_in:   `zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${duration * 25}:s=${w}x${h}:fps=25`,
    zoom_out:  `zoompan=z='if(lte(zoom,1.0),1.5,max(1.0,zoom-0.0015))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${duration * 25}:s=${w}x${h}:fps=25`,
    pan_left:  `zoompan=z='1.3':x='if(gte(x,iw*0.3),0,x+1)':y='ih/2-(ih/zoom/2)':d=${duration * 25}:s=${w}x${h}:fps=25`,
    pan_right: `zoompan=z='1.3':x='min(x+1,iw*0.3)':y='ih/2-(ih/zoom/2)':d=${duration * 25}:s=${w}x${h}:fps=25`,
    float:     `zoompan=z='1.2+0.1*sin(on/(${duration}*25)*2*PI)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${duration * 25}:s=${w}x${h}:fps=25`,
  };

  const zp = zoompanFilters[style] || zoompanFilters.zoom_in;

  // Add caption text overlay if provided
  const textFilter = caption_text
    ? `,drawtext=text='${caption_text.replace(/'/g, "\\'").slice(0, 80)}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=h-120:box=1:boxcolor=black@0.5:boxborderw=10`
    : "";

  const ffmpegCmd = [
    `ffmpeg -y`,
    `-loop 1 -i "${tmpImg}"`,
    `-vf "${zp},scale=${w}:${h},setsar=1${textFilter}"`,
    `-c:v libx264 -preset fast -crf 23`,
    `-t ${duration}`,
    `-pix_fmt yuv420p`,
    `-movflags +faststart`,
    `"${outPath}"`,
  ].join(" ");

  try {
    await execAsync(ffmpegCmd, { timeout: 120000 });
    fs.unlinkSync(tmpImg); // cleanup temp
    const url = `${PUBLIC_URL}/media/videos/${outName}`;
    return reply.send({ ok: true, url, format, style, duration, name: outName });
  } catch (err) {
    if (fs.existsSync(tmpImg)) fs.unlinkSync(tmpImg);
    return reply.code(500).send({ ok: false, error: err.message?.slice(0, 200) });
  }
});

// ── Slideshow video from multiple images (for ads) ─────────────────────────
// POST /make-slideshow { image_urls: [], duration_per_image, format, transition }
app.post("/make-slideshow", async (req, reply) => {
  if (requireSecret(req, reply)?.sent) return;

  const {
    image_urls = [],
    duration_per_image = 4,
    format = "reel",
    output_name,
  } = req.body || {};

  if (!image_urls.length) return reply.code(400).send({ ok: false, error: "image_urls required" });

  const id = crypto.randomBytes(6).toString("hex");
  const tmpFiles = [];
  const resolutions = { reel: "1080x1920", story: "1080x1920", feed: "1080x1080", landscape: "1920x1080" };
  const res = resolutions[format] || "1080x1920";
  const [w, h] = res.split("x");

  // Download all images
  for (let i = 0; i < Math.min(image_urls.length, 10); i++) {
    const tmpPath = path.join(MEDIA_DIR, "misc", `tmp-slide-${id}-${i}.jpg`);
    const r = await fetch(image_urls[i]);
    if (!r.ok) continue;
    await pipeline(r.body, fs.createWriteStream(tmpPath));
    tmpFiles.push(tmpPath);
  }

  if (!tmpFiles.length) return reply.code(502).send({ ok: false, error: "failed to download images" });

  const outName = output_name || `slideshow-${id}.mp4`;
  const outPath = path.join(MEDIA_DIR, "videos", outName);

  // Build ffmpeg concat command with crossfade transitions
  const inputs = tmpFiles.map(f => `-loop 1 -t ${duration_per_image} -i "${f}"`).join(" ");
  const filterParts = tmpFiles.map((_, i) =>
    `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`
  );
  const concatInputs = tmpFiles.map((_, i) => `[v${i}]`).join("");
  const filterComplex = `${filterParts.join(";")};${concatInputs}concat=n=${tmpFiles.length}:v=1:a=0[out]`;

  const ffmpegCmd = [
    `ffmpeg -y`,
    inputs,
    `-filter_complex "${filterComplex}"`,
    `-map "[out]"`,
    `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -movflags +faststart`,
    `"${outPath}"`,
  ].join(" ");

  try {
    await execAsync(ffmpegCmd, { timeout: 180000 });
    tmpFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });
    const url = `${PUBLIC_URL}/media/videos/${outName}`;
    return reply.send({ ok: true, url, format, slides: tmpFiles.length, name: outName });
  } catch (err) {
    tmpFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });
    return reply.code(500).send({ ok: false, error: err.message?.slice(0, 200) });
  }
});

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`Media server running on port ${PORT} | serving ${MEDIA_DIR} → ${PUBLIC_URL}`);
