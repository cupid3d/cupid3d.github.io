// This file intentionally left blank. The previous attempt to patch demo.js failed because the file was not found. Please ensure the JS file exists before attempting to patch it again.
// demo.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- Modular Viewer State ---
let scene, camera, renderer, controls, raycaster, mouse, ambientLight, directionalLight, axesGroup, ground, gridHelper;
let loader = new GLTFLoader();
let currentModel = null;
let currentImage = null;
let cameraFrustums = [];
let currentHoveredFrustum = null;
let currentHoveredMesh = null;
// let animationTokens = new Map();

// --- Modular Initialization ---
export function initDemoViewer({ containerId = 'viewer', galleryId = 'thumbnailGallery', thumbnailList = [] } = {}) {
    // Setup scene, camera, renderer
    scene = new THREE.Scene();
    // Create camera with temporary aspect; we'll set the real aspect after measuring the container
    camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    // Append canvas early so getBoundingClientRect can measure properly
    container.appendChild(renderer.domElement);
    // Ensure the canvas fills the container visually
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.objectFit = 'cover';
    renderer.domElement.style.display = 'block';
    // Size renderer and camera to match the container's actual size (fallback to window if container has zero size)
    const rect = container.getBoundingClientRect();
    const initW = rect.width > 0 ? rect.width : window.innerWidth;
    const initH = rect.height > 0 ? rect.height : window.innerHeight;
    renderer.setSize(initW, initH);
    camera.aspect = initW / initH;
    camera.updateProjectionMatrix();

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 1;
    controls.maxDistance = 100;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 3.5;

    window.addEventListener('keydown', function(e) {
        if (e.code === 'Space') {
            controls.autoRotate = !controls.autoRotate;
        }
    });

    raycaster = new THREE.Raycaster();
    raycaster.params.Line.threshold = 0.1;
    mouse = new THREE.Vector2();

    ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    directionalLight = new THREE.DirectionalLight(0xffffff, 0.3);
    directionalLight.position.set(5, 10, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -10;
    directionalLight.shadow.camera.right = 10;
    directionalLight.shadow.camera.top = 10;
    directionalLight.shadow.camera.bottom = -10;
    scene.add(directionalLight);

    axesGroup = createGlobalAxes(0.8);
    scene.add(axesGroup);

    camera.position.set(3, 3, 3);
    controls.target.set(0, 1, 0);
    controls.update();

    // Ground plane
    ground = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 10),
        new THREE.MeshPhongMaterial({ color: 0xffffff, side: THREE.DoubleSide, shininess: 10, transparent: true, opacity: 0.5 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.50;
    ground.receiveShadow = true;
    // mark ground so hover/highlight code can ignore it
    ground.userData.isGround = true;
    scene.add(ground);

    gridHelper = new THREE.GridHelper(10, 10, 0xd0d0e0, 0xe0e0f0);
    gridHelper.position.y = -0.49;
    scene.add(gridHelper);

    // Gradient background
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const angle = 115 * Math.PI / 180;
    const x1 = 0;
    const y1 = 512;
    const x2 = 512 * Math.cos(angle);
    const y2 = 512 - 512 * Math.sin(angle);
    const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
    gradient.addColorStop(0, '#265073');
    gradient.addColorStop(0.35, 'rgb(59,130,177)');
    gradient.addColorStop(0.65, 'rgb(187,158,166)');
    gradient.addColorStop(0.85, 'rgb(184,108,130)');
    gradient.addColorStop(1, 'rgb(184,108,130)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);
    const bgTexture = new THREE.CanvasTexture(canvas);
    bgTexture.colorSpace = THREE.SRGBColorSpace;
    bgTexture.minFilter = THREE.LinearFilter;
    bgTexture.magFilter = THREE.LinearFilter;
    renderer.setClearColor(0xffffff, 1);
    scene.background = bgTexture;

    // Animation loop
    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }
    animate();

    window.addEventListener('resize', function() {
        const rect = container.getBoundingClientRect();
        const w = rect.width > 0 ? rect.width : window.innerWidth;
        const h = rect.height > 0 ? rect.height : window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    });

    // Double-click camera animation
    renderer.domElement.addEventListener('dblclick', function(event) {
        // Stop auto-rotate if active
        controls.autoRotate = false;
        // Use canvas bounding rect to compute correct normalized device coords
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(cameraFrustums, true);
        if (intersects.length > 0) {
            let frustumGroup = intersects[0].object;
            while (frustumGroup.parent && !frustumGroup.userData.isClickable) {
                frustumGroup = frustumGroup.parent;
            }
            if (frustumGroup.userData.isClickable) {
                const startPos = camera.position.clone();
                const startQuat = camera.quaternion.clone();
                const startFov = camera.fov;
                const endPos = frustumGroup.userData.cameraPosition;
                const endQuat = frustumGroup.userData.cameraQuaternion;
                const endFov = frustumGroup.userData.cameraFov;
                // Pass the frustum helper so its stored view offset (principal point) is applied during animation
                animateClientCamera(startPos, startQuat, startFov, endPos, endQuat, endFov, 0.8, frustumGroup);
                return; // Frustum double-click takes priority
            }
        }

        // If not frustum, check mesh
        const meshObjects = [];
        scene.traverse(obj => {
            // Skip image planes that belong to camera frustums
            if (obj.isMesh && !obj.userData.isImagePlane) meshObjects.push(obj);
        });
        const meshIntersects = raycaster.intersectObjects(meshObjects, true);
        if (meshIntersects.length > 0) {
            // Animate camera to default view and reset controls
            const startPos = camera.position.clone();
            const startQuat = camera.quaternion.clone();
            const startFov = camera.fov;
            const endPos = new THREE.Vector3(3, 3, 3);

            // Find center of current model/group (default behavior)
            let targetCenter = new THREE.Vector3(0, 1, 0);
            if (currentModel) {
                // Compute bounding box center for group or mesh
                let bbox = new THREE.Box3().setFromObject(currentModel);
                targetCenter = bbox.getCenter(new THREE.Vector3());
            }

            // Look at target center
            const tempCam = new THREE.PerspectiveCamera(75, camera.aspect, camera.near, camera.far);
            tempCam.position.copy(endPos);
            tempCam.up.set(0, 1, 0);
            tempCam.lookAt(targetCenter);
            const endQuat = tempCam.quaternion.clone();
            const endFov = 75;
            animateClientCamera(startPos, startQuat, startFov, endPos, endQuat, endFov);

            // Reset OrbitControls target and up after animation
            setTimeout(() => {
                camera.position.copy(endPos);
                camera.quaternion.copy(endQuat);
                camera.fov = endFov;
                camera.up.set(0, 1, 0);
                camera.updateProjectionMatrix();
                controls.target.copy(targetCenter);
                controls.object.up.set(0, 1, 0);
                controls.update();
            }, 850); // Slightly longer than animation duration
        }
    });

    // Pointer move: highlight frustums in red when hovered
    // Use bounding rect to account for canvas placement/scaling and avoid inaccurate picks
    raycaster.params.Line.threshold = 0.1; // slightly increase line pick tolerance
    renderer.domElement.addEventListener('pointermove', function(event) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(cameraFrustums, true);
        if (intersects.length > 0) {
            let fr = intersects[0].object;
            while (fr.parent && !fr.userData.isFrustum) fr = fr.parent;
            if (fr && fr.userData && fr.userData.isFrustum) {
                if (currentHoveredFrustum !== fr) {
                    if (currentHoveredFrustum) restoreFrustumHover(currentHoveredFrustum);
                    applyFrustumHover(fr);
                    currentHoveredFrustum = fr;
                }
                // When hovering a frustum, ensure any hovered mesh is restored
                if (currentHoveredMesh) {
                    restoreMeshHover(currentHoveredMesh);
                    currentHoveredMesh = null;
                }
                return;
            }
        }
        // not hovering any frustum
        if (currentHoveredFrustum) {
            restoreFrustumHover(currentHoveredFrustum);
            currentHoveredFrustum = null;
        }
        // Raycast meshes (exclude image planes) for hover
        const meshCandidates = [];
        scene.traverse(obj => {
            // Skip image planes and the ground plane
            if (obj.isMesh && !obj.userData.isImagePlane && !obj.userData.isGround) meshCandidates.push(obj);
        });
        const meshIntersects = raycaster.intersectObjects(meshCandidates, true);
        if (meshIntersects.length > 0) {
            const m = meshIntersects[0].object;
            if (currentHoveredMesh !== m) {
                if (currentHoveredMesh) restoreMeshHover(currentHoveredMesh);
                // don't highlight the ground or static helpers
                if (!m.userData.isGround) {
                    applyMeshHover(m);
                    currentHoveredMesh = m;
                } else {
                    currentHoveredMesh = null;
                }
            }
            return;
        }
        if (currentHoveredMesh) {
            restoreMeshHover(currentHoveredMesh);
            currentHoveredMesh = null;
        }
    });

    renderer.domElement.addEventListener('pointerout', function() {
        if (currentHoveredFrustum) {
            restoreFrustumHover(currentHoveredFrustum);
            currentHoveredFrustum = null;
        }
    });

    // Setup thumbnails
    setupThumbnails(thumbnailList, galleryId);

    // Load first thumbnail by default
    if (thumbnailList.length > 0) {
        setTimeout(() => {
            const gallery = document.getElementById(galleryId);
            if (gallery && gallery.firstChild) {
                gallery.firstChild.click();
            }
        }, 100);
    }
}

// --- Helper functions (modularized) ---
function createGlobalAxes(size = 1.5) {
    const axesGroupLocal = new THREE.Group();
    axesGroupLocal.name = 'globalAxesGroup';
    function addAxisLocal(dir, colorHex, labelText, s = 1.0) {
        const dirVec = new THREE.Vector3(dir[0], dir[1], dir[2]).clone().normalize();
        const arrow = new THREE.ArrowHelper(dirVec, new THREE.Vector3(0, 0, 0), s, colorHex, 0.2 * s, 0.12 * s);
        axesGroupLocal.add(arrow);
        const label = makeLabelSprite(labelText, (colorHex === 0xff0000) ? '#ff0000' : (colorHex === 0x00ff00) ? '#00ff00' : '#00a0ff');
        label.scale.set(0.25 * s, 0.25 * s, 0.25 * s);
        label.position.copy(dirVec.clone().multiplyScalar(s * 1.15));
        axesGroupLocal.add(label);
    }
    addAxisLocal([1, 0, 0], 0xff0000, 'X', size);
    addAxisLocal([0, 1, 0], 0x00ff00, 'Y', size);
    addAxisLocal([0, 0, 1], 0x0066ff, 'Z', size);
    return axesGroupLocal;
}
function makeLabelSprite(text, color = '#ffffff') {
    const canvas = document.createElement('canvas');
    const size = 256;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, size, size);
    ctx.font = 'bold 140px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, size / 2, size / 2 + 10);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    return sprite;
}

