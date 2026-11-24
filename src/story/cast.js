// Story cast. `voice` is the Qwen3-TTS VoiceDesign description used to create each character's reference voice.
// `model` is a pedestrian model (SPECIAL key from src/data/peds.js, or an index).
export const CAST = {
  polly:    { name: 'Polly', color: '#f2b233', model: 'player', voice: 'A woman in her early thirties with a low, warm alto voice, wry and confident, a light Oklahoma drawl, speaks plainly and a little tired, dry humor.' },
  june:     { name: 'Mama June', color: '#e07a9a', model: 'mamajune', voice: 'An older woman in her sixties with a raspy smoker voice, strong Oklahoma country accent, sharp and motherly but dangerous, slow deliberate delivery.' },
  dewey:    { name: 'Dewey', color: '#7ec8e3', model: 'dewey', voice: 'Male, mid twenties. A nervous lanky young man with a low baritone voice, talks fast and jittery, thick rural Oklahoma twang, eager to please.' },
  whitlock: { name: 'Whitlock Bellwether', color: '#e8e0c0', model: 'whitlock', voice: 'A wealthy older Southern gentleman in his seventies, deep smooth baritone, honeyed and unhurried, polite menace, old oil money.' },
  corrigan: { name: 'Det. Corrigan', color: '#9aa4b0', model: 'corrigan', voice: 'A tired middle-aged police detective in his fifties, gravelly low voice, cynical, clipped sentences, mild Oklahoma accent.' },
  tess:     { name: 'Tess Okafor', color: '#e8b030', model: 'tess', voice: 'A sharp investigative journalist woman in her thirties, clear articulate mid-range voice, quick and determined, neutral American accent.' },
  carl:     { name: 'Catfish Carl', color: '#6fae5f', model: 'catfish', voice: 'Male, fifties. A big burly bearded man with a deep booming bass voice, low and chesty, jovial river-rat drawl, chuckles easily, rough around the edges.' },
  rhonda:   { name: 'Rhonda Vance', color: '#ff8fb0', model: 'rhonda', voice: 'A brassy older diner owner woman in her late fifties, low husky smoky alto, big Southern Oklahoma twang, loud, sassy and warm, calls people honey.' },
  brock:    { name: 'Brock Tolliver', color: '#6a8cff', model: 'brock', voice: 'A slick real estate developer man in his forties, polished salesman voice, smug and fast, corporate charm, slight condescension.' },
  lucky:    { name: 'Lucky Ortega', color: '#ff6a3a', model: 'lucky', voice: 'A cocky charming man in his thirties, smooth medium voice with a playful smirk, quick wit, hint of regret underneath, Oklahoma accent.' },
  nadine:   { name: 'Ranger Nadine Rowe', color: '#8fd08f', model: 'nadine', voice: 'A calm steady park ranger woman in her late forties, deep weathered contralto with a little gravel, slow and measured, dry and practical, rural Oklahoma accent.' },
  dispatch: { name: 'Police Dispatch', color: '#8fb6ff', model: 'cop', voice: 'A female police dispatcher in her thirties, flat neutral Midwestern accent, crisp clipped monotone, fast and emotionless, slightly nasal, all business.' },
  thug:     { name: 'Syndicate Heavy', color: '#c0a070', model: null, voice: 'A rough menacing man in his thirties, low gravelly voice, threatening, Oklahoma accent.' },
  dj:       { name: 'Radio DJ', color: '#f0a0ff', model: null, voice: 'Male, forties. An energetic late night radio DJ with a deep smooth baritone announcer voice, booming and resonant, upbeat and theatrical.' },
  dj_f:     { name: 'Radio DJ', color: '#f0a0ff', model: null, voice: 'A warm, playful female country radio DJ in her forties, bright smiling voice, smooth Oklahoma twang, relaxed late-night delivery.' },
};
