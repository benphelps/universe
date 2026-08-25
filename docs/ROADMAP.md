# Roadmap & Progress

Milestones build outward-in: foundations → one star → its system → its worlds → their surfaces → the galaxy around them. Each milestone ends with something visible and a test suite locking its physics. This file is the living progress record — check items off as they land.

## M0 — Foundations ([plan](plan/00-foundations.md))

- [x] Vite + TypeScript + Vitest scaffold, layering rule enforced by test (`core/`+`universe/` free of DOM/Three)
- [x] Seed tree + PCG32 + distribution toolkit, determinism property tests
- [x] Units/constants
- [x] Branded unit types at API boundaries: enforced `Mu`/`Seconds` brands on the Kepler/orbit functions (the AU-vs-SI and days-vs-seconds bug classes), producers branding once via `core/physics/units`; length/mass/time constants carry their unit types.
- [x] Kepler solver (elements ⇄ state, any-time propagation) + tests
- [x] Noise primitives (3D simplex, fBm, ridged, warp) seeded + worker-safe
- [x] Blackbody → CIE → sRGB pipeline + temperature-color LUT + tests
- [x] Worker protocol + scheduler skeleton (landed with M5: typed request/response protocol, terrain worker pool with transferables and nearest-first dispatch, sky worker with per-seed cache)

## M1 — The Star ([plan](plan/02-star.md))

