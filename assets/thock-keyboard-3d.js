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
 * Load the baked .glb and adapt it to the same interface `createKeyboard`
 * returns, so the hero never has to care which board it's driving.
 *
 * The model is pre-split by tools/bake-keyboard-glb.py into four primitives
 * with materials named case / cap_base / cap_mod / cap_accent — matching the
 * colorway block settings one-for-one. All this has to do is find them.
 *
 * Resolves to null rather than rejecting when the model is unusable, so the
 * caller can fall back to the procedural board on a plain falsy check.
 */
export function loadKeyboardModel(THREE, GLTFLoader, url) {
  return new Promise((resolve) => {
    new GLTFLoader().load(
      url,
      (gltf) => {
        try {
          resolve(adaptModel(THREE, gltf.scene));
        } catch (err) {
          console.warn('[THOCK] model loaded but could not be adapted', err);
          resolve(null);
        }
      },
      undefined,
      (err) => {
        console.warn('[THOCK] model failed to load', err);
        resolve(null);
      }
    );
  });
}

function adaptModel(THREE, scene) {
  const found = {};
  scene.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    if (node.material && node.material.name) found[node.material.name] = node.material;
  });

  const caseMat = found.case;
  const capBaseMat = found.cap_base;
  const capAccentMat = found.cap_accent;
  const capModMat = found.cap_mod;

  // Without separable materials the colorway system is meaningless, and a
  // silently-monochrome board is worse than the procedural one. Bail so the
  // caller falls back.
  if (!caseMat || !capBaseMat) {
    throw new Error('expected materials "case" and "cap_base" on the model');
  }

  const root = new THREE.Group();
  root.add(scene);

  // Legends are generated, because the source model ships with no textures.
  // Parented to the scene so they inherit the recentring below and stay
  // locked to the caps.
  const legends = createLegends(THREE, scene.userData && scene.userData.legends);
  if (legends) scene.add(legends);

  // The bake centres X/Z and rests the board on y=0; drop it so its middle is
  // on the origin, matching the procedural board's pivot.
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  scene.position.y -= center.y;

  root.rotation.x = 0.06;

  const materials = { caseMat, capBaseMat, capAccentMat, capModMat };
  const tweenFrom = {};
  const scratch = new THREE.Color();

  function asColor(hex) {
    return scratch.set(hex || '#888888');
  }

  function each(fn) {
    Object.keys(materials).forEach((k) => {
      if (materials[k]) fn(k, materials[k]);
    });
  }

  const colorKeyFor = {
    caseMat: 'case',
    capBaseMat: 'capBase',
    capAccentMat: 'capAccent',
    capModMat: 'capText',
  };

  return {
    root,
    // The bake merges all caps into four primitives, so there are no per-key
    // meshes to animate. The hero checks this before staggering an entrance.
    keys: [],
    keyField: scene,
    materials,
    size: { width: size.x, depth: size.z, height: size.y },

    applyColorway(cw) {
      if (!cw) return;
      each((key, mat) => {
        const hex = cw[colorKeyFor[key]];
        if (hex) mat.color.set(hex);
      });
      if (typeof cw.metalness === 'number') caseMat.metalness = cw.metalness;
      if (typeof cw.roughness === 'number') caseMat.roughness = cw.roughness;
      if (legends) legends.material.color.set(legendColorFor(cw.capBase));
    },

    beginColorwayTween() {
      each((key, mat) => {
        tweenFrom[key] = mat.color.clone();
      });
      tweenFrom.metalness = caseMat.metalness;
      tweenFrom.roughness = caseMat.roughness;
    },

    tweenColorway(cw, t) {
      if (!cw || !tweenFrom.caseMat) return;
      each((key, mat) => {
        const hex = cw[colorKeyFor[key]];
        if (hex && tweenFrom[key]) mat.color.copy(tweenFrom[key]).lerp(asColor(hex), t);
      });
      if (typeof cw.metalness === 'number') {
        caseMat.metalness = tweenFrom.metalness + (cw.metalness - tweenFrom.metalness) * t;
      }
      if (typeof cw.roughness === 'number') {
        caseMat.roughness = tweenFrom.roughness + (cw.roughness - tweenFrom.roughness) * t;
      }
      // Snap rather than tween: legend colour only ever flips between light
      // and dark, and a midpoint crossfade reads as the text washing out.
      if (legends && t > 0.5) legends.material.color.set(legendColorFor(cw.capBase));
    },

    dispose() {
      scene.traverse((node) => {
        if (node.isMesh) {
          node.geometry.dispose();
          if (node.material) node.material.dispose();
        }
      });
    },
  };
}

