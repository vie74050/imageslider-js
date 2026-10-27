# ImageSlidersJS

A lightweight, static web viewer for stepping through image slice series (CT, MRI) with a slider. Optional label points mark structures on each slice, and a body reference map shows where in the body the current slice sits.

> **NOTE** This site was set up as a backup viewer for the main <imagesliders.commons.bcit.ca> site, to be used if the Commons site is down or otherwise inaccessible.
>
> The image sets and data files here come from the main site's editor (see **Where image sets come from** below).

## Where image sets come from

**Image sets should be generated on the main ImageSliders site on Commons, using its editor feature.** That site houses the original image sets and their `data.json` (point and map) files; the copies here are exported from it. Anything added to this backup site must either come from that editor or **follow exactly the same structure** (see "Folder layout" and "data.js format" below), otherwise the points, map and slider direction may not display correctly.

## Using the viewer

- **Samples menu** (header): lists the preloaded series in `imagesets/CT/` and `imagesets/MRI/`. Pick one to load it.
- **Open folder…**: load any folder from your own computer that contains an `images/` subfolder and, optionally, a `data.js`. The folder name becomes the title.
- **Slider:** drag it, use the ▲ ▼ buttons, the arrow keys (Shift = 10 frames), Home/End, or Space to play and pause.
- **Points:** click a point to show its label; "All labels" shows every label; the Groups chips hide or show categories.
- **Reference map:** shows the slice position on a body outline. Click or drag on it to jump to a position.
- **Calibration** (side panel): adjusts point alignment if markers sit off the anatomy. It is remembered per sample in the browser.

The viewer starts empty and needs no server-side code or build step.

## Folder layout

``` text
index.html
src/                  app code, styles, reference-map images (map_*.gif)
imagesets/
  index.json          file list for the Samples menu (generated, see below)
  CT/<sample>/        images/ + optional data.js
  MRI/<sample>/       images/ + optional data.js
tools/                make-index.js, make-index.py, make-index.html
```

A sample without a `data.js` still loads its images, just with no map or points.

## Adding or changing samples

Create the image set in the Commons editor first, then copy it here. If you build one by hand, keep to the same structure.

1. Add a folder under `imagesets/CT/` or `imagesets/MRI/` with an `images/` subfolder (and optionally a `data.js`).
2. Regenerate `imagesets/index.json` using any one of:
   - `node tools/make-index.js` (from the project root)
   - `python3 tools/make-index.py`
   - open `tools/make-index.html` in a browser, choose the `imagesets` folder, and save the downloaded file into `imagesets/`
3. Commit the images and the updated `index.json`.

GitHub Pages cannot list folder contents, so the generated `index.json` is how the Samples menu finds the images. If it is missing, the page tries the GitHub API (on `*.github.io`, or with `?repo=owner/name`) and then the server's own directory listing.

## data.js format

```js
mapImage='map_frontal.gif';   // reference map in src/
startPercentage=30;           // where the series starts/ends on the map (%)
stopPercentage=52;
mapBlock1End=0;               // greyed-out areas on the map (%)
mapBlock2Start=100;
isVerticalPath=true;          // true = vertical slider (default), false = horizontal
_points=[{
  label:"Aorta", group:"Arteries", shape:"circle",   // circle (default), square, arrow-up
  "border-color":"#ff2600", "border-width":"3",
  positions:{ "0":{top:296,left:637}, "12":{top:290,left:636} }   // keyframes by slice number
}];
```

Between keyframes a point moves smoothly. A keyframe with `left` under 5 (the data uses -200) hides the point from that slice onward.

## Hosting

Any static host works, including GitHub Pages. Serve it over http(s); opening `index.html` directly from disk works for "Open folder…" but not for the Samples menu.
