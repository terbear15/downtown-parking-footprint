/* Downtown Parking Footprint - map application.
   Data: docs/data/index.json and docs/data/cities/<id>.json, built by python/build_data.py. */
(function () {
  'use strict';
  var CONUS = [[-124.8, 24.4], [-66.9, 49.4]];
  var LIMIT = [[-145, 12], [-45, 58]];
  var SQFT_PER_ACRE = 43560, FIELD_ACRES = 1.322, M_PER_MI = 1609.344;
  var FLY_MS = 2000, PAGE = 10, SPEED = 19.25;
  var DEFAULTS = { size: 1.5, core: 0.5, transit: 0.25, density: 1.0, rail: false, on: { size: true, core: true, transit: true, density: true } };

  var S = { cities: [], byId: {}, data: {}, medianShare: 0, active: null, mode: 'footprint', mapReady: false,
    f: JSON.parse(JSON.stringify(DEFAULTS)), sort: 'score', page: 0, bin: null, rankBy: 'share', region: 'All', entered: false };
  var $ = function (id) { return document.getElementById(id); };
  var pbody = $('pbody'), panel = $('panel'), track = $('track'), letters = $('letters');
  var COPIES = 3, setWidth = 0;

  function fmt(n, d) { return Number(n).toLocaleString('en-US', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }); }
  function pct(x, d) { return fmt(x * 100, d === undefined ? 1 : d) + '%'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function narrow() { return window.innerWidth <= 760; }
  function landscape() { return window.innerHeight <= 520 && window.innerWidth > window.innerHeight; }
  function each(sel, fn, root) { Array.prototype.forEach.call((root || document).querySelectorAll(sel), fn); }
  var ICON = {
    prev: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>', next: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  // Count-up animation for changing numbers.
  function countUp(el, to, dec, suffix) {
    if (!el) { return; }
    var from = parseFloat(el.getAttribute('data-v') || '0'), t0 = performance.now(), dur = 700;
    el.setAttribute('data-v', to);
    el.textContent = fmt(from, dec) + (suffix || '');
    function stepf(t) {
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e, dec) + (suffix || '');
      if (k < 1) { requestAnimationFrame(stepf); }
    }
    requestAnimationFrame(stepf);
    setTimeout(function () { el.textContent = fmt(to, dec) + (suffix || ''); }, dur + 100);
  }

  function padFor(view) {
    if (narrow()) { return { top: 70, bottom: (view === 'city' ? Math.round(window.innerHeight * 0.46) : 150) + 20, left: 20, right: 20 }; }
    if (landscape()) { return { top: 60, bottom: 110, left: 330, right: 20 }; }
    // the side panel covers the left, so the map is shifted right
    return { top: 80, bottom: 190, left: 400, right: view === 'city' ? 70 : 24 };
  }

  /* ---------------- map ---------------- */
  var style = {
    version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#141416' } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#0c0c0e' } },
      { id: 'coast', type: 'line', source: 'omt', 'source-layer': 'water', maxzoom: 9, paint: { 'line-color': '#f5f5f7', 'line-opacity': 0.34, 'line-width': 0.6 } },
      { id: 'states', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': '#f5f5f7', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.08, 8, 0.14], 'line-width': 0.5 } },
      { id: 'country', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': '#f5f5f7', 'line-opacity': 0.42, 'line-width': 0.8 } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', minzoom: 11, paint: { 'fill-color': '#18191a' } },
      { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 13, paint: { 'fill-color': '#1d1d20', 'fill-outline-color': '#28282c' } },
      { id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'track', 'path']]],
        paint: { 'line-color': '#f5f5f7', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.06, 16, 0.26], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.3, 16, 1.3] } },
      { id: 'road-mid', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary']]],
        paint: { 'line-color': '#f5f5f7', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.09, 14, 0.44], 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.3, 16, 2] } },
      { id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
        paint: { 'line-color': '#f5f5f7', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.14, 12, 0.72], 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.3, 16, 3] } }
    ]
  };
  var map = new maplibregl.Map({ container: 'map', style: style, bounds: CONUS, fitBoundsOptions: { padding: padFor('overview') }, maxBounds: LIMIT,
    renderWorldCopies: false, attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.AttributionControl({ compact: true,
    customAttribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a> · LEHD LODES' }), 'bottom-right');

  function resize() { try { map.resize(); } catch (e) {} measure(); }
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { resize(); } });

  var tileErrors = 0;
  map.on('error', function (e) {
    if (e && e.sourceId === 'omt' && ++tileErrors === 3) { toast('Some base map tiles did not load. Parking data is unaffected.'); }
  });

  var EMPTY = { type: 'FeatureCollection', features: [] };
  var LOT_OP = ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 0.46];
  map.on('load', function () {
    ['cities', 'outline', 'lots', 'structures', 'core', 'heat', 'ai'].forEach(function (s) {
      var src = { type: 'geojson', data: EMPTY }; if (s === 'lots') { src.promoteId = 'id'; } map.addSource(s, src);
    });
    map.addLayer({ id: 'outline-fill', type: 'fill', source: 'outline', paint: { 'fill-color': '#f5f5f7', 'fill-opacity': 0.012 } });
    map.addLayer({ id: 'heat', type: 'heatmap', source: 'heat', maxzoom: 14,
      paint: { 'heatmap-weight': ['interpolate', ['linear'], ['get', 'acres'], 0, 0, 3, 1], 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 13, 1.4],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9, 6, 13, 26],
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(233,165,119,0)', 0.25, 'rgba(233,165,119,0.18)', 0.6, 'rgba(233,165,119,0.5)', 1, 'rgba(243,196,162,0.85)'],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 12, 1, 13.6, 0] } });
    map.addLayer({ id: 'structures', type: 'fill', source: 'structures', minzoom: 12, paint: { 'fill-color': '#f5f5f7', 'fill-opacity': 0.1, 'fill-outline-color': 'rgba(245,245,247,0.25)' } });
    map.addLayer({ id: 'ai-fill', type: 'fill', source: 'ai', minzoom: 12, paint: { 'fill-color': '#e9a577', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 0.22] } });
    map.addLayer({ id: 'ai-line', type: 'line', source: 'ai', minzoom: 12, paint: { 'line-color': '#f3c4a2', 'line-width': 1.4, 'line-dasharray': [2, 1.5], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 0.9] } });
    map.addLayer({ id: 'lots-fill', type: 'fill', source: 'lots', minzoom: 12, paint: { 'fill-color': '#e9a577', 'fill-opacity': LOT_OP, 'fill-opacity-transition': { duration: 350 } } });
    map.addLayer({ id: 'lots-line', type: 'line', source: 'lots', minzoom: 12, paint: { 'line-color': '#f3c4a2', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 0.6], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 17, 1.1] } });
    map.addLayer({ id: 'lots-glow', type: 'line', source: 'lots', paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-blur': 7, 'line-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 0.55, 0] } });
    map.addLayer({ id: 'lots-hi', type: 'line', source: 'lots', paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 1, ['boolean', ['feature-state', 'hover'], false], 0.6, 0] } });
    map.addLayer({ id: 'core', type: 'circle', source: 'core', paint: { 'circle-radius': 6, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#f5f5f7', 'circle-stroke-width': 1.5 } });
    map.addLayer({ id: 'city-halo', type: 'circle', source: 'cities', maxzoom: 10,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'share'], 0, 6, 0.18, 24], 'circle-color': '#e9a577', 'circle-blur': 0.45,
        'circle-opacity': ['case', ['get', 'dim'], 0.04, 0.2] } });
    map.addLayer({ id: 'city-dot', type: 'circle', source: 'cities', maxzoom: 10,
      paint: { 'circle-radius': 3.5, 'circle-color': '#e9a577', 'circle-stroke-color': '#f5f5f7', 'circle-stroke-width': 1, 'circle-opacity': ['case', ['get', 'dim'], 0.2, 1], 'circle-stroke-opacity': ['case', ['get', 'dim'], 0.2, 1] } });
    map.addLayer({ id: 'city-label', type: 'symbol', source: 'cities', maxzoom: 10, minzoom: 3.6,
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 10.5, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': 'rgba(245,245,247,0.7)', 'text-halo-color': '#141416', 'text-halo-width': 1.2, 'text-opacity': ['case', ['get', 'dim'], 0.15, 1] } });

    ['city-dot', 'city-halo'].forEach(function (id) {
      map.on('click', id, function (e) { selectCity(e.features[0].properties.id); });
      map.on('mousemove', id, function (e) { map.getCanvas().style.cursor = 'pointer'; var p = e.features[0].properties; tip(e.point, '<b>' + esc(p.name) + '</b> · ' + pct(p.share) + ' surface parking'); });
      map.on('mouseleave', id, function () { map.getCanvas().style.cursor = ''; tip(); });
    });
    map.on('click', 'lots-fill', function (e) { openLot(e.features[0].properties.id, e.lngLat); });
    var hovered = null;
    map.on('mousemove', 'lots-fill', function (e) {
      map.getCanvas().style.cursor = 'pointer';
      var f = e.features[0], d = S.data[S.active]; if (!d) { return; }
      var id = f.properties.id;
      if (hovered !== id) { if (hovered) { map.setFeatureState({ source: 'lots', id: hovered }, { hover: false }); } hovered = id; map.setFeatureState({ source: 'lots', id: hovered }, { hover: true }); }
      var l = d.lotById[id]; if (!l) { return; }
      tip(e.point, '<b>' + fmt(l.acres, 2) + ' acres</b> · ' + fmt(l.acres / FIELD_ACRES, 1) + ' football fields<br>Score ' + evalLot(l, d).score + ' of 4');
    });
    map.on('mouseleave', 'lots-fill', function () { map.getCanvas().style.cursor = ''; if (hovered) { map.setFeatureState({ source: 'lots', id: hovered }, { hover: false }); hovered = null; } tip(); });
    map.on('mousemove', 'core', function (e) { var d = S.data[S.active]; tip(e.point, '<b>Downtown core</b><br>' + (d && d.coreJobsPerAcre ? 'Densest jobs: about ' + fmt(d.coreJobsPerAcre) + ' jobs per acre' : 'Set at Grand Central (Manhattan special case)')); });
    map.on('mouseleave', 'core', function () { tip(); });
    map.on('mousemove', 'ai-fill', function (e) { var p = e.features[0].properties; tip(e.point, '<b>Found by the AI model</b><br>' + fmt(p.acres, 2) + ' acres · confirmed by a reviewer · not in OpenStreetMap'); });
    map.on('mouseleave', 'ai-fill', function () { tip(); });
    map.on('mousemove', 'structures', function (e) { var p = e.features[0].properties; tip(e.point, '<b>' + esc(p.name || 'Parking structure') + '</b><br>' + (p.kind === 'rooftop' ? 'Rooftop' : 'Multi-storey') + ' · not counted as surface'); });
    map.on('mouseleave', 'structures', function () { tip(); });

    S.mapReady = true;
    syncCities();
    if (S.active && S.data[S.active]) { drawCity(S.data[S.active], true); } else if (S.entered) { overviewCamera(0); }
  });

  /* ---------------- tooltip / toast ---------------- */
  var tipEl = $('tip');
  function tip(pt, html) {
    if (!pt) { tipEl.classList.remove('show'); return; }
    tipEl.innerHTML = html;
    var x = pt.x + 14, y = pt.y + 14, w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    if (x + w > window.innerWidth - 8) { x = pt.x - w - 14; } if (y + h > window.innerHeight - 8) { y = pt.y - h - 14; }
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px'; tipEl.classList.add('show');
  }
  document.addEventListener('mouseover', function (e) {
    var t = e.target.closest && e.target.closest('.term'); if (!t) { return; }
    var r = t.getBoundingClientRect(); tip({ x: r.left, y: r.bottom - 6 }, esc(t.getAttribute('data-tip')));
  });
  document.addEventListener('mouseout', function (e) { if (e.target.closest && e.target.closest('.term')) { tip(); } });
  var toastT = null;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 4200); }

  /* ---------------- data ---------------- */
  function decodeRing(s) {
    var v = s.split(' ').map(Number), x = v[0], y = v[1], ring = [[x / 1e5, y / 1e5]];
    for (var i = 2; i < v.length; i += 2) { x += v[i]; y += v[i + 1]; ring.push([x / 1e5, y / 1e5]); }
    ring.push(ring[0].slice()); return ring;
  }
  function polyOf(l) {
    var rings = l.outer.map(decodeRing), holes = (l.inner || []).map(decodeRing);
    return rings.length === 1 ? { type: 'Polygon', coordinates: [rings[0]].concat(holes) }
      : { type: 'MultiPolygon', coordinates: rings.map(function (r, i) { return i === 0 ? [r].concat(holes) : [r]; }) };
  }
  function setProgress(p) { var el = $('progress'); el.style.width = (p * 100) + '%'; if (p >= 1) { el.style.opacity = 0; } }

  function loadIndex() {
    setProgress(0.15);
    return fetch('data/index.json').then(function (r) { if (!r.ok) { throw new Error(r.status); } setProgress(0.6); return r.json(); }).then(function (j) {
      S.cities = j.cities; S.medianShare = j.medianShare;
      j.cities.forEach(function (c) { S.byId[c.id] = c; });
      setProgress(1);
      var top = j.cities.slice().sort(function (a, b) { return b.stats.share - a.stats.share; })[0];
      $('finding-t').innerHTML = 'of downtown <b style="color:var(--ink)">' + esc(top.name) + '</b> is surface parking, the highest share we measured. The typical downtown is ' + pct(j.medianShare) + '.';
      $('finding').hidden = false; countUp($('finding-n'), top.stats.share * 100, 1, '%');
      renderRail(); renderOverview(); syncCities(); renderCoverage();
      applyHash();
    }).catch(function () {
      setProgress(1);
      pbody.innerHTML = '<p class="caption">The city list could not be loaded.</p><button class="btn" onclick="location.reload()">Reload</button>';
    });
  }

  function loadCity(id) {
    if (S.data[id]) { return Promise.resolve(S.data[id]); }
    return fetch('data/cities/' + id + '.json').then(function (r) { if (!r.ok) { throw new Error(r.status); } return r.json(); }).then(function (d) {
      d.lotById = {};
      d.lots.forEach(function (l) { if (l.acresInside == null) { l.acresInside = l.acres; } d.lotById[l.id] = l; });
      d.geo = { type: 'FeatureCollection', features: d.lots.map(function (l) { return { type: 'Feature', geometry: polyOf(l), properties: { id: l.id, acres: l.acres } }; }) };
      d.heat = { type: 'FeatureCollection', features: d.lots.map(function (l) { return { type: 'Feature', geometry: { type: 'Point', coordinates: l.center }, properties: { acres: l.acres } }; }) };
      d.aiGeo = { type: 'FeatureCollection', features: (d.aiLots || []).map(function (l) { return { type: 'Feature', geometry: polyOf(l), properties: { acres: l.acres } }; }) };
      d.structGeo = { type: 'FeatureCollection', features: (d.structures || []).map(function (l) { return { type: 'Feature', geometry: polyOf(l), properties: { name: l.name || '', kind: l.kind } }; }) };
      d.outlineGeo = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: d.outline.map(decodeRing) } };
      S.data[id] = d; return d;
    });
  }

  function regionOk(c) { return S.region === 'All' || c.region === S.region; }
  function syncCities() {
    if (!S.mapReady || !S.cities.length) { return; }
    map.getSource('cities').setData({ type: 'FeatureCollection', features: S.cities.map(function (c) {
      return { type: 'Feature', geometry: { type: 'Point', coordinates: c.core }, properties: { id: c.id, name: c.name, share: c.stats.share, dim: !regionOk(c) } };
    }) });
  }

  /* ---------------- URL state: #/<city>/<mode>?thresholds ---------------- */
  function writeHash() {
    var h = '';
    if (S.active) {
      h = '#/' + S.active + '/' + S.mode;
      if (S.mode === 'candidates') {
        var f = S.f, q = [];
        ['size', 'core', 'transit', 'density'].forEach(function (k) { if (f[k] !== DEFAULTS[k]) { q.push(k + '=' + f[k]); } });
        if (f.rail) { q.push('rail=1'); }
        var off = Object.keys(f.on).filter(function (k) { return !f.on[k]; }); if (off.length) { q.push('off=' + off.join(',')); }
        if (q.length) { h += '?' + q.join('&'); }
      }
    }
    if (location.hash !== h) { history.replaceState(null, '', h || (location.pathname + location.search)); }
  }
  function applyHash() {
    var m = location.hash.match(/^#\/([a-z]+)(?:\/(footprint|candidates))?(?:\?(.*))?$/);
    if (!m || !S.byId[m[1]]) { return; }
    S.mode = m[2] || 'footprint';
    if (m[3]) {
      m[3].split('&').forEach(function (kv) {
        var p = kv.split('='), k = p[0], v = p[1] || '';
        if (k === 'rail') { S.f.rail = v === '1'; }
        else if (k === 'off') { v.split(',').forEach(function (x) { if (x in S.f.on) { S.f.on[x] = false; } }); }
        else if (k in DEFAULTS && !isNaN(parseFloat(v))) { S.f[k] = parseFloat(v); }
      });
    }
    enter(true);
    selectCity(m[1]);
  }

  /* ---------------- landing ---------------- */
  var hero = $('hero');
  requestAnimationFrame(function () { setTimeout(function () { hero.classList.add('in'); }, 60); });
  setTimeout(function () { hero.classList.add('in'); }, 400);
  function enter(instant) {
    if (S.entered) { return; }
    S.entered = true;
    if (instant) { hero.style.transition = 'none'; }
    hero.classList.add('out'); document.body.classList.add('entered');
    resize();
    if (!S.active && S.mapReady) { overviewCamera(instant ? 0 : 1600); }
  }
  function showIntro() {
    S.entered = false; hero.style.transition = ''; hero.classList.remove('out'); hero.classList.add('in'); document.body.classList.remove('entered'); closeLot();
  }
  $('enter').addEventListener('click', function () { enter(); });
  $('intro').addEventListener('click', showIntro);
  hero.addEventListener('wheel', function (e) { if (e.deltaY > 12) { enter(); } }, { passive: true });
  var ty = null;
  hero.addEventListener('touchstart', function (e) { ty = e.touches[0].clientY; }, { passive: true });
  hero.addEventListener('touchmove', function (e) { if (ty !== null && ty - e.touches[0].clientY > 40) { ty = null; enter(); } }, { passive: true });

  /* ---------------- city rail (endless) ---------------- */
  function renderRail() {
    var maxShare = Math.max.apply(null, S.cities.map(function (c) { return c.stats.share; }));
    var one = S.cities.map(function (c) {
      return '<button class="card" role="listitem" data-id="' + c.id + '"><div class="nm">' + esc(c.name) + '</div><div class="st">' + c.state + ' · ' + fmt(c.stats.downtownSqMi, 1) + ' sq mi</div>' +
        '<div class="sh"><span class="trk"><span class="fil" style="width:' + (c.stats.share / maxShare * 100) + '%"></span></span>' + pct(c.stats.share) + '</div></button>';
    }).join('');
    var html = ''; for (var k = 0; k < COPIES; k++) { html += one; }
    track.innerHTML = html;
    each('.card', function (b) { b.addEventListener('click', function () { selectCity(b.getAttribute('data-id')); }); }, track);
    var seen = {};
    letters.innerHTML = S.cities.map(function (c) {
      var L = c.name.charAt(0).toUpperCase(); if (seen[L]) { return ''; } seen[L] = 1;
      return '<button data-id="' + c.id + '" title="Cities starting with ' + L + '">' + L + '</button>';
    }).join('');
    each('button', function (b) {
      b.addEventListener('click', function () {
        each('button', function (x) { x.classList.toggle('on', x === b); }, letters);
        centerCard(b.getAttribute('data-id'));
      });
    }, letters);
    requestAnimationFrame(measure); setTimeout(measure, 300);
    dimRail();
  }
  function dimRail() { each('.card', function (b) { var c = S.byId[b.getAttribute('data-id')]; b.classList.toggle('dim', !!c && !regionOk(c)); }, track); }
  function measure() {
    var n = S.cities.length; if (!n || track.children.length < 2 * n) { return; }
    setWidth = track.children[n].offsetLeft - track.children[0].offsetLeft;
    if (setWidth > 0 && (track.scrollLeft < setWidth * 0.5 || track.scrollLeft > setWidth * 1.5)) { track.scrollLeft = setWidth + (track.scrollLeft % setWidth); }
  }
  var animating = false;
  track.addEventListener('scroll', function () {
    if (!setWidth || animating) { return; }
    if (track.scrollLeft < setWidth * 0.5) { track.scrollLeft += setWidth; } else if (track.scrollLeft > setWidth * 1.5) { track.scrollLeft -= setWidth; }
  }, { passive: true });
  // Bring a card to the centre of the rail, using whichever copy is nearest.
  function centerCard(id) {
    if (!setWidth) { measure(); } if (!setWidth) { return; }
    var n = S.cities.length, idx = -1;
    for (var i = 0; i < n; i++) { if (S.cities[i].id === id) { idx = i; break; } }
    if (idx < 0) { return; }
    var card = track.children[idx];
    var base = card.offsetLeft - track.children[0].offsetLeft + parseFloat(getComputedStyle(track).paddingLeft) + card.offsetWidth / 2 - track.clientWidth / 2;
    var cur = track.scrollLeft, best = base + setWidth;
    [base, base + setWidth, base + 2 * setWidth].forEach(function (t) { if (Math.abs(t - cur) < Math.abs(best - cur)) { best = t; } });
    var from = cur, to = best, t0 = performance.now(), dur = 520; animating = true;
    function stepf(t) {
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      track.scrollLeft = from + (to - from) * e;
      if (k < 1) { requestAnimationFrame(stepf); } else { animating = false; track.dispatchEvent(new Event('scroll')); }
    }
    requestAnimationFrame(stepf);
    setTimeout(function () { if (animating) { track.scrollLeft = to; animating = false; } }, dur + 200);
  }
  (function () {
    var vx = 0, raf = null, hovering = false;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) { return; }
    function stepf() { if (!hovering || Math.abs(vx) < 0.05 || animating) { raf = null; return; } track.scrollLeft += vx; raf = requestAnimationFrame(stepf); }
    track.addEventListener('mousemove', function (e) {
      var r = track.getBoundingClientRect(), t = ((e.clientX - r.left) / r.width) * 2 - 1, dead = 0.18;
      var m = Math.abs(t) < dead ? 0 : (Math.abs(t) - dead) / (1 - dead);
      vx = Math.sign(t) * Math.pow(m, 1.6) * SPEED; hovering = true;
      if (!raf) { raf = requestAnimationFrame(stepf); }
    });
    track.addEventListener('mouseleave', function () { hovering = false; vx = 0; });
  })();
  function markCard(id) {
    var visible = false, r = track.getBoundingClientRect();
    each('.card', function (b) {
      var on = b.getAttribute('data-id') === id; b.classList.toggle('on', on);
      if (on) { var br = b.getBoundingClientRect(); if (br.left >= r.left + 40 && br.right <= r.right - 40) { visible = true; } }
    }, track);
    if (id && !visible) { centerCard(id); }
  }

  /* search */
  var sIn = $('search'), sugg = $('sugg'), hi = 0, hits = [];
  function renderSugg() {
    var q = sIn.value.trim().toLowerCase();
    hits = q ? S.cities.filter(function (c) { return c.name.toLowerCase().indexOf(q) >= 0 || c.state.toLowerCase() === q; }).slice(0, 8) : [];
    hi = 0;
    sugg.innerHTML = hits.map(function (c, i) { return '<button data-id="' + c.id + '" class="' + (i === 0 ? 'hi' : '') + '">' + esc(c.name) + '<span>' + c.state + '</span></button>'; }).join('') || (q ? '<button disabled>No match</button>' : '');
    sugg.classList.toggle('show', !!q);
    each('button[data-id]', function (b) { b.addEventListener('mousedown', function (e) { e.preventDefault(); pick(b.getAttribute('data-id')); }); }, sugg);
  }
  function pick(id) { sIn.value = ''; sugg.classList.remove('show'); sIn.blur(); selectCity(id); }
  sIn.addEventListener('input', renderSugg);
  sIn.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!hits.length) { return; } hi = (hi + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length; each('button', function (b, i) { b.classList.toggle('hi', i === hi); }, sugg); }
    else if (e.key === 'Enter' && hits[hi]) { pick(hits[hi].id); }
    else if (e.key === 'Escape') { sIn.value = ''; sugg.classList.remove('show'); sIn.blur(); }
    e.stopPropagation();
  });
  sIn.addEventListener('blur', function () { setTimeout(function () { sugg.classList.remove('show'); }, 150); });

  /* keyboard */
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') { return; }
    var open = document.querySelector('.sheet.show');
    if (e.key === 'Escape') { if (open) { open.classList.remove('show'); } else if (popupOpen()) { closeLot(); } else if (S.active) { overview(); } return; }
    if (open) { return; }
    if (!S.entered) { if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); enter(); } return; }
    if (e.key === 'ArrowRight') { step(1); } else if (e.key === 'ArrowLeft') { step(-1); }
    else if (e.key === '/') { e.preventDefault(); sIn.focus(); }
  });
  function step(dir) {
    var n = S.cities.length; if (!n) { return; }
    var i = -1; for (var k = 0; k < n; k++) { if (S.cities[k].id === S.active) { i = k; } }
    if (i < 0) { i = dir > 0 ? -1 : 0; }
    selectCity(S.cities[(i + dir + n) % n].id);
  }

  /* ---------------- overview ---------------- */
  function overviewCamera(dur) {
    var cam = map.cameraForBounds(CONUS, { padding: padFor('overview') });
    if (cam) { map.flyTo({ center: cam.center, zoom: cam.zoom, duration: dur, curve: 1.4, essential: true }); }
  }
  var RANK = {
    share: ['Share of downtown', function (c) { return c.stats.share; }, function (v) { return pct(v); }],
    acres: ['Parking acres', function (c) { return c.stats.parkingAcres; }, function (v) { return fmt(v); }],
    lots: ['Mapped lots', function (c) { return c.stats.lots; }, function (v) { return fmt(v); }],
    cand: ['Lots passing all checks', function (c) { return c.stats.candidates['4']; }, function (v) { return fmt(v); }]
  };
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function renderOverview() {
    var R = RANK[S.rankBy], get = R[1];
    var cs = S.cities.filter(regionOk).sort(function (a, b) { return get(b) - get(a); });
    var all = S.cities.map(get), max = Math.max.apply(null, all.concat([1e-9])), med = median(all);
    var totLots = 0, totAcres = 0; cs.forEach(function (c) { totLots += c.stats.lots; totAcres += c.stats.parkingAcres; });
    pbody.innerHTML = '<div class="fadein"><p class="eyebrow">' + (S.region === 'All' ? 'All downtowns' : S.region) + '</p><h2>' + cs.length + ' cities</h2><p class="sub">Measurement · OSM-mapped surface lots</p>' +
      '<div class="group"><div class="grid2"><div class="cellk"><div class="k">Mapped lots</div><div class="v" id="ov-l">0</div></div>' +
      '<div class="cellk"><div class="k">Parking area</div><div class="v"><span id="ov-a">0</span><small>acres</small></div></div></div></div>' +
      '<div class="seg sm" id="region" style="margin-bottom:12px">' + ['All', 'Northeast', 'Midwest', 'South', 'West'].map(function (r) {
        return '<button data-r="' + r + '" class="' + (S.region === r ? 'on' : '') + '" title="' + r + '">' + (r === 'Northeast' ? 'NE' : r === 'Midwest' ? 'Midwest' : r) + '</button>'; }).join('') + '</div>' +
      '<div class="ctlrow"><span class="h3" style="margin:0;flex:1">Ranked by</span><select id="rankby" aria-label="Rank cities by">' + Object.keys(RANK).map(function (k) { return '<option value="' + k + '"' + (k === S.rankBy ? ' selected' : '') + '>' + RANK[k][0] + '</option>'; }).join('') + '</select></div>' +
      '<ul class="ranks">' + cs.map(function (c, i) {
        return '<li data-id="' + c.id + '"><span class="i">' + (i + 1) + '</span><span>' + esc(c.name) + '</span><span class="trk"><span class="fil" data-w="' + (get(c) / max * 100) + '"></span><span class="med" style="left:' + (med / max * 100) + '%"></span></span><span class="num">' + R[2](get(c)) + '</span></li>';
      }).join('') + '</ul>' +
      '<p class="note">White tick: median of all cities (' + R[2](med) + '). Lower bound: only lots mapped in OpenStreetMap are counted. Manhattan uses the whole borough.</p>' +
      '<a class="btn full" href="data/summary.csv" download style="display:block;text-align:center;text-decoration:none;margin-top:12px">Download all cities (CSV)</a></div>';
    countUp($('ov-l'), totLots, 0); countUp($('ov-a'), totAcres, 0);
    requestAnimationFrame(function () { requestAnimationFrame(function () { each('.ranks .fil', function (f) { f.style.width = f.getAttribute('data-w') + '%'; }, pbody); }); });
    each('.ranks li', function (li) { li.addEventListener('click', function () { selectCity(li.getAttribute('data-id')); }); }, pbody);
    $('rankby').addEventListener('change', function (e) { S.rankBy = e.target.value; renderOverview(); });
    each('#region button', function (b) { b.addEventListener('click', function () { S.region = b.getAttribute('data-r'); renderOverview(); syncCities(); dimRail(); }); }, pbody);
  }
  function overview() {
    S.active = null; markCard(null); closeLot(); writeHash();
    if (S.mapReady) { ['outline', 'lots', 'core', 'heat', 'structures', 'ai'].forEach(function (s) { map.getSource(s).setData(EMPTY); }); overviewCamera(FLY_MS); }
    if (S.cities.length) { renderOverview(); }
    setDrawer('half');
  }
  $('home').addEventListener('click', function () { enter(); overview(); });

  /* ---------------- city view ---------------- */
  function selectCity(id) {
    if (!S.byId[id]) { return; }
    enter();
    var first = S.active !== id;
    S.active = id; S.page = 0; S.bin = null;
    markCard(id); closeLot();
    var c = S.byId[id];
    if (first) {
      pbody.innerHTML = '<div class="fadein"><p class="eyebrow">' + c.state + '</p><h2>' + esc(c.name) + '</h2><p class="caption">Loading lots…</p></div>';
      if (S.mapReady) {
        map.setPaintProperty('lots-fill', 'fill-opacity', 0);     // fade the old city out before flying
        var cam = map.cameraForBounds(c.bounds, { padding: padFor('city') });
        setTimeout(function () { if (cam && S.active === id) { map.flyTo({ center: cam.center, zoom: Math.min(cam.zoom, 15.5), duration: FLY_MS, curve: 1.8, essential: true }); } }, 180);
      }
    }
    writeHash();
    loadCity(id).then(function (d) {
      if (S.active !== id) { return; }
      renderCity(d);
      if (S.mapReady) { setTimeout(function () { if (S.active === id) { drawCity(d); } }, first ? 220 : 0); }
    }).catch(function () {
      pbody.innerHTML = '<p class="eyebrow">' + c.state + '</p><h2>' + esc(c.name) + '</h2><p class="caption">This city\'s data could not be loaded.</p><button class="btn" id="retry">Try again</button>';
      $('retry').onclick = function () { delete S.data[id]; S.active = null; selectCity(id); };
    });
  }
  function drawCity(d, jump) {
    map.getSource('outline').setData(d.outlineGeo);
    map.getSource('lots').setData(d.geo);
    map.getSource('heat').setData(d.heat);
    map.getSource('structures').setData(d.structGeo);
    map.getSource('ai').setData(d.aiGeo);
    map.getSource('core').setData({ type: 'Feature', geometry: { type: 'Point', coordinates: d.core }, properties: {} });
    if (jump) { var cam = map.cameraForBounds(d.bounds, { padding: padFor('city') }); if (cam) { map.jumpTo({ center: cam.center, zoom: Math.min(cam.zoom, 15.5) }); } }
    applyMode();
  }

  /* screening is recomputed in the browser so thresholds can change */
  function evalLot(l, d) {
    var f = S.f, dist = f.rail ? l.railMi : l.transitMi;
    var k = { size: l.acres >= f.size, core: l.coreMi <= f.core, transit: dist != null && dist <= f.transit, density: l.bldgCoverage > d.stats.medianBldgCoverage * f.density };
    var pass = true, anyOn = false;
    Object.keys(k).forEach(function (n) { if (f.on[n]) { anyOn = true; if (!k[n]) { pass = false; } } });
    return { checks: k, score: (k.size ? 1 : 0) + (k.core ? 1 : 0) + (k.transit ? 1 : 0) + (k.density ? 1 : 0), pass: anyOn && pass };
  }
  function applyMode() {
    if (!S.mapReady || !S.active) { return; }
    var d = S.data[S.active]; if (!d) { return; }
    if (S.mode === 'footprint') {
      var b = S.bin, f = null;
      if (b === 'lt0_5') { f = ['<', ['get', 'acres'], 0.5]; } else if (b === '0_5to2') { f = ['all', ['>=', ['get', 'acres'], 0.5], ['<=', ['get', 'acres'], 2]]; } else if (b === 'gt2') { f = ['>', ['get', 'acres'], 2]; }
      map.setPaintProperty('lots-fill', 'fill-color', f ? ['case', f, '#e9a577', '#3a3a3f'] : '#e9a577');
      map.setPaintProperty('lots-fill', 'fill-opacity', f ? ['case', f, 0.62, 0.25] : LOT_OP);
      map.setPaintProperty('lots-line', 'line-color', f ? ['case', f, '#f3c4a2', '#4a4a4f'] : '#f3c4a2');
      map.setLayoutProperty('heat', 'visibility', 'visible');
      map.setLayoutProperty('structures', 'visibility', 'visible');
      map.setLayoutProperty('ai-fill', 'visibility', 'visible'); map.setLayoutProperty('ai-line', 'visibility', 'visible');
    } else {
      map.setLayoutProperty('ai-fill', 'visibility', 'none'); map.setLayoutProperty('ai-line', 'visibility', 'none');
      var ids = d.lots.filter(function (l) { return evalLot(l, d).pass; }).map(function (l) { return l.id; });
      var on = ['in', ['get', 'id'], ['literal', ids]];
      map.setPaintProperty('lots-fill', 'fill-color', ['case', on, '#a9d4e6', '#3a3a3f']);
      map.setPaintProperty('lots-fill', 'fill-opacity', ['case', on, 0.78, 0.3]);
      map.setPaintProperty('lots-line', 'line-color', ['case', on, '#d6eef7', '#4a4a4f']);
      map.setLayoutProperty('heat', 'visibility', 'none');
      map.setLayoutProperty('structures', 'visibility', 'none');
    }
  }

  function headHtml(d) {
    var c = S.byId[d.id];
    return '<div class="phead"><div style="min-width:0"><p class="eyebrow">' + d.state + ' · ' + c.region + '</p><h2>' + esc(d.name) + '</h2></div>' +
      '<div class="navbtns"><button class="icon-btn" id="prev" title="Previous city (Left arrow)" aria-label="Previous city">' + ICON.prev + '</button><button class="icon-btn" id="next" title="Next city (Right arrow)" aria-label="Next city">' + ICON.next + '</button></div></div>' +
      '<p class="sub">' + (d.id === 'newyork' ? 'Special case: all of Manhattan' : 'Downtown ' + fmt(d.stats.downtownSqMi, 2) + ' sq mi · <span class="term" data-tip="Downtown = connected area with at least 25 jobs per acre (LEHD LODES).">LODES ' + d.stats.lodesYear + ' job density</span>') + '</p>' +
      (c.lowCoverage ? '<div class="tags"><span class="tag warn term" data-tip="Fewer lots are mapped in OpenStreetMap here than in most cities, so the true parking area is likely higher. A priority city for the aerial-imagery model.">Possible OSM under-mapping</span></div>' : '') +
      '<div class="seg" id="mode" style="margin-bottom:18px"><button data-mode="footprint" class="' + (S.mode === 'footprint' ? 'on' : '') + '">Footprint</button><button data-mode="candidates" class="' + (S.mode === 'candidates' ? 'on' : '') + '">Candidates</button></div>';
  }
  function renderCity(d) {
    pbody.innerHTML = '<div class="fadein">' + headHtml(d) + '<div id="mb"></div></div>';
    $('prev').onclick = function () { step(-1); }; $('next').onclick = function () { step(1); };
    each('#mode button', function (b) {
      b.addEventListener('click', function () {
        S.mode = b.getAttribute('data-mode'); S.page = 0; closeLot();
        each('#mode button', function (x) { x.classList.toggle('on', x === b); });
        renderMode(d); applyMode(); writeHash();
      });
    });
    renderMode(d);
  }
  function renderMode(d) { if (S.mode === 'footprint') { footprint(d); } else { candidates(d); } }

  function footprint(d) {
    var s = d.stats, b = s.bins, c = S.byId[d.id];
    var maxA = Math.max(b.lt0_5.acres, b['0_5to2'].acres, b.gt2.acres, 0.01);
    var diff = (s.share - S.medianShare) * 100;
    function bin(key, label) { var x = b[key]; return '<button class="bin' + (S.bin === key ? ' on' : '') + '" data-b="' + key + '"><span>' + label + '</span><span class="trk"><span class="fil" data-w="' + (x.acres / maxA * 100) + '"></span></span><span class="num">' + fmt(x.lots) + ' · ' + fmt(x.acres, 0) + ' ac</span></button>'; }
    $('mb').innerHTML = '<div class="big"><span id="bn">0</span><small>%</small></div>' +
      '<p class="caption">of downtown land is mapped surface parking <span class="tag">Measurement</span></p>' +
      '<div class="compare"><span>Rank <b>' + c.rank + '</b> of ' + S.cities.length + '</span><span><b>' + (diff >= 0 ? '+' : '−') + fmt(Math.abs(diff), 1) + '</b> pts vs median</span></div>' +
      '<div class="group"><div class="grid2">' +
      '<div class="cellk"><div class="k">Parking area</div><div class="v"><span id="ba">0</span><small>acres</small></div></div>' +
      '<div class="cellk"><div class="k">Football fields</div><div class="v"><span id="bf">0</span><small>fields</small></div></div>' +
      '<div class="cellk"><div class="k">Surface lots</div><div class="v"><span id="bl">0</span></div></div>' +
      '<div class="cellk"><div class="k">Area in sq ft</div><div class="v">' + fmt(s.parkingSqFt / 1e6, 2) + '<small>million</small></div></div></div></div>' +
      '<p class="h3">Lots by size <span class="r">tap to show on the map</span></p><div class="bins">' + bin('lt0_5', '&lt; 0.5 acre') + bin('0_5to2', '0.5–2 acres') + bin('gt2', '&gt; 2 acres') + '</div>' +
      (s.aiLots ? '<div class="group" style="padding:12px 14px"><div class="h3" style="margin:0 0 4px">Found by the AI model <span class="tag term" data-tip="A U-Net trained on NAIP aerial imagery proposed these lots; a person confirmed each one. They are not in OpenStreetMap and are not included in the main figure.">AI + human review</span></div>' +
        '<div style="font-size:13px;color:var(--ink-2);line-height:1.5">' + fmt(s.aiLots) + ' more lots, <b style="color:var(--ink)">' + fmt(s.aiAcres, 1) + ' acres</b>. Including them, surface parking covers <b style="color:var(--ink)">' + pct(s.shareWithAi) + '</b> of downtown. Dashed outlines on the map.</div></div>' : '') +
      (s.structures ? '<p class="note" style="margin:-6px 0 12px">' + fmt(s.structures) + ' parking structures (' + fmt(s.structuredAcres, 1) + ' acres of footprint) are shown in grey and not counted.</p>' : '') +
      '<p class="note">Lower bound: OSM-mapped lots only. Zoomed out, the glow shows where parking concentrates. The faintly lighter area is downtown; the ring marks the downtown core. Data fetched ' + d.osmFetched + '.</p>';
    countUp($('bn'), s.share * 100, 1); countUp($('ba'), s.parkingAcres, 1); countUp($('bf'), s.parkingAcres / FIELD_ACRES, 0); countUp($('bl'), s.lots, 0);
    requestAnimationFrame(function () { requestAnimationFrame(function () { each('.bin .fil', function (f) { f.style.width = f.getAttribute('data-w') + '%'; }, pbody); }); });
    each('.bin', function (el) {
      el.addEventListener('click', function () {
        var k = el.getAttribute('data-b'); S.bin = S.bin === k ? null : k;
        each('.bin', function (x) { x.classList.toggle('on', x.getAttribute('data-b') === S.bin); }, pbody); applyMode();
      });
    }, pbody);
  }

  var CRIT = [
    { k: 'size', label: 'Size', fmt: function (v) { return 'At least ' + fmt(v, 2) + ' acres'; }, min: 0.25, max: 5, step: 0.25 },
    { k: 'core', label: 'Near the downtown core', fmt: function (v) { return 'Within ' + fmt(v, 2) + ' mile'; }, min: 0.1, max: 1.5, step: 0.05 },
    { k: 'transit', label: 'Transit access', fmt: function (v) { return 'Within ' + fmt(v, 2) + ' mile of a ' + (S.f.rail ? 'rail station' : 'stop'); }, min: 0.05, max: 1, step: 0.05 },
    { k: 'density', label: 'Dense surroundings', fmt: function (v) { return 'Building coverage above ' + fmt(v * 100) + '% of the median'; }, min: 0.5, max: 1.5, step: 0.05 }
  ];
  function candidates(d) {
    var f = S.f;
    $('mb').innerHTML = '<p class="h3">Screening checks <span class="tag">Screening result</span></p>' +
      '<div class="group" id="crits">' + CRIT.map(function (c) {
        return '<div class="crit' + (f.on[c.k] ? '' : ' off') + '" data-k="' + c.k + '"><div class="top"><div><div class="lab">' + c.label + '</div><div class="val" id="v-' + c.k + '">' + c.fmt(f[c.k]) + '</div></div>' +
          '<button class="switch' + (f.on[c.k] ? ' on' : '') + '" role="switch" aria-checked="' + f.on[c.k] + '" aria-label="Require ' + c.label + '"></button></div>' +
          '<input type="range" min="' + c.min + '" max="' + c.max + '" step="' + c.step + '" value="' + f[c.k] + '"' + (f.on[c.k] ? '' : ' disabled') + ' aria-label="' + c.label + ' threshold">' +
          (c.k === 'transit' ? '<div class="seg sm" id="railseg"><button data-rail="0" class="' + (f.rail ? '' : 'on') + '">Any stop</button><button data-rail="1" class="' + (f.rail ? 'on' : '') + '">Rail only</button></div>' : '') + '</div>';
      }).join('') + '</div>' +
      '<div class="count"><span class="big" id="cn">0</span><span class="caption" style="margin:0">lots pass every check that is on</span></div>' +
      '<div class="legend"><span><i style="background:#a9d4e6"></i>Passes</span><span><i style="background:#3a3a3f"></i>Does not pass</span><span style="flex:1"></span><button class="btn" id="reset" style="padding:5px 10px;font-size:12px">Reset</button></div>' +
      '<div class="ctlrow"><span class="h3" style="margin:0;flex:1">Matching lots</span><select id="sort" aria-label="Sort lots"><option value="score">Highest score</option><option value="size">Largest</option><option value="core">Closest to core</option><option value="near">Most parking nearby</option></select></div>' +
      '<ul class="list" id="clist"></ul><div class="pager" id="pager"></div>' +
      '<button class="btn full" id="csv">Download matching lots (CSV)</button>' +
      '<p class="note">Zoning is not verified. A lot that passes is a screening result, not a recommendation.</p>';
    $('sort').value = S.sort;
    each('.crit', function (row) {
      var k = row.getAttribute('data-k'), c = CRIT.filter(function (x) { return x.k === k; })[0], range = row.querySelector('input'), sw = row.querySelector('.switch');
      range.addEventListener('input', function () { f[k] = parseFloat(range.value); $('v-' + k).textContent = c.fmt(f[k]); S.page = 0; refresh(d); });
      sw.addEventListener('click', function () { f.on[k] = !f.on[k]; sw.classList.toggle('on', f.on[k]); sw.setAttribute('aria-checked', f.on[k]); row.classList.toggle('off', !f.on[k]); range.disabled = !f.on[k]; S.page = 0; refresh(d); });
    }, pbody);
    each('#railseg button', function (b) {
      b.addEventListener('click', function () { f.rail = b.getAttribute('data-rail') === '1'; each('#railseg button', function (x) { x.classList.toggle('on', x === b); }, pbody); $('v-transit').textContent = CRIT[2].fmt(f.transit); S.page = 0; refresh(d); });
    }, pbody);
    $('reset').onclick = function () { S.f = JSON.parse(JSON.stringify(DEFAULTS)); S.page = 0; candidates(d); };
    $('sort').onchange = function (e) { S.sort = e.target.value; S.page = 0; refresh(d); };
    $('csv').onclick = function () { downloadCsv(d); };
    refresh(d);
  }
  function nearby(l, d) {
    if (l._near) { return l._near; }
    var lat = l.center[1] * Math.PI / 180, sum = 0, n = 0, r2 = Math.pow(0.25 * M_PER_MI, 2);
    d.lots.forEach(function (o) {
      if (o === l) { return; }
      var dx = (o.center[0] - l.center[0]) * 111320 * Math.cos(lat), dy = (o.center[1] - l.center[1]) * 111320;
      if (dx * dx + dy * dy <= r2) { sum += o.acres; n++; }
    });
    l._near = { acres: sum, lots: n }; return l._near;
  }
  function matching(d) {
    var list = d.lots.map(function (l) { return { l: l, e: evalLot(l, d) }; }).filter(function (x) { return x.e.pass; });
    if (S.sort === 'near') { list.forEach(function (x) { x.n = nearby(x.l, d); }); }
    list.sort(function (a, b) {
      if (S.sort === 'size') { return b.l.acres - a.l.acres; }
      if (S.sort === 'core') { return a.l.coreMi - b.l.coreMi; }
      if (S.sort === 'near') { return b.n.acres - a.n.acres; }
      return (b.e.score - a.e.score) || (b.l.acres - a.l.acres);
    });
    return list;
  }
  function refresh(d) {
    var list = matching(d), pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (S.page >= pages) { S.page = pages - 1; }
    countUp($('cn'), list.length, 0);
    var slice = list.slice(S.page * PAGE, S.page * PAGE + PAGE);
    $('clist').innerHTML = slice.map(function (x) {
      var l = x.l, extra = S.sort === 'near' ? fmt(x.n.acres, 1) + ' ac nearby' : fmt(l.coreMi, 2) + ' mi to core';
      return '<li data-id="' + l.id + '"><div style="min-width:0"><div class="n">' + esc(l.name || 'Unnamed lot') + '</div><div class="d">' + fmt(l.acres, 2) + ' acres · ' + extra + '</div></div><span class="s">' + x.e.score + '/4</span></li>';
    }).join('') || '<li style="cursor:default"><div class="d">No lots pass these checks. Loosen a threshold or switch a check off.</div><span></span></li>';
    $('pager').innerHTML = list.length > PAGE ? '<button class="icon-btn" id="pp" aria-label="Previous page"' + (S.page === 0 ? ' disabled' : '') + '>' + ICON.prev + '</button><span>Page ' + (S.page + 1) + ' of ' + pages + ' · ' + fmt(list.length) + ' lots</span><button class="icon-btn" id="pn" aria-label="Next page"' + (S.page >= pages - 1 ? ' disabled' : '') + '>' + ICON.next + '</button>' : '';
    if ($('pp')) { $('pp').onclick = function () { S.page--; refresh(d); }; $('pn').onclick = function () { S.page++; refresh(d); }; }
    each('li[data-id]', function (li) {
      li.addEventListener('click', function () {
        var l = d.lotById[li.getAttribute('data-id')];
        map.flyTo({ center: l.center, zoom: Math.max(map.getZoom(), 16), duration: 1100, essential: true });
        setTimeout(function () { openLot(l.id, { lng: l.center[0], lat: l.center[1] }); }, narrow() ? 0 : 1150);
      });
    }, $('clist'));
    applyMode(); writeHash();
  }
  function downloadCsv(d) {
    var cols = ['city', 'osm_id', 'name', 'lon', 'lat', 'acres', 'sq_ft', 'acres_inside_downtown', 'score_of_4', 'size_check', 'core_check', 'transit_check', 'density_check', 'zoning',
      'miles_to_core', 'miles_to_any_stop', 'miles_to_rail', 'building_coverage', 'nearby_parking_acres_0_25mi', 'parking_tag', 'fee', 'access'];
    function q(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var f = S.f, rows = matching(d).map(function (x) {
      var l = x.l, k = x.e.checks, n = nearby(l, d);
      return [d.name, l.id, l.name, l.center[0], l.center[1], l.acres, Math.round(l.acres * SQFT_PER_ACRE), l.acresInside, x.e.score, k.size, k.core, k.transit, k.density, 'not verified',
        l.coreMi, l.transitMi, l.railMi, l.bldgCoverage, n.acres.toFixed(2), l.parking || '', l.fee || '', l.access || ''].map(q).join(',');
    });
    var head = '# Downtown Parking Footprint - screening results, not recommendations. Checks on: ' + Object.keys(f.on).filter(function (k) { return f.on[k]; }).join(' ') +
      '; size>=' + f.size + ' ac; core<=' + f.core + ' mi; ' + (f.rail ? 'rail' : 'any stop') + '<=' + f.transit + ' mi; coverage>' + f.density + 'x median. Data (c) OpenStreetMap contributors, ODbL; LEHD LODES.\n';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([head + cols.join(',') + '\n' + rows.join('\n') + '\n'], { type: 'text/csv' }));
    a.download = 'parking-candidates-' + d.id + '.csv'; document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------------- lot detail ---------------- */
  var popup = null, selected = null, lotcard = $('lotcard');
  function popupOpen() { return !!popup || lotcard.classList.contains('show'); }
  function closeLot() {
    if (popup) { var p = popup; popup = null; p.remove(); }
    lotcard.classList.remove('show');
    if (selected && S.mapReady) { try { map.setFeatureState({ source: 'lots', id: selected }, { sel: false }); } catch (e) {} }
    selected = null;
  }
  function openLot(id, lngLat) {
    var d = S.data[S.active]; if (!d) { return; }
    var l = d.lotById[id]; if (!l) { return; }
    closeLot();
    selected = id; map.setFeatureState({ source: 'lots', id: id }, { sel: true });
    var e = evalLot(l, d), n = nearby(l, d), f = S.f;
    function yn(v, on) { return '<span class="' + (v ? 'ok' : 'no') + '">' + (v ? 'Pass' : 'No') + (on ? '' : ' (off)') + '</span>'; }
    var link = 'https://www.openstreetmap.org/' + (id[0] === 'r' ? 'relation/' : 'way/') + id.slice(1);
    var html = '<div class="pp"><h5>' + esc(l.name || 'Unnamed surface lot') + '</h5><div class="d">' + esc([l.fee === 'yes' ? 'Paid' : (l.fee === 'no' ? 'Free' : null), l.access, l.capacity ? l.capacity + ' spaces' : null].filter(Boolean).join(' · ') || 'Surface parking') + '</div>' +
      '<div class="lab"><span>Measurement</span></div>' +
      '<div class="row"><span>Area</span><span>' + fmt(l.acres, 2) + ' acres · ' + fmt(l.acres * SQFT_PER_ACRE) + ' sq ft</span></div>' +
      '<div class="row"><span>Football fields</span><span>' + fmt(l.acres / FIELD_ACRES, 1) + '</span></div>' +
      (Math.abs(l.acresInside - l.acres) > 0.005 ? '<div class="row"><span>Inside downtown</span><span>' + fmt(l.acresInside, 2) + ' acres</span></div>' : '') +
      '<div class="row"><span>To downtown core</span><span>' + fmt(l.coreMi, 2) + ' mi</span></div>' +
      '<div class="row"><span>Nearest stop · rail</span><span>' + (l.transitMi == null ? '—' : fmt(l.transitMi, 2)) + ' · ' + (l.railMi == null ? '—' : fmt(l.railMi, 2)) + ' mi</span></div>' +
      '<div class="lab"><span>Screening</span><span>Score ' + e.score + ' of 4</span></div>' +
      '<div class="row"><span>Size ≥ ' + fmt(f.size, 2) + ' ac</span>' + yn(e.checks.size, f.on.size) + '</div>' +
      '<div class="row"><span>≤ ' + fmt(f.core, 2) + ' mi from core</span>' + yn(e.checks.core, f.on.core) + '</div>' +
      '<div class="row"><span>' + (f.rail ? 'Rail' : 'Stop') + ' ≤ ' + fmt(f.transit, 2) + ' mi</span>' + yn(e.checks.transit, f.on.transit) + '</div>' +
      '<div class="row"><span>Dense surroundings</span>' + yn(e.checks.density, f.on.density) + '</div>' +
      '<div class="row"><span>Zoning</span><span class="no">Not verified</span></div>' +
      '<div class="near">' + (n.lots ? fmt(n.lots) + ' more surface lots within 0.25 mile add up to <b style="color:var(--ink)">' + fmt(n.acres, 1) + ' acres</b>. Neighbouring lots can sometimes be combined into a larger site.' : 'No other mapped surface lots within 0.25 mile.') + '</div>' +
      '<div class="row" style="border:0;margin-top:6px"><span>OpenStreetMap</span><a href="' + link + '" target="_blank" rel="noopener" style="color:var(--ink-2)">' + id + '</a></div></div>';
    if (narrow()) {
      lotcard.innerHTML = '<button class="icon-btn" id="lc-x" aria-label="Close">' + ICON.close + '</button>' + html;
      lotcard.classList.add('show'); $('lc-x').onclick = closeLot;
    } else {
      popup = new maplibregl.Popup({ offset: 12, maxWidth: '320px' }).setLngLat(lngLat).setHTML(html).addTo(map);
      popup.on('close', function () { if (popup) { popup = null; closeLot(); } });
      // keep the popup clear of the side panel
      var pt = map.project(lngLat), pr = panel.getBoundingClientRect(), need = pr.right + 180 - pt.x;
      if (need > 0) { map.panBy([-need, 0], { duration: 450 }); }
    }
  }

  /* ---------------- mobile drawer: peek / half / full ---------------- */
  var drawerState = 'half';
  function setDrawer(st) {
    if (!narrow() || landscape()) { panel.style.removeProperty('--drawer-h'); return; }
    drawerState = st;
    var h = st === 'peek' ? 132 : st === 'full' ? Math.round(window.innerHeight * 0.86) : Math.round(window.innerHeight * 0.46);
    panel.style.setProperty('--drawer-h', h + 'px');
  }
  (function () {
    var h = $('handle'), y0 = 0, h0 = 0, moved = false;
    h.addEventListener('pointerdown', function (e) { if (!narrow() || landscape()) { return; } y0 = e.clientY; h0 = panel.getBoundingClientRect().height; moved = false; panel.classList.add('dragging'); h.setPointerCapture(e.pointerId); });
    h.addEventListener('pointermove', function (e) {
      if (!panel.classList.contains('dragging')) { return; }
      var dy = y0 - e.clientY; if (Math.abs(dy) > 4) { moved = true; }
      panel.style.setProperty('--drawer-h', Math.max(110, Math.min(window.innerHeight * 0.9, h0 + dy)) + 'px');
    });
    function up() {
      if (!panel.classList.contains('dragging')) { return; }
      panel.classList.remove('dragging');
      var hh = panel.getBoundingClientRect().height, H = window.innerHeight;
      if (!moved) { setDrawer(drawerState === 'peek' ? 'half' : drawerState === 'half' ? 'full' : 'peek'); return; }
      setDrawer(hh < H * 0.3 ? 'peek' : hh < H * 0.66 ? 'half' : 'full');
    }
    h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  })();
  window.addEventListener('resize', function () { setDrawer(drawerState); });
  setDrawer('half');

  /* ---------------- sheets ---------------- */
  function renderCoverage() {
    var cs = S.cities.slice().sort(function (a, b) { return a.stats.lotsPerSqMi - b.stats.lotsPerSqMi; });
    $('covtable').innerHTML = '<tr><th>City</th><th class="num">Lots</th><th class="num">Downtown sq mi</th><th class="num">Lots per sq mi</th><th>Note</th></tr>' +
      cs.map(function (c) { return '<tr><td>' + esc(c.name) + '</td><td class="num">' + fmt(c.stats.lots) + '</td><td class="num">' + fmt(c.stats.downtownSqMi, 2) + '</td><td class="num">' + fmt(c.stats.lotsPerSqMi, 0) + '</td><td>' + (c.lowCoverage ? 'Possible under-mapping' : (c.id === 'newyork' ? 'Special case' : '')) + '</td></tr>'; }).join('');
  }
  each('[data-sheet]', function (b) { b.addEventListener('click', function () { $('sheet-' + b.getAttribute('data-sheet')).classList.add('show'); }); });
  each('.sheet', function (s) { s.addEventListener('click', function (e) { if (e.target === s || e.target.hasAttribute('data-close')) { s.classList.remove('show'); tip(); } }); });

  loadIndex();
})();
