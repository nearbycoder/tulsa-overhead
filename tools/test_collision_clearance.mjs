// Compare the cached broad phase with the exact solver over moving, rotating
// bodies, concave footprints, map changes, and float-rounded vehicle circles.
import assert from 'node:assert/strict';
import { World } from '../src/world/world.js';
import { mulberry32 } from '../src/engine/math.js';

const world = new World(), random = mulberry32(1731);
function building(coords) {
  const pts = Float32Array.from(coords);
  const xs = pts.filter((_, i) => !(i % 2)), ys = pts.filter((_, i) => i % 2);
  return { pts, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}
let buildings = [building([0, 0, 19, 0, 19, 9, 5, 9, 5, 22, 0, 22]),
  building([-20, 6, -5, -9, -2, -6, -17, 9]), building([16, -9, 23, -9, 23, 1, 16, 1])];
world.forEachInRect = (type, x0, y0, x1, y1, visit) => {
  assert.equal(type, 'blds');
  for (const b of buildings) {
    const [l, t, r, d] = b.bb;
    if (r >= x0 && l <= x1 && t <= y1 && d >= y0 && visit(b) === false) break;
  }
};
let hits = 0, skips = 0;
for (const offset of [0, 82000, -95000]) {
  buildings = buildings.map(b => building(b.pts.map(n => n + offset)));
  world.regionRevision++;
  for (const [len, width] of [[0.8, 0.8], [4.5, 1.9], [13.2, 3.0], [2.5, 3.2]]) {
    const actor = { x: 0, y: 0 }, reach = Math.max(len, width) / 2 + 0.02;
    for (let frame = 0; frame < 12000; frame++) {
      if (frame % 45 === 0) { actor.x = offset + random() * 70 - 34; actor.y = offset + random() * 65 - 32; }
      else { actor.x += random() - 0.5; actor.y += random() - 0.5; }
      const near = world.mayTouchBuilding(actor, reach);
      const angle = random() * 2 * Math.PI;
      for (const step of [-0.5, 0, 0.5]) {
        const shift = step * Math.max(0, len - width);
        const hit = world.collideCircle(Math.fround(actor.x + shift * Math.cos(angle)),
          Math.fround(actor.y + shift * Math.sin(angle)), width / 2);
        if (hit) { hits++; assert.ok(near, 'Broad phase skipped a real footprint contact'); }
      }
      if (!near) skips++;
    }
  }
  buildings = buildings.map(b => building(b.pts.map(n => n - offset)));
}
const actor = { x: 200, y: 205 };
assert.equal(world.mayTouchBuilding(actor, 0.4), false);
buildings = [building([200, 200, 208, 200, 208, 208, 200, 208])];
world.regionRevision++;
assert.equal(world.mayTouchBuilding(actor, 0.4), true, 'Newly streamed footprint must invalidate empty space');
buildings = [];
world.regionRevision++;
assert.equal(world.mayTouchBuilding(actor, 0.4), false);
buildings = [building([206, 200, 210, 200, 210, 210, 206, 210])];
world.regionRevision++;
assert.equal(world.mayTouchBuilding(actor, 0.4), false);
assert.equal(world.mayTouchBuilding(actor, 7), true, 'A larger radius requires a new clearance test');
assert.ok(hits > 100 && skips > 20000);
console.log('No missed contacts in 432,000 circle checks, including region changes, long vehicles and concave footprints.');
