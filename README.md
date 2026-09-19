# THOCK — Shopify landing page

L2 promotion assignment #3. A landing page for a fictional mechanical keyboard
brand, built as a Shopify theme on top of Dawn v16.

**Store:** `l2-assignment.myshopify.com` (Shopify Partner development store)

---

## Why it's built this way

**Dawn as a base, not a blank theme.** The assignment is a landing page, not a
storefront. Building cart, PDP, search and checkout plumbing from scratch would
have spent the budget on the part nobody is grading. Every custom file is
prefixed `thock-`, so `git diff` against the first commit is exactly the
assignment work and nothing else.

**The 3D keyboard is generated in JavaScript, not loaded from a `.glb`.** A
model file has to live in Shopify Files, which means a hardcoded CDN URL that
breaks the moment the theme moves to another store. Generated geometry travels
with the theme, weighs nothing, and lets colorways be material swaps driven
directly by Shopify variants.

**Everything is merchant-editable.** Colorways are section blocks with their own
colour and material settings. A merchant can add a sixth colorway, point it at a
new variant, and tune its metalness without touching code. A landing page that
only the developer can change is a liability, not a deliverable.

**Commerce and presentation are decoupled.** The variant picker, price and
add-to-cart are plain DOM and always work. three.js loads lazily, only when the
hero is near the viewport and the device looks capable. If WebGL is unavailable,
blocked, or the network drops the 190 KB payload, a CSS-rendered keyboard takes
its place and the product is still purchasable.

---

## Local development

```bash
npm i -g @shopify/cli@latest

# hot-reloading preview at http://127.0.0.1:9292
shopify theme dev --store l2-assignment.myshopify.com

# lint
shopify theme check

# push as an unpublished theme
shopify theme push --unpublished --store l2-assignment.myshopify.com
```

## Seeding the catalog

The landing page needs the product it configures. Import
[`seed/products.csv`](seed/products.csv) via **Products → Import** in the admin:
12 products, 44 variants. The flagship is `thock-model-65` with
`Colorway × Switch` variants — those option names are what the hero section maps
to swatches, so they must match.

---

## Custom files

| File | Role |
| --- | --- |
| `assets/thock-base.css` | Design tokens — colour, fluid type scale, spacing, easing, reduced-motion guard |
| `assets/thock-motion.js` | Shared reveal-on-scroll observer and scroll-progress helper |
| `sections/thock-hero.liquid` | Hero configurator section + schema |
| `assets/thock-hero.css` | Hero styles, including the no-WebGL fallback board |
| `assets/thock-hero.js` | Variant ↔ 3D binding, lazy WebGL boot, render loop |
| `assets/thock-keyboard-3d.js` | Procedural 65% keyboard geometry, studio environment, contact shadow |
| `assets/thock-keyboard.glb` | Baked keyboard model — 4 primitives, one material per colorway target |
| `tools/bake-keyboard-glb.py` | Offline splitter that produced the .glb (not shipped to the store) |
| `assets/three.module.min.js` | three.js 0.186.0, vendored, plus GLTFLoader and its two utils |

### Shopify rewrites dynamic `import()`

Shopify minifies theme JavaScript on its CDN and rewrites dynamic
`import(...)` into `require(...)` — which does not exist in a browser. It does
this in classic scripts **and** in ES modules, so adding `export {}` does not
help. Static `import` statements are left alone.

This only affects the published theme: `shopify theme dev` serves raw files, so
lazy-loaded 3D worked perfectly in local development and threw
`ReferenceError: require is not defined` the moment it was pushed.

The fix is `assets/thock-3d-boot.js.liquid`: a module that does all the imports
*statically*, lazy-loaded by injecting a `<script type="module">` tag
(`THOCK.load3D()` in `thock-motion.js`). Same deferral, no dynamic import.
Do not reintroduce `import()` in any theme asset.

### …and serves unversioned asset paths from a stale cache

That boot file is rendered through Liquid for a second reason. A relative
specifier like `'./thock-keyboard-3d.js'` resolves to the **unversioned** asset
path, which Shopify's CDN caches aggressively — so edits to an imported module
never reach visitors. Measured on this store after a successful push:

| URL | bytes | current? |
| --- | --- | --- |
| `thock-keyboard-3d.js?v=…` | 14,874 | yes |
| `thock-keyboard-3d.js` | 12,041 | no — an earlier deploy |

`asset_url` inside the Liquid asset emits absolute, content-versioned URLs, so a
changed module gets a changed specifier. Keep every import specifier in that
file going through `asset_url`.

One caveat this does *not* cover: the vendored libraries import each other
relatively (`three.module.min.js` → `three.core.min.js`, `gltf-loader.js` →
both utils). If you ever bump three.js, rename those files rather than
overwriting them, or the CDN will keep serving the old copies.

`three.module.min.js` ships from npm importing `./three.core.js` — the
*unminified* core. The vendored copy is patched to `./three.core.min.js` so the
relative resolve against Shopify's asset CDN picks up the minified build. Redo
that patch if you ever bump the three.js version.

## The 3D model

`assets/thock-keyboard.glb` started life as a CGTrader model (#6220946) that
exported as a **single 52k-triangle mesh with one flat material and no
textures** — unusable for a colorway configurator, which needs the case and the
keycaps tinted independently.

`tools/bake-keyboard-glb.py` fixes that offline: it separates the mesh into
connected components, classifies each one, and writes a new `.glb` with four
primitives and materials named `case`, `cap_base`, `cap_mod` and `cap_accent` —
matching the section's colorway block settings one-for-one.

Three things had to be right for the classification to work, and each was found
by measuring rather than assuming:

1. **Triangle count separates keycaps from switch stems.** They overlap almost
   completely in footprint, so size can't tell them apart — but they differ
   tenfold in density. Filtering at 150 triangles isolates the caps.
2. **Depth, not width, separates a keycap from the top panel.** Every cap is one
   key deep however wide it is, so a 6.4u spacebar and a 1u Escape look the same
   on that axis, while the panel spans the whole board. An earlier width-based
   filter put the spacebar in the case group, where it rendered as bronze trim.
3. **The source has ~3.8 degrees of residual yaw**, because the node quaternion
   is ~185 degrees rather than 180. Invisible at a glance, but it drags z by 1.2
   units across a 15-key row — more than the 0.9 row pitch — so rows genuinely
   interleave and no threshold can separate them. The bake removes it via the
   first principal axis of the vertex cloud, which collapses in-row z spread
   from 0.87 to 0.32 and makes rows resolve cleanly as 15/15/14/14/9.

To re-run it after swapping the source model:

```bash
python3 tools/bake-keyboard-glb.py path/to/source.glb assets/thock-keyboard.glb --report
```

`--report` prints the key count, the detected rows and where it thinks Esc is.
If the key count isn't close to 68, the classifier needs retuning before you
trust the output.

Model by Modelcore, via CGTrader, under their Royalty Free license.

## Migration

See [`MIGRATION.md`](MIGRATION.md) for what to redo when this theme moves to the
company store.
