// In-page autopilot that plays the active mission with the real player controls
// (GPS-routed driving, walking, carjacking, shooting). Used by tools/playtest.mjs.
// Records how much damage a player would have taken and every time it had to "assist".
(async () => {
  const g = window.__game;
  const { Vehicle } = await import('/src/entities/vehicle.js');
  const { WEAPONS } = await import('/src/data/weapons.js');
  const { laneOffset, lanesPerDir } = await import('/src/game/roads.js');
  const { DriverAI } = await import('/src/game/traffic.js');
  let DT = 1 / 60;
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const B = window.__bot = {
    on: true, dmg: 0, vdmg: 0, assists: [], stuck: 0, rev: 0, route: null, routeIdx: 0, routeT: 0, routeFor: null,
    goal: null, note: '', near: 0, dmgBy: {}, blasts: [], impacts: [], evadeTo: null, deaths: 0, dmgScale: 0.15, vehicleDamageScale: 0.25, walkStuck: 0, side: 0, sideT: 0, lastPos: null, idleT: 0,
  };
  const P = g.player;
  // damage bookkeeping: the bot is a clumsy driver and a poor shot, so it only takes a fraction
  const hookPed = (pd) => {
    if (pd._botHooked) return; pd._botHooked = true;
    const od = pd.damage.bind(pd);
    pd.damage = (a, by, kind, dx, dy) => {
      if (!B.on) return od(a, by, kind, dx, dy);
      if (!pd.dead && !pd.invuln) {
        B.dmg += a;
        const src = (by ? (by.isCop ? 'cop' : by.mission ? 'mission' : by.isPlayer ? 'self' : by.m ? 'veh:' + (by.driver ? (by.driver.isCop ? 'cop' : 'npc') : 'empty') : 'ped') : 'none') + '/' + kind + (pd.vehicle ? '@car' : '');
        B.dmgBy[src] = (B.dmgBy[src] || 0) + a;
        if (kind === 'impact' && a > 15 && B.impacts.length < 6) {
          let nv = null, nd = 9;
          for (const v of g.vehicles) { const dd = Math.hypot(v.x - pd.x, v.y - pd.y); if (dd < nd) { nd = dd; nv = v; } }
          B.impacts.push(`${Math.round(a)} ${pd.vehicle ? 'in ' + pd.vehicle.m.id : 'on foot'} knock=${pd.knock.toFixed(1)} v=${Math.hypot(pd.vx, pd.vy).toFixed(0)} near=${nv ? nv.m.id + '@' + nd.toFixed(1) + ' sp' + nv.speed.toFixed(0) + (nv.driver ? (nv.driver.isPlayer ? ' (player)' : ' drv') : ' empty') + (nv.isTrain || /train|loco/.test(nv.m.id) ? ' TRAIN' : '') : '-'} goal=${B.note}`);
        }
      }
      return od(a * B.dmgScale, by, kind, dx, dy);
    };
  };
  const vd = Vehicle.prototype.damage;
  Vehicle.prototype.damage = function (a, by, x, y) {
    if (B.on && this.driver && this.driver.isPlayer) { B.vdmg += a; return vd.call(this, a * B.vehicleDamageScale, by, x, y); }
    return vd.call(this, a, by, x, y);
  };
  // log explosions close to the player (to tell bad luck from bad design)
  const ex = g.combat.explodeVehicle.bind(g.combat);
  g.combat.explodeVehicle = (v) => {
    const pl = g.player, d = Math.hypot(v.x - pl.x, v.y - pl.y);
    if (B.on && d < 14) B.blasts.push(`${v.m.id}${v === pl.vehicle ? ' (own car)' : ''} d=${d.toFixed(0)} hp=${Math.round(v.health)} drv=${v.driver ? (v.driver.isPlayer ? 'player' : v.driver.isCop ? 'cop' : v.driver.mission ? 'mission' : 'npc') : 'none'} hit=${v.lastHitBy ? (v.lastHitBy.isPlayer ? 'player' : v.lastHitBy.isCop ? 'cop' : 'other') : '-'} tornado=${g.tornado && g.tornado.active ? 1 : 0}`);
    return ex(v);
  };
  // watch named story characters (cast peds) for damage: who hurt them and how
  B.castHits = [];
  const ospawn = g.peds.push.bind(g.peds);
  const hookCast = () => {
    for (const q of g.peds) {
      if (!q.cast || q._botCast) continue;
      q._botCast = true;
      const od = q.damage.bind(q);
      q.damage = (a, by, kind, dx, dy) => {
        if (B.on && !q.dead && !q.invuln && B.castHits.length < 12) B.castHits.push(`${q.cast}:${Math.round(a)} ${kind} by=${by ? (by.isPlayer ? 'player' : by.isCop ? 'cop' : by.mission ? 'mission' : by.faction || 'ped') : 'none'}${q.vehicle ? ' (in car)' : ''} hp=${Math.round(q.health - a)}`);
        return od(a, by, kind, dx, dy);
      };
    }
  };
  setInterval(hookCast, 300);
  const M = () => g.missions.active;
  const objText = () => (g.hud.objText || (g.hud.objective && g.hud.objective.text) || '').toLowerCase();
  const isVeh = (e) => e instanceof Vehicle;
  const assist = (what) => { const id = M() && M().def.id; B.assists.push(`${id}: ${what}`); };

  function pickGoal() {
    const run = M();
    if (!run) return null;
    const pl = g.player, px = pl.x, py = pl.y;
    if (run.followTarget) return { kind: 'follow', ent: run.followTarget.vehicle, range: run.followTarget };
    const obj = objText();
    const ents = [...run.entities].filter((e) => e.blip && !e.dead && !e.sunk && !(e.vehicle && e.vehicle === pl.vehicle));
    const dist = (e) => Math.hypot(e.x - px, e.y - py);
    // 1) a vehicle to get into
    const board = ents.filter((e) => isVeh(e) && e !== pl.vehicle && (!e.driver || e.driver.dead) && (e.blip === '#4af' || /get in|steal|take the|grab the|hop in|climb in|board/.test(obj)) && !e.locked).sort((a, b) => dist(a) - dist(b))[0];
    if (board) return { kind: 'board', ent: board };
    // 2) markers
    const mks = [...run.markers].filter((m) => g.markers.includes(m));
    if (mks.length) {
      const m = mks.sort((a, b) => Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py))[0];
      return { kind: 'marker', x: m.x, y: m.y, req: m.req || {}, mk: m };
    }
    // 3) things to kill / destroy
    const hostile = ents.filter((e) => (e._okDead || (e.ai && e.ai.mode === 'attack') || /\b(?:kill|destroy|take out|waste|wreck|stop|eliminate|deal with|ram|torch|blow)\b/.test(obj)) && !(e === pl.vehicle));
    const followy = /follow|tail|keep up|shadow|trail|ease up|behind the/.test(obj);
    if (!followy) {
      const t = hostile.sort((a, b) => dist(a) - dist(b))[0];
      if (t) return { kind: 'attack', ent: t };
    }
    // 4) moving vehicles to follow
    const mv = ents.filter((e) => isVeh(e) && e.driver && !e.driver.isPlayer).sort((a, b) => dist(a) - dist(b))[0];
    if (mv) return { kind: followy ? 'follow' : 'attack', ent: mv };
    // 5) people to reach
    const peds = ents.filter((e) => !isVeh(e)).sort((a, b) => dist(a) - dist(b))[0];
    if (peds) return { kind: 'approach', ent: peds };
    if (run.wantVehicle) {
      if (pl.vehicle && !run.wantVehicle(pl.vehicle)) return { kind: 'exitcar' };
      let best = null, bd = 400;
      for (const v of g.vehicles) {
        if (v.dead || v.locked || v.sinking || v === pl.vehicle || (v.isHeli && v.alt > 2)) continue;
        if (v.driver && (v.driver.isCop || v.driver.mission)) continue;
        let ok = false; try { ok = run.wantVehicle(v); } catch (e) { }
        if (!ok) continue;
        const d = Math.hypot(v.x - px, v.y - py);
        if (d < bd) { bd = d; best = v; }
      }
      if (best) return { kind: 'steal', ent: best };
      return { kind: 'findcar' };
    }
    if (g.police.level > 0) return { kind: 'evade' };
    if (run.timerVal != null && run.timerFail == null) return { kind: 'evade' };
    if (pl.vehicle && /drive|get away|keep moving|go!|floor it/.test(obj)) return { kind: 'evade' };
    return { kind: 'idle' };
  }

  // ---------------------------------------------------------------- driving
  function routeTo(v, tx, ty) {
    const moved = B.routeFor && Math.hypot(B.routeFor[0] - tx, B.routeFor[1] - ty) > 25;
    B.routeT -= DT;
    let off = false;
    if (B.route) {
      const r = B.route, i = B.routeIdx * 2;
      if (i < r.length) off = Math.hypot(r[i] - v.x, r[i + 1] - v.y) > 30;
    }
    if (!B.route || moved || off || B.routeT <= 0) {
      B.route = Math.hypot(tx - v.x, ty - v.y) > 45 ? g.gps.solve(v.x, v.y, tx, ty) : null;
      B.routeIdx = 0; B.routeT = 4; B.routeFor = [tx, ty];
    }
  }
  function lookahead(v, tx, ty, L, keepRight = true) {
    const r = B.route;
    if (!r || r.length < 4) return [tx, ty, 0];
    // advance index to the closest point ahead
    let best = B.routeIdx, bd = Infinity;
    for (let i = B.routeIdx; i < Math.min(r.length / 2, B.routeIdx + 40); i++) {
      const d = Math.hypot(r[i * 2] - v.x, r[i * 2 + 1] - v.y);
      if (d < bd) { bd = d; best = i; }
    }
    B.routeIdx = best;
    // walk L metres along the polyline
    let i = best, rem = L, x = r[i * 2], y = r[i * 2 + 1];
    let dirx = 1, diry = 0;
    while (i + 1 < r.length / 2) {
      const nx = r[i * 2 + 2], ny = r[i * 2 + 3];
      const seg = Math.hypot(nx - x, ny - y);
      if (seg > 1e-3) { dirx = (nx - x) / seg; diry = (ny - y) / seg; }
      if (seg >= rem) { x += dirx * rem; y += diry * rem; rem = 0; break; }
      rem -= seg; x = nx; y = ny; i++;
    }
    if (rem > 0 && i + 1 >= r.length / 2) return [tx, ty, 0];
    // keep right (y-down screen coords: right normal of (dx,dy) is (-dy, dx)) by the real lane offset
    let keep = 0;
    if (keepRight && v.speed > 3) { const nr = g.world.nearestRoad(x, y, 8); if (nr) { const lo = Math.abs(laneOffset(nr.road, 0)); if (!(nr.road.flags & 1)) keep = Math.min(lo, 3.5); } }
    // curvature: compare direction to the point twice as far
    let j = i, x2 = x, y2 = y, rem2 = L;
    while (j + 1 < r.length / 2 && rem2 > 0) { const nx = r[j * 2 + 2], ny = r[j * 2 + 3]; const seg = Math.hypot(nx - x2, ny - y2); if (seg >= rem2) { x2 += (nx - x2) / seg * rem2; y2 += (ny - y2) / seg * rem2; rem2 = 0; break; } rem2 -= seg; x2 = nx; y2 = ny; j++; }
    const a1 = Math.atan2(y - v.y, x - v.x), a2 = Math.atan2(y2 - y, x2 - x);
    return [x - diry * keep, y + dirx * keep, Math.abs(wrap(a2 - a1))];
  }
  function drive(v, tx, ty, opts = {}) {
    const c = v.ctrl;
    c.allowReverse = false;
    const sp = Math.abs(v.vf ?? v.speed);
    const top = (v.m.topSpeed || 45) * 0.85;
    const dist = Math.hypot(tx - v.x, ty - v.y);
    if (v.isHeli) {
      // helicopters fly straight
      v.heliAltTarget = dist > 30 ? 38 : 0;
      const a = Math.atan2(ty - v.y, tx - v.x);
      c.steer = clamp(wrap(a - v.h) * 2, -1, 1); c.throttle = dist > 15 ? 1 : 0; c.brake = dist < 15 ? 1 : 0; c.handbrake = false;
      return;
    }
    if (opts.trail) B.route = opts.trail;
    else if (!v.isBoat) routeTo(v, tx, ty);
    else B.route = null;
    // on the road network, let the game's own traffic AI do the driving toward GPS waypoints
    const hurry = M() && (M().timerVal != null || (g.hud.counter && /CHECKPOINT/.test(g.hud.counter.label)));
    if (!v.isBoat && !opts.trail && !opts.ram && dist > 35 && B.route && B.rev <= 0) {
      if (!v._botAI) { v._botAI = new DriverAI(g, v, null, 1, 0, 0); v._botAI.style = 1.3; }
      const ai = v._botAI;
      // closest route point, then a waypoint ~120 m further along
      const r = B.route;
      let best = B.routeIdx, bd = Infinity;
      for (let i = B.routeIdx; i < Math.min(r.length / 2, B.routeIdx + 60); i++) { const dd = Math.hypot(r[i * 2] - v.x, r[i * 2 + 1] - v.y); if (dd < bd) { bd = dd; best = i; } }
      B.routeIdx = best;
      let i = best, rem = 120, wx = r[i * 2], wy = r[i * 2 + 1];
      while (i + 1 < r.length / 2 && rem > 0) { const nx = r[i * 2 + 2], ny = r[i * 2 + 3], sg = Math.hypot(nx - wx, ny - wy); if (sg >= rem) { wx += (nx - wx) / sg * rem; wy += (ny - wy) / sg * rem; rem = 0; break; } rem -= sg; wx = nx; wy = ny; i++; }
      if (opts.maxSpeed != null && opts.maxSpeed < 0.8) { stopCar(v); return; }
      ai.mode = 'goto'; ai.target = [wx, wy];
      if (hurry) { ai.style = 1; ai.maxSpeed = opts.maxSpeed ?? Math.min(40, (v.m.topSpeed || 40) * 0.8); } else { ai.style = 1.3; ai.maxSpeed = opts.maxSpeed ?? null; }
      ai.update(DT);
      // watchdog for the AI driver too
      if (sp < 1 && (v.ctrl.throttle > 0.3 || v.ctrl.brake > 0.3)) B.stuck += DT; else B.stuck = Math.max(0, B.stuck - 2 * DT);
      if (B.stuck > 3) { B.stuck = 0; B.rev = 1.2; B.revSteer = Math.random() < 0.5 ? 1 : -1; ai.road = null; }
      return;
    }
    const L = opts.trail ? clamp(4 + sp * 0.45, 6, 13) : clamp(sp * 0.9, 9, 34);
    let [lx, ly, curve] = lookahead(v, tx, ty, L, !opts.trail);
    let want = top * (1 - Math.min(0.72, curve / 1.5));
    // things in the way: brake for moving traffic and people, swerve around stopped cars
    if (!opts.ram) {
      const fx = Math.cos(v.h), fy = Math.sin(v.h);
      const look = 6 + sp * 0.9;
      let block = null;
      for (const o of g.nearbyVehicles(v.x, v.y, look + 4)) {
        if (o === v || o.dead || Math.abs(v.z - o.z) > 2.5 || (o.isHeli && o.alt > 2)) continue;
        const rx = o.x - v.x, ry = o.y - v.y, ahead = rx * fx + ry * fy, side = Math.abs(-rx * fy + ry * fx);
        if (Math.cos(o.h - v.h) < -0.5 && side > 1.2) continue;
        if (ahead > 2 && ahead < look && side < (v.wid + o.wid) / 2 + 0.3) {
          if (o.speed < 2 && (!o.driver || o.parked || (B.wait || 0) > 3)) block = o;
          else want = Math.min(want, Math.max(0, (ahead - 6) * 0.8 + Math.max(0, o.vf || 0)));
        }
      }
      if (block) B.overT = 1.6;
      if (B.overT > 0) { B.overT -= DT; lx += fy * 3.6; ly -= fx * 3.6; want = Math.min(want, 9); }
      for (const q of g.nearbyPeds(v.x, v.y, look + 2)) {
        if (q.dead || q.vehicle || q.isPlayer || Math.abs(v.z - (q.z || 0)) > 2.5) continue;
        const rx = q.x - v.x, ry = q.y - v.y, ahead = rx * fx + ry * fy, side = Math.abs(-rx * fy + ry * fx);
        if (ahead > 1 && ahead < look && side < 2.2) want = Math.min(want, Math.max((B.pedWait || 0) > 3 ? 2.5 : 0, (ahead - 4) * 0.7));
      }
    }
    const ang = Math.atan2(ly - v.y, lx - v.x);
    B.dbg = { lx: Math.round(lx), ly: Math.round(ly), keepTgt: [Math.round(tx), Math.round(ty)] };
    const da = wrap(ang - v.h);
    if (Math.abs(da) > 0.6) want = Math.min(want, 9);
    if (opts.arrive != null) want = Math.min(want, Math.max(opts.arriveMin ?? 0, (dist - opts.arrive) * 0.7));
    if (opts.maxSpeed != null) want = Math.min(want, opts.maxSpeed);
    if (opts.trail && opts.maxSpeed < 0.3) { stopCar(v); return; }
    // waiting forever behind something counts as stuck too
    if (want < 1 && sp < 1 && dist > 20) { B.wait = (B.wait || 0) + DT; B.pedWait = (B.pedWait || 0) + DT; if (B.wait > 4) { B.wait = 0; B.overT = 2; } } else { B.wait = 0; if (sp > 4) B.pedWait = 0; }
    // stuck → reverse
    if (B.rev > 0) {
      B.rev -= DT;
      c.allowReverse = true;
      c.throttle = 0; c.brake = 1; c.steer = -B.revSteer; c.handbrake = false;
      return;
    }
    if (c.throttle > 0.5 && sp < 1.2) B.stuck += DT; else B.stuck = Math.max(0, B.stuck - 2 * DT);
    if (B.stuck > 1.3) { B.stuck = 0; B.rev = 1.1; B.revSteer = da > 0 ? 1 : -1; B.route = null; return; }
    c.steer = clamp(da * (sp < 10 ? 1.7 : 2.2), -1, 1);
    if (sp < want - 1) { c.throttle = 1; c.brake = 0; } else if (sp > want + 3) { c.throttle = 0; c.brake = clamp((sp - want) / 8, 0.2, 1); } else { c.throttle = 0.35; c.brake = 0; }
    if (want <= 0.5 && sp < 1.5) { c.throttle = 0; c.brake = 0.4; }
    c.handbrake = false;
  }
  function stopCar(v) { const c = v.ctrl; c.throttle = 0; c.brake = 1; c.allowReverse = false; c.steer = 0; c.handbrake = v.speed > 3; }

  function observedTrail(v, t) {
    if (B.tail?.target !== t) {
      // Seed the unseen stretch, then drive through the same turns and lane as the courier.
      const road = g.gps.solve(v.x, v.y, t.x, t.y) || [v.x, v.y, t.x, t.y];
      const points = [v.x, v.y];
      for (let i = 2; i < road.length; i += 2) {
        const x = points.at(-2), y = points.at(-1), dx = road[i] - x, dy = road[i + 1] - y;
        const steps = Math.ceil(Math.hypot(dx, dy) / 3);
        for (let j = 1; j <= steps; j++) points.push(x + dx * j / steps, y + dy * j / steps);
      }
      B.tail = { target: t, points };
      B.routeIdx = 0;
      B.routeFor = null;
    }
    const points = B.tail.points;
    if (Math.hypot(t.x - points.at(-2), t.y - points.at(-1)) >= 2.5) points.push(t.x, t.y);
    if (B.routeIdx > 100) { points.splice(0, B.routeIdx * 2); B.routeIdx = 0; }
    return points;
  }

  // ---------------------------------------------------------------- on foot
  function walk(p, tx, ty, run = true) {
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
    let mx = dx / d, my = dy / d;
    // route along streets when far
    if (d > 250) {
      routeTo(p, tx, ty);
      let [lx, ly] = lookahead({ x: p.x, y: p.y, speed: 0, h: p.h }, tx, ty, 6);
      // walk on the sidewalk, not down the centre line
      const nr = g.world.nearestRoad(lx, ly, 12);
      if (nr) { const ddx = lx - p.x, ddy = ly - p.y, dl = Math.hypot(ddx, ddy) || 1; const off = nr.road.w / 2 + 1.6; lx += -ddy / dl * off; ly += ddx / dl * off; }
      const ld = Math.hypot(lx - p.x, ly - p.y) || 1; mx = (lx - p.x) / ld; my = (ly - p.y) / ld;
    }
    // sidestep obstacles
    if ((p.curSpeed || 0) < 0.6) B.walkStuck += DT; else B.walkStuck = Math.max(0, B.walkStuck - 2 * DT);
    if (B.walkStuck > 0.7) { B.walkStuck = 0; B.sideT = 1.0; B.side = Math.random() < 0.5 ? 1 : -1; }
    if (B.sideT > 0) { B.sideT -= DT; const sx = -my * B.side, sy = mx * B.side; mx = mx * 0.2 + sx; my = my * 0.2 + sy; }
    p.move.x = mx; p.move.y = my; p.moveSpeed = run ? 6.2 : 4.3; p.aiming = false;
  }
  function bestGun(p) {
    let best = null, bv = 0;
    for (const id of Object.keys(p.ammo)) { const w = WEAPONS[id]; if (!w || w.type !== 'gun' || !(p.ammo[id] > 0)) continue; const val = (w.damage || 10) * (w.rate || 1); if (val > bv) { bv = val; best = id; } }
    return best;
  }
  function shootAt(p, t) {
    const gun = bestGun(p);
    if (!gun) return false;
    p.weapon = gun;
    const a = Math.atan2(t.y - p.y, t.x - p.x);
    p.face = a; p.h = a; p.aiming = true; p.move.x = p.move.y = 0;
    if ((p.clip[gun] || 0) <= 0) p.startReload();
    g.combat.tryFire(p, a, { target: [t.x, t.y] });
    return true;
  }
  function nearestFreeCar(p, r = 60) {
    let best = null, bd = r;
    for (const v of g.vehicles) {
      if (v.dead || v.isBoat || v.isHeli || v.locked || v.mission || v.isTwoWheel && v.m.kind === 'bicycle' || v.sinking) continue;
      if (v.driver && (v.driver.isCop || v.driver.mission)) continue;
      const d = Math.hypot(v.x - p.x, v.y - p.y);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  // ---------------------------------------------------------------- main step
  function step(dt) {
    DT = dt;
    const pl = g.player, p = pl.ped, v = pl.vehicle;
    hookPed(p);
    // bail out of a burning or sinking car; swim for the nearest land
    if (v && (v.fire > 0 || v.sinking) && !v.isBoat) { g.exitVehicle(p, true); B.note = 'bail'; return; }
    // run from burning cars before they blow
    if (!v) {
      const hot = g.vehicles.find((b) => b.fire > 0 && !b.dead && Math.hypot(b.x - p.x, b.y - p.y) < 11);
      if (hot) { B.note = 'flee-fire'; return walk(p, p.x + (p.x - hot.x) * 3, p.y + (p.y - hot.y) * 3, true); }
    }
    const boatNear = !v && g.vehicles.some((b) => b.isBoat && !b.dead && b.blip && Math.hypot(b.x - p.x, b.y - p.y) < 14);
    if (!v && !boatNear && g.world.surfaceAt(p.x, p.y) === 1) {
      let best = null, bd = 1e9;
      for (let a = 0; a < 16; a++) for (const r of [4, 8, 14, 22]) {
        const x = p.x + Math.cos(a * Math.PI / 8) * r, y = p.y + Math.sin(a * Math.PI / 8) * r;
        if (g.world.surfaceAt(x, y) !== 1 && r < bd) { bd = r; best = [x, y]; }
      }
      if (best) { B.note = 'swim'; return walk(p, best[0], best[1], true); }
    }
    let G = B.goal = pickGoal();
    if (B.tail && G?.kind !== 'follow') { B.tail = null; B.route = null; B.routeIdx = 0; }
    // self-defence: an armed enemy shooting at us on foot comes first
    if (G && !v && bestGun(p) && G.kind !== 'attack') {
      let thr = null, td = 26;
      for (const q of g.nearbyPeds(p.x, p.y, 26)) { if (q.dead || q.vehicle || q === p || !q.ai || q.ai.mode !== 'attack' || q.isCop) continue; const dd = Math.hypot(q.x - p.x, q.y - p.y); if (dd < td) { td = dd; thr = q; } }
      if (thr) G = B.goal = { kind: 'attack', ent: thr };
    }
    if (!G) { if (v) stopCar(v); else { p.move.x = p.move.y = 0; } return; }
    B.note = G.kind;
    const gx = G.ent ? G.ent.x : G.x, gy = G.ent ? G.ent.y : G.y;
    const d = gx != null ? Math.hypot(gx - pl.x, gy - pl.y) : 0;
    // progress is measured along the GPS route when driving (detours around rivers are fine)
    let prog = d;
    if (v && B.route && B.routeFor && gx != null && Math.hypot(B.routeFor[0] - gx, B.routeFor[1] - gy) < 30) {
      const r = B.route; let L = 0;
      for (let i = Math.max(1, B.routeIdx + 1); i < r.length / 2; i++) L += Math.hypot(r[i * 2] - r[i * 2 - 2], r[i * 2 + 1] - r[i * 2 - 1]);
      prog = L + Math.hypot(r[B.routeIdx * 2] - pl.x, r[B.routeIdx * 2 + 1] - pl.y);
    }
    // progress watchdog: same goal, no progress for 45 s → nudge (teleport closer along the route) and log it
    const key = G.kind + ':' + Math.round((gx || 0) / 20) + ',' + Math.round((gy || 0) / 20);
    if (B.lastKey !== key) { B.lastKey = key; B.bestD = prog; B.noProg = 0; }
    if (prog < B.bestD - 5) { B.bestD = prog; B.noProg = 0; } else B.noProg += dt;
    if (B.noProg > 45 && G.kind !== 'idle' && G.kind !== 'evade' && G.kind !== 'follow' && d > 12) {
      B.noProg = 0;
      const e = v || p, k = Math.min(0.5, 60 / Math.max(d, 1));
      const ox = e.x, oy = e.y;
      let nx = e.x + (gx - e.x) * Math.max(k, 0.3), ny = e.y + (gy - e.y) * Math.max(k, 0.3);
      // land on a road (never in a river or a wall); near the goal itself, just go to the goal
      const nr = g.world.nearestRoad(nx, ny, 120, (r) => r.cls !== 15);
      if (d < 40) { nx = gx; ny = gy; } else if (!v) { const s = g.world.surfaceAt(nx, ny); if (s === 4 || s === 1) { nx = ox; ny = oy; } } else if (nr) { nx = nr.x; ny = nr.y; } else { nx = ox; ny = oy; }
      if (g.world.surfaceAt(nx, ny) === 1) { nx = ox; ny = oy; }
      e.x = nx; e.y = ny; if (v) { v.vx = v.vy = 0; v.av = 0; }
      assist(`stuck going to ${G.kind} (${Math.round(d)} m) at ${Math.round(ox)},${Math.round(oy)} ${v ? 'in ' + v.m.id : 'on foot'} → nudged`);
      B.route = null;
    }
    switch (G.kind) {
      case 'board': {
        const t = G.ent;
        if (v && v !== t) { if (d > 40) return drive(v, t.x, t.y, { arrive: 8 }); stopCar(v); if (v.speed < 2) g.exitVehicle(p, false); return; }
        if (t.isBoat && d < 6.5) { p.move.x = p.move.y = 0; pl.tryEnter(); return; }
        if (d > 2.2 + (t.len || 4) * 0.45) return walk(p, t.x, t.y);
        p.move.x = p.move.y = 0; pl.tryEnter();
        if (!pl.vehicle && d < 4) { g.enterVehicle(p, t); }
        return;
      }
      case 'marker': {
        const req = G.req || {};
        const r = Math.max(1.5, Math.min(req.r || 4, 6) - 1);
        if (v) {
          if (req.onFoot && d < 30) { stopCar(v); if (v.speed < 2) g.exitVehicle(p, false); return; }
          return drive(v, gx, gy, { arrive: req.stopped || d < 40 ? r * 0.5 : null, arriveMin: req.stopped ? 0 : 6 });
        }
        if (!req.onFoot && (d > 120 || req.inVehicle)) {
          const car = nearestFreeCar(p, 80);
          if (car) { const cd = Math.hypot(car.x - p.x, car.y - p.y); if (cd > 2.2 + (car.len || 4) * 0.45) return walk(p, car.x, car.y); p.move.x = p.move.y = 0; pl.tryEnter(); if (!pl.vehicle) g.enterVehicle(p, car); return; }
          if (d > 400) { B.idleT += dt; if (B.idleT > 15) { B.idleT = 0; assist('no car nearby → spawned one'); const m = g.assets.pickVehicle(Math.random, 'urban'); const nv = new Vehicle(g, m, p.x + 3, p.y, 0, 0); g.addVehicle(nv); } }
        }
        return walk(p, gx, gy, true);
      }
      case 'attack': {
        const t = G.ent;
        B.near = d < 45 ? B.near + dt : Math.max(0, B.near - dt);
        if (B.near > 30) { B.near = 0; assist(`couldn't finish ${isVeh(t) ? 'vehicle ' + t.m.id : 'ped'} → killed it`); if (isVeh(t)) t.damage(99999, p); else t.damage(9999, p, 'bullet'); return; }
        if (isVeh(t)) {
          // parked/slow targets: get out and lob something explosive at them
          const thr = ['rocket', 'grenade', 'molotov'].find((w) => (p.ammo[w] || 0) > 0);
          if (thr && t.speed < 6) {
            if (v) { if (d > 45) return drive(v, t.x, t.y, { arrive: 30 }); stopCar(v); if (v.speed < 3) g.exitVehicle(p, false); return; }
            if (d > 20) return walk(p, t.x, t.y);
            if (d < 9) return walk(p, p.x + (p.x - t.x), p.y + (p.y - t.y));
            p.weapon = thr; const a = Math.atan2(t.y - p.y, t.x - p.x); p.face = a; p.h = a; p.move.x = p.move.y = 0;
            if ((p.clip[thr] || 0) <= 0) p.startReload();
            g.combat.tryFire(p, a, { target: [t.x, t.y] });
            return;
          }
          if (v) {
            // drive-by when there's a gun aboard and the target is close
            const gun = bestGun(p);
            if (gun && d < 32) { p.weapon = gun; if ((p.clip[gun] || 0) <= 0) p.startReload(); g.combat.tryFire(p, Math.atan2(t.y - v.y, t.x - v.x), { vehicle: v }); }
            return drive(v, t.x, t.y, { ram: true });
          }
          if (bestGun(p) && d < 30) return shootAt(p, t);
          const car = nearestFreeCar(p, 60);
          if (car && d > 30) { const cd = Math.hypot(car.x - p.x, car.y - p.y); if (cd > 2.2 + (car.len || 4) * 0.45) return walk(p, car.x, car.y); pl.tryEnter(); return; }
          return walk(p, t.x, t.y);
        }
        // ped target
        if (t.vehicle) { if (v) return drive(v, t.x, t.y, {}); if (bestGun(p) && d < 30) return shootAt(p, t); return walk(p, t.x, t.y); }
        if (v) { if (d > 35) return drive(v, t.x, t.y, { arrive: 20 }); stopCar(v); if (v.speed < 3) g.exitVehicle(p, false); return; }
        if (bestGun(p)) {
          if (d > 24 || !g.world.lineOfSight(p.x, p.y, t.x, t.y)) return walk(p, t.x, t.y);
          shootAt(p, t);
          // strafe while shooting
          B.strafeT = (B.strafeT || 0) - DT; if (B.strafeT <= 0) { B.strafeT = 0.8 + Math.random(); B.strafe = Math.random() < 0.5 ? 1 : -1; }
          const ux = (t.x - p.x) / d, uy = (t.y - p.y) / d;
          p.move.x = -uy * B.strafe + (d > 16 ? ux * 0.5 : d < 8 ? -ux * 0.5 : 0); p.move.y = ux * B.strafe + (d > 16 ? uy * 0.5 : d < 8 ? -uy * 0.5 : 0); p.moveSpeed = 3.2;
          return;
        }
        if (d > 1.1) return walk(p, t.x, t.y);
        p.weapon = p.ammo.bat ? 'bat' : p.ammo.knife ? 'knife' : 'fists';
        p.face = Math.atan2(t.y - p.y, t.x - p.x); p.move.x = p.move.y = 0;
        g.combat.tryFire(p, p.face, {});
        return;
      }
      case 'exitcar': { if (v) { stopCar(v); if (v.speed < 2) g.exitVehicle(p, false); } return; }
      case 'steal': {
        const t = G.ent;
        if (v) { if (d > 30) return drive(v, t.x, t.y, { arrive: 6 }); stopCar(v); if (v.speed < 2) g.exitVehicle(p, false); return; }
        if (d > 2.2 + (t.len || 4) * 0.45) return walk(p, t.x + (t.vx || 0) * 0.4, t.y + (t.vy || 0) * 0.4, true);
        p.move.x = p.move.y = 0; pl.tryEnter();
        return;
      }
      case 'findcar': {
        // nothing suitable nearby: cruise around (or walk) until traffic brings one
        B.idleT += dt;
        if (B.idleT > 40) { B.idleT = 0; const run = M(); const list = g.assets.vehicles.filter((m) => { try { return run.wantVehicle({ m, kind: m.kind, isBoat: m.kind === 'boat', isHeli: m.kind === 'heli' }); } catch (e) { return false; } }); if (list.length) { const m = list[Math.floor(Math.random() * list.length)]; const nv = new Vehicle(g, m, pl.x + 4, pl.y + 1, 0, 0); g.addVehicle(nv); assist('no matching vehicle in 40 s → spawned ' + m.id); } }
        if (!B.evadeTo || Math.hypot(B.evadeTo[0] - pl.x, B.evadeTo[1] - pl.y) < 60) { const a = Math.random() * 6.28; B.evadeTo = [pl.x + Math.cos(a) * 600, pl.y + Math.sin(a) * 600]; B.route = null; }
        if (v) return drive(v, B.evadeTo[0], B.evadeTo[1], { maxSpeed: 14 });
        return walk(p, B.evadeTo[0], B.evadeTo[1], false);
      }
      case 'follow': {
        const t = G.ent;
        if (!v) { const car = nearestFreeCar(p, 80); if (car) { const cd = Math.hypot(car.x - p.x, car.y - p.y); if (cd > 2.2 + (car.len || 4) * 0.45) return walk(p, car.x, car.y); pl.tryEnter(); return; } return walk(p, t.x, t.y); }
        const keep = G.range ? G.range.minDist + (G.range.maxDist - G.range.minDist) * 0.3 : 65;
        const want = clamp(t.speed + (d - keep) * 0.45, 0, Math.max(27, t.speed + 7));
        return drive(v, t.x, t.y, { trail: observedTrail(v, t), maxSpeed: want });
      }
      case 'approach': {
        const t = G.ent;
        if (v) { if (d > 14) return drive(v, t.x, t.y, { arrive: 6 }); stopCar(v); return; }
        if (d > 2.5) return walk(p, t.x, t.y, d > 10);
        p.move.x = p.move.y = 0; return;
      }
      case 'evade': {
        const e = v || p;
        if (!B.evadeTo || Math.hypot(B.evadeTo[0] - e.x, B.evadeTo[1] - e.y) < 60) {
          let cx = 0, cy = 0, n = 0;
          for (const u of g.vehicles) if (u.m && u.m.role === 'police' && !u.dead && Math.hypot(u.x - e.x, u.y - e.y) < 300) { cx += u.x; cy += u.y; n++; }
          let ax = Math.random() - 0.5, ay = Math.random() - 0.5;
          if (n) { ax = e.x - cx / n; ay = e.y - cy / n; }
          const L = Math.hypot(ax, ay) || 1;
          B.evadeTo = [e.x + ax / L * 900, e.y + ay / L * 900];
          B.route = null;
        }
        if (v) return drive(v, B.evadeTo[0], B.evadeTo[1], {});
        const car = nearestFreeCar(p, 60);
        if (car) { const cd = Math.hypot(car.x - p.x, car.y - p.y); if (cd > 2.2 + (car.len || 4) * 0.45) return walk(p, car.x, car.y); pl.tryEnter(); return; }
        return walk(p, B.evadeTo[0], B.evadeTo[1]);
      }
      default:
        if (v) stopCar(v); else { p.move.x = p.move.y = 0; }
    }
  }
  const origDrive = P.drive.bind(P), origFoot = P.onFoot.bind(P);
  P.drive = function (dt) { if (!B.on) return origDrive(dt); try { step(dt); } catch (e) { B.err = e.message + ' ' + (e.stack || '').split('\n')[1]; } };
  P.onFoot = function (dt) { if (!B.on) return origFoot(dt); try { step(dt); } catch (e) { B.err = e.message + ' ' + (e.stack || '').split('\n')[1]; } };
  return 'bot ready';
})();
