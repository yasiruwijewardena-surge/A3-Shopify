/**
 * THOCK — switch comparison lab.
 *
 * Draws a force-versus-travel curve for each switch, morphs between them on
 * selection, and traces a keypress along the active curve.
 *
 * The curves are GENERATED FROM THE SPEC NUMBERS, not drawn by hand. A merchant
 * changing "actuation force" from 45g to 60g in the theme editor redraws the
 * graph correctly. Hand-authored paths would have meant the chart silently
 * disagreeing with the numbers printed beside it the first time anyone edited
 * a switch — which is worse than having no chart.
 */
(function () {
  'use strict';

  var M = window.THOCK || {};
  var clamp = M.clamp || function (v, a, b) { return v < a ? a : v > b ? b : v; };

  /* Chart geometry, in the SVG's own 520x360 viewBox units. */
  var PAD = { top: 26, right: 26, bottom: 44, left: 52 };
  var W = 520;
  var H = 360;
  var PLOT_W = W - PAD.left - PAD.right;
  var PLOT_H = H - PAD.top - PAD.bottom;
  var SAMPLES = 64;

  /* Fixed force ceiling so the three curves stay visually comparable — a
     per-switch y-scale would make a 45g switch look identical to a 70g one. */
  var FORCE_MAX = 90;

  function init(root) {
    if (!root || root.dataset.thockSwitchesBound === 'true') return;
    root.dataset.thockSwitchesBound = 'true';

    var dataEl = root.querySelector('[data-thock-switches-data]');
    if (!dataEl) return;

    var data;
    try {
      data = JSON.parse(dataEl.textContent);
    } catch (err) {
      console.warn('[THOCK] switch data failed to parse', err);
      return;
    }
    if (!data.switches || !data.switches.length) return;

    var reduced = M.prefersReducedMotion ? M.prefersReducedMotion() : false;

    var el = {
      curve: root.querySelector('[data-thock-curve]'),
      fill: root.querySelector('[data-thock-curve-fill]'),
      grid: root.querySelector('[data-thock-chart-grid]'),
      travelTicks: root.querySelector('[data-thock-travel-ticks]'),
      desc: root.querySelector('[data-thock-chart-desc]'),
      actLine: root.querySelector('[data-thock-actuation-line]'),
      actDot: root.querySelector('[data-thock-actuation-dot]'),
      actText: root.querySelector('[data-thock-actuation-text]'),
      travelDot: root.querySelector('[data-thock-travel-dot]'),
      title: root.querySelector('[data-thock-switch-title]'),
      description: root.querySelector('[data-thock-switch-desc]'),
      specs: root.querySelector('[data-thock-switch-specs]'),
      cta: root.querySelector('[data-thock-switch-cta]'),
      ctaLabel: root.querySelector('[data-thock-switch-cta-label]'),
    };
    if (!el.curve) return;

    drawGrid(el.grid);

    var inputs = Array.prototype.slice.call(root.querySelectorAll('input[data-switch-index]'));
    var current = samplePoints(data.switches[0]);
    var target = current;
    var activeSpec = data.switches[0];
    var morph = 1;
    var press = reduced ? 1 : 0;
    var raf = null;

    function select(index) {
      var spec = data.switches[index];
      if (!spec || spec === activeSpec) return;

      activeSpec = spec;
      target = samplePoints(spec);

      // The tween is decoration; correctness must not depend on it. rAF is
      // frozen in a background tab, so without this the chart would keep
      // drawing the previous switch's curve while the specs beside it
      // described the new one — a chart that contradicts its own labels.
      if (reduced || document.hidden) {
        morph = 1;
        current = target;
      } else {
        morph = 0;
      }
      press = reduced ? 1 : 0;

      applyText(spec);
      root.style.setProperty('--switch-accent', spec.accent || '#ff5a1f');
      render();
      tick();
    }

    function applyText(spec) {
      if (el.title) el.title.textContent = spec.title;
      if (el.description) el.description.textContent = spec.description || '';

      drawTravelTicks(el.travelTicks, spec.totalTravel);

      setSpec('actuation', spec.actuation + 'g');
      setSpec('bottomOut', spec.bottomOut + 'g');
      setSpec('preTravel', spec.preTravel.toFixed(1) + 'mm');
      setSpec('totalTravel', spec.totalTravel.toFixed(1) + 'mm');

      if (el.cta) {
        if (spec.url) {
          el.cta.href = spec.url;
          el.cta.hidden = false;
          if (el.ctaLabel) {
            el.ctaLabel.textContent = spec.price ? 'Shop ' + spec.label + ' — ' + spec.price : 'Shop ' + spec.label;
          }
        } else {
          el.cta.hidden = true;
        }
      }

      if (el.desc) {
        // Regenerated per switch so the chart is never an unlabelled graphic.
        el.desc.textContent =
          spec.title + ': ' + describeProfile(spec.profile) + ' Actuates at ' +
          spec.actuation + ' grams after ' + spec.preTravel.toFixed(1) +
          ' millimetres, bottoming out at ' + spec.bottomOut + ' grams and ' +
          spec.totalTravel.toFixed(1) + ' millimetres.';
      }
    }

    function setSpec(key, value) {
      if (!el.specs) return;
      var node = el.specs.querySelector('[data-spec="' + key + '"]');
      if (node) node.textContent = value;
    }

    /* --- Render ------------------------------------------------------- */

    function render() {
      var pts = morph >= 1 ? target : lerpPoints(current, target, ease(morph));

      el.curve.setAttribute('d', pathFrom(pts));
      if (el.fill) {
        el.fill.setAttribute(
          'd',
          pathFrom(pts) + ' L ' + x(1) + ' ' + y(0) + ' L ' + x(0) + ' ' + y(0) + ' Z'
        );
      }

      // Actuation marker sits where pre-travel meets actuation force.
      var at = activeSpec.preTravel / activeSpec.totalTravel;
      var ax = x(clamp(at, 0, 1));
      var ay = y(activeSpec.actuation / FORCE_MAX);

      if (el.actLine) {
        el.actLine.setAttribute('x1', ax);
        el.actLine.setAttribute('x2', ax);
        el.actLine.setAttribute('y1', ay);
        el.actLine.setAttribute('y2', y(0));
      }
      if (el.actDot) {
        el.actDot.setAttribute('cx', ax);
        el.actDot.setAttribute('cy', ay);
      }
      if (el.actText) {
        el.actText.setAttribute('x', ax);
        el.actText.setAttribute('y', ay - 14);
        el.actText.setAttribute('text-anchor', ax > W - 120 ? 'end' : 'middle');
        el.actText.textContent = 'Actuates · ' + activeSpec.actuation + 'g';
      }

      // The travelling dot traces a full keypress along the curve.
      if (el.travelDot) {
        var t = clamp(press, 0, 1);
        var i = Math.min(pts.length - 1, Math.round(t * (pts.length - 1)));
        el.travelDot.setAttribute('cx', x(pts[i][0]));
        el.travelDot.setAttribute('cy', y(pts[i][1]));
        el.travelDot.setAttribute('opacity', reduced ? 0 : 1);
      }
    }

    function tick() {
      if (raf) return;
      raf = requestAnimationFrame(function step() {
        raf = null;
        var moving = false;

        if (morph < 1) {
          morph = Math.min(1, morph + 0.045);
          if (morph >= 1) current = target;
          moving = true;
        }

        if (!reduced && press < 1) {
          press = Math.min(1, press + 0.018);
          moving = true;
        }

        render();
        if (moving) tick();
      });
    }

    inputs.forEach(function (input) {
      input.addEventListener('change', function () {
        select(Number(input.dataset.switchIndex));
      });
    });

    // Resume a tween that was interrupted by the tab going to the background.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) tick();
    });

    // Replay the press trace when the section scrolls into view.
    if (!reduced && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            press = 0;
            tick();
          });
        },
        { threshold: 0.35 }
      );
      io.observe(root);
    }

    applyText(activeSpec);
    root.style.setProperty('--switch-accent', activeSpec.accent || '#ff5a1f');
    render();
    tick();
  }

  /* ======================================================================
   * Curve generation
   * ==================================================================== */

  /**
   * Control points for one switch, as [travel 0..1, force 0..1].
   *
   * Linear rises evenly. Tactile rises to a bump, drops away, then climbs to
   * bottom-out. Clicky is the same shape with a sharper peak and a deeper
   * collapse — which is exactly what the click bar does.
   */
  function controlPoints(spec) {
    var pre = 18 / FORCE_MAX; // spring preload: force at the very top of travel
    var bo = spec.bottomOut / FORCE_MAX;
    var act = spec.actuation / FORCE_MAX;

    // Every profile passes exactly through (pre-travel, actuation force).
    // That isn't cosmetic: actuation force IS the force at actuation depth, so
    // a curve that misses it contradicts the spec printed beside it — and the
    // actuation marker visibly floats off the line.
    var actAt = clamp(spec.preTravel / spec.totalTravel, 0.15, 0.8);

    if (spec.profile === 'linear') {
      return [
        [0, pre],
        [actAt * 0.5, pre + (act - pre) * 0.46],
        [actAt, act],
        [actAt + (1 - actAt) * 0.55, act + (bo - act) * 0.6],
        [1, bo],
      ];
    }

    // On a tactile switch the bump peaks slightly BEFORE actuation, then
    // collapses — the collapse is what you feel, and the switch registers at
    // the bottom of it.
    var peak = Math.max(spec.peak, spec.actuation) / FORCE_MAX;
    var sharp = spec.profile === 'clicky';
    var peakAt = Math.max(actAt * 0.45, actAt - (sharp ? 0.06 : 0.1));

    return [
      [0, pre],
      [peakAt * 0.5, pre + (peak - pre) * 0.5],
      [peakAt, peak],
      [actAt, act],
      [Math.min(0.93, actAt + 0.3), act + (bo - act) * 0.55],
      [1, bo],
    ];
  }

  /** Resample the control points to a fixed-length array so two switches can
      be interpolated point-for-point regardless of their control counts. */
  function samplePoints(spec) {
    var ctrl = controlPoints(spec);
    var out = [];
    for (var i = 0; i < SAMPLES; i++) {
      var t = i / (SAMPLES - 1);
      out.push([t, catmullRomAt(ctrl, t)]);
    }
    return out;
  }

  /** Force at travel `t`, interpolated smoothly through the control points. */
  function catmullRomAt(ctrl, t) {
    if (t <= ctrl[0][0]) return ctrl[0][1];
    if (t >= ctrl[ctrl.length - 1][0]) return ctrl[ctrl.length - 1][1];

    var i = 0;
    while (i < ctrl.length - 2 && ctrl[i + 1][0] < t) i++;

    var p0 = ctrl[Math.max(0, i - 1)];
    var p1 = ctrl[i];
    var p2 = ctrl[i + 1];
    var p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];

    var span = p2[0] - p1[0] || 1e-6;
    var u = (t - p1[0]) / span;
    var u2 = u * u;
    var u3 = u2 * u;

    return (
      0.5 *
      (2 * p1[1] +
        (-p0[1] + p2[1]) * u +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3)
    );
  }

  function lerpPoints(a, b, t) {
    var out = [];
    for (var i = 0; i < b.length; i++) {
      var from = a[i] || b[i];
      out.push([from[0] + (b[i][0] - from[0]) * t, from[1] + (b[i][1] - from[1]) * t]);
    }
    return out;
  }

  function pathFrom(points) {
    var d = 'M ' + x(points[0][0]) + ' ' + y(points[0][1]);
    for (var i = 1; i < points.length; i++) {
      d += ' L ' + x(points[i][0]).toFixed(2) + ' ' + y(points[i][1]).toFixed(2);
    }
    return d;
  }

  function x(t) {
    return PAD.left + t * PLOT_W;
  }

  function y(v) {
    return PAD.top + (1 - clamp(v, 0, 1)) * PLOT_H;
  }

  /** Force axis and horizontal rules. Fixed, because FORCE_MAX is fixed. */
  function drawGrid(group) {
    if (!group) return;
    var html = '';

    for (var g = 0; g <= 4; g++) {
      var gy = PAD.top + (g / 4) * PLOT_H;
      html +=
        '<line x1="' + PAD.left + '" x2="' + (W - PAD.right) + '" y1="' + gy + '" y2="' + gy + '"/>';
      html +=
        '<text class="thock-switches__tick" x="' + (PAD.left - 10) + '" y="' + (gy + 4) +
        '" text-anchor="end">' + Math.round(FORCE_MAX - (g / 4) * FORCE_MAX) + '</text>';
    }

    group.innerHTML = html;
  }

  /**
   * Travel axis. Redrawn per switch: the curve is normalised across each
   * switch's own total travel, so a fixed 0-4mm scale would mislabel a 3.4mm
   * switch — the chart would disagree with the spec printed beside it.
   */
  function drawTravelTicks(group, totalTravel) {
    if (!group) return;
    var html = '';
    for (var c = 0; c <= 4; c++) {
      var gx = PAD.left + (c / 4) * PLOT_W;
      html +=
        '<text class="thock-switches__tick" x="' + gx + '" y="' + (H - PAD.bottom + 20) +
        '" text-anchor="middle">' + ((c / 4) * totalTravel).toFixed(1) + '</text>';
    }
    group.innerHTML = html;
  }

  function describeProfile(profile) {
    if (profile === 'tactile') return 'force rises to a rounded bump, drops away, then climbs to bottom-out.';
    if (profile === 'clicky') return 'force rises to a sharp peak, collapses, then climbs to bottom-out.';
    return 'force rises evenly from the top of the stroke to the bottom, with no bump.';
  }

  function ease(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  /* ====================================================================== */

  function initAll(scope) {
    (scope || document).querySelectorAll('[data-thock-switches]').forEach(init);
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
