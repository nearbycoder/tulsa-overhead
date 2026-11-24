// Weapon definitions. dmg per hit; rate = shots/sec; spread radians; range metres.
export const WEAPONS = {
  fists:    { id: 'fists', name: 'Fists', type: 'melee', dmg: 9, rate: 2.6, range: 1.3, arc: 1.2, sound: 'punch', hitSound: 'punch_hit', slot: 0 },
  bat:      { id: 'bat', name: 'Ash Bat', type: 'melee', dmg: 24, rate: 1.6, range: 1.7, arc: 1.4, sound: 'melee_swing', hitSound: 'bat_hit', slot: 1, price: 50 },
  knife:    { id: 'knife', name: 'Bowie Knife', type: 'melee', dmg: 32, rate: 2.0, range: 1.25, arc: 1.0, sound: 'melee_swing', hitSound: 'knife_stab', slot: 1, price: 80 },
  pistol:   { id: 'pistol', name: '9mm Pistol', type: 'gun', dmg: 22, rate: 3.6, spread: 0.035, range: 60, clip: 15, maxAmmo: 300, reload: 1.1, sound: 'pistol', slot: 2, price: 400, ammoPrice: 60, tracer: '#ffe9a8' },
  revolver: { id: 'revolver', name: '.44 Revolver', type: 'gun', dmg: 58, rate: 1.25, spread: 0.018, range: 80, clip: 6, maxAmmo: 120, reload: 2.0, sound: 'revolver', slot: 2, price: 900, ammoPrice: 80, tracer: '#fff2c0', knock: 3 },
  smg:      { id: 'smg', name: 'Micro SMG', type: 'gun', dmg: 14, rate: 12, spread: 0.085, range: 45, clip: 32, maxAmmo: 600, reload: 1.4, sound: 'smg', slot: 3, price: 1500, ammoPrice: 120, tracer: '#ffd27a', driveBy: true },
  shotgun:  { id: 'shotgun', name: 'Pump Shotgun', type: 'gun', dmg: 13, pellets: 8, rate: 1.1, spread: 0.2, range: 26, clip: 8, maxAmmo: 120, reload: 2.4, sound: 'shotgun', slot: 4, price: 1200, ammoPrice: 90, tracer: '#ffcf8a', knock: 6 },
  rifle:    { id: 'rifle', name: 'Assault Rifle', type: 'gun', dmg: 27, rate: 9, spread: 0.045, range: 85, clip: 30, maxAmmo: 450, reload: 1.8, sound: 'rifle', slot: 5, price: 3500, ammoPrice: 200, tracer: '#ffe08a' },
  sniper:   { id: 'sniper', name: 'Deer Rifle', type: 'gun', dmg: 120, rate: 0.7, spread: 0.002, range: 170, clip: 5, maxAmmo: 60, reload: 2.6, sound: 'sniper', slot: 6, price: 4500, ammoPrice: 150, tracer: '#ffffff', knock: 4 },
  minigun:  { id: 'minigun', name: 'Gatling Gun', type: 'gun', dmg: 18, rate: 22, spread: 0.11, range: 70, clip: 500, maxAmmo: 1500, reload: 3, sound: 'minigun_shot', slot: 7, price: 25000, ammoPrice: 800, tracer: '#ffb85a', spinUp: 0.5 },
  rocket:   { id: 'rocket', name: 'Rocket Launcher', type: 'projectile', proj: 'rocket', dmg: 220, radius: 7.5, rate: 0.8, speed: 55, range: 120, clip: 1, maxAmmo: 20, reload: 1.6, sound: 'rocket_launch', slot: 8, price: 12000, ammoPrice: 1500 },
  grenade:  { id: 'grenade', name: 'Grenades', type: 'throw', proj: 'grenade', dmg: 160, radius: 6.5, rate: 1.0, speed: 17, fuse: 2.4, clip: 1, maxAmmo: 25, sound: 'grenade_throw', slot: 9, price: 300, ammoPrice: 300 },
  molotov:  { id: 'molotov', name: 'Molotov', type: 'throw', proj: 'molotov', dmg: 40, radius: 4.5, rate: 1.0, speed: 15, clip: 1, maxAmmo: 25, sound: 'molotov_throw', slot: 9, price: 200, ammoPrice: 200 },
  flamer:   { id: 'flamer', name: 'Flamethrower', type: 'flame', dmg: 90, rate: 20, spread: 0.25, range: 11, clip: 400, maxAmmo: 1200, reload: 2, sound: null, slot: 10, price: 8000, ammoPrice: 600 },
  taser:    { id: 'taser', name: 'Taser', type: 'gun', dmg: 4, stun: 3.5, rate: 0.8, spread: 0.01, range: 9, clip: 1, maxAmmo: 40, reload: 1.5, sound: 'taser', slot: 2, tracer: '#9fd4ff' },
};
export const WEAPON_ORDER = ['fists', 'bat', 'knife', 'pistol', 'revolver', 'smg', 'shotgun', 'rifle', 'sniper', 'minigun', 'rocket', 'grenade', 'molotov', 'flamer'];
