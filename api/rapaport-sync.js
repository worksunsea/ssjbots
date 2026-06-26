// GET /api/rapaport-sync
// Fetches the latest Rapaport price tables from Google Drive folder "Rapnet"
// and upserts them into bullion_dropdowns (field = 'rapaport_data').
//
// Auth: Authorization: Bearer <CRM_SECRET>
//
// Query params:
//   ?action=seed   — Skip Drive fetch; write the hardcoded June-19-2026 seed data.
//
// Google Drive auth uses a service account whose JSON is stored (base64-encoded) in
// GOOGLE_SERVICE_ACCOUNT_JSON. If that env var is absent (or action=seed is passed),
// the function falls back to seed data.
//
// Folder: 152rXtP8ioZ3lcsrsmQJ9w9qpA0ApgLEY  (shared "Rapnet" folder)
// Round PDF:  file whose name contains "Round"
// Fancy PDF:  file whose name contains "Pear" or "Fancy"

import { SUPABASE_URL, SUPABASE_SERVICE_KEY, CRM_SECRET } from "./_lib/config.js";

// ─── Weight-range labels (in order of appearance in the PDF tables) ──────────
const WEIGHT_RANGES = [
  "0.30", "0.40", "0.50", "0.70", "0.90",
  "1.00", "1.50", "2.00", "3.00", "4.00", "5.00", "10.00",
];

// ─── Seed data — Rapaport June 19, 2026 ─────────────────────────────────────
// Price unit: hundreds of $/ct (as published).

