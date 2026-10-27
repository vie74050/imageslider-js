#!/usr/bin/env python3
"""Builds imagesets/index.json, the file list ImageSlidersJS uses for its Samples menu.

Run from the project root (the folder containing index.html) after adding or changing samples:

    python3 tools/make-index.py            # uses ./imagesets
    python3 tools/make-index.py path/to/imagesets

Expected layout:  imagesets/<group>/<sample>/images/<slices>   (+ optional data.js or data.json)
Commit the generated imagesets/index.json along with the images.
"""
import json, os, re, sys

IMG = re.compile(r'\.(png|jpe?g|gif|bmp|webp)$', re.I)
nat = lambda s: [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', s)]

root = sys.argv[1] if len(sys.argv) > 1 else 'imagesets'
if not os.path.isdir(root):
    sys.exit('Folder not found: ' + root + '  (run from the project root, or pass the imagesets path)')

index, total = {}, 0
for group in sorted(os.listdir(root), key=nat):
    gdir = os.path.join(root, group)
    if not os.path.isdir(gdir):
        continue
    for name in sorted(os.listdir(gdir), key=nat):
        sdir = os.path.join(gdir, name)
        idir = os.path.join(sdir, 'images')
        if not os.path.isdir(idir):
            continue
        images = sorted((f for f in os.listdir(idir) if IMG.search(f)), key=nat)
        if not images:
            continue
        entry = {'images': images}
        for d in ('data.js', 'data.json'):
            if os.path.isfile(os.path.join(sdir, d)):
                entry['data'] = d
                break
        index.setdefault(group, {})[name] = entry
        total += 1
        print('%s/%s: %d images%s' % (group, name, len(images), ', ' + entry['data'] if 'data' in entry else ', no data file'))

out = os.path.join(root, 'index.json')
with open(out, 'w') as f:
    json.dump(index, f, separators=(',', ':'))
print('Wrote %s (%d samples)' % (out, total))
