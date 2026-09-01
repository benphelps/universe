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
- What is built is narrower than this: hardness comes from the ionization parameter alone, and the [N II]/[S II]/[O III] ratios are fixed against it. Observed H II spectra depend materially on the ionizing star's own spectrum and on metallicity too, so the colour responds to only one of the three things that move it. The grid in (T_eff, log U, Z) is still the target; the interface does not change when it lands.
- Because Z enters, nebular colour then varies with galactocentric radius on its own.

Three display modes, all honest, differing only in the instrument:

- **natural vision** — physical surface brightness through the existing HDR/ACES exposure; at these levels the eye is scotopic, so mostly grey glow with extinction and silhouettes reading stronger than colour.
- **true-colour camera** — the same radiance at photographic exposure, the actual visible line wavelengths.
- **mapped narrowband** — Hα/[O III]/[S II] to RGB, labelled as the false-colour mapping it is.

## Reflection

After emission works. Inverse-square irradiance from channel A, dust albedo a ≈ 0.6, Henyey–Greenstein g ≈ 0.6, with wavelength-dependent extinction A_B/A_V = 1.324 and A_R/A_V = 0.748 at R_V = 3.1 (≈1.2 / 0.8 in dense cores at R_V ≈ 5) — that ratio is why reflection nebulae are blue while transmitted light reddens. Upgrade to Magnor's precomputed multiple-scattering table P(τ_sct, θ), 1000 optical depths × 72 angles, a single 2D LUT fetch, rather than secondary light marches in the frame shader.

## Not in scope

Radiation-MHD at any point. Runtime photoionization solving. Planetary nebulae and supernova remnants — they need their own shell, bipolar-flow and shock-filament generators, and they do not exist as generated objects yet, so they would expand this task rather than shorten it. H II regions already have identity, density, embedded groups, tooltips, atlas images and travel items: they are the shortest path to proving the renderer.

## Staging

1. `Nebula` model, gas calibration, camera-driven query. No render change; testable alone. **Landed.**
2. The density pass: cloud gain against the extinction and molecular-mass anchors, carve concentration, members drawn against the field. **Landed** — clouds now hold 3.1 M☉/pc² of molecular gas across the disc at 1.0 mag/kpc of extinction, GMC masses run 10⁴–10⁶ M☉, sightlines through a cloud reach several magnitudes, ionizing stars stand in gas at ~160 cm⁻³, and Strömgren radii fall to a few percent of the cloud so there is neutral gas left to shadow.

   The two anchors that hold are the disc-averaged molecular content and the extinction. The per-cloud figures are weaker than the table above implies and should not be read as calibrated: measured over the local large-cloud sample, mean density comes to ~8 cm⁻³ and surface density to ~12 M☉ pc⁻², against catalogue medians nearer 50 (Miville-Deschênes 2017; Chen 2020 find a broad 2–300 range, so these sit inside the observed spread but at its thin end). Closing that means concentrating the carve further without moving the two anchors, which is its own pass.
3. One bright H II region, 64³ bake, single dominant source, single shadow ray. Carrier dome, premultiplied blending, sprite path untouched so the two sit side by side. **Landed**, with two corrections the bake forced. The box is the ionized bubble, not the cloud: a Strömgren radius of 2.4 pc inside a 200 pc cloud puts the whole nebula inside one cell of any grid that covers the cloud, and the cloud beyond the box is already drawn as the dark rift it is. And the turbulent cascade had to continue: three octaves pitched to the cloud radius are smooth at the bubble's scale, so the first front came out a bare sphere — three more octaves, same falloff, for the one consumer whose cells can resolve them, and the front now runs 2.75/4.50/8.50 pc across directions.
4. Per-star transmittance and scene-depth clipping. **Landed.** Occlusion by solid geometry was already correct — the carrier dome is depth-tested at the far plane, so a planet in front simply wins — but the star field needed the march: points are additive and write no depth, so each star now marches the volume over the stretch of its own sightline that falls inside the box, dimming and reddening on the R_V = 3.1 curve. Measured against the same frame with the march disabled: 1791 pixels change, every one of them dimmer, and the surviving fraction runs 0.773 red / 0.733 green / 0.692 blue. Brightness is no longer a dial either — the star's ionizing budget fixes L(Hβ), the line mixture carries the rest of the optical spectrum, and the gas divides that light by n², leaving one shared renderer constant for surface brightness.
5. Photoevaporative erosion pass and the line-ratio LUT — the step where the picture becomes physics rather than fog. **First slice landed**: the region gets its age — Spitzer D-type expansion scales the natal front by R(t)/R_s with the interior diluted n ∝ R^{-3/2} (budget-conserving exactly, pinned by test), a swept shell at the front, and the ionization march run in contracted coordinates so the carved directional shape survives the growth. An 11 Myr region is tens of parsecs, visible at cloud scale, which is what closed the sprite→volume "pink object vanishes into a blue dot" seam. Both renderers now colour from the same budgets — `nebulaEmissionShare` weighs line output against scattered continuum surface brightness, so O groups read pink and B groups read blue in sprite and volume alike, replacing the hand-mixed maxTeff hue ramp. Still open here: trunk/pillar erosion proper, winds and supernovae past the Spitzer floor, and the full line-ratio LUT.
6. Nebulae as places. **Part landed**: a cloud is a destination — the gazetteer already derives a gateway system per cloud, so travelling to one puts the scene origin at the cloud centre and the ordinary orbit camera circles it, and arrival stands off 2.2 cloud reaches so the whole cloud is in frame rather than the usual fifteen-parsec hop. The volume follows the view: the resident nebula is chosen by projected angular size rather than distance (radii run 10–65 pc, so a great cloud far off outranks a small one near), and inside three cloud reaches the box holds the whole cloud instead of just the bubble. Bakes are keyed by cloud *and* scale, since a cloud is a different volume seen from outside than from within.

   Open: several volumes resident with a crossfade between scales instead of a swap; in-shader detail octaves below cell size (a cloud box at 96³ is 4 pc per cell, which is coarser than the cascade the bake can resolve); and the pick priority — seeded stars win the cursor over an extended object by design, which was right when nebulae were background decals and now makes a nebula hard to click in a dense field. The landmark list travels to the same clouds meanwhile.

