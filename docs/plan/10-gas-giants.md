# 10 — Gas Giants: Living Atmospheres

The north star: a giant should read as weather, not wallpaper. Arrive at one and watch a specific, persistent, evolving atmosphere — storms that drift with their jets and age from white to red, bands that shear past each other in sim time with turbulence boiling at their edges, poles running their own regimes, night sides that glow with their own heat and flicker with aurora. Every feature a deterministic consequence of the planet's physics — rotation, interior heat flux, temperature, composition, magnetic field — per the emergent-over-painted rule: no painted noise without a model object behind it, and the same atmosphere at any sim time for the same seed.

## Where it stands (why they're boring)

The model is eight numbers (`GiantBanding`): band count, three flat colors chosen by temperature regime, a turbulence scalar, a spot size, a glow temperature. The shader draws sine-stripe bands with one fbm warp, thresholds noise into "storms" that never move or die, places the great-spot analog at the same latitude and longitude on every giant in the universe, and darkens the poles with a power law. The only motion is a near-imperceptible shear term. Every ammonia giant is the same three colors; every methane giant the same teal. Nothing has identity, and nothing happens.

## The reframe: from banding parameters to a circulation model

The atmosphere becomes first-class objects derived once per planet (a `circulation.ts` sibling to the surface params), and the shader becomes their renderer:

- **Jets**: alternating zonal jets u(φ). Jet count from the Rhines scale — rotation rate against convective vigor, with convective velocity from `interior.heatFluxWm2` — so fast rotators with hot interiors band finely and slow or cold ones band broadly, as physics says they must. Per-jet speed, width, and latitude seeded within physical envelopes.
- **Bands**: the cloud decks between jets — zones (anticyclonic, bright, high ammonia/water ice) and belts (cyclonic, dark, deeper decks). Each band carries width, hue, drift rate (its jet), and edge turbulence (the local shear du/dφ). Hues come from the temperature regime's cloud chemistry plus a per-planet chromophore draw — no two ammonia giants the same cream and tan.
- **Storms**: a deterministic catalog of discrete entities, not thresholded noise. Anticyclonic ovals seeded at band interfaces with a power-law size distribution; each has a birth epoch, lifetime, drift rate (the jet at its latitude), and an age-colored deck (fresh white upwelling reddening as chromophores accumulate, in the warm regimes). The population at any sim time is a pure function of (seed, t) — storms are born, drift, shrink, and die on camera. The great-spot analog becomes one long-lived catalog member with seeded latitude, drift, and slow wobble.
- **Poles**: their own regime, not a darkening term — a polar cyclone cluster (count from rotation via the polar deformation radius, Juno-style), an aerosol hood with its own hue, and for a seeded subset a standing polar-jet wave: the hexagon analog, wavenumber from jet speed and latitude, drifting slowly.
- **Aurora**: the interior model already carries `magneticFieldRelEarth`. Auroral ovals sized and offset by field strength and driven by the host star's activity (flare rate exists on the star model), rendered as additive polar rings — visible against the night side and the limb.

## G1 — The circulation model

- `src/universe/planet/circulation.ts`: `deriveCirculation(physical, seed)` → jets, bands, storm-catalog parameters, polar regime, spot analog, and an overall regime tag (`banded` / `locked` / `quiescent`). Pure and cheap; `GiantBanding` shrinks to a reference or retires.
- Physical scalings with tests: band count rises with rotation and heat flux (a 10 h Jupiter-analog lands ~10–14 bands, a 200 h sluggard 2–4); storm activity scales with heat flux; determinism (same seed, same catalog); locked worlds get the locked regime.
- Chromophore draw per planet: hue jitter and contrast within each temperature regime's chemistry envelope, disclosed as the one aesthetic degree of freedom.
- **Done when**: two same-class giants from adjacent seeds have visibly different band structures on paper (counts, widths, hues, storm counts), and every number traces to a physics input.

## G2 — Bands that move

- Shader v2: band edges, colors, and drift rates as uniform arrays (≤16 bands); per-band longitude offset accumulates with sim time, so adjacent bands genuinely shear past each other at the default planet time scale.
- Flow-noise churn: the cloud texture advects with the band's own motion (two-phase fbm blended by time), and edge turbulence — festoons, chevrons, Kelvin-Helmholtz curls — concentrates where the model says the shear is, scaled by it.
- Band-internal structure: sub-banding and deck granularity inside wide bands so close focus reads as cloud decks, not gradient stripes.
- **Done when**: thirty seconds of watching a focused Jupiter-analog at default time scale shows unmistakable differential motion and boiling band edges, and pausing time freezes an atmosphere that still looks alive in structure.

## G3 — Storms as objects

- The catalog renders: storm list as uniforms (≤24 live storms — lat, lon(t), size, age-color), ovals with rims and wakes; the shader carves each into its band with a turbulent skirt downstream.
- Lifecycle on camera: storms fade in at birth epochs, drift with their jets, decay; long-lived spot analogs wobble and slowly bleach or deepen. Speeding the time scale turns weather into climate — populations turn over.
- Convective outbreaks in high-shear belts of high-heat-flux giants: short-lived bright plumes (the catalog's small-fast tail).
- **Done when**: the spot analog sits at a different seeded latitude with different drift on every giant that has one, and watching at high time scale shows storms born, merging into the spot's wake, and dying.

## G4 — Poles and lights

- Polar cyclone cluster and hood from the circulation model; hexagon-analog standing wave on its seeded subset, drifting at its own rate.
- Aurora: additive oval rings at the magnetic poles (offset from spin poles by a seeded dipole tilt), intensity from `magneticFieldRelEarth` × host activity, brightest on the night limb; visible from the system view and from a moon's surface at night.
- Night-side lightning in high-turbulence belts: sparse deterministic flickers keyed to the storm catalog — subtle, a live-atmosphere tell.
- **Done when**: a pole-on approach shows a cyclone cluster inside a hooded cap instead of a dark gradient, and a night-side flyby of a magnetized giant shows the oval.

## G5 — The other giants

- Locked hot Jupiters: the `locked` regime replaces bands with day-night circulation — a superrotating equatorial jet, hottest point offset east of the substellar point, alkali-dark day side, the existing thermal night glow, and a cooler cloud crescent on the west terminator. No sine stripes.
- Ice giants: the `quiescent`/active split falls out of heat flux — Uranus-likes (cold interior) nearly featureless with a bare seasonal hood; Neptune-likes (hot interior) get episodic dark spots with bright methane-cirrus companions from the storm catalog, and thin sharp bands.
- Mini-Neptunes and small envelopes: hazier, lower contrast, fewer bands — already parameterized, now derived from the same model instead of a class flag.
- **Done when**: the four archetypes (warm banded, hot locked, cold quiet, cold active) are recognizable at a glance from the system view, and none of them share a palette draw.

## G6 — In the system

- Moon shadows on the focused giant: the eclipse-caster machinery exists (`setOccluders`) but the focused envelope never receives its moons — wire it, so transit shadows crawl across the deck (they already darken the moons the other way).
- Limb polish: a thin stratospheric haze shell — forward-scattering bright rim on the day limb, deeper limb darkening on the disc — replacing the single hard limb term.
- The view from the moons: verify the whole system reads from a moon's surface — bands, spot, aurora, transit shadows on the parent overhead (the moon-focus frame from milestone M8 makes this the best vantage in the game).
- Performance: everything stays one pass and uniform-driven — no textures, no extra render targets; the same material serves the distant node and the focused body.
- **Done when**: standing on a big moon at night, the parent shows moving bands, a drifting spot, an auroral oval, and a sibling moon's shadow in transit — at full frame rate.
