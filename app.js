import encodeJpeg from "@jsquash/jpeg/encode.js";
import decodeJpeg from "@jsquash/jpeg/decode.js";
import encodeWebp from "@jsquash/webp/encode.js";
import decodeWebp from "@jsquash/webp/decode.js";
import encodeAvif from "@jsquash/avif/encode.js";
import decodeAvif from "@jsquash/avif/decode.js";

// ---- benchmark definition --------------------------------------------------

const QUALITIES = [100, 90, 70, 50, 30, 10];
const SSIM_TARGET = 0.95; // threshold used for the "smallest file at ~equal quality" line
const CROP = 200; // px, centre crop shown in each cell

const FORMATS = [
  { label: "JPEG", mime: "image/jpeg", encode: (img, quality) => encodeJpeg(img, { quality }), decode: decodeJpeg },
  { label: "WebP", mime: "image/webp", encode: (img, quality) => encodeWebp(img, { quality }), decode: decodeWebp },
  { label: "AVIF", mime: "image/avif", encode: (img, quality) => encodeAvif(img, { quality }), decode: decodeAvif },
];

// ---- DOM -------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const ui = {
  file: $("file"),
  status: $("status"),
  results: $("results"),
  original: $("original"),
  originalCrop: $("original-crop"),
  lossy: $("lossy"),
  takeaway: $("takeaway"),
};

let objectUrls = [];

const formatSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} kB`;

const formatTime = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

// Let the browser paint before a synchronous wasm encode blocks the thread.
const yieldToPaint = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

function setStatus(text) {
  ui.status.textContent = text;
}

// ---- quality metric --------------------------------------------------------

// Mean SSIM over non-overlapping 8×8 luma blocks. Cheap approximation of the
// usual Gaussian-window SSIM; good enough to rank encodes of the same image.
function ssim(a, b, width, height) {
  const W = 8;
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

  let total = 0;
  let blocks = 0;
  for (let y = 0; y + W <= height; y += W) {
    for (let x = 0; x + W <= width; x += W) {
      let ma = 0, mb = 0, va = 0, vb = 0, cov = 0;
      for (let j = 0; j < W; j++) {
        let p = ((y + j) * width + x) * 4;
        for (let i = 0; i < W; i++, p += 4) {
          const la = luma(a, p);
          const lb = luma(b, p);
          ma += la; mb += lb;
          va += la * la; vb += lb * lb;
          cov += la * lb;
        }
      }
      const n = W * W;
      ma /= n; mb /= n;
      va = va / n - ma * ma;
      vb = vb / n - mb * mb;
      cov = cov / n - ma * mb;
      total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      blocks++;
    }
  }
  return blocks ? total / blocks : 1;
}

// ---- rendering -------------------------------------------------------------

function drawCrop(canvas, image) {
  const w = Math.min(CROP, image.width);
  const h = Math.min(CROP, image.height);
  const sx = Math.floor((image.width - w) / 2);
  const sy = Math.floor((image.height - h) / 2);

  canvas.width = w;
  canvas.height = h;
  const src = new OffscreenCanvas(image.width, image.height);
  src.getContext("2d").putImageData(image, 0, 0);
  canvas.getContext("2d").drawImage(src, sx, sy, w, h, 0, 0, w, h);
}

// One row per format, one column per quality step. Returns cell lookup.
function buildTable(table) {
  table.innerHTML = "";

  const head = table.createTHead().insertRow();
  head.insertCell().outerHTML = `<th>Format</th>`;
  head.insertCell().outerHTML =
    `<th colspan="${QUALITIES.length}" class="axis">less compression → more compression (each row uses its own encoder's quality scale)</th>`;

  const cells = new Map();
  const body = table.createTBody();
  for (const format of FORMATS) {
    const row = body.insertRow();
    row.insertCell().outerHTML = `<th>${format.label}</th>`;
    for (const quality of QUALITIES) {
      const cell = row.insertCell();
      cell.innerHTML = `<small>${format.label} q=${quality}</small>…`;
      cells.set(`${format.label}/${quality}`, cell);
    }
  }
  return (format, quality) => cells.get(`${format.label}/${quality}`);
}

