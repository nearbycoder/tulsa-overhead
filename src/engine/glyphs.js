// Button prompts that follow the active input device. Text uses {action} tokens, e.g.
// "Press {enter} to steal it" → a keycap "F" on keyboard, a yellow "Y" (Xbox) or "△" (PlayStation) on a pad.
import { input } from './input.js';

// Keyboard & mouse labels
const KB = {
  enter: 'F', fire: ['Ctrl', 'LMB'], fireCar: ['Ctrl', 'LMB'], aim: 'Mouse', move: 'WASD', steer: ['A', 'D'], accel: 'W', brake: 'S',
  handbrake: 'Space', sprint: 'Shift', phone: 'T', map: 'M', pause: 'Esc', radio: 'R', reload: 'R', horn: 'H',
  next: 'E', prev: 'Q', weapons: ['Q', 'E'], skip: 'Space', confirm: 'Enter', back: 'Esc', climb: 'Space', lookBehind: 'C',
  findPlace: '/', centerMap: 'Home', tabs: ['Q', 'E'], pan: 'WASD', zoomIn: 'Wheel', zoomOut: 'Wheel', waypoint: 'Click', select: ['↑', '↓'],
};
// Labels on the touchscreen controls.
const TOUCH = {
  enter: 'Use', fire: 'Attack', fireCar: 'Attack', aim: 'Drag Attack', move: 'Stick', steer: 'Stick', accel: 'Gas', brake: 'Brake',
  handbrake: 'Skid', sprint: 'Stick rim', phone: 'Phone', map: 'Map', pause: 'Menu', radio: 'Radio', reload: 'Reload', horn: 'Horn',
  next: 'Weapon', prev: 'Weapon', weapons: 'Weapon', skip: 'Tap', confirm: 'Tap', back: 'Back', climb: 'Lift', lookBehind: 'Stick',
  findPlace: 'Search', centerMap: 'Center', tabs: 'Tap', pan: 'Drag', zoomIn: 'Pinch', zoomOut: 'Pinch', waypoint: 'Tap', select: 'Tap',
};
// Xbox / generic standard-mapping pad
const XB = {
  enter: 'Y', fire: 'RT', fireCar: 'RB', aim: 'RS', move: 'LS', steer: 'LS', accel: 'RT', brake: 'LT',
  handbrake: 'A', sprint: 'A', phone: 'D↓', map: 'View', pause: 'Menu', radio: 'D↑', reload: 'X', horn: 'B',
  next: 'D→', prev: 'D←', weapons: ['D←', 'D→'], skip: 'A', confirm: 'A', back: 'B', climb: 'A', lookBehind: 'RS',
  findPlace: 'X', centerMap: 'Y', tabs: ['LB', 'RB'], pan: 'LS', zoomIn: 'RT', zoomOut: 'LT', waypoint: 'A', select: 'LS',
};
// PlayStation names for the same physical buttons
const PS_NAMES = { Y: '△', A: '✕', B: '○', X: '□', RT: 'R2', LT: 'L2', RB: 'R1', LB: 'L1', View: 'Create', Menu: 'Options', LS: 'L', RS: 'R' };
// Nintendo Pro Controller: labels swap A/B and X/Y in position
const NS_NAMES = { Y: 'X', A: 'B', B: 'A', X: 'Y', RT: 'ZR', LT: 'ZL', RB: 'R', LB: 'L', View: '−', Menu: '+', LS: 'LS', RS: 'RS' };

// Controllers show Xbox buttons unless PlayStation is picked in Settings → Gameplay → Button prompts.
export function device() {
  const ps = input.promptStyle;
  if (ps && ps !== 'auto') return ps;
  if (input.lastDevice === 'touch') return 'touch';
  return input.usingPad ? 'xbox' : 'kb';
}
export function padDevice() { return input.promptStyle === 'ps' ? 'ps' : 'xbox'; }

