import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { analyzeUrl, applyThreatFeed, applyVietnamThreatRecords, hostnameMatchesThreatFeed, matchVietnamThreatRecords, safetyBand, SIGNAL_RISK_POINTS } from "../src/analyzer.js";

test("HTTPS without detected signals receives a high heuristic safety score, not a guarantee", () => {
  const result = analyzeUrl("https://example.com/about");
  assert.equal(result.level, "Ít dấu hiệu đáng ngờ được phát hiện");
  assert.equal(result.riskScore, 0);
  assert.equal(result.safetyScore, 100);
  assert.equal(result.band, "green");
  assert.equal(result.findings.length, 0);
  assert.equal(result.parts.protocol, "HTTPS");
  assert.match(result.parts.path, /about/);
});

test("HTTP subtracts points and keeps user advice", () => {
  const result = analyzeUrl("http://example.com");
  assert.equal(result.safetyScore, 88);
  assert.equal(result.band, "green");
  assert.match(result.findings.join(" "), /HTTP/);
  assert.match(result.advice.join(" "), /OTP/);
});

test("shorteners and ASCII brand typos are explained", () => {
  assert.match(analyzeUrl("https://bit.ly/demo").findings.join(" "), /rút gọn|che khuất/);
  const typo = analyzeUrl("https://paypa1.com");
  assert.match(typo.findings.join(" "), /paypal/);
  assert.equal(typo.scoreBreakdown.find(({ code }) => code === "lookalike_brand").points, 25);
});

test("rejects malformed URLs and unsupported schemes", () => {
  assert.equal(analyzeUrl("không phải URL").valid, false);
  assert.equal(analyzeUrl("file:///tmp/demo").valid, false);
});

test("mixed-script homoglyphs match a supported brand and display the actual character", () => {
  const legitimate = analyzeUrl("https://amazon.com");
  const spoofed = analyzeUrl("https://аmazon.com");
  assert.equal(legitimate.safetyScore, 100);
  assert.equal(spoofed.hostname, "аmazon.com");
  assert.equal(spoofed.band, "red");
  assert.equal(spoofed.safetyScore, 15);
  assert.match(spoofed.findings.join(" "), /U\+0430/);
  assert.equal(spoofed.scoreBreakdown.find(({ code }) => code === "lookalike_brand").points, 60);
});

test("ordinary non-Latin IDN punycode is displayed but is not penalized by itself", () => {
  const result = analyzeUrl("https://xn--e1afmkfd.xn--p1ai");
  assert.equal(result.hostname, "пример.рф");
  assert.equal(result.safetyScore, 100);
  assert.equal(result.scoreBreakdown.length, 0);
});

test("URL parts preserve port, query and fragment for the user-facing structure tab", () => {
  const result = analyzeUrl("https://example.com:8443/path?q=demo#section");
  assert.equal(result.parts.port, "8443");
  assert.equal(result.parts.query, "q=demo");
  assert.equal(result.parts.fragment, "section");
});

test("score bands are green 76–100, yellow 41–75 and red 0–40", () => {
  assert.equal(SIGNAL_RISK_POINTS.lookalike_brand, 25);
  assert.equal(safetyBand(76), "green");
  assert.equal(safetyBand(75), "yellow");
  assert.equal(safetyBand(41), "yellow");
  assert.equal(safetyBand(40), "red");
  assert.equal(safetyBand(null), "unavailable");
  assert.equal(safetyBand(100 - 24), "green");
  assert.equal(safetyBand(100 - 25), "yellow");
  assert.equal(safetyBand(100 - 59), "yellow");
  assert.equal(safetyBand(100 - 60), "red");
  const manySignals = analyzeUrl("http://user@а.longlonglong-longlonglong.a.b.c.d.paypa1.com:8443/%2f/login");
  assert.equal(manySignals.riskScore, 94);
  const capped = applyThreatFeed(manySignals, { status: "match", matched: true });
  assert.equal(capped.riskScore, 100);
  assert.equal(capped.safetyScore, 0);
  assert.equal(capped.band, "red");
  assert.equal(analyzeUrl("not-url").safetyScore, null);
});

