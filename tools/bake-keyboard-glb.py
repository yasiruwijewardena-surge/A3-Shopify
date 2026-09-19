#!/usr/bin/env python3
"""
Bake a merged keyboard .glb into a clean, multi-material model.

The source model (CGTrader #6220946, exported to glTF by CGTrader's converter)
arrives as a single 52k-triangle mesh with one flat grey material and no
textures. The hero's colorway system needs the case, the alphanumeric keycaps,
the modifier keycaps and the Esc accent to be independently tintable, so the
geometry has to be split.

That split happens HERE, once, offline — not in the browser. The published
theme loads an ordinary well-formed .glb; none of the classification below
ships to visitors.

The mesh is separated into connected components, each component is classified
by its height and footprint, and the result is written out as four primitives
with named materials matching the section's colorway block settings.

Also normalises the model: bakes the node transform, centres it on the origin,
and scales it so the board is 16 units wide — the same coordinate space the
procedural fallback uses, so the camera framing code needs no special-casing.

Usage:
    python3 tools/bake-keyboard-glb.py <source.glb> <output.glb> [--report]
"""

import json
import math
import struct
import sys
from collections import Counter, defaultdict

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942

COMPONENT_TYPES = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2),
                   5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
TYPE_COUNTS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

# Target width in world units. Matches the procedural board so the two are
# interchangeable from the camera's point of view.
TARGET_WIDTH = 16.0

# A keycap is "wide" — i.e. a modifier — above this many key units. Set below
# 1.25u so Ctrl/Win/Alt count as modifiers alongside Shift, Enter and space.
MODIFIER_WIDTH_UNITS = 1.15

# Minimum triangles for a component to be a moulded keycap rather than a switch
# stem. The two are indistinguishable by footprint; they differ 10x in density.
MIN_KEYCAP_TRIS = 150


# ----------------------------------------------------------------------------
# GLB reading
# ----------------------------------------------------------------------------

def read_glb(path):
    data = open(path, 'rb').read()
    magic, _, length = struct.unpack('<III', data[:12])
    if magic != GLB_MAGIC:
        raise SystemExit(f'{path} is not a GLB file')

    gltf, buf, off = None, b'', 12
    while off < length:
        clen, ctype = struct.unpack('<II', data[off:off + 8])
        chunk = data[off + 8:off + 8 + clen]
        if ctype == CHUNK_JSON:
            gltf = json.loads(chunk)
        elif ctype == CHUNK_BIN:
            buf = chunk
        off += 8 + clen + (-clen % 4)
    return gltf, buf


def read_accessor(gltf, buf, index):
    acc = gltf['accessors'][index]
    view = gltf['bufferViews'][acc['bufferView']]
    fmt, size = COMPONENT_TYPES[acc['componentType']]
    n = TYPE_COUNTS[acc['type']]
    start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = view.get('byteStride') or size * n
    return [struct.unpack_from('<' + fmt * n, buf, start + i * stride)
            for i in range(acc['count'])]


# ----------------------------------------------------------------------------
# Transform
# ----------------------------------------------------------------------------

def quat_to_matrix(q):
    x, y, z, w = q
    return [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]


def apply_matrix(m, v):
    return (m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
            m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
            m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2])


# ----------------------------------------------------------------------------
# Connected components
# ----------------------------------------------------------------------------

