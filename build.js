// Production build for The KM.
//
// What it does:
//   1. Wipes dist/ and recreates it.
//   2. Copies EVERY public frontend file (html, css, js, images, manifest ...) into dist/.
//      (The old build.js only copied index.html, style.css and script.js, which is why
//       auto-key.css, neon.css, auto-admin.html, icons etc. went missing in production.)
//   3. Obfuscates script.js (same settings as before).
//   4. Verifies that every local file referenced by the HTML pages really exists in dist/.
//      If something is missing the build FAILS, so a broken site can never be deployed silently.
//
// Private folders (api/, lib/, supabase/) are never copied: they are only used by server.js.

const fs = require("fs");
const path = require("path");
const JavaScriptObfuscator = require("javascript-obfuscator");

const ROOT = __dirname;
const OUT = path.join(ROOT, "dist");

// Root-level files with these extensions are public frontend files.
const PUBLIC_EXT = new Set([
  ".html", ".css", ".js", ".json", ".png", ".jpg", ".jpeg", ".gif", ".svg",
  ".webp", ".ico", ".woff", ".woff2", ".ttf", ".xml"
]);

// Root-level files that must NEVER be published.
const PRIVATE_FILES = new Set([
  "server.js", "build.js", "package.json", "package-lock.json", "vercel.json"
]);

// Optional folders of static assets (copied recursively if they exist).
const STATIC_DIRS = ["assets", "images", "img", "fonts", "public"];

// Files that get obfuscated instead of plain-copied.
const OBFUSCATE = new Set(["script.js"]);

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

// ---------- 1. clean ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ---------- 2 + 3. copy / obfuscate ----------
const copied = [];
for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const name = entry.name;
  const lower = name.toLowerCase();
  if (name.startsWith(".")) continue;
  if (PRIVATE_FILES.has(lower)) continue;
  if (!PUBLIC_EXT.has(path.extname(lower))) continue;

  if (OBFUSCATE.has(name)) {
    const source = fs.readFileSync(path.join(ROOT, name), "utf8");
    const obfuscated = JavaScriptObfuscator.obfuscate(source, {
      compact: true,
      simplify: true,

      stringArray: true,
      stringArrayThreshold: 0.75,
      stringArrayEncoding: ["base64"],

      controlFlowFlattening: false,
      deadCodeInjection: false,
      debugProtection: false,
      selfDefending: false,

      sourceMap: false
    });
    fs.writeFileSync(path.join(OUT, name), obfuscated.getObfuscatedCode());
    copied.push(`${name} (obfuscated)`);
  } else {
    fs.copyFileSync(path.join(ROOT, name), path.join(OUT, name));
    copied.push(name);
  }
}

for (const dir of STATIC_DIRS) {
  const src = path.join(ROOT, dir);
  if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
    copyDir(src, path.join(OUT, dir));
    copied.push(`${dir}/`);
  }
}

if (!fs.existsSync(path.join(OUT, "index.html"))) {
  console.error("BUILD FAILED: index.html was not found in the project root.");
  process.exit(1);
}

// ---------- 4. verify that every local asset referenced by the HTML exists ----------
function isLocalRef(ref) {
  if (!ref) return false; // src="" is filled in by JavaScript at runtime
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return false; // http:, https:, mailto:, data:, //cdn, #anchor
  if (/^\/api(?:\/|$)/.test(ref)) return false; // backend routes, not files
  return true;
}

const problems = [];
const htmlFiles = fs.readdirSync(OUT).filter((f) => f.toLowerCase().endsWith(".html"));
for (const htmlFile of htmlFiles) {
  const html = fs.readFileSync(path.join(OUT, htmlFile), "utf8");
  const refRegex = /\b(?:src|href)\s*=\s*["']([^"']*)["']/gi;
  let match;
  while ((match = refRegex.exec(html)) !== null) {
    const ref = match[1].trim();
    if (!isLocalRef(ref)) continue;

    const clean = ref.split("#")[0].split("?")[0];
    if (clean === "" || clean === "/") continue; // link to the homepage
    const target = path.join(OUT, clean.startsWith("/") ? clean.slice(1) : clean);

    const exists =
      fs.existsSync(target) ||
      (!path.extname(target) && fs.existsSync(`${target}.html`)); // clean URLs like /auto-admin
    if (!exists) problems.push(`${htmlFile} -> "${ref}" (file not found)`);
  }
}

if (problems.length) {
  console.error("\nBUILD FAILED: these files are referenced by your HTML but do not exist:\n");
  problems.forEach((p) => console.error("  - " + p));
  console.error("\nFix: add the missing file to the project root, or remove the reference from the HTML.\n");
  process.exit(1);
}

console.log("Copied into dist/: " + copied.join(", "));
console.log("Asset check passed: every file referenced by the HTML exists.");
console.log("Production build completed successfully!");
