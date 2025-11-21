// demo.js
import * as THREE from 'three';
// demo.js
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
let imageOpacity = 1.0; // Global image opacity state
// Token to identify the latest requested load; incrementing cancels prior loads logically
let _currentLoadToken = 0;

// --- Control Panel Functions ---
function createControlPanel(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Create control panel
    const controlPanel = document.createElement('div');
    controlPanel.id = 'controlPanel';
    // Floating, collapsible control panel inserted into the viewer container (absolute positioning)
    // so it will be subject to the viewer's layout and the viewer CSS exception in rerun-viewer.css.
    // Presentation for #controlPanel is handled in static/css/rerun-viewer.css
    controlPanel.className = 'control-panel';

    controlPanel.innerHTML = `
        <div class="control-header">
            <h3>🎮 Control</h3>
            <button id="controlPanelToggle" class="control-toggle" title="Expand">+</button>
        </div>

        <div class="control-section">
            <h4>🖱️ Mouse</h4>
            <div class="control-note">Rotate • Pan • Zoom • Spin (Key: R)</div>
            <div class="control-note">Double-click ground → reset view<br/>Double-click frustum → camera view</div>
        </div>

        <div class="control-section">
            <h4>🔘 Buttons</h4>
            <div class="actions-row actions-row-two" style="display:flex; flex-direction:column; gap:6px;">
                <div class="actions-row-top" style="display:flex; gap:8px; align-items:center;">
                    <button id="resetViewBtn" class="action-button" aria-label="Reset view">🏠 <span class="action-text">Reset</span></button>
                    <button id="cameraViewBtn" class="action-button" aria-label="Go to camera view">📷 <span class="action-text">Camera</span></button>
                    <button id="toggleAxesBtn" class="action-button" title="Toggle axes" aria-label="Toggle axes">🧭 <span class="action-text">Axes</span></button>
                </div>
                <div class="actions-row-bottom" style="display:flex; gap:8px; align-items:center;">
                    <button id="toggleAutoRotateBtn" class="action-button" title="Toggle auto-rotate" aria-label="Toggle auto-rotate">🔁 <span class="action-text">Spin</span></button>
                    <button id="toggleFullscreenBtn" class="action-button" title="Toggle fullscreen" aria-label="Toggle fullscreen" style="color: #2b6fb3;">⤢ <span class="action-text">Full</span></button>
                </div>
            </div>
        </div>

        <div class="control-section">
            <h4>🎨 Image</h4>
            <div class="control-label">Opacity: <span id="opacityValue">100%</span></div>
            <input type="range" id="imageOpacitySlider" min="0" max="100" value="100" class="control-range">
        </div>
    `;
    // Insert panel into the viewer container so it participates in the viewer's local stacking/layout
    // and is not affected by global forcing rules. Container is positioned relative in initDemoViewer.
    container.appendChild(controlPanel);

    // Positioning helper: place panel at a small offset inside the container (local coordinates)
    function positionPanel() {
        try {
            const spacing = 8;
            controlPanel.style.left = `${spacing}px`;
            controlPanel.style.top = `${spacing}px`;
            controlPanel.style.opacity = '1';
        } catch (e) {
            controlPanel.style.left = '6px';
            controlPanel.style.top = '6px';
            controlPanel.style.opacity = '1';
        }
    }

    // keep panel aligned on resize/scroll
    const ro = new ResizeObserver(positionPanel);
    try { ro.observe(container); } catch (e) { /* ignore */ }
    window.addEventListener('resize', positionPanel);
    // Do NOT reposition on every scroll; keeping the panel fixed in viewport is preferred so it
    // doesn't follow page scroll. If you want it to stick to the viewer while scrolling, we can
    // re-enable a scroll handler or implement intersection-based visibility.

    // small state for collapsed/expanded — start collapsed by default
    controlPanel.dataset.collapsed = 'true';
    // use CSS collapsed class to hide details
    controlPanel.classList.add('collapsed');
    // mark slider as aria-hidden initially
    const initSlider = document.getElementById('imageOpacitySlider');
    const initSliderLabel = document.getElementById('opacityValue');
    if (initSlider) initSlider.setAttribute('aria-hidden', 'true');

    setupControlPanelEvents();
    // initial position
    positionPanel();
}

