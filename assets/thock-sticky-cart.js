/**
 * THOCK — sticky add-to-cart bar.
 *
 * Appears once the hero has scrolled past, and follows whatever variant the
 * hero configurator currently has selected.
 *
 * It listens for the `thock:variant` event rather than reaching into the hero
 * section, so either section can be removed from the template without
 * breaking the other. If the hero isn't on the page at all, the bar falls back
 * to the ?variant= URL parameter and still works.
 */
(function () {
  'use strict';

  function init(root) {
    if (!root || root.dataset.thockStickyBound === 'true') return;
    root.dataset.thockStickyBound = 'true';

    var dataEl = root.querySelector('[data-thock-sticky-data]');
    if (!dataEl) return;

    var data;
    try {
      data = JSON.parse(dataEl.textContent);
    } catch (err) {
      console.warn('[THOCK] sticky cart data failed to parse', err);
      return;
    }

    var priceEl = root.querySelector('[data-thock-sticky-price]');
    var variantEl = root.querySelector('[data-thock-sticky-variant]');
    var idInput = root.querySelector('[data-thock-sticky-variant-id]');
    var button = root.querySelector('[name="add"]');
    var label = root.querySelector('[data-thock-sticky-label]');
    var defaultLabel = label ? label.textContent.trim() : 'Add to cart';

    function apply(variant) {
      if (!variant) return;
      if (priceEl) priceEl.textContent = variant.price;
      if (variantEl) variantEl.textContent = variant.title;
      if (idInput) idInput.value = variant.id;
      if (button) button.disabled = !variant.available;
      if (label) label.textContent = variant.available ? defaultLabel : 'Sold out';
    }

    function byId(id) {
      for (var i = 0; i < data.variants.length; i++) {
        if (String(data.variants[i].id) === String(id)) return data.variants[i];
      }
      return null;
    }

    // Follow the hero.
    document.addEventListener('thock:variant', function (event) {
      if (event.detail && event.detail.variant) apply(byId(event.detail.variant.id));
    });

    // No hero on the page — honour a variant in the URL instead.
    var fromUrl = new URL(window.location.href).searchParams.get('variant');
    if (fromUrl) apply(byId(fromUrl));

    /* --- Reveal ---------------------------------------------------------- */

    var threshold = (Number(root.dataset.revealAfter) || 80) / 100;
    var shown = false;

    function update() {
      var should = window.scrollY > window.innerHeight * threshold;
      if (should === shown) return;
      shown = should;

      root.hidden = !should;
      // aria-hidden as well as hidden: the bar is a duplicate of the hero's
      // controls, so it should not be reachable by screen reader or tab while
      // it's off-screen.
      root.setAttribute('aria-hidden', should ? 'false' : 'true');
      root.classList.toggle('is-visible', should);
    }

    var ticking = false;
    function onScroll() {
      if (ticking) return;

      // Browsers don't run rAF callbacks in a hidden tab, so a frame queued
      // there never fires — leaving `ticking` latched true and every later
      // scroll ignored, even after the tab comes back. Bypass the throttle
      // when there's no frame loop to throttle against.
      if (document.hidden) {
        update();
        return;
      }

      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        update();
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    // Scroll position can be restored while the tab is hidden; re-sync on
    // return so the bar doesn't come back in the wrong state.
    document.addEventListener('visibilitychange', function () {
      ticking = false;
      update();
    });

    update();
  }

  function initAll(scope) {
    (scope || document).querySelectorAll('[data-thock-sticky-cart]').forEach(init);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initAll(); });
  } else {
    initAll();
  }

  document.addEventListener('shopify:section:load', function (event) {
    initAll(event.target);
  });
})();
