// Chapter 3 — Mother Road (Route 66: Sapulpa, New Sapulpa Road, Red Fork, Southwest Boulevard, the Cyrus Avery
// bridge, 11th Street and Sand Springs). Rhonda Vance ran moonshine with Whitlock Bellwether in the seventies,
// and she knows what he buried. Rhonda's diner and Bellwether Pipe and Supply are fictional; the giant gas pump,
// the Route 66 Historical Village, the Meadow Gold sign and Buck Atom's are scenery only.

export const PLACES = {
  c3_diner: { lat: 35.992235, lon: -96.106255, name: "Rhonda's diner, by the giant gas pump" },
  c3_garage: { lat: 35.992796, lon: -96.106489, name: "Rhonda's garage" },
  c3_carshow: { lat: 36.107796, lon: -96.017086, name: 'Route 66 Historical Village car show' },
  c3_village_gate: { lat: 36.107759, lon: -96.016285, name: 'Route 66 Historical Village, Southwest Boulevard' },
  c3_avery: { lat: 36.140615, lon: -96.006595, name: 'Cyrus Avery bridge, Southwest Boulevard' },
  c3_meadow: { lat: 36.147905, lon: -95.975445, name: 'Meadow Gold sign, 11th Street' },
  c3_buck: { lat: 36.147886, lon: -95.973698, name: "Buck Atom's, 11th Street" },
  c3_buck_walk: { lat: 36.147950, lon: -95.973698, name: "Buck Atom's Cosmic Curios" },
  c3_warehouse: { lat: 36.130939, lon: -96.100937, name: 'Bellwether Pipe and Supply yard' },
  c3_ware_road: { lat: 36.131391, lon: -96.100637, name: 'Bellwether Pipe and Supply, Sand Springs' },
  c3_photos: { lat: 36.130975, lon: -96.100470, name: 'Warehouse office' },
};

