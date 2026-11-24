# GTPolly mission scripting API

Story chapters live in `src/story/chN.js`. Each exports three objects:

```js
export const PLACES = {   // story-specific locations (real lat/lon in the Tulsa metro)
  dewey_shop: { lat: 36.05744, lon: -95.79350, name: "Dewey's Tire & Lube" },
};
export const LINES = {    // every spoken line, keyed by a globally unique id: c<chapter>m<mission>_<nn>
  c1m1_01: ['june', 'Well look what the parole board drug in.'],   // [castId, text]
};
export const MISSIONS = {
  c1m2: {
    id: 'c1m2', chapter: 1, title: 'Spare Parts', giver: 'dewey',   // giver = cast id (letter blip on radar)
    start: 'dewey_shop',            // place id or {lat,lon} where the start marker sits
    reward: 1500, requires: ['c1m1'],   // missions in the same chapter that must be passed first
    vehicleStart: false,            // true = can start the mission while driving
    async run(m) { ... },           // the script; returning normally = MISSION PASSED (+reward)
  },
};
```

Cast ids: `polly, june, dewey, whitlock, corrigan, tess, carl, rhonda, brock, lucky, nadine, dispatch, thug, dj` (see `src/story/cast.js`).
Lines must be speakable by TTS: plain sentences, no stage directions, no emoji, no brackets. Keep lines under ~25 words.

Place references accept: a place id (story `PLACES` or the global `src/data/places.js`), `{lat, lon}`, or `{x, y}` (world metres).

## The `m` object

### Dialogue
- `await m.cutscene(['c2m1_01', 'c2m1_02'], { focus: 'place_id' })`: letterboxed dialogue, player controls locked, camera pans to `focus`.
- `await m.talk('c2m1_05')` or `await m.talk([...ids])`: in-game dialogue while the player keeps control (phone call, radio, shouting).
- `m.objective('Text')`: shows the objective line and a help message.
- `m.message('Help text', seconds)`: small top-left help box.

### Navigation and waiting
- `await m.goto(pos, { r: 5, label: 'Drive to X', inVehicle, onFoot, vehicle: v, stopped, timeout, failMsg })`: marker plus radar blip; resolves when the player is inside radius `r`.
- `await m.waitFor(() => condition, { timeout, failMsg })`: resolves when the predicate returns truthy; `pred(dt)` runs every frame.
- `await m.wait(seconds)`
- `m.failIf(() => condition, 'Fail message')`: persistent fail check for the rest of the mission. It returns a remover function.
- `m.fail('message')`: fail immediately. It throws, so nothing after it runs.
- `m.timer(seconds, 'LABEL', { fail: 'Out of time.' })` and `m.stopTimer()`, `m.timeLeft`. Pass `{ fail: null }` for a countdown that doesn't fail.
- `m.counter('LABEL', value, max)`, `m.clearCounter()`, `m.bar('LABEL', 0..1, '#col')`, `m.clearBar()`
- `m.marker(pos, { r, col })` returns a handle; `m.unmark(handle)` removes it.

### Spawning (everything spawned is cleaned up automatically after the mission)
- `m.spawnCar(spec, pos, heading, opts)` returns a Vehicle.
  - `spec`: a vehicle id from `assets/vehicles/catalog.json`, or a keyword matched against class/kind/role/id/name (`'suv'`, `'pickup'`, `'police'`, `'muscle'`, `'sports'`, `'bus'`, `'boat'`, `'heli'`, `'motorbike'`, `'atv'`, `'truck'`, `'limo'`…), or a filter function `(model) => bool`.
  - `opts`: `onRoad` (snap to the nearest road lane and heading), `driver: { model, weapon }` (an AI drives it), `ai: 'cruise' | 'flee' | 'pursue' | 'goto'`, `speed` (max m/s), `blip: true | '#color'`, `health`, `paint`, `locked`.
- `m.driveTo(v, pos, { flee, speed })`: the AI driver heads to `pos` (greedy over the road graph; it U-turns when the target falls behind).
- `m.pursue(v, entity)`: the AI vehicle chases `entity` (a ped or vehicle) and keeps tracking it as it moves.
- `v.ai.mode = 'stop'` parks an AI vehicle; `'cruise'` resumes normal traffic.
- Boats with an AI driver steer straight for their target (`m.driveTo` / `m.pursue`), feeling for open water. Spawn them on water.
- `m.spawnPed(model, pos, opts)` returns a Ped.
  - `model`: a cast id (`'brock'`), a special (`'cop'`, `'swat'`, `'trooper'`, `'player'`), a ped model index, or `null` for a random civilian.
  - `opts`: `weapon`, `ammo`, `hostile: true` (attacks the player), `ai: 'idle' | 'guard' | 'attack' | 'flee' | 'follow' | 'goto'`, `faction`, `health`, `armor`, `blip`, `accuracy` (lower is better; default 1.8), `dmgMul`, `range` (guard aggro range), `target: {x,y}` and `speed` for `'goto'`, `dx`, `dy`.
  - `ped.ai.mode = 'attack'` switches behaviour later.
