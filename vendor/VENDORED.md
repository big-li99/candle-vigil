# Vendored: pixelfx

- Source: https://github.com/patch-gg/pixelfx
- Commit: `044e12a45dc9cc312cec50ee606dfc98afe5adc2` (2026-11-09), package version 0.3.1
- Copied: `src/core/` and `src/fx/` (whole tree — the bundler pulls in only what the game imports)
- License: MIT (see `vendor/pixelfx/LICENSE`); the Patch Pixel font is Patch's own, not used here
- Also copied: `LICENSE`, `NOTICE.md`

**Read-only.** Do not edit anything under `vendor/pixelfx/`. Wrap behaviour in `src/` instead.
The copy is pinned on purpose: a git dependency re-resolves on install and silently changes the art.
