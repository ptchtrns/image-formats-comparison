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
npm run dev      # Vite dev server, http://localhost:5173
```

## Deploy

Static build served from Cloudflare Workers (assets only, no worker code):

```sh
npm run deploy   # vite build && wrangler deploy
```

`wrangler login` first if not logged in. Config in `wrangler.jsonc`.

## Files

- `index.html` — page, a few lines of CSS
- `app.js` — the whole app: benchmark definition, table rendering, encode loop
- `wrangler.jsonc` — Cloudflare deploy config
