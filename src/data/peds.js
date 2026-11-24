// Tulsa Overhead — pedestrian / character models, generated as sprite stacks.
//
// Conventions (shared with the rest of the sprite-stack engine):
//   * A frame ("Strip") is a horizontal strip of PED_COUNT slices, each PED_W × PED_H px,
//     ground slice (z = 0) leftmost. Draw bottom→top, rotate every slice about the symmetric
//     centre ((w-1)/2, (h-1)/2), squash y for pitch, lift each slice by z * spacing.
//   * In every slice the character's FRONT (face / toes) points DOWN (+y).
//     Heading: turn = atan2(vy, vx) - PI/2.
//   * 0.1 m per pixel horizontally and 0.1 m per slice vertically. Feet touch z = 0 at the
//     slice centre (10,10). All frames share identical w, h, count and pivot.
//   * No per-slice outline: outline the finished stack once, as the engine does.
//
// Everything is deterministic (seeded PRNG); buildPedSprites(i) is pure.
import { setSliceBounds } from '../engine/stacks.js';

export const PED_W = 21, PED_H = 21, PED_COUNT = 22;
export const PED_SPRITE = Object.freeze({
  w: PED_W, h: PED_H, count: PED_COUNT,
  pivotX: (PED_W - 1) / 2, pivotY: (PED_H - 1) / 2,
  metersPerPx: 0.1, metersPerSlice: 0.1,
});
// Frame selection: drive walk/run frame from distance travelled (frame = floor(dist / cycle * 6) % 6).
export const PED_ANIM = Object.freeze({
  frames: ['idle', 'walk', 'run', 'aim', 'punch', 'dead', 'sit'],
  walkFrames: 6, runFrames: 6, punchFrames: 3,
  walkCycleM: 1.3, runCycleM: 2.6, // metres travelled per full 6-frame cycle (two steps)
  walkSpeed: 1.4, runSpeed: 5.0,   // suggested m/s
});

const W = PED_W, H = PED_H, N = PED_COUNT, WH = W * H, SW = W * N, CX = 10, CY = 10;

