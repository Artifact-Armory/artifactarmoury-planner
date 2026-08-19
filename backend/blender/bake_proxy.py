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

    # Weld coincident/near-coincident verts BEFORE anything else touches the mesh.
    # STL has no shared-vertex topology (every triangle owns its own 3 verts), so a
    # model built from many separate touching shells — individual roof tiles, floor
    # planks — imports as fully disconnected islands even after the join above (join
    # only merges them into one object/datablock, it doesn't fuse touching verts).
    # DECIMATE + volume-preserving LaplacianSmooth downstream is unstable on tiny
    # disconnected islands: they can shrink/invert and scatter into fragments instead
    # of smoothing cleanly — this is what shattered the "Japan houses" mid/top parts
    # (2026-08-15) while the single-shell bottom part baked fine. Welding first fuses
    # touching shells into one connected manifold so decimate/smooth see a normal mesh.
    weld_dist = float(CFG.get("weldMergeDistanceMm", 0.05))
    verts_before = len(src.data.vertices)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    if weld_dist > 0:
        bpy.ops.mesh.remove_doubles(threshold=weld_dist)
        # remove_doubles merges some of a triangle's verts but not always all of
        # them, which can leave razor-thin/zero-area sliver faces right at the weld
        # seam. Left alone, those slivers ride through decimate/smooth and go on to
        # confuse the emboss boolean's EXACT solver later (stray protruding
        # fragments instead of a clean carve — see make_proxy()'s cleanup pass,
        # which catches whatever this one misses). Cheap to do here too since it
        # stops the slivers from ever reaching decimate/smooth in the first place.
        try:
            bpy.ops.mesh.dissolve_degenerate(threshold=1e-4)
        except Exception as e:
            warn("Post-weld dissolve_degenerate failed (continuing): " + str(e))
        bpy.ops.mesh.select_all(action="SELECT")

    # Recalculate normals consistently outward (fixes flipped/inside-out faces
    # that would make the selected-to-active bake sample the wrong side).
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    if weld_dist > 0:
        welded = verts_before - len(src.data.vertices)
        if welded > 0:
            REPORT["weldedVertices"] = welded
            print("Welded %d coincident vertices (merge distance %.4fmm)."
                  % (welded, weld_dist))

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


def compute_adaptive_budget(src_tris):
    """Target proxy triangle count, scaled to source complexity instead of one fixed
    number for every model. A flat budget hits detail-dense sources hardest: on a
    ratio basis, decimating a 2.5M-tri architectural model (window lattices, roof
    tiles) down to a fixed 120k is a 4.8% retain — while a 90k-tri simple terrain
    tile keeps 100%. The LaplacianSmooth pass right after this (see make_proxy)
    melts fine RELIEF into a normal map on purpose (anti-theft), but it can't fake
    topology — a collapsed window opening stays collapsed no matter how good the
    normal map is — so triangle count is what keeps small openings/features
    resolvable on the busiest sources, not just "smoothness".

    Formula: retainRatio of the source, floored at triangleBudget (today's flat
    number — keeps small/typical sources decimating exactly as before, since the
    floor wins whenever src_tris * retainRatio < triangleBudget) and capped at
    triangleBudgetCeiling (protects the 20-min bake timeout / worker throughput on
    the very densest sources — the single-worker queue means every extra minute
    here is a minute added to every OTHER upload's wait, not just this one's).

    Defaults (retainRatio=0.09, ceiling=200000) were originally chosen from real
    production proxy_report data on the actual "Japan houses" set (see incident
    notes): its densest part was baking at 4.8% retain under the old flat 120k;
    9% roughly doubled that while keeping the ceiling well within the timeout
    margin those same real bakes showed (~50-90s wall time, non-decimate stages
    dominated by proxy triangle count — see max_surface_displacement and the UV
    unwrap, neither of which scale cheaply past a few hundred k triangles). A
    prior attempt at a 30%-retain FLOOR (no ceiling) was bake-tested against the
    real 2.5M-tri source and did not complete in a reasonable time even locally.

    Raised 2026-08-18 to retainRatio=0.22 (per-user decision to keep more detail —
    was too aggressively decimated at 9%) with ceiling raised only to 300000, NOT
    scaled proportionally (0.22/0.09 would imply ~490k) — this deliberately keeps
    the worst case for the known pathological 2.5M-tri source well clear of the
    30%/750k configuration that already failed to complete, while still giving
    every source below ~1.36M tris (300000/0.22) the full 22% retain. If a future
    source times out at this ceiling, lower triangleBudgetCeiling (or raise
    bakeTimeoutMinutes) rather than assuming 0.22 is universally safe — it has not
    been re-tested against the 2.5M-tri case at this ratio."""
    floor_budget = int(CFG.get("triangleBudget", 40000))
    retain_ratio = float(CFG.get("triangleRetainRatio", 0.09))
    ceiling_budget = max(floor_budget, int(CFG.get("triangleBudgetCeiling", 200000)))
    ratio_budget = int(round(src_tris * retain_ratio))
    budget = max(floor_budget, min(ratio_budget, ceiling_budget))
    REPORT["triangleBudgetFloor"] = floor_budget
    REPORT["triangleRetainRatio"] = retain_ratio
    REPORT["triangleBudgetCeiling"] = ceiling_budget
    REPORT["triangleBudgetEffective"] = budget
    return budget


def make_proxy(src, src_tris):
    """Duplicate the source and reduce it to the (adaptive) triangle budget. Returns
    (proxy, strategy)."""
    budget = compute_adaptive_budget(src_tris)

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
                lambda_val = max(0.0, float(CFG.get("proxySmoothLambda", 1.0)))
                sm.lambda_factor = lambda_val
                sm.lambda_border = 0.0
                sm.use_volume_preserve = True
                sm.use_normalized = True
                # Read the value BEFORE modifier_apply — apply() folds the modifier
                # into mesh data and frees it, so `sm` is a dangling reference
                # afterward; reading sm.lambda_factor post-apply returned garbage
                # (e.g. 2.95e-41) instead of the real value.
                bpy.ops.object.modifier_apply(modifier=sm.name)
                REPORT["proxySmoothMethod"] = "laplacian-volume-preserve"
                REPORT["proxySmoothLambda"] = lambda_val
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
            factor_val = max(0.0, min(1.0, float(CFG.get("proxySmoothFactor", 0.5))))
            sm.factor = factor_val
            sm.iterations = smooth_iters
            bpy.ops.object.modifier_apply(modifier=sm.name)
            REPORT["proxySmoothMethod"] = "smooth-legacy"
            REPORT["proxySmoothFactor"] = factor_val
        REPORT["proxySmoothIterations"] = smooth_iters
    else:
        REPORT["proxySmoothIterations"] = 0
        REPORT["proxySmoothMethod"] = "none"
        warn("Proxy smoothing DISABLED — geometry keeps printable detail (weak protection).")

    # Clean up degenerate geometry before this mesh goes anywhere near the emboss
    # boolean. The weld (remove_doubles, in preprocess()) and DECIMATE/LAPLACIANSMOOTH
    # above can each leave zero-area/near-zero-length sliver faces behind — welding
    # collapses some verts of a triangle but not all of them, decimate COLLAPSE can
    # leave a razor-thin leftover at a seam, and volume-preserving smoothing on the
    # now-connected (post-weld) topology can pinch faces down further. The emboss
    # boolean's EXACT solver is precision-sensitive: fed a sliver right where the
    # "PREVIEW" cutter crosses it, it doesn't cleanly carve — it leaves a fragment of
    # the cutter unresolved, which shows up as a long thin strand poking OUT of the
    # surface instead of a carved-in recess (the bug this fixes). dissolve_degenerate
    # removes those slivers; delete_loose sweeps up any resulting orphaned verts/edges.
    deselect_all()
    proxy.select_set(True)
    set_active(proxy)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        bpy.ops.mesh.dissolve_degenerate(threshold=1e-4)
    except Exception as e:
        warn("Post-smooth dissolve_degenerate failed (continuing): " + str(e))
    try:
        bpy.ops.mesh.delete_loose(use_verts=True, use_edges=True, use_faces=False)
    except Exception as e:
        warn("Post-smooth delete_loose failed (continuing): " + str(e))
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")

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


def bake_pass(src, proxy, img, bake_type, samples, cage_extrusion, max_ray_distance,
              extra=None, denoise=False):
    """Run one selected-to-active bake from src onto proxy's active image node.
    cage_extrusion/max_ray_distance are precomputed (see bake_maps) so every pass
    reaches the source detail regardless of how far smoothing moved the surface.

    denoise=True runs Cycles' CPU OpenImageDenoise pass over the bake — AO/colour
    passes at low sample counts show visible Monte-Carlo noise ("TV static") on
    detailed/crevice-heavy geometry, and this cleans it up without needing more
    samples (which would cost more bake time). NEVER set this for the normal-map
    pass: it's a data pass (tangent-space vectors), not a colour image, and
    denoising it would corrupt the encoded directions."""
    scene = bpy.context.scene
    scene.cycles.samples = max(1, int(samples))
    scene.cycles.use_denoising = bool(denoise)
    if denoise:
        try:
            scene.cycles.denoiser = "OPENIMAGEDENOISE"  # only CPU-available option here
        except Exception:
            pass

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
    bake_pass(src, proxy, ao_img, "AO", ao_samples, cage, ray, denoise=True)
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
                      extra=dict(pass_filter={"COLOR"}), denoise=True)
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


# --------------------------------------------------------------------------- #
# Emboss watermark — entry point + styles
# --------------------------------------------------------------------------- #

