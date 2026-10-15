import { loadStats } from "./community-shared.js";
const stats = document.querySelector("#community-stats"); loadStats(stats);
document.querySelectorAll("[data-event]").forEach((link) => link.addEventListener("click", () => fetch("/api/community/events", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({eventType:link.dataset.event,utmSource:new URL(location.href).searchParams.get("utm_source")||"community"}), keepalive:true })));
