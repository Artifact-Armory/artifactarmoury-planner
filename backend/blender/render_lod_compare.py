"""Render GLBs side by side at the planner's three camera distances.

WHY THIS EXISTS
---------------
The planner LOD shipped once with a triangle budget that visibly destroyed the
catalogue, and the reason it got through QA is that file sizes and triangle counts
were checked against the real catalogue while APPEARANCE was only ever checked
against four substitute models from another artist. Numbers cannot catch this
failure on their own: a roof whose tiles have melted into lumpy blobs covers the
same pixels at the same average brightness as the roof that was there before.
Somebody has to look at the actual models.

This is the "look at it" half, driven by scripts/qa-planner-lod.ts. It is a QA aid
only - nothing in the bake pipeline calls it and nothing it produces is shipped.

WHAT IT MATCHES
---------------
The camera convention is bake_proxy.py's render_views(): Blender units are source
mm, so a camera at (distance_m * 1000) units reproduces the planner's apparent size
whatever the piece's real footprint; the view direction is a fixed 3/4 orbit.

Lighting and lens are the PLANNER's, not bake_proxy's dark QA sun, because the
question being asked is what a buyer sees. frontend ThreeStage.tsx sets a
HemisphereLight(sky #dfeaff, ground #4a5260, 1.0) plus directionals at 0.65 / 0.30
/ 0.20, a PerspectiveCamera with a 50 degree VERTICAL fov, and no tone mapping -
hence Blender's Standard view transform here, and a world background at 1/pi of the
hemisphere intensity (Blender integrates a background over the hemisphere, while
three.js applies HemisphereLight as irradiance directly).

Every GLB is framed on the FIRST one's bounding box, so the images are pixel-
comparable and can be flipped between or differenced.

usage:
  blender -b -P render_lod_compare.py -- --glb proxy.glb --glb lod.glb --out DIR
          [--px 1600] [--dist 0.3,2.0,16.0] [--engine EEVEE|CYCLES] [--samples 40]
          [--light planner|bake] [--fov 50] [--az 45] [--el 35] [--clay]
"""
import bpy
import sys
import os
import math
import json
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def opt(name, default=None, multi=False):
    vals = [argv[i + 1] for i, a in enumerate(argv) if a == "--" + name and i + 1 < len(argv)]
    if multi:
        return vals
    return vals[0] if vals else default


glbs = opt("glb", multi=True)
out_dir = opt("out", ".")
px = int(opt("px", 1600))
dists = [float(x) for x in opt("dist", "0.3,2.0,16.0").split(",")]
engine = opt("engine", "EEVEE").upper()
samples = int(opt("samples", 40))
light_mode = opt("light", "planner")
fov_deg = float(opt("fov", 50))
az_deg = float(opt("az", 45))
el_deg = float(opt("el", 35))
clay = "--clay" in argv

if not glbs:
    raise SystemExit("render_lod_compare: need at least one --glb")