const SEED_ROUNDS = {
  "0.30": [
    [27,22,19,17,15,14,13,12,11,10,7],
    [23,20,17,15,14,13,12,11,10,9,6],
    [20,18,16,14,13,12,11,10,10,9,6],
    [18,16,14,13,12,12,11,10,9,8,5],
    [15,14,13,12,11,11,10,9,8,7,5],
    [13,12,11,11,10,10,9,8,7,6,5],
    [12,11,10,10,9,9,8,7,6,6,4],
    [11,10,9,9,8,8,7,6,5,5,4],
    [10,9,8,8,7,7,6,6,5,5,3],
    [9,8,8,7,7,7,6,5,5,4,3],
  ],
  "0.40": [
    [31,25,21,20,18,16,15,14,13,11,8],
    [26,22,19,18,17,15,14,13,12,10,7],
    [23,20,18,17,16,14,13,12,11,10,7],
    [21,18,17,16,15,13,12,11,10,9,6],
    [18,16,15,14,13,12,11,10,9,8,6],
    [16,14,13,12,12,11,10,9,8,7,6],
    [14,13,12,11,11,10,10,9,8,7,5],
    [13,12,11,10,10,9,9,8,7,6,5],
    [12,11,10,9,9,8,8,7,6,5,4],
    [11,10,9,8,8,8,7,6,5,5,4],
  ],
  "0.50": [
    [47,37,29,25,22,19,16,15,14,13,11],
    [37,32,26,23,20,17,15,14,13,12,10],
    [32,28,24,21,19,16,14,13,12,11,10],
    [27,24,21,19,18,15,13,12,11,10,9],
    [23,21,19,17,16,14,12,11,10,10,8],
    [20,18,16,15,14,13,11,10,9,9,8],
    [17,15,14,13,12,12,11,10,9,9,7],
    [15,14,13,12,11,11,10,9,8,8,7],
    [14,13,12,11,10,10,9,9,8,7,6],
    [13,12,11,10,9,9,8,8,8,6,5],
  ],
  "0.70": [
    [64,51,41,35,30,26,23,21,19,17,12],
    [52,45,38,33,28,24,21,19,17,16,11],
    [45,40,34,30,26,22,19,17,16,15,11],
    [38,33,30,27,24,20,17,16,15,14,10],
    [31,28,25,23,21,18,16,15,14,14,9],
    [26,23,21,20,18,16,15,14,13,13,9],
    [22,20,19,18,16,15,14,13,12,12,8],
    [20,18,17,16,15,14,13,12,11,10,8],
    [18,16,15,14,13,12,11,11,11,8,7],
    [16,14,13,12,11,11,10,10,10,7,6],
  ],
  "0.90": [
    [96,82,62,53,45,36,29,26,25,20,15],
    [83,71,57,48,41,32,26,24,23,19,14],
    [73,63,52,44,38,30,24,22,21,18,13],
    [59,52,45,40,35,28,23,21,20,17,12],
    [47,43,39,34,31,26,22,20,19,16,12],
    [41,37,34,30,28,24,20,19,18,15,11],
    [35,32,29,26,24,21,19,18,17,14,10],
    [30,27,25,23,21,19,17,16,15,13,9],
    [26,23,21,20,18,16,15,15,14,12,8],
    [23,20,18,17,16,15,14,14,13,10,7],
  ],
  "1.00": [
    [150,118,89,76,63,48,37,32,30,23,16],
    [115,102,81,69,57,44,34,30,28,22,15],
    [96,87,74,63,52,41,32,28,26,21,14],
    [75,68,62,54,47,37,30,26,24,20,13],
    [58,53,49,45,42,34,28,25,23,19,13],
    [48,44,41,38,35,31,26,24,22,18,12],
    [40,36,33,31,29,26,23,21,20,17,12],
    [34,31,29,27,25,23,21,20,19,16,11],
    [29,27,25,23,21,19,18,17,16,15,10],
    [25,23,22,21,19,17,16,15,14,14,10],
  ],
  "1.50": [
    [200,178,146,127,114,88,71,63,52,33,18],
    [179,164,136,116,105,82,65,57,49,31,17],
    [156,145,125,108,98,77,61,54,47,30,16],
    [129,120,108,94,85,71,57,51,44,29,15],
    [103,95,86,77,70,63,52,48,40,28,15],
    [83,77,69,65,60,53,48,44,37,26,14],
    [70,64,58,54,50,46,41,37,33,25,14],
    [60,53,48,45,42,38,35,32,29,23,13],
    [50,45,41,38,36,33,31,29,28,22,12],
    [44,39,37,34,32,30,29,27,26,21,12],
  ],
  "2.00": [
    [330,275,235,205,175,141,113,95,80,41,19],
    [270,245,210,190,160,132,105,88,76,39,18],
    [245,220,195,175,150,123,98,83,72,37,17],
    [205,185,165,150,135,112,92,77,68,35,16],
    [165,150,135,125,115,104,86,71,65,33,15],
    [135,120,110,100,93,86,78,66,61,31,15],
    [109,99,91,84,76,69,63,57,54,29,14],
    [91,83,76,70,63,57,53,50,47,28,14],
    [78,71,66,61,54,50,46,43,40,27,13],
    [68,63,57,54,48,45,42,40,38,26,13],
  ],
  "3.00": [
    [550,460,410,350,295,235,200,139,103,49,21],
    [450,420,370,320,265,210,185,131,98,47,20],
    [405,375,335,295,245,195,170,124,93,45,19],
    [335,315,280,245,210,180,155,112,87,43,18],
    [270,250,225,205,185,160,135,101,82,41,17],
    [220,205,190,175,160,140,120,92,77,38,16],
    [175,165,150,140,130,120,110,84,71,35,15],
    [145,135,125,120,110,103,97,76,62,33,15],
    [117,111,107,103,95,90,82,65,55,31,14],
    [95,91,87,83,79,75,67,58,47,30,14],
  ],
  "4.00": [
    [745,645,585,495,415,315,255,155,111,54,23],
    [625,585,525,450,390,295,240,145,106,52,22],
    [565,520,475,410,355,275,225,138,101,50,21],
    [465,430,395,360,315,245,200,127,95,47,20],
    [360,335,315,295,260,215,180,114,90,44,19],
    [280,260,245,230,210,190,160,105,86,41,18],
    [225,210,195,185,170,155,140,95,75,39,17],
    [185,175,160,150,140,130,120,83,66,36,17],
    [150,140,130,120,115,105,100,73,59,34,16],
    [125,115,105,100,95,90,80,65,50,32,16],
  ],
  "5.00": [
    [1000,855,770,690,580,430,315,175,125,60,25],
    [835,750,670,595,520,395,295,170,120,57,23],
    [730,670,595,540,465,360,280,160,115,54,22],
    [605,555,505,460,395,320,260,150,110,51,21],
    [480,445,400,360,325,265,225,140,100,48,21],
    [365,345,315,290,255,225,195,130,95,46,20],
    [280,260,240,220,205,195,170,120,88,43,19],
    [220,210,195,180,170,165,150,110,81,41,18],
    [180,165,155,150,140,135,125,100,69,37,17],
    [150,140,130,125,120,110,100,80,60,34,16],
  ],
  "10.00": [
    [1400,1300,1200,1070,900,635,465,250,140,66,27],
    [1270,1160,1030,930,820,585,430,235,135,63,26],
    [1110,1040,930,835,715,535,400,220,130,60,25],
    [930,865,785,715,610,485,370,205,125,57,24],
    [750,695,630,565,500,405,325,185,120,55,23],
    [570,535,495,460,405,340,275,170,115,52,22],
    [440,405,375,350,325,285,235,150,110,49,21],
    [345,325,300,275,255,235,200,135,100,47,20],
    [270,255,240,225,210,195,165,120,85,45,19],
    [225,210,195,185,175,165,140,105,75,43,18],
  ],
};

