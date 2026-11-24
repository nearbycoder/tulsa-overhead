// Chapter 1 — Rose District Blues (Broken Arrow)
export const PLACES = {
  mama_june_house: { lat: 36.04338, lon: -95.79460, name: "Mama June's House" },
  dewey_shop: { lat: 36.05744, lon: -95.79350, name: "Dewey's Tire & Lube" },
  chop_garage: { lat: 36.064172, lon: -95.800182, name: 'Chop Garage' },
  bass_pro_lot: { lat: 36.07380, lon: -95.84050, name: 'Bass Pro Parking Lot' },
  rose_meet: { lat: 36.05310, lon: -95.79090, name: 'Rose District' },
  ba_expressway: { lat: 36.06820, lon: -95.85600, name: 'BA Expressway on-ramp' },
};

export const LINES = {
  // c1m1 Homecoming
  c1m1_01: ['june', 'Well look what the parole board drug in. Four years, and you still walk like you own the road.'],
  c1m1_02: ['polly', "Hey, Mama June. Bus dropped me on Elm. Figured I'd come say hi before I lost my nerve."],
  c1m1_03: ['june', "Hi yourself. Sit down a minute. Your cousin's in trouble, and he's too proud to call you."],
  c1m1_04: ['polly', "Dewey? What'd he do, sell the shop for magic beans?"],
  c1m1_05: ['june', 'Worse. He borrowed from the Gusher Syndicate. Now they want the shop, the lot, and his kneecaps.'],
  c1m1_06: ['polly', "I've been out six hours, June."],
  c1m1_07: ['june', "Then you've had plenty of rest. Go see him. And find yourself a ride, baby. Ain't nobody walking in this heat."],
  c1m1_08: ['dewey', "Polly? Polly! Oh thank God. I mean, hey. Cool. You look great. Prison looks great on you."],
  c1m1_09: ['polly', "Dewey. How much do you owe them?"],
  c1m1_10: ['dewey', 'Forty. Thousand. Plus interest, which they keep changing. They said the shop sits right where some new road wants to go.'],
  c1m1_11: ['polly', "Road? Who builds a road through a tire shop in Broken Arrow?"],
  c1m1_12: ['dewey', "Guy named Brock Tolliver. Real estate. Nice teeth. Scary friends. Can you help me? Please say yes."],
  c1m1_13: ['polly', "I'll help. But we do it my way, and you stop borrowing money from people with the word Syndicate in their name."],
  // c1m2 Spare Parts
  c1m2_01: ['dewey', "Okay, so, my guy at the chop garage pays cash for parts. Real cash. Today."],
  c1m2_02: ['dewey', 'He wants a pickup first. Anything with a bed. This is Oklahoma, so, you know. Look around.'],
  c1m2_03: ['polly', 'A pickup in Broken Arrow. Hardest job I ever had.'],
  c1m2_04: ['dewey', 'Nice! Now he wants something fast. Sporty. Low. The kind of car that gets a speeding ticket parked.'],
  c1m2_05: ['dewey', "That's it! That's the money! Polly, I could kiss you. I won't. But I could."],
  c1m2_06: ['polly', "Don't. Put it toward the debt. All of it, Dewey."],
  // c1m3 Repo Rodeo
  c1m3_01: ['dewey', "Polly! They were here! Syndicate guys! They took the register and smashed the lift!"],
  c1m3_02: ['dewey', "Black SUV, headed for the expressway. They've got my ledger with every name in it!"],
  c1m3_03: ['polly', 'Every name? Including mine?'],
  c1m3_04: ['dewey', "...Maybe a little bit yours."],
  c1m3_05: ['polly', "Stop them before they hit the expressway. Got it."],
  c1m3_06: ['polly', 'Ledger is singed but readable. Dewey, you wrote my name in glitter pen.'],
  c1m3_07: ['dewey', "It was the only pen that worked! Bring it back, okay? Please?"],
  // c1m4 Last Call at the Rose
  c1m4_01: ['june', "Tolliver wants a sit-down. Main Street, by the Rose District fountain. Says he wants to make peace."],
  c1m4_02: ['polly', "Men like that don't make peace. They make offers you can't survive."],
  c1m4_03: ['june', "That's why you're bringing this. It was your uncle's. Try not to lose it in a ditch."],
  c1m4_04: ['brock', "Miss Haskins. Brock Tolliver. I'm told you're the family's new problem-solver. Here's a solution: sign the shop over. Everybody walks."],
  c1m4_05: ['polly', "Funny. That's exactly what I was about to tell you."],
  c1m4_06: ['brock', "Pity. Boys, make it quick. Downtown wants this lot paved by Christmas."],
  c1m4_07: ['polly', "Sirens. Somebody called it in. Time to go."],
  c1m4_08: ['june', "You did good, baby. But Tolliver's just the salesman. The man holding his leash is Whitlock Bellwether."],
  c1m4_09: ['polly', "Bellwether. The oil money. The museum-wing, hospital-wing, name-on-every-building Bellwether?"],
  c1m4_10: ['june', "That's him. And there's one more thing. Tolliver's getaway driver, the one who peeled off when you showed up?"],
  c1m4_11: ['june', "That was Lucky Ortega."],
  c1m4_12: ['polly', "Lucky. Of course it was. The man who left me holding the bag four years ago is driving for the people stealing our family's land."],
  c1m4_13: ['june', "Then I guess you've got two reasons to keep going."],
};

