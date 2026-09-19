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
| `assets/three.module.min.js` | three.js 0.186.0, vendored |

`three.module.min.js` ships from npm importing `./three.core.js` — the
*unminified* core. The vendored copy is patched to `./three.core.min.js` so the
relative resolve against Shopify's asset CDN picks up the minified build. Redo
that patch if you ever bump the three.js version.

## Migration

See [`MIGRATION.md`](MIGRATION.md) for what to redo when this theme moves to the
company store.