function setupControlPanelEvents() {
    // Camera View Button
    const cameraViewBtn = document.getElementById('cameraViewBtn');
    if (cameraViewBtn) {
        cameraViewBtn.addEventListener('click', () => {
            if (cameraFrustums.length > 0) {
                controls.autoRotate = false;
                const frustum = cameraFrustums[0]; // Go to first camera
                if (frustum.userData.isClickable) {
                    const startPos = camera.position.clone();
                    const startQuat = camera.quaternion.clone();
                    const startFov = camera.fov;
                    const endPos = frustum.userData.cameraPosition;
                    const endQuat = frustum.userData.cameraQuaternion;
                    const endFov = frustum.userData.cameraFov;
                    animateClientCamera(startPos, startQuat, startFov, endPos, endQuat, endFov, 0.8, frustum);
                }
            }
        });
    }

    // Reset View Button
    const resetViewBtn = document.getElementById('resetViewBtn');
    if (resetViewBtn) {
        resetViewBtn.addEventListener('click', () => {
            controls.autoRotate = false;
            const startPos = camera.position.clone();
            const startQuat = camera.quaternion.clone();
            const startFov = camera.fov;
            const endPos = new THREE.Vector3(3, 3, 3);

            let targetCenter = new THREE.Vector3(0, 1, 0);
            if (currentModel) {
                let bbox = new THREE.Box3().setFromObject(currentModel);
                targetCenter = bbox.getCenter(new THREE.Vector3());
            }

            const tempCam = new THREE.PerspectiveCamera(75, camera.aspect, camera.near, camera.far);
            tempCam.position.copy(endPos);
            tempCam.up.set(0, 1, 0);
            tempCam.lookAt(targetCenter);
            const endQuat = tempCam.quaternion.clone();
            const endFov = 75;
            
            animateClientCamera(startPos, startQuat, startFov, endPos, endQuat, endFov);

            setTimeout(() => {
                camera.position.copy(endPos);
                camera.quaternion.copy(endQuat);
                camera.fov = endFov;
                camera.up.set(0, 1, 0);
                camera.updateProjectionMatrix();
                controls.target.copy(targetCenter);
                controls.object.up.set(0, 1, 0);
                controls.update();
            }, 850);
        });
    }

    // Axes Toggle (emoji button)
    const toggleAxesBtn = document.getElementById('toggleAxesBtn');
    if (toggleAxesBtn) {
        const updateAxesButton = () => {
            if (!axesGroup) return;
            const on = !!axesGroup.visible;
            toggleAxesBtn.classList.toggle('active', on);
            toggleAxesBtn.classList.toggle('inactive', !on);
            toggleAxesBtn.title = on ? 'Hide axes' : 'Show axes';
        };
        toggleAxesBtn.addEventListener('click', () => {
            if (!axesGroup) return;
            axesGroup.visible = !axesGroup.visible;
            updateAxesButton();
        });
        // initialize state
        updateAxesButton();
    }

    // Auto-rotate Toggle (emoji button)
    const toggleAutoRotateBtn = document.getElementById('toggleAutoRotateBtn');
    if (toggleAutoRotateBtn) {
        const updateAutoRotateButton = () => {
            if (!controls) return;
            const on = !!controls.autoRotate;
            toggleAutoRotateBtn.classList.toggle('active', on);
            toggleAutoRotateBtn.classList.toggle('inactive', !on);
            toggleAutoRotateBtn.title = on ? 'Disable auto-rotate' : 'Enable auto-rotate';
        };
        toggleAutoRotateBtn.addEventListener('click', () => {
            if (!controls) return;
            controls.autoRotate = !controls.autoRotate;
            updateAutoRotateButton();
        });
        // initialize state
        updateAutoRotateButton();
    }

    // Fullscreen Toggle (use the control panel's parent as the viewer container)
    const toggleFullscreenBtn = document.getElementById('toggleFullscreenBtn');
    if (toggleFullscreenBtn) {
        const updateFullscreenButton = () => {
            const controlPanel = document.getElementById('controlPanel');
            const container = controlPanel ? controlPanel.parentElement : document.getElementById('viewer');
            const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
            toggleFullscreenBtn.classList.toggle('active', isFs);
            toggleFullscreenBtn.title = isFs ? 'Exit fullscreen' : 'Enter fullscreen';
            const label = toggleFullscreenBtn.querySelector('.action-text');
            if (label) label.textContent = isFs ? 'Exit' : 'Full';
        };

        toggleFullscreenBtn.addEventListener('click', () => {
            const controlPanel = document.getElementById('controlPanel');
            const container = controlPanel ? controlPanel.parentElement : document.getElementById('viewer');
            if (!container) return;
            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                if (container.requestFullscreen) container.requestFullscreen();
                else if (container.webkitRequestFullscreen) container.webkitRequestFullscreen();
            } else {
                if (document.exitFullscreen) document.exitFullscreen();
                else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
            }
            // actual button label/state will update on fullscreenchange event
        });

        // init button state
        updateFullscreenButton();
    }

    // Add hover/focus affordance for action buttons (scale + shadow)
    function addButtonAffordance(btn) {
        if (!btn) return;
        // CSS handles transitions and hover/focus states; toggle a helper class for non-CSS states
        const enter = () => btn.classList.add('btn-hover');
        const leave = () => btn.classList.remove('btn-hover');
        btn.addEventListener('mouseenter', enter);
        btn.addEventListener('focus', enter);
        btn.addEventListener('mouseleave', leave);
        btn.addEventListener('blur', leave);
    }

    // Apply affordance to the action buttons
    addButtonAffordance(document.getElementById('resetViewBtn'));
    addButtonAffordance(document.getElementById('cameraViewBtn'));
    addButtonAffordance(document.getElementById('toggleAxesBtn'));
    addButtonAffordance(document.getElementById('toggleAutoRotateBtn'));
    addButtonAffordance(document.getElementById('toggleFullscreenBtn'));

    // Image Opacity Slider
    const imageOpacitySlider = document.getElementById('imageOpacitySlider');
    const opacityValue = document.getElementById('opacityValue');
    if (imageOpacitySlider && opacityValue) {
        imageOpacitySlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            imageOpacity = value / 100;
            opacityValue.textContent = `${value}%`;
            
            // Update all camera image planes
            scene.traverse(obj => {
                if (obj.userData && obj.userData.isImagePlane && obj.material) {
                    obj.material.opacity = imageOpacity;
                    obj.material.needsUpdate = true;
                }
            });
        });
    }

    // Collapse toggle (panel is appended to body, toggle by changing transform/height)
    const panelToggle = document.getElementById('controlPanelToggle');
    const controlPanel = document.getElementById('controlPanel');
    if (panelToggle && controlPanel) {
        panelToggle.addEventListener('click', () => {
            const collapsed = controlPanel.dataset.collapsed === 'true';
            // helper to hide/show the image opacity slider and other controls
            const slider = document.getElementById('imageOpacitySlider');
            const sliderLabel = document.getElementById('opacityValue');
            if (collapsed) {
                        // expand (use CSS class)
                        controlPanel.classList.remove('collapsed');
                        controlPanel.dataset.collapsed = 'false';
                        panelToggle.textContent = '—';
                        panelToggle.title = 'Collapse';
                        if (slider) slider.removeAttribute('aria-hidden');
                        if (sliderLabel) sliderLabel.removeAttribute('aria-hidden');
            } else {
                        // collapse to header-only: rely on CSS collapsed class
                        controlPanel.classList.add('collapsed');
                        controlPanel.dataset.collapsed = 'true';
                        panelToggle.textContent = '+';
                        panelToggle.title = 'Expand';
                        // mark slider aria-hidden
                        if (slider) slider.setAttribute('aria-hidden', 'true');
                        if (sliderLabel) sliderLabel.setAttribute('aria-hidden', 'true');
            }
        });
    }
}

