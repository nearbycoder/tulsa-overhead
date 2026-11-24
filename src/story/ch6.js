// Chapter 6 — Glenpool Gusher (Glenpool, the old Ida Glenn field, Kiefer, Bixby farmland, Okmulgee, US-75)
// The old Ida Glenn field is worth more than oil. The deeds prove it.

export const PLACES = {
  c6_blackgold: { lat: 35.956458, lon: -96.010723, name: 'Black Gold Park, Glenpool' },
  c6_truck1: { lat: 35.964579, lon: -96.034988, name: 'Glenn Pool lease road' },
  c6_truck2: { lat: 35.955273, lon: -96.026655, name: 'Glenn Pool lease road' },
  c6_truck3: { lat: 35.946935, lon: -96.027779, name: 'Glenn Pool lease road' },
  c6_truck4: { lat: 35.945452, lon: -96.029514, name: 'South 33rd West Avenue' },
  c6_beeline_131: { lat: 35.976562, lon: -96.011691, name: 'US-75 at 131st Street' },
  c6_cityhall: { lat: 35.983435, lon: -96.018934, name: 'Glenpool City Hall' },
  c6_okm_annex: { lat: 35.623251, lon: -95.963673, name: 'County records annex, Okmulgee' },
  c6_okm_curb: { lat: 35.623134, lon: -95.963874, name: 'East 6th Street, Okmulgee' },
  c6_okm_north: { lat: 35.650337, lon: -95.962116, name: 'Wood Drive, north Okmulgee' },
  c6_beeline_nb: { lat: 35.964534, lon: -96.011691, name: 'Okmulgee Beeline, Glenpool' },
  c6_farm: { lat: 35.915879, lon: -95.850505, name: "Wade's farm, south of Bixby" },
  c6_tractor: { lat: 35.916241, lon: -95.850060, name: "Wade's farm" },
  c6_combine: { lat: 35.916150, lon: -95.849615, name: "Wade's farm" },
  c6_survey: { lat: 35.906659, lon: -95.850871, name: "Garnett Road, by Wade's back forty" },
  c6_bixby_escape: { lat: 35.944656, lon: -95.868762, name: 'Mingo Road and 151st' },
  c6_ambush: { lat: 35.959017, lon: -96.009488, name: 'Gas station on 141st Street' },
  c6_convoy: { lat: 35.942377, lon: -96.011747, name: 'Okmulgee Beeline, southbound of Glenpool' },
  c6_us75_north: { lat: 36.012032, lon: -96.011736, name: 'US-75 at Jenks' },
};

