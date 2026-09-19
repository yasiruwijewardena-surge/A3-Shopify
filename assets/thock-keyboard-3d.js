/**
 * THOCK — procedural 65% keyboard.
 *
 * The board is generated from a layout table rather than loaded from a .glb.
 * Three reasons, in order of how much they mattered:
 *
 *   1. Portability. A .glb has to live in Shopify Files, which means a
 *      hardcoded CDN URL that breaks the moment the theme moves to another
 *      store. Geometry built in JS moves with the theme.
 *   2. Weight. The whole board is ~900 triangles of description, not 8 MB.
 *   3. Colorways are material swaps driven by Shopify variants, which is
 *      trivial on generated meshes and fiddly on an imported scene graph.
 *
 * Exports a factory rather than a class so the caller owns the three.js
 * import and we never load it twice.
 */

/* Unit widths for a standard 65% (68 keys, 16u × 5 rows).
   `a` marks accent caps, `m` marks modifier caps — everything else is base. */
const LAYOUT = [
  [[1,'a'],[1],[1],[1],[1],[1],[1],[1],[1],[1],[1],[1],[1],[2,'m'],[1,'m']],
  [[1.5,'m'],[1],[1],[1],[1],[1],[1],[1],[1],[1],[1],[1],[1],[1.5,'m'],[1,'m']],
  [[1.75,'m'],[1],[1],[1],[1],[1],[1],[1],[1],[1],[1],[1],[2.25,'m'],[1,'m']],
  [[2.25,'m'],[1],[1],[1],[1],[1],[1],[1],[1],[1],[1],[1.75,'m'],[1,'m'],[1,'m']],
  [[1.25,'m'],[1.25,'m'],[1.25,'m'],[6.25],[1,'m'],[1,'m'],[1,'m'],[1,'m'],[1,'m'],[1,'m']],
];

const U = 1;            // one keycap unit
const GAP = 0.06;       // gap between caps
const ROW_H = 1;
const CAP_H = 0.42;     // keycap height
const CASE_PAD = 0.55;  // case overhang beyond the key field

/* Sculpted row profile — a real board steps and tilts row by row. Flat caps
   are the single clearest tell that a keyboard render is fake. */
const ROW_PROFILE = [
  { lift: 0.16, tilt: -0.14 },
  { lift: 0.06, tilt: -0.07 },
  { lift: 0.0, tilt: 0.0 },
  { lift: 0.04, tilt: 0.06 },
  { lift: 0.1, tilt: 0.11 },
];

