# 11 — Nebulae: Clouds You Can Fly Into

The molecular clouds are already first-class 3D objects — they carve the rifts, seat the constellations, name the provinces, and light up when their newborns switch on. What is missing is only the last step: the nebula is flattened to a 48² atlas tile marched from one fixed direction and pasted on a camera-centred dome, so it never parallaxes, never grows, and cannot be entered. Governing rule: **one density field, three tiers of the same volume** — the sprite becomes a render *of* the volume rather than a separate representation, and light comes from the ionizing budget of the stars that are actually there, never from a palette.

## What is already true

- `cloudLocalDensity` (`universe/galaxy/clouds.ts`) is a real anisotropic 3D field: stretched Gaussian envelope × three octaves of seeded simplex, carved at a threshold so silhouettes are filamentary rather than spherical.
- The embedded group is real: `buildGroups` draws coeval members inside the cloud and pushes them into the catalogue, so a nebula's exciting stars are already 3D objects at their own positions.
- The glow already extinguishes through these same clouds, so a rift and its nebula are one object seen two ways.
- `renderNebulaTile` already ray-marches the field, 16 steps with self-extinction. It is the right integral, evaluated once from the wrong place.

## The gas bridge (do this first)

`cloudLocalDensity` returns a dust-density multiplier, not cm⁻³ — but it is not arbitrary. `DUST_OPACITY_PER_PC = 0.045` fixes visual opacity per parsec of unit density, and with the model's own solar-circle dust and clump values that reproduces ≈1 mag/kpc of local visual extinction. The physical scale is therefore already pinned; it just has never been read out. Make it explicit:

- τ_V per pc = density × `DUST_OPACITY_PER_PC`; A_V = 1.086 τ_V.
- N(H) / A_V ≈ 1.87 × 10²¹ cm⁻² mag⁻¹ at R_V = 3.1 (Bohlin/Savage/Drake, Draine) → n_H in cm⁻³ per parsec of path.
- Dust-to-gas scaled by the local metallicity the galaxy model already carries, so metal-poor outskirts have less dust per hydrogen and bluer, thinner clouds.

Pin it with a test the way the cloud field's Monte-Carlo constant is already pinned: sampled cloud masses must land on the observed GMC mass function, mean densities in the observed 50–500 cm⁻³ band, and surface densities near Larson's ≈100 M☉ pc⁻². Without this, every recombination number downstream looks scientific while resting on an arbitrary scale.

### What the bridge measured

Read out at the solar circle, the calibration validates at the diffuse end and fails at the cloud end:

| quantity | model | observed |
|---|---|---|
| diffuse ISM n_H | 0.52 cm⁻³ | ~0.5–1 |
| visual extinction | 0.86 mag/kpc | ~1 |
| O5V ionizing output | log Q = 49.4 | 49.1–49.3 |
| GMC mass (median, r > 20 pc) | 3.2 × 10³ M☉ | 10⁵–10⁶ |
| GMC mean density | 0.28 cm⁻³ | 50–500 |
| GMC surface density | 0.41 M☉ pc⁻² | ~100 (Larson) |
| central extinction | 0.11 mag | several magnitudes |

The diffuse medium is right, so `DUST_OPACITY_PER_PC` is a sound anchor. The clouds are not: they carry ~3% of the local dust column where molecular gas carries tens of percent, and they spread what they carry over the whole cloud instead of concentrating it into the filaments that fill a percent of it. The consequence is not cosmetic — every forming cloud measured comes out with a Strömgren radius of 70–370 pc, larger than the cloud, so the ionization march would find nothing neutral left to shadow, and there would be no pillars, no dark cloud and no structure to see.

So the density pass is a prerequisite for the bake, not a polish item, and it is two coupled changes rather than one constant: move mass into the clumped component *and* out of the smooth disk (the extinction calibration above is anchored on their sum), then concentrate the carve so the filling factor falls. A third, smaller one belongs with it: members are placed on a Gaussian about the cloud centre rather than sampled against the density field, so a nebula's own stars can sit in holes it carved.

## The `Nebula` object

Extract `nebulaFor(cloud): Nebula | null` from `buildGroups` into `universe/galaxy/nebula.ts`, viewpoint-independent, carrying:

- cloud centre, extent, density seed; calibrated gas mass and mean density; metallicity and dust-to-gas.
- the individual ionizing sources — position, L, T_eff, and an ionizing photon rate Q derived from the star's own spectrum, not a class lookup.
- classification: emission, reflection, mixed, dark.

Both the sky worker and the volume tier call it; neither owns it. Query the population by **camera** galactic position through the existing `cloudsNear`, not by the origin system's viewpoint — otherwise the nebula set goes stale the moment you fly. Drop the `distance < 50` guard, which exists only because a sprite cannot represent a cloud that fills the sky; those are precisely the clouds worth entering.

## The bake

One RGBA8 3D texture per resident nebula, built in a worker:

| ch | content | consumer |
|---|---|---|
| R | dust density | extinction, reddening, star attenuation |
| G | ionized emission measure (∝ nₑn_p) | line emission |
| B | ionization hardness / log U | line-ratio → RGB LUT |
| A | irradiance from the group after source-to-voxel attenuation | reflection, emission gating |

A and B are the physics. Strömgren sets the scale — R_S = (3Q / 4π α_B n²)^⅓ with α_B ≈ 2.6 × 10⁻¹³ cm³ s⁻¹ at 10⁴ K, giving ≈3 pc for an O5 (Q ≈ 10⁴⁹ s⁻¹) in n = 100 cm⁻³, which is Orion — but the shape comes from marching the photon budget through the real field. Start with one dominant source and a single shadow ray per voxel; go to multiple sources and photon-conserving propagation only after profiling.

