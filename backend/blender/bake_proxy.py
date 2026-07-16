#!/usr/bin/env python3
"""
bake_proxy.py — headless Blender stage of the Preview Proxy Bake Pipeline.

Turns a high-poly source mesh (STL/OBJ) into a decimated, UV-unwrapped PROXY with
its surface detail baked into tangent-space normal + AO maps, then exports a GLB
(textures embedded) plus side-by-side validation renders and a machine-readable
report. A normal map is a lighting trick — it can't be printed — so a ripped proxy
is a smooth low-poly blob wearing a detailed costume. Print geometry never ships.

Run headless (no GUI), CPU-only, deterministic:

    blender -b -P bake_proxy.py -- \
        --config /path/config.json --input /path/model.stl --out-dir /path/out

Targets Blender 4.2 LTS operators with fallbacks to older names. Every failure
writes report.json with {"status": "failed", "error": ...} and exits non-zero, so
the Node wrapper never hangs and always has a reason.

Outputs in --out-dir:
    proxy_raw.glb            the baked proxy (textures embedded; PNG normal/AO)
    render_source_{0..2}.png source renders at the 3 planner camera distances
    render_proxy_{0..2}.png  proxy renders at the same distances
    report.json              measurements, timings, warnings, and status
"""

import bpy
import bmesh
import sys
import os
import json
import time
import math
import traceback

# --------------------------------------------------------------------------- #
# Args + config
# --------------------------------------------------------------------------- #

def parse_args(argv):
    """Args after the '--' separator Blender passes through to the script."""
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    out = {}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a.startswith("--"):
            key = a[2:]
            val = argv[i + 1] if i + 1 < len(argv) else ""
            out[key] = val
            i += 2
        else:
            i += 1
    return out


ARGS = parse_args(sys.argv)
CONFIG_PATH = ARGS.get("config")
INPUT_PATH = ARGS.get("input")
OUT_DIR = ARGS.get("out-dir")

REPORT = {
    "status": "failed",
    "stageTimings": {},
    "warnings": [],
    "error": None,
}


def out_path(name):
    return os.path.join(OUT_DIR, name)


def write_report_and_exit(code):
    try:
        os.makedirs(OUT_DIR, exist_ok=True)
        with open(out_path("report.json"), "w") as f:
            json.dump(REPORT, f, indent=2)
    except Exception:
        # Last resort: at least print the report so the wrapper's logs capture it.
        print("REPORT_JSON " + json.dumps(REPORT))
    sys.exit(code)


def fail(msg):
    REPORT["status"] = "failed"
    REPORT["error"] = str(msg)
    write_report_and_exit(1)


def warn(msg):
    REPORT["warnings"].append(str(msg))
    print("WARN " + str(msg))


class Stage:
    """Context manager that records how long a stage took."""

    def __init__(self, name):
        self.name = name

    def __enter__(self):
        self.t0 = time.time()
        print("STAGE " + self.name + " start")
        return self

    def __exit__(self, *exc):
        REPORT["stageTimings"][self.name] = round(time.time() - self.t0, 3)
        print("STAGE " + self.name + " done in "
              + str(REPORT["stageTimings"][self.name]) + "s")
        return False


if not CONFIG_PATH or not INPUT_PATH or not OUT_DIR:
    fail("Usage: -- --config <json> --input <mesh> --out-dir <dir>")

try:
    with open(CONFIG_PATH) as f:
        CFG = json.load(f)
except Exception as e:
    fail("Cannot read config: " + str(e))

# --------------------------------------------------------------------------- #
# Small Blender helpers
# --------------------------------------------------------------------------- #

def reset_scene():
    """Empty factory scene — deterministic, nothing left from a previous run."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def deselect_all():
    for o in bpy.context.scene.objects:
        o.select_set(False)


def set_active(obj):
    bpy.context.view_layer.objects.active = obj


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def triangle_count(obj):
    """Exact triangle count of an object's mesh (n-gons counted as a fan)."""
    me = obj.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def bbox_diagonal(obj):
    """World-space bounding-box diagonal length (Blender units == source units)."""
    corners = [obj.matrix_world @ __import__("mathutils").Vector(c)
               for c in obj.bound_box]
    xs = [c.x for c in corners]
    ys = [c.y for c in corners]
    zs = [c.z for c in corners]
    dx, dy, dz = max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)
    return math.sqrt(dx * dx + dy * dy + dz * dz), (dx, dy, dz), (min(zs), max(zs))


