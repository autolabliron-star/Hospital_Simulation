"""
The PBR material library of the look pass (tools/arch/materials.json): one Blender material per entry, glTF-exportable.

Wiring (what the Blender glTF exporter understands):
  Image(diff, sRGB)                      -> Principled Base Color                  (baseColorTexture)
  Image(arm, Non-Color) -> Separate Color: G -> Roughness, B -> Metallic          (metallicRoughnessTexture)
                                           R -> 'glTF Material Output'.Occlusion  (occlusionTexture, the same image)
  Image(nor_gl, Non-Color) -> Normal Map(strength) -> Normal                      (normalTexture, scale = strength)
All maps read UVMap (TEXCOORD_0), written by `project_uvs` as a world-space box projection at the material's real tile size.

The CC0 photos (docs/handover/look-textures.md) are recoloured here, once, with numpy (tint, contrast, saturation, roughness remap; the terrazzo's
0.25 m joints are removed so it reads as 1 m slabs), written at the export resolution to assets-src/arch/out/tex/ and cached by a key of the
source files and the settings. A material whose texture files are missing falls back to its flat colour.
"""
import hashlib
import json
import math
import os

import bpy
import numpy as np

from common import srgb_to_linear

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SPEC = json.load(open(os.path.join(HERE, 'materials.json')))
TEX_DIR = os.path.join(ROOT, SPEC['textureDir'])
CACHE = os.path.join(ROOT, 'assets-src', 'arch', 'out', 'tex')

MAPS = {'diff': 'diff', 'nor': 'nor_gl', 'arm': 'arm'}


def _src(tex_id, kind):
    d = os.path.join(TEX_DIR, tex_id)
    if not os.path.isdir(d):
        return None
    for f in sorted(os.listdir(d)):
        if f.startswith(f'{tex_id}_{MAPS[kind]}_') and f.lower().endswith(('.jpg', '.png')):
            return os.path.join(d, f)
    return None


def _to_lin(v):
    return np.where(v <= 0.04045, v / 12.92, np.power((np.maximum(v, 0) + 0.055) / 1.055, 2.4))


def _to_srgb(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)


def _read(path, size):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = 'Non-Color'   # raw values: the sRGB decode is done here, explicitly
    w, h = img.size
    if size and (w != size or h != size):
        img.scale(size, size)
        w, h = size, size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[:, :, :3].copy()


def _write(px, path, colorspace):
    h, w = px.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False)
    img.colorspace_settings.name = colorspace
    out = np.ones((h, w, 4), dtype=np.float32)
    out[:, :, :3] = np.clip(px, 0, 1)
    img.pixels.foreach_set(out.reshape(-1))
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def _remove_joints(px, rj, scale):
    """Copy the aggregate across the tile joints at every `period` px except every `keepEvery`-th (period scaled to this resolution)."""
    period = rj['period'] * scale
    half = max(1, int(round(rj['half'] * scale)))
    shift = max(half * 2 + 1, int(round(rj['shift'] * scale)))
    n = px.shape[0]
    k = 1
    while k * period < n:
        if k % rj['keepEvery']:
            c = int(round(k * period))
            lo, hi = c - half, c + half
            px[:, lo:hi] = px[:, lo + shift:hi + shift] if hi + shift < n else px[:, lo - shift:hi - shift]
            px[lo:hi, :] = px[lo + shift:hi + shift, :] if hi + shift < n else px[lo - shift:hi - shift, :]
        k += 1
    return px


