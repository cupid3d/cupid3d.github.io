import json
import argparse
import time
from pathlib import Path
from typing import Dict, Any

import numpy as np
import rerun as rr
from PIL import Image

def log_asset(glb_path: Path, entity_name: str = "model") -> None:
    """Logs a 3D asset from a GLB file to Rerun."""
    if not glb_path.exists():
        print(f"Warning: GLB file not found at '{glb_path}'. Skipping asset logging.")
        return
    rr.log(f"world/{entity_name}", rr.Asset3D(path=str(glb_path)))

def log_transformed_asset(glb_path: Path, transform_matrix: np.ndarray, entity_name: str = "model") -> None:
    """
    Logs a 3D asset with a transformation and scale to Rerun.
    
    Args:
        glb_path: Path to the GLB file
        transform_matrix: 4x4 transformation matrix
        scale: Uniform scale factor to apply to the mesh
        entity_name: Name for the entity in Rerun
    """
    if not glb_path.exists():
        print(f"Warning: GLB file not found at '{glb_path}'. Skipping asset logging.")
        return
    

    # Log the transform with scale incorporated
    rr.log(
        f"world/{entity_name}",
        rr.InstancePoses3D(
            translations=transform_matrix[:3, 3],
            mat3x3=transform_matrix[:3, :3],
        ),
    )
    
    # Log the asset
    rr.log(f"world/{entity_name}", rr.Asset3D(path=str(glb_path)))

def log_camera(c2w_rerun: np.ndarray, intrinsic: np.ndarray) -> None:
    """
    Transforms and logs a camera from OpenCV conventions to the Rerun world.

    Args:
        extrinsic_w2c: The 4x4 world-to-camera matrix (OpenCV convention).
        intrinsic: The 3x3 intrinsic matrix (normalized, for a square image).
    """
    # 1. Invert the w2c matrix to get the camera's pose (c2w) in OpenCV space.
    # c2w_opencv = np.linalg.inv(extrinsic_w2c)

    # # 2. Define the transform from OpenCV world (Y-down) to the Rerun world (Y-up).
    # opencv_to_rerun_transform = np.array([
    #     [1, 0, 0, 0],
    #     [0, 0, 1, 0],
    #     [0, -1, 0, 0],
    #     [0, 0, 0, 1]
    # ])

    # # 3. Pre-multiply the OpenCV c2w pose to get the final pose in Rerun's space.
    # c2w_rerun = opencv_to_rerun_transform @ c2w_opencv

    # Log the corrected camera transform
    rr.log(
        "world/camera",
        rr.Transform3D(
            translation=c2w_rerun[:3, 3],
            mat3x3=c2w_rerun[:3, :3],
        ),
    )

def log_image_and_intrinsics(image_path: Path, intrinsic: np.ndarray) -> None:
    """
    Loads an image, pads it to be square, and logs it along with its
    correctly calculated pinhole intrinsics.
    """
    if not image_path.exists():
        print(f"Warning: Image file not found at '{image_path}'. Skipping image and intrinsic logging.")
        return

    img = Image.open(image_path)
    image_width, image_height = img.size

    # Pad the image to be square for consistent visualization
    max_dim = max(image_width, image_height)
    left = (max_dim - image_width) // 2
    top = (max_dim - image_height) // 2

    # The intrinsic matrix was calculated for a square image.
    # We use the largest dimension of the original image to scale back to pixels.
    fx, fy = intrinsic[0, 0], intrinsic[1, 1]
    cx, cy = intrinsic[0, 2], intrinsic[1, 2]

    focal_length_x = fx * max_dim
    focal_length_y = fy * max_dim
    principal_point_x_px = cx * max_dim - left
    principal_point_y_px = cy * max_dim - top

    rr.log(
        "world/camera",
        rr.Pinhole(
            focal_length=[focal_length_x, focal_length_y],
            principal_point=[principal_point_x_px, principal_point_y_px],
            width=image_width,
            height=image_height,
            aspect_ratio=image_width / image_height,
            image_plane_distance=0.35,
        ),
    )
    rr.log("world/camera/input_image", rr.Image(img))

