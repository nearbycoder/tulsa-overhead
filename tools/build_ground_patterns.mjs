// With the local game server running, bake the vector terrain materials into two lossless texture packs.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const destination = fileURLToPath(new URL('../assets/map/ground/patterns/', import.meta.url));
const scratch = await mkdtemp(path.join(tmpdir(), 'gtpolly-patterns-'));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  await mkdir(destination, { recursive: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:' + (process.env.PORT || 8137) + '/package.json');
  for (const fine of [false, true]) {
    const data = await page.evaluate(async fine => {
      const { groundPatternRecipes, makeTexture } = await import('/src/engine/ground.js');
      return Object.values(groundPatternRecipes(fine)).map(({ base, options, seed }) =>
        makeTexture(base, options, seed).toDataURL('image/png').split(',')[1]);
    }, fine);
    // One fetch per tier. Individual WebPs decode straight to repeating
    // patterns on mobile, without drawing a large atlas into 28 canvases.
    const encoded = path.join(destination, fine ? 'fine.bin' : 'coarse.bin');
    const png = path.join(scratch, 'material.png');
    const header = Buffer.alloc(4 + data.length * 4);
    header.write('GTP1');
    let offset = header.length;
    const files = [header];
    for (const [i, tile] of data.entries()) {
      await writeFile(png, Buffer.from(tile, 'base64'));
      const webp = execFileSync('cwebp', ['-quiet', '-lossless', '-m', '6', png, '-o', '-']);
      files.push(webp);
      offset += webp.length;
      header.writeUInt32LE(offset, 4 + i * 4);
    }
    await writeFile(encoded + '.tmp', Buffer.concat(files));
    await rename(encoded + '.tmp', encoded);
    console.log(encoded);
  }
} finally {
  await browser.close();
  await rm(scratch, { recursive: true, force: true });
}