// ---------------------------------------------------------------- PRNG / helpers
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function hash3(x, y, z, s) {
  let h = (Math.imul(x + 31, 374761393) + Math.imul(y + 17, 668265263) + Math.imul(z + 7, 2246822519) + s) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
/** weighted pick: list items are values or [value, weight] */
function pick(r, list) {
  if (!Array.isArray(list)) return list;
  let tot = 0;
  for (const it of list) tot += Array.isArray(it) ? it[1] : 1;
  let x = r() * tot;
  for (const it of list) {
    const w = Array.isArray(it) ? it[1] : 1;
    if ((x -= w) < 0) return Array.isArray(it) ? it[0] : it;
  }
  const l = list[list.length - 1];
  return Array.isArray(l) ? l[0] : l;
}
function rngFn(rng) {
  if (typeof rng === 'function') return rng;
  if (rng && typeof rng.random === 'function') return () => rng.random();
  if (rng && typeof rng.next === 'function') return () => rng.next();
  if (rng && typeof rng.float === 'function') return () => rng.float();
  throw new Error('pickPedModel: rng must be a function returning [0,1) or an object with random()/next()');
}

// ---------------------------------------------------------------- colour
const c255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbHex(r, g, b) { return '#' + ((1 << 24) | (c255(r) << 16) | (c255(g) << 8) | c255(b)).toString(16).slice(1); }
function mixHex(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return rgbHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
function lum(hex) { const [r, g, b] = hexRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
/** 3-tone hue-shifted ramp: cool deep shadow, base mid, warm highlight. */
export function colorRamp(hex) {
  const [r, g, b] = hexRgb(hex);
  return {
    shadow: rgbHex(r * 0.62 + 3, g * 0.64 + 4, b * 0.70 + 12),
    mid: hex,
    highlight: rgbHex(r + (255 - r) * 0.24 + 9, g + (255 - g) * 0.2 + 6, b + (255 - b) * 0.13 + 2),
  };
}

// Fitzpatrick-like range, very light → very dark, hand-tuned ramps (warm highlights keep
// dark tones readable on asphalt).
export const SKIN_TONES = Object.freeze([
  { id: 0, name: 'porcelain', mid: '#f2d6c4', shadow: '#d3ad99', highlight: '#fde9dc' },
  { id: 1, name: 'fair', mid: '#ecc3a3', shadow: '#cc9c80', highlight: '#f8d9bf' },
  { id: 2, name: 'light', mid: '#e1b089', shadow: '#bf8a66', highlight: '#f0c6a1' },
  { id: 3, name: 'light olive', mid: '#d3a477', shadow: '#ad7d55', highlight: '#e5bb8f' },
  { id: 4, name: 'medium', mid: '#c68e62', shadow: '#9f6a44', highlight: '#daa679' },
  { id: 5, name: 'olive tan', mid: '#b27c50', shadow: '#8b5a36', highlight: '#c99565' },
  { id: 6, name: 'tan brown', mid: '#9f6942', shadow: '#7a4b2c', highlight: '#b88158' },
  { id: 7, name: 'brown', mid: '#895535', shadow: '#663b22', highlight: '#a26c49' },
  { id: 8, name: 'dark brown', mid: '#734428', shadow: '#522d18', highlight: '#8e5a3a' },
  { id: 9, name: 'deep brown', mid: '#5d3621', shadow: '#3f2214', highlight: '#7a4b33' },
  { id: 10, name: 'very dark', mid: '#4b2b1c', shadow: '#301b11', highlight: '#66402e' },
  { id: 11, name: 'deepest', mid: '#3c241a', shadow: '#25150f', highlight: '#58372a' },
]);

export const HAIR_COLORS = Object.freeze({
  black: '#1e1a18', dkbrown: '#3a2a1f', brown: '#5e4029', chestnut: '#7a4a2a', auburn: '#94401f',
  ginger: '#bb5b29', dirtyblonde: '#a88a5a', blonde: '#d8b66c', platinum: '#e8dfc6', grey: '#8f8d89',
  silver: '#c6c4bf', white: '#ecebe6', pink: '#e2629f', blue: '#3a6fd8', purple: '#7c4cc8',
  green: '#3ea866', teal: '#279c9c', red: '#c92b2b',
});

export const CLOTH = Object.freeze({
  white: '#e9e7e1', offwhite: '#d9d3c4', cream: '#e6d8b8', ivory: '#efe9d6', black: '#27272c', charcoal: '#3e4047',
  slate: '#5b6470', grey: '#8b8d92', heather: '#a6a8ab', silver: '#c4c8cc',
  navy: '#243559', midnight: '#1c2442', royal: '#2f5ec2', blue: '#3f80d0', sky: '#84b8e4', ceil: '#7fa6cf',
  powder: '#b5d1ea', denim: '#3e5f8e', ltdenim: '#7393bb', dkdenim: '#2a3a5c', bkdenim: '#2f3239',
  red: '#cb3029', crimson: '#9b1c31', maroon: '#692230', wine: '#7a2840', brick: '#9a3b2c', rust: '#a8431f',
  orange: '#e5772b', burnt: '#c0561c', coral: '#ef7b65', salmon: '#e89a85', peach: '#f0b48e',
  yellow: '#edc73a', mustard: '#c99e2a', gold: '#d0a339', lemon: '#f0e070', hivis: '#d4ef2e',
  hvorange: '#ff7417', blaze: '#ff6411',
  green: '#3d8b3f', kelly: '#2c9c4f', forest: '#2c5634', hunter: '#2f4a36', olive: '#6b6a3a', sage: '#9aab84',
  mint: '#8fd4b0', lime: '#9ccf3c', teal: '#24898a', wrench: '#1d948d', turquoise: '#3cbcbc', aqua: '#5fd0d8',
  purple: '#6b40a3', plum: '#5c2d59', lavender: '#a891d6', lilac: '#c6a8dc', pink: '#e680ad', hotpink: '#e3407f',
  blush: '#efb2c2', magenta: '#c2307f', diner: '#ee8fba',
  brown: '#6b462c', dkbrown: '#43301f', chocolate: '#5a3a26', tan: '#c4a678', khaki: '#b6a479', sand: '#d8c49a',
  camel: '#b08850', saddle: '#8a5a30', leather: '#3a2a20', oxblood: '#5e1f1f', taupe: '#8c7e6d', turnout: '#bfa266',
  trooper: '#b3a888', emerald: '#1f8a5a', fr_tan: '#c2a46c', deputy: '#c7b083', ranger: '#5b7344', rangerpants: '#3f4a30', gusher: '#e4d6b2',
  chrome: '#cfd5da', reflect: '#e2e8ea', gunmetal: '#4a4f55',
});
const C = (name) => (name && name[0] === '#') ? name : (CLOTH[name] || HAIR_COLORS[name] || '#ff00ff');

// ---------------------------------------------------------------- vocabulary
export const PED_ZONES = Object.freeze(['downtown', 'urban', 'suburb', 'rural', 'industrial', 'rich', 'campus', 'park', 'casino', 'route66']);
export const HAIR_STYLES = Object.freeze(['bald', 'balding', 'buzz', 'short', 'spiky', 'pixie', 'bob', 'long', 'ponytail', 'bun', 'afro', 'puffs', 'braids', 'locs', 'curly', 'mohawk', 'mullet', 'bighair']);
export const HAT_TYPES = Object.freeze(['none', 'cowboy', 'cap', 'capback', 'trucker', 'beanie', 'hardhat', 'sunhat', 'bucket', 'bikehelmet', 'helmet', 'bandana', 'campaign', 'police', 'firehelmet', 'toque', 'visor', 'fedora', 'churchhat', 'beret', 'skullcap']);
export const TOP_TYPES = Object.freeze(['tee', 'tank', 'buttonup', 'workshirt', 'hawaiian', 'flannel', 'flannelopen', 'pearlsnap', 'polo', 'hoodie', 'suit', 'blazer', 'tux', 'vest', 'leathervest', 'denimvest', 'hivis', 'fishvest', 'huntvest', 'dress', 'sundress', 'gown', 'scrubs', 'coveralls', 'leather', 'racing', 'letterman', 'uniform', 'chef', 'jersey', 'lycra', 'cardigan', 'blouse', 'apron', 'turnout', 'tactical']);
export const BOTTOM_TYPES = Object.freeze(['jeans', 'shorts', 'cargo', 'slacks', 'khakis', 'skirt', 'longskirt', 'sweatpants', 'overalls', 'lycrashorts']);
export const SHOE_TYPES = Object.freeze(['sneakers', 'runners', 'skate', 'boots', 'cowboyboots', 'workboots', 'dress', 'heels', 'sandals', 'clogs']);
export const ACCESSORIES = Object.freeze(['none', 'backpack', 'purse', 'briefcase', 'guitar', 'shopping', 'sunglasses', 'phone', 'coffee', 'cane', 'camera', 'headphones', 'toolbox', 'mailbag', 'carrybox', 'bucket', 'skateboard', 'toolbelt', 'medbag', 'lanyard']);

const NAT_HAIR = [['black', 6], ['dkbrown', 5], ['brown', 4], ['chestnut', 2], ['auburn', 1], ['ginger', 0.8], ['dirtyblonde', 1.5], ['blonde', 1.7], ['platinum', 0.3]];
const NAT_HAIR_DARKSKIN = [['black', 7], ['dkbrown', 3], ['brown', 0.8], ['blonde', 0.25], ['auburn', 0.25]];
const OLD_HAIR = [['grey', 4], ['silver', 4], ['white', 2], ['dkbrown', 0.6], ['black', 0.6], ['dirtyblonde', 0.4]];
const DYED = [['pink', 1], ['blue', 1], ['purple', 1], ['green', 0.7], ['teal', 0.7], ['red', 1], ['platinum', 1]];
const HAIR_M = [['short', 6], ['buzz', 3], ['bald', 1.4], ['curly', 1.5], ['afro', 0.8], ['locs', 0.7], ['mullet', 0.4], ['balding', 0.6], ['spiky', 0.7]];
const HAIR_F = [['long', 5], ['ponytail', 3], ['bun', 2], ['bob', 2], ['braids', 1.2], ['curly', 1.5], ['afro', 0.8], ['locs', 0.6], ['puffs', 0.5], ['pixie', 0.8]];
const BRIGHT = ['red', 'royal', 'sky', 'orange', 'yellow', 'green', 'kelly', 'teal', 'turquoise', 'purple', 'pink', 'hotpink', 'coral', 'lime', 'mint', 'lavender', 'white', 'black', 'grey', 'navy', 'maroon', 'mustard', 'crimson', 'gold', 'forest', 'blue', 'aqua', 'magenta'];
const MUTED = ['white', 'black', 'grey', 'heather', 'navy', 'charcoal', 'olive', 'tan', 'brown', 'maroon', 'forest', 'slate', 'sand', 'khaki', 'denim', 'sage', 'cream', 'rust', 'wine', 'hunter', 'taupe'];
const DENIMS = [['denim', 4], ['ltdenim', 2], ['dkdenim', 3], ['bkdenim', 1.5]];
const SNEAKER_C = [['white', 4], ['black', 3], ['grey', 1], ['red', 1], ['royal', 1], ['offwhite', 1]];
const BOOT_C = [['saddle', 3], ['brown', 3], ['dkbrown', 2], ['black', 2], ['tan', 1]];
const CASUAL_ACC = [['none', 8], ['phone', 2], ['sunglasses', 1.5], ['backpack', 1], ['coffee', 0.8], ['shopping', 0.8], ['headphones', 0.6]];

// Archetype spec keys: n (#models), zones (zone → spawn weight), f (P female), age, build, hairM/hairF,
// hc (hair colours), dyed (P dyed), facial, hat/hatF, hatC, top/topF, tc (top colours), tc2
// (secondary / pattern colours), inner, tie, pat, bot/botF, bc ('match' = top colour), shoes/shoesF,
// sc, acc, ac.
export const ARCHETYPES = [
  { id: 'business', label: 'Businessperson', n: 18, zones: { downtown: 6, rich: 3, urban: 1, casino: 1 }, f: 0.45,
    age: [['adult', 4], ['senior', 1]], hat: [['none', 12], ['fedora', 1]], hatC: ['charcoal', 'black', 'brown'],
    top: ['suit'], topF: [['suit', 3], ['blazer', 2], ['dress', 1]], tc: ['navy', 'charcoal', 'black', 'grey', 'slate', 'midnight', 'brown', 'taupe'],
    tc2: ['white', 'powder', 'blush', 'sky', 'ivory', 'lilac'], inner: ['white', 'powder', 'ivory', 'blush', 'black'], tie: ['crimson', 'royal', 'gold', 'maroon', 'navy', 'teal', 'plum', 'silver', 'red'],
    pat: ['solid'], bot: ['slacks'], botF: [['slacks', 2], ['skirt', 2]], bc: 'match', shoes: ['dress'], shoesF: [['heels', 2], ['dress', 1]],
    sc: ['black', 'oxblood', 'brown', 'dkbrown'], acc: [['briefcase', 4], ['phone', 3], ['coffee', 2], ['none', 2], ['sunglasses', 1]], ac: ['black', 'leather', 'saddle', 'brown'] },
  { id: 'office', label: 'Office worker', n: 18, zones: { downtown: 5, urban: 2, suburb: 1, campus: 0.5 }, f: 0.55,
    top: [['buttonup', 3], ['polo', 2], ['cardigan', 1]], topF: [['blouse', 3], ['cardigan', 2], ['buttonup', 1], ['dress', 1]],
    tc: ['white', 'sky', 'powder', 'lavender', 'heather', 'navy', 'mint', 'blush', 'sage', 'coral', 'wine', 'teal', 'mustard'], pat: [['solid', 5], ['stripes', 2], ['plaid', 1]],
    inner: ['white', 'black', 'ivory', 'heather'], bot: [['khakis', 2], ['slacks', 3]], botF: [['slacks', 2], ['skirt', 2], ['khakis', 1]],
    bc: ['khaki', 'charcoal', 'navy', 'black', 'grey', 'taupe'], shoes: ['dress'], shoesF: [['heels', 1], ['dress', 1], ['sneakers', 0.5]], sc: ['black', 'brown', 'oxblood'],
    acc: [['lanyard', 3], ['coffee', 3], ['phone', 2], ['none', 2], ['backpack', 1]], ac: ['royal', 'red', 'black', 'teal'] },
  { id: 'roughneck', label: 'Oil-field roughneck', n: 16, zones: { industrial: 5, rural: 2, route66: 1 }, f: 0.1, build: ['avg', 'heavy', 'athletic'],
    facial: [['none', 2], ['beard', 2], ['stache', 1], ['stubble', 2]], hat: ['hardhat'], hatC: ['white', 'yellow', 'hvorange', 'royal', 'red', 'lime'],
    top: ['coveralls'], tc: ['red', 'navy', 'fr_tan', 'royal', 'hvorange', 'khaki', 'grey', 'brick'], pat: [['solid', 3], ['grease', 2]],
    bot: ['jeans'], bc: 'match', shoes: ['workboots'], sc: ['saddle', 'brown', 'black', 'tan'], acc: [['none', 4], ['sunglasses', 1], ['toolbox', 1]], ac: ['red', 'black'] },
  { id: 'rancher', label: 'Rancher', n: 18, zones: { rural: 5, route66: 1.5, suburb: 0.5, casino: 0.5 }, f: 0.25, age: [['adult', 3], ['senior', 2]],
    build: ['avg', 'heavy', 'thin', 'athletic'], facial: [['none', 3], ['stache', 2], ['beard', 1], ['stubble', 1]],
    hat: [['cowboy', 8], ['trucker', 1]], hatC: ['tan', 'sand', 'saddle', 'brown', 'black', 'cream', 'dkbrown', 'white'],
    top: [['pearlsnap', 4], ['buttonup', 1], ['flannel', 1]], tc: ['red', 'sky', 'denim', 'white', 'maroon', 'turquoise', 'navy', 'brick', 'sand', 'powder', 'kelly', 'purple'],
    tc2: ['white', 'black', 'navy', 'cream'], pat: [['solid', 3], ['plaid', 1], ['twotone', 1]], bot: ['jeans'], bc: DENIMS, shoes: ['cowboyboots'], sc: BOOT_C,
    acc: [['none', 6], ['sunglasses', 1]] },
  { id: 'farmer', label: 'Farmer', n: 14, zones: { rural: 6, route66: 0.5, suburb: 0.3 }, f: 0.3, age: [['adult', 3], ['senior', 2]], build: ['avg', 'heavy', 'thin'],
    facial: [['none', 3], ['beard', 1], ['stubble', 2]], hat: [['trucker', 3], ['cap', 3], ['sunhat', 1], ['none', 1]], hatC: ['green', 'red', 'white', 'royal', 'mustard', 'khaki', 'kelly', 'sand'],
    top: [['tee', 2], ['flannel', 2], ['workshirt', 1]], tc: ['red', 'white', 'grey', 'sky', 'green', 'mustard', 'navy', 'heather', 'brick'], pat: [['solid', 3], ['plaid', 2]],
    bot: ['overalls'], bc: [['denim', 4], ['brown', 1], ['khaki', 1], ['hunter', 1]], shoes: ['workboots', 'boots'], sc: BOOT_C, acc: [['none', 5], ['bucket', 1]], ac: ['white', 'grey'] },
  { id: 'student', label: 'College student', n: 18, zones: { campus: 6, urban: 2, downtown: 1, park: 1 }, age: ['adult'], build: ['thin', 'avg', 'avg', 'athletic'], dyed: 0.12,
    hat: [['none', 6], ['capback', 1], ['beanie', 1], ['cap', 1]], hatC: BRIGHT, top: [['tee', 4], ['hoodie', 3], ['flannel', 1]], topF: [['tee', 3], ['hoodie', 3], ['tank', 1], ['flannel', 1]],
    tc: BRIGHT, pat: [['solid', 4], ['logodot', 2], ['stripes', 1], ['twotone', 1]], bot: [['jeans', 3], ['shorts', 2], ['sweatpants', 1]], botF: [['jeans', 3], ['shorts', 2], ['skirt', 1], ['sweatpants', 1]],
    bc: ['denim', 'ltdenim', 'dkdenim', 'black', 'grey', 'khaki'], shoes: ['sneakers', 'skate'], sc: SNEAKER_C, acc: [['backpack', 8], ['phone', 2], ['headphones', 1], ['coffee', 1]],
    ac: ['black', 'navy', 'red', 'royal', 'grey', 'green', 'pink', 'purple', 'orange'] },
  { id: 'univ', label: 'University student', n: 14, zones: { campus: 7, downtown: 0.5, park: 0.5 }, age: ['adult'], build: ['thin', 'avg', 'athletic'],
    hat: [['none', 5], ['cap', 1], ['capback', 1], ['beanie', 1]], hatC: ['gold', 'royal', 'navy', 'crimson', 'cream', 'white'],
    top: [['hoodie', 3], ['tee', 3], ['letterman', 1], ['jersey', 1]], tc: ['royal', 'navy', 'gold', 'crimson', 'cream', 'white', 'heather', 'burnt', 'midnight'],
    tc2: ['gold', 'white', 'cream', 'crimson', 'royal'], pat: [['logodot', 3], ['twotone', 2], ['solid', 2], ['stripes', 1]],
    bot: [['jeans', 2], ['sweatpants', 2], ['shorts', 1]], bc: ['denim', 'grey', 'black', 'navy', 'dkdenim'], shoes: ['sneakers'], sc: SNEAKER_C,
    acc: [['backpack', 6], ['phone', 2], ['coffee', 1]], ac: ['black', 'navy', 'grey', 'gold', 'crimson'] },
  { id: 'jogger', label: 'Jogger', n: 14, zones: { park: 5, suburb: 3, rich: 2, campus: 1 }, build: ['thin', 'athletic', 'athletic', 'avg'],
    hairF: [['ponytail', 5], ['bun', 2], ['puffs', 1], ['braids', 1], ['pixie', 1]], hat: [['none', 4], ['visor', 1], ['cap', 1], ['headband', 0]], hatC: ['white', 'black', 'hotpink', 'royal'],
    top: [['tank', 3], ['tee', 2]], topF: [['tank', 3], ['tee', 1], ['lycra', 1]], tc: ['hotpink', 'lime', 'hivis', 'coral', 'royal', 'turquoise', 'white', 'black', 'red', 'orange', 'aqua', 'purple'],
    tc2: ['black', 'white', 'grey'], pat: [['solid', 3], ['twotone', 1]], bot: [['shorts', 3], ['lycrashorts', 1]], botF: [['lycrashorts', 3], ['shorts', 1]],
    bc: ['black', 'navy', 'grey', 'charcoal', 'royal'], shoes: ['runners'], sc: ['white', 'hotpink', 'lime', 'royal', 'black', 'orange', 'aqua'], acc: [['headphones', 4], ['none', 2], ['sunglasses', 1]], ac: ['black', 'white'] },
  { id: 'cyclist', label: 'Cyclist', n: 10, zones: { park: 3, suburb: 1, campus: 1, route66: 0.5 }, build: ['thin', 'athletic'],
    hat: ['bikehelmet'], hatC: ['white', 'red', 'black', 'royal', 'lime', 'hvorange'], top: ['lycra'], tc: ['red', 'royal', 'yellow', 'hvorange', 'lime', 'turquoise', 'hotpink', 'white', 'black', 'kelly'],
    tc2: ['black', 'white', 'navy', 'red'], pat: [['twotone', 2], ['stripes', 1], ['solid', 1]], bot: ['lycrashorts'], bc: ['black', 'navy', 'charcoal'],
    shoes: ['runners'], sc: ['white', 'black', 'red'], acc: [['sunglasses', 3], ['none', 1]] },
  { id: 'retiree', label: 'Retiree', n: 16, zones: { suburb: 4, park: 2, casino: 2, rural: 1, rich: 1 }, age: ['senior'], build: ['avg', 'heavy', 'thin'],
    facial: [['none', 4], ['stache', 1], ['beard', 1]], hairM: [['balding', 3], ['short', 3], ['bald', 1], ['buzz', 1]], hairF: [['bob', 3], ['curly', 3], ['pixie', 2], ['bun', 1]],
    hat: [['none', 4], ['cap', 2], ['sunhat', 1], ['bucket', 1], ['fedora', 0.5]], hatC: ['white', 'khaki', 'navy', 'sand', 'red', 'tan'],
    top: [['polo', 3], ['buttonup', 2], ['hawaiian', 1], ['cardigan', 1]], topF: [['blouse', 3], ['cardigan', 2], ['polo', 1]],
    tc: ['white', 'sky', 'mint', 'sand', 'coral', 'navy', 'lavender', 'peach', 'powder', 'sage', 'red', 'teal'], tc2: ['white', 'coral', 'yellow', 'sky'],
    pat: [['solid', 5], ['stripes', 1], ['plaid', 1]], inner: ['white', 'ivory'], bot: [['khakis', 3], ['slacks', 2], ['shorts', 1]], botF: [['slacks', 3], ['skirt', 1], ['khakis', 1]],
    bc: ['khaki', 'navy', 'tan', 'grey', 'white', 'sand', 'charcoal'], shoes: [['sneakers', 3], ['dress', 1]], sc: [['white', 4], ['brown', 1], ['black', 1]],
    acc: [['none', 4], ['cane', 2], ['sunglasses', 1], ['shopping', 1]], ac: ['brown', 'black', 'white'] },
  { id: 'church', label: 'Church-goer', n: 14, zones: { suburb: 3, urban: 2, rural: 2, downtown: 0.5 }, age: [['adult', 3], ['senior', 2]],
    hat: [['none', 5], ['fedora', 1]], hatF: [['none', 3], ['churchhat', 3]], hatC: ['white', 'royal', 'purple', 'hotpink', 'black', 'lemon', 'coral', 'cream'],
    top: [['suit', 4], ['buttonup', 1]], topF: [['dress', 4], ['blazer', 1]], tc: ['navy', 'charcoal', 'black', 'cream', 'royal', 'purple', 'lavender', 'lemon', 'coral', 'mint', 'white', 'hotpink', 'tan', 'plum'],
    tc2: ['white', 'pink', 'yellow', 'navy'], inner: ['white', 'ivory', 'lavender', 'powder'], tie: ['red', 'royal', 'gold', 'purple', 'maroon', 'silver'], pat: [['solid', 5], ['floral', 2]],
    bot: ['slacks'], botF: ['skirt'], bc: 'match', shoes: ['dress'], shoesF: ['heels'], sc: ['black', 'brown', 'white', 'oxblood'], acc: [['none', 4], ['purse', 1]], ac: ['black', 'white', 'cream'] },
  { id: 'nurse', label: 'Nurse', n: 12, zones: { downtown: 2, urban: 2, campus: 1, suburb: 1 }, f: 0.7, hairF: [['ponytail', 4], ['bun', 3], ['braids', 1], ['pixie', 1], ['bob', 1]],
    hat: ['none'], top: ['scrubs'], tc: ['teal', 'navy', 'ceil', 'wine', 'royal', 'kelly', 'lavender', 'pink', 'black', 'mint'], pat: [['solid', 6], ['floral', 1]], tc2: ['white', 'pink', 'yellow'],
    bot: ['slacks'], bc: 'match', shoes: ['sneakers', 'clogs'], sc: ['white', 'black', 'royal', 'hotpink'], acc: [['lanyard', 3], ['coffee', 2], ['none', 1]], ac: ['royal', 'red', 'teal'] },
  { id: 'construction', label: 'Construction worker', n: 14, zones: { industrial: 3, downtown: 2, suburb: 1, urban: 1 }, f: 0.12, build: ['avg', 'heavy', 'athletic'],
    facial: [['none', 2], ['beard', 1], ['stubble', 2], ['stache', 1]], hat: ['hardhat'], hatC: ['white', 'yellow', 'hvorange', 'royal', 'lime'],
    top: ['hivis'], tc: ['hivis', 'hvorange', 'hivis', 'lime'], inner: ['grey', 'white', 'black', 'navy', 'heather', 'hvorange', 'hivis', 'red', 'royal'],
    bot: ['jeans', 'cargo'], bc: ['denim', 'dkdenim', 'khaki', 'brown', 'tan'], shoes: ['workboots'], sc: BOOT_C, acc: [['toolbelt', 3], ['none', 2], ['sunglasses', 1], ['coffee', 1]], ac: ['saddle', 'brown'] },
  { id: 'mechanic', label: 'Mechanic', n: 12, zones: { urban: 2, industrial: 3, route66: 2, suburb: 0.5 }, f: 0.15, build: ['avg', 'heavy', 'thin'],
    facial: [['none', 2], ['beard', 1], ['stubble', 2], ['goatee', 1]], hat: [['none', 3], ['cap', 1], ['capback', 1]], hatC: ['navy', 'red', 'black', 'grey'],
    top: [['workshirt', 3], ['coveralls', 2]], tc: ['navy', 'slate', 'grey', 'royal', 'khaki', 'charcoal', 'blue', 'brown'], pat: [['grease', 3], ['solid', 1]],
    bot: ['jeans', 'slacks'], bc: ['navy', 'charcoal', 'dkdenim', 'black', 'khaki'], shoes: ['workboots', 'boots'], sc: ['black', 'brown', 'saddle'], acc: [['toolbox', 3], ['none', 2]], ac: ['red', 'black', 'royal'] },
  { id: 'chef', label: 'Chef', n: 8, zones: { downtown: 2, urban: 1.5, casino: 0.5 }, hat: [['toque', 3], ['skullcap', 2], ['bandana', 1], ['none', 1]], hatC: ['white', 'black', 'red'],
    top: ['chef'], tc: ['white', 'white', 'black', 'charcoal'], bot: ['slacks'], bc: ['black', 'charcoal', 'grey'], pat: ['solid'],
    shoes: ['clogs', 'sneakers'], sc: ['black', 'white'], acc: ['none'] },
  { id: 'mail', label: 'Mail carrier', n: 8, zones: { suburb: 3, urban: 2, downtown: 1 }, hat: [['sunhat', 2], ['cap', 1], ['none', 1]], hatC: ['sand', 'navy', 'khaki'],
    top: ['workshirt'], tc: ['powder', 'ceil'], pat: ['solid'], bot: ['shorts', 'slacks'], bc: ['navy', 'midnight'], shoes: ['sneakers', 'boots'], sc: ['black'],
    acc: ['mailbag'], ac: ['navy', 'dkbrown', 'black'] },
  { id: 'delivery', label: 'Delivery driver', n: 10, zones: { urban: 2, suburb: 2, downtown: 2, industrial: 1 }, hat: [['cap', 2], ['none', 2]], hatC: ['brown', 'red', 'royal', 'black', 'hvorange'],
    top: ['polo', 'tee'], tc: ['brown', 'red', 'royal', 'hvorange', 'purple', 'black', 'kelly'], pat: ['solid'], bot: ['shorts', 'cargo'], bc: ['brown', 'black', 'navy', 'khaki', 'charcoal'],
    shoes: ['sneakers', 'boots'], sc: ['black', 'brown', 'white'], acc: [['carrybox', 4], ['phone', 1]], ac: ['camel', 'sand', 'white'] },
  { id: 'hipster', label: 'Hipster', n: 16, zones: { urban: 4, downtown: 2, campus: 1, rich: 0.5 }, age: ['adult'], build: ['thin', 'avg'], dyed: 0.15,
    facial: [['beard', 4], ['stache', 1], ['none', 1]], hairM: [['short', 2], ['bun', 2], ['curly', 1], ['long', 1]], hairF: [['bob', 2], ['bun', 2], ['pixie', 1], ['long', 1], ['curly', 1]],
    hat: [['none', 3], ['beanie', 2], ['fedora', 1], ['beret', 0.5], ['bucket', 0.5]], hatC: ['mustard', 'rust', 'olive', 'charcoal', 'cream', 'black', 'wine'],
    top: [['flannel', 2], ['tee', 2], ['cardigan', 1], ['denimvest', 1], ['buttonup', 1]], tc: ['mustard', 'rust', 'olive', 'teal', 'cream', 'wine', 'sage', 'burnt', 'heather', 'charcoal', 'forest', 'salmon'],
    inner: ['white', 'black', 'heather', 'cream'], pat: [['plaid', 2], ['stripes', 2], ['solid', 2]], bot: [['jeans', 3], ['khakis', 1]], botF: [['jeans', 2], ['skirt', 1], ['longskirt', 1]],
    bc: ['bkdenim', 'dkdenim', 'olive', 'khaki', 'black'], shoes: ['boots', 'sneakers'], sc: ['saddle', 'black', 'white', 'oxblood'], acc: [['coffee', 3], ['phone', 1], ['camera', 1], ['none', 1], ['sunglasses', 1]] },
  { id: 'skater', label: 'Skater', n: 12, zones: { urban: 3, park: 2, campus: 1, suburb: 1 }, age: [['adult', 1], ['teen', 2]], build: ['thin', 'avg'], dyed: 0.2,
    hat: [['capback', 3], ['beanie', 2], ['none', 2], ['bucket', 1]], hatC: BRIGHT, top: [['tee', 3], ['hoodie', 2], ['flannel', 1]], tc: BRIGHT,
    pat: [['solid', 2], ['logodot', 2], ['stripes', 1], ['twotone', 1]], bot: [['shorts', 2], ['jeans', 2], ['cargo', 1]], bc: ['khaki', 'black', 'dkdenim', 'denim', 'olive', 'grey'],
    shoes: ['skate'], sc: SNEAKER_C, acc: [['skateboard', 4], ['backpack', 1], ['headphones', 1]], ac: ['black', 'red', 'royal', 'saddle', 'lime'] },
  { id: 'punk', label: 'Punk / goth', n: 12, zones: { urban: 2, downtown: 1, campus: 0.5 }, age: [['adult', 2], ['teen', 1]], build: ['thin', 'avg'], dyed: 0.65,
    hairM: [['mohawk', 3], ['spiky', 2], ['long', 1], ['buzz', 1]], hairF: [['mohawk', 1], ['bob', 2], ['long', 2], ['pixie', 1], ['puffs', 1]],
    hat: [['none', 6], ['beanie', 1]], hatC: ['black'], top: [['leather', 3], ['tee', 2], ['tank', 1], ['hoodie', 1]], topF: [['leather', 2], ['tee', 1], ['dress', 2], ['tank', 1]],
    tc: [['black', 6], ['charcoal', 1], ['wine', 1], ['plum', 1], ['red', 1]], tc2: ['red', 'white', 'hotpink', 'lime', 'purple'], inner: ['black', 'white', 'red', 'charcoal'],
    pat: [['solid', 3], ['stripes', 1], ['plaid', 1], ['logodot', 1]], bot: ['jeans'], botF: [['jeans', 2], ['skirt', 2]], bc: ['black', 'bkdenim', 'plum', 'red'],
    shoes: ['boots'], sc: ['black', 'oxblood'], acc: [['none', 3], ['sunglasses', 1], ['headphones', 1]] },
  { id: 'metal', label: 'Metalhead', n: 10, zones: { urban: 2, industrial: 1, route66: 1 }, f: 0.3, build: ['avg', 'heavy', 'thin'], hairM: [['long', 5], ['locs', 1], ['bald', 1]], hairF: [['long', 4], ['braids', 1]],
    facial: [['beard', 3], ['goatee', 2], ['none', 1]], hat: [['none', 5], ['beanie', 1], ['bandana', 1]], hatC: ['black', 'red'],
    top: [['tee', 3], ['denimvest', 2], ['leather', 1], ['leathervest', 1]], tc: ['black', 'charcoal', 'black', 'dkdenim'], tc2: ['white', 'red', 'silver', 'orange', 'lime'], inner: ['black', 'charcoal'],
    pat: [['logodot', 4], ['solid', 1]], bot: ['jeans'], bc: ['black', 'bkdenim', 'dkdenim'], shoes: ['boots'], sc: ['black'], acc: [['none', 3], ['sunglasses', 1], ['headphones', 1]] },
  { id: 'cowgirl', label: 'Rodeo cowgirl', n: 12, zones: { rural: 3, route66: 2, casino: 1, suburb: 0.5 }, f: 0.85, age: ['adult'], build: ['thin', 'avg', 'athletic'],
    hairF: [['long', 4], ['braids', 2], ['ponytail', 2]], hat: ['cowboy'], hatC: ['white', 'cream', 'black', 'tan', 'hotpink', 'saddle', 'sand'],
    top: [['pearlsnap', 4], ['tank', 1], ['flannel', 1]], tc: ['turquoise', 'hotpink', 'red', 'royal', 'white', 'purple', 'coral', 'lemon', 'sky', 'black'], tc2: ['white', 'black', 'turquoise', 'red'],
    pat: [['solid', 3], ['twotone', 2], ['plaid', 1]], bot: ['jeans'], bc: DENIMS, shoes: ['cowboyboots'], sc: ['saddle', 'tan', 'black', 'white', 'brown', 'turquoise'], acc: [['none', 4], ['sunglasses', 1], ['phone', 1]] },
  { id: 'tourist', label: 'Tourist', n: 14, zones: { route66: 4, downtown: 2, casino: 2, park: 1 }, age: [['adult', 3], ['senior', 1]], build: ['avg', 'heavy', 'thin'],
    hat: [['sunhat', 2], ['bucket', 2], ['cap', 2], ['visor', 1], ['none', 1]], hatC: ['white', 'sand', 'khaki', 'red', 'royal', 'aqua', 'yellow'],
    top: [['hawaiian', 3], ['tee', 3], ['polo', 1]], topF: [['tee', 2], ['sundress', 2], ['hawaiian', 1], ['tank', 1]], tc: ['aqua', 'coral', 'yellow', 'royal', 'red', 'white', 'lime', 'orange', 'turquoise', 'hotpink', 'sky', 'lemon'],
    tc2: ['white', 'yellow', 'red', 'green', 'hotpink'], pat: [['solid', 2], ['floral', 2], ['logodot', 1], ['stripes', 1]], bot: [['shorts', 3], ['cargo', 2]], botF: [['shorts', 3], ['skirt', 1]],
    bc: ['khaki', 'white', 'denim', 'navy', 'sand', 'tan'], shoes: [['sandals', 2], ['sneakers', 3]], sc: ['white', 'brown', 'black', 'tan'], acc: [['camera', 4], ['sunglasses', 2], ['backpack', 1], ['shopping', 1]], ac: ['black', 'royal', 'red'] },
  { id: 'gambler', label: 'Casino gambler', n: 14, zones: { casino: 7, route66: 0.5, downtown: 0.3 }, age: [['adult', 2], ['senior', 2]], build: ['avg', 'heavy', 'thin'],
    facial: [['none', 3], ['stache', 1], ['goatee', 1]], hat: [['none', 5], ['cowboy', 2], ['cap', 1], ['fedora', 1]], hatC: ['black', 'tan', 'white', 'saddle', 'grey'],
    top: [['buttonup', 2], ['polo', 2], ['hawaiian', 1], ['blazer', 1], ['pearlsnap', 1]], topF: [['blouse', 3], ['dress', 1], ['cardigan', 1]],
    tc: ['black', 'red', 'purple', 'gold', 'royal', 'white', 'magenta', 'teal', 'lavender', 'charcoal', 'wine', 'lemon'], tc2: ['gold', 'black', 'white'], inner: ['black', 'white', 'gold'],
    pat: [['solid', 4], ['floral', 1], ['stripes', 1]], bot: [['slacks', 2], ['jeans', 2], ['khakis', 1]], botF: [['slacks', 2], ['skirt', 1], ['jeans', 1]], bc: ['black', 'charcoal', 'denim', 'khaki', 'navy'],
    shoes: ['dress', 'sneakers', 'cowboyboots'], shoesF: ['heels', 'sneakers', 'dress'], sc: ['black', 'white', 'brown', 'saddle'], acc: [['none', 3], ['purse', 1], ['sunglasses', 1], ['phone', 1]], ac: ['black', 'gold', 'red'] },
  { id: 'musician', label: 'Musician', n: 12, zones: { urban: 2, downtown: 2, route66: 1, campus: 0.3 }, build: ['thin', 'avg'], dyed: 0.1,
    facial: [['beard', 3], ['stubble', 2], ['none', 2], ['stache', 1]], hairM: [['long', 3], ['short', 2], ['curly', 1], ['locs', 1], ['mullet', 1]],
    hat: [['none', 4], ['cowboy', 2], ['fedora', 1], ['beanie', 1]], hatC: ['black', 'saddle', 'grey', 'tan', 'charcoal'],
    top: [['pearlsnap', 2], ['tee', 2], ['leather', 1], ['denimvest', 1], ['buttonup', 1]], tc: ['black', 'white', 'maroon', 'denim', 'cream', 'turquoise', 'mustard', 'charcoal', 'rust', 'teal'],
    tc2: ['white', 'black', 'red'], inner: ['white', 'black'], pat: [['solid', 3], ['plaid', 1], ['logodot', 1]], bot: ['jeans'], bc: ['bkdenim', 'dkdenim', 'denim', 'black'],
    shoes: ['boots', 'cowboyboots', 'sneakers'], sc: ['black', 'saddle', 'brown', 'white'], acc: ['guitar'], ac: ['black', 'dkbrown', 'saddle'] },
  { id: 'artist', label: 'Artist', n: 10, zones: { urban: 2, downtown: 1, campus: 1 }, build: ['thin', 'avg'], dyed: 0.3,
    hairF: [['bun', 3], ['puffs', 1], ['locs', 1], ['curly', 1], ['bob', 1]], hairM: [['locs', 1], ['curly', 1], ['short', 1], ['bun', 1]],
    hat: [['none', 4], ['beret', 1], ['bandana', 1], ['beanie', 1]], hatC: ['black', 'red', 'mustard', 'teal'],
    top: [['tee', 2], ['buttonup', 1], ['apron', 2]], tc: ['white', 'cream', 'denim', 'heather', 'black', 'mustard', 'sage'], pat: [['splatter', 4], ['solid', 1]],
    bot: [['overalls', 2], ['jeans', 2]], bc: ['denim', 'khaki', 'black', 'cream', 'olive'], shoes: ['sneakers', 'boots'], sc: ['white', 'black', 'red'], acc: [['none', 2], ['shopping', 1], ['coffee', 1]], ac: ['camel'] },
  { id: 'unhoused', label: 'Unhoused person', n: 10, zones: { downtown: 2, urban: 2, industrial: 1, route66: 0.5 }, age: [['adult', 3], ['senior', 1]], build: ['thin', 'avg'],
    facial: [['beard', 4], ['stubble', 2], ['none', 1]], hat: [['beanie', 3], ['cap', 2], ['none', 2]], hatC: ['charcoal', 'navy', 'olive', 'maroon', 'grey', 'brown'],
    top: [['hoodie', 2], ['vest', 1], ['flannel', 1], ['leather', 1]], tc: ['olive', 'brown', 'charcoal', 'navy', 'grey', 'maroon', 'hunter', 'taupe', 'rust'], inner: ['grey', 'heather', 'red', 'navy', 'olive'],
    pat: [['solid', 3], ['plaid', 1]], bot: ['jeans', 'sweatpants', 'cargo'], bc: ['dkdenim', 'grey', 'olive', 'brown', 'charcoal', 'khaki'], shoes: ['boots', 'sneakers'], sc: ['brown', 'black', 'grey'],
    acc: [['backpack', 3], ['shopping', 2], ['none', 1]], ac: ['olive', 'navy', 'charcoal', 'white', 'red'] },
  { id: 'kid', label: 'Kid', n: 16, zones: { suburb: 3, park: 4, urban: 1, rural: 1 }, age: ['kid'], build: ['thin', 'avg'],
    hairF: [['ponytail', 3], ['puffs', 2], ['braids', 2], ['long', 2], ['bob', 1]], hairM: [['short', 4], ['curly', 2], ['buzz', 1], ['afro', 1], ['spiky', 1]],
    hat: [['none', 5], ['cap', 2], ['capback', 1], ['bucket', 1]], hatC: BRIGHT, top: [['tee', 5], ['hoodie', 1], ['tank', 1]], topF: [['tee', 4], ['sundress', 1], ['hoodie', 1]],
    tc: BRIGHT, pat: [['solid', 3], ['stripes', 2], ['logodot', 2], ['twotone', 1]], bot: [['shorts', 3], ['jeans', 2], ['sweatpants', 1]], botF: [['shorts', 2], ['skirt', 1], ['jeans', 1]],
    bc: ['denim', 'khaki', 'navy', 'black', 'red', 'pink', 'grey'], shoes: ['sneakers'], sc: SNEAKER_C.concat([['hotpink', 1], ['lime', 1]]), acc: [['none', 4], ['backpack', 2]], ac: BRIGHT },
  { id: 'teen', label: 'Teen', n: 14, zones: { suburb: 2, park: 2, urban: 2, campus: 1, downtown: 0.5 }, age: ['teen'], build: ['thin', 'avg'], dyed: 0.1,
    hat: [['none', 5], ['capback', 1], ['beanie', 1], ['cap', 1]], hatC: BRIGHT, top: [['hoodie', 3], ['tee', 3], ['letterman', 1], ['jersey', 1]], tc: BRIGHT, tc2: ['white', 'black', 'gold', 'red'],
    pat: [['solid', 3], ['logodot', 2], ['twotone', 1]], bot: [['jeans', 3], ['sweatpants', 2], ['shorts', 1]], botF: [['jeans', 3], ['shorts', 1], ['skirt', 1], ['sweatpants', 1]],
    bc: ['denim', 'ltdenim', 'black', 'grey', 'dkdenim'], shoes: ['sneakers', 'skate'], sc: SNEAKER_C, acc: [['phone', 4], ['backpack', 2], ['headphones', 2]], ac: ['black', 'royal', 'red', 'purple'] },
  { id: 'grandma', label: 'Grandma', n: 12, zones: { suburb: 3, rural: 2, casino: 2, urban: 1, park: 1 }, f: 1, age: ['senior'], build: ['avg', 'heavy', 'thin'],
    hairF: [['bun', 3], ['curly', 3], ['bob', 2], ['pixie', 1], ['bighair', 1]], hat: [['none', 5], ['sunhat', 1], ['churchhat', 1]], hatC: ['white', 'lavender', 'pink', 'sand'],
    top: [['cardigan', 3], ['blouse', 3], ['dress', 2]], tc: ['lavender', 'pink', 'powder', 'mint', 'coral', 'peach', 'lilac', 'teal', 'plum', 'royal', 'white', 'sage'],
    tc2: ['white', 'pink', 'yellow', 'navy'], inner: ['white', 'ivory', 'powder', 'blush'], pat: [['solid', 3], ['floral', 3]], bot: [['slacks', 3], ['skirt', 2]],
    bc: ['navy', 'grey', 'white', 'khaki', 'plum', 'black'], shoes: ['sneakers', 'dress'], sc: ['white', 'black', 'navy', 'brown'], acc: [['purse', 6], ['cane', 1], ['shopping', 1]], ac: ['black', 'brown', 'white', 'red', 'cream', 'navy'] },
  { id: 'gymbro', label: 'Gym regular', n: 12, zones: { suburb: 2, urban: 2, campus: 1, rich: 1, park: 1 }, f: 0.3, age: ['adult'], build: ['athletic', 'athletic', 'heavy'],
    hairM: [['buzz', 3], ['short', 2], ['bald', 1], ['spiky', 1]], hairF: [['ponytail', 4], ['bun', 2], ['braids', 1]], facial: [['none', 3], ['beard', 2], ['stubble', 1]],
    hat: [['none', 3], ['capback', 2], ['cap', 1]], hatC: ['black', 'white', 'red', 'grey', 'royal'], top: [['tank', 4], ['tee', 1]], topF: [['tank', 3], ['lycra', 1]],
    tc: ['black', 'grey', 'white', 'red', 'royal', 'heather', 'lime', 'hotpink', 'charcoal', 'navy', 'olive'], pat: [['solid', 4], ['logodot', 1]], bot: [['shorts', 3], ['sweatpants', 2]], botF: [['lycrashorts', 2], ['sweatpants', 1]],
    bc: ['black', 'grey', 'charcoal', 'navy', 'royal'], shoes: ['runners', 'sneakers'], sc: ['white', 'black', 'red', 'lime', 'royal'], acc: [['coffee', 2], ['headphones', 2], ['none', 2], ['backpack', 1]], ac: ['black', 'white', 'grey'] },
  { id: 'fisher', label: 'Fisherman', n: 10, zones: { park: 3, rural: 3, route66: 0.5 }, f: 0.2, age: [['adult', 2], ['senior', 2]], build: ['avg', 'heavy'],
    facial: [['beard', 2], ['stubble', 1], ['none', 2], ['stache', 1]], hat: [['bucket', 3], ['cap', 1], ['trucker', 1]], hatC: ['khaki', 'olive', 'sand', 'tan', 'sage', 'navy'],
    top: ['fishvest'], tc: ['khaki', 'olive', 'sage', 'tan', 'sand'], inner: ['white', 'heather', 'navy', 'sky', 'red', 'forest', 'grey'], bot: ['cargo', 'khakis', 'jeans'], bc: ['khaki', 'olive', 'denim', 'tan', 'sand'],
    shoes: ['boots', 'workboots', 'sandals'], sc: ['brown', 'olive', 'tan'], acc: [['bucket', 3], ['none', 1], ['sunglasses', 1]], ac: ['white', 'hvorange', 'grey'] },
  { id: 'hunter', label: 'Hunter', n: 10, zones: { rural: 4, route66: 0.3 }, f: 0.2, build: ['avg', 'heavy', 'athletic'], facial: [['beard', 3], ['stubble', 2], ['none', 1]],
    hat: [['cap', 3], ['beanie', 2]], hatC: ['blaze', 'blaze', 'blaze'], top: ['huntvest'], tc: ['blaze'], inner: ['olive', 'forest', 'brown', 'hunter', 'khaki', 'red'],
    pat: ['camo'], bot: ['jeans', 'cargo', 'cargo'], bc: ['olive', 'khaki', 'dkdenim', 'brown', 'hunter'], shoes: ['workboots', 'boots'], sc: ['brown', 'saddle', 'olive'], acc: ['none'] },
  { id: 'foodtruck', label: 'Food-truck worker', n: 8, zones: { downtown: 2, urban: 2, park: 1, campus: 0.5 }, hat: [['capback', 2], ['bandana', 2], ['cap', 1], ['none', 1]], hatC: ['black', 'red', 'mustard', 'teal', 'turquoise'],
    top: ['apron'], tc: ['black', 'red', 'white', 'teal', 'mustard', 'grey'], tc2: ['black', 'white', 'denim', 'red', 'brown'], pat: ['solid'], bot: ['jeans', 'shorts'], bc: ['denim', 'black', 'khaki', 'dkdenim'],
    shoes: ['sneakers', 'clogs'], sc: ['black', 'white'], acc: ['none'] },
  { id: 'security', label: 'Security guard', n: 10, zones: { downtown: 2, casino: 2, industrial: 1, rich: 1, campus: 0.5 }, build: ['avg', 'heavy', 'athletic'],
    hat: [['none', 2], ['cap', 1]], hatC: ['black', 'navy'], top: ['uniform'], tc: ['black', 'white', 'charcoal', 'sky', 'midnight'], tc2: ['silver', 'gold'], pat: ['solid'],
    bot: ['slacks'], bc: ['black', 'charcoal', 'navy'], shoes: ['dress', 'boots'], sc: ['black'], acc: [['none', 3], ['lanyard', 1], ['sunglasses', 1]], ac: ['black'] },
  { id: 'bartender', label: 'Bartender', n: 8, zones: { downtown: 2, urban: 2, casino: 1, route66: 0.5 }, hat: ['none'], facial: [['beard', 2], ['stache', 1], ['none', 2]],
    top: [['vest', 3], ['tee', 1], ['apron', 1]], tc: ['black', 'charcoal', 'wine', 'navy'], inner: ['white', 'black', 'grey'], tc2: ['black', 'white'], tie: ['black', 'crimson'], pat: ['solid'],
    bot: ['slacks', 'jeans'], bc: ['black', 'charcoal', 'bkdenim'], shoes: ['dress', 'boots'], sc: ['black'], acc: ['none'] },
  { id: 'formal', label: 'Prom / formal', n: 12, zones: { rich: 2, downtown: 1.5, casino: 1.5 }, age: [['teen', 1], ['adult', 2]], build: ['thin', 'avg', 'athletic'],
    hairF: [['bun', 3], ['long', 3], ['curly', 1], ['braids', 1]], hat: ['none'], top: ['tux'], topF: ['gown'],
    tc: ['black', 'black', 'white', 'midnight', 'wine', 'royal'], tcF: ['crimson', 'royal', 'hotpink', 'emerald', 'gold', 'lilac', 'black', 'aqua', 'purple', 'red', 'silver', 'blush'],
    tie: ['black', 'crimson', 'royal', 'silver'], inner: ['white'], pat: ['solid'], bot: ['slacks'], botF: ['longskirt'], bc: 'match',
    shoes: ['dress'], shoesF: ['heels'], sc: ['black', 'silver', 'gold'], acc: [['none', 3], ['purse', 1]], ac: ['gold', 'silver', 'black'] },
  { id: 'biker', label: 'Route 66 biker', n: 12, zones: { route66: 4, rural: 1, urban: 1, industrial: 0.5 }, f: 0.25, age: [['adult', 3], ['senior', 1]], build: ['heavy', 'avg', 'athletic'],
    facial: [['beard', 5], ['goatee', 1], ['stache', 1]], hairM: [['long', 2], ['bald', 2], ['short', 1], ['balding', 1]], hairF: [['long', 3], ['braids', 1]],
    hat: [['bandana', 3], ['skullcap', 2], ['none', 2]], hatC: ['black', 'navy', 'red', 'charcoal'], top: [['leathervest', 3], ['leather', 2], ['denimvest', 1]],
    tc: ['black', 'leather', 'black'], inner: ['white', 'black', 'grey', 'heather', 'charcoal', 'maroon', 'orange'], bot: ['jeans'], bc: ['bkdenim', 'dkdenim', 'black', 'denim'],
    shoes: ['boots'], sc: ['black'], acc: [['sunglasses', 5], ['none', 1]] },
  { id: 'socialite', label: 'Maple Ridge local', n: 12, zones: { rich: 6, casino: 1, downtown: 0.5 }, f: 0.6, age: [['adult', 3], ['senior', 1]], build: ['thin', 'avg', 'athletic'],
    hat: [['none', 4], ['sunhat', 1], ['visor', 1]], hatC: ['white', 'cream', 'sand', 'black'], top: [['polo', 3], ['buttonup', 1], ['cardigan', 1]], topF: [['sundress', 3], ['polo', 1], ['blouse', 1]],
    tc: ['white', 'powder', 'mint', 'blush', 'lemon', 'navy', 'cream', 'coral', 'lilac', 'sky'], tc2: ['navy', 'white', 'coral'], inner: ['white', 'navy'], pat: [['solid', 4], ['stripes', 1]],
    bot: [['khakis', 3], ['shorts', 1]], botF: [['skirt', 1], ['slacks', 1]], bc: ['khaki', 'white', 'navy', 'sand'], shoes: ['dress', 'sneakers'], shoesF: ['sandals', 'sneakers'],
    sc: ['white', 'saddle', 'tan'], acc: [['sunglasses', 3], ['shopping', 2], ['phone', 1], ['purse', 1]], ac: ['white', 'black', 'hotpink', 'saddle'] },
  { id: 'oilexec', label: 'Oil executive', n: 8, zones: { rich: 3, downtown: 3, casino: 1 }, f: 0.25, age: [['adult', 2], ['senior', 2]], build: ['avg', 'heavy'],
    hat: [['cowboy', 3], ['none', 2]], hatC: ['black', 'white', 'cream', 'tan', 'grey'], top: ['suit'], tc: ['charcoal', 'navy', 'tan', 'grey', 'black', 'brown'], tc2: ['white', 'powder'],
    inner: ['white'], tie: ['turquoise', 'silver', 'crimson', 'black'], pat: ['solid'], bot: ['slacks'], bc: 'match', shoes: ['cowboyboots', 'dress'], sc: ['black', 'oxblood', 'saddle'],
    acc: [['phone', 2], ['briefcase', 1], ['none', 2], ['sunglasses', 1]], ac: ['black', 'saddle'] },
  { id: 'shopper', label: 'Shopper', n: 14, zones: { downtown: 2, suburb: 2, urban: 2, rich: 1, route66: 1 }, age: [['adult', 3], ['senior', 1], ['teen', 0.5]],
    hat: [['none', 6], ['cap', 1], ['sunhat', 0.5]], hatC: BRIGHT, top: [['tee', 3], ['polo', 1], ['hoodie', 1], ['buttonup', 1]], topF: [['blouse', 2], ['tee', 2], ['sundress', 1], ['cardigan', 1]],
    tc: BRIGHT.concat(MUTED), inner: ['white', 'black'], pat: [['solid', 4], ['stripes', 1], ['floral', 1], ['plaid', 0.5]], bot: [['jeans', 3], ['shorts', 1], ['khakis', 1]], botF: [['jeans', 2], ['skirt', 1], ['shorts', 1]],
    bc: ['denim', 'khaki', 'black', 'dkdenim', 'white', 'ltdenim'], shoes: ['sneakers', 'sandals'], sc: SNEAKER_C, acc: [['shopping', 5], ['purse', 1], ['phone', 1]], ac: ['white', 'red', 'sand', 'hotpink', 'royal', 'camel', 'kelly'] },
  { id: 'landscaper', label: 'Landscaper', n: 8, zones: { suburb: 2, rich: 2, park: 1 }, f: 0.15, hat: [['sunhat', 2], ['cap', 2], ['bucket', 1]], hatC: ['sand', 'khaki', 'hivis', 'white', 'olive'],
    top: [['tee', 2], ['hivis', 1], ['workshirt', 1]], tc: ['hivis', 'kelly', 'grey', 'olive', 'white', 'hvorange'], inner: ['grey', 'white'], pat: ['solid'], bot: ['jeans', 'cargo'],
    bc: ['denim', 'khaki', 'olive'], shoes: ['workboots'], sc: BOOT_C, acc: [['none', 2], ['sunglasses', 1], ['bucket', 1]], ac: ['white', 'hvorange'] },
  { id: 'trucker', label: 'Trucker', n: 10, zones: { route66: 3, industrial: 2, rural: 1 }, f: 0.2, build: ['heavy', 'avg'], facial: [['beard', 3], ['stache', 2], ['stubble', 1]],
    hat: [['trucker', 4], ['cap', 1], ['cowboy', 1]], hatC: ['red', 'royal', 'black', 'kelly', 'white', 'mustard', 'navy'], top: [['flannel', 2], ['tee', 2], ['workshirt', 1]],
    tc: ['red', 'navy', 'grey', 'forest', 'brown', 'black', 'royal', 'heather', 'maroon'], pat: [['plaid', 2], ['solid', 2]], bot: ['jeans'], bc: DENIMS, shoes: ['boots', 'workboots', 'cowboyboots'],
    sc: BOOT_C, acc: [['coffee', 2], ['none', 2], ['sunglasses', 1]] },
  { id: 'casual', label: 'Pedestrian', n: 34, zones: { downtown: 2, urban: 3, suburb: 3, rural: 1, industrial: 1, rich: 0.5, campus: 1, park: 2, casino: 1, route66: 1.5 },
    age: [['adult', 6], ['senior', 1.5], ['teen', 1]], dyed: 0.05, hat: [['none', 8], ['cap', 2], ['capback', 1], ['beanie', 0.6], ['cowboy', 0.6], ['sunhat', 0.3]], hatC: BRIGHT.concat(MUTED),
    top: [['tee', 5], ['polo', 1.5], ['hoodie', 1.5], ['buttonup', 1], ['flannel', 1], ['tank', 0.7], ['leather', 0.4], ['pearlsnap', 0.4]],
    topF: [['tee', 4], ['blouse', 2], ['tank', 1], ['sundress', 1], ['hoodie', 1], ['cardigan', 0.6], ['dress', 0.6]], tc: BRIGHT.concat(MUTED),
    inner: ['white', 'black', 'heather'], pat: [['solid', 6], ['stripes', 1.5], ['logodot', 1], ['plaid', 1], ['twotone', 1]], bot: [['jeans', 5], ['shorts', 2], ['khakis', 1], ['sweatpants', 0.7], ['cargo', 1]],
    botF: [['jeans', 4], ['shorts', 2], ['skirt', 1.5], ['slacks', 0.7]], bc: DENIMS.concat(['khaki', 'black', 'grey', 'olive', 'navy', 'white']), shoes: [['sneakers', 5], ['boots', 1], ['sandals', 0.6]],
    sc: SNEAKER_C.concat(BOOT_C), acc: CASUAL_ACC, ac: BRIGHT },
];

// Top garment construction flags (used by the painter).
//  sl: sleeve length 'none'|'short'|'long'; inner: sleeves/front show innerColor (vests, open jackets)
//  open: front strip shows 'inner' | 'shirt' (suit V + tie); skirt: 'knee'|'long' (dresses)
const TOPS = {
  tee: { sl: 'short' }, tank: { sl: 'none', straps: 1 }, buttonup: { sl: 'long', collar: 1, placket: 1 },
  workshirt: { sl: 'short', collar: 1, placket: 1, patch: 1 }, hawaiian: { sl: 'short', collar: 1, force: 'floral' },
  flannel: { sl: 'long', collar: 1, force: 'plaid' }, flannelopen: { sl: 'long', open: 'inner', force: 'plaid' },
  pearlsnap: { sl: 'long', collar: 1, yoke: 1, snaps: 1 }, polo: { sl: 'short', collar: 1 },
  hoodie: { sl: 'long', hood: 1, pocket: 1 }, suit: { sl: 'long', open: 'shirt', tie: 1 }, blazer: { sl: 'long', open: 'inner' },
  tux: { sl: 'long', open: 'shirt', tie: 1, bow: 1 }, vest: { sl: 'long', inner: 1, open: 'inner' },
  leathervest: { sl: 'short', inner: 1, open: 'inner', patchBack: 1 }, denimvest: { sl: 'short', inner: 1, open: 'inner' },
  hivis: { sl: 'short', inner: 1, bands: 1, open: 'inner' }, fishvest: { sl: 'short', inner: 1, pockets: 1, open: 'inner' },
  huntvest: { sl: 'long', inner: 1, open: 'inner' }, dress: { sl: 'short', skirt: 'knee' }, sundress: { sl: 'none', straps: 1, skirt: 'knee' },
  gown: { sl: 'none', straps: 1, skirt: 'long' }, diner: { sl: 'short', skirt: 'knee', collar: 2, apron: 1 },
  scrubs: { sl: 'short', vneck: 1, match: 1 }, coveralls: { sl: 'long', collar: 1, zip: 1, match: 1, patch: 1 },
  leather: { sl: 'long', zip: 1, collar: 1 }, racing: { sl: 'long', zip: 1, collar: 1, racing: 1 },
  letterman: { sl: 'long', sleeves2: 1, hem: 1 }, uniform: { sl: 'long', collar: 1, placket: 1, badge: 1, belt: 1, patch: 1 },
  chef: { sl: 'long', buttons2: 1 }, jersey: { sl: 'short', sides2: 1 }, lycra: { sl: 'short', sides2: 1 },
  cardigan: { sl: 'long', open: 'inner' }, blouse: { sl: 'short', collar: 2 }, apron: { sl: 'short', apron: 1 },
  turnout: { sl: 'long', bands: 1, match: 1, collar: 1 }, tactical: { sl: 'long', tac: 1, belt: 1 },
};
const PATTERN_2ND = {
  plaid: (t) => mixHex(t, '#120e10', 0.62), stripes: (t) => (lum(t) > 0.62 ? CLOTH.navy : CLOTH.white),
  logodot: (t) => (lum(t) > 0.62 ? CLOTH.black : CLOTH.white), floral: (t) => (lum(t) > 0.6 ? CLOTH.hotpink : CLOTH.white),
  twotone: (t) => (lum(t) > 0.55 ? CLOTH.navy : CLOTH.white),
};

// ---------------------------------------------------------------- special / story models
const D = (o) => Object.assign({
  sex: 'm', age: 'adult', skin: 4, hair: 'short', hairColor: HAIR_COLORS.dkbrown, facial: 'none', hat: 'none', hatColor: CLOTH.black,
  top: 'tee', topColor: CLOTH.white, topColor2: null, innerColor: CLOTH.white, tieColor: CLOTH.crimson, pattern: 'solid',
  bottom: 'jeans', bottomColor: CLOTH.denim, shoes: 'sneakers', shoeColor: CLOTH.black, build: 'avg', height: 18,
  accessory: 'none', accColor: CLOTH.black, extras: [], sleeves: null,
}, o);

const SPECIAL_LIST = [
  ['player', D({ name: 'Polly', archetype: 'hero', sex: 'f', skin: 3, hair: 'ponytail', hairColor: '#a3421d', top: 'flannelopen', topColor: '#d8302a',
    topColor2: '#3b0e12', innerColor: '#1d1c20', pattern: 'plaid', bottom: 'jeans', bottomColor: '#3c5f94', shoes: 'boots', shoeColor: '#7b4a25', build: 'athletic', height: 18 })],
  ['cop', D({ name: 'Police officer', archetype: 'police', skin: 7, hair: 'short', hairColor: HAIR_COLORS.black, hat: 'police', hatColor: '#1f2a4a', top: 'uniform',
    topColor: '#26345e', topColor2: '#e3b53a', bottom: 'slacks', bottomColor: '#1b2443', shoes: 'dress', shoeColor: '#151518', build: 'athletic', extras: ['radio'] })],
  ['trooper', D({ name: 'State trooper', archetype: 'police', skin: 2, hair: 'buzz', hairColor: HAIR_COLORS.brown, hat: 'campaign', hatColor: '#8a6a3e', top: 'uniform',
    topColor: '#b9ad8c', topColor2: '#d9b04a', bottom: 'slacks', bottomColor: '#4a3828', shoes: 'boots', shoeColor: '#151518', build: 'athletic', height: 19, accessory: 'sunglasses' })],
  ['swat', D({ name: 'SWAT', archetype: 'police', skin: 5, hair: 'buzz', hat: 'helmet', hatColor: '#24262b', top: 'tactical', topColor: '#1e1f23', topColor2: '#34373d',
    bottom: 'cargo', bottomColor: '#202125', shoes: 'boots', shoeColor: '#121214', build: 'athletic', height: 19, extras: ['gloves'] })],
  ['deputy', D({ name: 'Sheriff deputy', archetype: 'police', skin: 9, hair: 'short', hairColor: HAIR_COLORS.black, hat: 'cap', hatColor: '#4a3523', top: 'uniform', sleeves: 'short',
    topColor: CLOTH.deputy, topColor2: '#e0b640', bottom: 'slacks', bottomColor: '#3f3424', shoes: 'boots', shoeColor: '#2a1d14', build: 'heavy', extras: ['star'] })],
  ['paramedic', D({ name: 'Paramedic', archetype: 'ems', sex: 'f', skin: 6, hair: 'bun', hairColor: HAIR_COLORS.black, top: 'uniform', sleeves: 'short', topColor: '#eceae4',
    topColor2: '#c8312a', bottom: 'cargo', bottomColor: '#1f2b4c', shoes: 'boots', shoeColor: '#151518', accessory: 'medbag', accColor: '#c8312a', height: 17 })],
  ['firefighter', D({ name: 'Firefighter', archetype: 'fire', skin: 1, hair: 'short', hairColor: HAIR_COLORS.ginger, facial: 'stache', hat: 'firehelmet', hatColor: '#f2c318',
    top: 'turnout', topColor: CLOTH.turnout, bottom: 'slacks', bottomColor: CLOTH.turnout, shoes: 'boots', shoeColor: '#18181b', build: 'heavy', height: 19, extras: ['gloves'] })],
  ['wrenches', D({ name: 'Rose District Wrench', archetype: 'gang_wrenches', skin: 4, hair: 'short', hairColor: HAIR_COLORS.black, facial: 'stubble', hat: 'capback', hatColor: '#1b1b1f',
    top: 'workshirt', topColor: CLOTH.wrench, pattern: 'grease', bottom: 'slacks', bottomColor: '#35383e', shoes: 'workboots', shoeColor: '#1c1a19', accessory: 'toolbelt', accColor: '#3a2a20' })],
  ['gusher', D({ name: 'Gusher Syndicate enforcer', archetype: 'gang_gusher', skin: 2, hair: 'short', hairColor: HAIR_COLORS.dkbrown, facial: 'stache', hat: 'cowboy', hatColor: '#1e1b1a',
    top: 'suit', topColor: CLOTH.gusher, innerColor: '#f2efe6', tieColor: '#2fb3b0', extras: ['bolo'], bottom: 'slacks', bottomColor: CLOTH.gusher, shoes: 'cowboyboots', shoeColor: '#5e1f1f',
    build: 'heavy', height: 19, accessory: 'sunglasses' })],
  ['portrats', D({ name: 'Port Rat', archetype: 'gang_portrats', skin: 8, hair: 'short', hairColor: HAIR_COLORS.black, hat: 'beanie', hatColor: '#26324f', top: 'hivis',
    topColor: CLOTH.hvorange, innerColor: '#2b2d33', sleeves: 'long', bottom: 'cargo', bottomColor: '#4b4a3c', shoes: 'workboots', shoeColor: '#6b4a2c', build: 'avg' })],
  ['riders', D({ name: 'Red Dirt Rider', archetype: 'gang_riders', skin: 3, hair: 'long', hairColor: HAIR_COLORS.brown, facial: 'beard', hat: 'bandana', hatColor: CLOTH.rust,
    top: 'leathervest', topColor: '#1d1a19', innerColor: '#8b8d92', bottom: 'jeans', bottomColor: '#2a3a5c', shoes: 'boots', shoeColor: '#151414', build: 'heavy', accessory: 'sunglasses' })],
  ['dewey', D({ name: 'Cousin Dewey', archetype: 'story', skin: 1, hair: 'mullet', hairColor: HAIR_COLORS.dirtyblonde, facial: 'stubble', hat: 'capback', hatColor: '#c8312a',
    top: 'coveralls', topColor: '#6f775c', pattern: 'grease', shoes: 'workboots', shoeColor: '#4a3020', build: 'thin', height: 19 })],
  ['mamajune', D({ name: 'Mama June', archetype: 'story', sex: 'f', age: 'senior', skin: 8, hair: 'bun', hairColor: HAIR_COLORS.silver, top: 'dress', topColor: '#6f5cb4',
    topColor2: '#f4a3c4', pattern: 'floral', shoes: 'dress', shoeColor: '#1e1b1a', build: 'heavy', height: 17, accessory: 'purse', accColor: '#2a2422' })],
  ['whitlock', D({ name: 'Whitlock Bellwether', archetype: 'story', age: 'senior', skin: 0, hair: 'short', hairColor: HAIR_COLORS.white, facial: 'stache', hat: 'cowboy', hatColor: '#f1efe8',
    top: 'suit', topColor: '#eeece5', innerColor: '#d9e3ea', tieColor: '#2a2a2e', extras: ['bolo'], bottom: 'slacks', bottomColor: '#eeece5', shoes: 'cowboyboots', shoeColor: '#5e1f1f', height: 19 })],
  ['corrigan', D({ name: 'Det. Ray Corrigan', archetype: 'story', skin: 2, hair: 'balding', hairColor: '#6d655c', facial: 'stubble', top: 'suit', topColor: '#6b4e33', innerColor: '#d8d2c0',
    tieColor: '#7a2335', bottom: 'slacks', bottomColor: '#5e452e', shoes: 'dress', shoeColor: '#3a2618', build: 'heavy', accessory: 'coffee', extras: ['looseTie'] })],
  ['tess', D({ name: 'Tess Okafor', archetype: 'story', sex: 'f', skin: 10, hair: 'braids', hairColor: HAIR_COLORS.black, top: 'blazer', topColor: '#cc9f26', innerColor: '#efe9d6',
    bottom: 'jeans', bottomColor: '#2f3239', shoes: 'boots', shoeColor: '#1c1a1a', build: 'thin', accessory: 'camera' })],
  ['catfish', D({ name: '"Catfish" Carl', archetype: 'story', skin: 4, hair: 'long', hairColor: HAIR_COLORS.chestnut, facial: 'fullbeard', hat: 'trucker', hatColor: '#2c5634', topColor2: '#e9e7e1',
    top: 'tee', topColor: '#9a3b2c', bottom: 'overalls', bottomColor: '#3e5f8e', shoes: 'workboots', shoeColor: '#5a3a22', build: 'heavy', height: 19 })],
  ['rhonda', D({ name: 'Rhonda Vance', archetype: 'story', sex: 'f', age: 'senior', skin: 1, hair: 'bighair', hairColor: '#e8c76a', top: 'diner', topColor: CLOTH.diner, topColor2: '#f6f3ee',
    shoes: 'sneakers', shoeColor: '#f2f0ea', build: 'avg', height: 17 })],
  ['brock', D({ name: 'Brock Tolliver', archetype: 'story', skin: 2, hair: 'short', hairColor: '#2a1d15', top: 'suit', topColor: '#1d2a50', innerColor: '#f3f1ec', tieColor: '#c9a23a',
    bottom: 'slacks', bottomColor: '#1d2a50', shoes: 'dress', shoeColor: '#4a1a1a', build: 'athletic', height: 19, accessory: 'phone', extras: ['slick', 'sunglasses'] })],
  ['lucky', D({ name: 'Luis "Lucky" Ortega', archetype: 'story', skin: 5, hair: 'curly', hairColor: HAIR_COLORS.black, facial: 'goatee', top: 'racing', topColor: '#cb3029', topColor2: '#f2f0ea',
    bottom: 'jeans', bottomColor: '#2f3239', shoes: 'sneakers', shoeColor: '#1d1c20', build: 'thin', accessory: 'sunglasses' })],
  ['nadine', D({ name: 'Nadine Rowe', archetype: 'story', sex: 'f', skin: 6, hair: 'ponytail', hairColor: HAIR_COLORS.dkbrown, hat: 'campaign', hatColor: '#9c7a4a', top: 'uniform', sleeves: 'short',
    topColor: CLOTH.ranger, topColor2: '#d9b04a', bottom: 'slacks', bottomColor: CLOTH.rangerpants, shoes: 'boots', shoeColor: '#4a3020', build: 'athletic', height: 17 })],
];
export const SPECIAL = Object.freeze(Object.fromEntries(SPECIAL_LIST.map(([k], i) => [k, i])));

// Extra looks per service / faction (same outfit, different person). VARIANTS[key][0] is the SPECIAL.
const VARIANT_KEYS = ['cop', 'trooper', 'swat', 'deputy', 'paramedic', 'firefighter', 'wrenches', 'gusher', 'portrats', 'riders'];
const VARIANT_TWEAKS = {
  wrenches: (r) => ({ hat: pick(r, [['capback', 2], ['none', 2], ['beanie', 1]]), hatColor: C(pick(r, ['black', 'wrench', 'charcoal'])), accessory: pick(r, ['toolbelt', 'none', 'toolbox']) }),
  gusher: (r) => ({ hatColor: C(pick(r, ['black', 'white', 'saddle', 'tan', 'cream'])), tieColor: C(pick(r, ['turquoise', 'silver', 'teal'])), accessory: pick(r, ['sunglasses', 'none']) }),
  portrats: (r) => ({ topColor: C(pick(r, ['hvorange', 'hivis'])), hatColor: C(pick(r, ['navy', 'black', 'grey', 'red', 'olive', 'charcoal'])), hat: pick(r, [['beanie', 4], ['none', 1]]),
    innerColor: C(pick(r, ['charcoal', 'navy', 'black', 'grey', 'olive'])) }),
  riders: (r) => ({ innerColor: C(pick(r, ['grey', 'white', 'black', 'heather', 'maroon', 'charcoal'])), hat: pick(r, [['bandana', 4], ['skullcap', 1]]), hatColor: CLOTH.rust,
    top: pick(r, [['leathervest', 3], ['leather', 1]]) }),
};

// ---------------------------------------------------------------- generation
const RANDOM_TARGET = 520;
const SERVICE_HATS_OK = (hat, hair) => !(hat !== 'none' && (hair === 'afro' || hair === 'bighair' || hair === 'mohawk' || hair === 'puffs'));

const HC = (n) => HAIR_COLORS[n] || C(n);
function natHair(r, skin, age, dyed) {
  if (dyed && r() < dyed) return HC(pick(r, DYED));
  if (age === 'senior') return HC(pick(r, OLD_HAIR));
  return HC(pick(r, skin >= 7 ? NAT_HAIR_DARKSKIN : NAT_HAIR));
}
function heightFor(r, sex, age) {
  if (age === 'kid') return 12 + (r() < 0.5 ? 1 : 0);
  if (age === 'teen') return 15 + (r() < 0.5 ? 1 : 0);
  if (age === 'senior') return sex === 'f' ? 16 + (r() < 0.6 ? 1 : 0) : 17 + (r() < 0.5 ? 1 : 0);
  return sex === 'f' ? 17 + (r() < 0.4 ? 1 : 0) : 18 + (r() < 0.4 ? 1 : 0);
}
function shuffled(r, n) { const a = [...Array(n).keys()]; for (let i = n - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

function genFromArch(a, r, skin) {
  const sex = r() < (a.f ?? 0.5) ? 'f' : 'm';
  const F = sex === 'f';
  const age = pick(r, a.age || [['adult', 5], ['senior', 1]]);
  const build = pick(r, a.build || [['avg', 4], ['thin', 2], ['athletic', 2], ['heavy', 2]]);
  let hair = pick(r, F ? (a.hairF || HAIR_F) : (a.hairM || HAIR_M));
  const hairColor = a.hc ? HC(pick(r, a.hc)) : natHair(r, skin, age, a.dyed || (hair === 'mohawk' ? 0.7 : 0));
  const facial = (!F && age !== 'kid' && age !== 'teen') ? pick(r, a.facial || [['none', 6], ['stubble', 1.5], ['beard', 1.5], ['stache', 0.6], ['goatee', 0.6]]) : 'none';
  let hat = pick(r, F && a.hatF ? a.hatF : (a.hat || ['none']));
  if (!SERVICE_HATS_OK(hat, hair) && hat !== 'bandana' && hat !== 'beanie') hair = F ? 'long' : 'short';
  const hatColor = C(pick(r, a.hatC || BRIGHT));
  const top = pick(r, F && a.topF ? a.topF : a.top);
  const T = TOPS[top] || TOPS.tee;
  const topColor = C(pick(r, F && a.tcF ? a.tcF : a.tc));
  const pattern = T.force || pick(r, a.pat || ['solid']);
  let topColor2 = a.tc2 ? C(pick(r, a.tc2)) : null;
  if (topColor2 === topColor || !topColor2) topColor2 = (PATTERN_2ND[pattern] || PATTERN_2ND.twotone)(topColor);
  if (pattern === 'plaid' && !a.tc2) topColor2 = PATTERN_2ND.plaid(topColor);
  let innerColor = C(pick(r, a.inner || ['white', 'black', 'heather']));
  if (innerColor === topColor) innerColor = lum(topColor) > 0.5 ? CLOTH.black : CLOTH.white;
  const tieColor = C(pick(r, a.tie || ['crimson', 'navy', 'black']));
  let bottom, bottomColor;
  if (T.skirt) { bottom = T.skirt === 'long' ? 'longskirt' : 'skirt'; bottomColor = topColor; }
  else {
    bottom = pick(r, F && a.botF ? a.botF : (a.bot || ['jeans']));
    bottomColor = (a.bc === 'match' || T.match) ? topColor : C(pick(r, a.bc || DENIMS));
    if (bottom === 'overalls' && !a.bc) bottomColor = CLOTH.denim;
  }
  const shoes = pick(r, F && a.shoesF ? a.shoesF : (a.shoes || ['sneakers']));
  const shoeColor = C(pick(r, a.sc || SNEAKER_C));
  const accessory = pick(r, a.acc || CASUAL_ACC);
  const accColor = C(pick(r, a.ac || ['black', 'brown', 'navy']));
  return D({ archetype: a.id, sex, age, skin, hair, hairColor, facial, hat, hatColor, top, topColor, topColor2, innerColor, tieColor, pattern,
    bottom, bottomColor, shoes, shoeColor, build: age === 'kid' && build === 'heavy' ? 'avg' : build, height: heightFor(r, sex, age), accessory, accColor });
}
const VIS_FIELDS = ['sex', 'age', 'skin', 'hair', 'hairColor', 'facial', 'hat', 'hatColor', 'top', 'topColor', 'topColor2', 'innerColor', 'pattern', 'bottom', 'bottomColor',
  'shoes', 'shoeColor', 'build', 'height', 'accessory', 'accColor'];
const visKey = (d) => VIS_FIELDS.map((k) => d[k]).join('|') + '|' + d.archetype;
const glanceKey = (d) => [d.top, d.topColor, d.hat, d.hat === 'none' ? '' : d.hatColor, d.hairColor, d.hair, d.bottomColor].join('|');

function generateModels() {
  const out = [];
  const seen = new Set();
  const add = (d, zones, weight) => {
    d.id = out.length; d.zones = zones; d.weight = weight; d.name = d.name || `${d.label || d.archetype} #${d.id}`; delete d.label;
    seen.add(visKey(d)); out.push(Object.freeze(d));
  };
  for (const [, d] of SPECIAL_LIST) add({ ...d }, [], 0);
  const variants = {};
  for (const key of VARIANT_KEYS) {
    const base = SPECIAL_LIST[SPECIAL[key]][1];
    const r = mulberry32(strHash('variant:' + key));
    const skins = shuffled(r, SKIN_TONES.length).filter((s) => s !== base.skin);
    variants[key] = [SPECIAL[key]];
    for (let v = 0; v < 6; v++) {
      for (let tries = 0; tries < 40; tries++) {
        const sex = r() < (key === 'gusher' || key === 'riders' ? 0.2 : 0.35) ? 'f' : 'm';
        const tw = VARIANT_TWEAKS[key] ? VARIANT_TWEAKS[key](r) : {};
        const hatNow = tw.hat || base.hat;
        let hair = pick(r, sex === 'f' ? [['ponytail', 3], ['bun', 3], ['bob', 1], ['braids', 1], ['long', 1], ['pixie', 1]] : [['short', 4], ['buzz', 3], ['bald', 1], ['curly', 1], ['locs', 0.5]]);
        if (key === 'riders' && r() < 0.5) hair = 'long';
        const skin = skins[(v + tries) % skins.length];
        const d = D({ ...base, ...tw, name: `${base.name} ${v + 2}`, sex, skin, hair, hairColor: natHair(r, skin, r() < 0.15 ? 'senior' : 'adult', 0),
          facial: sex === 'm' ? pick(r, [['none', 3], ['stubble', 1], ['beard', key === 'riders' ? 4 : 0.6], ['stache', 0.6], ['goatee', 0.5]]) : 'none',
          build: pick(r, base.build === 'heavy' ? [['heavy', 2], ['avg', 1], ['athletic', 1]] : [['avg', 2], ['athletic', 2], ['thin', 1], ['heavy', 1]]),
          height: heightFor(r, sex, 'adult'), extras: (base.extras || []).filter((e) => e !== 'slick') });
        if (!SERVICE_HATS_OK(hatNow, hair)) continue;
        if (seen.has(visKey(d))) continue;
        add(d, [], 0); variants[key].push(d.id); break;
      }
    }
  }
  // random civilians
  const totalN = ARCHETYPES.reduce((s, a) => s + a.n, 0);
  for (const a of ARCHETYPES) {
    const r = mulberry32(strHash('arch:' + a.id));
    const count = Math.max(a.n, Math.round((a.n * RANDOM_TARGET) / totalN));
    const skins = shuffled(r, SKIN_TONES.length);
    const zones = Object.keys(a.zones).filter((z) => a.zones[z] > 0);
    const glances = new Set();
    for (let k = 0; k < count; k++) {
      let d = null;
      for (let tries = 0; tries < 60; tries++) {
        const cand = genFromArch(a, r, skins[(k + (tries >> 2)) % skins.length]);
        if (seen.has(visKey(cand))) continue;
        if (tries < 40 && glances.has(glanceKey(cand))) continue;
        d = cand; break;
      }
      if (!d) continue;
      glances.add(glanceKey(d));
      d.label = a.label;
      add(d, zones, 1 / count);
    }
  }
  return { models: out, variants };
}

const GEN = generateModels();
export const PED_MODELS = Object.freeze(GEN.models);
export const VARIANTS = Object.freeze(GEN.variants);
export function pedModelCount() { return PED_MODELS.length; }
export function getPedModel(i) { return PED_MODELS[((i % PED_MODELS.length) + PED_MODELS.length) % PED_MODELS.length]; }

const ARCH_BY_ID = Object.fromEntries(ARCHETYPES.map((a) => [a.id, a]));
const ZONE_TABLES = {};
for (const zone of PED_ZONES) {
  const idx = [], cum = [];
  let s = 0;
  for (const m of PED_MODELS) {
    const a = ARCH_BY_ID[m.archetype];
    const w = a && a.zones[zone] ? a.zones[zone] * m.weight : 0;
    if (w > 0) { s += w; idx.push(m.id); cum.push(s); }
  }
  ZONE_TABLES[zone] = { idx, cum, total: s };
}
/** Weighted random civilian model index for a map zone. rng: () => [0,1) or {random()|next()}. */
export function pickPedModel(rng, zone) {
  const r = rngFn(rng);
  const t = ZONE_TABLES[zone] || ZONE_TABLES.urban;
  const x = r() * t.total;
  let lo = 0, hi = t.cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (t.cum[mid] > x) hi = mid; else lo = mid + 1; }
  return t.idx[lo];
}
/** Random look for a service / faction ('cop','trooper','swat','deputy','paramedic','firefighter','wrenches','gusher','portrats','riders'). */
export function pickVariant(rng, key) {
  const list = VARIANTS[key];
  if (!list) throw new Error('pickVariant: unknown key ' + key);
  return list[Math.floor(rngFn(rng)() * list.length) % list.length];
}

// ================================================================ voxel painter
// A frame is painted into a W×H×N volume of material ids, then shaded into the RGBA strip.
// Shading: voxel with nothing above → highlight; voxel directly under a different material
// group → shadow (contact shadow under hems, brims, sleeves, jaw); everything else → mid.
const vol = new Uint8Array(WH * N);
const vol2 = new Uint8Array(WH * N);
const pal = new Uint8Array(256 * 9);
const grp = new Uint8Array(256);
const palMap = new Map();
let palN = 1;
const GS = { skin: 1, hair: 2, hat: 3, top: 4, bot: 5, shoe: 6, acc: 7, neck: 8, dress: 4 };

function matRamp(sh, mid, hi, g) {
  const k = sh + mid + hi + g;
  let id = palMap.get(k);
  if (id) return id;
  id = palN++;
  if (id > 255) throw new Error('peds: palette overflow');
  const a = hexRgb(sh), b = hexRgb(mid), c = hexRgb(hi);
  pal[id * 9] = a[0]; pal[id * 9 + 1] = a[1]; pal[id * 9 + 2] = a[2];
  pal[id * 9 + 3] = b[0]; pal[id * 9 + 4] = b[1]; pal[id * 9 + 5] = b[2];
  pal[id * 9 + 6] = c[0]; pal[id * 9 + 7] = c[1]; pal[id * 9 + 8] = c[2];
  grp[id] = g; palMap.set(k, id);
  return id;
}
function M(hex, g) { const r = colorRamp(hex); return matRamp(r.shadow, r.mid, r.highlight, g); }
function MF(hex, g) { return matRamp(hex, hex, hex, g); }

const BUILDS = {
  thin: { thw: 2, shw: 3, ty0: 9, ty1: 11, legW: 2, legD: 2, belly: 0, waist: 2 },
  avg: { thw: 2, shw: 3, ty0: 8, ty1: 11, legW: 2, legD: 2, belly: 0, waist: 2 },
  athletic: { thw: 3, shw: 4, ty0: 8, ty1: 11, legW: 2, legD: 2, belly: 0, waist: 2 },
  heavy: { thw: 3, shw: 4, ty0: 8, ty1: 12, legW: 3, legD: 2, belly: 1, waist: 3 },
};

// ---- current paint state (module-level for speed; painting is synchronous) ----
let R = null;          // resolved model
let ZO = 0, LEAN = 0;  // upper-body z offset (sit) and forward lean in px at head height

let CLIPPED = 0;
function put(x, y, z, m) {
  if (x < 0 || x >= W || y < 0 || y >= H || z < 0 || z >= N) { if (m) CLIPPED++; return; }
  vol[z * WH + y * W + x] = m;
}
/** upper-body put: applies sit offset and lean */
function up(x, y, z, m) {
  z += ZO;
  if (LEAN && z > R.hipZ + ZO) y += Math.round((LEAN * (z - R.hipZ - ZO)) / (R.T - R.hipZ));
  put(x, y, z, m);
}
function box(x0, x1, y0, y1, z0, z1, m, f = up) {
  for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) f(x, y, z, m);
}
function disc(cx, cy, rx, ry, z, m, f = up, ring = 0) {
  const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx), y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const q = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (q <= 1.0001 && (!ring || q > ring)) f(x, y, z, m);
  }
}
/** thick 3D polyline of sx×sy×sz cubes (min-corner on the path); mat(t, i) */
function limb(pts, sx, sy, sz, mat, f = up) {
  let total = 0;
  const segs = [];
  for (let s = 0; s < pts.length - 1; s++) {
    const a = pts[s], b = pts[s + 1];
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2]), 1);
    segs.push([a, b, n]); total += n;
  }
  let k = 0;
  for (let s = 0; s < segs.length; s++) {
    const [a, b, n] = segs[s];
    for (let i = s === 0 ? 0 : 1; i <= n; i++, k++) {
      const t = i / n;
      const x = Math.round(a[0] + (b[0] - a[0]) * t), y = Math.round(a[1] + (b[1] - a[1]) * t), z = Math.round(a[2] + (b[2] - a[2]) * t);
      const m = mat(Math.min(1, k / total), k);
      for (let dz = 0; dz < sz; dz++) for (let dy = 0; dy < sy; dy++) for (let dx = 0; dx < sx; dx++) f(x + dx, y + dy, z + dz, m);
    }
  }
}

