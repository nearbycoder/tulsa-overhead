// Chapter 7 — Osage Hills (Owasso, Skiatook Lake, the Osage County hills and tallgrass prairie, Pawhuska, Bartlesville)
// Framed for Tess's kidnapping and hunted by every badge in Green Country, Polly runs north to Ranger Nadine Rowe.

export const PLACES = {
  c7_mohawk: { lat: 36.22220, lon: -95.91130, name: 'Mohawk Park' },
  c7_owasso: { lat: 36.26970, lon: -95.85501, name: 'Main Street, Owasso' },
  c7_hills: { lat: 36.36819, lon: -96.08274, name: 'Highway 20, Osage hills' },
  c7_cbay: { lat: 36.374893, lon: -96.126195, name: 'Crystal Bay ranger post' },
  c7_cbay_rd: { lat: 36.375309, lon: -96.126006, name: 'Crystal Bay Drive' },
  c7_cbay_loop: { lat: 36.376330, lon: -96.127064, name: 'Crystal Bay Drive loop' },
  c7_cbay_land: { lat: 36.374694, lon: -96.126339, name: 'Crystal Bay ramp' },
  c7_cbay_boat: { lat: 36.374712, lon: -96.126807, name: "Nadine's patrol boat" },
  c7_paw_north: { lat: 36.70690, lon: -96.33640, name: 'County Road 4201, north of Pawhuska' },
  c7_convoy_start: { lat: 36.70872, lon: -96.33686, name: 'County Road 4201' },
  c7_ranch_gate: { lat: 36.739002, lon: -96.360887, name: 'Ranch gate' },
  c7_ranch: { lat: 36.738875, lon: -96.361332, name: 'The old Tate place' },
  c7_ranch_tess: { lat: 36.738722, lon: -96.361610, name: 'Ranch yard' },
  c7_ranch_truck: { lat: 36.738807, lon: -96.360991, name: 'Pickup by the barn' },
  c7_ranch_north: { lat: 36.74670, lon: -96.36376, name: 'County Road 4201, north' },
  c7_overlook: { lat: 36.737094, lon: -96.358885, name: 'Rise south of the ranch' },
  c7_bridge: { lat: 36.66020, lon: -96.33172, name: 'Lynn Avenue bridge over Bird Creek' },
  c7_price: { lat: 36.748805, lon: -95.976401, name: 'Price Tower' },
  c7_bv_start: { lat: 36.746284, lon: -95.975277, name: 'Adams Boulevard, Bartlesville' },
  c7_bv_adams: { lat: 36.74255, lon: -95.94448, name: 'Adams Boulevard' },
  c7_bv_75: { lat: 36.71013, lon: -95.93514, name: 'Highway 75 south of Bartlesville' },
};

// Water routes on Skiatook Lake (every leg checked against the map): main lake -> Crystal Bay ramp.
const BOAT_A = [
  { lat: 36.373491, lon: -96.133093 },
  { lat: 36.374938, lon: -96.128865 },
  { lat: 36.374848, lon: -96.127530 },
  { lat: 36.374649, lon: -96.126640 },
];
const BOAT_B = [
  { lat: 36.369421, lon: -96.134984 },
  { lat: 36.374938, lon: -96.129755 },
  { lat: 36.374938, lon: -96.127975 },
  { lat: 36.374649, lon: -96.126640 },
];
// The spotter idles in the bay mouth, then runs for the open lake.
const SPOTTER = [
  { lat: 36.372731, lon: -96.131847 },
  { lat: 36.369421, lon: -96.134984 },
  { lat: 36.369060, lon: -96.135429 },
  { lat: 36.374757, lon: -96.140102 },
];
// County Road 4201 from the bend north of Pawhuska up to the ranch gate.
const CR4201 = [
  { lat: 36.71789, lon: -96.33125 },
  { lat: 36.72956, lon: -96.34391 },
  { lat: 36.73435, lon: -96.34937 },
  { lat: 36.73446, lon: -96.35682 },
  { lat: 36.73802, lon: -96.35909 },
  'c7_ranch_gate',
];

// The bagman's run: east on Adams Boulevard (US 60), then south on Washington Boulevard (US 75) toward Tulsa.
const BV_ROUTE = [
  { lat: 36.74617, lon: -95.96756 },
  { lat: 36.74474, lon: -95.95987 },
  'c7_bv_adams',
  { lat: 36.72091, lon: -95.93515 },
  'c7_bv_75',
];

