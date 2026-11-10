// Canonical source: src/bot/widget.source.html. The generated template is shared
// unchanged across users; private values arrive only through Telegram chatData.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";

// Reuse the esbuild version locked by the Mini App's existing Vite toolchain.
const requireWeb = createRequire(new URL("../web/package.json", import.meta.url));
const { transform } = requireWeb("esbuild");
const source = await readFile(new URL("../src/bot/widget.source.html", import.meta.url), "utf8");
const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const style = source.match(/<style>([\s\S]*?)<\/style>/)?.[1];
if (!script || !style) throw new Error("Widget source needs one script and style element");

const [js, css] = await Promise.all([
  transform(script, { loader: "js", target: "es2020", minify: true, charset: "utf8", legalComments: "none" }),
  transform(style, { loader: "css", minify: true, legalComments: "none" }),
]);
const html = source
  .replace(/<script>[\s\S]*?<\/script>/, () => `<script>${js.code.trim()}</script>`)
  .replace(/<style>[\s\S]*?<\/style>/, () => `<style>${css.code.trim()}</style>`)
  .replace(/>\s+</g, "><")
  .trim() + "\n";
const raw = Buffer.byteLength(html);
const compressed = deflateSync(html, { level: 9 }).length;
if (raw > 32768 || compressed > 4096) {
  throw new Error(`Widget exceeds Telegram limits: ${raw} raw / ${compressed} zlib bytes`);
}
await writeFile(new URL("../src/bot/widget.html", import.meta.url), html);
console.log(`Widget: ${raw} raw / ${compressed} zlib bytes`);