// ---------------------------------------------------------------- resolve descriptor
function resolve(d) {
  palN = 1; palMap.clear();
  const b = BUILDS[d.build] || BUILDS.avg;
  const T = d.height;
  const hipZ = Math.round(T * 0.42), shZ = T - 6;
  const tf = TOPS[d.top] || TOPS.tee;
  const sk = SKIN_TONES[d.skin] || SKIN_TONES[4];
  const ex = new Set(d.extras || []);
  const dark = (h, t = 0.32) => mixHex(h, '#0c0a10', t);
  const light = (h, t = 0.28) => mixHex(h, '#ffffff', t);
  const isDress = !!tf.skirt;
  const m = {
    skin: matRamp(sk.shadow, sk.mid, sk.highlight, GS.skin),
    neck: matRamp(sk.shadow, sk.mid, sk.highlight, GS.neck),
    eye: MF('#1b1412', GS.skin),
    mouth: MF(mixHex(sk.shadow, '#5a2020', 0.25), GS.skin),
    hair: M(d.hairColor, GS.hair),
    hairD: M(dark(d.hairColor, 0.3), GS.hair),
    hairL: M(light(d.hairColor, 0.25), GS.hair),
    stubble: M(mixHex(sk.mid, d.hairColor, 0.5), GS.skin),
    hat: M(d.hatColor, GS.hat), hatD: M(dark(d.hatColor, 0.38), GS.hat), hatL: M(light(d.hatColor, 0.3), GS.hat),
    top: M(d.topColor, GS.top), top2: M(d.topColor2 || PATTERN_2ND.twotone(d.topColor), GS.top),
    top3: M(mixHex(d.topColor, d.topColor2 || '#000000', 0.5), GS.top),
    topD: M(dark(d.topColor, 0.22), GS.top), topL: M(light(d.topColor, 0.3), GS.top),
    inner: M(d.innerColor, GS.top), tie: M(d.tieColor, GS.top), string: MF('#1d1a1a', GS.top),
    bot: M(d.bottomColor, isDress ? GS.dress : GS.bot), botD: M(dark(d.bottomColor, 0.25), isDress ? GS.dress : GS.bot),
    shoe: M(d.shoeColor, GS.shoe),
    acc: M(d.accColor, GS.acc), accD: M(dark(d.accColor, 0.35), GS.acc),
    metal: M('#c3c9cf', GS.acc), gold: M('#e0b43c', GS.top), white: M('#eeece6', GS.top), black: M('#1c1c20', GS.acc),
    reflect: MF('#e8eef0', GS.top), bandY: M('#d8e03a', GS.top), belt: M('#1a1a1d', GS.bot),
    glove: M('#1d1d21', GS.skin), grease: M('#2b2723', GS.top), patch: M(d.topColor2 || '#c8312a', GS.top),
    lens: MF('#0f1114', GS.skin), camo: [M('#55613a', GS.top), M('#6e5a3c', GS.top), M('#2f3a26', GS.top)],
    paint: [M('#d8352a', GS.top), M('#2f6fd8', GS.top), M('#f0c93a', GS.top), M('#3aa65a', GS.top)],
  };
  const shoeDark = lum(d.shoeColor) < 0.2;
  m.sole = M(['sneakers', 'runners', 'skate', 'clogs'].includes(d.shoes) ? (lum(d.shoeColor) > 0.8 ? '#b9b7b1' : '#ecebe6') : (shoeDark ? '#3a3330' : '#221c19'), GS.shoe);
  let sl = d.sleeves || tf.sl;
  return {
    d, b, T, hipZ, shZ, neckZ: T - 5, hz0: T - 4, hTop: T - 1, kneeZ: 2 + Math.round((hipZ - 2) * 0.45),
    ay0: Math.floor((b.ty0 + b.ty1) / 2), armXL: CX - b.thw - 2, armXR: CX + b.thw + 1,
    handZ: hipZ - 1, elbowZ: Math.round((shZ - 1 + hipZ - 1) / 2), ly0: 9,
    tf, sl, ex, m, pattern: tf.force || d.pattern, seed: strHash(d.name || String(d.id)),
    hy: b.ty0 - 1, // y just behind the back
  };
}

