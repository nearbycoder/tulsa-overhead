// Regression checks for junction controls, turn lanes and stacked roads.
import assert from 'node:assert/strict';
import { DriverAI, Traffic } from '../src/game/traffic.js';
import { Vehicle } from '../src/entities/vehicle.js';
import { chooseNext, cum } from '../src/game/roads.js';
import { controlState, approachControls } from '../src/game/traffic-controls.js';

function road(x1, y1, x2, y2, options = {}) {
  const r = { pts: [x1, y1, x2, y2], cls: 3, w: 9, lanes: 3, flags: 0, speed: 14, ...options };
  cum(r);
  return r;
}
const input = road(-100, 0, 0, 0, { ahead: [2, 1, 4], flags: 1 });
const left = road(0, 0, 0, -100),
  through = road(0, 0, 100, 0),
  right = road(0, 0, 0, 100);
const junction = {
  edges: [{ road: input, dir: -1 }, ...[left, through, right].map((road) => ({ road, dir: 1 }))]
};
input.node1 = junction;
for (const [lane, expected] of [left, through, right].entries()) {
  for (const choice of [0, 0.25, 0.99])
    assert.equal(chooseNext(input, 1, () => choice, { lane }).road, expected);
}
// Ordinary DriverAI must pass its actual lane when choosing the next road.
for (const [lane, expected] of [left, through, right].entries()) {
  const v = { x: -18, y: 0, h: 0, z: 0, len: 4, wid: 1.9, vf: 5, driver: {}, ctrl: {} };
  const game = { time: 0, nearbyVehicles: () => [], nearbyPeds: () => [] };
  const driver = new DriverAI(game, v, input, 1, lane, 82);
  driver.update(1 / 60);
  assert.equal(driver.next.road, expected);
}
input.ahead = [1 | 4];
assert.equal(chooseNext(input, 1, () => 0, { lane: 0 }).road, through);
assert.equal(chooseNext(input, 1, () => 0.99, { lane: 0 }).road, right);
// The mapped OSM way may end at a bend before the final signaled junction.
input.node1 = {
  edges: [
    { road: input, dir: -1 },
    { road: left, dir: 1 }
  ]
};
assert.equal(chooseNext(input, 1, () => 0, { lane: 0 }).road, left);

for (let t = 0; t < 28; t += 0.25) {
  const east = controlState({ group: 1, phase: 4.5 }, t),
    north = controlState({ group: 2, phase: 4.5 }, t);
  assert.ok(east === 'red' || north === 'red');
}
const r = road(0, 0, 100, 0, { controls: [[1, 1, 0, 0, 0]], lanes: 2 });
const [stop] = approachControls(r, 1);
assert.deepEqual(approachControls(r, -1), []);
const g = { time: 0, nearbyVehicles: () => traffic, nearbyPeds: () => walkers };
const car = { x: 97, y: 1.5, z: 0, h: 0, len: 4, wid: 1.9, vf: 0, driver: {}, ctrl: {}, id: 2 };
const ai = new DriverAI(g, car, r, 1, 0, 97);
const cross = { x: 104, y: -10, z: 0, h: Math.PI / 2, driver: {}, vx: 0, vy: 9, speed: 9 };
let traffic = [car, cross],
  walkers = [];
for (let i = 0; i < 90; i++) {
  g.time += 1 / 60;
  assert.equal(ai.controlSpeed(1 / 60, 0, 3), 0);
}
cross.y = 25;
assert.equal(ai.controlSpeed(1 / 60, 0, 3), Infinity);
assert.equal(ai.releasedControl, stop);

const lead = { ...car, id: 1, x: car.x + 4.6, ai: { mode: 'cruise' } };
traffic = [lead];
for (let i = 0; i < 410; i++) ai.update(1 / 60);
assert.ok(!(ai.overtakeT > 0));
assert.equal(ai.blockedT, 0);
lead.z = 7;
walkers = [{ x: lead.x, y: lead.y, z: 7 }];
assert.equal(ai.scanAhead(10), Infinity);
lead.z = 0;
assert.ok(Number.isFinite(ai.scanAhead(10)));
traffic = [];
walkers[0].z = 0;
assert.ok(Number.isFinite(ai.scanAhead(10)));

// A waiting driver with an earlier arrival gets the first turn at an all-way stop.
const peer = { ...cross, x: 105, y: -5, speed: 0, id: 1, ai: { arrivedAtStop: 8 } };
traffic = [peer];
ai.arrivedAtStop = 9;
assert.equal(ai.crossingTraffic(), true);
peer.ai.arrivedAtStop = 12;
assert.equal(ai.crossingTraffic(), false);

// A perpendicular stall at the end of a Jenks parking aisle used to block East Main Street.
const aisle = road(2160, 14506, 2160, 14532, { cls: 8, flags: 32, lanes: 2, w: 6 });
const main = road(2088, 14532, 2160, 14532, { lanes: 2, w: 6.6 });
const parking = new Traffic({ world: { forEachInRect: (type, x1, y1, x2, y2, fn) => { fn(aisle); fn(main); } } });
const parked = { x: 2154, y: 14531, z: 0, h: 0, len: 4.2, wid: 1.8, radius: 2.3, circles: 2, circlePositions: Vehicle.prototype.circlePositions };
assert.equal(parking.clearOfOtherRoads(parked, aisle), false);
parked.y = 14512;
assert.equal(parking.clearOfOtherRoads(parked, aisle), true);
parked.y = 14531;
main.z = [6, 6];
assert.equal(parking.clearOfOtherRoads(parked, aisle), true);
console.log('Mapped turn choices, signal phases, stop clearance, queues, overpasses and parking-aisle exits passed.');
