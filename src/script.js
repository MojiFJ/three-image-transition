import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import gsap from 'gsap';

////////////////////
// CONFIGURATION
////////////////////

// Set the image folder to use
// Options: 'images' or 'infravis_days'
const IMAGE_FOLDER = 'images';
// const IMAGE_FOLDER = 'infravis_days';

// Maximum dimensions for the plane (will scale to fit within this)
const MAX_WIDTH = 100;
const MAX_HEIGHT = 60;

// Gallery settings
const GALLERY_CONFIG = {
  autoAdvance: false,        // Automatically advance to next image
  autoAdvanceDelay: 5,       // Seconds to wait before auto-advancing
  shuffleImages: false,      // Randomize image order
  transitionDuration: 3,     // Duration of transition animation in seconds
  transitionDelay: 1,        // Delay between transitions in seconds
  preloadRadius: 3,          // Number of images to preload in each direction (forward & backward)
};

// Load all images from both folders
// Note: Both folders are loaded at build time. To reduce bundle size,
// comment out the folder you don't need before building.
const imageModules = import.meta.glob('./images/**/*.{jpg,jpeg,png}', { eager: true, import: 'default' });
const infravisModules = import.meta.glob('./infravis_days/**/*.{jpg,jpeg,png}', { eager: true, import: 'default' });

// Select which folder to use at runtime
const selectedModules = IMAGE_FOLDER === 'infravis_days' ? infravisModules : imageModules;
let imagePaths = Object.values(selectedModules);

// Shuffle if configured
if (GALLERY_CONFIG.shuffleImages) {
  imagePaths = shuffleArray([...imagePaths]);
}

console.log(`Gallery: ${imagePaths.length} images from '${IMAGE_FOLDER}' folder${GALLERY_CONFIG.shuffleImages ? ' (shuffled)' : ''}`);

////////////////////
// INITIALIZATION
////////////////////

window.onload = init;

let gallery; // Global gallery instance

async function init() {
  if (imagePaths.length < 1) {
    console.error('Need at least 1 image in the folder!');
    return;
  }

  const root = new THREERoot({
    createCameraControls: false,
    antialias: (window.devicePixelRatio === 1),
    fov: 80
  });

  root.renderer.setClearColor(0x000000, 0);
  root.renderer.setPixelRatio(window.devicePixelRatio || 1);
  root.camera.position.set(0, 0, 60);

  // Create gallery
  gallery = new ImageGallery(root, imagePaths);
  await gallery.init();

  // Setup keyboard controls
  setupKeyboardControls();

  // Setup drag/scrubbing controls (once for all transitions)
  createTweenScrubber(gallery);

  console.log('Gallery initialized. Use arrow keys or Space to navigate.');
}

// Helper function to load texture as a promise
function loadTexture(loader, path) {
  return new Promise((resolve, reject) => {
    loader.load(
      path,
      (texture) => resolve(texture),
      undefined,
      (error) => reject(error)
    );
  });
}

// Calculate plane dimensions that preserve aspect ratio and fit within max bounds
function calculatePlaneDimensions(imageWidth, imageHeight) {
  const imageAspect = imageWidth / imageHeight;
  const maxAspect = MAX_WIDTH / MAX_HEIGHT;

  let width, height;

  if (imageAspect > maxAspect) {
    // Image is wider than max bounds - fit to width
    width = MAX_WIDTH;
    height = MAX_WIDTH / imageAspect;
  } else {
    // Image is taller than max bounds - fit to height
    height = MAX_HEIGHT;
    width = MAX_HEIGHT * imageAspect;
  }

  return { width, height };
}

// Helper function to shuffle array
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Setup keyboard controls for gallery navigation
function setupKeyboardControls() {
  window.addEventListener('keydown', (e) => {
    if (!gallery) return;

    switch(e.key) {
      case 'ArrowRight':
      case ' ':
      case 'Enter':
        e.preventDefault();
        gallery.next();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        gallery.previous();
        break;
      case 'p':
      case 'P':
        gallery.togglePause();
        break;
      case 'r':
      case 'R':
        gallery.reset();
        break;
    }
  });
}

