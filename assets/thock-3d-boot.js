/**
 * THOCK — 3D bundle entry point.
 *
 * Exists because Shopify's CDN rewrites dynamic `import(...)` into
 * `require(...)` when it minifies theme JavaScript — in classic scripts AND in
 * ES modules — and `require` doesn't exist in a browser. STATIC imports are
 * left alone, so all the module loading has to happen here, statically.
 *
 * Lazy loading is preserved by the caller: THOCK.load3D() injects this file as
 * a <script type="module"> only when a 3D section is near the viewport, so the
 * ~190 KB of three.js is still kept off the critical path.
 *
 * The specifiers below are relative on purpose. Shopify serves every theme
 * asset from one flat directory, so siblings resolve correctly.
 */

import * as THREE from './three.module.min.js';
import * as KB from './thock-keyboard-3d.js';
import { GLTFLoader } from './gltf-loader.js';

window.THOCK3D = { THREE: THREE, KB: KB, GLTFLoader: GLTFLoader };

document.dispatchEvent(new CustomEvent('thock:3d-ready'));