def emboss_watermark(proxy):
    """Emboss the watermark string into the PREVIEW proxy GEOMETRY so a mesh-rip
    carries the mark. Two styles (embossStyle):

      • "pillars" (default): N text placements (embossPillarCount, default 4), evenly
        spaced around the model, each climbing bottom→top (embossOrientation=
        "vertical", the default) on a real raycast-located flat patch of each wall.
        By default (embossThroughHoles=true) these are genuine THROUGH-HOLES — real
        extruded letters booleaned out of the proxy, deep enough to fully perforate
        the local material (see _emboss_pillars/_measure_thickness_mm) — rather than
        a shallow shaded recess; set embossThroughHoles=false for the older, boolean-
        free vertex-displacement relief instead. Letter size (embossPillarWidthFrac,
        default 0.32 of the footprint) and, for holes, cut depth both scale with the
        model rather than a fixed size.
      • "bands": the older placement — four upright bands hugging the bottom edge,
        always a boolean.

    "bands", and "pillars" when embossThroughHoles=true, drive a boolean against the
    proxy: DIFFERENCE (engrave/hole, carve the mark into real geometry — can never
    float) or UNION (raised, letters stand proud — bands only; a "raised hole" isn't
    coherent, so pillars' holes always use DIFFERENCE regardless of embossEngrave).
    Engrave is the default for bands because a difference only removes material where
    the cutter meets real mesh, so the mark always sticks to the surface and never
    floats over empty space. The paid STL is never touched. Any error is a warning,
    never a job failure — a bake must never die over the watermark."""
    if not bool(CFG.get("embossWatermarkEnabled", True)):
        REPORT["embossApplied"] = False
        warn("Emboss watermark DISABLED — a mesh-rip carries no mark.")
        return

    text = str(CFG.get("embossWatermarkText", "PREVIEW")).strip()
    if not text:
        REPORT["embossApplied"] = False
        return

    engrave = bool(CFG.get("embossEngrave", True))
    depth_pct = float(CFG.get("embossDepthPct", 1.5))
    inset_pct = float(CFG.get("embossInsetPct", 2.0))
    style = str(CFG.get("embossStyle", "pillars")).strip().lower()

    if style == "bands":
        _emboss_bands(proxy, text, engrave, float(CFG.get("embossHeightPct", 9.0)),
                      depth_pct, inset_pct)
    else:
        _emboss_pillars(proxy, text, engrave, depth_pct, inset_pct)


def _wm_material():
    """Near-black material so the mark READS in the planner. On a boolean difference
    the cutter's material is transferred to the freshly cut recess faces (dark carved
    text); on a union the raised letters carry it directly."""
    wm_mat = bpy.data.materials.new("wm_mat")
    wm_mat.use_nodes = True
    wm_bsdf = wm_mat.node_tree.nodes.get("Principled BSDF")
    if wm_bsdf:
        wm_bsdf.inputs["Base Color"].default_value = (0.02, 0.02, 0.02, 1.0)
        if "Roughness" in wm_bsdf.inputs:
            wm_bsdf.inputs["Roughness"].default_value = 0.75
    return wm_mat


def _apply_wm_boolean(proxy, wm, engrave, text, placement):
    """Boolean the finished watermark operand `wm` onto `proxy` (DIFFERENCE=engrave,
    UNION=raised). Tries the EXACT solver, then retries once with FAST (less robust
    on messy geometry but handles some cases EXACT chokes on, e.g. near-coplanar
    faces in ornate/lattice-heavy models). If BOTH fail, the operand is discarded
    WITHOUT joining it to the proxy: a failed cut must never leave un-subtracted
    cutter geometry sitting on/through the surface — that reads as a visible
    bulge/gouge, not a hole, which defeats the point of the mark. Returns True iff
    a real cut was applied; the caller decides whether to count this wall/placement
    as watermarked. Sets REPORT fields only on success (caller aggregates the
    overall outcome across all placements)."""
    wm.data.materials.clear()
    wm.data.materials.append(_wm_material())

    deselect_all()
    proxy.select_set(True)
    set_active(proxy)

    for solver in ("EXACT", "FAST"):
        mod = proxy.modifiers.new(name="wm_bool", type="BOOLEAN")
        mod.operation = "DIFFERENCE" if engrave else "UNION"
        mod.object = wm
        try:
            mod.solver = solver
        except Exception:
            pass
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
            REPORT["embossMethod"] = "boolean-" + solver.lower() + "-" + ("difference" if engrave else "union")
            if wm.name in bpy.data.objects:
                bpy.data.objects.remove(wm, do_unlink=True)
            REPORT["embossWatermark"] = text
            REPORT["embossPlacement"] = placement
            REPORT["embossApplied"] = True
            return True
        except Exception as e:
            warn("Emboss boolean (%s solver, %s) failed: %s" % (solver, placement, str(e)))
            try:
                proxy.modifiers.remove(mod)
            except Exception:
                pass

    warn("Emboss boolean failed on both solvers for %s — dropping this mark "
         "rather than leaving a visible un-subtracted bulge" % placement)
    if wm.name in bpy.data.objects:
        bpy.data.objects.remove(wm, do_unlink=True)
    return False


_WM_TILE_CACHE = {}


def _watermark_tile_cache_path(text):
    """Disk path for the cached heightmap tile. Lives next to this script (not in
    the per-job OUT_DIR, which gets deleted after every job) so it survives across
    bake jobs on the same worker container. The text is always "PREVIEW" — the
    same tile is reusable across every model forever, so this render (a few
    hundred ms) happens at most once per worker-container lifetime, not once per
    bake, which matters at upload-volume scale."""
    import hashlib
    h = hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]
    cache_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".wm_cache")
    try:
        os.makedirs(cache_dir, exist_ok=True)
        return os.path.join(cache_dir, "wm_tile_%s.png" % h)
    except Exception:
        # No write access next to the script — fall back to the job's own
        # out-dir (loses cross-job caching, still correct for this job).
        return out_path("wm_tile_%s.png" % h)


def _get_watermark_tile(text):
    """Return (png_path, unit_width, unit_height) for one vertically-tileable
    repeat unit of `text + "  "`, rendered flat (font size=1.0) top-down, white
    text on black. Cached in-process and on disk keyed by text."""
    if text in _WM_TILE_CACHE:
        return _WM_TILE_CACHE[text]
    cache_path = _watermark_tile_cache_path(text)
    meta_path = cache_path + ".meta.json"
    if os.path.exists(cache_path) and os.path.exists(meta_path):
        try:
            with open(meta_path) as f:
                meta = json.load(f)
            result = (cache_path, float(meta["w"]), float(meta["h"]))
            _WM_TILE_CACHE[text] = result
            return result
        except Exception:
            pass  # corrupt/partial cache entry — fall through and re-render
    result = _render_watermark_tile(text, cache_path)
    try:
        with open(meta_path, "w") as f:
            json.dump({"w": result[1], "h": result[2]}, f)
    except Exception:
        pass
    _WM_TILE_CACHE[text] = result
    return result


def _render_watermark_tile(text, out_png):
    """Render one flat repeat-unit of `text + "  "` (font size=1.0, not tied to
    any model) top-down onto a black background as white emissive text. Real-
    world scale is applied later, per wall, via the Displace modifier's
    projector transform — this image is dimensionless."""
    made = []
    scene = bpy.context.scene
    saved_camera, saved_world = scene.camera, scene.world
    # This runs mid-pipeline, after src/proxy are already in the scene — a fresh
    # camera+tiny-text-plane sitting near world origin would otherwise be shot
    # from INSIDE or right next to the model itself (both span roughly that
    # region in real mm), photographing the model's own surface instead of the
    # text. Hide everything else in the scene for the duration of this render.
    hidden_prev = {}
    for obj in scene.objects:
        hidden_prev[obj.name] = obj.hide_render
        obj.hide_render = True
    try:
        cur = bpy.data.curves.new(name="wm_tile_curve", type="FONT")
        cur.body = text + "  "
        cur.align_x = "LEFT"
        cur.align_y = "BOTTOM_BASELINE"
        cur.size = 1.0
        o = bpy.data.objects.new("wm_tile_text", cur)
        scene.collection.objects.link(o)
        made.append(o)
        deselect_all()
        o.select_set(True)
        set_active(o)
        bpy.ops.object.convert(target="MESH")
        o = bpy.context.view_layer.objects.active
        me = o.data
        if len(me.vertices) == 0:
            raise RuntimeError("degenerate watermark tile (empty font render?)")
        xs = [v.co.x for v in me.vertices]
        ys = [v.co.y for v in me.vertices]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        w = max(1e-4, max_x - min_x)
        h = max(1e-4, max_y - min_y)

        mat = bpy.data.materials.new("wm_tile_mat")
        mat.use_nodes = True
        nt = mat.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        em.inputs["Strength"].default_value = 1.0
        out_node = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(em.outputs["Emission"], out_node.inputs["Surface"])
        me.materials.append(mat)

        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = 8
        scene.render.film_transparent = False
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGB"
        px_w = 256
        px_h = max(32, int(round(px_w * (h / w))))
        scene.render.resolution_x = px_w
        scene.render.resolution_y = px_h

        world = bpy.data.worlds.new("wm_tile_world")
        world.use_nodes = True
        bg = world.node_tree.nodes.get("Background")
        if bg:
            bg.inputs[0].default_value = (0.0, 0.0, 0.0, 1.0)
            bg.inputs[1].default_value = 1.0
        scene.world = world

        cam_data = bpy.data.cameras.new("wm_tile_cam")
        cam_data.type = "ORTHO"
        cam_data.sensor_fit = "HORIZONTAL"
        pad = 0.08
        cam_data.ortho_scale = w * (1.0 + 2.0 * pad)
        cam = bpy.data.objects.new("wm_tile_cam", cam_data)
        scene.collection.objects.link(cam)
        made.append(cam)
        scene.camera = cam
        cx = (min_x + max_x) / 2.0
        cy = (min_y + max_y) / 2.0
        cam.location = (cx, cy, 10.0)
        cam.rotation_euler = (0.0, 0.0, 0.0)  # looks straight down -Z at the flat text

        scene.render.filepath = out_png
        bpy.ops.render.render(write_still=True)
        if not os.path.exists(out_png):
            raise RuntimeError("watermark tile render produced no file")
        return (out_png, w, h)
    finally:
        for obj in made:
            if obj is not None and obj.name in bpy.data.objects:
                try:
                    bpy.data.objects.remove(obj, do_unlink=True)
                except Exception:
                    pass
        scene.camera, scene.world = saved_camera, saved_world
        for obj in scene.objects:
            if obj.name in hidden_prev:
                obj.hide_render = hidden_prev[obj.name]
        deselect_all()


