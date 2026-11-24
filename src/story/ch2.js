// Chapter 2 — River Money (Jenks, Bixby, Turkey Mountain, the Arkansas River)
// The Syndicate washes cash through a Jenks antique mall and runs it down the Arkansas by bass boat.
// River Spirit and the Oklahoma Aquarium are scenery only.

export const PLACES = {
  jenks_antiques: { lat: 36.02262, lon: -95.97000, name: 'Jenks Main Street' },
  jenks_ramp: { lat: 36.02089, lon: -95.95589, name: 'Old Jenks Boat Ramp' },
  aquarium_lot: { lat: 36.01986, lon: -95.95862, name: 'Aquarium Parking Lot' },
  bixby_dock: { lat: 35.97368, lon: -95.91158, name: "Pruitt's Dock" },
  turkey_trailhead: { lat: 36.06447, lon: -95.99340, name: 'Turkey Mountain Trailhead' },
  bixby_farm: { lat: 35.95864, lon: -95.89663, name: "Pruitt's Sod Farm" },
};

export const LINES = {
  // c2m1 Cash on the River
  c2m1_01: ['june', 'Jenks. Antique capital of Oklahoma. Every Thursday a Syndicate van leaves that antique mall heavier than it went in.'],
  c2m1_02: ['polly', "Somebody's buying an awful lot of butter churns."],
  c2m1_03: ['june', "Somebody's washing money, baby. Dirty cash goes in as old dressers and comes out somewhere clean. I want to know where."],
  c2m1_04: ['polly', 'So I follow the van.'],
  c2m1_05: ['june', "You follow the van. Take my Homestead. It's beige. Nobody in the history of Tulsa County has ever noticed a beige Homestead."],
  c2m1_06: ['polly', "That's either the best tail car in Oklahoma or the worst one."],
  c2m1_07: ['june', 'Stay back a few lengths. Couriers check their mirrors more than they check their teeth.'],
  c2m1_08: ['polly', "He's turning toward the river. Down past the aquarium."],
  c2m1_09: ['polly', 'Old boat ramp below the aquarium. Two guys, a bass boat, and a whole lot of duffel bags.'],
  c2m1_10: ['june', "A bass boat? On the Arkansas? That river's two inches deep and mostly sand."],
  c2m1_11: ['polly', "Deep enough for a flat-bottom. Shallow enough nobody follows. They're running the money downriver, June."],
  c2m1_12: ['june', "Then we'll take it off the water. Get out of there before they make you. I'll call your cousin."],
  c2m1_13: ['polly', 'Dewey and a boat. What could possibly go wrong.'],
  // c2m2 Bass Boat Getaway
  c2m2_01: ['dewey', "Okay. Okay okay okay. I watched that ramp all week from the aquarium lot. Me and the sharks are basically friends now."],
  c2m2_02: ['polly', 'Focus, Dewey.'],
  c2m2_03: ['dewey', "Right. Sundown, three guys load the cash. We take the boat, run it downriver, and my buddy Pruitt's got a dock above Bixby."],
  c2m2_04: ['polly', 'You want me to steal a boat. On the Arkansas River. Which is mostly sandbar.'],
  c2m2_05: ['dewey', "It's a flat-bottom! Those things float on a wet parking lot! Probably!"],
  c2m2_06: ['polly', 'Probably. Great. And where will you be?'],
  c2m2_07: ['dewey', 'At the dock with the truck. Somebody has to be the getaway driver for the getaway driver.'],
  c2m2_08: ['polly', 'These bags are heavy. Somebody in Jenks sold a whole lot of antiques.'],
  c2m2_09: ['thug', "That's our boat! Get the other boats in the water, now!"],
  c2m2_10: ['polly', 'Company. Boats coming up fast. Hang on, money.'],
  c2m2_11: ['dewey', 'Stay in the deep channel! The sandbars past the turnpike bridge will eat your prop!'],
  c2m2_12: ['dewey', "You made it! The bags made it! You're not even shot! This is the best day of my whole life!"],
  c2m2_13: ['polly', "Count it later. Somebody's going to miss this money, and they know who's crazy enough to take it."],
  c2m2_14: ['dewey', 'Who? Me?'],
  c2m2_15: ['polly', 'Us, Dewey. They know us.'],
  c2m2_16: ['polly', "No boat in the water yet. Fine. I'll take the boat and the truck it's sitting on."],
  c2m2_17: ['polly', 'Black trucks in the mirror. Stay with me, money.'],
  // c2m3 Turkey Mountain Scramble
  c2m3_01: ['lucky', 'Polly Haskins. You look good. Before you shoot me, let me say one thing.'],
  c2m3_02: ['polly', 'You have until I find a rock big enough, Lucky.'],
  c2m3_03: ['lucky', 'Race me. Once around the mountain. You win, I tell you everything. I win, I still tell you, but I feel better about it.'],
  c2m3_04: ['polly', 'Dirt bikes. On Elwood. At our age.'],
  c2m3_05: ['lucky', "Your age. I'm twenty-six in my heart. Me and the trail boys are on quads, so don't get sentimental in the turns."],
  c2m3_06: ['lucky', 'Still braking too early on the downhill, Pol!'],
  c2m3_07: ['polly', 'Still talking too much on the straightaway!'],
  c2m3_08: ['lucky', 'Okay. You won. You always won. That was sort of the whole problem.'],
  c2m3_09: ['polly', 'Talk. I did four years, Lucky. You did a disappearing act.'],
  c2m3_10: ['lucky', 'Corrigan. Detective Ray Corrigan. He grabbed me two days before the job. Had my record, my mama, her house, all of it.'],
  c2m3_11: ['lucky', "He said drive off when the alarm trips, or I do twenty and Mama loses the house. So I drove off."],
  c2m3_12: ['polly', 'And left me holding the bag.'],
  c2m3_13: ['lucky', "And left you holding the bag. Then Corrigan handed me to Tolliver like a used car. I've been driving for them ever since."],
  c2m3_14: ['polly', 'Why tell me now?'],
  c2m3_15: ['lucky', "Because you're the only person I know crazy enough to beat them. And because I owe you four years."],
  // c2m4 Bixby Bottoms
  c2m4_01: ['dewey', "Polly! Over here! Bixby's got more sod farms than people, so I figured nobody looks for money in dirt."],
  c2m4_02: ['polly', "You hid a quarter million dollars in somebody's lawn."],
  c2m4_03: ['dewey', 'In the hay bales. Next to the lawn. Pruitt owes me for a set of tractor tires. Wait. Do you hear trucks?'],
  c2m4_04: ['polly', 'Get behind the bales, Dewey, and stay there.'],
  c2m4_05: ['thug', 'Tolliver says leave the farm boy breathing. Everybody else is optional.'],
  c2m4_06: ['polly', "Optional. I'll have that put on my headstone."],
  c2m4_07: ['polly', 'More trucks coming down the section line. Keep your head down, Dewey.'],
  c2m4_08: ['dewey', "My head's so far down I'm basically a gopher!"],
  c2m4_09: ['polly', "Get in. We're going to June's. Nobody is dumb enough to shoot up Mama June's porch twice."],
  c2m4_10: ['dewey', 'Somebody shot it up once?'],
  c2m4_11: ['polly', 'Long story. Buckle up.'],
  c2m4_12: ['june', 'Dewey, honey, you smell like a hayloft. Polly, what is that in the bag?'],
  c2m4_13: ['polly', 'A ledger. Every Thursday the river money lands in one account. Bellwether Holdings.'],
  c2m4_14: ['june', "Of course it does. That old buzzard never met a dollar he didn't want to adopt."],
  c2m4_15: ['polly', "There's more. A payment every month, same amount, same name. Detective Ray Corrigan."],
  c2m4_16: ['dewey', "The cop? The cop's on the Syndicate payroll?"],
  c2m4_17: ['polly', 'The cop who put me away. The cop who squeezed Lucky. Now I know who signs his checks.'],
};

