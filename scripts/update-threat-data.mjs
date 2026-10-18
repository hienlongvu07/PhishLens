import { createHash } from "node:crypto";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const out = resolve(root, "web/data");
const gzipAsync = promisify(gzip);
const sources = {
  phishing: "https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt",
  license: "https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/LICENSE",
  confusables: "https://www.unicode.org/Public/18.0.0/security/confusables.txt"
};

async function get(url) {
  const response = await fetch(url, { headers: { "User-Agent": "PhishLens-threat-data-updater/1.0" } });
  if (!response.ok) throw new Error(`Không tải được nguồn dữ liệu (${response.status}): ${url}`);
  return response.text();
}

const [domainText, license, confusablesText] = await Promise.all(Object.values(sources).map(get));
const entries = [...new Set(domainText.split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter((line) => line && !line.startsWith("#")))].sort();
const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;
const domains = entries.filter((domain) => domainPattern.test(domain));
if (domains.length < 10_000 || domains.length < entries.length * 0.95) {
  throw new Error("Feed domain ACTIVE không đúng định dạng hoặc có quá ít mục; giữ nguyên dữ liệu cũ.");
}
if (domains.length !== entries.length) console.warn(`Bỏ qua ${entries.length - domains.length} dòng không phải tên miền hợp lệ.`);

const gzipped = await gzipAsync(`${domains.join("\n")}\n`, { level: 9, mtime: 0 });
const sha256 = createHash("sha256").update(gzipped).digest("hex");
const mappings = {};
let maxSourceLength = 1;
for (const line of confusablesText.split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const [source, target] = line.split(";").map((part) => part.trim());
  const sourceCodepoints = source?.split(/\s+/) || [];
  const targetCodepoints = target?.split(/\s+/) || [];
  if (!sourceCodepoints.length || !targetCodepoints.length) continue;
  const sourceText = String.fromCodePoint(...sourceCodepoints.map((point) => Number.parseInt(point, 16)));
  const replacement = String.fromCodePoint(...targetCodepoints.map((point) => Number.parseInt(point, 16)));
  mappings[sourceText] = replacement;
  maxSourceLength = Math.max(maxSourceLength, sourceCodepoints.length);
}

await mkdir(out, { recursive: true });
await writeFile(resolve(out, "phishing-domains.gzdata"), gzipped);
await writeFile(resolve(out, "phishing-domains.json"), `${JSON.stringify({
  source: "Phishing.Database",
  sourceUrl: "https://github.com/Phishing-Database/Phishing.Database",
  file: "phishing-domains-ACTIVE.txt",
  updatedAt: new Date().toISOString(),
  domainCount: domains.length,
  sha256
}, null, 2)}\n`);
await writeFile(resolve(out, "PHISHING-DATABASE-LICENSE.txt"), `${license.trim()}\n\nSource: ${sources.phishing}\nProject: https://github.com/Phishing-Database/Phishing.Database\n`);
await writeFile(resolve(root, "src/uts39-confusables.js"), `// Generated from Unicode UTS #39 18.0.0 confusables.txt. See web/data/UNICODE-DATA-NOTICE.txt.\nexport const UTS39_MAX_SOURCE_LENGTH = ${maxSourceLength};\nexport const UTS39_CONFUSABLES = Object.freeze(${JSON.stringify(mappings)});\n`);
await writeFile(resolve(out, "UNICODE-DATA-NOTICE.txt"), "Unicode Security Mechanisms (UTS #39), confusables.txt, version 18.0.0. Copyright © 2026 Unicode, Inc. Data source: https://www.unicode.org/Public/18.0.0/security/confusables.txt. Terms of use: https://www.unicode.org/terms_of_use.html. Comparison mappings are used only to identify possible visual confusability; they are not used to normalize or display domain names.\n");
console.log(`Updated ${domains.length.toLocaleString("en-US")} active domains (${(gzipped.length / 1_000_000).toFixed(2)} MB gzip) and ${Object.keys(mappings).length} Unicode mappings.`);
console.log(`SHA-256: ${sha256}`);
