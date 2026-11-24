// DOM UI: title/pause menus, settings (resolution + graphics + audio), map, shop, stats, garage, dialogue.
import { settings, PRESETS, frameDimensions } from '../engine/settings.js';
import { input } from '../engine/input.js';
import { WEAPONS, WEAPON_ORDER } from '../data/weapons.js';
import { fmtMoney } from '../engine/math.js';
import { MapView } from './mapview.js';
import { storyJournal } from './story-journal.js';
import { html as glyphHtml, refreshDom, device, padDevice } from '../engine/glyphs.js';

const $ = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
// controller helpers for form controls
function stepRange(f, dir) {
  const step = +f.step || 1, min = +f.min, max = +f.max;
  const v = Math.min(max, Math.max(min, Math.round((+f.value + dir * step) / step) * step));
  if (v === +f.value) return;
  f.value = v;
  f.dispatchEvent(new Event('input', { bubbles: true }));
}
function cycleSelect(f, dir) {
  const n = f.options.length;
  if (!n) return;
  f.selectedIndex = (f.selectedIndex + dir + n) % n;
  f.dispatchEvent(new Event('change', { bubbles: true }));
}

export class UI {
  constructor(root, ground) {
    this.root = root;
    this.ground = ground;
    this.stack = [];
    this.fadeEl = $('<div class="fade"></div>');
    document.body.appendChild(this.fadeEl);
    this.dialog = new Dialog(this);
    this.game = null;
    this.audio = null;
    this.toastEl = $('<div class="toast"></div>');
    document.body.appendChild(this.toastEl);
    // controller plugged in / unplugged: say so, and swap every on-screen prompt
    input.onDeviceChange((dev, kind, ev) => {
      if (ev === 'connected') this.toast('Controller connected');
      else if (ev === 'disconnected') this.toast('Controller disconnected');
    });
  }
  get open() { return this.stack.length > 0; }
  toast(text, ms = 2600) {
    this.toastEl.textContent = text; this.toastEl.classList.add('on');
    clearTimeout(this._toastT); this._toastT = setTimeout(() => this.toastEl.classList.remove('on'), ms);
  }
  push(el, hint) {
    const previous = this.stack.at(-1);
    if (previous) {
      if (previous.contains(document.activeElement)) el._returnFocus = document.activeElement;
      previous.inert = true;
      previous.hidden = true;
    }
    // every menu gets a footer showing how to drive it with the current device
    const menu = el.querySelector('.menu');
    if (menu && !menu.querySelector('.navhint')) {
      const h = $('<div class="navhint"></div>');
      h.dataset.ghint = hint || (el._noBack ? '{confirm} Select' : '{confirm} Select|{back} Back');
      menu.appendChild(h);
    }
    this.root.appendChild(el); this.stack.push(el);
    document.body.classList.add('menu-open');
    refreshDom(el);
    const f = el.querySelector('button.item:not([disabled]), button:not([disabled]), input, select');
    if (f) setTimeout(() => { if (this.stack.at(-1) === el) (el._initialFocus || f).focus(); }, 0);
    return el;
  }
  pop() {
    this.lastClose = performance.now();
    const el = this.stack.pop();
    if (!el) return;
    el._onclose?.(); el.remove();
    const top = this.stack.at(-1);
    document.body.classList.toggle('menu-open', !!top);
    if (top) {
      top.hidden = false; top.inert = false;
      const items = this.focusables(top);
      const target = items.includes(el._returnFocus) ? el._returnFocus : items[0];
      target?.focus();
    }
  }

