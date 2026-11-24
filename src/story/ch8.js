// Chapter 8 — Golden Driller (the State Fair at Expo Square, the Golden Driller, Riverside Drive, the Gathering Place)
// The finale. Tolliver cracks, Tess goes live from the fairgrounds, Bellwether runs, and the Golden Driller
// gets a front-row seat. Expo Square, the fair, River Parks and the Gathering Place are backdrops only.

export const PLACES = {
  c8_driller_walk: { lat: 36.133371, lon: -95.931109, name: 'Golden Driller, 21st Street' },
  c8_brock_spot: { lat: 36.133615, lon: -95.931165, name: 'Golden Driller' },
  c8_brock_car: { lat: 36.133299, lon: -95.930664, name: '21st Street' },
  c8_tess_car: { lat: 36.133543, lon: -95.932700, name: 'Expo Square lot' },
  c8_van: { lat: 36.133543, lon: -95.931476, name: 'Live truck at the Golden Driller' },
  c8_van_walk: { lat: 36.133371, lon: -95.931476, name: 'Live truck at the Golden Driller' },
  c8_heli_pad: { lat: 36.133634, lon: -95.932144, name: 'News chopper, Expo Square' },
  c8_heli_walk: { lat: 36.133371, lon: -95.932144, name: 'News chopper, Expo Square' },
  c8_crash: { lat: 36.133543, lon: -95.930553, name: 'Expo Square lot' },
  c8_driller_foot: { lat: 36.133533, lon: -95.931176, name: 'Golden Driller' },
  c8_riverparks: { lat: 36.140389, lon: -95.997128, name: 'River Parks at 15th Street' },
  c8_lucky_car: { lat: 36.140579, lon: -95.996861, name: 'River Parks lot' },
  c8_convoy: { lat: 36.142451, lon: -96.000143, name: 'Riverside Drive' },
  c8_gp_drive: { lat: 36.126688, lon: -95.987182, name: 'Riverside Drive at the Gathering Place' },
};

