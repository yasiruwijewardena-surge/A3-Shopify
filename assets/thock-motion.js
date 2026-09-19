/**
 * THOCK — shared motion primitives.
 *
 * Deliberately dependency-free. Two things every section on the landing page
 * needs, and nothing else:
 *
 *   1. reveal-on-scroll  — IntersectionObserver, one observer for the page
 *   2. scroll progress   — rAF-throttled 0..1 progress for a pinned element
 *
 * Exposed on window.THOCK so section scripts can reuse them without a bundler.
 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ----------------------------------------------------------------------
   * Reveal on scroll
   * -------------------------------------------------------------------- */

  var revealObserver = null;

  function ensureRevealObserver() {
    if (revealObserver || !('IntersectionObserver' in window)) return revealObserver;

    revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-revealed');
          // One-shot: revealing is not a toggle, and un-revealing on scroll-up
          // reads as a bug to everyone who isn't the developer.
          revealObserver.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.1 }
    );

    return revealObserver;
  }

  function initReveals(root) {
    var scope = root || document;
    var targets = scope.querySelectorAll('[data-reveal]:not([data-reveal-bound])');
    if (!targets.length) return;

    // Index children of stagger containers so CSS can derive per-item delay.
    scope.querySelectorAll('[data-reveal-stagger]').forEach(function (group) {
      Array.prototype.forEach.call(group.children, function (child, i) {
        child.style.setProperty('--reveal-i', String(i));
      });
    });

    // Only opt into the hidden-start state once we know we can reveal.
    // If IntersectionObserver is missing, content simply stays visible.
    var observer = ensureRevealObserver();

    document.querySelectorAll('.thock').forEach(function (section) {
      section.dataset.revealReady = observer ? 'true' : 'false';
    });

    targets.forEach(function (el) {
      el.setAttribute('data-reveal-bound', '');
      if (observer) {
        observer.observe(el);
      } else {
        el.classList.add('is-revealed');
      }
    });
  }

  /* ----------------------------------------------------------------------
   * Scroll progress for pinned sections
   *
   * Returns 0 while the element's top is below the viewport top, ramping to 1
   * as its scrollable overflow is consumed. Callback fires on a rAF tick, not
   * per scroll event, so it stays off the main-thread hot path.
   * -------------------------------------------------------------------- */

  function trackProgress(el, onProgress) {
    var ticking = false;
    var last = -1;

    function measure() {
      ticking = false;

      var rect = el.getBoundingClientRect();
      var scrollable = rect.height - window.innerHeight;

      var progress = scrollable <= 0 ? (rect.top <= 0 ? 1 : 0) : clamp(-rect.top / scrollable, 0, 1);

      // Skip sub-pixel churn; sections re-render on meaningful change only.
      if (Math.abs(progress - last) < 0.0005) return;
      last = progress;
      onProgress(progress);
    }

    function request() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(measure);
    }

    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request, { passive: true });
    measure();

    return function destroy() {
      window.removeEventListener('scroll', request);
      window.removeEventListener('resize', request);
    };
  }

  /* ----------------------------------------------------------------------
   * Small maths helpers shared by the 3D + canvas sections
   * -------------------------------------------------------------------- */

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /** Smooth 0..1 ramp between two thresholds — the workhorse of scroll choreography. */
  function smoothstep(edge0, edge1, x) {
    var t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  /** Frame-rate independent easing toward a target. */
  function damp(current, target, smoothing, dt) {
    return lerp(current, target, 1 - Math.pow(smoothing, dt));
  }

  /* ----------------------------------------------------------------------
   * Lazy 3D bundle loader
   *
   * Shopify's CDN rewrites dynamic import() to require() when minifying theme
   * JS, which throws ReferenceError on the published theme while working fine
   * under `shopify theme dev` (which serves raw files). Static imports survive,
   * so the imports live in thock-3d-boot.js and we lazy-load it by injecting a
   * module script instead — same deferral, no dynamic import.
   *
   * Shared by every 3D section so three.js is fetched, parsed and instantiated
   * exactly once no matter how many sections want it.
   * -------------------------------------------------------------------- */

  var boot3D = null;

  function load3D(url) {
    if (window.THOCK3D) return Promise.resolve(window.THOCK3D);
    if (boot3D) return boot3D;

    boot3D = new Promise(function (resolve, reject) {
      document.addEventListener(
        'thock:3d-ready',
        function () {
          resolve(window.THOCK3D);
        },
        { once: true }
      );

      var script = document.createElement('script');
      script.type = 'module';
      script.src = url;
      script.onerror = function () {
        reject(new Error('failed to load the 3D bundle: ' + url));
      };
      document.head.appendChild(script);
    });

    return boot3D;
  }

  window.THOCK = {
    initReveals: initReveals,
    trackProgress: trackProgress,
    load3D: load3D,
    clamp: clamp,
    lerp: lerp,
    smoothstep: smoothstep,
    damp: damp,
    prefersReducedMotion: function () {
      return reduceMotion.matches;
    },
  };

  document.addEventListener('DOMContentLoaded', function () {
    initReveals();
  });

  // Theme editor: sections are re-rendered in place, so re-bind on load.
  document.addEventListener('shopify:section:load', function (event) {
    initReveals(event.target);
  });
})();
