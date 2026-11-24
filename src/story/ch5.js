// Chapter 5 — Port of Catoosa (Catoosa, the Blue Whale, the Tulsa Port of Catoosa, the Verdigris River)
// Catfish Carl runs the docks at the head of navigation. Something big is coming upriver.

export const PLACES = {
  c5_whale: { lat: 36.19329, lon: -95.73308, name: 'Blue Whale of Catoosa' },
  c5_carl_dock: { lat: 36.230383, lon: -95.731061, name: "Catfish Carl's Dock" },
  c5_carl_water: { lat: 36.230365, lon: -95.730939, name: "Carl's slip" },
  c5_channel_rd: { lat: 36.23062, lon: -95.73219, name: 'West Channel Road' },
  c5_wharf: { lat: 36.23911, lon: -95.73441, name: 'Syndicate Wharf' },
  c5_wharf_t1: { lat: 36.23883, lon: -95.73486, name: 'Wharf apron' },
  c5_wharf_t2: { lat: 36.23937, lon: -95.73480, name: 'Wharf apron' },
  c5_wharf_t3: { lat: 36.23815, lon: -95.73424, name: 'Wharf apron' },
  c5_tug: { lat: 36.23901, lon: -95.73552, name: 'Barge tug' },
  c5_unload: { lat: 36.238568, lon: -95.734610, name: 'Wharf landing' },
  c5_lot1: { lat: 36.23539, lon: -95.72189, name: 'Port yard' },
  c5_lot2: { lat: 36.232784, lon: -95.720425, name: 'Port yard' },
  c5_lot3: { lat: 36.23946, lon: -95.73191, name: 'Port yard' },
  c5_field: { lat: 36.25013, lon: -95.72801, name: 'Hay field off Highway 266' },
  c5_field_rd: { lat: 36.24948, lon: -95.72760, name: 'Highway 266' },
  c5_casino_lot: { lat: 36.17914, lon: -95.74748, name: 'Catoosa, Route 66' },
  c5_acct: { lat: 36.182253, lon: -95.746880, name: 'Route 66' },
  c5_r66_north: { lat: 36.24326, lon: -95.67560, name: 'Route 66 toward Claremore' },
  c5_landing: { lat: 36.19388, lon: -95.68735, name: "Cousin Earl's landing" },
  c5_landing_bank: { lat: 36.19325, lon: -95.68735, name: "Cousin Earl's landing" },
  c5_landing_rd: { lat: 36.19144, lon: -95.68735, name: 'East 570 Road' },
};

// Channel waypoints (all water, checked against the map): downriver from Carl's slip to Earl's landing.
const RIVER_DOWN = [
  { lat: 36.22246, lon: -95.72762 },
  { lat: 36.21116, lon: -95.71605 },   // Route 66 bridge reach
  { lat: 36.20365, lon: -95.70682 },
  { lat: 36.19551, lon: -95.69825 },
  { lat: 36.19397, lon: -95.69180 },
];
// Syndicate boat run: up the channel to the wharf landing.
const RAID_PATH = [
  { lat: 36.228972, lon: -95.730127 },
  { lat: 36.235520, lon: -95.732663 },
  { lat: 36.238342, lon: -95.735423 },
];