def connected_components(positions, triangles):
    """Group triangles into surface islands, welding coincident vertices first
    so that duplicated seam vertices don't split an island in two."""
    welded, representative = {}, [0] * len(positions)
    for i, p in enumerate(positions):
        key = (round(p[0], 5), round(p[1], 5), round(p[2], 5))
        welded.setdefault(key, i)
        representative[i] = welded[key]

    parent = list(range(len(positions)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for a, b, c in triangles:
        union(representative[a], representative[b])
        union(representative[b], representative[c])

    groups = defaultdict(list)
    for ti, (a, b, c) in enumerate(triangles):
        groups[find(representative[a])].append(ti)
    return list(groups.values())


def component_bounds(positions, triangles, tri_indices):
    verts = set()
    for ti in tri_indices:
        verts.update(triangles[ti])
    xs = [positions[v][0] for v in verts]
    ys = [positions[v][1] for v in verts]
    zs = [positions[v][2] for v in verts]
    return {
        'tris': tri_indices,
        'xmin': min(xs), 'xmax': max(xs),
        'ymin': min(ys), 'ymax': max(ys),
        'zmin': min(zs), 'zmax': max(zs),
        'cx': (min(xs) + max(xs)) / 2,
        'cz': (min(zs) + max(zs)) / 2,
        'w': max(xs) - min(xs),
        'd': max(zs) - min(zs),
    }


# ----------------------------------------------------------------------------
# Classification
# ----------------------------------------------------------------------------

def classify(components, report=False):
    """Split components into case / alpha caps / modifier caps / accent cap.

    Each keycap in this model is exactly one connected component, so no
    grouping is needed — the job is purely to tell keycaps apart from the
    switch stems and internals that sit at the same height.
    """
    y_lo = min(c['ymin'] for c in components)
    y_hi = max(c['ymax'] for c in components)
    board_w = max(c['xmax'] for c in components) - min(c['xmin'] for c in components)

    cap_height = y_lo + (y_hi - y_lo) * 0.55
    max_cap_span = board_w * 0.2

    # Triangle count is what separates a moulded keycap from a switch stem.
    # Footprint alone doesn't: stems and caps overlap heavily in width, which
    # is what made the median footprint a useless estimate of 1u.
    caps, case = [], []
    for c in components:
        is_high = c['ymax'] > cap_height
        is_compact = c['w'] < max_cap_span and c['d'] < max_cap_span
        if is_high and is_compact and len(c['tris']) >= MIN_KEYCAP_TRIS:
            caps.append(c)
        else:
            # Switch housings and stems go with the case; they read as dark
            # hardware in the gaps between caps, which is what they are.
            case.append(c)

    unit = estimate_key_unit(caps)

    # Discard anything far too small to be a cap at this scale.
    caps, strays = ([c for c in caps if c['w'] > unit * 0.5],
                    [c for c in caps if c['w'] <= unit * 0.5])
    case.extend(strays)

    rows = defaultdict(list)
    for c in caps:
        rows[round(c['cz'] / unit)].append(c)
    row_keys = sorted(rows)

    # The bottom row (spacebar) has the fewest keys. The number row is the row
    # furthest from it. Orientation-independent, so it survives the source
    # model's ~185 degree yaw without hardcoding a direction.
    populated = [r for r in row_keys if len(rows[r]) >= 8]
    if populated:
        bottom = min(populated, key=lambda r: len(rows[r]))
        number_row = max(populated, key=lambda r: abs(r - bottom))
    else:
        number_row = row_keys[0] if row_keys else None

    accent = None
    if number_row is not None and len(rows[number_row]) >= 8:
        row = sorted(rows[number_row], key=lambda c: c['cx'])
        # Backspace (the widest cap in the number row) marks the right-hand end.
        # Esc is the outermost cap at the opposite end.
        widest = max(row, key=lambda c: c['w'])
        right_end = abs(widest['cx'] - row[-1]['cx']) < abs(widest['cx'] - row[0]['cx'])
        accent = row[0] if right_end else row[-1]

    alpha, modifier = [], []
    for c in caps:
        if c is accent:
            continue
        (modifier if c['w'] > unit * MODIFIER_WIDTH_UNITS else alpha).append(c)

    if report:
        print(f'  board width      : {board_w:.2f}')
        print(f'  estimated 1u     : {unit:.3f}')
        print(f'  keycaps found    : {len(caps)}')
        print(f'  rows (z/unit)    : { {r: len(rows[r]) for r in row_keys} }')
        print(f'  number row       : {number_row}')
        acc = f"x={accent['cx']:.2f} z={accent['cz']:.2f}" if accent else 'NOT FOUND'
        print(f'  accent (Esc) at  : {acc}')
        print(f'  alpha caps       : {len(alpha)}')
        print(f'  modifier caps    : {len(modifier)}')
        print(f'  case components  : {len(case)}')

    def tris_of(items):
        return [t for c in items for t in c['tris']]

    return {
        'case': tris_of(case),
        'cap_base': tris_of(alpha),
        'cap_mod': tris_of(modifier),
        'cap_accent': tris_of([accent]) if accent else [],
    }


def estimate_key_unit(caps):
    """One key unit, from the most common keycap footprint width.

    The mode, not the median: most keys on any layout are 1u, so the width
    histogram spikes hard there while modifiers spread thinly across the tail.
    """
    if not caps:
        return 1.0
    histogram = Counter(round(c['w'], 1) for c in caps)
    return histogram.most_common(1)[0][0] or 1.0


# ----------------------------------------------------------------------------
# GLB writing
# ----------------------------------------------------------------------------

MATERIALS = [
    ('case', [0.11, 0.12, 0.13, 1.0], 0.9, 0.3),
    ('cap_base', [0.16, 0.18, 0.20, 1.0], 0.0, 0.62),
    ('cap_mod', [0.96, 0.95, 0.93, 1.0], 0.0, 0.62),
    ('cap_accent', [1.0, 0.35, 0.12, 1.0], 0.0, 0.55),
]


def build_glb(groups, positions, normals, uvs, triangles):
    buffer = bytearray()
    views, accessors, primitives = [], [], []

    def add_view(blob, target=None):
        while len(buffer) % 4:
            buffer.append(0)
        offset = len(buffer)
        buffer.extend(blob)
        view = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(blob)}
        if target:
            view['target'] = target
        views.append(view)
        return len(views) - 1

    for mat_index, (name, _, _, _) in enumerate(MATERIALS):
        tri_list = groups[name]
        if not tri_list:
            print(f'  ! group "{name}" is empty, skipping primitive')
            continue

        # Re-index: each primitive carries only the vertices it uses.
        remap, local_pos, local_nrm, local_uv, indices = {}, [], [], [], []
        for ti in tri_list:
            for v in triangles[ti]:
                if v not in remap:
                    remap[v] = len(local_pos)
                    local_pos.append(positions[v])
                    local_nrm.append(normals[v])
                    local_uv.append(uvs[v] if uvs else (0.0, 0.0))
                indices.append(remap[v])

        pos_blob = b''.join(struct.pack('<3f', *p) for p in local_pos)
        nrm_blob = b''.join(struct.pack('<3f', *n) for n in local_nrm)
        uv_blob = b''.join(struct.pack('<2f', *t) for t in local_uv)
        # 16-bit indices wherever the primitive fits, which every group here
        # does after re-indexing. Halves the index buffer against uint32.
        narrow = len(local_pos) < 65536
        idx_fmt, idx_component = ('<H', 5123) if narrow else ('<I', 5125)
        idx_blob = b''.join(struct.pack(idx_fmt, i) for i in indices)

        pos_view = add_view(pos_blob, 34962)
        nrm_view = add_view(nrm_blob, 34962)
        uv_view = add_view(uv_blob, 34962)
        idx_view = add_view(idx_blob, 34963)

        # POSITION min/max are required by the glTF spec.
        mins = [min(p[i] for p in local_pos) for i in range(3)]
        maxs = [max(p[i] for p in local_pos) for i in range(3)]

        base = len(accessors)
        accessors.append({'bufferView': pos_view, 'componentType': 5126,
                          'count': len(local_pos), 'type': 'VEC3',
                          'min': mins, 'max': maxs})
        accessors.append({'bufferView': nrm_view, 'componentType': 5126,
                          'count': len(local_nrm), 'type': 'VEC3'})
        accessors.append({'bufferView': uv_view, 'componentType': 5126,
                          'count': len(local_uv), 'type': 'VEC2'})
        accessors.append({'bufferView': idx_view, 'componentType': idx_component,
                          'count': len(indices), 'type': 'SCALAR'})

        primitives.append({
            'attributes': {'POSITION': base, 'NORMAL': base + 1, 'TEXCOORD_0': base + 2},
            'indices': base + 3,
            'material': mat_index,
            'mode': 4,
        })
        print(f'  {name:12} {len(indices)//3:>7,} tris  {len(local_pos):>7,} verts')

    gltf = {
        'asset': {'version': '2.0', 'generator': 'THOCK bake-keyboard-glb.py'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0, 'name': 'Keyboard'}],
        'meshes': [{'name': 'Keyboard', 'primitives': primitives}],
        'materials': [
            {
                'name': name,
                'pbrMetallicRoughness': {
                    'baseColorFactor': color,
                    'metallicFactor': metal,
                    'roughnessFactor': rough,
                },
            }
            for name, color, metal, rough in MATERIALS
        ],
        'accessors': accessors,
        'bufferViews': views,
        'buffers': [{'byteLength': len(buffer)}],
    }

    json_blob = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    json_blob += b' ' * (-len(json_blob) % 4)
    bin_blob = bytes(buffer) + b'\x00' * (-len(buffer) % 4)

    total = 12 + 8 + len(json_blob) + 8 + len(bin_blob)
    out = bytearray()
    out.extend(struct.pack('<III', GLB_MAGIC, 2, total))
    out.extend(struct.pack('<II', len(json_blob), CHUNK_JSON))
    out.extend(json_blob)
    out.extend(struct.pack('<II', len(bin_blob), CHUNK_BIN))
    out.extend(bin_blob)
    return bytes(out)


