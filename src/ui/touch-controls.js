// Pointer capture lets the left thumb steer while the right thumb aims or works a pedal.
import { input } from '../engine/input.js';

const foot = [['enter', 'Use'], ['nextWeapon', 'Weapon'], ['fire', 'Attack']];
const driving = [['enter', 'Exit'], ['fire', 'Attack'], ['handbrake', 'Skid'], ['brake', 'Brake'], ['accel', 'Gas']];
const flying = [['enter', 'Exit'], ['fire', 'Attack'], ['handbrake', 'Lift'], ['brake', 'Back'], ['accel', 'Forward']];

function button(action, text) {
  const node = document.createElement('button');
  node.type = 'button';
  node.dataset.action = action;
  node.textContent = text;
  if (action === 'fire') node.setAttribute('aria-label', 'Attack. Hold and drag to aim');
  return node;
}

export class TouchControls {
  constructor() {
    const root = this.root = document.createElement('div');
    root.className = 'touch-controls';
    root.hidden = true;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Gameplay controls');
    root.innerHTML = `<div class="touch-tools"><button type="button" data-action="map">Map</button>
      <button type="button" data-action="pause">Menu</button><button type="button" data-action="more" aria-expanded="false" aria-controls="touch-more">More</button></div>
      <div class="touch-more" id="touch-more" hidden></div>
      <div class="touch-stick" data-action="move" role="group" aria-label="Movement stick">
        <span class="touch-thumb"></span><span class="touch-stick-label">Move</span></div>
      <div class="touch-buttons"></div>`;
    document.body.append(root);
    this.stick = root.querySelector('.touch-stick');
    this.thumb = root.querySelector('.touch-thumb');
    this.stickLabel = root.querySelector('.touch-stick-label');
    this.actions = root.querySelector('.touch-buttons');
    this.more = root.querySelector('.touch-more');
    this.moreButton = root.querySelector('[data-action=more]');
    this.held = new Map();
    root.addEventListener('pointerdown', e => this.start(e));
    root.addEventListener('pointermove', e => this.move(e));
    root.addEventListener('pointerup', e => this.finish(e, false));
    root.addEventListener('pointercancel', e => this.finish(e, true));
    root.addEventListener('lostpointercapture', e => this.finish(e, true));
    root.addEventListener('contextmenu', e => e.preventDefault());
    // A screen reader can activate a button without producing a pointer sequence.
    root.addEventListener('click', e => {
      if (e.detail !== 0 || this.root.hidden) return;
      const action = e.target.closest('button')?.dataset.action;
      if (action === 'more') this.showMore(this.more.hidden);
      else if (action) input.pressed.add('TOUCH_' + action);
    });
    const cancel = () => this.reset();
    window.addEventListener('blur', cancel);
    window.addEventListener('pagehide', cancel);
    window.addEventListener('resize', cancel);
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
    input.onDeviceChange(d => { if (d !== 'touch') this.setMode('off'); });
  }

  sync(game, ui) {
    let mode = 'off';
    if (input.lastDevice === 'touch' && game?.player && !ui.open && !game.paused && !document.hidden) {
      mode = game.controlsLocked || game.respawning || game.player.ped.dead ? 'locked'
        : game.player.vehicle?.isHeli ? 'heli' : game.player.vehicle ? 'drive' : 'foot';
    }
    if (mode !== this.mode) this.setMode(mode);
    if (mode === 'heli') {
      const lift = (game.player.vehicle.heliAltTarget ?? 38) > 0 ? 'Land' : 'Lift';
      if (this.lift.textContent !== lift) this.lift.textContent = lift;
    }
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.reset();
    this.mode = mode;
    this.root.hidden = mode === 'off';
    document.body.classList.toggle('touch-playing', mode !== 'off');
    if (mode === 'off') return;
    this.root.dataset.mode = mode;
    this.showMore(false);
    this.moreButton.hidden = mode === 'locked';
    this.stick.hidden = this.actions.hidden = mode === 'locked';
    if (mode === 'locked') return;
    const onFoot = mode === 'foot';
    this.stickLabel.textContent = onFoot ? 'Move' : 'Steer';
    this.stick.setAttribute('aria-label', onFoot ? 'Move. Push to the rim to sprint' : 'Steer. Push up or down to accelerate or reverse');
    const layout = onFoot ? foot : mode === 'heli' ? flying : driving;
    this.actions.replaceChildren(...layout.map(([a, name]) => button(a, name)));
    this.lift = mode === 'heli' ? this.actions.querySelector('[data-action=handbrake]') : null;
    this.more.replaceChildren(button('phone', 'Phone'), button('radio', onFoot ? 'Reload' : 'Radio'));
    if (!onFoot) this.more.append(button('nextWeapon', 'Weapon'), button('horn', 'Horn'));
  }

