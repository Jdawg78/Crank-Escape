import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, HostListener, ChangeDetectorRef, Inject, PLATFORM_ID } from '@angular/core';
import * as THREE from 'three';
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
  animationFrameId: number = 0;
  
  interactables: THREE.Mesh[] = [];
  crankAssembly!: THREE.Group;
  rotator!: THREE.Group;
  ledTexture!: THREE.CanvasTexture;
  ledCtx!: CanvasRenderingContext2D;
  ledCanvas!: HTMLCanvasElement;
  
  vendingTexture!: THREE.CanvasTexture;
  vendingCtx!: CanvasRenderingContext2D;
  vendingCanvas!: HTMLCanvasElement;

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

  // Particles
  particles!: THREE.Points;
  particleGeometry!: THREE.BufferGeometry;
  particleMaterial!: THREE.PointsMaterial;
  particleCount = 200;
  particlePositions!: Float32Array;
  particleVelocities!: Float32Array;
  particleLifetimes!: Float32Array;
  activeParticles = 0;

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
    this.updateVendingSign();
    this.animate();

    this.autoCrankInterval = setInterval(() => {
      if (this.autoCrank > 0 || this.passiveCoins > 0) {
        this.revolutions += this.autoCrank;
        this.coins += (this.autoCrank * 8) * this.coinMultiplier;
        this.coins += this.passiveCoins;
        this.targetRotation -= (Math.PI * 2) * this.autoCrank;
        this.updateLedSign();
        this.updateVendingSign();
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
    if (this.renderer) {
      this.renderer.dispose();
    }
  }

  initThreeJS() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0a0a0a, 0.06);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 2.4, 4);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x0a0a0a);
    
    // Enable shadows
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.canvasContainer.nativeElement.appendChild(this.renderer.domElement);

    // Lighting
    this.scene.add(new THREE.AmbientLight(0x222222));
    const pointLight = new THREE.PointLight(0xffaa55, 1.2, 20);
    pointLight.position.set(0, 4, 0);
    pointLight.castShadow = true;
    this.scene.add(pointLight);

    // Room
    const room = new THREE.Mesh(
      new THREE.BoxGeometry(16, 12, 16),
      new THREE.MeshStandardMaterial({ map: this.createBrickTexture(), roughness: 0.9, side: THREE.BackSide })
    );
    room.position.y = 6;
    room.receiveShadow = true;
    this.scene.add(room);

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
      new THREE.MeshStandardMaterial({ color: 0x444, metalness: 0.8, roughness: 0.4 })
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
      new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.2 })
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
    vendingGroup.position.set(7.25, 2.5, 0);
    vendingGroup.rotation.y = -Math.PI / 2;

    const vmBody = new THREE.Mesh(
      new THREE.BoxGeometry(4.5, 5, 1.5),
      new THREE.MeshStandardMaterial({ color: 0x551111, roughness: 0.6 })
    );
    vmBody.castShadow = true;
    vmBody.receiveShadow = true;
    vendingGroup.add(vmBody);

    const vmGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(4.1, 2.0),
      new THREE.MeshStandardMaterial({ color: 0x88ccff, roughness: 0.1, transparent: true, opacity: 0.3 })
    );
    vmGlass.position.set(0, -0.5, 0.76);
    vendingGroup.add(vmGlass);

    this.vendingCanvas = document.createElement('canvas');
    this.vendingCanvas.width = 1024;
    this.vendingCanvas.height = 625;
    this.vendingCtx = this.vendingCanvas.getContext('2d')!;
    this.vendingTexture = new THREE.CanvasTexture(this.vendingCanvas);

    const vmPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(4.1, 2.5),
      new THREE.MeshBasicMaterial({ map: this.vendingTexture })
    );
    vmPanel.position.set(0, 1.25, 0.76);
    vendingGroup.add(vmPanel);

    const btnGeo = new THREE.BoxGeometry(0.3, 0.3, 0.1);

    const btnPowerMesh = new THREE.Mesh(btnGeo, new THREE.MeshStandardMaterial({ color: 0xff4444 }));
    btnPowerMesh.position.set(-1.5, 2.1, 0.8);
    btnPowerMesh.userData = { type: 'upgrade_power', getName: () => `Buy WD-40 (+Power) - ${this.costs.power} Coins` };
    vendingGroup.add(btnPowerMesh);
    this.interactables.push(btnPowerMesh);

    const btnMultiMesh = new THREE.Mesh(btnGeo, new THREE.MeshStandardMaterial({ color: 0x44ff44 }));
    btnMultiMesh.position.set(-1.5, 1.7, 0.8);
    btnMultiMesh.userData = { type: 'upgrade_multi', getName: () => `Buy Snacks (x2 Coins) - ${this.costs.multi} Coins` };
    vendingGroup.add(btnMultiMesh);
    this.interactables.push(btnMultiMesh);

    const btnEnergyMesh = new THREE.Mesh(btnGeo, new THREE.MeshStandardMaterial({ color: 0xffff44 }));
    btnEnergyMesh.position.set(-1.5, 1.3, 0.8);
    btnEnergyMesh.userData = { type: 'upgrade_energy', getName: () => `Buy Energy Drink (+5 Power) - ${this.costs.energy} Coins` };
    vendingGroup.add(btnEnergyMesh);
    this.interactables.push(btnEnergyMesh);

    const btnBribeMesh = new THREE.Mesh(btnGeo, new THREE.MeshStandardMaterial({ color: 0xff44ff }));
    btnBribeMesh.position.set(-1.5, 0.9, 0.8);
    btnBribeMesh.userData = { type: 'upgrade_bribe', getName: () => `Bribe Guard (+10 Coins/sec) - ${this.costs.bribe} Coins` };
    vendingGroup.add(btnBribeMesh);
    this.interactables.push(btnBribeMesh);

    const btnGoonMesh = new THREE.Mesh(btnGeo, new THREE.MeshStandardMaterial({ color: 0xff8844 }));
    btnGoonMesh.position.set(-1.5, 0.5, 0.8);
    btnGoonMesh.userData = { type: 'upgrade_goon', getName: () => `Hire Goon (+5 Rev/sec) - ${this.costs.goon} Coins` };
    vendingGroup.add(btnGoonMesh);
    this.interactables.push(btnGoonMesh);

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
    this.ledCtx.fillText('GOAL: 1,000,000 REVS', 512, 120);

    this.ledCtx.font = 'bold 120px Courier New';
    if (this.revolutions >= 1000000) {
      this.ledCtx.fillStyle = '#00ff00';
      this.ledCtx.fillText('FREEDOM!', 512, 320);
    } else {
      this.ledCtx.fillStyle = '#ff2222';
      this.ledCtx.shadowColor = '#ff2222';
      this.ledCtx.fillText(Math.floor(this.revolutions).toLocaleString(), 512, 320);
    }
    this.ledTexture.needsUpdate = true;
  }

  updateVendingSign() {
    if (!this.vendingCtx) return;
    this.vendingCtx.fillStyle = '#ffddaa';
    this.vendingCtx.fillRect(0, 0, this.vendingCanvas.width, this.vendingCanvas.height);
    this.vendingCtx.textAlign = 'left';
    this.vendingCtx.textBaseline = 'middle';
    this.vendingCtx.font = 'bold 32px Courier New';

    const items = [
      { name: 'WD-40 (+Power)', cost: this.costs.power, y: 100 },
      { name: 'Snacks (x2 Coins)', cost: this.costs.multi, y: 200 },
      { name: 'Energy Drink (+5 Power)', cost: this.costs.energy, y: 300 },
      { name: 'Bribe Guard (+10 Coins/s)', cost: this.costs.bribe, y: 400 },
      { name: 'Hire Goon (+5 Rev/s)', cost: this.costs.goon, y: 500 }
    ];

    items.forEach(item => {
      this.vendingCtx!.fillStyle = this.coins >= item.cost ? '#115511' : '#551111';
      this.vendingCtx!.fillText(`${item.name} - ${item.cost} Coins`, 200, item.y);
    });

    this.vendingTexture.needsUpdate = true;
  }

  lockPointer() {
    if (this.isMobile) {
      this.isLocked = true;
      this.cdr.detectChanges();
    } else {
      document.body.requestPointerLock();
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
    if (this.isLocked && !this.isMobile) {
      this.euler.setFromQuaternion(this.camera.quaternion);
      this.euler.y -= e.movementX * 0.002;
      this.euler.x -= e.movementY * 0.002;
      this.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.euler.x));
      this.camera.quaternion.setFromEuler(this.euler);
    }
  }

  @HostListener('document:mousedown', ['$event'])
  onMouseDown(e: MouseEvent) {
    if (!this.isLocked || this.isMobile) return;
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
    if (this.camera && this.renderer) {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
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

  fireInteraction() {
    this.raycaster.setFromCamera(this.centerPoint, this.camera);
    const intersects = this.raycaster.intersectObjects(this.interactables);

    if (intersects.length > 0) {
      const dist = intersects[0].distance;
      if (dist < 4.5) {
        const type = intersects[0].object.userData['type'];
        let playedSound = false;
        
        if (type === 'crank') {
          const wasGoalReached = this.revolutions >= 1000000;
          this.revolutions += 0.125 * this.crankPower;
          this.coins += 1 * this.coinMultiplier;
          this.targetRotation -= (Math.PI / 4) * this.crankPower;
          this.audioService.playSound('crank');
          this.spawnParticles(intersects[0].point, 5, 0xffaa00);
          playedSound = true;
          
          if (!wasGoalReached && this.revolutions >= 1000000) {
              this.audioService.playSound('goal');
              this.spawnParticles(intersects[0].point, 50, 0x00ff00);
          }
        } else if (type === 'upgrade_power') {
          if (this.coins >= this.costs.power) { this.coins -= this.costs.power; this.crankPower++; this.costs.power = Math.floor(this.costs.power * 1.5); this.audioService.playSound('buy'); this.spawnParticles(intersects[0].point, 10, 0xff4444); playedSound = true; }
        } else if (type === 'upgrade_multi') {
          if (this.coins >= this.costs.multi) { this.coins -= this.costs.multi; this.coinMultiplier++; this.costs.multi = Math.floor(this.costs.multi * 2.5); this.audioService.playSound('buy'); this.spawnParticles(intersects[0].point, 10, 0x44ff44); playedSound = true; }
        } else if (type === 'upgrade_energy') {
          if (this.coins >= this.costs.energy) { this.coins -= this.costs.energy; this.crankPower += 5; this.costs.energy = Math.floor(this.costs.energy * 1.6); this.audioService.playSound('buy'); this.spawnParticles(intersects[0].point, 10, 0xffff44); playedSound = true; }
        } else if (type === 'upgrade_bribe') {
          if (this.coins >= this.costs.bribe) { this.coins -= this.costs.bribe; this.passiveCoins += 10; this.costs.bribe = Math.floor(this.costs.bribe * 2.0); this.audioService.playSound('buy'); this.spawnParticles(intersects[0].point, 10, 0xff44ff); playedSound = true; }
        } else if (type === 'upgrade_goon') {
          if (this.coins >= this.costs.goon) { this.coins -= this.costs.goon; this.autoCrank += 5; this.costs.goon = Math.floor(this.costs.goon * 1.8); this.audioService.playSound('buy'); this.spawnParticles(intersects[0].point, 10, 0xff8844); playedSound = true; }
        }
        
        this.updateLedSign();
        this.updateVendingSign();
        this.cdr.detectChanges();
      }
    }
  }

  animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    const time = performance.now();
    const delta = (time - this.prevTime) / 1000;
    this.prevTime = time;

    if (this.isLocked) {
      this.velocity.x -= this.velocity.x * 10.0 * delta;
      this.velocity.z -= this.velocity.z * 10.0 * delta;

      if (this.isMobile) {
        this.direction.z = -this.joyVector.y;
        this.direction.x = this.joyVector.x;
      } else {
        this.direction.z = Number(this.moveForward) - Number(this.moveBackward);
        this.direction.x = Number(this.moveRight) - Number(this.moveLeft);
        this.direction.normalize();
      }

      const speed = 25.0;
      if (this.direction.z !== 0) this.velocity.z -= this.direction.z * speed * delta;
      if (this.direction.x !== 0) this.velocity.x -= this.direction.x * speed * delta;

      this.camera.translateX(-this.velocity.x * delta);
      this.camera.translateZ(this.velocity.z * delta);

      this.camera.position.y = 2.4;
      this.camera.position.x = Math.max(-7.2, Math.min(7.2, this.camera.position.x));
      this.camera.position.z = Math.max(-7.2, Math.min(7.2, this.camera.position.z));
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

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  };
}