////////////////////
// CLASSES
////////////////////

class ImageGallery {
  constructor(root, imagePaths) {
    this.root = root;
    this.imagePaths = imagePaths;
    this.currentIndex = 0;
    this.loader = new THREE.TextureLoader();
    this.textures = [];
    this.currentSlide = null;
    this.nextSlide = null;
    this.isTransitioning = false;
    this.isPaused = false;
    this.timeline = null;
    this.autoAdvanceTimer = null;
  }

  async init() {
    // Load first texture
    console.log(`Loading image 1/${this.imagePaths.length}...`);
    const texture1 = await loadTexture(this.loader, this.imagePaths[0]);
    this.textures[0] = texture1;

    // Create first slide - start it fully visible
    const dims1 = calculatePlaneDimensions(texture1.image.width, texture1.image.height);
    this.currentSlide = new Slide(dims1.width, dims1.height, 'in');
    this.currentSlide.setTexture(texture1);
    this.currentSlide.time = this.currentSlide.totalDuration; // Show immediately
    this.root.scene.add(this.currentSlide);

    console.log(`Image 1: ${texture1.image.width}x${texture1.image.height} -> ${dims1.width.toFixed(1)}x${dims1.height.toFixed(1)}`);

    // Preload nearby images for smooth navigation
    if (this.imagePaths.length > 1) {
      this.preloadAround(this.currentIndex);
    }

    // Setup auto-advance if enabled
    if (GALLERY_CONFIG.autoAdvance) {
      this.startAutoAdvance();
    }
  }

  async preloadAround(centerIndex) {
    // Preload images in both directions (forward and backward)
    const radius = GALLERY_CONFIG.preloadRadius;
    const promises = [];

    for (let offset = -radius; offset <= radius; offset++) {
      if (offset === 0) continue; // Skip current image (already loaded)

      const targetIndex = (centerIndex + offset + this.imagePaths.length) % this.imagePaths.length;

      // Only load if not already cached
      if (!this.textures[targetIndex]) {
        promises.push(
          loadTexture(this.loader, this.imagePaths[targetIndex])
            .then(texture => {
              this.textures[targetIndex] = texture;
              console.log(`Preloaded image ${targetIndex + 1}/${this.imagePaths.length}`);
            })
            .catch(err => {
              console.error(`Failed to preload image ${targetIndex + 1}:`, err);
            })
        );
      }
    }

    // Load all preload promises in parallel
    if (promises.length > 0) {
      await Promise.all(promises);
      console.log(`Preloading complete: ${promises.length} images loaded`);
    }
  }

  async next() {
    if (this.isTransitioning || this.imagePaths.length < 2) return;

    this.stopAutoAdvance();
    this.isTransitioning = true;

    const nextIndex = (this.currentIndex + 1) % this.imagePaths.length;

    // Load next texture if not cached (should be preloaded, but just in case)
    if (!this.textures[nextIndex]) {
      console.log(`Loading image ${nextIndex + 1}/${this.imagePaths.length}...`);
      this.textures[nextIndex] = await loadTexture(this.loader, this.imagePaths[nextIndex]);
    }

    await this.transitionTo(nextIndex);

    // Preload nearby images in background (non-blocking)
    this.preloadAround(this.currentIndex);

    if (GALLERY_CONFIG.autoAdvance) {
      this.startAutoAdvance();
    }
  }

  async previous() {
    if (this.isTransitioning || this.imagePaths.length < 2) return;

    this.stopAutoAdvance();
    this.isTransitioning = true;

    const prevIndex = (this.currentIndex - 1 + this.imagePaths.length) % this.imagePaths.length;

    // Load previous texture if not cached (should be preloaded, but just in case)
    if (!this.textures[prevIndex]) {
      console.log(`Loading image ${prevIndex + 1}/${this.imagePaths.length}...`);
      this.textures[prevIndex] = await loadTexture(this.loader, this.imagePaths[prevIndex]);
    }

    await this.transitionTo(prevIndex);

    // Preload nearby images in background (non-blocking)
    this.preloadAround(this.currentIndex);

    if (GALLERY_CONFIG.autoAdvance) {
      this.startAutoAdvance();
    }
  }