async function loadGLB(glbPath, transformMatrix = null, scale = 1.0, group = null, entityName = null) {
    // Loads a GLB and applies transform/scale if provided
    return await new Promise((resolve, reject) => {
        loader.load(
            glbPath,
            function (gltf) {
                let model = gltf.scene;
                model.traverse(function (child) {
                    if (child.isMesh) {
                        child.castShadow = true;
                        if (child.material) {
                            const materials = Array.isArray(child.material) ? child.material : [child.material];
                            const newMaterials = materials.map(material => {
                                const basicMaterial = new THREE.MeshBasicMaterial();
                                if (material.color) basicMaterial.color.copy(material.color);
                                if (material.map) basicMaterial.map = material.map;
                                if (material.transparent) {
                                    basicMaterial.transparent = material.transparent;
                                    basicMaterial.opacity = material.opacity;
                                }
                                if (material.side !== undefined) basicMaterial.side = material.side;
                                return basicMaterial;
                            });
                            child.material = Array.isArray(child.material) ? newMaterials : newMaterials[0];
                        }
                    }
                });
                if (transformMatrix) {
                    model.matrixAutoUpdate = false;
                    model.matrix.copy(transformMatrix);
                }
                if (scale !== undefined && scale !== 1.0) {
                    model.scale.set(scale, scale, scale);
                }
                if (group) {
                    group.add(model);
                } else {
                    scene.add(model);
                    currentModel = model;
                }
                controls.update();
                resolve(model);
            },
            undefined,
            function (error) {
                console.error('Error loading GLB:', error);
                reject(error);
            }
        );
    });
}