// labels (array) for an action on the current device
export function labels(action, dev = device()) {
  let v = (dev === 'touch' ? TOUCH : dev === 'kb' ? KB : XB)[action];
  if (dev === 'touch' && action === 'enter' && input.context === 'car') v = 'Exit';
  if (v == null) return [action];
  if (!Array.isArray(v)) v = [v];
  if (dev === 'ps') v = v.map((l) => PS_NAMES[l] || l);
  else if (dev === 'nintendo') v = v.map((l) => NS_NAMES[l] || l);
  return v;
}

// visual style for one label
const FACE = { A: '#5fb34a', B: '#d8463c', X: '#3d7fd9', Y: '#e8b631', '✕': '#7ea6e8', '○': '#e86a6a', '□': '#d98cc4', '△': '#45c3a0' };
export function style(label, dev = device()) {
  if (dev === 'kb' || dev === 'touch') return { kind: 'key' };
  if (dev === 'nintendo' && /^[ABXY]$/.test(label)) return { kind: 'face', col: '#e9e4d6' };
  if (FACE[label]) return { kind: 'face', col: FACE[label] };
  if (/^D[↑↓←→]$/.test(label)) return { kind: 'dpad' };
  if (/^(LS|RS|L|R)$/.test(label) && dev !== 'nintendo') return { kind: 'stick' };
  if (/^(LS|RS)$/.test(label)) return { kind: 'stick' };
  return { kind: 'shoulder' };
}
const shown = (l) => (/^D[↑↓←→]$/.test(l) ? l.slice(1) : l);

// split "Press {enter} to go" into text and button runs
export function tokenize(str, dev = device()) {
  const out = [];
  const re = /\{([a-zA-Z]+)\}/g;
  let last = 0, m;
  while ((m = re.exec(str))) {
    if (m.index > last) out.push({ t: 'text', s: str.slice(last, m.index) });
    const ls = labels(m[1], dev);
    ls.forEach((l, i) => { if (i) out.push({ t: 'text', s: '/' }); out.push({ t: 'btn', label: l, st: style(l, dev) }); });
    last = re.lastIndex;
  }
  if (last < str.length) out.push({ t: 'text', s: str.slice(last) });
  return out;
}
export const hasTokens = (s) => typeof s === 'string' && /\{[a-zA-Z]+\}/.test(s);

// plain-text version (for logs or places that can't draw badges)
export function plain(str) { return tokenize(str).map((p) => (p.t === 'text' ? p.s : shown(p.label))).join(''); }

// HTML version with styled badges
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function html(str, dev = device()) {
  const parts = tokenize(str, dev);
  if (!parts.some((p) => p.t === 'btn')) return esc(str);
  return `<span class="gline">${parts.map((p) => {
    if (p.t === 'text') return p.s === '/' ? '<span class="gsep">/</span>' : `<span class="gtx">${esc(p.s)}</span>`;
    const k = p.st.kind;
    const col = p.st.col ? ` style="--gc:${p.st.col}"` : '';
    return `<span class="gl gl-${k}"${col}>${esc(shown(p.label))}</span>`;
  }).join('')}</span>`;
}

// device-specific choice: pick('Drag to pan', '{pan} pan')
export function pick(kbText, padText) { return device() === 'kb' ? kbText : padText; }

// menu footer: "{confirm} Select|{back} Back" → evenly spaced [button + label] groups on one centre line
export function hintHtml(str, dev = device()) {
  return str.split('|').map((part) => {
    const m = part.trim().match(/^((?:\{[a-zA-Z]+\}\s*)+)(.*)$/);
    if (!m) return `<span class="hgrp"><span class="hlab">${esc(part.trim())}</span></span>`;
    const btns = tokenize(m[1].replace(/\s+/g, ''), dev).map((p) => (p.t === 'text' ? '<span class="gsep">/</span>' : `<span class="gl gl-${p.st.kind}"${p.st.col ? ` style="--gc:${p.st.col}"` : ''}>${esc(shown(p.label))}</span>`)).join('');
    return `<span class="hgrp"><span class="hbtn">${btns}</span><span class="hlab">${esc(m[2].trim())}</span></span>`;
  }).join('');
}

