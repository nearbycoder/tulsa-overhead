import { RouteGraph } from './route-graph.js';

const graphs = new Map();
let latest;
async function load(base, mode) {
  const res = await fetch(base + (mode === 'walk' ? '/walking.bin.gz' : '/navigation.bin.gz'));
  if (!res.ok) throw Error('Navigation data unavailable');
  let data = await res.arrayBuffer();
  if (new DataView(data).getUint16(0) === 0x1f8b) {
    data = await new Response(
      new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))
    ).arrayBuffer();
  }
  return new RouteGraph(data, mode);
}
self.onmessage = async ({ data }) => {
  latest = data.id;
  try {
    if (!graphs.has(data.mode)) graphs.set(data.mode, load(data.base, data.mode));
    const ready = await graphs.get(data.mode);
    if (latest !== data.id) return;
    const route = ready.solve(...data.coords, data.heading);
    self.postMessage({ id: data.id, route }, route ? [route.points.buffer] : []);
  } catch {
    graphs.delete(data.mode);
    self.postMessage({ id: data.id, unavailable: true });
  }
};