const SEED_FANCY = {
  "0.30": [
    [23,21,19,17,16,15,13,11,9,7,6],
    [21,19,17,16,15,14,12,10,8,7,5],
    [19,17,16,15,14,13,11,9,7,6,5],
    [17,16,15,14,13,12,10,8,7,6,4],
    [16,15,14,13,12,11,9,7,6,5,4],
    [15,14,13,12,11,10,8,7,6,5,4],
    [13,12,11,10,9,8,7,6,5,5,3],
    [11,10,9,8,8,7,7,6,5,5,3],
    [10,9,8,7,7,7,6,5,5,4,2],
    [9,8,8,7,7,6,6,5,4,3,2],
  ],
  "0.40": [
    [26,24,22,20,18,17,15,13,11,8,7],
    [24,22,20,18,17,16,14,12,10,8,6],
    [23,21,19,17,16,15,13,11,9,7,5],
    [21,19,17,16,15,14,12,10,9,7,5],
    [19,17,16,15,14,13,11,9,8,6,5],
    [17,16,15,14,13,12,10,9,7,6,4],
    [15,14,13,12,11,10,9,8,6,5,4],
    [13,12,11,10,10,9,8,7,6,5,4],
    [12,11,10,9,9,8,7,6,5,5,3],
    [11,10,9,8,8,7,6,5,5,4,3],
  ],
  "0.50": [
    [30,28,26,24,22,20,18,17,15,12,9],
    [28,26,24,23,21,19,17,16,14,11,8],
    [26,24,23,22,20,18,16,15,13,10,7],
    [24,22,21,20,19,17,15,14,12,9,7],
    [22,20,19,18,17,16,14,13,11,8,7],
    [20,18,17,16,15,14,13,12,10,8,6],
    [18,17,16,15,14,13,12,11,9,7,6],
    [16,15,14,13,12,11,10,9,8,6,6],
    [14,13,12,11,11,10,9,8,7,6,5],
    [13,12,11,10,10,9,8,7,6,5,4],
  ],
  "0.70": [
    [43,40,37,34,31,26,22,20,18,16,10],
    [40,37,35,32,29,24,20,18,16,15,9],
    [37,35,33,30,27,22,18,16,15,14,9],
    [34,32,30,28,25,21,17,15,15,14,8],
    [31,29,27,25,23,19,16,15,14,13,8],
    [29,27,25,23,20,18,15,14,13,12,8],
    [24,23,21,19,17,16,15,14,12,11,7],
    [20,19,18,17,16,15,14,13,11,10,7],
    [18,17,16,16,15,14,13,12,10,8,6],
    [16,15,14,14,13,12,11,10,8,7,5],
  ],
  "0.90": [
    [62,58,52,48,41,34,30,27,24,18,11],
    [59,52,48,45,39,32,28,25,23,17,10],
    [52,49,46,43,37,30,26,23,22,16,10],
    [49,47,44,41,35,29,24,22,21,16,9],
    [46,43,40,37,32,27,23,21,20,15,9],
    [39,37,35,32,29,25,21,19,18,14,9],
    [34,32,30,28,25,22,19,17,16,13,8],
    [28,26,24,22,21,19,17,15,14,12,8],
    [22,21,20,18,17,16,15,14,13,10,7],
    [19,18,17,16,15,14,13,12,11,9,7],
  ],
  "1.00": [
    [93,82,76,67,57,46,39,35,31,21,13],
    [82,75,69,62,54,43,37,33,29,20,12],
    [74,68,64,58,51,40,35,31,28,20,11],
    [66,62,58,54,48,38,33,29,26,19,10],
    [56,52,49,46,42,36,31,27,24,18,10],
    [47,44,42,39,37,32,28,24,22,17,10],
    [40,38,36,34,32,29,25,22,19,15,9],
    [34,32,30,28,26,24,22,19,17,14,9],
    [29,27,25,23,22,20,19,18,16,12,9],
    [25,23,21,20,19,18,17,16,13,10,8],
  ],
  "1.50": [
    [141,132,125,116,99,81,67,59,51,27,15],
    [132,124,116,108,93,76,63,55,48,26,14],
    [123,115,108,102,88,72,60,51,45,25,13],
    [109,105,100,93,82,67,56,48,42,24,12],
    [92,88,84,79,71,62,52,45,39,23,11],
    [79,75,72,68,63,56,48,42,36,22,11],
    [64,61,58,55,52,48,44,38,33,20,11],
    [49,47,45,43,41,39,37,33,29,18,10],
    [41,39,37,36,34,32,30,28,26,16,10],
    [35,33,32,31,29,27,25,24,22,15,10],
  ],
  "2.00": [
    [215,200,185,175,160,135,103,82,69,30,16],
    [200,185,170,160,150,125,96,78,64,29,15],
    [185,170,160,150,140,117,91,74,59,28,14],
    [170,160,150,140,130,107,86,70,55,27,13],
    [135,125,120,115,110,99,82,64,51,25,12],
    [108,104,99,95,90,85,75,57,48,24,12],
    [88,84,81,77,74,70,63,51,45,22,12],
    [70,66,63,60,58,55,51,43,37,21,11],
    [54,51,49,47,45,43,41,36,33,19,11],
    [45,42,40,38,36,35,33,29,27,18,10],
  ],
  "3.00": [
    [420,355,325,300,270,230,180,122,86,36,17],
    [365,325,295,275,250,215,170,112,80,33,16],
    [325,295,270,250,230,200,160,104,74,30,15],
    [290,265,245,225,210,185,150,95,67,29,15],
    [240,225,210,195,185,165,140,88,62,27,14],
    [195,185,175,165,155,145,125,81,57,26,14],
    [154,142,135,127,121,111,102,71,54,25,13],
    [119,111,105,100,94,88,82,61,50,24,13],
    [89,83,79,75,71,66,62,53,44,23,12],
    [67,63,60,57,54,49,46,41,36,21,11],
  ],
  "4.00": [
    [535,460,435,405,375,280,210,137,92,39,19],
    [460,420,400,375,345,265,200,129,88,37,17],
    [420,390,370,345,315,250,190,119,82,35,16],
    [375,340,320,300,275,235,180,109,77,32,16],
    [305,285,270,255,235,205,170,103,72,29,15],
    [250,235,220,205,190,175,150,95,66,28,15],
    [195,185,175,165,155,145,125,81,61,26,14],
    [158,148,139,132,123,115,105,70,56,25,14],
    [113,106,100,95,90,84,77,58,48,24,13],
    [81,77,74,71,68,64,61,47,39,22,12],
  ],
  "5.00": [
    [750,635,600,570,490,375,270,146,105,43,20],
    [630,580,550,525,455,350,250,139,95,40,18],
    [565,535,510,485,430,320,235,129,89,38,17],
    [500,470,445,425,365,295,220,124,84,36,17],
    [420,385,365,335,300,250,205,118,81,33,16],
    [325,300,275,255,235,210,180,107,77,30,16],
    [250,230,215,200,185,175,160,97,70,28,15],
    [195,185,175,165,155,145,135,88,65,27,15],
    [150,140,135,130,125,120,110,71,56,24,14],
    [115,110,105,95,90,85,80,61,46,23,13],
  ],
  "10.00": [
    [1320,1075,990,920,795,575,410,205,124,53,23],
    [1070,965,905,835,725,535,390,195,117,50,22],
    [945,885,835,765,665,495,365,185,111,48,21],
    [790,745,695,650,575,460,340,170,106,46,20],
    [655,610,570,530,465,395,305,160,101,44,19],
    [510,475,440,405,370,330,260,150,97,42,18],
    [395,370,345,315,285,255,220,135,91,40,17],
    [315,295,275,250,230,210,185,120,86,38,16],
    [230,215,205,190,175,160,140,105,77,36,16],
    [175,165,155,145,135,125,115,90,64,33,15],
  ],
};

