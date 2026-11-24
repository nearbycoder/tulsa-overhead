// Run with node tools/test_navigation.mjs after rebuilding the regional road graph.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { RouteGraph } from '../src/game/route-graph.js';
import { GPS } from '../src/game/gps.js';
import { F, RC } from '../src/world/shared.js';

function graphFromRoads(roads) {
  const ends = [],
    offsets = [],
    kinds = [],
    points = [];
  for (const [a, b, flags, vertices] of roads) {
    ends.push(a, b);
    offsets.push(points.length / 2);
    kinds.push(RC.RESIDENTIAL | (flags << 8));
    let px = 0,
      py = 0;
    for (const [x, y] of vertices) {
      points.push((x - px) * 10, (y - py) * 10);
      px = x;
      py = y;
    }
  }
  offsets.push(points.length / 2);
  const words = Int32Array.from([
    0,
    Math.max(...ends) + 1,
    roads.length,
    points.length / 2,
    ...ends,
    ...offsets,
    ...roads.map((_, i) => i),
    ...kinds,
    ...points
  ]);
  new DataView(words.buffer).setUint32(0, 0x47505331);
  return new RouteGraph(words.buffer);
}

const graph = graphFromRoads([
  [
    0,
    1,
    0,
    [
      [0, 0],
      [50, 50],
      [100, 0]
    ]
  ],
  [
    1,
    2,
    F.ONEWAY,
    [
      [100, 0],
      [200, 0]
    ]
  ],
  [
    2,
    3,
    0,
    [
      [200, 0],
      [200, 100]
    ]
  ],
  [
    4,
    5,
    0,
    [
      [1000, 2000],
      [1300, 2000]
    ]
  ]
]);
const route = (x, y, tx, ty) => graph.solve(x, y, tx, ty, null);
assert.deepEqual([...route(10, 10, 90, 10).points], [10, 10, 50, 50, 90, 10]);
assert.deepEqual([...route(90, 10, 10, 10).points], [90, 10, 50, 50, 10, 10]);
assert.equal(route(175, 0, 125, 0), null);
assert.equal(route(195, 75, 25, 25), null);
assert.equal(route(25, 25, 1100, 2000), null);
assert.equal(route(3000, 4000, 1100, 2000), null);
const trip = route(25, 25, 200, 75);
assert.deepEqual([...trip.points], [25, 25, 50, 50, 100, 0, 200, 0, 200, 75]);
assert.equal(trip.turns.at(-1).action, 'Turn right');
assert.equal(trip.turns.at(-1).name, 2);
assert.equal(trip.access, -1);
assert.equal(route(25, 25, 225, 75).access, 4);
assert.deepEqual([...route(130, 0, 150, 0).points], [130, 0, 150, 0]);

// Enter the reverse end of a two-way edge with the goal at its exact midpoint.
const midpoint = graphFromRoads([
  [
    0,
    1,
    0,
    [
      [0, 0],
      [100, 0]
    ]
  ],
  [
    2,
    1,
    0,
    [
      [100, 100],
      [100, 0]
    ]
  ]
]).solve(100, 80, 50, 0, null);
assert.deepEqual([...midpoint.points], [100, 80, 100, 0, 50, 0]);

const roundabout = graphFromRoads([
  [
    0,
    1,
    0,
    [
      [0, 0],
      [100, 0]
    ]
  ],
  [
    1,
    2,
    F.ONEWAY | F.ROUND,
    [
      [100, 0],
      [125, 25],
      [150, 0]
    ]
  ],
  [
    2,
    3,
    0,
    [
      [150, 0],
      [250, 0]
    ]
  ]
]).solve(20, 0, 225, 0, null);
assert.deepEqual(
  roundabout.turns.map((t) => t.action),
  ['Enter roundabout', 'Exit roundabout']
);

const folder = new URL('../assets/map/', import.meta.url);
function loadRegional(file, mode) {
  const { buffer, byteOffset, byteLength } = gunzipSync(readFileSync(new URL(file, folder)));
  return new RouteGraph(buffer.slice(byteOffset, byteOffset + byteLength), mode);
}
const regional = loadRegional('navigation.bin.gz', 'road');
const pedestrian = loadRegional('walking.bin.gz', 'walk');
const { places } = JSON.parse(readFileSync(new URL('meta.json', folder)));
const start = places.find((p) => p.n === 'Broken Arrow');
for (const name of [
  'Tulsa',
  'Catoosa',
  'Glenpool',
  'Claremore',
  'Bartlesville',
  'Okmulgee',
  'Sand Springs'
]) {
  const end = places.find((p) => p.n === name && p.t !== 'county');
  assert.ok(end, name);
  for (const network of [regional, pedestrian]) {
    const path = network.solve(start.x, start.y, end.x, end.y, null);
    assert.ok(path && path.points.length > 30, name);
    assert.deepEqual([...path.points.slice(-2)], [end.x, end.y], name);
  }
}
const highways = [RC.MOTORWAY, RC.TRUNK, RC.MOTORWAY_LINK, RC.TRUNK_LINK];
assert.ok(!pedestrian.kind.some(kind => highways.includes(kind & 255)));
assert.ok(pedestrian.kind.some(kind => (kind & 255) === RC.PATH));

// From Gathering Place to the west bank via the Williams Crossing footbridge.
function bridgeDistance(network) {
  const p = network.solve(616.25, 3581.86, 199.41, 3761.15, null).points;
  let distance = 0;
  for (let i = 2; i < p.length; i += 2) distance += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return distance;
}
assert.ok(bridgeDistance(pedestrian) < 650);
assert.ok(bridgeDistance(regional) > 4000);

// In a runtime without workers, walking directions must not fall back to a highway.
const gps = new GPS({ player: { x: 0, y: 0 }, markers: [], waypoint: [1000, 2000], waypointIsManual: true });
gps.update(1);
assert.equal(gps.status, 'Walking map unavailable');
assert.equal(gps.route, null);
gps.request = () => {};
for (const [vehicle, mode] of [
  [{ kind: 'bike' }, 'road'],
  [{ kind: 'heli', isHeli: true }, 'bearing'],
  [{ kind: 'boat', isBoat: true }, 'bearing'],
  [null, 'walk']
]) {
  gps.game.player.vehicle = vehicle;
  gps.update(1);
  assert.equal(gps.mode, mode);
}
console.log(
  'Regional routing passed directed travel, curved geometry, maneuvers, walking/road access, Williams Crossing and seven city pairs.'
);