def _box_support(hx, hy, direction):
    """Half-extent of an axis-aligned XY box (half-dims hx,hy) projected onto a
    unit XY `direction` — how far the box extends from its centre along that
    direction. For the four axis-aligned pillar walls this reduces exactly to
    hy/hx (matching the old hardcoded per-wall table); it also gives the wall's
    real LATERAL width for any azimuth, which the old code never computed at
    all — it only ever searched a fixed ~cap_h-wide column at the wall's literal
    centre point, which is exactly what put a pillar in the middle of a doorway/
    window on real (non-box) building geometry. See _locate_wall_text."""
    return abs(hx * direction.x) + abs(hy * direction.y)


def _build_local_bvh(obj):
    """BVH of `obj`'s mesh in LOCAL coordinates — the same space every vertex
    loop in this file already works in (`vert.co` directly; the proxy carries an
    identity transform by this point, preprocess() having applied rotation/scale
    up front). Built once per emboss pass and reused for every wall's raycasts."""
    from mathutils.bvhtree import BVHTree
    me = obj.data
    me.calc_loop_triangles()
    coords = [v.co.copy() for v in me.vertices]
    tris = [(t.vertices[0], t.vertices[1], t.vertices[2]) for t in me.loop_triangles]
    return BVHTree.FromPolygons(coords, tris)


_MAX_WALL_GRID_CELLS = 30000


def _wall_solidity_grid(bvh, wall_centre, normal, read_axis, read0, read1,
                         cross_axis, cross_half, reach_mm, cell_mm):
    """Raycast a (read x cross) grid of sample points across a candidate
    placement plane, firing each ray from just outside the model back in along
    `-normal`. A cell counts SOLID only if the first thing the ray hits is close
    to the nominal plane (within `reach_mm`) AND that hit's own face normal
    roughly agrees with `normal` — i.e. it's real outward-facing wall material,
    not a window-frame reveal (normal points sideways, into the opening), the
    room's interior surface glimpsed through an open window (normal points the
    wrong way), or wall material the smoothing pass tucked deeper than
    `reach_mm` away.

    This is the direct fix for "assumes a flat solid wall at the bbox edge":
    tested against a real production model with lattice windows on every wall
    (see model 222c8daa, the "Japan houses" set), this grid comes back ~90%
    empty/misaligned almost everywhere except a thin band near the base —
    instead of the old code's blind guess that the whole bbox-edge plane was
    fair game, which is exactly what put a pillar in a doorway opening on one
    wall and scattered it across window mullions on the other three.

    Returns (grid, read_n, cross_n, cell_read, cell_cross); grid[r][c] is a
    bool, r=0 at read0, c=0 at -cross_half. Grid resolution is capped
    (_MAX_WALL_GRID_CELLS) so a very large or very finely-sized model can't
    blow up raycast count — the cell size coarsens proportionally instead."""
    read_n = max(6, int(math.ceil((read1 - read0) / cell_mm)))
    cross_n = max(6, int(math.ceil((cross_half * 2) / cell_mm)))
    if read_n * cross_n > _MAX_WALL_GRID_CELLS:
        scale = math.sqrt((read_n * cross_n) / float(_MAX_WALL_GRID_CELLS))
        cell_mm = cell_mm * scale
        read_n = max(6, int(math.ceil((read1 - read0) / cell_mm)))
        cross_n = max(6, int(math.ceil((cross_half * 2) / cell_mm)))
    cell_read = (read1 - read0) / read_n
    cell_cross = (cross_half * 2) / cross_n
    start = reach_mm * 2.5 + 2.0
    max_dist = start + reach_mm * 3.0
    grid = [[False] * cross_n for _ in range(read_n)]
    for r in range(read_n):
        rd = read0 + (r + 0.5) * cell_read
        base = wall_centre + read_axis * rd
        for c in range(cross_n):
            cr = -cross_half + (c + 0.5) * cell_cross
            origin = base + cross_axis * cr + normal * start
            hit = bvh.ray_cast(origin, -normal, max_dist)
            if hit and hit[0] is not None:
                _loc, hit_n, _idx, dist = hit
                depth = start - dist  # distance from the nominal plane
                if hit_n.dot(normal) > 0.3 and -reach_mm <= depth <= reach_mm:
                    grid[r][c] = True
    return grid, read_n, cross_n, cell_read, cell_cross


def _best_strip(grid, read_n, cross_n, strip_cross_cells, min_coverage):
    """Longest run of rows (the READ axis, the direction the text will run) for
    which some contiguous `strip_cross_cells`-wide window (the CROSS axis, the
    glyph cap-height direction) stays >= min_coverage solid for the whole run.
    Requiring coverage rather than 100% solid absorbs raycast-grid discretisation
    noise and the odd mullion crossing a cell without treating it as a break,
    while a genuine gap (a window, a doorway, the notch between two wings of an
    L-shaped building) still fails every window that overlaps it, because it
    drags the average well below the threshold for its whole width.

    Ties are broken by preferring the window closest to the wall's lateral
    CENTRE. On a uniformly flat wall (the common case) nearly every cross-axis
    window `cs` achieves the exact same max run length, and scanning `cs`
    ascending while only replacing `best` on a STRICTLY longer run always kept
    the very first (leftmost) one it found — the mark would land hard against
    one edge of the wall instead of centred, even though a centred window was
    equally valid the whole time. Real asymmetric geometry (an off-centre run
    genuinely longer than any centred one, e.g. one side of the wall blocked by
    a window) still wins on length as before; centring only breaks true ties.

    Returns (run_len_cells, read_start_cell, cross_start_cell) or None."""
    w = max(1, min(strip_cross_cells, cross_n))
    centre_cs = (cross_n - w) / 2.0
    best = None  # (length, run_start, cs, centre_dist) — centre_dist dropped before returning
    for cs in range(0, cross_n - w + 1):
        usable = []
        for r in range(read_n):
            row = grid[r]
            cnt = 0
            for c in range(cs, cs + w):
                if row[c]:
                    cnt += 1
            usable.append(cnt >= w * min_coverage)
        centre_dist = abs(cs - centre_cs)
        run_start = None
        r = 0
        while r <= read_n:
            if r < read_n and usable[r]:
                if run_start is None:
                    run_start = r
                r += 1
            else:
                if run_start is not None:
                    length = r - run_start
                    if best is None or length > best[0] or (length == best[0] and centre_dist < best[3]):
                        best = (length, run_start, cs, centre_dist)
                    run_start = None
                r += 1
    return best[:3] if best else None


def _find_wall_segments(grid, read_n, cross_n, strip_cross_cells, min_coverage, min_run_cells):
    """Every contiguous run (along the read/Z axis), fixed at the wall's
    LATERAL CENTRE column, that clears `min_run_cells` — the watermark always
    sits in the middle of each wall (2026-08-19, explicit user request: "only
    the middle of each side"), never searching sideways for a longer run
    elsewhere on the wall even if one exists. A gap at the centre (a window,
    a post) still yields multiple segments — one below it, one above — so the
    mark still reaches top-to-bottom through a centred obstruction; it just
    never leaves the centre column to dodge one.

    Returns a list of (run_len_cells, read_start_cell, cross_start_cell) — all
    sharing the same centred cross_start_cell — longest segment first, or []
    if nothing at the centre clears the floor anywhere."""
    w = max(1, min(strip_cross_cells, cross_n))
    cs = max(0, min(int(round((cross_n - w) / 2.0)), cross_n - w))
    usable = []
    for r in range(read_n):
        row = grid[r]
        cnt = sum(1 for c in range(cs, cs + w) if row[c])
        usable.append(cnt >= w * min_coverage)
    runs = []
    run_start = None
    r = 0
    while r <= read_n:
        if r < read_n and usable[r]:
            if run_start is None:
                run_start = r
            r += 1
        else:
            if run_start is not None:
                length = r - run_start
                if length >= min_run_cells:
                    runs.append((length, run_start, cs))
                run_start = None
            r += 1
    runs.sort(key=lambda seg: seg[0], reverse=True)
    return runs


def _select_reach_mm(reach_mm, depth_mm, cap_h):
    """Depth-of-search clamp shared by _locate_wall_text (what counts as a
    'solid, in-reach' raycast hit) and _displace_wall_text (what vertices are
    later close enough to actually select/displace) — they MUST agree, or a
    spot the locator accepts as solid can sit just outside what the displacer
    is willing to grab. Confirmed by testing: computed differently (locator
    using the wall's full reach, displacer using this tighter clamp), a real
    baseboard surface sitting ~11mm inside the nominal wall plane was accepted
    by the locator every time and then excluded by the displacer every time —
    "no nearby vertices" despite a located patch that really was there, just a
    couple of mm past the depth this function clamps to.
    `reach_mm` (up to the wall's full half-depth) is sized for the OLD boolean
    cutter, which needed to reach deep enough to guarantee hitting a wall set
    back from the bounding box; for actual vertex work it only needs to find
    the real surface — the full half-depth would pull in interior geometry far
    from anything visible (a real vertex-count explosion caught in testing:
    one wall alone went from ~600 to ~86,000 verts), so it's capped to a small
    multiple of the recess depth / letter size instead."""
    return min(reach_mm, max(depth_mm * 4.0, cap_h * 0.6))