- `m.gang(n, pos, { weapon, spread, health, armor, faction, blip, models, ai: 'guard' })` returns an array of hostile peds.
- `m.roadAt(pos, { lane: true })` returns `{x, y, h}`, the nearest road point and its heading. `m.offset(pos, dx, dy)` and `m.place(id)` return world points (metres; +x east, +y south).
- `m.remove(entity)`, `m.keep(entity)` (survives cleanup).
- `m.exitVehicle(ped)` makes an NPC get out; `m.putInVehicle(ped, v)` seats an NPC as the driver; `m.invincible(entity, true|false)` toggles damage immunity on a ped or vehicle.

### Composite objectives
- `await m.getAnyVehicle('Steal a car', (v) => filter)` resolves with the vehicle once the player is driving one that matches.
- `await m.enterVehicle(v, 'Get in the truck')`
- `await m.deliver(v, pos, { label, r, maxDamage: 0.5, timeout, exit: true })`: the player must bring this vehicle to `pos` and stop. It fails if the vehicle is destroyed.
- `await m.destroy(entities, { label, counter: 'TARGETS', timeout })`: wait until every vehicle or ped in the list is dead. `m.kill` is an alias.
- `await m.follow(v, { maxDist: 140, minDist: 25, spotTime: 3, until: pos, label, rangeLabel })` tracks a vehicle within the distance limits. An optional `rangeLabel` shows the current gap in metres on the HUD.
- `await m.race(checkpoints, { opponents: [vehicles], oppSpeed: 34, r: 9 })`: checkpoint race; it fails if an opponent finishes first.
- `await m.collect(positions, { label, counter })`: pick-up spots.
- `await m.loseCops('Lose the cops')`, `await m.survive(seconds, 'LABEL')`
- `await m.escort(ped, pos, { label, name })`: the NPC follows the player (gets in the player's car) to `pos`; the mission fails if they die.
- `m.failIfDestroyed(entity, msg)`

### Player and world
- `m.player` (`.money`, `.stats`), `m.ped` (player ped), `m.vehicle` (current vehicle or null), `m.x`, `m.y`
- `m.giveWeapon(id, ammo)` with ids from `src/data/weapons.js`: `bat, knife, pistol, revolver, smg, shotgun, rifle, sniper, minigun, rocket, grenade, molotov, flamer, taser`
- `m.giveMoney(n)`, `m.wanted(stars)`, `m.maxWanted(stars | null)`, `m.clearWanted()`, `m.freezeCops(true)`
- `m.setTime(hour)`, `m.weather('rain' | 'storm' | 'clear')`, `m.music(0..1)` (mission tension layer), `m.flag('name', value)`, `m.teleport(pos, heading)`
- `m.rand(a, b)`, `m.dist(a, b)`
- `m.on('pedKilled', (ped, by) => …)`, `m.on('vehicleDestroyed', (v, by) => …)`, `m.on('enter', v => …)`, `m.on('exit', v => …)`
- `m.onTick = (dt) => { … }`: per-frame hook (used by `race`).

Vehicle fields: `v.x, v.y, v.h, v.speed, v.health, v.maxHealth, v.dead, v.driver, v.passengers, v.m` (catalog model), `v.ai.mode, v.blip, v.sirenOn`.
Ped fields: `p.x, p.y, p.dead, p.health, p.vehicle, p.ai.mode, p.blip, p.weapon`.

Wasted or busted fails the active mission automatically. On failure the player walks back into the start marker to retry.

## Testing a mission headlessly

```
node tools/serve.mjs 8137 &        # if not already running
node tools/shot.mjs "index.html?autostart=new&nomission&chapter=3" out.png --wait 9000 \
  --pre "(() => { const g = __game; const def = Object.values(g.missions.story.MISSIONS).find(m => m.id==='c3m1'); g.missions.start(def); return 'ok'; })()" \
  --keys "Space:200,wait:3000,Space:200" --eval "JSON.stringify(__game.missions.lastResult)"
```
`?chapter=N` marks earlier chapters complete. Script errors surface as `MISSION FAILED (script error) …` and in the console output the tool prints.
