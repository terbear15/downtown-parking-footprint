/* Downtown Parking Footprint — in-browser U-Net pipeline (TensorFlow.js, WebGL/GPU).
   Loaded into the review page: dataset building, training, evaluation, city-wide
   mosaic inference, oriented outline tracing and review-set export.
   Round 4 adds OSM building footprints as hard negatives (rooftops). */
(function () {
  'use strict';
  const AI = window.AI = window.AI || {};
  const IN = AI.IN = 224, Z = AI.Z = 17;
  const lon2x = (lon, z) => (lon + 180) / 360 * 2 ** z;
  const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
  const x2lon = (x, z) => x / 2 ** z * 360 - 180;
  const y2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(Math.sinh(n)); };
  AI.f = { lon2x, lat2y, x2lon, y2lat };
  AI.prog = '';
  const BASE = new URL('../', location.href).href;

  AI.decodeRing = s => { const v = s.split(' ').map(Number); let x = v[0], y = v[1]; const r = [[x / 1e5, y / 1e5]]; for (let i = 2; i < v.length; i += 2) { x += v[i]; y += v[i + 1]; r.push([x / 1e5, y / 1e5]); } return r; };
  AI.rleDecode = (rle, n) => { const m = new Uint8Array(n * n); let p = 0, v = 0; rle.forEach(r => { if (v) m.fill(1, p, p + r); p += r; v = 1 - v; }); return m; };
  AI.polyArea = p => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(a) / 2; };

  /* ---------- data access ---------- */
  const cityCache = {};
  AI.city = async id => cityCache[id] || (cityCache[id] = await fetch(BASE + 'data/cities/' + id + '.json').then(r => r.json()));
  AI.index = null;
  AI.loadIndex = async () => AI.index = await fetch(BASE + 'data/index.json').then(r => r.json());
  AI.register = async () => {
    const q = { collections: ['naip'], 'filter-lang': 'cql2-json', filter: { op: '>=', args: [{ property: 'datetime' }, '2021-01-01T00:00:00Z'] }, sortby: [{ field: 'datetime', direction: 'desc' }] };
    AI.mosaicQuery = q;
    const j = await fetch('https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(q) }).then(r => r.json());
    AI.tpl = 'https://planetarycomputer.microsoft.com/api/data/v1/mosaic/' + j.searchid + '/tiles/WebMercatorQuad/{z}/{x}/{y}?collection=naip&assets=image&asset_bidx=image%7C1,2,3';
  };
  AI.image = (x, y) => new Promise(res => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { const c = new OffscreenCanvas(IN, IN), g = c.getContext('2d'); g.drawImage(im, 0, 0, IN, IN); const d = g.getImageData(0, 0, IN, IN).data, o = new Uint8Array(IN * IN * 3); let s = 0; for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { o[j] = d[i]; o[j + 1] = d[i + 1]; o[j + 2] = d[i + 2]; s += d[i]; } res(s / (IN * IN) < 3 ? null : o); };
    im.onerror = () => res(null);
    im.src = AI.tpl.replace('{z}', Z).replace('{x}', x).replace('{y}', y);
  });
  async function pool(items, n, fn) { let i = 0; const out = new Array(items.length); await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }
  AI.pool = pool;

  /* tiles at z17 covering the downtown outline */
  AI.tilesFor = async id => {
    const d = await AI.city(id); const rings = d.outline.map(AI.decodeRing);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; rings.flat().forEach(([lo, la]) => { const x = lon2x(lo, Z), y = lat2y(la, Z); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
    const X0 = Math.floor(x0), Y0 = Math.floor(y0), W = Math.floor(x1) - X0 + 1, H = Math.floor(y1) - Y0 + 1, S = 8;
    const c = new OffscreenCanvas(W * S, H * S), g = c.getContext('2d'); g.fillStyle = '#fff'; g.beginPath();
    rings.forEach(r => r.forEach(([lo, la], i) => { const px = (lon2x(lo, Z) - X0) * S, py = (lat2y(la, Z) - Y0) * S; i ? g.lineTo(px, py) : g.moveTo(px, py); })); g.fill('evenodd');
    const im = g.getImageData(0, 0, W * S, H * S).data, out = [];
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) { let hit = false; for (let r = 0; r < S && !hit; r++) for (let q = 0; q < S; q++) if (im[((ty * S + r) * W * S + tx * S + q) * 4 + 3]) { hit = true; break; } if (hit) out.push([X0 + tx, Y0 + ty]); }
    return out;
  };

  /* OSM building footprints (Overpass), rings in lon/lat */
  const bldCache = {};
  AI.buildings = async id => {
    if (bldCache[id]) return bldCache[id];
    const d = await AI.city(id), [[w, s], [e, n]] = d.bounds, m = 0.004;
    const q = '[out:json][timeout:120];way["building"](' + (s - m) + ',' + (w - m) + ',' + (n + m) + ',' + (e + m) + ');out geom;';
    for (const ep of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
      for (let t = 0; t < 2; t++) {
        try { const r = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q) }); if (!r.ok) throw r.status; const j = await r.json();
          return bldCache[id] = j.elements.filter(el => el.geometry && el.geometry.length > 3 && !/parking/.test(el.tags.building || '') ).map(el => el.geometry.map(p => [p.lon, p.lat]));
        } catch (err) { await new Promise(r => setTimeout(r, 4000)); }
      }
    }
    throw new Error('overpass failed ' + id);
  };

  /* buildings touching a z17 tile, via a tile-bucket index */
  const bIdx = {};
  AI.bldTile = (id, tx, ty) => { const b = bldCache[id]; if (!b) return []; if (!bIdx[id]) { const m = new Map(); b.forEach((r, k) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [lo, la] of r) { const x = lon2x(lo, Z), y = lat2y(la, Z); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } for (let X = Math.floor(x0); X <= Math.floor(x1); X++) for (let Y = Math.floor(y0); Y <= Math.floor(y1); Y++) { const key = X + ',' + Y; if (!m.has(key)) m.set(key, []); m.get(key).push(r); } }); bIdx[id] = m; } return bIdx[id].get(tx + ',' + ty) || []; };

  /* paint lon/lat rings into a canvas whose origin is tile (x0,y0) at IN px per tile */
  AI.paint = (g, rings, x0, y0) => { g.beginPath(); for (const ring of rings) { ring.forEach((p, i) => { const px = (lon2x(p[0], Z) - x0) * IN, py = (lat2y(p[1], Z) - y0) * IN; i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.closePath(); } g.fill('evenodd'); };
  AI.rasterRings = (rings, tx, ty) => { const c = new OffscreenCanvas(IN, IN), g = c.getContext('2d'); g.fillStyle = '#fff'; AI.paint(g, rings, tx, ty); const d = g.getImageData(0, 0, IN, IN).data, m = new Uint8Array(IN * IN); for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0; return m; };
  const ringsOfLot = l => l.outer.map(AI.decodeRing).concat((l.inner || []).map(AI.decodeRing));

  /* ---------- review history ---------- */
  AI.loadReviews = async () => {
    const get = p => fetch(p).then(r => r.ok ? r.json() : null).catch(() => null);
    AI.rounds = [];
    for (const [n, sp, ap] of [[1, 'review.json', 'round1_results.json'], [2, 'review_r2.json', 'round2_results.json'], [3, 'review_r3.json', 'round3_results.json']]) {
      const s = await get(sp), a = await get(ap); if (s && a) AI.rounds.push({ n, set: s, ans: a.answers || a });
    }
    AI.reviewed = [];   // {round,id,city,a,kind,poly|mask,x,y}
    for (const R of AI.rounds) for (const d of R.set.detections) { const a = R.ans[d.id]; if (a !== 'yes' && a !== 'no') continue;
      if (d.poly && d.poly.length >= 3) AI.reviewed.push({ round: R.n, id: d.id, city: d.city, a, kind: 'poly', poly: d.poly, lon: d.lon, lat: d.lat });
      else if (d.mask) AI.reviewed.push({ round: R.n, id: d.id, city: d.city, a, kind: 'mask', mask: d.mask, x: d.x, y: d.y, grid: R.set.grid || IN }); }
    return AI.reviewed.length;
  };
  const itemMask = (it, tx, ty) => { if (it.kind === 'poly') return AI.rasterRings([it.poly], tx, ty); if (it.x !== tx || it.y !== ty) return new Uint8Array(IN * IN); const g = it.grid, m = AI.rleDecode(it.mask, g); if (g === IN) return m; const o = new Uint8Array(IN * IN); for (let r = 0; r < IN; r++) for (let c = 0; c < IN; c++) o[r * IN + c] = m[Math.floor(r * g / IN) * g + Math.floor(c * g / IN)]; return o; };
  const itemTile = it => it.kind === 'mask' ? [it.x, it.y] : [Math.floor(lon2x(it.lon, Z)), Math.floor(lat2y(it.lat, Z))];
  AI.itemMask = itemMask; AI.itemTile = itemTile;

  /* ---------- dataset ---------- */
  function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
  AI.buildDS = async (o) => {
    o = Object.assign({ posPerCity: 22, negPerCity: 6, testFrac: 0.25, testRound: 3, bldW: 3 }, o || {});
    const R = rng(7); AI.DS = { train: { X: [], Y: [], W: [], meta: [] }, val: { X: [], Y: [], W: [], meta: [] }, fbTest: { X: [], Y: [], W: [], meta: [] } };
    // hold back a share of the latest round's answers as a fair test
    AI.testIds = new Set(AI.reviewed.filter(it => it.round === o.testRound).filter(() => R() < o.testFrac).map(it => it.id));
    const ids = AI.index.cities.map(c => c.id);
    const valCities = new Set(['denver', 'detroit', 'milwaukee', 'cleveland', 'indianapolis'].filter(c => ids.includes(c)));
    for (const id of ids) {
      AI.prog = 'ds ' + id;
      const d = await AI.city(id); let bld = []; try { bld = await AI.buildings(id); } catch (e) { AI.bldErr = (AI.bldErr || []).concat(id); }
      const tiles = await AI.tilesFor(id); const pos = [], neg = [];
      const lotRings = d.lots.map(ringsOfLot).concat((d.aiLots || []).map(ringsOfLot));
      const strRings = (d.structures || []).map(ringsOfLot);
      const lotTiles = new Set(); d.lots.forEach(l => lotTiles.add(Math.floor(lon2x(l.center[0], Z)) + ',' + Math.floor(lat2y(l.center[1], Z))));
      tiles.forEach(t => (lotTiles.has(t[0] + ',' + t[1]) ? pos : neg).push(t));
      pos.sort(() => R() - .5); neg.sort(() => R() - .5);
      const fb = AI.reviewed.filter(it => it.city === id);
      const jobs = pos.slice(0, o.posPerCity).map(t => [t, 'osm']).concat(neg.slice(0, o.negPerCity).map(t => [t, 'osm']));
      const byTile = new Map(); fb.forEach(it => { const k = itemTile(it).join(','); if (!byTile.has(k)) byTile.set(k, []); byTile.get(k).push(it); });
      for (const [k, its] of byTile) { const t = k.split(',').map(Number); jobs.push([t, its.some(it => AI.testIds.has(it.id)) ? 'test' : 'fb', its]); }
      const imgs = await pool(jobs, 8, j => AI.image(j[0][0], j[0][1]));
      jobs.forEach(([t, kind, its], k) => {
        const img = imgs[k]; if (!img) return; const [tx, ty] = t;
        const c = new OffscreenCanvas(IN, IN), g = c.getContext('2d');
        g.fillStyle = '#00f'; for (const b of AI.bldTile(id, tx, ty)) AI.paint(g, [b], tx, ty); for (const s of strRings) AI.paint(g, s, tx, ty);
        g.fillStyle = '#f00'; for (const l of lotRings) AI.paint(g, l, tx, ty);
        const px = g.getImageData(0, 0, IN, IN).data, Y = new Uint8Array(IN * IN), W = new Float32Array(IN * IN).fill(1);
        for (let i = 0; i < IN * IN; i++) { if (px[i * 4] > 127) Y[i] = 1; else if (px[i * 4 + 2] > 127) W[i] = o.bldW; }
        const meta = [id, tx, ty, kind, []];
        if (its) for (const it of its) { const m = itemMask(it, tx, ty); meta[4].push([it.kind, it.id, it.a]);
          if (kind === 'test' && AI.testIds.has(it.id)) continue;
          for (let i = 0; i < m.length; i++) if (m[i]) { if (it.a === 'yes') { Y[i] = 1; W[i] = 2; } else { Y[i] = 0; W[i] = 4; } } }
        const split = kind === 'test' ? 'fbTest' : (valCities.has(id) && kind === 'osm') ? 'val' : 'train';
        const D = AI.DS[split]; D.X.push(img); D.Y.push(Y); D.W.push(W); D.meta.push(meta);
        if (kind === 'test') { // a test tile still carries its non-test feedback: train on a copy without the test items
          const D2 = AI.DS.train; const Y2 = Y.slice(), W2 = W.slice(); D2.X.push(img); D2.Y.push(Y2); D2.W.push(W2); D2.meta.push([id, tx, ty, 'fb-of-test', []]);
          for (const it of its) if (AI.testIds.has(it.id)) { const m = itemMask(it, tx, ty); for (let i = 0; i < m.length; i++) if (m[i]) W2[i] = 0; }
        }
      });
    }
    AI.prog = 'built';
    return { train: AI.DS.train.X.length, val: AI.DS.val.X.length, test: AI.DS.fbTest.X.length, testItems: AI.testIds.size };
  };

  /* ---------- training ---------- */
  AI.batch = (split, idxs, aug) => { const D = AI.DS[split]; const n = idxs.length, X = new Float32Array(n * IN * IN * 3), Y = new Float32Array(n * IN * IN), Wt = new Float32Array(n * IN * IN);
    idxs.forEach((k, b) => { const x = D.X[k], y = D.Y[k], w = D.W[k]; const fx = aug && Math.random() < .5, fy = aug && Math.random() < .5, tr = aug && Math.random() < .5, jit = aug ? Math.random() * 0.2 - 0.1 : 0, con = aug ? 0.85 + Math.random() * 0.3 : 1;
      for (let r = 0; r < IN; r++) for (let c = 0; c < IN; c++) { let rr = fy ? IN - 1 - r : r, cc = fx ? IN - 1 - c : c; if (tr) { const t = rr; rr = cc; cc = t; } const si = rr * IN + cc, di = b * IN * IN + r * IN + c;
        for (let ch = 0; ch < 3; ch++) X[di * 3 + ch] = (x[si * 3 + ch] / 127.5 - 1) * con + jit; Y[di] = y[si]; Wt[di] = w[si]; } });
    return [tf.tensor4d(X, [n, IN, IN, 3]), tf.tensor4d(Y, [n, IN, IN, 1]), tf.tensor4d(Wt, [n, IN, IN, 1])]; };
  AI.loss = (y, p, w) => tf.tidy(() => { const e = 1e-6, pc = p.clipByValue(e, 1 - e);
    const bce = y.mul(pc.log()).add(tf.scalar(1).sub(y).mul(tf.scalar(1).sub(pc).log())).neg().mul(w).sum().div(w.sum().add(1));
    const wm = w.greater(0).cast('float32'), inter = y.mul(p).mul(wm).sum();
    return bce.add(tf.scalar(1).sub(inter.mul(2).add(1).div(y.mul(wm).sum().add(p.mul(wm).sum()).add(1)))); });
  AI.predictTile = (model, img) => { const P = tf.tidy(() => model.predict(tf.tensor4d(Float32Array.from(img, v => v / 127.5 - 1), [1, IN, IN, 3]))); const p = P.dataSync(); P.dispose(); return p; };
  AI.evalPix = (model, split, thr) => { const D = AI.DS[split]; let tp = 0, fp = 0, fn = 0, bp = 0, bn = 0;
    for (let k = 0; k < D.X.length; k++) { const p = AI.predictTile(model, D.X[k]), y = D.Y[k], w = D.W[k];
      for (let j = 0; j < p.length; j++) { const a = p[j] >= thr, t = y[j] > 0.5; if (a && t) tp++; else if (a) fp++; else if (t) fn++; if (w[j] === 3 && !t) { bn++; if (a) bp++; } } }
    return { iou: +(tp / (tp + fp + fn)).toFixed(3), precision: +(tp / (tp + fp)).toFixed(3), recall: +(tp / (tp + fn)).toFixed(3), roofFP: +(bp / Math.max(1, bn)).toFixed(4) }; };
  /* held-back reviewed items: share of each item's outline the model still calls parking */
  AI.fbScores = (model) => { const D = AI.DS.fbTest, out = new Map();
    for (let k = 0; k < D.X.length; k++) { const [id, tx, ty, , its] = D.meta[k]; const p = AI.predictTile(model, D.X[k]);
      for (const [kind, did, a] of its) { if (!AI.testIds.has(did)) continue; const it = AI.reviewed.find(r => r.id === did); const m = itemMask(it, tx, ty); let n = 0, s = 0; for (let j = 0; j < m.length; j++) if (m[j]) { n++; s += p[j]; } const o = out.get(did) || { a, n: 0, s: 0 }; o.n += n; o.s += s; out.set(did, o); } }
    return [...out.values()].filter(o => o.n).map(o => ({ a: o.a, mp: o.s / o.n })); };
  AI.evalFb = (model, thr, scores) => { scores = scores || AI.fbScores(model); let yh = 0, yn = 0, nh = 0, nn = 0;
    for (const s of scores) { const hit = s.mp >= thr; if (s.a === 'yes') { yn++; if (hit) yh++; } else { nn++; if (hit) nh++; } }
    return { thr, yesKept: +(yh / yn).toFixed(3), noKept: +(nh / nn).toFixed(3), yesN: yn, noN: nn, precision: +(yh / Math.max(1, yh + nh)).toFixed(3) }; };

  AI.train = (model, o) => { o = Object.assign({ epochs: 10, lr0: 1e-4, lr1: 3e-5, B: 8, thr: 0.78 }, o || {});
    AI.trainLog = []; AI.trainDone = false; const n = AI.DS.train.X.length; let ep = 0;
    const score = () => { const v = AI.evalPix(model, 'val', 0.5), f = AI.evalFb(model, o.thr); return { v, f, s: v.iou + f.precision * (f.yesKept >= 0.5 ? 1 : 0.5) }; };
    const b0 = score(); AI.trainBase = b0; AI.best = { s: b0.s, w: model.getWeights().map(w => w.clone()), ep: 0 };
    const step = () => { try {
      const lr = o.lr0 * Math.pow(o.lr1 / o.lr0, ep / Math.max(1, o.epochs - 1)), opt = tf.train.adam(lr), idx = [...Array(n).keys()].sort(() => Math.random() - .5); let L = 0, k = 0;
      for (let i = 0; i + o.B <= n; i += o.B) { const [X, Y, W] = AI.batch('train', idx.slice(i, i + o.B), true); const l = opt.minimize(() => AI.loss(Y, model.apply(X, { training: true }), W), true); L += l.dataSync()[0]; k++; l.dispose(); X.dispose(); Y.dispose(); W.dispose(); }
      opt.dispose(); ep++; const sc = score(); AI.trainLog.push(Object.assign({ ep, lr: +lr.toExponential(2), loss: +(L / k).toFixed(4), score: +sc.s.toFixed(3) }, sc.v, { fbYes: sc.f.yesKept, fbNo: sc.f.noKept, fbPrecision: sc.f.precision }));
      if (sc.s > AI.best.s) { AI.best.w.forEach(w => w.dispose()); AI.best = { s: sc.s, w: model.getWeights().map(w => w.clone()), ep }; }
      if (ep < o.epochs) setTimeout(step, 0); else { model.setWeights(AI.best.w); AI.trainDone = true; }
    } catch (e) { AI.trainErr = String(e); } };
    setTimeout(step, 0); return b0; };

  /* ---------- morphology / geometry ---------- */
  AI.dil = (m, W, H, r) => { const t = new Uint8Array(W * H), o = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) { let run = 0; for (let x = 0; x < W; x++) { run = m[y * W + x] ? r * 2 + 1 : Math.max(0, run - 1); if (run) t[y * W + x] = 1; } run = 0; for (let x = W - 1; x >= 0; x--) { run = m[y * W + x] ? r + 1 : Math.max(0, run - 1); if (run) t[y * W + x] = 1; } }
    for (let x = 0; x < W; x++) { let run = 0; for (let y = 0; y < H; y++) { run = t[y * W + x] ? r + 1 : Math.max(0, run - 1); if (run) o[y * W + x] = 1; } run = 0; for (let y = H - 1; y >= 0; y--) { run = t[y * W + x] ? r + 1 : Math.max(0, run - 1); if (run) o[y * W + x] = 1; } }
    return o; };
  AI.ero = (m, W, H, r) => { const inv = new Uint8Array(W * H); for (let i = 0; i < inv.length; i++) inv[i] = m[i] ? 0 : 1; const d = AI.dil(inv, W, H, r); for (let i = 0; i < d.length; i++) d[i] = d[i] ? 0 : 1; return d; };

  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  AI.hull = pts => { const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), lo = [], up = []; for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); } for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); } up.pop(); lo.pop(); return lo.concat(up); };
  AI.minRect = h => { let best = null; for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!L) continue; const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L; let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9; for (const p of h) { const u = p[0] * ux + p[1] * uy, v = -p[0] * uy + p[1] * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); } const ar = (u1 - u0 + 1) * (v1 - v0 + 1); if (!best || ar < best.ar) best = { ar, ux, uy, u0, u1, v0, v1 }; } return best; };
  const dpOpen = (pts, eps) => { if (pts.length < 3) return pts; const a = pts[0], b = pts[pts.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9; let dm = 0, k = 0; for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / L; if (d > dm) { dm = d; k = i; } } if (dm <= eps) return [a, b]; const l = dpOpen(pts.slice(0, k + 1), eps), r = dpOpen(pts.slice(k), eps); return l.slice(0, -1).concat(r); };
  AI.dpRing = (ring, eps) => { if (ring.length < 4) return ring; let far = 0, dm = -1; for (let i = 1; i < ring.length; i++) { const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]); if (d > dm) { dm = d; far = i; } } const a = dpOpen(ring.slice(0, far + 1), eps), b = dpOpen(ring.slice(far).concat([ring[0]]), eps); return a.slice(0, -1).concat(b.slice(0, -1)); };
  /* boundary of the largest 4-connected blob in a binary grid, as an axis-aligned ring (cell-corner coordinates) */
  AI.traceCells = (g, W, H) => {
    const lab = new Int32Array(W * H), sizes = [0]; let cur = 0;
    for (let i = 0; i < W * H; i++) { if (!g[i] || lab[i]) continue; cur++; let n = 0; const st = [i]; lab[i] = cur; while (st.length) { const q = st.pop(); n++; const x = q % W, y = (q / W) | 0; for (const nb of [x + 1 < W ? q + 1 : -1, x > 0 ? q - 1 : -1, y + 1 < H ? q + W : -1, y > 0 ? q - W : -1]) if (nb >= 0 && g[nb] && !lab[nb]) { lab[nb] = cur; st.push(nb); } } sizes.push(n); }
    if (!cur) return null; let L = 1; for (let k = 2; k <= cur; k++) if (sizes[k] > sizes[L]) L = k;
    const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && lab[y * W + x] === L;
    const next = new Map(), key = (x, y) => x + ',' + y, add = (a, b) => { const k = key(a[0], a[1]); if (!next.has(k)) next.set(k, []); next.get(k).push(b); };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (!on(x, y)) continue;
      if (!on(x, y - 1)) add([x, y], [x + 1, y]); if (!on(x + 1, y)) add([x + 1, y], [x + 1, y + 1]); if (!on(x, y + 1)) add([x + 1, y + 1], [x, y + 1]); if (!on(x - 1, y)) add([x, y + 1], [x, y]); }
    let best = null; const used = new Set();
    for (const [k0, outs] of next) for (let oi = 0; oi < outs.length; oi++) { const ek = k0 + '>' + oi; if (used.has(ek)) continue;
      const start = k0.split(',').map(Number), ring = [start]; let p = start, e = outs[oi]; used.add(ek); let guard = 0;
      while (guard++ < 200000) { const nk = key(e[0], e[1]); if (nk === k0) break; ring.push(e); const cand = next.get(nk) || []; let pick = -1;
        for (let j = 0; j < cand.length; j++) if (!used.has(nk + '>' + j)) { // prefer right turn at pinch points
          const c = cand[j], d1 = [e[0] - p[0], e[1] - p[1]], d2 = [c[0] - e[0], c[1] - e[1]]; if (pick < 0 || d1[0] * d2[1] - d1[1] * d2[0] > 0) pick = j; }
        if (pick < 0) break; used.add(nk + '>' + pick); p = e; e = cand[pick]; }
      if (!best || ring.length > best.length) best = ring; }
    const r = []; for (let i = 0; i < best.length; i++) { const a = best[(i - 1 + best.length) % best.length], b = best[i], c = best[(i + 1) % best.length]; if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) r.push(b); }
    return r;
  };
  /* oriented outline: rectangle if well filled, else traced right-angled polygon in the lot's own frame */
  AI.shapeOf = px => {
    const h = AI.hull(px); if (h.length < 3) return null; const r = AI.minRect(h); if (!r) return null; const fill = px.length / r.ar;
    const back = (u, v) => [u * r.ux - v * r.uy, u * r.uy + v * r.ux];
    if (fill >= 0.86) return { shape: 'rectangle', fill: +fill.toFixed(2), poly: [back(r.u0, r.v0), back(r.u1 + 1, r.v0), back(r.u1 + 1, r.v1 + 1), back(r.u0, r.v1 + 1)] };
    const W = Math.ceil(r.u1 - r.u0) + 7, H = Math.ceil(r.v1 - r.v0) + 7; let g = new Uint8Array(W * H);
    for (const [x, y] of px) { const u = x * r.ux + y * r.uy - r.u0 + 3, v = -x * r.uy + y * r.ux - r.v0 + 3; const ui = Math.round(u), vi = Math.round(v); if (ui >= 0 && vi >= 0 && ui < W && vi < H) g[vi * W + ui] = 1; }
    g = AI.ero(AI.dil(g, W, H, 2), W, H, 2); g = AI.dil(AI.ero(g, W, H, 1), W, H, 1);
    const ring = AI.traceCells(g, W, H); if (!ring || ring.length < 4) return null;
    let best = ring; for (const e of [1.6, 2.5, 3.5, 5]) { const q = AI.dpRing(best === ring ? ring : ring, e); if (q.length >= 4) best = q; if (best.length <= 12) break; }
    return { shape: 'outline', fill: +fill.toFixed(2), poly: best.map(([u, v]) => back(u + r.u0 - 3, v + r.v0 - 3)) };
  };
  AI.valid = (s, npx) => { if (!s || !s.poly || s.poly.length < 4 || !s.poly.every(p => isFinite(p[0]) && isFinite(p[1]))) return false; const a = AI.polyArea(s.poly); return a >= 0.6 * npx && a <= 1.8 * npx; };

  /* ---------- city-wide inference ---------- */
  AI.inferMosaic = async (id, model, o) => {
    o = Object.assign({ thr: 0.6, minM2: 2000, minProb: 0.8, maxOsm: 0.3, maxBld: 0.15, round: 4 }, o || {});
    const d = await AI.city(id); const tiles = await AI.tilesFor(id); let bld = []; try { bld = await AI.buildings(id); } catch (e) {}
    const xs = tiles.map(t => t[0]), ys = tiles.map(t => t[1]); const x0 = Math.min(...xs), y0 = Math.min(...ys), W = (Math.max(...xs) - x0 + 1) * IN, H = (Math.max(...ys) - y0 + 1) * IN;
    const prob = new Uint8Array(W * H); const imgs = await pool(tiles, 8, t => AI.image(t[0], t[1]));
    tiles.forEach(([x, y], k) => { const img = imgs[k]; if (!img) return; const p = AI.predictTile(model, img), ox = (x - x0) * IN, oy = (y - y0) * IN; for (let r = 0; r < IN; r++) for (let c = 0; c < IN; c++) prob[(oy + r) * W + ox + c] = Math.round(p[r * IN + c] * 255); });
    let bin = new Uint8Array(W * H); const t = Math.round(o.thr * 255); for (let i = 0; i < W * H; i++) bin[i] = prob[i] >= t ? 1 : 0;
    bin = AI.dil(AI.ero(bin, W, H, 2), W, H, 2); bin = AI.ero(AI.dil(bin, W, H, 3), W, H, 3);
    const cv = new OffscreenCanvas(W, H), g = cv.getContext('2d');
    g.fillStyle = 'rgba(255,0,0,1)'; for (const l of d.lots) AI.paint(g, ringsOfLot(l), x0, y0); for (const s of (d.structures || [])) AI.paint(g, ringsOfLot(s), x0, y0); for (const a of (d.aiLots || [])) AI.paint(g, ringsOfLot(a), x0, y0);
    const known = g.getImageData(0, 0, W, H).data.slice(); g.clearRect(0, 0, W, H);
    g.fillStyle = '#0f0'; for (const it of AI.reviewed.filter(r => r.city === id)) { if (it.kind === 'poly') AI.paint(g, [it.poly], x0, y0); else { const m = itemMask(it, it.x, it.y), ox = (it.x - x0) * IN, oy = (it.y - y0) * IN; if (ox < 0 || oy < 0 || ox + IN > W || oy + IN > H) continue; const im = g.getImageData(ox, oy, IN, IN); for (let j = 0; j < IN * IN; j++) if (m[j]) { im.data[j * 4 + 1] = 255; im.data[j * 4 + 3] = 255; } g.putImageData(im, ox, oy); } }
    const rev = g.getImageData(0, 0, W, H).data.slice(); g.clearRect(0, 0, W, H);
    g.fillStyle = '#00f'; for (const b of bld) AI.paint(g, [b], x0, y0); const bd = g.getImageData(0, 0, W, H).data;
    const pxm = 40075016.686 * Math.cos(d.core[1] * Math.PI / 180) / 2 ** Z / IN; const lab = new Uint8Array(W * H), dets = []; const why = { small: 0, osm: 0, rev: 0, prob: 0, roof: 0, shape: 0 };
    for (let i = 0; i < W * H; i++) { if (!bin[i] || lab[i]) continue; const comp = [], st = [i]; lab[i] = 1;
      while (st.length) { const q = st.pop(); comp.push(q); const r = (q / W) | 0, c = q % W; for (const n of [c + 1 < W ? q + 1 : -1, c > 0 ? q - 1 : -1, r + 1 < H ? q + W : -1, r > 0 ? q - W : -1]) if (n >= 0 && bin[n] && !lab[n]) { lab[n] = 1; st.push(n); } }
      const area = comp.length * pxm * pxm; if (area < o.minM2) { why.small++; continue; }
      let osm = 0, rv = 0, rf = 0, ps = 0; for (const q of comp) { if (known[q * 4 + 3] > 127) osm++; if (rev[q * 4 + 3] > 127) rv++; if (bd[q * 4 + 3] > 127) rf++; ps += prob[q]; }
      const n = comp.length, mp = ps / n / 255;
      if (osm / n > o.maxOsm) { why.osm++; continue; } if (rv / n > 0.3) { why.rev++; continue; } if (mp < o.minProb) { why.prob++; continue; } if (rf / n > o.maxBld) { why.roof++; continue; }
      const pts = comp.map(q => [q % W, (q / W) | 0]); const s = AI.shapeOf(pts); if (!AI.valid(s, n)) { why.shape++; continue; }
      const poly = s.poly.map(([px, py]) => [+x2lon(x0 + px / IN, Z).toFixed(6), +y2lat(y0 + py / IN, Z).toFixed(6)]); let sx = 0, sy = 0; for (const [px, py] of pts) { sx += px; sy += py; }
      dets.push({ id: id + '-r' + o.round + '-' + comp[0], city: id, cityName: d.name, lon: +x2lon(x0 + sx / n / IN, Z).toFixed(6), lat: +y2lat(y0 + sy / n / IN, Z).toFixed(6), acres: +(AI.polyArea(s.poly) * pxm * pxm / 4046.856).toFixed(3), prob: +mp.toFixed(3), roof: +(rf / n).toFixed(3), shape: s.shape, corners: s.poly.length, fill: s.fill, poly }); }
    AI.why = AI.why || {}; for (const k in why) AI.why[k] = (AI.why[k] || 0) + why[k];
    return dets;
  };

  /* render check identical to the review page's view: every outline must draw visibly */
  AI.renderCheck = d => { const xs = d.poly.map(p => lon2x(p[0], 17)), ys = d.poly.map(p => lat2y(p[1], 17)); const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2, ext = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)); const span = Math.min(3, Math.max(0.9, ext * 2.4)), sc = 300 / span;
    const c = new OffscreenCanvas(300, 300), g = c.getContext('2d'); g.beginPath(); xs.forEach((x, k) => { const px = (x - cx + span / 2) * sc, py = (ys[k] - cy + span / 2) * sc; k ? g.lineTo(px, py) : g.moveTo(px, py); }); g.closePath(); g.lineWidth = 3; g.strokeStyle = '#f00'; g.stroke();
    const im = g.getImageData(0, 0, 300, 300).data; let n = 0; for (let j = 3; j < im.length; j += 4) if (im[j]) n++; return n; };
  AI.download = (obj, name) => { const b = new Blob([typeof obj === 'string' ? obj : JSON.stringify(obj)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
})();