// ---------------------------------------------------------------- garments
function patMat(x, y, z, top) {
  const m = R.m;
  switch (R.pattern) {
    case 'stripes': return ((top ? y : z) & 1) ? m.top2 : m.top;
    case 'plaid': {
      const a = (x + 21) % 3 === 0, b = (top ? y : z) % 3 === 0;
      return a && b ? m.top3 : (a || b) ? m.top2 : m.top;
    }
    case 'twotone': return z >= R.shZ - 1 ? m.top2 : m.top;
    case 'logodot': return (y >= R.b.ty1 && z === R.shZ - 2 && (x === CX || x === CX + 1)) || (y <= R.b.ty0 && z === R.shZ - 1 && Math.abs(x - CX) <= 1) ? m.top2 : m.top;
    case 'floral': { const h = hash3(x, y, z, R.seed) % 9; return h === 0 ? m.top2 : h === 1 ? m.top3 : m.top; }
    case 'splatter': { const h = hash3(x, y, z, R.seed) % 13; return h < 4 ? m.paint[h] : m.top; }
    case 'grease': { const h = hash3(x, y, z, R.seed) % 7; return h === 0 ? m.grease : h === 1 ? m.topD : m.top; }
    case 'camo': return m.camo[hash3(x >> 1, y >> 1, (z / 2) | 0, R.seed) % 3];
    default: return m.top;
  }
}
function sleeveMat(i) {
  const { m, tf, d } = R;
  if (tf.inner) return m.inner;
  if (tf.sleeves2) return m.top2;
  if (tf.sides2) return i === 0 ? m.top : m.top2;
  if (tf.patch && i === 1 && d.top === 'uniform') return m.patch;
  if (tf.racing) return i === 1 ? m.top2 : m.top;
  if (tf.bands && i === 2) return d.top === 'turnout' ? m.bandY : m.reflect;
  switch (R.pattern) {
    case 'plaid': return i % 3 === 0 ? m.top2 : m.top;
    case 'stripes': return i & 1 ? m.top2 : m.top;
    case 'twotone': return m.top2;
    case 'floral': case 'grease': case 'splatter': case 'camo': return patMat(i, 3, i + 2, false);
    default: return m.top;
  }
}
function torsoMat(x, y, z, front, back, isTop, hw) {
  const { m, tf, shZ, hipZ, d, ex } = R;
  const ax = Math.abs(x - CX);
  const outer = ax > R.b.thw;
  // sleeveless shoulders
  if (isTop && (tf.straps || tf.sl === 'none' && !tf.inner)) {
    if (outer) return m.skin;
    if (ax !== R.b.thw && (front || ax <= 1)) return m.skin;
  }
  if (isTop && outer && tf.inner) return m.inner;
  if (tf.vneck && front && ax === 0 && z >= shZ - 1) return m.skin;
  if (tf.belt && z === hipZ) return front && ax === 0 ? m.metal : m.belt;
  if (front && tf.open) {
    if (tf.open === 'shirt') {
      if (ex.has('bolo')) {
        if (ax === 0) return z === shZ - 1 ? m.tie : z >= shZ - 3 ? m.string : z >= shZ - 4 ? m.inner : null;
        if (ax === 1 && z >= shZ - 2) return m.inner;
      } else {
        if (ax === 0 && tf.bow) return z === shZ - 1 ? m.tie : z >= shZ - 3 ? m.inner : null;
        if (ax === 0 && z < shZ && z > hipZ) return ex.has('looseTie') && z === shZ - 1 ? m.inner : m.tie;
        if (ax === 0 && z >= shZ) return m.inner;
        if (ax === 1 && z >= shZ - 1) return m.inner;
      }
    } else if (ax === 0 || (ax === 1 && (z >= shZ - 1 || d.top === 'flannelopen' || tf.inner))) return m.inner;
  }
  if (tf.tac && (front || back) && z > hipZ && z < shZ) return front && z === hipZ + 1 && ax >= 1 ? m.black : m.top2;
  if (tf.apron && front && ax <= 1 && z < shZ) return m.top2;
  if (tf.bands && (z === hipZ + 1 || (z === shZ - 1 && shZ - hipZ >= 4))) return d.top === 'turnout' ? m.bandY : m.reflect;
  if (tf.badge && front && z === shZ - 1 && x === CX + 2) return ex.has('star') ? m.gold : MF(d.topColor2 || '#e0b43c', GS.top);
  if (ex.has('radio') && isTop && x === CX + 2 && front) return m.black;
  if (tf.patch && d.top !== 'uniform' && front && z === shZ - 1 && x === CX - 2) return m.white;
  if (tf.patchBack && back && z >= shZ - 2 && z <= shZ - 1 && ax <= 1) return MF(R.d.archetype === 'gang_riders' ? '#b84a22' : '#8a8a8a', GS.top);
  if (tf.collar && isTop && front && ax === 1) return tf.collar === 2 ? m.white : m.topL;
  if (tf.zip && front && ax === 0) return d.top === 'coveralls' ? m.topD : m.metal;
  if (tf.racing && (front || back || isTop) && ax === 1) return m.top2;
  if (tf.snaps && front && ax === 0) return (z - hipZ) % 2 ? m.white : m.topD;
  if (tf.placket && front && ax === 0) return m.topD;
  if (tf.buttons2 && front && ax === 1 && (z - hipZ) % 2 === 1) return m.black;
  if (tf.pocket && front && ax <= 1 && z <= hipZ + 1) return m.topD;
  if (tf.pockets && front && ax >= 1 && (z === hipZ + 1 || z === shZ - 2)) return m.topD;
  if (tf.hem && z === hipZ) return m.top2;
  if (tf.sides2 && ax >= hw) return m.top2;
  if (tf.yoke && z >= shZ - 1) return R.pattern === 'twotone' ? m.top2 : m.topL;
  return patMat(x, y, z, isTop);
}
function paintTorso() {
  const { b, hipZ, shZ, tf, m, d } = R;
  for (let z = hipZ; z <= shZ; z++) {
    const isTop = z === shZ;
    const hw = isTop ? b.shw : (z <= hipZ + 1 ? b.waist : b.thw);
    for (let y = b.ty0; y <= b.ty1; y++) for (let x = CX - hw; x <= CX + hw; x++) {
      const ax = Math.abs(x - CX);
      if (isTop && ax > b.thw && (y < R.ay0 || y > R.ay0 + 1)) continue;
      const mm = torsoMat(x, y, z, y === b.ty1, y === b.ty0, isTop, hw);
      up(x, y, z, mm === null ? patMat(x, y, z, isTop) : mm);
    }
    if (b.belly && z >= hipZ + 1 && z <= hipZ + 2) for (let x = CX - 1; x <= CX + 1; x++) up(x, b.ty1 + 1, z, torsoMat(x, b.ty1 + 1, z, true, false, false, b.thw) || m.top);
  }
  // collar on neck slice
  if (tf.collar) {
    const cm = tf.collar === 2 ? m.white : (tf.open === 'shirt' ? m.inner : m.top);
    for (let y = 9; y <= 11; y++) { up(CX - 2, y, R.neckZ, cm); up(CX + 2, y, R.neckZ, cm); }
    if (d.top !== 'polo') { up(CX - 1, 11, R.neckZ, cm); up(CX + 1, 11, R.neckZ, cm); }
  } else if (tf.open === 'shirt') {
    for (let y = 9; y <= 11; y++) { up(CX - 2, y, R.neckZ, m.inner); up(CX + 2, y, R.neckZ, m.inner); }
  }
  if (tf.hood) box(CX - 2, CX + 2, b.ty0 - 1, b.ty0 - 1, shZ - 1, shZ + 1, m.top);
  if (tf.apron && d.top !== 'diner') { for (let z = R.kneeZ; z < hipZ; z++) for (let x = CX - 1; x <= CX + 1; x++) up(x, b.ty1, z, m.top2); }
  // overalls bib + straps
  if (d.bottom === 'overalls') {
    box(CX - 1, CX + 1, b.ty1, b.ty1, hipZ, shZ - 1, m.bot);
    for (let y = b.ty0; y <= b.ty1; y++) { up(CX - 2, y, shZ, m.bot); up(CX + 2, y, shZ, m.bot); }
    up(CX - 2, b.ty0, shZ - 1, m.bot); up(CX + 2, b.ty0, shZ - 1, m.bot);
    up(CX - 1, b.ty1, shZ - 1, m.metal); up(CX + 1, b.ty1, shZ - 1, m.metal);
  }
}
let SITTING = false;
function legMat(t) {
  const { d, m } = R;
  if (SITTING && (d.bottom === 'longskirt' || (d.bottom === 'skirt' && t < 0.55))) return m.bot;
  switch (d.bottom) {
    case 'shorts': return t < 0.42 ? m.bot : m.skin;
    case 'lycrashorts': return t < 0.5 ? m.bot : m.skin;
    case 'skirt': case 'longskirt': return m.skin;
    case 'sweatpants': return t > 0.85 ? m.botD : m.bot;
    case 'cargo': return t > 0.35 && t < 0.55 ? m.botD : m.bot;
    default: return m.bot;
  }
}
function paintLegs(legs) {
  const { b, d, m, hipZ } = R;
  // pelvis
  const pm = d.bottom === 'skirt' || d.bottom === 'longskirt' ? m.bot : m.bot;
  box(CX - b.waist, CX + b.waist, b.ty0 + (b.ty1 - b.ty0 > 2 ? 1 : 0), b.ty1, hipZ - 1 + ZO, hipZ - 1 + ZO, pm, put);
  for (const L of legs) {
    limb([L.h, L.k, L.a], b.legW, b.legD, 2, legMat, put);
    paintShoe(L);
  }
}
function paintShoe(L) {
  const { b, d, m } = R;
  const x0 = L.a[0], x1 = L.a[0] + b.legW - 1, y0 = L.a[1], z0 = Math.max(0, L.a[2] - 2);
  const s = d.shoes;
  const len = s === 'heels' ? 3 : s === 'cowboyboots' ? 5 : 4;
  for (let y = y0; y < y0 + len; y++) {
    put(x0, y, z0, m.sole); put(x1, y, z0, m.sole);
    if (b.legW === 3) put(x0 + 1, y, z0, m.sole);
    const um = s === 'sandals' && y > y0 + 1 ? m.skin : m.shoe;
    for (let x = x0; x <= x1; x++) put(x, y, z0 + 1, s === 'cowboyboots' && y === y0 + len - 1 && x !== x0 ? 0 : um);
  }
  if (s === 'heels') { put(x0, y0, z0, m.shoe); put(x1, y0, z0, m.shoe); }
  const covered = ['jeans', 'slacks', 'khakis', 'overalls', 'sweatpants', 'cargo'].includes(d.bottom) && !R.ex.has('tucked') && d.top !== 'turnout';
  const shaft = s === 'cowboyboots' ? (covered ? 1 : 3) : (s === 'boots' || s === 'workboots') ? (covered ? 0 : 2) : 0;
  for (let k = 0; k < shaft; k++) for (let y = y0; y < y0 + b.legD; y++) for (let x = x0; x <= x1; x++) put(x, y, z0 + 2 + k, m.shoe);
}
function paintSkirt() {
  const { b, d, m, hipZ, kneeZ } = R;
  if (d.bottom !== 'skirt' && d.bottom !== 'longskirt') return;
  const long = d.bottom === 'longskirt';
  const zb = long ? 1 : kneeZ;
  const dress = !!R.tf.skirt;
  for (let z = zb; z < hipZ; z++) {
    const flare = z <= zb + (long ? 3 : 1) ? 1 : 0;
    const hw = b.thw + flare;
    for (let y = b.ty0 - flare; y <= b.ty1 + flare; y++) for (let x = CX - hw; x <= CX + hw; x++) {
      if (flare && Math.abs(x - CX) === hw && (y === b.ty0 - flare || y === b.ty1 + flare)) continue;
      const mm = dress ? patMat(x, y, z, false) : m.bot;
      put(x, y, z + ZO, d.top === 'diner' && y >= b.ty1 && Math.abs(x - CX) <= 1 ? m.white : (dress && mm === m.top ? m.bot : mm));
    }
  }
}