  async transitionTo(targetIndex) {
    const texture = this.textures[targetIndex];
    const dims = calculatePlaneDimensions(texture.image.width, texture.image.height);

    console.log(`Transitioning to image ${targetIndex + 1}/${this.imagePaths.length}`);
    console.log(`  ${texture.image.width}x${texture.image.height} -> ${dims.width.toFixed(1)}x${dims.height.toFixed(1)}`);

    // Create new slide (will transition in)
    this.nextSlide = new Slide(dims.width, dims.height, 'in');
    this.nextSlide.setTexture(texture);
    this.root.scene.add(this.nextSlide);

    // Update current slide to transition out
    if (this.currentSlide) {
      this.currentSlide.phase = 'out';
      // Reset its time to 0 so it can transition out
      this.currentSlide.time = 0;
    }

    // Create timeline for transition with Promise
    return new Promise(resolve => {
      this.timeline = gsap.timeline({
        onComplete: () => {
          // Remove old slide
          if (this.currentSlide) {
            this.root.scene.remove(this.currentSlide);
            this.currentSlide.geometry.dispose();
            this.currentSlide.material.dispose();
          }

          // Update references
          this.currentSlide = this.nextSlide;
          this.nextSlide = null;
          this.currentIndex = targetIndex;
          this.isTransitioning = false;

          // Resolve the promise
          resolve();
        }
      });

      // Add both transitions
      if (this.currentSlide) {
        this.timeline.add(this.currentSlide.transition(), 0);
      }
      this.timeline.add(this.nextSlide.transition(), 0);
    });
  }

  startAutoAdvance() {
    this.stopAutoAdvance();
    this.autoAdvanceTimer = setTimeout(() => {
      this.next();
    }, GALLERY_CONFIG.autoAdvanceDelay * 1000);
  }

  stopAutoAdvance() {
    if (this.autoAdvanceTimer) {
      clearTimeout(this.autoAdvanceTimer);
      this.autoAdvanceTimer = null;
    }
  }

  togglePause() {
    if (this.timeline) {
      this.isPaused = !this.isPaused;
      this.timeline.paused(this.isPaused);
      console.log(this.isPaused ? 'Paused' : 'Resumed');
    }
  }

  reset() {
    console.log('Resetting gallery to first image...');
    this.stopAutoAdvance();
    if (this.currentIndex !== 0) {
      this.currentIndex = this.imagePaths.length - 1; // Set to before 0
      this.next(); // This will advance to 0
    }
  }
}