export const LINES = {
  // c5m1 Whale of a Time
  c5m1_01: ['carl', "Well butter my biscuit, Polly Haskins! Mama June said I'd know you by the scowl. Come say hey to the whale."],
  c5m1_02: ['polly', 'Catfish Carl. June says you run a dock at the port and owe her a favor.'],
  c5m1_03: ['carl', 'Owe her three. She pulled me out of the Verdigris in seventy nine. Long story. Involves a goat.'],
  c5m1_04: ['polly', "Leave the goat out of it. What's the Syndicate doing way up here?"],
  c5m1_05: ['carl', "Bellwether's boys moved onto my dock last week. Said the lease changed hands. I've had that dock since disco."],
  c5m1_06: ['carl', "They're sitting on it right now, drinking my bait shop coffee. I'd run 'em off myself, but my aim ain't what it was."],
  c5m1_07: ['polly', 'Your aim, or your nerve?'],
  c5m1_08: ['carl', "Both, darlin'. Head up West Channel Road to the port. Can't miss it. It's the dock with the ugly flag."],
  c5m1_09: ['thug', 'This dock is private property now. Turn around, lady.'],
  c5m1_10: ['polly', 'Funny. Carl says otherwise.'],
  c5m1_11: ['carl', 'Hoo! Look at that. My dock, my coffee, and my dignity, all returned in one afternoon.'],
  c5m1_12: ['polly', 'What were they guarding, Carl? Nobody fights that hard over a bait shop.'],
  c5m1_13: ['carl', "Containers, honey. Coming upriver on barges three nights a week. Stamped farm equipment. Ain't no tractor that heavy."],
  c5m1_14: ['polly', "Then let's find out what's in them."],
  // c5m2 Container Shuffle
  c5m2_01: ['carl', "Here's my thinking. The Syndicate's got three rigs sitting in the port yard, waiting on tonight's barge."],
  c5m2_02: ['carl', "We take the rigs, the barge has nothing to load, and Bellwether's shipping schedule goes right in the ditch."],
  c5m2_03: ['polly', 'Where do I take them?'],
  c5m2_04: ['carl', "Hay field off Highway 266, up by Verdigris. My nephew Boone's got a tarp the size of Rhode Island."],
  c5m2_05: ['carl', "Port security runs a gate check every couple minutes. So, you know. Don't sightsee."],
  c5m2_06: ['carl', "That's one! Boone says it smells like diesel and bad decisions. Go get the next."],
  c5m2_07: ['polly', "This one's got a tracker blinking under the dash. Somebody's going to come looking."],
  c5m2_08: ['thug', 'Pull over and step out of the truck. Mister Bellwether wants his property back.'],
  c5m2_09: ['polly', 'Tell Mister Bellwether he can file a claim.'],
  c5m2_10: ['carl', 'Three for three! Boone pried one open. You want to guess what was inside?'],
  c5m2_11: ['polly', 'Not tractors.'],
  c5m2_12: ['carl', 'Survey stakes. Thousands of them. County plat maps, and a crate of brand new signs that say Tolliver Development.'],
  c5m2_13: ['polly', "They're not shipping goods up this river. They're shipping a land grab."],
  // c5m3 Barge Breaker
  c5m3_01: ['carl', "Barge came in early. It's tied up at the Syndicate wharf on the east channel, loaded to the gills."],
  c5m3_02: ['carl', "Now, I can't let you sink a whole barge. The Corps of Engineers gets real fussy. But the cargo on the wharf? Fair game."],
  c5m3_03: ['carl', "Here. My brother in law's rocket launcher. Don't ask. He was going through a phase."],
  c5m3_04: ['polly', 'Carl, why does a bait shop owner keep a rocket launcher?'],
  c5m3_05: ['carl', "Big catfish, darlin'. Real big catfish."],
  c5m3_06: ['carl', "Boats coming up the channel! Sink 'em before they reach the wharf, or you'll have company!"],
  c5m3_07: ['thug', 'Hit the dock! Hit the dock! Somebody shoot that woman!'],
  c5m3_08: ['polly', "Cargo's burning. The barge is still floating, Carl. Just like you asked."],
  c5m3_09: ['carl', "Then that's a good day on the river. The insurance man can sort out the rest."],
  c5m3_10: ['carl', "Listen. Tess Okafor called the shop. Says Tolliver's money man is in Catoosa tonight, with a laptop he never lets out of his sight."],
  c5m3_11: ['polly', "Then I'll ask him nicely to let it out of his sight."],
  // c5m4 Long Count
  c5m4_01: ['tess', "Polly. Over here. Silver sedan on Route 66. That's Gerald Pike, Tolliver's accountant. He counts every dollar the Syndicate washes."],
  c5m4_02: ['polly', 'He looks like a man who irons his socks.'],
  c5m4_03: ['tess', 'He does. He also carries a laptop with every land deal Tolliver has closed in the last five years.'],
  c5m4_04: ['tess', "If he reaches Claremore, he's on a private plane by midnight, and so is the evidence. Take my car. Please bring it back."],
  c5m4_05: ['polly', "He's not reaching Claremore."],
  c5m4_06: ['tess', "He spotted you! He's running north on Route 66, toward Claremore!"],
  c5m4_07: ['brock', "Gerald, keep driving. Miss Haskins, that laptop is company property. I'd hate for there to be an accident."],
  c5m4_08: ['polly', "Brock, you're always hating things that haven't happened yet."],
  c5m4_09: ['polly', "Got the laptop. Gerald's going to need a new car, and a long talk with his chiropractor."],
  c5m4_10: ['tess', 'Bring it to Carl\'s dock. I can crack the password. He uses his mother\'s birthday for everything.'],
  c5m4_11: ['polly', 'How do you know that?'],
  c5m4_12: ['tess', "I'm a journalist. Also, he told me. On a date. It went badly."],
  // c5m5 Head of Navigation
  c5m5_01: ['tess', "I'm in. Polly, look at this map. These aren't random lots. Every parcel Tolliver bought lines up."],
  c5m5_02: ['polly', 'Lines up to where?'],
  c5m5_03: ['tess', 'South. Through Jenks and Bixby, straight to Glenpool. Every easement and every deed points at the old Ida Glenn field.'],
  c5m5_04: ['carl', "Ladies? Hate to interrupt the book club, but there's about forty police cars on West Channel Road."],
  c5m5_05: ['dispatch', 'All units, armed suspect at the Port of Catoosa. Detective Corrigan requests a full response.'],
  c5m5_06: ['polly', 'Corrigan. Of course he does.'],
  c5m5_07: ['carl', "Everybody in the airboat! The river don't have roadblocks!"],
  c5m5_08: ['carl', "Under the Route 66 bridge! That'll shake the chopper for a minute!"],
  c5m5_09: ['dispatch', 'Air One has lost visual on the river. Ground units, hold the banks.'],
  c5m5_10: ['carl', "Yee haw! Head of navigation, my foot. This here's the head of getting the heck out of Rogers County!"],
  c5m5_11: ['carl', "That's cousin Earl's landing. You two get going. I'll sink this airboat in the shallows and tell 'em it was stolen."],
  c5m5_12: ['tess', "Polly, Bellwether doesn't want Catoosa. He wants Glenpool. Whatever's under that field is worth more than everything he's bought."],
  c5m5_13: ['polly', 'Then we go to Glenpool.'],
};