export const LINES = {
  // c8m1 Fair Game
  c8m1_01: ['tess', 'Polly. Saturday night at the State Fair. Corn dogs, a Ferris wheel, and Brock Tolliver waiting under the Golden Driller.'],
  c8m1_02: ['polly', 'So Bellwether sent his salesman to the meeting. I guess Corrigan is still shopping for a new car.'],
  c8m1_03: ['tess', "Brock thinks you're bringing him the lockbox. You're not. My notebooks and that burner phone go on the air tonight, live."],
  c8m1_04: ['polly', 'Then why do we need Brock?'],
  c8m1_05: ['tess', 'Because every deed says Tolliver. I need Tolliver to say Bellwether, on the record, before he gets on a plane.'],
  c8m1_06: ['polly', 'Brock always did love an exit.'],
  c8m1_07: ['tess', "Talk to him. Nicely. And whatever you do, don't let him reach his car out on Twenty-First Street."],
  c8m1_08: ['polly', "I've never once talked to anybody nicely, Tess. But I'll give it a try."],
  c8m1_09: ['brock', "Miss Haskins! At the fair! Have you tried the fried butter? I'd love to chat, but I'm late for literally anything else."],
  c8m1_10: ['thug', "Mister Tolliver, go! We'll handle her!"],
  c8m1_11: ['tess', "He's in his car! Polly, my car's in the lot behind the Driller. Take it, and don't let him reach the highway!"],
  c8m1_12: ['brock', "Whitlock, it's Brock. She's on me. No, the tire shop one. The scary one!"],
  c8m1_13: ['brock', "Okay! Okay! I surrender! Don't shoot the suit, it's Italian. And it's a rental."],
  c8m1_14: ['polly', 'Say his name, Brock. The man who signs your checks.'],
  c8m1_15: ['brock', "Whitlock Bellwether. He signed every deed. He owns the zoning board and half of Corrigan's pension. Happy now?"],
  c8m1_16: ['polly', "Ecstatic. Get in the car. You're going on television."],
  c8m1_17: ['polly', "Tolliver won't be giving any interviews. But his phone keeps ringing, and the caller says Bellwether."],
  c8m1_18: ['tess', 'Mister Tolliver. Smile. In one hour you are going to be the most famous salesman in Oklahoma.'],
  c8m1_19: ['brock', 'Can I at least have my good side?'],
  c8m1_20: ['polly', "Brock, you don't have a good side. Get in the van."],
  c8m1_21: ['tess', 'His phone still works. Every text Bellwether ever sent him is evidence now. Grim, but useful.'],
  // c8m2 Midway Mayhem
  c8m2_01: ['tess', "Camera's up, the dish is on the satellite, and Brock is in the back of the van eating a funnel cake."],
  c8m2_02: ['polly', 'He earned it. He talked for an hour straight.'],
  c8m2_03: ['tess', "The station gives me five minutes, live. The deeds, the river money, the burner phone, Corrigan's payments. Everything goes out at once."],
  c8m2_04: ['polly', 'And Bellwether just sits at his gala and watches it happen?'],
  c8m2_05: ['tess', 'No. Bellwether sends everybody he has left. So I need you standing in front of this van, being charming.'],
  c8m2_06: ['lucky', "Pol, it's Lucky. Three Syndicate trucks just turned off Yale Avenue. They're coming for the fair."],
  c8m2_07: ['polly', "Then I guess we're on the air."],
  c8m2_08: ['tess', "Good evening, Tulsa. I'm Tess Okafor, live from the State Fair, with a story about the man whose name is on half this city."],
  c8m2_09: ['thug', 'Shoot the van! Mister Bellwether wants that dish in pieces!'],
  c8m2_10: ['tess', "Those are gunshots you're hearing. Please stay with us. This is the story they don't want you to see."],
  c8m2_11: ['polly', 'Tess, maybe duck while you journalism!'],
  c8m2_12: ['tess', 'Every deed in Glenpool, Jenks and Broken Arrow runs through one company. Bellwether Holdings.'],
  c8m2_13: ['thug', 'Truck coming through! Ram that van!'],
  c8m2_14: ['tess', 'Thirty more seconds, Polly. Thirty seconds and it is out there forever.'],
  c8m2_15: ['tess', 'Mister Bellwether, if you are watching, and I know you are, no comment is still a comment.'],
  c8m2_16: ['tess', 'And we are clear. That went out to every TV in Green Country. The station phones are melting.'],
  c8m2_17: ['polly', 'You were great. Very calm, for somebody standing in a gunfight.'],
  c8m2_18: ['tess', "I was screaming on the inside. Polly, look. The VIP lot. That's Bellwether's limo leaving the gala."],
  c8m2_19: ['lucky', "I see him, Pol. He's heading downtown to clean out his office. Then Riverside Drive, south. Meet me at River Parks by Fifteenth."],
  c8m2_20: ['polly', "What's south on Riverside?"],
  c8m2_21: ['lucky', 'The Gathering Place. And a private helicopter waiting by the river that nobody filed a flight plan for.'],
  c8m2_22: ['polly', 'Tess, stay with the van. And keep Brock away from the funnel cakes.'],
  // c8m3 River Parks Run
  c8m3_01: ['lucky', "Pol. I brought you a car. It's fast, it's black, and it's mostly insured."],
  c8m3_02: ['polly', "You didn't have to come, Lucky. You don't owe me anything anymore."],
  c8m3_03: ['lucky', "I owe you four years. I'm paying it off in installments."],
  c8m3_04: ['lucky', "Bellwether's convoy is coming down Riverside any minute. The limo, two black SUVs, and enough lawyers to dam the river."],
  c8m3_05: ['polly', "Two escorts. I'll handle them. You stay out of my mirrors."],
  c8m3_06: ['lucky', 'Story of my life.'],
  c8m3_07: ['whitlock', "Miss Haskins. I watched your friend's little broadcast. You have cost me a great deal of money. I find that unforgivable."],
  c8m3_08: ['polly', "Then you're really going to hate the next five minutes."],
  c8m3_09: ['lucky', "That's one! The other one's trying to box you in against the river!"],
  c8m3_10: ['polly', "Escorts are scrap. It's just you and me now, Whitlock."],
  c8m3_11: ['whitlock', 'Driver, do not slow down. Not for lights, not for joggers, and certainly not for her.'],
  c8m3_12: ['whitlock', 'Miss Haskins. Keep the car. I have other ways home.'],
  c8m3_13: ['polly', 'A helicopter. Landing on Riverside Drive. Rich people are exhausting.'],
  c8m3_14: ['polly', 'He ran in such a hurry he left his briefcase on the seat.'],
  c8m3_15: ['polly', "Signed originals. Every Glenpool deed, in Bellwether's own handwriting. No Brock to hide behind now."],
  c8m3_16: ['lucky', "Pol! His chopper's turning east, toward the fairgrounds. Brock's in Tess's van. He's going to shut him up for good."],
  c8m3_17: ['polly', 'Then I need something that flies.'],
  c8m3_18: ['lucky', "The station parked their news chopper at the fair for the broadcast. Go. I'll be right behind you."],
  // c8m4 Golden Driller
  c8m4_01: ['tess', "Polly! He's coming. You can hear the rotor over the Ferris wheel."],
  c8m4_02: ['brock', 'That is him. I know that sound. He bought that helicopter with my commission!'],
  c8m4_03: ['lucky', "One news chopper, keys in it. The pilot's on a very long coffee break. I may have paid for the coffee."],
  c8m4_04: ['polly', 'Lucky, can you fly one of these?'],
  c8m4_05: ['lucky', "I've flown coach. Twice. You're the one who can drive anything."],
  c8m4_06: ['polly', 'Driving is just flying with rules. Tess, get in the van and stay down.'],
  c8m4_07: ['whitlock', 'Miss Haskins. You do know I paid to repaint that statue? Every inch of gold on that man is mine.'],
  c8m4_08: ['polly', "Then he's about to get a really good view."],
  c8m4_09: ['tess', "He's shooting at the van! Polly, get him off us!"],
  c8m4_10: ['lucky', "Ram him if you have to, Pol! It's not our helicopter!"],
  c8m4_11: ['tess', "He's breaking off! He's circling the Golden Driller!"],
  c8m4_12: ['polly', "He's smoking. He's going down by the Driller."],
  c8m4_13: ['whitlock', 'Mayday. Mayday. Oh, for heaven’s sake.'],
  c8m4_14: ['whitlock', 'Miss Haskins. Do you know what that Glenpool land is worth? I could make your family richer than God.'],
  c8m4_15: ['polly', "My family's already rich, Whitlock. We just keep it in a tire shop."],
  c8m4_16: ['dispatch', 'All units, Expo Square. Hold Whitlock Bellwether for state investigators. Use caution. Subject is extremely well dressed.'],
  c8m4_17: ['tess', "Smile, Mister Bellwether. You're live."],
  c8m4_18: ['june', "Well, look what the State Fair drug in. The Syndicate loan is void, the deed's back in our name, and the shop is ours."],
  c8m4_19: ['dewey', 'I painted the new sign myself! Haskins Family Tire and Lube. I spelled everything right except lube. Lube is hard!'],
  c8m4_20: ['tess', "Bellwether's arraigned Monday. Corrigan and Tolliver are both singing to state investigators. And every acre in Glenpool goes back to its owners."],
  c8m4_21: ['june', 'Carl sent a catfish the size of a canoe. Rhonda is bringing pie. And Nadine says the hills are finally quiet.'],
  c8m4_22: ['lucky', 'So what now, Pol? Big city? Vegas? I know a guy in Vegas.'],
  c8m4_23: ['polly', "I'm staying in Broken Arrow, Lucky. Somebody has to keep Dewey away from loan sharks."],
  c8m4_24: ['polly', "Besides, June says I need to go straight. So I'm going straight. Straight down Kenosha, about ninety miles an hour."],
};

