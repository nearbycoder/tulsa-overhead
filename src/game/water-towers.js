// Place the existing sprite stack at mapped towers. Where a building import has
// traced the tank as an ordinary building, use that footprint's painter slot.
import { waterTowers } from '../data/water-towers.js';
import { pointInPoly } from '../engine/math.js';
import { StackSprite } from '../engine/stacks.js';
import { REGION } from '../world/shared.js';

function bucket(index, key, item) {
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(item);
}

export function prepareWaterTowers(game, cellSize) {
  const { world } = game, tower = game.assets.props.get('water_tower');
  const byCell = new Map(), byRegion = new Map();
  if (!tower) return { byCell };
  for (const [, lat, lon, diameter, height] of waterTowers) {
    const [x, y] = world.project(lat, lon);
    const scale = diameter ? Math.max(.6, Math.min(2.6, diameter / tower.footprint[0])) : 1;
    const site = { x, y, scale, height, onFootprint: false };
    bucket(byCell, `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`, site);
    bucket(byRegion, world.key(Math.floor(x / REGION), Math.floor(y / REGION)), site);
  }
  const attach = region => {
    const sites = byRegion.get(region.key);
    if (!sites) return;
    for (const site of sites) {
      const { x, y } = site;
      let host;
      world.forEachInRect('blds', x - 1, y - 1, x + 1, y + 1, b => {
        if (pointInPoly(x, y, b.pts)) host = b;
      });
      site.onFootprint = !!host;
      const model = tower.sprite, h = site.height || (host?.h > 19 ? host.h : model.height);
      const sprite = new StackSprite(model.img, model.w, model.h, model.count, model.px * site.scale, h / model.count);
      site.def = { ...tower, radius: tower.radius * site.scale, sprite };
      if (host) {
        // Limit substitution to compact traces centered on the mapped tank. A
        // tower recorded inside a larger facility must not replace the facility.
        const [xmin, ymin, xmax, ymax] = host.bb;
        const width = xmax - xmin, depth = ymax - ymin;
        if (Math.max(width, depth) > 46 || Math.hypot(x - (xmin+xmax)/2, y - (ymin+ymax)/2) > 7) continue;
        host.towerSprite = { x, y, sprite };
        host._st = null;
      }
    }
  };
  const unsubscribe = world.on('load', attach);
  for (const region of world.regions.values()) attach(region);
  return { byCell, unsubscribe };
}