def _process(name, spec, tex_id):
    """Recolour/rescale the texture set of one material; returns {kind: png path} for the maps it uses."""
    pr = spec.get('process', {})
    res = spec.get('res', {})
    srcs = {k: _src(tex_id, k) for k in MAPS}
    if not srcs['diff']:
        return {}
    key = hashlib.sha1(json.dumps([name, spec, [os.path.getsize(s) if s else 0 for s in srcs.values()]], sort_keys=True).encode()).hexdigest()[:10]
    os.makedirs(CACHE, exist_ok=True)
    out = {}
    for kind in ('diff', 'nor', 'arm'):
        size = res.get(kind, 1024)
        if not size or not srcs[kind]:
            continue
        path = os.path.join(CACHE, f'{name}_{kind}_{size}_{key}.png')
        out[kind] = path
        if os.path.exists(path):
            continue
        # read at full size (joints are found at the source scale), then scale down
        px = _read(srcs[kind], 0)
        if 'removeJoints' in pr:
            px = _remove_joints(px, pr['removeJoints'], 1.0)
        if size != px.shape[0]:
            img = bpy.data.images.new('tmp', px.shape[1], px.shape[0], alpha=False, float_buffer=True)
            img.colorspace_settings.name = 'Non-Color'
            o4 = np.ones((px.shape[0], px.shape[1], 4), dtype=np.float32)
            o4[:, :, :3] = px
            img.pixels.foreach_set(o4.reshape(-1))
            img.scale(size, size)
            p2 = np.empty(size * size * 4, dtype=np.float32)
            img.pixels.foreach_get(p2)
            bpy.data.images.remove(img)
            px = p2.reshape(size, size, 4)[:, :, :3].copy()
        if kind == 'diff':
            lin = _to_lin(px)
            lum = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
            m = float(lum.mean())
            tint = np.array(srgb_to_linear(pr.get('tint', '#808080')), dtype=np.float32)
            tl = float(tint @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))
            detail = 1.0 + pr.get('contrast', 1.0) * (lum / max(m, 1e-4) - 1.0)
            chroma = (lin - lum[..., None]) / max(m, 1e-4) * tl * pr.get('saturation', 0.0)
            lin = tint[None, None, :] * detail[..., None] + chroma
            px = _to_srgb(lin)
            _write(px, path, 'sRGB')
        elif kind == 'arm':
            g = px[:, :, 1]
            mean, spread = pr.get('roughness', [spec.get('roughness', 0.5), 0.05])
            sd = float(g.std()) or 1.0
            px[:, :, 1] = np.clip(mean + (g - float(g.mean())) / sd * spread * 0.5, 0.02, 1.0)
            px[:, :, 2] = 0.0                      # no metal in these sets
            px[:, :, 0] = 1.0 - (1.0 - px[:, :, 0]) * 0.6   # soften the photo AO (the lightmap holds the real occlusion)
            _write(px, path, 'Non-Color')
        else:
            _write(px, path, 'Non-Color')
    return out


def _gltf_output_group():
    g = bpy.data.node_groups.get('glTF Material Output')
    if g:
        return g
    g = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    g.interface.new_socket('Thickness', in_out='INPUT', socket_type='NodeSocketFloat')
    return g


def _image_node(nt, path, colorspace, x, y):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = colorspace
    n = nt.nodes.new('ShaderNodeTexImage')
    n.image = img
    n.location = (x, y)
    n.interpolation = 'Linear'
    return n


def _palette_image(colors):
    """A small swatch strip for the Accent material: 8 px per colour, 16 px tall."""
    w, h = 8 * 8, 16
    px = np.ones((h, w, 4), dtype=np.float32)
    for i, c in enumerate(colors):
        h_ = c.lstrip('#')
        px[:, i * 8:(i + 1) * 8, :3] = [int(h_[k:k + 2], 16) / 255 for k in (0, 2, 4)]
    path = os.path.join(CACHE, 'Accent_palette.png')
    os.makedirs(CACHE, exist_ok=True)
    _write(px[:, :, :3], path, 'sRGB')
    return path


def palette_uv(i):
    """UV of swatch i in the Accent palette (its centre)."""
    return ((i * 8 + 4) / 64.0, 0.5)


