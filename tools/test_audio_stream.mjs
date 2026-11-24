// A real first touch should unlock audio without building the full synthesizer library.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--mute-audio'],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true }
});
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:' + (process.env.PORT || 8137) + '/?nomission');
  await page.waitForSelector('.title button');
  await page.evaluate(async () => {
    const module = await import('/src/engine/audio.js');
    window.sounds = module.audio;
    window.recipes = module.SOUND_DEFS;
    window.synthesize = module.synthesizeSamples;
  });
  await page.tap('button::-p-text(Settings)');
  await page.waitForFunction(() => sounds.baked && sounds.music?.notes > 0);
  const startup = await page.evaluate(() => {
    window.firstTitle = sounds.music;
    const clips = Object.values(sounds.buffers).flat();
    return { bytes: clips.reduce((sum, b) => sum + b.length * b.numberOfChannels * 4, 0), count: clips.length };
  });
  assert.ok(startup.bytes < 200000 && startup.count < 5);
  await page.tap('button::-p-text(Graphics)');
  assert.equal(await page.evaluate(() => sounds.music === firstTitle), true);
  const results = await page.evaluate(async () => {
    const a = sounds;
    a.stopMusic(0.1);
    const canceled = a.play('cow_moo');
    canceled.stop();
    await a._soundJobs.get('cow_moo');
    await Promise.resolve();
    if (canceled.playing || a._active.get('cow_moo')?.some(h => h.playing)) throw Error('Canceled cold one-shot played');
    const cold = a.play('pistol');
    await a._soundJobs.get('pistol');
    await new Promise(r => setTimeout(r, 0));
    if (!a._active.get('pistol')?.length || a.buffers.pistol.length !== recipes.pistol.vars) throw Error('Cold effect or variations missing');
    cold.stop();

    // Compare every sample of representative worker output to the original deterministic generator.
    for (const [kind, name] of [['loop','crowd'], ['instrument','piano'], ['instrument','steel']]) {
      const loaded = await a.prepareSamples(kind, name);
      const reference = synthesize(kind, name);
      const buffers = kind === 'loop' ? [loaded] : loaded.map(s => s.buf);
      for (let i = 0; i < reference.length; i++) {
        const zone = reference[i], buffer = buffers[i];
        if (zone.sr !== buffer.sampleRate || zone.channels.length !== buffer.numberOfChannels) throw Error(name + ' format mismatch');
        if (kind === 'instrument' && (zone.root !== loaded[i].root || zone.ls !== loaded[i].ls || zone.le !== loaded[i].le)) throw Error(name + ' tuning mismatch');
        for (let channel = 0; channel < zone.channels.length; channel++) {
          const actual = buffer.getChannelData(channel), expected = zone.channels[channel];
          if (expected.length !== actual.length || actual.some((s, j) => s !== expected[j])) throw Error(name + ' waveform changed');
        }
      }
    }
    const loop = a.createLoop('water_lap');
    loop.stop();
    await loop.loading;
    if (loop.v || a._loops.has(loop)) throw Error('Stopped ambient loop restarted');
    const live = a.createLoop('rain');
    await live.loading;
    if (!live.v) throw Error('Ambient loop did not start');
    live.stop();
    const { AudioSys } = await import('/src/engine/audio.js');
    const restricted = new AudioSys(), WorkerClass = window.Worker;
    let fallback;
    try {
      window.Worker = class { constructor() { throw new DOMException('Worker disabled', 'SecurityError'); } };
      fallback = restricted.prepareSamples('loop', 'cicadas');
    } finally { window.Worker = WorkerClass; }
    if (!(await fallback).length || !restricted._workerUnavailable) throw Error('Worker fallback failed');
    // Tuning away from a cold station while instruments prepare must not revive the old song.
    a.radio.play(2); const old = a.radio.player;
    a.radio.play(0);
    return { worker: !!a._sampleWorker, stopped: old.stopped, oldScheduled: a._players.has(old) };
  });
  assert.deepEqual(results, { worker: true, stopped: true, oldScheduled: false });
  await page.waitForFunction(() => sounds.radio.player?.notes > 0 && sounds.radio.current === 0);
  await page.evaluate(() => sounds.radio.off());
  assert.deepEqual(errors, []);
  console.log('Cold startup, title continuity, sound variations, canceled effects and loops, sample-exact worker synthesis and radio switching passed.', startup);
} finally { await browser.close(); }