// ---------------------------------------------------------------- helpers
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const far = (m) => ({ x: m.x + 4000, y: m.y + 4000 });
// first filter that actually matches something in the vehicle catalog (spawnCar falls back to a random car otherwise)
function pick(m, ...filters) {
  for (const f of filters) {
    const probe = m.spawnCar(f, far(m), 0);
    const ok = !!f(probe.m);
    m.remove(probe);
    if (ok) return f;
  }
  return null;
}
// dialogue that plays while the player keeps driving; chained so lines never overlap
function chatter(m) {
  let p = Promise.resolve();
  return { say(ids) { p = p.then(() => m.talk(ids)).catch(() => { }); return p; }, done() { return p; } };
}
// background per-frame hook that never resolves (cleaned up with the mission)
function every(m, fn) { m.waitFor((dt) => { fn(dt); return false; }).catch(() => { }); }
// keep AI cars chasing the player (m.pursue only records the target's position once)
function hunt(m, cars) {
  let t = 0, on = true;
  every(m, (dt) => {
    if (!on || (t -= dt) > 0) return;
    t = 0.3;
    const T = m.vehicle || m.ped;
    for (const v of cars) if (!v.dead && v.driver && !v.driver.dead) m.pursue(v, T);
  });
  return () => { on = false; for (const v of cars) if (v.ai) v.ai.mode = 'cruise'; };
}