export function createKeyboard(THREE, options = {}) {
  const quality = options.quality || 'high';
  const segments = quality === 'high' ? 3 : 1;

  const root = new THREE.Group();
  const keys = [];

  /* ------------------------------------------------------------------
   * Materials — three shared instances, so a colorway change is three
   * property writes rather than 68.
   * ---------------------------------------------------------------- */
  const caseMat = new THREE.MeshStandardMaterial({ color: 0x1c1f22, metalness: 0.9, roughness: 0.35 });
  const capBaseMat = new THREE.MeshStandardMaterial({ color: 0x2a2e33, metalness: 0.0, roughness: 0.62 });
  const capAccentMat = new THREE.MeshStandardMaterial({ color: 0xff5a1f, metalness: 0.0, roughness: 0.55 });
  const capModMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ec, metalness: 0.0, roughness: 0.62 });
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x0a0b0c, metalness: 0.4, roughness: 0.85 });

  const materials = { caseMat, capBaseMat, capAccentMat, capModMat, plateMat };

  /* ------------------------------------------------------------------
   * Geometry
   * ---------------------------------------------------------------- */

  /** Rounded-rectangle extrusion, tapered toward the top like a real keycap. */
  const capGeometryCache = new Map();

  function keycapGeometry(widthU) {
    const cached = capGeometryCache.get(widthU);
    if (cached) return cached;

    const w = widthU * U - GAP;
    const d = U - GAP;
    const r = 0.09;

    const shape = new THREE.Shape();
    const hw = w / 2 - r;
    const hd = d / 2 - r;
    shape.moveTo(-hw - r, -hd);
    shape.lineTo(-hw - r, hd);
    shape.quadraticCurveTo(-hw - r, hd + r, -hw, hd + r);
    shape.lineTo(hw, hd + r);
    shape.quadraticCurveTo(hw + r, hd + r, hw + r, hd);
    shape.lineTo(hw + r, -hd);
    shape.quadraticCurveTo(hw + r, -hd - r, hw, -hd - r);
    shape.lineTo(-hw, -hd - r);
    shape.quadraticCurveTo(-hw - r, -hd - r, -hw - r, -hd);

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: CAP_H,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.045,
      bevelSegments: segments,
      curveSegments: segments,
    });

    // Extrude builds along +Z; stand it up so +Y is height.
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, CAP_H / 2, 0);

    // Taper: squeeze vertices toward the centre in proportion to height, so
    // the cap narrows as it rises. This is what reads as "moulded".
    const pos = geo.attributes.position;
    const top = CAP_H / 2 + 0.05;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = Math.max(0, (y + CAP_H / 2) / CAP_H);
      const squeeze = 1 - 0.13 * t * t;
      pos.setX(i, pos.getX(i) * squeeze);
      pos.setZ(i, pos.getZ(i) * squeeze);
      if (y > top - 0.001) pos.setY(i, y - 0.012); // shallow dish on the top face
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    capGeometryCache.set(widthU, geo);
    return geo;
  }

  /** Simple rounded slab, used for the case and the plate. */
  function slabGeometry(w, h, d, r) {
    const shape = new THREE.Shape();
    const hw = w / 2 - r;
    const hd = d / 2 - r;
    shape.moveTo(-hw - r, -hd);
    shape.lineTo(-hw - r, hd);
    shape.quadraticCurveTo(-hw - r, hd + r, -hw, hd + r);
    shape.lineTo(hw, hd + r);
    shape.quadraticCurveTo(hw + r, hd + r, hw + r, hd);
    shape.lineTo(hw + r, -hd);
    shape.quadraticCurveTo(hw + r, -hd - r, hw, -hd - r);
    shape.lineTo(-hw, -hd - r);
    shape.quadraticCurveTo(-hw - r, -hd - r, -hw - r, -hd);

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: h,
      bevelEnabled: true,
      bevelThickness: 0.035,
      bevelSize: 0.035,
      bevelSegments: segments,
      curveSegments: segments,
    });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, h / 2, 0);
    geo.computeVertexNormals();
    return geo;
  }

  /* ------------------------------------------------------------------
   * Assembly
   * ---------------------------------------------------------------- */

  const rowWidths = LAYOUT.map((row) => row.reduce((sum, k) => sum + k[0], 0));
  const boardW = Math.max(...rowWidths) * U;
  const boardD = LAYOUT.length * ROW_H;

  const keyField = new THREE.Group();

  LAYOUT.forEach((row, rowIndex) => {
    const profile = ROW_PROFILE[rowIndex] || ROW_PROFILE[2];
    let x = -boardW / 2;

    row.forEach(([widthU, kind]) => {
      const mat = kind === 'a' ? capAccentMat : kind === 'm' ? capModMat : capBaseMat;
      const mesh = new THREE.Mesh(keycapGeometry(widthU), mat);

      mesh.position.set(
        x + (widthU * U) / 2,
        profile.lift,
        -boardD / 2 + rowIndex * ROW_H + ROW_H / 2
      );
      mesh.rotation.x = profile.tilt;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // Remember the rest pose so key-press and entrance animations have
      // something to return to.
      mesh.userData.restY = mesh.position.y;
      mesh.userData.row = rowIndex;

      keyField.add(mesh);
      keys.push(mesh);

      x += widthU * U;
    });
  });

  root.add(keyField);

  const plate = new THREE.Mesh(slabGeometry(boardW + 0.12, 0.12, boardD + 0.12, 0.1), plateMat);
  plate.position.y = -0.18;
  plate.receiveShadow = true;
  root.add(plate);

  const body = new THREE.Mesh(
    slabGeometry(boardW + CASE_PAD, 0.78, boardD + CASE_PAD, 0.22),
    caseMat
  );
  body.position.y = -0.58;
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);

  // A real 65% sits at a typing angle, not flat to camera.
  root.rotation.x = 0.06;

  /* ------------------------------------------------------------------
   * Public surface
   * ---------------------------------------------------------------- */

  function applyColorway(cw) {
    if (!cw) return;
    setColor(caseMat, cw.case);
    setColor(capBaseMat, cw.capBase);
    setColor(capAccentMat, cw.capAccent);
    setColor(capModMat, cw.capText);
    if (typeof cw.metalness === 'number') caseMat.metalness = cw.metalness;
    if (typeof cw.roughness === 'number') caseMat.roughness = cw.roughness;
  }

  /** Tween toward a colorway. `t` is 0..1; caller drives it per frame. */
  const tweenFrom = {};
  function beginColorwayTween() {
    tweenFrom.case = caseMat.color.clone();
    tweenFrom.capBase = capBaseMat.color.clone();
    tweenFrom.capAccent = capAccentMat.color.clone();
    tweenFrom.capMod = capModMat.color.clone();
    tweenFrom.metalness = caseMat.metalness;
    tweenFrom.roughness = caseMat.roughness;
  }

  function tweenColorway(cw, t) {
    if (!cw || !tweenFrom.case) return;
    caseMat.color.copy(tweenFrom.case).lerp(asColor(cw.case), t);
    capBaseMat.color.copy(tweenFrom.capBase).lerp(asColor(cw.capBase), t);
    capAccentMat.color.copy(tweenFrom.capAccent).lerp(asColor(cw.capAccent), t);
    capModMat.color.copy(tweenFrom.capMod).lerp(asColor(cw.capText), t);
    if (typeof cw.metalness === 'number') {
      caseMat.metalness = tweenFrom.metalness + (cw.metalness - tweenFrom.metalness) * t;
    }
    if (typeof cw.roughness === 'number') {
      caseMat.roughness = tweenFrom.roughness + (cw.roughness - tweenFrom.roughness) * t;
    }
  }

  const colorScratch = new THREE.Color();
  function asColor(hex) {
    return colorScratch.set(hex || '#888888');
  }
  function setColor(mat, hex) {
    if (hex) mat.color.set(hex);
  }

  function dispose() {
    capGeometryCache.forEach((g) => g.dispose());
    capGeometryCache.clear();
    [plate.geometry, body.geometry].forEach((g) => g.dispose());
    Object.values(materials).forEach((m) => m.dispose());
  }

  return {
    root,
    keys,
    keyField,
    materials,
    size: { width: boardW, depth: boardD },
    applyColorway,
    beginColorwayTween,
    tweenColorway,
    dispose,
  };
}