function updateControlPanelInfo() {
    // Camera and Scene info removed; nothing to update here
}

// Helper: find the viewer container element (parent of control panel) or fallback to #viewer
function getViewerContainer() {
    const controlPanel = document.getElementById('controlPanel');
    if (controlPanel && controlPanel.parentElement) return controlPanel.parentElement;
    return document.getElementById('viewer');
}

// Centralized renderer sizing so canvas resolution matches container or fullscreen
function updateRendererSize() {
    try {
        const container = getViewerContainer() || document.body;
        if (!container || !renderer || !camera) return;
        const rect = container.getBoundingClientRect();
        const w = rect.width > 0 ? rect.width : window.innerWidth;
        const h = rect.height > 0 ? rect.height : window.innerHeight;
        // clamp DPR for performance on very high-DPI displays if desired
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        renderer.setPixelRatio(dpr);
        // Use integer sizes for the renderer to avoid half-pixel issues
        renderer.setSize(Math.round(w), Math.round(h), false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
    } catch (e) {
        // ignore sizing errors
    }
}

// Ensure renderer resizes when entering/exiting fullscreen
document.addEventListener('fullscreenchange', () => {
    updateRendererSize();
    const btn = document.getElementById('toggleFullscreenBtn');
    if (btn) {
        const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
        btn.classList.toggle('active', isFs);
        btn.title = isFs ? 'Exit fullscreen' : 'Enter fullscreen';
        const label = btn.querySelector('.action-text');
        if (label) label.textContent = isFs ? 'Exit' : 'Full';
    }
});
document.addEventListener('webkitfullscreenchange', () => {
    updateRendererSize();
    const btn = document.getElementById('toggleFullscreenBtn');
    if (btn) {
        const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
        btn.classList.toggle('active', isFs);
        btn.title = isFs ? 'Exit fullscreen' : 'Enter fullscreen';
        const label = btn.querySelector('.action-text');
        if (label) label.textContent = isFs ? 'Exit' : 'Full';
    }
});

// --- Modular Initialization ---
export function initDemoViewer({ containerId = 'viewer', galleryId = 'thumbnailGallery', thumbnailList = [] } = {}) {
    // Setup scene, camera, renderer
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    container.style.position = 'relative'; // Ensure container is positioned for absolute children
    container.appendChild(renderer.domElement);
    
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.objectFit = 'cover';
    renderer.domElement.style.display = 'block';
    
    // Make renderer match the container size (and handle DPR). This will also be used on
    // window resize and fullscreen changes via updateRendererSize().
    updateRendererSize();

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 1;
    controls.maxDistance = 100;
        // Enable auto-rotate by default so the scene gently spins on load. Can be toggled in the UI.
        controls.autoRotate = true;
    controls.autoRotateSpeed = 2.5;

        window.addEventListener('keydown', function(e) {
            // R: toggle auto-rotate (replaces Space behavior)
            if (e.code === 'KeyR') {
                if (controls) {
                    controls.autoRotate = !controls.autoRotate;
                    // reflect new state on the UI button if present
                    const toggleAutoRotateBtn = document.getElementById('toggleAutoRotateBtn');
                    if (toggleAutoRotateBtn) {
                        toggleAutoRotateBtn.classList.toggle('active', !!controls.autoRotate);
                        toggleAutoRotateBtn.classList.toggle('inactive', !controls.autoRotate);
                        toggleAutoRotateBtn.title = controls.autoRotate ? 'Disable auto-rotate' : 'Enable auto-rotate';
                    }
                }
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

    camera.position.set(-2, 2, -2);
    controls.target.set(0, 0, 0);
    controls.update();

    // Ground plane
    ground = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 10),
        new THREE.MeshPhongMaterial({ color: 0xffffff, side: THREE.DoubleSide, shininess: 10, transparent: true, opacity: 0.5 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.50;
    ground.receiveShadow = true;
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
    // Use a plain, neutral light-gray background for the viewer
    // Use a very light, perceptually neutral gray for the background (5% gray)
    const neutralGray = new THREE.Color(0xf2f2f2); // sRGB ~95% gray
    renderer.setClearColor(neutralGray, 1);
    scene.background = null;
    // scene.background = bgTexture;

    // Create control panel
    createControlPanel(containerId);

    // Animation loop
    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        updateControlPanelInfo();
        renderer.render(scene, camera);
    }
    animate();

    window.addEventListener('resize', function() {
        // Recompute sizes based on viewer container / fullscreen state
        updateRendererSize();
    });

    // Double-click camera animation
    renderer.domElement.addEventListener('dblclick', function(event) {
        controls.autoRotate = false;
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
                animateClientCamera(startPos, startQuat, startFov, endPos, endQuat, endFov, 0.8, frustumGroup);
                return;
            }
        }

        const meshObjects = [];
        scene.traverse(obj => {
            if (obj.isMesh && !obj.userData.isImagePlane) meshObjects.push(obj);
        });
        const meshIntersects = raycaster.intersectObjects(meshObjects, true);
        if (meshIntersects.length > 0) {
            const startPos = camera.position.clone();
            const startQuat = camera.quaternion.clone();
            const startFov = camera.fov;
            const endPos = new THREE.Vector3(3, 3, 3);

            let targetCenter = new THREE.Vector3(0, 1, 0);
            if (currentModel) {
                let bbox = new THREE.Box3().setFromObject(currentModel);
                targetCenter = bbox.getCenter(new THREE.Vector3());
            }

            const tempCam = new THREE.PerspectiveCamera(75, camera.aspect, camera.near, camera.far);
            tempCam.position.copy(endPos);
            tempCam.up.set(0, 1, 0);
            tempCam.lookAt(targetCenter);
            const endQuat = tempCam.quaternion.clone();
            const endFov = 75;
            animateClientCamera(startPos, startQuat, startFov, endPos, endQuat, endFov);

            setTimeout(() => {
                camera.position.copy(endPos);
                camera.quaternion.copy(endQuat);
                camera.fov = endFov;
                camera.up.set(0, 1, 0);
                camera.updateProjectionMatrix();
                controls.target.copy(targetCenter);
                controls.object.up.set(0, 1, 0);
                controls.update();
            }, 850);
        }
    });

    // Pointer move hover effects
    raycaster.params.Line.threshold = 0.1;
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
                if (currentHoveredMesh) {
                    restoreMeshHover(currentHoveredMesh);
                    currentHoveredMesh = null;
                }
                return;
            }
        }
        if (currentHoveredFrustum) {
            restoreFrustumHover(currentHoveredFrustum);
            currentHoveredFrustum = null;
        }
        const meshCandidates = [];
        scene.traverse(obj => {
            if (obj.isMesh && !obj.userData.isImagePlane && !obj.userData.isGround) meshCandidates.push(obj);
        });
        const meshIntersects = raycaster.intersectObjects(meshCandidates, true);
        if (meshIntersects.length > 0) {
            const m = meshIntersects[0].object;
            if (currentHoveredMesh !== m) {
                if (currentHoveredMesh) restoreMeshHover(currentHoveredMesh);
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

    setupThumbnails(thumbnailList, galleryId);

        if (thumbnailList.length > 0) {
            // After a short delay, mark the first thumbnail active and trigger its click handler
            // using the same DOM event path as a real user click so all handlers run consistently.
            setTimeout(() => {
                const gallery = document.getElementById(galleryId);
                if (gallery) {
                    const first = gallery.querySelector('.rerun-thumbnail');
                    if (first) {
                        // mark active for visual consistency
                        first.classList.add('active');
                        // dispatch a real click event so existing listeners handle loading the scene
                        const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
                        first.dispatchEvent(ev);
                    }
                }
            }, 100);
        }
}

// --- Rest of the helper functions remain the same ---
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

async function loadGLB(glbPath, transformMatrix = null, scale = 1.0, group = null, entityName = null, loadToken = null) {
    return await new Promise((resolve, reject) => {
        // show loading overlay for this file
        ensureLoadingOverlay();
        setLoadingProgress(0, `Loading model`);

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
                // If a load token is provided and it no longer matches the current token,
                // this load was superseded — dispose model and resolve(null).
                if (loadToken !== null && loadToken !== undefined && loadToken !== _currentLoadToken) {
                    try {
                        model.traverse(c => {
                            if (c.isMesh) {
                                if (c.geometry) c.geometry.dispose();
                                if (c.material) {
                                    if (Array.isArray(c.material)) c.material.forEach(m => { if (m.map) m.map.dispose(); if (m.dispose) m.dispose(); });
                                    else { if (c.material.map) c.material.map.dispose(); if (c.material.dispose) c.material.dispose(); }
                                }
                            }
                        });
                    } catch (e) { /* ignore disposal errors */ }
                    try { hideLoadingOverlay(); } catch (e) {}
                    resolve(null);
                    return;
                }

                if (group) {
                    group.add(model);
                } else {
                    scene.add(model);
                    currentModel = model;
                }
                controls.update();
                // hide loading overlay on success for this file
                try { hideLoadingOverlay(); } catch (e) { /* ignore */ }
                resolve(model);
            },
            // onProgress
            function (xhr) {
                try {
                    if (xhr && xhr.lengthComputable) {
                        const pct = Math.round((xhr.loaded / xhr.total) * 100);
                        setLoadingProgress(pct, `Loading model (${pct}%)`);
                    } else {
                        // indeterminate progress
                        setLoadingProgress(null, `Loading model…`);
                    }
                } catch (e) {
                    // ignore
                }
            },
            function (error) {
                console.error('Error loading GLB:', error);
                hideLoadingOverlay();
                reject(error);
            }
        );
    });
}

