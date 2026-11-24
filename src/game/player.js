// Player controller: on-foot (mouse aim or classic tank controls) and driving.
import { input } from '../engine/input.js';
import { settings } from '../engine/settings.js';
import { WEAPONS, WEAPON_ORDER } from '../data/weapons.js';
import { clamp, wrapAngle } from '../engine/math.js';

export class Player {
  constructor(game, ped) {
    this.game = game;
    this.ped = ped;
    ped.isPlayer = true;
    ped.persist = true;
    ped.maxHealth = 100;
    this.money = 0;
    this.displayMoney = 0;
    this.stats = { kills: 0, copsKilled: 0, carsStolen: 0, carsDestroyed: 0, distance: 0, busted: 0, wasted: 0, missions: 0, shots: 0, rampages: 0, packages: 0, vehiclesSeen: {} };
    this.stamina = 1;
    this.exhausted = false;
    this.mouseAimT = 0;
  }
  get vehicle() { return this.ped.vehicle; }
  get x() { return this.ped.vehicle ? this.ped.vehicle.x : this.ped.x; }
  get y() { return this.ped.vehicle ? this.ped.vehicle.y : this.ped.y; }
  get vx() { return this.ped.vehicle ? this.ped.vehicle.vx : this.ped.vx; }
  get vy() { return this.ped.vehicle ? this.ped.vehicle.vy : this.ped.vy; }
  addMoney(v) { this.money = Math.max(0, this.money + v); }

  update(dt) {
    const g = this.game, p = this.ped;
    input.context = p.vehicle ? 'car' : 'foot'; // RT is the gas pedal in a car, the trigger on foot
    if (p.dead || g.controlsLocked) {
      if (p.vehicle) { const c = p.vehicle.ctrl; c.throttle = 0; c.brake = g.controlsLocked ? 0.6 : 0; c.allowReverse = false; c.steer = 0; c.handbrake = false; }
      p.move.x = p.move.y = 0;
      return;
    }
    // weapon cycling
    if (input.wasPressed('nextWeapon') || input.mouse.wheel > 0 && !p.vehicle) this.cycleWeapon(1);
    if (input.wasPressed('prevWeapon') || input.mouse.wheel < 0 && !p.vehicle) this.cycleWeapon(-1);
    if (input.mouse.moved) this.mouseAimT = 2.5; else this.mouseAimT -= dt;
    if (p.vehicle) this.drive(dt); else this.onFoot(dt);
    if (p._flameT > 0) { p._flameT -= dt; if (p._flameT <= 0 && p._flameSnd) { p._flameSnd.stop(); p._flameSnd = null; } }
    if (p.fireFlash > 0) p.fireFlash -= dt;
  }

  mouseWorld() {
    const g = this.game;
    return g.cam.toWorld(input.mouse.x * g.cam.W, input.mouse.y * g.cam.H);
  }