export const LINES = {
  // c7m1 Most Wanted
  c7m1_01: ['june', "Baby, your face is on every TV in Green Country. They're saying you kidnapped that reporter girl."],
  c7m1_02: ['polly', "Bellwether's people took Tess and dressed it up to look like me. Corrigan signed the warrant himself."],
  c7m1_03: ['june', "I figured. I brought cash, a burner phone, and one of Dewey's sandwiches. Do not eat the sandwich."],
  c7m1_04: ['polly', 'Where do I even go, June? Every cop from here to Muskogee has my picture taped to the dash.'],
  c7m1_05: ['june', "North. Up through Owasso and out into the Osage hills. There's a ranger at Skiatook Lake named Nadine Rowe."],
  c7m1_06: ['june', "Nadine and I go back thirty years. She doesn't trust the news, and she doesn't scare."],
  c7m1_07: ['polly', 'Sounds like my kind of people.'],
  c7m1_08: ['june', "Hear that? Sirens. Somebody followed me. Dewey's spare car is on the park road. Go, baby, and don't you dare get caught."],
  c7m1_09: ['dispatch', 'All units, Polly Haskins sighted at Mohawk Park. Suspect is armed and wanted for kidnapping. Detective Corrigan has the lead.'],
  c7m1_10: ['polly', "Armed. I've got a burner phone and a sandwich I'm not allowed to eat."],
  c7m1_11: ['lucky', "Polly, it's Lucky. Don't hang up. Corrigan's got roadblocks on Highway seventy five. Stay on the back roads to Skiatook."],
  c7m1_12: ['polly', 'Give me one reason to believe a single word you say.'],
  c7m1_13: ['lucky', "I'm going back inside the Syndicate tonight. If Tess is alive, I'll find out where they're keeping her."],
  c7m1_14: ['polly', "Lucky. Don't get yourself killed before I get the chance."],
  c7m1_15: ['dispatch', 'Air One is returning to base. All units, suspect last seen westbound on Highway twenty past Skiatook.'],
  c7m1_16: ['nadine', "This is Nadine Rowe. June says you're the trouble she called about. Come on down to Crystal Bay. Headlights off."],
  c7m1_17: ['nadine', "You're shorter than June described. She said ten feet tall and mean as a snake."],
  c7m1_18: ['polly', "I'm mean as a snake. The rest is good posture."],
  c7m1_19: ['nadine', 'Get that car under the trees. Nobody comes down to the bay this time of year but me and the catfish.'],
  // c7m2 Ranger Station
  c7m2_01: ['nadine', "Coffee's on. Now tell me straight. Did you take that reporter?"],
  c7m2_02: ['polly', "No ma'am. Bellwether's people took her, and Corrigan pinned it on me so nobody would go looking."],
  c7m2_03: ['nadine', "That's what June said. I've worked this lake twenty two years. I know a liar by how they hold a coffee cup."],
  c7m2_04: ['nadine', "Trouble is, somebody else knows you're here. Two trucks just turned off Highway twenty with their headlights dark."],
  c7m2_05: ['polly', 'Syndicate. They never knock.'],
  c7m2_06: ['nadine', "Then we don't answer. Take my deer rifle and the scattergun. I'll get on the radio to the few folks I trust."],
  c7m2_07: ['nadine', "This is Corps of Engineers shoreline, and I don't care for gunfire on it. So aim careful."],
  c7m2_08: ['thug', 'Haskins! Mister Bellwether says come quiet, and nobody has to get wet.'],
  c7m2_09: ['polly', "It's a lake, genius. Somebody's getting wet."],
  c7m2_10: ['nadine', 'Boats in the cove! Two bass boats coming in off the main lake. Sink them before they reach the ramp!'],
  c7m2_11: ['thug', 'Run it up on the ramp! Go, go, go!'],
  c7m2_12: ['polly', 'Crew boss had a phone. Texts from Corrigan. Move the package at dawn. Pawhuska. County Road forty two oh one.'],
  c7m2_13: ['nadine', "The package is your reporter. And that boat sitting out on the lake is their spotter. He's calling this in."],
  c7m2_14: ['nadine', "My patrol boat's tied up at the ramp. Or shoot him from the bank. I won't tell anybody."],
  c7m2_15: ['nadine', "Well. That's a whole lot of paperwork for one morning."],
  c7m2_16: ['polly', "They're moving Tess up to Pawhuska at dawn. Tallgrass country."],
  c7m2_17: ['nadine', "I know every cattle guard between here and Kansas. I'll trailer the four wheelers. We'll be in Pawhuska by sunup."],
  c7m2_18: ['polly', "Why are you helping me, Nadine? You don't know me from Adam."],
  c7m2_19: ['nadine', "I know June. And I know who's been buying land around my lake with somebody else's name on the deeds."],
  // c7m3 Bison Country
  c7m3_01: ['nadine', "Sun's up. That's County Road forty two oh one. It runs north out of Pawhuska, straight into the tallgrass."],
  c7m3_02: ['nadine', 'Two pickups and a black SUV just came up from town. If that phone was right, your reporter is riding in the SUV.'],
  c7m3_03: ['polly', 'Why not hit them on the road?'],
  c7m3_04: ['nadine', 'Six guns, open country, and a hostage in the middle. We find where they keep her. Then we pick the ground.'],
  c7m3_05: ['nadine', "Take the four wheeler. Stay in the grass, stay off the ridgeline, and don't get close enough to wave."],
  c7m3_06: ['polly', 'Low and slow. Just how my parole officer likes it.'],
  c7m3_07: ['nadine', 'There they go. Give them a long leash. Out here, dust carries for a mile.'],
  c7m3_08: ['nadine', "Bison on the ridge to your left. Two thousand pounds of not caring. Don't spook them."],
  c7m3_09: ['polly', "Wasn't planning on it. I've got enough enemies today."],
  c7m3_10: ['nadine', 'Too close, Polly. Drop back into the bluestem before somebody checks a mirror.'],
  c7m3_11: ['thug', 'Ranch, this is the convoy. Ten minutes out. Tell Corrigan the package is quiet.'],
  c7m3_12: ['polly', "Package. I'm going to make that man eat that word."],
  c7m3_13: ['polly', 'They pulled into a ranch at the edge of the blackjack oaks. Barn yard, trailers, and more guns than a gun show.'],
  c7m3_14: ['nadine', "That's the old Tate place. Sold last spring to a company nobody around here ever heard of."],
  c7m3_15: ['polly', 'Let me guess. Tolliver Development.'],
  c7m3_16: ['nadine', "Through three shell companies and a lawyer in Tulsa. Sit tight. I'm bringing more ammunition."],
  // c7m4 Pawhuska Standoff
  c7m4_01: ['nadine', "I count eight on the ground, maybe more in the barn. Body armor and rifles. These aren't the usual parking lot boys."],
  c7m4_02: ['polly', 'Corrigan brought the varsity.'],
  c7m4_03: ['nadine', "I'll be waiting at the Lynn Avenue bridge over Bird Creek with my truck. Get Tess out and get her to me."],
  c7m4_04: ['nadine', 'And Polly? Pawhuska is a nice town. Try to leave it the way you found it.'],
  c7m4_05: ['polly', "No promises. But I'll try to keep it out of the newspaper."],
  c7m4_06: ['thug', "Somebody's in the grass! Everybody up! Watch the trees!"],
  c7m4_07: ['thug', 'Reinforcements coming down forty two oh one! Pin her down!'],
  c7m4_08: ['tess', "Polly? Polly! I told them you'd come. They laughed. Who's laughing now?"],
  c7m4_09: ['polly', 'Not them. Are you hurt?'],
  c7m4_10: ['tess', 'Bruised and very angry. Corrigan was here. He took my notebooks, but that man talks way too much on the phone.'],
  c7m4_11: ['tess', "There's a pickup by the barn with the keys in it. Nobody out here ever takes their keys."],
  c7m4_12: ['thug', "They're running for town! Cut them off on the county road!"],
  c7m4_13: ['tess', 'Two trucks behind us! Polly, drive like you mean it!'],
  c7m4_14: ['polly', 'I always mean it.'],
  c7m4_15: ['nadine', "Right on time. Miss Okafor, I'm Nadine. You're safe now, or near enough."],
  c7m4_16: ['tess', 'Polly, Corrigan kept saying Bartlesville. Something about a handoff by the Price Tower tonight.'],
  c7m4_17: ['polly', 'Lucky texted the same thing. Bartlesville, Price Tower, nine o\'clock. Come alone.'],
  c7m4_18: ['nadine', "I'll take Tess to my sister's place in Hominy. You go see your man in Bartlesville."],
  c7m4_19: ['polly', "He's not my man. He's my problem. Different thing entirely."],
  // c7m5 Price of the Tower
  c7m5_01: ['lucky', 'Frank Lloyd Wright built one skyscraper in his whole life, and he put it in Bartlesville. Kind of romantic.'],
  c7m5_02: ['polly', 'You dragged me all the way to Bartlesville to talk architecture?'],
  c7m5_03: ['lucky', 'No. I dragged you here for this. A recording. Corrigan on the phone with Bellwether, planning your whole frame job.'],
  c7m5_04: ['lucky', "Names, dates, and Bellwether telling him to make the reporter disappear quiet. It's the last piece, Polly."],
  c7m5_05: ['polly', 'Lucky. Thank you. I mean it.'],
  c7m5_06: ['lucky', "Don't thank me yet. Corrigan's bagman is idling on Adams Boulevard right now, in Corrigan's own unmarked car."],
  c7m5_07: ['lucky', "Trunk's got Tess's notebooks, her camera, and the burner they used for the ransom calls. He's driving it all to Bellwether."],
  c7m5_08: ['lucky', "It's in a fireproof lockbox. Bellwether's paranoid. So feel free to be rough with that car."],
  c7m5_09: ['polly', "Best news I've had all week."],
  c7m5_10: ['lucky', "There he goes! Gray Meridian, heading for Highway seventy five! Take my car, it's right there!"],
  c7m5_11: ['dispatch', 'Bartlesville units, shots fired downtown. Be advised, the vehicle involved is registered to Detective Ray Corrigan.'],
  c7m5_12: ['polly', "If he makes Highway seventy five, he's in Tulsa in forty minutes. Not today."],
  c7m5_13: ['polly', "Lockbox is scorched, but it's all here. Notebooks, camera, burner phone. Tess is going to cry."],
  c7m5_14: ['corrigan', 'Haskins. That was my car.'],
  c7m5_15: ['polly', 'Was, Ray. Past tense. Kind of like your career.'],
  c7m5_16: ['corrigan', 'Mister Bellwether would like to settle this. Saturday night, the State Fair, under the Golden Driller. Bring the box.'],
  c7m5_17: ['corrigan', 'Come alone, and your aunt keeps her tire shop. Bring friends, and Dewey learns to swim in the Arkansas.'],
  c7m5_18: ['lucky', "Let me guess. Corrigan wants a meeting. Somewhere crowded, so you can't make a scene."],
  c7m5_19: ['polly', "The State Fair, under the Golden Driller. It's a trap, and we're going anyway. Somebody bring corn dogs."],
};