// Simple loading overlay helpers
let _loadingOverlay = null;
function ensureLoadingOverlay() {
    if (_loadingOverlay) return;
    const wrap = document.createElement('div');
    wrap.id = 'glbLoadingOverlay';

    // If control panel exists, place overlay inside the same container so CSS rules for the viewer apply.
    const controlPanel = document.getElementById('controlPanel');
    let parentEl = document.body;
    let zIndexBase = 2000;
    if (controlPanel && controlPanel.parentElement) {
        parentEl = controlPanel.parentElement; // should be the viewer container
        const z = window.getComputedStyle(controlPanel).zIndex;
        zIndexBase = z && !isNaN(parseInt(z)) ? parseInt(z) : zIndexBase;
    }

    // Positioning and layout handled in CSS (#glbLoadingOverlay).
    // Keep only dynamic z-index so the overlay stacks correctly relative to the control panel.
    wrap.style.zIndex = (zIndexBase - 10).toString();

    const inner = document.createElement('div');
    // Use CSS classes (defined in static/css/rerun-viewer.css) for appearance/positioning
    inner.className = 'glb-loading-inner';
    inner.innerHTML = `
        <div id="glbLoadingText">Loading...</div>
        <div class="glb-loading-track"><div id="glbLoadingBar"></div></div>
    `;

    wrap.appendChild(inner);
    parentEl.appendChild(wrap);
    _loadingOverlay = wrap;
}