  onFoot(dt) {
    const g = this.game, p = this.ped;
    const tank = settings.get('aimMode') === 'tank';
    const axis = input.moveAxis();
    const w = WEAPONS[p.weapon] || WEAPONS.fists;
    p.tankSteering = tank;
    if (tank) {
      const fwd = axis.y > 0 ? -axis.y * 0.6 : -axis.y;
      p.h = wrapAngle(p.h + axis.x * 4.2 * dt);
      p.face = p.h;
      p.move.x = Math.cos(p.h) * fwd; p.move.y = Math.sin(p.h) * fwd;
      p.aiming = input.isDown('fire') && w.type !== 'melee';
    } else {
      p.move.x = axis.x; p.move.y = axis.y;
      const gpAim = input.aimAxis();
      const useMouse = this.mouseAimT > 0 && input.lastDevice === 'kb';
      if (gpAim) { p.face = Math.atan2(gpAim.y, gpAim.x); p.aiming = true; }
      else if (useMouse) {
        const m = this.mouseWorld();
        p.face = Math.atan2(m[1] - p.y, m[0] - p.x);
        p.aiming = w.type !== 'melee' && (input.mouse.right || input.isDown('fire') || this.mouseAimT > 1.5);
      } else {
        if (Math.hypot(axis.x, axis.y) > 0.1) p.face = Math.atan2(axis.y, axis.x);
        p.aiming = input.isDown('fire') && w.type !== 'melee';
      }
    }
    const aimingWalk = !tank && p.aiming;
    const wantsSprint = input.isDown('sprint') && Math.hypot(p.move.x, p.move.y) > 0.1 && !aimingWalk;
    if (this.stamina >= 0.25) this.exhausted = false;
    const sprint = wantsSprint && !this.exhausted && this.stamina > 0;
    this.stamina = clamp(this.stamina + dt * (sprint ? -0.12 : 0.2), 0, 1);
    if (this.stamina === 0) this.exhausted = true;
    p.moveSpeed = aimingWalk ? 3.2 : sprint ? 6.6 : 4.3;
    if (input.isDown('fire')) {
      if (w.type === 'melee' && !tank && Math.hypot(p.move.x, p.move.y) < 0.1 && this.mouseAimT <= 0 &&
          !(input.lastDevice === 'touch' && input.aimAxis())) {
        // auto-face nearest target for melee
        let best = null, bd = 3;
        for (const q of g.nearbyPeds(p.x, p.y, 3)) { if (q === p || q.dead || q.vehicle) continue; const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = q; } }
        if (best) p.face = Math.atan2(best.y - p.y, best.x - p.x);
      }
      const target = input.lastDevice === 'touch' ? undefined : this.mouseWorld();
      if (g.combat.tryFire(p, p.face, { target })) {
        this.stats.shots++;
        if (w.type !== 'melee') g.onPlayerShot();
      }
    }
    if (input.wasPressed('enter')) this.tryEnter();
    if (input.wasPressed('radio')) { /* reload on foot */ p.startReload(); }
  }

  tryEnter() {
    const g = this.game, p = this.ped;
    let best = null, bd = Infinity;
    for (const v of g.nearbyVehicles(p.x, p.y, 8)) {
      if (v.dead || v.sinking || (v.isHeli && v.alt > 2)) continue;
      if (Math.abs((v.z || 0) - (p.z || 0)) > 2) continue; // not the car on the overpass above (or below)
      const d = Math.hypot(v.x - p.x, v.y - p.y) - v.len * 0.45;
      if (d < (v.isBoat ? 7 : 2.6) && d < bd) { bd = d; best = v; }
    }
    if (best) g.enterVehicle(p, best);
  }

  drive(dt) {
    const g = this.game, p = this.ped, v = p.vehicle;
    const a = input.driveAxes();
    v.ctrl.throttle = a.throttle; v.ctrl.brake = a.brake; v.ctrl.steer = a.steer;
    v.ctrl.allowReverse = true;
    v.ctrl.handbrake = input.isDown('handbrake');
    if (v.isHeli) {
      v.ctrl.strafe = 0;
      if (input.wasPressed('handbrake')) v.heliAltTarget = (v.heliAltTarget ?? 38) > 0 ? 0 : 38;
    }
    if (input.wasPressed('horn')) {
      if (v.m.siren) { v.sirenOn = !v.sirenOn; if (!v.sirenOn) v.horn = 0; }
      g.audio.play('horn_' + (v.m.horn || 'mid'), { x: v.x, y: v.y });
      v.horn = 0.5;
      g.onHorn(v);
    }
    if (input.wasPressed('radio')) g.radioNext();
    if (input.wasPressed('enter')) {
      if (v.isHeli && v.alt > 3) { v.heliAltTarget = 0; g.hud.message('Landing…', 1.5); }
      else g.exitVehicle(p, false);
      return;
    }
    // drive-by: guns fire forward (or toward the mouse) from the vehicle
    const w = WEAPONS[p.weapon];
    if (input.isDown('fire') && w && (w.type === 'gun' || w.type === 'throw' || w.type === 'projectile') && !v.isTwoWheel || (input.isDown('fire') && v.isTwoWheel && w && w.type === 'gun')) {
      let aim = v.h;
      const touchAim = input.lastDevice === 'touch' && input.aimAxis();
      if (touchAim) aim = Math.atan2(touchAim.y, touchAim.x);
      else if (this.mouseAimT > 0 && input.lastDevice === 'kb') {
        const m = this.mouseWorld();
        aim = Math.atan2(m[1] - v.y, m[0] - v.x);
      }
      if (g.combat.tryFire(p, aim, { vehicle: v })) { this.stats.shots++; g.onPlayerShot(); }
    }
  }

  cycleWeapon(dir) {
    const p = this.ped;
    const owned = WEAPON_ORDER.filter((id) => p.hasWeapon(id));
    let i = owned.indexOf(p.weapon);
    i = (i + dir + owned.length) % owned.length;
    p.weapon = owned[i];
    if (p.clip[p.weapon] === 0 && p.ammo[p.weapon] > 0) p.finishReload();
    this.game.audio.play('ui_select', { vol: 0.4 });
  }
}
