export async function fetchJsonGz(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  let text;
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(ds).text();
  } else {
    text = new TextDecoder().decode(buf);
  }
  return JSON.parse(text);
}

// A chunk covers multiple regions. Share its fetch across concurrent region loads.
const streetChunks = new Map();
export function streetData(base, rx, ry, chunkSize) {
  if (!chunkSize) return null;
  const url = `${base}/streets/${Math.floor(rx / chunkSize)}_${Math.floor(ry / chunkSize)}.json.gz`;
  let chunk = streetChunks.get(url);
  if (!chunk) {
    chunk = fetchJsonGz(url)
      .then((data) => {
        if (!data) throw Error(`Missing street geometry: ${url}`);
        return data;
      })
      .catch((err) => {
        streetChunks.delete(url);
        throw err;
      });
  } else streetChunks.delete(url);
  streetChunks.set(url, chunk);
  if (streetChunks.size > 6) streetChunks.delete(streetChunks.keys().next().value);
  return chunk.then((data) => data[`${rx},${ry}`]);
}