function setLoadingProgress(percent, text) {
    ensureLoadingOverlay();
    const txt = document.getElementById('glbLoadingText');
    const bar = document.getElementById('glbLoadingBar');
    if (txt && text) txt.textContent = text;
    if (bar) {
        if (percent === null || percent === undefined) {
            // indeterminate animation
            bar.style.width = '60%';
            bar.style.transition = 'none';
            bar.style.transform = 'translateX(-20%)';
            bar.style.animation = 'glb-indeterminate 1.2s infinite linear';
            if (!document.getElementById('glb-indeterminate-style')) {
                const s = document.createElement('style');
                s.id = 'glb-indeterminate-style';
                s.textContent = `@keyframes glb-indeterminate { 0% { transform: translateX(-40%); } 100% { transform: translateX(200%); } } #glbLoadingBar { will-change: transform; }`;
                // Append style to the parent element when possible so viewer-local CSS can override if needed
                document.head.appendChild(s);
            }
        } else {
            // determinate
            bar.style.animation = '';
            bar.style.transition = 'width 220ms linear';
            bar.style.width = `${Math.max(3, percent)}%`;
        }
    }
}

function hideLoadingOverlay() {
    if (!_loadingOverlay) return;
    try {
        if (_loadingOverlay.parentElement) _loadingOverlay.parentElement.removeChild(_loadingOverlay);
        else _loadingOverlay.remove();
    } catch (e) {}
    _loadingOverlay = null;
    const s = document.getElementById('glb-indeterminate-style');
    if (s) s.remove();
}

