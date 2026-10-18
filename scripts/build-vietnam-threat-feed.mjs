import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { domainToASCII, fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const inputPath = resolve(root, "data/vietnam-threats-source.json");
const outputPath = resolve(root, "web/data/vietnam-reported-sites.json");
const sourceData = JSON.parse(await readFile(inputPath, "utf8"));
const sources = new Map(sourceData.sources.map((source) => [source.id, source]));
const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;
const records = [];
const seen = new Set();

for (const record of sourceData.records) {
  const source = sources.get(record.sourceId);
  const domain = domainToASCII(String(record.domain || "").trim().toLowerCase().replace(/\.$/, ""));
  if (!source || source.kind !== record.kind || !["impersonation", "gambling_violation"].includes(record.kind)) {
    throw new Error(`Nguồn hoặc loại cảnh báo không hợp lệ: ${record.domain}`);
  }
  if (!domainPattern.test(domain)) throw new Error(`Hostname không hợp lệ: ${record.domain}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.reportedAt) || Number.isNaN(Date.parse(`${record.reportedAt}T00:00:00Z`))) {
    throw new Error(`Ngày báo cáo không hợp lệ: ${record.domain}`);
  }
  const key = `${record.kind}|${domain}|${record.sourceId}`;
  if (seen.has(key)) continue;
  seen.add(key);
  records.push({
    domain,
    kind: record.kind,
    target: String(record.target || "").trim() || undefined,
    reportedAt: record.reportedAt,
    sourceId: source.id,
    sourceName: source.name,
    sourceUrl: source.url,
    sourceEvidenceUrl: source.evidenceUrl || undefined,
    sourcePublishedAt: source.publishedAt
  });
}

records.sort((left, right) => left.domain.localeCompare(right.domain) || left.kind.localeCompare(right.kind));
const sourceCounts = new Map();
for (const record of records) sourceCounts.set(record.sourceId, (sourceCounts.get(record.sourceId) || 0) + 1);
const data = {
  updatedAt: new Date().toISOString(),
  recordCount: records.length,
  coverageNote: "Curated sample only; this feed does not contain the complete lists published by the cited authorities.",
  sources: sourceData.sources.map((source) => ({ ...source, recordCount: sourceCounts.get(source.id) || 0 })),
  records
};
await mkdir(resolve(root, "web/data"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Generated ${records.length} attributed Vietnam threat records at ${outputPath}`);