export const LINES = {
  // c3m1 Pie and Pistols
  c3m1_01: ['rhonda', "You must be June's girl. Sit down, honey. The pie is fresh and the coffee is older than you are."],
  c3m1_02: ['polly', 'June says you knew Whitlock Bellwether before he had money.'],
  c3m1_03: ['rhonda', 'Knew him? I taught that man to drive. Then he taught me never to trust a man in a clean hat.'],
  c3m1_04: ['rhonda', "Hold that thought. Black trucks out front. Tolliver's boys come every Friday to collect on a loan I never took."],
  c3m1_05: ['thug', "Rhonda! Mister Tolliver says the rent went up. And the pie's on the house from now on."],
  c3m1_06: ['polly', 'Friends of yours?'],
  c3m1_07: ['rhonda', "Termites. There's a shotgun under the register, but you look like you brought your own. Go on, honey. Break some dishes."],
  c3m1_08: ['thug', "Forget this! I'm telling Tolliver the old lady hired a bodyguard!"],
  c3m1_09: ['rhonda', "Old lady? Polly, don't let that weasel reach the turnpike. My stepside is at the curb, keys in the visor."],
  c3m1_10: ['polly', 'He dropped something in the wreck. A car show flyer. Route 66 Village in Red Fork, this Saturday.'],
  c3m1_11: ['polly', 'Somebody circled one car in red ink. A nineteen fifty seven Mother Road Jetfin.'],
  c3m1_12: ['rhonda', 'A Jetfin? Get back here, honey. Right now. I need to sit down for this.'],
  c3m1_13: ['rhonda', 'That Jetfin was mine. Me and Whitlock ran moonshine up and down Route 66 in her, nineteen seventy three and four.'],
  c3m1_14: ['polly', 'You and Bellwether were bootleggers.'],
  c3m1_15: ['rhonda', 'Best on the Mother Road. Then he got rich, I got left behind, and he kept my car out of pure spite.'],
  c3m1_16: ['rhonda', 'Now Tolliver shows her off like a trophy. And there is something hidden in her that Whitlock never found.'],
  // c3m2 Chrome and Fins
  c3m2_01: ['rhonda', 'The show is at the Route 66 Historical Village in Red Fork. Right under the old oil derrick and the Frisco steam engine.'],
  c3m2_02: ['polly', 'So I walk in, admire the chrome, and drive off in the prettiest car on the lot.'],
  c3m2_03: ['rhonda', "That's the plan. Bring her to my garage out back. And honey, not a scratch. She's been through enough."],
  c3m2_04: ['polly', "Who's watching her?"],
  c3m2_05: ['rhonda', 'Car people. They fight harder for a hubcap than any Syndicate goon. And Tolliver always leaves a couple of his boys around.'],
  c3m2_06: ['polly', 'There she is. Fins like a rocket ship and more chrome than a jukebox. I can see why you miss her.'],
  c3m2_07: ['thug', "Hey! That's Mister Tolliver's Jetfin! Somebody stop her!"],
  c3m2_08: ['dispatch', 'All units, vehicle theft at the Route 66 Village on Southwest Boulevard. Classic cruiser, big fins. Owner requests no damage.'],
  c3m2_09: ['polly', 'Even the cops are scared to scratch her.'],
  c3m2_10: ['rhonda', "There's my girl. Not a dent. Pop the trunk, honey, and pull up the spare tire."],
  c3m2_11: ['polly', "There's a tin box bolted under here. Rusted shut."],
  c3m2_12: ['rhonda', 'My insurance policy from nineteen seventy four. Run sheets, payoffs, and every sheriff Whitlock ever paid to look the other way.'],
  c3m2_13: ['polly', 'Fifty years in his garage, and he never once looked under the spare.'],
  c3m2_14: ['rhonda', "Whitlock never changed a tire in his life. That's what he kept me around for."],
  c3m2_15: ['rhonda', "Now this box needs to get to somebody who isn't scared of him. And I know just the girl."],
  // c3m3 Neon Run
  c3m3_01: ['rhonda', "Her name is Tess Okafor. She writes for a Tulsa paper, and she's been chasing Whitlock for two years."],
  c3m3_02: ['rhonda', "She's waiting at Buck Atom's on Eleventh Street, under the big space cowboy. Nine o'clock sharp, and then she's gone."],
  c3m3_03: ['polly', "That's twenty miles of Route 66 at rush hour, Rhonda."],
  c3m3_04: ['rhonda', 'Then don\'t stop for pie. Take the Jetfin. She knows the road better than you do.'],
  c3m3_05: ['rhonda', "And Polly, my phone's been clicking all week. If they're listening, they know that box is moving."],
  c3m3_06: ['rhonda', 'New Sapulpa Road. Me and Whitlock used to outrun the revenue men right through here with the headlights off.'],
  c3m3_07: ['thug', "There's the box! Run her off the road, Tolliver wants it back!"],
  c3m3_08: ['polly', 'So much for a scenic drive.'],
  c3m3_09: ['rhonda', "That's the Route 66 Village coming up. Don't wave at the car show, honey. They remember you."],
  c3m3_10: ['rhonda', "That bridge is Cyrus Avery's. The man who put Route 66 on the map. Whitlock always wanted his name on something like it."],
  c3m3_11: ['rhonda', "There's the Meadow Gold sign. Buck Atom's is just up the block. Go get her, honey."],
  c3m3_12: ['tess', "You must be Polly. Rhonda said you'd be early, loud, or both."],
  c3m3_13: ['polly', 'Both. This is from Rhonda. It spent fifty years under a spare tire.'],
  c3m3_14: ['tess', 'Run sheets. Payoffs. Sheriffs by name. This is incredible, and without proof, any lawyer will call it fiction.'],
  c3m3_15: ['polly', 'What kind of proof?'],
  c3m3_16: ['tess', 'Pictures. Rhonda took Polaroids back then. Whitlock at the still. Whitlock shaking hands with the sheriff.'],
  c3m3_17: ['tess', 'His men stole them in seventy four. If he kept them, they are at Bellwether Pipe and Supply, his old warehouse in Sand Springs.'],
  // c3m4 Sand Springs Shakedown
  c3m4_01: ['tess', "Bellwether Pipe and Supply. Whitlock's very first company, down by the river off Morrow Road in Sand Springs."],
  c3m4_02: ['tess', 'My source says he never throws anything away. Old ledgers, old trucks, old grudges.'],
  c3m4_03: ['polly', 'And old photos. How many guards?'],
  c3m4_04: ['tess', "Enough that I'm staying right here with my notebook. Rhonda sent this along for you, wrapped in a pie box."],
  c3m4_05: ['polly', 'A shotgun, a submachine gun, and a slice of cherry. That woman understands me.'],
  c3m4_06: ['polly', "Rusty fence, brand new cameras, and a lot of men in cowboy hats. Somebody's guarding more than pipe."],
  c3m4_07: ['polly', 'A shoebox marked R V, nineteen seventy four. Rhonda, you were a knockout.'],
  c3m4_08: ['thug', "Somebody's in the office! Get the trucks back here and lock the gate!"],
  c3m4_09: ['dispatch', 'All units, shots fired at a warehouse off Morrow Road in Sand Springs. Multiple suspects. Approach with caution.'],
  c3m4_10: ['polly', "Rhonda, I've got your pictures. Put the coffee on."],
  c3m4_11: ['rhonda', "Coffee's on, and your reporter just walked in. Come on home, honey."],
  c3m4_12: ['rhonda', "Lord, look at us. That's Whitlock at the still, and that's me holding the jar."],
  c3m4_13: ['tess', "And that's a county sheriff with his hand out. Rhonda, these are front page."],
  c3m4_14: ['polly', 'You said Whitlock buried something back then. What was it?'],
  c3m4_15: ['rhonda', 'Summer of seventy four, the revenue men came. Whitlock buried the still, the truck, and all the shine money in the Glenn Pool field.'],
  c3m4_16: ['rhonda', 'He dug it up a year later and bought his first oil lease. Every tower downtown grew out of that hole in the ground.'],
  c3m4_17: ['polly', 'So the Gusher Syndicate started with a shovel.'],
  c3m4_18: ['rhonda', 'Honey, everything in Oklahoma starts with a shovel.'],
  c3m4_19: ['tess', "Polly, I need a driver who doesn't scare easy. Meet me at Guthrie Green downtown on Monday."],
  c3m4_20: ['polly', 'A parolee chauffeuring a reporter around Tulsa. What could possibly go wrong.'],
};

