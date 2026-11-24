// Search the map data already on the device. Only the story contacts and unlocked
// services depend on the current campaign. Geographic records can span sessions.
const geography = new WeakMap();
export const categories = ['All', 'Towns', 'Landmarks', 'Services', 'Story'];

function normalize(text) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function record(name, kind, group, x, y, area, rank) {
  return {
    name,
    kind,
    group,
    x,
    y,
    area,
    rank,
    key: normalize(name),
    terms: normalize([name, kind, area].join(' '))
  };
}

function mapRecords(game) {
  const world = game.world;
  if (geography.has(world)) return geography.get(world);
  const places = [];
  const byName = new Map();
  const areaAt = (x, y) => world.cityAt(x, y) || world.countyAt(x, y) || '';
  function add(name, kind, group, x, y, area, rank) {
    if (!name || !world.inWorld(x, y)) return;
    const key = normalize(name),
      neighbors = byName.get(key) || [];
    if (neighbors.some((p) => Math.hypot(p.x - x, p.y - y) < 120)) return;
    const p = record(name, kind, group, x, y, area || areaAt(x, y), rank);
    neighbors.push(p);
    byName.set(key, neighbors);
    places.push(p);
  }
  const townNames = new Set(world.cities.map((c) => c.name));
  for (const p of world.places) {
    if (!['city', 'town', 'village', 'hamlet'].includes(p.t)) continue;
    add(p.n, p.t[0].toUpperCase() + p.t.slice(1), 'Towns', p.x, p.y, world.countyAt(p.x, p.y), 2);
  }
  for (const p of Object.values(game.places)) {
    if (townNames.has(p.name) && byName.has(normalize(p.name))) continue;
    const town = townNames.has(p.name);
    add(
      p.name,
      town ? 'Town' : 'Landmark',
      town ? 'Towns' : 'Landmarks',
      p.x,
      p.y,
      town ? world.countyAt(p.x, p.y) : p.area,
      town ? 2 : 1
    );
  }
  for (const p of world.places) {
    if (p.t === 'neighbourhood' || p.t === 'locality') add(p.n, 'Neighborhood', 'All', p.x, p.y, '', 3);
  }
  for (const p of world.pois) {
    const [tag, value] = p.k.split('=');
    const type = (value === 'yes' ? tag : value).replaceAll('_', ' ');
    const landmark =
      tag === 'tourism' || tag === 'historic' || ['park', 'museum', 'library', 'theatre'].includes(value);
    add(p.n, type[0].toUpperCase() + type.slice(1), landmark ? 'Landmarks' : 'All', p.x, p.y, '', 4);
  }
  geography.set(world, places);
  return places;
}

export function destinationIndex(game) {
  const local = [];
  const world = game.world;
  for (const p of game.services) {
    if (p.type === 'safehouse' && !game.isSafehouseUnlocked(p)) continue;
    const kind = { safehouse: 'Safehouse', respray: 'Respray', gunshop: 'Gun shop' }[p.type];
    if (kind) local.push(record(p.name, kind, 'Services', p.x, p.y, world.cityAt(p.x, p.y) || '', 0));
  }
  const missions = game.missions;
  if (missions && !missions.active)
    for (const m of missions.available()) {
      const p = missions.place(m.start);
      local.push(
        record(
          m.title,
          missions.castName(m.giver),
          'Story',
          p.x,
          p.y,
          p.area || world.cityAt(p.x, p.y) || '',
          0
        )
      );
    }
  return local.concat(mapRecords(game));
}

export function findDestinations(index, text, group, x, y) {
  const query = normalize(text),
    tokens = query.split(' ').filter(Boolean);
  const results = [];
  for (const place of index) {
    if (group !== 'All' && group !== place.group) continue;
    if (!tokens.length && group === 'All' && place.rank > 2) continue;
    if (!tokens.every((t) => place.terms.includes(t))) continue;
    const match = !query
      ? 0
      : place.key === query
        ? 0
        : place.key.startsWith(query)
          ? 1
          : tokens.every((t) => place.key.includes(t))
            ? 2
            : 3;
    results.push({ place, distance: Math.hypot(place.x - x, place.y - y), match });
  }
  return results.sort(
    (a, b) =>
      a.match - b.match ||
      a.distance - b.distance ||
      a.place.rank - b.place.rank ||
      a.place.name.localeCompare(b.place.name)
  );
}
