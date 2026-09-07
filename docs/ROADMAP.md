# Roadmap

The September 2026 audit has reached an integration checkpoint. Galaxy structure/populations, nebula accounting and representations, stellar evolution, system inventories, terrain LOD, atmosphere transport, thermal light and seasonal appearance have received implementation and regression coverage. This closes the identified audit batches; it does not establish full scientific fidelity at every scale.

## Next priorities

1. **Release verification and loading stability.** Check representative supported browsers/devices and the published base path. Track remaining cold body-switch hitches separately from smooth warm traversal. Preserve bounded resource ownership and avoid tuning to a single FPS number.
2. **Viewing instruments.** Build on shared emitted/reflected light. Define wavelength bands and detector response, then add appropriate stellar/planetary spectra and wavelength-dependent atmosphere/dust transport. An infrared camera needs real thermal power outside the optical band, not an optical palette change.
3. **Targeted scientific validation.** Expand population/track coverage, calibrate galaxy families and test end-to-end light/extinction across selected cameras. Add reference cases where they constrain the model meaningfully.
4. **Focused surface and system improvements.** Use visual review to select remaining geology, gas-giant and small-body work. Prefer coherent changes to adding more loosely coupled layers.

## Deliberately deferred

- Full radiation hydrodynamics, nebular metal chemistry and evolving dust.
- Coupled atmospheric radiation/convection, chemistry, weather and snow/water feedback.
- Broad metallicity/rotation stellar tracks and interacting-binary evolution.
- Self-consistent galaxy dynamics, long-term formation simulations and deep geology/ecology.
- Exact versioned camera/time replay, exhaustive arbitrary-scene flux closure and a WebGPU backend evaluation.

The [model references](README.md) explain current approximations. [Performance](PERFORMANCE.md) distinguishes measured improvements from remaining limits. Historical milestone plans and all original findings are retained in the [audit archive](ARCHIVE.md), rather than carried forward as contradictory active plans.