// ---------------------------------------------------------------- arms
function paintArms(arms) {
  const { sl, m, ex, tf } = R;
  const hand = ex.has('gloves') ? m.glove : m.skin;
  const mat = (t, i) => {
    if (t >= 0.78) return hand;
    if (sl === 'long') return (t > 0.62 && tf.sleeves2) ? m.top : sleeveMat(i);
    if (sl === 'short') return t < 0.36 ? sleeveMat(i) : m.skin;
    return m.skin;
  };
  for (const A of arms) limb([A.s, A.e, A.h], 2, 2, 2, mat);
}

// ---------------------------------------------------------------- head, hair, face, hats
function inHead(dx, dy, L) {
  if (L === 0) return dx >= -1 && dx <= 1 && dy >= -1 && dy <= 2;
  return Math.abs(dx) <= 2 && Math.abs(dy) <= 2 && !(Math.abs(dx) === 2 && Math.abs(dy) === 2);
}
function hairCovers(style, dx, dy, L) {
  const adx = Math.abs(dx);
  const short = L === 3 || (L === 2 && (dy <= 0 || (adx === 2 && dy <= 1))) || (L === 1 && dy === -2);
  switch (style) {
    case 'bald': return false;
    case 'balding': return (L === 1 || L === 2) && (dy === -2 || (adx === 2 && dy <= 0));
    case 'buzz': return L === 3 || (L === 2 && (dy <= -1 || (adx === 2 && dy <= 0)));
    case 'mohawk': return (L === 3 && dx === 0) || (L === 2 && dy === -2 && adx === 0);
    case 'bob': case 'long': case 'braids': case 'locs': case 'bighair':
      return short || (L === 1 && (dy <= 0 || adx === 2)) || (L === 0 && dy <= 0);
    case 'afro': return !(dy === 2 && adx <= 1 && L <= 2) && !(L === 0 && dy >= 1);
    default: return short;
  }
}
function paintHead(P) {
  const { m, d, hz0, hTop, T, neckZ, hy } = R;
  // neck
  box(CX - 1, CX + 1, 9, 10, neckZ, neckZ, m.neck);
  const style = d.hair;
  const buzz = style === 'buzz' || style === 'mohawk';
  const hm = style === 'buzz' ? m.stubble : m.hair;
  for (let L = 0; L < 4; L++) {
    const z = hz0 + L;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (!inHead(dx, dy, L)) continue;
      let mm = hairCovers(style, dx, dy, L) ? hm : m.skin;
      if (style === 'mohawk' && L === 3 && dx !== 0) mm = m.stubble;
      up(CX + dx, CY + dy, z, mm);
    }
  }
  // face
  const eyeZ = hz0 + 2;
  if (d.accessory === 'sunglasses' || R.ex.has('sunglasses')) { for (let x = CX - 1; x <= CX + 1; x++) up(x, 12, eyeZ, m.lens); }
  else { up(CX - 1, 12, eyeZ, m.eye); up(CX + 1, 12, eyeZ, m.eye); }
  // facial hair
  const f = d.facial;
  if (f && f !== 'none') {
    const fm = f === 'stubble' ? m.stubble : m.hair;
    if (f === 'stache') { for (let x = CX - 1; x <= CX + 1; x++) up(x, 12, hz0 + 1, fm); }
    else if (f === 'goatee') { up(CX, 12, hz0, fm); up(CX - 1, 12, hz0, fm); up(CX + 1, 12, hz0 + 1, fm); up(CX - 1, 12, hz0 + 1, fm); box(CX - 1, CX, 11, 12, hz0 - 1, hz0 - 1, fm); }
    else {
      for (let dy = 0; dy <= 2; dy++) for (let dx = -1; dx <= 1; dx++) up(CX + dx, CY + dy, hz0, fm);
      up(CX - 1, 12, hz0 + 1, fm); up(CX + 1, 12, hz0 + 1, fm); up(CX, 12, hz0 + 1, f === 'stubble' ? m.mouth : fm);
      if (f === 'beard' || f === 'fullbeard') { box(CX - 1, CX + 1, 11, 12, hz0 - 1, hz0 - 1, fm); up(CX - 2, 10, hz0 + 1, fm); up(CX + 2, 10, hz0 + 1, fm); }
      if (f === 'fullbeard') { box(CX - 2, CX + 2, 11, 12, hz0 - 1, hz0 - 1, fm); box(CX - 1, CX + 1, 12, 12, hz0 - 2, hz0 - 2, fm); }
    }
  }
  // hair volumes
  const sway = P.sway || 0;
  switch (style) {
    case 'long': case 'bighair':
      box(CX - 2, CX + 2, hy, hy, R.shZ - 1, hz0 + 1, m.hair);
      box(CX - 2, CX + 2, hy + 1, hy + 1, R.shZ, R.shZ, m.hair);
      for (let y = 8; y <= 10; y++) { up(CX - 2, y, hz0, m.hair); up(CX + 2, y, hz0, m.hair); }
      if (style === 'bighair') {
        for (let z = hz0 + 1; z <= hTop; z++) disc(CX, CY - 0.3, 3.4, 3.2, z, z === hTop ? m.hairL : m.hair, (x, y, zz, mm) => { if (!(y >= 12 && Math.abs(x - CX) <= 1 && zz <= hz0 + 2)) up(x, y, zz, mm); });
        disc(CX, CY - 0.3, 2.6, 2.6, T, m.hairL); disc(CX, CY - 0.3, 1.5, 1.5, T + 1, m.hair);
      }
      break;
    case 'braids': case 'locs': {
      const wide = style === 'locs' ? 1 : 0;
      for (let z = (style === 'braids' ? R.hipZ + 1 : R.shZ - 2); z <= hz0 + 1; z++) for (let x = CX - 2 - wide; x <= CX + 2 + wide; x++) up(x + (z < R.shZ - 1 ? sway : 0), hy, z, ((x + (style === 'locs' ? z : 0)) & 1) ? m.hairD : m.hair);
      for (let y = 8; y <= 10; y++) { up(CX - 2, y, hz0, m.hairD); up(CX + 2, y, hz0, m.hairD); }
      box(CX - 2, CX + 2, hy + 1, hy + 1, R.shZ, R.shZ, m.hairD);
      break;
    }
    case 'ponytail': {
      const px = CX - 1 + sway;
      box(CX - 1, CX + 1, 7, 7, hz0 + 2, hz0 + 3, m.hair);
      box(px, px + 1, 6, 7, hz0 + 1, hz0 + 1, m.hair);
      box(px, px + 1, 6, 6, hz0 - 2, hz0, m.hair);
      up(px, 6, hz0 - 3, m.hairD); up(px + 1, 6, hz0 - 3, m.hairD);
      break;
    }
    case 'bun': box(CX - 1, CX + 1, 8, 10, T, T, m.hair); up(CX, 9, T + 1, m.hairL); break;
    case 'puffs': for (const sx of [-1, 1]) { disc(CX + sx * 2.5, 9.5, 1.6, 1.6, hTop, m.hair); disc(CX + sx * 2.5, 9.5, 1.6, 1.6, T, m.hairL); } break;
    case 'afro':
      for (let z = hz0 + 1; z <= hTop; z++) disc(CX, CY - 0.4, 3.3, 3.3, z, m.hair, (x, y, zz, mm) => { if (!(y >= 12 && Math.abs(x - CX) <= 1 && zz <= hz0 + 2)) up(x, y, zz, mm); });
      disc(CX, CY - 0.4, 2.5, 2.5, T, m.hair);
      break;
    case 'curly':
      disc(CX, CY - 0.4, 2.2, 2.2, T, m.hair, (x, y, z, mm) => up(x, y, z, ((x + y) & 1) ? m.hairL : mm));
      for (const [x, y] of [[CX - 3, 9], [CX + 3, 9], [CX - 3, 11], [CX + 3, 11], [CX - 1, 7], [CX + 1, 7]]) up(x, y, hTop - 1, m.hair);
      break;
    case 'spiky': for (const [x, y] of [[9, 9], [11, 9], [10, 10], [9, 11], [11, 11], [10, 8]]) up(x, y, T, m.hairL); break;
    case 'mohawk': box(CX, CX, 8, 12, T, T, m.hair); box(CX - 1, CX + 1, 9, 10, T, T, m.hair); box(CX, CX, 9, 10, T + 1, T + 1, m.hairL); break;
    case 'mullet': box(CX - 1, CX + 1, hy, hy, R.shZ, hz0 + 1, m.hair); break;
    default: break;
  }
  if (P.noHat) return;
  paintHat();
}
function paintHat() {
  const { m, d, hTop, T, hz0 } = R;
  const h = d.hat;
  if (!h || h === 'none') return;
  const headTop = (mm, L = 3) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inHead(dx, dy, L)) up(CX + dx, CY + dy, hz0 + L, mm); };
  const backSides = (mm, L = 2, front = 0) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inHead(dx, dy, L) && (dy <= front || (Math.abs(dx) === 2 && dy <= front + 1))) up(CX + dx, CY + dy, hz0 + L, mm); };
  switch (h) {
    case 'cowboy':
      disc(CX, CY, 4.6, 3.9, hTop, m.hat);
      for (const x of [CX - 4, CX + 4]) for (let y = CY - 1; y <= CY + 1; y++) up(x, y, T, m.hatL);
      disc(CX, CY - 0.2, 2.5, 2.5, T, m.hatD);
      disc(CX, CY - 0.2, 2.2, 2.6, T + 1, m.hat);
      up(CX, 9, T + 1, m.hatD); up(CX, 10, T + 1, m.hatD);
      break;
    case 'campaign':
      disc(CX, CY, 4.5, 4.5, hTop, m.hat);
      disc(CX, CY, 2.5, 2.5, T, m.hatD);
      box(CX - 1, CX + 1, CY - 1, CY + 1, T + 1, T + 1, m.hat);
      up(CX, CY, T + 1, m.hatL);
      break;
    case 'cap': case 'capback': case 'trucker': {
      const front = h === 'trucker' ? (d.hatColor === CLOTH.white ? m.hatD : M('#eeece6', GS.hat)) : m.hat;
      backSides(h === 'trucker' ? m.hatD : m.hat, 2);
      headTop(m.hat);
      if (h === 'trucker') for (let x = CX - 2; x <= CX + 2; x++) for (let y = 11; y <= 12; y++) if (inHead(x - CX, y - CY, 3)) up(x, y, hTop, front);
      box(CX - 1, CX + 1, 9, 11, T, T, m.hat);
      if (h === 'capback') { box(CX - 2, CX + 2, 7, 7, hTop, hTop, m.hatD); box(CX - 1, CX + 1, 6, 6, hTop, hTop, m.hatD); }
      else { box(CX - 2, CX + 2, 13, 13, hTop, hTop, m.hatD); box(CX - 1, CX + 1, 14, 14, hTop, hTop, m.hatD); }
      break;
    }
    case 'beanie':
      backSides(m.hatD, 2, 1);
      headTop(m.hat);
      disc(CX, CY - 0.2, 2.5, 2.5, T, m.hat);
      box(CX - 1, CX + 1, 9, 10, T + 1, T + 1, m.hatL);
      break;
    case 'skullcap': backSides(m.hat, 2, -1); headTop(m.hat); break;
    case 'bandana':
      backSides(m.hat, 2, 0); headTop(m.hat);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inHead(dx, dy, 3) && hash3(dx, dy, 3, 7) % 5 === 0) up(CX + dx, CY + dy, hTop, m.hatL);
      box(CX - 1, CX, 7, 7, hz0 + 1, hz0 + 2, m.hatD);
      break;
    case 'hardhat':
      disc(CX, CY, 3.5, 3.5, hTop, m.hat);
      disc(CX, CY, 2.5, 2.5, T, m.hat);
      box(CX - 1, CX + 1, 8, 12, T + 1, T + 1, m.hatL);
      break;
    case 'sunhat': case 'churchhat':
      disc(CX, CY, 4.5, 4.5, hTop, m.hat);
      disc(CX, CY, 2.5, 2.5, T, h === 'churchhat' ? m.hatD : m.hat);
      disc(CX, CY, 1.6, 1.6, T + 1, m.hat);
      if (h === 'churchhat') { up(CX + 2, 8, T, M(d.topColor2 || '#ffffff', GS.hat)); up(CX + 3, 9, T, M(d.topColor2 || '#ffffff', GS.hat)); }
      else box(CX - 2, CX + 2, CY + 2, CY + 2, T, T, m.hatD);
      break;
    case 'bucket':
      disc(CX, CY, 3.6, 3.6, hTop - 1, m.hat, up, 0.55);
      disc(CX, CY, 3.2, 3.2, hTop, m.hat);
      disc(CX, CY, 2.5, 2.5, T, m.hatL);
      break;
    case 'bikehelmet':
      backSides(m.hat, 2, 0);
      disc(CX, CY - 0.5, 3, 3.5, hTop, m.hat);
      disc(CX, CY - 0.5, 2.2, 3, T, m.hat);
      for (let y = 8; y <= 11; y += 2) up(CX, y, T, m.hatD);
      box(CX - 1, CX + 1, 13, 13, hTop, hTop, m.hatD);
      break;
    case 'helmet':
      disc(CX, CY - 0.3, 3.2, 3.2, hTop - 1, m.hat, (x, y, z, mm) => { if (!(y >= 12 && Math.abs(x - CX) <= 1)) up(x, y, z, mm); });
      disc(CX, CY - 0.3, 3.2, 3.2, hTop, m.hat);
      disc(CX, CY - 0.3, 2.5, 2.5, T, m.hat);
      disc(CX, CY - 0.3, 1.5, 1.5, T + 1, m.hatL);
      break;
    case 'police':
      headTop(m.black);
      disc(CX, CY, 3, 3, T, m.hat);
      up(CX, 12, T, m.gold); up(CX, 13, T, m.gold);
      box(CX - 1, CX + 1, 13, 13, hTop, hTop, m.black);
      break;
    case 'firehelmet':
      disc(CX, CY - 0.8, 3.6, 4.4, hTop, m.hat);
      disc(CX, CY, 2.5, 2.5, T, m.hat);
      box(CX, CX, 8, 12, T + 1, T + 1, m.hatL); box(CX - 1, CX + 1, 9, 11, T + 1, T + 1, m.hat);
      box(CX - 1, CX + 1, 13, 13, T, T, m.black);
      break;
    case 'toque':
      headTop(m.hat);
      disc(CX, CY, 2.6, 2.6, T, m.hat);
      disc(CX, CY, 3.1, 3.1, T + 1, m.hat);
      if (T + 2 < N) disc(CX, CY, 2.2, 2.2, T + 2, m.hatL);
      break;
    case 'visor':
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inHead(dx, dy, 3) && (Math.abs(dx) === 2 || Math.abs(dy) === 2)) up(CX + dx, CY + dy, hTop, m.hat);
      box(CX - 2, CX + 2, 13, 13, hTop, hTop, m.hat); box(CX - 1, CX + 1, 14, 14, hTop, hTop, m.hat);
      break;
    case 'fedora':
      disc(CX, CY, 3.6, 3.6, hTop, m.hat);
      disc(CX, CY, 2.5, 2.5, T, m.hatD);
      disc(CX, CY, 2, 2.4, T + 1, m.hat); up(CX, 10, T + 1, m.hatD);
      break;
    case 'beret':
      headTop(m.hat);
      disc(CX + 0.6, CY - 0.2, 3, 2.6, T, m.hat);
      break;
    default: break;
  }
}

