#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const templateDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "template");

const args = process.argv.slice(2).filter((a) => a !== "--here");
const here = process.argv.includes("--here");

if (args.length > 1) {
  console.error("Usage: create-oblik [dir] [--here]");
  process.exit(1);
}

const target = path.resolve(args[0] ?? ".");

function fail(msg) {
  console.error(`create-oblik: ${msg}`);
  process.exit(1);
}

if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
  fail(`"${target}" is not empty (use --here to scaffold into an existing project)`);
}
if (here && fs.existsSync(path.join(target, "package.json"))) {
  fail(`"${target}" already has a package.json`);
}

const name = path.basename(target) || "oblik-figures";

fs.cpSync(templateDir, target, { recursive: true, force: false, errorOnExist: true });

const pkgPath = path.join(target, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.name = name;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, undefined, 2) + "\n");

console.log(`Scaffolded oblik project in ${target}`);
console.log(`
Next steps:
  cd ${path.relative(process.cwd(), target) || "."}
  pnpm install
  pnpm dev
`);