async function loadGLBFromMetadata(metadata, parentDir) {
    // Implements the Python logic for multi-object and single-object scenes
    let intrinsic = null;
    let extrinsic = null;
    let imagePath = parentDir + '/images_crop/input_no_mask.png';
    if (metadata["glb_path"] && Array.isArray(metadata["glb_path"])) {
        console.log(`🎭 Processing multi-object scene with ${metadata['glb_path'].length} objects`);
        const multiGroup = new THREE.Group();
        multiGroup.name = 'multiObjectGroup';
        let camera_c2w = null;
        for (let i = 0; i < metadata["glb_path"].length; ++i) {
            // if (i >= 1) continue;
            const meshPath = parentDir + '/' + `mesh${i}.glb`;
            // Get transformation data for this mesh
            const pose = metadata["pose"][String(i)];
            if (!pose) continue;
            // Deep copy RT_mesh to avoid mutating input
            const camera_opencv2gl = new THREE.Matrix4().set(
                1, 0, 0, 0,
                0, -1, 0, 0,
                0, 0, -1, 0,
                0, 0, 0, 1
            );
            const world_opencv2gl = new THREE.Matrix4().set(
                1, 0, 0, 0,
                0, 0, 1, 0,
                0, -1, 0, 0,
                0, 0, 0, 1
            );

            let RT_mesh = pose['original_extrinsic'].map(row => row.slice());
            const RT_new = pose['new_extrinsic'];
            const scale = parseFloat(pose['scale']);
            
            const RT_new_mat = new THREE.Matrix4().fromArray(RT_new.flat()).transpose();
            const RT_mesh_mat = new THREE.Matrix4().set(
                RT_mesh[0][0], RT_mesh[0][1], RT_mesh[0][2], RT_mesh[0][3] * scale,
                RT_mesh[1][0], RT_mesh[1][1], RT_mesh[1][2], RT_mesh[1][3] * scale,
                RT_mesh[2][0], RT_mesh[2][1], RT_mesh[2][2], RT_mesh[2][3] * scale,
                RT_mesh[3][0], RT_mesh[3][1], RT_mesh[3][2], RT_mesh[3][3]
            );
            const scale_mat = new THREE.Matrix4().makeScale(scale, scale, scale);
            console.log('RT_new', RT_new_mat);
            console.log('RT_mesh', RT_mesh_mat);
            

            let c2w_transform = new THREE.Matrix4().multiplyMatrices(RT_new_mat, RT_mesh_mat).invert();

            c2w_transform = new THREE.Matrix4().multiplyMatrices(world_opencv2gl, c2w_transform);
            c2w_transform = new THREE.Matrix4().multiplyMatrices(c2w_transform, camera_opencv2gl);
            console.log('c2w_transform before adjustment:', c2w_transform);
            
            if (i == 0) {
                camera_c2w = c2w_transform.clone();
                intrinsic = metadata["pose"]["0"]["new_intrinsic"];
                // ground.scale.set(scale, scale, scale);
                ground.position.y = -0.5 * scale;
                gridHelper.position.y = -0.49 * scale;
            }

            let final_transform = scale_mat;
            final_transform = new THREE.Matrix4().multiplyMatrices(c2w_transform.invert(), final_transform);
            final_transform = new THREE.Matrix4().multiplyMatrices(camera_c2w, final_transform);
            loadGLB(meshPath, final_transform, 1.0, multiGroup, `object_${i}`);
        }

        addCameraFrustum(intrinsic, camera_c2w, imagePath);
        scene.add(multiGroup);
        currentModel = multiGroup;
    } else {
        // Single object case
        console.log(`📦 Processing single object scene`);
        const glbPath = parentDir + '/mesh.glb';
        await loadGLB(glbPath);
        ground.position.y = -0.5;
        gridHelper.position.y = -0.49;
        if (metadata.pose) {
            intrinsic = (metadata.pose["intrinsic"] && metadata.pose["intrinsic"][0]) || metadata.intrinsic;
            extrinsic = (metadata.pose["extrinsic"] && metadata.pose["extrinsic"][0]) || metadata.extrinsic;
        } else {
            intrinsic = metadata.intrinsic;
            extrinsic = metadata.extrinsic;
        }

        // Defensive: unwrap [1,3,3] intrinsic if needed
        if (intrinsic && Array.isArray(intrinsic)) {
            if (intrinsic.length === 1 && Array.isArray(intrinsic[0]) && intrinsic[0].length === 3 && Array.isArray(intrinsic[0][0]) && intrinsic[0][0].length === 3) {
                intrinsic = intrinsic[0];
            }
        }

        const extFlat = extrinsic.flat();
        const w2c = new THREE.Matrix4().set(
            extFlat[0], extFlat[1], extFlat[2], extFlat[3],
            extFlat[4], extFlat[5], extFlat[6], extFlat[7],
            extFlat[8], extFlat[9], extFlat[10], extFlat[11],
            extFlat[12], extFlat[13], extFlat[14], extFlat[15]
        );

        console.log('World to Camera (w2c) matrix:', w2c);

        const c2w = new THREE.Matrix4().copy(w2c).invert();
        const camera_opencv2gl = new THREE.Matrix4().set(
                1, 0, 0, 0,
                0, -1, 0, 0,
                0, 0, -1, 0,
                0, 0, 0, 1
        );
        const world_opencv2gl = new THREE.Matrix4().set(
            1, 0, 0, 0,
            0, 0, 1, 0,
            0, -1, 0, 0,
            0, 0, 0, 1
        );

        let camera_c2w = new THREE.Matrix4().multiplyMatrices(world_opencv2gl, c2w);
        camera_c2w = new THREE.Matrix4().multiplyMatrices(camera_c2w, camera_opencv2gl);
        console.log('Camera c2w matrix:', camera_c2w);
        await addCameraFrustum(intrinsic, camera_c2w, imagePath);
    }
}