// ---------------------------------------------------------------- helpers
// background per-frame hook; return true from fn to stop it (cleaned up with the mission)
function every(m, fn) { m.waitFor((dt) => fn(dt) === true).catch(() => { }); }
// dialogue that plays while the player keeps control; chained so lines never overlap
function chatter(m) {
  let p = Promise.resolve();
  return { say(ids) { p = p.then(() => m.talk(ids)).catch(() => { }); return p; }, done() { return p; } };
}
// a point d metres along a road point's heading (negative = behind), `side` metres to its right
const along = (p, d, side = 0) => ({ x: p.x + Math.cos(p.h) * d - Math.sin(p.h) * side, y: p.y + Math.sin(p.h) * d + Math.cos(p.h) * side, h: p.h });
// keep AI cars chasing the player (m.pursue only snapshots the target position)
function hunt(m, cars) {
  let on = true, t = 0;
  every(m, (dt) => {
    if (!on) return true;
    if ((t -= dt) > 0) return false;
    t = 0.3;
    const T = m.vehicle || m.ped;
    for (const v of cars) if (!v.dead && v.driver && !v.driver.dead) m.pursue(v, T);
    return false;
  });
  return () => { on = false; for (const v of cars) if (!v.dead && v.ai) v.ai.mode = 'cruise'; };
}
// a road lane point about d metres behind the player (falls back to other directions)
function roadBehind(m, d) {
  const e = m.vehicle || m.ped;
  const h = m.vehicle ? m.vehicle.h : 0;
  for (const a of [Math.PI, Math.PI - 0.6, Math.PI + 0.6, Math.PI / 2, -Math.PI / 2, 0]) {
    const p = { x: e.x + Math.cos(h + a) * d, y: e.y + Math.sin(h + a) * d };
    const r = m.roadAt(p, { lane: true });
    if (m.dist(r, p) < 45 && m.dist(r) > d * 0.6) return r;
  }
  return m.roadAt({ x: e.x - Math.cos(h) * d, y: e.y - Math.sin(h) * d }, { lane: true });
}
const SUV = (v) => v.class === 'suv';
const PICKUP = (v) => /pickup/.test(v.class || '') && v.kind === 'car';
const HOODS = { models: ['gusher'], faction: 'syndicate' };