/* ==========================================================================
 * Keycap legends
 *
 * The source model has no textures, so the caps are blank. Positions and
 * labels come from the bake (carried in the glTF scene extras); this turns
 * them into a single mesh: one canvas atlas, one geometry, one draw call for
 * all 66 legends.
 * ========================================================================== */

const LEGEND_CELL = 128;

export function createLegends(THREE, legends) {
  if (!legends || !legends.length) return null;

  const labels = [];
  const slot = new Map();
  legends.forEach((l) => {
    if (!slot.has(l.label)) {
      slot.set(l.label, labels.length);
      labels.push(l.label);
    }
  });

  const cols = Math.ceil(Math.sqrt(labels.length));
  const rows = Math.ceil(labels.length / cols);

  const canvas = document.createElement('canvas');
  canvas.width = cols * LEGEND_CELL;
  canvas.height = rows * LEGEND_CELL;
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';

  labels.forEach((label, i) => {
    const cx = (i % cols) * LEGEND_CELL + LEGEND_CELL / 2;
    const cy = Math.floor(i / cols) * LEGEND_CELL + LEGEND_CELL / 2;

    // Fit the label to the cell. Single characters end up large, words like
    // "Shift" end up small — which is how real keycaps are printed.
    let size = label.length > 2 ? 46 : 74;
    ctx.font = `600 ${size}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
    const maxWidth = LEGEND_CELL * 0.78;
    const measured = ctx.measureText(label).width;
    if (measured > maxWidth) {
      size = Math.max(18, Math.floor((size * maxWidth) / measured));
      ctx.font = `600 ${size}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
    }
    ctx.fillText(label, cx, cy);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.flipY = false;

  const positions = [];
  const uvs = [];
  const normals = [];
  const indices = [];

  legends.forEach((l, n) => {
    const i = slot.get(l.label);
    const col = i % cols;
    const row = Math.floor(i / cols);

    // Quads track the cap's own footprint so wide modifiers get wide labels.
    const hw = Math.min(l.w * 0.44, 0.58);
    const hd = Math.min(l.d * 0.4, 0.34);
    const y = l.y + 0.012; // clear of the cap's dished top

    positions.push(
      l.x - hw, y, l.z - hd,
      l.x + hw, y, l.z - hd,
      l.x + hw, y, l.z + hd,
      l.x - hw, y, l.z + hd
    );

    // flipY is off, so v runs top-down with the canvas. -Z is away from the
    // camera, which is the top edge of the glyph.
    const u0 = col / cols;
    const u1 = (col + 1) / cols;
    const v0 = row / rows;
    const v1 = (row + 1) / rows;
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);

    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);

    const base = n * 4;
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color: 0x1a1d20,
    transparent: true,
    roughness: 0.75,
    metalness: 0,
    // Legends sit a hair above the cap; offset stops them z-fighting when the
    // camera is near-parallel to the board.
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  mesh.userData.isLegends = true;
  return mesh;
}

/** Legends have to contrast with whatever the caps just became. */
export function legendColorFor(hex) {
  const c = String(hex || '#2a2e33').replace('#', '');
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? '#1a1d20' : '#efeae1';
}

/* ==========================================================================
 * Exploded build stack
 *
 * The baked model supplies the three layers that are genuinely modelled —
 * keycaps, switches, case. The plate, foam and PCB between them are generated
 * slabs: they're flat rectangles in real life, so generated geometry is
 * indistinguishable from modelled geometry there, and it saves needing a
 * differently-built source model.
 * ========================================================================== */

/** Order matters: index drives the separation stagger, top of the board first. */
const STACK = [
  { key: 'keycaps', materials: ['cap_base', 'cap_mod', 'cap_accent'], lift: 3.4 },
  { key: 'switches', materials: ['switches'], lift: 2.3 },
  { key: 'plate', generated: true, thickness: 0.09, color: 0x9aa3ab, metalness: 0.85, roughness: 0.35, lift: 1.5 },
  { key: 'foam', generated: true, thickness: 0.14, color: 0x2b2118, metalness: 0.0, roughness: 0.95, lift: 0.85 },
  { key: 'pcb', generated: true, thickness: 0.07, color: 0x14432c, metalness: 0.25, roughness: 0.6, lift: 0.3 },
  { key: 'case', materials: ['case'], lift: -0.6 },
];

export function loadExplodedStack(THREE, GLTFLoader, url) {
  return new Promise((resolve) => {
    new GLTFLoader().load(
      url,
      (gltf) => {
        try {
          resolve(buildStack(THREE, gltf.scene));
        } catch (err) {
          console.warn('[THOCK] exploded stack could not be built', err);
          resolve(null);
        }
      },
      undefined,
      (err) => {
        console.warn('[THOCK] exploded stack model failed to load', err);
        resolve(null);
      }
    );
  });
}

function buildStack(THREE, scene) {
  const byMaterial = {};
  scene.traverse((node) => {
    if (node.isMesh && node.material && node.material.name) {
      (byMaterial[node.material.name] = byMaterial[node.material.name] || []).push(node);
    }
  });

  if (!byMaterial.case || !byMaterial.cap_base) {
    throw new Error('model is missing the case / cap_base materials');
  }

  const root = new THREE.Group();
  root.add(scene);

  const whole = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  whole.getSize(size);
  whole.getCenter(center);
  scene.position.y -= center.y;

  // Where the generated slabs live: stacked below the switches, inside the
  // case, so they're hidden when assembled and emerge as it separates.
  const caseBox = boxOf(THREE, byMaterial.case);
  const switchBox = byMaterial.switches ? boxOf(THREE, byMaterial.switches) : caseBox;
  let slabY = switchBox.min.y - center.y - 0.08;

  const layers = [];

  STACK.forEach((spec, index) => {
    let group;

    if (spec.generated) {
      group = new THREE.Group();
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x * 0.93, spec.thickness, size.z * 0.88),
        new THREE.MeshStandardMaterial({
          color: spec.color,
          metalness: spec.metalness,
          roughness: spec.roughness,
        })
      );
      mesh.position.y = slabY;
      slabY -= spec.thickness + 0.05;
      group.add(mesh);
      root.add(group);
    } else {
      // Reparent the model's own meshes so each layer can be moved on its own.
      group = new THREE.Group();
      spec.materials.forEach((name) => {
        (byMaterial[name] || []).forEach((mesh) => group.attach(mesh));
      });
      if (!group.children.length) return;

      // Legends belong to the keycaps, so they have to travel with that layer
      // rather than staying behind on the case.
      if (spec.key === 'keycaps') {
        const legends = createLegends(THREE, scene.userData && scene.userData.legends);
        if (legends) {
          legends.position.y -= center.y;
          group.add(legends);
        }
      }

      root.add(group);
    }

    layers.push({ key: spec.key, index, group, lift: spec.lift, restY: group.position.y });
  });

  root.rotation.x = 0.06;

  return {
    root,
    layers,
    size: { width: size.x, depth: size.z, height: size.y },

    /**
     * `progress` 0..1 drives the whole stack. Each layer gets a staggered
     * window so they peel apart in order rather than all at once, which is
     * what makes it read as disassembly rather than a scale transform.
     */
    setProgress(progress, smoothstep) {
      const count = layers.length;
      layers.forEach((layer) => {
        const start = (layer.index / count) * 0.55;
        const t = smoothstep(start, start + 0.45, progress);
        layer.group.position.y = layer.restY + layer.lift * t;
        layer.t = t;
      });
    },

    dispose() {
      root.traverse((node) => {
        if (!node.isMesh) return;
        node.geometry.dispose();
        if (node.material) node.material.dispose();
      });
    },
  };
}

function boxOf(THREE, meshes) {
  const box = new THREE.Box3();
  meshes.forEach((mesh) => box.expandByObject(mesh));
  return box;
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
  sky.addColorStop(0, '#5a6675');
  sky.addColorStop(0.45, '#242a31');
  sky.addColorStop(1, '#0a0c0e');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 512, 256);

  // Key light — the bright soft box the case highlights will rake across.
  paintBlob(ctx, 150, 46, 130, 78, 'rgba(255,255,255,1)');
  // Warm rim from behind right, so the silhouette separates from the bg.
  paintBlob(ctx, 400, 92, 100, 66, 'rgba(255,150,90,0.85)');
  // Cool fill from the left, which is what keeps a near-black case from
  // collapsing into the background — reflected light, not raised albedo.
  paintBlob(ctx, 40, 116, 110, 88, 'rgba(150,190,255,0.6)');

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
