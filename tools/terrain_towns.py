"""Select native aerial patches for a town-focused build, in the game's metre grid."""

from shapely.geometry import Point, Polygon, box
from shapely.ops import unary_union
from shapely.prepared import prep


def town_masks(meta, jobs):
    # Include the approaches to municipal limits and the centres of unincorporated
    # places, many of which have a place point but no municipal boundary.
    shapes = [Polygon(ring).buffer(0).buffer(512)
              for city in meta['cities'] for ring in city['poly']]
    shapes.extend(Point(p['x'], p['y']).buffer(768) for p in meta['places']
                  if p['t'] in ('city', 'town', 'village'))
    settled = prep(unary_union(shapes))
    selected = {}
    for rx, ry, wanted in jobs:
        x, y = rx * 2048, ry * 2048
        region = box(x, y, x + 2048, y + 2048)
        if not settled.intersects(region):
            continue
        bits = wanted
        if not settled.covers(region):
            bits = 0
            for bit in range(16):
                if wanted & (1 << bit):
                    left, top = x + (bit % 4) * 512, y + (bit // 4) * 512
                    if settled.intersects(box(left, top, left + 512, top + 512)):
                        bits |= 1 << bit
        if bits:
            selected[rx, ry] = bits
    return selected
