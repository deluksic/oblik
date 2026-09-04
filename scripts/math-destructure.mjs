#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist" || ent.name === ".git") continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(ent.name) && !ent.name.endsWith(".d.ts")) acc.push(p);
  }
  return acc;
}

function skipFile(file) {
  if (file.includes("/scripts/math-destructure.mjs")) return true;
  return false;
}

function parseBalanced(content, start, open = "(", close = ")") {
  if (content[start] !== open) throw new Error(`expected ${open} at ${start}`);
  let depth = 0;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return { inner: content.slice(start + 1, i), end: i + 1 };
    }
  }
  throw new Error("unbalanced");
}

function splitTopLevelArgs(inner) {
  const args = [];
  let start = 0;
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  for (let i = 0; i <= inner.length; i++) {
    const ch = inner[i];
    if (ch === "(") depthParen++;
    else if (ch === ")") depthParen--;
    else if (ch === "[") depthBracket++;
    else if (ch === "]") depthBracket--;
    else if (ch === "{") depthBrace++;
    else if (ch === "}") depthBrace--;
    else if (ch === "," && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
      args.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = inner.slice(start).trim();
  if (tail) args.push(tail);
  return args;
}

function replaceHypot(content) {
  const used = new Set();
  let out = "";
  let i = 0;
  while (i < content.length) {
    const idx = content.indexOf("Math.hypot(", i);
    if (idx === -1) {
      out += content.slice(i);
      break;
    }
    out += content.slice(i, idx);
    const parsed = parseBalanced(content, idx + "Math.hypot".length);
    const args = splitTopLevelArgs(parsed.inner);
    if (args.length < 2 || args.length > 3) {
      throw new Error(`unsupported hypot arity ${args.length} at ${idx}`);
    }
    const terms = args.map((a) => `(${a}) * (${a})`).join(" + ");
    out += `sqrt(${terms})`;
    used.add("sqrt");
    i = parsed.end;
  }
  return { content: out, used };
}

function stripStringsAndComments(content) {
  let out = "";
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1];
    if (ch === "/" && next === "/") {
      const end = content.indexOf("\n", i);
      const stop = end === -1 ? content.length : end;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = content.indexOf("*/", i + 2);
      const stop = end === -1 ? content.length : end + 2;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < content.length) {
        if (content[j] === "\\") {
          j += 2;
          continue;
        }
        if (content[j] === quote) {
          j++;
          break;
        }
        j++;
      }
      out += content.slice(i, j);
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function moduleLevelBindings(content) {
  const bindings = new Set();
  for (const m of content.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm))
    bindings.add(m[1]);
  for (const m of content.matchAll(/^const\s+([A-Za-z_$][\w$]*)\s*=/gm)) bindings.add(m[1]);
  return bindings;
}

function collectMathMembers(content) {
  const members = new Set();
  const stripped = stripStringsAndComments(content);
  for (const m of stripped.matchAll(/\bMath\.([A-Za-z_$][\w$]*)/g)) members.add(m[1]);
  return members;
}

function hasMathDestructure(content) {
  return /const\s*\{[^}]+\}\s*=\s*Math\s*;/.test(content);
}

function insertDestructure(content, members) {
  const bindings = moduleLevelBindings(content);
  const aliased = new Map();
  const plain = [];
  for (const m of [...members].toSorted()) {
    if (bindings.has(m)) aliased.set(m, `${m}Math`);
    else plain.push(m);
  }
  const parts = [...plain, ...[...aliased.entries()].map(([k, v]) => `${k}: ${v}`)].toSorted();
  if (parts.length === 0) return content;
  const line = `const { ${parts.join(", ")} } = Math;\n`;
  if (hasMathDestructure(content)) {
    return content.replace(/const\s*\{([^}]+)\}\s*=\s*Math\s*;/, () => line.trimEnd());
  }

  const shebang = content.startsWith("#!") ? (content.match(/^#!.*\n/)?.[0] ?? "") : "";
  const rest = content.slice(shebang.length);
  const importMatch = rest.match(/^(?:\s*import[\s\S]*?;\s*\n)+/);
  if (importMatch) {
    const at = shebang.length + importMatch[0].length;
    return content.slice(0, at) + "\n" + line + content.slice(at);
  }
  return shebang + line + rest;
}

function replaceMathMembers(content, members) {
  const bindings = moduleLevelBindings(content);
  let out = content;
  for (const m of members) {
    if (m === "hypot") continue;
    const alias = bindings.has(m) ? `${m}Math` : m;
    const re = new RegExp(`\\bMath\\.${m}\\b`, "g");
    let idx = 0;
    let rebuilt = "";
    while (idx < out.length) {
      const hit = out.slice(idx).search(re);
      if (hit === -1) {
        rebuilt += out.slice(idx);
        break;
      }
      const at = idx + hit;
      const before = out.slice(0, at);
      if (stripStringsAndComments(before).length !== before.length) {
        rebuilt += out.slice(idx, at + `Math.${m}`.length);
        idx = at + `Math.${m}`.length;
        continue;
      }
      rebuilt += out.slice(idx, at) + alias;
      idx = at + `Math.${m}`.length;
    }
    out = rebuilt;
  }
  return out;
}

function transformFile(file) {
  let content = fs.readFileSync(file, "utf8");
  if (!content.includes("Math.")) return false;

  const { content: afterHypot, used: hypotUsed } = replaceHypot(content);
  content = afterHypot;

  const members = collectMathMembers(content);
  for (const m of hypotUsed) members.add(m);
  members.delete("hypot");

  if (members.size === 0) return false;

  content = replaceMathMembers(content, members);
  content = insertDestructure(content, members);

  fs.writeFileSync(file, content);
  return true;
}

const files = walk(ROOT).filter((f) => !skipFile(f));
let changed = 0;
for (const file of files) {
  try {
    if (transformFile(file)) {
      changed++;
      console.log("updated", path.relative(ROOT, file));
    }
  } catch (e) {
    console.error("FAILED", path.relative(ROOT, file), e.message);
    process.exitCode = 1;
  }
}
console.log(`done: ${changed} files updated`);
