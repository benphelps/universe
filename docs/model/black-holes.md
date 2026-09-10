# Black holes: science, model, and appearance

The black-hole view combines a relativistic lens, emitting gas, the surrounding galaxy, and a camera response. The dark region comes from photon capture; the light comes from material outside the horizon and from the background sky.

The implementation uses Kerr ray tracing with a reduced model of accretion, plasma emission, and outflows. It does **not** evolve a full general relativistic magnetohydrodynamic simulation (GRMHD). Geometry, empirical population rules, approximate gas physics, and display choices have different levels of certainty; this guide distinguishes them.

For spectral equations, numerical table sizes, and detailed energy accounting, see [Hot-flow emission](hot-flow-emission.md). For reproducible checks, see [Validation](../VALIDATION.md).

## 1. What defines a black hole here

The spacetime is the stationary, uncharged Kerr solution. Its two physical parameters are mass, `M`, and dimensionless spin, `a* = Jc/(GM²)`. The gas does not change the metric, and the simulation does not evolve the hole's mass or spin as it accretes. The underlying geometry follows [Kerr (1963)](https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.11.237).

Lengths near the hole are expressed in gravitational radii:

`r_g = GM/c²`.

One gravitational radius is approximately 1.477 km per solar mass. Increasing mass scales all the geometric lengths and characteristic times. At a fixed distance in gravitational radii, changing mass alone does not change the dimensionless Kerr lens. It does change the plasma: density, magnetic field, temperature, and optical brightness can differ substantially.

Several different radii matter:

| Quantity | Meaning | Nonrotating value |
| --- | --- | --- |
| Event horizon | Boundary beyond which future-directed light cannot reach distant observers | `2 r_g` |
| Photon sphere | Unstable circular light orbits in Schwarzschild spacetime | `3 r_g` |
| ISCO | Innermost stable equatorial circular orbit for massive particles | `6 r_g` |
| Shadow impact radius | Critical apparent radius against distant background illumination | `3√3 r_g ≈ 5.196 r_g` |