def _locate_wall_text(bvh, wall_centre, normal, lateral, lateral_half, z0, z1,
                       cap_h, tile_aspect, select_reach_mm, min_coverage, cell_divisor,
                       force_orientation="auto"):
    """Find where on this wall there's actually room for the watermark, trying
    the letter size down a few notches if the nominal one doesn't fit anywhere.

    `force_orientation="vertical"` (the embossOrientation default) restricts the
    search to the bottom→top climb only, even on a wall whose only usable patch
    would otherwise read better horizontally — see _locate_wall_text_at.
    "auto" restores trying both and keeping whichever finds the longer run.

    A facade's only flat band (a baseboard/eave trim — see _locate_wall_text_at)
    is very often THINNER than the "ideal" cap height derived from the model's
    footprint: confirmed against the real "Japan houses" model, the baseboard is
    a clean, almost fully solid ~5-row band, but the nominal letter height
    needed a 6-row window — so every window that includes even one row of the
    window lattice immediately above dragged coverage below threshold almost
    everywhere, leaving only a handful of short, accidental runs instead of the
    long, clean run the baseboard actually offers. Shrinking the window to match
    what's really there fixes this directly (and shrinks the text's own repeat
    period to match, so a short run still shows most of "PREVIEW" rather than a
    fragment) instead of forcing a fixed size onto geometry that doesn't have
    room for it. Stops at the largest size that clears the legibility floor —
    smaller text that reads beats full-size text that's a scatter of fragments.
    `tile_aspect` (the cached watermark tile's width/height, from
    _get_watermark_tile) is what lets _locate_wall_text_at judge "enough run to
    actually read" rather than just "enough run for one glyph row" — see there.
    Every wall should end up with SOME mark: after the normal shrink sequence,
    a final last-resort pass tries the smallest size again with a relaxed
    coverage floor — a smaller, less-ideal patch beats no mark at all on that
    side. Returns a dict (orientation/lateral_centre/z_centre/run_mm/cap_h), or
    None only if the wall truly has zero solid, in-reach material anywhere
    (e.g. a fully open doorway spanning the whole side) — no size/coverage
    combination can cut a hole through empty space."""
    for shrink in (1.0, 0.85, 0.7, 0.55, 0.42, 0.32, 0.24, 0.18, 0.13, 0.1):
        result = _locate_wall_text_at(bvh, wall_centre, normal, lateral, lateral_half,
                                       z0, z1, cap_h * shrink, tile_aspect, select_reach_mm,
                                       min_coverage, cell_divisor, force_orientation)
        if result is not None:
            result["cap_h"] = cap_h * shrink
            return result

    relaxed_coverage = max(0.15, min_coverage * 0.5)
    smallest = cap_h * 0.1
    result = _locate_wall_text_at(bvh, wall_centre, normal, lateral, lateral_half,
                                   z0, z1, smallest, tile_aspect, select_reach_mm,
                                   relaxed_coverage, cell_divisor, force_orientation)
    if result is not None:
        result["cap_h"] = smallest
        return result
    return None


def _locate_wall_text_at(bvh, wall_centre, normal, lateral, lateral_half, z0, z1,
                          cap_h, tile_aspect, select_reach_mm, min_coverage, cell_divisor,
                          force_orientation="auto"):
    """One trial of _locate_wall_text at a fixed `cap_h`. Normally (force_orientation=
    "auto") tries BOTH readable orientations against the real geometry instead of
    assuming "climb straight up the middle of the bbox edge" — a tall clear column
    (the pillar style's original always-vertical look) AND a horizontal run along
    whatever flat band exists — and whichever finds the longer clear run wins, since
    more run length means more of "PREVIEW" actually resolves instead of a fragment
    of one glyph or nothing at all. force_orientation="vertical" skips the horizontal
    search entirely and only ever returns a vertical placement (or None) — the
    through-hole pillars use this so every placement reads as a climbing column,
    never a stray horizontal band on one wall and vertical columns on the rest.

    `select_reach_mm` (the SAME clamped depth _displace_wall_text will later
    select vertices within — see _select_reach_mm) bounds how deep a raycast
    hit may sit and still count as "solid" here. Using the wall's full reach
    instead would find patches _displace_wall_text can't actually reach.

    Returns a dict (orientation/lateral_centre/z_centre/run_mm), or None if
    neither orientation clears the legibility floor anywhere on this wall at
    this cap_h."""
    import mathutils
    up = mathutils.Vector((0.0, 0.0, 1.0))
    cell = max(0.6, cap_h / max(1.0, cell_divisor))
    # One full trip through the tile (period_read_mm — the same period
    # _displace_wall_text samples with) is "PREVIEW  " top to bottom; requiring
    # only cap_h*1.15 (one glyph ROW) passed a run as short as 17mm against a
    # ~44mm period — plenty of real vertices to displace, but only a meaningless
    # fragment of the word (confirmed by rendering it — see git history around
    # this function). Requiring most of a period is what actually makes the
    # located run legible; the shrink loop in _locate_wall_text is what lets a
    # short run still clear this by shrinking the period to match, rather than
    # this floor just failing every wall with a short flat band.
    period_read_mm = max(1e-3, cap_h * tile_aspect)
    min_run_mm = max(cap_h * 1.15, period_read_mm * 0.6)

    grid, read_n, cross_n, cell_read, cell_cross = _wall_solidity_grid(
        bvh, wall_centre, normal, up, z0, z1, lateral, lateral_half, select_reach_mm, cell)

    if os.environ.get("WM_DEBUG"):
        solid_count = sum(1 for row in grid for c in row if c)
        print("WMDEBUG locate read_n=%d cross_n=%d cell_read=%.3f cell_cross=%.3f "
              "select_reach_mm=%.3f solid_total=%d/%d"
              % (read_n, cross_n, cell_read, cell_cross, select_reach_mm,
                 solid_count, read_n * cross_n))

    # Vertical: read axis = Z (the original climb), cross axis = lateral.
    vert_w = max(1, int(math.ceil(cap_h * 0.96 / cell_cross)))
    vert = _best_strip(grid, read_n, cross_n, vert_w, min_coverage)
    vert_mm = vert[0] * cell_read if vert else 0.0

    # Horizontal: transpose so lateral becomes the read axis and Z the cross axis.
    # Skipped entirely when the caller forces vertical-only — every placement should
    # read as a climbing column, not a stray horizontal band on whichever wall
    # happened to have a wider-than-tall patch.
    if force_orientation == "vertical":
        horiz, horiz_mm = None, 0.0
    else:
        grid_t = [[grid[r][c] for r in range(read_n)] for c in range(cross_n)]
        horiz_w = max(1, int(math.ceil(cap_h * 0.96 / cell_read)))
        horiz = _best_strip(grid_t, cross_n, read_n, horiz_w, min_coverage)
        horiz_mm = horiz[0] * cell_cross if horiz else 0.0

    if os.environ.get("WM_DEBUG"):
        print("WMDEBUG locate vert_w=%d vert=%r vert_mm=%.2f  horiz=%r horiz_mm=%.2f force=%s"
              % (vert_w, vert, vert_mm, horiz, horiz_mm, force_orientation))

    if vert_mm < min_run_mm and horiz_mm < min_run_mm:
        return None

    if horiz_mm >= vert_mm:
        run_len, lat_start, z_start = horiz
        return dict(
            orientation="horizontal",
            lateral_centre=-lateral_half + (lat_start + run_len / 2.0) * cell_cross,
            z_centre=z0 + (z_start + horiz_w / 2.0) * cell_read,
            run_mm=run_len * cell_cross,
        )
    run_len, z_start, lat_start = vert
    return dict(
        orientation="vertical",
        lateral_centre=-lateral_half + (lat_start + vert_w / 2.0) * cell_cross,
        z_centre=z0 + (z_start + run_len / 2.0) * cell_read,
        run_mm=run_len * cell_read,
    )


def _locate_wall_segments_at(bvh, wall_centre, normal, lateral, lateral_half, z0, z1,
                              cap_h, tile_aspect, select_reach_mm, min_coverage, cell_divisor):
    """VERTICAL-ONLY sibling of _locate_wall_text_at that returns EVERY usable
    segment at the wall's LATERAL CENTRE (via _find_wall_segments) instead of
    the single best run anywhere on the wall — see _find_wall_segments for why.
    One trial at a fixed `cap_h`. Returns a list of dicts (orientation=
    'vertical'/lateral_centre/z_centre/run_mm), possibly empty."""
    import mathutils
    up = mathutils.Vector((0.0, 0.0, 1.0))
    cell = max(0.6, cap_h / max(1.0, cell_divisor))
    period_read_mm = max(1e-3, cap_h * tile_aspect)
    min_run_mm = max(cap_h * 1.15, period_read_mm * 0.6)

    grid, read_n, cross_n, cell_read, cell_cross = _wall_solidity_grid(
        bvh, wall_centre, normal, up, z0, z1, lateral, lateral_half, select_reach_mm, cell)

    vert_w = max(1, int(math.ceil(cap_h * 0.96 / cell_cross)))
    min_run_cells = max(1, int(math.ceil(min_run_mm / cell_read)))
    segments = _find_wall_segments(grid, read_n, cross_n, vert_w, min_coverage, min_run_cells)

    if os.environ.get("WM_DEBUG"):
        print("WMDEBUG locate-segments vert_w=%d min_run_cells=%d segments=%r"
              % (vert_w, min_run_cells, segments))

    out = []
    for run_len, z_start, lat_start in segments:
        out.append(dict(
            orientation="vertical",
            lateral_centre=-lateral_half + (lat_start + vert_w / 2.0) * cell_cross,
            z_centre=z0 + (z_start + run_len / 2.0) * cell_read,
            run_mm=run_len * cell_read,
        ))
    return out


