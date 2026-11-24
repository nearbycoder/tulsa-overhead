// Boot: load data, title screen (attract mode over downtown Tulsa), new game / continue, main loop.
import { World } from '../world/world.js';
import { Camera } from '../engine/camera.js';
import { Renderer } from '../engine/renderer.js';
import { settings } from '../engine/settings.js';
import { input } from '../engine/input.js';
import { Assets } from './assets.js';
import { Game } from './game.js';
import { MissionManager } from './missions.js';
import { UI } from '../ui/ui.js';
import { TouchControls } from '../ui/touch-controls.js';
import { loadStory } from '../story/index.js';
import { fmtMoney } from '../engine/math.js';
import { refreshDom } from '../engine/glyphs.js';

const params = new URLSearchParams(location.search);
const msg = (m) => { const el = document.getElementById('boot-msg'); if (el) el.textContent = m; };

// Audio facade: real engine if present, silent stub otherwise.
async function makeAudio() {
  const noop = () => { };
  const handle = { stop: noop, setState: noop, setPos: noop, setPlayer: noop, setIntensity: noop, setMode: noop, setVelocity: noop };
  let real = null;
  try { const m = await import('../engine/audio.js'); real = m.audio || (m.AudioSys ? new m.AudioSys() : null); } catch (e) { console.warn('audio engine unavailable', e); }
  const A = {
    real, ready: false,
    async init() {
      if (this.ready || this._initing) return;
      this._initing = true;
      if (real) { try { this.applyVolumes(); await real.init({ onDemand: true }); this.ready = true; } catch (e) { console.warn('audio init failed', e); } }
      this._initing = false;
    },
    applyVolumes() { if (real && real.setVolumes) real.setVolumes({ master: settings.get('masterVolume'), sfx: settings.get('sfxVolume'), music: settings.get('musicVolume'), radio: settings.get('radioVolume'), voice: settings.get('voiceVolume') }); },
    setVolumes(v) { real && real.setVolumes && real.setVolumes(v); },
    play(n, o) { if (!this.ready) return handle; try { return real.play(n, o) || handle; } catch (e) { return handle; } },
    createEngine(p) { if (!this.ready || !real.createEngine) return null; try { return real.createEngine(p); } catch (e) { return null; } },
    createSiren(t) { if (!this.ready || !real.createSiren) return null; try { return real.createSiren(t); } catch (e) { return null; } },
    createLoop(n) { if (!this.ready || !real.createLoop) return null; try { return real.createLoop(n); } catch (e) { return null; } },
    setListener(x, y, z) { if (this.ready && real.setListener) real.setListener(x, y, z); },
    // Encoded voices can play as soon as the mixer exists, while procedural effects are still baking.
    playVoice(url, options) { return real?.ready ? real.playVoice(url, options) : Promise.resolve(false); },
    stopVoice(channel) { real?.stopVoice(channel); },
    setVoicePaused(paused) { if (real) real.setVoicePaused(paused); },
    playMusic(n) { if (this.ready && real.playMusic) real.playMusic(n); },
    stopMusic(f) { if (this.ready && real.stopMusic) real.stopMusic(f); },
    setMusicIntensity(v) { if (this.ready && real.setMusicIntensity) real.setMusicIntensity(v); },
    get radio() { return this.ready && real.radio ? real.radio : null; },
  };
  return A;
}

