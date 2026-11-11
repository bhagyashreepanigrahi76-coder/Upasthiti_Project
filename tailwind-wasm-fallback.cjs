/*
 * Windows Application Control (Smart App Control / WDAC) can block Tailwind's
 * native binary (@tailwindcss/oxide-win32-x64-msvc). Tailwind then falls back to
 * its WASM build, whose file scanner cannot read from disk, so NO utility
 * classes get generated and the site renders unstyled. The WASM scanner does
 * work on text we hand it, so in that case we read the source files in Node,
 * extract the class candidates, and pass them to Tailwind with @source inline().
 * When the native binary loads normally this plugin does nothing.
 */
const fs = require("node:fs");
const path = require("node:path");

function nativeOxideAvailable() {
  try {
    require("@tailwindcss/oxide-win32-x64-msvc");
    return true;
  } catch (e) {
    return !(e && /Application Control|blocked/i.test(String(e.message)));
  }
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?|mdx?|html)$/.test(entry.name)) out.push(full);
  }
}

module.exports = () => ({
  postcssPlugin: "tailwind-wasm-source-fallback",
  Once(root, { postcss }) {
    if (nativeOxideAvailable()) return;
    const { Scanner } = require("@tailwindcss/oxide");
    const files = [];
    walk(path.join(process.cwd(), "src"), files);

    const candidates = new Set();
    const scanner = new Scanner({});
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      const ext = path.extname(file).slice(1);
      for (const c of scanner.scanFiles([{ content, extension: ext }])) {
        // Keep the generated @source inline("...") string safe.
        if (!/[\s"'`{}\\]/.test(c)) candidates.add(c);
      }
    }
    root.prepend(postcss.atRule({ name: "source", params: `inline("${[...candidates].join(" ")}")` }));
  },
});
module.exports.postcss = true;