test("feed match subtracts 80 points and a no-match keeps the local score unchanged", () => {
  const base = analyzeUrl("https://example.com");
  const matched = applyThreatFeed(base, { status: "match", matched: true, updatedAt: "2026-10-18T00:00:00Z" });
  const clear = applyThreatFeed(base, { status: "not-found", matched: false, updatedAt: "2026-10-18T00:00:00Z" });
  assert.equal(matched.safetyScore, 20);
  assert.equal(matched.band, "red");
  assert.equal(matched.scoreBreakdown.at(-1).code, "threat_feed");
  assert.equal(clear.safetyScore, 100);
  assert.equal(clear.band, "green");
  assert.equal(clear.findings.length, 0);
  const unavailable = applyThreatFeed(base, { status: "unavailable", matched: false });
  assert.equal(unavailable.safetyScore, base.safetyScore);
  assert.match(unavailable.feedStatus, /unavailable/);
});

test("feed hostname matching covers listed host and subdomains without suffix false matches", () => {
  const feed = ["bad.example", "phishing.test"];
  assert.equal(hostnameMatchesThreatFeed("bad.example", feed), true);
  assert.equal(hostnameMatchesThreatFeed("login.bad.example", feed), true);
  assert.equal(hostnameMatchesThreatFeed("notbad.example", feed), false);
  assert.equal(hostnameMatchesThreatFeed("phishing.test.example", feed), false);
});

test("Vietnam reports match root domains and subdomains but not lookalike suffixes", () => {
  const feed = { records: [{ domain: "fake.gov.vn", kind: "impersonation", reportedAt: "2025-11-16", sourceName: "Cơ quan", sourceUrl: "https://example.test/report" }] };
  assert.equal(matchVietnamThreatRecords("fake.gov.vn", feed, Date.parse("2026-10-18T00:00:00Z")).length, 1);
  assert.equal(matchVietnamThreatRecords("login.fake.gov.vn", feed, Date.parse("2026-10-18T00:00:00Z")).length, 1);
  assert.equal(matchVietnamThreatRecords("notfake.gov.vn", feed, Date.parse("2026-10-18T00:00:00Z")).length, 0);
});

test("Vietnam impersonation reports deduct 80 only while within 12 months", () => {
  const now = Date.parse("2026-10-18T00:00:00Z");
  const feed = { records: [
    { domain: "recent.test", kind: "impersonation", target: "Bộ mẫu", reportedAt: "2025-11-16", sourceName: "Nguồn mẫu", sourceUrl: "https://example.test/report" },
    { domain: "old.test", kind: "impersonation", target: "Cơ quan mẫu", reportedAt: "2024-11-16", sourceName: "Nguồn mẫu", sourceUrl: "https://example.test/report" },
    { domain: "gambling.test", kind: "gambling_violation", reportedAt: "2022-09-30", sourceName: "Cơ quan mẫu", sourceUrl: "https://example.test/list" }
  ] };
  const recent = applyVietnamThreatRecords(analyzeUrl("https://recent.test"), matchVietnamThreatRecords("recent.test", feed, now), "available", "2026-10-18T00:00:00Z");
  assert.equal(recent.safetyScore, 20);
  assert.equal(recent.scoreBreakdown.at(-1).code, "vietnam_impersonation");
  assert.ok(recent.findings.some((finding) => /Bộ mẫu/.test(finding)));

  const old = applyVietnamThreatRecords(analyzeUrl("https://old.test"), matchVietnamThreatRecords("old.test", feed, now));
  assert.equal(old.safetyScore, 100);
  assert.ok(old.vietnamThreatMatches[0].historical);
  assert.ok(old.findings.some((finding) => /quá 12 tháng/.test(finding)));

  const gambling = applyVietnamThreatRecords(analyzeUrl("https://gambling.test"), matchVietnamThreatRecords("gambling.test", feed, now));
  assert.equal(gambling.safetyScore, 100);
  assert.equal(gambling.scoreBreakdown.length, 0);
  assert.ok(gambling.findings.some((finding) => /không phải kết luận phishing/.test(finding)));
});

