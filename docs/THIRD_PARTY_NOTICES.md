# Third-party notices

This repository vendors a small browser-side glass effect for the optional workspace liquid glass UI.

## liquidGL

- Source: <https://github.com/naughtyduk/liquidGL>
- Website/demo: <https://liquidgl.naughtyduk.com/>
- Vendored files:
  - `public/vendor/liquidgl/liquidGL.js`
  - `public/vendor/liquidgl/assets/*.webp`
- License notice in vendored `liquidGL.js`: MIT.
- Local note: the vendored script has small cleanup fixes so toggling/rebuilding glass does not leave stale bound mouse/touch handlers, resize observers, scroll RAF loops, or old WebGL canvases behind. It also keeps the previous liquid canvas visible during recapture because the app already excludes liquid canvases from html2canvas snapshots.

## html2canvas

- Source: <https://github.com/niklasvh/html2canvas>
- Vendored file: `public/vendor/liquidgl/html2canvas.min.js`
- License: MIT.

If these vendor files are updated, re-check upstream license files and keep this notice current.
