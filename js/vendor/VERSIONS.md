# Vendored libraries

Exact upstream files shipped under `js/vendor/`, with the version each file declares in its own header and its SHA-256 as committed. Licences are the upstream licences; no file is modified.

| File | Library | Version (from the file header) | Licence | SHA-256 (first 16) | Bytes |
|---|---|---|---|---|---|
| `gsap.min.js` | GSAP core | 3.13.0 | GSAP Standard License (free for most uses; see gsap.com/licensing) | `96c01b81f44a3290` | 72,435 |
| `ScrollTrigger.min.js` | GSAP ScrollTrigger plugin | 3.13.0 | GSAP Standard License | `308219390e5e3b84` | 44,157 |
| `SplitText.min.js` | GSAP SplitText plugin | 3.13.0 | GSAP Standard License (free since GSAP 3.13) | `5e519ea2470faa15` | 7,247 |
| `lenis.min.js` | Lenis smooth scroll (darkroom.engineering) | 1.3.26 | MIT | `47b79e37f93a8f9a` | 18,777 |

Consumers: `js/app.js` uses GSAP, ScrollTrigger, SplitText and Lenis; `js/hero-value.js`, `js/charts.js` and `js/dash.js` use GSAP and ScrollTrigger; `js/rail.js` and `js/request.js` use none of them. Pages load only the scripts they have a consumer for (see the `<script defer>` list at the head of each page).

To verify: `sha256sum js/vendor/*.js`. To update a library, replace the file, record the new version and hash here, and run `node --test tests/` plus a visual pass of the homepage hero, the data desk and the client-perspectives rail.
