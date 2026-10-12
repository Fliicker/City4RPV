"""Blender-side batch renderer. Executed by Blender, not regular Python."""

from __future__ import annotations

import json
import math
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


TOOL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL_ROOT / "src"))

from mesh_to_images.geometry import calculate_render_frame  # noqa: E402


def _request_path() -> Path:
    if "--" not in sys.argv:
        raise ValueError("Missing render request after Blender's -- separator")
    arguments = sys.argv[sys.argv.index("--") + 1 :]
    if len(arguments) != 1:
        raise ValueError("Expected exactly one render request JSON path")
    return Path(arguments[0]).resolve()


def _write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def _clear_imported_data() -> None:
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for block in list(collection):
            collection.remove(block)


def _configure_scene() -> bpy.types.Scene:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    if background is not None:
        background.inputs["Color"].default_value = (0.18, 0.18, 0.18, 1.0)
        background.inputs["Strength"].default_value = 0.7
    return scene


def _add_sun(name: str, energy: float, rotation: tuple[float, float, float]) -> None:
    light = bpy.data.lights.new(name=name, type="SUN")
    light.energy = energy
    light.angle = math.radians(18.0)
    obj = bpy.data.objects.new(name, light)
    bpy.context.scene.collection.objects.link(obj)
    obj.rotation_euler = rotation


def _add_lighting() -> None:
    _add_sun("Key", 2.2, (math.radians(28), math.radians(-24), math.radians(-35)))
    _add_sun("Fill", 1.0, (math.radians(62), math.radians(12), math.radians(125)))
    _add_sun("Rim", 0.7, (math.radians(-42), math.radians(18), math.radians(215)))


def _import_vertices(obj_path: Path) -> list[tuple[float, float, float]]:
    bpy.ops.wm.obj_import(
        filepath=str(obj_path),
        forward_axis="NEGATIVE_Y",
        up_axis="Z",
        use_split_objects=True,
        use_split_groups=False,
        validate_meshes=True,
    )
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not mesh_objects:
        raise ValueError(f"OBJ contains no Mesh objects: {obj_path}")
    vertices: list[tuple[float, float, float]] = []
    for obj in mesh_objects:
        world = obj.matrix_world
        vertices.extend(tuple(world @ vertex.co) for vertex in obj.data.vertices)
    if not vertices:
        raise ValueError(f"OBJ contains no vertices: {obj_path}")
    return vertices


def _create_camera() -> bpy.types.Object:
    data = bpy.data.cameras.new("RenderCamera")
    data.type = "ORTHO"
    camera = bpy.data.objects.new("RenderCamera", data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    return camera


def _place_camera(camera: bpy.types.Object, frame) -> None:
    right = Vector(frame.basis.right)
    up = Vector(frame.basis.up)
    backward = Vector(frame.basis.backward)
    centre = Vector(frame.centre)
    location = centre + backward * frame.camera_distance
    camera.matrix_world = Matrix((
        (right.x, up.x, backward.x, location.x),
        (right.y, up.y, backward.y, location.y),
        (right.z, up.z, backward.z, location.z),
        (0.0, 0.0, 0.0, 1.0),
    ))
    camera.data.ortho_scale = frame.ortho_scale
    camera.data.clip_start = frame.clip_start
    camera.data.clip_end = frame.clip_end


def _render_job(job: dict, request: dict) -> dict:
    building_id = job["buildingId"]
    obj_path = Path(job["objPath"])
    output_dir = Path(job["outputDir"])
    if not obj_path.is_file():
        raise ValueError(f"OBJ does not exist: {obj_path}")
    output_dir.mkdir(parents=True, exist_ok=False)

    _clear_imported_data()
    scene = _configure_scene()
    vertices = _import_vertices(obj_path)
    _add_lighting()
    camera = _create_camera()
    render = request["render"]
    view_records = []
    for view in request["views"]:
        frame = calculate_render_frame(
            vertices,
            azimuth_deg=float(view["azimuthDeg"]),
            elevation_deg=float(view["elevationDeg"]),
            pixels_per_metre=float(render["pixelsPerMetre"]),
            margin=float(render["margin"]),
            max_dimension=int(render["maxDimension"]),
            min_dimension=int(render["minDimension"]),
            dimension_multiple=int(render["dimensionMultiple"]),
        )
        _place_camera(camera, frame)
        scene.render.resolution_x = frame.resolution_x
        scene.render.resolution_y = frame.resolution_y
        image_name = f'{view["id"]}.png'
        scene.render.filepath = str(output_dir / image_name)
        bpy.ops.render.render(write_still=True)
        view_records.append({
            "id": view["id"],
            "image": image_name,
            "azimuthDeg": view["azimuthDeg"],
            "elevationDeg": view["elevationDeg"],
            "width": frame.resolution_x,
            "height": frame.resolution_y,
        })

    _write_json(output_dir / "manifest.json", {
        "schemaVersion": 1,
        "artifactType": "multiview-images",
        "buildingId": building_id,
        "views": view_records,
    })
    print(f"Rendered building {building_id} ({len(view_records)} views)", flush=True)
    return {"buildingId": building_id, "manifest": f"{building_id}/manifest.json"}


def main() -> None:
    request_path = _request_path()
    request = json.loads(request_path.read_text(encoding="utf-8"))
    result_path = Path(request["resultPath"])
    try:
        buildings = [_render_job(job, request) for job in request["jobs"]]
        _clear_imported_data()
        _write_json(result_path, {"success": True, "buildings": buildings})
    except Exception:
        error = traceback.format_exc()
        _write_json(result_path, {"success": False, "error": error})
        raise


if __name__ == "__main__":
    main()