class Slide extends THREE.Mesh {
  constructor(width, height, animationPhase) {
    // Create plane geometry
    const widthSegments = width * 2;
    const heightSegments = height * 2;
    const planeGeometry = new THREE.PlaneGeometry(width, height, widthSegments, heightSegments);

    // Convert to non-indexed geometry for face separation
    const geometry = planeGeometry.toNonIndexed();

    // Create custom attributes for animation
    const positionAttribute = geometry.attributes.position;
    const faceCount = positionAttribute.count / 3;

    // Animation attributes
    const aAnimation = new Float32Array(positionAttribute.count * 2);
    const aStartPosition = new Float32Array(positionAttribute.count * 3);
    const aControl0 = new Float32Array(positionAttribute.count * 3);
    const aControl1 = new Float32Array(positionAttribute.count * 3);
    const aEndPosition = new Float32Array(positionAttribute.count * 3);

    const minDuration = 0.8;
    const maxDuration = 1.2;
    const maxDelayX = 0.9;
    const maxDelayY = 0.125;
    const stretch = 0.11;

    const totalDuration = maxDuration + maxDelayX + maxDelayY + stretch;

    // Process each face
    for (let i = 0; i < faceCount; i++) {
      const faceIndex = i * 3;

      // Calculate face centroid
      const v0 = new THREE.Vector3().fromBufferAttribute(positionAttribute, faceIndex);
      const v1 = new THREE.Vector3().fromBufferAttribute(positionAttribute, faceIndex + 1);
      const v2 = new THREE.Vector3().fromBufferAttribute(positionAttribute, faceIndex + 2);
      const centroid = new THREE.Vector3().add(v0).add(v1).add(v2).divideScalar(3);

      // Animation timing
      const duration = THREE.MathUtils.randFloat(minDuration, maxDuration);
      const delayX = THREE.MathUtils.mapLinear(centroid.x, -width * 0.5, width * 0.5, 0.0, maxDelayX);
      let delayY;

      if (animationPhase === 'in') {
        delayY = THREE.MathUtils.mapLinear(Math.abs(centroid.y), 0, height * 0.5, 0.0, maxDelayY);
      } else {
        delayY = THREE.MathUtils.mapLinear(Math.abs(centroid.y), 0, height * 0.5, maxDelayY, 0.0);
      }

      // Set animation data for all 3 vertices of the face
      for (let v = 0; v < 3; v++) {
        const vertexIndex = faceIndex + v;
        aAnimation[vertexIndex * 2] = delayX + delayY + (Math.random() * stretch * duration);
        aAnimation[vertexIndex * 2 + 1] = duration;
      }

      // Control points for bezier curve
      const control0 = getControlPoint0(centroid, animationPhase);
      const control1 = getControlPoint1(centroid, animationPhase);

      // Set position data for all 3 vertices
      for (let v = 0; v < 3; v++) {
        const vertexIndex = faceIndex + v;
        const i3 = vertexIndex * 3;

        aStartPosition[i3] = centroid.x;
        aStartPosition[i3 + 1] = centroid.y;
        aStartPosition[i3 + 2] = centroid.z;

        aControl0[i3] = control0.x;
        aControl0[i3 + 1] = control0.y;
        aControl0[i3 + 2] = control0.z;

        aControl1[i3] = control1.x;
        aControl1[i3 + 1] = control1.y;
        aControl1[i3 + 2] = control1.z;

        aEndPosition[i3] = centroid.x;
        aEndPosition[i3 + 1] = centroid.y;
        aEndPosition[i3 + 2] = centroid.z;

        // Adjust vertex positions relative to centroid
        const originalPos = new THREE.Vector3().fromBufferAttribute(positionAttribute, vertexIndex);
        positionAttribute.setXYZ(vertexIndex,
          originalPos.x - centroid.x,
          originalPos.y - centroid.y,
          originalPos.z - centroid.z
        );
      }
    }

    // Add custom attributes to geometry
    geometry.setAttribute('aAnimation', new THREE.BufferAttribute(aAnimation, 2));
    geometry.setAttribute('aStartPosition', new THREE.BufferAttribute(aStartPosition, 3));
    geometry.setAttribute('aControl0', new THREE.BufferAttribute(aControl0, 3));
    geometry.setAttribute('aControl1', new THREE.BufferAttribute(aControl1, 3));
    geometry.setAttribute('aEndPosition', new THREE.BufferAttribute(aEndPosition, 3));

    // Create shader material
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uTexture: { value: null },
        uPhase: { value: animationPhase === 'in' ? 1.0 : -1.0 } // 1.0 for 'in', -1.0 for 'out'
      },
      vertexShader: `
        uniform float uTime;
        uniform float uPhase;
        attribute vec2 aAnimation;
        attribute vec3 aStartPosition;
        attribute vec3 aControl0;
        attribute vec3 aControl1;
        attribute vec3 aEndPosition;

        varying vec2 vUv;

        // Cubic bezier function
        vec3 cubicBezier(vec3 p0, vec3 c0, vec3 c1, vec3 p1, float t) {
          float tn = 1.0 - t;
          return tn * tn * tn * p0 + 3.0 * tn * tn * t * c0 + 3.0 * tn * t * t * c1 + t * t * t * p1;
        }

        // Ease in out cubic
        float ease(float t, float b, float c, float d) {
          t /= d / 2.0;
          if (t < 1.0) return c / 2.0 * t * t * t + b;
          t -= 2.0;
          return c / 2.0 * (t * t * t + 2.0) + b;
        }

        void main() {
          vUv = uv;

          float tDelay = aAnimation.x;
          float tDuration = aAnimation.y;
          float tTime = clamp(uTime - tDelay, 0.0, tDuration);
          float tProgress = ease(tTime, 0.0, 1.0, tDuration);

          vec3 newPosition = position;
          // Use uPhase: 1.0 for 'in' (scale up), -1.0 for 'out' (scale down)
          if (uPhase > 0.0) {
            newPosition *= tProgress;
          } else {
            newPosition *= 1.0 - tProgress;
          }
          newPosition += cubicBezier(aStartPosition, aControl0, aControl1, aEndPosition, tProgress);

          gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        varying vec2 vUv;

        void main() {
          gl_FragColor = texture2D(uTexture, vUv);
        }
      `,
      side: THREE.DoubleSide
    });

    super(geometry, material);

    this.frustumCulled = false;
    this.totalDuration = totalDuration;
    this.animationPhase = animationPhase; // Store the phase
  }

  get time() {
    return this.material.uniforms.uTime.value;
  }

  set time(v) {
    this.material.uniforms.uTime.value = v;
  }

  get phase() {
    return this.animationPhase;
  }

  set phase(value) {
    this.animationPhase = value;
    this.material.uniforms.uPhase.value = value === 'in' ? 1.0 : -1.0;
  }

  setTexture(texture) {
    this.material.uniforms.uTexture.value = texture;
    this.material.needsUpdate = true;
  }

  transition() {
    return gsap.fromTo(this,
      { time: 0.0 },
      { time: this.totalDuration, duration: GALLERY_CONFIG.transitionDuration, ease: 'none' }
    );
  }
}

