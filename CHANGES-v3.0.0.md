---
source: claude
date: 2026-10-07
status: draft
---
# ssh4ai (Windows) v3.0.0 - parity with web app v5-ui-center

The renderer is now the web app's own UI (`src/renderer/index.html`, `styles/web.css`, `js/web-app.js` are unmodified copies of SSHWEB `public/`), so both look and behave the same. Small Electron-only layer: `js/electron-shim.js`, `styles/electron.css`, `styles/fonts.css` (local fonts, works offline), `src/main/api.cjs` (serves the web REST API from the local sql.js database).

Ported from web v1-v5: keyboard-interactive SSH login (ESXi/esx96), Secret Redactor removed (use Presidio), Web Links dock (4 slots, Presidio pre-seeded, own lock, icon upload/paste), Macros/Scratchpad dock tabs + Ctrl+J, colored Copy/Save .log/Clear/Zen buttons beside the terminal, centered layout, host filter, pin + drag-reorder.
App-specific changes: connection errors are now shown (as on web) instead of falling back to a simulated shell; window controls added to the header; Zen also toggles real fullscreen.
Notes: scratchpad text is kept per-install in the browser store (as on web), old DB scratchpad content is not migrated. Old v2.4.0 files are in `_backup-v2.4.0/`.
To update later: re-copy `SSHWEB/public/{index.html,css/style.css,js/app.js}`, re-apply: index.html head/script tags + win-controls block; remove `@import` lines from style.css.
