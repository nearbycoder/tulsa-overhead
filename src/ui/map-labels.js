// Place names and street labels share a collision check across tile boundaries.
export function drawMapLabels(view, ctx, width, height, mpp, toScreen, blips) {
  const d = view.dpr,
    g = view.g,
    used = [],
    repeats = new Map();
  for (const point of [g.player, ...blips]) {
    const [x, y] = toScreen(point.x, point.y);
    const r = (point === g.player ? 13 : (point.size || 5) * 2) * d;
    if (x+r >= 0 && y+r >= 0 && x-r <= width && y-r <= height) used.push([x-r, y-r, x+r, y+r]);
  }
  const accept = (x, y, w, h) => {
    const box = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
    if (box[0] < 0 || box[1] < 0 || box[2] > width || box[3] > height) return false;
    if (used.some((b) => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1])) return false;
    used.push(box);
    return true;
  };
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const label = (text, x, y, size, bold, ink, outline) => {
    if (x < 0 || y < 0 || x > width || y > height) return;
    ctx.font = `${bold ? 'bold ' : ''}${Math.round(size * d)}px "Trebuchet MS",sans-serif`;
    const w = ctx.measureText(text).width + 10 * d;
    x = Math.max(w / 2, Math.min(width - w / 2, x));
    if (!accept(x, y, w, (size + 5) * d)) return false;
    ctx.lineWidth = 3.2 * d;
    ctx.strokeStyle = outline;
    ctx.fillStyle = ink;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    return true;
  };
  if (g.waypointLabel && g.waypoint) {
    const [x, y] = toScreen(...g.waypoint);
    label(g.waypointLabel, x, y - 22 * d, 14, true, '#55224c', '#fff6ed');
  }
  view.townLabels ??= [...g.world.places]
    .filter((p) => p.t !== 'county')
    .sort((a, b) => (b.p || 0) - (a.p || 0) || a.n.localeCompare(b.n));
  for (const p of view.townLabels) {
    const town = p.t === 'city' || p.t === 'town' || p.t === 'village';
    if (view.mpp > (town ? 400 : p.t === 'neighbourhood' ? 4 : 10)) continue;
    if (view.mpp > 55 && (p.p || 0) < view.mpp * 23) continue;
    const [x, y] = toScreen(p.x, p.y);
    const size = town ? (p.t === 'city' ? 17 : 14) : 12;
    const placed = label(p.n, x, y, size, town, '#243a30', '#fff8e6');
    if (!placed && town) label(p.n, x, y + (size + 7) * d, size, true, '#243a30', '#fff8e6');
  }
  if (view.mpp < 34)
    for (const p of Object.values(g.places)) {
      const [x, y] = toScreen(p.x, p.y);
      if (x < 0 || y < 0 || x > width || y > height) continue;
      ctx.beginPath();
      ctx.arc(x, y, 2.7 * d, 0, Math.PI * 2);
      ctx.fillStyle = '#905817';
      ctx.fill();
      ctx.lineWidth = 1.2 * d;
      ctx.strokeStyle = '#fff4d6';
      ctx.stroke();
      if (view.mpp < 7) label(p.name, x, y - 10 * d, 12, true, '#6c4a21', '#fff5de');
    }
  if (view.mpp <= 4) {
    const anchors = [];
    for (const key of view.detailWanted) {
      const labels = view.detailTiles.get(key)?.labels;
      if (labels)
        for (const p of labels) {
          if (view.mpp > 2.5 && p.kind > 4) continue;
          const [x, y] = toScreen(p.x, p.y);
          if (x >= 0 && y >= 0 && x < width && y < height) anchors.push({ p, x, y });
        }
    }
    anchors.sort((a, b) => a.p.kind - b.p.kind || b.p.length - a.p.length || a.x - b.x || a.y - b.y);
    ctx.font = `${Math.round(11 * d)}px "Trebuchet MS",sans-serif`;
    for (const { p, x, y } of anchors) {
      const name = g.world.names[p.name];
      if (!name || repeats.get(name)?.some((q) => Math.hypot(q[0] - x, q[1] - y) < 310 * d)) continue;
      const text = shortStreet(name),
        w = ctx.measureText(text).width,
        h = 13 * d;
      if (w * 0.85 > p.length / mpp) continue;
      const ac = Math.abs(Math.cos(p.angle)),
        as = Math.abs(Math.sin(p.angle));
      if (!accept(x, y, ac * w + as * h + 8 * d, as * w + ac * h + 4 * d)) continue;
      if (!repeats.has(name)) repeats.set(name, []);
      repeats.get(name).push([x, y]);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.angle);
      ctx.lineWidth = 3 * d;
      ctx.strokeStyle = '#fff9eb';
      ctx.fillStyle = '#3c4941';
      ctx.strokeText(text, 0, 0);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
}

const streetWords = {
  North: 'N',
  South: 'S',
  East: 'E',
  West: 'W',
  Street: 'St',
  Avenue: 'Ave',
  Road: 'Rd',
  Drive: 'Dr',
  Boulevard: 'Blvd',
  Highway: 'Hwy',
  Expressway: 'Expy',
  Place: 'Pl',
  Court: 'Ct',
  Lane: 'Ln',
  Circle: 'Cir'
};
function shortStreet(name) {
  return name.replace(
    /\b(North|South|East|West|Street|Avenue|Road|Drive|Boulevard|Highway|Expressway|Place|Court|Lane|Circle)\b/g,
    (word) => streetWords[word]
  );
}