7. Multi-volume marching, crossfade, streaming and eviction.
8. Reflection scattering; display modes.

## Ledger — open items as of the galaxy-march branch (Sep 2026)

Rough priority order. The residency dials live at the top of
`src/app/unifiedViewer.ts` (`NEBULA_VOLUME_RESIDENTS`, `NEBULA_VOLUME_REACH_PC`,
`NEBULA_VOLUME_MIN_ANGULAR`, `NEBULA_RESIDENCY_STRIDE_PC`).

- **Multi-box march.** Each resident volume is its own full-screen dome; several
  *enclosing* volumes at a gateway complex each march the whole sky (~45 ms GPU
  measured with four). The carrier should march all resident boxes in one pass,
  sorted front-to-back (§render pass). Per-axis box extents (the bake already
  stores a vec3; the shader assumes cubic) would also shrink footprints for
  stretched clouds.
- **Residency ranking.** Admission is by projected size alone, so a bright
  emission complex can lose its slot to four bigger dark rifts. Weight by the
  object's light budgets, and consider admitting more small-footprint volumes
  (cheap) while capping enclosing ones (expensive).
- **Photometric unification.** The sprite's brightness law is still the impostor
  (`95·√L/d²`, peak-normalized tiles); the volume's zero point is order-unity
  provisional. Build the sprite/volume agreement harness and tie both to the
  star sprites' photometric system. Hue already unified via `nebulaEmissionShare`.
- **Display modes.** Bright bubble cores tone-map to white at close range — the
  natural-vision / camera / narrowband instrument split (§Colour) is where that
  judgment belongs, not the physics.
- **Stage 5 remainder.** Trunk/pillar photoevaporation, winds and supernovae
  past the Spitzer floor (the expansion slice that landed is the floor, not the
  ceiling).
- **Cluster members are not addressable.** Group members ride their cloud's
  stream (`starSeed === 0n` in the sky field), so they hover as "cluster member"
  but cannot be travelled to. They are deterministic per cloud —
  `deriveSeed(cloud.seed, 'member', i)` could name them — but arrival needs the
  system generator to honor a member's physical identity (mass, age, tEff)
  rather than rolling its own star from the seed.
- **Dead members as ionizers.** A few nebula members report tEff ~10⁶ K —
  `evolve()` returning remnant parameters for massive stars past their
  lifetime, which then ionize as planetary-nebula-nucleus-like sources. Possibly
  physics, never reviewed: decide what a dead member should contribute to Q,
  luminosity, and the illuminant choice.
- **Arrival bake latency.** ~6 s for the subject's coarse bake after travel
  (worker is serial, one bake in flight). A low-resolution first pass or a
  second worker would halve the perceived wait.
- **Reach cap.** Residency searches 2 kpc of clouds; complexes beyond that lose
  their volumes once the backdrop fades (sub-6° at that range, so quiet — but it
  is a dial, not a law).
- **Kerr shadow test flake** (cross-domain): fails ~1-in-5 full-suite runs,
  never in isolation — suspected cross-file state; background task chip spawned.

## Testing targets

- GMC population: sampled masses on the observed mass function, densities in 50–500 cm⁻³, surface density near 100 M☉ pc⁻².
- Extinction round-trip: the calibrated n_H integrated back through `DUST_OPACITY_PER_PC` reproduces ≈1 mag/kpc locally.
- Strömgren regression: a single O5 in uniform n = 100 cm⁻³ ionizes to 3 pc ± tolerance through the bake path.
- Colour: synthesized H II chromaticity against published Orion line ratios; [O III]/Hβ rising monotonically with T_eff.
- Sprite/volume agreement: the far impostor rendered from the volume matches the volume's own image at the crossfade distance.
- Benchmarks before any quality default is fixed: 64³ vs 128³ bake time, half vs full resolution frame cost on integrated and discrete GPUs, upload stalls, cancellation while travelling.