async function loadGLBFromMetadata(metadata, parentDir, loadToken = null) {
    let intrinsic = null;
    let extrinsic = null;
    let imagePath = parentDir + '/images_crop/input_no_mask.png';
    if (metadata["glb_path"] && Array.isArray(metadata["glb_path"])) {
        console.log(`🎭 Processing multi-object scene with ${metadata['glb_path'].length} objects`);
    const multiGroup = new THREE.Group();
        multiGroup.name = 'multiObjectGroup';
        let camera_c2w = null;
        for (let i = 0; i < metadata["glb_path"].length; ++i) {
            const meshPath = parentDir + '/' + `mesh${i}.glb`;
            const pose = metadata["pose"][String(i)];
            if (!pose) continue;
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
                ground.position.y = -0.5 * scale;
                gridHelper.position.y = -0.49 * scale;
            }

            let final_transform = scale_mat;
            final_transform = new THREE.Matrix4().multiplyMatrices(c2w_transform.invert(), final_transform);
            final_transform = new THREE.Matrix4().multiplyMatrices(camera_c2w, final_transform);
            await loadGLB(meshPath, final_transform, 1.0, multiGroup, `object_${i}`, loadToken);
            // If this load has been superseded, stop processing further parts
            if (loadToken !== null && loadToken !== undefined && loadToken !== _currentLoadToken) return;
        }

        if (loadToken !== null && loadToken !== undefined && loadToken !== _currentLoadToken) return;

        addCameraFrustum(intrinsic, camera_c2w, imagePath);
        scene.add(multiGroup);
        currentModel = multiGroup;
    } else {
        console.log(`📦 Processing single object scene`);
        const glbPath = parentDir + '/mesh.glb';
    const loadedModel = await loadGLB(glbPath, null, 1.0, null, null, loadToken);
    if (loadToken !== null && loadToken !== undefined && loadToken !== _currentLoadToken) return;
    // if loadGLB returned null it was superseded
    if (!loadedModel) return;
        ground.position.y = -0.5;
        gridHelper.position.y = -0.49;
        // Gather intrinsics/extrinsics robustly — support arrays for multi-camera captures
        let intrinsics = [];
        let extrinsicsArr = [];
        if (metadata.pose && metadata.pose['intrinsic'] && metadata.pose['extrinsic']) {
            intrinsics = metadata.pose['intrinsic'];
            extrinsicsArr = metadata.pose['extrinsic'];
        } else if (metadata.intrinsic && metadata.extrinsic) {
            intrinsics = metadata.intrinsic;
            extrinsicsArr = metadata.extrinsic;
        }

        // Normalize to arrays of camera matrices
        if (!Array.isArray(intrinsics)) intrinsics = [intrinsics];
        if (!Array.isArray(extrinsicsArr)) extrinsicsArr = [extrinsicsArr];

        // If intrinsics is nested as [[3x3]] -> unwrap
        intrinsics = intrinsics.map(i => {
            if (Array.isArray(i) && i.length === 1 && Array.isArray(i[0]) && i[0].length === 3) return i[0];
            return i;
        });

        // For each available camera entry, construct camera and add frustum. If counts differ, iterate over min length.
        const camCount = Math.min(intrinsics.length, extrinsicsArr.length);
        for (let ci = 0; ci < camCount; ++ci) {
            const intr = intrinsics[ci];
            const ext = extrinsicsArr[ci];
            if (!intr || !ext) continue;

            // Choose an image per-camera: prefer input_no_mask.png, but if missing try input_no_mask_{ci}.png
            let imagePathForCam = parentDir + '/images_crop/input_no_mask.png';
            try {
                // Try HEAD first to avoid downloading the full image when not present.
                const headResp = await fetch(imagePathForCam, { method: 'HEAD' });
                if (!headResp.ok) {
                    const altPath = parentDir + `/images_crop/input_no_mask_${ci}.png`;
                    try {
                        const altResp = await fetch(altPath, { method: 'HEAD' });
                        if (altResp.ok) imagePathForCam = altPath;
                    } catch (e) {
                        // ignore; we'll fall back to original path which will cause loadTexture to use placeholder
                    }
                }
            } catch (e) {
                // If HEAD is not allowed or fails, try direct existence check for the indexed image.
                const altPath = parentDir + `/images_crop/input_no_mask_${ci}.png`;
                try {
                    const altResp = await fetch(altPath, { method: 'HEAD' });
                    if (altResp.ok) imagePathForCam = altPath;
                } catch (e2) {
                    // ignore and keep default imagePathForCam
                }
            }

            // ext is expected to be 4x4 matrix (rows)
            let extFlat = [];
            try { extFlat = ext.flat(); } catch (e) { extFlat = [].concat(...ext); }
            if (extFlat.length < 16) {
                console.warn('Unexpected extrinsic size for camera', ci, ext);
                continue;
            }

            const w2c = new THREE.Matrix4().set(
                extFlat[0], extFlat[1], extFlat[2], extFlat[3],
                extFlat[4], extFlat[5], extFlat[6], extFlat[7],
                extFlat[8], extFlat[9], extFlat[10], extFlat[11],
                extFlat[12], extFlat[13], extFlat[14], extFlat[15]
            );

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
            console.log('Camera c2w matrix (camera index', ci, '):', camera_c2w);

            try {
                await addCameraFrustum(intr, camera_c2w, imagePathForCam);
            } catch (e) {
                console.warn('Failed to add camera frustum for index', ci, e);
            }
        }
    }
}