/**
 * Studio lighting without three.js `examples/` — we only vendored the core
 * build, so RoomEnvironment isn't available. A painted equirect gradient run
 * through PMREM gives convincing metal reflections for ~2 KB of code.
 */
export function createStudioEnvironment(THREE, renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  const sky = ctx.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#2a3038');
  sky.addColorStop(0.45, '#0e1013');
  sky.addColorStop(1, '#050607');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 512, 256);

  // Key light — the bright soft box the case highlights will rake across.
  paintBlob(ctx, 150, 46, 120, 70, 'rgba(255,255,255,0.95)');
  // Warm rim from behind right, so the silhouette separates from the bg.
  paintBlob(ctx, 400, 96, 90, 60, 'rgba(255,138,74,0.5)');
  // Cool fill from the left.
  paintBlob(ctx, 40, 120, 100, 80, 'rgba(120,170,255,0.3)');

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromEquirectangular(texture).texture;

  pmrem.dispose();
  texture.dispose();

  return envMap;
}

function paintBlob(ctx, x, y, rx, ry, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / Math.max(rx, ry));
  ctx.translate(-x, -y);
  ctx.fillStyle = g;
  ctx.fillRect(x - rx * 1.5, y - rx * 1.5, rx * 3, rx * 3);
  ctx.restore();
}

/** Soft radial contact shadow — far cheaper than a shadow map, and softer. */
export function createContactShadow(THREE, width, depth) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,0.62)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.26)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);

  const tex = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 1.5, depth * 2.4),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -1.02;
  return mesh;
}
