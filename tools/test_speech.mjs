// With npm start running, run node tools/test_speech.mjs to exercise real decoded voices.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 960, height: 540 }
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:' + (process.env.PORT || 8137) + '/?autostart=new&nomission');
  await page.waitForFunction(() => window.__game?.player && !__game.controlsLocked);
  await page.evaluate(async () => {
    const game = __game;
    await game.audio.init();
    const engine = game.audio.real;
    const check = (ok, message) => { if (!ok) throw Error(message); };
    // Schedule all three before the first decode settles.
    const radio = engine.playVoice('assets/voice/radio_krdr_1.mp3', {channel: 'radio'});
    const dispatch = engine.playVoice('assets/voice/disp_up_1.mp3', {channel: 'dispatch'});
    const story = engine.playVoice('assets/voice/c1m1_01.mp3');
    const active = engine._voice;
    const duplicate = engine.playVoice(active.url);
    check(engine._voice === active, 'Duplicate requests restarted a recording');
    check(!await radio && !await dispatch, 'Preempted announcements reported a natural end');
    check(!await engine.playVoice('assets/voice/disp_up_2.mp3', {channel: 'dispatch'}), 'Dispatch displaced story');
    engine.stopVoice('radio');
    check(engine._voice === active, 'An unrelated cancellation stopped story');
    check(await story && await duplicate, 'The shared story source did not play to its natural end');
    const {MissionRun} = await import('/src/game/missions.js');
    const mission = new MissionRun(game.missions, {id: 'dialogue-test'});
    window.testMission = mission;
    window.lines = [];
    const dialog = game.ui.dialog, say = dialog.say.bind(dialog);
    dialog.say = (...args) => { window.lines.push(args[2].voice); return say(...args); };
    window.exchange = Promise.all([mission.talk(['c1m1_01', 'c1m1_02']), mission.talk('c1m1_03')]);
  });
  await page.waitForFunction(() => __game.audio.real.voicePlaying);
  await new Promise(resolve => setTimeout(resolve, 650));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => __game.paused && __game.audio.real._voicePaused);
  const offset = await page.evaluate(() => __game.audio.real._voice.offset);
  assert.ok(offset > 0.15);
  await page.keyboard.press('Space');
  // The pause menu uses its own keyboard navigation. Re-open it if Space selected Resume.
  const paused = await page.evaluate(() => __game.paused);
  if (!paused) await page.keyboard.press('Escape');
  await page.waitForFunction(() => __game.paused);
  assert.equal(await page.evaluate(() => lines.length), 1);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !__game.paused && __game.audio.real.voicePlaying);
  assert.ok(await page.evaluate(() => __game.audio.real._voice.offset) >= offset - 0.03);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => lines.length === 2);
  await page.keyboard.down('Space');
  await new Promise(resolve => setTimeout(resolve, 700));
  // A held key produces repeating keydowns long after the next line's skip guard has expired.
  await page.keyboard.down('Space');
  await page.keyboard.up('Space');
  assert.equal(await page.evaluate(() => lines.length), 2);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => lines.length === 3);
  await page.evaluate(() => exchange);
  assert.deepEqual(await page.evaluate(() => lines.map(url => url.split('/').pop())),
    ['c1m1_01.mp3', 'c1m1_02.mp3', 'c1m1_03.mp3']);

  const result = await page.evaluate(async () => {
    const game = __game, engine = game.audio.real;
    const { settings } = await import('/src/engine/settings.js');
    settings.set('subtitles', false);
    const dialog = game.ui.dialog;
    const missing = dialog.say('Radio', 'Take the next right.', {voice:'data:audio/wav,invalid'});
    await new Promise(resolve => setTimeout(resolve, 450));
    const caption = dialog.active && dialog.el.style.display === 'block' && dialog.remaining > 0;
    dialog.cancel();
    await missing;
    const car = game.vehicles.find(v => !v.isTwoWheel && !v.copUnit && !v.driver && !v.dead);
    if (!car) throw Error('Missing street vehicle');
    game.enterVehicle(game.player.ped, car);
    game.setRadio(0);
    game.identDue = game.time;
    game.updateRadio();
    const stationQueued = engine._voice?.channel === 'radio';
    game.setRadio(1);
    const oldStationStopped = !engine._voice;
    game.identDue = game.time;
    game.updateRadio();
    const currentStation = engine._voice?.url.includes('radio_' + game.audio.radio.station.id);
    game.exitVehicle(game.player.ped, true);
    return {caption, stationQueued, oldStationStopped, currentStation, quietOnExit: !engine._voice && !game.audio.radio.station};
  });
  assert.deepEqual(result, {caption:true, stationQueued:true, oldStationStopped:true, currentStation:true, quietOnExit:true});
  await page.evaluate(() => __game.missions.start(__game.missions.story.MISSIONS.c1m1));
  await page.waitForFunction(() => __game.dialogActive && __game.audio.real.voicePlaying);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => __game.paused);
  const ui = await page.evaluateHandle(() => __game.ui);
  await page.locator('button::-p-text(Quit to Title)').click();
  await page.waitForFunction(ui => !ui.game && !window.__game, {}, ui);
  await new Promise(resolve => setTimeout(resolve, 900));
  assert.ok(await ui.evaluate(ui => !ui.dialog.active && !ui.audio.real._voice));
  await ui.dispose();
  assert.deepEqual(errors, []);
  console.log('Story ordering, decoded playback, pause/resume, skip, captions, dispatch priority and radio retuning passed.');
} finally {
  await browser.close();
}
