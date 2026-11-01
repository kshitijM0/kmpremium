
const fs = require("fs");
const path = require("path");
const JavaScriptObfuscator = require("javascript-obfuscator");

const output = "dist";

// Clean old build
fs.rmSync(output, {
    recursive: true,
    force: true
});

fs.mkdirSync(output, {
    recursive: true
});

// Read original JavaScript
const source = fs.readFileSync("script.js", "utf8");

// Obfuscate JavaScript
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

// Save protected JavaScript
fs.writeFileSync(
    path.join(output, "script.js"),
    obfuscated.getObfuscatedCode()
);

// Copy HTML and CSS
fs.copyFileSync("index.html", path.join(output, "index.html"));
fs.copyFileSync("style.css", path.join(output, "style.css"));

console.log("Production build completed successfully!");
