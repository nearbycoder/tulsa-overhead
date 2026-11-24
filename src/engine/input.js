// Keyboard, mouse and gamepad input mapped to game actions, plus controller menu navigation,
// device detection (keyboard vs Xbox-style vs PlayStation-style pad) and rumble.
export const BINDINGS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  fire: ['ControlLeft', 'ControlRight', 'KeyJ'],
  handbrake: ['Space'],
  enter: ['KeyF', 'Enter'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  horn: ['KeyH'],
  nextWeapon: ['KeyE', 'BracketRight'],
  prevWeapon: ['KeyQ', 'BracketLeft'],
  radio: ['KeyR'],
  map: ['KeyM', 'Tab'],
  pause: ['Escape', 'KeyP'],
  lookBehind: ['KeyC'],
  jump: ['KeyX'],
  skip: ['Space', 'Enter'],
  phone: ['KeyT'],
  camera: ['KeyV'],
};

// Standard-mapping gamepad button indices
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

// what kind of pad is this? (only affects which button names we show)
function padType(id = '') {
  if (/xbox|045e|xinput/i.test(id)) return 'xbox';
  if (/054c|dualsense|dualshock|playstation|ps[345]|^wireless controller/i.test(id)) return 'ps';
  if (/057e|nintendo|pro controller|joy-con/i.test(id)) return 'nintendo';
  return 'xbox';
}

// Track movement away from rest, including slow stick travel over several frames.
// A spring returning to centre after the player picks up the mouse is a release.
function movedOutward(levels, index, value, tracking) {
  const previous = levels[index];
  const moved = previous !== undefined && Math.abs(value) > 0.2 && Math.sign(value) * (value - previous) > 0.2;
  if (previous === undefined || tracking || moved || Math.abs(value) < Math.abs(previous) || value * previous < 0) {
    levels[index] = value;
  }
  return moved;
}

