"""Build the offline driving graph used by the GPS worker from the shipped roads."""
from array import array
import gzip
import json
from pathlib import Path
import struct
import sys

MAP = Path(__file__).resolve().parents[1] / 'assets/map'


def build():
    nodes = {}
    ends, offsets, names, kinds, points = (array('i') for _ in range(5))
    meta = json.loads((MAP / 'meta.json').read_text())
    for rx, ry, count, *_ in sorted(meta['regions']):
        if not count:
            continue
        with gzip.open(MAP / 'r' / f'{rx}_{ry}.json.gz') as stream:
            for kind, flags, lanes, layer, name, start, end, speed, shape, *_ in json.load(stream)['roads']:
                if kind == 15 or not start or not end or len(shape) < 4:
                    continue
                ends.extend([nodes.setdefault(start, len(nodes)), nodes.setdefault(end, len(nodes))])
                offsets.append(len(points) // 2)
                names.append(name)
                kinds.append(kind | (flags << 8))
                points.extend(shape)
    offsets.append(len(points) // 2)
    write_graph(MAP / 'navigation.bin.gz', len(nodes), ends, offsets, names, kinds, points)


def write_graph(dest, node_count, ends, offsets, names, kinds, points):
    tmp = dest.with_suffix('.tmp')
    with tmp.open('wb') as raw, gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0, compresslevel=7) as stream:
        stream.write(struct.pack('<4sIII', b'GPS1', node_count, len(names), len(points) // 2))
        for field in (ends, offsets, names, kinds, points):
            if field.itemsize != 4:
                raise ValueError('GPS format requires 32-bit integer arrays')
            if sys.byteorder != 'little':
                field.byteswap()
            stream.write(field)
    tmp.replace(dest)
    print(f'{len(names):,} segments, {node_count:,} junctions, {dest.stat().st_size:,} compressed bytes')


if __name__ == '__main__':
    build()