def _locate_wall_text_segments(bvh, wall_centre, normal, lateral, lateral_half, z0, z1,
                                cap_h, tile_aspect, select_reach_mm, min_coverage, cell_divisor):
    """Segmented sibling of _locate_wall_text: tries the same shrink sequence
    (progressively smaller sizes, then one last-resort relaxed-coverage pass —
    same "every wall gets SOME mark" guarantee) but returns ALL usable segments
    at the wall's LATERAL CENTRE at whichever size first finds any, instead of
    stopping at one placement anywhere on the wall. This is what makes the
    watermark reach top-to-bottom without leaving the centre: a centred window
    still gets a mark below it AND above it, together spanning close to the
    wall's full extent, rather than the single best run giving up at the first
    gap or drifting sideways to dodge it. VERTICAL orientation only — see
    _locate_wall_segments_at. Returns a list of dicts, possibly empty (only
    when the centre column truly has zero solid material anywhere)."""
    for shrink in (1.0, 0.85, 0.7, 0.55, 0.42, 0.32, 0.24, 0.18, 0.13, 0.1):
        segs = _locate_wall_segments_at(bvh, wall_centre, normal, lateral, lateral_half,
                                         z0, z1, cap_h * shrink, tile_aspect, select_reach_mm,
                                         min_coverage, cell_divisor)
        if segs:
            for s in segs:
                s["cap_h"] = cap_h * shrink
            return segs

    relaxed_coverage = max(0.15, min_coverage * 0.5)
    smallest = cap_h * 0.1
    segs = _locate_wall_segments_at(bvh, wall_centre, normal, lateral, lateral_half,
                                     z0, z1, smallest, tile_aspect, select_reach_mm,
                                     relaxed_coverage, cell_divisor)
    for s in segs:
        s["cap_h"] = smallest
    return segs


def _displace_wall_text(proxy, tile_path, normal, read_axis, height_axis, anchor,
                         run_mm, cap_h, depth_mm, select_reach_mm, engrave, label):
    """Engrave (or raise) one pillar's worth of watermark text by directly
    moving vertices near `anchor` along `normal`, weighted by a cached heightmap
    image sampled in Python — no boolean (can't leave a stray unresolved cutter
    fragment behind on degenerate geometry, the "strand poking out" bug this
    whole rewrite replaced) and no Displace modifier (see the comment above the
    sampling loop below for why: `direction='NORMAL'` shears text into a blob on
    a noisy surface).

    `read_axis` is the direction the text climbs/runs — Z for the original
    vertical-pillar look, or the wall's own in-plane direction for a horizontal
    band; `height_axis` is always the glyph cap-height direction (whichever of
    the two isn't the read axis). `anchor` is the CENTRE of an already-located
    solid patch (see _locate_wall_text) and `run_mm` is how long that patch is
    along `read_axis` — both come from actually measuring the geometry, not
    from the wall's bounding-box centre/full span like the old blind version.
    Proximity-based vertex selection around that anchor means this can't fail
    to find material the way a boolean could fail to find the right cut — it's
    the same selection idea as before, just anchored somewhere real."""
    lateral_reach = max(cap_h * 0.48, 1e-3)
    read_half = max(1e-3, run_mm / 2.0 + max(1e-3, run_mm * 0.06))
    # `select_reach_mm` is pre-clamped by the caller (_select_reach_mm) — the
    # SAME clamp _locate_wall_text used to decide this patch was "solid" in the
    # first place. It must not be recomputed from a wider raw reach here: doing
    # so let the locator accept surfaces the displacer would then reject as
    # just-out-of-reach (see _select_reach_mm's docstring for the failure this
    # caused in testing).
    if os.environ.get("WM_DEBUG"):
        print("WMDEBUG %s anchor=%r normal=%r read_axis=%r height_axis=%r "
              "read_half=%.3f lateral_reach=%.3f select_reach_mm=%.3f run_mm=%.3f"
              % (label, tuple(anchor), tuple(normal), tuple(read_axis), tuple(height_axis),
                 read_half, lateral_reach, select_reach_mm, run_mm))

    def select_near_wall(bm):
        hit = 0
        for v in bm.verts:
            rel = v.co - anchor
            d_normal = rel.dot(normal)
            d_read = rel.dot(read_axis)
            d_height = rel.dot(height_axis)
            near = (-select_reach_mm <= d_normal <= max(2.0, select_reach_mm * 0.3)
                    and abs(d_height) <= lateral_reach
                    and abs(d_read) <= read_half)
            v.select = near
            if near:
                hit += 1
        # Setting vertex .select alone doesn't propagate to edges/faces — ops
        # like subdivide act on selected edges/faces, so without this flush they
        # see nothing to do even though the vertex selection itself looks right.
        bm.select_flush(True)
        return hit

    def select_faces_touching_wall(bm):
        """Bootstrap pass: select whole FACES whose vertex extents straddle the
        target box, rather than individual verts inside it. On a flat, sparsely
        decimated patch (exactly the baseboard/eave bands _locate_wall_text
        finds on busy facades) one huge triangle can legitimately cover the
        whole search box without any of ITS OWN 3 vertices — all out at the
        triangle's far corners — landing inside it, so the plain vertex test
        above finds nothing to subdivide even though the anchor point sits
        right on that triangle's surface (confirmed: this is exactly what
        happened on the "Japan houses" baseboard once the placement search
        started correctly finding it — see the git history around this
        function). A face overlaps the box if it does on EVERY axis (normal/
        read/height), which is guaranteed for the face the locating raycast
        actually hit, since the hit point is a convex combination of that
        face's 3 vertices and therefore lies between their per-axis min/max."""
        hit = 0
        for f in bm.faces:
            d_normals, d_reads, d_heights = [], [], []
            for v in f.verts:
                rel = v.co - anchor
                d_normals.append(rel.dot(normal))
                d_reads.append(rel.dot(read_axis))
                d_heights.append(rel.dot(height_axis))
            overlaps = (
                min(d_normals) <= max(2.0, select_reach_mm * 0.3) and max(d_normals) >= -select_reach_mm
                and min(d_reads) <= read_half and max(d_reads) >= -read_half
                and min(d_heights) <= lateral_reach and max(d_heights) >= -lateral_reach
            )
            if overlaps:
                f.select = True
                for v in f.verts:
                    v.select = True
                hit += 1
        bm.select_flush(True)
        return hit

    try:
        # 1) Locally subdivide until the tight, precise check (select_near_wall)
        #    actually finds vertices to displace — the vertex displacement below
        #    is capped by whatever vertex density exists there (unlike a
        #    boolean, which builds brand-new topology along the cut), and the
        #    decimated proxy's global resolution is too coarse on its own to
        #    resolve letterforms. A flat, sparsely-decimated patch (exactly the
        #    baseboard/eave bands _locate_wall_text finds on busy facades) can
        #    be one or two huge triangles, so a SINGLE fixed subdivide pass
        #    isn't always fine enough — confirmed by testing: one round left
        #    every resulting sub-triangle edge coarser than the tight cross-
        #    axis window, so the tight check found nothing even with real
        #    material right there ("selection vanished after subdivide").
        #    Looping — check density first, stop once it's dense enough, only
        #    bootstrap+subdivide again when it isn't — converges in a couple of
        #    rounds without over-subdividing: sizing the subdivision from the
        #    touching faces' own (possibly huge, possibly tiny) edge lengths was
        #    tried and tended to blast an already-fine patch with the same
        #    aggressive cut count a single huge outlier face needed, exploding
        #    triangle count for no legibility gain (measured: one wall alone
        #    reached 137,000+ selected verts). Stopping at the first NON-EMPTY
        #    selection (rather than a density target) was also tried and
        #    compiles/runs fine, but the vertex spacing that leaves is nowhere
        #    near fine enough to resolve actual letterforms — confirmed by
        #    rendering it: recognisable as "some texture was displaced here",
        #    not as "PREVIEW" (see git history around this function). Requiring
        #    a target vertex COUNT sized from the patch's own area — enough
        #    for a genuinely legible spacing, not just a non-empty selection —
        #    is what actually produces readable text. A fixed, modest per-round
        #    cut (6, ~7x finer each round) applied only as many times as
        #    actually needed keeps triangle growth in check. The FACE-overlap
        #    test (select_faces_touching_wall) is what each round's subdivide
        #    operates on, so a triangle spanning the whole search box still
        #    gets subdivided even though none of its own vertices sit inside
        #    it yet.
        target_spacing = max(0.25, cap_h / 12.0)
        target_count = max(60, int((2 * read_half) * (2 * lateral_reach) / (target_spacing * target_spacing)))
        bpy.ops.object.mode_set(mode="EDIT")
        max_rounds = 7
        n_tight = 0
        for round_i in range(max_rounds + 1):
            bpy.ops.mesh.select_all(action="DESELECT")
            bm = bmesh.from_edit_mesh(proxy.data)
            bm.verts.ensure_lookup_table()
            n_tight = select_near_wall(bm)
            bmesh.update_edit_mesh(proxy.data)
            if n_tight >= target_count or round_i == max_rounds:
                break
            bpy.ops.mesh.select_all(action="DESELECT")
            bm = bmesh.from_edit_mesh(proxy.data)
            bm.verts.ensure_lookup_table()
            n_faces = select_faces_touching_wall(bm)
            bmesh.update_edit_mesh(proxy.data)
            if n_faces == 0:
                if n_tight > 0:
                    break  # nothing left to refine further — use what we have
                bpy.ops.object.mode_set(mode="OBJECT")
                warn("Watermark %s: no nearby geometry found despite a located solid patch, skipping" % label)
                return False
            try:
                bpy.ops.mesh.subdivide(number_cuts=6, smoothness=0)
            except Exception as e:
                warn("Watermark %s subdivide round %d failed (continuing): %s" % (label, round_i, e))
                break
        if os.environ.get("WM_DEBUG"):
            print("WMDEBUG %s final tight select=%d target=%d rounds<=%d" % (label, n_tight, target_count, max_rounds))
        bpy.ops.object.mode_set(mode="OBJECT")

        verts_sel = [v.index for v in proxy.data.vertices if v.select]
        deselect_all()
        proxy.select_set(True)
        set_active(proxy)
        if not verts_sel:
            warn("Watermark %s: selection vanished after subdivide, skipping" % label)
            return False

        # 3) Displace each selected vertex directly, along the wall's single
        #    FIXED outward normal, sampling the cached heightmap by hand instead
        #    of going through a Blender Displace modifier.
        #
        #    This started as a Displace modifier with direction='NORMAL' (each
        #    vertex along its OWN normal) driven by an image Texture through a
        #    projector Empty's OBJECT texture coordinates. Two real problems
        #    with that, found by testing against actual Blender renders:
        #      (a) on a noisy/bumpy surface neighbouring vertices' normals
        #          diverge enough that even correctly-patterned texture values
        #          displace in inconsistent directions, shearing legible text
        #          into an unreadable blob (confirmed: swapping to a fixed
        #          world axis on a test wall immediately resolved the blob into
        #          much cleaner geometry — direction='NORMAL' was the actual
        #          bug, not resolution, tiling width, or anything else tried
        #          first);
        #      (b) Blender's OBJECT-coordinate image sampling turned out to be
        #          centred on the projector's origin (local (0,0) samples the
        #          image CENTRE, not its corner) — an undocumented-enough quirk
        #          that it's simpler to not depend on at all.
        #    Sampling the image in Python and moving vertices directly sidesteps
        #    both: one shared direction per wall (no shear), and a mapping this
        #    file fully controls (no modifier-internals quirk to compensate for).
        #    It also means no Empty object and no Texture datablock — simpler,
        #    matching the point of this rewrite.
        img = bpy.data.images.load(tile_path, check_existing=True)
        tw, th = img.size
        px = img.pixels[:]

        def sample(u, v):
            u %= 1.0  # REPEAT tiling
            v %= 1.0
            xi = min(tw - 1, int(u * tw))
            yi = min(th - 1, int(v * th))
            i = (yi * tw + xi) * 4
            return px[i]  # R channel; image is greyscale (R=G=B)

        # U (read axis) = the reading direction, one tile = one "PREVIEW  "
        # period, derived from the tile's own aspect ratio so glyphs never
        # distort. V (height axis) = the glyph cap-height direction, one tile =
        # cap_h exactly, centred on the anchor (+0.5).
        period_read_mm = max(1e-3, cap_h * (tw / max(th, 1e-6)))
        strength = -depth_mm if engrave else depth_mm
        me = proxy.data
        for i in verts_sel:
            vert = me.vertices[i]
            rel = vert.co - anchor
            u = rel.dot(read_axis) / period_read_mm
            v = rel.dot(height_axis) / cap_h + 0.5
            val = sample(u, v)
            vert.co = vert.co + normal * (strength * val)
        me.update()
        return True
    finally:
        # Nothing extra to clean up — no Empty/Texture/vertex-group objects are
        # created by this approach (that was the boolean/Displace-modifier
        # version's overhead), just verts moved directly on `proxy` itself.
        deselect_all()
        proxy.select_set(True)
        set_active(proxy)


