# Model audit archive

The original September 2026 investigations, raw test/benchmark output, comparison images and chronological plans are preserved outside the source checkout. The repository retains current reference docs, reusable validation tools, five explanatory images and the published input data required by tests and generators.

Archive ID: **2026-09-07-model-audit-4f56606**

Source branch: `codex/model-audit-fixes`

Source commit: `4f5660675c7277d7afb8f8404caa2e590fb915f6`

The archive was created at `/Users/phelps/Archives/universe/2026-09-07-model-audit-4f56606`. This is a local location, not a public download or remote backup. Copy the directory to durable backed-up storage for independent retention; do not rely on a worktree or temporary restore directory.

| File | Contents |
| --- | --- |
| `model-audit-history.bundle` | Complete reachable Git history through the source commit, including individual fixes and committed evidence |
| `documentation-and-evidence.tar.gz` | All 918 original documentation files, including local untracked/ignored evidence |
| `manifest.json` | Per-file sizes and SHA-256 hashes, source identity and archive checksums |
| `README.md` | Restoration instructions and verification record |

The portable [archive manifest](archive-manifest.json) records the two artifact sizes and SHA-256 hashes. All 918 tar entries were read back and matched against original file checksums. The bundle passed `git bundle verify`; a separate restored checkout reached the expected commit and passed `git fsck --no-dangling`.

## Restore

From a directory containing the archive files:

```bash
shasum -a 256 model-audit-history.bundle documentation-and-evidence.tar.gz
# Compare with archive-manifest.json from this repository.
git bundle verify model-audit-history.bundle
git clone --branch codex/model-audit-fixes model-audit-history.bundle restored-sim
git -C restored-sim rev-parse HEAD
mkdir restored-docs
tar -xzf documentation-and-evidence.tar.gz -C restored-docs
```

Specify the branch when cloning: the bundle contains that branch ref, not a default `HEAD` ref. The restored documentation lives under `restored-docs/docs/`.

## Git integration policy

Removing large files in a later commit does not remove their earlier versions from Git ancestry. The cleaned audit branch is therefore integrated into `main` as a squash. The original branch and bundle preserve the per-fix history; the mainline commit contains the curated final tree. Publishing the original audit branch would still publish its historical artifacts. No shared history is rewritten and no other worktree is removed.