// ---------------------------------------------------------------- helpers
// Per-frame hooks that coexist (m.onTick is a single slot). A hook returning false is removed.
function everyFrame(m, fn) {
  if (!m._c5hooks) {
    const hooks = (m._c5hooks = []);
    m.onTick = (dt) => { for (const h of hooks.slice()) if (h(dt) === false) hooks.splice(hooks.indexOf(h), 1); };
  }
  m._c5hooks.push(fn);
}
// m.pursue aims at a snapshot of the target's position, so refresh it every frame.
function hunt(m, cars) {
  everyFrame(m, () => {
    let live = 0;
    for (const c of cars) if (!c.dead && c.driver && c.ai && !c.driver.dead) { m.pursue(c, m.player); live++; }
    return live > 0;
  });
}
// Spawn the first spec whose catalog model really matches (filters fall back to vehicle 0 when nothing does).
function spawnBest(m, specs, pos, h, opts) {
  for (let i = 0; i < specs.length; i++) {
    const v = m.spawnCar(specs[i], pos, h, opts);
    if (i === specs.length - 1 || specs[i](v.m)) return v;
    m.remove(v);
  }
  return null;
}
// Scripted boat: glides along water waypoints (AI drivers only know roads). Stops if the player takes it.
function sail(m, boat, path, speed, onArrive) {
  const pts = path.map((p) => m.place(p));
  let i = 0;
  everyFrame(m, (dt) => {
    if (boat.dead || boat.sunk || m.vehicle === boat) return false;
    const p = pts[i];
    const dx = p.x - boat.x, dy = p.y - boat.y, d = Math.hypot(dx, dy), step = speed * dt;
    const want = Math.atan2(dy, dx);
    let dh = want - boat.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    boat.h += dh * Math.min(1, dt * 3);
    if (d <= step + 0.5) { i++; if (i >= pts.length) { if (onArrive) onArrive(boat); return false; } return undefined; }
    boat.x += (dx / d) * step; boat.y += (dy / d) * step;
    return undefined;
  });
}
// m.wanted(n) can lose a star on the very next frame if no cop has seen the player for a while
// (the evasion clock isn't reset), so set it again two frames later.
function heat(m, n) {
  m.wanted(n);
  let k = 0;
  everyFrame(m, () => { if (++k < 2) return undefined; m.wanted(n); return false; });
}
// Fire-and-forget dialogue (no dangling rejected promise if the mission ends mid-line).
function say(m, ids) { m.talk(ids).catch(() => {}); }
const isBoat = (v) => v.kind === 'boat';
const isBass = (v) => v.kind === 'boat' && /bass/i.test(v.class + v.name);
const isAirboat = (v) => v.kind === 'boat' && /air/i.test(v.class + v.name);
const isRig = (v) => /semitrailer|boxtruck|semi/i.test(v.class || '');
const isSuv = (v) => v.class === 'suv';
const isSedan = (v) => /sedan|luxury|fullsize/i.test(v.class || '');
const isSporty = (v) => /sports|muscle|coupe/i.test(v.class || '') && v.kind === 'car';
const isPickup = (v) => /pickup/i.test(v.class || '') && v.kind === 'car';

