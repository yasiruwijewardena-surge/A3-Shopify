# Moving this theme to the company store

The theme is the source of truth and lives in this repo, so the move itself is
one command. What doesn't travel is listed below — this is the checklist, not a
warning.

```bash
shopify theme push --unpublished --store <company-store>.myshopify.com
```

## What travels automatically

- All section, snippet, layout and asset files
- `templates/index.json` — the landing page composition, including every
  colorway block and its settings
- `config/settings_data.json` — theme settings
- Anything in `assets/`, including the vendored three.js

## What does not travel, and what to do about it

### 1. Products

Section settings reference products by handle (`shopify://products/thock-model-65`).
The handle must exist on the destination store or the hero renders its
onboarding state.

**Do:** import `seed/products.csv` on the new store *before* pushing the theme.
Handles in the CSV match what `templates/index.json` references, so nothing
needs re-picking.

### 2. Variant option names

The hero maps swatches by option *name*, set in the section settings
(`Colorway`, `Switch`). If the destination store's product uses different option
names, update **Hero configurator → Variant mapping** — no code change needed.

### 3. Colorway values

Each colorway block matches a variant value by exact string (`Obsidian`,
`Milk Tea`, …). A renamed variant value silently stops matching: the swatch
still renders, the 3D board just won't change colour. If you rename variants,
update the block's **Variant option value** field to match.

### 4. The 3D model

**Nothing to do.** `assets/thock-keyboard.glb` lives in the theme's asset
folder, which Shopify accepts for `.glb`, so it moves with the theme like any
stylesheet. No Files upload, no URL to repaste.

This was worth verifying rather than assuming — the alternative (Content →
Files) would have meant a hardcoded `cdn.shopify.com/s/files/...` URL that
breaks the moment the source store is paused.

If you add **images**, the same rule applies: put them in `assets/` so they
travel. Files uploads do not.

### 5. Apps

None used, deliberately. App blocks disable themselves on a store where the app
isn't installed, which turns a clean port into a debugging session.

## After pushing

1. Preview the unpublished theme before publishing anything.
2. Check the hero: swatches change the 3D board, price updates, add-to-cart
   reaches the cart.
3. Run `shopify theme check` — it should report 0 errors.
4. Test with `prefers-reduced-motion` enabled and with JavaScript disabled.
