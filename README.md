# Image compression benchmark

Pick a JPEG or PNG; the browser encodes it to JPEG, WebP and AVIF at quality
100, 90, 70, 50, 30 and 10, decodes each result and scores it against the
original with a block SSIM. Every cell shows a 1:1 centre crop, size, percent
of the original, encode time and SSIM, and opens in a new tab. A summary line
estimates the file size each format needs to reach SSIM 0.95 (interpolated
between the bracketing steps) — the only fair cross-format comparison, since
the quality numbers are per-codec knobs.

PNG is deliberately not included: it is lossless and has no quality knob, so
its output is not comparable with the lossy formats. See the notes at the
bottom of the page for what the quality numbers mean per format.

Everything runs client-side with the [jSquash](https://github.com/jamsinclair/jSquash) wasm codecs.

## Run

```sh
npm install
npm start        # python3 -m http.server 8080
```

Open http://localhost:8080. A static server is required because ES modules and
wasm cannot be loaded from `file://`.

## Files

- `index.html` — page, import map for `node_modules`, a few lines of CSS
- `app.js` — the whole app: benchmark definition, table rendering, encode loop
- `original.jpg` — sample input
