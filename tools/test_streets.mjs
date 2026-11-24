// Run against the local game server: node tools/test_streets.mjs [base URL].
import puppeteer from 'puppeteer-core';

const base = process.argv[2] || 'http://localhost:8137';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--mute-audio'],
});
try {
  const page = await browser.newPage();
  await page.goto(base + '/package.json');
  const report = await page.evaluate(async () => {
    const { World } = await import('/src/world/world.js');
    const { S, F } = await import('/src/world/shared.js');
    const { lanesPerDir, laneOffset, laneStripes, pointAt } = await import('/src/game/roads.js');
    const { Ground } = await import('/src/engine/ground.js');
    const world = new World('/assets/map');
    await world.init();
    const ground = new Ground(world);
    const count = { regionPairs: 0, laneCenters: 0, sidewalks: 0, paintOnlyTiles: 0, raisedRoads: 0 };
    function check(ok, msg) { if (!ok) throw Error(msg); }
    for (const [rx, ry] of [[8, 5], [0, 0], [-2, 9], [11, -4], [13, 4], [-20, -20]]) {
      for (const key of [...world.regions.keys()]) world.removeRegion(key);
      const r = await world.requestRegion(rx, ry);
      function remotePoint() {
        for (const road of r.roads) {
          if (!road.sharedId || road.sharedId.startsWith(r.key + ',') || road.cls > 7 ||
              !road.n0 || road.flags & (F.BRIDGE | F.TUNNEL)) continue;
          for (let s = 3; s < road.len - 3; s += 3) {
            const [x, y] = pointAt(road, 1, s, 0, []);
            if (x < r.ox + 4 || x > r.ox + 2044 || y < r.oy + 4 || y > r.oy + 2044) continue;
            if ([S.ROAD, S.DIRTROAD].includes(world.surfaceAt(x, y))) return { road, x, y };
          }
        }
      }
      const sample = remotePoint();
      check(sample, 'No imported boundary surface in ' + r.key);
      const { road, x, y } = sample;
      const near = world.nearestRoad(x, y, 0.7, candidate => candidate === road);
      check(near?.road === road, 'Missing neighbor-only spatial result');
      ground.renderTile(Math.floor(x / 64), Math.floor(y / 64), 1, 8);
      const [ox, oy] = road.sharedId.split(',').map(Number);
      const owner = await world.requestRegion(ox, oy);
      check(owner.roads.includes(road), 'Split road identity');
      let hits = 0;
      world.forEachInRect('roads', ...road.bb, candidate => { if (candidate === road) hits++; });
      check(hits === 1 && road.node0.edges.filter(e => e.road === road && e.dir === 1).length === 1, 'Duplicate edge');
      world.removeRegion(owner.key);
      check(!road.dead && world.sharedRoads.has(road.sharedId), 'Owner eviction killed a live road');
      await world.requestRegion(ox, oy);
      world.removeRegion(r.key);
      check(!road.dead, 'Neighbor eviction killed a live road');
      world.removeRegion(owner.key);
      check(road.dead && !world.sharedRoads.has(road.sharedId), 'Stale unloaded edge');
      const ownerFirst = await world.requestRegion(ox, oy), neighborSecond = await world.requestRegion(rx, ry);
      // Deck physics and drawing must visit the same road objects in the same
      // order as the full index, including ramps shared by adjacent regions.
      for (let dy = 0; dy <= 2048; dy += 128) for (let dx = 0; dx <= 2048; dx += 128) {
        const x = neighborSecond.ox + dx, y = neighborSecond.oy + dy;
        const expected = [], indexed = [];
        world.forEachInRect('roads', x-30, y-30, x+30, y+30, road => {
          if (road.z && road.zmax >= 0.05) expected.push(road);
        });
        world.forEachInRect('decks', x-30, y-30, x+30, y+30, road => { indexed.push(road); });
        check(indexed.length === expected.length && indexed.every((road, i) => road === expected[i]), 'Raised road index mismatch');
        count.raisedRoads += expected.length;
      }
      const reloaded = ownerFirst.roads.find(rd => rd.sharedId === road.sharedId);
      check(reloaded && !reloaded.dead && neighborSecond.roads.includes(reloaded), 'Owner-first reload failed');
      for (const rd of neighborSecond.roads) {
        if (rd.sidewalk) count.sidewalks++;
        if (rd.split) {
          const lines = laneStripes(rd);
          for (const dir of [-1, 1]) for (let lane = 0; lane < lanesPerDir(rd, dir); lane++) {
            const off = laneOffset(rd, lane, dir) * dir;
            check(Math.abs(off) < rd.w / 2 && !lines.some(l => Math.abs(l.offset - off) < 0.5), 'Traffic on lane divider');
            count.laneCenters++;
          }
        }
        // A wide carriageway can enter a tile while its entire centerline lies
        // beyond the old four-metre search margin. Check that tile in isolation.
        if (rd.cls > 4 || rd.w < 12 || !rd.len) continue;
        const xs = [], ys = [];
        for (let i = 0; i < rd.pts.length; i += 2) { xs.push(rd.pts[i]); ys.push(rd.pts[i + 1]); }
        const left = Math.min(...xs), top = Math.min(...ys), right = Math.max(...xs), bottom = Math.max(...ys);
        for (const side of [-1, 1]) {
          const [px, py] = pointAt(rd, 1, rd.len / 2, side * (rd.w / 2 - 0.6), []);
          const x0 = Math.floor(px / 64) * 64, y0 = Math.floor(py / 64) * 64;
          if (world.regionAt(px, py) !== neighborSecond || (right >= x0 - 4 && left <= x0 + 68 && bottom >= y0 - 4 && top <= y0 + 68)) continue;
          let found = false;
          world.forEachInRect('roads', x0, y0, x0 + 64, y0 + 64, candidate => { if (candidate === rd) found = true; });
          check(found, 'Tile omitted a road edge');
          count.paintOnlyTiles++;
        }
      }
      count.regionPairs++;
    }
    check(count.sidewalks && count.laneCenters && count.paintOnlyTiles && count.raisedRoads, 'Missing coverage in street fixture areas');
    // Repeated frames share one pending window. A failed load must still retry
    // when the player stands still, and crossing a prefetch threshold must update it.
    const zone = new World('/assets/map');
    zone.exists = zone.streetRegions = zone.canopyRegions = new Set(['0,0']);
    let attempts = 0;
    zone.worker = { postMessage({ id }) {
      attempts++;
      queueMicrotask(() => zone.onWorker({ id, region: attempts === 1 ? null : { rx: 0, ry: 0, empty: true } }));
    } };
    const pending = zone.update(1024, 1024, 0);
    check(zone.update(1025, 1025, 0) === pending, 'Repeated frame rebuilt a pending window');
    check((await pending)[0] === null, 'Failed fixture unexpectedly loaded');
    await new Promise(resolve => setTimeout(resolve, 2050));
    check((await zone.update(1024, 1024, 0))[0]?.key === '0,0' && attempts === 2, 'Stationary retry failed');
    await zone.update(1600, 1024, 0);
    check(zone.regions.has('1,0'), 'Missed prefetch on approach to region edge');
    zone.removeRegion('0,0');
    await zone.update(1600, 1024, 0);
    check(zone.regions.has('0,0'), 'Window retained an explicitly unloaded region');
    world.worker.terminate();
    return count;
  });
  console.log(report);
} finally {
  await browser.close();
}
