# Published reference data

## Geneva massive-star tracks

`geneva-z014-v04.tsv` is the retained VizieR extract used by the massive-star generator and its source-comparison tests. It is input data, not disposable benchmark output.

- Paper: [Ekström et al. (2012), grids of stellar models with rotation](https://arxiv.org/abs/1110.5049).
- Catalogue: [CDS/VizieR J/A+A/537/A146](https://doi.org/10.26093/cds/vizier.35370146).
- [Catalogue metadata](https://cdsarc.cds.unistra.fr/viz-bin/cat/J/A+A/537/A146) and [Geneva file formats](https://www.unige.ch/sciences/astro/evolution/en/database/file-formats).
- Source SHA-256: `64c876afe6d2c1773173b71babe006b1edda44794ba3f7c4c395e80a2f210ad0`.

Original catalogue headers, attribution and query metadata are retained in the file. Refer to the source provider for applicable data-use terms; the project does not assign a new license to the extract.

The six columns are initial mass in solar masses (`Mini`), selected phase row (`Line`), age in years, surviving mass in solar masses, log luminosity in solar units, and log effective temperature in kelvin; consult the preserved header for exact names. The extract contains 400 rows for each of ten initial masses: 9, 12, 15, 20, 25, 32, 40, 60, 85 and 120 solar masses, at Z = 0.014 and initial v/vcrit = 0.4.

Regenerate from the repository root:

```bash
npm run generate:massive
npm test -- src/universe/star/massiveTracks.test.ts
```

The generator writes `src/universe/star/massiveTrackData.ts`, aligning phases at shared knots and compressing to tolerances of 0.006 dex in log luminosity, 0.004 dex in log temperature and 0.002 of initial mass. The 8-solar-mass bridge is synthetic; it must not be presented as a published track. Row 110 marks the reference turnoff. Tracks at 12 solar masses and above reach the core-carbon-burning endpoint; the 9-solar-mass track reaches early AGB and is incomplete as a full post-main-sequence lifetime.

The runtime table covers one metallicity and one initial rotation. It is not a complete grid for binary interaction, all metallicities or detailed remnant physics. Tests check source compression and radiated-energy integration as well as the generated model's bounds.

## Other generated tables

The following generators use analytic prescriptions or source data embedded in their scripts. Their output belongs in the source tree because the app consumes it without repeating expensive integration at startup.

| Command/script | Purpose |
| --- | --- |
| `npm run generate:stellar-response` | Optical stellar response table |
| `npm run generate:population` | Population mass/light moments |
| `scripts/generate-field-population.mjs` | Field-star population table |
| `scripts/generate-field-selection.mjs` | Field selection table |
| `scripts/generate-overview-population.mjs` | Galaxy overview population table |
| `python3 scripts/generate-annual-insolation.py` | Annual forcing: 129 tilts, 12 equal-area latitude centers, 512 orbital samples |

Run these from the repository root. Review generated numeric changes together with their model changes and tests; a path-only documentation reorganization should not alter table values.
