# Documentation

These pages describe the current implementation. Start with the model references for scientific assumptions, or the architecture for code ownership.

| Document | Purpose |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | Layers, generation, rendering and resource ownership |
| [Galaxies and stars](model/galaxies-and-stars.md) | Density, populations, evolution and optical light accounting |
| [Black holes](model/black-holes.md) | Relativistic geometry, accretion, appearance, camera response and model limits |
| [Hot-flow emission](model/hot-flow-emission.md) | Reduced plasma equations, transport, outflows and radiation accounting |
| [Nebulae](model/nebulae.md) | Gas and photon budgets, dust, representations and limits |
| [Worlds and surfaces](model/worlds-and-surfaces.md) | Systems, climate, atmosphere, terrain and seasonal appearance |
| [Performance](PERFORMANCE.md) | Budgets, scheduling, representative measurements and profiling |
| [Validation](VALIDATION.md) | Automated tests, browser checks and reproducible regressions |
| [Roadmap](ROADMAP.md) | Remaining work and deliberately deferred fidelity |
| [Reference data](../data/reference/README.md) | Published stellar tracks and table regeneration |
| [Audit archive](ARCHIVE.md) | Restore the original investigations and individual fix history |

## What belongs here

Keep explanations of current behavior, sources, assumptions, limitations, decisions that still matter, and compact validation summaries. Keep executable regression tests in `src/`, reusable diagnostic pages in `tools/validation/`, and benchmark entry points in `tools/benchmarks/`. Published input data belongs in `data/reference/`; generators belong in `scripts/`.

Write generated reports, CPU profiles, logs and comparison captures to ignored `.artifacts/`. Before discarding evidence that cannot be reproduced cheaply, archive it outside the checkout with a source commit, manifest and checksums. Link the archive from a short maintained summary. A local archive needs a separate backup if long-term retention is required.

Do not append a new chronological report for every fix. Update the relevant topic, put the regression in an executable check, and let the commit explain the change. Retain an image only when it explains a stable feature or regression; the five images here illustrate galaxy diversity, seasonal cover and the cloud-horizon defect.
