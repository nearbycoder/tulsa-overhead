// Procedural street furniture + countryside decor, generated deterministically per 64 m cell:
// street lamps, hydrants, stop signs, traffic signals (with working phases), utility poles,
// pumpjacks, cattle, bison, hay bales, windmills, gas stations at real fuel POIs, park furniture.
import { S, RC } from '../world/shared.js';
import { mulberry32, hash2 } from '../engine/math.js';
import { cum, pointAt } from './roads.js';
import { approachControls, controlState } from './traffic-controls.js';
import { prepareWaterTowers } from './water-towers.js';

const CELL = 64;
const MAXCELLS = 900;
const tmp = [0, 0, 0, 0];

export class Decor {
  constructor(game) {
    this.game = game;
    this.cells = new Map();
    this.waterTowers = prepareWaterTowers(game, CELL);
    this.fuelByCell = new Map();
    for (const p of game.world.pois) {
      if (p.k !== 'amenity=fuel') continue;
      const k = `${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`;
      if (!this.fuelByCell.has(k)) this.fuelByCell.set(k, []);
      this.fuelByCell.get(k).push(p);
    }
  }

  cell(cx, cy) {
    const k = `${cx},${cy}`;
    let c = this.cells.get(k);
    if (c) return c;
    const W = this.game.world;
    if (!W.isLoadedAt(cx * CELL + 32, cy * CELL + 32)) return null;
    c = this.generate(cx, cy);
    this.cells.set(k, c);
    if (this.cells.size > MAXCELLS) { const first = this.cells.keys().next().value; this.cells.delete(first); }
    return c;
  }

