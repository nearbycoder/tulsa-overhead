#!/usr/bin/env python3
"""Bake GT Tulsa's Blender architectural models for the overhead renderer.

Run with the same Python environment as import_gt_tulsa.py, after importing buildings:
    python tools/import_landmarks.py /path/to/gt-tulsa --blender /path/to/blender
The catalog matches projected footprints to the shipped region files. Runtime needs
only the catalog and compressed assets. Mesh positions use centimetres; Y points south.
"""
import argparse
import gzip
import json
import math
import struct
import subprocess
import sys
import tempfile
from itertools import accumulate
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "landmarks"


def bake_model(scene, filepath):
    import bpy
    from mathutils import Vector

    bpy.ops.wm.open_mainfile(filepath=str(scene))
    vertices = {}
    indices = []
    bounds = [math.inf, math.inf, -math.inf, -math.inf, 0.]
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH' or obj.hide_render:
            continue
        mesh = obj.data
        mesh.calc_loop_triangles()
        transform = obj.matrix_world
        normals = transform.to_3x3().inverted().transposed()
        points = []
        for v in mesh.vertices:
            x, y, z = transform @ v.co
            bounds = [min(bounds[0], x), min(bounds[1], -y), max(bounds[2], x), max(bounds[3], -y), max(bounds[4], z)]
            points.append(tuple(round(100 * a) for a in (x, -y, z)))
        light = Vector((-.42, .55, .72)).normalized()
        colors = []
        for face in mesh.polygons:
            material = mesh.materials[face.material_index]
            name = material.name.lower()
            glass = 'glass' in name or name == 'glazing'
            n = (normals @ face.normal).normalized()
            is_roof = abs(n.z) > .5 and all(points[i][2] > 230 for i in face.vertices)
            finish = 0
            if name in ('tile', 'under roof'):
                finish = 1
            elif 'brick' in name:
                finish = 2
            elif 'concrete' in name or name in ('head house', 'elevator band', 'granite'):
                finish = 3
            elif name in ('limestone', 'mortar and sills', 'dressed stone'):
                finish = 4
            surface = (finish << 2) | (2 if is_roof else 0) | int(glass and 'shade' not in name)
            lightness = .70 + .30 * max(-.45, n.dot(light))
            # Studio material swatches are linear RGB. Compress highlights to match the game palette.
            rgb = tuple(round(255 * min(1, c ** .62 * lightness)) for c in material.diffuse_color[:3])
            colors.append((*rgb, surface))
        for triangle in mesh.loop_triangles:
            if max(points[i][2] for i in triangle.vertices) < 0:
                continue
            color = colors[triangle.polygon_index]
            for i in triangle.vertices:
                vertex = (*points[i], *color)
                if vertex not in vertices:
                    vertices[vertex] = len(vertices)
                indices.append(vertices[vertex])
    # Ten bytes per vertex (xyz i16, rgba u8), then a four-byte aligned u32 index array.
    data = bytearray(struct.pack('<II', len(vertices), len(indices)))
    for vertex in vertices:
        data.extend(struct.pack('<hhhBBBB', *vertex))
    data.extend(bytes(-len(data) % 4))
    data.extend(struct.pack(f'<{len(indices)}I', *indices))
    filepath.write_bytes(gzip.compress(data, mtime=0))
    return [round(v, 2) for v in bounds]


