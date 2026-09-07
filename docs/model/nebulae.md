# Nebulae and dark clouds

Nebulae are seeded gas clouds illuminated by explicit stellar sources. Cloud geometry, material accounting, ionization, dust attenuation and distant portraits are related representations of that model. A dark cloud has no intrinsic optical glow merely because the observer enters it.

## Physical accounting

The natal gas inventory is distinct from the present visible or ionized extent. Feedback remaps material conservatively and records material leaving the represented domain. Fine and coarse domains exchange boundary radiation; multiple internal sources and external continuum contribute without duplicating the same photon budget.

The hydrogen solution uses a case-B recombination approximation. At 10,000 K its reference coefficients include αB = 2.59 × 10⁻¹³ cm³/s and an Hβ effective coefficient of 3.03 × 10⁻¹⁴ cm³/s, with photon energy about 4.09 × 10⁻¹² erg. The implementation and conventions are in [line emission](../../src/universe/galaxy/nebulaLines.ts). Stellar ionizing spectra are approximated with blackbodies.

[Gas inventory](../../src/universe/galaxy/nebulaGasInventory.ts), [accounting](../../src/universe/galaxy/nebulaAccounting.ts), [feedback](../../src/universe/galaxy/nebulaFeedback.ts), and the [paired-domain solver](../../src/universe/galaxy/nebulaPair.ts) keep material transport, radiation balance and representation boundaries explicit. Archived representative cases closed their mass and photon ledgers near 10⁻¹⁰ and 10⁻¹⁵ relative residuals respectively. Ledger closure does not establish spatial convergence or physical completeness.

Expansion is a bounded kinematic prescription, informed by H II-region behavior and benchmarks such as [STARBENCH](https://academic.oup.com/mnras/article/453/2/1324/1135077). It does not solve momentum and energy equations. Changing source histories or density structure can exceed the validity of the reference expansion law.

## Dust and rendered appearance

Dust removes and redistributes source light. Continuum uses a gray scattering approximation (reference albedo 0.6 and asymmetry parameter g = 0.6), informed by [Draine's Milky Way dust tables](https://www.astro.princeton.edu/~draine/dust/extcurvs/kext_albedo_WD_MW_3.1_60_D03.all). These constants are an optical approximation, not a wavelength-dependent grain model.

Portraits project the same density, emission and source locations used by local volumes. Camera direction, domain mapping and transfer conventions are shared. Empty space remains transparent, and an opaque dark center must not acquire a separate off-black emissive fill. Distant statistical dust accounts for material outside the resident foreground contribution.

Hydrogen emission has a physical photon budget. Metal/helium line ratios and diagnostic color mappings remain illustrative reduced prescriptions; they are not a full thermal/chemical ionization network. Optical and narrowband presentations should not be described as calibrated spectroscopic predictions.

## Work limits and validation

Bakes have finite iteration, resolution and memory limits. Early portraits appear before expensive refinement; camera motion prioritizes useful representations. Uploads are staged, and replacement data does not displace a ready volume until usable. A work cap can end a refinement before numerical convergence; completion of a job is not a convergence certificate.

Unit tests cover material/photon accounting, paired domains, gas inventory, encoding, continuum, portrait projection and memory admission. Browser checks validate GPU storage/readback and [staged volume uploads](../../tools/validation/volume-upload.html). See [performance](../PERFORMANCE.md) for the payload partition and measurement limits.

Remaining scientific extensions are radiation hydrodynamics, calibrated thermal/metal chemistry, evolving dust destruction/drift, and broader resolution/convergence studies. They are separate model projects, not prerequisites for the current bounded procedural nebula representation.