  // ---------------------------------------------------------------- controller navigation
  focusables(root) {
    return [...root.querySelectorAll('button:not([disabled]), input, select, [data-nav]')].filter((e) => e.offsetParent !== null || e.getClientRects().length);
  }
  // nearest focusable in a direction, by on-screen position
  spatial(list, f, dir) {
    const r = f.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bs = Infinity;
    for (const e of list) {
      if (e === f) continue;
      const q = e.getBoundingClientRect(), dx = q.left + q.width / 2 - cx, dy = q.top + q.height / 2 - cy;
      let main, cross;
      if (dir === 'down') { main = dy; cross = Math.abs(dx); } else if (dir === 'up') { main = -dy; cross = Math.abs(dx); }
      else if (dir === 'right') { main = dx; cross = Math.abs(dy); } else { main = -dx; cross = Math.abs(dy); }
      if (main <= 6) continue;
      if ((dir === 'left' || dir === 'right') && cross > Math.max(r.height, q.height) * 0.75) continue;
      // vertical: the nearest row wins, then the most aligned control in it; horizontal: stay in the row
      const score = (dir === 'up' || dir === 'down') ? main + cross * 0.6 : main + cross * 2.2;
      if (score < bs) { bs = score; best = e; }
    }
    return best;
  }
  scrollTo(e) { try { e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (err) { /* ignore */ } }
  // returns true when the UI consumed the input this frame
  padNav(nav, dt = 1 / 60) {
    const top = this.stack[this.stack.length - 1];
    // dialogue lines skip on A even with no menu open
    if (!top) { if (nav.has('a') && this.dialog.active) { this.dialog.skip(); return true; } return false; }
    // right stick scrolls long screens (story, registry, credits)
    const gp = input.usingPad ? input.gamepad : null, menu = top.querySelector(".menu");
    if (gp && menu) { const ry = gp.axes[3] || 0; if (Math.abs(ry) > 0.3) menu.scrollTop += ry * 900 * dt; }
    if (!nav.size) return true;
    if (top._pad && top._pad(nav)) return true;
    const list = this.focusables(top);
    let f = document.activeElement;
    if (!f || !top.contains(f) || !list.includes(f)) {
      if (list.length) { f = list[0]; f.focus(); this.scrollTo(f); }
      if (!nav.has('b') && !nav.has('start')) return true;
    }
    for (const dir of ['up', 'down', 'left', 'right']) {
      if (!nav.has(dir) || !f) continue;
      const horiz = dir === 'left' || dir === 'right', sgn = dir === 'right' || dir === 'down' ? 1 : -1;
      if (horiz && f.type === 'range') { stepRange(f, sgn); continue; }
      if (horiz && f.tagName === 'SELECT') { cycleSelect(f, sgn); continue; }
      let n = this.spatial(list, f, dir);
      if (!n && !horiz) {
        // nothing further this way: scroll the panel, or wrap around short menus
        if (menu && menu.scrollHeight > menu.clientHeight + 4 && ((sgn > 0 && menu.scrollTop + menu.clientHeight < menu.scrollHeight - 2) || (sgn < 0 && menu.scrollTop > 0))) { menu.scrollTop += sgn * 160; continue; }
        n = sgn > 0 ? list[0] : list[list.length - 1];
      }
      if (n && n !== f) { n.focus(); this.scrollTo(n); f = n; this.audio && this.audio.play && this.audio.play('ui_click', { vol: 0.25 }); }
    }
    if (nav.has('a') && f) {
      if (f.tagName === 'SELECT') cycleSelect(f, 1);
      else if (f.type !== 'range') f.click();
    }
    if (nav.has('lb') || nav.has('rb')) {
      const tabs = [...top.querySelectorAll('.tabs button')];
      if (tabs.length) {
        const i = Math.max(0, tabs.findIndex((t) => t.classList.contains('on')));
        tabs[(i + (nav.has('rb') ? 1 : -1) + tabs.length) % tabs.length].click();
        setTimeout(() => { const on = top.querySelector('.tabs .on'); if (on) on.focus(); }, 0);
      }
    }
    if (nav.has('b') || nav.has('start')) {
      // every screen closes on Escape; send it one (synthetic, so the game itself never sees it)
      const target = f && top.contains(f) ? f : top;
      target.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true }));
    }
    return true;
  }
  closeAll() { while (this.stack.length) this.pop(); }
  click() { this.audio && this.audio.play && this.audio.play('ui_click', { vol: 0.5 }); }
  fade(on) { this.fadeEl.classList.toggle('on', on); return new Promise((r) => setTimeout(r, 550)); }
  cine(on) { document.body.classList.toggle('cine-bars', on); if (this.game) this.game.hud.hidden = on; }

  menu(title, sub, items, opts = {}) {
    const el = $(`<div class="screen ${opts.cls || ''}"><div class="menu"><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}<div class="items"></div></div></div>`);
    const box = el.querySelector('.items');
    for (const it of items) {
      if (!it) continue;
      const b = $(`<button class="item">${it.label}</button>`);
      if (it.detail) {
        const detail = document.createElement('small');
        detail.textContent = it.detail;
        b.appendChild(detail);
      }
      if (it.disabled) b.disabled = true;
      b.onclick = () => { this.click(); it.fn(); };
      box.appendChild(b);
    }
    el.addEventListener('keydown', (e) => {
      const btns = [...box.querySelectorAll('button:not([disabled])')];
      const i = btns.indexOf(document.activeElement);
      if (e.code === 'ArrowDown' || e.code === 'KeyS') { btns[(i + 1) % btns.length].focus(); e.preventDefault(); }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { btns[(i - 1 + btns.length) % btns.length].focus(); e.preventDefault(); }
      if (e.code === 'Escape' && opts.onBack) { e.stopPropagation(); opts.onBack(); }
    });
    if (opts.onBack && !items.some(it => it && /^(back|resume)$/i.test(it.label))) {
      const back = $('<button class="btn ghost touch-back">Back</button>');
      back.onclick = () => { this.click(); opts.onBack(); };
      box.appendChild(back);
    }
    if (!opts.onBack) el._noBack = true;
    return this.push(el);
  }

  // ---------------------------------------------------------------- settings
  settingsScreen(onClose) {
    const el = $(`<div class="screen"><div class="menu" style="width:min(720px,94vw)"><h1>SETTINGS</h1>
      <div class="tabs"></div><div class="body"></div>
      <div class="btnbar"><button class="btn ghost" data-a="reset">Reset defaults</button><button class="btn" data-a="close">Done</button></div></div></div>`);
    const tabs = ['Display', 'Graphics', 'Audio', 'Gameplay', 'Controls'];
    const tabsEl = el.querySelector('.tabs'), body = el.querySelector('.body');
    let cur = 'Display';
    const updateResolution = () => {
      const output = body.querySelector('[data-frame-size]');
      if (!output) return;
      const [w, h] = frameDimensions(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, settings.v);
      output.textContent = w + ' × ' + h + ' pixels';
    };
    window.addEventListener('resize', updateResolution);
    el._onclose = () => window.removeEventListener('resize', updateResolution);
    const render = () => {
      body.oninput = body.onchange = null;
      tabsEl.innerHTML = '';
      for (const t of tabs) { const b = $(`<button class="${t === cur ? 'on' : ''}">${t}</button>`); b.onclick = () => { cur = t; this.click(); render(); }; tabsEl.appendChild(b); }
      body.innerHTML = '';
      const row = (label, ctrl, hint) => {
        const r = $(`<div class="row"><label>${label}${hint ? `<div class="hint">${hint}</div>` : ''}</label><div class="c"></div></div>`);
        r.querySelector('.c').appendChild(ctrl);
        const input = r.querySelector('select, input');
        if (input) { input.id = 'option-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-'); r.querySelector('label').htmlFor = input.id; }
        body.appendChild(r);
        return r;
      };
      const slider = (key, min, max, step, fmt = (v) => v, onSet) => {
        const wrap = $('<div style="display:flex;align-items:center;gap:8px"></div>');
        const inp = $(`<input type="range" min="${min}" max="${max}" step="${step}">`);
        inp.value = settings.get(key);
        const val = $(`<span class="val">${fmt(+inp.value)}</span>`);
        inp.oninput = () => { val.textContent = fmt(+inp.value); settings.set(key, +inp.value); onSet && onSet(+inp.value); };
        wrap.append(inp, val); return wrap;
      };
      const check = (key, onSet) => { const c = $('<input type="checkbox">'); c.checked = !!settings.get(key); c.onchange = () => { settings.set(key, c.checked); onSet && onSet(c.checked); }; return c; };
      const select = (key, opts, onSet) => { const s = $('<select></select>'); for (const [v, l] of opts) { const o = $(`<option value="${v}">${l}</option>`); if (String(settings.get(key)) === String(v)) o.selected = true; s.appendChild(o); } s.onchange = () => { const v = isNaN(+s.value) || s.value === '' ? s.value : +s.value; settings.set(key, v); onSet && onSet(v); }; return s; };
      if (cur === 'Display') {
        const modes = [
          ['adaptive', 'Automatic · adaptive resolution'],
          ['native', 'Native display · up to 4K'], ['retro', '480p'], ['hd', '720p HD'],
          ['fullHD', '1080p Full HD'], ['qhd', '1440p QHD'], ['uhd', '2160p 4K UHD'], ['scaled', 'Custom window scale']
        ];
        const mode = select('resolutionMode', modes, () => {
          render();
          body.querySelector('#option-render-resolution').focus();
        });
        const display = row('Render resolution', mode);
        const frameSize = $('<div class="hint" data-frame-size></div>');
        display.querySelector('label').appendChild(frameSize);
        updateResolution();
        row('Frame limit', select('frameLimit', [[30, '30 FPS'], [60, '60 FPS'], [0, 'Display refresh rate']]));
        if (settings.get('resolutionMode') === 'scaled') {
          row('Resolution scale', slider('resolutionScale', 0, 1, 0.05,
            v => v ? Math.round(v * 100) + '%' : 'Retro 480p', updateResolution));
          row('Native HiDPI', check('nativeHiDPI', updateResolution), 'Use display pixels when scaling the window.');
        }
        row('Pixel-perfect upscaling', check('pixelPerfect'), 'Nearest-neighbour scaling of the frame (crisp pixels). Off = smooth.');
        row('Smooth ground filtering', check('smoothGround'), 'Bilinear filtering of the cached terrain.');
        row('Perspective strength', slider('perspective', 0.5, 1.5, 0.05, (v) => v.toFixed(2)), 'How far buildings and objects lean away from the camera.');
        row('Camera look-ahead', check('cameraLead'));
        row('Screen shake', check('screenShake'));
        row('Show FPS / stats', check('showFps'));
      } else if (cur === 'Graphics') {
        const pre = $('<div class="preset-options"></div>');
        for (const [key, preset] of Object.entries(PRESETS)) {
          const b = $(`<button class="btn" data-preset="${key}" style="font-size:13px;padding:5px 10px">${preset.label}</button>`);
          b.onclick = () => {
            settings.applyPreset(key); this.click(); render();
            body.querySelector(`[data-preset="${key}"]`).focus();
          };
          pre.appendChild(b);
        }
        const presetRow = row('Quality preset', pre);
        const presetStatus = $('<div class="hint"></div>');
        presetRow.querySelector('label').appendChild(presetStatus);
        const showPreset = () => {
          const current = settings.get('preset');
          for (const button of pre.children) {
            const selected = button.dataset.preset === current;
            button.classList.toggle('ghost', !selected);
            button.setAttribute('aria-pressed', String(selected));
          }
          presetStatus.textContent = current === 'auto' ? 'Adjusts resolution and scenery as frame times change.' : current === 'custom' ? 'Custom' : '';
        };
        showPreset();
        body.oninput = showPreset;
        body.onchange = showPreset;
        const imagery = this.ground?.nativeArea;
        row('Terrain detail', select('terrainDetail', [[0, 'Economy'], [1, 'Balanced'], [2, 'High'], [3, 'Ultra']]),
          imagery === 'towns' ? 'Compact edition. Towns include 0.6 m imagery. The countryside uses 4 m imagery.'
          : imagery === 'none' ? 'Overview edition. Ground imagery is 4 m throughout. Higher settings add surface detail.'
          : 'Controls ground imagery detail and texture memory.');
        row('Shadows', check('shadows'), 'Buildings, trees and vehicles cast sun shadows.');
        row('Building detail', select('buildingDetail', [[0, 'Flat'], [1, 'Windows'], [2, 'Windows + rooftops']]));
        row('Day/night lighting', check('lighting'), 'Night darkness, headlights, street lamps and lit windows.');
        row('Day/night cycle', check('dayNightCycle'), 'A full day passes every 24 minutes.');
        row('Weather', check('weather'), 'Oklahoma rainstorms.');
        row('Particles', slider('particles', 0.25, 1.5, 0.05, (v) => Math.round(v * 100) + '%'));
        row('Tree density', slider('treeDensity', 0.2, 1.3, 0.05, (v) => Math.round(v * 100) + '%'), 'Takes effect as new areas stream in.');
        row('Traffic density', slider('trafficDensity', 0.3, 2, 0.05, (v) => Math.round(v * 100) + '%'));
        row('Pedestrian density', slider('pedDensity', 0.3, 2, 0.05, (v) => Math.round(v * 100) + '%'));
        row('Draw distance (zoom-out)', slider('drawDistance', 0, 2, 0.1, (v) => v.toFixed(1)));
      } else if (cur === 'Audio') {
        const pct = (v) => Math.round(v * 100) + '%';
        const apply = () => this.audio && this.audio.setVolumes && this.audio.setVolumes({ master: settings.get('masterVolume'), sfx: settings.get('sfxVolume'), music: settings.get('musicVolume'), radio: settings.get('radioVolume'), voice: settings.get('voiceVolume') });
        row('Master volume', slider('masterVolume', 0, 1, 0.01, pct, apply));
        row('Sound effects', slider('sfxVolume', 0, 1, 0.01, pct, apply));
        row('Music', slider('musicVolume', 0, 1, 0.01, pct, apply));
        row('Car radio', slider('radioVolume', 0, 1, 0.01, pct, apply));
        row('Voice / dialogue', slider('voiceVolume', 0, 1, 0.01, pct, apply));
        row('Subtitles', check('subtitles'));
        row('Auto radio when entering cars', check('autoRadio'));
        const t = $('<button class="btn ghost">Test sound</button>'); t.onclick = () => this.audio && this.audio.play('pistol'); row('', t);
      } else if (cur === 'Gameplay') {
        row('On-foot controls', select('aimMode', [['mouse', 'Modern (WASD move + mouse aim)'], ['tank', 'Classic (rotate & walk, 1997 style)']]));
        row('Difficulty', select('difficulty', [[0.7, 'Easy'], [1, 'Normal'], [1.4, 'Hard']], (v) => { if (this.game) this.game.difficulty = v; }));
        row('Speed units', select('speedUnits', [['mph', 'MPH'], ['kmh', 'KM/H']]));
        row('Controller vibration', check('vibration', (v) => { input.vibration = v; if (v) input.rumble(0.5, 0.5, 160); }), 'Rumble on crashes, gunfire, explosions and hits.');
        row('Button prompts', select('promptStyle', [['auto', 'Automatic (keyboard or Xbox)'], ['xbox', 'Always Xbox'], ['ps', 'PlayStation'], ['kb', 'Always keyboard']], (v) => { input.promptStyle = v; refreshDom(); }), 'Which buttons the on-screen prompts show. Controllers use Xbox buttons unless you pick PlayStation.');
      } else if (cur === 'Controls') {
        const padDev = padDevice();
        const rows = [
          ['{move}', '{move}', 'Move / steer'],
          ['{aim}', '{aim}', 'Aim on foot'],
          ['{fire}', '{fire}', 'Fire on foot'],
          ['{fireCar}', '{fireCar}', 'Drive-by fire'],
          ['{accel} {brake}', '{accel} {brake}', 'Gas / brake and reverse'],
          ['{handbrake}', '{handbrake}', 'Handbrake · climb or land (helicopter)'],
          ['{sprint}', '{sprint}', 'Sprint (on foot)'],
          ['{enter}', '{enter}', 'Enter or steal a vehicle · exit · shop · save'],
          ['{weapons}', '{weapons}', 'Switch weapon'],
          ['{radio}', '{radio}', 'Next radio station (in vehicles)'],
          ['{reload}', '{reload}', 'Reload (on foot)'],
          ['{horn}', '{horn}', 'Horn · siren in emergency vehicles'],
          ['{phone}', '{phone}', 'Catch a ride (safehouse) · skip a long drive · retry · vehicle jobs'],
          ['{map}', '{map}', 'Map'],
          ['{pause}', '{pause}', 'Pause'],
          ['{skip}', '{skip}', 'Skip a line of dialogue'],
        ];
        if (input.lastDevice === 'touch') {
          body.appendChild($(`<div class="keys touch-help">${rows.map(([k, , what]) =>
            `<span>${glyphHtml(k, 'touch')}</span><span>${what}</span>`).join('')}</div>`));
          body.appendChild($('<p class="hint">Push the stick to its rim to sprint. Drag Attack to aim. On the map, drag to pan, pinch to zoom and tap to set a waypoint.</p>'));
          return;
        }
        const name = padDev === 'ps' ? 'PlayStation controller' : 'Xbox controller';
        body.appendChild($(`<div class="keys3"><b class="hd">Keyboard &amp; mouse</b><b class="hd">${name}${input.gamepad ? '' : ' (none connected)'}</b><span class="hd"></span>
          ${rows.map(([k, p, what]) => `<span>${glyphHtml(k, 'kb')}</span><span>${glyphHtml(p, padDev)}</span><span>${what}</span>`).join('')}
        </div>`));
        body.appendChild($(`<div class="hint" style="margin-top:10px">Menus: ${glyphHtml('{select}', padDev)} move · ${glyphHtml('{confirm}', padDev)} select · ${glyphHtml('{back}', padDev)} back · ${glyphHtml('{tabs}', padDev)} switch tabs · right stick scrolls · ${glyphHtml('{pan}', padDev)} ${glyphHtml('{zoomIn}', padDev)} ${glyphHtml('{zoomOut}', padDev)} pan and zoom the map.</div>`));
      }
    };
    render();
    el.querySelector('[data-a=close]').onclick = () => { this.click(); this.pop(); onClose && onClose(); };
    el.querySelector('[data-a=reset]').onclick = () => { settings.reset(); this.click(); render(); };
    el.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') { e.stopPropagation(); this.pop(); onClose && onClose(); }
      if ((e.code === 'KeyQ' || e.code === 'KeyE') && e.isTrusted) { const i = tabs.indexOf(cur); cur = tabs[(i + (e.code === 'KeyE' ? 1 : -1) + tabs.length) % tabs.length]; this.click(); render(); const on = el.querySelector('.tabs .on'); if (on) on.focus(); }
    });
    return this.push(el, '{tabs} Tabs|{select} Move|{confirm} Change|{back} Done');
  }

  // ---------------------------------------------------------------- shop
  openShop(sv) {
    const g = this.game;
    if (!g || this.open) return;
    g.paused = true;
    const el = $(`<div class="screen"><div class="menu" style="width:min(640px,94vw)"><h1>OKIE <span>ARMS & AMMO</span></h1><div class="sub">${sv.name} — Cash: <b class="cash"></b></div><div class="list"></div><div class="btnbar"><button class="btn" data-a="close">Leave</button></div></div></div>`);
    const list = el.querySelector('.list');
    const p = g.player.ped;
    const items = [['armor', 'Body Armor', 450], ['health', 'First Aid', 150]];
    const chapterGate = { minigun: 7, rocket: 6, flamer: 5, sniper: 4, rifle: 3, revolver: 2, grenade: 2, molotov: 2 };
    const render = () => {
      el.querySelector('.cash').textContent = fmtMoney(g.player.money);
      list.innerHTML = '';
      for (const id of WEAPON_ORDER) {
        const w = WEAPONS[id];
        if (!w.price) continue;
        const gate = chapterGate[id] || 1;
        const locked = g.missions && g.missions.chapter < gate;
        const owned = p.hasWeapon(id) && w.type !== 'melee';
        const price = owned ? w.ammoPrice : w.price;
        const r = $(`<div class="row"><label>${w.name}<div class="hint">${locked ? `Unlocks in chapter ${gate}` : owned ? `Ammo +${w.clip > 1 ? w.clip * 3 : 5}` : w.type}</div></label><div><button class="btn ${g.player.money >= price && !locked ? '' : 'ghost'}">${owned ? 'Ammo' : 'Buy'} $${price}</button></div></div>`);
        const b = r.querySelector('button');
        b.disabled = locked;
        b.onclick = () => {
          if (g.player.money < price) { g.audio.play('empty_click'); return; }
          g.player.addMoney(-price);
          p.give(id, w.clip > 1 ? w.clip * 3 : w.type === 'melee' ? 0 : 5);
          if (!owned) p.weapon = id;
          g.audio.play('cash'); render();
        };
        list.appendChild(r);
      }
      for (const [k, name, price] of items) {
        const r = $(`<div class="row"><label>${name}</label><div><button class="btn ${g.player.money >= price ? '' : 'ghost'}">Buy $${price}</button></div></div>`);
        r.querySelector('button').onclick = () => { if (g.player.money < price) return; g.player.addMoney(-price); if (k === 'armor') p.armor = 100; else p.health = p.maxHealth; g.audio.play('pickup_armor'); render(); };
        list.appendChild(r);
      }
    };
    render();
    const close = () => { this.pop(); g.paused = false; };
    el.querySelector('[data-a=close]').onclick = close;
    el.addEventListener('keydown', (e) => { if (e.code === 'Escape') { e.stopPropagation(); close(); } });
    this.push(el);
  }

  // ---------------------------------------------------------------- rides (fast travel from a safehouse)
  openRides(from) {
    const g = this.game;
    if (!g || this.open) return;
    g.paused = true;
    const dests = [];
    for (const sv of g.services) if (sv.type === 'safehouse' && sv !== from && g.isSafehouseUnlocked(sv)) dests.push({ name: sv.name, x: sv.x, y: sv.y, kind: 'Safehouse' });
    const M = g.missions;
    if (M) {
      const seen = new Set();
      for (const m of M.available()) {
        const p = M.place(m.start);
        const k = Math.round(p.x / 50) + ',' + Math.round(p.y / 50);
        if (seen.has(k)) continue; seen.add(k);
        const who = (M.story.CAST[m.giver] || {}).name || m.giver;
        dests.push({ name: `${who}: “${m.title}”`, x: p.x + 6, y: p.y + 6, kind: 'Story contact' });
      }
    }
    const el = $(`<div class="screen"><div class="menu" style="width:min(640px,94vw)"><h1>CATCH A <span>RIDE</span></h1><div class="sub">A cousin with a pickup drops you at any safehouse or story contact. Cash: <b class="cash"></b></div><div class="list"></div><div class="btnbar"><button class="btn" data-a="close">Stay here</button></div></div></div>`);
    el.querySelector('.cash').textContent = fmtMoney(g.player.money);
    const list = el.querySelector('.list');
    const close = () => { this.pop(); g.paused = false; };
    if (!dests.length) list.appendChild($(`<div class="row"><label>Nowhere else to go yet.<div class="hint">More safehouses unlock as the story moves on.</div></label></div>`));
    for (const d of dests) {
      const km = Math.hypot(d.x - from.x, d.y - from.y) / 1000;
      const cost = Math.round(20 + km * 6);
      const mins = Math.max(5, Math.round(km * 1.4));
      const r = $(`<div class="row"><label>${d.name}<div class="hint">${d.kind} · ${km.toFixed(1)} km · about ${mins} min</div></label><div><button class="btn ${g.player.money >= cost ? '' : 'ghost'}">Go $${cost}</button></div></div>`);
      r.querySelector('button').onclick = () => {
        if (g.player.money < cost) { g.audio.play('empty_click'); return; }
        g.player.addMoney(-cost);
        this.click();
        close();
        g.fastTravel(d.x, d.y, mins, d.name);
      };
      list.appendChild(r);
    }
    el.querySelector('[data-a=close]').onclick = close;
    el.addEventListener('keydown', (e) => { if (e.code === 'Escape') { e.stopPropagation(); close(); } });
    this.push(el);
  }

  // ---------------------------------------------------------------- map
  openMap() {
    const g = this.game;
    if (!g) return;
    g.paused = true;
    const mv = new MapView(g, this);
    const el = mv.el;
    el._onclose = () => { mv.destroy(); g.paused = false; };
    this.push(el);
    mv.start();
  }

  // ---------------------------------------------------------------- stats / story / garage
  statsScreen() {
    const g = this.game, st = g.player.stats;
    const seen = Object.keys(st.vehiclesSeen || {}).length;
    const rows = [['Story chapter', `${Math.min(g.missions.chapter, 8)} / 8`], ['Missions passed', st.missions], ['Money', fmtMoney(g.player.money)], ['People wasted', st.kills], ['Cops wasted', st.copsKilled], ['Vehicles stolen', st.carsStolen], ['Vehicles destroyed', st.carsDestroyed], ['Vehicle models driven', `${seen} / ${g.assets.vehicles.length}`], ['Hidden packages', `${st.packages} / ${g.packages.length}`], ['Times busted', st.busted], ['Times wasted', st.wasted], ['Shots fired', st.shots], ['Distance travelled', `${(st.distance / 1609).toFixed(1)} mi`], ['Day', g.day]];
    const el = $(`<div class="screen"><div class="menu"><h1>STATS</h1><div class="stats">${rows.map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('')}</div><div class="btnbar"><button class="btn">Back</button></div></div></div>`);
    el.querySelector('.btn').onclick = () => { this.click(); this.pop(); };
    el.addEventListener('keydown', (e) => { if (e.code === 'Escape') { e.stopPropagation(); this.pop(); } });
    this.push(el);
  }
  storyScreen() {
    return storyJournal(this);
  }
  garageScreen() {
    const g = this.game;
    const seen = g.player.stats.vehiclesSeen || {};
    const el = $(`<div class="screen"><div class="menu" style="width:min(980px,96vw)"><h1>VEHICLE <span>REGISTRY</span></h1><div class="sub">${Object.keys(seen).length} of ${g.assets.vehicles.length} driven. Steal them all.</div><div class="garage"></div><div class="btnbar"><button class="btn">Back</button></div></div></div>`);
    const box = el.querySelector('.garage');
    for (const v of g.assets.vehicles) {
      const card = $(`<div class="car ${seen[v.id] ? 'seen' : 'unseen'}"><canvas width="120" height="90"></canvas><div>${seen[v.id] ? (v.make ? v.make + ' ' : '') + v.name : '???'}</div><div class="hint">${v.class || v.kind}</div></div>`);
      const cv = card.querySelector('canvas');
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      const spr = g.assets.vehicleSprite(v);
      const k = Math.min(2.2, 70 / Math.max(v.h, v.w * 1.5, 10));
      spr.drawPreview(ctx, 60, 54, 0.6, k, 0.7, 1);
      if (!seen[v.id]) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(0, 0, 120, 90); }
      box.appendChild(card);
    }
    el.querySelector('.btn').onclick = () => { this.click(); this.pop(); };
    el.addEventListener('keydown', (e) => { if (e.code === 'Escape') { e.stopPropagation(); this.pop(); } });
    this.push(el);
  }
  showCredits() {
    const el = $(`<div class="screen"><div class="menu"><h1>TULSA <span>OVERHEAD</span></h1><div class="sub">OKLAHOMA</div>
      <p>An original open-world crime game set in a real-scale Tulsa metro — Tulsa, Broken Arrow, Glenpool, Catoosa and Tulsa, Osage, Pawnee, Creek, Okmulgee, Wagoner, Rogers and Washington counties.</p>
      <p class="hint">Map data <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> (<a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL</a>). Buildings from Overture, Microsoft and GT Tulsa. Terrain elevations and roof surveys from USGS 3DEP. Ground and roof imagery from USDA NAIP (2025). Ground material scans from Poly Haven (CC0). Tree placements adapted from Meta/WRI canopy heights (CC BY 4.0). Sprite stacking by github.com/danielwh2/sprite-stacking (MIT). Voices generated with Qwen3-TTS. <a href="https://github.com/nearbycoder/tulsa-overhead#credits" target="_blank" rel="noopener">Full credits and map downloads</a>. All characters, vehicles, brands and events are fictional.</p>
      <div class="btnbar"><button class="btn">Close</button></div></div></div>`);
    el.querySelector('.btn').onclick = () => { this.click(); this.pop(); };
    el.addEventListener('keydown', (e) => { if (e.code === 'Escape') { e.stopPropagation(); this.pop(); } });
    this.push(el);
  }
}

