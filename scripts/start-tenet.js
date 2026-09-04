#!/usr/bin/env node
"use strict";

/**
 * Tenet MVP fork launcher.
 *
 * Loads `.env.tenet` (or the file given as the first argument) into
 * process.env, forces PENECHO_TENET_MODE=1 and a loopback bind, then starts
 * the PenEcho server in this process. No dotenv dependency; the parser is the
 * same KEY=value grammar the PenEcho CLI uses for config.env.
 *
 * The Tenet Gateway demo host writes `.env.tenet` on every start
 * (packages/tenet-gateway: `npm run penecho-demo:start`), so values from the
 * file deliberately override the shell: the Gateway key rotates each run.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const file = path.resolve(process.argv[2] || path.join(ROOT, ".env.tenet"));

function parseEnvText(text) {
  const values = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

let text;
try {
  text = fs.readFileSync(file, "utf8");
} catch (error) {
  console.error(`Tenet launcher: cannot read ${file} (${error.message}).`);
  console.error("Start the Gateway demo host first: in packages/tenet-gateway run `npm run penecho-demo:start`; it writes this file.");
  process.exit(1);
}

const values = parseEnvText(text);
for (const [key, value] of Object.entries(values)) process.env[key] = value;
// An explicit PENECHO_TENET_MODE=0 in the file runs plain upstream PenEcho
// (the contrast instance in the demo); anything else is Tenet mode.
const plain = String(values.PENECHO_TENET_MODE || "").trim() === "0";
process.env.PENECHO_TENET_MODE = plain ? "0" : "1";
if (!process.env.HOST) process.env.HOST = "127.0.0.1";
// Loopback-only binds skip PenEcho's local-access gate; a LAN bind keeps it.
if (!plain && ["127.0.0.1", "localhost", "::1"].includes(process.env.HOST) && process.env.PENECHO_TENET_OPEN_ACCESS === undefined) {
  process.env.PENECHO_TENET_OPEN_ACCESS = "1";
}
if (!process.env.AI_PROVIDER) process.env.AI_PROVIDER = "api";
if (!process.env.AI_API_FORMAT) process.env.AI_API_FORMAT = "openai";

for (const required of ["AI_API_URL", "AI_API_MODEL", "AI_API_KEY"]) {
  if (!process.env[required]) {
    console.error(`Tenet launcher: ${required} is missing from ${file}.`);
    process.exit(1);
  }
}

console.log(`Tenet launcher: ${path.relative(ROOT, file)} -> ${plain ? "PLAIN upstream mode, provider" : "Tenet mode, gateway"} ${process.env.AI_API_URL}, model ${process.env.AI_API_MODEL}, bind ${process.env.HOST}:${process.env.PORT || 3888}`);
require(path.join(ROOT, "server.js"));