def _measure_thickness_mm(bvh, anchor, normal, cap_h, max_probe_mm):
    """From `anchor` (a point ON the model's outward surface, as located by
    _locate_wall_text), raycast INWARD along `-normal` to find how far the solid
    material actually extends before the ray exits again — the true local wall/
    model thickness at this exact spot, measured against the real mesh instead of
    assumed from a fixed percentage. This is what lets the through-hole cutter
    (see _build_hole_cutter) reach exactly through whatever's really there: a thin
    wall gets a thin, still fully-through cut; a solid chunk gets a correspondingly
    deep one — the hole SCALES WITH THE MODEL rather than using one depth for
    every shape.

    Two raycasts: the first finds the near (outward) surface itself — should land
    close to `anchor`, which is already on/near the surface, a small start offset
    just covers `anchor` sitting fractionally off the true surface after decimate/
    smooth. The second, fired from just past that hit, finds where the ray exits
    the solid it just entered — the near wall's OWN back face if the model is a
    hollow shell, or the model's opposite outer surface if solid all the way
    through. Either is correct: "through the model" means through whatever
    material is actually in the way, not an arbitrary fixed depth.

    Returns thickness in mm, or None if no exit surface is found within
    `max_probe_mm` (pathological/very thick geometry — caller skips this wall
    rather than guessing a depth)."""
    eps = 0.05
    start = max(2.0, cap_h * 0.1)
    origin = anchor + normal * start
    hit1 = bvh.ray_cast(origin, -normal, start + max_probe_mm)
    if not hit1 or hit1[0] is None:
        return None
    loc1, _n1, _i1, dist1 = hit1
    remaining = start + max_probe_mm - dist1 - eps
    if remaining <= 0:
        return None
    hit2 = bvh.ray_cast(loc1 - normal * eps, -normal, remaining)
    if not hit2 or hit2[0] is None:
        return None
    loc2 = hit2[0]
    thickness = (loc2 - loc1).length
    return thickness if thickness > 1e-3 else None


def _build_hole_cutter(text, tile_aspect, read_axis, height_axis, normal, anchor,
                        cap_h, run_mm, thickness_mm, outside_mm, safety_mm, label):
    """Build one wall's through-hole cutter: real extruded letter geometry (not a
    heightmap-driven displacement) so a boolean DIFFERENCE against the proxy
    actually removes material — a genuine perforation, not a shallow relief. Sized
    and oriented from the same real, raycast-located wall patch _locate_wall_text
    already found; depth comes from `thickness_mm` (see _measure_thickness_mm) plus
    `safety_mm` so the cut reliably clears the far surface even on a slightly noisy
    mesh, never leaving a paper-thin unresolved sliver of material behind, plus
    `outside_mm` so it also starts cleanly outside the (possibly slightly-off)
    located surface.

    `read_axis`/`height_axis` come from the caller (forced to world-up/lateral for
    the vertical-only placements this is built for). Because a font curve's
    natural reading direction is its own local X and its extrude axis is local Z,
    the returned object's rotation is built directly from these three world axes
    as the COLUMNS of a 3x3 matrix rather than Euler angles — exact by
    construction, no gimbal ambiguity — and it naturally rotates every glyph 90°
    into the 'reads sideways, climbs upward' spine-label look the vertical pillars
    have always had.

    Returns the finished (already-a-mesh, already positioned) cutter Object, left
    as a normal scene object for the caller to join with other walls' cutters
    before a single boolean pass."""
    import mathutils

    period_read_mm = max(1e-3, cap_h * tile_aspect)
    repeats = max(1, int(math.ceil(run_mm / period_read_mm)) + 1)
    body = (text + "  ") * repeats

    cur = bpy.data.curves.new(name="wm_hole_curve", type="FONT")
    cur.body = body
    cur.align_x = "CENTER"
    cur.align_y = "CENTER"
    cur.size = cap_h

    total_depth = max(1e-3, outside_mm + thickness_mm + safety_mm)
    extrude = total_depth / 2.0
    cur.extrude = extrude

    safe_label = "".join(c if c.isalnum() else "_" for c in label)
    o = bpy.data.objects.new("wm_hole_" + safe_label, cur)
    bpy.context.scene.collection.objects.link(o)
    deselect_all()
    o.select_set(True)
    set_active(o)
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.view_layer.objects.active

    rot = mathutils.Matrix((
        (read_axis.x, height_axis.x, normal.x),
        (read_axis.y, height_axis.y, normal.y),
        (read_axis.z, height_axis.z, normal.z),
    ))
    # Centred so the cutter's local +Z face sits `outside_mm` proud of the surface
    # and its local -Z face reaches (thickness_mm + safety_mm) past it — see the
    # docstring above.
    centre = anchor + normal * (outside_mm - extrude)
    o.matrix_world = mathutils.Matrix.Translation(centre) @ rot.to_4x4()
    return o