async function loadTexture(url) {
    return await new Promise((resolve, reject) => {
        const texLoader = new THREE.TextureLoader();
        texLoader.load(url, (tex) => resolve(tex), undefined, (err) => reject(err));
    });
}

// --- Camera Frustum Loader ---
export async function addCameraFrustum(intrinsic, camera_c2w, imagePath) {
    let texture = null;
    let imageWidth = null;
    let imageHeight = null;
    try {
        texture = await loadTexture(imagePath);
        imageWidth = texture.image.width;
        imageHeight = texture.image.height;
    } catch (err) {
        console.warn('Failed to load image, using placeholder size', err);
        imageWidth = 1024;
        imageHeight = 1024;
    }
    // try {
        // Use provided intrinsic and extrinsic directly
        const imgW = imageWidth || 1024;
        const imgH = imageHeight || 1024;
        const maxDim = Math.max(imgW, imgH);
        const left = Math.floor((maxDim - imgW) / 2);
        const top = Math.floor((maxDim - imgH) / 2);
        const fx = intrinsic[0][0];
        const fy = intrinsic[1][1];
        const cx = intrinsic[0][2];
        const cy = intrinsic[1][2];
        const focal_length_x = fx * maxDim;
        const focal_length_y = fy * maxDim;
        const principal_point_x_px = cx * maxDim - left;
        const principal_point_y_px = cy * maxDim - top;
        const fov = 2 * Math.atan(0.5 * imgH / focal_length_y) * 180 / Math.PI;
        const aspect = imgW / imgH;
        const near = 0.5;
        const far = 0.500001;
        const cam = new THREE.PerspectiveCamera(fov, aspect, near, far);
        const fullWidth = imgW;
        const fullHeight = imgH;
        const viewWidth = imgW;
        const viewHeight = imgH;
        const offsetX = principal_point_x_px - imgW / 2;
        const offsetY = principal_point_y_px - imgH / 2;
        cam.setViewOffset(fullWidth, fullHeight, -offsetX, -offsetY, viewWidth, viewHeight);
        if (camera_c2w) {
            cam.matrixAutoUpdate = false;
            cam.matrix.copy(camera_c2w);
            cam.matrix.decompose(cam.position, cam.quaternion, cam.scale);
        }
        if (texture) {
            const height_near = 2 * Math.tan((fov * Math.PI / 180) / 2) * near;
            const width_near = height_near * aspect;
            const planeGeometry = new THREE.PlaneGeometry(width_near, height_near);
            const planeMaterial = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
            const imagePlane = new THREE.Mesh(planeGeometry, planeMaterial);
            imagePlane.userData.isImagePlane = true; // mark so raycasts can ignore it
            imagePlane.position.z = -near + 0.0001; // Slightly in front of near plane to avoid z-fighting
            const dx = (principal_point_x_px - imgW / 2) * (width_near / imgW);
            const dy = (principal_point_y_px - imgH / 2) * (height_near / imgH);
            imagePlane.position.x = -dx;
            imagePlane.position.y = dy;
            cam.add(imagePlane);
        }
        const camHelper = new THREE.CameraHelper(cam);

        // Set line width for CameraHelper's LineSegments
        // Note: linewidth only works in some renderers/platforms (not all browsers)
        camHelper.traverse(obj => {
            if (obj.isLineSegments && obj.material && obj.material instanceof THREE.LineBasicMaterial) {
                console.log('Setting line width for camera frustum helper');
                // no effect
                // obj.material.linewidth = 10; // Set desired line width
            }
        });

        // Use THREE.Color and set unwanted lines to transparent
        const colorFrustum = new THREE.Color(0x444444); // medium gray
        const colorCone = new THREE.Color(0x444444);    // dark gray
        const colorUp = new THREE.Color(0x4444ff);      // transparent
        const colorCross = new THREE.Color(0x888888);   // transparent
        const colorTarget = new THREE.Color(0x888888);  // transparent
        camHelper.setColors(
            colorFrustum,
            colorCone,
            colorUp,
            colorCross,
            colorTarget,
        );


        cam.updateMatrixWorld(true);
        camHelper.userData.isClickable = true;
        camHelper.userData.isFrustum = true;
        // Store the camera view offset (if any) so we can restore it when animating
        camHelper.userData.cameraView = cam.view ? { fullWidth: cam.view.fullWidth, fullHeight: cam.view.fullHeight, offsetX: cam.view.offsetX, offsetY: cam.view.offsetY, width: cam.view.width, height: cam.view.height } : null;
        const camWorldPos = new THREE.Vector3();
        cam.getWorldPosition(camWorldPos);
        const camWorldQuat = new THREE.Quaternion();
        cam.getWorldQuaternion(camWorldQuat);
        camHelper.userData.cameraPosition = camWorldPos.clone();
        camHelper.userData.cameraQuaternion = camWorldQuat.clone();
    camHelper.userData.cameraFov = cam.fov;
    // keep a reference to the camera so we can highlight its image plane on hover
    camHelper.userData.camera = cam;
    scene.add(camHelper);
        scene.add(cam);
        cameraFrustums.push(camHelper);
}