// ---------------------------------------------------------------- accessories
function paintAccessories(P) {
  const { d, m, b, hipZ, shZ } = R;
  const a = d.accessory;
  const [h0, h1] = [P.arms[0].h, P.arms[1].h];
  const held = P.held, worn = P.worn;
  const bags = held || P.bags;
  switch (a) {
    case 'backpack': if (worn && !P.sit) {
      box(CX - 2, CX + 2, b.ty0 - 2, b.ty0 - 1, hipZ + 1, shZ - 1, m.acc);
      box(CX - 2, CX + 2, b.ty0 - 2, b.ty0 - 2, hipZ + 2, shZ - 2, m.accD);
      box(CX - 1, CX + 1, b.ty0 - 3, b.ty0 - 3, hipZ + 1, hipZ + 2, m.acc);
      for (let y = b.ty0; y <= b.ty1; y++) { up(CX - 2, y, shZ, m.accD); up(CX + 2, y, shZ, m.accD); }
      box(CX - 2, CX - 2, b.ty1, b.ty1, hipZ + 2, shZ - 1, m.accD); box(CX + 2, CX + 2, b.ty1, b.ty1, hipZ + 2, shZ - 1, m.accD);
    } break;
    case 'guitar': if (worn && !P.sit) {
      const y0 = b.ty0 - 2;
      box(CX - 3, CX, y0, y0 + 1, Math.max(0, hipZ - 4), hipZ + 1, m.acc);
      box(CX - 2, CX - 1, y0, y0, hipZ - 3, hipZ, m.accD);
      box(CX, CX + 1, y0, y0 + 1, hipZ + 2, shZ + 3, m.acc);
      box(CX, CX + 2, y0, y0 + 1, shZ + 4, shZ + 4, m.accD);
    } break;
    case 'camera': if (worn) { box(CX - 1, CX + 1, b.ty1 + 1, b.ty1 + 1, shZ - 3, shZ - 2, m.black); up(CX, b.ty1 + 2, shZ - 3, m.metal);
      for (let y = b.ty0; y <= b.ty1; y++) { up(CX - 2, y, shZ, m.black); } } break;
    case 'headphones': if (worn) { box(CX - 2, CX + 2, 9, 10, R.T, R.T, m.acc); box(CX - 3, CX - 3, 9, 10, R.hz0 + 2, R.hz0 + 2, m.accD); box(CX + 3, CX + 3, 9, 10, R.hz0 + 2, R.hz0 + 2, m.accD); } break;
    case 'lanyard': if (worn) { up(CX, b.ty1 + 1, shZ - 1, m.acc); up(CX, b.ty1 + 1, shZ - 2, m.acc); box(CX - 1, CX, b.ty1 + 1, b.ty1 + 1, shZ - 4, shZ - 3, m.white); } break;
    case 'toolbelt': if (worn) {
      for (let y = b.ty0; y <= b.ty1; y++) for (let x = CX - b.waist; x <= CX + b.waist; x++) if (y === b.ty0 || y === b.ty1 || Math.abs(x - CX) === b.waist) up(x, y, hipZ, m.acc);
      box(CX - 2, CX - 1, b.ty1 + 1, b.ty1 + 1, hipZ - 2, hipZ, m.accD); box(CX + 1, CX + 2, b.ty1 + 1, b.ty1 + 1, hipZ - 2, hipZ, m.accD);
    } break;
    case 'mailbag': if (worn) {
      box(CX + 1, CX + 3, b.ty1 + 1, b.ty1 + 2, hipZ - 2, hipZ, m.acc);
      for (let k = 0; k <= shZ - hipZ; k++) { up(CX + 2 - k, b.ty1, hipZ + k, m.accD); up(CX + 2 - k, b.ty0, hipZ + k, m.accD); }
    } break;
    case 'briefcase': case 'medbag': if (bags) {
      box(h0[0], h0[0] + 1, h0[1] - 1, h0[1] + 2, h0[2] - 3, h0[2] - 1, m.acc);
      if (a === 'medbag') { up(h0[0], h0[1] + 1, h0[2] - 1, m.white); up(h0[0] + 1, h0[1], h0[2] - 1, m.white); }
      else up(h0[0], h0[1] + 1, h0[2] - 1, m.metal);
    } break;
    case 'toolbox': case 'shopping': case 'bucket': if (bags) {
      const w = a === 'toolbox' ? 2 : 1;
      box(h0[0] - (w - 1), h0[0] + 1, h0[1] - 1, h0[1] + 1, h0[2] - 3, h0[2] - 1, m.acc);
      if (a === 'toolbox') box(h0[0] - 1, h0[0] + 1, h0[1], h0[1], h0[2] - 1, h0[2] - 1, m.metal);
      if (a === 'bucket') up(h0[0], h0[1], h0[2] - 1, m.accD);
    } break;
    case 'purse': if (bags) { box(h1[0], h1[0] + 1, h1[1] - 1, h1[1] + 1, h1[2] - 2, h1[2] - 1, m.acc); up(h1[0], h1[1], h1[2] - 1, m.gold); } break;
    case 'skateboard': if (held) { box(h0[0] - 2, h0[0] - 1, h0[1] - 3, h0[1] + 4, h0[2] - 1, h0[2], m.acc); put(h0[0] - 2, h0[1] - 2, h0[2] - 1 + ZO, m.metal); put(h0[0] - 2, h0[1] + 3, h0[2] - 1 + ZO, m.metal); } break;
    case 'cane': if (held) box(h0[0], h0[0] + 1, h0[1] + 2, h0[1] + 2, 0, h0[2] + 1, m.acc); break;
    case 'phone': if (held) { box(h0[0], h0[0] + 1, h0[1] + 2, h0[1] + 2, h0[2] + 1, h0[2] + 1, m.black); } break;
    case 'coffee': if (held) { box(h0[0], h0[0] + 1, h0[1] + 2, h0[1] + 3, h0[2] + 1, h0[2] + 2, m.white); up(h0[0], h0[1] + 2, h0[2] + 1, M('#8a5a30', GS.top)); } break;
    case 'carrybox': if (held) { box(CX - 2, CX + 2, b.ty1 + 1, b.ty1 + 3, h0[2], h0[2] + 2, m.acc); box(CX, CX, b.ty1 + 1, b.ty1 + 3, h0[2] + 2, h0[2] + 2, M('#d8c49a', GS.acc)); } break;
    default: break;
  }
}

