import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stories } from "../web/stories.js";

const home = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
const privacy = await readFile(new URL("../web/privacy.html", import.meta.url), "utf8");
const site = await readFile(new URL("../web/site.js", import.meta.url), "utf8");

test("HIBP link is official, attributed, and leaves email entry to the user", () => {
  assert.match(home, /href="https:\/\/haveibeenpwned\.com\/" target="_blank" rel="noopener noreferrer"/);
  assert.match(home, /Nguồn: <a[^>]*>Have I Been Pwned<\/a>/);
  assert.match(home, /PhishLens không nhận email hay kết quả/);
  assert.match(home, /Tự nhập email trên Have I Been Pwned/);
  assert.match(home, /không nhận email hay kết quả/);
  assert.match(home, /không cho biết ai đang truy cập hộp thư Gmail/);
  assert.doesNotMatch(home, /<input\b[^>]*(?:type="email"|name="email")/i);
  assert.doesNotMatch(site, /haveibeenpwned\.com|hibp/i);
  assert.match(privacy, /không gửi email tới HIBP thay bạn/);
  assert.match(privacy, /không nhận kết quả và không lưu email/);
});

test("privacy policy explains manual third-party checks", () => {
  assert.match(privacy, /scam\.vn\/check-website/);
  assert.match(privacy, /scamadviser\.com\/check-website/);
  assert.doesNotMatch(privacy, /PhishTank|phishtank/);
});

test("URL lookup and internal report confirmation remain on the homepage", () => {
  assert.match(home, /id="lookup-form"/);
  assert.match(home, /id="lookup-input"/);
  assert.match(home, /id="lookup-result" class="lookup-result" aria-live="polite"/);
  assert.match(site, /fetch\(`\/api\/lookup\?url=/);
  assert.match(home, /id="report-form"/);
  assert.match(home, /id="report-confirm-dialog"/);
  assert.match(site, /fetch\("\/api\/reports"/);
  assert.match(site, /reportDialog\.showModal\(\)/);
  assert.match(home, /URL đầy đủ, gồm query và fragment, sẽ được gửi đến nhóm/);
  assert.match(home, /Query đôi khi chứa mã phiên hoặc dữ liệu riêng tư/);
});

test("story guide contains four clearly labeled, sourced example scenarios", async () => {
  assert.match(home, /<h1><span>Bạn biết những<\/span><span>hình thức <em>lừa đảo<\/em><\/span><span>nào không\?<\/span><\/h1>/);
  assert.match(home, /id="story-grid"/);
  assert.match(site, /Tình huống minh họa/);
  assert.equal(stories.length, 4);
  assert.deepEqual(stories.map(({ id }) => id), ["bank", "job", "official", "investment"]);
  for (const story of stories) {
    assert.ok(story.title && story.setup && story.turningPoint && story.takeaway && story.action);
    assert.match(story.sourceUrl, /^https:\/\//);
    assert.match(story.art, /^\/images\/story-[a-z]+\.svg$/);
    const svg = await readFile(new URL(`../web${story.art}`, import.meta.url), "utf8");
    assert.match(svg, /<svg\b[^>]*viewBox=/);
  }
  assert.match(site, /story\.sourceUrl/);
  assert.match(site, /noopener noreferrer/);
});

test("editorial home preserves accessibility and compact survey context", () => {
  assert.match(home, /class="skip-link" href="#noi-dung"/);
  assert.match(home, /aria-label="Điều hướng chính"/);
  assert.match(home, /alt="Minh họa một người đang dừng lại/);
  assert.match(home, /Khảo sát tự báo cáo, n = 120/);
  assert.match(home, /không phải bằng chứng về hiệu quả PhishLens/);
  assert.match(home, /Chưa có dữ liệu không có nghĩa website an toàn/);
});

test("extension spotlight links to the published Chrome Web Store listing", () => {
  assert.match(home, /<section class="extension-feature" aria-labelledby="extension-heading">/);
  assert.match(home, /<a class="button extension-button is-install" href="https:\/\/chromewebstore\.google\.com\/detail\/phishlens\/ompglgjccagiadkbeeneonjiooojincn" target="_blank" rel="noopener noreferrer"/);
  assert.match(home, /class="release-pill"><span aria-hidden="true">●<\/span> Chrome Web Store<\/span>/);
  assert.match(home, /Mở trang tiện ích trên Chrome Web Store để xem thông tin và cài đặt/);
  assert.match(home, /class="survey-number"><strong>94<\/strong><span class="survey-total">\/120<\/span>/);
  assert.match(home, /class="survey-meter" aria-hidden="true"/);
  assert.match(home, /class="survey-facts"><p><b>86<\/b><span>/);
});

test("new motion layers retain reduced-motion and scroll-reveal support", async () => {
  const css = await readFile(new URL("../web/site.css", import.meta.url), "utf8");
  assert.match(site, /\.extension-copy, \.extension-visual/);
  assert.match(css, /@keyframes window-glint/);
  assert.match(css, /@keyframes popup-hover/);
  assert.match(css, /@keyframes meter-fill/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /\.browser-page::after[^}]*animation:\s*window-glint/);
  assert.match(css, /\.extension-popup \{ animation:\s*none !important/);
  assert.match(css, /\.survey-main \.survey-number strong[^}]*font-size:clamp\(64px/);
});

test("public landing-page text sizes are readable on desktop and mobile", async () => {
  const css = await readFile(new URL("../web/site.css", import.meta.url), "utf8");
  assert.match(css, /\.hero-intro\s*\{[^}]*font-size:18px/);
  assert.match(css, /\.tool-copy[^}]*font-size:15px/);
  assert.match(css, /\.story-text, \.story-turn span[^}]*font-size:15px/);
  assert.match(css, /\.extension-points li[^}]*font-size:14px/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*?\.hero-intro\s*\{\s*font-size:16px/);
  assert.match(css, /@media\(max-width:420px\)[\s\S]*?\.hero-intro\s*\{\s*font-size:15px/);
});

test("editorial illustrations are local SVGs with layered motion and reduced-motion fallbacks", async () => {
  const assets = [
    "/images/hero-pause.svg",
    "/images/tool-domain.svg",
    "/images/tool-email.svg",
    "/images/verification-path.svg",
    ...stories.map(({ art }) => art)
  ];
  assert.match(home, /class="tool-illustration" src="\/images\/tool-domain\.svg"/);
  assert.match(home, /class="tool-illustration" src="\/images\/tool-email\.svg"/);
  assert.match(home, /class="verification-illustration" src="\/images\/verification-path\.svg"/);
  for (const asset of new Set(assets)) {
    const svg = await readFile(new URL(`../web${asset}`, import.meta.url), "utf8");
    assert.match(svg, /<svg\b[^>]*viewBox=/, `${asset} has a viewBox`);
    assert.match(svg, /<style>/, `${asset} uses local vector styling`);
    assert.match(svg, /animation:/, `${asset} includes an animated layer`);
    assert.match(svg, /prefers-reduced-motion:\s*reduce/, `${asset} respects reduced motion`);
    assert.doesNotMatch(svg, /\b(?:href|src)=["']https?:\/\//i, `${asset} has no remote dependencies`);
  }
});
