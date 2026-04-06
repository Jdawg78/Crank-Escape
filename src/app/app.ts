import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, HostListener, ChangeDetectorRef, Inject, PLATFORM_ID } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { AudioService } from './audio.service';
import { CommonModule, isPlatformBrowser } from '@angular/common';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements AfterViewInit, OnDestroy {
  @ViewChild('canvasContainer', { static: true }) canvasContainer!: ElementRef<HTMLDivElement>;

  Math = Math;

  // Game State
  revolutions = 0;
  coins = 0;
  crankPower = 1;
  coinMultiplier = 1;
  autoCrank = 0;
  passiveCoins = 0;
  costs = { power: 10, multi: 50, energy: 500, bribe: 1000, goon: 2500 };

  // UI State
  isMobile = false;
  isLocked = false;
  
  crosshairTransform = 'translate(-50%, -50%) scale(1)';
  crosshairBg = 'rgba(255, 255, 255, 0.8)';
  tooltipDisplay = 'none';
  tooltipText = 'Click to Interact';

  joyBaseDisplay = 'none';
  joyBaseLeft = 0;
  joyBaseTop = 0;
  joyKnobTransform = 'translate(0px, 0px)';
  mobileHintDisplay = 'block';

  // Three.js
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  renderer!: THREE.WebGLRenderer;
  composer!: EffectComposer;
  animationFrameId: number = 0;
  
  interactables: THREE.Mesh[] = [];
  upgradeMarkers: THREE.Mesh[] = [];
  crankAssembly!: THREE.Group;
  rotator!: THREE.Group;
  ledTexture!: THREE.CanvasTexture;
  ledCtx!: CanvasRenderingContext2D;
  ledCanvas!: HTMLCanvasElement;
  hangingLamps: THREE.SpotLight[] = [];

  // Effects & Feedback
  shakeIntensity = 0;
  caughtEffectIntensity = 0;
  time = 0;

  // Controls
  moveForward = false;
  moveBackward = false;
  moveLeft = false;
  moveRight = false;
  velocity = new THREE.Vector3();
  direction = new THREE.Vector3();
  euler = new THREE.Euler(0, 0, 0, 'YXZ');
  raycaster = new THREE.Raycaster();
  centerPoint = new THREE.Vector2(0, 0);

  targetRotation = 0;
  currentRotation = 0;
  prevTime = 0;

  // Mobile Touch
  leftTouchId: number | null = null;
  rightTouchId: number | null = null;
  rightTouchStart = { x: 0, y: 0 };
  isDraggingRight = false;
  joyVector = { x: 0, y: 0 };
  joyOrigin = { x: 0, y: 0 };

  autoCrankInterval: any;

  // Guard State
  guardGroup!: THREE.Group;
  guardLight!: THREE.SpotLight;
  guardAudio!: THREE.PositionalAudio;
  guardZ = -40; // Starts deep in the hallway
  guardDirection = 1; // 1 for moving forward, -1 for moving backward
  guardSpeed = 3.0;
  guardState: 'patrolling' | 'catching' = 'patrolling';
  lastCheckpoint = 0;
  checkpointInterval = 50;
  isCaught = false;
  caughtTimer = 0;
  lastCrankTime = 0;

  // Particles
  particles!: THREE.Points;
  particleGeometry!: THREE.BufferGeometry;
  particleMaterial!: THREE.PointsMaterial;
  particleCount = 200;
  particlePositions!: Float32Array;
  particleVelocities!: Float32Array;
  particleLifetimes!: Float32Array;
  activeParticles = 0;

  // Gamepad State
  gamepadButtonPrevPressed = false;
  gamepadValues = { x: 0, y: 0, lookX: 0, lookY: 0 };

  constructor(
    private audioService: AudioService, 
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    if (isPlatformBrowser(this.platformId)) {
      this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || navigator.maxTouchPoints > 0;
      this.prevTime = performance.now();
    }
  }

  ngAfterViewInit() {
    if (!isPlatformBrowser(this.platformId)) return;

    this.initThreeJS();
    this.updateLedSign();
    this.animate();

    this.autoCrankInterval = setInterval(() => {
      if (this.isCaught) return; // Pause auto-crank while caught
      
      if (this.autoCrank > 0 || this.passiveCoins > 0) {
        this.revolutions += this.autoCrank;
        this.coins += (this.autoCrank * 8) * this.coinMultiplier;
        this.coins += this.passiveCoins;
        this.targetRotation -= (Math.PI * 2) * this.autoCrank;
        this.updateLedSign();
        this.cdr.detectChanges();
      }
    }, 1000);

    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  ngOnDestroy() {
    if (!isPlatformBrowser(this.platformId)) return;
    cancelAnimationFrame(this.animationFrameId);
    clearInterval(this.autoCrankInterval);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    if (this.composer) {
      this.composer.dispose();
    }
    if (this.renderer) {
      this.renderer.dispose();
    }
  }

  createHangingLamp(x: number, y: number, z: number, targetX: number, targetY: number, targetZ: number) {
    const lampGroup = new THREE.Group();
    lampGroup.position.set(x, y, z);
    
    // Wire/Cord
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 4),
      new THREE.MeshStandardMaterial({ color: 0x111111 })
    );
    cord.position.y = -2;
    lampGroup.add(cord);

    // Lamp Shade
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.8, 0.6, 16, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x222222, side: THREE.DoubleSide, roughness: 0.5 })
    );
    shade.position.y = -4;
    lampGroup.add(shade);

    // Bulb
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffeedd })
    );
    bulb.position.y = -4.1;
    lampGroup.add(bulb);

    // Main Light
    const spotLight = new THREE.SpotLight(0xffeedd, 3.5, 25, Math.PI / 3.5, 0.4, 1);
    spotLight.position.set(0, -4.2, 0);
    // Target is relative to the lamp group
    spotLight.target.position.set(targetX - x, targetY - y, targetZ - z);
    spotLight.castShadow = true;
    spotLight.shadow.bias = -0.001;
    lampGroup.add(spotLight);
    lampGroup.add(spotLight.target);
    this.hangingLamps.push(spotLight);

    this.scene.add(lampGroup);
  }

  initThreeJS() {
    if (this.renderer) {
      this.renderer.dispose();
      const canvas = this.canvasContainer.nativeElement.querySelector('canvas');
      if (canvas) canvas.remove();
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a0a); // Atmospheric black
    this.scene.fog = new THREE.FogExp2(0x0a0a0a, 0.05);

    const width = this.canvasContainer.nativeElement.clientWidth || window.innerWidth;
    const height = this.canvasContainer.nativeElement.clientHeight || window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 1000);
    this.camera.position.set(0, 2.4, 4);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x0a0a0a);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ReinhardToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.canvasContainer.nativeElement.appendChild(this.renderer.domElement);
    
    // Force a clear color check
    // Post-processing
    const renderScene = new RenderPass(this.scene, this.camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.21;
    bloomPass.strength = 1.2;
    bloomPass.radius = 0.55;
    const outputPass = new OutputPass();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderScene);
    this.composer.addPass(bloomPass);
    this.composer.addPass(outputPass);

    // Lighting
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.05)); // Atmospheric dark ambient

    this.createHangingLamp(0, 12, 0, 1.5, 5, 0.5); // Center room lamp// Hanging Lamp 1 (Crank)
    this.createHangingLamp(0, 12, -2, 0, 0, -2); // Point straight down at the crank

    // Hanging Lamp 2 (Vending Machine)
    this.createHangingLamp(5.5, 12, 0, 7.25, 2.5, 0); // Point at the vending machine

    const brickMat = new THREE.MeshStandardMaterial({ map: this.createBrickTexture(), roughness: 0.9, side: THREE.BackSide });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8, side: THREE.BackSide });
    const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 1.0, side: THREE.BackSide });
    const invisibleMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.BackSide });

    // Materials: [Right, Left, Top, Bottom, Front, Back]
    const roomMaterials = [
      brickMat,      // +x (Right)
      invisibleMat,  // -x (Left - cut out for bars)
      ceilingMat,    // +y (Top)
      floorMat,      // -y (Bottom)
      brickMat,      // +z (Front)
      brickMat       // -z (Back)
    ];

    const room = new THREE.Mesh(
      new THREE.BoxGeometry(16, 12, 16),
      roomMaterials
    );
    room.position.y = 6;
    room.receiveShadow = true;
    this.scene.add(room);

    // Iron Bars (Left Wall)
    const barsGroup = new THREE.Group();
    barsGroup.position.set(-8, 0, 0);

    const barMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8, roughness: 0.3 });
    const barGeo = new THREE.CylinderGeometry(0.1, 0.1, 12, 16);
    for (let i = -7.5; i <= 7.5; i += 1.5) {
      const bar = new THREE.Mesh(barGeo, barMat);
      bar.position.set(0, 6, i);
      bar.castShadow = true;
      bar.receiveShadow = true;
      barsGroup.add(bar);
    }

    // Horizontal crossbars
    const crossBarGeo = new THREE.CylinderGeometry(0.08, 0.08, 16, 8);
    crossBarGeo.rotateX(Math.PI / 2);
    
    const crossBar1 = new THREE.Mesh(crossBarGeo, barMat);
    crossBar1.position.set(0, 4, 0);
    crossBar1.castShadow = true;
    crossBar1.receiveShadow = true;
    barsGroup.add(crossBar1);

    const crossBar2 = new THREE.Mesh(crossBarGeo, barMat);
    crossBar2.position.set(0, 8, 0);
    crossBar2.castShadow = true;
    crossBar2.receiveShadow = true;
    barsGroup.add(crossBar2);

    this.scene.add(barsGroup);

    // Hallway (Outside the bars)
    const hallwayGroup = new THREE.Group();
    const hallMat = new THREE.MeshStandardMaterial({ map: this.createBrickTexture(), roughness: 0.9, side: THREE.DoubleSide });
    
    // Floor
    const hallFloor = new THREE.Mesh(new THREE.PlaneGeometry(8, 60), hallMat);
    hallFloor.rotation.x = -Math.PI / 2;
    hallFloor.position.set(-12, 0, 0);
    hallFloor.receiveShadow = true;
    hallwayGroup.add(hallFloor);

    // Ceiling
    const hallCeiling = new THREE.Mesh(new THREE.PlaneGeometry(8, 60), hallMat);
    hallCeiling.rotation.x = Math.PI / 2;
    hallCeiling.position.set(-12, 12, 0);
    hallCeiling.receiveShadow = true;
    hallwayGroup.add(hallCeiling);

    // Left Wall
    const hallLeft = new THREE.Mesh(new THREE.PlaneGeometry(60, 12), hallMat);
    hallLeft.rotation.y = Math.PI / 2;
    hallLeft.position.set(-16, 6, 0);
    hallLeft.receiveShadow = true;
    hallwayGroup.add(hallLeft);

    // Right Wall (Front part, z > 8)
    const hallRightFront = new THREE.Mesh(new THREE.PlaneGeometry(22, 12), hallMat);
    hallRightFront.rotation.y = -Math.PI / 2;
    hallRightFront.position.set(-8, 6, 19);
    hallRightFront.receiveShadow = true;
    hallwayGroup.add(hallRightFront);

    // Right Wall (Back part, z < -8)
    const hallRightBack = new THREE.Mesh(new THREE.PlaneGeometry(22, 12), hallMat);
    hallRightBack.rotation.y = -Math.PI / 2;
    hallRightBack.position.set(-8, 6, -19);
    hallRightBack.receiveShadow = true;
    hallwayGroup.add(hallRightBack);

    // Front Wall (z = 30)
    const hallFront = new THREE.Mesh(new THREE.PlaneGeometry(8, 12), hallMat);
    hallFront.rotation.y = Math.PI;
    hallFront.position.set(-12, 6, 30);
    hallFront.receiveShadow = true;
    hallwayGroup.add(hallFront);

    // Back Wall (z = -30)
    const hallBack = new THREE.Mesh(new THREE.PlaneGeometry(8, 12), hallMat);
    hallBack.position.set(-12, 6, -30);
    hallBack.receiveShadow = true;
    hallwayGroup.add(hallBack);

    this.scene.add(hallwayGroup);

    // Dim hallway lights
    const hallLight1 = new THREE.PointLight(0x444433, 0.6, 25);
    hallLight1.position.set(-12, 10, -20);
    this.scene.add(hallLight1);

    const hallLight2 = new THREE.PointLight(0x444433, 0.6, 25);
    hallLight2.position.set(-12, 10, 20);
    this.scene.add(hallLight2);

    // Guard & Flashlight
    this.guardGroup = new THREE.Group();
    this.guardGroup.position.set(-12, 4, this.guardZ);
    
    // Guard Body (simple dark capsule)
    const guardBody = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.8, 4, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1.0 })
    );
    this.guardGroup.add(guardBody);

    // Flashlight Beam
    this.guardLight = new THREE.SpotLight(0xffffff, 10.0, 40, Math.PI / 6, 0.5, 1);
    this.guardLight.position.set(0, 1, 0); // Chest height
    this.guardLight.castShadow = true;
    this.guardLight.shadow.bias = -0.001;
    this.guardGroup.add(this.guardLight);
    this.guardGroup.add(this.guardLight.target);
    
    // Flashlight target points towards the cell
    this.guardLight.target.position.set(12, -1, 0);

    // Guard Audio (Footsteps)
    const listener = new THREE.AudioListener();
    this.camera.add(listener);
    this.guardAudio = new THREE.PositionalAudio(listener);
    
    const audioLoader = new THREE.AudioLoader();
    audioLoader.load('sounds/footsteps.mp3', (buffer) => {
      this.guardAudio.setBuffer(buffer);
      this.guardAudio.setRefDistance(5);
      this.guardAudio.setMaxDistance(40);
      this.guardAudio.setRolloffFactor(1);
      this.guardAudio.setLoop(true);
      this.guardAudio.setVolume(1.5);
      if (this.isLocked) {
        this.guardAudio.play();
      }
    }, undefined, (err) => {
      console.warn('Failed to load footsteps.mp3', err);
    });
    this.guardGroup.add(this.guardAudio);

    this.scene.add(this.guardGroup);

    // LED Sign
    this.ledCanvas = document.createElement('canvas');
    this.ledCanvas.width = 1024;
    this.ledCanvas.height = 512;
    this.ledCtx = this.ledCanvas.getContext('2d')!;
    this.ledTexture = new THREE.CanvasTexture(this.ledCanvas);

    const ledMat = new THREE.MeshBasicMaterial({ map: this.ledTexture });
    const ledSign = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), ledMat);
    ledSign.position.set(0, 5, -7.9);
    this.scene.add(ledSign);

    const glowLight = new THREE.PointLight(0xff2222, 1.5, 10);
    glowLight.position.set(0, 5, -7.0);
    this.scene.add(glowLight);

    // Crank
    this.crankAssembly = new THREE.Group();
    this.crankAssembly.position.set(0, 1.5, -2);

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 2, 1.5),
      new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 1.0 })
    );
    base.position.y = -0.5;
    base.castShadow = true;
    base.receiveShadow = true;
    this.crankAssembly.add(base);

    this.rotator = new THREE.Group();
    this.rotator.position.y = 0.5;

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 0.5, 16),
      new THREE.MeshStandardMaterial({ 
        color: 0x888888, 
        metalness: 0.5, 
        roughness: 0.5,
        emissive: 0x222222
      })
    );
    hub.castShadow = true;
    this.rotator.add(hub);

    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.3, 2.5),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.9, roughness: 0.5 })
    );
    arm.position.set(0, 0, 1.25);
    arm.castShadow = true;
    this.rotator.add(arm);

    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.8, 16),
      new THREE.MeshStandardMaterial({ 
        color: 0x333333, 
        metalness: 0.5, 
        roughness: 0.5,
        emissive: 0x111111
      })
    );
    handle.position.set(0, 0.4, 2.3);
    handle.castShadow = true;
    this.rotator.add(handle);

    this.crankAssembly.add(this.rotator);
    this.scene.add(this.crankAssembly);

    const crankHitbox = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), new THREE.MeshBasicMaterial({ visible: false }));
    crankHitbox.position.copy(this.crankAssembly.position);
    crankHitbox.userData = { type: 'crank', name: 'Turn Crank' };
    this.scene.add(crankHitbox);
    this.interactables.push(crankHitbox);

    // Vending Machine
    const vendingGroup = new THREE.Group();
    vendingGroup.position.set(7.25, 0, 0); // Base at floor
    vendingGroup.rotation.y = -Math.PI / 2;
    this.scene.add(vendingGroup);

    const loader = new GLTFLoader();
    loader.load('vending.glb', (gltf: any) => {
      const model = gltf.scene;
      // Scale it if needed, assuming it's roughly 1x1x1 or similar
      // Let's try to fit it to the previous size (4.5 wide, 5 high, 1.5 deep)
      // We'll calculate its bounding box to scale it correctly
      const bbox = new THREE.Box3().setFromObject(model);
      const size = bbox.getSize(new THREE.Vector3());
      const scaleX = 4.5 / size.x;
      const scaleY = 5.0 / size.y;
      const scaleZ = 1.5 / size.z;
      const scale = Math.min(scaleX, scaleY, scaleZ);
      model.scale.set(scale, scale, scale);
      
      // Center it horizontally/depth-wise, but keep base at y=0
      model.position.y = -bbox.min.y * scale;
      
      model.traverse((child: any) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      vendingGroup.add(model);
    }, undefined, (error: any) => {
      console.error('Error loading vending.glb:', error);
      // Fallback to procedural body if GLB fails
      // Fallback TO THE FALLBACK: Ensure it is REALLY BRIGHT
      const vmBody = new THREE.Mesh(
        new THREE.BoxGeometry(4.5, 5, 1.5),
        new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.5, roughness: 0.5 })
      );
      vmBody.position.y = 2.5;
      vmBody.castShadow = true;
      vmBody.receiveShadow = true;
      vendingGroup.add(vmBody);
    });

    const btnGeo = new THREE.SphereGeometry(0.12, 16, 16);
    const createMarker = (color: number, y: number, type: string, nameFn: () => string) => {
      const mesh = new THREE.Mesh(btnGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }));
      mesh.position.set(1.5, y, 1.1); // Right side of the machine, slightly in front
      mesh.userData = { type, getName: nameFn, baseY: y };
      vendingGroup.add(mesh);
      this.interactables.push(mesh);
      this.upgradeMarkers.push(mesh);
    };

    createMarker(0xff4444, 3.8, 'upgrade_power', () => `Buy WD-40 (+Power) - ${this.costs.power} Coins`);
    createMarker(0x44ff44, 3.3, 'upgrade_multi', () => `Buy Snacks (x2 Coins) - ${this.costs.multi} Coins`);
    createMarker(0xffff44, 2.8, 'upgrade_energy', () => `Buy Energy Drink (+5 Power) - ${this.costs.energy} Coins`);
    createMarker(0xff44ff, 2.3, 'upgrade_bribe', () => `Bribe Guard (+10 Coins/sec) - ${this.costs.bribe} Coins`);
    createMarker(0xff8844, 1.8, 'upgrade_goon', () => `Hire Goon (+5 Rev/sec) - ${this.costs.goon} Coins`);

    this.scene.add(vendingGroup);

    // Particles
    this.particleGeometry = new THREE.BufferGeometry();
    this.particlePositions = new Float32Array(this.particleCount * 3);
    this.particleVelocities = new Float32Array(this.particleCount * 3);
    this.particleLifetimes = new Float32Array(this.particleCount);
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    this.particleGeometry.setDrawRange(0, 0);
    
    this.particleMaterial = new THREE.PointsMaterial({
      color: 0xffaa00,
      size: 0.15,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });
    
    this.particles = new THREE.Points(this.particleGeometry, this.particleMaterial);
    this.scene.add(this.particles);
  }

  createBrickTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#555555';
    ctx.fillRect(0, 0, 512, 512);

    const rows = 16, cols = 8;
    const bWidth = 512 / cols, bHeight = 512 / rows, mSize = 4;

    for (let y = 0; y < rows; y++) {
      const offset = (y % 2 === 0) ? 0 : bWidth / 2;
      for (let x = -1; x < cols; x++) {
        const bx = x * bWidth + offset;
        const by = y * bHeight;
        const shade = Math.floor(90 + Math.random() * 30);
        ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
        ctx.fillRect(bx + mSize / 2, by + mSize / 2, bWidth - mSize, bHeight - mSize);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 3);
    return tex;
  }

  updateLedSign() {
    if (!this.ledCtx) return;
    this.ledCtx.fillStyle = '#050505';
    this.ledCtx.fillRect(0, 0, this.ledCanvas.width, this.ledCanvas.height);
    this.ledCtx.textAlign = 'center';
    this.ledCtx.textBaseline = 'middle';

    this.ledCtx.font = 'bold 72px Courier New';
    this.ledCtx.fillStyle = '#00ff00';
    this.ledCtx.shadowColor = '#00ff00';
    this.ledCtx.shadowBlur = 20;
    this.ledCtx.fillText('GOAL: 1,000,000 REVS', 512, 100);

    this.ledCtx.font = 'bold 40px Courier New';
    this.ledCtx.fillStyle = '#aaaaaa';
    this.ledCtx.shadowColor = 'transparent';
    this.ledCtx.fillText(`CHECKPOINT: ${this.lastCheckpoint.toLocaleString()}`, 512, 180);

    this.ledCtx.font = 'bold 120px Courier New';
    if (this.revolutions >= 1000000) {
      this.ledCtx.fillStyle = '#00ff00';
      this.ledCtx.fillText('FREEDOM!', 512, 340);
    } else {
      this.ledCtx.fillStyle = '#ff2222';
      this.ledCtx.shadowColor = '#ff2222';
      this.ledCtx.fillText(Math.floor(this.revolutions).toLocaleString(), 512, 340);
    }
    this.ledTexture.needsUpdate = true;
  }

  lockPointer() {
    if (this.guardAudio && !this.guardAudio.isPlaying && this.guardAudio.buffer) {
      this.guardAudio.play();
    }
    
    if (this.isMobile) {
      this.isLocked = true;
      this.cdr.detectChanges();
    } else {
      try {
        const promise = document.body.requestPointerLock() as any;
        if (promise && typeof promise.catch === 'function') {
          promise.catch((err: any) => {
            console.warn('Pointer lock failed:', err);
          });
        }
      } catch (err) {
        console.warn('Pointer lock failed:', err);
      }
    }
  }

  onPointerLockChange = () => {
    if (!this.isMobile) {
      this.isLocked = document.pointerLockElement === document.body;
      this.cdr.detectChanges();
    }
  };

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(e: MouseEvent) {
    if (this.isLocked) {
      this.euler.setFromQuaternion(this.camera.quaternion);
      this.euler.y -= e.movementX * 0.002;
      this.euler.x -= e.movementY * 0.002;
      this.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.euler.x));
      this.camera.quaternion.setFromEuler(this.euler);
    }
  }

  @HostListener('document:mousedown', ['$event'])
  onMouseDown(e: MouseEvent) {
    if (!this.isLocked) return;
    if (e.button === 0) this.fireInteraction();
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent) {
    if (!this.isLocked) return;
    switch (e.code) {
      case 'KeyW': this.moveForward = true; break;
      case 'KeyA': this.moveLeft = true; break;
      case 'KeyS': this.moveBackward = true; break;
      case 'KeyD': this.moveRight = true; break;
    }
  }

  @HostListener('document:keyup', ['$event'])
  onKeyUp(e: KeyboardEvent) {
    switch (e.code) {
      case 'KeyW': this.moveForward = false; break;
      case 'KeyA': this.moveLeft = false; break;
      case 'KeyS': this.moveBackward = false; break;
      case 'KeyD': this.moveRight = false; break;
    }
  }

  @HostListener('document:touchstart', ['$event'])
  onTouchStart(e: TouchEvent) {
    if (!this.isLocked || !this.isMobile) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      let t = e.changedTouches[i];
      if (t.clientX < window.innerWidth / 2 && this.leftTouchId === null) {
        this.leftTouchId = t.identifier;
        this.joyOrigin = { x: t.clientX, y: t.clientY };
        this.joyBaseDisplay = 'block';
        this.joyBaseLeft = t.clientX - 60;
        this.joyBaseTop = t.clientY - 60;
        this.joyKnobTransform = `translate(0px, 0px)`;
        this.mobileHintDisplay = 'none';
      } else if (t.clientX >= window.innerWidth / 2 && this.rightTouchId === null) {
        this.rightTouchId = t.identifier;
        this.rightTouchStart = { x: t.clientX, y: t.clientY };
        this.isDraggingRight = false;
      }
    }
  }

  @HostListener('document:touchmove', ['$event'])
  onTouchMove(e: TouchEvent) {
    if (!this.isLocked || !this.isMobile) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      let t = e.changedTouches[i];
      if (t.identifier === this.leftTouchId) {
        let dx = t.clientX - this.joyOrigin.x;
        let dy = t.clientY - this.joyOrigin.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        let maxDist = 40;

        if (dist > maxDist) {
          dx = (dx / dist) * maxDist;
          dy = (dy / dist) * maxDist;
        }
        this.joyKnobTransform = `translate(${dx}px, ${dy}px)`;

        this.joyVector.x = dx / maxDist;
        this.joyVector.y = dy / maxDist;
      } else if (t.identifier === this.rightTouchId) {
        this.isDraggingRight = true;
        let dx = t.clientX - this.rightTouchStart.x;
        let dy = t.clientY - this.rightTouchStart.y;

        this.euler.setFromQuaternion(this.camera.quaternion);
        this.euler.y -= dx * 0.005;
        this.euler.x -= dy * 0.005;
        this.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.euler.x));
        this.camera.quaternion.setFromEuler(this.euler);

        this.rightTouchStart = { x: t.clientX, y: t.clientY };
      }
    }
  }

  @HostListener('document:touchend', ['$event'])
  onTouchEnd(e: TouchEvent) {
    if (!this.isLocked || !this.isMobile) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      let t = e.changedTouches[i];
      if (t.identifier === this.leftTouchId) {
        this.leftTouchId = null;
        this.joyVector = { x: 0, y: 0 };
        this.joyBaseDisplay = 'none';
      } else if (t.identifier === this.rightTouchId) {
        if (!this.isDraggingRight) {
          this.fireInteraction();
        }
        this.rightTouchId = null;
      }
    }
  }

  @HostListener('window:resize', ['$event'])
  onResize(event?: Event) {
    if (this.camera && this.renderer && this.composer) {
      const width = this.canvasContainer.nativeElement.clientWidth;
      const height = this.canvasContainer.nativeElement.clientHeight;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
      this.composer.setSize(width, height);
    }
  }

  spawnParticles(position: THREE.Vector3, count: number = 10, color: number = 0xffaa00) {
    this.particleMaterial.color.setHex(color);
    for (let i = 0; i < count; i++) {
      if (this.activeParticles >= this.particleCount) break;
      
      const idx = this.activeParticles * 3;
      this.particlePositions[idx] = position.x + (Math.random() - 0.5) * 0.5;
      this.particlePositions[idx + 1] = position.y + (Math.random() - 0.5) * 0.5;
      this.particlePositions[idx + 2] = position.z + (Math.random() - 0.5) * 0.5;
      
      this.particleVelocities[idx] = (Math.random() - 0.5) * 4;
      this.particleVelocities[idx + 1] = Math.random() * 4 + 2;
      this.particleVelocities[idx + 2] = (Math.random() - 0.5) * 4;
      
      this.particleLifetimes[this.activeParticles] = 2.0 + Math.random() * 1.5; // 2 to 3.5 seconds
      
      this.activeParticles++;
    }
    this.particleGeometry.attributes['position'].needsUpdate = true;
  }

  catchPlayer() {
    this.isCaught = true;
    this.guardState = 'catching';
    this.caughtTimer = performance.now();
    
    // Penalty
    this.revolutions = this.lastCheckpoint;
    
    // Visual/Audio feedback
    this.guardLight.color.setHex(0xff0000); // Turn light red
    if (this.guardAudio && this.guardAudio.isPlaying) {
      this.guardAudio.stop(); // Stop footsteps
    }
    this.audioService.playSound('error'); // Play error/caught sound if available
    
    this.updateLedSign();
    this.cdr.detectChanges();
    
    // Trigger intense camera shake
    this.shakeIntensity = 1.5;
    this.caughtEffectIntensity = 1.0;
  }

  fireInteraction() {
    this.raycaster.setFromCamera(this.centerPoint, this.camera);
    const intersects = this.raycaster.intersectObjects(this.interactables);

    if (intersects.length > 0) {
      const dist = intersects[0].distance;
      if (dist < 4.5) {
        const type = intersects[0].object.userData['type'];
        
        if (type === 'crank') {
          if (this.isCaught) return; // Cannot crank while caught
          
          this.lastCrankTime = performance.now();
          const wasGoalReached = this.revolutions >= 1000000;
          this.revolutions += 0.125 * this.crankPower;
          this.coins += 1 * this.coinMultiplier;
          this.targetRotation -= (Math.PI / 4) * this.crankPower;
          this.audioService.playSound('crank');
          this.spawnParticles(intersects[0].point, 5, 0xffaa00);
          this.shakeIntensity = 0.15; // Subtle shake on crank
          
          if (!wasGoalReached && this.revolutions >= 1000000) {
              this.audioService.playSound('goal');
              this.spawnParticles(intersects[0].point, 50, 0x00ff00);
              this.shakeIntensity = 1.0; // Big shake on goal
          }
        } else if (type === 'upgrade_power') {
          if (this.coins >= this.costs.power) { this.coins -= this.costs.power; this.crankPower++; this.costs.power = Math.floor(this.costs.power * 1.5); this.audioService.playSound('buy'); this.spawnParticles(intersects[0].point, 10, 0xff4444); }
        } else if (type === 'upgrade_multi') {
          if (this.coins >= this.costs.multi) { this.coins -= this.costs.multi; this.coinMultiplier++; this.costs.multi = Math.floor(this.costs.multi * 2.5); this.audioService.playSound('buy'); this.spawnParticles(intersects[0].point, 10, 0x44ff44); }
        } else if (type === 'upgrade_energy') {
          if (this.coins >= this.costs.energy) { this.coins -= this.costs.energy; this.crankPower += 5; this.costs.energy = Math.floor(this.costs.energy * 1.6); this.audioService.playSound('buy'); this.spawnParticles(intersects[0].point, 10, 0xffff44); }
        } else if (type === 'upgrade_bribe') {
          if (this.coins >= this.costs.bribe) { this.coins -= this.costs.bribe; this.passiveCoins += 10; this.costs.bribe = Math.floor(this.costs.bribe * 2.0); this.audioService.playSound('buy'); this.spawnParticles(intersects[0].point, 10, 0xff44ff); }
        } else if (type === 'upgrade_goon') {
          if (this.coins >= this.costs.goon) { this.coins -= this.costs.goon; this.autoCrank += 5; this.costs.goon = Math.floor(this.costs.goon * 1.8); this.audioService.playSound('buy'); this.spawnParticles(intersects[0].point, 10, 0xff8844); }
        }
        
        this.updateLedSign();
        this.cdr.detectChanges();
      }
    }
  }

  handleGamepadInput() {
    const gamepads = navigator.getGamepads();
    const gp = gamepads[0];
    if (gp) {
      // Sticks
      const leftX = gp.axes[0];
      const leftY = gp.axes[1];
      const rightX = gp.axes[2];
      const rightY = gp.axes[3];

      // Deadzone and mapping
      this.gamepadValues.x = Math.abs(leftX) > 0.1 ? leftX : 0;
      this.gamepadValues.y = Math.abs(leftY) > 0.1 ? leftY : 0;
      this.gamepadValues.lookX = Math.abs(rightX) > 0.1 ? rightX : 0;
      this.gamepadValues.lookY = Math.abs(rightY) > 0.1 ? rightY : 0;

      // Rotation (Right Stick)
      if (this.gamepadValues.lookX || this.gamepadValues.lookY) {
        this.euler.setFromQuaternion(this.camera.quaternion);
        this.euler.y -= this.gamepadValues.lookX * 0.04;
        this.euler.x -= this.gamepadValues.lookY * 0.04;
        this.euler.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.euler.x));
        this.camera.quaternion.setFromEuler(this.euler);
      }

      // Interaction (Button 0 - A/Cross, Button 1 - B/Circle)
      const interactPressed = gp.buttons[0].pressed || gp.buttons[1].pressed;
      if (interactPressed && !this.gamepadButtonPrevPressed) {
        this.fireInteraction();
      }
      this.gamepadButtonPrevPressed = interactPressed;
    } else {
      this.gamepadValues.x = 0;
      this.gamepadValues.y = 0;
    }
  }

  animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    const time = performance.now();
    const delta = (time - this.prevTime) / 1000;
    this.prevTime = time;
    this.time += delta;

    // Effects
    // 1. Lamp Flickering
    this.hangingLamps.forEach(lamp => {
      if (Math.random() > 0.985) {
        lamp.intensity = 0.5 + Math.random() * 4.0;
      } else {
        lamp.intensity += (3.5 - lamp.intensity) * 0.15;
      }
    });

    // 2. Caught Effect Decay
    if (this.caughtEffectIntensity > 0) {
      this.caughtEffectIntensity *= 0.96;
      if (this.caughtEffectIntensity < 0.01) this.caughtEffectIntensity = 0;
    }

    // Checkpoint Logic
    if (this.revolutions - this.lastCheckpoint >= this.checkpointInterval) {
      this.lastCheckpoint = Math.floor(this.revolutions / this.checkpointInterval) * this.checkpointInterval;
      this.updateLedSign();
      this.cdr.detectChanges();
    }

    // Guard Patrol Logic
    if (this.guardGroup && this.guardState === 'patrolling') {
      this.guardZ += this.guardSpeed * this.guardDirection * delta;
      
      // Reverse direction at ends of hallway
      if (this.guardZ > 35) {
        this.guardZ = 35;
        this.guardDirection = -1;
      } else if (this.guardZ < -35) {
        this.guardZ = -35;
        this.guardDirection = 1;
      }
      
      this.guardGroup.position.z = this.guardZ;

      // Bobbing effect for flashlight
      this.guardLight.position.y = 1 + Math.sin(time * 0.005) * 0.1;
      this.guardLight.target.position.y = -1 + Math.sin(time * 0.005) * 0.2;

      // Detection Logic
      const isCranking = (time - this.lastCrankTime) < 500; // Cranking if clicked in last 500ms
      const inDangerZone = Math.abs(this.guardZ) < 8; // Guard is in front of the cell

      if (inDangerZone && isCranking && !this.isCaught) {
        this.catchPlayer();
      }
    } else if (this.guardState === 'catching') {
      // Guard caught player, look directly at them
      this.guardLight.target.position.set(12, 2.4, -this.guardZ); // Point at camera
      
      if (time - this.caughtTimer > 2000) {
        // Reset after 2 seconds
        this.isCaught = false;
        this.guardState = 'patrolling';
        this.guardLight.target.position.set(12, -1, 0); // Point back down
        this.guardLight.color.setHex(0xffffff); // Reset light color
        if (this.guardAudio && !this.guardAudio.isPlaying && this.guardAudio.buffer) {
          this.guardAudio.play();
        }
      }
    }

    // 1. Reset base camera height and clamp bounds (Fix runaway camera bug)
    const baseHeight = 2.4;
    this.camera.position.x = Math.max(-7.2, Math.min(7.2, this.camera.position.x));
    this.camera.position.z = Math.max(-7.2, Math.min(7.2, this.camera.position.z));
    
    // 2. Add breathing offset to base height
    this.camera.position.y = baseHeight + Math.sin(this.time * 0.8) * 0.04; 
    this.camera.position.y += this.shakeIntensity * (Math.random() - 0.5);

    if (this.isLocked) {
      this.handleGamepadInput();

      this.velocity.x -= this.velocity.x * 10.0 * delta;
      this.velocity.z -= this.velocity.z * 10.0 * delta;

      if (this.isMobile) {
        this.direction.z = -this.joyVector.y - this.gamepadValues.y;
        this.direction.x = this.joyVector.x + this.gamepadValues.x;
      } else {
        this.direction.z = Number(this.moveForward) - Number(this.moveBackward) - this.gamepadValues.y;
        this.direction.x = Number(this.moveRight) - Number(this.moveLeft) + this.gamepadValues.x;
      }
      this.direction.normalize();

      const speed = 25.0;
      if (this.direction.z !== 0) this.velocity.z -= this.direction.z * speed * delta;
      if (this.direction.x !== 0) this.velocity.x -= this.direction.x * speed * delta;

      this.camera.translateX(-this.velocity.x * delta);
      this.camera.translateZ(this.velocity.z * delta);
    }

    // 2. Camera Breathing & Shake (Applied after base height is fixed)
    this.camera.position.y += Math.sin(this.time * 0.8) * 0.04; // Breathing
    
    if (this.shakeIntensity > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeIntensity;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity *= 0.92;
      if (this.shakeIntensity < 0.005) this.shakeIntensity = 0;
    }

    if (this.isLocked) {
      this.raycaster.setFromCamera(this.centerPoint, this.camera);
      const intersects = this.raycaster.intersectObjects(this.interactables);
      if (intersects.length > 0 && intersects[0].distance < 4.5) {
        this.crosshairTransform = 'translate(-50%, -50%) scale(1.5)';
        this.crosshairBg = 'rgba(255, 200, 0, 0.9)';
        const objData = intersects[0].object.userData;
        this.tooltipText = objData['getName'] ? objData['getName']() : objData['name'];
        this.tooltipDisplay = 'block';
      } else {
        this.crosshairTransform = 'translate(-50%, -50%) scale(1)';
        this.crosshairBg = 'rgba(255, 255, 255, 0.8)';
        this.tooltipDisplay = 'none';
      }
    } else {
      this.tooltipDisplay = 'none';
    }

    this.currentRotation += (this.targetRotation - this.currentRotation) * 0.1;
    if (this.rotator) {
      this.rotator.rotation.y = this.currentRotation;
    }

    this.upgradeMarkers.forEach((marker, i) => {
      marker.position.y = marker.userData['baseY'] + Math.sin(time * 0.003 + i) * 0.05;
    });

    // Update particles
    if (this.activeParticles > 0) {
      for (let i = 0; i < this.activeParticles; i++) {
        const idx = i * 3;
        
        this.particleLifetimes[i] -= delta;
        
        this.particleVelocities[idx + 1] -= 9.8 * delta; // Gravity
        
        this.particlePositions[idx] += this.particleVelocities[idx] * delta;
        this.particlePositions[idx + 1] += this.particleVelocities[idx + 1] * delta;
        this.particlePositions[idx + 2] += this.particleVelocities[idx + 2] * delta;
        
        // Floor collision
        if (this.particlePositions[idx + 1] < 0.05) {
          this.particlePositions[idx + 1] = 0.05;
          this.particleVelocities[idx + 1] *= -0.6; // Bounce
          this.particleVelocities[idx] *= 0.8; // Friction
          this.particleVelocities[idx + 2] *= 0.8; // Friction
        }
        
        // Remove particle if lifetime is over
        if (this.particleLifetimes[i] <= 0) {
          // Remove particle by swapping with last active
          this.activeParticles--;
          const lastIdx = this.activeParticles * 3;
          this.particlePositions[idx] = this.particlePositions[lastIdx];
          this.particlePositions[idx + 1] = this.particlePositions[lastIdx + 1];
          this.particlePositions[idx + 2] = this.particlePositions[lastIdx + 2];
          this.particleVelocities[idx] = this.particleVelocities[lastIdx];
          this.particleVelocities[idx + 1] = this.particleVelocities[lastIdx + 1];
          this.particleVelocities[idx + 2] = this.particleVelocities[lastIdx + 2];
          this.particleLifetimes[i] = this.particleLifetimes[this.activeParticles];
          i--; // Re-check this index
        }
      }
      this.particleGeometry.attributes['position'].needsUpdate = true;
    }
    this.particleGeometry.setDrawRange(0, this.activeParticles);

    // Final Render
    if (this.composer) {
      this.composer.render();
    } else if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  };
}