// Traffic AI can deadlock behind parked or wrong-way cars; clear whatever is wedged in front of a stalled mission car.
function unstick(m, v, dt, st) {
  st.t = v.speed < 0.6 && v.ai && v.ai.mode !== 'stop' ? (st.t || 0) + dt : 0;
  if (st.t < 5) return;
  st.t = 0;
  const g = m.game, fx = Math.cos(v.h), fy = Math.sin(v.h);
  for (const o of [...((g && g.vehicles) || [])]) {
    if (o === v || o.mission || o === m.vehicle) continue;
    const dx = o.x - v.x, dy = o.y - v.y, ahead = dx * fx + dy * fy, lat = Math.abs(-dx * fy + dy * fx);
    if (ahead > 0 && ahead < 16 && lat < 4 && g.removeVehicle) g.removeVehicle(o);
  }
  for (const p of [...((g && g.peds) || [])]) {
    if (p.isPlayer || p.mission || p.vehicle || p.giver) continue;
    const dx = p.x - v.x, dy = p.y - v.y, ahead = dx * fx + dy * fy, lat = Math.abs(-dx * fy + dy * fx);
    if (ahead > 0 && ahead < 12 && lat < 3 && g.removePed) g.removePed(p);
  }
}
// drive an AI car through road waypoints, then park it
function driveRoute(m, v, pts, o = {}) {
  let i = 0;
  m.driveTo(v, pts[0], o);
  return m.waitFor(() => {
    if (v.dead || !v.ai) return true;
    if (m.dist(v, pts[i]) < (o.r || 28)) {
      if (++i >= pts.length) { v.ai.mode = 'stop'; return true; }
      m.driveTo(v, pts[i], o);
    }
    return false;
  });
}

const BOAT = (v) => v.kind === 'boat';
const BASS_BOAT = (v) => v.kind === 'boat' && /bass|fish|jon|skiff|flat/i.test(`${v.class} ${v.name} ${v.id}`);
const FAST_BOAT = (v) => v.kind === 'boat' && /air ?boat|speed|cig|racing|go.?fast|runabout/i.test(`${v.class} ${v.name} ${v.id}`);
const BASS_RIG = (v) => v.id === 'redfork_bassrig' || (v.kind !== 'boat' && /bass ?boat/i.test(v.name || ''));
const SUV = (v) => v.class === 'suv';
const PICKUP = (v) => /pickup|ranchtruck|lifted/.test(v.class || '');

