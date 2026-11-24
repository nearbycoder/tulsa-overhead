// Street sidecars store the control's vertex, travel direction, phase group and
// cycle offset (tenths of a second). Stops have group zero. Map timing is simulated.
import { cum, endNode } from './roads.js';
import { RC } from '../world/shared.js';

const empty = [];
export function approachControls(road, dir) {
  if (!road.controls) return empty;
  const key = dir > 0 ? 'forwardStops' : 'backwardStops';
  if (road[key]) return road[key];
  const distances = cum(road),
    result = [];
  for (const [vertex, facing, group, phase, central] of road.controls) {
    if (facing !== dir) continue;
    let s = dir > 0 ? distances[vertex] : road.len - distances[vertex];
    if (central) {
      const node = endNode(road, dir);
      if (node && node.edges.length >= 3) {
        const width = Math.max(
          road.w,
          ...node.edges.filter((e) => e.road.cls !== RC.PATH).map((e) => e.road.w)
        );
        s = Math.max(0, s - width / 2 - 1);
      }
    }
    result.push({ s, group, phase: phase / 10 });
  }
  road[key] = result.sort((a, b) => a.s - b.s);
  return road[key];
}

export function controlState(control, time) {
  if (!control.group) return 'stop';
  const phase = (time + control.phase + (control.group === 2 ? 14 : 0)) % 28;
  if (phase < 10) return 'green';
  if (phase < 13) return 'yellow';
  return 'red';
}
