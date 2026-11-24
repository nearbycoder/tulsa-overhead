"""Bake textured Tulsa canopy study meshes to GTPolly overhead sprite stacks.

Run with the project Python, --models pointing to GT Tulsa's art/blend/world/canopy.
Blender renders horizontal sections of the original packed-texture models. The
short stacks retain the old prop footprint and height so survey placement and
collision can continue using the original catalog.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile

LAYERS = 12
MODELS = {
    'oak_1': 'BurOak', 'oak_2': 'Pecan', 'oak_3': 'Hackberry', 'elm': 'AmericanElm',
    'cottonwood': 'Sycamore', 'redbud': 'Hackberry', 'redbud_bloom': 'Hackberry',
    'eastern_red_cedar_1': 'Redcedar', 'eastern_red_cedar_2': 'Redcedar',
    'post_oak': 'BurOak', 'pine': 'Redcedar', 'bush_1': 'Hackberry',
    'bush_2': 'Pecan', 'bush_3': 'AmericanElm',
}


def render_slices(output):
    import bpy
    scene = bpy.context.scene
    camera = scene.camera
    camera.location = (0, 0, 2.2)
    camera.rotation_euler = (0, 0, 0)
    tree = next(obj for obj in scene.objects if obj.type == 'MESH')
    camera.data.ortho_scale = max(abs(v.co[axis]) for v in tree.data.vertices for axis in (0, 1)) * 2.04
    scene.render.resolution_x = scene.render.resolution_y = 320
    scene.cycles.samples = 18
    scene.render.film_transparent = True
    scene.render.use_persistent_data = True
    for i in range(LAYERS):
        camera.data.clip_start = 2.2 - (i + 1) / LAYERS
        camera.data.clip_end = 2.2 - i / LAYERS + 0.0001
        scene.render.filepath = str(output / f'{i:02}.png')
        bpy.ops.render.render(write_still=True)


def pack(layers, original, prop, kind, dest):
    import numpy as np
    from PIL import Image, ImageChops

    base_w, base_h = prop['w'], prop['h']
    factor = max(3, min(9, round(256 / max(base_w, base_h))))
    w, h = base_w * factor, base_h * factor
    alpha = Image.new('L', (base_w, base_h))
    for i in range(prop['count']):
        old = original.crop((i*base_w, 0, (i+1)*base_w, base_h))
        alpha = ImageChops.lighter(alpha, old.getchannel('A'))
    target = tuple(k * factor for k in alpha.getbbox())
    silhouette = Image.new('L', layers[0].size)
    for layer in layers:
        silhouette = ImageChops.lighter(silhouette, layer.getchannel('A'))
    box = silhouette.getbbox()
    resized = []
    for i, layer in enumerate(layers):
        piece = layer.crop(box).resize((target[2]-target[0], target[3]-target[1]), Image.Resampling.LANCZOS)
        if kind == 'redbud_bloom' and i >= LAYERS//2:
            # Only sunlit leaf tips carry the dusty spring colour in this variant.
            arr = np.array(piece)
            rgb = arr[:, :, :3].astype(float)
            tips = np.clip((rgb[:, :, 1] - 73) / 56, 0, .72)[:, :, None]
            rgb += tips * [51, -14, 39]
            arr[:, :, :3] = np.clip(rgb, 0, 255).astype('uint8')
            piece = Image.fromarray(arr)
        frame = Image.new('RGBA', (w, h))
        frame.paste(piece, target[:2])
        resized.append(frame)

    def sheet(frames, suffix):
        sw, sh = frames[0].size
        strip = Image.new('RGBA', (sw * len(frames), sh))
        for i, frame in enumerate(frames):
            strip.paste(frame, (sw * i, 0))
        strip.save(dest / (kind + suffix + '.webp'), quality=83, method=4)

    sheet(resized, '')
    far = []
    # Group neighbouring layers before reducing resolution so no twigs disappear.
    for i in range(0, LAYERS, 3):
        merged = resized[i].copy()
        for layer in resized[i+1:i+3]:
            merged.alpha_composite(layer)
        far.append(merged.resize((base_w*2, base_h*2), Image.Resampling.LANCZOS))
    sheet(far, '-distant')


def build(args):
    from PIL import Image

    props = Path(__file__).resolve().parents[1] / 'assets/props'
    dest = props / 'crowns'
    dest.mkdir(exist_ok=True)
    catalog = {p['id']: p for p in json.loads((props/'catalog.json').read_text())['props']}
    with tempfile.TemporaryDirectory() as tmp:
        for model in sorted(set(MODELS.values())):
            directory = Path(tmp) / model
            directory.mkdir()
            subprocess.run([args.blender, '-b', str(args.models / (model+'.blend')), '-t', '6',
                            '--python-exit-code', '1', '-P', str(Path(__file__).resolve()), '--',
                            '--render-slices', str(directory)], check=True)
            layers = [Image.open(directory / f'{i:02}.png').convert('RGBA') for i in range(LAYERS)]
            for kind, source in MODELS.items():
                if source != model:
                    continue
                prop = catalog['redbud' if kind == 'redbud_bloom' else kind]
                with Image.open(props/prop['file']) as original:
                    pack(layers, original.convert('RGBA'), prop, kind, dest)


if __name__ == '__main__':
    if '--render-slices' in sys.argv:
        render_slices(Path(sys.argv[sys.argv.index('--render-slices') + 1]))
    else:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument('--blender', default='blender')
        parser.add_argument('--models', type=Path, required=True)
        build(parser.parse_args())
