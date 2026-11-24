<img src="assets/icon.svg" width="64" height="64" alt="">

# Tulsa Overhead

[Play in your browser](https://nearbycoder.github.io/tulsa-overhead/play/) · [Game website](https://nearbycoder.github.io/tulsa-overhead/) · [Download a standalone copy](https://github.com/nearbycoder/tulsa-overhead/releases/latest)

Tulsa Overhead is an original top-down open-world crime game in the style of the late-90s overhead classics. It runs in the browser and is set in a **real-scale, real-geography Tulsa metro**: Tulsa, Broken Arrow, Glenpool, Catoosa, Jenks, Bixby, Sand Springs, Sapulpa, Owasso, Claremore and all of Tulsa, Osage, Pawnee, Creek, Okmulgee, Wagoner, Rogers and Washington counties (about 167 × 179 km).

Vehicles, pedestrians, trees and roadside props use **sprite stacks** built with [danielwh2/sprite-stacking](https://github.com/danielwh2/sprite-stacking). Buildings rise from mapped footprints, with individually modelled architecture at selected landmarks. The overhead camera projects every layer in perspective.

## Run it

Download the Overview or Compact ZIP from [Releases](https://github.com/nearbycoder/tulsa-overhead/releases/latest), extract it and run the following command from the extracted folder with Node.js installed.

For a source checkout, download the Overview ZIP and extract its `assets/` directory into the project first. The release contains the generated map and dialogue audio. The public browser edition streams the Overview map as you play.

```bash
npm start            # zero-dependency static server -> http://localhost:8137
```

Open the URL in Chrome, Edge, Firefox or Safari. On a phone or tablet, connect to the same Wi-Fi as the computer running the game and open the Wi-Fi address printed by `npm start`. Tap or click to enable audio. Saves belong to the browser and address used to play.

### Playing on a touchscreen

Use the left stick to walk or steer. Push to the rim to sprint. On foot, tap **Use** to interact or enter a vehicle. Tap **Attack** to strike or fire ahead, or drag it to aim. Vehicles show accelerator and brake pedals. Helicopters show lift and land controls. **More** opens the phone and secondary actions. In the map, drag to pan, pinch to zoom, and tap to set a waypoint. Portrait and landscape both support gameplay.

**Automatic** graphics is the default for a new installation. It starts with a device-appropriate resolution and adjusts to sustained frame times during play. Choose **Settings → Display → Frame limit** for 30 FPS, 60 FPS or the display refresh rate. Fixed presets, including Ultra 4K, keep their chosen quality.

### Smaller game downloads

Run `npm run package` from the source project to create `build/Tulsa-Overhead-Compact.zip`. Unzip it and run `npm start` in the extracted folder. The archive includes the game, the map and its local server. Node.js is the only runtime dependency.

| Edition | Aerial imagery included | Aerial image size | Build command |
| --- | --- | ---: | --- |
| Compact | 16,634 native 0.6 m patches around municipalities and named towns and villages, with 4 m imagery throughout the countryside | 1.63 GB | `npm run package -- compact` |
| Overview | 4 m imagery across all eight counties | 217 MB | `npm run package -- overview` |
| Full | Native 0.6 m imagery and the 4 m overview across all eight counties | 5.49 GB | `npm run package -- full` |

Every edition includes the same streets, buildings, trees, missions and graphics presets. Choose an edition for download size and use **Settings → Graphics** to adjust rendering on the machine running the game. Ultra can render at 3840 × 2160 in every edition. Close-up photographic detail depends on which aerial imagery is installed.

**Continue** opens the newest save. **Load Game** lets you pick your manual save or the autosave by place and date. In free roam, Quick Save remembers your occupied vehicle and its condition. Vehicles resume at rest, including helicopters hovering at their saved altitude. Saving at a safehouse restores health and advances the clock by six hours. If you quit during a story mission, Continue restarts that mission with the money and equipment you had when it began.

## What's in it

- **Buildings and streets.** The eight-county map contains 548,417 building footprints and about 408,000 road segments. It includes 23,531 mapped sidewalk ways, directional lane counts and turn arrows on tagged approaches. The central Tulsa metro uses GT Tulsa survey geometry and lidar roof measurements. At close range on Medium and higher settings, 61,192 complex roofs show measured ridges, eaves and shadows, including 10,051 in Broken Arrow. Outside that survey, footprints come from Overture's November 18, 2026 buildings release. The game estimates heights and finishes where source measurements are missing. [Municipal coverage](docs/building-coverage.csv)
- **Terrain.** The 2025 USDA 0.6 m aerial survey covers the full 17,785.5 km² game world, including rural fields, riverbanks and roads. A 4 m overview appears first. Nearby 512 m patches load at native survey detail on Balanced, High and Ultra. Economy uses the overview. High and Ultra add shaded relief from USGS bare-earth elevations, plus metre-scaled photographic textures for paving, gravel, turf and soil. Road surfaces and markings follow mapped geometry.
- **Buildings and vegetation.** The close-up renderer streams matched roof photographs for 301,697 buildings. Across the map, 526,383 buildings have photographed or mapped roof colors. Central metro tree placements and heights use the canopy survey. High and Ultra use textured canopy models, with smaller sprite stacks for distant trees.
- **Geography.** Lakes, rivers, creeks, parks, farmland, rail, runways and points of interest stream in 2 km regions. The full-screen map uses five overview levels. Zooming in draws the actual building and street outlines wherever you pan, independently of the player’s location.
- **Highways in 3D:** real overpasses, flyovers and bridges over roads, railways and rivers stand on piers at 7.2 m per level. The roads that feed them ramp up at a 5% grade on embankments. Cars drive up and over, guard rails keep them on the deck, and traffic underneath passes below. Creek culverts that OSM also tags as bridges stay on the ground.
- **Landmarks** include the Rose District Farmers Market pavilion, Broken Arrow grain elevator, Museum Broken Arrow, Catoosa depot, the Golden Driller, Blue Whale of Catoosa, Praying Hands, Prayer Tower, Center of the Universe, Buck Atom's Space Cowboy, the Meadow Gold sign, the Sapulpa giant gas pump and Route 66 Rising. You can also find the BOK Center, Cain's Ballroom, Gathering Place, Philbrook, Utica Square, Expo Square, the Port of Catoosa, Keystone, Skiatook and Oologah lakes, and more.
- **Story.** Polly Haskins comes home to Broken Arrow and takes on the Gusher Syndicate across eight chapters and 35 missions. Open **Pause → Story** to check the current objective, reread the mission conversation, find the next contact or retry a failed mission. Story dialogue is voiced with [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS).
- **Territories** are the story-driven layer. Faction turf (Gusher Syndicate, Rose District Wrenches, Port Rats, Red Dirt Riders) changes hands as chapters complete. Hostile crews attack on sight and do drive-bys; allies defend you.
- **Vehicles:** about 100 unique sprite-stacked models with fictional makes. They include sedans, muscle cars, supercars, pickups, semis, buses, a school bus, police, an ambulance, fire trucks, taxis, bicycles, motorbikes, ATVs, tractors, a combine, boats and helicopters. Each model has its own handling, engine sound and paint variants.
- **People:** 500+ procedurally built pedestrian models with distinct outfits, skin tones, hair, hats, builds and accessories. Walking and running are animated, and pedestrians follow sidewalks, cross streets, panic, fight back and sometimes carry guns.
- **Weapons:** fists, bat, knife, pistol, .44 revolver, SMG, shotgun, assault rifle, deer rifle, Gatling gun, rocket launcher, grenades, molotovs and a flamethrower. Drive-bys work too.
- **Police:** wanted levels run from 1 to 6 stars. Pursuit cars use the real road graph. Cops chase on foot and make arrests; higher levels bring helicopters with spotlights and snipers, roadblocks, troopers and SWAT. You can evade them, or lose the heat at Red Dirt Respray.
- **Activities:** taxi, vigilante, paramedic and firefighter jobs, ringing payphones with random hits, car boosts and hot drops, 24 rampages, 50 hidden packages, police bribes, gun shops and safehouses.
- **Navigation.** Open the map and press **/** (controller **X / □**) to find a town, landmark, business, unlocked service or available story contact. Select a result to see the route across all eight counties. On foot, GPS uses mapped sidewalks, crossings, trails and streets open to pedestrians. Enter a road vehicle or bicycle to switch to road guidance. Boats and helicopters show a direct bearing. **Zoom to pin** shows named streets, footprints and mapped sidewalks around your destination. A manual waypoint stays in the save and takes priority over mission guidance until arrival or removal. The radar shows the next turn, street name and remaining distance. Miss a turn and the GPS recalculates.
- **Getting around a real-size metro:** press T at any unlocked safehouse to catch a paid ride to another safehouse or straight to a story contact. During a mission, a long haul (over 3 km, no timer, no heat, nobody shooting) can be skipped with T. After a failed story mission, press T to return to the contact and retry. Once the shortcut expires, Pause → Story keeps the retry available, including after saving and loading.
- **Living metro:** freight trains on the real rail lines; ambulances whose paramedics revive the fallen; fire engines; police radio dispatch callouts and radio-DJ station idents, all voiced with Qwen3-TTS; and Oklahoma thunderstorms that can spawn tornadoes (with civil-defence sirens) that throw cars around.
- **World simulation.** Drivers queue at signals, yield at stop signs and follow mapped turn arrows. The road data includes 15,426 stop nodes and 2,847 signal nodes. Signal timing is simulated. Headlights, street lamps and windows light up at night. Oklahoma rainstorms roll through during play. You'll also see pumpjacks, cattle and bison, hay bales, street furniture you can knock over, skid marks, blood, fire and explosions.
- **Audio:** fully procedural Web Audio covers engines that rev with RPM, sirens, gunfire, crashes and ambience. There are seven generative radio stations, including Red Dirt Radio, The Tulsa Sound, Greenwood Jazz and Route 66 Oldies. Story conversations play in order and resume at the same point after a pause. Radio announcements follow the radio volume and end when you change stations or leave the vehicle.
- **Graphics settings.** Choose **Settings → Graphics → Ultra · 4K** for 3840 × 2160 at 16:9. **High · Native** follows the display up to 4K. **Medium · 1080p**, **Low · 720p** and **Retro · 480p** reduce the rendered pixel count, scenery and memory budget. Adjust **Terrain detail** independently under Graphics or select a different **Render resolution** under Display, including 1440p or a custom scale. The game preserves the viewport aspect ratio and remembers your settings.

## Controls

Keyboard and mouse, or any standard controller (Xbox, PlayStation or Switch Pro). On-screen button prompts switch to whichever you touched last, and you can pin them under Settings → Gameplay → Button prompts. Every menu works on a controller: the left stick or d-pad moves, A/✕ selects, B/○ goes back, LB/RB switch settings tabs, left and right change sliders and options, and the right stick scrolls long screens.

| | Keyboard / mouse | Controller (Xbox · PlayStation) |
|---|---|---|
| Move / steer | WASD or arrows | Left stick |
| Gas / brake | W / S | RT / LT · R2 / L2 |
| Aim (on foot) | Mouse | Right stick |
| Fire on foot · drive-by | Ctrl / LMB | RT · R2 on foot, RB · R1 in a vehicle |
| Enter / steal / exit vehicle, shop, save | F / Enter | Y · △ |
| Handbrake (helicopter: climb or land) · sprint | Space · Shift | A · ✕ |
| Switch weapon | Q / E / wheel | D-pad ← → |
| Radio · reload | R | D-pad ↑ · X / □ |
| Horn / siren | H | B · ○ |
| Catch a ride, skip a long drive, retry, vehicle jobs | T | D-pad ↓ |
| Skip dialogue | Space / Enter / click | A · ✕ |
| Map (pan with the stick, triggers zoom, A sets a waypoint) | M / Tab | View · Create |
| Find a destination on the map | / · type · Enter | X / □ · move through categories and places · A / ✕ |
| Center the map on the player | Home | Y / △ |
| Pause | Esc / P | Menu · Options |

To fly over a destination, open the pause menu, choose **Spawn Helicopter** and select an aircraft. Press **Space** or **A / ✕** to take off.

Controllers rumble on crashes, gunfire, explosions and hits; switch this off under Settings → Gameplay.

### Cheats

Type these during play: `OKIEARSENAL` (all weapons), `SOONERSTATE` (health and armor), `LOSETHEBADGE` (clear wanted level), `BRINGTHEHEAT` (+2 stars), `OILMONEY` (+$250k), `MOTHERROAD` (finned Route 66 classic), `REDDIRTRIDE` (mud truck), `WHIRLYBIRD` (helicopter), `TWISTER` (tornado), `STORMCHASER` / `BLUESKIES` (weather), `MIDNIGHTOIL` / `SUNRISE` (time).

## Project layout

```
src/engine/   renderer, perspective camera, sprite-stack drawing, buildings, ground tiles, audio, input, settings
src/world/    region streaming worker (surface rasteriser, trees, spatial buckets), world queries
src/entities/ vehicle physics, pedestrians
src/game/     game loop, traffic AI, pedestrian AI, police, combat, effects, decor, jobs, factions, missions, HUD
src/story/    cast, chapters, mission scripts (see docs/MISSION_API.md)
src/data/     places (real lat/lon), weapons, pedestrian model generator
assets/       map regions + tiles, vehicle and prop sprite stacks, voice lines
tools/        build_map.py, build_tiles.py, gen_vehicles.py, gen_props.py, gen_voices.py, serve.mjs, shot.mjs,
              test_missions.mjs (smoke test), playtest.mjs + bot.js (autopilot that plays the story), tour.mjs, perf.mjs
```

## Testing

```bash
npm start &                                   # the tools expect the server on :8137
node tools/test_missions.mjs                  # every mission starts and reaches its first objective
node tools/test_mission_retry.mjs             # fail at the contact and retry from a safehouse or saved game
node tools/playtest.mjs ch1-4                 # a bot plays the missions with the real controls and reports
                                              # pass/fail, time, distance, damage taken and any help it needed
node tools/test_navigation.mjs && node tools/test_streets.mjs && node tools/test_traffic.mjs
node tools/test_map_finder.mjs && node tools/test_speech.mjs
node tools/test_journal.mjs && node tools/test_save_resume.mjs && node tools/test_mission_retry.mjs
node tools/test_graphics.mjs && node tools/test_terrain_stream.mjs && node tools/test_compact_terrain.mjs && node tools/test_terrain_cache.mjs
node tools/test_adaptive.mjs && node tools/test_ground_patterns.mjs
node tools/test_touch_gameplay.mjs && node tools/test_mobile_ui.mjs
node tools/test_helicopter.mjs                 # pause-menu aircraft swaps on land, over water and over a building
node tools/test_collision_clearance.mjs        # check optimized collision queries against the exact solver
node tools/bench_gameplay.mjs                  # downtown drive and Broken Arrow flight at a fixed preset
PROFILE=phone-software node tools/bench_gameplay.mjs  # phone viewport, software rendering, 4× CPU slowdown
PRESET=ultra node tools/bench_gameplay.mjs     # repeat the same routes at 4K
node tools/tour.mjs out/                      # screenshots around the map;  node tools/perf.mjs … for frame times
```

## Rebuilding assets

```bash
# map (needs osmium-tool and the Python venv with osmium/shapely/pillow)
osmium extract -s smart -b -97.2,35.30,-95.05,37.05 oklahoma-latest.osm.pbf -o region.osm.pbf
osmium tags-filter region.osm.pbf nwr/highway nwr/building nwr/natural nwr/waterway nwr/landuse nwr/leisure \
  r/boundary=administrative nwr/railway nwr/amenity nwr/tourism nwr/historic nwr/aeroway nwr/shop nwr/man_made nwr/place nwr/name -o filtered.osm.pbf
.venv/bin/python tools/build_map.py filtered.osm.pbf

# Use the GT Tulsa pipeline Python environment for the survey imports.
# GT points to the sibling gt-tulsa project. NAIP points to the eight 2025
# county .sid mosaics. DECODER points to the MrSID SDK's mrsiddecode.
python tools/import_gt_tulsa.py --gt "$GT"
.venv/bin/python tools/road_levels.py
python3 tools/build_navigation.py
.venv/bin/python tools/build_walking.py region.osm.pbf
.venv/bin/python tools/build_streets.py region.osm.pbf
overturemaps download -r 2026-11-18.0 -t building --bbox=-97.070,35.374,-95.205,37.002 -f geoparquet -o build/eight_county_buildings.parquet
python tools/import_county_buildings.py build/eight_county_buildings.parquet --release 2026-11-18.0
python tools/import_roof_colors.py "$GT/data/build/imagery"
python tools/import_county_roof_colors.py --decoder "$DECODER" "$NAIP"/*.sid
python tools/build_roof_photos.py --gt "$GT"
python tools/build_survey_roofs.py --gt "$GT"
python tools/build_full_terrain.py --decoder "$DECODER" "$NAIP"/*.sid  # 68,670 native patches, 4,424 overviews
python tools/check_full_terrain.py
# Five full USGS 1/3 arc-second source tiles; --metro adds the optional 4 m metro grid.
python tools/build_terrain_relief.py "$DEM"/*.tif --metro "$GT/data/build/terrain/height_4m.npy"
# Directories containing the Poly Haven diffuse scans listed in the material builder.
python tools/build_ground_materials.py "$GT/data/raw/world_surfaces" "$MATERIALS"
python tools/import_canopy.py "$GT"
python tools/import_landmarks.py "$GT" --blender /path/to/blender
python tools/import_water_towers.py region.osm.pbf
osmium tags-filter region.osm.pbf n/highway=crossing n/crossing:markings w/footway=crossing w/cycleway=crossing -o crossings.osm.pbf
.venv/bin/python tools/import_crossings.py crossings.osm.pbf
.venv/bin/python tools/build_tiles.py
.venv/bin/python tools/audit_buildings.py > docs/building-coverage.csv

# sprite stacks (uses the vendored sprite-stacking slicer in tools/sprite-stacking)
.venv/bin/python tools/gen_vehicles.py
.venv/bin/python tools/gen_props.py
node tools/build_ground_patterns.mjs  # Bake ground materials with Chrome, cwebp and the local server
python tools/build_tree_crowns.py --blender /path/to/blender --models "$GT/art/blend/world/canopy"

# voices (Qwen3-TTS; separate venv)
<tts-venv>/bin/python tools/gen_voices.py
```

To bake only the imagery needed for a smaller edition, use a separate output directory. The builder encodes opaque imagery directly from the county mosaics using AVIF and preserves transparency along survey edges with WebP. It can resume a build with the same inputs and encoder settings.

```bash
python tools/build_full_terrain.py --native-area towns --out ../terrain-towns --decoder "$DECODER" "$NAIP"/*.sid
python tools/check_full_terrain.py --folder ../terrain-towns
npm run package -- compact --pyramid ../terrain-towns

python tools/build_full_terrain.py --level overview --out ../terrain-overview --decoder "$DECODER" "$NAIP"/*.sid
python tools/check_full_terrain.py --folder ../terrain-overview --overview-only
npm run package -- overview --pyramid ../terrain-overview
```

## Credits

The OpenStreetMap-derived map database is distributed under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Both [release downloads](https://github.com/nearbycoder/tulsa-overhead/releases/tag/v0.1.0) include the machine-readable regional data under `assets/map/r/`, alongside the route networks and map metadata. The repository includes the import and conversion scripts. Third-party licenses apply to their respective components.

- Streets and mapped features © OpenStreetMap contributors. Building geometry combines OpenStreetMap and Microsoft footprints through Overture Maps and the GT Tulsa project. The elevation survey uses USGS 3DEP lidar. [OpenStreetMap copyright](https://www.openstreetmap.org/copyright) · [Overture building sources](https://docs.overturemaps.org/guides/buildings/)
- Roof photography, sampled roof colors and the color-graded ground layer derive from the 2025 USDA National Agriculture Imagery Program Oklahoma county mosaics. [USDA imagery archive](https://nrcs.app.box.com/v/naip/folder/335607759930)
- Central metro tree placements adapt the 2024 High Resolution Canopy Height Maps from Meta and World Resources Institute, screened against USDA vegetation imagery. Source imagery for CHM © 2016 Maxar. [Dataset](https://registry.opendata.aws/dataforgood-fb-forests/). [Tolan et al.](https://doi.org/10.1016/j.rse.2023.113888) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Relief uses USGS 3DEP bare-earth elevation. High-detail ground materials use CC0 Poly Haven scans of Asphalt 04, Gravel Concrete 03, Gravel Floor, Red Brick Pavers, Rectangular Paving, Grass Ground and Brown Mud. [USGS 3DEP](https://www.usgs.gov/3d-elevation-program) · [Poly Haven texture library](https://polyhaven.com/textures)
- Surveyed landmark models and roof charts were adapted from the GT Tulsa project. The landmark surface atlas includes [Poly Haven materials](https://polyhaven.com/textures) ([CC0](https://creativecommons.org/publicdomain/zero/1.0/)).
- Sprite stacking: [danielwh2/sprite-stacking](https://github.com/danielwh2/sprite-stacking) (MIT).
- Voices: [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS).
- All characters, companies, vehicle brands and events are fictional. Real places appear only as setting.