// Frustum hover helpers: apply red material on hover, restore on leave
const _frustumOriginalMaterials = new WeakMap();
function applyFrustumHover(frustum) {
    if (!frustum) return;
    // Save originals: materials + helper scale + image plane state
    const saved = { materials: [], scale: null, imagePlane: null };
    frustum.traverse(obj => {
        if (obj.material) {
            const mat = obj.material;
            const entry = { obj: obj, color: mat.color ? mat.color.getHex() : null, opacity: mat.opacity !== undefined ? mat.opacity : null };
            saved.materials.push(entry);
            try {
                const shine = new THREE.Color(0x00ff00);
                if (mat.color) mat.color.set(shine);
                if (mat.emissive) {
                    mat.emissive.set(shine);
                    if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = Math.max(mat.emissiveIntensity || 0, 2.0);
                }
                mat.opacity = (entry.opacity !== null) ? Math.max(entry.opacity, 1.0) : 1.0;
                mat.needsUpdate = true;
            } catch (e) {
                // ignore
            }
        }
    });
    // save and grow helper
    try {
        if (frustum.scale) saved.scale = frustum.scale.clone();
        if (frustum.scale) frustum.scale.multiplyScalar(1.06);
    } catch (e) {
        // ignore
    }

    // highlight image plane if present
    try {
        const cam = frustum.userData && frustum.userData.camera;
        if (cam && cam.children && cam.children.length > 0) {
            const img = cam.children.find(c => c.userData && c.userData.isImagePlane && c.isMesh);
            if (img) {
                const mat = img.material;
                    saved.imagePlane = {
                        obj: img,
                        materialProps: { color: mat.color ? mat.color.getHex() : null, opacity: mat.opacity !== undefined ? mat.opacity : null }
                    };
                    try {
                        // For image plane highlight: only lower opacity to 0.5 (keep colors intact)
                        if (mat.transparent === undefined) mat.transparent = true;
                        mat.opacity = 0.5;
                        mat.needsUpdate = true;
                    } catch (e) {
                        // ignore
                    }
            }
        }
    } catch (e) {
        // ignore
    }

    _frustumOriginalMaterials.set(frustum, saved);
}