export const LINES = {
  // c6m1 Pumpjack Sabotage
  c6m1_01: ['tess', 'Welcome to Glenpool. Nineteen oh five, a wildcatter hit the Ida Glenn lease over that ridge. Made Tulsa the Oil Capital of the World.'],
  c6m1_02: ['polly', "Great. A history lesson. Why does Bellwether care about a field that's been pumped dry for fifty years?"],
  c6m1_03: ['tess', "That's what I can't figure out. But his service crews are out there right now, running survey rigs on every lease road."],
  c6m1_04: ['tess', 'Four trucks. Driller Oilfield Services. Bellwether owns the company through three shell companies and a cousin.'],
  c6m1_05: ['polly', 'And if those four trucks happened to catch fire?'],
  c6m1_06: ['tess', "Then the survey stops. Mama June sent you a care package, by the way. I didn't look inside. I'm choosing not to know."],
  c6m1_07: ['polly', "June's care packages always either tick or slosh."],
  c6m1_08: ['thug', 'Hey! Who let her on the lease? Get her!'],
  c6m1_09: ['tess', "They're calling for backup on the radio. Hurry, before they move the last rigs off the field."],
  c6m1_10: ['tess', "The last truck is pulling out! Don't let it reach the highway!"],
  c6m1_11: ['polly', "Four trucks, one bonfire. So what were they surveying, Tess? That field's been dry since the Depression."],
  c6m1_12: ['tess', 'Not oil. Brine. Their logs say the old salt water under Glenn Pool is loaded with lithium. Batteries, Polly. Every car in America.'],
  c6m1_13: ['polly', "So Bellwether's buying the dirt. Who owns what's under it?"],
  c6m1_14: ['tess', 'The original deeds would say. And a county clerk down in Okmulgee just called me, scared half to death.'],
  // c6m2 Deeds in Okmulgee
  c6m2_01: ['tess', 'Her name is Marjorie Pruitt. Thirty one years in the county records office. She found the original Glenn Pool deeds in a vault in Okmulgee.'],
  c6m2_02: ['tess', 'Somebody offered her a lot of money to lose them. Then somebody slashed her tires. She will only hand them to a judge in Glenpool.'],
  c6m2_03: ['polly', "Okmulgee's forty minutes down the Beeline. Let's go get her."],
  c6m2_04: ['tess', 'That is her, on the steps with the banker box. Marjorie, this is Polly. She drives. Fast.'],
  c6m2_05: ['polly', "Ma'am. Get in the car, keep your head down, and don't let go of that box."],
  c6m2_06: ['dispatch', 'Okmulgee units, reported abduction on East Sixth Street. Gray sedan, two women and an elderly hostage.'],
  c6m2_07: ['polly', 'Hostage? She volunteered!'],
  c6m2_08: ['tess', 'Syndicate trucks behind us, and they called it in to the troopers. Just get us out of town on Wood Drive.'],
  c6m2_09: ['tess', "Marjorie says these deeds have a clause nobody has read since nineteen oh seven. She won't say more until a judge is present."],
  c6m2_10: ['polly', 'Smart lady. Wake me when we hit Glenpool.'],
  c6m2_11: ['tess', 'Syndicate cars at City Hall. They knew we were coming.'],
  c6m2_12: ['polly', "Everybody knows we're coming. It's sort of our brand now."],
  c6m2_13: ['tess', "Marjorie's inside with the judge. The nineteen oh seven deeds split the mineral rights. Half belong to the town of Glenpool, forever."],
  c6m2_14: ['polly', 'Unless somebody makes the deeds disappear.'],
  c6m2_15: ['tess', "Which is why Bellwether wanted them. Now they're certified copies in a judge's safe. That's a very bad day for a billionaire."],
  // c6m3 Harvest Moon
  c6m3_01: ['dewey', "Polly! Over here! Don't step in that. Or that. My buddy Wade lets me park the tow truck on his farm. Long story."],
  c6m3_02: ['polly', "Dewey, it's midnight. Why am I standing in a cow pasture south of Bixby?"],
  c6m3_03: ['dewey', "Because Tolliver's surveyors are out in Wade's back forty, under the moon, planting stakes. Wade never sold them nothing."],
  c6m3_04: ['dewey', "They're redrawing the lines for a lithium pipeline. If they file that survey, Wade loses his farm and I lose my parking spot."],
  c6m3_05: ['polly', "Where's their truck?"],
  c6m3_06: ['dewey', 'White pickup, out on the dirt roads past Garnett. Oh, and Wade says you can borrow his combine. He was very clear. Borrow.'],
  c6m3_07: ['polly', "I'm not chasing a pickup in a combine, Dewey."],
  c6m3_08: ['dewey', "I'm just saying it's an option. It's got headlights. Big ones."],
  c6m3_09: ['dewey', "They saw you! They're running for Bixby with the survey!"],
  c6m3_10: ['dewey', "Is that the combine? Polly, is that the combine? Oh, Wade's gonna cry."],
  c6m3_11: ['polly', 'Got their survey plats. Pretty colors. Lots of lines through other people\'s farms.'],
  c6m3_12: ['dewey', 'Wade says thank you. And he wants to know who is paying for the fence.'],
  c6m3_13: ['polly', 'Send the bill to Tolliver Development. I hear they love paperwork.'],
  // c6m4 Wildcatter
  c6m4_01: ['lucky', "Polly. Don't shoot. I come bearing gifts, and a really good parking spot."],
  c6m4_02: ['polly', 'Lucky Ortega. Last time you came bearing anything, I got four years.'],
  c6m4_03: ['lucky', "And I've been sorry every day since. Corrigan had my kid sister's papers in his desk. I drove away, or she got sent away."],
  c6m4_04: ['polly', 'You could have told me.'],
  c6m4_05: ['lucky', "I'm telling you now. And I'm giving you the Syndicate tanker run. Crude hauler, northbound on the Beeline, every Thursday at nine."],
  c6m4_06: ['lucky', "There's no crude in that tank. It's lithium brine from Bellwether's test wells. His proof for the investors at the State Fair."],
  c6m4_07: ['polly', 'So we blow up his proof.'],
  c6m4_08: ['lucky', 'Like old times. You drive, I make bad decisions. Except this time I brought my own car.'],
  c6m4_09: ['lucky', "Convoy's coming up the Beeline! Escorts front and back. Hit the tanker. The escorts are just furniture."],
  c6m4_10: ['thug', "It's the Haskins woman! Box her in! Protect the tanker!"],
  c6m4_11: ['lucky', 'Ha! Look at that thing burn. Smells like money and bad chemistry.'],
  c6m4_12: ['polly', 'Lucky. Thanks.'],
  c6m4_13: ['lucky', "Don't thank me yet. Check your phone. Tess hasn't answered in an hour."],
  c6m4_14: ['dispatch', 'All units, reporter Tess Okafor abducted from a Glenpool motel. Suspect is Polly Haskins. Consider her armed and dangerous.'],
  c6m4_15: ['polly', 'They took Tess. And they put my name on it.'],
  c6m4_16: ['lucky', "That's Corrigan's handwriting. Get out of the city tonight, Polly. Head north and don't stop till the Osage hills."],
};