// ------------------------------------------------------------------ dialogue box with voice playback
class Dialog {
  constructor(ui) {
    this.ui = ui;
    this.el = $('<div class="dialog" style="display:none"><div class="who"></div><div class="what"></div><div class="skip" data-g="{skip} skip"></div><button type="button" class="dialog-next" aria-label="Skip dialogue line">Next ›</button></div>');
    document.body.appendChild(this.el);
    this.el.addEventListener('click', e => {
      if (e.target.closest('.dialog-next') || input.lastDevice === 'touch') this.skip();
    });
    this.cancel = null;
    this.active = false;
    this._skip = null;
  }
  hide() { this.cancel?.(); }
  skip() { this._skip?.(); }
  update(dt) {
    if (this.remaining == null || !this.active) return;
    this.remaining -= dt;
    if (this.remaining <= 0) this.cancel();
  }
  say(who, text, opts = {}) {
    this.hide();
    const g = this.ui.game, audio = this.ui.audio;
    const run = g?.missions?.active;
    if (run) {
      run.transcript ??= [];
      run.transcript.push({ who, text });
    }
    if (g) g.dialogActive = true;
    const readingTime = 1.4 + text.length * 0.052;
    const hasVoice = !!(opts.voice && audio?.playVoice);
    this.el.classList.toggle('captions-off', !settings.get('subtitles') && hasVoice);
    this.el.style.display = 'block';
    this.el.querySelector('.who').textContent = who;
    this.el.querySelector('.who').style.color = opts.color || '';
    this.el.querySelector('.what').textContent = text;
    this.active = true;
    this.remaining = null;
    refreshDom(this.el);
    return new Promise(resolve => {
      const finish = () => {
        if (this.cancel !== finish) return;
        this.cancel = null;
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('pointerdown', onKey, true);
        if (hasVoice) audio.stopVoice('dialogue');
        this.el.style.display = 'none';
        if (g) g.dialogActive = false;
        this.active = false;
        this._skip = null;
        this.remaining = null;
        resolve();
      };
      const readyToSkip = performance.now() + 400;
      this._skip = () => {
        if (performance.now() >= readyToSkip && !g?.paused && !this.ui.open && !document.hidden) finish();
      };
      const onKey = e => {
        if (!e.repeat && (e.pointerType === 'mouse' || e.code === 'Space' || e.code === 'Enter')) this.skip();
      };
      this.cancel = finish;
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('pointerdown', onKey, true);
      const readCaption = () => {
        if (this.cancel !== finish) return;
        this.el.classList.remove('captions-off');
        this.el.style.display = 'block';
        this.remaining = readingTime;
      };
      if (hasVoice) {
        audio.playVoice(opts.voice, { channel: 'dialogue' }).then(natural => {
          if (this.cancel !== finish) return;
          if (natural) this.remaining = 0.35;
          else readCaption();
        }, readCaption);
      } else readCaption();
    });
  }
}