  showMore(open) {
    this.more.hidden = !open;
    this.moreButton.setAttribute('aria-expanded', String(open));
  }

  press(action) {
    input.touch.held.add(action);
    input.pressed.add('TOUCH_' + action);
  }

  start(e) {
    if (e.pointerType !== 'touch' || this.root.hidden) return;
    const node = e.target.closest('[data-action]');
    if (!node || node.classList.contains('touch-held')) return;
    e.preventDefault();
    const action = node.dataset.action;
    const p = { node, action, x: e.clientX, y: e.clientY, id: e.pointerId };
    this.held.set(p.id, p);
    node.setPointerCapture(p.id);
    node.classList.add('touch-held');
    if (action === 'more') return;
    if (action === 'move') {
      const rect = node.getBoundingClientRect();
      p.x = rect.left + rect.width / 2;
      p.y = rect.top + rect.height / 2;
      p.radius = rect.width * 0.38;
      this.move(e);
    } else if (action === 'fire') {
      // A quick tap attacks straight ahead. Give a drag time to set the first shot's bearing.
      p.timer = setTimeout(() => { if (this.held.has(p.id)) this.press('fire'); }, 130);
    } else this.press(action);
  }

  move(e) {
    const p = this.held.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    const len = Math.hypot(dx, dy);
    if (p.action === 'move') {
      const distance = Math.min(1, len / p.radius);
      const amount = Math.max(0, (distance - 0.1) / 0.9);
      input.touch.x = dx / (len || 1) * amount;
      input.touch.y = dy / (len || 1) * amount;
      input.touch.sprint = this.mode === 'foot' && distance > 0.94;
      const label = this.mode === 'foot' ? input.touch.sprint ? 'Sprint' : 'Move' : 'Steer';
      if (this.stickLabel.textContent !== label) this.stickLabel.textContent = label;
      this.thumb.style.transform = 'translate(' + dx / (len || 1) * distance * p.radius + 'px,' + dy / (len || 1) * distance * p.radius + 'px)';
    } else if (p.action === 'fire' && len > 5) {
      input.touch.aim = { x: dx / len, y: dy / len };
      clearTimeout(p.timer);
      if (!input.touch.held.has('fire')) this.press('fire');
    }
  }

  finish(e, canceled) {
    const p = this.held.get(e.pointerId);
    if (!p) return;
    this.held.delete(p.id);
    clearTimeout(p.timer);
    p.node.classList.remove('touch-held');
    if (p.action === 'move') {
      input.touch.x = input.touch.y = 0;
      input.touch.sprint = false;
      this.thumb.style.transform = '';
      this.stickLabel.textContent = this.mode === 'foot' ? 'Move' : 'Steer';
    } else if (p.action === 'more') {
      if (!canceled) this.showMore(this.more.hidden);
    } else {
      if (!canceled && p.action === 'fire' && !input.touch.held.has('fire')) input.pressed.add('TOUCH_fire');
      if (canceled) input.pressed.delete('TOUCH_' + p.action);
      input.touch.held.delete(p.action);
      if (p.action === 'fire') {
        input.touch.tapAim = !canceled && input.pressed.has('TOUCH_fire') ? input.touch.aim : null;
        input.touch.aim = null;
      }
      if (this.more.contains(p.node)) this.showMore(false);
    }
    if (p.node.hasPointerCapture(p.id)) p.node.releasePointerCapture(p.id);
  }

  reset() {
    for (const id of this.held.keys()) this.finish({ pointerId: id }, true);
    for (const k of input.pressed) if (k.startsWith('TOUCH_')) input.pressed.delete(k);
    input.touch.tapAim = null;
  }
}
