/**
 * Farever Planner — 3D model viewer.
 *
 * A standalone ES module (the one exception to the single-IIFE planner) that renders an item's
 * in-game GLB model in an orbitable three.js modal. It communicates with `gear-planner.js` only
 * through `window.FareverPlanner3D`:
 *
 *   FareverPlanner3D.canRender()          → boolean; false when WebGL is unavailable (hide buttons)
 *   FareverPlanner3D.open({ glbUrl, title }) → open the modal for a relative GLB url
 *
 * three.js is vendored in `assets/vendor/three/` and only imported lazily on first `open()`, so
 * this module costs nothing at page load. GLBs are fetched with relative urls so GitHub Pages
 * sub-path deployments keep working.
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const ORBIT_URL = "./assets/vendor/three/OrbitControls.js";
  const GLTF_URL = "./assets/vendor/three/GLTFLoader.js";

  let webglSupport = null;
  /** Feature-detect WebGL once. Used to hide "View in 3D" buttons on unsupported devices. */
  function canRender() {
    if (webglSupport !== null) return webglSupport;
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      webglSupport = !!(gl && typeof gl.getParameter === "function");
    } catch (e) {
      webglSupport = false;
    }
    return webglSupport;
  }

  let three = null; // { THREE, OrbitControls, GLTFLoader } — resolved on first open()
  let modal = null; // persistent overlay DOM (built once)
  let active = null; // per-open scene runtime; disposed on close
  let invoker = null; // element to refocus on close

  function prefersReducedMotion() {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  async function loadThree() {
    if (three) return three;
    const [THREE, orbit, gltf] = await Promise.all([
      import("three"),
      import(ORBIT_URL),
      import(GLTF_URL),
    ]);
    three = { THREE, OrbitControls: orbit.OrbitControls, GLTFLoader: gltf.GLTFLoader };
    return three;
  }

  function buildModal() {
    const overlay = document.createElement("div");
    overlay.className = "gp-3d-overlay";
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "3D model viewer");
    overlay.innerHTML =
      '<div class="gp-3d-panel" role="document">' +
      '<div class="gp-3d-panel__head">' +
      '<h2 class="gp-3d-panel__title"></h2>' +
      '<button type="button" class="gp-3d-close" aria-label="Close 3D viewer">✕</button>' +
      "</div>" +
      '<div class="gp-3d-canvas-wrap"><div class="gp-3d-status" role="status" aria-live="polite"></div></div>' +
      '<div class="gp-3d-panel__foot">' +
      '<label class="gp-3d-autorotate"><input type="checkbox" class="gp-3d-autorotate__chk" /> <span>Auto-rotate</span></label>' +
      '<span class="gp-3d-hint gp-muted">Drag to orbit · scroll to zoom</span>' +
      "</div>" +
      "</div>";
    document.body.appendChild(overlay);
    modal = {
      overlay,
      panel: overlay.querySelector(".gp-3d-panel"),
      titleEl: overlay.querySelector(".gp-3d-panel__title"),
      statusEl: overlay.querySelector(".gp-3d-status"),
      canvasWrap: overlay.querySelector(".gp-3d-canvas-wrap"),
      autoRotateChk: overlay.querySelector(".gp-3d-autorotate__chk"),
      closeBtn: overlay.querySelector(".gp-3d-close"),
    };
    modal.closeBtn.addEventListener("click", close);
    // Backdrop click (on the overlay itself, not the panel) closes.
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close();
    });
    return modal;
  }

  function setStatus(text, isError) {
    if (!modal) return;
    modal.statusEl.textContent = text || "";
    modal.statusEl.hidden = !text;
    modal.statusEl.classList.toggle("gp-3d-status--error", !!isError);
  }

  function disposeMaterial(m) {
    if (!m) return;
    for (const key in m) {
      const val = m[key];
      if (val && val.isTexture && typeof val.dispose === "function") val.dispose();
    }
    if (typeof m.dispose === "function") m.dispose();
  }

  /** Stop the render loop and release GPU resources so re-opening starts from a clean renderer. */
  function disposeActive() {
    if (!active) return;
    const a = active;
    active = null;
    a.disposed = true;
    if (a.raf) cancelAnimationFrame(a.raf);
    if (a.onResize) window.removeEventListener("resize", a.onResize);
    if (a.controls && typeof a.controls.dispose === "function") a.controls.dispose();
    if (a.scene) {
      a.scene.traverse((obj) => {
        if (obj.geometry && typeof obj.geometry.dispose === "function") obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach(disposeMaterial);
        else if (obj.material) disposeMaterial(obj.material);
      });
    }
    if (a.renderer) {
      a.renderer.dispose();
      const el = a.renderer.domElement;
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
  }

  function close() {
    if (!modal || modal.overlay.hidden) return;
    disposeActive();
    document.removeEventListener("keydown", onKeydown, true);
    modal.overlay.hidden = true;
    setStatus("");
    const inv = invoker;
    invoker = null;
    if (inv && typeof inv.focus === "function") inv.focus();
  }

  function onKeydown(e) {
    if (!modal || modal.overlay.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Tab") {
      const focusables = modal.panel.querySelectorAll(
        "button, input, [tabindex]:not([tabindex='-1'])"
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  /**
   * These GLBs carry a `COLOR_0` attribute that stores gradient-ramp *coordinates* for the game's
   * custom shader, not display colors — GLTFLoader would otherwise render them as a rainbow. We drop
   * vertex colors so the model shows as a cleanly-lit figurine of its true geometry. (Faithfully
   * reproducing the in-game gradient material is a separate project — see the spec's out-of-scope note.)
   */
  function neutralizeVertexColors(root) {
    root.traverse((obj) => {
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      for (const m of mats) {
        if (m && m.vertexColors) {
          m.vertexColors = false;
          m.needsUpdate = true;
        }
      }
    });
  }

  /** Recenter the model on the origin and pull the camera back far enough to frame it at any scale. */
  function frameModel(THREE, object, camera, controls) {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    object.position.sub(center); // model now centered on origin
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 1;
    const fov = (camera.fov * Math.PI) / 180;
    // Fit the bounding sphere in the vertical frustum, then add margin (~1.8x the tight fit).
    const dist = (radius / Math.sin(fov / 2)) * 1.15;
    camera.position.set(0, size.y * 0.15, dist);
    camera.near = Math.max(radius / 100, 0.001);
    camera.far = radius * 100;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.maxDistance = dist * 4;
    controls.minDistance = radius * 0.2;
    controls.update();
  }

  async function open(opts) {
    const glbUrl = opts && opts.glbUrl;
    const title = (opts && opts.title) || "Model";
    if (!glbUrl || !canRender()) return;
    if (!modal) buildModal();

    invoker =
      document.activeElement && typeof document.activeElement.focus === "function"
        ? document.activeElement
        : null;
    disposeActive();
    modal.titleEl.textContent = title;
    modal.overlay.hidden = false;
    setStatus("Loading model…");
    document.addEventListener("keydown", onKeydown, true);
    modal.closeBtn.focus();

    let THREE, OrbitControls, GLTFLoader;
    try {
      ({ THREE, OrbitControls, GLTFLoader } = await loadThree());
    } catch (e) {
      setStatus("Could not load the 3D viewer.", true);
      return;
    }
    if (!modal || modal.overlay.hidden) return; // closed while three loaded

    const wrap = modal.canvasWrap;
    const width = wrap.clientWidth || 640;
    const height = wrap.clientHeight || 420;

    const scene = new THREE.Scene();
    scene.background = null;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 2000);
    camera.position.set(0, 0, 3);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    wrap.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a2f3a, 1.1));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
    dirLight.position.set(2.5, 4, 2);
    scene.add(dirLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = !prefersReducedMotion();
    controls.autoRotateSpeed = 1.6;
    modal.autoRotateChk.checked = controls.autoRotate;
    modal.autoRotateChk.onchange = () => {
      if (active && active.controls) active.controls.autoRotate = modal.autoRotateChk.checked;
    };

    const a = { renderer, scene, camera, controls, raf: 0, disposed: false, onResize: null };
    active = a;

    a.onResize = () => {
      if (a.disposed) return;
      const w = wrap.clientWidth || width;
      const h = wrap.clientHeight || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", a.onResize);

    function animate() {
      if (a.disposed) return;
      a.raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    const loader = new GLTFLoader();
    loader.load(
      glbUrl,
      (gltf) => {
        if (a.disposed) return;
        const model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
        if (!model) {
          setStatus("Could not load this model.", true);
          return;
        }
        scene.add(model);
        neutralizeVertexColors(model);
        frameModel(THREE, model, camera, controls);
        setStatus("");
      },
      undefined,
      () => {
        if (a.disposed) return;
        setStatus("Could not load this model.", true);
      }
    );
  }

  window.FareverPlanner3D = { open, canRender };
})();