function restoreFrustumHover(frustum) {
    if (!frustum) return;
    const saved = _frustumOriginalMaterials.get(frustum);
    if (!saved) return;
    // restore materials
    saved.materials.forEach(entry => {
        const mat = entry.obj.material;
        try {
            if (mat && entry.color !== null && mat.color) mat.color.setHex(entry.color);
            if (mat && entry.opacity !== null) mat.opacity = entry.opacity;
            mat.needsUpdate = true;
        } catch (e) {
            // ignore
        }
    });
    // restore helper scale
    try {
        if (saved.scale && frustum.scale) frustum.scale.copy(saved.scale);
    } catch (e) {
        // ignore
    }
    // restore image plane
    try {
        if (saved.imagePlane && saved.imagePlane.obj) {
            const img = saved.imagePlane.obj;
            if (saved.imagePlane.scale && img.scale) img.scale.copy(saved.imagePlane.scale);
            const mat = img.material;
            if (mat && saved.imagePlane.materialProps) {
                if (saved.imagePlane.materialProps.color !== null && mat.color) mat.color.setHex(saved.imagePlane.materialProps.color);
                if (saved.imagePlane.materialProps.opacity !== null) mat.opacity = saved.imagePlane.materialProps.opacity;
                mat.needsUpdate = true;
            }
        }
    } catch (e) {
        // ignore
    }

    _frustumOriginalMaterials.delete(frustum);
}
// Mesh hover helpers: non-destructive grow + emissive/color highlight
const _meshOriginalState = new WeakMap();
function applyMeshHover(mesh) {
    if (!mesh || !mesh.material) return;
    // Save original state
    const orig = {
        scale: mesh.scale.clone(),
        materialProps: null
    };
    // store color/opacity/emissive if present
    const mat = mesh.material;
    orig.materialProps = {
        color: mat.color ? mat.color.getHex() : null,
        opacity: mat.opacity !== undefined ? mat.opacity : null,
        emissive: mat.emissive ? mat.emissive.getHex() : null,
        emissiveIntensity: mat.emissiveIntensity !== undefined ? mat.emissiveIntensity : null
    };
    _meshOriginalState.set(mesh, orig);

    // Apply highlight: subtle grow + bright color/emissive
    mesh.scale.multiplyScalar(1.06);
    try {
        const shine = new THREE.Color(0xffff66);
        if (mat.color) mat.color.set(shine);
        if (mat.emissive) {
            mat.emissive.set(shine);
            if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = Math.max(mat.emissiveIntensity || 0, 1.5);
        }
        if (orig.materialProps.opacity !== null) mat.opacity = Math.max(orig.materialProps.opacity, 1.0);
        mat.needsUpdate = true;
    } catch (e) {
        // ignore
    }
}

