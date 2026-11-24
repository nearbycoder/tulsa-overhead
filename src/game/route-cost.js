import { RC, F } from '../world/shared.js';

export class Heap {
  constructor() {
    this.a = [];
  }
  push(n, f) {
    const a = this.a;
    a.push([f, n]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1,
          r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top && top[1];
  }
  get size() {
    return this.a.length;
  }
}

export function roadCost(cls, flags) {
  if (cls <= 1) return 0.55;
  if (cls === 10 || cls === 11) return 0.65;
  if (cls <= 3) return 0.75;
  if (cls === 4 || (cls >= 12 && cls <= 14)) return 0.85;
  if (cls === RC.SERVICE) return flags & (F.AISLE | F.DRIVEWAY) ? 6 : 2.5;
  if (cls === RC.TRACK) return 2.2;
  return 1;
}
