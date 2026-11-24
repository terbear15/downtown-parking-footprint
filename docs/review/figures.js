/* Draws before/after outline figures from NAIP tiles (used to build docs/img/ figures). */
(function () {
  'use strict';
  const F = window.FIG = {};
  const lon2x = (lon, z) => (lon + 180) / 360 * 2 ** z;
  const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
  F.register = async () => {
    const q = { collections: ['naip'], 'filter-lang': 'cql2-json', filter: { op: '>=', args: [{ property: 'datetime' }, '2021-01-01T00:00:00Z'] }, sortby: [{ field: 'datetime', direction: 'desc' }] };
    const j = await fetch('https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(q) }).then(r => r.json());
    F.tpl = 'https://planetarycomputer.microsoft.com/api/data/v1/mosaic/' + j.searchid + '/tiles/WebMercatorQuad/{z}/{x}/{y}?collection=naip&assets=image&asset_bidx=image%7C1,2,3';
  };
  const cache = {};
  const img = (z, x, y) => cache[z + '/' + x + '/' + y] || (cache[z + '/' + x + '/' + y] = new Promise(res => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = F.tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y); }));
  /* draw aerial view around a set of polygons into ctx at (ox,oy,size) */
  F.panel = async (g, ox, oy, S, polys, styles, z) => {
    z = z || 18;
    const all = polys.flat(); const xs = all.map(p => lon2x(p[0], z)), ys = all.map(p => lat2y(p[1], z));
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 1.7 + 0.15, sc = S / span, x0 = cx - span / 2, y0 = cy - span / 2;
    g.save(); g.beginPath(); g.rect(ox, oy, S, S); g.clip(); g.fillStyle = '#1c1c1f'; g.fillRect(ox, oy, S, S);
    const jobs = []; for (let tx = Math.floor(x0); tx <= Math.floor(x0 + span); tx++) for (let ty = Math.floor(y0); ty <= Math.floor(y0 + span); ty++) jobs.push([tx, ty]);
    const ims = await Promise.all(jobs.map(([tx, ty]) => img(z, tx, ty)));
    jobs.forEach(([tx, ty], k) => { if (ims[k]) g.drawImage(ims[k], ox + (tx - x0) * sc, oy + (ty - y0) * sc, sc + 0.6, sc + 0.6); });
    polys.forEach((poly, k) => { const st = styles[k]; g.beginPath(); poly.forEach(([lo, la], i) => { const px = ox + (lon2x(lo, z) - x0) * sc, py = oy + (lat2y(la, z) - y0) * sc; i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.closePath();
      if (st.fill) { g.fillStyle = st.fill; g.fill(); } g.lineJoin = 'round'; g.setLineDash([]); g.strokeStyle = 'rgba(0,0,0,.75)'; g.lineWidth = st.w + 4; g.stroke(); g.setLineDash(st.dash || []); g.strokeStyle = st.color; g.lineWidth = st.w; g.stroke(); g.setLineDash([]); });
    g.restore();
  };
  F.png = (canvas, name) => new Promise(res => canvas.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); res(b.size); }, 'image/png'));
})();