def _emboss_pillars(proxy, text, engrave, depth_pct, inset_pct):
    """Emboss `text` at N wall positions (default 4), evenly spaced around the
    model. Each wall's actual placement is chosen by _locate_wall_text after
    raycast-sampling that wall for real flat, solid, outward-facing material,
    rather than assumed from the model's bounding box.

    Two placement mechanisms, controlled by embossThroughHoles:
      • THROUGH-HOLES (default, embossThroughHoles=true): real extruded letter
        geometry, one boolean DIFFERENCE per wall against the proxy
        (_build_hole_cutter + _apply_wm_boolean, applied per-wall so one wall's
        solver failure can't sink marks already cut cleanly on the others) sized
        to fully perforate the local material at each located spot
        (_measure_thickness_mm) — an actual hole a would-be thief has to notice
        and repair, not a shading trick a render can hide. _apply_wm_boolean
        retries with the FAST solver if EXACT fails; if both fail for a wall,
        that wall's mark is dropped entirely rather than left as a visible
        un-subtracted bulge — a failed cut must never look like anything other
        than a clean hole or nothing at all.
      • RELIEF (embossThroughHoles=false): the original direct vertex-
        displacement approach (_displace_wall_text) — no boolean CSG cut at
        all, so it can't fail the way a boolean solver can on degenerate/sliver
        geometry, but only a shallow shaded recess rather than a real opening.

    embossOrientation="vertical" (default) restricts every placement to a
    bottom→top climb (the classic spine-label look, each glyph rotated 90° into
    the climb — see _build_hole_cutter); "auto" lets each wall pick whichever of
    vertical/horizontal finds the longer legible run, as before.

    Both letter size (embossPillarWidthFrac, of the footprint) and, for holes,
    cut depth (the raycast-measured local thickness) scale with the model
    itself rather than using one fixed size for every shape.

    NOTE: the old spiral twist (embossPillarTwistDeg) is dropped — no clean
    equivalent for either mechanism without a much more involved sheared/curved
    mapping. embossPillarMaxRepeats no longer applies (both mechanisms tile to
    fill whatever run was actually located, not a precomputed repeat count)."""
    import mathutils
    try:
        count = max(1, int(CFG.get("embossPillarCount", 4)))
        width_frac = float(CFG.get("embossPillarWidthFrac", 0.1))
        reach_frac = max(0.05, float(CFG.get("embossPillarReachFrac", 1.0)))
        min_coverage = min(1.0, max(0.05, float(CFG.get("embossWallMinCoverage", 0.65))))
        cell_divisor = max(1.0, float(CFG.get("embossWallCellDivisor", 6.0)))
        orientation_cfg = str(CFG.get("embossOrientation", "vertical")).strip().lower()
        force_orientation = "auto" if orientation_cfg == "auto" else "vertical"
        through_holes = bool(CFG.get("embossThroughHoles", True))
        hole_outside_mm = max(0.0, float(CFG.get("embossHoleOutsideMm", 0.6)))
        hole_safety_mm = max(0.0, float(CFG.get("embossHoleSafetyMm", 0.8)))

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

        hx = dx / 2.0
        hy = dy / 2.0
        depth_mm = max(1e-4, diagp * depth_pct / 100.0)

        # Letter size: a fraction of EACH WALL'S OWN width (not the model's overall
        # footprint minimum) → a narrow side gets proportionately smaller letters,
        # a wide side gets bigger ones, computed per-wall below via
        # _cap_h_for_wall(lateral_half). NOTE what this actually controls for the
        # default "vertical" (climbing) orientation: each glyph is rotated 90° to
        # read bottom-to-top, so cap_h becomes the WIDTH of the text column across
        # the wall, not how far up the wall it reaches — that's governed by the
        # z0/z1 search band below (the actual lever for "full height of the
        # model") plus how much contiguous solid material _locate_wall_text_at
        # finds inside it. The `dz * 0.8` clamp here just stops the column from
        # being clamped back down to a stingy width on tall, narrow walls
        # (ceiling raised 2026-08-19 from 0.64 alongside the z0/z1 change below,
        # both from the same "full height" request) — it does not, by itself,
        # change vertical reach.
        def _cap_h_for_wall(wall_lateral_half):
            wall_width = max(1e-4, wall_lateral_half * 2.0)
            return max(diagp * 0.004, min(wall_width * width_frac, dz * 0.8))

        # Upper bound for _measure_thickness_mm's exit-surface search. Bounded by the
        # model's own bbox diagonal — "through the model" can legitimately mean the
        # whole thing on a solid piece — just enough to stop a degenerate mesh (no
        # exit surface at all) from raycasting forever.
        max_probe_mm = max(diagp, 1.0)

        # Vertical search band the climbing text is allowed to reach into. A
        # PERCENTAGE of this model's own dz (never a fixed mm value), so it
        # automatically scales for any model size — a 20mm miniature and a 2m
        # diorama piece both get a band covering the same fraction of their own
        # height. Shrunk 2026-08-19 from 6%-per-side to embossVerticalMarginFrac
        # (default 1%) per explicit "full height of the model" request — just
        # enough clearance to keep the cutter off the literal top/bottom edge
        # (thin material there may not have room for the hole cutter's entry/
        # exit faces), not enough to visibly shrink the mark's reach. NOTE: this
        # sets the MAXIMUM possible reach — _locate_wall_text_at still only
        # places the run where it finds actual contiguous solid material within
        # this band, so a wall broken up by windows/lattice may still fall short
        # of the full band on that specific wall; that's a real geometry
        # constraint, not something a margin setting can override without
        # risking a hole cut through empty space.
        v_margin = max(0.0, float(CFG.get("embossVerticalMarginFrac", 0.01)))
        z0 = minz + dz * v_margin
        z1 = maxz - dz * v_margin

        # Evenly-spaced azimuths. For the default 4 this is the cardinal
        # +Y/+X/-Y/-X order the old hardcoded table used (kept identical so
        # existing bakes don't shuffle which wall is "wall 0"); for any other
        # count it's N evenly spaced angles. Each wall's centre point and its
        # reach (into the model) / lateral half-extent (across its own face) are
        # then derived uniformly via the box-support function — this REPLACES
        # the old N-gon branch's separate ellipse-inscribed formula with the
        # same exact math the default 4-wall case already implied, and (unlike
        # the old code) actually gives every wall its true lateral width instead
        # of just a fixed narrow search column.
        angles = [0.0, -90.0, 180.0, 90.0] if count == 4 else [
            360.0 * k / count - 90.0 for k in range(count)
        ]

        walls = []
        for ang in angles:
            rad = math.radians(ang)
            normal = mathutils.Vector((-math.sin(rad), math.cos(rad), 0.0))
            lateral = mathutils.Vector((math.cos(rad), math.sin(rad), 0.0))
            reach_depth = _box_support(hx, hy, normal)
            lateral_half = _box_support(hx, hy, lateral)
            wx = cx + normal.x * reach_depth
            wy = cy + normal.y * reach_depth
            walls.append((normal, lateral, (wx, wy), reach_depth, lateral_half))

        tile_path, tile_w, tile_h = _get_watermark_tile(text)
        tile_aspect = max(1e-3, tile_w / max(tile_h, 1e-6))
        # _get_watermark_tile builds/removes its own temp objects and can leave no
        # active object behind — _displace_wall_text needs `proxy` active to enter
        # edit mode for its vertex selection.
        deselect_all()
        proxy.select_set(True)
        set_active(proxy)

        bvh = _build_local_bvh(proxy)

        applied = 0
        holes_attempted = 0
        holes_cut = 0
        walls_covered = 0  # walls with >=1 successful mark — distinct from `applied`,
        # which now counts individual holes and can exceed the wall count once a
        # wall picks up more than one segment.
        placements = []
        cap_h_per_wall = []
        up = mathutils.Vector((0.0, 0.0, 1.0))
        for i, (normal, lateral, (wx, wy), reach_depth, lateral_half) in enumerate(walls):
            # Sized to THIS wall's own width, not the model's overall footprint —
            # see _cap_h_for_wall.
            cap_h = _cap_h_for_wall(lateral_half)
            cap_h_per_wall.append(round(cap_h, 3))
            reach_mm = max(1e-4, reach_depth * reach_frac)
            # Computed ONCE and used for both the search (_locate_wall_text) and
            # the actual selection (_displace_wall_text) — they must agree, see
            # _select_reach_mm's docstring for the bug this fixes.
            select_reach_mm = _select_reach_mm(reach_mm, depth_mm, cap_h)
            wall_centre = mathutils.Vector((wx, wy, 0.0))
            label = "wall %d" % i

            if through_holes and force_orientation == "vertical":
                # Segmented placement, fixed to the wall's LATERAL CENTRE (never
                # searches sideways for a better spot — explicit user request):
                # every usable solid run in that centre column gets its own
                # hole, not just the single best one. This is what lets the
                # mark reach top-to-bottom through a centred obstruction (a run
                # below a window AND a separate run above it) instead of
                # stopping at the first gap. See _locate_wall_text_segments.
                segs = _locate_wall_text_segments(bvh, wall_centre, normal, lateral, lateral_half,
                                                   z0, z1, cap_h, tile_aspect, select_reach_mm,
                                                   min_coverage, cell_divisor)
                if not segs:
                    warn("Watermark %s: no solid material found ANYWHERE on this wall "
                         "(%.0fmm wide) even at minimum size — this side gets no mark"
                         % (label, lateral_half * 2))
                    placements.append("skipped")
                    continue

                wall_cut = 0
                for seg_i, loc in enumerate(segs):
                    anchor = wall_centre + lateral * loc["lateral_centre"] \
                        + mathutils.Vector((0.0, 0.0, loc["z_centre"]))
                    seg_label = "%s seg%d/%d" % (label, seg_i + 1, len(segs))
                    thickness_mm = _measure_thickness_mm(bvh, anchor, normal, loc["cap_h"], max_probe_mm)
                    if thickness_mm is None:
                        warn("Watermark %s: couldn't measure a local thickness (no far surface "
                             "found within %.0fmm), skipping this segment" % (seg_label, max_probe_mm))
                        placements.append("no-thickness (%s)" % seg_label)
                        continue
                    cutter = _build_hole_cutter(
                        text, tile_aspect, up, lateral, normal, anchor,
                        loc["cap_h"], loc["run_mm"], thickness_mm, hole_outside_mm,
                        hole_safety_mm, seg_label)
                    holes_attempted += 1
                    # Cut THIS segment's hole right away (per-segment boolean) —
                    # a solver failure on one segment must not sink marks that
                    # already cut cleanly elsewhere (same reasoning as per-wall
                    # booleans below, just one level finer).
                    if _apply_wm_boolean(proxy, cutter, True, text,
                                          "vertical-pillars-hole-%d-seg%d" % (i, seg_i)):
                        applied += 1
                        holes_cut += 1
                        wall_cut += 1
                        placements.append("vertical@%.1fmm thru=%.1fmm (%s)"
                                           % (loc["cap_h"], thickness_mm, seg_label))
                    else:
                        placements.append("boolean-failed (%s)" % seg_label)
                if wall_cut > 0:
                    walls_covered += 1
                continue

            loc = _locate_wall_text(bvh, wall_centre, normal, lateral, lateral_half,
                                     z0, z1, cap_h, tile_aspect, select_reach_mm,
                                     min_coverage, cell_divisor, force_orientation)
            if loc is None:
                # _locate_wall_text already tried every size down to a last-resort
                # relaxed-coverage attempt — this only fires if the wall truly has
                # zero solid material anywhere (e.g. an open doorway spanning the
                # whole side). Real walls with any frame/baseboard/mullion should
                # always find something.
                warn("Watermark %s: no solid material found ANYWHERE on this wall "
                     "(%.0fmm wide) even at minimum size — this side gets no mark"
                     % (label, lateral_half * 2))
                placements.append("skipped")
                continue

            anchor = wall_centre + lateral * loc["lateral_centre"] \
                + mathutils.Vector((0.0, 0.0, loc["z_centre"]))
            if loc["orientation"] == "horizontal":
                read_axis, height_axis = lateral, up
            else:
                read_axis, height_axis = up, lateral

            if through_holes:
                # force_orientation == "auto" here (embossOrientation override) —
                # the segmented path above only handles the vertical-only default.
                thickness_mm = _measure_thickness_mm(bvh, anchor, normal, loc["cap_h"], max_probe_mm)
                if thickness_mm is None:
                    warn("Watermark %s: couldn't measure a local thickness (no far surface found "
                         "within %.0fmm), skipping" % (label, max_probe_mm))
                    placements.append("no-thickness")
                    continue
                cutter = _build_hole_cutter(
                    text, tile_aspect, read_axis, height_axis, normal, anchor,
                    loc["cap_h"], loc["run_mm"], thickness_mm, hole_outside_mm,
                    hole_safety_mm, label)
                holes_attempted += 1
                if _apply_wm_boolean(proxy, cutter, True, text, "vertical-pillars-hole-%d" % i):
                    applied += 1
                    holes_cut += 1
                    walls_covered += 1
                    placements.append("%s@%.1fmm thru=%.1fmm" % (loc["orientation"], loc["cap_h"], thickness_mm))
                else:
                    placements.append("boolean-failed")
            elif _displace_wall_text(proxy, tile_path, normal, read_axis, height_axis,
                                      anchor, loc["run_mm"], loc["cap_h"], depth_mm, select_reach_mm,
                                      engrave, label):
                applied += 1
                walls_covered += 1
                placements.append("%s@%.1fmm" % (loc["orientation"], loc["cap_h"]))
            else:
                placements.append("failed")

        if through_holes:
            # Aggregate outcome across all per-wall booleans (each call above may
            # have overwritten embossMethod/embossApplied with its own result).
            if holes_attempted == 0:
                REPORT["embossMethod"] = "holes-none-located"
            elif holes_cut == 0:
                REPORT["embossMethod"] = "holes-all-failed"
            else:
                REPORT["embossMethod"] = "boolean-per-wall"
            REPORT["embossApplied"] = holes_cut > 0
        else:
            REPORT["embossMethod"] = "displace"
            REPORT["embossApplied"] = applied > 0

        REPORT["embossPillarCount"] = count
        # One nominal size per wall now (proportionate to that wall's own width),
        # not a single shared value — see _cap_h_for_wall.
        REPORT["embossPillarCapHeightMmPerWall"] = cap_h_per_wall
        REPORT["embossWatermark"] = text
        REPORT["embossPlacement"] = "vertical-pillars-%d" % count
        REPORT["embossOrientationCfg"] = orientation_cfg
        REPORT["embossWallPlacements"] = placements
        REPORT["embossWallsCovered"] = walls_covered
        REPORT["embossHolesTotal"] = applied  # individual holes; can exceed embossPillarCount
        # now that a single wall can carry more than one segment
        if walls_covered == 0:
            warn("Watermark applied to 0 of %d walls" % count)
        elif walls_covered < count:
            warn("Watermark applied to only %d of %d walls" % (walls_covered, count))
    except Exception as e:
        warn("Emboss pillars failed (continuing without it): " + str(e))
        REPORT["embossApplied"] = False
    finally:
        deselect_all()
        proxy.select_set(True)
        set_active(proxy)


