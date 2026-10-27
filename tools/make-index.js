#!/usr/bin/env node
/* Builds imagesets/index.json, the file list ImageSlidersJS uses for its Samples menu.
 *
 * Run from the project root (the folder containing index.html) after adding or changing samples:
 *
 *     node tools/make-index.js              # uses ./imagesets
 *     node tools/make-index.js path/to/imagesets
 *
 * Layout:  imagesets/<group>/<sample>/images/<slices>   (+ optional data.js or data.json)
 * Commit the generated imagesets/index.json along with the images.
 */
const fs = require('fs'), path = require('path');
const IMG = /\.(png|jpe?g|gif|bmp|webp)$/i;
const nat = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const dirs = d => fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort(nat);

const root = process.argv[2] || 'imagesets';
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error('Folder not found: ' + root + '  (run from the project root, or pass the imagesets path)');
  process.exit(1);
}

const index = {}; let total = 0;
for (const group of dirs(root)) {
  for (const name of dirs(path.join(root, group))) {
    const sdir = path.join(root, group, name), idir = path.join(sdir, 'images');
    if (!fs.existsSync(idir) || !fs.statSync(idir).isDirectory()) continue;
    const images = fs.readdirSync(idir).filter(f => IMG.test(f)).sort(nat);
    if (!images.length) continue;
    const entry = { images };
    for (const d of ['data.js', 'data.json']) if (fs.existsSync(path.join(sdir, d))) { entry.data = d; break; }
    (index[group] = index[group] || {})[name] = entry; total++;
    console.log(group + '/' + name + ': ' + images.length + ' images' + (entry.data ? ', ' + entry.data : ', no data file'));
  }
}
const out = path.join(root, 'index.json');
fs.writeFileSync(out, JSON.stringify(index));
console.log('Wrote ' + out + ' (' + total + ' samples)');