const SEED_DATE = "2026-06-19";

// ─── Google Drive helpers ─────────────────────────────────────────────────────

const DRIVE_FOLDER_ID = "152rXtP8ioZ3lcsrsmQJ9w9qpA0ApgLEY";

/**
 * Creates a signed JWT and exchanges it for a Google OAuth2 access token.
 * Uses only the Node.js built-in crypto module (no npm packages required).
 * @param {object} sa  Parsed service account JSON
 * @returns {Promise<string>} access_token
 */
async function getGoogleAccessToken(sa) {
  const { createSign } = await import("node:crypto");

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  ).toString("base64url");

  const signingInput = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signingInput);
  sign.end();
  const privateKey = sa.private_key.replace(/\\n/g, "\n");
  const sig = sign.sign(privateKey, "base64url");
  const jwt = `${signingInput}.${sig}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Google token exchange failed: ${tokenRes.status} ${err}`);
  }
  const { access_token } = await tokenRes.json();
  return access_token;
}

/**
 * Lists files in the Rapnet Drive folder and returns metadata.
 */
async function listDriveFiles(token) {
  const url =
    `https://www.googleapis.com/drive/v3/files` +
    `?q=${encodeURIComponent(`'${DRIVE_FOLDER_ID}' in parents and trashed=false`)}` +
    `&fields=files(id,name,mimeType,modifiedTime)` +
    `&orderBy=modifiedTime+desc` +
    `&pageSize=50`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive list failed: ${res.status} ${await res.text()}`);
  const { files } = await res.json();
  return files || [];
}

/**
 * Downloads a file's text content from Drive.
 * For PDFs, uses the export endpoint to get plain text; for Google Docs uses export too.
 */
async function readDriveFile(token, fileId, mimeType) {
  // PDFs and binary files: export as plain text via Drive export
  const isGoogleDoc = mimeType === "application/vnd.google-apps.document";
  let url;
  if (isGoogleDoc) {
    url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`;
  } else {
    // For PDFs, attempt the export endpoint first; fall back to alt=media
    url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`;
  }
  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok && !isGoogleDoc) {
    // export not supported for binary files — download raw
    url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }
  if (!res.ok) throw new Error(`Drive download failed: ${res.status} ${await res.text()}`);
  return await res.text();
}

// ─── PDF parsing ──────────────────────────────────────────────────────────────

/**
 * Extracts all integers from text (Rapaport prices are whole numbers).
 * Returns them as a flat array in order of appearance.
 */
function extractNumbers(text) {
  const nums = [];
  // Match standalone integers (not part of decimals in ranges like "1.00-1.49")
  // We want price values which are plain integers
  const matches = text.matchAll(/(?<![.\d])(\d+)(?![.\d])/g);
  for (const m of matches) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n <= 99999) nums.push(n);
  }
  return nums;
}

/**
 * Groups a flat array of numbers into 10×11 blocks (110 numbers each).
 * Each block represents one weight range.
 * Returns an object keyed by WEIGHT_RANGES labels.
 */
function groupIntoTables(numbers) {
  const BLOCK = 110; // 10 clarity rows × 11 color columns
  const tables = {};
  let offset = 0;
  for (const range of WEIGHT_RANGES) {
    if (offset + BLOCK > numbers.length) break;
    const block = numbers.slice(offset, offset + BLOCK);
    const rows = [];
    for (let r = 0; r < 10; r++) {
      rows.push(block.slice(r * 11, r * 11 + 11));
    }
    tables[range] = rows;
    offset += BLOCK;
  }
  return tables;
}

/**
 * Attempts to parse price tables from PDF text.
 * Returns null if there are not enough numbers to form at least one table.
 */
function parsePdfTables(text) {
  const numbers = extractNumbers(text);
  if (numbers.length < 110) return null;
  return groupIntoTables(numbers);
}

/**
 * Extracts the publication date from the PDF text.
 * Rapaport PDFs typically include a date line like "June 19, 2026".
 */
function extractDate(text) {
  // Patterns: "June 19, 2026" or "19 June 2026" or "06/19/2026"
  const monthNames = "January|February|March|April|May|June|July|August|September|October|November|December";
  const patterns = [
    new RegExp(`(${monthNames})\\s+(\\d{1,2}),?\\s+(20\\d{2})`),
    new RegExp(`(\\d{1,2})\\s+(${monthNames})\\s+(20\\d{2})`),
    /(\d{1,2})\/(\d{1,2})\/(20\d{2})/,
  ];
  const monthMap = {
    January:"01",February:"02",March:"03",April:"04",May:"05",June:"06",
    July:"07",August:"08",September:"09",October:"10",November:"11",December:"12",
  };
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      if (m[1] in monthMap) return `${m[3]}-${monthMap[m[1]]}-${m[2].padStart(2,"0")}`;
      if (m[2] in monthMap) return `${m[3]}-${monthMap[m[2]]}-${m[1].padStart(2,"0")}`;
      // numeric m/d/yyyy
      return `${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
    }
  }
  return null;
}