**Pillars are an erosion pass, not a shadow.** Ionization shadowing alone gives dark wedges behind clumps; it does not give elephant trunks, cometary heads, swept shells, or photoevaporative flows — those come from gas being removed and driven, which is radiation-hydrodynamics. We do not simulate that per frame, and we do not paint it either. We run it at generation time, exactly as the terrain runs fluvial and glacial erosion: iterate the ionization front a few passes, removing gas where the incident ionizing flux exceeds the photoevaporation threshold, so dense clumps shield the column behind them and trunks survive pointing back at the source, with a cavity and a swept rim around the group. Frozen morphology, produced by a process, honestly described as quasi-static.

Resolution carries *identity*, not detail: 64³ (1 MiB) for the mid tier, up to 128³ (8 MiB) for a cloud you can enter, with unseeded octaves added below voxel scale in the shader. This is the same line the model already draws between `cloudLocalDensity` and `cloudSmoothDensity` — sub-sample turbulence is statistical, and the seeded bake is what keeps the rendered nebula the same object as the rift, the constellation and the name. It also sidesteps the fact that the CPU simplex (seeded permutation) and the GLSL one (Ashima's fixed table) cannot agree numerically.

Bakes go in their own cancellable worker that participates in the existing `generationScheduler` priorities, not in `skyBackgroundWorker` — that one exists to hand back gas, dust and glow early, and camera-driven volumes can be obsoleted mid-bake anyway.

## The render pass

A camera-locked carrier dome, exactly like `GalaxyVolume`, with ray/ellipsoid intersection done analytically in the fragment shader from cloud centres passed as uniforms and the march run in parsecs. This is forced, not stylistic: `camera.far` is reset every frame to `max(distance × 2.5, 75 pc)`, so a bounding-sphere mesh at a 200 pc cloud's true position is simply clipped away when the camera sits in a system. A carrier also lets one pass march several clouds sorted front-to-back, which fixes ordering between overlapping nebulae and composites coherently with the galaxy volume behind them.

- front-to-back radiance and transmittance, 32–64 jittered steps, blue-noise start offset, envelope-based empty-space skipping, early termination.
- explicit half-resolution target with temporal reprojection: the composer runs at up to 2× device pixel ratio, so a full-res march is four times the naive estimate.
- correct behaviour outside *and* inside the volume.
- LOD by projected pixel radius and a global sample budget, never a fixed distance — cloud radii span 10–65 pc, so a large cloud at 300 pc can outweigh a small one at 100 pc.
- the far tier keeps a sprite, but recomputed from the true camera-to-cloud vector each frame so it parallaxes, and crossfaded against the volume by the same projected size. Mind the 60–450 pc backdrop-to-galaxy-volume handoff: that band is exactly where a nebula stops being sky and becomes an object.

## Compositing against the star field

Premultiplied output — `ONE, ONE_MINUS_SRC_ALPHA` gives C = L + T·C_behind — is correct for the volume against opaque geometry, and is enough for the first prototype. It is not enough for stars. Star points are additive, write no depth, and clamp distant depth to the far floor, so no depth buffer can say whether a star is in front of, inside, or behind a cloud.

The primary fix is per-star transmittance: an 8–16 step march of the resident volumes in the star vertex shader, attenuating `energy` and reddening by the R_V curve. A few thousand points is nothing, and it delivers the effect that actually sells a cloud as a physical object — the star field dimming and reddening *behind* it, which is the same extinction the Milky Way glow already computes through these clouds. Alternatives if that measures badly: a star-distance buffer, or chunked depth-ordered star draws.

## Colour

Line ratios through the CIE path, not a hue ramp. The CMFs are analytic Wyman lobes, so add `spectralLinesToXyz(lines)` evaluating x̄/ȳ/z̄ at exact wavelengths — `spectrumToXyz` samples on a 5 nm grid and would drop Hα 656.3 between samples.

- Hα 656.3 at 2.86 × Hβ (Case B, 10⁴ K), Hβ 486.1, [O III] 4959/5007 rising with hardness and ionization parameter, [N II] 6548/6583 and [S II] 6716/6731 in the low-ionization skin at the front.
- **The grid landed**: the mixture runs over (T_eff, log U, Z) — [O III] gated by the star's ability to make 35.1 eV photons and carrying the electron-temperature inversion (peak excitation at LMC-like metallicity, unity at solar by construction), [N II] steepening as secondary nitrogen, [S II] linear in Z, both strongest at low U; anchored on Orion (~3 at 5007/Hβ), 30 Doradus (~6) and the B-star ceiling (nothing teal below ~33 kK, at any U). Each nebula's bake samples the grid at its own star and gas, the cells' baked U interpolating between; sprites read the same grid at a representative U.
- Because Z enters, nebular colour varies with galactocentric radius on its own — pinned by the inversion test.

Three display modes, all honest, differing only in the instrument:

- **natural vision** — physical surface brightness through the existing HDR/ACES exposure; at these levels the eye is scotopic, so mostly grey glow with extinction and silhouettes reading stronger than colour.
- **true-colour camera** — the same radiance at photographic exposure, the actual visible line wavelengths.
- **mapped narrowband** — Hα/[O III]/[S II] to RGB, labelled as the false-colour mapping it is.

## Reflection

**Landed.** The table is `universe/galaxy/dustScattering.ts`: successive orders of
scattering around a point source in an infinite homogeneous medium of the
model's own albedo and asymmetry (both now constants in `density.ts`),
deterministic, ~33 ms solved once per session, 96 log-spaced optical depths ×
64 angles. Normalized so first order alone is `e^(−τ)·Φ_HG(μ)` — the exact
factor the frame shader used when it was single-scatter — so the table dropped
into its place: the shader indexes it by the depth the bake actually marched
(channel A) and the scattering angle, which keeps clump shadows carved at
first order and fills them with softly diffused light at the higher ones.
Measured against single scattering: ×1.1 at τ = 0.1, ×3 at τ = 2, ×14 at
τ = 10, with the forward peak washing out as depth grows — pinned structurally
in `dustScattering.test.ts`. The chromatic piece rides the same fetch:
A_B/A_V = 1.324 and A_R/A_V = 0.748 (R_V = 3.1, V on green) scale both the
scattering coefficient and the per-channel depths, and the march's
transmittance went vec3, so the nebula's own deep light reddens exactly as
transmitted starlight does while thin columns scatter blue out. The blue of a
reflection complex is now an emergent flux ratio, pinned against a grey twin
march (scattered-only B/R runs ~3.3–4.4 against ~3.05 grey on the dusty
subjects; a source buried deep enough reddens instead, and the direction
belongs to the column). The sprite tier's scattered continuum wears the
luminance-normalized ratio tilt (`SCATTER_TINT_RGB`), standing in for the
per-λ march only the volume runs, and its scattered *budget* is the
model's own interception: the group's continuum marched from the
illuminant through the region's re-plumbed dust with exact per-step
capture, times the albedo (`Nebula.scatteredShare`, 0.002–0.2 across the
home regions — the constant 0.3 it replaced overstated most clouds by an
order of magnitude). The dense-core R_V ≈ 5 variant remains unmodelled.

## Not in scope

Radiation-MHD at any point. Runtime photoionization solving. Planetary nebulae and supernova remnants — they need their own shell, bipolar-flow and shock-filament generators, and they do not exist as generated objects yet, so they would expand this task rather than shorten it. H II regions already have identity, density, embedded groups, tooltips, atlas images and travel items: they are the shortest path to proving the renderer.

## Staging

1. `Nebula` model, gas calibration, camera-driven query. No render change; testable alone. **Landed.**
2. The density pass: cloud gain against the extinction and molecular-mass anchors, carve concentration, members drawn against the field. **Landed** — clouds now hold 3.1 M☉/pc² of molecular gas across the disc at 1.0 mag/kpc of extinction, GMC masses run 10⁴–10⁶ M☉, sightlines through a cloud reach several magnitudes, ionizing stars stand in gas at ~160 cm⁻³, and Strömgren radii fall to a few percent of the cloud so there is neutral gas left to shadow.

   The two anchors that hold are the disc-averaged molecular content and the extinction. The per-cloud figures are weaker than the table above implies and should not be read as calibrated: measured over the local large-cloud sample, mean density comes to ~8 cm⁻³ and surface density to ~12 M☉ pc⁻², against catalogue medians nearer 50 (Miville-Deschênes 2017; Chen 2020 find a broad 2–300 range, so these sit inside the observed spread but at its thin end). Closing that means concentrating the carve further without moving the two anchors, which is its own pass.
3. One bright H II region, 64³ bake, single dominant source, single shadow ray. Carrier dome, premultiplied blending, sprite path untouched so the two sit side by side. **Landed**, with two corrections the bake forced. The box is the ionized bubble, not the cloud: a Strömgren radius of 2.4 pc inside a 200 pc cloud puts the whole nebula inside one cell of any grid that covers the cloud, and the cloud beyond the box is already drawn as the dark rift it is. And the turbulent cascade had to continue: three octaves pitched to the cloud radius are smooth at the bubble's scale, so the first front came out a bare sphere — three more octaves, same falloff, for the one consumer whose cells can resolve them, and the front now runs 2.75/4.50/8.50 pc across directions.
4. Per-star transmittance and scene-depth clipping. **Landed.** Occlusion by solid geometry was already correct — the carrier dome is depth-tested at the far plane, so a planet in front simply wins — but the star field needed the march: points are additive and write no depth, so each star now marches the volume over the stretch of its own sightline that falls inside the box, dimming and reddening on the R_V = 3.1 curve. Measured against the same frame with the march disabled: 1791 pixels change, every one of them dimmer, and the surviving fraction runs 0.773 red / 0.733 green / 0.692 blue. Brightness is no longer a dial either — the star's ionizing budget fixes L(Hβ), the line mixture carries the rest of the optical spectrum, and the gas divides that light by n², leaving one shared renderer constant for surface brightness.
5. Photoevaporative erosion pass and the line-ratio LUT — the step where the picture becomes physics rather than fog. **First slice landed**: the region gets its age — Spitzer D-type expansion scales the natal front by R(t)/R_s with the interior diluted n ∝ R^{-3/2} (budget-conserving exactly, pinned by test), a swept shell at the front, and the ionization march run in contracted coordinates so the carved directional shape survives the growth. An 11 Myr region is tens of parsecs, visible at cloud scale, which is what closed the sprite→volume "pink object vanishes into a blue dot" seam. Both renderers now colour from the same budgets — `nebulaEmissionShare` weighs line output against scattered continuum surface brightness, so O groups read pink and B groups read blue in sprite and volume alike, replacing the hand-mixed maxTeff hue ramp. **Second slice landed — the wind cavity**: the dominant source's line-driven wind (momentum snowplow, ṗ = ηL/c through the diluted interior; Weaver's energy-driven form overruns observed cavities and is deliberately not used) hollows the bubble and piles the displaced gas into a photoionized wall, so an evolved region reads as the limb-brightened ring it actually is instead of a filled disc — cavity/bubble ratios land at the surveys' 0.3–0.7, B-led groups whose hottest member cannot drive a line wind keep their filled cocoons, and the emission books stay closed because the finish renormalizes total line light to the ionizing budget wherever the density moves. Pinned by a ring test; mirrored in the GPU march and re-A/B'd (coefficients to 0.07%, ionized channel to 3/255). **Third slice — champagne venting**: ten-thousand-kelvin gas holds together only where the cloud around it can confine it, so the interior keeps its density gated by the natal field at each cell (quasi-static, like the rest of the bake) and streams to a residue where the bubble has outrun the cloud's body — the gate is the cloud's own carved boundary, so a face-blister opens into a horseshoe and rims go ragged along real filaments. Pinned by an A/B against the disarmed gate (thin-gas sectors lose ≥65% of their emission, fully confined cells pass untouched); the march itself supplied the deeper truth that dense front cells barely exist, since a dense direction stops its own ray. **Fourth slice — supernovae and the lit front**: members drawn past their model lifetime are struck from the group — no million-kelvin remnant sets the hue or sits in the source list any more (the ledgered "dead members as ionizers" oddity, resolved) — and each death feeds the swept cavity its terminal momentum (3×10⁴³ g cm/s, sixtyfold the whole wind's ṗt), so a group's first supernova blows its region toward the 0.9-bubble cap and an old region is a thin broken shell. And what finally killed the wrapped-on-a-sphere look: the swept shell's inner *skin* is now ionized — the front eating into the shell is where recombinations concentrate — so the glow follows the budget march's own carved, directional front instead of leaving all the light to the spherical wind wall. The march itself taught the tests two things on the way: dense cells at the front barely exist because a dense direction stops its own ray, and venting claims exactly the farthest-reaching thin channels. **Fifth slice — photoevaporative erosion**: the budget march fixes where the mean front got to, but what the front eats there is the *uncontracted* cloud at that radius — and it does not eat evenly. The local front is the mean modulated by (interior pivot / ambient)^⅓, bounded to [0.75, 1.3]: thin gas evaporates fast and lets the front bulge through, dense filaments stall it, which gives scalloped rims and trunks at clump scale and — because the ambient at tens of parsecs carries the cloud's resolved octaves — the large-scale directionality the contracted march alone could never see, which is what was keeping deeply-embedded regions spherical. The shell skin and swept band re-anchor to the eroded front, and the skin is floored at one bake cell so a sub-cell shell no longer aliases into stripes. Erosion carries its own pivot on the plan so it and the champagne gate can be disarmed independently (the tests do). **Sixth slice — the line grid (§Colour) — landed, which closes stage 5.** **Seventh slice — the cavity follows the cloud.** The wind wall was the last surface in the region drawn with a compass — one scalar radius, a sphere hollowed to 2% with a wall 2.9× dense, in every lit region, and blown to the 0.9 cap in half of them by their supernovae — and the user found it in every evolved region as the one perfect thing in a ragged picture. It is eroded now the way the front is: a momentum snowplow's radius goes as the ploughed density to the −¼, so the cavity along each ray is the mean radius scaled by (interior pivot / natal density at the cavity's natal position)^¼, bounded to [0.6, 1.6] — blown out where the interior is thin, stalled against filaments, corrugated by the cloud's own turbulence; where it runs past the ray's front the interior is simply empty to the front and the front's skin is the only shell, which is the merged superbubble. Mirrored in the GPU march (re-A/B'd: refs within 1%, emission within 0.7%, the same front-flip cells as before) and in the model's `nebulaGasAt`, so the sprite tier carries the same shape. Pinned: the cavity edge varies by more than 1.3× across rays on the bright home subject, and the thinnest third of directions carries it further out than the densest third.
6. Nebulae as places. **Part landed**: a cloud is a destination — the gazetteer already derives a gateway system per cloud, so travelling to one puts the scene origin at the cloud centre and the ordinary orbit camera circles it, and arrival stands off 2.2 cloud reaches so the whole cloud is in frame rather than the usual fifteen-parsec hop. The volume follows the view: the resident nebula is chosen by projected angular size rather than distance (radii run 10–65 pc, so a great cloud far off outranks a small one near), and inside three cloud reaches the box holds the whole cloud instead of just the bubble. Bakes are keyed by cloud *and* scale, since a cloud is a different volume seen from outside than from within.

   The impostor marches the same object the bake does: `nebulaGasAt` re-plumbs the cloud as the region has — the diluted interior hollowed by the wind, the swept shell and its ionized skin, the natal cloud beyond — with the front's radius along sixty-four rays marched by the bake's own budget integral, so a sprite carries the region's directional shape; lines go as n², scattered light as dust times flux, each closing on its own budget over what escapes toward the viewer. A tile now costs ~150 ms of worker time against ~90 for the heuristic it replaced. The tile spans the cloud's full reach rather than 1.6 radii: a drawn-out cloud reaches 2.5× further along its long axis, and a tile sized to the radius sliced it off in a straight line — the light along the cut read as a box hung in the sky, which is what a viewer standing far enough for the sprite tier saw of Zetalu. Pinned: the tile's outer ring carries under 2% of the interior's mean — what survives there is the vented residue of an interior that has outrun its cloud, which the sprite's helper now thins through the same champagne gate the bake uses. That residue is itself cut flat at the bake box and the tile edge alike (5% of the diluted interior, wherever the front reaches): a streaming flow should thin with distance, and giving it a falloff in both tiers is the open item.

   Open: the pick priority — seeded stars win the cursor over an extended object by design, which was right when nebulae were background decals and now makes a nebula hard to click in a dense field. The landmark list travels to the same clouds meanwhile. (In-shader detail octaves below cell size landed: two octaves of the tiling clump noise continue the cascade under whichever grid the ray reads, gated by apparent size so only a sky-filling volume pays.)

7. Multi-volume marching, crossfade, streaming and eviction. **Landed** — residents chosen by projected size under a cap the frame itself sets (a controller from 12 to 64, starting at 32), baked on the GPU in seconds, each dissolving in against its sprite (which carries the complement) and fading back out when residency moves on, with disposal only at zero and a swing-back simply fading up again. What remains of this stage is the one-pass multi-box march in the ledger.
8. Reflection scattering (**landed** — the multiple-scattering table and the
   chromatic march, §Reflection); display modes (**landed** — camera / eye /
   SHO as instrument seatings over one law, with an exposure dial).

## Ledger — open items as of the galaxy-march branch (Sep 2026)

Rough priority order. The residency dials live at the top of
`src/app/unifiedViewer.ts` (`NEBULA_RESIDENTS_START/MIN/MAX` and the frame
budget the cap answers to, `NEBULA_VOLUME_REACH_PC`,
`NEBULA_VOLUME_MIN_ANGULAR`, `NEBULA_RESIDENCY_STRIDE_PC`).

- **Multi-box march.** Each resident volume is its own full-screen dome;
  several *enclosing* volumes at a gateway complex each march the whole sky
  (~45 ms GPU measured with four — before empty-space skipping; see below). Non-enclosing residents are nearly free —
  the cap is a controller (`tuneNebulaResidency`): it starts at 32, grows
  by eight every 1.5 s while the frame's cost sits under 70% of a 60 fps
  budget and every requested bake has landed, and shrinks by a quarter the
  moment the smoothed cost runs over, between a floor of 12 and a ceiling
  of 64. The cost it reads is the pipeline's own GPU time
  (`EXT_disjoint_timer_query_webgl2` around `pipeline.render`, against the
  script's share of the frame) where the extension exists, and the frame
  interval otherwise — an interval is quantized to the display's refresh
  and cannot show headroom under it, which is why the interval-only version
  stalled at 48 on a 120 Hz display reading a 12 ms average of 8 and 17 ms
  frames. Measured at the Musas gateway: the cap climbs to 64 within ten
  seconds of arrival at ~11 ms of GPU per frame. What a big cap costs is
  memory (~3.4 MB
  per grid on the heap and again on the GPU, two grids for a lit cloud,
  16 MB per near-grade grid; the textures keep the bake buffers alive, so
  a standing residency is a few hundred megabytes of heap), not the
  march. **Empty-space skipping landed** after a GPU timer-query bisection
  at the Musas gateway (`EXT_disjoint_timer_query_webgl2` around the sky
  layer, one volume visible at a time): of a 50 ms frame the sky pass was
  43 ms, and two volumes were nearly all of it — the rift the camera stood
  in (160³, 154 steps, detail on) at 20 ms, fifteen of them the detail
  octaves' four extra 3D fetches per step through void, and the Musas
  volume at 20 ms for a hundred steps through a box the carve fills a few
  percent of; the other thirty cost under a millisecond each. Each bake now
  carries a 16³ occupancy grid (a block is occupied if any cell a trilinear
  read inside it could touch is non-zero, so the skip is exact) and the
  march runs an empty block to its far face in one iteration, spending
  samples, warps, table fetches and the emission and scatter arithmetic
  only where there is gas. Same view, every volume standing: sky pass
  5.9 ms, frame 8.4 ms — the display's 120 Hz quantum, and the same frame as
  with no nebulae drawn at all. The rift volume went 20 → 2.6 ms, Musas
  20 → 5.3. Two artefacts the skip introduced, both caught by eye and both
  fixed: gas missing in rectangular chunks (the occupancy came from the
  cloud-scale grid alone while the march reads the bubble-scale grid inside
  its box, and that grid holds filaments and the diluted interior the coarse
  cells quantize to nothing — a volume's occupancy is now the union, each
  occupied fine block marking the coarse blocks it overlaps), and volumes
  rendering as stacked slabs (every ray resumed at a block face plus one
  fixed nudge, so the per-pixel jitter was lost at every boundary and the
  samples lined up — a skip now resumes at the pixel's own jitter). The carrier
  should still march all resident boxes in one pass, sorted front-to-back
  (§render pass), to tame the enclosing-overlap case. Per-axis box extents
  (the bake already stores a vec3; the shader assumes cubic) would also
  shrink footprints for stretched clouds. The star-extinction shader carries
  `MAX_STAR_NEBULAE` slots, filled nearest-first when residents outnumber
  them.
- **Glints at the galaxy frame — measured, and the floor released.** The
  star tiers were suspected of the pulled-out frame's cost at 400–500k
  points. Timed in a visible tab at a 2564×2074 canvas, with the far
  field cloned to eight times its count (442k points): the whole star
  tier adds under 2.5 ms at any altitude, and at full pull-out the frame
  is ~6 ms with the galaxy dome (4–6 ms at mid range) and the bloom pass
  (4–5 ms, in its full-resolution bright and composite passes, not its
  mips — halving them saved 1 ms) as the costs. No CPU culling exists and
  none is needed: the points are one draw, the GPU clips them after a
  cheap vertex stage. What was wrong was the display floor: it held every
  point at a dim constant at every distance, so from kiloparsecs out the
  whole sky field drew as a blob at the origin, light the galaxy dome
  already carries. A point a decade below the floor's own brightness now
  fades and two decades below it leaves the clip volume, costing no
  fragments; at a locale nothing the sweep kept is that faint (its
  faintest is three decades above the release), so the sky is unchanged.
  The star count itself is the sweep's brightness threshold against the
  local density — 63k at Musas, several hundred thousand in the inner
  disk — and a budget on it would be a display choice, not made here.
  The mid-range frame, measured clean (no bakes in flight) at 1.5 kpc
  above Musas on a 2564×1962 canvas, 15 volumes standing: 23.4 ms GPU,
  ~39 fps; the galaxy dome ~11 ms (72 disk steps + 32 halo steps per
  half-res pixel), bloom ~12 ms by removal (its full-resolution bright and
  composite passes), nebulae ~4, particles ~2, stars ~0, everything off
  4 ms. Levers, with their measured savings: the sky layer at 0.35 of the
  buffer instead of 0.5 (−6 ms; the domes are smooth glow and the layer
  is upsampled bilinearly), bloom's targets at half (−2.7 ms), and the
  dome's step placement — 72 uniform steps across a ±2.6 kpc slab put
  most samples in near-empty thick disk when the light lives in the thin
  one; midplane-weighted spacing would keep the integral at fewer steps.
  Bake contention is the transient on top: right after an arrival or a
  pull-out the worker's GPU bakes stretch frames to ~90 ms until the
  queue drains. **Two of those levers landed.** The dome's disk crossing
  is sampled by where the light is: seventy-two steps shared between the
  thin disk's own slab (|z| < 0.5 kpc, which holds the dust and nearly
  all the light) and the thick disk either side by length, the thick
  counting a third, and neither taking more steps than 60 pc of thin or
  180 pc of thick call for — a ray along the plane keeps its seventy-two,
  a ray from above crosses in about forty. Measured fresh at 1.5 kpc: dome
  11 → ~5 ms, the frame 9 ms GPU at 120 Hz with sixteen volumes. And
  residents now stand up at a first grade of 48³ — a bake the worker's
  GPU finishes in milliseconds, so an arrival's whole residency lands
  within a second — and climb to their grade one bake at a time whenever
  nothing else is baking, the most apparent first; only a residency at
  its grade, with headroom, admits more. Measured: twelve residents at
  their grades ten seconds after arrival, with no frame past 90 ms.
  Measurement caveat learned the hard way: a page that has been through
  hot reloads accumulates state — everything-off read 16 ms where a fresh
  load reads 3 — so time on a fresh load only.
- **The near grade's detail octaves — priced and packed.** Zoomed in on
  Musas to where it takes the near grade (250 pc out, 160³ with the fine
  grid, 131 steps, detail amp 0.54), the frame was 52 ms of GPU and Musas
  alone 31 of it, 26 of those the detail path: per occupied sample a
  three-fetch domain warp on the cloud grid, another on the fine grid, and
  the sub-cell octave — up to nine texture fetches where the plain march
  takes two. Three exact changes: the clump tile is RGBA now, its colour
  channels the noise at the warp's three offsets so the warp is one fetch,
  and its alpha the noise at twice the frequency with the octave's offset,
  which is the sub-cell octave from that same fetch; the fine grid takes
  the cloud grid's displacement instead of fetching its own, so the two
  grids are bent into one space; and the occupancy grid is 32³, five cells
  a block at the near grade, so fewer void samples inside occupied blocks
  are marched at all. A detailed sample is three fetches. Same view: the
  frame 26.6 ms, Musas 8.6 ms with the detail path 5 of it, 29 → ~57 fps.
  The step count matters less than it looks (131 → 64 saved 3 ms).
- **The two display levers, A/B'd.** At the same view and frame state,
  captured from the drawing buffer at 1:1 with a local receiver (the
  screenshot tools downscale and cannot show the difference): the sky
  layer at 0.35 of the buffer instead of 0.5 saved 6.3 ms (26.0 → 19.7 ms
  GPU, 60 fps) at a mean pixel difference of 1.2/255 against the current
  frame, indistinguishable at buffer resolution; bloom's targets at half
  saved nothing at this view (26.1 vs 26.0 — its cost is the full-res
  bright and composite passes, which do not shrink) at 0.6/255. The sky
  layer's scale is now a sample pitch of 1.4 CSS pixels
  (`SKY_SAMPLE_CSS_PX`, `skyResolutionScale`): 0.36 of the buffer at a
  pixel ratio of two, the old 0.5 on a ratio-one display. Bloom is left
  as it was.
- **Obvious levers, if the frame ever needs pulling back again.** In order
  of what they buy, with what they cost, all measured on the 2564×1962
  buffer at the near grade over Musas:
  - `SKY_SAMPLE_CSS_PX` in `render/fx/skyLayer.ts` — the sky layer's
    sample pitch. 1.0 → 1.4 was −6 ms at 1.2/255; 2.0 would be roughly
    −3 ms more and the domes visibly softer. The one dial that is purely
    display, and the first to turn.
  - The near grade's step ceiling, `MAX_STEPS` in
    `render/galaxy/nebulaVolume.ts`: 131 → 64 steps was −3 ms on the
    volume that filled the view, at the cost of thin structure along the
    ray.
  - Bloom's targets — not worth it: half size was 0 ms here and −2.7 ms
    at 1.5 kpc, since its cost is the full-resolution bright and
    composite passes that do not shrink. Moving those to half resolution
    would be the real lever, and a look change.
  - The residency controller's budget, `NEBULA_FRAME_BUDGET_MS`, is not a
    lever: it trims volumes only, and the arrival's near-grade subject is
    what the frame is made of.
- **The sky's reaches taper — landed.** Pulled out, the sky field showed
  nested spheres: the near census (every star, whatever its light, to the
  neighbourhood's radius) ended on one, and each catalog row's sweep ended
  on another at its budgeted radius — 90, 150, 600, 2500 pc — well inside
  where its brightest members still clear the magnitude-9 limit, so the
  A–F stars simply stopped at 150 pc and the B stars at 600. Each reach now
  tapers past its radius (1.5× for a row, 2× for the census), the sweep
  thinning candidates by a unit fixed by their position before the density
  test that costs the most, and consuming the cell generator's draws
  exactly as before so every star inside a reach keeps its identity.
  Measured in shells at home: 790 → 504 → 260 stars per 10⁶ pc³ across the
  old 150 pc cut, 29 → 20 → 4 across 600, the census falling from 10⁵ to
  the sky's 2×10³ over 30–60 pc; pinned in `galaxy.test.ts`. The same pass
  fixed a hole: the neighbourhood shrinks its radius below 30 pc where the
  disk is dense, while the sky split near from far at a fixed 30, and the
  shell between was drawn by neither — the split now follows the
  neighbourhood's own radius. Cost: the home sweep runs ~30 s single-
  threaded in the test (it is pooled across workers in the app).
- **Residency ranking.** Admission is by projected size alone, so a bright
  emission complex can in principle lose its slot to bigger dark rifts —
  much blunter with dozens standing at once, but the ranking is still
  brightness-blind. Weight by the object's light budgets if it ever bites.
- **Systems embedded in dark clouds — decision pending.** Measured over 5.1 M
  catalog stars: 0.4% stand in cloud gas and 0.1% in dense gas, where reality
  keeps mature systems essentially clear of it (clouds live ~20 Myr, stars
  decouple; only natal groups are genuinely embedded, and the nebula members
  already model those). Worse, every landmark cloud's *gateway* system is
  seeded at the complex itself — the densest possible sky, A_V 5–223 mag by
  direction measured at one — so the flagship destinations get near-black
  skies by construction. The render of an embedded viewpoint is honest
  (nearest stars survive at 55–80% flux; the rest go; Barnard 68 from
  inside). Proposed, awaiting the call: move gateways to the cloud's near
  edge or a carved cavity so arrival puts the complex overhead rather than
  around you; optionally veto catalog systems where the smooth cloud density
  is high (an envelope-level check — the full turbulent field is too dear per
  star). Both change which seeds exist and where some travel URLs land.
- **Photometric unification — landed.** One law for the whole sky, in
  `universe/galaxy/displayLaw.ts`: the star points' own curve (display energy
  `0.055·(B/2⁻¹⁷)^0.36`, B in L☉/pc²) extracted as the shared transfer, with
  extended light entering as radiance through a reference beam and displayed as
  the law's *marginal response above a subtracted sky pedestal* —
  `D(P+R) − D(P)`, P ≈ 1 L☉ pc⁻² sr⁻¹, the integrated starlight of a dark
  column — exactly what a sky-subtracted deep exposure shows. The pure power
  applied to extended light directly was measured first and stretched the
  diffuse floor into fog across the whole display (thirty-two volume skirts
  plus the band, each lifted by `x^0.36`); the marginal form kills the fog
  while keeping every structure's stature. What moved: the volume's
  `NEBULA_PIXEL_SCALE` is gone (the march's radiance is displayed by the law);
  the sprite's `95·√L/d²` impostor law is gone — the tile's peak radiance now
  follows from exact flux closure (the cloud's line + scattered budget over
  the tile's own luminance integral, distance cancelling as surface brightness
  demands) and the tile is baked in display space with its peak riding in
  `brightness`; the glow map joined the same law (its own darkest column is
  its pedestal, self-calibrated per viewpoint) and dark-cloud transmission
  dims it as `T^γ` in-shader; the bake's emission books now close on the
  *quantized* grid, the thing the renderer actually integrates. The harness
  (`displayLaw.test.ts`) pins the law against the star shader exactly, pins
  real-sky anchors (pole sky black, band ~0.05, Orion-core ~0.37), closes the
  sprite tile's flux books to a tenth of a percent on the escaping light,
  and pins volume-against-sprite total flux at 0.2–1.5 over the cloud-scale
  box (measured 0.3–1.0 on the bright subjects). What closed the earlier
  ~0.14: the volume was closing its books on the dominant member's photons
  where the sprite spent the group's total (a median 54% of it); the
  impostor's continuum interception was a constant 0.3 where the marched
  first-order interception runs 0.002–0.2 by cloud; and the two were being
  compared over different bodies. What remains is what the march resolves
  and the impostor cannot — the front broken cell by cell, the champagne
  gate and erosion, per-cell U, and the phase toward one viewpoint.
  Residual refinement: rift and dark-tile dimming of the glow, and a
  volume's cover of what stands behind it, are display-space `T^γ`, exact
  for the pure law and ~1.5× steep at mid-transmittance against the
  marginal form. Overlapping *sprites* now sum their radiance before the
  law; a volume over the glow, or over another volume, still takes the
  marginal law once per tier — compositing in linear radiance and
  displaying once would need the sky target to carry radiance rather than
  display energy.
- **Display modes — landed.** The §Colour instrument split, as
  `DisplayInstrument` presets in `displayLaw.ts` seated onto the whole sky's
  uniforms (`render/displayTransfer.ts`, `viewer.setSkyInstrument`): **camera**
  is the sky-subtracted deep exposure everything was calibrated under; **eye**
  anchors the same law at the dark-adapted naked eye — points cut off at sixth
  magnitude and the brightest near unit display, extended light landing where
  it really does (the band a barely-there grey at ~0.02, an Orion-class core a
  dim smudge), colour draining below a mesopic knee into the rods' blue-green
  cast on every tier; **SHO** swaps the emission endpoints to the mapped
  [S II]/Hα/[O III] palette — computed from the same line grid, carried on
  every bake and patch so the switch never re-bakes — and cuts continuum to
  the sliver narrowband filters pass, the sky pedestal with it, which is
  the suppression narrowband imaging exists for. One exposure dial (sky depth) slides
  pivot, cutoff and knee together, so it reads as integration time on the
  camera and dark adaptation on the eye. The 3D star tiers (neighbor, far,
  preview points) take the same seating as the backdrop points, so the two
  star systems stay one photometric system under any mode. Not seated, by
  choice: the system's belt points (system-local content, not sky) and the
  nuclear-cluster swarm's custom zero point. Verified live: eye mode makes
  the brightest home H II complex vanish outright — the honest answer to why
  nowhere in the galaxy mirrors an Earth dark-sky night.
- **Stage 5 remainder.** Trunk/pillar photoevaporation, winds and supernovae
  past the Spitzer floor (the expansion slice that landed is the floor, not the
  ceiling).
- **Cluster members are not destinations — settled.** Group members ride their
  cloud's stream (`starSeed === 0n` in the sky field), so they hover as
  "cluster member" but offer no travel, and that is by decision, not omission:
  a member has no identity beyond its group, and the nebula is the shared
  destination for all of them. If member-click ever wants to do something, the
  right something is routing to the parent cloud's gateway, not minting
  per-member systems.
- **Bake on the GPU — landed.** The worker now bakes on an OffscreenCanvas
  WebGL2 context (`render/galaxy/nebulaBakeGpu.ts`): the seeded simplex ported
  to GLSL with the galaxy's permutation as an R8UI texture, the carve filled
  layer by layer into an R16F 3D texture (dimensionless, so half floats never
  overflow — the per-cloud scale rides in a uniform), one march pass over a 2D
  atlas, one float readback into the same `finishNebulaBake` the CPU path uses.
  Measured on the brightest home-region H II region with the tab visible: 96³
  bakes run 60–180 ms against 2.2–4.1 s on the CPU (~20–50×), the first ~1 s
  including worker boot and shader link. In a hidden tab Chrome deprioritizes
  the worker context's GPU submissions and a bake stretches to ~2.5 s — still
  no worse than the CPU it replaced. A per-layer march with flushes between
  (yield points for the frame renderer) measured 30× slower and was reverted;
  if arrivals ever hitch from bake-vs-frame GPU contention, that is the knob
  that did not work, and splitting the readback or spacing whole bakes is the
  next thing to try. Agreement with the CPU march: dark clouds
  bit-identical; refs and emission coefficient within 0.1%; ~50 cells in 262k
  differ visibly, all one-step front flips where fp32 and fp64 disagree on the
  exact step the budget runs out. The CPU walk in `nebulaVolume.ts` stays the
  physics authority and the fallback (no OffscreenCanvas, no float render
  targets, or a mid-bake GL failure demotes the worker to it); the pool of
  three workers remains for that path. The atlas comes home a row of tiles
  at a time into a strip buffer, and the field and atlas textures are kept
  per grid size for the baker's life. No automated CPU-vs-GPU test exists —
  vitest has no WebGL — so any change to the CPU march must re-run the
  in-browser A/B (bake both paths on one cloud from a page console, diff the
  byte volumes) before trusting the GPU mirror. Re-run after the review
  pass's depletion change on the Musas cloud at 64³, both boxes: refs within
  1%, emission coefficient within 0.8%, dust and ionized bytes off by more
  than one in ~10–25 cells of 262k, hardness in ~130–520 (log U on
  near-empty cells, where nothing is emitted) and transmittance in ~90–290 —
  the one-step front flips, as before. The recipe is a page-console
  `import('/src/…')` of the bake modules under the Vite dev server; the
  GPU baker stands on the main thread's OffscreenCanvas as well.
- **Reach cap.** Residency searches 2 kpc of clouds; complexes beyond that lose
  their volumes once the backdrop fades (sub-6° at that range, so quiet — but it
  is a dial, not a law).
- **Shell ordering vs the sky composite.** Anything that shines nearer than
  the sky must draw after the composite, or a volume's occlusion multiplies
  its light away and cuts black holes into it. Fixed so far: the terrain sky
  dome (twilight haze) and the weather `cloudShell` — the deck was the
  uniform "atmosphere tint" a hothouse's night sky showed with hard black
  nebula cutouts punched through it, and stars used to shine through an
  overcast besides — and the sun's corona billboard, whose glow and flares a
  dark cloud parsecs behind it used to eat (bright nebulae hid the same
  theft inside their own light) — and finally the limb glow, the rings and
  the aurora together, seated in the band between the star points and the
  haze dome. Every transparent layer now has an explicit seat. The one
  standing compromise a global order forces: a ring's far side just past
  the limb draws over the limb glow rather than under it, traded knowingly
  for the prominent near-side crossing.
- **Massive-star lifetimes — fixed.** `msLifetimeGyr` was the textbook fuel
  estimate 10·M/L, which ignores the growing convective core and ran massive
  stars ~4× short (30 M☉ died at 1.4 Myr against a real ~6, so 3 Myr groups
  already counted several supernovae). The law now carries the Eddington
  asymptote as an additive 3.2 Myr floor — 60 M☉ at 3.5 Myr, 20 at 7.2, 9 at
  33, sunlike untouched, within ~25% of the track grids throughout. This
  moves which massive stars are alive in every sky, by decision: skies with
  O stars gain a few and their oldest regions lose their earliest supernovae.
- **Kerr shadow test flake** (cross-domain): fails ~1-in-5 full-suite runs,
  never in isolation — suspected cross-file state; background task chip spawned.

## Testing targets

- GMC population: sampled masses on the observed mass function, densities in 50–500 cm⁻³, surface density near 100 M☉ pc⁻².
- Extinction round-trip: the calibrated n_H integrated back through `DUST_OPACITY_PER_PC` reproduces ≈1 mag/kpc locally.
- Strömgren regression: a single O5 in uniform n = 100 cm⁻³ ionizes to 3 pc ± tolerance through the bake path.
- Colour: synthesized H II chromaticity against published Orion line ratios; [O III]/Hβ rising monotonically with T_eff.
- Sprite/volume agreement: the far impostor rendered from the volume matches the volume's own image at the crossfade distance.
- Benchmarks before any quality default is fixed: 64³ vs 128³ bake time, half vs full resolution frame cost on integrated and discrete GPUs, upload stalls, cancellation while travelling.