def import_mesh(path):
    """Import STL or OBJ, trying 4.x operators first, then legacy names."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".stl":
        try:
            bpy.ops.wm.stl_import(filepath=path)          # Blender 4.x
        except Exception:
            bpy.ops.import_mesh.stl(filepath=path)        # legacy addon
    elif ext == ".obj":
        try:
            bpy.ops.wm.obj_import(filepath=path)          # Blender 4.x
        except Exception:
            bpy.ops.import_scene.obj(filepath=path)       # legacy addon
    else:
        fail("Unsupported source format: " + ext + " (only .stl / .obj)")


# --------------------------------------------------------------------------- #
# Pipeline
# --------------------------------------------------------------------------- #

def preprocess():
    """Import, join loose parts, recalc normals, unit sanity — returns the source object."""
    reset_scene()
    import_mesh(INPUT_PATH)

    objs = mesh_objects()
    if not objs:
        fail("No mesh found in source file")

    # Join loose parts (default) so the bake sees one surface; flag it for review.
    if len(objs) > 1:
        if CFG.get("joinLooseParts", True):
            deselect_all()
            for o in objs:
                o.select_set(True)
            set_active(objs[0])
            bpy.ops.object.join()
            warn("Source had %d loose parts; joined into one." % len(objs))
        else:
            warn("Source had %d loose parts; joinLooseParts is off — baking the first only."
                 % len(objs))

    src = mesh_objects()[0]
    deselect_all()
    src.select_set(True)
    set_active(src)

    # Apply transforms so real-world scale/rotation are baked into the geometry
    # WITHOUT normalising size — the planner's grid snapping depends on the exact
    # physical footprint, so we never rescale.
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    # Recalculate normals consistently outward (fixes flipped/inside-out faces
    # that would make the selected-to-active bake sample the wrong side).
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    src_tris = triangle_count(src)
    REPORT["sourceTriangles"] = src_tris
    cap = int(CFG.get("sourceTriangleCap", 5000000))
    if src_tris > cap:
        fail("Source too complex: %d triangles > cap %d" % (src_tris, cap))

    # Unit sanity: terrain is authored in mm (tens–hundreds of units). A bbox that
    # implies metres (tiny) or something absurd is flagged, never silently "fixed".
    diag, dims, _z = bbox_diagonal(src)
    REPORT["boundingBoxMm"] = [round(d, 3) for d in dims]
    max_dim = max(dims)
    if max_dim < 1.0:
        warn("Bounding box max dimension is %.4f — source may be in metres, not mm."
             % max_dim)
    elif max_dim > 100000.0:
        warn("Bounding box max dimension is %.1f — unusually large; check units." % max_dim)

    return src, src_tris, diag


def make_proxy(src, src_tris):
    """Duplicate the source and reduce it to the triangle budget. Returns (proxy, strategy)."""
    budget = int(CFG.get("triangleBudget", 40000))

    deselect_all()
    src.select_set(True)
    set_active(src)
    bpy.ops.object.duplicate()
    proxy = bpy.context.view_layer.objects.active
    proxy.name = "proxy"

    def decimate(obj, ratio):
        m = obj.modifiers.new(name="decimate", type="DECIMATE")
        m.decimate_type = "COLLAPSE"
        m.ratio = max(0.0005, min(1.0, ratio))
        deselect_all()
        obj.select_set(True)
        set_active(obj)
        bpy.ops.object.modifier_apply(modifier=m.name)

    strategy = str(CFG.get("remeshStrategy", "decimate"))

    # Sources already at/under budget skip decimation but STILL get UV + AO + poison
    # pills — the split between preview and purchase file must hold universally.
    if src_tris <= budget:
        strategy = "none"
        REPORT["proxyStrategyDetail"] = "source already within budget"
    else:
        try:
            if strategy == "voxel":
                raise RuntimeError("voxel requested")
            decimate(proxy, budget / float(src_tris))
            # A degenerate collapse (non-manifold input) can leave far too few faces.
            if triangle_count(proxy) < 8:
                raise RuntimeError("collapse produced degenerate mesh")
            strategy = "decimate"
        except Exception as e:
            # Fallback: voxel remesh (robust on non-manifold/pathological topology),
            # then decimate the uniform result down to the budget.
            warn("Decimate fallback to voxel remesh: " + str(e))
            deselect_all()
            proxy.select_set(True)
            set_active(proxy)
            diag, _dims, _z = bbox_diagonal(proxy)
            rm = proxy.modifiers.new(name="remesh", type="REMESH")
            rm.mode = "VOXEL"
            # Resolution derived from bbox size: ~1% of the diagonal per voxel.
            rm.voxel_size = max(diag * 0.01, 1e-4)
            bpy.ops.object.modifier_apply(modifier=rm.name)
            if triangle_count(proxy) > budget:
                decimate(proxy, budget / float(triangle_count(proxy)))
            strategy = "voxel"

    # --- Detail removal (the anti-theft core) ---------------------------------
    # Decimation preserves surface relief (that's its job), so a decimated proxy is
    # still printable. Smooth the geometry to melt the fine detail OUT of the mesh;
    # the detail is re-added afterwards as a tangent-space normal map, which a printer
    # ignores. Result: on-screen it looks detailed, but the geometry a ripper extracts
    # is a smooth, un-printable surface.
    #
    # The plain SMOOTH (Laplacian) modifier used to do this, but it SHRINKS and rounds
    # the mesh — eroding the silhouette. A normal map can fake surface detail but NOT a
    # silhouette, so once the outline melts the model stops looking like the product
    # (this is exactly what ruined the earlier attempt). LAPLACIANSMOOTH with volume
    # preservation removes the same high-frequency relief WITHOUT the shrinkage, so the
    # recognisable form survives while the fine detail is what gets flattened.
    # Tunable via proxySmoothIterations / proxySmoothLambda / proxySmoothVolumePreserve.
    smooth_iters = int(CFG.get("proxySmoothIterations", 10))
    if smooth_iters > 0:
        deselect_all()
        proxy.select_set(True)
        set_active(proxy)
        use_vp = bool(CFG.get("proxySmoothVolumePreserve", True))
        applied = False
        if use_vp:
            try:
                sm = proxy.modifiers.new(name="detail_smooth", type="LAPLACIANSMOOTH")
                sm.iterations = smooth_iters
                sm.lambda_factor = max(0.0, float(CFG.get("proxySmoothLambda", 1.0)))
                sm.lambda_border = 0.0
                sm.use_volume_preserve = True
                sm.use_normalized = True
                bpy.ops.object.modifier_apply(modifier=sm.name)
                REPORT["proxySmoothMethod"] = "laplacian-volume-preserve"
                REPORT["proxySmoothLambda"] = sm.lambda_factor
                applied = True
            except Exception as e:
                warn("LaplacianSmooth failed, falling back to plain Smooth: " + str(e))
                # A half-applied modifier may linger — clear it before the fallback.
                for m in list(proxy.modifiers):
                    if m.name == "detail_smooth":
                        try:
                            proxy.modifiers.remove(m)
                        except Exception:
                            pass
        if not applied:
            sm = proxy.modifiers.new(name="detail_smooth", type="SMOOTH")
            sm.factor = max(0.0, min(1.0, float(CFG.get("proxySmoothFactor", 0.5))))
            sm.iterations = smooth_iters
            bpy.ops.object.modifier_apply(modifier=sm.name)
            REPORT["proxySmoothMethod"] = "smooth-legacy"
            REPORT["proxySmoothFactor"] = sm.factor
        REPORT["proxySmoothIterations"] = smooth_iters
    else:
        REPORT["proxySmoothIterations"] = 0
        REPORT["proxySmoothMethod"] = "none"
        warn("Proxy smoothing DISABLED — geometry keeps printable detail (weak protection).")

    REPORT["proxyTriangles"] = triangle_count(proxy)
    REPORT["remeshStrategy"] = strategy
    return proxy, strategy


def unwrap(proxy):
    """Smart UV Project on the proxy (source UVs are irrelevant for geometry bakes).
    Corrected aspect + a repack keep stretching down and texel budget high, so the
    baked normal map resolves the fine detail rather than smearing it across seams."""
    angle = math.radians(float(CFG.get("uvAngleLimitDeg", 66.0)))
    margin = float(CFG.get("uvIslandMargin", 0.02))
    deselect_all()
    proxy.select_set(True)
    set_active(proxy)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=angle, island_margin=margin, correct_aspect=True)
    # Repack tightly so islands use the whole 0..1 space (more texels per feature).
    try:
        bpy.ops.uv.pack_islands(margin=margin)
    except Exception as e:
        warn("UV pack_islands failed (continuing with smart-project layout): " + str(e))
    bpy.ops.object.mode_set(mode="OBJECT")


def new_image(name, res):
    img = bpy.data.images.new(name, width=res, height=res, alpha=False,
                              float_buffer=False)
    return img


def ensure_material_with_image(proxy, img):
    """Give the proxy a material whose ACTIVE node is an image texture (bake target)."""
    mat = bpy.data.materials.get("proxy_mat")
    if mat is None:
        mat = bpy.data.materials.new("proxy_mat")
        mat.use_nodes = True
    if not proxy.data.materials:
        proxy.data.materials.append(mat)
    else:
        proxy.data.materials[0] = mat

    nodes = mat.node_tree.nodes
    tex = nodes.get("bake_target")
    if tex is None:
        tex = nodes.new("ShaderNodeTexImage")
        tex.name = "bake_target"
    tex.image = img
    nodes.active = tex           # Cycles bakes into the active image node
    return mat


def configure_cycles_cpu():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"


def max_surface_displacement(src, proxy):
    """Largest distance from a proxy vertex to the SOURCE surface (Blender units == mm).

    Smoothing pushes the proxy surface away from the source detail. The bake shoots
    rays from the proxy out to the source; if a ray is shorter than that gap it finds
    nothing and the normal map goes flat right where the detail was — the exact reason
    a smoothed proxy can look under-detailed. Measuring the real max gap lets us size
    the cage/ray so rays always reach the source."""
    from mathutils.bvhtree import BVHTree
    try:
        deps = bpy.context.evaluated_depsgraph_get()
        bvh = BVHTree.FromObject(src, deps)
    except Exception as e:
        warn("Displacement BVH build failed (using diagonal-based cage): " + str(e))
        return 0.0
    inv = src.matrix_world.inverted()
    mw = proxy.matrix_world
    maxd = 0.0
    for v in proxy.data.vertices:
        co_src = inv @ (mw @ v.co)  # proxy vertex in source local space
        hit = bvh.find_nearest(co_src)
        if hit and hit[3] is not None and hit[3] > maxd:
            maxd = hit[3]
    return maxd


def bake_pass(src, proxy, img, bake_type, samples, cage_extrusion, max_ray_distance, extra=None):
    """Run one selected-to-active bake from src onto proxy's active image node.
    cage_extrusion/max_ray_distance are precomputed (see bake_maps) so every pass
    reaches the source detail regardless of how far smoothing moved the surface."""
    scene = bpy.context.scene
    scene.cycles.samples = max(1, int(samples))

    ensure_material_with_image(proxy, img)

    bake = scene.render.bake
    bake.use_selected_to_active = True
    bake.cage_extrusion = cage_extrusion
    bake.max_ray_distance = max_ray_distance

    # Selection order matters: source(s) selected, proxy active (the target).
    deselect_all()
    src.select_set(True)
    proxy.select_set(True)
    set_active(proxy)

    kwargs = dict(type=bake_type, use_selected_to_active=True,
                  cage_extrusion=cage_extrusion,
                  max_ray_distance=max_ray_distance)
    if extra:
        kwargs.update(extra)
    bpy.ops.object.bake(**kwargs)


def save_png(img, name):
    img.file_format = "PNG"
    img.filepath_raw = out_path(name)
    img.save()


def bake_maps(src, proxy, diag):
    """Bake tangent-space normal (+Y) and AO; wire them into the proxy material."""
    normal_res = int(CFG.get("normalMapRes", 2048))
    ao_res = int(CFG.get("aoMapRes", 1024))
    ao_samples = int(CFG.get("aoSamples", 64))

    # Cage extrusion + max ray distance must SPAN the gap smoothing opened between the
    # proxy surface and the source detail, or the bake reads empty and the normal map
    # comes out flat (losing the very detail we smoothed away). Floor them at a % of the
    # bbox diagonal (thin geometry), but raise to the measured max proxy→source
    # displacement × a safety factor so every ray reaches the source.
    disp = max_surface_displacement(src, proxy)
    safety = float(CFG.get("bakeDisplacementSafety", 1.5))
    cage = max(diag * float(CFG.get("bakeExtrusionPct", 0.75)) / 100.0, disp * safety)
    ray = max(diag * float(CFG.get("maxRayDistancePct", 1.5)) / 100.0, disp * safety)
    REPORT["maxProxyDisplacementMm"] = round(disp, 4)
    REPORT["bakeCageExtrusion"] = round(cage, 4)
    REPORT["bakeMaxRayDistance"] = round(ray, 4)

    normal_img = new_image("proxy_normal", normal_res)
    # Normal maps are data, not colour — keep them linear so PNG values are exact.
    normal_img.colorspace_settings.name = "Non-Color"
    # Normal bakes need only 1 sample; OpenGL/+Y convention matches glTF (Blender default).
    bake_pass(src, proxy, normal_img, "NORMAL", 1, cage, ray,
              extra=dict(normal_space="TANGENT"))
    save_png(normal_img, "normal.png")

    ao_img = new_image("proxy_ao", ao_res)
    ao_img.colorspace_settings.name = "Non-Color"
    bake_pass(src, proxy, ao_img, "AO", ao_samples, cage, ray)
    save_png(ao_img, "ao.png")

    REPORT["textureResolutions"] = {"normal": normal_res, "ao": ao_res}

    # Optional baseColor atlas when the source carries usable materials, so the
    # preview matches product imagery. Falls back to a neutral material otherwise.
    base_res = int(CFG.get("baseColorRes", 2048))
    has_materials = any(len(o.data.materials) > 0 and any(m is not None for m in o.data.materials)
                        for o in [src])
    base_img = None
    if has_materials:
        try:
            base_img = new_image("proxy_basecolor", base_res)
            bake_pass(src, proxy, base_img, "DIFFUSE", 16, cage, ray,
                      extra=dict(pass_filter={"COLOR"}))
            save_png(base_img, "basecolor.png")
            REPORT["textureResolutions"]["baseColor"] = base_res
            REPORT["baseColorBaked"] = True
        except Exception as e:
            warn("baseColor bake failed, using neutral material: " + str(e))
            base_img = None
            REPORT["baseColorBaked"] = False
    else:
        REPORT["baseColorBaked"] = False

    wire_material(proxy, normal_img, ao_img, base_img)


def wire_material(proxy, normal_img, ao_img, base_img):
    """Rebuild the proxy material: baseColor/neutral -> BSDF, normal -> Normal Map,
    AO -> multiplied into base colour (glTF occlusion slot is set on export)."""
    mat = proxy.data.materials[0]
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (-300, 0)
    out.location = (60, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Roughness"].default_value = 0.9
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = 0.0

    # Base colour: baked atlas, or a neutral mid-grey.
    if base_img is not None:
        base_tex = nt.nodes.new("ShaderNodeTexImage")
        base_tex.image = base_img
        base_tex.location = (-900, 200)
        nt.links.new(base_tex.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (0.62, 0.62, 0.60, 1.0)

    # Normal map (tangent-space, +Y).
    ntex = nt.nodes.new("ShaderNodeTexImage")
    ntex.image = normal_img
    ntex.location = (-900, -200)
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nmap.location = (-600, -200)
    nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    # Keep the AO image in the material (as the active node's data) so the glTF
    # exporter can attach it to the occlusion slot; store a reference node.
    aotex = nt.nodes.new("ShaderNodeTexImage")
    aotex.image = ao_img
    aotex.location = (-900, -600)
    aotex.name = "ao_target"
    nt.nodes.active = aotex


def emboss_watermark(proxy):
    """Emboss the watermark string into the proxy GEOMETRY, wrapping it around the
    model's BOTTOM EDGE on all four sides so a ripped mesh reliably carries the mark.

    The old placement laid a single flat plate over the model's TOP surface. That was
    fragile: an open, hollow or irregular top (ruins, towers, walls with no roof) has
    no solid geometry under the centred plate, so the boolean union touched nothing
    and the "watermark" was a free-floating plate that a ripper could delete in one
    click — no protection at all. The bottom edge is the widest, most solid part of
    almost every terrain piece (it sits on the table), so a band placed there actually
    intersects real geometry.

    For each of the four bbox sides we stand the string upright on the wall near the
    base, its body straddling the wall plane (inset inward, extruded to poke `proud`
    proud outside and deep inside) so the boolean bites even when the true wall is set
    back from the bbox extreme. A distinct near-black material makes the mark read in
    the planner. The paid STL is never touched — this is the preview proxy only.

    Boolean-union is the primary path; on failure we fall back to joining the text as
    loose geometry (weaker, but still in-mesh). Any error is a warning, never a job
    failure — a bake must never die over the watermark."""
    import mathutils

    if not bool(CFG.get("embossWatermarkEnabled", True)):
        REPORT["embossApplied"] = False
        warn("Emboss watermark DISABLED — a mesh-rip carries no mark.")
        return

    text = str(CFG.get("embossWatermarkText", "ARTIFACT ARMOURY  PREVIEW")).strip()
    if not text:
        REPORT["embossApplied"] = False
        return

    engrave = bool(CFG.get("embossEngrave", False))
    height_pct = float(CFG.get("embossHeightPct", 9.0))
    depth_pct = float(CFG.get("embossDepthPct", 1.5))
    inset_pct = float(CFG.get("embossInsetPct", 2.0))

    made = []
    try:
        diagp, _dimsp, (minz, maxz) = bbox_diagonal(proxy)
        corners = [proxy.matrix_world @ mathutils.Vector(c) for c in proxy.bound_box]
        xs = [c.x for c in corners]
        ys = [c.y for c in corners]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        cx = (min_x + max_x) / 2.0
        cy = (min_y + max_y) / 2.0
        dx = max(1e-4, max_x - min_x)
        dy = max(1e-4, max_y - min_y)
        dz = max(1e-4, maxz - minz)

        # Cap height: footprint-relative, but clamped so the whole string fits across
        # the NARROWER face (~0.65 em advance per glyph) and stays in the lower half of
        # the wall — a band that hugs the base, never a full-height billboard.
        min_horiz = min(dx, dy)
        cap_h = min_horiz * height_pct / 100.0
        cap_fit = min_horiz / (max(1, len(text)) * 0.65)
        cap_h = max(1e-4, min(cap_h, cap_fit, dz * 0.5))

        # Cutter geometry differs by mode:
        #  • ENGRAVE (difference): a shallow cutter CENTRED on the bbox face. Difference
        #    only removes material where the cutter overlaps real mesh, so the mark can
        #    NEVER float — it appears solely on faces that exist. Kept shallow so it's
        #    subtle and never punches through a thin wall.
        #  • RAISED (union): plane inset inward and extruded so it reaches `proud` proud
        #    outside and deep inside — the inward reach catches a wall standing back from
        #    the bbox extreme, but stray letters over empty space float (why engrave is
        #    the default now).
        if engrave:
            cut = max(1e-4, diagp * depth_pct / 100.0)
            extrude = cut          # ±cut about the face -> recess up to `cut` deep
            offs = 0.0             # centred on the face plane; empty space untouched
        else:
            inset = max(1e-4, diagp * inset_pct / 100.0)
            proud = max(1e-4, diagp * depth_pct / 100.0)
            extrude = inset + proud
            offs = inset

        # Letters hug the base: vertical centre just above min Z.
        z_band = minz + cap_h * 0.65

        # (name, XYZ euler, location) per side. Rotation stands the FONT plane upright
        # on the wall: local +Y (letter up) -> world +Z, local +Z (extrude) -> ±wall
        # normal, local +X (reading) -> the horizontal face tangent.
        sides = [
            ("pY", (math.radians(90), 0.0, 0.0),                (cx, max_y - offs, z_band)),
            ("nY", (math.radians(90), 0.0, math.radians(180)),  (cx, min_y + offs, z_band)),
            ("pX", (math.radians(90), 0.0, math.radians(90)),   (max_x - offs, cy, z_band)),
            ("nX", (math.radians(90), 0.0, math.radians(-90)),  (min_x + offs, cy, z_band)),
        ]

        for name, rot, loc in sides:
            cur = bpy.data.curves.new(name="wm_curve_" + name, type="FONT")
            cur.body = text
            cur.align_x = "CENTER"
            cur.align_y = "CENTER"
            cur.size = cap_h
            cur.extrude = extrude  # extends +/-Z from the plane -> ~2*extrude thick
            o = bpy.data.objects.new("wm_text_" + name, cur)
            bpy.context.scene.collection.objects.link(o)

            deselect_all()
            o.select_set(True)
            set_active(o)
            bpy.ops.object.convert(target="MESH")
            o = bpy.context.view_layer.objects.active
            o.rotation_euler = rot
            o.location = loc
            made.append(o)

        bpy.context.view_layer.update()

        # Join the four bands into one boolean operand.
        deselect_all()
        for o in made:
            o.select_set(True)
        set_active(made[0])
        bpy.ops.object.join()
        wm = bpy.context.view_layer.objects.active
        made = [wm]

        # Material: a raised mark gets a distinct near-black so it reads as a logo; an
        # engraved mark reuses the model's own material so it stays SUBTLE — just fine
        # recessed relief that the AO bake shades, not a bold band. (For a difference the
        # operand is consumed anyway; matching materials keeps any transferred cut faces
        # blended in.)
        wm.data.materials.clear()
        if engrave and proxy.data.materials:
            wm.data.materials.append(proxy.data.materials[0])
        else:
            wm_mat = bpy.data.materials.new("wm_mat")
            wm_mat.use_nodes = True
            wm_bsdf = wm_mat.node_tree.nodes.get("Principled BSDF")
            if wm_bsdf:
                wm_bsdf.inputs["Base Color"].default_value = (0.02, 0.02, 0.02, 1.0)
                if "Roughness" in wm_bsdf.inputs:
                    wm_bsdf.inputs["Roughness"].default_value = 0.75
            wm.data.materials.append(wm_mat)

        # Boolean the bands onto the proxy (primary), else join them (fallback).
        deselect_all()
        proxy.select_set(True)
        set_active(proxy)
        mod = proxy.modifiers.new(name="wm_bool", type="BOOLEAN")
        mod.operation = "DIFFERENCE" if engrave else "UNION"
        mod.object = wm
        try:
            mod.solver = "EXACT"
        except Exception:
            pass

        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
            REPORT["embossMethod"] = "boolean-" + ("difference" if engrave else "union")
            # Boolean leaves the operand object behind — remove it.
            if wm.name in bpy.data.objects:
                bpy.data.objects.remove(wm, do_unlink=True)
            made = []
        except Exception as e:
            warn("Emboss boolean failed, joining text as loose geometry: " + str(e))
            try:
                proxy.modifiers.remove(mod)
            except Exception:
                pass
            deselect_all()
            wm.select_set(True)
            proxy.select_set(True)
            set_active(proxy)  # active = join target
            bpy.ops.object.join()  # consumes wm into proxy
            made = []
            REPORT["embossMethod"] = "join"

        REPORT["embossWatermark"] = text
        REPORT["embossPlacement"] = "bottom-edge-4-sides"
        REPORT["embossApplied"] = True
    except Exception as e:
        warn("Emboss watermark failed (continuing without it): " + str(e))
        REPORT["embossApplied"] = False
    finally:
        # Ensure the scene is left clean and the proxy is the active object.
        for o in made:
            if o is not None and o.name in bpy.data.objects:
                try:
                    bpy.data.objects.remove(o, do_unlink=True)
                except Exception:
                    pass
        deselect_all()
        proxy.select_set(True)
        set_active(proxy)


def poison_pills(proxy):
    """Make the proxy deliberately un-printable (invisible cost at planner angles):
    delete downward base faces near the table, delete interior faces, and assert
    the result is non-watertight (boundary edges > 0).

    Toggleable via poisonPillsEnabled so it can be isolated when diagnosing a
    ruined-looking preview — select_interior_faces is a heuristic and can punch holes
    in visible surfaces on some meshes."""
    if not bool(CFG.get("poisonPillsEnabled", True)):
        REPORT["poisonPillsApplied"] = False
        warn("Poison pills DISABLED — proxy may be watertight/printable (weak protection).")
        return
    REPORT["poisonPillsApplied"] = True
    z_thr = float(CFG.get("baseFaceZNormalThreshold", -0.5))
    base_h = float(CFG.get("baseFaceHeightMm", 2.0))

    deselect_all()
    proxy.select_set(True)
    set_active(proxy)
    bpy.ops.object.mode_set(mode="EDIT")

    me = proxy.data
    bm = bmesh.from_edit_mesh(me)
    bm.faces.ensure_lookup_table()
    min_z = min((v.co.z for v in bm.verts), default=0.0)

    # 1) Base faces: normal points down AND the face sits within base_h of min Z.
    deleted_base = 0
    for f in bm.faces:
        f.select = False
    for f in bm.faces:
        centre_z = sum((v.co.z for v in f.verts)) / len(f.verts)
        if f.normal.z < z_thr and (centre_z - min_z) <= base_h:
            f.select = True
            deleted_base += 1
    bmesh.update_edit_mesh(me)
    if deleted_base:
        bpy.ops.mesh.delete(type="FACE")

    # 2) Interior faces (enclosed pockets a slicer would need but a viewer never sees).
    bpy.ops.mesh.select_all(action="DESELECT")
    try:
        bpy.ops.mesh.select_interior_faces()
        bpy.ops.mesh.delete(type="FACE")
    except Exception as e:
        warn("select_interior_faces failed (continuing): " + str(e))

    # Assert non-watertight: at least one boundary edge must remain.
    bm = bmesh.from_edit_mesh(me)
    boundary = sum(1 for e in bm.edges if e.is_boundary)
    bpy.ops.object.mode_set(mode="OBJECT")

    REPORT["deletedBaseFaces"] = deleted_base
    REPORT["boundaryEdgeCount"] = boundary
    if boundary <= 0:
        fail("Poison-pill assertion failed: proxy is still watertight (0 boundary edges)")


def strip_metadata(proxy):
    """Remove custom properties / naming that could leak source provenance."""
    for key in list(proxy.keys()):
        try:
            del proxy[key]
        except Exception:
            pass
    proxy.name = "proxy"
    proxy.data.name = "proxy_mesh"


def export_glb(proxy):
    deselect_all()
    proxy.select_set(True)
    set_active(proxy)
    path = out_path("proxy_raw.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,            # Blender Z-up -> glTF Y-up
        export_apply=True,
        export_normals=True,
        export_tangents=True,       # MikkTSpace tangents for correct normal-map shading
        export_texcoords=True,
        export_materials="EXPORT",
    )
    REPORT["glbExported"] = True


def setup_render_world():
    scene = bpy.context.scene
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    px = int(CFG.get("validationRenderPx", 512))
    scene.render.resolution_x = px
    scene.render.resolution_y = px
    scene.cycles.samples = 16
    # A simple sun + soft world so the baked normals read.
    world = bpy.data.worlds.new("qa_world")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.05, 0.05, 0.06, 1.0)
        bg.inputs[1].default_value = 1.0
    scene.world = world
    light_data = bpy.data.lights.new("qa_sun", "SUN")
    light_data.energy = 3.0
    light = bpy.data.objects.new("qa_sun", light_data)
    scene.collection.objects.link(light)
    light.rotation_euler = (math.radians(50), 0.0, math.radians(30))
    return scene


def render_views(src, proxy, diag, dims, centre):
    """Render source vs proxy at the three planner camera distances. Best-effort:
    a render failure is a warning, not a job failure."""
    import mathutils
    try:
        scene = setup_render_world()
        cam_data = bpy.data.cameras.new("qa_cam")
        cam = bpy.data.objects.new("qa_cam", cam_data)
        scene.collection.objects.link(cam)
        scene.camera = cam
        cam_data.clip_end = max(diag * 100.0, 1e6)

        # Planner distance is in metres; Blender units == source mm, and planner mm =
        # metres*1000, so a camera at (distance_m * 1000) source-units reproduces the
        # planner's apparent size regardless of the piece's absolute footprint.
        distances_m = [
            float(CFG.get("plannerMinCameraDistanceM", 0.3)),
            float(CFG.get("plannerTypicalCameraDistanceM", 2.0)),
            float(CFG.get("plannerFullTableCameraDistanceM", 16.0)),
        ]
        # Fixed 3/4 orbit view direction (elevation ~35°, azimuth ~45°).
        el, az = math.radians(35), math.radians(45)
        vd = mathutils.Vector((
            math.cos(el) * math.cos(az),
            math.cos(el) * math.sin(az),
            math.sin(el),
        ))
        c = mathutils.Vector(centre)

        def render_one(obj_visible, path, dist_units):
            src.hide_render = obj_visible != "src"
            proxy.hide_render = obj_visible != "proxy"
            cam.location = c + vd * dist_units
            look = (c - cam.location).normalized()
            cam.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)

        rendered = 0
        for i, dm in enumerate(distances_m):
            dist_units = dm * 1000.0
            render_one("src", out_path("render_source_%d.png" % i), dist_units)
            render_one("proxy", out_path("render_proxy_%d.png" % i), dist_units)
            rendered += 1

        src.hide_render = False
        proxy.hide_render = False
        REPORT["validationRenders"] = rendered
        REPORT["validationDistancesM"] = distances_m
    except Exception as e:
        warn("Validation renders failed (continuing): " + str(e))
        REPORT["validationRenders"] = 0


def main():
    t_all = time.time()
    with Stage("preprocess"):
        src, src_tris, diag = preprocess()
        import mathutils
        _d, dims, _z = bbox_diagonal(src)
        corners = [src.matrix_world @ mathutils.Vector(cc) for cc in src.bound_box]
        centre = (
            sum(c.x for c in corners) / 8.0,
            sum(c.y for c in corners) / 8.0,
            sum(c.z for c in corners) / 8.0,
        )

    with Stage("proxy"):
        proxy, _strategy = make_proxy(src, src_tris)

    with Stage("unwrap"):
        unwrap(proxy)

    configure_cycles_cpu()
    with Stage("bake"):
        bake_maps(src, proxy, diag)

    with Stage("emboss"):
        emboss_watermark(proxy)

    with Stage("poison_pills"):
        poison_pills(proxy)

    strip_metadata(proxy)
    with Stage("export"):
        export_glb(proxy)

    with Stage("render"):
        render_views(src, proxy, diag, dims, centre)

    REPORT["status"] = "ok"
    REPORT["totalSeconds"] = round(time.time() - t_all, 3)
    write_report_and_exit(0)


try:
    main()
except SystemExit:
    raise
except Exception as e:
    traceback.print_exc()
    fail("Unhandled: " + str(e))