// Arkansas River centreline, Jenks ramp -> Pruitt's dock (world metres, traced from the map)
const RIVER = [
  [3420, 14700], [3567, 14892], [3621, 15188], [3657, 15486], [3746, 15775], [3827, 16066], [3859, 16365], [3941, 16654],
  [4001, 16949], [4140, 17223], [4298, 17478], [4501, 17699], [4705, 17899], [4943, 18053], [5165, 18224], [5376, 18408],
  [5586, 18593], [5793, 18783], [5985, 18987], [6145, 19218], [6341, 19420], [6541, 19620], [6760, 19800], [6960, 19930],
].map(([x, y]) => ({ x, y }));
const nearestIdx = (path, p) => { let bi = 0, bd = Infinity; for (let i = 0; i < path.length; i++) { const d = Math.hypot(path[i].x - p.x, path[i].y - p.y); if (d < bd) { bd = d; bi = i; } } return bi; };

// The engine's DriverAI only follows roads and NPCs never shoot from vehicles, so river chase boats get a small
// scripted pilot: follow the river centreline toward the player, ram when close, and fire bursts from the boat.
function boatPilot(m, boat, path, o = {}) {
  let armed = !o.wake, cd = 1.5 + Math.random() * 1.5, burst = 0;
  boat.ai = {
    mode: 'boat',
    update(dt) {
      const c = boat.ctrl, drv = boat.driver;
      if (!c) return;
      if (!drv || drv.dead || boat.dead) { c.throttle = 0; return; }
      const T = m.vehicle || m.ped;
      const dT = Math.hypot(T.x - boat.x, T.y - boat.y);
      if (!armed) { if (dT < o.wake) armed = true; else { c.throttle = 0; c.brake = 0; c.steer = 0; return; } }
      let tx, ty;
      if (dT < 110) { tx = T.x + (T.vx || 0) * 0.45; ty = T.y + (T.vy || 0) * 0.45; }
      else {
        const ci = nearestIdx(path, boat), pi = nearestIdx(path, T);
        const ti = ci < pi ? ci + 1 : ci > pi ? ci - 1 : pi;
        tx = path[ti].x; ty = path[ti].y;
      }
      const err = wrap(Math.atan2(ty - boat.y, tx - boat.x) - boat.h);
      c.steer = clamp(err * 2.4, -1, 1);
      c.brake = 0; c.handbrake = false;
      c.throttle = Math.abs(err) > 1.6 ? 0.35 : dT > 50 ? 1 : 0.7;
      // gunfire: peds inside vehicles are not ticked, so run the shooter's cooldowns here
      drv.fireCd = Math.max(0, (drv.fireCd || 0) - dt);
      if (drv.reloadT > 0) { drv.reloadT -= dt; if (drv.reloadT <= 0 && drv.finishReload) drv.finishReload(); }
      if ((cd -= dt) <= 0 && dT < 34) {
        const C = m.game && m.game.combat;
        if (C && C.tryFire) C.tryFire(drv, Math.atan2(T.y - boat.y, T.x - boat.x) + (Math.random() - 0.5) * 0.25, { vehicle: boat });
        if (++burst >= 4) { burst = 0; cd = 1.3 + Math.random() * 1.2; } else cd = 0.2;
      }
    },
  };
}