// ---------------------------------------------------------------- missions
export const MISSIONS = {
  c5m1: {
    id: 'c5m1', chapter: 5, title: 'Whale of a Time', giver: 'carl', start: 'c5_whale', reward: 8000,
    async run(m) {
      const carl = m.spawnPed('carl', m.offset('c5_whale', 3, -2), { ai: 'idle' });
      await m.cutscene(['c5m1_01', 'c5m1_02', 'c5m1_03', 'c5m1_04', 'c5m1_05', 'c5m1_06', 'c5m1_07', 'c5m1_08'], { focus: 'c5_whale' });
      m.remove(carl);
      m.giveWeapon('shotgun', 40);
      m.giveWeapon('pistol', 120);
      if (!m.vehicle) m.message('Grab a car off Route 66.', 4);
      await m.goto('c5_channel_rd', { r: 40, label: "Drive up West Channel Road to Carl's dock at the Port of Catoosa." });
      const suv = spawnBest(m, [isSuv, (v) => v.kind === 'car'], m.offset('c5_channel_rd', 0, 26), null, { onRoad: true });
      const crew = m.gang(5, m.offset('c5_carl_dock', -14, 2), { weapon: 'pistol', models: ['gusher'], spread: 14, ai: 'guard', range: 34, health: 80 });
      crew.push(...m.gang(1, m.offset('c5_carl_dock', -6, -10), { weapon: 'shotgun', models: ['gusher'], ai: 'guard', range: 26, health: 110 }));
      await m.goto('c5_carl_dock', { r: 75, label: "Clear the Syndicate off Carl's dock." });
      await m.talk(['c5m1_09', 'c5m1_10']);
      for (const p of crew) if (!p.dead && p.ai) p.ai.mode = 'attack';
      m.music(1);
      await m.kill(crew, { label: "Take out the Syndicate crew on Carl's dock.", counter: 'HEAVIES' });
      m.music(0);
      if (suv && !suv.dead) m.remove(suv);
      await m.loseCops('Lose the cops, then meet Carl at his dock.');
      await m.goto('c5_carl_dock', { r: 5, onFoot: true, label: 'Meet Carl at the end of his dock.' });
      m.spawnPed('carl', m.offset('c5_carl_dock', 5, 4), { ai: 'idle' });
      await m.cutscene(['c5m1_11', 'c5m1_12', 'c5m1_13', 'c5m1_14'], { focus: 'c5_carl_dock' });
    },
  },

  c5m2: {
    id: 'c5m2', chapter: 5, title: 'Container Shuffle', giver: 'carl', start: 'c5_carl_dock', reward: 10000, requires: ['c5m1'],
    async run(m) {
      m.spawnPed('carl', m.offset('c5_carl_dock', 5, 4), { ai: 'idle' });
      await m.cutscene(['c5m2_01', 'c5m2_02', 'c5m2_03', 'c5m2_04', 'c5m2_05'], { focus: 'c5_carl_dock' });
      const yards = [['c5_lot1', 0.2], ['c5_lot2', 1.6], ['c5_lot3', -1.2]];
      for (let i = 0; i < 3; i++) {
        const [yard, h] = yards[i];
        if (!m.vehicle) m.message('Steal a car to get around the port.', 4);
        await m.goto(yard, { r: 70, label: `Head into the port yard and find Syndicate rig ${i + 1} of 3.` });
        const rig = spawnBest(m, [isRig, (v) => v.kind === 'truck'], yard, h, { blip: '#4af' });
        m.gang(2, m.offset(rig, 7, 6), { weapon: i === 2 ? 'smg' : 'pistol', models: ['gusher'], ai: 'guard', range: 26, spread: 4 });
        await m.enterVehicle(rig, 'Steal the Syndicate rig.');
        if (i === 1) say(m, 'c5m2_07');
        let tail = [];
        if (i === 2) {
          const opts = { onRoad: true, driver: { model: 'gusher', weapon: 'pistol' }, ai: 'pursue', blip: '#e33', health: 1100 };
          // they come down Highway 266 from both directions
          tail = [spawnBest(m, [isSuv, (v) => v.kind === 'car'], m.offset('c5_field_rd', -420, 0), null, opts),
            spawnBest(m, [isSuv, (v) => v.kind === 'car'], m.offset('c5_field_rd', 380, 0), null, opts)];
          hunt(m, tail);
          say(m, ['c5m2_08', 'c5m2_09']);
        }
        m.timer(i === 2 ? 240 : 270, 'GATE CHECK', { fail: 'Port security found the empty bay.' });
        await m.deliver(rig, 'c5_field', { label: 'Drive the rig to the hay field off Highway 266.', r: 10, maxDamage: 0.75, damageMsg: 'The rig is wrecked.' });
        m.stopTimer();
        for (const t of tail) if (t && !t.dead) m.remove(t);
        m.giveMoney(1000);
        if (i < 2) {
          if (i === 0) await m.talk('c5m2_06');
          const ride = spawnBest(m, [isPickup, (v) => v.kind === 'car'], { lat: 36.250089, lon: -95.727902 }, 3.1);
          ride.blip = '#4af';
          m.message("Boone left his pickup by the road. Take it back to the port.", 5);
        }
      }
      await m.cutscene(['c5m2_10', 'c5m2_11', 'c5m2_12', 'c5m2_13'], { focus: 'c5_field' });
    },
  },

  c5m3: {
    id: 'c5m3', chapter: 5, title: 'Barge Breaker', giver: 'carl', start: 'c5_carl_dock', reward: 12000, requires: ['c5m2'],
    async run(m) {
      m.spawnPed('carl', m.offset('c5_carl_dock', 5, 4), { ai: 'idle' });
      await m.cutscene(['c5m3_01', 'c5m3_02', 'c5m3_03', 'c5m3_04', 'c5m3_05'], { focus: 'c5_carl_dock' });
      m.giveWeapon('smg', 240);
      m.giveWeapon('rocket', 14);
      m.message('{weapons} switch weapons. Rockets work on boats and trucks alike.', 6);
      await m.goto('c5_wharf', { r: 90, label: 'Get to the Syndicate wharf on the east channel.' });
      // cargo: container rigs on the apron and the barge tug alongside
      const cargo = [];
      for (const [p, h] of [['c5_wharf_t1', 1.2], ['c5_wharf_t2', 1.3], ['c5_wharf_t3', 1.1]]) cargo.push(spawnBest(m, [isRig, (v) => v.kind === 'truck'], p, h, { health: 900 }));
      const tug = spawnBest(m, [(v) => v.kind === 'boat' && /pontoon/i.test(v.class + v.name), isBoat], 'c5_tug', 1.25, { health: 700 });
      if (tug.m.kind === 'boat') cargo.push(tug); else m.remove(tug);
      const gunmen = m.gang(4, m.offset('c5_wharf_t1', 24, 8), { weapon: 'pistol', models: ['gusher'], spread: 14, ai: 'guard', range: 30, health: 80 });
      // the raid: boats run up the channel; any that reach the landing put a crew ashore
      let launched = 0;
      const raiders = [];
      const launch = () => {
        launched++;
        const b = spawnBest(m, [isBass, isBoat], RAID_PATH[0], -1.9, { blip: '#e33', health: 420 });
        if (b.m.kind !== 'boat') { m.remove(b); return; }
        raiders.push(b);
        sail(m, b, RAID_PATH.slice(1), 21, () => {
          b.blip = null;
          b._landed = true;
          gunmen.push(...m.gang(3, 'c5_unload', { weapon: 'smg', models: ['gusher'], spread: 4, health: 70 }));
          say(m, 'c5m3_07');
        });
      };
      m.on('enter', (v) => { if (raiders.includes(v)) { v.blip = null; v._landed = true; } }); // the player stole a raider boat
      m.music(1);
      launch();
      say(m, 'c5m3_06');
      let clock = 0;
      everyFrame(m, (dt) => { clock += dt; if (launched < 3 && clock > 20 * launched) launch(); return launched < 3 ? undefined : false; });
      await m.destroy(cargo, { label: 'Blow up the Syndicate cargo. Sink the boats before they land.', counter: 'CARGO' });
      await m.talk('c5m3_08');
      m.objective('Hold the wharf until the raid is over.');
      await m.waitFor(() => launched >= 3 && raiders.every((r) => r.dead || r._landed || m.vehicle === r));
      const left = gunmen.filter((p) => !p.dead);
      if (left.length) await m.kill(left, { label: 'Finish off the Syndicate gunmen.', counter: 'GUNMEN' });
      m.music(0);
      await m.loseCops('Lose the cops.');
      await m.goto('c5_carl_dock', { r: 6, label: "Head back to Carl's dock." });
      m.spawnPed('carl', m.offset('c5_carl_dock', 5, 4), { ai: 'idle' });
      await m.cutscene(['c5m3_09', 'c5m3_10', 'c5m3_11'], { focus: 'c5_carl_dock' });
    },
  },

  c5m4: {
    id: 'c5m4', chapter: 5, title: 'Long Count', giver: 'tess', start: 'c5_casino_lot', reward: 12000, requires: ['c5m3'],
    async run(m) {
      const tess = m.spawnPed('tess', m.offset('c5_casino_lot', 2, 2), { ai: 'idle' });
      // Pike's sedan idles on Route 66 pointing north-east, toward Claremore
      const pike = spawnBest(m, [isSedan, (v) => v.kind === 'car'], 'c5_acct', -0.95, { onRoad: true, driver: { model: null }, ai: 'stop', health: 1300, blip: '#e33' });
      const ride = spawnBest(m, [isSporty, (v) => v.kind === 'car'], m.offset('c5_casino_lot', 6, 9), -0.9);
      await m.cutscene(['c5m4_01', 'c5m4_02', 'c5m4_03', 'c5m4_04', 'c5m4_05'], { focus: 'c5_acct' });
      m.remove(tess);
      await m.enterVehicle(ride, "Get in Tess's car.");
      m.driveTo(pike, 'c5_r66_north', { speed: 31 });
      const guard = spawnBest(m, [isSuv, (v) => v.kind === 'car'], m.offset('c5_acct', -40, 40), null, { onRoad: true, driver: { model: 'gusher', weapon: 'pistol' }, ai: 'pursue', blip: '#e33', health: 1200 });
      hunt(m, [guard]);
      say(m, ['c5m4_06', 'c5m4_07', 'c5m4_08']);
      m.music(1);
      const escape = m.place('c5_r66_north');
      m.failIf(() => !pike.dead && Math.hypot(pike.x - escape.x, pike.y - escape.y) < 45, 'Pike made it out to Claremore.');
      m.timer(260, 'CLAREMORE', { fail: 'Pike made it out to Claremore.' });
      m.objective('Run Gerald Pike off the road before he reaches Claremore.');
      await m.waitFor(() => pike.dead || pike.health < pike.maxHealth * 0.3);
      m.stopTimer();
      if (pike.ai) pike.ai.mode = 'stop';
      m.music(0.4);
      const wreck = { x: pike.x + Math.cos(pike.h + Math.PI / 2) * 3, y: pike.y + Math.sin(pike.h + Math.PI / 2) * 3 };
      await m.collect([wreck], { label: "Grab Pike's laptop from the car.", counter: 'LAPTOP' });
      await m.talk(['c5m4_09', 'c5m4_10', 'c5m4_11', 'c5m4_12']);
      m.music(0);
      await m.loseCops('Lose the cops.');
      await m.goto('c5_carl_dock', { r: 6, label: "Bring the laptop to Carl's dock." });
    },
  },

  c5m5: {
    id: 'c5m5', chapter: 5, title: 'Head of Navigation', giver: 'carl', start: 'c5_carl_dock', reward: 15000, requires: ['c5m4'],
    async run(m) {
      const carl = m.spawnPed('carl', m.offset('c5_carl_dock', 5, 4), { ai: 'idle' });
      const tess = m.spawnPed('tess', m.offset('c5_carl_dock', 4, 7), { ai: 'idle' });
      const boat = spawnBest(m, [isAirboat, isBoat], 'c5_carl_water', 1.35, { health: 2200 });
      await m.cutscene(['c5m5_01', 'c5m5_02', 'c5m5_03', 'c5m5_04', 'c5m5_05', 'c5m5_06', 'c5m5_07'], { focus: 'c5_carl_dock' });
      heat(m, 4);
      m.music(1);
      m.failIf(() => carl.dead, 'Carl went in the river.');
      m.failIf(() => tess.dead, 'Tess was killed.');
      await m.enterVehicle(boat, "Get in Carl's airboat. It's tied up at the end of the dock.");
      carl.ai.mode = 'follow';
      tess.ai.mode = 'follow';
      m.objective('Wait for Carl and Tess to climb aboard.');
      await m.waitFor(() => carl.vehicle === boat && tess.vehicle === boat, { timeout: 25, failMsg: 'You left Carl and Tess on the dock.' });
      m.objective('Run the river! Head downstream through the channel.');
      for (let i = 0; i < RIVER_DOWN.length; i++) {
        m.counter('CHANNEL', i, RIVER_DOWN.length);
        await m.goto(RIVER_DOWN[i], { r: 34, vehicle: boat });
        if (i === 1) { say(m, ['c5m5_08', 'c5m5_09']); m.wanted(2); }
      }
      m.clearCounter();
      say(m, 'c5m5_10');
      await m.loseCops('Lose the last of the cops on the river.');
      await m.goto('c5_landing', { r: 30, vehicle: boat, label: "Pull in at cousin Earl's landing." });
      m.music(0);
      await m.cutscene(['c5m5_11', 'c5m5_12', 'c5m5_13'], { focus: 'c5_landing_bank' });
      // hop out and let Tess drive: the player lands at the start of chapter 6, in Glenpool
      await m.deliver(boat, 'c5_landing', { r: 300, maxSpeed: 99 });
      m.teleport({ lat: 35.95660, lon: -96.01020 }, -Math.PI / 2);
      m.message('Tess drives you south to Glenpool.', 5);
    },
  },
};