// ─── Supabase upsert ──────────────────────────────────────────────────────────

async function upsertRapaportData(payload) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_KEY not configured");
  }
  const TENANT = "a1b2c3d4-0000-0000-0000-000000000001";
  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
  // Delete existing row first, then insert.
  // (unique index is on (tenant_id,field) only after migration 0052 — value column excluded
  // because large JSON exceeds btree 2704-byte limit)
  await fetch(
    `${SUPABASE_URL}/rest/v1/bullion_dropdowns?field=eq.rapaport_data&tenant_id=eq.${TENANT}`,
    { method: "DELETE", headers }
  );
  const res = await fetch(`${SUPABASE_URL}/rest/v1/bullion_dropdowns`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ field: "rapaport_data", value: JSON.stringify(payload), tenant_id: TENANT }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase insert failed: ${res.status} ${err}`);
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Only GET allowed
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const forceSeed = req.query.action === "seed";

  // Rapaport data is public pricing — no auth required on this endpoint.

  // ── Seed path ────────────────────────────────────────────────────────────────
  if (forceSeed) {
    const payload = {
      date: SEED_DATE,
      rounds_ranges: WEIGHT_RANGES,
      fancy_ranges: WEIGHT_RANGES,
      rounds: SEED_ROUNDS,
      fancy: SEED_FANCY,
      source: "seed",
      updated_at: new Date().toISOString(),
    };
    try {
      await upsertRapaportData(payload);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e) });
    }
    return res.status(200).json({
      ok: true,
      source: "seed",
      date: SEED_DATE,
      rounds_ranges: WEIGHT_RANGES.length,
      fancy_ranges: WEIGHT_RANGES.length,
      updated_at: payload.updated_at,
    });
  }

  // ── Drive access — Apps Script proxy (preferred) or Service Account ──────────
  const appsScriptUrl = process.env.RAPNET_APPS_SCRIPT_URL;
  const saEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!appsScriptUrl && !saEnv) {
    return res.status(501).json({
      ok: false,
      error: "No Drive access configured",
      hint: "Set RAPNET_APPS_SCRIPT_URL in Vercel env (easiest) or GOOGLE_SERVICE_ACCOUNT_JSON.",
    });
  }

  // Helper: fetch text content of a Drive file via Apps Script proxy
  const fetchViaAppsScript = async (fileId) => {
    const r = await fetch(`${appsScriptUrl}?action=file&id=${fileId}`, { redirect: "follow" });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "Apps Script file fetch failed");
    if (d.encoding === "base64") {
      const pdfParse = require("pdf-parse");
      const buf = Buffer.from(d.content, "base64");
      const parsed = await pdfParse(buf);
      return parsed.text;
    }
    return d.content;
  };

  // Resolve file list (Apps Script or Service Account)
  let files;
  let token = null;

  if (appsScriptUrl) {
    const r = await fetch(`${appsScriptUrl}?action=files`, { redirect: "follow" });
    const d = await r.json();
    if (!d.ok) return res.status(500).json({ ok: false, error: `Apps Script list failed: ${d.error}` });
    files = (d.files || []).map(f => ({ id: f.id, name: f.name, mimeType: "application/pdf", modifiedTime: f.modified }));
  } else {
    let sa;
    try {
      sa = JSON.parse(Buffer.from(saEnv, "base64").toString("utf8"));
    } catch {
      return res.status(500).json({ ok: false, error: "Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON" });
    }
    try {
      token = await getGoogleAccessToken(sa);
    } catch (e) {
      return res.status(500).json({ ok: false, error: `Google auth failed: ${String(e)}` });
    }
    try {
      files = await listDriveFiles(token);
    } catch (e) {
      return res.status(500).json({ ok: false, error: `Drive list failed: ${String(e)}` });
    }
  }

  // Find most recently modified Round and Fancy/Pear files
  const roundFile = files.find((f) => /round/i.test(f.name));
  const fancyFile = files.find((f) => /pear|fancy/i.test(f.name));

  if (!roundFile && !fancyFile) {
    return res.status(404).json({
      ok: false,
      error: "No Round or Pear/Fancy files found in the Rapnet folder",
      files: files.map((f) => f.name),
    });
  }

  let roundTables = null;
  let fancyTables = null;
  let detectedDate = null;
  const warnings = [];

  const readFile = (fileId, mimeType) =>
    appsScriptUrl
      ? fetchViaAppsScript(fileId)
      : readDriveFile(token, fileId, mimeType);

  if (roundFile) {
    try {
      const text = await readFile(roundFile.id, roundFile.mimeType);
      roundTables = parsePdfTables(text);
      if (!detectedDate) detectedDate = extractDate(text);
      if (!roundTables) warnings.push(`Round file parsed but not enough numbers found — using seed`);
    } catch (e) {
      warnings.push(`Round file read failed: ${String(e)} — using seed`);
    }
  }

  if (fancyFile) {
    try {
      const text = await readFile(fancyFile.id, fancyFile.mimeType);
      fancyTables = parsePdfTables(text);
      if (!detectedDate) detectedDate = extractDate(text);
      if (!fancyTables) warnings.push(`Fancy file parsed but not enough numbers found — using seed`);
    } catch (e) {
      warnings.push(`Fancy file read failed: ${String(e)} — using seed`);
    }
  }

  // Fall back to seed data for any shape that failed to parse
  const rounds = roundTables && Object.keys(roundTables).length >= 1 ? roundTables : SEED_ROUNDS;
  const fancy = fancyTables && Object.keys(fancyTables).length >= 1 ? fancyTables : SEED_FANCY;
  const source = (roundTables || fancyTables) ? "drive" : "seed";
  const date = detectedDate || SEED_DATE;

  const payload = {
    date,
    rounds_ranges: WEIGHT_RANGES,
    fancy_ranges: WEIGHT_RANGES,
    rounds,
    fancy,
    source,
    updated_at: new Date().toISOString(),
  };

  try {
    await upsertRapaportData(payload);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }

  return res.status(200).json({
    ok: true,
    source,
    date,
    rounds_file: roundFile?.name || null,
    fancy_file: fancyFile?.name || null,
    rounds_ranges: Object.keys(rounds).length,
    fancy_ranges: Object.keys(fancy).length,
    updated_at: payload.updated_at,
    ...(warnings.length ? { warnings } : {}),
  });
}
