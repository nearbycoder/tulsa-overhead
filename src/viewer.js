// Standalone terrain viewer used for map inspection.
import { World } from './world/world.js';
import { Camera } from './engine/camera.js';
import { Renderer } from './engine/renderer.js';
import { settings } from './engine/settings.js';
import { input } from './engine/input.js';

const params = new URLSearchParams(location.search);
const bootMsg = (m) => { const el = document.getElementById('boot-msg'); if (el) el.textContent = m; };
export async function viewer() {
  const world = new World('assets/map');
  await world.init();
  const cam = new Camera();
  const canvas = document.getElementById('game');
  const r = new Renderer(canvas, world, cam);
  input.attach(canvas);
  let x = 0, y = 0;
  if (params.get('at')) { const [la, lo] = params.get('at').split(',').map(Number); [x, y] = world.project(la, lo); }
  if (params.get('x')) { x = +params.get('x'); y = +params.get('y'); }
  if (params.get('view')) cam.viewH = cam.targetViewH = +params.get('view');
  if (params.has('res')) {
    settings.v.resolutionMode = 'scaled';
    settings.v.resolutionScale = +params.get('res');
  }
  if (params.get('night')) r.night = +params.get('night');
  cam.x = x; cam.y = y; r.resize();
  bootMsg('Loading regions…');
  await world.update(x, y);
  document.getElementById('boot').classList.add('hidden');
  let last = performance.now();
  const game = { loading: true };
  const frame = (t) => {
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    const ax = input.moveAxis();
    const sp = input.isDown('sprint') ? 120 : 30;
    cam.x += ax.x * sp * dt; cam.y += ax.y * sp * dt;
    if (input.mouse.wheel) cam.viewH *= input.mouse.wheel > 0 ? 1.15 : 0.87;
    cam.updateDerived();
    world.update(cam.x, cam.y);
    r.render(game, dt);
    game.loading = false;
    input.endFrame();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.__dbg = { world, cam, r };
}