export const MISSIONS = {
  c1m1: {
    id: 'c1m1', chapter: 1, title: 'Homecoming', giver: 'june', start: 'mama_june_house', reward: 500, autoStart: true,
    async run(m) {
      await m.cutscene(['c1m1_01', 'c1m1_02', 'c1m1_03', 'c1m1_04', 'c1m1_05', 'c1m1_06', 'c1m1_07'], { focus: 'mama_june_house' });
      m.message('Walk up to any car and press {enter} to take it.', 7);
      await m.getAnyVehicle('Find a ride. Steal any car on the street.');
      m.message('{accel} gas  {brake} brake  {steer} steer  {handbrake} handbrake  {radio} radio', 7);
      await m.goto('dewey_shop', { r: 7, label: "Drive to Dewey's Tire & Lube in the Rose District." });
      m.maxWanted(0);
      await m.cutscene(['c1m1_08', 'c1m1_09', 'c1m1_10', 'c1m1_11', 'c1m1_12', 'c1m1_13'], { focus: 'dewey_shop' });
      m.maxWanted(null);
    },
  },
  c1m2: {
    id: 'c1m2', chapter: 1, title: 'Spare Parts', giver: 'dewey', start: 'dewey_shop', reward: 1500, requires: ['c1m1'],
    async run(m) {
      await m.cutscene(['c1m2_01', 'c1m2_02']);
      const truck = await m.getAnyVehicle('Steal a pickup truck.', (v) => v.kind === 'truck' || /pickup|truck/i.test((v.m.class || '') + v.m.name));
      await m.talk('c1m2_03');
      await m.deliver(truck, 'chop_garage', { label: 'Take the pickup to the chop garage.', r: 6 });
      m.giveMoney(300);
      await m.talk('c1m2_04');
      const fast = await m.getAnyVehicle('Steal a sports car (something fast).', (v) => (v.m.topSpeed || 0) >= 58 || /sport|super|muscle|coupe/i.test(v.m.class || ''));
      m.timer(150, 'DELIVER');
      await m.deliver(fast, 'chop_garage', { label: 'Deliver the sports car to the chop garage — no scratches.', r: 6, maxDamage: 0.6 });
      m.stopTimer();
      await m.cutscene(['c1m2_05', 'c1m2_06']);
    },
  },
  c1m3: {
    id: 'c1m3', chapter: 1, title: 'Repo Rodeo', giver: 'dewey', start: 'dewey_shop', reward: 2000, requires: ['c1m2'],
    async run(m) {
      await m.cutscene(['c1m3_01', 'c1m3_02', 'c1m3_03', 'c1m3_04', 'c1m3_05']);
      const start = m.roadAt(m.offset('dewey_shop', 0, -120), { lane: true });
      const suv = m.spawnCar('suv', start, start.h, { onRoad: true, driver: { model: null, weapon: 'pistol' }, ai: 'flee', blip: '#e33', health: 850 });
      m.driveTo(suv, 'ba_expressway', { flee: true, speed: 30 });
      if (!m.vehicle) m.message('Grab a car — quick!', 4);
      m.timer(170, 'ESCAPE');
      m.failIf(() => Math.hypot(suv.x - m.place('ba_expressway').x, suv.y - m.place('ba_expressway').y) < 30, 'They reached the expressway.');
      await m.destroy(suv, { label: 'Wreck the Syndicate SUV before it reaches the expressway.' });
      m.stopTimer();
      const wreck = { x: suv.x + 3, y: suv.y + 3 };
      await m.collect([wreck], { label: "Grab Dewey's ledger from the wreck.", counter: 'LEDGER' });
      await m.talk(['c1m3_06', 'c1m3_07']);
      await m.goto('dewey_shop', { r: 7, label: 'Bring the ledger back to Dewey.' });
    },
  },
  c1m4: {
    id: 'c1m4', chapter: 1, title: 'Last Call at the Rose', giver: 'june', start: 'mama_june_house', reward: 3000, requires: ['c1m3'],
    async run(m) {
      await m.cutscene(['c1m4_01', 'c1m4_02', 'c1m4_03']);
      m.giveWeapon('pistol', 90);
      m.message('Hold {fire} to shoot. Aim with {aim}. {weapons} switch weapons.', 7);
      await m.goto('rose_meet', { r: 6, label: 'Meet Brock Tolliver in the Rose District.', onFoot: false });
      const brock = m.spawnPed('brock', m.offset('rose_meet', 4, 0), { ai: 'idle' });
      const lucky = m.spawnCar('muscle', m.roadAt(m.offset('rose_meet', 0, 40), { lane: true }), null, { onRoad: true, driver: { model: 'lucky' } });
      await m.cutscene(['c1m4_04', 'c1m4_05', 'c1m4_06'], { focus: 'rose_meet' });
      brock.ai.mode = 'flee';
      m.driveTo(lucky, 'ba_expressway', { flee: true, speed: 35 });
      const thugs = m.gang(5, m.offset('rose_meet', 0, 14), { weapon: 'pistol', faction: 'syndicate', spread: 10, health: 70 });
      m.music(1);
      await m.kill(thugs, { label: 'Take out the Syndicate heavies.', counter: 'HEAVIES' });
      m.remove(brock);
      await m.talk('c1m4_07');
      m.wanted(2);
      await m.loseCops('Lose the cops.');
      m.music(0);
      await m.goto('mama_june_house', { r: 5, label: "Head back to Mama June's." });
      await m.cutscene(['c1m4_08', 'c1m4_09', 'c1m4_10', 'c1m4_11', 'c1m4_12', 'c1m4_13'], { focus: 'mama_june_house' });
    },
  },
};