def main() -> None:
    """
    Main function to run the Rerun visualization for multiple objects in a scene.
    Supports multiple operating modes: save, spawn, serve, or connect.
    """
    parser = argparse.ArgumentParser(description="Visualize multiple 3D models in a scene with Rerun.")
    parser.add_argument("--metadata_path", type=Path, default="metadata.json", help="Path to the metadata JSON file.")
    parser.add_argument("--image_path", type=Path, default="images_crop/input_no_mask.png", help="Path to the input image.")
    parser.add_argument("--output_dir", type=Path, default="static/scene_rrds", help="Directory to save the output RRD file.")
    parser.add_argument("--mode", type=str, default="save", 
                        choices=["save", "spawn", "serve", "connect"],
                        help="Operating mode: 'save' (file), 'spawn' (native viewer), 'serve' (browser), 'connect' (existing viewer)")
    parser.add_argument("--addr", type=str, default="127.0.0.1:9876",
                        help="Address for connect mode (default: 127.0.0.1:9876)")
    args = parser.parse_args()

    # Generate output filename based on metadata path
    metadata_folder_name = args.metadata_path.parent.name
    output_filename = f"{metadata_folder_name}.rrd"
    output_path = args.output_dir / output_filename
    
    # Create output directory if it doesn't exist
    args.output_dir.mkdir(parents=True, exist_ok=True)

    # Initialize Rerun based on mode
    if args.mode == "save":
        print(f"📦 Mode: Save to file")
        recording_id = rr.init("Cupid_visualization", spawn=False, recording_id=metadata_folder_name)
    elif args.mode == "serve":
        print(f"🌐 Mode: Serve - spawning viewer")
        recording_id = rr.init("Cupid_visualization", spawn=True, recording_id=metadata_folder_name)
    elif args.mode == "spawn":
        print(f"🖥️  Mode: Spawn viewer")
        recording_id = rr.init("Cupid_visualization", spawn=True, recording_id=metadata_folder_name)
    elif args.mode == "connect":
        print(f"🔗 Mode: Connect to existing viewer")
        recording_id = rr.init("Cupid_visualization", spawn=False, recording_id=metadata_folder_name)
        rr.connect(args.addr)
    else:
        raise ValueError(f"Unsupported mode.")
    
    print(f"📝 Recording ID: {recording_id}")

    # Set the world coordinate system
    rr.log("world", rr.ViewCoordinates.RIGHT_HAND_Y_UP, static=True)

    try:
        with open(args.metadata_path, "r") as f:
            metadata = json.load(f)
    except FileNotFoundError:
        print(f"Error: Metadata file not found at '{args.metadata_path}'. Exiting.")
        return

    workspace_root = Path(args.metadata_path).parent
    
    # Check if this is a multi-object scene
    if "glb_path" in metadata and isinstance(metadata["glb_path"], list):
        print(f"🎭 Processing multi-object scene with {len(metadata['glb_path'])} objects")
        
        # Process multiple meshes
        first_extrinsic = None
        
        for i in range(len(metadata['glb_path'])):
            mesh_path = workspace_root / f'mesh{i}.glb'
            
            if not mesh_path.exists():
                print(f"⚠️  Warning: mesh{i}.glb not found, skipping...")
                continue
            
            # Get transformation data for this mesh
            RT_mesh = np.array(metadata['pose'][str(i)]['original_extrinsic'])
            RT_news = np.array(metadata['pose'][str(i)]['new_extrinsic'])
            mesh_scale = float(metadata['pose'][str(i)]['scale'])
            
            # Apply scale to translation
            RT_mesh[:3, 3] = RT_mesh[:3, 3] * mesh_scale
            extrinsic = RT_news @ RT_mesh    
            scale_matrix = np.diag([mesh_scale, mesh_scale, mesh_scale, 1.0])
            opencv_to_rerun_transform = np.array([
                    [1, 0, 0, 0],
                    [0, 0, 1, 0],
                    [0, -1, 0, 0],
                    [0, 0, 0, 1]
                ])

            # Camera c2w in Rerun space
            c2w_transform = opencv_to_rerun_transform @ np.linalg.inv(extrinsic)
            if i == 0:
                camera_c2w =  c2w_transform
                intrinsic = np.array(metadata["pose"]["0"]["new_intrinsic"])
            
            log_transformed_asset(mesh_path, camera_c2w @ np.linalg.inv(c2w_transform) @ scale_matrix, entity_name=f"object_{i}")
            print(f"  ✓ Logged object {i} with transform and scale {mesh_scale:.4f}: {mesh_path.name}")
    else:
        # Single object case (fallback to original behavior)
        print(f"📦 Processing single object scene")
        glb_path = workspace_root / 'mesh.glb'
        log_asset(glb_path, entity_name="model")
        
        extrinsic_w2c = np.array(metadata["pose"]["extrinsic"][0])
        intrinsic = np.array(metadata["pose"]["intrinsic"][0])

    # Log camera
    log_camera(c2w_rerun=camera_c2w, intrinsic=intrinsic)
    
    # Log input image
    image_path = workspace_root / args.image_path
    log_image_and_intrinsics(image_path, intrinsic)

    # Save input image to output folder if in save mode
    if args.mode == "save":
        if image_path.exists():
            input_output_path = args.output_dir / f"{metadata_folder_name}_input.png"
            img_input = Image.open(image_path)
            img_input.save(input_output_path)
            print(f"  ✓ Saved input image: {input_output_path}")

    # Handle post-logging actions based on mode
    if args.mode == "save":
        try:
            rr.save(str(output_path))
            print(f"✓ Successfully saved to: {output_path}")
            print(f"  Filename: {output_filename}")
        except Exception as e:
            print(f"✗ Error saving RRD file: {e}")
            return
    elif args.mode == "serve":
        print("\n🌐 Starting web server...")
        print("   Open browser at: http://127.0.0.1:9090")
        print("   Press Ctrl+C to stop")
        
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nShutting down server…")
    else:
        raise ValueError(f"Unsupported mode '{args.mode}'. Choose from 'save' or 'serve'.")

if __name__ == "__main__":
    main()
