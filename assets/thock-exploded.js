/**
 * THOCK — exploded build stack.
 *
 * Scroll through a tall section; a sticky viewport inside it holds a 3D board
 * that comes apart layer by layer, with the matching description opening in
 * the list beside it.
 *
 * The list is the content and the render is the illustration, not the other
 * way round. With no JavaScript, no WebGL, or reduced motion, the section
 * collapses to an ordinary readable spec list and loses nothing but the
 * animation — the CSS handles that via [data-render3d].
 */
(function () {
  'use strict';

  var M = window.THOCK || {};
  var clamp = M.clamp || function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var smoothstep =
    M.smoothstep ||
    function (a, b, x) {
      var t = clamp((x - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    };

  function init(root) {
    if (!root || root.dataset.thockExplodedBound === 'true') return;
    root.dataset.thockExplodedBound = 'true';

    var canvas = root.querySelector('[data-thock-exploded-canvas]');
    var items = Array.prototype.slice.call(root.querySelectorAll('[data-layer-key]'));
    if (!canvas || !items.length) return;

    if (M.prefersReducedMotion && M.prefersReducedMotion()) {
      // Static, fully separated, no scroll binding. The CSS already expands
      // every description; nothing here should re-collapse them.
      root.dataset.render3d = 'reduced';
      return;
    }

    if (!hasWebGL()) {
      root.dataset.render3d = 'declined';
      return;
    }

    whenNear(root, function () {
      boot(root, canvas, items);
    });
  }

  var webgl = null;
  function hasWebGL() {
    if (webgl !== null) return webgl;
    try {
      var c = document.createElement('canvas');
      webgl = !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (err) {
      webgl = false;
    }
    return webgl;
  }

  function whenNear(el, fn) {
    if (!('IntersectionObserver' in window)) return fn();
    var io = new IntersectionObserver(
      function (entries) {
        if (!entries.some(function (e) { return e.isIntersecting; })) return;
        io.disconnect();
        fn();
      },
      { rootMargin: '300px' }
    );
    io.observe(el);
  }

  function boot(root, canvas, items) {
    Promise.all([
      import(root.dataset.threeUrl),
      import(root.dataset.keyboardUrl),
      import(root.dataset.gltfLoaderUrl),
    ])
      .then(function (mods) {
        var THREE = mods[0];
        var KB = mods[1];
        return KB.loadExplodedStack(THREE, mods[2].GLTFLoader, root.dataset.modelUrl).then(
          function (stack) {
            if (!stack) throw new Error('stack unavailable');
            run(THREE, KB, stack, root, canvas, items);
          }
        );
      })
      .catch(function (err) {
        console.warn('[THOCK] exploded view unavailable, falling back to the list', err);
        root.dataset.render3d = 'failed';
      });
  }

  function run(THREE, KB, stack, root, canvas, items) {
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    var scene = new THREE.Scene();
    scene.environment = KB.createStudioEnvironment(THREE, renderer);
    scene.add(stack.root);

    var key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(5, 9, 6);
    scene.add(key);

    var rim = new THREE.DirectionalLight(0xff8a4a, 0.7);
    rim.position.set(-6, 2, -5);
    scene.add(rim);

    var camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);

    // Where the board sits horizontally. On desktop the copy occupies the left
    // third, so the board is pushed right to clear it.
    var offsetX = 0;

    function resize() {
      var rect = canvas.getBoundingClientRect();
      var w = Math.max(1, rect.width);
      var h = Math.max(1, rect.height);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;

      var wide = w >= 990;
      offsetX = wide ? stack.size.width * 0.26 : 0;

      // Fit for the fully-exploded height, not the assembled one — otherwise
      // the top layer climbs out of frame right when it matters.
      var explodedHeight = stack.size.height + 4.2;
      var halfFov = (camera.fov * Math.PI) / 360;
      var fitH = explodedHeight * 1.25;
      var fitW = stack.size.width * (wide ? 2.1 : 1.35);
      var dist = Math.max(
        fitH / (2 * Math.tan(halfFov)),
        fitW / camera.aspect / (2 * Math.tan(halfFov))
      );

      camera.position.set(offsetX * 0.35, dist * 0.34, dist);
      camera.lookAt(offsetX, 0, 0);
      camera.updateProjectionMatrix();

      stack.root.position.x = offsetX;
      renderer.render(scene, camera);
    }

    var resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    /* --- Scroll binding ------------------------------------------------ */

    var progress = 0;
    var eased = 0;
    var active = -1;

    var stopTracking = M.trackProgress(root, function (p) {
      progress = p;
      schedule();
    });

    function applyList(p) {
      // Which layer is "current" — the one whose separation window the scroll
      // is inside. Drives the description that's open.
      var index = clamp(Math.floor(p * items.length), 0, items.length - 1);
      if (index === active) return;
      active = index;
      items.forEach(function (item, i) {
        item.classList.toggle('is-active', i === index);
      });
    }

    /* --- Frame loop ----------------------------------------------------- */

    var visible = true;
    var running = true;
    var scheduled = false;

    function schedule() {
      if (scheduled || !running || !visible || document.hidden) return;
      scheduled = true;
      requestAnimationFrame(frame);
    }

    function frame() {
      scheduled = false;
      if (!running || !visible || document.hidden) return;

      // Ease toward the scroll position so a flicked scrollwheel doesn't snap
      // the stack apart in one frame.
      eased += (progress - eased) * 0.12;
      if (Math.abs(progress - eased) < 0.0004) eased = progress;

      stack.setProgress(eased, smoothstep);
      applyList(eased);

      // Drift the board as it opens, so the lower layers stay readable rather
      // than hiding behind the ones above them.
      stack.root.rotation.y = -0.35 + eased * 0.5;
      stack.root.rotation.x = 0.06 + eased * 0.16;

      renderer.render(scene, camera);

      if (eased !== progress) schedule();
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

    root.dataset.render3d = 'active';
    schedule();

    /* --- Teardown -------------------------------------------------------- */

    var destroyed = false;

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      running = false;
      if (stopTracking) stopTracking();
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      document.removeEventListener('visibilitychange', schedule);
      stack.dispose();
      renderer.dispose();
      delete root.dataset.thockExplodedBound;
    }

    function onUnload(event) {
      if (event.target.contains(root)) destroy();
    }

    document.addEventListener('shopify:section:unload', onUnload);
  }

  /* ====================================================================== */

  function initAll(scope) {
    (scope || document).querySelectorAll('[data-thock-exploded]').forEach(init);
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