// Elements marked data-g="template" (or data-gkb / data-gpad pairs, or data-ghint) re-render whenever the device changes.
export function refreshDom(root = document) {
  for (const el of root.querySelectorAll('[data-ghint]')) el.innerHTML = hintHtml(el.dataset.ghint);
  for (const el of root.querySelectorAll('[data-g], [data-gkb]')) {
    const t = el.dataset.gkb != null ? (device() === 'kb' ? el.dataset.gkb : el.dataset.gpad) : el.dataset.g;
    el.innerHTML = html(t || '');
  }
  document.body.classList.toggle('pad', input.usingPad);
}
input.onDeviceChange(() => refreshDom());

// ---- canvas drawing (HUD)
// measure / draw a token string on a 2D canvas at font size `size`
function badgeW(c, p, size) {
  const l = shown(p.label), k = p.st.kind;
  c.save(); c.font = `bold ${Math.round(size * 0.72)}px "Trebuchet MS", system-ui, sans-serif`;
  const tw = c.measureText(l).width;
  c.restore();
  if (k === 'face' || k === 'stick' || (k === 'dpad')) return Math.max(size * 1.05, tw + size * 0.5);
  return tw + size * 0.62;
}
export function measure(c, str, size, font) {
  c.font = `${Math.round(size)}px ${font}`;
  let w = 0;
  for (const p of tokenize(str)) w += p.t === 'text' ? c.measureText(p.s).width : badgeW(c, p, size) + size * 0.16;
  return w;
}
function drawBadge(c, p, x, y, size) {
  const l = shown(p.label), k = p.st.kind, w = badgeW(c, p, size), h = size * 1.02;
  const cx = x + w / 2, cy = y - size * 0.34;
  c.save();
  c.lineWidth = Math.max(1, size * 0.08);
  if (k === 'face') {
    const r = h / 2;
    c.fillStyle = '#16140f'; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = p.st.col; c.stroke();
    c.fillStyle = p.st.col;
  } else if (k === 'stick') {
    const r = h / 2;
    c.fillStyle = '#2a2722'; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#d9d2bf'; c.stroke();
    c.beginPath(); c.arc(cx, cy, r * 0.62, 0, Math.PI * 2); c.strokeStyle = '#8a8476'; c.stroke();
    c.fillStyle = '#f4ead2';
  } else if (k === 'key') {
    const rr = size * 0.18;
    rrect(c, x, cy - h / 2, w, h, rr); c.fillStyle = '#ece4cf'; c.fill();
    c.strokeStyle = '#7d745f'; c.stroke();
    c.fillStyle = '#1b1812';
  } else {
    // shoulder buttons, triggers, d-pad, system buttons: dark rounded pill
    rrect(c, x, cy - h / 2, w, h, k === 'dpad' ? size * 0.16 : h / 2); c.fillStyle = '#2a2722'; c.fill();
    c.strokeStyle = '#d9d2bf'; c.stroke();
    c.fillStyle = '#f4ead2';
  }
  c.font = `bold ${Math.round(size * (k === 'face' && /[✕○□△]/.test(l) ? 0.62 : 0.72))}px "Trebuchet MS", system-ui, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(l, cx, cy + size * 0.02);
  c.restore();
  return w;
}
function rrect(c, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
// draw rich text; align = left | center | right; textFn draws a text run (keeps the HUD's outline style)
export function drawRich(c, str, x, y, size, font, align, textFn) {
  const total = measure(c, str, size, font);
  let px = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  for (const p of tokenize(str)) {
    if (p.t === 'text') { c.font = `${Math.round(size)}px ${font}`; textFn(p.s, px, y); px += c.measureText(p.s).width; }
    else { px += size * 0.08; px += drawBadge(c, p, px, y, size); px += size * 0.08; }
  }
  return total;
}