  forEach(x0, y0, x1, y1, fn) {
    for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      const c = this.cell(cx, cy);
      if (!c) continue;
      for (const it of c) if (!it.broken && it.x >= x0 && it.x <= x1 && it.y >= y0 && it.y <= y1) fn(it);
    }
  }

  generate(cx, cy) {
    const g = this.game, W = g.world, A = g.assets;
    const out = [];
    const x0 = cx * CELL, y0 = cy * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
    const r = mulberry32((cx * 73856093) ^ (cy * 19349663) ^ 0x5bd1e995);
    const free = (x, y, pad = 1.2) => {
      for (const [dx, dy] of [[0, 0], [pad, 0], [-pad, 0], [0, pad], [0, -pad]]) {
        const s = W.surfaceAt(x + dx, y + dy);
        if (s === S.ROAD || s === S.BUILDING || s === S.WATER || s === S.BRIDGE || s === S.RAIL || s === S.DIRTROAD || s < 0) return false;
      }
      return true;
    };
    const add = (id, x, y, h, extra) => {
      const def = A.props.get(id);
      if (!def) return null;
      const sc = (extra && extra.scale) || 1;
      const it = { id, x, y, h, r: (def.radius || 0) * sc, solid: !!def.solid && (def.radius || 0) > 0, breakable: !!def.breakable, def, ...extra };
      out.push(it);
      return it;
    };
    for (const site of this.waterTowers.byCell.get(`${cx},${cy}`) || []) {
      if (!site.onFootprint && site.def) add('water_tower', site.x, site.y, Math.PI / 2, { def: site.def, r: site.def.radius });
    }
    const inCell = (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
    // ---- along roads
    W.forEachInRect('roads', x0 - 8, y0 - 8, x1 + 8, y1 + 8, (road) => {
      if (road.cls === RC.PATH || ((road.cls === RC.SERVICE || road.cls === RC.TRACK) && !road.controls)) return;
      if (!road.walkSide && g.renderer.ground.sidewalkFor) road.walkSide = g.renderer.ground.sidewalkFor(road);
      cum(road);
      const urban = road.walkSide === 1;
      const seed = Math.abs((road.n0 || 0) % 100000) + Math.floor(road.pts[0]);
      const items = [];
      if (urban && road.cls <= 7) {
        items.push(['street_lamp', 34, road.w / 2 + 3.6, true, 0]);
        items.push(['fire_hydrant', 115, road.w / 2 + 2.4, false, 17]);
        if (W.densityAt(road.pts[0], road.pts[1]) >= 3) { items.push(['trash_can', 70, road.w / 2 + 4.2, false, 31]); items.push(['newspaper_box', 160, road.w / 2 + 4.4, true, 77]); items.push(['parking_meter', 23, road.w / 2 + 1.6, true, 5]); }
      } else if (road.cls <= 4 || road.cls === RC.UNCLASSIFIED) {
        items.push(['utility_pole', 58, road.w / 2 + 6, false, 0]);
      }
      for (const [id, spacing, off, alt, phase] of items) {
        const start = (hash2(seed, phase, 9) * spacing) + 6;
        let k = 0;
        for (let s = start; s < road.len - 6; s += spacing, k++) {
          const side = alt ? (k % 2 ? 1 : -1) : 1;
          pointAt(road, 1, s, off * side, tmp);
          if (!inCell(tmp[0], tmp[1])) continue;
          if (!free(tmp[0], tmp[1], 0.6)) continue;
          // lamps/poles face the road
          add(id, tmp[0], tmp[1], Math.atan2(tmp[3], tmp[2]) + (side > 0 ? Math.PI : 0) + Math.PI / 2);
        }
      }
      for (const dir of [1, -1]) {
        for (const control of approachControls(road, dir)) {
          pointAt(road, dir, control.s, road.w / 2 + 1.6, tmp);
          if (!inCell(tmp[0], tmp[1])) continue;
          const h = Math.atan2(tmp[3], tmp[2]) + Math.PI;
          if (control.group) add('traffic_light_red', tmp[0], tmp[1], h, {signal: control});
          else add('stop_sign', tmp[0], tmp[1], h);
        }
      }
    });
    // ---- gas stations (real fuel POIs)
    const fuel = this.fuelByCell.get(`${cx},${cy}`) || [];
    for (const p of fuel) {
      const near = W.nearestRoad(p.x, p.y, 60, (rd) => rd.cls <= 7);
      let h = 0;
      if (near) { cum(near.road); pointAt(near.road, 1, near.s, 0, tmp); h = Math.atan2(tmp[3], tmp[2]); }
      const cxp = p.x, cyp = p.y;
      if (W.surfaceAt(cxp, cyp) === S.BUILDING) continue;
      add('gas_station_canopy', cxp, cyp, h, { overhead: true });
      const fx = Math.cos(h), fy = Math.sin(h);
      for (const o of [-6, -2, 2, 6]) add('gas_station_pump', cxp + fx * o, cyp + fy * o, h + Math.PI / 2);
    }
    // ---- countryside & parks
    const dens = W.densityAt(x0 + 32, y0 + 32);
    const sc = W.surfaceAt(x0 + 32, y0 + 32);
    const roll = r();
    const px = x0 + 8 + r() * 48, py = y0 + 8 + r() * 48;
    // the old Glenn Pool field south-west of Glenpool is still thick with pumpjacks
    if (!this.oilFields) this.oilFields = [[35.9560, -96.0320, 3800], [35.9300, -96.0600, 2500]].map(([la, lo, r]) => { const q = W.project(la, lo); return { x: q[0], y: q[1], r }; });
    const inOil = this.oilFields.some((f) => Math.hypot(x0 + 32 - f.x, y0 + 32 - f.y) < f.r);
    if (inOil && dens <= 1 && sc !== S.WATER && sc !== S.BUILDING && sc !== S.ROAD && roll < 0.45) {
      for (let k = 0; k < 2; k++) {
        const qx = x0 + 8 + r() * 48, qy = y0 + 8 + r() * 48;
        if (free(qx, qy, 8) && free(qx, qy, 4)) { add('pumpjack', qx, qy, r() * 6.28, { anim: true }); if (r() < 0.2 && free(qx + 12, qy + 6, 7)) add('oil_storage_tank', qx + 12, qy + 6, 0, { scale: 0.35 }); }
      }
    } else if (dens === 0 && (sc === S.GROUND || sc === S.FARM || sc === S.DIRT)) {
      const county = W.countyAt(x0, y0) || '';
      if (roll < 0.05 && sc !== S.FARM) {
        if (free(px, py, 8) && free(px, py, 4)) { add('pumpjack', px, py, r() * 6.28, { anim: true }); if (r() < 0.35 && free(px + 12, py + 6, 7)) add('oil_storage_tank', px + 12, py + 6, 0, { scale: 0.35 }); }
      } else if (roll < 0.13) {
        const herd = county === 'Osage County' && r() < 0.4 ? 'bison' : null;
        const n = 2 + Math.floor(r() * 4);
        for (let i = 0; i < n; i++) {
          const x = px + (r() - 0.5) * 22, y = py + (r() - 0.5) * 22;
          if (!free(x, y, 2)) continue;
          add(herd || (r() < 0.12 ? 'horse' : r() < 0.5 ? 'cow_hereford' : 'cow_angus'), x, y, r() * 6.28, { animal: true, phase: r() * 10 });
        }
      } else if (roll < 0.22 && sc === S.FARM) {
        const n = 3 + Math.floor(r() * 6), a = r() * 6.28, sq = r() < 0.3;
        for (let i = 0; i < n; i++) { const x = px + Math.cos(a) * i * 4, y = py + Math.sin(a) * i * 4; if (free(x, y, 1)) add(sq ? 'hay_bale_square' : 'hay_bale_round', x, y, a + Math.PI / 2 + (r() - 0.5) * 0.4); }
      } else if (roll < 0.235) {
        if (free(px, py, 3)) add('windmill', px, py, r() * 6.28, { anim: true });
      } else if (roll < 0.242) {
        if (free(px, py, 6)) add('oil_derrick', px, py, 0);
      } else if (roll < 0.25) {
        if (free(px, py, 4)) add('car_wreck', px, py, r() * 6.28);
      }
    } else if (sc === S.PARK && roll < 0.25) {
      if (free(px, py, 2)) add(r() < 0.5 ? 'picnic_table' : 'bench', px, py, r() * 6.28);
    } else if (sc === S.PITCH && roll < 0.2) {
      if (free(px, py, 1)) add('basketball_hoop', px, py, r() * 6.28);
    } else if ((sc === S.LOT || sc === S.PARKING) && dens >= 2 && roll < 0.08) {
      if (free(px, py, 1.5)) add(r() < 0.6 ? 'dumpster' : 'pallet_stack', px, py, r() * 6.28);
    }
    return out;
  }

  signalState(control) {
    return controlState(control, this.game.time);
  }
}