# ----------------------------------------------------------------------------

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    report = '--report' in sys.argv
    if len(args) < 2:
        raise SystemExit(__doc__)
    src, dst = args[0], args[1]

    gltf, buf = read_glb(src)
    prim = gltf['meshes'][0]['primitives'][0]
    positions = read_accessor(gltf, buf, prim['attributes']['POSITION'])
    normals = read_accessor(gltf, buf, prim['attributes']['NORMAL'])
    uvs = (read_accessor(gltf, buf, prim['attributes']['TEXCOORD_0'])
           if 'TEXCOORD_0' in prim['attributes'] else None)
    raw_idx = [v[0] for v in read_accessor(gltf, buf, prim['indices'])]
    triangles = [(raw_idx[i], raw_idx[i + 1], raw_idx[i + 2])
                 for i in range(0, len(raw_idx), 3)]

    print(f'source: {src}')
    print(f'  {len(positions):,} verts  {len(triangles):,} tris  '
          f'{len(gltf.get("materials", []))} material(s)')

    # Bake the node's rotation so the board faces the camera; the source sits
    # at ~185 degrees of yaw.
    node = gltf['nodes'][0]
    if 'rotation' in node:
        m = quat_to_matrix(node['rotation'])
        positions = [apply_matrix(m, p) for p in positions]
        normals = [apply_matrix(m, n) for n in normals]

    # Centre on the origin and scale to the target width. Node translation and
    # scale are discarded — they're superseded by this normalisation.
    xs = [p[0] for p in positions]
    ys = [p[1] for p in positions]
    zs = [p[2] for p in positions]
    scale = TARGET_WIDTH / (max(xs) - min(xs))
    cx = (max(xs) + min(xs)) / 2
    cz = (max(zs) + min(zs)) / 2
    cy = min(ys)  # sit the board on y=0 so the contact shadow lines up
    positions = [((p[0] - cx) * scale, (p[1] - cy) * scale, (p[2] - cz) * scale)
                 for p in positions]

    components = [component_bounds(positions, triangles, t)
                  for t in connected_components(positions, triangles)]
    print(f'  {len(components)} connected components')

    groups = classify(components, report=report)

    assigned = sum(len(v) for v in groups.values())
    if assigned != len(triangles):
        print(f'  ! {len(triangles) - assigned} triangles unassigned '
              f'({assigned:,}/{len(triangles):,}) — folding into case')
        seen = {t for v in groups.values() for t in v}
        groups['case'].extend(t for t in range(len(triangles)) if t not in seen)

    print('output primitives:')
    blob = build_glb(groups, positions, normals, uvs, triangles)
    open(dst, 'wb').write(blob)
    print(f'\nwrote {dst}  ({len(blob)/1e6:.2f} MB)')


if __name__ == '__main__':
    main()