function restoreMeshHover(mesh) {
    if (!mesh) return;
    const orig = _meshOriginalState.get(mesh);
    if (!orig) return;
    try {
        mesh.scale.copy(orig.scale);
        const mat = mesh.material;
        if (mat) {
            if (orig.materialProps.color !== null && mat.color) mat.color.setHex(orig.materialProps.color);
            if (orig.materialProps.opacity !== null) mat.opacity = orig.materialProps.opacity;
            if (orig.materialProps.emissive !== null && mat.emissive) mat.emissive.setHex(orig.materialProps.emissive);
            if (orig.materialProps.emissiveIntensity !== null && mat.emissiveIntensity !== undefined) mat.emissiveIntensity = orig.materialProps.emissiveIntensity;
            mat.needsUpdate = true;
        }
    } catch (e) {
        // ignore
    }
    _meshOriginalState.delete(mesh);
}
// --- Double-click camera animation ---
let animationTokens = new Map();
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(start, end, t) {
    return start + (end - start) * t;
}

function slerp(start, end, t) {
    return start.clone().slerp(end, t);
}

function animateClientCamera(startPos, startQuat, startFov, endPos, endQuat, endFov, duration = 0.8, targetCamera = null) {
    const token = Date.now();
    animationTokens.set('camera', token);
    const startTime = performance.now();
    const endTime = startTime + duration * 1000;

    // Determine client sizes (use renderer size as authoritative)
    const clientSize = new THREE.Vector2();
    renderer.getSize(clientSize);
    const clientFullW = Math.round(clientSize.x);
    const clientFullH = Math.round(clientSize.y);
    // The view size used on the client (typically same as full for our viewer)
    const clientViewW = clientFullW;
    const clientViewH = clientFullH;

    // Original camera offsets (if any)
    const originalViewOffset = camera.view ? {
        fullWidth: camera.view.fullWidth,
        fullHeight: camera.view.fullHeight,
        offsetX: camera.view.offsetX,
        offsetY: camera.view.offsetY,
        width: camera.view.width,
        height: camera.view.height
    } : {
        fullWidth: clientFullW,
        fullHeight: clientFullH,
        offsetX: 0,
        offsetY: 0,
        width: clientViewW,
        height: clientViewH
    };

    // If a target frustum was provided and has a stored cameraView, map its principal-point offsets
    let mappedTargetView = null;
    if (targetCamera && targetCamera.userData && targetCamera.userData.cameraView) {
        const tv = targetCamera.userData.cameraView;
        // Map target offsets (which are in the target's full-size space) into the client's full-size space
        if (tv && tv.fullWidth && tv.fullHeight) {
            const mappedOffsetX = (tv.offsetX / tv.fullWidth) * clientFullW;
            const mappedOffsetY = (tv.offsetY / tv.fullHeight) * clientFullH;
            mappedTargetView = {
                fullWidth: clientFullW,
                fullHeight: clientFullH,
                offsetX: mappedOffsetX,
                offsetY: mappedOffsetY,
                width: clientViewW,
                height: clientViewH
            };
        }
    }

    function frame(now) {
        if (animationTokens.get('camera') !== token) return;
        const tRaw = (now - startTime) / (endTime - startTime);
        const tClamped = Math.max(0, Math.min(1, tRaw));
        const te = easeInOutCubic(tClamped);

        // Interpolate transform
        const currentPos = new THREE.Vector3().lerpVectors(startPos, endPos, te);
        const currentQuat = slerp(startQuat, endQuat, te);
        const currentFov = lerp(startFov, endFov, te);
        camera.position.copy(currentPos);
        camera.quaternion.copy(currentQuat);
        camera.fov = currentFov;

        // Interpolate only the principal-point offsets (mapped into client sizes) if a mapped target exists
        if (mappedTargetView) {
            const curOffsetX = lerp(originalViewOffset.offsetX, mappedTargetView.offsetX, te);
            const curOffsetY = lerp(originalViewOffset.offsetY, mappedTargetView.offsetY, te);
            try {
                camera.setViewOffset(clientFullW, clientFullH, Math.round(curOffsetX), Math.round(curOffsetY), clientViewW, clientViewH);
            } catch (e) {
                // Some environments may not support setViewOffset or intermediate values; ignore errors
            }
        }

        camera.updateProjectionMatrix();
        controls.object.up.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(currentQuat).normalize());
        const forwardPoint = new THREE.Vector3(0, 0, -1).applyQuaternion(currentQuat).normalize();
        controls.target.copy(currentPos).add(forwardPoint);
        controls.update();

        if (tClamped < 1) {
            requestAnimationFrame(frame);
        } else {
            // Finalize camera transform and ensure final offsets applied
            if (animationTokens.get('camera') === token) {
                camera.position.copy(endPos);
                camera.quaternion.copy(endQuat);
                camera.fov = endFov;
                if (mappedTargetView) {
                    try {
                        camera.setViewOffset(clientFullW, clientFullH, Math.round(mappedTargetView.offsetX), Math.round(mappedTargetView.offsetY), clientViewW, clientViewH);
                    } catch (e) {
                        // ignore
                    }
                } else {
                    // Restore original view if no targetView
                    if (originalViewOffset) {
                        try {
                            camera.setViewOffset(originalViewOffset.fullWidth, originalViewOffset.fullHeight, Math.round(originalViewOffset.offsetX), Math.round(originalViewOffset.offsetY), originalViewOffset.width, originalViewOffset.height);
                        } catch (e) {
                            // ignore
                        }
                    }
                }
                camera.updateProjectionMatrix();
                controls.update();
            }
        }
    }

    requestAnimationFrame(frame);
}

