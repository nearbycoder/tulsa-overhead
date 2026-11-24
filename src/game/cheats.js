// Classic typed cheat codes (type them while playing).
import { Vehicle } from '../entities/vehicle.js';
import { WEAPON_ORDER, WEAPONS } from '../data/weapons.js';

export const CHEATS = {
  OKIEARSENAL: 'All weapons + ammo',
  SOONERSTATE: 'Full health and armor',
  LOSETHEBADGE: 'Clear wanted level',
  BRINGTHEHEAT: '+2 wanted stars',
  OILMONEY: '+$250,000',
  MOTHERROAD: 'Spawn a Route 66 classic',
  REDDIRTRIDE: 'Spawn a lifted mud truck',
  WHIRLYBIRD: 'Spawn a news helicopter',
  TWISTER: 'Summon a tornado',
  STORMCHASER: 'Thunderstorm',
  BLUESKIES: 'Clear weather',
  MIDNIGHTOIL: 'Jump to midnight',
  SUNRISE: 'Jump to morning',
};

export class Cheats {
  constructor(game) {
    this.game = game;
    this.buf = '';
    this.onKey = (e) => {
      if (!/^Key[A-Z]$/.test(e.code) || game.paused) return;
      this.buf = (this.buf + e.code.slice(3)).slice(-16);
      for (const code of Object.keys(CHEATS)) if (this.buf.endsWith(code)) { this.buf = ''; this.apply(code); }
    };
    window.addEventListener('keydown', this.onKey);
  }
  destroy() { window.removeEventListener('keydown', this.onKey); }
  spawnCar(id) {
    const g = this.game, pl = g.player, m = g.assets.vehicle(id);
    if (!m) return;
    const h = pl.ped.h;
    const v = new Vehicle(g, m, pl.x + Math.cos(h) * 6, pl.y + Math.sin(h) * 6, h, m.paint && m.paint.length ? g.assets.randomPaint(Math.random) : -1);
    v.parked = true; v.persist = true;
    g.addVehicle(v);
  }
  apply(code) {
    const g = this.game, p = g.player.ped;
    switch (code) {
      case 'OKIEARSENAL': for (const id of WEAPON_ORDER) if (id !== 'fists') p.give(id, WEAPONS[id].maxAmmo || 50); break;
      case 'SOONERSTATE': p.health = p.maxHealth; p.armor = 100; break;
      case 'LOSETHEBADGE': g.police.setLevel(0); g.police.clearUnits(true); break;
      case 'BRINGTHEHEAT': g.police.setLevel(Math.min(6, g.police.level + 2)); break;
      case 'OILMONEY': g.player.addMoney(250000); break;
      case 'MOTHERROAD': this.spawnCar('motherroad_jetfin'); break;
      case 'REDDIRTRIDE': this.spawnCar('redfork_mudbogger'); break;
      case 'WHIRLYBIRD': this.spawnCar('tallgrass_skywatch'); break;
      case 'TWISTER': g.tornado.spawn(true); break;
      case 'STORMCHASER': g.weather.target = 1; g.weather.t = 300; break;
      case 'BLUESKIES': g.weather.target = 0; g.weather.rain = 0; g.weather.t = 300; break;
      case 'MIDNIGHTOIL': g.clock = 0; break;
      case 'SUNRISE': g.clock = 7 * 60; break;
    }
    g.audio.play('pickup');
    g.hud.message(`Cheat activated: ${CHEATS[code]}`, 3);
    g.player.stats.cheated = true;
  }
}