// ---------------------------------------------------------------- helpers
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hyp = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const SUV = (v) => v.class === 'suv' && v.kind === 'car';
const FAST = (v) => v.kind === 'car' && /sports|muscle|coupe/.test(v.class || '');
const COP_CAR = (v) => v.role === 'police' && v.kind === 'car';

// dialogue while the player keeps control; chained so lines never overlap
function chatter(m) {
  let p = Promise.resolve();
  return { say(ids) { p = p.then(() => m.talk(ids)).catch(() => { }); return p; }, done() { return p; } };
}
// background per-frame hook (m.onTick is a single slot). Return false from fn to stop; the returned function stops it too.
function every(m, fn) {
  let on = true;
  m.waitFor((dt) => { if (on && fn(dt) === false) on = false; return !on; }).catch(() => { });
  return () => { on = false; };
}
// keep AI cars chasing a moving target (m.pursue only records the target's position once)
function hunt(m, cars, target) {
  let t = 0;
  return every(m, (dt) => {
    if ((t -= dt) > 0) return;
    t = 0.3;
    const T = target ? target() : (m.vehicle || m.ped);
    let live = 0;
    for (const v of cars) if (!v.dead && v.driver && !v.driver.dead) { m.pursue(v, T); live++; }
    return live > 0;
  });
}
// Keep a vehicle from being destroyed: health never drops below floor * maxHealth (no fire, no explosion).
// floor may be a function; opts.immune() true = ignore damage entirely.
function armor(v, floor, opts = {}) {
  const base = v.damage;
  v.damage = function (amount, by, x, y) {
    if (opts.immune && opts.immune()) return;
    base.call(this, amount, by, x, y);
    const f = this.maxHealth * (typeof floor === 'function' ? floor() : floor);
    if (!this.dead && this.health < f) { this.health = f; this.fire = 0; }
  };
}
// Scripted helicopter pilot. The engine's DriverAI only knows roads, so this flies straight at target() each frame.
// throttle caps the cruise speed (helicopters top out around 10 m/s: accel 6 against drag 0.6).
function pilot(m, heli, target, o = {}) {
  heli.ai = {
    kind: 'pilot', mode: 'pilot',
    update(dt) {
      const c = heli.ctrl;
      if (!c || heli.dead) return;
      const t = target(dt);
      if (!t) { c.throttle = 0; c.brake = 0.6; c.steer = 0; return; }
      const dx = t.x - heli.x, dy = t.y - heli.y, d = Math.hypot(dx, dy);
      const err = wrap(Math.atan2(dy, dx) - heli.h);
      c.steer = clamp(err * 2.2, -1, 1);
      const cap = typeof o.throttle === 'function' ? o.throttle() : (o.throttle ?? 0.7);
      c.throttle = Math.abs(err) > 1.3 ? 0.12 : clamp(d / 25, 0.08, cap);
      c.brake = d < 6 && heli.speed > 2 ? 0.7 : 0;
    },
  };
}
// The helicopter's door gunner. Peds in vehicles are not ticked, so run his cooldowns here.
// NPC bullets can't hit airborne helicopters, so hits on the player's chopper are applied directly.
function doorGunner(m, heli, pickTarget) {
  let cd = 2, burst = 0;
  return every(m, (dt) => {
    const drv = heli.driver;
    if (heli.dead || !drv || drv.dead) return false;
    drv.fireCd = Math.max(0, (drv.fireCd || 0) - dt);
    if (drv.reloadT > 0) { drv.reloadT -= dt; if (drv.reloadT <= 0 && drv.finishReload) drv.finishReload(); }
    if ((cd -= dt) > 0) return;
    const T = pickTarget();
    if (!T) { cd = 0.5; return; }
    const C = m.game && m.game.combat;
    const aim = Math.atan2(T.y - heli.y, T.x - heli.x) + (Math.random() - 0.5) * 0.12;
    if (C && C.tryFire) C.tryFire(drv, aim, { vehicle: heli });
    if (T.isHeli && T.alt > 3 && Math.random() < 0.35) T.damage(8, drv);
    if (++burst >= 4) { burst = 0; cd = 1.4 + Math.random() * 1.2; } else cd = 0.16;
  });
}
// Walking AI goes in a straight line and can wedge itself on a lamp post or tree; sidestep when it stops making progress.
function unstick(p, goal, dt) {
  p._sT = (p._sT || 0) + dt;
  if (p._sT < 1.2) return;
  if (p._sP && Math.hypot(p.x - p._sP.x, p.y - p._sP.y) < 0.8) {
    const a = Math.atan2(goal.y - p.y, goal.x - p.x) + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
    p.x += Math.cos(a) * 1.8; p.y += Math.sin(a) * 1.8;
  }
  p._sP = { x: p.x, y: p.y }; p._sT = 0;
}
// an airborne helicopter with a scripted pilot
function spawnChopper(m, pos, h, driver, health) {
  const heli = m.spawnCar('tallgrass_skywatch', pos, h, { driver, health, blip: '#e33' });
  heli.alt = 30; heli.heliAltTarget = 38;
  return heli;
}
// a point beside a vehicle: side 1 = right-hand door, -1 = left
function doorOf(v, side = 1, d = 3) { return { x: v.x - Math.sin(v.h) * d * side, y: v.y + Math.cos(v.h) * d * side }; }
// the door that opens onto dry, open ground (not the river, not a wall)
function openDoor(m, v, d = 2.8) {
  const W = m.game && m.game.world;
  for (const side of [-1, 1]) {
    const p = doorOf(v, side, d);
    const s = W && W.surfaceAt ? W.surfaceAt(p.x, p.y) : 0;
    if (s !== 1 && s !== 4 && s !== 20) return p;
  }
  return doorOf(v, -1, d);
}
// take an NPC driver out of a stopped car (the engine has no scripted exit) and stand a fresh ped at the door
function climbOut(m, v, model, opts = {}) {
  if (v.driver && !v.driver.isPlayer) { const d = v.driver; m.remove(d); v.driver = null; }
  if (v.ai) v.ai.mode = 'stop';
  return m.spawnPed(model, openDoor(m, v, 2.6), opts);
}
// nearest lane point to pos, heading along the road in the direction of target
function laneToward(m, pos, target) {
  const r = m.roadAt(pos, { lane: true });
  const t = m.place(target);
  if (Math.cos(Math.atan2(t.y - r.y, t.x - r.x) - r.h) < 0) r.h = wrap(r.h + Math.PI);
  return r;
}