function fillCell(cell, result) {
  const { format, quality, bytes, ms, score, decoded, originalSize } = result;
  const url = URL.createObjectURL(new Blob([bytes], { type: format.mime }));
  objectUrls.push(url);

  const percent = (bytes.byteLength / originalSize) * 100;
  cell.innerHTML = `
    <small>${format.label} q=${quality}</small>
    <canvas class="crop" title="Centre ${CROP}×${CROP} crop, 1:1 pixels"></canvas>
    <a href="${url}" target="_blank" rel="noopener">${formatSize(bytes.byteLength)}</a>
    <small>${percent.toFixed(1)} % of original</small>
    <small>${formatTime(ms)}</small>
    <small>SSIM ${score.toFixed(3)}</small>`;
  drawCrop(cell.querySelector("canvas"), decoded);
}

// Estimate the file size each format needs to reach SSIM_TARGET by
// interpolating (linearly in log-size) between the two steps that bracket it.
// Picking the nearest step instead would compare e.g. SSIM 0.99 against 0.95.
function sizeAtTarget(results) {
  const sorted = [...results].sort((a, b) => a.score - b.score);
  const hi = sorted.find((r) => r.score >= SSIM_TARGET);
  if (!hi) return null;
  const lo = [...sorted].reverse().find((r) => r.score < SSIM_TARGET);
  if (!lo) return { bytes: hi.bytes.byteLength, via: `q=${hi.quality}` };

  const t = (SSIM_TARGET - lo.score) / (hi.score - lo.score);
  const logSize = Math.log(lo.bytes.byteLength) + t * (Math.log(hi.bytes.byteLength) - Math.log(lo.bytes.byteLength));
  return { bytes: Math.exp(logSize), via: `between q=${lo.quality} and q=${hi.quality}` };
}

function renderTakeaway(results) {
  const estimates = FORMATS.map((format) => ({
    format,
    est: sizeAtTarget(results.filter((r) => r.format === format)),
  }));

  const parts = estimates.map(({ format, est }) =>
    est ? `${format.label} ≈ ${formatSize(est.bytes)} (${est.via})` : `${format.label}: no step reached ${SSIM_TARGET}`,
  );
  let text = `Estimated size at SSIM ${SSIM_TARGET}: ${parts.join("; ")}.`;

  const reached = estimates.filter((e) => e.est).sort((a, b) => a.est.bytes - b.est.bytes);
  if (reached.length > 1) {
    const [winner, ...rest] = reached;
    const vs = rest.map((r) => `${(100 - (winner.est.bytes / r.est.bytes) * 100).toFixed(0)} % smaller than ${r.format.label}`);
    text += ` At equal measured quality ${winner.format.label} is ${vs.join(" and ")}.`;
  }
  ui.takeaway.textContent = text;
}

// ---- pipeline --------------------------------------------------------------

async function decodeFile(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function encodeStep(cell, format, quality, image, originalSize) {
  cell.classList.add("active");
  await yieldToPaint();

  const start = performance.now();
  const bytes = await format.encode(image, quality);
  const ms = performance.now() - start;

  const decoded = await format.decode(bytes);
  const score = ssim(image.data, decoded.data, image.width, image.height);

  const result = { format, quality, bytes, ms, score, decoded, originalSize };
  fillCell(cell, result);
  cell.classList.remove("active");
  return result;
}

async function run(file) {
  ui.file.disabled = true;
  objectUrls.forEach(URL.revokeObjectURL);
  objectUrls = [];
  ui.takeaway.textContent = "";

  try {
    setStatus(`Decoding ${file.name}…`);
    const image = await decodeFile(file);

    ui.original.textContent = `${file.name} — ${image.width}×${image.height}, ${formatSize(file.size)}`;
    drawCrop(ui.originalCrop, image);
    const cellFor = buildTable(ui.lossy);
    ui.results.hidden = false;

    const total = QUALITIES.length * FORMATS.length;
    let done = 0;
    const started = performance.now();
    const results = [];

    for (const quality of QUALITIES) {
      for (const format of FORMATS) {
        setStatus(`Encoding ${format.label} at quality ${quality} (${++done}/${total})…`);
        results.push(await encodeStep(cellFor(format, quality), format, quality, image, file.size));
      }
    }

    renderTakeaway(results);
    setStatus(`Done in ${formatTime(performance.now() - started)}.`);
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error.message}`);
  } finally {
    ui.file.disabled = false;
  }
}

ui.file.addEventListener("change", () => {
  const file = ui.file.files[0];
  if (file) run(file);
});
