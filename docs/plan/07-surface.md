# 07 — Surface Level: Terrain, Craters, Erosion, Hydrology, Biomes

The deepest LOD: continuous terrain from orbit down to standing on the ground. Every surface is a consequence of the planet model (04/05): heat budget picks the tectonic regime, atmosphere picks the erosion suite, climate picks ice/water/biome placement, age picks crater density. No two world types share a generic "noise planet" look.

## Terrain architecture

- **Cube-sphere quadtree (chunked LOD)**: six root faces, each chunk a heightfield tile; subdivision by screen-space error; skirts/edge-stitching against cracks; morphing between levels to hide pops.
- **Height function = ordered layer stack**, each layer a pure seeded field over the unit sphere. Chunks at any depth evaluate the same stack at their resolution — coarse orbital views and close-ups always agree.
- Generation runs in workers (00 protocol); GPU compute variant later via WebGPU. Normal maps derived from heights at one level deeper than geometry for crisp lighting.
- Beyond heightfields: local detail (boulders, dunes ripples, ice blocks) as instanced scatter driven by the same fields; non-heightfield features (caves, overhangs, arches) deferred to a later SDF pass.

## Layer stack (composed per world type)

1. **Crust base / tectonics** (active worlds): plates from a seeded spherical Voronoi relaxation; plate motion vectors → boundary classification (convergent → fold-mountain ridged belts, divergent → rifts and mid-ocean ridges, transform → shear scarring); continental vs oceanic crust sets the bimodal hypsometry (Earth's two-level surface) ; hotspot trails (island chains aging along plate motion). Stagnant-lid worlds instead get shield volcano provinces, coronae, global resurfacing plains (Venus-style).
2. **Impact cratering** (every solid world): deterministic crater inventory per region cell sampled from the SFD, density from surface age *per province* (old highlands saturated, young plains sparse — the Moon dichotomy). Morphology by diameter and gravity: bowl (simple) → central peak → peak-ring → multiring basin; degradation state by crater age (crisp + rays → softened → ghost rims); secondary chains and ejecta blankets around the young ones. Atmosphere screens small impactors (min crater size from atmospheric strength) and erosion erases old craters on active worlds — Earth-like surfaces end up correctly almost crater-free.
3. **Volcanism**: shields, stratocone fields, calderas, flood-basalt plains, lava tubes/channels; active worlds get glowing vents/flows (night-side emissive with 08); cryovolcanism variant for icy bodies (smooth resurfaced plains, ridge extrusions).
4. **Erosion & sediment** (atmosphere/hydrosphere dependent):
   - **Fluvial**: flow-routing approximation on the coarse grid (upstream area → stream power) carving valley networks that refine self-similarly at depth; deltas and alluvial fans at outlets; paleochannels on worlds that lost their water (Mars-style).
   - **Glacial**: U-valleys, cirques, fjords where ice caps sat (climate history from the 04 EBM).
   - **Aeolian**: dune seas (barchan/linear/star by wind regime from the climate cells), yardangs, dust mantling — the dominant suite on thin-atmosphere deserts.
   - **Thermal/mass wasting**: talus slopes, slope-angle limits by gravity and material.
   - **Coastal**: shelf smoothing, cliff retreat along the sea level band.
5. **Hydrosphere placement**: sea level from water inventory vs basin volume (hypsometry integral) → oceans, seas, lakes in closed basins, river networks consistent with the fluvial layer; frozen equivalents (ice shelves, pack ice) by climate; exotic liquids on Titan-class worlds (methane lakes at the poles).
6. **Ice & snow**: cap extent and snowline elevation from the climate field, seasonal oscillation with time `t`; glacier tongues down high valleys; penitentes/sublimation textures on airless ice.
7. **Biome & ground cover** (worlds flagged habitable in 04): Whittaker-style classification (temperature × precipitation from the climate field, adjusted by elevation and latitude) → desert, grassland, forest, tundra, etc. as **palette + texture + scatter density** — vegetation-like coloration with seasonal hue shift; alien palettes derived from the star's spectrum (photosynthetic pigment optimum shifts under red suns). Life remains a visual/parametric layer; a deeper biosphere sim is a future extension.

## Material & color

- Surface color from **mineralogy first**: basalt/andesite grays, iron-oxide reddening as a function of oxidation history, sulfur yellows on Io-class, tholin rust on cold ice, carbonaceous charcoal, salt flats white. Palettes are generated per-world from composition, then varied by province.
- Splat-map blending (height/slope/latitude/moisture rules) with tri-planar projection on steep faces; macro-variation noise breaks tiling at all scales.
- Wetness/specular for shores and rain bands, subsurface-scatter approximation for ice and snow.

## Airless small-body mode (06 bodies)

Same stack minus tectonics/erosion suites, plus: non-spherical base shape (heights over the ellipsoid), local-gravity slope logic (regolith ponds in potential lows), space-weathering tint by exposure age, thermal-fatigue crack fields near the sub-solar track.

## Data shape

`SurfaceField { seed, layers: LayerSpec[], hypsometry, seaLevel?, provinces: Province[], palette }` → per-chunk `TerrainChunk { heights, normals, splat, scatter }` (typed arrays, transferable).

## Testing targets

- Determinism: chunk re-generation at any LOD and on any worker reproduces bit-identical arrays; parent/child chunk agreement at shared borders.
- Fixtures: Earth-like → bimodal hypsometry, crater-free, river networks reach the sea monotonically downhill; Moon-like → saturated highlands vs sparse maria, correct simple/complex crater transition scale for its gravity; Mars-like → volcano giants (low gravity → tall), paleochannels, polar layered ice.
- Statistical: crater counts per province match age × SFD; stream networks acyclic; sea level integral matches water inventory.