For Kerr, the horizon coordinate radius is `(1 + √(1 − a*²)) r_g`. Equatorial circular orbits depend on whether matter moves with or against the spin. The model uses the equatorial ISCO and its orbital energy; the relevant orbit formulas are described by [Bardeen, Press & Teukolsky (1972)](https://adsabs.harvard.edu/pdf/1972ApJ...178..347B).

Two readout shortcuts should not be mistaken for the full image geometry. The quoted shadow radius uses the Schwarzschild value as a convenient scale; the renderer computes spin- and viewing-dependent capture. The function named `photonSphereRadiusRg` returns an equatorial circular photon-orbit radius, not a complete Kerr photon region. The Hawking-temperature readout is also a mass-only Schwarzschild estimate; Hawking emission contributes no rendered light.

## 2. How a galaxy gets its central hole

The galaxy seed determines a reproducible nucleus. The classical-bulge branch uses a black-hole/bulge mass relation with logarithmic scatter. The pseudobulge branch uses a separate, broadly scattered mass fraction. The observational motivation is that classical bulges and pseudobulges do not exhibit equally tight black-hole correlations; the particular procedural draws remain assumptions. See [Kormendy & Ho (2013)](https://arxiv.org/abs/1304.7762).

The implemented population rules are:

- Classical bulge: `M_BH = 0.49 × 10⁹ (M_bulge/10¹¹ M☉)^1.16 M☉`, multiplied by a lognormal scatter of 0.29 dex.
- Pseudobulge: `M_BH/M_bulge = 10^N`, where `N` has mean −3.5 and standard deviation 0.55.
- Spin: a seeded draw biased toward high prograde spin, capped at 0.998.
- Feeding: a seeded distribution strongly weighted toward low Eddington ratios.
- Orientation: a seeded tilt relative to the galaxy's disk.
- Horizon magnetic flux: an independent log-uniform draw from 3 to 35 in the model's dimensionless convention.

These are not individual measurements, nor a simulated history of galaxy mergers and black-hole growth. The model can produce a central hole below the usual supermassive range. For example, galaxy `62765c1caafc1d12` contains a roughly 7,184-solar-mass hole, despite the current panel's generic “supermassive” wording.

The stellar environment also has a model: bulge, nuclear cluster, stellar populations, and an influence scale `GM/σ²`. That influence radius is a conventional dynamical estimate, not a resolved boundary where the stellar gravity suddenly turns off.

## 3. The shadow and the bent sky

For every rendered pixel, the tracer follows a null geodesic backward from the camera. It accumulates emission and extinction through the gas, then determines whether the ray reaches the background or is captured. The visible dark region is therefore an apparent capture shadow, larger than the horizon itself.

A shadow need not appear perfectly black. Light emitted by gas **in front of** the capture region still reaches the observer. The depth of the central brightness depression depends on the emitting material and viewing geometry. The EHT's M87 observations likewise distinguish an emitting crescent from its central brightness depression; those observations were made at millimeter wavelengths, not as a visible-light color photograph. See the [EHT shadow analysis](https://arxiv.org/abs/1906.11243) and [imaging paper](https://arxiv.org/abs/1906.11241).

In this renderer, rays that escape sample a directional sky captured at the nucleus. That capture contains the galaxy's actual diffuse light, nuclear stars, nebula emission, and dark cloud structure. It is an environment approximation: the observer's motion near the hole is treated as negligible compared with the distances to those background sources.

Lensing can stretch stars into arcs, produce multiple images, and carry the far side of the emitting flow above and below the shadow. Spin also changes the capture boundary and photon trajectories. A broad bright ring in the image should not automatically be called the photon ring: directly visible gas and several lensed images contribute to it, while the highest-order subrings may be too narrow to resolve.

The production solver uses inverse radius and a unit angular vector to reduce coordinate problems near the poles. It still uses finite steps, a capture lookup, and a finite sky texture. “Kerr geometry” identifies the equations being approximated; it does not mean that every output pixel is an exact analytic solution.

## 4. Why the flow can be a disk or a thick torus

The Eddington luminosity used here is

`L_Edd = 4πGMm_p c/σ_T`.

It is the spherical, ionized-hydrogen electron-scattering balance scale. The input `λ = L/L_Edd` controls the accretion prescription. Real hot and cold accretion states depend on cooling, mass supply, and additional physics; a single luminosity boundary cannot describe all transitions. Hot flows are generally less radiatively efficient and geometrically thicker than the standard cold disk. See [Yuan & Narayan (2014)](https://arxiv.org/abs/1401.0586).

Our model makes an explicit simplifying choice: `λ ≥ 0.01` selects the thin disk; lower values select the hot flow. A hole above that threshold is not necessarily a quasar. A hole below it is not necessarily visually faint at the chosen distance and exposure.

### Thin disk

The disk uses the standard torque-free temperature profile:

`σ_SB T_eff⁴(R) = [3GM Mdot/(8πR³)] [1 − √(R_in/R)]`.

It is hottest just outside its inner edge and cools approximately as `R^(−3/4)` farther out. The physical motivation is the [Shakura–Sunyaev disk model](https://ui.adsabs.harvard.edu/abs/1973A%26A....24..337S/abstract).

Our implementation places the inner edge at the Kerr ISCO, uses `η = 1 − E_ISCO` to infer accretion rate from luminosity, and uses a self-gravity scaling for the outer edge. It combines that with the above Newtonian dissipation profile. This is a hybrid approximation, not the full relativistic Novikov–Thorne disk solution; its integrated disk luminosity should not be assumed identical to the supplied relativistic energy budget. The renderer also uses a simplified opacity profile rather than solving a disk atmosphere.

The thin disk also evolves a **64-radius × 128-azimuth field** of surface-density, thermal-energy, and heating-stress perturbations. Galactic nuclei and stellar remnants supply independent material seeds derived from their respective entity seeds; changing this stream leaves mass, spin, and feeding unchanged. Reopening the same hole starts from the same initial state. The material history is not saved when leaving the view.

Circular rotation follows the Kerr period, `Omega ∝ 1/(r^(3/2)+a)`. Conservative orbital remapping shears structure without rapidly diffusing it away. A prescribed inward velocity `v_r = alpha (H/R)^2 c/sqrt(r)`, with `alpha = 0.1`, transports perturbations from an unperturbed outer supply to the draining ISCO boundary. Weak compressive azimuthal velocities move mass through shared faces. These transport steps conserve mass with an explicit supply/loss balance.

Unresolved turbulent work is represented by seeded, overlapping orbital patches with two-local-orbit lifetimes. They drive an advected stress reservoir, while thermal energy responds on `t_th = 1/(alpha Omega)`. This timescale follows the standard thin-disk scaling discussed in [Spruit's accretion-disk lectures](https://wwwmpa.mpa-garching.mpg.de/~henk/pub/imprsaccretion.pdf). The amplitudes, packet widths, and mode counts are modeling choices, not predictions from an instability solver. Mean heating is normalized around each ring to preserve the fixed background feeding profile; the model produces local and viewing-dependent variability, not a solved global accretion outburst.

Density changes the optical column. The independent thermal reservoir changes surface flux, so `T_eff = T_background × (U/U_background)^(1/4)`, followed by the existing Planck spectrum and relativistic frequency shift. Heating and cooling have a positive local reservoir balance. Radial energy transport is of perturbations about a prescribed equilibrium, not an absolute relativistic energy-conservation solution. Magnetic vectors, momentum feedback, compression work, radiation-pressure instability, atmosphere changes, and self-consistent angular-momentum transport remain omitted. Small transport velocities are not added to the photon frequency-shift calculation.

Fixed steps of 1/240 displayed inner orbit make evolution reproducible for the same accepted elapsed time regardless of frame batching. Each update accepts at most 0.02 orbit (five substeps); excessive requested time is discarded rather than accumulated. Rendering interpolates adjacent states with one step of latency. A 128 KiB texture replaces the old shared 2 MiB noise tile, and the same material is sampled by strong-lensing rays and distant disk intersections. The image itself remains at native resolution. The tiny field initializes on the main thread; expensive hot spectra still run in the worker.

### Hot flow

The hot branch has prescribed thickness `H/R = 0.55`, extends inside the ISCO toward the horizon, and ends at 60 gravitational radii. It is a volume of gas rather than a luminous sheet. Its Gaussian-like vertical density falls rapidly toward the poles, leaving a funnel.

Hot-flow efficiency decreases as `η_hot = η_thin √(λ/0.01)`. The horizon mass supply follows from `L = η_hot Mdot_h c²`, subject to the shared numerical efficiency floor. This is a reduced feeding prescription, not a solved cooling transition. The supplied `L` becomes a radiative budget; the spectral model may radiate less.

The retained effective temperature in the flow data is a bolometric bookkeeping quantity. It does **not** set the hot torus's visible color.

## 5. Where the light and color come from

A thin disk uses a temperature-dependent Planck spectrum. A hot flow uses electron density, electron temperature, magnetic field, and an energetic-electron population. These are different emission models.

In the hot prescription, steady mass flux and an inward speed `v_r = α c (H/R)²/√(r/r_g)`, with `α = 0.1`, determine density. Ions have a virial-temperature estimate. Electrons have a separately prescribed temperature, lowered when the estimated escaping power exceeds the budget. Magnetic pressure is initially one tenth of gas pressure.

The emission calculation includes synchrotron radiation from electrons in the magnetic field, electron-ion and electron-electron free-free radiation, and a local approximation to Compton redistribution. Most electrons occupy a relativistic thermal distribution. A cooled power-law tail receives a nominal 1% of electron kinetic energy while conserving particle count. The equations and the assumptions behind that tail are documented in [Hot-flow emission](hot-flow-emission.md).

Temperature alone therefore cannot assign a hot torus a color. Changing density or field strength can move spectral structure into or out of the visible band. The approaching side may appear much brighter than the receding side, and the brightest patch need not trace the densest gas.

The renderer computes a frequency shift `g = ν_observed/ν_emitted` from the ray and gas motion. Emitted intensity transforms with `g³`, while its spectrum is sampled at `ν_observed/g`. This combines gravitational and Doppler effects before integrating visible light with color-matching functions. The relativistic transfer basis is described by [Younsi, Wu & Fuerst (2012)](https://arxiv.org/abs/1207.4234).

There is no arbitrary blue-to-red palette attached to the hot-flow type. Nevertheless, visible color is an approximation to a physical spectrum, filtered through RGB representation, display gamut, exposure, and tone mapping. It is not an exact spectrum or a prediction of unaided human vision.

## 6. Absorption and scattering

Each gas segment contributes emission and attenuates light arriving from farther away. For a uniform segment the formal solution is

`I_out = I_in exp(−τ) + (j/κ) [1 − exp(−τ)]`, with `τ = κ Δℓ`.

Here `j` is emissivity, `κ` is extinction per length, and `Δℓ` is path length in the emitter's frame. The implementation evaluates the transparent limit without subtractive cancellation and combines overlapping torus, wind, and jet contributions before applying a segment's transfer.

True absorption is represented at three visible wavelengths: 610, 550, and 460 nm. Each is shifted to the emitter frame. The ray carries separate red, green, and blue transmissions, so gas can alter color as well as brightness. This is a three-band approximation, not a frequency-resolved spectrum along every ray. Electron scattering adds approximately grey optical extinction.

The local Compton model retains direct emission and adds up to three scattering-source orders. A representative column partitions photons between escape, absorption, and another scattering. Frequency redistribution conserves photon number within its finite grid and preserves the prescribed mean energy shift; photons outside the grid and the unresolved higher-order remainder are accounted for separately. A recoil turnover and approximate Klein–Nishina suppression limit high-energy behavior. Electron heating and global radiative-budget guards constrain energy transfer.

This does not solve photons travelling between different parts of the torus, or galaxy light scattering into a new direction. The RGB sky lacks the broad incident spectrum needed for that hot-electron calculation. Three local orders also become less reliable at high optical depth. Global relativistic Compton transport is a substantially different calculation, illustrated by [Niedźwiecki, Xie & Zdziarski (2011)](https://arxiv.org/abs/1107.0860).

## 7. Moving gas, winds, and jets

The animated torus carries density and thermal, magnetic, and energetic-electron reservoirs on a 32-by-96 radial/azimuthal grid. Differential rotation and inward transport move perturbations. Compression changes density and magnetic energy; bounded dissipation heats electrons and supplies the energetic tail; cooling removes energy.

These reservoirs give bright patches motion and a cooling history. They do not resolve three-dimensional turbulence, magnetic field lines, or the magnetorotational instability itself. Local energy transfers are balanced, but that does not establish a complete relativistic energy budget for the whole flow. The displayed clock is also capped per frame to prevent temporal aliasing and catch-up backlogs. Different lensed images sample the same current material state; separate photon travel-time delays are not evolved.

The wind prescription increases the inward mass supply with radius outside 8 `r_g`. The difference feeds a broad outflow. A requested radial exponent of 0.35 is reduced if its binding, kinetic, magnetic, and electron-heating costs would exceed the available budget. The mass ledger distinguishes supply at the outer edge, gas lost to the wind, jet loading, and gas crossing the horizon.

The jet prescription draws power from black-hole spin through horizon magnetic flux. A fast spin alone is insufficient: zero flux gives zero jet power. This follows the motivation of the Blandford–Znajek mechanism and numerical studies such as [Tchekhovskoy, Narayan & McKinney (2011)](https://arxiv.org/abs/1108.0412).

Our jet is a prescribed, accelerating pair of polar flows, with terminal Lorentz factor 3. Its power is allocated 65% to terminal kinetic energy, 30% to magnetic energy, and 5% to electrons. Its energetic-electron tail uses 3% of electron kinetic energy. These allocations and the opening profile are model choices, not universal measurements.

The rendered outflows are only the **inner bases**, within the hot model's 60 `r_g` extent. They do not include parsec-scale knots or radio lobes. Their gas has its own density, spectrum, velocity, absorption, and beaming; it can produce side emission or polar bright patches without an equally visible cloud everywhere. Those structures are steady prescriptions rather than a time-dependent jet-launch simulation.

## 8. The galactic sky and the camera

The background is the host galaxy seen from its nucleus. Stellar populations provide both individually represented stars and unresolved light; nebulae and dust contribute emission and extinction. There is no single prescribed “galactic-center sky color.” Direction, cloud structure, stellar populations, and viewing instrument all affect the rendered result. See [Galaxies and stars](galaxies-and-stars.md) and [Nebulae](nebulae.md).

The nuclear-star realization is bounded at 196,608 points. Their represented luminosity is deducted from the unresolved population rather than added on top of it. This supplies granular structure without generating every physical star or sending a stellar catalog through each black-hole ray. The lens samples the resulting sky texture.

Exposure applies to the whole composition. A bright nearby flow can saturate into a nearly white cloud and obscure an otherwise correctly rendered shadow. Reducing exposure reveals the flow's contrast but also darkens the stars and nebulae. Dense populations therefore do not require a uniformly bright background in the displayed image.

Hot cores now receive a starting exposure estimated from their already-generated reference spectrum. It can shorten exposure for a bright core, but never brightens a faint one above the previous sky preset. It stays fixed while the camera orbits. Manual compensation spans −16 to +4 stops; one stop doubles or halves exposure. This is a camera preset, not a biological adaptation model.

The hot plasma uses one common optical-radiance reference. Thin disks retain a separate spectrum-relative display gain. Absolute displayed brightness across the two regimes is consequently not a single calibrated observational prediction. Within the composition, the final exposure and HDR response act on the accumulated light together.

## 9. What full-resolution rendering does and does not mean

The strong-field trace and final black-hole image use the native drawing buffer. The material spectrum is precomputed, and the sky has 1024-pixel cube faces. Neither texture is a lower-resolution version of the final black-hole image; both still impose limits on detail that lensing can reveal.

Expensive spectral generation runs in a cancellable worker. The shadow and current sky remain interactive until the gas is ready. A cached material atlas avoids repeating the full spectral calculation inside every ray segment. Finite ray steps, three absorption bands, a bounded flow grid, and local scattering make the model practical; full resolution does not remove those approximations.

Tests check analytic geometry limits, independent ray comparisons, radiation and mass ledgers, spectral interpolation, photon accounting, cancellation, and resource disposal. Browser diagnostics compare regular and finer traces, and cached versus direct material sampling. Those checks constrain implementation error. They cannot establish that a prescribed electron-temperature law or a seeded magnetic-flux distribution matches every real accretion system.

## Implementation map

| Area | Source |
| --- | --- |
| Nucleus generation | [nucleus.ts](../../src/universe/galaxy/nucleus.ts) |
| Radii, orbits, feeding regimes | [blackHole.ts](../../src/core/physics/blackHole.ts), [accretionFlow.ts](../../src/universe/galaxy/accretionFlow.ts) |
| Kerr rays and gas transfer | [regularKerrGlsl.ts](../../src/render/blackhole/regularKerrGlsl.ts), [geodesicGlsl.ts](../../src/render/blackhole/geodesicGlsl.ts) |
| Hot spectra and local scattering | [hotFlowEmission.ts](../../src/universe/galaxy/hotFlowEmission.ts), [radiativeTransfer.ts](../../src/universe/galaxy/radiativeTransfer.ts) |
| Gas perturbations | [hotFlowDynamics.ts](../../src/universe/galaxy/hotFlowDynamics.ts), [thinDiskDynamics.ts](../../src/universe/galaxy/thinDiskDynamics.ts) |
| Outflow mass, energy, and emission | [hotOutflow.ts](../../src/universe/galaxy/hotOutflow.ts), [hotOutflowEmission.ts](../../src/universe/galaxy/hotOutflowEmission.ts) |
| Sky capture and stellar detail | [lensedSky.ts](../../src/render/blackhole/lensedSky.ts), [clusterStars.ts](../../src/universe/galaxy/clusterStars.ts) |
| Camera preset and asynchronous ownership | [coreExposure.ts](../../src/render/blackhole/coreExposure.ts), [streamingBlackHoleObject.ts](../../src/render/blackhole/streamingBlackHoleObject.ts) |
