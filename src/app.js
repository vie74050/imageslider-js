(function () {
  'use strict';
  const { posAt, fromText, fromJSON, empty } = window.MRIData;
  const MAP_DIR = 'src/';              // reference-map images live here
  const CAL_DEFAULT = { ox: 348, oy: 0, s: 1, ms: 14 };

  const $ = id => document.getElementById(id);
  const stage = $('stage'), sizer = $('sizer'), scene = $('scene'), img = $('img'), msg = $('msg'), ptsEl = $('pts');
  const slider = $('slider'), frameNum = $('frameNum');
  const mapBox = $('map'), mapWrap = $('mapwrap'), mapImg = $('mapImg');

  /* ---------- State ---------- */
  const S = {
    ds: null,                       // loaded dataset (points + map meta); null until a folder is opened
    files: [],                      // image slices: [{name, url}]
    mapUrl: '',                     // object URL if the map image came from the chosen folder
    cal: Object.assign({}, CAL_DEFAULT),
    frame: 0, selected: null, hiddenGroups: new Set(),
    natW: 512, natH: 512, zoom: 1, playing: false, mapOK: false
  };
  let els = [];

  const frameCount = () => S.files.length || (S.ds ? S.ds.maxKey + 1 : 1);

  /* ---------- Helpers ---------- */
  let toastTimer;
  function toast(text) {
    const t = $('toast'); t.textContent = text; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 4500);
  }
  const isImage = f => /^image\//.test(f.type) || /\.(png|jpe?g|gif|bmp|webp)$/i.test(f.name);
  const natural = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
  const calKey = () => 'mri.cal.' + S.ds.id;
  function loadCal() {
    try { return Object.assign({}, CAL_DEFAULT, JSON.parse(localStorage.getItem(calKey()) || 'null') || {}); }
    catch (e) { return Object.assign({}, CAL_DEFAULT); }
  }
  function saveCal() { try { localStorage.setItem(calKey(), JSON.stringify(S.cal)); } catch (e) {} }

  /* ---------- Opening a folder ---------- */
  // Expected layout:  <folder>/data.js  and  <folder>/images/<slices>
  async function openFolder(fileList) {
    const all = Array.from(fileList);
    if (!all.length) return;
    const parts = f => (f.webkitRelativePath || f.name).split('/');
    const root = parts(all[0])[0];

    // data.js (or data.json) is optional: without it the images still load, with no map or points
    const topLevel = (f, re) => { const p = parts(f); return p.length === 2 && re.test(p[1]); };
    const dataFile = all.find(f => topLevel(f, /^data\.js$/i)) || all.find(f => topLevel(f, /^data\.json$/i))
                  || all.find(f => topLevel(f, /\.js$/i));

    const slices = all.filter(f => { const p = parts(f); return p.length >= 3 && p[1].toLowerCase() === 'images' && isImage(f); }).sort(natural);
    if (!slices.length) { toast('No images found in “' + root + '/images/”.'); return; }

    let ds = null, note = '';
    if (dataFile) {
      try {
        const text = await dataFile.text();
        ds = /\.json$/i.test(dataFile.name) ? fromJSON(text, 'folder:' + root, root) : fromText(text, 'folder:' + root, root);
      } catch (e) { note = ' (could not read ' + dataFile.name + ': ' + e.message + ')'; }
    } else note = ' (no data.js — no map or points)';
    if (!ds) ds = empty('folder:' + root, root, slices.length);

    // optional: the reference-map image may sit in the chosen folder instead of src/
    const mapName = ds.meta.mapImage.toLowerCase();
    const mapFile = mapName ? all.find(f => isImage(f) && f.name.toLowerCase() === mapName && !slices.includes(f)) : null;

    show(root, slices.map(f => ({ name: f.name, url: URL.createObjectURL(f) })), ds,
         mapFile ? URL.createObjectURL(mapFile) : '', note, true);
  }

  // Common to a picked folder and a server sample: swap in the images + dataset and redraw.
  function show(title, files, ds, mapUrl, note, revoke) {
    stopPlay();
    if (S.revoke) { S.files.forEach(f => URL.revokeObjectURL(f.url)); if (S.mapUrl) URL.revokeObjectURL(S.mapUrl); }
    S.revoke = !!revoke;
    S.files = files; S.mapUrl = mapUrl || '';
    preloaded.clear();

    S.ds = ds; S.frame = 0; S.selected = null; S.hiddenGroups = new Set();
    S.cal = loadCal();
    $('dsName').textContent = title;
    $('dsName').classList.add('loaded');
    document.title = title + ' — ImageSlidersJS';
    $('empty').style.display = 'none';
    sizer.style.visibility = 'visible';
    applyOrientation(ds.meta.isVerticalPath);
    buildMarkers(); renderGroups(); syncInputs(); setMap(); render();
    toast('Loaded “' + title + '”: ' + S.files.length + ' images' + (ds.points.length ? ', ' + ds.points.length + ' points' : '') + (note || ''));
  }

  /* ---------- Server samples: imagesets/<CT|MRI>/<name>/{images/, data.js} ---------- */
  const SAMPLE_ROOT = 'imagesets/';
  const SAMPLE_GROUPS = ['CT', 'MRI'];
  // Used only if the server does not allow directory listings.
  const SAMPLE_FALLBACK = {
    CT: ['abdomen-axial', 'abdomen-coronal', 'abdomen-sagittal'],
    MRI: ['Ankle_66_A3_T1-axial', 'Ankle_66_A4_T2_STIR-coronal', 'Ankle_66_A7_T1-sagittal',
          'Brain_Axial_MPRAGE_T1_3D', 'Brain_Axial_T2', 'Brain_Coronal_T2',
          'elbow29-A1_Axial_T1__34', 'elbow29-A3_Cor_T1__22', 'elbow29-A5_Sag_T2_FAT__24',
          'Hand_Right_Axial_T1', 'Hand_Right_Coronal_T1', 'Hand_Right_Sagittal_T1',
          'knee69-A2_T2_FAT-axial', 'knee69-A3_T2_FAT-coronal', 'knee69-A6_T2-sagittal',
          'Shoulder_Right_Axial_PD', 'Shoulder_Right_Coronal_PD', 'Shoulder_Right_Sagittal_T1']
  };
  const encPath = s => s.split('/').map(encodeURIComponent).join('/');

  // Read the links out of a server directory listing (Apache/nginx autoindex, python http.server...).
  async function listDir(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    return Array.from(doc.querySelectorAll('a[href]')).map(a => a.getAttribute('href'))
      .filter(h => h && !/^([a-z]+:|\/\/|[?#]|\.\.?\/?$)/i.test(h))
      .map(h => decodeURIComponent(h.split(/[?#]/)[0]))
      .filter(h => h && !h.startsWith('/'));
  }

  // Where the list of samples and their image names comes from, first match wins:
  //   1. imagesets/index.json  (made by tools/make-index.py; works on any static host)
  //   2. the GitHub API file tree (on *.github.io or ?repo=owner/name[@branch])
  //   3. the server's own directory listing (local dev servers)
  //   4. a built-in list of folder names (menu only)
  // Catalog shape: { CT: { name: { images: [files], data: 'data.js' | undefined } }, MRI: {...} }
  let catalogP;
  const catalog = () => catalogP || (catalogP = buildCatalog());
  const IMG_RE = /\.(png|jpe?g|gif|bmp|webp)$/i;

  async function buildCatalog() {
    try {
      const r = await fetch(SAMPLE_ROOT + 'index.json', { cache: 'no-store' });
      if (r.ok) { const c = fromIndex(await r.json()); if (Object.keys(c).length) return c; }
    } catch (e) {}
    return githubTree();
  }
  function fromIndex(raw) {
    const out = {};
    Object.keys(raw || {}).forEach(g => Object.keys(raw[g] || {}).forEach(n => {
      const v = raw[g][n];
      const images = Array.isArray(v) ? v : (v && v.images) || [];
      if (images.length) ((out[g] = out[g] || {})[n] = { images: images.slice(), data: Array.isArray(v) ? undefined : v.data || undefined });
    }));
    return out;
  }

  function repoRef() {
    const q = new URLSearchParams(location.search).get('repo');
    if (q) { const m = q.match(/^([^/\s]+)\/([^@\s]+)(?:@(\S+))?$/); return m && { owner: m[1], repo: m[2], ref: m[3] || 'HEAD' }; }
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    if (!m) return null;
    const first = location.pathname.split('/').filter(Boolean)[0];
    return { owner: m[1], repo: first && !/\.html?$/i.test(first) ? first : m[1] + '.github.io', ref: 'HEAD' };
  }
  async function githubTree() {
    const r = repoRef(); if (!r) return null;
    try {
      const res = await fetch('https://api.github.com/repos/' + r.owner + '/' + r.repo + '/git/trees/' + encodeURIComponent(r.ref) + '?recursive=1');
      if (!res.ok) throw new Error(res.status);
      const out = {};
      (await res.json()).tree.forEach(t => {
        if (t.type !== 'blob') return;
        let m = t.path.match(/(?:^|\/)imagesets\/([^/]+)\/([^/]+)\/images\/([^/]+)$/);
        if (m && IMG_RE.test(m[3])) { const e = ((out[m[1]] = out[m[1]] || {})[m[2]] = out[m[1]][m[2]] || { images: [] }); e.images.push(m[3]); return; }
        m = t.path.match(/(?:^|\/)imagesets\/([^/]+)\/([^/]+)\/(data\.js|data\.json)$/i);
        if (m) { const e = ((out[m[1]] = out[m[1]] || {})[m[2]] = out[m[1]][m[2]] || { images: [] }); if (!e.data || /\.js$/i.test(m[3])) e.data = m[3]; }
      });
      return Object.keys(out).length ? out : null;
    } catch (e) { return null; }
  }

  async function discoverSamples() {
    const sel = $('sampleSel');
    sel.innerHTML = '<option value="">Samples…</option>';
    const cat = await catalog();
    for (const g of SAMPLE_GROUPS) {
      let names = cat && cat[g] ? Object.keys(cat[g]) : [];
      if (!names.length) {
        try { names = (await listDir(SAMPLE_ROOT + g + '/')).filter(n => n.endsWith('/')).map(n => n.slice(0, -1)); }
        catch (e) { names = []; }
      }
      if (!names.length) names = SAMPLE_FALLBACK[g] || [];
      const og = document.createElement('optgroup'); og.label = g;
      names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).forEach(n => {
        const o = document.createElement('option'); o.value = g + '/' + n; o.textContent = n.replace(/_/g, ' '); og.appendChild(o);
      });
      if (names.length) sel.appendChild(og);
    }
    sel.hidden = sel.options.length < 2;
  }

  async function loadSample(path) {
    const base = SAMPLE_ROOT + encPath(path) + '/';
    const title = path.split('/').pop();
    const [g, n] = path.split('/');
    const cat = await catalog();
    const entry = cat && cat[g] && cat[g][n];
    let names;
    if (entry) names = entry.images.slice();
    else {
      try { names = await listDir(base + 'images/'); }
      catch (e) { toast('Could not list the images in ' + SAMPLE_ROOT + path + '/images/. Run tools/make-index.py to create imagesets/index.json.'); return; }
    }
    names = names.filter(f => IMG_RE.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!names.length) { toast('No images found in ' + SAMPLE_ROOT + path + '/images/.'); return; }

    let ds = null, note = '';
    for (const fn of (entry ? (entry.data ? [entry.data] : []) : ['data.js', 'data.json'])) {
      try {
        const r = await fetch(base + fn, { cache: 'no-store' });
        if (!r.ok) continue;
        const text = await r.text();
        ds = /\.json$/i.test(fn) ? fromJSON(text, 'sample:' + path, title) : fromText(text, 'sample:' + path, title);
        break;
      } catch (e) { note = ' (could not read ' + fn + ': ' + e.message + ')'; }
    }
    if (!ds) { ds = empty('sample:' + path, title, names.length); note = note || ' (no data.js — no map or points)'; }
    show(title, names.map(n => ({ name: n, url: base + 'images/' + encodeURIComponent(n) })), ds, '', note, false);
  }
  $('sampleSel').addEventListener('change', e => { if (e.target.value) loadSample(e.target.value); });

  function buildMarkers() {
    ptsEl.textContent = ''; els = [];
    S.ds.points.forEach(p => {
      const d = document.createElement('div');
      d.className = 'pt';
      // the inner .shape gets a class named after the data's "shape" (circle, square, arrow-up, ...)
      const sh = document.createElement('span');
      sh.className = 'shape ' + p.shape;
      sh.style.setProperty('--c', p.color);
      sh.style.setProperty('--bw', p.bw + 'px');
      const lb = document.createElement('span');
      lb.className = 'lbl'; lb.textContent = p.label;
      d.append(sh, lb);
      d.addEventListener('click', e => { e.stopPropagation(); select(p.id); });
      ptsEl.appendChild(d); els.push(d);
    });
  }

  /* ---------- Selection / side panel ---------- */
  function select(id) {
    S.selected = id;
    els.forEach((e, i) => e.classList.toggle('sel', i === id));
    renderInfo(); renderList();
  }
  function visibleRange(p) {
    let first = -1, last = -1;
    for (let f = 0; f < frameCount(); f++) if (posAt(p, f)) { if (first < 0) first = f; last = f; }
    return first < 0 ? null : [first, last];
  }
  function renderInfo() {
    const el = $('info');
    if (S.selected == null || !S.ds) { el.innerHTML = '<h2>Selected</h2><div style="color:var(--muted)">' + (!S.ds ? 'Nothing loaded.' : S.ds.points.length ? 'Click a point on the image.' : 'No points for this folder.') + '</div>'; return; }
    const p = S.ds.points[S.selected], r = visibleRange(p), here = !!posAt(p, S.frame);
    el.innerHTML = '<h2>Selected</h2><div class="name"><span class="dot" style="border-color:' + p.color + ';display:inline-block;margin-right:6px"></span></div><div class="meta"></div><div class="meta st"></div>';
    el.querySelector('.name').appendChild(document.createTextNode(p.label));
    el.querySelector('.meta').textContent = p.group;
    el.querySelector('.st').textContent = (r ? 'Visible on frames ' + r[0] + '–' + r[1] : 'Never visible') + (here ? '' : ' · not in this frame');
  }
  function renderList() {
    const box = $('list'); box.textContent = '';
    if (!S.ds) return;
    const vis = S.ds.points.filter(p => posAt(p, S.frame) && !S.hiddenGroups.has(p.group))
      .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
    let g = null;
    vis.forEach(p => {
      if (p.group !== g) { g = p.group; const h = document.createElement('div'); h.className = 'grp'; h.textContent = g; box.appendChild(h); }
      const row = document.createElement('div');
      row.className = 'row' + (p.id === S.selected ? ' sel' : '');
      row.innerHTML = '<span class="dot" style="border-color:' + p.color + '"></span><span></span>';
      row.lastChild.textContent = p.label;
      row.onclick = e => { e.stopPropagation(); select(p.id); };
      box.appendChild(row);
    });
    if (!vis.length) box.innerHTML = '<div class="grp">No points in this frame</div>';
  }
  function renderGroups() {
    const box = $('groups'); box.textContent = '';
    if (!S.ds) return;
    const seen = new Map();
    S.ds.points.forEach(p => { if (!seen.has(p.group)) seen.set(p.group, p.color); });
    seen.forEach((color, g) => {
      const c = document.createElement('div');
      c.className = 'chip' + (S.hiddenGroups.has(g) ? ' off' : '');
      c.innerHTML = '<span class="dot" style="border-color:' + color + '"></span><span></span>';
      c.lastChild.textContent = g;
      c.onclick = () => { S.hiddenGroups.has(g) ? S.hiddenGroups.delete(g) : S.hiddenGroups.add(g); renderGroups(); render(); };
      box.appendChild(c);
    });
  }
  stage.addEventListener('click', () => select(null));

  /* ---------- Slice images ---------- */
  const srcFor = i => (S.files[i] ? S.files[i].url : '');
  const preloaded = new Map();
  function preload(i) {
    if (i < 0 || i >= S.files.length || preloaded.has(i)) return;
    const im = new Image(); im.src = srcFor(i); preloaded.set(i, im);
    if (preloaded.size > 40) preloaded.delete(preloaded.keys().next().value);
  }
  img.addEventListener('load', () => {
    msg.style.display = 'none';
    if (img.naturalWidth && (img.naturalWidth !== S.natW || img.naturalHeight !== S.natH)) {
      S.natW = img.naturalWidth; S.natH = img.naturalHeight; fit(); render();
    }
  });
  img.addEventListener('error', () => { msg.style.display = 'flex'; msg.textContent = 'Could not display this image file.'; });

  /* ---------- Layout ---------- */
  function fit() {
    const aw = stage.clientWidth, ah = stage.clientHeight;
    S.zoom = Math.min(aw / S.natW, ah / S.natH) || 1;
    sizer.style.width = S.natW * S.zoom + 'px';
    sizer.style.height = S.natH * S.zoom + 'px';
    scene.style.width = S.natW + 'px';
    scene.style.height = S.natH + 'px';
    scene.style.transform = 'scale(' + S.zoom + ')';
    scene.style.setProperty('--inv', 1 / S.zoom);
  }

  /* ---------- Reference map ---------- */
  // Band from startPercentage to stopPercentage along the scan direction (vertical when
  // isVerticalPath, else horizontal), with a cursor for the current frame.
  function setMap() {
    const m = S.ds && S.ds.meta;
    S.mapOK = false;
    if (!m || !m.mapImage) { updateMap(); return; }
    const src = S.mapUrl || MAP_DIR + m.mapImage;
    if (mapImg.getAttribute('src') !== src) mapImg.src = src; else S.mapOK = true;
    updateMap();
  }
  mapImg.addEventListener('load', () => {
    S.mapOK = true;
    mapWrap.style.setProperty('--ar', mapImg.naturalWidth / mapImg.naturalHeight);
    updateMap();
  });
  mapImg.addEventListener('error', () => {
    S.mapOK = false; updateMap();
    if (S.ds && S.ds.meta.mapImage) toast('Map image “' + S.ds.meta.mapImage + '” not found in src/ or in the chosen folder.');
  });
  const pathPos = f => {
    const m = S.ds.meta, N = frameCount();
    return m.startPercentage + (m.stopPercentage - m.startPercentage) * (N > 1 ? f / (N - 1) : 0);
  };
  function updateMap() {
    const show = $('showMap').checked && S.ds && S.ds.meta.mapImage && S.mapOK;
    mapBox.hidden = !show;
    if (!show) return;
    const m = S.ds.meta, v = m.isVerticalPath, pos = pathPos(S.frame);
    const band = $('band'), cur = $('cursor'), b1 = $('blk1'), b2 = $('blk2');
    const lo = Math.min(m.startPercentage, m.stopPercentage), hi = Math.max(m.startPercentage, m.stopPercentage);
    const clear = el => { el.style.left = el.style.right = el.style.top = el.style.bottom = el.style.width = el.style.height = ''; };
    const set = (el, a, b) => {      // a = start %, b = length %
      clear(el);
      if (v) { el.style.left = '0'; el.style.right = '0'; el.style.top = a + '%'; el.style.height = b + '%'; }
      else { el.style.top = '0'; el.style.bottom = '0'; el.style.left = a + '%'; el.style.width = b + '%'; }
    };
    // greyed-out areas lie across the other axis: left/right strips for a vertical path,
    // top/bottom strips for a horizontal one
    const setBlock = (el, a, b) => {
      clear(el);
      if (v) { el.style.top = '0'; el.style.bottom = '0'; el.style.left = a + '%'; el.style.width = b + '%'; }
      else { el.style.left = '0'; el.style.right = '0'; el.style.top = a + '%'; el.style.height = b + '%'; }
    };
    set(band, lo, hi - lo);
    setBlock(b1, 0, m.mapBlock1End);
    setBlock(b2, m.mapBlock2Start, 100 - m.mapBlock2Start);
    b1.style.display = m.mapBlock1End > 0 ? 'block' : 'none';
    b2.style.display = m.mapBlock2Start < 100 ? 'block' : 'none';
    clear(cur);
    if (v) { cur.style.left = '-4px'; cur.style.right = '-4px'; cur.style.height = '2px'; cur.style.top = 'calc(' + pos + '% - 1px)'; }
    else { cur.style.top = '-4px'; cur.style.bottom = '-4px'; cur.style.width = '2px'; cur.style.left = 'calc(' + pos + '% - 1px)'; }
    $('mapLabel').textContent = 'Frame ' + S.frame + ' · ' + pos.toFixed(1) + '% of body ' + (v ? 'height' : 'width');
  }
  // click/drag on the map to seek within the scanned band
  let mapDrag = false;
  function mapSeek(e) {
    const m = S.ds.meta, r = mapWrap.getBoundingClientRect();
    const pct = 100 * (m.isVerticalPath ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width);
    const span = m.stopPercentage - m.startPercentage || 1;
    go(Math.round((pct - m.startPercentage) / span * (frameCount() - 1)));
  }
  mapWrap.addEventListener('pointerdown', e => { mapDrag = true; mapWrap.setPointerCapture(e.pointerId); mapSeek(e); e.stopPropagation(); });
  mapWrap.addEventListener('pointermove', e => { if (mapDrag) mapSeek(e); });
  mapWrap.addEventListener('pointerup', () => { mapDrag = false; });
  mapBox.addEventListener('click', e => e.stopPropagation());
  $('showMap').addEventListener('change', updateMap);

  /* ---------- Render ---------- */
  function render() {
    if (!S.ds) return;
    const f = S.frame, N = frameCount();
    slider.max = N - 1; slider.value = f; frameNum.value = f; frameNum.max = N - 1;
    scene.style.setProperty('--ms', S.cal.ms + 'px');

    const src = srcFor(f);
    if (src && img.getAttribute('src') !== src) img.src = src;
    $('hud').textContent = 'Frame ' + f + ' / ' + (N - 1);

    const s = Number(S.cal.s) || 1, ox = Number(S.cal.ox) || 0, oy = Number(S.cal.oy) || 0;
    S.ds.points.forEach(p => {
      const pos = posAt(p, f), el = els[p.id];
      if (!pos || S.hiddenGroups.has(p.group)) { el.style.display = 'none'; return; }
      const x = (pos.left - ox) * s, y = (pos.top - oy) * s;
      el.style.display = 'block';
      el.style.left = x + 'px'; el.style.top = y + 'px';
      el.classList.toggle('flip', x > S.natW * 0.6);
    });
    renderList(); renderInfo(); updateMap();
    for (let d = 1; d <= 3; d++) { preload(f + d); preload(f - d); }
  }
  function go(f) { if (!S.ds) return; S.frame = Math.max(0, Math.min(frameCount() - 1, Math.round(f) || 0)); render(); }

  /* ---------- Controls ---------- */
  // isVerticalPath (data.js, default true): vertical slider in a rail beside the image,
  // otherwise a horizontal slider in the footer.
  function applyOrientation(vertical) {
    const ctl = $('ctl'), host = vertical ? $('rail') : $('foot');
    if (ctl.parentNode !== host) host.appendChild(ctl);
    ctl.classList.toggle('vertical', vertical);
    ctl.classList.toggle('horizontal', !vertical);
    $('prev').textContent = vertical ? '▲' : '◀';
    $('next').textContent = vertical ? '▼' : '▶';
    $('prev').title = 'Previous frame'; $('next').title = 'Next frame';
    $('rail').style.display = vertical ? 'flex' : 'none';
    $('foot').style.display = vertical ? 'none' : 'flex';
  }
  slider.addEventListener('input', () => go(slider.value));
  frameNum.addEventListener('change', () => go(frameNum.value));
  $('prev').onclick = () => go(S.frame - 1);
  $('next').onclick = () => go(S.frame + 1);
  $('showAll').onchange = e => scene.classList.toggle('showall', e.target.checked);

  let timer = null;
  function stopPlay() { S.playing = false; clearInterval(timer); $('play').textContent = '▶'; }
  function togglePlay() {
    if (!S.ds) return;
    if (S.playing) return stopPlay();
    S.playing = true; $('play').textContent = '❚❚';
    timer = setInterval(() => go(S.frame + 1 >= frameCount() ? 0 : S.frame + 1), 90);
  }
  $('play').onclick = togglePlay;

  document.addEventListener('keydown', e => {
    const t = e.target;
    if (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && (t.type === 'text' || t.type === 'number'))) return;
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { go(S.frame + step); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { go(S.frame - step); e.preventDefault(); }
    else if (e.key === 'Home') { go(0); e.preventDefault(); }
    else if (e.key === 'End') { go(frameCount() - 1); e.preventDefault(); }
    else if (e.key === ' ' && t.tagName !== 'BUTTON') { togglePlay(); e.preventDefault(); }
    else if (e.key === 'Escape') select(null);
  });

  // Calibration
  function syncInputs() { $('offX').value = S.cal.ox; $('offY').value = S.cal.oy; $('scl').value = S.cal.s; $('msz').value = S.cal.ms; }
  [['offX', 'ox'], ['offY', 'oy'], ['scl', 's'], ['msz', 'ms']].forEach(([id, key]) => {
    $(id).addEventListener('input', e => { if (!S.ds) return; S.cal[key] = parseFloat(e.target.value) || 0; saveCal(); render(); });
  });
  $('resetCal').onclick = () => { if (!S.ds) return; S.cal = Object.assign({}, CAL_DEFAULT); saveCal(); syncInputs(); render(); };

  /* ---------- Folder picker ---------- */
  const pick = () => $('folderIn').click();
  $('btnFolder').onclick = pick;
  $('btnFolder2').onclick = pick;
  $('folderIn').onchange = e => { openFolder(e.target.files); e.target.value = ''; };

  window.addEventListener('resize', fit);
  new ResizeObserver(fit).observe(stage);

  /* ---------- Start with nothing loaded ---------- */
  discoverSamples();
  sizer.style.visibility = 'hidden';
  applyOrientation(true);
  fit(); renderInfo();
})();