os.makedirs(out_dir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

if engine.startswith("CY"):
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.device = "CPU"
else:
    # EEVEE is enough to judge silhouette and surface detail and is far faster,
    # which is what makes rendering the WHOLE catalogue cheap enough to actually do.
    for name in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            scene.render.engine = name
            break
        except TypeError:
            continue
    try:
        scene.eevee.taa_render_samples = samples
    except Exception:
        pass

scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.render.resolution_x = px
scene.render.resolution_y = int(px * 0.75)
scene.render.resolution_percentage = 100
try:
    scene.view_settings.view_transform = "Standard"
except Exception:
    pass


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    return tuple(srgb_to_linear(((h >> s) & 255) / 255.0) for s in (16, 8, 0)) + (1.0,)


world = bpy.data.worlds.new("qa_world")
world.use_nodes = True
nt = world.node_tree
bgn = nt.nodes.get("Background")
scene.world = world

if light_mode == "planner":
    # Hemisphere approximation: sky overhead, ground below, blended across the
    # horizon the way THREE.HemisphereLight blends on the surface normal.
    texco = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    mr = nt.nodes.new("ShaderNodeMapRange")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    nt.links.new(texco.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    mr.inputs["From Min"].default_value = -1.0
    mr.inputs["From Max"].default_value = 1.0
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = hexcol(0x4A5260)
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = hexcol(0xDFEAFF)
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bgn.inputs[0])
    bgn.inputs[1].default_value = 1.0 / math.pi
    # three.js is Y-up, Blender is Z-up: (x, y, z) -> (x, z, y).
    for name, energy, pos in (("key", 0.65, (3, 2, 6)),
                              ("fill", 0.30, (-4, -3, 4)),
                              ("top", 0.20, (0, 0, 8))):
        ld = bpy.data.lights.new("qa_" + name, "SUN")
        ld.energy = energy
        ld.angle = math.radians(8.0)
        obj = bpy.data.objects.new("qa_" + name, ld)
        scene.collection.objects.link(obj)
        aim = -mathutils.Vector(pos).normalized()
        obj.rotation_euler = aim.to_track_quat("-Z", "Y").to_euler()
else:
    bgn.inputs[0].default_value = (0.05, 0.05, 0.06, 1.0)
    bgn.inputs[1].default_value = 1.0
    ld = bpy.data.lights.new("qa_sun", "SUN")
    ld.energy = 3.0
    obj = bpy.data.objects.new("qa_sun", ld)
    scene.collection.objects.link(obj)
    obj.rotation_euler = (math.radians(50), 0.0, math.radians(30))

groups = []
for path in glbs:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    groups.append({"path": path,
                   "meshes": [o for o in new if o.type == "MESH"],
                   "label": os.path.splitext(os.path.basename(path))[0]})

if clay:
    # Strips the baked normal map, leaving raw geometry. Not the acceptance test -
    # buyers see the map - but it isolates whether a difference is geometric.
    mat = bpy.data.materials.new("clay")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.62, 0.60, 0.57, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.65
    for g in groups:
        for o in g["meshes"]:
            o.data.materials.clear()
            o.data.materials.append(mat)

corners = [o.matrix_world @ mathutils.Vector(c)
           for o in groups[0]["meshes"] for c in o.bound_box]
lo = mathutils.Vector((min(c.x for c in corners),
                       min(c.y for c in corners),
                       min(c.z for c in corners)))
hi = mathutils.Vector((max(c.x for c in corners),
                       max(c.y for c in corners),
                       max(c.z for c in corners)))
centre = (lo + hi) / 2.0
diag = (hi - lo).length
print("BBOX %.2f x %.2f x %.2f  diag=%.2f" % (hi.x - lo.x, hi.y - lo.y, hi.z - lo.z, diag))

cam_data = bpy.data.cameras.new("qa_cam")
cam_data.sensor_fit = "VERTICAL"
cam_data.angle_y = math.radians(fov_deg)
cam_data.clip_start = 1.0
cam_data.clip_end = max(diag * 200.0, 1e6)
cam = bpy.data.objects.new("qa_cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

el, az = math.radians(el_deg), math.radians(az_deg)
view_dir = mathutils.Vector((math.cos(el) * math.cos(az),
                             math.cos(el) * math.sin(az),
                             math.sin(el)))

manifest = []
for g in groups:
    for o in bpy.data.objects:
        if o.type == "MESH":
            o.hide_render = True
    for o in g["meshes"]:
        o.hide_render = False
    for dm in dists:
        cam.location = centre + view_dir * (dm * 1000.0)
        look = (centre - cam.location).normalized()
        cam.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
        name = "%s__d%s%s.png" % (g["label"], str(dm).replace(".", "p"), "_clay" if clay else "")
        scene.render.filepath = os.path.join(out_dir, name)
        bpy.ops.render.render(write_still=True)
        manifest.append({"glb": g["path"], "label": g["label"], "distM": dm, "png": name})
        print("RENDERED %s" % name)

with open(os.path.join(out_dir, "manifest.json"), "w") as f:
    json.dump(manifest, f, indent=1)
print("DONE engine=%s" % scene.render.engine)
