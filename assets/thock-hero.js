/**
 * THOCK — hero configurator controller.
 *
 * Two responsibilities, deliberately decoupled so that either can fail without
 * taking the other down:
 *
 *   A. Commerce. Radio inputs -> matching Shopify variant -> price, compare-at,
 *      availability, and the hidden [name=id] that Dawn's <product-form>
 *      submits. This is plain DOM work and always runs.
 *
 *   B. Presentation. A three.js board that reacts to the same selection.
 *      Loaded lazily, only when the hero is near the viewport and the device
 *      looks capable. If this never loads, A still sells the keyboard.
 *
 * The ordering matters: a shopper on a locked-down browser or a cheap phone
 * gets a working product page, not a blank hero.
 */
(function () {
  'use strict';

  var M = window.THOCK || {};
  var clamp = M.clamp || function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var damp = M.damp || function (c, t) { return t; };

  function init(root) {
    if (!root || root.dataset.thockHeroBound === 'true') return;
    root.dataset.thockHeroBound = 'true';

    var dataEl = root.querySelector('[data-thock-hero-data]');
    if (!dataEl) return;

    var data;
    try {
      data = JSON.parse(dataEl.textContent);
    } catch (err) {
      console.warn('[THOCK] hero data failed to parse', err);
      return;
    }

    trackChromeHeight(root);
    var commerce = initCommerce(root, data);
    initVisuals(root, data, commerce);
  }

  /**
   * A 100vh hero that starts below the header overflows the fold by exactly the
   * height of whatever sits above it. Dawn publishes --header-height, but that
   * misses the announcement bar, and both are merchant-toggleable. Measuring the
   * section's own offset covers every combination without guessing.
   *
   * getBoundingClientRect().top + scrollY is scroll-independent, and the hero's
   * position doesn't depend on its own height, so there's no feedback loop.
   */
  function trackChromeHeight(root) {
    function measure() {
      var top = root.getBoundingClientRect().top + window.scrollY;
      root.style.setProperty('--hero-chrome', Math.max(0, Math.round(top)) + 'px');
    }

    measure();
    window.addEventListener('resize', measure, { passive: true });

    // Web fonts and the sticky-header script both settle after first paint and
    // can change the header's height.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    window.addEventListener('load', measure, { once: true });
  }

  /* ======================================================================
   * A. Commerce
   * ==================================================================== */

  function initCommerce(root, data) {
    var priceEl = root.querySelector('[data-thock-price]');
    var compareEl = root.querySelector('[data-thock-compare]');
    var variantInput = root.querySelector('[data-thock-variant-id]');
    var addButton = root.querySelector('[name="add"]');
    var addLabel = root.querySelector('[data-thock-add-label]');
    var inputs = Array.prototype.slice.call(root.querySelectorAll('input[type="radio"][data-option-position]'));

    var colorwayIndex = data.optionNames.indexOf(data.colorwayOption);
    var listeners = [];

    function currentSelection() {
      // Option position is 1-based in Liquid; the variant options array is 0-based.
      var selected = [];
      inputs.forEach(function (input) {
        if (input.checked) selected[Number(input.dataset.optionPosition) - 1] = input.value;
      });
      return selected;
    }

    function findVariant(selection) {
      for (var i = 0; i < data.variants.length; i++) {
        var v = data.variants[i];
        var match = true;
        for (var j = 0; j < selection.length; j++) {
          if (selection[j] !== undefined && v.options[j] !== selection[j]) {
            match = false;
            break;
          }
        }
        if (match) return v;
      }
      return null;
    }

    function update() {
      var selection = currentSelection();
      var variant = findVariant(selection);

      // Keep each fieldset's legend echoing the live choice.
      root.querySelectorAll('[data-thock-option]').forEach(function (fieldset) {
        var checked = fieldset.querySelector('input:checked');
        var label = fieldset.querySelector('[data-thock-option-value]');
        if (checked && label) label.textContent = checked.value;
      });

      if (!variant) {
        setUnavailable();
      } else {
        if (priceEl) priceEl.textContent = variant.price;

        if (compareEl) {
          if (variant.compareAt) {
            compareEl.textContent = variant.compareAt;
            compareEl.hidden = false;
          } else {
            compareEl.hidden = true;
          }
        }

        if (variantInput) variantInput.value = variant.id;

        if (addButton) {
          addButton.disabled = !variant.available;
          addButton.removeAttribute('aria-disabled');
        }
        if (addLabel && !variant.available) addLabel.textContent = 'Sold out';
        if (addLabel && variant.available) {
          addLabel.textContent = addLabel.dataset.defaultLabel || addLabel.textContent;
        }

        // Reflect the selection in the URL so a configured board is shareable
        // and survives a refresh — cheap, and shoppers expect it.
        if (window.history && window.history.replaceState) {
          var url = new URL(window.location.href);
          url.searchParams.set('variant', variant.id);
          window.history.replaceState({}, '', url);
        }
      }

      var colorway = colorwayIndex >= 0 ? selection[colorwayIndex] : null;
      listeners.forEach(function (fn) {
        fn({ variant: variant, colorway: colorway, colorwayData: colorway ? data.colorways[colorway] : null });
      });
    }

    function setUnavailable() {
      if (addButton) addButton.disabled = true;
      if (addLabel) addLabel.textContent = 'Unavailable';
      if (compareEl) compareEl.hidden = true;
    }

    if (addLabel) addLabel.dataset.defaultLabel = addLabel.textContent.trim();

    inputs.forEach(function (input) {
      input.addEventListener('change', update);
    });

    update();

    return {
      onChange: function (fn) {
        listeners.push(fn);
        fn({
          variant: findVariant(currentSelection()),
          colorway: colorwayIndex >= 0 ? currentSelection()[colorwayIndex] : null,
          colorwayData: colorwayIndex >= 0 ? data.colorways[currentSelection()[colorwayIndex]] : null,
        });
      },
    };
  }

  /* ======================================================================
   * B. Presentation
   * ==================================================================== */

  /** Should this device get WebGL at all? */
  function shouldRender3D(quality) {
    if (quality === 'low') return false;
    if (quality === 'high') return hasWebGL();

    // auto
    if (navigator.deviceMemory && navigator.deviceMemory < 4) return false;
    if (navigator.connection && navigator.connection.saveData) return false;
    return hasWebGL();
  }

  var webglSupport = null;
  function hasWebGL() {
    if (webglSupport !== null) return webglSupport;
    try {
      var c = document.createElement('canvas');
      webglSupport = !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (err) {
      webglSupport = false;
    }
    return webglSupport;
  }

  function initVisuals(root, data, commerce) {
    var canvas = root.querySelector('[data-thock-hero-canvas]');
    var fallback = root.querySelector('[data-thock-hero-fallback]');
    if (!canvas) return;

    if (!shouldRender3D(root.dataset.quality)) {
      root.dataset.render3d = 'declined';
      return;
    }

    // Defer the ~190 KB three.js payload until the hero is actually near.
    var start = function () {
      start = function () {};
      boot(root, canvas, fallback, data, commerce);
    };

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(
        function (entries) {
          if (entries.some(function (e) { return e.isIntersecting; })) {
            io.disconnect();
            start();
          }
        },
        { rootMargin: '200px' }
      );
      io.observe(root);
    } else {
      start();
    }
  }

  function boot(root, canvas, fallback, data, commerce) {
    var threeUrl = root.dataset.threeUrl;
    var kbUrl = root.dataset.keyboardUrl;
    var loaderUrl = root.dataset.gltfLoaderUrl;
    var modelUrl = root.dataset.modelUrl;

    Promise.all([import(threeUrl), import(kbUrl)])
      .then(function (mods) {
        var THREE = mods[0];
        var KB = mods[1];

        // No model configured — go straight to the procedural board rather
        // than paying for a loader we won't use.
        if (!modelUrl || !loaderUrl) return { THREE: THREE, KB: KB, board: null };

        return import(loaderUrl)
          .then(function (loaderMod) {
            return KB.loadKeyboardModel(THREE, loaderMod.GLTFLoader, modelUrl);
          })
          .catch(function (err) {
            console.warn('[THOCK] GLTFLoader unavailable', err);
            return null;
          })
          .then(function (board) {
            return { THREE: THREE, KB: KB, board: board };
          });
      })
      .then(function (ctx) {
        var board = ctx.board;
        if (board) {
          root.dataset.boardSource = 'model';
        } else {
          // The procedural board is the safety net: a missing or malformed
          // .glb degrades to a working keyboard, not an empty hero.
          board = ctx.KB.createKeyboard(ctx.THREE, {});
          root.dataset.boardSource = 'procedural';
        }
        run(ctx.THREE, ctx.KB, board, root, canvas, fallback, data, commerce);
      })
      .catch(function (err) {
        // Network blocked, CSP, ancient browser — the DOM hero still works.
        console.warn('[THOCK] 3D hero unavailable, using fallback', err);
        root.dataset.render3d = 'failed';
      });
  }

  function run(THREE, KB, board, root, canvas, fallback, data, commerce) {
    var reduced = M.prefersReducedMotion ? M.prefersReducedMotion() : false;
    var lowPower = root.dataset.quality === 'low' || (navigator.deviceMemory && navigator.deviceMemory < 8);

    var renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: !lowPower,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.25 : 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.45;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    var scene = new THREE.Scene();
    scene.environment = KB.createStudioEnvironment(THREE, renderer);

    var camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);

    scene.add(board.root);

    var shadow = KB.createContactShadow(THREE, board.size.width, board.size.depth);
    shadow.position.y = -(board.size.height || 2) / 2 - 0.12;
    scene.add(shadow);

    // Environment does most of the work; one directional light adds the
    // specular streak across the case that sells "machined aluminium".
    var key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, 8, 5);
    scene.add(key);

    var rim = new THREE.DirectionalLight(0xff8a4a, 0.8);
    rim.position.set(-6, 3, -4);
    scene.add(rim);

    /* --- Layout ------------------------------------------------------- */

    function resize() {
      var rect = canvas.getBoundingClientRect();
      var w = Math.max(1, rect.width);
      var h = Math.max(1, rect.height);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();

      // Frame the board from its real dimensions rather than hardcoded camera
      // coordinates. A 16u-wide board at a fixed distance crops the moment the
      // viewport aspect changes, and every laptop has a different one.
      var portrait = camera.aspect < 1;
      var margin = portrait ? 1.15 : 1.45;
      var halfFov = (camera.fov * Math.PI) / 360;

      // Distance needed to fit the board's width, and to fit its depth once
      // foreshortened by the viewing angle. Take whichever is further.
      var elevation = portrait ? 0.72 : 0.58; // radians above the horizon
      var fitWidth = board.size.width * margin;
      var fitDepth = board.size.depth * margin * Math.sin(elevation);

      var distForWidth = fitWidth / camera.aspect / (2 * Math.tan(halfFov));
      var distForDepth = fitDepth / (2 * Math.tan(halfFov));
      var dist = Math.max(distForWidth, distForDepth);

      camera.position.set(0, Math.sin(elevation) * dist, Math.cos(elevation) * dist);

      // Aim below the board so it sits in the upper part of the frame, leaving
      // the lower third clear for the headline and the configurator panel.
      camera.lookAt(0, -dist * (portrait ? 0.06 : 0.16), 0);
      camera.updateProjectionMatrix();

      // setSize clears the drawing buffer. If the loop happens to be paused —
      // scrolled past, background tab — nothing would repaint it and the hero
      // would be left blank. Repaint immediately instead of relying on a frame.
      if (!destroyed) renderer.render(scene, camera);
    }

    var resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    /* --- Pointer parallax --------------------------------------------- */

    var pointer = { x: 0, y: 0 };
    var eased = { x: 0, y: 0 };

    if (!reduced) {
      root.addEventListener('pointermove', function (e) {
        var rect = root.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      }, { passive: true });

      root.addEventListener('pointerleave', function () {
        pointer.x = 0;
        pointer.y = 0;
      }, { passive: true });
    }

    /* --- Colorway tweening -------------------------------------------- */

    var pendingColorway = null;
    var tweenT = 1;

    commerce.onChange(function (state) {
      if (!state.colorwayData) return;
      if (pendingColorway === state.colorwayData) return;
      pendingColorway = state.colorwayData;
      board.beginColorwayTween();
      tweenT = 0;
    });

    // Apply the initial colorway with no animation.
    if (pendingColorway) {
      board.applyColorway(pendingColorway);
      tweenT = 1;
    }

    /* --- Entrance ------------------------------------------------------ */

    var entrance = reduced ? 1 : 0;

    /* --- Frame loop ---------------------------------------------------- */

    var visible = true;
    var running = true;
    var scheduled = false;
    // The baked model merges its caps into four primitives, so it has no
    // per-key meshes to stagger. Only the procedural board does.
    var keysSettled = reduced || !board.keys.length;
    var lastTime = performance.now();

    // Single entry point for scheduling. Without the `scheduled` guard, the
    // observer and the visibilitychange handler can each start a rAF chain and
    // the scene quietly renders twice per frame.
    function schedule() {
      if (scheduled || !running || !visible || document.hidden) return;
      scheduled = true;
      lastTime = performance.now();
      requestAnimationFrame(frame);
    }

    var visibilityObserver = new IntersectionObserver(
      function (entries) {
        visible = entries[0].isIntersecting;
        schedule();
      },
      { threshold: 0 }
    );
    visibilityObserver.observe(canvas);

    document.addEventListener('visibilitychange', schedule);

    function frame(now) {
      scheduled = false;
      if (!running) return;
      // Stop burning GPU when scrolled past or on a background tab.
      if (!visible || document.hidden) return;

      scheduled = true;
      requestAnimationFrame(frame);

      var dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      if (entrance < 1) entrance = Math.min(1, entrance + dt / 1.1);
      var e = easeOutCubic(entrance);

      if (tweenT < 1) {
        tweenT = Math.min(1, tweenT + dt / 0.55);
        board.tweenColorway(pendingColorway, easeOutCubic(tweenT));
      }

      eased.x = damp(eased.x, pointer.x, 0.002, dt);
      eased.y = damp(eased.y, pointer.y, 0.002, dt);

      var idle = reduced ? 0 : Math.sin(now / 2600) * 0.035;

      board.root.rotation.y = eased.x * 0.34 + idle + (1 - e) * 0.5;
      board.root.rotation.x = 0.06 + eased.y * 0.12 + (1 - e) * 0.22;
      board.root.position.y = (1 - e) * 1.6;

      // Keycaps rain in row by row on first paint. Runs one extra time after
      // `entrance` hits 1 so every cap lands exactly on its rest height —
      // gating on `entrance < 1` alone leaves the last frame's offset baked in.
      if (!keysSettled) {
        for (var i = 0; i < board.keys.length; i++) {
          var k = board.keys[i];
          var delay = k.userData.row * 0.07;
          var t = easeOutCubic(clamp((entrance - delay) / 0.55, 0, 1));
          k.position.y = k.userData.restY + (1 - t) * 1.4;
        }
        if (entrance >= 1) keysSettled = true;
      }

      renderer.render(scene, camera);
    }

    schedule();

    if (fallback) fallback.dataset.hidden = 'true';
    root.dataset.render3d = 'active';

    /* --- Teardown ------------------------------------------------------ */

    var destroyed = false;

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      running = false;
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      document.removeEventListener('shopify:section:unload', onSectionUnload);
      document.removeEventListener('visibilitychange', schedule);
      board.dispose();
      renderer.dispose();

      // Release the bind flag. The theme editor and the CLI's hot reload both
      // swap a section's inner HTML while keeping the outer element, so the
      // element that comes back still carries the flag. Without clearing it,
      // init() bails out, nothing restarts the render loop, and the canvas
      // goes blank at the next resize that clears the drawing buffer.
      delete root.dataset.thockHeroBound;
    }

    function onSectionUnload(event) {
      if (event.target.contains(root)) destroy();
    }

    // The theme editor tears sections down and rebuilds them; without this
    // every settings tweak leaks a WebGL context and Chrome kills the page
    // after about sixteen of them.
    document.addEventListener('shopify:section:unload', onSectionUnload);
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  /* ====================================================================== */

  function initAll(scope) {
    (scope || document).querySelectorAll('[data-thock-hero]').forEach(init);
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