// Double-click event for camera animation
// Moved inside initDemoViewer to ensure renderer is initialized

export function setupThumbnails(thumbnailList, galleryId = 'thumbnailGallery') {
    const gallery = document.getElementById(galleryId);
    if (!gallery) return;
    gallery.innerHTML = '';

    const thumbnailsDiv = document.createElement('div');
    thumbnailsDiv.className = 'rerun-thumbnails';

    thumbnailList.forEach((item, idx) => {
        const thumbnailDiv = document.createElement('div');
        thumbnailDiv.className = 'rerun-thumbnail';
        thumbnailDiv.setAttribute('data-label', item.label || `Scene ${idx+1}`);
        thumbnailDiv.setAttribute('data-idx', idx);

        // Use thumbnail image if available
        if (item.thumbnail) {
            const img = document.createElement('img');
            img.src = item.thumbnail;
            img.alt = item.label || `Scene ${idx+1}`;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '8px';
            thumbnailDiv.appendChild(img);
        } else {
            // Fallback to gradient placeholder
            thumbnailDiv.style.background = 'linear-gradient(135deg, #667eea, #764ba2)';
            const span = document.createElement('span');
            span.textContent = item.label || `Scene ${idx+1}`;
            span.style.color = 'white';
            span.style.fontSize = '0.9em';
            thumbnailDiv.appendChild(span);
        }

        thumbnailDiv.style.cursor = 'pointer';
        thumbnailDiv.onclick = async () => {
            // Remove active state from all thumbnails
            thumbnailsDiv.querySelectorAll('.rerun-thumbnail').forEach(t => t.classList.remove('active'));
            thumbnailDiv.classList.add('active');

            // Clear previous model/frustums
            if (currentModel) {
                scene.remove(currentModel);
                currentModel = null;
            }
            if (scene.getObjectByName('multiObjectGroup')) {
                scene.remove(scene.getObjectByName('multiObjectGroup'));
            }
            cameraFrustums.forEach(f => {
                scene.remove(f);
                if (f.parent && f.parent.type === 'Scene') {
                    f.parent.remove(f);
                }
                if (f.camera && f.camera.parent) {
                    f.camera.parent.remove(f.camera);
                }
            });
            // Remove any floating camera image children
            scene.traverse(obj => {
                if (obj.type === 'PerspectiveCamera' && obj.children && obj.children.length > 0) {
                    obj.children.forEach(child => {
                        if (child.type === 'Mesh' && child.material && child.material.map) {
                            obj.remove(child);
                        }
                    });
                    scene.remove(obj);
                }
            });
            cameraFrustums = [];

            // Fetch metadata and load scene
            let metadata = null;
            if (item.metadataPath) {
                try {
                    const res = await fetch(item.metadataPath);
                    if (res.ok) metadata = await res.json();
                } catch (err) {
                    console.warn('Failed to fetch metadata for thumbnail', err);
                }
            }
            if (metadata) {
                const parentDir = item.metadataPath.split('/').slice(0, -1).join('/');
                await loadGLBFromMetadata(metadata, parentDir);
            }
        };

        thumbnailsDiv.appendChild(thumbnailDiv);
    });

    gallery.appendChild(thumbnailsDiv);
    // Activate first thumbnail by default
    if (thumbnailsDiv.firstChild) thumbnailsDiv.firstChild.classList.add('active');
}

// --- Remove direct DOM event listeners for file/axes toggles ---
// These can be added externally if needed

// --- Export for HTML to call ---
export default {
    addCameraFrustum,
    setupThumbnails,
    initDemoViewer
};