- [x] IMF sampling, MS relations, evolution stages, compact objects, classification
- [x] Rotation/activity/variability (spots, flares, pulsators) as functions of `t`
- [x] Multiplicity (flat companion list; the full hierarchy tree lands with 03's system builder)
- [x] Star model test fixtures (Sun, M dwarf, red supergiant, white dwarf, brown dwarf) + population distribution tests
- [x] Render: HDR pipeline + tone mapping + bloom
- [x] Render: photosphere shader (granulation, limb darkening, spots), corona
- [x] Render: photometric star sprites — one magnitude/color mapping shared by the backdrop, the 3D neighborhood, and the system's own stars once their discs fall subpixel; brightness follows true camera distance everywhere
- [x] Demo: seed → star viewer (orbit camera around any generated star)

## M2 — The System ([plan](plan/03-system.md))

- [x] Disk recipe, planet slots, element sampling, stability filter
- [x] Zones (HZ, frost line, lock radius); binary S/P-type placement
- [x] Belts + resonance structure (Kirkwood arithmetic), reservoirs
- [x] Fixtures + statistics tests (occurrence, period ratios, stability)
- [x] Render: system map view, live orbital motion, time controls
- [x] Demo: seed → explorable system map with placeholder planet spheres

## M3 — Worlds ([plan](plan/04-planet.md))

- [x] Bulk/interior/mass–radius, rotation & tidal state, magnetic field
- [x] Atmosphere retention/composition/greenhouse; climate EBM + albedo fixpoint
- [x] Appearance parameters (terrestrial palettes, giant banding, methane tint)
- [x] Fixtures (Earth/Venus/Mars/Jupiter/Uranus analogs) + population statistics tests
- [x] Render: planet spheres with banded giants, atmosphere limb, clouds v1 (ground-level sky scattering lands with M5 surfaces)
- [x] Demo: planet view with correct phases and star angular size (eclipses arrive with M4 moons)

## M4 — Moons, Rings, Small Bodies ([plans](plan/05-moons-rings.md), [plan](plan/06-small-bodies.md))

- [x] Satellite budgets, channels, Hill/Roche placement, tidal heating states
- [x] Ring systems with resonance gaps; ring render (phase function, shadows)
- [x] Belt cell instantiation, asteroid shapes/spins, comet activity + tails
- [x] Fixtures (Io calibration, impact moons, resonant chains, Saturn-class rings) + SFD tests
- [x] Render: comet apparitions, moon orbits with eclipse shadows, ring shadows (belt fields landed in M2)
- [x] Asteroid close-up rendering: notable belt asteroids are focusable bodies whose shape spec (ellipsoid axes, contact binaries, seeded lumps) becomes streamed terrain.

## M5 — Surfaces ([plan](plan/07-surface.md))

- [x] Cube-sphere quadtree LOD + worker chunk generation (skirts hide LOD cracks; geomorphing remains the one open M5 polish item, tracked under M7 performance hardening)
- [x] Layer stack: tectonics (Worley plate belts), craters, volcanic provinces, erosion smoothing
- [x] Deeper erosion suites: fluvial valley networks (dendritic ridge-crest carving with tributaries, elevation-scaled depth), glacial carving (freeze-masked trough cutting plus fine-relief smoothing), and dune fields (wind-aligned draa-scale transverse ripples over erg patches with sand tinting) — all pure, LOD-faded, and climate-gated.
- [x] Ice/snow + biome palettes from climate
- [x] Airless small-body surface mode: a dedicated asteroid surface field (shape lobes + saturated craters + regolith cascade to boulder scale) runs through the same cube-sphere streamer; the body stepper walks planets then each belt's landmark rocks.
- [x] Determinism/border tests + world-type fixtures (Earth-like, Moon-like, Mars-like)
- [x] Render: vertex-colored lit terrain, ocean sphere, ground-level sky + aerial fog
- [x] Scatter instancing: worker-placed deterministic boulders (with an airless large-block tail) and biosphere ground cover, instanced per tile with terrain lighting/fog and proximity-based visibility.
- [x] Demo: orbit → descend to the ground of any solid world, unbroken

## M6 — The Galaxy ([plan](plan/01-galaxy.md))

- [x] Density model (disks, halo, arms, dust) + deterministic sector sampling
- [x] Population gradients feeding star properties: thin-disk/thick-disk/halo mix drawn from the local density model, with disk radial metallicity gradient, old metal-poor thick disk, and ancient halo; shared draw sequence keeps sky photometry and generated stars in agreement.
- [x] Procedural sky from local sampling (resolved shells + Milky Way glow with dust reddening) in every view
- [x] Clusters, OB associations, nebulae — emergent from the model: giant molecular clouds are first-class objects (deterministic cells, dust- and arm-weighted, gathered into kpc-scale complexes) with anisotropic noise-carved density fields; the Milky Way glow extinguishes through them so every dark rift is a specific cloud; young groups form inside clouds and the lit natal cloud is the nebula — ray-marched through its own density field with illumination from the embedded group and self-extinction, colored by ionization physics from the hottest member (Hα → O III with temperature, blue reflection below the ionizing threshold) — baked to a sprite atlas in the sky worker; dispersed older clusters ride as bare coeval knots. Glow mean luminosity is IMF-derived; the galactic center sits dozens of optical depths deep, as observed.
- [x] Magnitude-count regression test (naked-eye counts the right order of magnitude)
- [x] Demo: galaxy view of the real 20 pc neighborhood; click a neighbor to travel — its system is waiting

## M7 — Depth & Polish

- [x] **Unified body viewer** (step 1 of the single universe renderer): planet + surface merged — solid worlds are streamed terrain at every altitude, envelopes are shader spheres, everything else (sun, moons, eclipses, rings, atmosphere, backdrop) shared in one scene.
- [x] **Single universe renderer, step 2**: star view and system map folded into the body scene — the unified viewer holds the whole system (real photospheres, planets on their orbits, belts, comets, companions) around whichever body has focus; star/system/planet are camera presets, the map is an orbit-line overlay that appears at map altitudes, and one wheel ride runs from the system's rim to a planet's ground.
- [x] **Single universe renderer, step 3**: galaxy view folded in — the 30 pc neighborhood rides in the scene as true 3D points that double as the night sky's near field (the backdrop keeps only far shells and the Milky Way glow), so every view is a preset of the one renderer and a single wheel ride runs from interstellar space to any planet's ground. Travel to a neighbor rebuilds the system in place. Open: whole-disk galaxy rendering beyond the neighborhood (clusters/nebulae land with the M6 leftovers).
- [x] Clouds over terrain: a translucent deck shell above the highest terrain, sharing the shader-sphere planets' drifting cloud field (the focus view keeps the climate the far view promised), with close-range detail fade-in and a pass-through fade. Open: cloud shadows on the ground; volumetric decks stay a later item.
- [ ] Volumetric clouds; multiple-scattering atmospheres; black-hole lensing pass
- [x] Real far starfield: the statistical shells are gone — every glint in the sky is a catalog star with a seed, hoverable and travelable like the neighborhood. Stars carry their identity (mass, age) in seed bits through the explicit IMF/population inverse CDFs, so the catalog constructs seeds for exactly the bright young stars a far cell can show while arbitrary seeds keep the same distributions; survey depth is mass-stratified (0.91 M☉ turnoff / 2.2 / 7 M☉ out to 90/150/600/2500 pc). Open survey-depth items: sub-turnoff giants beyond 150 pc, hot young white dwarfs beyond the near field, per-star dust extinction, unresolved-binary brightening; cluster/group members are identifiable but not yet individually addressable (their ages live outside the population model)
- [x] Whole-galaxy view: the galaxy renders as a raymarched volume of the same density model the sky integrates — the identical emission/dust/knee/reddening constants as the glow map, marched per pixel from wherever the camera is (fine steps across the disk slab, coarse through the halo). It crossfades in as the sky-sphere backdrop's parallax breaks down (60–450 pc out), the altitude ceiling now reaches 45 kpc, and the wheel rides toward the panned anchor at large scale so zoom goes where you look. Spiral arms, bulge, disk, and dust patchiness all emerge from density.ts; the volume's ray geometry provably matches the 3D neighborhood layer. Open polish: dust lanes aren't arm-correlated (the cloud population doesn't know about arms yet), the clump noise is the statistical limit of the cloud field rather than the clouds themselves, and no bright-star sparkle rides the volume
- [ ] Galaxy population: the universe currently holds one Milky-Way-like spiral; derive multiple galaxies (ellipticals with smooth band-less glows, irregulars, dwarfs) from parameterized density models so a seed's sky depends on which galaxy — and where in it — the system lives
- [x] Belt materialization: belts are full populations — orbital cells (semi-major-axis band × epoch mean-longitude sector, Keplerian-shear-predicted) instantiate deterministically near the camera; each member is a true body rendered as a shaped spinning rock when resolved and a reflected-sunlight glint (with a faint marker floor) when subpixel, and clicking any of them promotes it to a full streamed-terrain focus body. The additive point cloud remains the far-field statistical limit; counts follow a main-belt-normalized SFD, so belts are honestly sparse.
- [ ] Exotic showcases: circumbinary worlds, eyeball planets, Io-class volcanism, pulsar systems
- [ ] Ground-frame completeness: ring shadows on terrain; asteroid focuses ignore their random spin axis in the frame the way solid planets honor obliquity
- [x] Free flight, step 1: right-shift + drag pans the camera through space in every view — a screen-plane grab scaled by altitude (meters over a ridge, parsecs across the neighborhood), with altitude re-derived from wherever the camera ends up instead of snapped to the focus sphere, the terrain floor as a hard clamp, and the orbit pivot traveling with the pan (re-anchoring on focus change). Wheel ride, orbit drag, hover picking, and terrain streaming all compose with it. Scoped to the space views: on the ground (solid focus below the horizon-gaze altitude) the original surface controls stand untouched, and descending there re-anchors the orbit on the body — WASD walking is its own future feature
- [ ] Surface free camera, step 2: WASD + mouse-look movement on the ground. The ground-fixed frame is built for this — terrain vertices are static world geometry, up is radial, and the sky/frame contract (see frameQuat in unifiedViewer) keeps every sky object correct regardless of how the camera moves
- [ ] Performance hardening (belt LOD, chunk budgets, memory eviction, terrain geomorphing)
- [ ] WebGPU renderer evaluation

