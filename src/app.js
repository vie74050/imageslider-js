(function () {
  'use strict';
  const { posAt, fromText } = window.MRIData;
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

    const dataFile = all.find(f => { const p = parts(f); return p.length === 2 && /^data\.js$/i.test(p[1]); })
                  || all.find(f => { const p = parts(f); return p.length === 2 && /\.js$/i.test(p[1]); });
    if (!dataFile) { toast('No data.js found in “' + root + '”.'); return; }

    const slices = all.filter(f => { const p = parts(f); return p.length >= 3 && p[1].toLowerCase() === 'images' && isImage(f); }).sort(natural);
    if (!slices.length) { toast('No images found in “' + root + '/images/”.'); return; }

    let ds;
    try { ds = fromText(await dataFile.text(), 'folder:' + root, root); }
    catch (e) { toast('Could not read ' + dataFile.name + ': ' + e.message); return; }

    // optional: the reference-map image may sit in the chosen folder instead of src/
    const mapName = ds.meta.mapImage.toLowerCase();
    const mapFile = mapName ? all.find(f => isImage(f) && f.name.toLowerCase() === mapName && !slices.includes(f)) : null;

    stopPlay();
    S.files.forEach(f => URL.revokeObjectURL(f.url));
    if (S.mapUrl) URL.revokeObjectURL(S.mapUrl);
    S.files = slices.map(f => ({ name: f.name, url: URL.createObjectURL(f) }));
    S.mapUrl = mapFile ? URL.createObjectURL(mapFile) : '';
    preloaded.clear();

    S.ds = ds; S.frame = 0; S.selected = null; S.hiddenGroups = new Set();
    S.cal = loadCal();
    $('dsName').textContent = root;
    $('dsName').classList.add('loaded');
    document.title = root + ' — ImageSlidersJS';
    $('empty').style.display = 'none';
    sizer.style.visibility = 'visible';
    buildMarkers(); renderGroups(); syncInputs(); setMap(); render();
    toast('Loaded “' + root + '”: ' + S.files.length + ' images, ' + ds.points.length + ' points');
  }

  function buildMarkers() {
    ptsEl.textContent = ''; els = [];
    S.ds.points.forEach(p => {
      const d = document.createElement('div');
      d.className = 'pt';
      d.style.border = p.bw + 'px solid ' + p.color;
      d.innerHTML = '<span class="lbl"></span>';
      d.firstChild.textContent = p.label;
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
    if (S.selected == null || !S.ds) { el.innerHTML = '<h2>Selected</h2><div style="color:var(--muted)">' + (S.ds ? 'Click a point on the image.' : 'Nothing loaded.') + '</div>'; return; }
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
    set(band, lo, hi - lo);
    set(b1, 0, m.mapBlock1End);
    set(b2, m.mapBlock2Start, 100 - m.mapBlock2Start);
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
    if (e.key === 'ArrowRight') { go(S.frame + step); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { go(S.frame - step); e.preventDefault(); }
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
  sizer.style.visibility = 'hidden';
  fit(); renderInfo();
})();