// ---------------------------------------------------------------- missions
export const MISSIONS = {
  c8m1: {
    id: 'c8m1', chapter: 8, title: 'Fair Game', giver: 'tess', start: 'c8_driller_walk', reward: 15000,
    async run(m) {
      const chat = chatter(m);
      m.setTime(19.5);
      m.maxWanted(2);
      const tess = m.spawnPed('tess', m.offset('c8_driller_walk', -3, -2), { ai: 'idle' });
      await m.cutscene(['c8m1_01', 'c8m1_02', 'c8m1_03', 'c8m1_04', 'c8m1_05', 'c8m1_06', 'c8m1_07', 'c8m1_08'], { focus: 'c8_brock_spot' });
      // Brock works the crowd at the Driller's feet; his car idles on 21st Street; two heavies keep watch
      const carP = m.roadAt('c8_brock_car', { lane: true });
      let car = m.spawnCar(FAST, carP, carP.h, { health: 1100 });
      car.locked = true;
      const bs = m.place('c8_brock_spot');
      const door = [doorOf(car, 1, 2.2), doorOf(car, -1, 2.2)].sort((a, b) => hyp(a, bs) - hyp(b, bs))[0];
      const brock = m.spawnPed('brock', bs, { ai: 'idle', target: door, speed: 5.4, health: 120, blip: '#6a8cff' });
      const guards = m.gang(2, m.offset('c8_brock_spot', 5, -5), { weapon: 'pistol', models: ['gusher'], spread: 3, ai: 'guard', range: 14, health: 90, accuracy: 2.4 });
      const ride = m.spawnCar(FAST, 'c8_tess_car', 0, { health: 1200 });
      m.remove(tess);
      m.giveWeapon('pistol', 120);
      m.giveWeapon('smg', 300);
      await m.goto(m.offset('c8_brock_spot', 0, 6), { r: 16, label: 'Find Brock Tolliver at the Golden Driller.' });
      // he bolts for his car
      if (!brock.dead) brock.ai.mode = 'goto';
      for (const g of guards) if (!g.dead && g.ai) g.ai.mode = 'attack';
      m.music(0.8);
      chat.say(['c8m1_09', 'c8m1_10']);
      m.objective('Stop Tolliver before he reaches his car on 21st Street.');
      let clock = 0;
      const stopClock = every(m, (dt) => { clock += dt; });
      await m.waitFor((dt) => {
        if (!brock.dead && brock.ai && brock.ai.mode === 'goto') unstick(brock, door, dt);
        return brock.dead || hyp(brock, door) < 2.5 || hyp(brock, car) < 4.2 || clock > 20;
      });
      stopClock();
      let alive = !brock.dead;
      let wreck = null;
      if (alive) {
        // Brock dives behind the wheel and floors it
        const p = { x: car.x, y: car.y, h: car.h, model: car.m, paint: car.paint };
        m.remove(brock);
        m.remove(car);
        car = m.spawnCar(p.model, p, p.h, { driver: { model: 'brock' }, ai: 'flee', health: 1100, blip: '#e33', paint: p.paint });
        armor(car, 0.2);
        m.driveTo(car, { x: p.x + 3000, y: p.y - 1500 }, { flee: true, speed: 18 });
        ride.blip = '#4af';
        await chat.done();
        chat.say(['c8m1_11']);
        // a long leash while Polly is still running for a car, a tighter one once she's driving
        const lost = m.failIf(() => !car.dead && hyp(car, m.player) > (m.vehicle ? 520 : 1100), 'Tolliver got away.');
        m.objective('Chase Tolliver down. Wreck his car, but keep him breathing.');
        m.wait(14).then(() => chat.say('c8m1_12')).catch(() => { });
        let flip = 0;
        await m.waitFor((dt) => {
          // a bump from the player can make the AI forget it's fleeing; keep it running
          if ((flip -= dt) <= 0 && car.ai && car.ai.mode !== 'flee' && car.health > car.maxHealth * 0.3) { flip = 1; car.ai.mode = 'flee'; }
          return car.dead || car.health <= car.maxHealth * 0.3;
        });
        lost();
        ride.blip = null;
        if (car.ai) car.ai.mode = 'stop';
        await m.waitFor(() => car.speed < 1.2, { timeout: 6 });
        const b2 = climbOut(m, car, 'brock', { ai: 'idle', health: 120, blip: '#6a8cff' });
        m.objective('Tolliver is out of the car. Get over there before he changes his mind.');
        await chat.done();
        chat.say('c8m1_13');
        await m.waitFor(() => b2.dead || (hyp(b2, m.player) < 7 && !m.vehicle) || (hyp(b2, m.player) < 5 && m.vehicle && m.vehicle.speed < 3));
        if (!b2.dead) {
          await chat.done();
          m.music(0.3);
          await m.cutscene(['c8m1_14', 'c8m1_15', 'c8m1_16'], { focus: b2 });
          m.clearWanted();
          await m.escort(b2, 'c8_van_walk', { label: 'Bring Tolliver back to the news van at the Golden Driller.', name: 'Tolliver', r: 10 });
        } else { alive = false; wreck = { x: b2.x, y: b2.y }; }
      } else wreck = { x: brock.x, y: brock.y };
      if (!alive) {
        // the dead-witness path: his phone is evidence too
        await chat.done();
        await m.collect([wreck], { label: "Grab Tolliver's phone.", counter: 'PHONE' });
        await m.talk('c8m1_17');
        m.clearWanted();
        await m.goto('c8_van_walk', { r: 6, label: 'Bring the phone to the news van at the Golden Driller.' });
      }
      m.music(0);
      await chat.done();
      m.spawnCar('arkvalley_newsvan', 'c8_van', 0, { locked: true });
      m.spawnPed('tess', m.offset('c8_van', -1, -5), { ai: 'idle' });
      await m.cutscene(alive ? ['c8m1_18', 'c8m1_19', 'c8m1_20'] : ['c8m1_21'], { focus: 'c8_van' });
      m.maxWanted(null);
    },
  },

  c8m2: {
    id: 'c8m2', chapter: 8, title: 'Midway Mayhem', giver: 'tess', start: 'c8_van_walk', reward: 20000, requires: ['c8m1'],
    async run(m) {
      const chat = chatter(m);
      m.setTime(20.5);
      const van = m.spawnCar('arkvalley_newsvan', 'c8_van', 0, { health: 2400, locked: true });
      const tess = m.spawnPed('tess', m.offset('c8_van', -1, -5), { ai: 'idle', health: 400 });
      await m.cutscene(['c8m2_01', 'c8m2_02', 'c8m2_03', 'c8m2_04', 'c8m2_05', 'c8m2_06', 'c8m2_07'], { focus: 'c8_van' });
      m.giveWeapon('smg', 400);
      m.giveWeapon('rifle', 300);
      m.ped.armor = Math.max(m.ped.armor, 100);
      m.message('Tess found a vest in the van. {weapons} switch weapons. The rifle reaches across the lot.', 6);
      // the fair's own security keeps the police back; this fight is Polly's
      m.maxWanted(0);
      m.music(1);
      m.failIfDestroyed(van, 'The live truck is scrap. The broadcast is dead.');
      m.failIf(() => tess.dead, 'Tess is down. The broadcast is dead.');
      const vp = m.place('c8_van');
      const gunmen = [];
      // gunmen walk in, take a spot near the van and shoot it up until Polly gets in their face
      const wave = (dx, dy, n, weapon) => {
        const from = m.offset('c8_van', dx, dy);
        const L = Math.hypot(dx, dy);
        for (let i = 0; i < n; i++) {
          const sx = from.x + m.rand(-5, 5), sy = from.y + m.rand(-5, 5);
          const stand = { x: vp.x + (dx / L) * 16 + m.rand(-6, 6), y: vp.y + (dy / L) * 16 + m.rand(-4, 4) };
          const p = m.spawnPed('gusher', { x: sx, y: sy }, { weapon, ai: 'goto', target: stand, speed: 4.2, faction: 'syndicate', blip: '#e33', health: 80, hostile: true });
          p._stand = stand; p._cd = m.rand(0.5, 1.5);
          gunmen.push(p);
        }
      };
      let rammer = null;
      const sendRammer = () => {
        const rp = m.roadAt(m.offset('c8_van', 488, 27), { lane: true });
        rammer = m.spawnCar(SUV, rp, Math.PI, { onRoad: true, driver: { model: 'gusher' }, ai: 'pursue', health: 1000, blip: '#e33', paint: 2 });
        rammer._callOff = hunt(m, [rammer], () => van);
      };
      const C = m.game && m.game.combat;
      let clock = 0, next = 0;
      const schedule = [
        [0, () => wave(-92, -12, 3, 'pistol')],
        [20, () => { wave(110, -10, 3, 'pistol'); chat.say(['c8m2_09', 'c8m2_10', 'c8m2_11']); }],
        [42, () => { sendRammer(); chat.say(['c8m2_12', 'c8m2_13']); }],
        [62, () => { wave(33, 56, 3, 'smg'); wave(-90, 58, 2, 'pistol'); }],
        [82, () => { wave(110, -10, 3, 'smg'); chat.say('c8m2_14'); }],
      ];
      every(m, (dt) => {
        clock += dt;
        while (next < schedule.length && clock >= schedule[next][0]) schedule[next++][1]();
        m.bar('LIVE TRUCK', van.health / van.maxHealth, '#e8b030');
        // Tess ducks behind the truck instead of running off across the fairgrounds
        if (!tess.dead && tess.ai && tess.ai.mode !== 'idle') tess.ai.mode = 'idle';
        for (const p of gunmen) {
          if (p.dead || !p.ai) continue;
          const dP = hyp(p, m.player);
          if (p.ai.mode !== 'attack' && (dP < 20 || p.health < p.maxHealth)) { p.ai.mode = 'attack'; continue; }
          if (p.ai.mode === 'goto' && hyp(p, p._stand) < 1.5) p.ai.mode = 'idle';
          if (p.ai.mode === 'goto') unstick(p, p._stand, dt);
          if (p.ai.mode === 'idle' && C && C.tryFire && (p._cd -= dt) <= 0) {
            p._cd = m.rand(0.45, 0.9);
            p.face = Math.atan2(van.y - p.y, van.x - p.x); p.h = p.face; p.aiming = true;
            C.tryFire(p, p.face + m.rand(-0.06, 0.06));
          }
        }
        // the ram truck dumps two shooters when it gets close or gets stopped
        if (rammer && !rammer._dumped && (rammer.dead || hyp(rammer, van) < 13 || rammer.health < rammer.maxHealth * 0.4)) {
          rammer._dumped = true;
          rammer._callOff();
          const at = openDoor(m, rammer, 3);
          if (!rammer.dead) { climbOut(m, rammer, 'gusher', { weapon: 'smg', ai: 'attack', faction: 'syndicate', blip: '#e33', health: 80, hostile: true })._stand = at; }
          rammer.blip = null;
          for (let i = 0; i < 2; i++) {
            const p = m.spawnPed('gusher', { x: at.x + i * 1.5, y: at.y + 1 }, { weapon: 'smg', ai: 'attack', faction: 'syndicate', blip: '#e33', health: 80, hostile: true });
            p._stand = at; p._cd = 1;
            gunmen.push(p);
          }
        }
      });
      await chat.say('c8m2_08');
      m.objective('Protect the live truck while Tess broadcasts.');
      m.wait(70).then(() => chat.say('c8m2_15')).catch(() => { });
      await m.survive(100, 'ON AIR');
      await m.waitFor(() => next >= schedule.length);
      const left = m.game.peds.filter((p) => p.faction === 'syndicate' && p.mission && !p.dead);
      if (left.length) await m.kill(left, { label: 'Clear the last of the Syndicate gunmen.', counter: 'GUNMEN' });
      m.clearBar();
      m.music(0);
      m.clearWanted();
      await chat.done();
      await m.goto('c8_van_walk', { r: 7, onFoot: true, label: 'Check on Tess.' });
      if (!tess.dead && hyp(tess, vp) > 12) { const tp = m.offset('c8_van', -1, -5); tess.x = tp.x; tess.y = tp.y; }
      await m.cutscene(['c8m2_16', 'c8m2_17', 'c8m2_18', 'c8m2_19', 'c8m2_20', 'c8m2_21', 'c8m2_22'], { focus: 'c8_van' });
      m.maxWanted(null);
    },
  },

  c8m3: {
    id: 'c8m3', chapter: 8, title: 'River Parks Run', giver: 'lucky', start: 'c8_riverparks', reward: 25000, requires: ['c8m2'],
    async run(m) {
      const chat = chatter(m);
      m.setTime(21.5);
      const lucky = m.spawnPed('lucky', m.offset('c8_riverparks', 2, -2), { ai: 'idle' });
      const ride = m.spawnCar(FAST, 'c8_lucky_car', -0.8, { health: 1500, paint: 2 });
      await m.cutscene(['c8m3_01', 'c8m3_02', 'c8m3_03', 'c8m3_04', 'c8m3_05', 'c8m3_06'], { focus: 'c8_riverparks' });
      m.remove(lucky);
      m.giveWeapon('smg', 500);
      m.maxWanted(2);
      // (not m.enterVehicle: that would fail the mission if this car gets wrecked later in the chase)
      m.objective("Get in Lucky's car.");
      ride.blip = '#4af';
      await m.waitFor(() => m.vehicle === ride);
      ride.blip = null;
      m.message('The SMG fires forward from the car. Hold {fireCar} while you drive.', 6);
      // the convoy rolls down Riverside Drive: escort, limo, escort
      const gp = m.place('c8_gp_drive');
      const lane = (dx, dy) => laneToward(m, m.offset('c8_convoy', dx, dy), gp);
      const escOpts = { driver: { model: 'gusher', weapon: 'pistol' }, ai: 'goto', speed: 17, health: 1000, blip: '#e33', paint: 2 };
      const lp = lane(0, 0), ea = lane(50, 39), eb = lane(-55, -44);
      const limo = m.spawnCar('keystone_regalia', lp, lp.h, { driver: { model: 'whitlock' }, ai: 'goto', speed: 16, health: 2600, blip: '#e8e0c0', paint: 3 });
      const escorts = [m.spawnCar(SUV, ea, ea.h, escOpts), m.spawnCar(SUV, eb, eb.h, escOpts)];
      // the limo can't be stopped while its escorts are still running interference
      armor(limo, () => (escorts.every((e) => e.dead) ? 0.25 : 0.45));
      m.driveTo(limo, gp, { speed: 16 });
      for (const e of escorts) m.driveTo(e, gp, { speed: 17 });
      let phase = 'drive';
      m.failIf(() => phase === 'drive' && hyp(limo, gp) < 40, 'Bellwether made it to the Gathering Place.');
      m.failIf(() => phase === 'drive' && hyp(limo, m.player) > 600, 'You lost the convoy.');
      // escorts peel off to hunt Polly once she's close; the limo keeps to Riverside no matter who rams it
      let hunting = false, nag = 0;
      every(m, (dt) => {
        if (!hunting && escorts.some((e) => !e.dead && hyp(e, m.player) < 90)) { hunting = true; hunt(m, escorts); }
        if (phase === 'drive' && (nag -= dt) <= 0) { nag = 0.5; if (limo.ai && limo.ai.mode !== 'goto') m.driveTo(limo, gp, { speed: 16 }); }
      });
      m.music(1);
      chat.say(['c8m3_07', 'c8m3_08']);
      m.waitFor(() => escorts.some((e) => e.dead)).then(() => { if (escorts.some((e) => !e.dead)) chat.say('c8m3_09'); }).catch(() => { });
      await m.destroy(escorts, { label: "Wreck Bellwether's escort SUVs before the convoy reaches the Gathering Place.", counter: 'ESCORTS' });
      chat.say(['c8m3_10', 'c8m3_11']);
      m.objective('Run the limo off the road.');
      await m.waitFor(() => limo.health <= limo.maxHealth * 0.4);
      phase = 'stopped';
      if (limo.ai) limo.ai.mode = 'stop';
      await m.waitFor(() => limo.speed < 1.2, { timeout: 6 });
      // DriverAI's 'stop' still creeps forward at ~1 m/s, so take the chauffeur out of the loop
      if (limo.driver) { m.remove(limo.driver); limo.driver = null; }
      m.music(0.6);
      // his helicopter drops out of the dark onto Riverside Drive
      await chat.done();
      const ahead = { x: limo.x + Math.cos(limo.h) * 18, y: limo.y + Math.sin(limo.h) * 18 };
      const heli = spawnChopper(m, { x: ahead.x + 90, y: ahead.y + 60 }, Math.atan2(-60, -90), { model: null }, 1800);
      armor(heli, 0.5, { immune: () => true });
      let land = false;
      pilot(m, heli, () => ahead, { throttle: 0.9 });
      chat.say(['c8m3_12', 'c8m3_13']);
      m.objective('Bellwether is bailing out. Stay on him.');
      await m.waitFor(() => { if (!land && hyp(heli, ahead) < 5) { land = true; heli.heliAltTarget = 0; } return land && heli.alt < 0.6; }, { timeout: 40 });
      heli.x = ahead.x; heli.y = ahead.y; heli.heliAltTarget = 0;
      const bw = climbOut(m, limo, 'whitlock', { ai: 'goto', target: ahead, speed: 3, health: 1500 });
      m.failIf(() => bw.dead && !bw._aboard, 'Bellwether is dead. Tulsa wanted him in a courtroom.');
      await m.waitFor((dt) => { if (!bw.dead) unstick(bw, ahead, dt); return bw.dead || hyp(bw, ahead) < 3.5; }, { timeout: 10 });
      bw._aboard = true;
      m.remove(bw);
      heli.heliAltTarget = 38;
      const away = { x: ahead.x + 3000, y: ahead.y - 800 };
      pilot(m, heli, () => away, { throttle: 1 });
      heli.blip = '#e33';
      m.music(0.3);
      const case_ = openDoor(m, limo, 3);
      await m.collect([case_], { label: "Bellwether left something in the limo. Grab his briefcase.", counter: 'BRIEFCASE' });
      await chat.done();
      await m.talk(['c8m3_14', 'c8m3_15', 'c8m3_16', 'c8m3_17', 'c8m3_18']);
      m.remove(heli);
      m.music(0);
      m.clearWanted();
      m.maxWanted(null);
    },
  },

  c8m4: {
    id: 'c8m4', chapter: 8, title: 'Golden Driller', giver: 'tess', start: 'c8_heli_walk', reward: 50000, requires: ['c8m3'],
    async run(m) {
      const chat = chatter(m);
      m.setTime(22);
      m.maxWanted(0);
      const van = m.spawnCar('arkvalley_newsvan', 'c8_van', 0, { health: 2200, locked: true });
      const tess = m.spawnPed('tess', m.offset('c8_van', -1, -5), { ai: 'idle' });
      const lucky = m.spawnPed('lucky', m.offset('c8_heli_walk', 4, -3), { ai: 'idle' });
      const brock = m.spawnPed('brock', m.offset('c8_van', 5, -4), { ai: 'idle' });
      const news = m.spawnCar('tallgrass_skywatch', 'c8_heli_pad', 0, { health: 1400 });
      await m.cutscene(['c8m4_01', 'c8m4_02', 'c8m4_03', 'c8m4_04', 'c8m4_05', 'c8m4_06'], { focus: 'c8_heli_pad' });
      m.remove(tess); m.remove(brock);
      lucky.ai.mode = 'flee';
      m.giveWeapon('smg', 400);
      m.giveWeapon('rifle', 600);
      await m.enterVehicle(news, 'Get in the news helicopter.');
      m.remove(lucky);
      m.message('Flying: {accel}/{brake} forward and back, {steer} turn, {climb} climb or settle. Hold {fireCar} to shoot.', 9);
      m.failIfDestroyed(van, 'The van went up, and Brock with it.');
      const dropHeli = m.failIfDestroyed(news, 'The news chopper went down.');
      // Bellwether comes in low from the west
      const vp = m.place('c8_van'), dr = m.place('c8_driller_foot'), crash = m.place('c8_crash');
      const bh = spawnChopper(m, m.offset('c8_van', -110, -40), 0.3, { model: 'gusher', weapon: 'rifle', dmgMul: 0.5 }, 3000);
      armor(bh, 0.2);
      let phase = 'strafe', theta = Math.PI, landT = 0;
      pilot(m, bh, (dt) => {
        if (phase === 'strafe') {
          // orbit the van so the door gunner has a clean line on it
          if (hyp(bh, vp) < 60) theta += dt * 0.16;
          return { x: vp.x + Math.cos(theta + 0.45) * 38, y: vp.y + Math.sin(theta + 0.45) * 30 };
        }
        if (phase === 'circle') {
          // a flat racetrack around the Golden Driller, over the lawns and 21st Street
          theta += dt * 0.05;
          return { x: dr.x + Math.cos(theta + 0.35) * 120, y: dr.y + 14 + Math.sin(theta + 0.35) * 30 };
        }
        if (phase === 'down') return crash;
        return null;
      }, { throttle: () => (phase === 'down' ? 0.45 : phase === 'circle' ? 0.75 : 0.7) });
      doorGunner(m, bh, () => {
        if (phase !== 'strafe' && phase !== 'circle') return null;
        const P = m.vehicle || m.ped;
        if (hyp(bh, P) < 45) return P;
        if (phase === 'strafe' && hyp(bh, vp) < 75) return van;
        return null;
      });
      // ramming: airborne helicopters don't collide in the engine, so trade paint by hand
      let ramCd = 0;
      every(m, (dt) => {
        ramCd -= dt;
        const v = m.vehicle;
        if (v === news && ramCd <= 0 && (phase === 'strafe' || phase === 'circle') && v.alt > 3 && hyp(v, bh) < 8.5) {
          const rel = Math.hypot(v.vx - bh.vx, v.vy - bh.vy);
          if (rel > 2) {
            ramCd = 1.2;
            bh.damage(140 + Math.min(rel, 12) * 25, m.ped);
            v.damage(40 + Math.min(rel, 12) * 4, null);
            const a = Math.atan2(bh.y - v.y, bh.x - v.x);
            bh.vx += Math.cos(a) * 6; bh.vy += Math.sin(a) * 6; v.vx -= Math.cos(a) * 4; v.vy -= Math.sin(a) * 4;
            const G = m.game;
            if (G && G.effects) G.effects.sparks((v.x + bh.x) / 2, (v.y + bh.y) / 2, 14, 30);
            if (G && G.cam && G.cam.addShake) G.cam.addShake(0.8);
          }
        }
        // phase changes driven by damage
        const hp = bh.health / bh.maxHealth;
        if (phase === 'strafe') m.bar('LIVE TRUCK', van.health / van.maxHealth, '#e8b030');
        else if (phase === 'circle') m.bar('BELLWETHER', (hp - 0.2) / 0.4, '#e33');
        if (phase === 'strafe' && hp < 0.6) { phase = 'circle'; theta = Math.atan2(bh.y - dr.y, bh.x - dr.x); chat.say('c8m4_11'); }
        if ((phase === 'strafe' || phase === 'circle') && hp <= 0.205) { phase = 'down'; m.clearBar(); chat.say(['c8m4_12', 'c8m4_13']); }
        if (phase === 'down' && (hyp(bh, crash) < 6 || (landT += dt) > 45)) { phase = 'landing'; bh.heliAltTarget = 0; }
        if (phase === 'landing' && bh.alt < 0.6) { phase = 'landed'; return false; }
      });
      m.music(1);
      chat.say(['c8m4_07', 'c8m4_08']);
      m.objective("Shoot down Bellwether's helicopter. Keep him off the news van.");
      m.wait(16).then(() => { if (phase === 'strafe') chat.say(['c8m4_09', 'c8m4_10']); }).catch(() => { });
      await m.waitFor(() => phase === 'landed');
      m.clearBar();
      // Bellwether staggers out of the smoking wreck toward the Driller
      const bw = m.spawnPed('whitlock', doorOf(bh, 1, 3), { ai: 'goto', target: dr, speed: 1.3, health: 400, blip: '#e8e0c0' });
      m.failIf(() => bw.dead, 'Bellwether is dead. Tulsa wanted him in a courtroom.');
      dropHeli();
      m.music(0.5);
      m.message('Enter sets the helicopter down. Enter again to climb out.', 6);
      m.objective('Land and catch Bellwether at the Golden Driller.');
      await m.waitFor((dt) => { if (bw.ai.mode === 'goto' && hyp(bw, dr) > 2) unstick(bw, dr, dt); return !m.vehicle && hyp(bw, m.player) < 4; });
      await chat.done();
      m.clearWanted();
      m.maxWanted(0);
      m.music(0);
      // the welcoming committee
      bw.ai.mode = 'idle';
      m.spawnPed('tess', m.offset(bw, -4, 5), { ai: 'idle' });
      m.spawnPed('lucky', m.offset(bw, 5, 5), { ai: 'idle' });
      const cp = m.roadAt('c8_driller_walk', { lane: true });
      m.spawnCar(COP_CAR, cp, cp.h, { locked: true }).sirenOn = true;
      m.spawnPed('cop', m.offset(bw, 3, -3), { ai: 'idle' });
      m.spawnPed('cop', m.offset(bw, -3, -3), { ai: 'idle' });
      await m.cutscene(['c8m4_14', 'c8m4_15', 'c8m4_16', 'c8m4_17'], { focus: bw });
      // epilogue: three weeks later, Broken Arrow
      m.teleport(m.offset('dewey_shop', -2, 4), -Math.PI / 2);
      m.setTime(10.5);
      m.message('Three weeks later. Broken Arrow.', 5);
      await m.wait(2.5);
      m.spawnPed('june', m.offset('dewey_shop', 1, 1.5), { ai: 'idle' });
      m.spawnPed('dewey', m.offset('dewey_shop', 3, 0), { ai: 'idle' });
      m.spawnPed('tess', m.offset('dewey_shop', -4, 1), { ai: 'idle' });
      m.spawnPed('lucky', m.offset('dewey_shop', 0, 6), { ai: 'idle' });
      await m.cutscene(['c8m4_18', 'c8m4_19', 'c8m4_20', 'c8m4_21', 'c8m4_22', 'c8m4_23', 'c8m4_24'], { focus: 'dewey_shop' });
      m.maxWanted(null);
    },
  },
};
