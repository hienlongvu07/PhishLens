export async function communityApi(path, options = {}) {
  const response = await fetch(`/api/community/${path}`, { ...options, cache: "no-store", headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
export async function loadConfig() { return communityApi("config"); }
export function mountTurnstile(config, slot, onToken) {
  if (!config.turnstileSiteKey) { slot.textContent = "Xác minh hiện chưa được cấu hình."; return { reset() {}, unavailable: true }; }
  let widgetId = null; let ready = false;
  const render = () => { if (ready && widgetId === null) widgetId = window.turnstile.render(slot, { sitekey: config.turnstileSiteKey, callback: onToken, "expired-callback": () => onToken(""), "error-callback": () => onToken("") }); };
  if (window.turnstile) { ready = true; render(); }
  else { window.__phishLensTurnstileReady = () => { ready = true; render(); }; const script = document.createElement("script"); script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__phishLensTurnstileReady&render=explicit"; script.async = true; script.defer = true; script.onerror = () => { slot.textContent = "Không tải được xác minh. Hãy thử lại sau."; }; document.head.append(script); }
  return { reset() { if (widgetId !== null) window.turnstile.reset(widgetId); }, get unavailable() { return false; } };
}
export function campaignSource() { const value = new URL(location.href).searchParams.get("utm_source") || "direct"; return value.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 80) || "direct"; }
export function recordEvent(eventType) { return communityApi("events", { method: "POST", keepalive: true, body: JSON.stringify({ eventType, utmSource: campaignSource() }) }).catch(() => {}); }
export async function loadStats(target) { try { const data = await communityApi("stats"); const keys={challengeStarts:"challengeStarted",challengeCompletions:"challengeCompleted",betaResponses:"betaFeedback",campaignViews:"campaignViews"}; for (const node of target.querySelectorAll("[data-stat]")) node.textContent = String(data[keys[node.dataset.stat]] ?? 0); } catch { target.textContent = "Chưa tải được thống kê."; } }
export function addFooter() { const footer = document.createElement("footer"); footer.className = "community-footer"; footer.innerHTML = '<a href="/community.html">PhishLens Community</a> · <a href="/privacy.html">Quyền riêng tư</a> · Ghi nhận hoạt động dưới dạng lượt, không định danh người dùng.'; document.body.append(footer); }
export function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char])); }
