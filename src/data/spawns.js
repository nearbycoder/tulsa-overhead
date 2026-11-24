// Fixed spawn spots for special vehicles, so every kind of ride can be found in the world.
// kind: 'water' snaps to open water nearby; otherwise snaps to the nearest road/lot.
export const SPECIAL_SPAWNS = [
  // helicopters
  { model: 'tallgrass_skywatch', lat: 36.0405, lon: -95.9850, label: 'Riverside Airport' },
  { model: 'tallgrass_skywatch', lat: 36.1895, lon: -95.8935, label: 'Tulsa International' },
  { model: 'tallgrass_skywatch', lat: 36.1710, lon: -95.7330, label: "Molly's Landing" },
  // boats
  { model: 'jenks_lunker', lat: 36.0230, lon: -95.9645, water: true, label: 'Jenks Riverwalk' },
  { model: 'jenks_skimmer', lat: 36.1330, lon: -95.9925, water: true, label: 'Zink Lake' },
  { model: 'jenks_sunsetter', lat: 36.1600, lon: -96.2600, water: true, label: 'Keystone Lake' },
  { model: 'jenks_lunker', lat: 36.3520, lon: -96.1520, water: true, label: 'Skiatook Lake' },
  { model: 'jenks_skimmer', lat: 36.2340, lon: -95.7330, water: true, label: 'Port of Catoosa' },
  { model: 'jenks_sunsetter', lat: 36.4450, lon: -95.6620, water: true, label: 'Oologah Lake' },
  { model: 'jenks_lunker', lat: 35.9620, lon: -95.8780, water: true, label: 'Bixby river bend' },
  // farm & off-road
  { model: 'panhandle_reaper', lat: 35.9300, lon: -95.8650, label: 'Bixby farmland' },
  { model: 'panhandle_sodbuster', lat: 35.9650, lon: -96.0420, label: 'Glenpool fields' },
  { model: 'panhandle_sodbuster', lat: 35.9600, lon: -95.6850, label: 'Coweta farms' },
  { model: 'bermuda_lawnpro', lat: 36.1300, lon: -95.9745, label: 'Woodward Park' },
  { model: 'bermuda_lawnpro', lat: 36.0530, lon: -95.7950, label: 'Broken Arrow' },
  { model: 'kiamichi_mudlark', lat: 36.0700, lon: -95.9935, label: 'Turkey Mountain' },
  { model: 'kiamichi_brushbuster', lat: 36.0745, lon: -95.9980, label: 'Turkey Mountain' },
  { model: 'kiamichi_ridgerunner', lat: 36.1500, lon: -96.2450, label: 'Keystone' },
  { model: 'scissortail_talon', lat: 36.1280, lon: -96.1180, label: 'Sand Springs BMX' },
  { model: 'redfork_mudbogger', lat: 36.3400, lon: -96.0500, label: 'Osage backroads' },
  // bikes
  { model: 'sandhill_velo', lat: 36.1210, lon: -95.9850, label: 'Gathering Place' },
  { model: 'sandhill_kicker', lat: 36.1150, lon: -95.9830, label: 'River Parks' },
  { model: 'sandhill_boardwalk', lat: 36.0540, lon: -95.7900, label: 'Rose District' },
  { model: 'zipline_scoot', lat: 36.1560, lon: -95.9880, label: 'Downtown' },
  // golf carts
  { model: 'ozark_putt', lat: 36.0728, lon: -95.9497, label: 'Southern Hills' },
  { model: 'ozark_putt', lat: 36.0844, lon: -95.7656, label: 'BA Golf & Athletic' },
  // high-end
  { model: 'keystone_rapier', lat: 36.0385, lon: -95.9590, label: 'River Spirit lot' },
  { model: 'derecho_anvil', lat: 36.1795, lon: -95.7470, label: 'Hard Rock lot' },
  { model: 'keystone_regalia', lat: 36.1503, lon: -95.9935, label: 'Mayo Hotel' },
  { model: 'keystone_sovereign', lat: 36.1361, lon: -95.9604, label: 'Utica Square' },
  { model: 'motherroad_jetfin', lat: 35.9926, lon: -96.1063, label: 'Sapulpa Route 66' },
  { model: 'motherroad_jetfin', lat: 36.1478, lon: -95.9740, label: "Buck Atom's" },
  { model: 'arkvalley_sundae', lat: 36.1196, lon: -95.9856, label: 'Gathering Place' },
  { model: 'heartland_scholar', lat: 36.0520, lon: -95.7700, label: 'Broken Arrow schools' },
  { model: 'sooner_longhaul', lat: 36.1600, lon: -95.8700, label: 'I-44 truck stop' },
  { model: 'heartland_aerial', lat: 36.1540, lon: -95.9960, label: 'Downtown fire station' },
  { model: 'arkvalley_medic', lat: 36.1460, lon: -95.9700, label: 'Hillcrest ER' },
];