---

## Log

- **2026-08-23** — Repository created; architecture and all level plans (00–08) written.
- **2026-08-23** — M0 core landed (seed tree, RNG/distributions, Kepler solver, noise, spectral color pipeline) and M1 star level landed (full generator with evolution/classification/activity/multiplicity, HDR photosphere+corona rendering, interactive viewer). 33 tests green; verified in-browser across K/M/A dwarfs and a red giant.
- **2026-08-23** — Corona reworked into a star-anchored 3D field: true parallax when orbiting, co-rotation with the surface, activity-driven structure over spot bands.
- **2026-08-23** — M2 system level landed: disk→slots→elements→stability generation with S/P-type binaries, zones, Kirkwood belts, reservoirs, and end-state effects (engulfment, supernova sterilization); system map view with live Keplerian motion and shearing belts. 45 tests green; verified in-browser on a circumbinary resonant chain and an M-dwarf eyeball-world system with a gapped asteroid belt.
- **2026-08-23** — M3 planet level landed: full characterization (bulk, interior, rotation, atmosphere retention/greenhouse, climate fixpoint with snowballs and biospheres, appearance) plus planet rendering (solid worlds, banded giants, scattering limbs) and a true-scale planet view with exact phases. 54 tests green; verified in-browser on a biosphere crescent, a banded gas giant, a brown-dwarf-lit mini-Neptune, and a locked ocean world.
- **2026-08-23** — M4 moons/rings/small bodies landed: satellite systems with Io-calibrated tidal heating (volcanic/cryovolcanic/subsurface-ocean states), Roche-limit rings with moon-resonance gaps, deterministic belt asteroid instantiation, and comets. Rendering: analytic eclipse shadows (moon transits, ring shadow bands), forward-scattering rings, live moons in the planet view, comet apparitions in the map. 67 tests green; verified on a ringed super-Jupiter around an L8 brown dwarf.
- **2026-08-23** — Comet legibility and moon discoverability fixes: activity-capped comas, physical dust-tail lag, motion trails; moon orbit guides and adaptive marker dots in the planet view.
- **2026-08-23** — M5 core landed: pure surface fields (plate-belt mountains, lattice-cell craters, erosion, solved sea levels, climate-driven color), worker-streamed cube-sphere quadtree terrain with floating-origin rendering, and the surface view descending from orbit to the ground. 75 tests green; verified on a crater-field Mercury analog and a locked habitable world. Open: fluvial/glacial erosion detail, scatter instancing, geomorphing, asteroid surface mode.
- **2026-08-23** — Surface shakedown from live testing: OrbitControls-based camera (no more flipped axes), seam-free border-ring normals, priority-ordered chunk requests, detail-band cascade to ~100 m features with LOD fading, chunk-aligned water tiles (ocean z-fighting gone), GPU mottling and micro-relief shading, relief-scaled color windows, minimum LOD floor for orbital views.
- **2026-08-24** — Single-renderer step 2: star, system, and planet views unified into one focus-centric scene (km units, focused body at the origin, everything else translated in doubles). The real photosphere is now every planet's sun — the additive sun proxy is gone — with companions on barycentric orbits, other planets at true positions with adaptive markers, belts/comets/zone rings folded in, and the orbit-line map as an altitude-triggered overlay; the sky dome went additive (scattering adds light, never occludes) and scales with surface pressure. One wheel ride runs from the system's rim to any planet's ground. Verified on a 12-planet G system (all presets, click-through, planet→system zoom-out) and a circumbinary brown-dwarf pair.
- **2026-08-24** — Milestone backlog cleared (every M0–M6 checkbox): galactic population mix feeding stellar age/metallicity; open clusters, OB associations, and nebulae in the sky (plus the galactic-bulge glow fix from live testing); photometric star sprites unified across all views; fluvial/glacial/dune erosion suites; asteroid close-ups as focusable streamed-terrain bodies; instanced boulder/ground-cover scatter; branded unit types at the orbital-mechanics boundary. Only M7 depth items remain.
- **2026-08-24** — Single-renderer step 3: the galaxy view retired as a separate renderer. The neighborhood (every sector star within 30 pc) is now 3D content of the unified scene under a pc-scaled group, photometrically identical to the backdrop stars it replaces but parallax-correct at every altitude; the backdrop carries only far shells and dust glow. Galaxy is a camera preset (focus star, 15 pc altitude, time frozen); the travel panel swaps systems inside the same viewer. Belt point clouds fade below sub-pixel size so distant systems don't bloom into false blobs; near/far planes scale into the interstellar regime. Verified: galaxy preset, neighbor travel (G dwarf → L6 brown dwarf), system→interstellar wheel-out, and the ground night sky retaining its near field.
- **2026-08-23** — M6 core landed: galactic density model with deterministic sectors, per-seed sky fields (resolved star shells + dust-reddened Milky Way glow) rendered as backdrops in every view with daylight washout on surfaces, and the galaxy view — the real 20 pc neighborhood, flyable, with click-to-travel to any neighbor system. 83 tests green. Open: population gradients into star properties, clusters/nebulae.
- **2026-08-25** — The band pointed the wrong way, and the whole-galaxy view caught it: the glow/rift maps are written with longitude in [0, 2π) but were sampled with an atan2 origin plus a half-turn — every interior sky's Milky Way band has been rotated 180° in galactic longitude since the glow map existed, its bright bulge end pointing anti-center, silently contradicting the far-star density gradient and the cloud sprites. Unnoticeable from inside; blatant the moment the volumetric galaxy rendered the truth beside it (reported from flight as "the angle is correct, but it's flipped" — exactly a longitude half-turn). One-line sampler fix; backdrop and volume now hand off seamlessly. Also: the far catalog stars are now true 3D points (direction × distance in the neighborhood frame) instead of a sky-sphere shell — parallax-correct at every altitude, they persist through the backdrop→volume crossfade (only the unresolved-glow representations swap), and hover/travel picks them at their real positions.
- **2026-08-25** — Moons rise and set: moon groups now carry the ground frame's diurnal sweep (spin only — the equatorial plane doesn't lean), so moons wheel across a fixed landscape like the sun and stars, lagging by their orbital rate, instead of hanging geostationary over one longitude with half of them below the horizon for weeks. The frame's spin sign flipped to prograde while wiring it: the sky had been sweeping opposite the planets' revolution, so every solid world was silently a retrograde rotator — now base spin matches the revolution (and the envelope planets' band direction), and genuinely retrograde worlds still emerge from obliquity > 90°, verified on a 150°-tilt rocky whose solar day correctly runs shorter than its sidereal day. The frame contract is documented in one place (frameQuat): new sky content parents under a frame group and is correct by construction. Considered and rejected: rotating the camera with the planet instead — a planet-radius terrain mesh spinning under float32 transforms jitters at the meter scale at ground zoom; static terrain is also what makes the planned surface free-camera easy.
- **2026-08-25** — Rings recovered on solid planets: since the unified body viewer, a terrain-focused planet's rings were added flat in the ecliptic — the very plane the sun moves in — so they sat at permanent equinox, edge-lit down to the shader's 5% floor, and read as lost (gas giants kept theirs because PlanetObject tilts its whole group). The fix models the cause: the ground frame now composes the planet's axial tilt with its spin, so the ecliptic — sun, planets, belts, sky — leans by the obliquity while rings and moons keep the equatorial plane, and seasonal sun declination emerges for free. Browser-verified on a 34°-tilt ringed rocky (ring lit and planet-occluded) with the icy-giant view unchanged. Remaining truth, not a bug: solid-planet rings are all faint dusty debris (τ ≤ 0.08) in the model, honestly near-invisible; the showpieces are the icy giants. Follow-up by request: a disclosed legibility lift in the ring shader (compressive optical-depth curve, softer illumination floor — the belt-glint marker-floor convention) so dusty rings read as a faint band, and ringed worlds now greet the camera from ~29° above the ring plane, since an in-plane arrival collapses any ring to a one-pixel sliver.
- **2026-08-25** — Real far starfield: the star catalog. A star's initial mass and population age now live in its seed (bit fields of the invertible mixed seed feeding the IMF and population-mixture inverse CDFs), and the galaxy's stellar field is realized as mass×age-stratified Poisson cells — fine cells for the faint bulk and the post-luminous slices, coarse cells for the rare bright young strata so the sky sweeps them to 2500 pc. The statistical far shells are deleted: every sky point is a real star whose seed travels, with hover showing its true spectral type and distance (a universe re-roll: all seeds keep their hex but resolve to new stars). 96 tests green; browser-verified hover identities across the sky and click-travel to a 313 pc B9V.