// ---------------------------------------------------------------- poses
function legAt(side, fy, lift, fx = 0) {
  const lx = side < 0 ? CX - R.b.legW : CX + 1, ly = R.ly0;
  let ky = Math.round(fy * 0.5), kz = R.kneeZ;
  if (lift >= 2 && fy >= 0) { ky = fy + 1; kz = R.kneeZ + 2; }
  else if (lift >= 2) { ky = 1; kz = R.kneeZ; }
  else if (lift === 1) { ky += 1; kz += 1; }
  return { h: [lx, ly, R.hipZ - 1], k: [lx + Math.round(fx / 2), ly + ky, kz], a: [lx + fx, ly + fy, 2 + lift] };
}
function armAt(side, e, h) {
  const ax = side < 0 ? R.armXL : R.armXR;
  return { s: [ax, R.ay0, R.shZ - 1], e: [ax + e[0], R.ay0 + e[1], e[2]], h: [ax + h[0], R.ay0 + h[1], h[2]] };
}
const hang = (side, sw, rise = 0) => armAt(side, [0, Math.round(sw * 0.45), R.elbowZ], [side, sw, R.handZ + rise]);
// [foot0 dy, lift0, foot1 dy, lift1]; leg 0 / arm 0 are on the -x side (the character's RIGHT).
const WALK = [[2, 0, -2, 0], [1, 0, 0, 1], [-1, 0, 1, 1], [-2, 0, 2, 0], [0, 1, 1, 0], [1, 1, -1, 0]];
const RUN = [[3, 0, -3, 1], [1, 0, -2, 3], [-2, 0, 2, 2], [-3, 1, 3, 0], [-2, 3, 1, 0], [2, 2, -2, 0]];
const SWAY = [0, 1, 1, 0, -1, -1];

