import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

let version;
try {
  version = execSync("git rev-parse HEAD").toString().trim();
} catch {
  version = String(Date.now());
}

writeFileSync("public/version.json", JSON.stringify({ version }));
writeFileSync("src/buildVersion.generated.js", `export const BUILD_VERSION = ${JSON.stringify(version)};\n`);
console.log("build version:", version);
