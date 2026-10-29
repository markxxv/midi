import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { lowerBound, clamp } from './utils.js';

const THEMES = {
  aurora: { background: '#060916', colors: ['#b69bff', '#50f0e7', '#ff88bf', '#ffc48d', '#688bff'], grid: '#65518c' },
  ember: { background: '#12090e', colors: ['#ff996a', '#ffd07c', '#fa587f', '#ffbba6', '#d873ff'], grid: '#81434e' },
  ocean: { background: '#04121a', colors: ['#48dfed', '#61aaff', '#a1f1ed', '#61e7ae', '#a198ff'], grid: '#226b7d' },
  mono: { background: '#0b0c11', colors: ['#f4f1ea', '#aaa6ba', '#d5d4e9', '#a6d5d6', '#f7f7ff'], grid: '#474453' },
};
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
const HIT_Z = 5;
const NOTE_POOL_SIZE = 650;
const PARTICLES_PER_HIT = 5;
const PARTICLE_CAP = 700;

function line(from, to, color, opacity = .3) {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
}

export class MidiVisualizer {
  constructor(element) {
    this.host = element;
    this.speed = 3.6;
    this.glow = 1.4;
    this.particlesEnabled = true;
    this.motionEnabled = true;
    this.themeName = 'aurora';
    this.theme = THEMES.aurora;
    this.ratio = '16:9';
    this.song = null;
    this.exportSize = null;
    this.laneWidth = .36;
    this.maxDuration = 8;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.theme.background);
    this.scene.fog = new THREE.FogExp2(this.theme.background, .012);
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, .1, 180);
    this.camera.position.set(0, 13.5, 21);
    this.camera.lookAt(0, 0, -5);
    this.renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.setClearColor(this.theme.background);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
    this.renderer.domElement.setAttribute('aria-label', 'Animated three-dimensional MIDI piano roll');
    this.host.appendChild(this.renderer.domElement);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), this.glow, .75, .2);
    this.composer.addPass(this.bloomPass);
    this.scene.add(new THREE.AmbientLight(0xadb6ff, 1.2));
    const lamp = new THREE.PointLight(0x9188ff, 85, 65);
    lamp.position.set(0, 9, 4);
    this.scene.add(lamp);
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.createStars();
    this.noteGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.noteMaterials = [];
    this.createNotePool();
    this.createPulsePool();
    this.createImpactParticles();
    this.keys = [];
    this.constructWorld();
    this.observe = new ResizeObserver(() => this.resize());
    this.observe.observe(element);
    this.resize();
  }

  createStars() {
    const count = 900;
    const vertices = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      vertices[i * 3] = (Math.random() - .5) * 85;
      vertices[i * 3 + 1] = 3 + Math.random() * 37;
      vertices[i * 3 + 2] = -50 + Math.random() * 70;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    this.stars = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0xa5a9ff, size: .09, transparent: true, opacity: .68, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.scene.add(this.stars);
  }

  createNotePool() {
    for (let i = 0; i < 5; i++) {
      const color = new THREE.Color(this.theme.colors[i]);
      this.noteMaterials.push(new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 2.5, metalness: .32, roughness: .23,
      }));
    }
    this.notes = Array.from({ length: NOTE_POOL_SIZE }, () => {
      const mesh = new THREE.Mesh(this.noteGeometry, this.noteMaterials[0]);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      return mesh;
    });
  }

  createPulsePool() {
    const circle = new THREE.CircleGeometry(.52, 26);
    this.pulses = Array.from({ length: 90 }, (_, i) => {
      const material = new THREE.MeshBasicMaterial({
        color: this.theme.colors[i % 5], transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(circle, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.scene.add(mesh);
      return mesh;
    });
  }

  createImpactParticles() {
    const positions = new Float32Array(PARTICLE_CAP * 3);
    const colors = new Float32Array(PARTICLE_CAP * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setDrawRange(0, 0);
    this.particleGeometry = geometry;
    this.particleCloud = new THREE.Points(geometry, new THREE.PointsMaterial({
      size: .19, vertexColors: true, transparent: true, opacity: .95,
      sizeAttenuation: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.particleCloud.frustumCulled = false;
    this.scene.add(this.particleCloud);
  }

  constructWorld() {
    while (this.world.children.length) {
      const object = this.world.children[0];
      this.world.remove(object);
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        if (Array.isArray(object.material)) object.material.forEach(m => m.dispose());
        else object.material.dispose();
      }
    }
    this.keys = [];
    const min = this.song?.range.min ?? 36;
    const max = this.song?.range.max ?? 96;
    const width = (max - min + 1) * this.laneWidth;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width + 3, 63), new THREE.MeshBasicMaterial({
      color: this.theme.grid, transparent: true, opacity: .055, side: THREE.DoubleSide, depthWrite: false,
    }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -.18, -24);
    this.world.add(floor);
    for (let pitch = min; pitch <= max + 1; pitch++) {
      const x = (pitch - min - (max - min + 1) / 2) * this.laneWidth;
      this.world.add(line([x, -.10, HIT_Z], [x, -.1, -46], this.theme.grid, BLACK_KEYS.has(pitch % 12) ? .07 : .17));
    }
    for (let z = HIT_Z; z >= -43; z -= this.speed * 1.0) {
      this.world.add(line([-width / 2, -.10, z], [width / 2, -.10, z], this.theme.grid, .15));
    }
    const strike = new THREE.Mesh(new THREE.BoxGeometry(width + .5, .07, .12), new THREE.MeshBasicMaterial({
      color: this.theme.colors[0], transparent: true, opacity: .92,
    }));
    strike.position.set(0, .03, HIT_Z);
    this.world.add(strike);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(width + 1.5, 2.8), new THREE.MeshBasicMaterial({
      color: this.theme.colors[0], transparent: true, opacity: .065, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(0, -.04, HIT_Z - .12);
    this.world.add(halo);
    const white = new THREE.Color('#b3bbd8');
    const black = new THREE.Color('#161b32');
    for (let pitch = min; pitch <= max; pitch++) {
      const isBlack = BLACK_KEYS.has(pitch % 12);
      const material = new THREE.MeshStandardMaterial({
        color: isBlack ? black : white,
        emissive: new THREE.Color(this.theme.colors[pitch % 5]),
        emissiveIntensity: .025, metalness: .25, roughness: .4,
      });
      const key = new THREE.Mesh(new THREE.BoxGeometry(this.laneWidth * (isBlack ? .65 : .91), isBlack ? .47 : .23, isBlack ? 1.75 : 2.6), material);
      key.position.set(this.pitchX(pitch), isBlack ? .15 : 0, isBlack ? HIT_Z + .76 : HIT_Z + 1.35);
      this.keys.push({ pitch, key, baseY: key.position.y });
      this.world.add(key);
    }
    const endbar = new THREE.Mesh(new THREE.BoxGeometry(width + .8, .12, .18), new THREE.MeshBasicMaterial({ color: 0x1d2441 }));
    endbar.position.set(0, -.16, HIT_Z + 2.8);
    this.world.add(endbar);
  }

  pitchX(pitch) {
    const min = this.song?.range.min ?? 36;
    const max = this.song?.range.max ?? 96;
    return (pitch - (min + max) / 2) * this.laneWidth;
  }

  setSong(song) {
    this.song = song;
    this.maxDuration = Math.min(20, Math.max(4, ...song.notes.map(n => n.duration)));
    this.constructWorld();
  }

  setTheme(name) {
    if (!THEMES[name]) return;
    this.themeName = name;
    this.theme = THEMES[name];
    this.scene.background.set(this.theme.background);
    this.scene.fog.color.set(this.theme.background);
    this.renderer.setClearColor(this.theme.background);
    for (let i = 0; i < this.noteMaterials.length; i++) {
      this.noteMaterials[i].color.set(this.theme.colors[i]);
      this.noteMaterials[i].emissive.set(this.theme.colors[i]);
    }
    this.constructWorld();
  }

  setSpeed(speed) {
    this.speed = speed;
    this.constructWorld();
  }

  setGlow(value) { this.glow = value; this.bloomPass.strength = value; }
  setParticles(value) { this.particlesEnabled = Boolean(value); this.particleCloud.visible = this.particlesEnabled; }
  setMotion(value) { this.motionEnabled = Boolean(value); }

  setRatio(ratio) {
    this.ratio = ratio;
    this.laneWidth = ratio === '9:16' ? .22 : ratio === '1:1' ? .30 : .36;
    this.constructWorld();
    this.resize();
  }

  setExportSize(size) {
    this.exportSize = size;
    this.resize();
  }

  resize() {
    const w = this.exportSize?.width || Math.max(1, this.host.clientWidth);
    const h = this.exportSize?.height || Math.max(1, this.host.clientHeight);
    if (w < 1 || h < 1) return;
    this.renderer.setPixelRatio(this.exportSize ? 1 : Math.min(window.devicePixelRatio || 1, 1.65));
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.position.set(0, aspect < .85 ? 21 : aspect < 1.25 ? 16 : 13.5, aspect < .85 ? 32 : aspect < 1.25 ? 27 : 21);
    this.camera.lookAt(0, 0, aspect < .85 ? -4 : -5);
    this.camera.updateProjectionMatrix();
    // Preserve the CSS layout while recording at an independent pixel resolution.
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
  }

  render(time = 0) {
    const song = this.song;
    const s = this.speed;
    let shown = 0;
    let pulses = 0;
    let particleCount = 0;
    const activePitches = new Set();
    const positions = this.particleGeometry.attributes.position.array;
    const colors = this.particleGeometry.attributes.color.array;
    if (song) {
      const first = lowerBound(song.notes, Math.max(0, time - this.maxDuration - .1));
      const lastTime = time + 46 / s;
      for (let i = first; i < song.notes.length && song.notes[i].time <= lastTime; i++) {
        const note = song.notes[i];
        const elapsed = time - note.time;
        const remaining = note.duration - elapsed;
        if (remaining <= 0) continue;
        const head = Math.min(HIT_Z, HIT_Z - (note.time - time) * s);
        if (head < -43) continue;
        const length = Math.max(.11, Math.min(note.duration, remaining) * s);
        if (shown < this.notes.length) {
          const mesh = this.notes[shown++];
          mesh.visible = true;
          mesh.material = this.noteMaterials[note.track % 5];
          mesh.position.set(this.pitchX(note.midi), .32 + (elapsed >= 0 ? .09 : 0), head - length / 2);
          mesh.scale.set(this.laneWidth * .76, elapsed >= 0 ? .53 : .38, length);
        }
        if (elapsed >= 0 && remaining > 0) activePitches.add(note.midi);
        if (elapsed > -.035 && elapsed < .58 && pulses < this.pulses.length) {
          const age = Math.max(0, elapsed);
          const pulse = this.pulses[pulses++];
          pulse.visible = true;
          pulse.position.set(this.pitchX(note.midi), .055, HIT_Z + .02);
          const radius = .35 + age * 3;
          pulse.scale.set(radius, radius, 1);
          pulse.material.color.set(this.theme.colors[note.track % 5]);
          pulse.material.opacity = (1 - age / .58) * .68;
        }
        if (this.particlesEnabled && elapsed >= 0 && elapsed < .65) {
          const color = new THREE.Color(this.theme.colors[note.track % 5]);
          for (let j = 0; j < PARTICLES_PER_HIT && particleCount < PARTICLE_CAP; j++) {
            const seed = note.midi * 12.989 + note.time * 34.4 + j * 78.233;
            const random = (k) => (Math.sin(seed + k * 92.12) * 43758.5453) % 1;
            const vx = random(1) * 3;
            const vz = random(2) * 3;
            const idx = particleCount * 3;
            positions[idx] = this.pitchX(note.midi) + vx * elapsed;
            positions[idx + 1] = .22 + (2 + Math.abs(random(3)) * 4) * elapsed - 5 * elapsed * elapsed;
            positions[idx + 2] = HIT_Z + vz * elapsed;
            colors[idx] = color.r * (1 - elapsed / .65);
            colors[idx + 1] = color.g * (1 - elapsed / .65);
            colors[idx + 2] = color.b * (1 - elapsed / .65);
            particleCount++;
          }
        }
      }
    }
    for (let i = shown; i < this.notes.length; i++) this.notes[i].visible = false;
    for (let i = pulses; i < this.pulses.length; i++) this.pulses[i].visible = false;
    this.particleGeometry.setDrawRange(0, particleCount);
    this.particleGeometry.attributes.position.needsUpdate = true;
    this.particleGeometry.attributes.color.needsUpdate = true;
    this.particleCloud.visible = this.particlesEnabled;
    for (const { pitch, key, baseY } of this.keys) {
      const active = activePitches.has(pitch);
      key.material.emissiveIntensity = active ? 2.3 : .025;
      key.position.y = baseY - (active ? .045 : 0);
    }
    const drift = this.motionEnabled ? Math.sin(time * .17) * .37 : 0;
    this.camera.position.x = drift;
    this.camera.lookAt(0, 0, this.ratio === '9:16' ? -4 : -5);
    this.stars.rotation.y = Math.sin(time * .05) * .025;
    this.composer.render();
  }

  canvas() { return this.renderer.domElement; }

  dispose() {
    this.observe.disconnect();
    this.noteGeometry.dispose();
    for (const mat of this.noteMaterials) mat.dispose();
    this.pulsePool?.forEach(mesh => mesh.geometry.dispose());
    this.scene.traverse(object => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        if (Array.isArray(object.material)) object.material.forEach(m => m.dispose());
        else object.material.dispose();
      }
    });
    this.composer.dispose();
    this.renderer.dispose();
  }
}
