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

    REPORT["proxyTriangles"] = triangle_count(proxy)
    REPORT["remeshStrategy"] = strategy
    return proxy, strategy


def unwrap(proxy):
    """Smart UV Project on the proxy (source UVs are irrelevant for geometry bakes)."""
    deselect_all()
    proxy.select_set(True)
    set_active(proxy)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.02)
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


def bake_pass(src, proxy, img, bake_type, samples, diag, extra=None):
    """Run one selected-to-active bake from src onto proxy's active image node."""
    scene = bpy.context.scene
    scene.cycles.samples = max(1, int(samples))

    ensure_material_with_image(proxy, img)

    bake = scene.render.bake
    bake.use_selected_to_active = True
    # Cage extrusion + max ray distance are the critical quality knobs; both are a
    # percentage of the bbox diagonal so thin geometry can be tuned per-model.
    bake.cage_extrusion = diag * float(CFG.get("bakeExtrusionPct", 0.75)) / 100.0
    bake.max_ray_distance = diag * float(CFG.get("maxRayDistancePct", 1.5)) / 100.0

    # Selection order matters: source(s) selected, proxy active (the target).
    deselect_all()
    src.select_set(True)
    proxy.select_set(True)
    set_active(proxy)

    kwargs = dict(type=bake_type, use_selected_to_active=True,
                  cage_extrusion=bake.cage_extrusion,
                  max_ray_distance=bake.max_ray_distance)
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

    normal_img = new_image("proxy_normal", normal_res)
    # Normal maps are data, not colour — keep them linear so PNG values are exact.
    normal_img.colorspace_settings.name = "Non-Color"
    # Normal bakes need only 1 sample; OpenGL/+Y convention matches glTF (Blender default).
    bake_pass(src, proxy, normal_img, "NORMAL", 1, diag,
              extra=dict(normal_space="TANGENT"))
    save_png(normal_img, "normal.png")

    ao_img = new_image("proxy_ao", ao_res)
    ao_img.colorspace_settings.name = "Non-Color"
    bake_pass(src, proxy, ao_img, "AO", ao_samples, diag)
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
            bake_pass(src, proxy, base_img, "DIFFUSE", 16, diag,
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


def poison_pills(proxy):
    """Make the proxy deliberately un-printable (invisible cost at planner angles):
    delete downward base faces near the table, delete interior faces, and assert
    the result is non-watertight (boundary edges > 0)."""
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