// ---------------------------------------------------------------- helpers
// Per-frame hooks that coexist (m.onTick is a single slot). A hook returning false is removed.
function everyFrame(m, fn) {
  if (!m._c6hooks) {
    const hooks = (m._c6hooks = []);
    m.onTick = (dt) => { for (const h of hooks.slice()) if (h(dt) === false) hooks.splice(hooks.indexOf(h), 1); };
  }
  m._c6hooks.push(fn);
}
// m.pursue aims at a snapshot of the target's position, so refresh it every frame.
function hunt(m, cars, target = () => m.player) {
  everyFrame(m, () => {
    let live = 0;
    const t = target();
    for (const c of cars) if (c && !c.dead && c.driver && c.ai && !c.driver.dead) { if (t && !t.dead) m.pursue(c, t); live++; }
    return live > 0 && !!t && !t.dead;
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
// m.wanted(n) can lose a star on the very next frame if no cop has seen the player for a while
// (the evasion clock isn't reset), so set it again two frames later.
function heat(m, n) {
  m.wanted(n);
  let k = 0;
  everyFrame(m, () => { if (++k < 2) return undefined; m.wanted(n); return false; });
}
// Fire-and-forget dialogue (no dangling rejected promise if the mission ends mid-line).
function say(m, ids) { m.talk(ids).catch(() => {}); }
// Wait until a fleeing vehicle is wrecked or badly damaged, then park it.
async function disable(m, v, frac = 0.3) {
  await m.waitFor(() => v.dead || v.health < v.maxHealth * frac);
  if (!v.dead && v.ai) v.ai.mode = 'stop';
}
const isOilTruck = (v) => /oilfield/i.test(v.class || '');
const isTanker = (v) => /tanker/i.test(v.class || '');
const isSuv = (v) => v.class === 'suv';
const isSedan = (v) => /sedan|fullsize/i.test(v.class || '') && v.kind === 'car';
const isPickup = (v) => /pickup/i.test(v.class || '') && v.kind === 'car';
const isMuscle = (v) => v.class === 'muscle';
const isTractor = (v) => v.kind === 'tractor' && /^tractor$/i.test(v.class || '');
const isCombine = (v) => v.kind === 'tractor' && /combine/i.test(v.class + v.name);
const anyCar = (v) => v.kind === 'car';
const anyTruck = (v) => v.kind === 'truck';

// ---------------------------------------------------------------- missions
export const MISSIONS = {
  c6m1: {
    id: 'c6m1', chapter: 6, title: 'Pumpjack Sabotage', giver: 'tess', start: 'c6_blackgold', reward: 12000,
    async run(m) {
      const tess = m.spawnPed('tess', m.offset('c6_blackgold', 3, 2), { ai: 'idle' });
      await m.cutscene(['c6m1_01', 'c6m1_02', 'c6m1_03', 'c6m1_04', 'c6m1_05', 'c6m1_06', 'c6m1_07'], { focus: 'c6_blackgold' });
      m.remove(tess);
      m.giveWeapon('grenade', 6);
      m.giveWeapon('molotov', 10);
      m.message('{weapons} switch weapons. Throw with {fire}.', 6);
      // the oil field is a mile off: Tess leaves her pickup at the kerb
      if (!m.vehicle) {
        const kerb = m.roadAt(m.offset('c6_blackgold', 0, 10), { lane: true });
        const ride = spawnBest(m, [isPickup, anyCar], kerb, kerb.h, { blip: '#4af' });
        if (ride) { m.message("Tess left her pickup at the kerb. The field is a mile out.", 5); m.waitFor(() => m.vehicle === ride).then(() => { ride.blip = null; }).catch(() => { }); }
      }
      const spots = [['c6_truck1', 0], ['c6_truck2', 1.6], ['c6_truck3', 3.1], ['c6_truck4', -Math.PI / 2]];
      const trucks = spots.map(([p, h], i) => spawnBest(m, [isOilTruck, anyTruck], p, h, i === 3
        ? { onRoad: true, driver: { model: 'gusher' }, ai: 'stop', health: 800 } : { health: 800 }));
      const crews = [];
      spots.forEach(([p], i) => crews.push(...m.gang(2, m.offset(p, 12, 9), { weapon: i % 2 ? 'smg' : 'pistol', models: ['gusher'], ai: 'guard', range: 28, spread: 4, health: 80 })));
      let warned = false;
      m.on('pedKilled', (p) => { if (!warned && crews.includes(p)) { warned = true; say(m, 'c6m1_08'); } });
      m.timer(420, 'SURVEY', { fail: 'The survey crews finished up and pulled out.' });
      m.music(1);
      let fled = false;
      const runner = trucks[3];
      const exit = m.place('c6_beeline_131');
      everyFrame(m, () => {
        const down = trucks.filter((t) => t.dead).length;
        if (!fled && down >= 3 && !runner.dead) {
          fled = true;
          m.driveTo(runner, 'c6_beeline_131', { speed: 22 });
          say(m, 'c6m1_10');
          m.failIf(() => !runner.dead && Math.hypot(runner.x - exit.x, runner.y - exit.y) < 50, 'The last rig made it onto the highway.');
        }
        return fled || runner.dead ? false : undefined;
      });
      let nagged = false;
      everyFrame(m, () => { if (!nagged && trucks.filter((t) => t.dead).length === 2) { nagged = true; say(m, 'c6m1_09'); } return nagged ? false : undefined; });
      await m.destroy(trucks, { label: 'Torch the four Syndicate survey trucks on the Glenn Pool field.', counter: 'TRUCKS' });
      m.stopTimer();
      m.music(0);
      await m.loseCops('Lose the cops.');
      await m.goto('c6_blackgold', { r: 6, label: 'Meet Tess back at Black Gold Park.' });
      m.spawnPed('tess', m.offset('c6_blackgold', 3, 2), { ai: 'idle' });
      await m.cutscene(['c6m1_11', 'c6m1_12', 'c6m1_13', 'c6m1_14'], { focus: 'c6_blackgold' });
    },
  },

  c6m2: {
    id: 'c6m2', chapter: 6, title: 'Deeds in Okmulgee', giver: 'tess', start: 'c6_cityhall', reward: 15000, requires: ['c6m1'],
    async run(m) {
      let tess = m.spawnPed('tess', m.offset('c6_cityhall', 3, 2), { ai: 'idle' });
      await m.cutscene(['c6m2_01', 'c6m2_02', 'c6m2_03'], { focus: 'c6_cityhall' });
      m.remove(tess);
      // forty minutes down US-75: Tess drives, we pick it up on East 6th Street in Okmulgee
      m.teleport('c6_okm_annex', 0);
      m.message('Okmulgee. Tess drove you both down US-75.', 5);
      await m.wait(1.2); // let the streets stream in before parking anything
      const car = spawnBest(m, [isSedan, anyCar], 'c6_okm_curb', null, { onRoad: true, health: 1600 });
      tess = m.spawnPed('tess', m.offset('c6_okm_annex', 3, 0), { ai: 'idle', health: 250 });
      const clerk = m.spawnPed(null, m.offset('c6_okm_annex', 6, -1), { ai: 'idle', health: 250 });
      await m.cutscene(['c6m2_04', 'c6m2_05'], { focus: 'c6_okm_annex' });
      m.failIf(() => clerk.dead, 'Marjorie was killed. The deeds are gone with her.');
      m.failIf(() => tess.dead, 'Tess was killed.');
      await m.enterVehicle(car, "Get in Tess's car.");
      clerk.ai.mode = 'follow';
      tess.ai.mode = 'follow';
      m.objective('Wait for Marjorie and Tess to get in.');
      await m.waitFor(() => clerk.vehicle && tess.vehicle, { timeout: 40, failMsg: 'You left Marjorie on the courthouse steps.' });
      heat(m, 2);
      m.music(1);
      const hunters = [
        spawnBest(m, [isSuv, anyCar], m.offset('c6_okm_annex', -260, -120), null, { onRoad: true, driver: { model: 'gusher', weapon: 'pistol' }, ai: 'pursue', blip: '#e33', health: 1200 }),
        spawnBest(m, [isPickup, anyCar], m.offset('c6_okm_annex', 260, -200), null, { onRoad: true, driver: { model: 'gusher', weapon: 'pistol' }, ai: 'pursue', blip: '#e33', health: 1200 }),
      ];
      hunt(m, hunters);
      say(m, ['c6m2_06', 'c6m2_07', 'c6m2_08']);
      await m.goto('c6_okm_north', { r: 25, inVehicle: true, label: 'Get Marjorie out of Okmulgee. Head north on Wood Drive.' });
      // the long haul up the Beeline happens off screen
      for (const h of hunters) if (h && !h.dead) m.remove(h);
      m.clearWanted();
      m.teleport('c6_beeline_nb', -Math.PI / 2);
      m.message('Forty minutes later: Glenpool.', 4);
      await m.cutscene(['c6m2_09', 'c6m2_10']);
      const welcome = m.gang(4, m.offset('c6_cityhall', 20, -30), { weapon: 'smg', models: ['gusher'], ai: 'guard', range: 40, spread: 12, health: 90 });
      const late = spawnBest(m, [isSuv, anyCar], m.offset('c6_beeline_nb', 0, -500), null, { onRoad: true, driver: { model: 'gusher', weapon: 'pistol' }, ai: 'pursue', blip: '#e33', health: 1200 });
      hunt(m, [late]);
      await m.goto('c6_cityhall', { r: 130, label: 'Get Marjorie to Glenpool City Hall.' });
      await m.talk(['c6m2_11', 'c6m2_12']);
      for (const p of welcome) if (!p.dead && p.ai) p.ai.mode = 'attack';
      await m.kill(welcome, { label: 'Clear the Syndicate gunmen off the City Hall lot.', counter: 'GUNMEN' });
      await m.goto('c6_cityhall', { r: 9, label: 'Bring Marjorie to the City Hall doors.' });
      await m.waitFor(() => Math.hypot(clerk.x - m.x, clerk.y - m.y) < 14 || clerk.vehicle === m.vehicle);
      m.music(0);
      await m.loseCops('Lose the cops.');
      await m.cutscene(['c6m2_13', 'c6m2_14', 'c6m2_15'], { focus: 'c6_cityhall' });
    },
  },

  c6m3: {
    id: 'c6m3', chapter: 6, title: 'Harvest Moon', giver: 'dewey', start: 'c6_farm', reward: 14000, requires: ['c6m2'],
    async run(m) {
      m.setTime(23.5);
      m.weather('clear');
      m.spawnPed('dewey', m.offset('c6_farm', 3, 2), { ai: 'idle' });
      const combine = spawnBest(m, [isCombine, (v) => v.kind === 'tractor'], 'c6_combine', 0);
      spawnBest(m, [isTractor, (v) => v.kind === 'tractor'], 'c6_tractor', 1.5);
      await m.cutscene(['c6m3_01', 'c6m3_02', 'c6m3_03', 'c6m3_04', 'c6m3_05', 'c6m3_06', 'c6m3_07', 'c6m3_08'], { focus: 'c6_farm' });
      let gag = false;
      m.on('enter', (v) => { if (v === combine && !gag) { gag = true; say(m, 'c6m3_10'); } });
      const truck = spawnBest(m, [isPickup, anyCar], 'c6_survey', -Math.PI / 2, { onRoad: true, driver: { model: 'gusher' }, ai: 'stop', health: 1100, paint: 3 });
      const crew = m.gang(2, m.offset(truck, 32, -12), { weapon: 'pistol', models: ['gusher'], ai: 'guard', range: 30, spread: 5, health: 70 });
      truck.blip = '#e33';
      m.objective("Find the surveyors' white pickup down Garnett Road, by Wade's back forty.");
      await m.waitFor(() => Math.hypot(truck.x - m.x, truck.y - m.y) < 70 || crew.some((p) => p.dead || p.ai.mode === 'attack') || truck.health < truck.maxHealth);
      m.driveTo(truck, 'c6_bixby_escape', { speed: 24 });
      say(m, 'c6m3_09');
      m.music(1);
      const exit = m.place('c6_bixby_escape');
      m.failIf(() => !truck.dead && Math.hypot(truck.x - exit.x, truck.y - exit.y) < 45, 'The surveyors made it to Bixby and filed the survey.');
      m.timer(210, 'SURVEY', { fail: 'The surveyors made it to Bixby and filed the survey.' });
      m.objective('Wreck the surveyors\' pickup before it reaches Bixby.');
      await disable(m, truck);
      m.stopTimer();
      m.music(0.3);
      const wreck = { x: truck.x + Math.cos(truck.h + Math.PI / 2) * 3, y: truck.y + Math.sin(truck.h + Math.PI / 2) * 3 };
      await m.collect([wreck], { label: 'Grab the survey plats from the pickup.', counter: 'PLATS' });
      await m.talk(['c6m3_11', 'c6m3_12', 'c6m3_13']);
      m.music(0);
      await m.loseCops('Lose the cops.');
    },
  },

  c6m4: {
    id: 'c6m4', chapter: 6, title: 'Wildcatter', giver: 'lucky', start: 'c6_ambush', reward: 18000, requires: ['c6m3'],
    async run(m) {
      const luckyPed = m.spawnPed('lucky', m.offset('c6_ambush', 3, 2), { ai: 'idle' });
      const ride = spawnBest(m, [(v) => v.class === 'sports', isMuscle, anyCar], m.offset('c6_ambush', 10, 8), Math.PI);
      await m.cutscene(['c6m4_01', 'c6m4_02', 'c6m4_03', 'c6m4_04', 'c6m4_05', 'c6m4_06', 'c6m4_07', 'c6m4_08'], { focus: 'c6_ambush' });
      m.remove(luckyPed);
      m.giveWeapon('smg', 300);
      m.giveWeapon('rocket', 6);
      // Lucky takes his own car; the player gets the other one
      const lucky = spawnBest(m, [isMuscle, anyCar], m.offset('c6_ambush', -8, 6), Math.PI, { onRoad: true, driver: { model: 'lucky' }, ai: 'stop', health: 6000, blip: '#ff6a3a' });
      await m.enterVehicle(ride, 'Get in the car. Lucky has his own.');
      // the convoy: lead escort, tanker, rear escort, northbound on the Beeline
      const opts = (extra) => ({ onRoad: true, driver: { model: 'gusher', weapon: 'pistol' }, ai: 'stop', ...extra });
      const lead = spawnBest(m, [isSuv, anyCar], m.offset('c6_convoy', 0, -45), -Math.PI / 2, opts({ health: 1300 }));
      const tanker = spawnBest(m, [isTanker, anyTruck], 'c6_convoy', -Math.PI / 2, opts({ health: 2600, blip: '#e33' }));
      const rear = spawnBest(m, [isSuv, anyCar], m.offset('c6_convoy', 0, 55), -Math.PI / 2, opts({ health: 1300 }));
      for (const v of [lead, tanker, rear]) m.driveTo(v, 'c6_us75_north', { speed: 21 });
      say(m, 'c6m4_09');
      m.music(1);
      hunt(m, [lucky], () => tanker);
      let roused = false;
      everyFrame(m, () => {
        if (roused) return false;
        const near = Math.hypot(tanker.x - m.x, tanker.y - m.y) < 70;
        if (near || tanker.health < tanker.maxHealth || lead.health < lead.maxHealth || rear.health < rear.maxHealth) {
          roused = true;
          hunt(m, [lead, rear]);
          say(m, 'c6m4_10');
        }
        return undefined;
      });
      const end = m.place('c6_us75_north');
      m.failIf(() => !tanker.dead && Math.hypot(tanker.x - end.x, tanker.y - end.y) < 80, 'The tanker made it to Jenks. Bellwether has his proof.');
      m.timer(300, 'TANKER', { fail: 'The tanker made it to Jenks. Bellwether has his proof.' });
      await m.destroy(tanker, { label: 'Destroy the Syndicate tanker before it reaches Jenks.' });
      m.stopTimer();
      await m.talk(['c6m4_11', 'c6m4_12', 'c6m4_13']);
      m.music(0);
      await m.loseCops('Lose the cops.');
      await m.cutscene(['c6m4_14', 'c6m4_15', 'c6m4_16']);
    },
  },
};