// ---------------------------------------------------------------- helpers
// Per-frame hooks that coexist (m.onTick is a single slot). A hook returning false is removed.
function everyFrame(m, fn) {
  if (!m._c7hooks) {
    const hooks = (m._c7hooks = []);
    m.onTick = (dt) => { for (const h of hooks.slice()) if (h(dt) === false) hooks.splice(hooks.indexOf(h), 1); };
  }
  m._c7hooks.push(fn);
}
// Fire-and-forget dialogue, queued so overlapping calls never clobber each other.
function say(m, ids) {
  m._c7say = (m._c7say || Promise.resolve()).then(() => m.talk(ids)).catch(() => {});
  return m._c7say;
}
function hush(m) { return m._c7say || Promise.resolve(); }
// A cast member standing exactly where the engine's giver ped stands (start + 2.2, 0.8). The giver ped is
// dropped 40 s into a mission, so long scenes need their own copy; the two overlap invisibly until then.
function castAt(m, id, pos, opts = {}) {
  return m.spawnPed(id, m.offset(pos, 2.2, 0.8), { ai: 'idle', h: Math.PI, health: 2000, ...opts });
}
// Mission clock (seconds since run() began); the giver ped is gone once it passes 41.
function clock(m) {
  m._c7t = 0;
  everyFrame(m, (dt) => { m._c7t += dt; return undefined; });
}
// Quietly drop a cast member once the player is well clear of them.
function dismissWhenFar(m, ped, r = 80) {
  everyFrame(m, () => { if (ped.dead || m.dist(ped) > r) { m.remove(ped); return false; } return undefined; });
}
// Heading from one place to another.
function facing(m, a, b) { const p = m.place(a), q = m.place(b); return Math.atan2(q.y - p.y, q.x - p.x); }
// m.pursue aims at a snapshot of the target's position, so refresh it every frame.
function hunt(m, cars) {
  everyFrame(m, () => {
    let live = 0;
    for (const c of cars) if (c && !c.dead && c.driver && c.ai && !c.driver.dead) { m.pursue(c, m.player); live++; }
    return live > 0;
  });
}
// Drive an AI vehicle through a list of waypoints, then stop. onDone(v) fires on arrival.
// If the driver wedges itself off the road (sharp corners, convoy fender benders), it is put back on the lane.
function route(m, v, pts, speed, onDone) {
  const P = pts.map((p) => m.place(p));
  let i = 0, still = 0;
  m.driveTo(v, P[0], { speed });
  everyFrame(m, (dt) => {
    if (v.dead || !v.ai || !v.driver || v.driver.dead || v.driver.isPlayer) return false;
    const p = P[i];
    still = v.speed < 1 && v.ai.mode !== 'stop' ? still + dt : 0;
    if (still > 4 && m.dist(v) > 60) {
      still = 0;
      const r = m.roadAt(v, { lane: true });
      const want = Math.atan2(p.y - r.y, p.x - r.x);
      const h = Math.cos(r.h - want) >= 0 ? r.h : r.h + Math.PI;
      v.x = r.x + Math.cos(h) * 4; v.y = r.y + Math.sin(h) * 4; v.h = h;
      m.driveTo(v, p, { speed });
    }
    if (Math.hypot(v.x - p.x, v.y - p.y) < (i === P.length - 1 ? 24 : 40)) {
      i++;
      if (i >= P.length) { v.ai.mode = 'stop'; if (onDone) onDone(v); return false; }
      m.driveTo(v, P[i], { speed });
    }
    return undefined;
  });
}
// The crew climbs out: swap the AI-driven truck for a parked copy and put a gang on the ground beside it.
function unload(m, v, n, opts) {
  if (v.dead) return [];
  const at = { x: v.x, y: v.y }, h = v.h, id = v.m.id, paint = v.paint;
  m.remove(v);
  m.spawnCar(id, at, h, { paint });
  const side = { x: at.x + Math.cos(h + Math.PI / 2) * 4.5, y: at.y + Math.sin(h + Math.PI / 2) * 4.5 };
  return m.gang(n, side, { spread: 3, ...opts });
}
// Truck run: drive in along the roads; unload on arrival, when boxed in by parked cars near the end,
// or wherever it got to after `late` seconds.
function truckRun(m, v, pts, speed, late, n, gangOpts, onCrew) {
  let done = false, t = 0, still = 0;
  const end = m.place(pts[pts.length - 1]);
  const drop = () => { if (done) return; done = true; if (!v.dead) onCrew(unload(m, v, n, gangOpts)); };
  route(m, v, pts, speed, drop);
  everyFrame(m, (dt) => {
    if (done || v.dead) return false;
    t += dt;
    still = v.speed < 1 ? still + dt : 0;
    if (t > late || (still > 2.5 && Math.hypot(v.x - end.x, v.y - end.y) < 220)) { drop(); return false; }
    return undefined;
  });
}
// Scripted boat: glides along water waypoints (AI drivers only know roads). Stops if the player takes it.
function sail(m, boat, path, speed, onArrive) {
  const pts = path.map((p) => m.place(p));
  let i = 0;
  everyFrame(m, (dt) => {
    if (boat.dead || boat.sunk || m.vehicle === boat) return false;
    const p = pts[i];
    const dx = p.x - boat.x, dy = p.y - boat.y, d = Math.hypot(dx, dy), step = speed * dt;
    let dh = Math.atan2(dy, dx) - boat.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    boat.h += dh * Math.min(1, dt * 3);
    if (d <= step + 0.5) { i++; if (i >= pts.length) { if (onArrive) onArrive(boat); return false; } return undefined; }
    boat.x += (dx / d) * step; boat.y += (dy / d) * step;
    return undefined;
  });
}
// A point a few metres behind a vehicle, snapped to the road lane.
function behind(m, pos, h, metres) {
  const p = m.place(pos);
  return m.roadAt({ x: p.x - Math.cos(h) * metres, y: p.y - Math.sin(h) * metres }, { lane: true });
}
const alive = (list) => list.filter((p) => p && !p.dead);
const GOONS = { models: ['gusher'], ai: 'guard' };