async function loadTexture(url) {
    return await new Promise((resolve, reject) => {
        const texLoader = new THREE.TextureLoader();
        texLoader.load(url, (tex) => {
            try {
                if (tex && 'colorSpace' in tex) {
                    tex.colorSpace = THREE.SRGBColorSpace;
                } else if (tex && 'encoding' in tex) {
                    tex.encoding = THREE.sRGBEncoding;
                }
                tex.minFilter = tex.minFilter || THREE.LinearFilter;
                tex.magFilter = tex.magFilter || THREE.LinearFilter;
                tex.needsUpdate = true;
            } catch (e) {
                // ignore and resolve with original texture
            }
            resolve(tex);
        }, undefined, (err) => reject(err));
    });
}

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
        const planeMaterial = new THREE.MeshBasicMaterial({ 
            map: texture, 
            side: THREE.DoubleSide, 
            transparent: true, 
            opacity: imageOpacity // Use global opacity
        });
        const imagePlane = new THREE.Mesh(planeGeometry, planeMaterial);
        imagePlane.userData.isImagePlane = true;
        imagePlane.position.z = -near + 0.0001;
        const dx = (principal_point_x_px - imgW / 2) * (width_near / imgW);
        const dy = (principal_point_y_px - imgH / 2) * (height_near / imgH);
        imagePlane.position.x = -dx;
        imagePlane.position.y = dy;
        cam.add(imagePlane);
    }
    
    const camHelper = new THREE.CameraHelper(cam);

    const colorFrustum = new THREE.Color(0x444444);
    const colorCone = new THREE.Color(0x444444);
    const colorUp = new THREE.Color(0x4444ff);
    const colorCross = new THREE.Color(0x888888);
    const colorTarget = new THREE.Color(0x888888);
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
    camHelper.userData.cameraView = cam.view ? { 
        fullWidth: cam.view.fullWidth, 
        fullHeight: cam.view.fullHeight, 
        offsetX: cam.view.offsetX, 
        offsetY: cam.view.offsetY, 
        width: cam.view.width, 
        height: cam.view.height 
    } : null;
    
    const camWorldPos = new THREE.Vector3();
    cam.getWorldPosition(camWorldPos);
    const camWorldQuat = new THREE.Quaternion();
    cam.getWorldQuaternion(camWorldQuat);
    camHelper.userData.cameraPosition = camWorldPos.clone();
    camHelper.userData.cameraQuaternion = camWorldQuat.clone();
    camHelper.userData.cameraFov = cam.fov;
    camHelper.userData.camera = cam;
    
    scene.add(camHelper);
    scene.add(cam);
    cameraFrustums.push(camHelper);
}