// ---------------------------------------------------------------- missions
export const MISSIONS = {
  c2m1: {
    id: 'c2m1', chapter: 2, title: 'Cash on the River', giver: 'june', start: 'jenks_antiques', reward: 3000,
    async run(m) {
      const chat = chatter(m);
      await m.cutscene(['c2m1_01', 'c2m1_02', 'c2m1_03', 'c2m1_04', 'c2m1_05', 'c2m1_06'], { focus: 'jenks_antiques' });
      // June's wagon waits on the antique shop forecourt, clear of the Main Street travel lanes.
      const forecourt = m.offset('jenks_antiques', 2, -4);
      const wagonModel = pick(m, (v) => v.id === 'osage_homestead', (v) => v.class === 'wagon', (v) => v.class === 'sedan');
      const wagon = m.spawnCar(wagonModel, forecourt, 0, { paint: 14, blip: '#4af' });
      const vs = m.roadAt({ x: 2100, y: 14535 }, { lane: true });
      const van = m.spawnCar((v) => v.class === 'van', vs, 0, { onRoad: true, driver: { model: null }, ai: 'stop', speed: 12, health: 1800 });
      van.blip = '#e8b030';
      m.failIfDestroyed(van, 'You wrecked the courier van. So much for following the money.');
      await m.enterVehicle(wagon, "Get in June's beige Homestead.");
      m.message('Tail the van. Not too close, not too far.', 5);
      // East on Main, up Riverfront, then off Aquarium Drive into the riverside lot.
      const route = [{ x: 2400, y: 14535 }, { x: 2700, y: 14536 }, { x: 2930, y: 14414 }, { x: 2935, y: 14335 }, { x: 3062, y: 14316 }, { x: 3150, y: 14410 }, { x: 3121, y: 14515 }, { x: 3164, y: 14609 }, { x: 3210, y: 14671 }, { x: 3211, y: 14713 }];
      const stop = route[route.length - 1];
      let leg = 0;
      driveRoute(m, van, route, { speed: 12 }).then(() => { leg = 2; }).catch(() => { });
      every(m, () => { if (leg === 0 && van.x > 2930) leg = 1; });
      m.wait(5).then(() => chat.say('c2m1_07')).catch(() => { });
      m.waitFor(() => leg >= 1).then(() => chat.say('c2m1_08')).catch(() => { });
      await m.follow(van, { maxDist: 170, minDist: 20, spotTime: 3, until: stop, untilR: 28, rangeLabel: 'COURIER', label: 'Tail the courier van. Stay 20–170 m back.',
        lostMsg: 'You lost the van.', spottedMsg: 'The courier made you.' });
      van.blip = null;
      await m.waitFor(() => van.speed < 1.5, { timeout: 8 });
      await chat.done();
      // the boat crew at the ramp
      const crew = [m.spawnPed(null, { x: 3312, y: 14712 }, { weapon: 'pistol', ai: 'idle', faction: 'syndicate' }),
        m.spawnPed(null, { x: 3322, y: 14726 }, { weapon: 'shotgun', ai: 'idle', faction: 'syndicate' })];
      const bb = pick(m, BASS_BOAT, BOAT);
      if (bb) m.spawnCar(bb, { x: 3346, y: 14722 }, 0);
      await m.cutscene(['c2m1_09', 'c2m1_10', 'c2m1_11', 'c2m1_12'], { focus: 'jenks_ramp' });
      const exit = m.marker({ x: 2969, y: 14912 }, { label: 'Aquarium Drive' });
      m.objective('Get 320 m clear of the ramp. Aquarium Drive heads southwest.');
      await m.waitFor(() => m.dist('jenks_ramp') > 320);
      m.unmark(exit);
      await m.talk('c2m1_13');
    },
  },

  c2m2: {
    id: 'c2m2', chapter: 2, title: 'Bass Boat Getaway', giver: 'dewey', start: 'aquarium_lot', reward: 3500, requires: ['c2m1'],
    async run(m) {
      const chat = chatter(m);
      m.setTime(19.4);
      await m.cutscene(['c2m2_01', 'c2m2_02', 'c2m2_03', 'c2m2_04', 'c2m2_05', 'c2m2_06', 'c2m2_07'], { focus: 'jenks_ramp' });
      m.giveWeapon('smg', 180);
      m.message('The SMG fires forward from a moving vehicle. Hold {fireCar} while you drive.', 6);
      const boatModel = pick(m, BASS_BOAT, BOAT);
      const crew = m.gang(3, { x: 3296, y: 14716 }, { weapon: 'pistol', spread: 8, faction: 'syndicate', ai: 'guard', range: 30, health: 70 });
      // getaway ride: a bass boat at the water's edge, or (no boats in the catalog yet) the bass-boat rig on the access road
      const ride = boatModel
        ? m.spawnCar(boatModel, { x: 3343, y: 14722 }, 0, { health: 1600 })
        : m.spawnCar(pick(m, BASS_RIG, PICKUP), { x: 3204, y: 14700 }, 0, { health: 1600 });
      m.failIfDestroyed(ride, boatModel ? 'The boat sank, and the money with it.' : 'The truck is scrap, and the money with it.');
      m.music(0.8);
      await m.kill(crew, { label: 'Take out the boat crew at the old ramp.', counter: 'CREW' });
      await m.collect([{ x: 3318, y: 14710 }, { x: 3326, y: 14728 }], { label: 'Grab the cash bags.', counter: 'BAGS' });
      await m.talk('c2m2_08');
      if (!boatModel) await m.talk('c2m2_16');
      await m.enterVehicle(ride, boatModel ? 'Get in the bass boat.' : 'Get in the bass-boat rig.');
      m.music(1);
      if (boatModel) {
        // river chase: one crew boat from upriver, two waiting downstream
        const fast = pick(m, FAST_BOAT, BOAT);
        const chasers = [
          m.spawnCar(fast, { x: 3520, y: 14470 }, Math.PI / 2, { driver: { model: null, weapon: 'smg', dmgMul: 0.8, accuracy: 1.5 }, health: 650, blip: '#e33' }),
          m.spawnCar(fast, { x: 4380, y: 17560 }, -2.2, { driver: { model: null, weapon: 'pistol', dmgMul: 0.9 }, health: 650, blip: '#e33' }),
          m.spawnCar(fast, { x: 5690, y: 18680 }, -2.3, { driver: { model: null, weapon: 'smg', dmgMul: 0.8 }, health: 650, blip: '#e33' }),
        ];
        boatPilot(m, chasers[0], RIVER);
        boatPilot(m, chasers[1], RIVER, { wake: 320 });
        boatPilot(m, chasers[2], RIVER, { wake: 320 });
        chat.say(['c2m2_09', 'c2m2_10']);
        m.waitFor(() => m.dist({ x: 3700, y: 15700 }) < 200).then(() => chat.say('c2m2_11')).catch(() => { });
        const cps = [{ x: 3640, y: 15400 }, { x: 4298, y: 17478 }, { x: 5481, y: 18501 }, { x: 6541, y: 19620 }];
        for (let i = 0; i < cps.length; i++) {
          m.counter('RIVER', i, cps.length + 1);
          await m.goto(cps[i], { r: 70, vehicle: ride, label: i ? 'Keep running downriver.' : 'Run the money down the Arkansas. Stay in the channel.' });
        }
        m.counter('RIVER', cps.length, cps.length + 1);
        await m.deliver(ride, { x: 7095, y: 19962 }, { r: 18, maxSpeed: 7, exit: true, label: "Bring the boat in to Pruitt's dock and cut the motor." });
        m.clearCounter();
        // step ashore onto the dock
        m.teleport({ x: 7290, y: 19945 }, 0);
        for (const c of chasers) if (c.ai) c.ai = null;
        await chat.done();
      } else {
        const rigs = [
          m.spawnCar(SUV, m.roadAt({ x: 2600, y: 14540 }, { lane: true }), null, { onRoad: true, driver: { model: null, weapon: 'pistol' }, ai: 'pursue', health: 1200, blip: '#e33' }),
          m.spawnCar(PICKUP, m.roadAt({ x: 3100, y: 15100 }, { lane: true }), null, { onRoad: true, driver: { model: null, weapon: 'pistol' }, ai: 'pursue', health: 1200, blip: '#e33' }),
        ];
        const calloff = hunt(m, rigs);
        chat.say(['c2m2_09', 'c2m2_17']);
        await m.deliver(ride, 'bixby_dock', { label: "Haul the money to Pruitt's dock above Bixby.", r: 9, exit: true });
        calloff();
      }
      m.music(0.3);
      m.clearWanted();
      const truck = m.spawnCar(PICKUP, { x: 7312, y: 19930 }, Math.PI, {});
      m.spawnPed('dewey', { x: 7300, y: 19950 }, { ai: 'idle' });
      truck.locked = true;
      await m.cutscene(['c2m2_12', 'c2m2_13', 'c2m2_14', 'c2m2_15'], { focus: 'bixby_dock' });
    },
  },

  c2m3: {
    id: 'c2m3', chapter: 2, title: 'Turkey Mountain Scramble', giver: 'lucky', start: 'turkey_trailhead', reward: 3500, requires: ['c2m1'],
    async run(m) {
      const chat = chatter(m);
      m.maxWanted(1);
      await m.cutscene(['c2m3_01', 'c2m3_02', 'c2m3_03', 'c2m3_04', 'c2m3_05'], { focus: 'turkey_trailhead' });
      const RIDE = pick(m,
        (v) => v.kind === 'motorbike' && /dirt|enduro|trail|moto|scram|mx/i.test(`${v.class} ${v.name} ${v.id}`),
        (v) => v.kind === 'atv' || /\batv\b|quad/i.test(`${v.class} ${v.name}`),
        (v) => v.kind === 'motorbike',
        (v) => v.class === 'offroad' || v.class === 'lifted');
      // AI opponents ride quads: the engine throws riders off two-wheelers on any bump over 9 m/s
      const QUAD = pick(m, (v) => v.kind === 'atv' && /\batv\b|quad/i.test(`${v.class} ${v.name}`), (v) => v.kind === 'atv') || RIDE;
      // grid on Elwood south of the trailhead, pointing south (+y)
      const S = Math.PI / 2;
      // grid on Elwood below the trailhead light, far enough from the trailhead that Lucky isn't standing in two places
      const lane = (dy) => m.roadAt({ x: -86, y: 10000 + dy }, { lane: true });
      const oppDefs = [{ dy: 48, model: 'lucky' }, { dy: 33, model: null }, { dy: 18, model: null }];
      const opps = oppDefs.map((o) => { const p = lane(o.dy); return m.spawnCar(QUAD, p, S, { onRoad: true, driver: { model: o.model, health: 400 }, ai: 'stop', health: o.model ? 4000 : 1200, blip: o.model ? '#ff6a3a' : '#e8b030' }); });
      const lucky = opps[0].driver;
      let luckyShot = false;
      m.on('pedKilled', (p, by) => { if (p === lucky && by && by.isPlayer) luckyShot = true; });
      m.failIf(() => luckyShot, 'You killed Lucky. Whatever he knew died with him.');
      const st = opps.map(() => ({}));
      every(m, (dt) => opps.forEach((o, i) => { if (!o.dead && o.ai && o.ai.mode === 'goto') unstick(m, o, dt, st[i]); }));
      const gridP = lane(0);
      const bike = m.spawnCar(RIDE, { x: gridP.x, y: gridP.y }, S, { health: 900 });
      m.failIfDestroyed(bike, 'You totaled your ride.');
      await m.enterVehicle(bike, 'Get on your ride at the starting line on Elwood.');
      await m.goto(gridP, { r: 7, vehicle: bike, label: 'Line up on the grid.' });
      for (const n of ['3', '2', '1']) { m.message(n, 0.9); await m.wait(1); }
      m.message('GO!', 1.5);
      // tight checkpoints at the corners keep the AI riders (greedy road routing) on course past the US-75 ramps
      const cps = [{ x: -86, y: 10262 }, { x: -650, y: 10282 }, { x: -1100, y: 10268 }, { x: -1250, y: 10267 }, { x: -1400, y: 10267 }, { x: -1665, y: 10274 },
        { x: -1698, y: 10170 }, { x: -1698, y: 9480 }, { x: -1698, y: 8712 }].map((p) => m.roadAt(p));
      m.waitFor(() => m.dist(cps[1]) < 40).then(() => chat.say('c2m3_06')).catch(() => { });
      m.waitFor(() => m.dist(cps[7]) < 60).then(() => chat.say('c2m3_07')).catch(() => { });
      m.music(0.8);
      m.objective('Beat Lucky around Turkey Mountain: down Elwood, west on 71st, up Union.');
      await m.race(cps, { opponents: opps, oppSpeed: 31, r: 11, loseMsg: 'Lucky beat you. Again.' });
      m.music(0);
      for (const o of opps) if (o.ai) o.ai.mode = 'stop';
      await chat.done();
      await m.cutscene(['c2m3_08', 'c2m3_09', 'c2m3_10', 'c2m3_11', 'c2m3_12', 'c2m3_13', 'c2m3_14', 'c2m3_15'], { focus: cps[cps.length - 1] });
      m.maxWanted(null);
    },
  },

  c2m4: {
    id: 'c2m4', chapter: 2, title: 'Bixby Bottoms', giver: 'dewey', start: 'bixby_farm', reward: 4500, requires: ['c2m2', 'c2m3'],
    async run(m) {
      const chat = chatter(m);
      const clock = { t: 0 };
      every(m, (dt) => { clock.t += dt; });
      await m.cutscene(['c2m4_01', 'c2m4_02', 'c2m4_03', 'c2m4_04'], { focus: 'bixby_farm' });
      m.maxWanted(1);
      m.giveWeapon('shotgun', 40);
      m.ped.armor = Math.max(m.ped.armor, 60);
      m.message('Dewey left his old deer-season vest on the porch. Body armor: 60.', 5);
      const hide = { x: 8700, y: 21655 };
      // two Syndicate trucks rolling in from both ends of the section line
      const wave = (from, n, weapon) => {
        const start = m.roadAt(from, { lane: true });
        const truck = m.spawnCar(PICKUP, start, null, { onRoad: true, driver: { model: null }, ai: 'goto', speed: 22, health: 1100, blip: '#e33' });
        m.driveTo(truck, 'bixby_farm', { speed: 22 });
        return { truck, n, weapon, out: null };
      };
      const waves = [wave({ x: 8140, y: 21563 }, 3, 'pistol'), wave({ x: 9060, y: 21830 }, 3, 'smg')];
      const unload = async (w) => {
        const t0 = clock.t;
        await m.waitFor(() => w.truck.dead || m.dist(w.truck, 'bixby_farm') < 35 || clock.t - t0 > 16);
        if (w.truck.ai) w.truck.ai.mode = 'stop';
        w.out = m.gang(w.n, m.offset(w.truck, 0, 0), { weapon: w.weapon, spread: 6, faction: 'syndicate', health: 75 });
        return w.out;
      };
      m.objective('Hold the farm. Keep the Syndicate off Dewey.');
      const first = await unload(waves[0]);
      await m.talk('c2m4_05');
      chat.say('c2m4_06');
      const firstAll = [...first, ...(await unload(waves[1]))];
      await m.kill(firstAll, { label: 'Take out the Syndicate crew.', counter: 'HOODS' });
      await chat.done();
      await m.talk(['c2m4_07', 'c2m4_08']);
      const w3 = wave({ x: 8140, y: 21563 }, 4, 'pistol');
      const second = await unload(w3);
      await m.kill(second, { label: 'Clear the second wave.', counter: 'HOODS' });
      // Dewey comes out from behind the hay (wait for the giver stand-in to despawn first)
      await m.waitFor(() => clock.t > 41);
      const dewey = m.spawnPed('dewey', hide, { ai: 'idle', health: 140 });
      m.failIf(() => dewey.dead, 'Dewey is dead.');
      if (!m.vehicle) {
        const p = m.roadAt('bixby_farm', { lane: true });
        m.spawnCar(PICKUP, p, p.h, { blip: '#4af' });
      }
      await m.talk(['c2m4_09', 'c2m4_10', 'c2m4_11']);
      m.maxWanted(2);
      const hunters = [
        m.spawnCar(SUV, m.roadAt({ x: 9500, y: 22400 }, { lane: true }), null, { onRoad: true, driver: { model: null, weapon: 'pistol' }, ai: 'pursue', health: 1200, blip: '#e33' }),
        m.spawnCar(SUV, m.roadAt({ x: 7900, y: 21300 }, { lane: true }), null, { onRoad: true, driver: { model: null, weapon: 'pistol' }, ai: 'pursue', health: 1200, blip: '#e33' }),
      ];
      const calloff = hunt(m, hunters);
      await m.escort(dewey, 'mama_june_house', { label: "Get Dewey and the ledger to Mama June's in Broken Arrow.", name: 'Dewey', r: 9 });
      calloff();
      m.maxWanted(null);
      m.clearWanted();
      m.spawnPed('june', m.offset('mama_june_house', 2, 1.5), { ai: 'idle' });
      await m.cutscene(['c2m4_12', 'c2m4_13', 'c2m4_14', 'c2m4_15', 'c2m4_16', 'c2m4_17'], { focus: 'mama_june_house' });
    },
  },
};