// Neon Run: Route 66 from Sapulpa to 11th Street (world metres, all on the road surface)
const NEON = [
  { x: -9537, y: 16500, label: 'Up Mission Street, out of Sapulpa on Route 66.' },
  { x: -8841, y: 14139, label: 'North on New Sapulpa Road.', line: 'c3m3_06' },
  { x: -7313, y: 11076, label: 'Keep on New Sapulpa Road toward Tulsa.' },
  { x: -5176, y: 7988, label: 'Pick up Southwest Boulevard.' },
  { x: -3587, y: 6316, label: 'Southwest Boulevard into Red Fork.' },
  { x: -2111, y: 5113, label: 'Past the Route 66 Historical Village.', line: 'c3m3_09' },
  { place: 'c3_avery', label: 'Cyrus Avery plaza, at the bridge over the Arkansas.', line: 'c3m3_10' },
  { place: 'c3_meadow', label: 'East on 11th Street, under the Meadow Gold sign.', line: 'c3m3_11' },
  { place: 'c3_buck', label: "Pull up at Buck Atom's." },
];

// ---------------------------------------------------------------- missions
export const MISSIONS = {
  c3m1: {
    id: 'c3m1', chapter: 3, title: 'Pie and Pistols', giver: 'rhonda', start: 'c3_diner', reward: 3500,
    async run(m) {
      const chat = chatter(m);
      m.maxWanted(1);
      // the Syndicate trucks at the curb on Cleveland Avenue; the runner waits behind the wheel of the first
      const curb = m.roadAt(m.offset('c3_diner', -10, 3), { lane: true });
      const runCar = m.spawnCar(SUV, along(curb, 9), curb.h, { onRoad: true, driver: { model: 'gusher', weapon: 'pistol' }, ai: 'stop', health: 1000 });
      m.spawnCar(SUV, along(curb, 17), curb.h, { paint: 0 });
      const stepside = m.spawnCar('motherroad_stepside', along(curb, -14), curb.h, { health: 1100 });
      await m.cutscene(['c3m1_01', 'c3m1_02', 'c3m1_03', 'c3m1_04', 'c3m1_05', 'c3m1_06', 'c3m1_07'], { focus: 'c3_diner' });
      m.giveWeapon('pistol', 90);
      const front = along(curb, 3, -5);
      const hoods = [
        ...m.gang(3, front, { ...HOODS, weapon: 'pistol', spread: 6, health: 70 }),
        ...m.gang(2, along(curb, -4, -6), { ...HOODS, weapon: 'bat', spread: 3, health: 80 }),
      ];
      m.music(0.8);
      await m.kill(hoods, { label: "Run the Syndicate hoods off Rhonda's lot.", counter: 'HOODS' });
      // the last one floors it for the turnpike
      if (!runCar.dead) {
        chat.say(['c3m1_08', 'c3m1_09']);
        runCar.blip = '#e33';
        m.driveTo(runCar, NEON[1], { flee: true, speed: 26 });
        stepside.blip = m.vehicle ? null : '#4af';
        m.music(1);
        const stop = m.failIf(() => !runCar.dead && m.dist(runCar) > 480, 'The runner got away. Tolliver will hear all about it.');
        await m.destroy(runCar, { label: "Chase down the runner before he reaches the turnpike. Rhonda's stepside is at the curb." });
        stop();
        stepside.blip = null;
      }
      m.music(0.3);
      await chat.done();
      // the flyer is lying on the road behind the wreck
      const r = m.roadAt(runCar);
      const back = along({ x: runCar.x, y: runCar.y, h: r.h }, -5);
      await m.collect([back], { label: 'Search the wreck.', counter: 'WRECK' });
      await m.talk(['c3m1_10', 'c3m1_11', 'c3m1_12']);
      m.music(0);
      await m.goto('c3_diner', { r: 9, label: "Head back to Rhonda's diner by the giant gas pump." });
      m.maxWanted(0);
      const rhonda = m.spawnPed('rhonda', m.offset('c3_diner', 2.2, 0.8), { ai: 'idle' });
      await m.cutscene(['c3m1_13', 'c3m1_14', 'c3m1_15', 'c3m1_16'], { focus: 'c3_diner' });
      m.remove(rhonda);
      m.maxWanted(null);
    },
  },

  c3m2: {
    id: 'c3m2', chapter: 3, title: 'Chrome and Fins', giver: 'rhonda', start: 'c3_diner', reward: 5000, requires: ['c3m1'],
    async run(m) {
      const chat = chatter(m);
      await m.cutscene(['c3m2_01', 'c3m2_02', 'c3m2_03', 'c3m2_04', 'c3m2_05'], { focus: 'c3_diner' });
      if (!m.vehicle) m.message('Grab a car. Red Fork is a good drive up Route 66.', 5);
      await m.goto('c3_village_gate', { r: 120, label: 'Head up Route 66 to the car show at the Route 66 Historical Village in Red Fork.' });
      // the show: a row of classics in the village lot, owners admiring the chrome, two Syndicate minders
      const H = -0.8;
      const jet = m.spawnCar('motherroad_jetfin', 'c3_carshow', H, { health: 1300 });
      const show = [['speedshop_highboy', -13, -15], ['cimarron_sundowner', 11, -12], ['motherroad_stepside', 18, 6], ['bluedome_bajito', 8, 18]];
      for (const [id, dx, dy] of show) m.spawnCar(id, m.offset('c3_carshow', dx, dy), H, {});
      for (const [dx, dy] of [[-10, -11], [-8, -13], [14, -8], [15, 9], [5, 15]]) m.spawnPed(null, m.offset('c3_carshow', dx, dy), { ai: 'idle' });
      const minders = m.gang(2, m.offset('c3_carshow', 3, 4), { ...HOODS, weapon: 'pistol', ai: 'idle', spread: 3, health: 80, blip: false });
      await m.talk('c3m2_06');
      await m.enterVehicle(jet, 'Steal the Jetfin from the car show.');
      for (const p of minders) if (!p.dead) { p.ai.mode = 'attack'; p.blip = '#e33'; }
      m.wanted(2);
      m.maxWanted(3);
      m.music(1);
      // Tolliver's men come off Southwest Boulevard after her
      const tail = [m.spawnCar(SUV, roadBehind(m, 120), null, { onRoad: true, driver: { model: 'gusher', weapon: 'pistol' }, ai: 'pursue', health: 1000, blip: '#e33' })];
      const calloff = hunt(m, tail);
      chat.say(['c3m2_07', 'c3m2_08', 'c3m2_09']);
      // the paint matters: show how much of the Jetfin is left
      let showBar = true;
      every(m, () => { if (!showBar) return true; const f = jet.health / jet.maxHealth; m.bar('CHROME', Math.max(0, (f - 0.5) / 0.5), f > 0.75 ? '#7ed36b' : '#e8b030'); return false; });
      m.failIf(() => !jet.dead && jet.health < jet.maxHealth * 0.5, "Rhonda's Jetfin is too beat up. That's not a car anymore, it's a lawn ornament.");
      await m.loseCops('Lose the cops. Keep the chrome pretty.');
      m.maxWanted(1);
      await m.deliver(jet, 'c3_garage', { label: "Bring the Jetfin to Rhonda's garage behind the diner in Sapulpa.", r: 7, maxDamage: 0.5, damageMsg: "Rhonda's Jetfin is too beat up.", exit: true });
      calloff();
      showBar = false;
      m.clearBar();
      m.music(0);
      await chat.done();
      m.clearWanted();
      m.maxWanted(0);
      const rhonda = m.spawnPed('rhonda', m.offset('c3_garage', 4, 1), { ai: 'idle' });
      await m.cutscene(['c3m2_10', 'c3m2_11', 'c3m2_12', 'c3m2_13', 'c3m2_14', 'c3m2_15'], { focus: 'c3_garage' });
      m.remove(rhonda);
      m.maxWanted(null);
    },
  },

  c3m3: {
    id: 'c3m3', chapter: 3, title: 'Neon Run', giver: 'rhonda', start: 'c3_diner', reward: 5500, requires: ['c3m2'],
    async run(m) {
      const chat = chatter(m);
      m.setTime(19.6);
      m.maxWanted(1);
      // the Jetfin, polished and parked at the curb
      const curb = m.roadAt(m.offset('c3_diner', 0, 4), { lane: true });
      const jet = m.spawnCar('motherroad_jetfin', along(curb, -9), curb.h, { health: 1300, blip: '#4af' });
      await m.cutscene(['c3m3_01', 'c3m3_02', 'c3m3_03', 'c3m3_04', 'c3m3_05'], { focus: 'c3_diner' });
      await m.getAnyVehicle('Get in the Jetfin at the curb, or any car you like, and get rolling.');
      jet.blip = null;
      // the clock starts when the wheels do; every checkpoint buys time for the next leg
      const pts = NEON.map((c) => (c.place ? m.place(c.place) : { x: c.x, y: c.y }));
      const legTime = (a, b) => Math.max(26, Math.round(m.dist(a, b) * 1.35 / 22) + 10);
      const FAIL = { fail: 'Nine o\'clock came and went. Tess gave up and left.' };
      m.timer(legTime({ x: m.x, y: m.y }, pts[0]) + 30, 'NINE O\'CLOCK', FAIL);
      m.music(0.7);
      let calloff = null;
      for (let i = 0; i < pts.length; i++) {
        m.counter('NEON', i, pts.length);
        const last = i === pts.length - 1;
        await m.goto(pts[i], { r: last ? 10 : 16, inVehicle: true, label: NEON[i].label, col: last ? '#7ed36b' : '#f2c233' });
        if (!last) m.timer(m.timeLeft + legTime(pts[i], pts[i + 1]), 'NINE O\'CLOCK', FAIL);
        if (NEON[i].line) chat.say(NEON[i].line);
        if (i === 2) {
          // Tolliver's men were listening: two trucks come up Route 66 behind the box
          const cars = [roadBehind(m, 140), roadBehind(m, 190)].map((p) => m.spawnCar(SUV, p, null, { onRoad: true, driver: { model: 'gusher', weapon: 'pistol' }, ai: 'pursue', health: 900, blip: '#e33' }));
          calloff = hunt(m, cars);
          chat.say(['c3m3_07', 'c3m3_08']);
          m.music(1);
        }
        if (i === 6 && calloff) { calloff(); calloff = null; m.music(0.6); }
      }
      m.stopTimer();
      m.clearCounter();
      if (calloff) calloff();
      m.music(0);
      const tess = m.spawnPed('tess', m.offset('c3_buck_walk', 2.2, 0.8), { ai: 'idle' });
      m.objective('Stop the car and hand Tess the box.');
      await m.waitFor(() => !m.vehicle || m.vehicle.speed < 2, { timeout: 8 });
      await chat.done();
      m.maxWanted(0);
      await m.cutscene(['c3m3_12', 'c3m3_13', 'c3m3_14', 'c3m3_15', 'c3m3_16', 'c3m3_17'], { focus: 'c3_buck_walk' });
      // Tess stays put: the next mission's contact marker sits right where she stands
      m.remove(tess);
      m.maxWanted(null);
    },
  },

  c3m4: {
    id: 'c3m4', chapter: 3, title: 'Sand Springs Shakedown', giver: 'tess', start: 'c3_buck_walk', reward: 7000, requires: ['c3m3'],
    async run(m) {
      const chat = chatter(m);
      await m.cutscene(['c3m4_01', 'c3m4_02', 'c3m4_03', 'c3m4_04', 'c3m4_05'], { focus: 'c3_buck_walk' });
      m.giveWeapon('shotgun', 48);
      m.giveWeapon('smg', 240);
      m.message('The SMG fires forward from a moving car. The shotgun clears a room.', 6);
      await m.goto('c3_ware_road', { r: 80, label: 'Drive out to Bellwether Pipe and Supply, off Morrow Road in Sand Springs.' });
      m.maxWanted(0);
      // the yard: pistols at the fence, shotguns by the trucks, SMGs at the office door
      m.spawnCar(PICKUP, m.offset('c3_warehouse', 10, -22), Math.PI / 2, {});
      m.spawnCar(SUV, m.offset('c3_warehouse', -12, 18), 0, { paint: 0 });
      const guards = [
        ...m.gang(3, m.offset('c3_warehouse', -6, -22), { ...HOODS, weapon: 'pistol', ai: 'guard', range: 32, spread: 7, health: 80 }),
        ...m.gang(2, m.offset('c3_warehouse', 4, 16), { ...HOODS, weapon: 'shotgun', ai: 'guard', range: 26, spread: 4, health: 100, armor: 30 }),
        ...m.gang(2, m.offset('c3_photos', -7, 0), { ...HOODS, weapon: 'smg', ai: 'guard', range: 30, spread: 3, health: 90, armor: 30 }),
      ];
      m.music(0.9);
      await m.talk('c3m4_06');
      await m.kill(guards, { label: 'Clear the Syndicate guards out of the warehouse yard.', counter: 'GUARDS' });
      await m.collect(['c3_photos'], { label: "Find Rhonda's photos at the warehouse office door.", counter: 'PHOTOS' });
      await m.talk('c3m4_07');
      // the trucks come back with friends
      const lane = m.roadAt('c3_ware_road', { lane: true });
      m.spawnCar(SUV, along(lane, -10), lane.h, {});
      m.spawnCar(PICKUP, along(lane, 4), lane.h, {});
      const wave = [
        ...m.gang(3, along(lane, -4, 5), { ...HOODS, weapon: 'smg', ai: 'attack', spread: 4, health: 90, armor: 20 }),
        ...m.gang(2, along(lane, 8, 5), { ...HOODS, weapon: 'shotgun', ai: 'attack', spread: 3, health: 100, armor: 30 }),
      ];
      m.music(1);
      await m.talk('c3m4_08');
      await m.kill(wave, { label: 'Syndicate reinforcements. Fight your way out of the yard.', counter: 'GOONS' });
      m.maxWanted(3);
      m.wanted(3);
      chat.say('c3m4_09');
      await m.loseCops('Three stars. Lose the cops before you head home.');
      m.music(0.3);
      await chat.done();
      await m.talk(['c3m4_10', 'c3m4_11']);
      m.maxWanted(null);
      await m.goto('c3_diner', { r: 9, label: "Bring the photos to Rhonda's diner in Sapulpa." });
      m.music(0);
      m.clearWanted();
      m.maxWanted(0);
      const rhonda = m.spawnPed('rhonda', m.offset('c3_diner', 2.2, 0.8), { ai: 'idle' });
      const tess = m.spawnPed('tess', m.offset('c3_diner', 4.2, -0.4), { ai: 'idle' });
      await m.cutscene(['c3m4_12', 'c3m4_13', 'c3m4_14', 'c3m4_15', 'c3m4_16', 'c3m4_17', 'c3m4_18', 'c3m4_19', 'c3m4_20'], { focus: 'c3_diner' });
      m.remove(rhonda);
      m.remove(tess);
      m.maxWanted(null);
    },
  },
};