// Hover effect functions remain the same
const _frustumOriginalMaterials = new WeakMap();
function applyFrustumHover(frustum) {
    if (!frustum) return;
    const saved = { materials: [], scale: null, imagePlane: null };
    frustum.traverse(obj => {
        if (obj.material) {
            const mat = obj.material;
            const entry = { obj: obj, color: mat.color ? mat.color.getHex() : null, opacity: mat.opacity !== undefined ? mat.opacity : null };
            saved.materials.push(entry);
            try {
                const shine = new THREE.Color(0x0000ff);
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
    try {
        if (frustum.scale) saved.scale = frustum.scale.clone();
        if (frustum.scale) frustum.scale.multiplyScalar(1.06);
    } catch (e) {
        // ignore
    }

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
                    if (mat.transparent === undefined) mat.transparent = true;
                    // mat.opacity = 1.0;
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
    try {
        if (saved.scale && frustum.scale) frustum.scale.copy(saved.scale);
    } catch (e) {
        // ignore
    }
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

const _meshOriginalState = new WeakMap();
function applyMeshHover(mesh) {
    if (!mesh || !mesh.material) return;
    const orig = {
        scale: mesh.scale.clone(),
        materialProps: null
    };
    const mat = mesh.material;
    orig.materialProps = {
        color: mat.color ? mat.color.getHex() : null,
        opacity: mat.opacity !== undefined ? mat.opacity : null,
        emissive: mat.emissive ? mat.emissive.getHex() : null,
        emissiveIntensity: mat.emissiveIntensity !== undefined ? mat.emissiveIntensity : null
    };
    _meshOriginalState.set(mesh, orig);

    mesh.scale.multiplyScalar(1.02);
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

    const clientSize = new THREE.Vector2();
    renderer.getSize(clientSize);
    const clientFullW = Math.round(clientSize.x);
    const clientFullH = Math.round(clientSize.y);
    const clientViewW = clientFullW;
    const clientViewH = clientFullH;

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

    let mappedTargetView = null;
    if (targetCamera && targetCamera.userData && targetCamera.userData.cameraView) {
        const tv = targetCamera.userData.cameraView;
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

        const currentPos = new THREE.Vector3().lerpVectors(startPos, endPos, te);
        const currentQuat = slerp(startQuat, endQuat, te);
        const currentFov = lerp(startFov, endFov, te);
        camera.position.copy(currentPos);
        camera.quaternion.copy(currentQuat);
        camera.fov = currentFov;

        if (mappedTargetView) {
            const curOffsetX = lerp(originalViewOffset.offsetX, mappedTargetView.offsetX, te);
            const curOffsetY = lerp(originalViewOffset.offsetY, mappedTargetView.offsetY, te);
            try {
                camera.setViewOffset(clientFullW, clientFullH, Math.round(curOffsetX), Math.round(curOffsetY), clientViewW, clientViewH);
            } catch (e) {
                // ignore
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

export function setupThumbnails(thumbnailList, galleryId = 'thumbnailGallery') {
    const gallery = document.getElementById(galleryId);
    if (!gallery) return;
    gallery.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'rerun-thumbnails-wrapper compact';

    const thumbnailsDiv = document.createElement('div');
    thumbnailsDiv.className = 'rerun-thumbnails compact';

    thumbnailList.forEach((item, idx) => {
        const thumbnailDiv = document.createElement('div');
        thumbnailDiv.className = 'rerun-thumbnail';
        thumbnailDiv.setAttribute('data-label', item.label || `Scene ${idx+1}`);
        thumbnailDiv.setAttribute('data-idx', idx);

        if (item.thumbnail) {
            const img = document.createElement('img');
            img.src = item.thumbnail;
            img.alt = item.label || `Scene ${idx+1}`;
            // Let CSS (.rerun-thumbnail img) control sizing and object-fit
            thumbnailDiv.appendChild(img);
        } else {
            thumbnailDiv.style.background = 'linear-gradient(135deg, #667eea, #764ba2)';
            const span = document.createElement('span');
            span.className = 'fallback-label';
            span.textContent = item.label || `Scene ${idx+1}`;
            thumbnailDiv.appendChild(span);
        }

    // cursor/presentation handled via CSS (.rerun-thumbnail)
        thumbnailDiv.onclick = async () => {
            // each click starts a new logical load; bump token so prior loads are ignored
            const myLoadToken = ++_currentLoadToken;

            thumbnailsDiv.querySelectorAll('.rerun-thumbnail').forEach(t => t.classList.remove('active'));
            thumbnailDiv.classList.add('active');

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
                await loadGLBFromMetadata(metadata, parentDir, myLoadToken);
            }
        };

        thumbnailsDiv.appendChild(thumbnailDiv);
    });

    const prevButton = document.createElement('button');
    prevButton.className = 'carousel-button prev';
    prevButton.innerHTML = '‹';
    prevButton.setAttribute('aria-label', 'Previous');
    // presentation handled via CSS (.carousel-button)

    const nextButton = document.createElement('button');
    nextButton.className = 'carousel-button next';
    nextButton.innerHTML = '›';
    nextButton.setAttribute('aria-label', 'Next');
    // presentation handled via CSS (.carousel-button)

    prevButton.addEventListener('click', () => {
        const scrollLeft = thumbnailsDiv.scrollLeft;
        const maxScroll = thumbnailsDiv.scrollWidth - thumbnailsDiv.clientWidth;
        if (scrollLeft <= 0) {
            // wrap to rightmost
            thumbnailsDiv.scrollTo({ left: maxScroll, behavior: 'smooth' });
        } else {
            thumbnailsDiv.scrollBy({ left: -300, behavior: 'smooth' });
        }
    });
    nextButton.addEventListener('click', () => {
        const scrollLeft = thumbnailsDiv.scrollLeft;
        const maxScroll = thumbnailsDiv.scrollWidth - thumbnailsDiv.clientWidth;
        if (scrollLeft >= maxScroll - 1 || maxScroll <= 0) {
            // wrap to leftmost
            thumbnailsDiv.scrollTo({ left: 0, behavior: 'smooth' });
        } else {
            thumbnailsDiv.scrollBy({ left: 300, behavior: 'smooth' });
        }
    });

    const updateButtonStates = () => {
        const itemsCount = thumbnailsDiv.querySelectorAll('.rerun-thumbnail').length;
        const scrollLeft = thumbnailsDiv.scrollLeft;
        const maxScroll = thumbnailsDiv.scrollWidth - thumbnailsDiv.clientWidth;
        const hasItems = itemsCount > 0;
        // Keep buttons enabled when there are thumbnails so wrap-around can work.
        // Only disable when there are no items at all.
        prevButton.disabled = !hasItems;
        nextButton.disabled = !hasItems;
        // For accessibility, update aria-disabled when not active
        prevButton.setAttribute('aria-disabled', (!hasItems).toString());
        nextButton.setAttribute('aria-disabled', (!hasItems).toString());
    };

    thumbnailsDiv.addEventListener('scroll', updateButtonStates);

    const images = thumbnailsDiv.querySelectorAll('img');
    let loadedCount = 0;
    images.forEach(img => {
        if (img.complete) {
            loadedCount++;
        } else {
            img.addEventListener('load', () => {
                loadedCount++;
                if (loadedCount === images.length) updateButtonStates();
            });
        }
    });
    setTimeout(updateButtonStates, 100);

    wrapper.appendChild(prevButton);
    wrapper.appendChild(thumbnailsDiv);
    wrapper.appendChild(nextButton);

    gallery.appendChild(wrapper);

    const firstThumb = thumbnailsDiv.querySelector('.rerun-thumbnail');
    if (firstThumb) firstThumb.classList.add('active');
}

export default {
    addCameraFrustum,
    setupThumbnails,
    initDemoViewer
};