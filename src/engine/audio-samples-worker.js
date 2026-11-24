import { synthesizeSamples } from './audio.js';

self.onmessage = ({ data: { kind, name, key } }) => {
  try {
    const samples = synthesizeSamples(kind, name);
    self.postMessage({ key, samples }, samples.flatMap(s => s.channels.map(c => c.buffer)));
  } catch (error) {
    self.postMessage({ key, error: error.message });
  }
};
