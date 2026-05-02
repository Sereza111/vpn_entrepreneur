import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
const landingDir = path.join(root, "landing");
const outDir = path.join(root, "public", "site");

async function copyRecursive(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const ents = await fs.readdir(src, { withFileTypes: true });
  for (const ent of ents) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) await copyRecursive(s, d);
    else await fs.copyFile(s, d);
  }
}

async function main() {
  try {
    await fs.access(landingDir);
  } catch {
    console.error("landing/ not found");
    process.exit(1);
    return;
  }
  await fs.rm(outDir, { recursive: true }).catch(() => null);
  await copyRecursive(landingDir, outDir);
  console.log(`[build-landing] copied → ${path.relative(root, outDir)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