export async function boot() {
  msg('Loading map of the Tulsa metro…');
  const world = new World('assets/map');
  const assets = new Assets();
  const attractPath = [[-200, 300], [400, -300], [1500, 1200], [5500, 2200], [1700, 2600], [600, 3800]];
  world.treeDensity = settings.get('treeDensity');
  const [story, audio, downtown] = await Promise.all([
    loadStory(), makeAudio(),
    world.init().then(() => ({ ready: world.update(...attractPath[0]) })),
    assets.load(msg),
  ]);
  const cam = new Camera();
  const canvas = document.getElementById('game');
  const renderer = new Renderer(canvas, world, cam);
  const ui = new UI(document.getElementById('ui'), renderer.ground);
  ui.audio = audio;
  input.attach(canvas);
  let touchControls = input.lastDevice === 'touch' ? new TouchControls() : null;
  if (!touchControls) {
    const unsubscribe = input.onDeviceChange(device => {
      if (device === 'touch') {
        touchControls = new TouchControls();
        unsubscribe();
      }
    });
  }
  input.vibration = settings.get('vibration') !== false;
  input.promptStyle = settings.get('promptStyle') || 'auto';
  settings.onChange((k) => { if (k === 'vibration' || k === '*') input.vibration = settings.get('vibration') !== false; if (k === 'promptStyle' || k === '*') { input.promptStyle = settings.get('promptStyle') || 'auto'; refreshDom(); } });
  settings.onChange(k => {
    if (k === '*' || k === 'treeDensity' || k === 'autoQuality') world.treeDensity = settings.get('treeDensity');
  });
  const unlockAudio = () => {
    if (audio.ready || audio._initing) return;
    audio.init().then(() => { if (state.attract && !state.game && ui.open) audio.playMusic('title'); });
  };
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);
  settings.onChange((k) => { if (/Volume/.test(k) || k === '*') audio.applyVolumes(); });

  const state = { game: null, attract: true, t: 0 };
  let pauseFrameValid = false;
  const invalidatePauseFrame = () => { pauseFrameValid = false; };
  window.addEventListener('resize', invalidatePauseFrame);
  settings.onChange(invalidatePauseFrame);
  const pauseSpeech = () => audio.setVoicePaused(document.hidden || !!state.game?.paused);
  document.addEventListener('visibilitychange', pauseSpeech);
  const leaveGame = () => {
    const g = state.game;
    if (!g) return;
    // Invalidate both the active line and any pending mission exchange before another session begins.
    const run = g.missions?.active;
    if (run?.stop()) run.cleanup();
    g.setRadio(-2);
    audio.stopVoice();
    g.destroy();
    state.game = null;
    window.__game = null;
    ui.game = null;
    pauseSpeech();
  };
  // attract mode: slow flight over downtown Tulsa
  cam.x = attractPath[0][0]; cam.y = attractPath[0][1];
  cam.viewH = cam.targetViewH = 120;
  msg('Streaming downtown…');
  await downtown.ready;
  document.getElementById('boot').classList.add('hidden');

  const startGame = async (save) => {
    ui.closeAll();
    audio.stopMusic();
    await ui.fade(true);
    state.attract = false;
    leaveGame();
    const g = new Game({ world, assets, audio, renderer, cam, hudCanvas: document.getElementById('hud'), ui });
    ui.game = g;
    g.missions = new MissionManager(g, story);
    let sx, sy;
    if (save) { sx = save.x; sy = save.y; }
    else { const p = g.missions.place('mama_june_house'); sx = p.x - 5; sy = p.y - 4; }
    cam.x = sx; cam.y = sy; cam.viewH = 50;
    msg('');
    await world.update(sx, sy);
    g.spawnPlayer(sx, sy, -Math.PI / 2);
    if (save) g.applySave(save);
    else { g.player.money = 250; g.clock = 17 * 60 + 30; }
    if (params.get('chapter')) { const n = +params.get('chapter'); g.missions.chapter = n; for (const m of Object.values(story.MISSIONS)) if (m.chapter < n) g.missions.done.add(m.id); }
    state.game = g;
    window.__game = g;
    const restart = save?.restartMission && g.missions.available().find(m => m.id === save.restartMission);
    if (restart) g.missions.cooldown = Infinity;
    await ui.fade(false);
    if (state.game !== g) return;
    if (restart) {
      g.missions.cooldown = 0;
      g.missions.start(restart);
    } else if (!save) {
      const first = Object.values(story.MISSIONS).find((m) => m.autoStart && !g.missions.done.has(m.id));
      if (first && !params.has('nomission')) setTimeout(() => { if (state.game === g) g.missions.start(first); }, 600);
      g.hud.bigMessage('TULSA OVERHEAD', 'TULSA COUNTY, OKLAHOMA', '#f2b233', 4);
    } else g.hud.message(`Welcome back. Chapter ${g.missions.chapter}.`, 4);
  };

  const readSlots = () => ['slot1', 'auto'].map(id => ({ id, save: Game.loadData(id) }))
    .filter(({ save }) => Number.isFinite(save?.x) && Number.isFinite(save.y))
    .sort((a, b) => (b.save.t || 0) - (a.save.t || 0));
  const titleMenu = () => {
    const slots = readSlots();
    const website = document.querySelector('link[rel="up"]');
    const load = () => {
      const items = slots.map(({ id, save }) => {
        const mission = story.MISSIONS[save.restartMission];
        const chapter = Math.min(story.CHAPTERS.length, save.missions?.chapter || 1);
        const when = Number.isFinite(save.t) ? new Date(save.t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
        const where = mission ? 'Restart ' + mission.title : world.cityAt(save.x, save.y) || world.countyAt(save.x, save.y);
        return { label: id === 'slot1' ? 'Manual save' : 'Autosave',
          detail: ['Chapter ' + chapter, where, when].filter(Boolean).join(' · '), fn: () => startGame(save) };
      });
      items.push({ label: 'Back', fn: () => ui.pop() });
      ui.menu('LOAD GAME', '', items, { onBack: () => ui.pop() });
    };
    ui.menu('TULSA <span>OVERHEAD</span>', 'BROKEN ARROW · TULSA · GLENPOOL · CATOOSA', [
      slots.length > 0 && { label: 'Continue', fn: () => startGame(slots[0].save) },
      slots.length > 0 && { label: 'Load Game', fn: load },
      { label: 'New Game', fn: () => startGame(null) },
      { label: 'Settings', fn: () => ui.settingsScreen() },
      { label: 'Credits', fn: () => ui.showCredits() },
      website && { label: 'Back to website', fn: () => location.assign(website.href) },
    ], { cls: 'title' });
  };

  const pauseMenu = () => {
    const g = state.game;
    g.paused = true;
    const close = () => { ui.pop(); g.paused = false; };
    const el = ui.menu('PAUSED', `${fmtMoney(g.player.money)} · Chapter ${Math.min(8, g.missions.chapter)}: ${g.missions.chapterDef()?.title || 'Complete'} · Day ${g.day} ${String(Math.floor(g.clock / 60)).padStart(2, '0')}:${String(Math.floor(g.clock % 60)).padStart(2, '0')}`, [
      { label: 'Resume', fn: close },
      { label: 'Map', fn: () => { ui.pop(); g.paused = false; ui.openMap(); } },
      { label: 'Story', fn: () => ui.storyScreen() },
      { label: 'Stats', fn: () => ui.statsScreen() },
      { label: 'Vehicle Registry', fn: () => ui.garageScreen() },
      { label: 'Spawn Helicopter', fn: () => {
        const helis = g.assets.vehicles.filter((m) => m.kind === 'heli');
        ui.menu('SPAWN <span>HELICOPTER</span>', 'Sets one down beside you and puts you in the pilot seat.', helis.map((m) => ({
          label: `${m.make ? m.make + ' ' : ''}${m.name}`,
          fn: () => { ui.closeAll(); g.paused = false; g.spawnHelicopter(m.id); },
        })), { onBack: () => ui.pop() });
      } },
      { label: 'Settings', fn: () => ui.settingsScreen() },
      { label: g.missions.active ? 'Quick Save (not during missions)' : 'Quick Save', disabled: !!g.missions.active, fn: () => {
        if (!g.save('slot1')) { ui.toast('Save failed. Check browser storage and try again.'); return; }
        g.hud.message('Game saved.', 3); close();
      } },
      { label: 'Quit to Title', fn: () => {
        const snapshot = g.missions.active?.startSave;
        if (!g.save('auto', snapshot && { ...snapshot, t: Date.now() })) {
          ui.toast('Save failed. Your game is still open.'); return;
        }
        ui.closeAll(); leaveGame(); state.attract = true; g.hud.ctx.clearRect(0, 0, 1e5, 1e5);
        audio.playMusic('title'); titleMenu();
      } },
    ], { onBack: close });
    el._freezeScene = true;
    if (g.missions.active) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = g.missions.active.def.odd
        ? 'If you quit, Continue returns you to the start of this job.'
        : 'If you quit, Continue restarts this mission from the beginning.';
      el.querySelector('.sub').appendChild(hint);
    }
  };

  if (params.has('autostart')) startGame(params.get('autostart') === 'continue' ? readSlots()[0]?.save : null);
  else titleMenu();

  let last = performance.now(), nextFrame = last;
  document.addEventListener('visibilitychange', () => {
    last = nextFrame = performance.now();
    settings.adaptive.clearSamples();
    if (audio.real?.ready) {
      const playback = document.hidden ? audio.real.suspend() : audio.real.resume();
      playback.catch(() => {});
    }
  });
  const frame = (t) => {
    const chosenLimit = settings.get('frameLimit');
    const limit = state.attract ? Math.min(chosenLimit || 30, 30) : chosenLimit;
    if (document.hidden || (limit && t + 0.5 < nextFrame)) { requestAnimationFrame(frame); return; }
    // Carry the deadline forward on 90/120/144 Hz screens without accumulating missed frames.
    const period = limit ? 1000 / limit : 0;
    nextFrame = period ? nextFrame + Math.max(1, Math.floor((t + 0.5 - nextFrame) / period) + 1) * period : t;
    const interval = t - last, started = performance.now();
    const dt = Math.max(0, Math.min(0.1, interval / 1000));
    last = t;
    input.pollGamepad(dt);
    const g = state.game;
    try {
    // controller in menus (and A to skip dialogue); runs before gameplay so a menu can't reopen the frame it closes
    // (also true for a frame after a menu closes: the key that closed it mustn't act in the game)
    const uiWasOpen = ui.open || performance.now() - (ui.lastClose || 0) < 120;
    if (input.gamepad) {
      if (!audio.ready && (input.nav.has('a') || input.nav.has('start'))) unlockAudio();
      ui.padNav(input.nav, dt);
    }
    // the press that closed a menu shouldn't also honk, sprint or toggle a helicopter this frame
    if (uiWasOpen) input.pressed.clear();
    if (g) {
      if (!ui.open && !uiWasOpen && !g.respawning && !g.missions?.retrying) {
        if (input.wasPressed('pause')) pauseMenu();
        else if (input.wasPressed('map')) ui.openMap();
      }
      pauseSpeech();
      if (!g.paused && !document.hidden) ui.dialog.update(dt);
      if (!g.paused) g.update(dt);
      const frozen = g.paused && ui.stack.some(screen => screen._freezeScene);
      if (!frozen || renderer.displayDpr !== (window.devicePixelRatio || 1)) pauseFrameValid = false;
      if (!ui.stack.at(-1)?._coversScene) {
        if (!pauseFrameValid) {
          g.render(dt);
          g.hud.draw();
          pauseFrameValid = frozen;
        }
      }
    } else if (state.attract) {
      state.t += dt;
      const seg = attractPath.length;
      const k = (state.t / 25) % seg;
      const i = Math.floor(k), f = k - i;
      const a = attractPath[i], b = attractPath[(i + 1) % seg];
      const e = f * f * (3 - 2 * f);
      cam.x = a[0] + (b[0] - a[0]) * e; cam.y = a[1] + (b[1] - a[1]) * e;
      cam.viewH = 110 + Math.sin(state.t * 0.2) * 30;
      cam.updateDerived();
      world.update(cam.x, cam.y);
      renderer.night = 0; renderer.rain = 0;
      renderer.render({ loading: false }, dt);
    }
    } catch (err) {
      // never let one bad frame freeze the game
      state.errors = (state.errors || 0) + 1;
      if (state.errors < 20) console.error('frame error', err);
      if (g && g.renderer) g.renderer.drawables = [];
    }
    touchControls?.sync(state.game, ui);
    input.endFrame();
    if (g && !g.paused && !ui.open) settings.sampleFrame(interval, performance.now() - started);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