def import_sites(args):
    from pyproj import Transformer
    from shapely.geometry import Polygon

    gt = args.gt.resolve()
    from PIL import Image, ImageStat
    sys.path.insert(0, str(gt / 'pipeline'))
    from tulsa.worldgen.roof_atlas import photograph, R
    OUT.mkdir(exist_ok=True)
    # Pack the CC0 Poly Haven scans used by the authored landmarks as a single
    # luminance texture. The material swatches retain the authored surface color.
    atlas = Image.new('L', (1024, 256))
    for index, name in enumerate(['grey_roof_tiles_02', 'red_brick_03', 'precast_concrete_wall', 'concrete_tile_facade']):
        with Image.open(gt / f'GTTulsa/Assets/Resources/City/Masonry/{name}.jpg') as src:
            tile = src.convert('L').resize((256, 256), Image.Resampling.LANCZOS)
            avg = ImageStat.Stat(tile).mean[0]
            atlas.paste(tile.point(lambda n: 128 + (n - avg) * 1.35), (index * 256, 0))
    atlas.save(OUT / 'materials.webp', quality=91)
    sites = json.loads((gt / 'GTTulsa/Assets/Resources/City/Landmarks.json').read_text())['models']
    # These exhibits already have dedicated animated-game props. Two multi-footprint models
    # span separate buildings in this map and need an assembly renderer before they can be used.
    sites = [s for s in sites if s['style'] not in ('blue_whale', 'prayer_tower', 'central_library', 'first_place')]
    tr = Transformer.from_crs('+proj=tmerc +lat_0=36.12 +lon_0=-95.91 +k=1 +datum=WGS84 +units=m', 'EPSG:4326', always_xy=True)
    origin = json.loads((ROOT / 'assets/map/meta.json').read_text())['origin']

    def project(x, z):
        lon, lat = tr.transform(x, z)
        return [(lon - origin['lon']) * origin['kx'], (origin['lat'] - lat) * origin['ky']]

    catalog = []
    for site in sites:
        x, z = site['x'], site['z']
        cx, cy = project(x, z)
        shape = Polygon([project(x + dx, z + dz) for dx, dz in site['outline']]).buffer(0)
        rx, ry = math.floor(cx / 2048), math.floor(cy / 2048)
        region = json.loads(gzip.decompress((ROOT / f'assets/map/r/{rx}_{ry}.json.gz').read_bytes()))
        score, signature = 0, None
        for b in region['bld']:
            ring = b[3]
            trace = Polygon(zip([i/10 for i in accumulate(ring[::2])], [i/10 for i in accumulate(ring[1::2])])).buffer(0)
            if shape.intersects(trace):
                iou = shape.intersection(trace).area / shape.union(trace).area
                if iou > score:
                    score = iou
                    signature = [ring[0], ring[1], len(ring), ring[2], ring[3]]
        if score < .9:
            raise ValueError(f"Missing footprint for {site['name']} (overlap {score:.1%})")
        entry = {'model': site['style'], 'footprint': signature, 'x': round(cx, 2), 'y': round(cy, 2)}
        # The survey's infrared mask rejects tree canopy, deep shadows and mixed
        # pixels near displaced eaves before extending the interior to the edge.
        local = Polygon([(x + u, z + v) for u, v in site['outline']])
        photo = photograph(local, site['height_m'], None)
        if not isinstance(photo, str):
            im, (west, south), *_ = photo
            im.transpose(Image.Transpose.FLIP_TOP_BOTTOM).save(OUT / (site['style'] + '.webp'), quality=93)
            width, height = im.width / R, im.height / R
            entry['roofUV'] = [round(west - x, 3), round(z - south - height, 3), round(width, 3), round(height, 3)]
        catalog.append(entry)
    with tempfile.TemporaryDirectory() as tmp:
        metadata = Path(tmp) / 'sites.json'
        metadata.write_text(json.dumps(catalog))
        subprocess.run([args.blender, '--background', '--factory-startup', '--python-exit-code', '1',
                        '--python', __file__, '--', str(gt), str(metadata)], check=True)
        catalog = json.loads(metadata.read_text())
    target = ROOT / 'src/data/landmark-models.js'
    target.write_text('// Generated by tools/import_landmarks.py from the surveyed architectural models.\n'
                      + 'export const landmarkModels = [\n'
                      + ''.join('  ' + json.dumps(s, separators=(',', ':')) + ',\n' for s in catalog) + '];\n')


if __name__ == '__main__':
    if '--' in sys.argv:
        gt, metadata = map(Path, sys.argv[sys.argv.index('--') + 1:])
        catalog = json.loads(metadata.read_text())
        for site in catalog:
            key = site['model']
            site['bounds'] = bake_model(gt / f'art/blend/landmarks/{key}.blend', OUT / f'{key}.mesh.gz')
        metadata.write_text(json.dumps(catalog))
    else:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument('gt', type=Path)
        parser.add_argument('--blender', default='blender')
        import_sites(parser.parse_args())