class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();   // edge-triggered this frame
    this.mouse = { x: 0, y: 0, down: false, right: false, clicked: false, wheel: 0, moved: false, lastMove: 0 };
    this.gamepad = null;
    this.padActivity = new Map();
    this.padDiscoveryAt = 0;
    this.gpPrev = {};
    this.gpState = null;
    this.enabled = true;
    this._device = 'kb';        // 'kb' | 'gp' | 'touch'
    this.touch = { x: 0, y: 0, aim: null, tapAim: null, sprint: false, held: new Set() };
    this.padKind = 'xbox';      // 'xbox' | 'ps' | 'nintendo'
    this.context = 'foot';      // 'foot' | 'car' (set by the player controller each frame)
    this.target = null;
    this.listeners = new Set();
    this.nav = new Set();       // menu navigation edges this frame: up down left right a b x y lb rb start select
    this.navHeld = {};          // direction -> {t, next} for auto-repeat
    this.rumbleUntil = 0;
  }
  get lastDevice() { return this._device; }
  set lastDevice(d) {
    if (d === this._device) return;
    this._device = d;
    for (const fn of this.listeners) { try { fn(d, this.padKind); } catch (e) { /* ignore */ } }
  }
  get usingPad() { return this._device === 'gp'; }
  onDeviceChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  attach(el) {
    this.target = el;
    this.onDeviceChange(d => document.body.classList.toggle('touch-input', d === 'touch'));
    if (window.matchMedia('(pointer: coarse)').matches) this.lastDevice = 'touch';
    window.addEventListener('pointerdown', e => {
      if (e.isTrusted) this.lastDevice = e.pointerType === 'touch' ? 'touch' : 'kb';
    }, true);
    window.addEventListener('keydown', (e) => {
      if (!e.isTrusted) return; // synthetic events (controller menu navigation) never touch game state
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      this.lastDevice = 'kb';
    });
    window.addEventListener('keyup', (e) => { this.down.delete(e.code); });
    window.addEventListener('blur', () => { this.down.clear(); this.mouse.down = false; this.mouse.right = false; });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const r = el.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) / r.width;
      this.mouse.y = (e.clientY - r.top) / r.height;
      this.mouse.moved = true;
      this.mouse.lastMove = performance.now();
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this.lastDevice = 'kb';
    });
    window.addEventListener('pointerdown', (e) => {
      if (!e.isTrusted || e.pointerType === 'touch') return;
      if (e.target !== el) return;
      if (e.button === 0) { this.mouse.down = true; this.mouse.clicked = true; }
      if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return;
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.right = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    window.addEventListener('gamepadconnected', () => {
      this.padDiscoveryAt = 0;
      for (const fn of this.listeners) { try { fn(this.lastDevice, this.padKind, 'connected'); } catch (err) { /* ignore */ } }
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      this.padActivity.delete(e.gamepad.index);
      if (this.usingPad && this.gamepad?.index === e.gamepad.index) this.lastDevice = window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'kb';
      for (const fn of this.listeners) { try { fn(this.lastDevice, this.padKind, 'disconnected'); } catch (err) { /* ignore */ } }
    });
  }

  pollGamepad(dt = 1 / 60) {
    if (!this.gamepad && performance.now() < this.padDiscoveryAt) return;
    let pads;
    try { pads = navigator.getGamepads?.() || []; }
    catch { pads = []; } // The embedding page may disable the Gamepad API.
    const previous = this.gamepad;
    let available = null, used = null;
    for (const [index] of this.padActivity) if (!pads[index]?.connected) this.padActivity.delete(index);
    for (const pad of pads) {
      if (!pad?.connected) continue;
      const same = pad.index === previous?.index && pad.id === previous?.id;
      if (same || !available) available = pad;
      let state = this.padActivity.get(pad.index);
      if (!state || state.id !== pad.id) {
        state = { id: pad.id, buttons: [], pressed: [], axes: [] };
        this.padActivity.set(pad.index, state);
      }
      const tracking = same && this.usingPad;
      let moved = false;
      for (let i = 0; i < pad.buttons.length; i++) {
        const button = pad.buttons[i];
        if (movedOutward(state.buttons, i, button.value, tracking) || (button.pressed && state.pressed[i] === false)) moved = true;
        state.pressed[i] = button.pressed;
      }
      for (let i = 0; i < pad.axes.length; i++) {
        if (movedOutward(state.axes, i, pad.axes[i], tracking)) moved = true;
      }
      if (moved) used = pad;
    }
    this.gamepad = used || available;
    if (this.gamepad?.index !== previous?.index || this.gamepad?.id !== previous?.id) {
      this.gpPrev = {};
      this.navHeld = {};
      if (!used && this.usingPad) this.lastDevice = window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'kb';
    }
    this.nav.clear();
    if (!this.gamepad) {
      this.gpState = null;
      this.padDiscoveryAt = performance.now() + 1000;
      return;
    }
    const g = this.gamepad;
    const kind = padType(g.id);
    if (kind !== this.padKind) { this.padKind = kind; for (const fn of this.listeners) { try { fn(this._device, kind); } catch (e) { /* ignore */ } } }
    if (used) this.lastDevice = 'gp';
    const active = this.usingPad;
    const b = (i) => active && !!(g.buttons[i] && g.buttons[i].pressed);
    const inCar = this.context === 'car';
    // context-aware layout: RT is the gas pedal in a car and the trigger on foot
    const map = {
      fire: inCar ? b(PAD.RB) : (b(PAD.RT) || b(PAD.RB)),
      handbrake: b(PAD.A) || b(PAD.LB),
      sprint: b(PAD.A),
      enter: b(PAD.Y),
      horn: b(PAD.B) || b(PAD.L3),
      nextWeapon: b(PAD.RIGHT),
      prevWeapon: b(PAD.LEFT),
      radio: b(PAD.UP) || b(PAD.X),
      phone: b(PAD.DOWN),
      map: b(PAD.VIEW),
      pause: b(PAD.MENU),
      lookBehind: b(PAD.R3),
      skip: b(PAD.A),
      accel: b(PAD.RT),
      brake: b(PAD.LT),
    };
    for (const [k, v] of Object.entries(map)) {
      if (v && !this.gpPrev[k]) this.pressed.add('GP_' + k);
      this.gpPrev[k] = v;
    }
    this.gpState = active ? map : null;
    // menu navigation: edges for buttons, auto-repeat for the d-pad and left stick
    const btn = { a: PAD.A, b: PAD.B, x: PAD.X, y: PAD.Y, lb: PAD.LB, rb: PAD.RB, start: PAD.MENU, select: PAD.VIEW, rs: PAD.R3, lt: PAD.LT, rt: PAD.RT };
    for (const [k, i] of Object.entries(btn)) {
      const v = b(i);
      if (v && !this.gpPrev['nav_' + k]) this.nav.add(k);
      this.gpPrev['nav_' + k] = v;
    }
    const ax = active ? g.axes[0] || 0 : 0, ay = active ? g.axes[1] || 0 : 0;
    const dirs = { up: b(PAD.UP) || ay < -0.55, down: b(PAD.DOWN) || ay > 0.55, left: b(PAD.LEFT) || ax < -0.55, right: b(PAD.RIGHT) || ax > 0.55 };
    for (const [d, held] of Object.entries(dirs)) {
      const h = this.navHeld[d];
      if (!held) { this.navHeld[d] = null; continue; }
      if (!h) { this.nav.add(d); this.navHeld[d] = { t: 0, next: 0.38 }; continue; }
      h.t += dt;
      if (h.t >= h.next) { this.nav.add(d); h.next += 0.11; }
    }
  }

  // short controller rumble (no-op on keyboard, unsupported pads, or when switched off)
  rumble(strong = 0.5, weak = 0.5, ms = 120) {
    if (!this.usingPad || !this.gamepad || this.vibration === false) return;
    const act = this.gamepad.vibrationActuator;
    if (!act || !act.playEffect) return;
    const now = performance.now();
    if (now < this.rumbleUntil - ms * 0.5 && strong < 0.6) return; // don't stack weak buzzes
    this.rumbleUntil = now + ms;
    try { act.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => { }); } catch (e) { /* ignore */ }
  }

  isDown(action) {
    const keys = BINDINGS[action];
    if (keys) for (const k of keys) if (this.down.has(k)) return true;
    if (action === 'fire' && this.mouse.down) return true;
    if (this.lastDevice === 'touch' && (this.touch.held.has(action) ||
        action === 'sprint' && this.touch.sprint || action === 'fire' && this.pressed.has('TOUCH_fire'))) return true;
    if (this.gpState && this.gpState[action]) return true;
    return false;
  }
  wasPressed(action) {
    const keys = BINDINGS[action];
    if (keys) for (const k of keys) if (this.pressed.has(k)) return true;
    if (this.pressed.has('GP_' + action) || this.pressed.has('TOUCH_' + action)) return true;
    return false;
  }
  // analog axes: returns {x, y} in -1..1 (screen space: +y down)
  moveAxis() {
    let x = 0, y = 0;
    if (this.isDown('left')) x -= 1;
    if (this.isDown('right')) x += 1;
    if (this.isDown('up')) y -= 1;
    if (this.isDown('down')) y += 1;
    if (this.lastDevice === 'touch' && (this.touch.x || this.touch.y)) { x = this.touch.x; y = this.touch.y; }
    const g = this.usingPad ? this.gamepad : null;
    if (g) {
      const ax = g.axes[0] || 0, ay = g.axes[1] || 0;
      if (Math.hypot(ax, ay) > 0.2) { x = ax; y = ay; }
    }
    return { x, y };
  }
  aimAxis() {
    if (this.lastDevice === 'touch') return this.touch.aim || this.touch.tapAim;
    const g = this.usingPad ? this.gamepad : null;
    if (g) {
      const ax = g.axes[2] || 0, ay = g.axes[3] || 0;
      if (Math.hypot(ax, ay) > 0.3) return { x: ax, y: ay };
    }
    return null;
  }
  driveAxes() {
    let throttle = 0, brake = 0, steer = 0;
    if (this.isDown('up')) throttle = 1;
    if (this.isDown('down')) brake = 1;
    if (this.isDown('left')) steer -= 1;
    if (this.isDown('right')) steer += 1;
    if (this.lastDevice === 'touch') {
      if (this.touch.x) steer = this.touch.x;
      throttle = Math.max(throttle, -this.touch.y, this.touch.held.has('accel') ? 1 : 0);
      brake = Math.max(brake, this.touch.y, this.touch.held.has('brake') ? 1 : 0);
    }
    const g = this.usingPad ? this.gamepad : null;
    if (g) {
      const rt = g.buttons[PAD.RT] ? g.buttons[PAD.RT].value : 0, lt = g.buttons[PAD.LT] ? g.buttons[PAD.LT].value : 0;
      if (rt > 0.05) throttle = rt;
      if (lt > 0.05) brake = lt;
      const ax = g.axes[0] || 0;
      if (Math.abs(ax) > 0.15) steer = ax;
    }
    return { throttle, brake, steer };
  }
  // swallow this frame's press of an action so nothing else reacts to it
  consume(action) {
    for (const k of BINDINGS[action] || []) this.pressed.delete(k);
    this.pressed.delete('GP_' + action);
    this.pressed.delete('TOUCH_' + action);
  }
  endFrame() {
    this.pressed.clear();
    this.touch.tapAim = null;
    this.mouse.clicked = false;
    this.mouse.wheel = 0;
    this.mouse.moved = false;
  }
}

export const input = new Input();