function getControlPoint0(centroid, animationPhase) {
  const signY = Math.sign(centroid.y);
  const point = new THREE.Vector3(
    THREE.MathUtils.randFloat(0.1, 0.3) * 50,
    signY * THREE.MathUtils.randFloat(0.1, 0.3) * 70,
    THREE.MathUtils.randFloatSpread(20)
  );

  if (animationPhase === 'in') {
    return new THREE.Vector3().copy(centroid).sub(point);
  } else {
    return new THREE.Vector3().copy(centroid).add(point);
  }
}

function getControlPoint1(centroid, animationPhase) {
  const signY = Math.sign(centroid.y);
  const point = new THREE.Vector3(
    THREE.MathUtils.randFloat(0.3, 0.6) * 50,
    -signY * THREE.MathUtils.randFloat(0.3, 0.6) * 70,
    THREE.MathUtils.randFloatSpread(20)
  );

  if (animationPhase === 'in') {
    return new THREE.Vector3().copy(centroid).sub(point);
  } else {
    return new THREE.Vector3().copy(centroid).add(point);
  }
}

class THREERoot {
  constructor(params) {
    params = Object.assign({
      fov: 60,
      zNear: 10,
      zFar: 100000,
      createCameraControls: true,
      antialias: true
    }, params);

    this.renderer = new THREE.WebGLRenderer({
      antialias: params.antialias,
      alpha: true
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    document.getElementById('three-container').appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      params.fov,
      window.innerWidth / window.innerHeight,
      params.zNear,
      params.zFar
    );

    this.scene = new THREE.Scene();

    if (params.createCameraControls) {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    }

    this.resize = this.resize.bind(this);
    this.tick = this.tick.bind(this);

    this.resize();
    this.tick();

    window.addEventListener('resize', this.resize, false);
  }

  tick() {
    this.update();
    this.render();
    requestAnimationFrame(this.tick);
  }

  update() {
    if (this.controls) {
      this.controls.update();
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

function createTweenScrubber(galleryInstance, seekSpeed = 0.001) {
  let _cx = 0;
  let _startX = 0; // Track starting position
  let mouseDown = false;
  let transitionInitiated = false;
  let transitionDirection = null; // 'next' or 'previous'

  function stop() {
    if (galleryInstance.timeline) {
      galleryInstance.timeline.pause();
    }
  }

  function resume() {
    if (galleryInstance.timeline) {
      galleryInstance.timeline.play();
    }
  }

  function seek(dx, totalDx) {
    // If no active timeline or it's completed, initiate a transition
    const needsNewTimeline = !galleryInstance.timeline || galleryInstance.timeline.progress() === 1;

    if (needsNewTimeline && !transitionInitiated && !galleryInstance.isTransitioning) {
      // Use total accumulated distance from mousedown with a larger threshold
      // This prevents accidental triggers from small jitters
      const threshold = 30;

      if (Math.abs(totalDx) > threshold) {
        transitionInitiated = true;
        transitionDirection = totalDx > 0 ? 'next' : 'previous';
        console.log(`Drag: initiating ${transitionDirection} transition (totalDx: ${totalDx})`);

        // Start transition (non-blocking)
        if (transitionDirection === 'next') {
          galleryInstance.next().then(() => {
            // Immediately pause the timeline once it's created
            if (galleryInstance.timeline && mouseDown) {
              galleryInstance.timeline.pause();
            }
          });
        } else {
          galleryInstance.previous().then(() => {
            // Immediately pause the timeline once it's created
            if (galleryInstance.timeline && mouseDown) {
              galleryInstance.timeline.pause();
            }
          });
        }
        return; // Don't scrub on the initiation frame
      }
    }

    // Scrub the active timeline
    if (galleryInstance.timeline && transitionInitiated) {
      const progress = galleryInstance.timeline.progress();

      // For 'previous' transitions, invert dx so dragging left increases progress
      const effectiveDx = transitionDirection === 'previous' ? -dx : dx;
      const newProgress = THREE.MathUtils.clamp(progress + (effectiveDx * seekSpeed), 0, 1);

      galleryInstance.timeline.progress(newProgress);
    }
  }

  // desktop
  document.body.style.cursor = 'pointer';

  window.addEventListener('mousedown', function(e) {
    mouseDown = true;
    transitionInitiated = false;
    transitionDirection = null;
    document.body.style.cursor = 'ew-resize';
    _cx = e.clientX;
    _startX = e.clientX; // Record starting position

    // If there's an active timeline, pause it
    if (galleryInstance.timeline && galleryInstance.timeline.progress() < 1) {
      stop();
      transitionInitiated = true; // Mark as already having a transition
      // Note: transitionDirection is unknown here, will be handled in scrubbing
    }
  });

  window.addEventListener('mouseup', function() {
    mouseDown = false;
    transitionInitiated = false;
    transitionDirection = null;
    document.body.style.cursor = 'pointer';
    resume();
  });

  window.addEventListener('mousemove', function(e) {
    if (mouseDown === true) {
      const cx = e.clientX;
      const dx = cx - _cx; // Incremental distance
      const totalDx = cx - _startX; // Total distance from mousedown
      _cx = cx;
      seek(dx, totalDx);
    }
  });

  // mobile
  window.addEventListener('touchstart', function(e) {
    transitionInitiated = false;
    transitionDirection = null;
    _cx = e.touches[0].clientX;
    _startX = e.touches[0].clientX; // Record starting position

    // If there's an active timeline, pause it
    if (galleryInstance.timeline && galleryInstance.timeline.progress() < 1) {
      stop();
      transitionInitiated = true; // Mark as already having a transition
    }
    e.preventDefault();
  });

  window.addEventListener('touchend', function(e) {
    transitionInitiated = false;
    transitionDirection = null;
    resume();
    e.preventDefault();
  });

  window.addEventListener('touchmove', function(e) {
    const cx = e.touches[0].clientX;
    const dx = cx - _cx; // Incremental distance
    const totalDx = cx - _startX; // Total distance from touchstart
    _cx = cx;
    seek(dx, totalDx);
    e.preventDefault();
  });
}
