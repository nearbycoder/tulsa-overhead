#!/usr/bin/env node
// Dump every story line + cast voice description as JSON (consumed by tools/gen_voices.py).
//
//   node tools/dump_lines.mjs
//   -> {"cast":{id:{name,voice}}, "lines":{lineId:[castId,text]}, "files":[...], "importErrors":[...], "warnings":[...]}
//
// Imports src/story/cast.js and every src/story/ch<N>.js that exists (sorted by chapter number).
// Story modules are plain data + async functions, so they import cleanly in Node.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const storyDir = join(root, 'src', 'story');

const { CAST } = await import(pathToFileURL(join(storyDir, 'cast.js')).href);

const chapterFiles = readdirSync(storyDir)
  .map((f) => [f, /^ch(\d+)\.js$/.exec(f)])
  .filter(([, m]) => m)
  .sort((a, b) => Number(a[1][1]) - Number(b[1][1]))
  .map(([f]) => f);
// non-chapter voiced line sets (radio DJ idents)
for (const extra of ['radio.js']) { try { readdirSync(storyDir).includes(extra) && chapterFiles.push(extra); } catch (e) { /* ignore */ } }

const cast = {};
for (const [id, c] of Object.entries(CAST)) cast[id] = { name: c.name, voice: c.voice || '' };

const lines = {};
const importErrors = []; // chapter files that failed to import (their lines are missing from this dump)
const warnings = [];
for (const f of chapterFiles) {
  let mod;
  try {
    mod = await import(pathToFileURL(join(storyDir, f)).href);
  } catch (e) {
    // a chapter being written concurrently may be mid-edit: skip it, don't kill the whole dump
    importErrors.push(`${f}: ${e && e.message ? e.message.split('\n')[0] : e}`);
    continue;
  }
  for (const [id, entry] of Object.entries(mod.LINES || {})) {
    if (!Array.isArray(entry) || entry.length < 2) { warnings.push(`${f}: ${id} is not [castId, text]`); continue; }
    const [who, text] = entry;
    if (id in lines) warnings.push(`${f}: duplicate line id ${id} (later one wins)`);
    if (!(who in cast)) warnings.push(`${f}: ${id} speaker '${who}' is not in CAST`);
    lines[id] = [String(who), String(text)];
  }
}

for (const e of importErrors) process.stderr.write(`dump_lines: import failed: ${e}\n`);
for (const w of warnings) process.stderr.write(`dump_lines: ${w}\n`);
process.stdout.write(JSON.stringify({ cast, lines, files: chapterFiles, importErrors, warnings }) + '\n');
