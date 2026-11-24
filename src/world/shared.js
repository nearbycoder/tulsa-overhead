// Constants shared by the world worker and the main thread.
export const REGION = 2048;
export const MASK_M = 2;
export const MASK_N = REGION / MASK_M;
export const CELL = 64;
export const CELLS = REGION / CELL;

// Surface categories
export const S = { GROUND: 0, WATER: 1, ROAD: 2, WALK: 3, BUILDING: 4, PARK: 5, FOREST: 6, FARM: 7, DIRT: 8, PARKING: 9,
  LAWN: 10, LOT: 11, RAIL: 12, DIRTROAD: 13, RUNWAY: 14, WETLAND: 15, BRIDGE: 16, PITCH: 17, CEMETERY: 18,
  GOLF: 19, POOL: 20, CREEK: 21 };
export const SURF_NAME = Object.fromEntries(Object.entries(S).map(([k, v]) => [v, k]));

// Road classes (build_map ROAD_CLS)
export const RC = { MOTORWAY: 0, TRUNK: 1, PRIMARY: 2, SECONDARY: 3, TERTIARY: 4, UNCLASSIFIED: 5, RESIDENTIAL: 6,
  LIVING: 7, SERVICE: 8, TRACK: 9, MOTORWAY_LINK: 10, TRUNK_LINK: 11, PRIMARY_LINK: 12, SECONDARY_LINK: 13,
  TERTIARY_LINK: 14, PATH: 15, RACEWAY: 16 };
export const LANE_W = [3.7, 3.6, 3.4, 3.3, 3.2, 3.0, 3.0, 2.8, 2.8, 2.6, 3.6, 3.5, 3.3, 3.2, 3.1, 1.6, 5.0];
export const F = { ONEWAY: 1, BRIDGE: 2, TUNNEL: 4, UNPAVED: 8, ROUND: 16, AISLE: 32, DRIVEWAY: 64 };
// default speed limits (m/s) by class
export const CLASS_SPEED = [31, 27, 20, 18, 16, 15, 12, 8, 7, 11, 18, 18, 14, 13, 12, 3, 30];

export function roadWidth(cls, lanes, flags) {
  let w = LANE_W[cls] * lanes;
  if (cls === 0 || cls === 1) w += (flags & F.ONEWAY) ? 3.5 : 5;
  else if (cls === 10 || cls === 11) w += 2.5;
  else if (cls === 9) w = Math.max(w, 4.0);
  else if (cls === 8) w = (flags & F.DRIVEWAY) ? 3.2 : (flags & F.AISLE) ? 6.0 : Math.max(w * 0.85, 4.5);
  return w;
}
export const isDrivableSurf = (v) => v === S.ROAD || v === S.BRIDGE || v === S.DIRTROAD || v === S.PARKING || v === S.RUNWAY;

// Parallel sidewalk centre lines are shared by the ground renderer and surface mask.
export function curbWalk(road, side) {
  const key = side < 0 ? 'leftWalk' : 'rightWalk';
  if (road[key]) return road[key];
  const p = road.pts, out = new Float32Array(p.length), off = side * (road.w / 2 + 2);
  for (let i = 0; i < p.length; i += 2) {
    const a = Math.max(0, i - 2), b = Math.min(p.length - 2, i + 2);
    const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], len = Math.hypot(dx, dy) || 1;
    out[i] = p[i] - dy * off / len; out[i + 1] = p[i + 1] + dx * off / len;
  }
  road[key] = out;
  return out;
}
