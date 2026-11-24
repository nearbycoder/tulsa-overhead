// Exercise the worker's final navigation masks on a reproducible mix of wet and dry terrain.
import assert from 'node:assert/strict';
import { REGION, MASK_M, MASK_N, S } from '../src/world/shared.js';

const waterLines = [
  [16, [[-200, 511], [300, 511], [300, 955], [499, 790], [750, 845]]],
  [7.5, [[1950, 2110], [1950, 1910], [2100, 1970], [1785, 2180]]],
  [3, [[2050, -2], [2050, 200], [2040, 205], [2040, 220]]],
  [12, [[-25, 1450], [-25, 1400]]],
  [3, [[310, 1500], [310, 1500]]],
];
let state = 1234;
const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2**32);
for (let i = 0; i < 75; i++) {
  const points = [];
  let x = Math.round(random()*2400)-180, y = Math.round(random()*2400)-180;
  for (let j = 0; j < 4; j++) {
    points.push([x,y]);
    x += Math.round(random()*300)-150; y += Math.round(random()*300)-150;
  }
  waterLines.push([Math.round(10 + random()*200)/10, points]);
}

// Reference scan conversion uses the even/odd polygon rule for every segment.
function referenceMask() {
  const mask = new Uint8Array(MASK_N * MASK_N);
  function span(row, left, right) {
    const first = Math.max(0, Math.ceil(left / MASK_M - 0.5));
    const last = Math.min(MASK_N-1, Math.floor(right / MASK_M - 0.5));
    if (first <= last) mask.fill(S.WATER, row*MASK_N + first, row*MASK_N + last+1);
  }
  for (const [width, pts] of waterLines) {
    const radius = Math.max(width/2, MASK_M*0.6);
    for (let i = 1; i < pts.length; i++) {
      const [ax,ay] = pts[i-1], [bx,by] = pts[i];
      const length = Math.hypot(bx-ax, by-ay);
      if (!length) continue;
      const dx = (ay-by) / length * radius, dy = (bx-ax) / length * radius;
      const quad = new Float32Array([ax+dx,ay+dy,bx+dx,by+dy,bx-dx,by-dy,ax-dx,ay-dy]);
      for (let row = 0; row < MASK_N; row++) {
        const y = (row+0.5)*MASK_M, ends = [];
        for (let k = 0, j = 6; k < 8; j = k, k += 2) {
          if ((quad[k+1] > y) !== (quad[j+1] > y)) {
            ends.push(quad[j] + (y-quad[j+1])*(quad[k]-quad[j])/(quad[k+1]-quad[j+1]));
          }
        }
        if (ends.length) span(row, Math.min(...ends), Math.max(...ends));
      }
    }
    for (const [x,y] of pts) for (let row = 0; row < MASK_N; row++) {
      const dy = (row+0.5)*MASK_M - y, half = Math.sqrt(radius*radius - dy*dy);
      if (Number.isFinite(half)) span(row, x-half, x+half);
    }
  }
  return mask;
}

globalThis.self = {};
await import('../src/world/worker.js');
for (const [rx,ry] of [[0,0], [-10,11]]) {
  const ox = rx*REGION, oy = ry*REGION;
  const lines = waterLines.map(([width, path]) => {
    let prevX = 0, prevY = 0;
    const encoded = path.flatMap(([x,y]) => {
      const x10 = (ox+x)*10, y10 = (oy+y)*10, delta = [x10-prevX,y10-prevY];
      prevX = x10; prevY = y10;
      return delta;
    });
    return [2, width, 0, encoded];
  });
  globalThis.fetch = async () => new Response(JSON.stringify({ lines, roads: [], bld: [], areas: [] }));
  const reply = new Promise(resolve => { self.postMessage = resolve; });
  await self.onmessage({ data: { type: 'load', id: 1, base: 'map', rx, ry, opts: {} } });
  const msg = await reply;
  assert.equal(msg.type, 'region', msg.error);
  const expected = referenceMask();
  let differences = 0;
  for (let i = 0; i < expected.length; i++) if (msg.region.mask[i] !== expected[i]) differences++;
  assert.equal(differences, 0, `surface differences in region ${rx},${ry}`);
}
console.log('Worker surface masks matched independent segment and cap rasterization at both region origins.');
