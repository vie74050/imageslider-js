/* Turns the text of a data.js into a normalised dataset, and computes where each
   point is on a given frame. */
(function (global) {
  'use strict';

  // A point whose data `left` is under MIN_LEFT px is treated as hidden (data.js parks hidden points at -200).
  const MIN_LEFT = 200;
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  // data.js is a list of top-level assignments (mapImage=...; _points=[...];). They are
  // captured in a private object instead of leaking onto window.
  function fromText(text, id, name) {
    const store = {};
    const proxy = new Proxy(store, {
      has: (t, k) => typeof k === 'string' && !(k in globalThis),
      get: (t, k) => t[k],
      set: (t, k, v) => { t[k] = v; return true; }
    });
    new Function('__ctx', 'with(__ctx){' + text + '\n}')(proxy);
    return build(store, id, name);
  }

  function build(store, id, name, frames) {
    const raw = store._points;
    if (!Array.isArray(raw)) throw new Error('no _points array found');
    const points = raw.map((p, i) => {
      const keys = Object.keys(p.positions || {}).map(Number).sort((a, b) => a - b);
      return {
        id: i,
        label: (p.label || '').trim(),
        group: (p.group || '').trim(),
        shape: (String(p.shape || 'circle').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'circle'),
        color: p['border-color'] || '#ffffff',
        bw: parseInt(p['border-width'], 10) || 2,
        keys, pos: p.positions || {}
      };
    });
    const maxKey = points.length ? points.reduce((m, p) => Math.max(m, p.keys[p.keys.length - 1] || 0), 0) : Math.max(0, (frames || 1) - 1);
    return {
      id, name, points, maxKey,
      meta: {
        mapImage: store.mapImage || '',
        startPercentage: num(store.startPercentage, 0),
        stopPercentage: num(store.stopPercentage, 100),
        mapBlock1End: num(store.mapBlock1End, 0),
        mapBlock2Start: num(store.mapBlock2Start, 100),
        isVerticalPath: store.isVerticalPath !== false
      }
    };
  }

  // Position of a point on frame f, or null if it is not shown.
  // A keyframe with left < 200 (data.js uses -200) means "not shown from here".
  // Between two visible keyframes the point moves linearly.
  function posAt(p, f) {
    const k = p.keys; let lo = -1;
    for (let i = 0; i < k.length; i++) { if (k[i] <= f) lo = i; else break; }
    if (lo < 0) return null;
    const a = p.pos[k[lo]]; console.log('left:', a.left, 'MIN_LEFT:', MIN_LEFT);
    if (a.left < MIN_LEFT) return null;
    const nk = k[lo + 1];
    const b = nk !== undefined ? p.pos[nk] : null;
    if (!b || b.left < MIN_LEFT || k[lo] === f) return { top: a.top, left: a.left };
    const t = (f - k[lo]) / (nk - k[lo]); 
    return { top: a.top + (b.top - a.top) * t, left: a.left + (b.left - a.left) * t };
  }

  // data.json: same fields as data.js (mapImage, startPercentage, ..., _points) as a JSON object.
  function fromJSON(text, id, name) {
    const o = JSON.parse(text);
    return build(o, id, name);
  }

  // No data file: just the images — no points, no map.
  function empty(id, name, frames) {
    return build({ _points: [] }, id, name, frames);
  }

  global.MRIData = { fromText, fromJSON, empty, posAt };
})(window);
