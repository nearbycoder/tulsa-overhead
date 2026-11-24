// Ringing payphones hand out randomised odd jobs (hits, car boosts, timed deliveries),
// built on the story mission engine so they get markers, timers, fail handling, etc.
import { input } from '../engine/input.js';
import { mulberry32, rng } from '../engine/math.js';

const HIT_LINES = ['A deacon of the Gusher Syndicate is collecting in {area}. Make him retire.', 'Some loan shark in {area} has been leaning on the wrong people. Lean back.', 'A Syndicate bagman is holding court in {area}. End the meeting.'];
const BOOST_LINES = ['Collector wants a {car}. One is parked in {area}. Bring it to the chop garage without a scratch.', 'Somebody in {area} owes me a {car}. Go collect it.'];
const DROP_LINES = ['Package in {area}. Get it to {dest} before the clock runs out. Don\'t ask what\'s in it.', 'Hot cargo sitting in {area}. Needs to be in {dest}, fast.'];

export class Payphones {
  constructor(game) {
    this.game = game;
    const r = mulberry32(918);
    const fuel = game.world.pois.filter((p) => p.k === 'amenity=fuel');
    this.phones = [];
    for (const sv of game.services) if (sv.type === 'safehouse') this.phones.push({ x: sv.x + 4, y: sv.y + 3, cd: 0 });
    for (let i = 0; i < 26 && fuel.length; i++) { const p = fuel[Math.floor(r() * fuel.length)]; this.phones.push({ x: p.x + 9, y: p.y + 9, cd: 0, prop: true }); }
    for (const ph of this.phones) if (ph.prop) game.props.push({ id: 'payphone', x: ph.x, y: ph.y, h: 0 });
    this.ringT = 0; this.ringing = null; this.count = 0;
  }

  update(dt) {
    const g = this.game, pl = g.player;
    if (!pl || g.respawning || g.missions?.active || g.missions?.retrying || g.jobs.active) { this.ringing = null; return; }
    for (const ph of this.phones) if (ph.cd > 0) ph.cd -= dt;
    // the nearest phone within 60 m rings now and then
    let near = null, nd = 60;
    for (const ph of this.phones) { const d = Math.hypot(ph.x - pl.x, ph.y - pl.y); if (d < nd && ph.cd <= 0) { nd = d; near = ph; } }
    this.ringing = near;
    if (!near) return;
    this.ringT -= dt;
    if (this.ringT <= 0) { g.audio.play('phone_ring', { x: near.x, y: near.y, vol: 0.8 }); this.ringT = 2.2; }
    if (nd < 2.5 && !pl.vehicle) {
      g.prompt = 'Press {enter} to answer the payphone';
      if (input.wasPressed('enter')) { g.audio.play('phone_pickup'); near.cd = 240; this.start(near); }
    }
  }

  blips(out) { if (this.ringing) out.push({ x: this.ringing.x, y: this.ringing.y, col: '#e8e0c0', shape: 'letter', letter: '☎', size: 4, flash: true }); }

  areaName(x, y) { return this.game.nearPlaceName(x, y) || this.game.world.cityAt(x, y) || this.game.world.countyAt(x, y) || 'the county'; }

  spot(minD, maxD) {
    const g = this.game, pl = g.player;
    for (let t = 0; t < 20; t++) {
      const a = rng() * Math.PI * 2, d = minD + rng() * (maxD - minD);
      const x = pl.x + Math.cos(a) * d, y = pl.y + Math.sin(a) * d;
      if (!g.world.isLoadedAt(x, y)) continue;
      const near = g.world.nearestRoad(x, y, 80, (r) => r.cls >= 2 && r.cls <= 7);
      if (near) return { x: near.x, y: near.y };
    }
    return null;
  }

  start(ph) {
    const g = this.game, M = g.missions;
    const kind = ['hit', 'boost', 'drop'][this.count++ % 3];
    const self = this;
    const def = {
      id: `odd_${Date.now()}`, chapter: M.chapter, title: kind === 'hit' ? 'Payphone: The Hit' : kind === 'boost' ? 'Payphone: Boost' : 'Payphone: Hot Drop',
      giver: null, start: { x: ph.x, y: ph.y }, reward: 0, odd: true,
      async run(m) {
        const lvl = Math.min(8, M.chapter);
        if (kind === 'hit') {
          const s = self.spot(350, 700); if (!s) m.fail('The line went dead.');
          m.message('Voice on the phone: ' + HIT_LINES[Math.floor(rng() * HIT_LINES.length)].replace('{area}', self.areaName(s.x, s.y)), 8);
          await m.goto(s, { r: 60, label: 'Find the target.' });
          const target = m.spawnPed(null, s, { weapon: lvl > 3 ? 'smg' : 'pistol', ai: 'guard', blip: '#e33', health: 120 + lvl * 15, range: 18 });
          const guards = m.gang(1 + Math.floor(lvl / 2), { x: s.x + 3, y: s.y + 2 }, { weapon: lvl > 4 ? 'shotgun' : 'pistol', ai: 'guard', spread: 6, blip: '#a33' });
          await m.kill(target, { label: 'Waste the target.' });
          if (guards.length) m.message('Clean up or get gone.', 4);
          return { reward: 1500 + lvl * 600 };
        }
        if (kind === 'boost') {
          const s = self.spot(300, 700); if (!s) m.fail('The line went dead.');
          const car = m.spawnCar((v) => (v.kind === 'car') && (v.topSpeed || 0) > 55 && v.role === 'civilian', m.roadAt(s), null, { onRoad: true, blip: '#4af' });
          car.parked = true;
          m.message('Voice on the phone: ' + BOOST_LINES[Math.floor(rng() * BOOST_LINES.length)].replace('{car}', `${car.m.make} ${car.m.name}`).replace('{area}', self.areaName(s.x, s.y)), 8);
          await m.enterVehicle(car, `Steal the ${car.m.name}.`);
          await m.deliver(car, 'chop_garage', { label: 'Deliver it to the chop garage in Broken Arrow (light damage only).', maxDamage: 0.5, r: 7 });
          return { reward: 1200 + lvl * 500 };
        }
        const a = self.spot(200, 450); if (!a) m.fail('The line went dead.');
        const b = self.spot(900, 1600); if (!b) m.fail('The line went dead.');
        m.message('Voice on the phone: ' + DROP_LINES[Math.floor(rng() * DROP_LINES.length)].replace('{area}', self.areaName(a.x, a.y)).replace('{dest}', self.areaName(b.x, b.y)), 8);
        await m.collect([a], { label: 'Pick up the package.', counter: 'PACKAGE' });
        m.timer(Math.round(40 + Math.hypot(b.x - m.x, b.y - m.y) / 16), 'DROP');
        await m.goto(b, { r: 8, label: 'Deliver the package.' });
        m.stopTimer();
        return { reward: 900 + lvl * 400 };
      },
    };
    M.start(def);
  }
}