def build_material(name, spec):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    out = nt.nodes['Material Output']
    col = srgb_to_linear(spec.get('color', '#cccccc'))
    bsdf.inputs['Base Color'].default_value = (*col, 1)
    bsdf.inputs['Roughness'].default_value = spec.get('roughness', 0.5)
    bsdf.inputs['Metallic'].default_value = spec.get('metallic', 0.0)
    m['tile'] = spec.get('tile', 1.0)
    m['grain'] = spec.get('grain', '')
    m['bake'] = spec.get('bake', True)
    m.use_backface_culling = not spec.get('doubleSided', False)
    if spec.get('emission'):
        bsdf.inputs['Emission Color'].default_value = (*srgb_to_linear(spec['emission']), 1)
        bsdf.inputs['Emission Strength'].default_value = spec.get('strength', 1.0)
        bsdf.inputs['Base Color'].default_value = (*srgb_to_linear(spec['emission']), 1)
    if spec.get('palette'):
        n = _image_node(nt, _palette_image(spec['palette']), 'sRGB', -500, 300)
        n.interpolation = 'Closest'
        nt.links.new(n.outputs['Color'], bsdf.inputs['Base Color'])
        m['palette'] = True
    if spec.get('glass'):
        _glass(m, spec)
    tex = spec.get('texture')
    maps = _process(name, spec, tex) if tex else {}
    m['textured'] = bool(maps)
    if 'diff' in maps:
        n = _image_node(nt, maps['diff'], 'sRGB', -600, 300)
        nt.links.new(n.outputs['Color'], bsdf.inputs['Base Color'])
    if 'arm' in maps:
        n = _image_node(nt, maps['arm'], 'Non-Color', -800, 0)
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        sep.location = (-500, 0)
        nt.links.new(n.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
        grp = nt.nodes.new('ShaderNodeGroup')
        grp.node_tree = _gltf_output_group()
        grp.location = (0, -400)
        nt.links.new(sep.outputs['Red'], grp.inputs['Occlusion'])
    if 'nor' in maps:
        n = _image_node(nt, maps['nor'], 'Non-Color', -800, -300)
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.location = (-400, -300)
        nm.inputs['Strength'].default_value = spec.get('normal', 1.0)
        nt.links.new(n.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        m['normalNode'] = nm.name
    return m


def _glass(m, spec):
    """Cycles: thin architectural glass = Fresnel mix of a clear Transparent BSDF and a sharp Glossy (light passes without caustics, so the sun
    reaches the floor in renders and bakes). The Principled node stays for the glTF export (`glass_for_export` relinks it, alpha blended)."""
    nt = m.node_tree
    out = nt.nodes['Material Output']
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    tr.inputs['Color'].default_value = (0.9, 0.94, 0.93, 1)
    gl = nt.nodes.new('ShaderNodeBsdfGlossy')
    gl.inputs['Roughness'].default_value = 0.02
    fr = nt.nodes.new('ShaderNodeFresnel')
    fr.inputs['IOR'].default_value = 1.52
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(fr.outputs['Fac'], mix.inputs['Fac'])
    nt.links.new(tr.outputs['BSDF'], mix.inputs[1])
    nt.links.new(gl.outputs['BSDF'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    m['cyclesGlass'] = True


def glass_for_export(m):
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Alpha'].default_value = 0.16
    bsdf.inputs['Roughness'].default_value = 0.03
    nt.links.new(bsdf.outputs['BSDF'], nt.nodes['Material Output'].inputs['Surface'])
    for attr, v in (('blend_method', 'BLEND'), ('surface_render_method', 'BLENDED')):
        try:
            setattr(m, attr, v)
        except Exception:
            pass


def build_all():
    return {name: build_material(name, spec) for name, spec in SPEC['materials'].items()}


def bevel_of(name):
    return SPEC['materials'][name].get('bevel', [0, 0])


def lightmap_of(name):
    return SPEC['materials'][name].get('lightmap')


# --- UVs ------------------------------------------------------------------------------------------------------------------------------------------
def project_uvs(o, palette_index=None):
    """World-space box projection into UVMap at the material's tile size (metres per repeat). Horizontal faces map (x, y); walls map
    (along, height) — or (height, along) for 'vertical' grain. Palette materials put every face on its swatch (palette_index: face -> i)."""
    me = o.data
    m = me.materials[0]
    tile = float(m.get('tile', 1.0)) or 1.0
    vertical = m.get('grain', '') == 'vertical'
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    data = uv.data
    co = [v.co for v in me.vertices]
    for p in me.polygons:
        if m.get('palette'):
            i = palette_index(p) if palette_index else 0
            u, v = palette_uv(i)
            for li in p.loop_indices:
                data[li].uv = (u, v)
            continue
        n = p.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for li in p.loop_indices:
            c = co[me.loops[li].vertex_index]
            if az >= ax and az >= ay:
                u, v = c.x, c.y
                if vertical:
                    u, v = c.y, c.x
            elif ax >= ay:
                u, v = (c.y if n.x > 0 else -c.y), c.z
            else:
                u, v = (-c.x if n.y > 0 else c.x), c.z
            if vertical and not (az >= ax and az >= ay):
                u, v = v, u
            data[li].uv = (u / tile, v / tile)
    me.uv_layers.active = uv
    uv.active_render = True