def _emboss_bands(proxy, text, engrave, height_pct, depth_pct, inset_pct):
    """Legacy placement: four upright bands hugging the model's BOTTOM EDGE on all
    four sides. Kept as a fallback (embossStyle="bands")."""
    import mathutils

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

        deselect_all()
        for o in made:
            o.select_set(True)
        set_active(made[0])
        bpy.ops.object.join()
        wm = bpy.context.view_layer.objects.active
        made = [wm]

        cut_ok = _apply_wm_boolean(proxy, wm, engrave, text, "bottom-edge-4-sides")
        REPORT["embossApplied"] = cut_ok
        made = []
    except Exception as e:
        warn("Emboss watermark failed (continuing without it): " + str(e))
        REPORT["embossApplied"] = False
    finally:
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


def remove_boolean_debris(proxy, diag):
    """Drop any small disconnected mesh island left on `proxy` — a boolean cut
    (the watermark emboss, primarily) can sever a thin sliver of material into a
    fragment that's no longer attached to the main shell, which reads as visible
    debris floating near the surface even though the cut itself succeeded (a
    real defect confirmed on a production bake: a corner of a wall next to a
    watermark hole came away as a free-floating shard not present in the source).
    Always keeps the single largest island; anything else under the size floor
    is deleted. `proxy`'s object identity is preserved throughout — later
    pipeline steps hold a direct reference to it — by repointing `proxy.data` at
    the largest island's mesh instead of assuming `proxy` itself kept it.
    Best-effort: any failure here just leaves the mesh as-is, same as every
    other "never fail the bake over cleanup" step in this file."""
    import mathutils
    min_diag_frac = float(CFG.get("debrisIslandMinDiagFrac", 0.03))
    min_faces = int(CFG.get("debrisIslandMinFaces", 30))
    try:
        before = set(bpy.data.objects.keys())
        deselect_all()
        proxy.select_set(True)
        set_active(proxy)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.separate(type="LOOSE")
        bpy.ops.object.mode_set(mode="OBJECT")

        after = set(bpy.data.objects.keys())
        new_names = after - before
        pieces = [proxy] + [bpy.data.objects[n] for n in new_names if n in bpy.data.objects]
        if len(pieces) <= 1:
            return  # nothing was actually disconnected — the common, expected case

        def piece_diag(o):
            corners = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
            xs = [c.x for c in corners]
            ys = [c.y for c in corners]
            zs = [c.z for c in corners]
            return math.sqrt((max(xs) - min(xs)) ** 2 + (max(ys) - min(ys)) ** 2
                              + (max(zs) - min(zs)) ** 2)

        pieces.sort(key=lambda o: len(o.data.polygons), reverse=True)
        main = pieces[0]
        threshold = diag * min_diag_frac
        keep, debris = [], []
        for o in pieces[1:]:
            if piece_diag(o) < threshold or len(o.data.polygons) < min_faces:
                debris.append(o)
            else:
                keep.append(o)  # not obviously debris — a human should look, not lose it silently

        dropped_faces = sum(len(o.data.polygons) for o in debris)
        for o in debris:
            bpy.data.objects.remove(o, do_unlink=True)

        # If the largest island ended up as a NEW object (not `proxy` itself),
        # repoint `proxy` at its mesh data rather than joining into whatever
        # (possibly debris-sized) data `proxy` happened to keep after separate.
        if main is not proxy:
            old_data = proxy.data
            proxy.data = main.data
            bpy.data.objects.remove(main, do_unlink=True)
            if old_data.users == 0:
                bpy.data.meshes.remove(old_data)

        if keep:
            deselect_all()
            for o in keep:
                o.select_set(True)
            proxy.select_set(True)
            set_active(proxy)
            bpy.ops.object.join()

        if debris:
            REPORT["debrisIslandsRemoved"] = len(debris)
            REPORT["debrisFacesRemoved"] = dropped_faces
            warn("Removed %d small disconnected mesh island(s) (%d faces total) — "
                 "likely boolean-cut debris, not real geometry" % (len(debris), dropped_faces))
        if keep:
            warn("Kept %d disconnected island(s) above the debris size floor — "
                 "worth a manual look at this bake's report" % len(keep))
    except Exception as e:
        warn("Boolean-debris cleanup failed (continuing without it): " + str(e))
        try:
            bpy.ops.object.mode_set(mode="OBJECT")
        except Exception:
            pass
    finally:
        deselect_all()
        proxy.select_set(True)
        set_active(proxy)


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
    """Render source vs proxy at the three planner camera distances. QA aid only —
    never shipped to buyers, so it's opt-in via validationRenderEnabled (default
    off). Best-effort when it does run: a render failure is a warning, not a job
    failure."""
    if not CFG.get("validationRenderEnabled", False):
        REPORT["validationRenders"] = 0
        return
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

    with Stage("debris_cleanup"):
        remove_boolean_debris(proxy, diag)

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
