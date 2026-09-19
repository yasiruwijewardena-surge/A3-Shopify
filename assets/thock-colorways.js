/**
 * THOCK — colorway rail.
 *
 * Two jobs: scroll buttons for the rail, and keeping the active card in sync
 * with whatever the hero configurator has selected.
 *
 * The cards are ordinary links to ?variant=, so the rail works with no
 * JavaScript at all — this only adds the convenience layer on top.
 */
(function () {
  'use strict';

  function init(root) {
    if (!root || root.dataset.thockColorwaysBound === 'true') return;
    root.dataset.thockColorwaysBound = 'true';

    var rail = root.querySelector('[data-thock-rail]');
    var cards = Array.prototype.slice.call(root.querySelectorAll('[data-thock-colorway]'));
    if (!rail || !cards.length) return;

    /* --- Sync with the hero --------------------------------------------- */

    function markActive(colorway) {
      cards.forEach(function (card) {
        var active = card.dataset.colorway === colorway;
        card.classList.toggle('is-active', active);
        // Communicates the current selection to assistive tech, not just colour.
        if (active) {
          card.setAttribute('aria-current', 'true');
        } else {
          card.removeAttribute('aria-current');
        }
      });
    }

    document.addEventListener('thock:variant', function (event) {
      if (event.detail && event.detail.colorway) markActive(event.detail.colorway);
    });

    /* --- Scroll buttons -------------------------------------------------- */

    var prev = root.querySelector('[data-rail-prev]');
    var next = root.querySelector('[data-rail-next]');

    function step(direction) {
      // Scroll by one card plus its gap, so cards land on the snap points.
      var card = cards[0].parentElement;
      var amount = card ? card.getBoundingClientRect().width + 16 : rail.clientWidth * 0.8;
      rail.scrollBy({ left: amount * direction, behavior: prefersReduced() ? 'auto' : 'smooth' });
    }

    if (prev) prev.addEventListener('click', function () { step(-1); });
    if (next) next.addEventListener('click', function () { step(1); });

    function updateButtons() {
      if (!prev || !next) return;
      var max = rail.scrollWidth - rail.clientWidth - 1;
      prev.disabled = rail.scrollLeft <= 0;
      next.disabled = rail.scrollLeft >= max;
    }

    rail.addEventListener('scroll', updateButtons, { passive: true });
    window.addEventListener('resize', updateButtons, { passive: true });
    updateButtons();
  }

  function prefersReduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function initAll(scope) {
    (scope || document).querySelectorAll('[data-thock-colorways]').forEach(init);
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
