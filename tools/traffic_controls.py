"""Match OSM stop signs and traffic signals to directed approaches in the shipped graph."""

from collections import defaultdict
from itertools import pairwise
from math import atan2, cos, hypot, sin

from build_map import proj


class TrafficControls:
    def __init__(self):
        self.nodes = {}
        self.arms = defaultdict(list)
        self.bearings = defaultdict(list)
        self.phases = {}
        self.min_class = {}
        self.used = set()

    def node(self, node):
        kind = node.tags.get("highway")
        if kind not in ("stop", "traffic_signals"):
            return
        direction = node.tags.get("traffic_signals:direction") or node.tags.get("direction")
        if direction not in (None, "forward", "backward", "both"):
            return
        xy = proj(node.location.lon, node.location.lat)
        self.nodes[node.id] = (kind, direction, node.tags.get("stop"), xy)

    def way(self, way, cls, oneway, reverse):
        if cls == 15:
            return
        ns = way.nodes
        for i, node in enumerate(ns):
            data = self.nodes.get(node.ref)
            if not data:
                continue
            kind, direction, _, _ = data
            for sign in (1, -1):
                j = i - sign
                if not 0 <= j < len(ns) or not (node.location.valid() and ns[j].location.valid()):
                    continue
                stored = -sign if reverse else sign
                if oneway and stored < 0:
                    continue
                self.min_class[node.ref] = min(cls, self.min_class.get(node.ref, cls))
                if direction in ("forward", "backward") and (direction == "forward") != (sign == 1):
                    continue
                a, b = (tuple(round(t * 10) for t in proj(n.lon, n.lat)) for n in (ns[j], node))
                if a == b:
                    continue
                angle = atan2(b[1] - a[1], b[0] - a[0])
                if kind == "traffic_signals":
                    self.bearings[node.ref].append(angle)
                self.arms[(cls, a, b) if stored > 0 else (cls, b, a)].append((node.ref, stored, angle))

    def finish(self):
        # Opposing stop lines at a divided intersection often have distinct OSM nodes.
        # Group nearby heads and derive the two perpendicular phase axes from the approaches.
        parent = {}

        def root(k):
            while parent[k] != k:
                parent[k] = parent[parent[k]]
                k = parent[k]
            return k

        grid = defaultdict(list)
        for k in self.bearings:
            x, y = self.nodes[k][3]
            cx, cy = int(x // 48), int(y // 48)
            parent[k] = k
            for ix in range(cx - 1, cx + 2):
                for iy in range(cy - 1, cy + 2):
                    for other in grid[ix, iy]:
                        ox, oy = self.nodes[other][3]
                        if hypot(ox - x, oy - y) <= 48:
                            a, b = root(k), root(other)
                            parent[max(a, b)] = min(a, b)
            grid[cx, cy].append(k)
        groups = defaultdict(list)
        for k in parent:
            groups[root(k)].extend(self.bearings[k])
        axes = {
            k: atan2(sum(sin(4 * a) for a in vals), sum(cos(4 * a) for a in vals)) / 4
            for k, vals in groups.items()
        }
        self.phases = {k: (root(k) % 280, axes[root(k)]) for k in parent}

    def match(self, road, pts):
        cls, flags = road[:2]
        result = []
        for i, (a, b) in enumerate(pairwise(pts)):
            for osm_id, direction, angle in self.arms.get((cls, a, b), ()):
                kind, facing, stop, _ = self.nodes[osm_id]
                if kind == "stop" and not facing and stop == "minor" and cls == self.min_class[osm_id]:
                    continue
                vi = i + 1 if direction > 0 else i
                # Endpoint controls without a tagged approach can sit at the junction centre.
                # Mark them so the driver and prop move back to the edge of the crossing.
                central = facing in (None, "both") and (vi == len(pts) - 1 if direction > 0 else vi == 0)
                # An undirected stop on a two-way mid-block approach has no reliable
                # facing. Do not invent a second stop for vehicles leaving the junction.
                if kind == "stop" and not facing and not central and not flags & 1 and stop != "all":
                    continue
                record = [vi, direction, 0, 0, int(central)]
                if kind == "traffic_signals":
                    phase, axis = self.phases[osm_id]
                    record[2:4] = [1 if abs(cos(angle - axis)) >= 2**-0.5 else 2, phase]
                if record not in result:
                    result.append(record)
                    self.used.add(osm_id)
        return result