// ---------------------------------------------------------------- missions
export const MISSIONS = {
  c7m1: {
    id: 'c7m1', chapter: 7, title: 'Most Wanted', giver: 'june', start: 'c7_mohawk', reward: 12000,
    async run(m) {
      const june = castAt(m, 'june', 'c7_mohawk');
      const ride = m.spawnCar('cimarron_dustdevil', m.roadAt('c7_mohawk', { lane: true }), null, { onRoad: true });
      await m.cutscene(['c7m1_01', 'c7m1_02', 'c7m1_03', 'c7m1_04', 'c7m1_05', 'c7m1_06', 'c7m1_07', 'c7m1_08'], { focus: 'c7_mohawk' });
      m.giveMoney(2500);
      m.giveWeapon('pistol', 90);
      dismissWhenFar(m, june);
      m.wanted(4);
      m.music(1);
      ride.blip = '#4af';
      m.message("Dewey's spare car is parked on the road. Take it, or take anything.", 5);
      say(m, ['c7m1_09', 'c7m1_10']);
      await m.goto('c7_owasso', { r: 70, label: 'Run north. Get through Owasso on Main Street.' });
      ride.blip = null;
      say(m, ['c7m1_11', 'c7m1_12', 'c7m1_13', 'c7m1_14']);
      await m.goto('c7_hills', { r: 60, label: 'Head for the Osage hills. Take Highway 20 west past Skiatook.' });
      say(m, 'c7m1_15');
      m.maxWanted(2);
      await m.loseCops('Lose the cops in the hills.');
      m.music(0);
      m.maxWanted(null);
      await say(m, 'c7m1_16');
      await m.goto('c7_cbay', { r: 8, label: 'Meet Nadine Rowe at the Crystal Bay ranger post on Skiatook Lake.' });
      const nadine = castAt(m, 'nadine', 'c7_cbay');
      await hush(m);
      await m.cutscene(['c7m1_17', 'c7m1_18', 'c7m1_19'], { focus: 'c7_cbay' });
      m.remove(nadine);
    },
  },

  c7m2: {
    id: 'c7m2', chapter: 7, title: 'Ranger Station', giver: 'nadine', start: 'c7_cbay', reward: 14000, requires: ['c7m1'],
    async run(m) {
      clock(m);
      const cabin = m.offset('c7_cbay', 60, -70);
      const nadine = castAt(m, 'nadine', 'c7_cbay', { target: cabin, speed: 3 });
      let boss = null, bossSpot = null;
      m.on('pedKilled', (p) => { if (p === boss) bossSpot = { x: p.x, y: p.y }; });
      await m.cutscene(['c7m2_01', 'c7m2_02', 'c7m2_03', 'c7m2_04', 'c7m2_05', 'c7m2_06', 'c7m2_07'], { focus: 'c7_cbay' });
      m.giveWeapon('shotgun', 64);
      m.giveWeapon('sniper', 30);
      m.message('{weapons} switch weapons. The deer rifle reaches a long way.', 6);
      // she heads up to the cabin to work the radio once the giver ped has gone
      everyFrame(m, () => {
        if (m._c7t < 41) return undefined;
        if (nadine.ai.mode !== 'goto') nadine.ai.mode = 'goto';
        if (m.dist(nadine, cabin) < 3 || m.dist(nadine) > 90) { m.remove(nadine); return false; }
        return undefined;
      });
      m.maxWanted(1);
      m.music(0.6);
      m.objective('Hold the ranger post. Two trucks are coming down Crystal Bay Drive.');
      // wave one: two trucks down the access road
      const crews = [];
      let landed = 0;
      const tA = m.roadAt(m.offset('c7_cbay_rd', 160, -620), { lane: true });
      const tB = m.roadAt(m.offset('c7_cbay_rd', 210, -700), { lane: true });
      const trucks = [
        m.spawnCar('redfork_mudbogger', tA, facing(m, tA, 'c7_cbay_rd'), { onRoad: true, driver: { model: 'gusher', weapon: 'smg' }, ai: 'goto', blip: '#e33', health: 1400 }),
        m.spawnCar('redfork_outrider', tB, facing(m, tB, 'c7_cbay_rd'), { onRoad: true, driver: { model: 'gusher', weapon: 'smg' }, ai: 'goto', blip: '#e33', health: 1300 }),
      ];
      trucks.forEach((v, k) => {
        truckRun(m, v, ['c7_cbay_loop'], 17, 55 + k * 6, 3, { ...GOONS, ai: 'attack', weapon: k ? 'smg' : 'pistol', health: 90 }, (g) => {
          landed++;
          crews.push(...g);
          if (!boss && g.length) { boss = g[0]; boss.blip = '#f80'; }
          if (landed === 1) say(m, ['c7m2_08', 'c7m2_09']);
        });
      });
      await m.waitFor(() => landed + trucks.filter((v) => v.dead).length >= 2);
      m.music(1);
      m.objective('Take out the Syndicate crews. Their boss is marked in orange.');
      await m.waitFor(() => alive(crews).length === 0);
      // wave two: bass boats across the cove
      say(m, 'c7m2_10');
      const boats = [];
      const launch = (path, delay) => {
        const b = m.spawnCar('jenks_lunker', path[0], 0, { blip: '#e33', health: 360 });
        boats.push(b);
        let t = 0;
        everyFrame(m, (dt) => {
          t += dt;
          if (t < delay) return undefined;
          sail(m, b, path.slice(1), 17, () => {
            b.blip = null; b._landed = true;
            crews.push(...m.gang(3, 'c7_cbay_land', { ...GOONS, ai: 'attack', weapon: 'smg', spread: 4, health: 80 }));
            say(m, 'c7m2_11');
          });
          return false;
        });
      };
      launch(BOAT_A, 0);
      launch(BOAT_B, 7);
      m.objective('Sink the boats before they land, then finish the crews.');
      await m.waitFor(() => boats.every((b) => b.dead || b.sunk || b._landed || m.vehicle === b) && alive(crews).length === 0);
      for (const b of boats) b.blip = null;
      m.music(0.5);
      // the crew boss carried Corrigan's texts
      const spot = bossSpot || m.offset('c7_cbay_rd', -6, 6);
      await m.collect([spot], { label: "Search the crew boss for a phone.", counter: 'PHONE' });
      await say(m, ['c7m2_12', 'c7m2_13', 'c7m2_14']);
      // the spotter runs for the open lake
      const patrol = m.spawnCar('jenks_lunker', 'c7_cbay_boat', Math.PI, { blip: '#4af' });
      const spotter = m.spawnCar('jenks_lunker', SPOTTER[0], 2.4, { blip: '#e33', health: 300 });
      let escaped = false;
      sail(m, spotter, SPOTTER.slice(1), 11, () => { escaped = true; });
      m.failIf(() => escaped && !spotter.dead && !spotter.sunk, 'The spotter got away.');
      m.music(1);
      m.objective("Stop the spotter's boat. Nadine's patrol boat is at the ramp.");
      await m.waitFor(() => spotter.dead || spotter.sunk || m.vehicle === spotter);
      spotter.blip = null;
      patrol.blip = null;
      m.music(0);
      m.maxWanted(null);
      await m.loseCops('Lose the cops.');
      await m.goto('c7_cbay', { r: 6, onFoot: true, label: 'Head back to Nadine at the ranger post.' });
      const n2 = castAt(m, 'nadine', 'c7_cbay');
      await hush(m);
      await m.cutscene(['c7m2_15', 'c7m2_16', 'c7m2_17', 'c7m2_18', 'c7m2_19'], { focus: 'c7_cbay' });
      m.remove(n2);
      // Nadine trailers you up Highway 99 to Pawhuska
      m.teleport(m.offset('c7_paw_north', -9, 7), -Math.PI / 2);
      m.setTime(6.5);
      m.message('Nadine drives you north to Pawhuska before sunup.', 5);
    },
  },

  c7m3: {
    id: 'c7m3', chapter: 7, title: 'Bison Country', giver: 'nadine', start: 'c7_paw_north', reward: 15000, requires: ['c7m2'],
    async run(m) {
      const nadine = castAt(m, 'nadine', 'c7_paw_north');
      const atv = m.spawnCar('kiamichi_brushbuster', m.offset('c7_paw_north', -5, 6), -Math.PI / 2, { blip: '#4af' });
      await m.cutscene(['c7m3_01', 'c7m3_02', 'c7m3_03', 'c7m3_04', 'c7m3_05', 'c7m3_06'], { focus: 'c7_paw_north' });
      await m.getAnyVehicle('Get on the four wheeler.', (v) => v === atv || v.kind === 'atv');
      atv.blip = null;
      dismissWhenFar(m, nadine);
      // the convoy: SUV with Tess in front, two pickups behind, rolling up County Road 4201
      const head = m.roadAt('c7_convoy_start', { lane: true });
      const hd = facing(m, head, CR4201[0]);
      const drv = (w) => ({ onRoad: true, driver: { model: 'gusher', weapon: w }, ai: 'goto', health: 1500 });
      const lead = m.spawnCar('keystone_chancellor', head, hd, { ...drv('smg'), blip: '#e33' });
      const mid = m.spawnCar('redfork_roughneck', behind(m, head, hd, 40), hd, drv('rifle'));
      const front = m.spawnCar('redfork_mudbogger', behind(m, head, hd, -40), hd, drv('rifle'));
      // the convoy idles at the junction until Polly is close enough to pick up the tail
      for (const v of [front, lead, mid]) if (v.ai) v.ai.mode = 'stop';
      m.objective('Ease up behind the convoy on County Road 4201. Not too close.');
      const t0 = m.t;
      await m.waitFor(() => m.dist(lead) < 170 || m.t - t0 > 12);
      route(m, front, CR4201, 17.5);
      route(m, lead, CR4201, 17);
      route(m, mid, CR4201, 16.5);
      say(m, 'c7m3_07');
      m.music(0.5);
      // radio chatter as the tail goes on, and a warning when the player crowds them
      let t = 0, warned = false;
      everyFrame(m, (dt) => {
        t += dt;
        if (t > 25 && !m._c7b) { m._c7b = 1; say(m, ['c7m3_08', 'c7m3_09']); }
        if (t > 75 && !m._c7r) { m._c7r = 1; say(m, ['c7m3_11', 'c7m3_12']); }
        if (!warned && m.dist(lead) < 55) { warned = true; say(m, 'c7m3_10'); }
        return undefined;
      });
      m.failIf(() => [front, mid].some((v) => v.dead), 'You blew your cover.');
      await m.follow(lead, {
        minDist: 40, maxDist: 300, spotTime: 4, until: 'c7_ranch_gate', untilR: 30,
        label: 'Tail the convoy up County Road 4201. Stay back in the grass.',
        lostMsg: 'You lost the convoy.', spottedMsg: 'The convoy spotted you.', destroyMsg: 'Tess was in that SUV.',
      });
      lead.blip = null;
      m.music(0);
      await hush(m);
      await m.goto('c7_overlook', { r: 8, label: 'Get eyes on the ranch from the rise south of the gate.' });
      await m.cutscene(['c7m3_13', 'c7m3_14', 'c7m3_15', 'c7m3_16'], { focus: 'c7_ranch' });
    },
  },

  c7m4: {
    id: 'c7m4', chapter: 7, title: 'Pawhuska Standoff', giver: 'nadine', start: 'c7_overlook', reward: 20000, requires: ['c7m3'],
    async run(m) {
      const nadine = castAt(m, 'nadine', 'c7_overlook');
      dismissWhenFar(m, nadine, 90);
      // the compound: parked trucks for cover, Tess at the back of the yard
      m.spawnCar('redfork_roughneck', m.offset('c7_ranch', 6, -12), 0.5);
      m.spawnCar('keystone_chancellor', m.offset('c7_ranch', 10, 14), 0.5);
      m.spawnCar('redfork_mudbogger', m.offset('c7_ranch', -22, 4), 2.1);
      // 'goto' her own spot keeps her from bolting into the oaks when the shooting starts
      const tess = m.spawnPed('tess', 'c7_ranch_tess', { ai: 'goto', target: m.place('c7_ranch_tess'), speed: 2, health: 900 });
      await m.cutscene(['c7m4_01', 'c7m4_02', 'c7m4_03', 'c7m4_04', 'c7m4_05'], { focus: 'c7_ranch' });
      m.giveWeapon('grenade', 6);
      m.giveWeapon('rifle', 360);
      m.maxWanted(2);
      m.failIf(() => tess.dead, 'Tess was killed.');
      const armored = { ...GOONS, armor: 60, health: 110, accuracy: 1.6 };
      const guards = [
        ...m.gang(4, m.offset('c7_ranch_gate', -6, 10), { ...armored, weapon: 'rifle', spread: 12, range: 48 }),
        ...m.gang(3, m.offset('c7_ranch', -14, 8), { ...armored, weapon: 'smg', spread: 8, range: 40 }),
        ...m.gang(2, m.offset('c7_ranch_tess', 4, -4), { ...armored, weapon: 'shotgun', spread: 3, range: 30, armor: 90 }),
      ];
      await m.goto('c7_ranch', { r: 95, label: 'Move in on the ranch. Get Tess out.' });
      say(m, 'c7m4_06');
      for (const g of guards) if (!g.dead && g.ai) g.ai.mode = 'attack';
      m.music(1);
      await m.kill(guards, { label: 'Take down the armored guards.', counter: 'GUARDS' });
      // reinforcements barrel down from the north
      say(m, 'c7m4_07');
      m.objective('More guns coming down County Road 4201. Hold the yard.');
      const reinf = [];
      let arrived = 0;
      const rn = m.roadAt('c7_ranch_north', { lane: true });
      const rigs = [
        m.spawnCar('redfork_outrider', rn, facing(m, rn, 'c7_ranch_gate'), { onRoad: true, driver: { model: 'gusher', weapon: 'smg' }, ai: 'goto', blip: '#e33', health: 1300 }),
      ];
      truckRun(m, rigs[0], ['c7_ranch_gate'], 22, 45, 4, { ...armored, ai: 'attack', weapon: 'rifle' }, (g) => { arrived++; reinf.push(...g); });
      await m.waitFor(() => arrived || rigs[0].dead);
      if (reinf.length) await m.kill(reinf, { label: 'Deal with the reinforcements.', counter: 'GUARDS' });
      m.music(0.4);
      await m.goto(tess, { r: 3, onFoot: true, label: 'Get to Tess.' });
      await hush(m);
      await m.cutscene(['c7m4_08', 'c7m4_09', 'c7m4_10', 'c7m4_11'], { focus: tess });
      // escape: the ranch pickup, Tess riding shotgun, Syndicate trucks on your bumper
      const truck = m.spawnCar('redfork_cattleman', 'c7_ranch_truck', 0.5, { blip: '#4af', health: 1600 });
      tess.ai.mode = 'follow';
      await m.getAnyVehicle('Take the pickup by the barn.', (v) => !['atv', 'boat', 'motorbike', 'bike', 'heli'].includes(v.kind));
      truck.blip = null;
      m.objective('Pick up Tess. Pull up close so she can climb in.');
      await m.waitFor(() => m.vehicle && tess.vehicle === m.vehicle);
      const chase = [
        m.spawnCar('redfork_mudbogger', m.roadAt({ lat: 36.74009, lon: -96.36361 }, { lane: true }), null, { onRoad: true, driver: { model: 'gusher', weapon: 'smg' }, ai: 'pursue', blip: '#e33', health: 1300 }),
        m.spawnCar('redfork_outrider', m.roadAt(m.offset('c7_ranch_north', 0, -260), { lane: true }), null, { onRoad: true, driver: { model: 'gusher', weapon: 'smg' }, ai: 'pursue', blip: '#e33', health: 1200 }),
      ];
      hunt(m, chase);
      m.music(1);
      say(m, ['c7m4_12', 'c7m4_13', 'c7m4_14']);
      const leftBehind = m.failIf(() => !tess.vehicle && m.dist(tess) > 160, 'You left Tess behind.');
      await m.escort(tess, 'c7_bridge', { label: 'Get Tess to Nadine at the Lynn Avenue bridge in Pawhuska.', name: 'Tess', r: 16 });
      leftBehind();
      for (const c of chase) if (!c.dead) m.remove(c);
      m.music(0);
      m.maxWanted(null);
      await m.loseCops('Lose the cops before you meet Nadine.');
      await m.goto('c7_bridge', { r: 16, onFoot: true, label: 'Get out and hand Tess over to Nadine.' });
      const n2 = castAt(m, 'nadine', m.offset('c7_bridge', 18, 2));
      await hush(m);
      await m.cutscene(['c7m4_15', 'c7m4_16', 'c7m4_17', 'c7m4_18', 'c7m4_19'], { focus: 'c7_bridge' });
      m.remove(n2);
      m.remove(tess);
      // Highway 60 east to Bartlesville
      const bv = m.roadAt(m.offset('c7_price', 0, 40), { lane: true });
      m.teleport(bv, bv.h);
      m.setTime(20.5);
      m.message('You take Highway 60 east to Bartlesville. Lucky is waiting at the Price Tower.', 6);
    },
  },

  c7m5: {
    id: 'c7m5', chapter: 7, title: 'Price of the Tower', giver: 'lucky', start: 'c7_price', reward: 22000, requires: ['c7m4'],
    async run(m) {
      m.setTime(21);
      const lucky = castAt(m, 'lucky', 'c7_price');
      const ride = m.spawnCar('cimarron_haymaker', m.roadAt(m.offset('c7_price', -6, 22), { lane: true }), null, { onRoad: true });
      await m.cutscene(['c7m5_01', 'c7m5_02', 'c7m5_03', 'c7m5_04', 'c7m5_05', 'c7m5_06', 'c7m5_07', 'c7m5_08', 'c7m5_09'], { focus: 'c7_price' });
      const st = m.roadAt('c7_bv_start', { lane: true });
      const car = m.spawnCar('osage_meridian_detective', st, facing(m, st, BV_ROUTE[0]), { onRoad: true, driver: { model: 'gusher', weapon: 'pistol' }, ai: 'goto', blip: '#e33', health: 1500 });
      const bagman = car.driver;
      route(m, car, BV_ROUTE, 27);
      ride.blip = '#4af';
      await say(m, 'c7m5_10');
      dismissWhenFar(m, lucky);
      m.music(1);
      say(m, ['c7m5_11', 'c7m5_12']);
      const exit = m.place('c7_bv_75');
      const chaseFails = [
        m.failIf(() => !car.dead && Math.hypot(car.x - exit.x, car.y - exit.y) < 40, 'The bagman made it onto Highway 75.'),
        m.failIf(() => !car.dead && m.dist(car) > (m.vehicle ? 850 : 1100), 'The bagman got away.'),
      ];
      m.timer(240, 'HIGHWAY 75', { fail: 'The bagman made it out of Bartlesville.' });
      m.objective("Stop Corrigan's car. Wreck it or take out the driver.");
      await m.waitFor(() => car.dead || bagman.dead || car.driver !== bagman || car.health < car.maxHealth * 0.25);
      m.stopTimer();
      for (const off of chaseFails) off();
      ride.blip = null;
      car.blip = null;
      if (car.ai) car.ai.mode = 'stop';
      m.music(0.4);
      const box = { x: car.x + Math.cos(car.h) * -3.2, y: car.y + Math.sin(car.h) * -3.2 };
      await m.collect([box], { label: 'Grab the lockbox from the trunk.', counter: 'LOCKBOX' });
      await say(m, 'c7m5_13');
      await m.talk(['c7m5_14', 'c7m5_15', 'c7m5_16', 'c7m5_17']);
      m.music(0);
      await m.loseCops('Lose the cops.');
      await m.goto('c7_price', { r: 6, label: 'Meet Lucky back at the Price Tower.' });
      const l2 = castAt(m, 'lucky', 'c7_price');
      await hush(m);
      await m.cutscene(['c7m5_18', 'c7m5_19'], { focus: 'c7_price' });
      m.remove(l2);
    },
  },
};
