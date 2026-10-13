import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, copyFile, writeFile, cp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "archiver";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Map(process.argv.slice(2).filter((item) => item.startsWith("--")).map((item) => {
  const [key, ...value] = item.slice(2).split("="); return [key, value.join("=")];
}));
const siteUrl = args.get("site-url") || process.env.PHISHLENS_SITE_URL;
if (!siteUrl) throw new Error("Dùng --site-url=https://<site>.netlify.app hoặc đặt PHISHLENS_SITE_URL.");
const parsed = new URL(siteUrl);
if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
  throw new Error("Site URL phải là origin HTTPS, ví dụ https://phishlens.netlify.app");
}

const output = resolve(root, args.get("out") || "dist");
const extensionDir = resolve(output, "extension");
await rm(extensionDir, { recursive: true, force: true });
await mkdir(extensionDir, { recursive: true });
await cp(resolve(root, "icons"), resolve(extensionDir, "icons"), { recursive: true });
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
manifest.host_permissions = [`${parsed.origin}/*`];
manifest.description = "Giải thích dấu hiệu đáng chú ý trong URL và hỗ trợ gửi báo cáo sau khi bạn xác nhận.";
await writeFile(resolve(extensionDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
for (const file of ["popup.html", "popup.css", "popup.js"]) await copyFile(resolve(root, file), resolve(extensionDir, file));
await mkdir(resolve(extensionDir, "src"), { recursive: true });
await copyFile(resolve(root, "src/analyzer.js"), resolve(extensionDir, "src/analyzer.js"));

const zipPath = resolve(output, "phishlens-extension.zip");
await mkdir(dirname(zipPath), { recursive: true });
await new Promise((resolvePromise, reject) => {
  const stream = createWriteStream(zipPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  stream.on("close", resolvePromise);
  stream.on("error", reject);
  archive.on("error", reject);
  archive.pipe(stream);
  archive.directory(extensionDir, false);
  archive.finalize().catch(reject);
});
console.log(`Extension package: ${zipPath}`);
console.log(`Host permission: ${parsed.origin}/*`);