function withAccessoryArms(P) {
  const a = R.d.accessory;
  if (a === 'phone') P.arms[0] = armAt(-1, [0, 1, R.elbowZ], [2, 3, R.shZ - 3]);
  else if (a === 'coffee') P.arms[0] = armAt(-1, [0, 0, R.elbowZ], [1, 2, R.elbowZ]);
  else if (a === 'cane') P.arms[0] = armAt(-1, [0, 1, R.elbowZ], [-1, 1, R.handZ + 1]);
  else if (a === 'carrybox') P.arms = [armAt(-1, [0, 1, R.elbowZ], [1, 3, R.elbowZ]), armAt(1, [0, 1, R.elbowZ], [-1, 3, R.elbowZ])];
  return P;
}
function poseIdle() { return withAccessoryArms({ legs: [legAt(-1, 0, 0), legAt(1, 0, 0)], arms: [hang(-1, 0), hang(1, 0)], held: true, worn: true }); }
function poseWalk(i) {
  const [f0, l0, f1, l1] = WALK[i];
  return withAccessoryArms({ legs: [legAt(-1, f0, l0), legAt(1, f1, l1)], arms: [hang(-1, -f0, Math.abs(f0) >= 2 ? 1 : 0), hang(1, -f1, Math.abs(f1) >= 2 ? 1 : 0)],
    sway: SWAY[i], held: true, worn: true });
}
function poseRun(i) {
  const [f0, l0, f1, l1] = RUN[i];
  const ra = (s, sw) => armAt(s, [0, Math.round(sw * 0.6) - 1, R.shZ - 3], [0, Math.round(sw * 0.6) + 2, R.shZ - 2]);
  return { legs: [legAt(-1, f0, l0), legAt(1, f1, l1)], arms: [ra(-1, -f0), ra(1, -f1)], lean: 2, sway: SWAY[i], bags: true, worn: true };
}
function poseAim() {
  return { legs: [legAt(-1, -1, 0), legAt(1, 1, 0)], worn: true,
    arms: [armAt(-1, [1, 3, R.shZ - 1], [CX - 1 - R.armXL, 6, R.shZ - 1]), armAt(1, [-1, 3, R.shZ - 1], [CX - R.armXR, 6, R.shZ - 1])] };
}
function posePunch(i) {
  const guard = armAt(1, [0, 1, R.shZ - 3], [-1, 3, R.shZ - 2]);
  const legs = [legAt(-1, -1, 0), legAt(1, 1, 0)];
  if (i === 0) return { legs, worn: true, arms: [armAt(-1, [0, -1, R.shZ - 2], [1, 1, R.shZ - 2]), guard] };
  if (i === 1) return { legs, worn: true, lean: 1, arms: [armAt(-1, [1, 3, R.shZ - 1], [CX - 1 - R.armXL, 7, R.shZ - 1]), armAt(1, [0, 0, R.shZ - 3], [-1, 2, R.shZ - 2])] };
  return { legs, worn: true, arms: [armAt(-1, [0, 1, R.shZ - 2], [2, 4, R.shZ - 2]), guard] };
}
function poseDead() {
  return { legs: [legAt(-1, 0, 0, -1), legAt(1, 0, 0, 1)], noHat: true, worn: false, dead: true,
    arms: [armAt(-1, [-3, 0, R.shZ - 2], [-Math.min(6, R.armXL - 1), 0, R.shZ - 4]), armAt(1, [3, 0, R.shZ - 2], [Math.min(6, W - 3 - R.armXR), 0, R.shZ - 4])] };
}
function poseSit() {
  const seat = 4;
  const leg = (side) => { const lx = side < 0 ? CX - R.b.legW : CX + 1, ly = R.ly0; return { h: [lx, ly, seat - 1], k: [lx, ly + 5, seat - 1], a: [lx, ly + 6, 2] }; };
  return { legs: [leg(-1), leg(1)], zo: seat - R.hipZ, sit: true, worn: true,
    arms: [armAt(-1, [0, 2, R.shZ - 3], [1, 5, R.shZ - 3]), armAt(1, [0, 2, R.shZ - 3], [-1, 5, R.shZ - 3])] };
}

// ---------------------------------------------------------------- frame assembly
function layDown() {
  vol2.fill(0);
  const yOff = CY + Math.floor(R.T / 2), base = R.b.ty0;
  for (let z = 0; z < N; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = vol[z * WH + y * W + x];
    if (!v) continue;
    const ny = yOff - z, nz = Math.max(0, y - base);
    if (ny < 0 || ny >= H || nz >= N) continue;
    vol2[nz * WH + ny * W + x] = v;
  }
  vol.set(vol2);
}
function paint(P) {
  vol.fill(0);
  ZO = P.zo || 0; LEAN = P.lean || 0; SITTING = !!P.sit;
  paintLegs(P.legs);
  if (!P.sit) paintSkirt();
  paintTorso();
  paintArms(P.arms);
  paintHead(P);
  paintAccessories(P);
  ZO = 0; LEAN = 0; SITTING = false;
  if (P.dead) layDown();
}
function shadeInto(out, bounds) {
  for (let z = 0; z < N; z++) {
    const zb = z * WH, hasAbove = z + 1 < N;
    let left = W, right = -1, top = H, bottom = -1;
    for (let y = 0; y < H; y++) {
      const row = zb + y * W, o0 = (y * SW + z * W) * 4;
      for (let x = 0; x < W; x++) {
        const v = vol[row + x];
        if (!v) continue;
        if (bounds) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          bottom = y;
        }
        const a = hasAbove ? vol[row + x + WH] : 0;
        const t = a === 0 ? 2 : (grp[a] !== grp[v] ? 0 : 1);
        const p = v * 9 + t * 3, o = o0 + x * 4;
        out[o] = pal[p]; out[o + 1] = pal[p + 1]; out[o + 2] = pal[p + 2]; out[o + 3] = 255;
      }
    }
    if (bounds && right >= left) {
      const b = z * 4;
      bounds[b] = left; bounds[b + 1] = top;
      bounds[b + 2] = right - left + 1; bounds[b + 3] = bottom - top + 1;
    }
  }
}

function paintFrame(pose, bounds) {
  paint(pose);
  const out = new Uint8ClampedArray(SW * H * 4);
  shadeInto(out, bounds);
  return out;
}

/** Raw RGBA strips (Uint8ClampedArray, (w*count) × h) — usable in workers / Node. Same layout as buildPedSprites. */
export function buildPedFrameData(i) {
  const d = getPedModel(i);
  R = resolve(d);
  CLIPPED = 0;
  try {
    const mk = paintFrame;
    const frames = {
      idle: mk(poseIdle()),
      walk: [0, 1, 2, 3, 4, 5].map((k) => mk(poseWalk(k))),
      run: [0, 1, 2, 3, 4, 5].map((k) => mk(poseRun(k))),
      aim: mk(poseAim()),
      punch: [0, 1, 2].map((k) => mk(posePunch(k))),
      dead: mk(poseDead()),
      sit: mk(poseSit()),
    };
    return { w: W, h: H, count: N, frames, colors: pedColors(d), clipped: CLIPPED };
  } finally { R = null; }
}
function pedColors(d) {
  return { shirt: d.topColor, skin: SKIN_TONES[d.skin].mid, hair: d.hairColor, pants: d.bottomColor, hat: d.hat === 'none' ? null : d.hatColor, shoes: d.shoeColor };
}
function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
function toStrip(data) {
  const c = makeCanvas(SW, H);
  c.getContext('2d').putImageData(new ImageData(data, SW, H), 0, 0);
  return c;
}

// NPCs often stay in vehicles or leave the camera without using most poses.
// Materialize a strip on first use, with the same frame layout as the gallery.
export function lazyPedSprites(i) {
  const model = getPedModel(i);
  const frames = { walk: new Array(WALK.length), run: new Array(RUN.length), punch: new Array(3) };
  function defer(target, key, pose, step) {
    Object.defineProperty(target, key, { enumerable: true, configurable: true, get() {
      R = resolve(model);
      try {
        const bounds = new Uint8Array(N * 4);
        const value = toStrip(paintFrame(pose(step), bounds));
        setSliceBounds(value, bounds);
        Object.defineProperty(target, key, { enumerable: true, value });
        return value;
      } finally { R = null; }
    } });
  }
  for (const [name, pose] of Object.entries({ idle: poseIdle, aim: poseAim, dead: poseDead, sit: poseSit }))
    defer(frames, name, pose);
  for (const [name, pose] of Object.entries({ walk: poseWalk, run: poseRun, punch: posePunch }))
    for (let k = 0; k < frames[name].length; k++) defer(frames[name], k, pose, k);
  return { w: W, h: H, count: N, frames, colors: pedColors(model) };
}
/**
 * Build every animation frame of model i as slice strips.
 * -> { w, h, count, frames: { idle, walk[6], run[6], aim, punch[3], dead, sit }, colors: { shirt, skin, hair, pants, hat, shoes } }
 * Pure & deterministic: cache the result per model index.
 */
export function buildPedSprites(i) {
  const raw = buildPedFrameData(i);
  const f = raw.frames;
  return {
    w: raw.w, h: raw.h, count: raw.count, colors: raw.colors,
    frames: { idle: toStrip(f.idle), walk: f.walk.map(toStrip), run: f.run.map(toStrip), aim: toStrip(f.aim), punch: f.punch.map(toStrip), dead: toStrip(f.dead), sit: toStrip(f.sit) },
  };
}
