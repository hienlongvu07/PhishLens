const PHISHING_FEED_URL = "/data/phishing-domains.gzdata";
const VIETNAM_FEED_URL = "/data/vietnam-reported-sites.json";
const TWELVE_MONTHS = 12;

let phishingDomainsPromise;
let vietnamRecordsPromise;

export function hostnameMatchesFeed(hostname, domains) {
  if (typeof hostname !== "string" || !Array.isArray(domains)) return false;
  const host = hostname.toLowerCase().replace(/\.$/, "");
  let start = 0;
  while (start < host.length) {
    const candidate = host.slice(start);
    let low = 0, high = domains.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      if (domains[middle] === candidate) return true;
      if (domains[middle] < candidate) low = middle + 1;
      else high = middle - 1;
    }
    start = host.indexOf(".", start) + 1;
    if (start === 0) break;
  }
  return false;
}

export function vietnamReportMatches(hostname, records, now = Date.now()) {
  if (!Array.isArray(records)) return [];
  const matched = records.filter((record) => hostnameMatchesFeed(hostname, [record.domain]));
  const byKind = new Map();
  for (const record of matched) {
    const previous = byKind.get(record.kind);
    if (!previous || Date.parse(record.reportedAt) > Date.parse(previous.reportedAt)) byKind.set(record.kind, record);
  }
  return [...byKind.values()].map((record) => {
    const publishedAt = Date.parse(`${record.reportedAt}T00:00:00Z`);
    const expiry = new Date(publishedAt);
    expiry.setUTCMonth(expiry.getUTCMonth() + TWELVE_MONTHS);
    return { ...record, historical: !Number.isFinite(publishedAt) || now > expiry.getTime() };
  });
}

async function loadPhishingDomains() {
  if (!phishingDomainsPromise) phishingDomainsPromise = (async () => {
    const response = await fetch(PHISHING_FEED_URL, { cache: "force-cache", credentials: "omit" });
    if (!response.ok || !response.body || typeof DecompressionStream !== "function") throw new Error("feed_unavailable");
    const text = await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).text();
    const domains = text.trim().split("\n").filter(Boolean);
    if (!domains.length) throw new Error("feed_empty");
    return domains;
  })().catch((error) => { phishingDomainsPromise = null; throw error; });
  return phishingDomainsPromise;
}

async function loadVietnamRecords() {
  if (!vietnamRecordsPromise) vietnamRecordsPromise = fetch(VIETNAM_FEED_URL, { cache: "force-cache", credentials: "omit" })
    .then((response) => { if (!response.ok) throw new Error("feed_unavailable"); return response.json(); })
    .then((data) => { if (!Array.isArray(data.records)) throw new Error("feed_invalid"); return data.records; })
    .catch((error) => { vietnamRecordsPromise = null; throw error; });
  return vietnamRecordsPromise;
}

export async function lookupPublicThreatData(hostname, now = Date.now()) {
  const [phishing, vietnam] = await Promise.allSettled([loadPhishingDomains(), loadVietnamRecords()]);
  return {
    phishingStatus: phishing.status === "fulfilled" ? "available" : "unavailable",
    phishingMatch: phishing.status === "fulfilled" && hostnameMatchesFeed(hostname, phishing.value),
    vietnamStatus: vietnam.status === "fulfilled" ? "available" : "unavailable",
    vietnamMatches: vietnam.status === "fulfilled" ? vietnamReportMatches(hostname, vietnam.value, now) : []
  };
}
