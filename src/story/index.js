// Story aggregator. Each chapter module exports PLACES, LINES and MISSIONS.
import { CAST } from './cast.js';
import { CHAPTERS } from './chapters.js';
import * as ch1 from './ch1.js';

// later chapters are optional during development: load whichever exist
const optional = ['./ch2.js', './ch3.js', './ch4.js', './ch5.js', './ch6.js', './ch7.js', './ch8.js'];

export async function loadStory() {
  const chapters = await Promise.all(optional.map(async path => {
    try { return await import(path); }
    catch (e) {
      if (!/Failed to fetch|Importing a module script failed|404|Cannot find module|ERR_MODULE_NOT_FOUND/i.test(String(e?.message || e))) {
        console.error('story module error', path, e);
      }
      return null;
    }
  }));
  const STORY_PLACES = {}, LINES = {}, MISSIONS = {};
  for (const m of [ch1, ...chapters]) {
    if (!m) continue;
    Object.assign(STORY_PLACES, m.PLACES || {});
    Object.assign(LINES, m.LINES || {});
    Object.assign(MISSIONS, m.MISSIONS || {});
  }
  return { CAST, CHAPTERS, STORY_PLACES, LINES, MISSIONS };
}
