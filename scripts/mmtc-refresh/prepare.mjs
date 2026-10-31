// node scripts/mmtc-refresh/prepare.mjs [--dry]
// Fills the auth token (HMAC of CRM_SECRET from .env.local) into runner.js and
// writes the result to <tmp>/mmtc_runner.js. Prints that path. The token never
// leaves this machine except in the POST to ssjbots.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(here, "../../.env.local"), "utf8");
const secret = (env.match(/^CRM_SECRET=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, "");
if (!secret) throw new Error("CRM_SECRET missing in .env.local");
const token = crypto.createHmac("sha256", secret).update("mmtc-refresh").digest("hex").slice(0, 32);
const dry = process.argv.includes("--dry") ? "1" : "0";
const src = fs.readFileSync(path.join(here, "runner.js"), "utf8").replace("__TOKEN__", token).replace('"__DRY__"', `"${dry}"`);
const out = path.join(os.tmpdir(), "mmtc_runner.js");
fs.writeFileSync(out, src);
console.log(out);