test("unavailable Vietnam data leaves the local score unchanged", () => {
  const local = analyzeUrl("https://example.com");
  const result = applyVietnamThreatRecords(local, [], "unavailable");
  assert.equal(result.safetyScore, local.safetyScore);
  assert.equal(result.vietnamThreatStatus, "unavailable");
});

test("Vietnam static feed contains sourced, separated, explicitly partial records", async () => {
  const data = JSON.parse(await readFile(new URL("../web/data/vietnam-reported-sites.json", import.meta.url), "utf8"));
  assert.equal(data.recordCount, data.records.length);
  assert.equal(data.records.length, 80);
  assert.match(data.coverageNote, /does not contain the complete lists/i);
  assert.ok(data.records.some(({ kind }) => kind === "impersonation"));
  assert.ok(data.records.some(({ kind }) => kind === "gambling_violation"));
  for (const record of data.records) {
    assert.match(record.domain, /^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/);
    assert.match(record.sourceUrl, /^https:\/\//);
    assert.match(record.reportedAt, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.equal(data.records.some(({ sourceId }) => sourceId === "abei-gambling-2024"), false);
});

test("downloadable feed is gzip, sorted, attributed and consistent with metadata", async () => {
  const [compressed, metadataText, license, unicodeNotice] = await Promise.all([
    readFile(new URL("../web/data/phishing-domains.gzdata", import.meta.url)),
    readFile(new URL("../web/data/phishing-domains.json", import.meta.url), "utf8"),
    readFile(new URL("../web/data/PHISHING-DATABASE-LICENSE.txt", import.meta.url), "utf8"),
    readFile(new URL("../web/data/UNICODE-DATA-NOTICE.txt", import.meta.url), "utf8")
  ]);
  const metadata = JSON.parse(metadataText);
  const domains = gunzipSync(compressed).toString("utf8").trim().split("\n");
  const checksum = createHash("sha256").update(compressed).digest("hex");
  assert.equal(domains.length, metadata.domainCount);
  assert.equal(checksum, metadata.sha256);
  assert.ok(domains.length > 10_000);
  assert.deepEqual(domains, [...domains].sort());
  assert.match(license, /MIT License/);
  assert.match(unicodeNotice, /UTS #39/);
});

test("popup asks before AI fetch and sends only hostname plus signal codes", async () => {
  const popup = await readFile(new URL("../popup.js", import.meta.url), "utf8");
  const handler = popup.slice(popup.indexOf('$("#ai-analyze").addEventListener'), popup.indexOf('$("#report").addEventListener'));
  assert.ok(handler.indexOf("requestAiConsent(hostname)") < handler.indexOf("/api/analyze"));
  assert.match(handler, /if \(!approved\) return/);
  assert.match(handler, /JSON\.stringify\(\{ hostname, signalCodes \}\)/);
  assert.doesNotMatch(handler, /currentUrl|\.pathname|\.search|\.hash|\.cookie|innerText/);
});

test("popup scoring uses the static feed locally and retains manual third-party links", async () => {
  const popup = await readFile(new URL("../popup.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../popup.html", import.meta.url), "utf8");
  const privacy = await readFile(new URL("../web/privacy.html", import.meta.url), "utf8");
  assert.match(popup, /indexedDB/);
  assert.match(popup, /phishing-domains\.gzdata/);
  assert.doesNotMatch(popup, /fetch\([^\n]*canonicalHostname/);
  assert.match(html, /Điểm an toàn/);
  assert.match(html, /Phishing\.Database/);
  assert.match(html, /https:\/\/scam\.vn\/check-website/);
  assert.match(html, /https:\/\/www\.scamadviser\.com\/check-website/);
  assert.match(popup, /data\/vietnam-reported-sites\.json/);
  assert.match(popup, /https:\/\/tinnhiemmang\.vn\/website-lua-dao/);
  assert.doesNotMatch(popup, /tinnhiemmang\.vn[^\n]*(?:hostname|canonicalHostname|currentUrl)/);
  assert.match(privacy, /không đính kèm tên miền/);
});
