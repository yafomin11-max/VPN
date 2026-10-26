/* ══════════════════════════════════════════════════════════════
   parallelogram.vpn — 3D-сцена v2
   Гироскоп из вложенных светящихся параллелограммов: объект
   можно вращать перетаскиванием (инерция + автовращение).
   Вокруг — частицы-пакеты и дальняя аллея рамок-границ.
   Шейдеры + собственный bloom. Палитра — холодный белый неон.
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const canvas = document.getElementById('scene');
  if (!canvas || typeof THREE === 'undefined') return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = window.innerWidth < 900;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance'
    });
  } catch (e) {
    canvas.style.display = 'none';
    return;
  }
  if (!renderer.getContext()) { canvas.style.display = 'none'; return; }

  let DPR = Math.min(window.devicePixelRatio || 1, 1.7);
  renderer.setPixelRatio(DPR);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(0x040406, 1);

  // защита от сбоя GPU: теряем контекст — тихо гасим сцену, страница жива
  let contextLost = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    contextLost = true;
    canvas.style.display = 'none';
  }, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 120);
  const CAM_Z = 9;
  camera.position.set(0, 0, CAM_Z);

  /* ── фон ──────────────────────────────────────────────────── */
  const bgMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uScroll: { value: 0 },
      uSpin: { value: 0 }
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform vec2 uRes;
      uniform float uTime;
      uniform float uScroll;
      uniform float uSpin;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }

      void main(){
        vec2 uv = vUv;
        vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);

        vec3 col = vec3(0.014, 0.014, 0.018);

        // холодное свечение за ядром гироскопа, пульсирует от вращения
        vec2 c = vec2(0.17, 0.02);
        float d = length((p - c) * vec2(1.0, 1.35));
        float beat = 1.0 + uSpin * 0.35;
        col += vec3(0.055, 0.075, 0.105) * pow(max(0.0, 1.0 - d * 1.25), 3.4) * beat;

        // мягкая дымка
        float n = noise(p * 3.2 + vec2(uTime * 0.015, uTime * 0.01));
        col += vec3(0.02, 0.024, 0.032) * n * 0.8;

        col *= 1.0 - 0.55 * smoothstep(0.25, 1.15, length(p));
        col *= 0.94 + 0.12 * uScroll;

        gl_FragColor = vec4(col, 1.0);
      }
    `
  });

  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
  quad.frustumCulled = false;
  quadScene.add(quad);

  /* ── шейдер рамки-параллелограмма (SDF) ───────────────────── */
  const frameVert = `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const frameFrag = `
    precision highp float;
    varying vec2 vUv;
    uniform vec3 uColor;
    uniform vec2 uSize;
    uniform float uShear;
    uniform float uOpacity;
    uniform float uTime;
    uniform float uSeed;

    float sdBox(vec2 p, vec2 b){
      vec2 d = abs(p) - b;
      return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
    }

    void main(){
      vec2 p = (vUv - 0.5) * 2.0 * uSize;
      p.x -= p.y * uShear;

      float breathe = 1.0 + sin(uTime * 0.9 + uSeed * 6.28) * 0.012;
      vec2 b = uSize * 0.9 * breathe;

      float d = abs(sdBox(p, b));
      float t = 0.055;

      float core = 1.0 - smoothstep(t * 0.45, t * 1.55, d);
      float halo = exp(-d * 3.4) * 0.42 + exp(-d * 0.9) * 0.10;

      // редкий неоновый «сбой» линии
      float glitch = step(0.996, sin(uTime * 9.1 + uSeed * 31.0)) * 0.35;

      // вторая, внутренняя линия — как рамка на логотипе
      float d2 = abs(sdBox(p, b * 0.78));
      float inner = (1.0 - smoothstep(t * 0.4, t * 1.3, d2)) * 0.22;

      float edgeFade = smoothstep(0.0, 1.2, uSize.x - abs(p.x));

      vec3 col = uColor * (core * (1.35 + glitch) + halo + inner);
      col *= edgeFade;

      gl_FragColor = vec4(col * uOpacity, 1.0);
    }
  `;

  function makeFrame(w, h, shear, color) {
    const geo = new THREE.PlaneGeometry(w * 2, h * 2, 1, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uSize: { value: new THREE.Vector2(w, h) },
        uShear: { value: shear },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uSeed: { value: Math.random() }
      },
      vertexShader: frameVert,
      fragmentShader: frameFrag,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return mesh;
  }

  /* ── ГИРОСКОП: вложенные параллелограммы в настоящем 3D ───── */
  const gyro = new THREE.Group();
  scene.add(gyro);

  const RING_COUNT = isMobile ? 4 : 6;
  const rings = [];

  for (let i = 0; i < RING_COUNT; i++) {
    const k = i / (RING_COUNT - 1);                 // 0..1 от внешнего к внутреннему
    const size = 3.35 - k * 2.35;                   // 3.35 → 1.0
    const ring = makeFrame(
      size,
      size * 0.56,
      0.34 + (i % 3) * 0.07,
      [0xffffff, 0xdfe9ff, 0xcfe0ff, 0xeaf2ff, 0xbfd4ff][i % 5]
    );

    // «апертурный» старт: рамки раскрыты к камере, в плоскости — ровный веер,
    // поэтому при загрузке сразу читается гироскоп, а не «полоски» ребром
    const holder = new THREE.Object3D();
    holder.rotation.set(
      0.1 + (i % 3) * 0.05,
      (i % 2 ? 1 : -1) * (0.06 + (i % 4) * 0.035),
      0
    );
    holder.add(ring);
    gyro.add(holder);

    rings.push({
      holder: holder,
      mesh: ring,
      idx: i,
      spin: (i % 2 ? 1 : -1) * (0.09 + 0.06 * ((i * 7) % 5)),    // рад/с вокруг своей оси
      prec: (i % 2 ? 1 : -1) * (0.05 + 0.02 * (i % 4)),          // прецессия держателя
      phase: i * (Math.PI / RING_COUNT) * 1.05,                  // веер в плоскости
      baseTilt: holder.rotation.clone(),
      wave: 0.9 + 0.1 * Math.sin(i)
    });
  }

  /* ── ядро: светящийся «пакет» в центре ────────────────────── */
  const coreMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uBoost: { value: 0 }, uIntro: { value: 0 } },
    vertexShader: frameVert,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform float uTime;
      uniform float uBoost;
      uniform float uIntro;
      void main(){
        float d = length((vUv - 0.5) * 2.0);
        float pulse = 0.86 + 0.14 * sin(uTime * 2.1);
        float glow = exp(-d * 5.2) * 1.35 + exp(-d * 1.7) * 0.16;
        vec3 col = mix(vec3(0.78, 0.87, 1.0), vec3(1.0), 0.55);
        float a = glow * pulse * (1.0 + uBoost) * uIntro;
        if (a < 0.004) discard;
        gl_FragColor = vec4(col * a, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending
  });
  const core = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 5.5), coreMat);
  core.frustumCulled = false;
  gyro.add(core);

  /* ── дальняя аллея рамок-границ ────────────────────────────── */
  const alley = new THREE.Group();
  scene.add(alley);

  const ALLEY_COUNT = isMobile ? 5 : 7;
  const ALLEY_GAP = 5.2;
  const ALLEY_TOTAL = ALLEY_COUNT * ALLEY_GAP;
  const alleyFrames = [];

  for (let i = 0; i < ALLEY_COUNT; i++) {
    const f = makeFrame(6.0, 3.25, 0.34 + (i % 3) * 0.06, [0xdfe9ff, 0xbfd4ff, 0xeaf2ff][i % 3]);
    f.position.set(0, 0, 2 - i * ALLEY_GAP);
    f.rotation.z = (i % 2 ? 1 : -1) * 0.035;
    f.rotation.y = (i % 3 - 1) * 0.05;
    alley.add(f);
    alleyFrames.push({ mesh: f, baseRot: f.rotation.z, phase: i * 0.6 });
  }

  /* ── постобработка: bright-pass → гауссов bloom → композит ─── */
  const rtScene = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false
  });
  const rtBright = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false
  });
  const rtBlurA = rtBright.clone();
  const rtBlurB = rtBright.clone();

  const QUAD_VS = `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `;

  const brightMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uThreshold: { value: 0.52 }, uKnee: { value: 0.4 } },
    vertexShader: QUAD_VS,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform float uThreshold;
      uniform float uKnee;
      void main(){
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        float l = max(max(c.r, c.g), c.b);
        gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + uKnee, l), 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false
  });

  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } },
    vertexShader: QUAD_VS,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform vec2 uDir;
      void main(){
        vec4 sum = texture2D(tDiffuse, vUv) * 0.227027;
        sum += texture2D(tDiffuse, vUv + uDir * 1.384615) * 0.316216;
        sum += texture2D(tDiffuse, vUv - uDir * 1.384615) * 0.316216;
        sum += texture2D(tDiffuse, vUv + uDir * 3.230769) * 0.070270;
        sum += texture2D(tDiffuse, vUv - uDir * 3.230769) * 0.070270;
        gl_FragColor = sum;
      }
    `,
    depthTest: false,
    depthWrite: false
  });

  const compositeMat = new THREE.ShaderMaterial({
    uniforms: {
      tBase: { value: null },
      tBloom: { value: null },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uBloom: { value: 1.0 },
      uCA: { value: 0.0016 }
    },
    vertexShader: QUAD_VS,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tBase;
      uniform sampler2D tBloom;
      uniform float uTime;
      uniform vec2 uRes;
      uniform float uBloom;
      uniform float uCA;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

      void main(){
        vec2 uv = vUv;
        vec2 d = uv - 0.5;
        vec2 off = d * dot(d, d) * uCA * 6.0;

        vec3 base;
        base.r = texture2D(tBase, uv + off).r;
        base.g = texture2D(tBase, uv).g;
        base.b = texture2D(tBase, uv - off).b;

        vec3 bloom = texture2D(tBloom, uv).rgb;
        vec3 col = base + bloom * uBloom;

        // отражение в «полу»
        float horizon = 0.58;
        if (uv.y < horizon) {
          vec2 ruv = vec2(uv.x, horizon * 2.0 - uv.y);
          float fade = smoothstep(horizon, horizon - 0.36, uv.y);
          vec3 refl = texture2D(tBase, ruv).rgb + texture2D(tBloom, ruv).rgb * 1.25;
          col += refl * 0.30 * fade * fade;
        }

        col *= 1.0 - 0.42 * smoothstep(0.34, 1.0, length(d) * 1.22);

        float g = hash(uv * uRes + fract(uTime) * 57.0) - 0.5;
        col += g * 0.012;

        col = max(col, 0.0);
        col = pow(col, vec3(0.97));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false
  });

  /* ── размеры ──────────────────────────────────────────────── */
  function layout() {
    const mobile = window.innerWidth < 900;
    if (mobile) {
      gyro.scale.setScalar(0.8);
      gyro.position.set(0, 1.6, 0);
      alley.scale.setScalar(0.7);
      alley.position.set(0, 1.6, 0);
    } else {
      gyro.scale.setScalar(1);
      gyro.position.set(1.7, 0, 0);
      alley.scale.setScalar(1);
      alley.position.set(1.7, 0, 0);
    }
  }

  function resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const dpr = renderer.getPixelRatio();

    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);

    const bw = Math.max(2, Math.floor(w * dpr));
    const bh = Math.max(2, Math.floor(h * dpr));
    rtScene.setSize(bw, bh);

    const qw = Math.max(2, Math.floor(bw * 0.5));
    const qh = Math.max(2, Math.floor(bh * 0.5));
    rtBright.setSize(qw, qh);
    rtBlurA.setSize(qw, qh);
    rtBlurB.setSize(qw, qh);

    bgMat.uniforms.uRes.value.set(w, h);
    compositeMat.uniforms.uRes.value.set(bw, bh);

    layout();
  }
  resize();

  /* ── HUD: телеметрия вращения ─────────────────────────────── */
  let hud = null;
  const hero = document.querySelector('.hero');
  if (hero && !isMobile) {
    hud = document.createElement('div');
    hud.className = 'scene-hud';
    hud.setAttribute('aria-hidden', 'true');
    hero.appendChild(hud);
  }

  /* ── интерактив: курсор ────────────────────────────────────── */
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', (e) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  /* ── интерактив: наклон телефона → параллакс сцены ────────── */
  const coarsePointer = window.matchMedia('(pointer:coarse)').matches;
  const tilt = { tx: 0, ty: 0, sx: 0, sy: 0, on: false };
  if (coarsePointer && !reduceMotion) {
    window.addEventListener('deviceorientation', (e) => {
      if (typeof e.gamma !== 'number' || typeof e.beta !== 'number') return;
      if (!tilt.on) {
        tilt.on = true;
        // подсказку про drag меняем на «наклоняй» и показываем
        const hint = document.querySelector('.hero__drag-hint');
        if (hint) {
          const span = hint.querySelector('span');
          if (span) span.textContent = 'наклоняй — вращай';
          hint.classList.add('tilt-mode');
        }
      }
      tilt.tx = Math.max(-1, Math.min(1, e.gamma / 26));
      tilt.ty = Math.max(-1, Math.min(1, (e.beta - 42) / 38));
    }, { passive: true });
  }

  /* ── интерактив: вращение гироскопа перетаскиванием ────────── */
  const DRAG_YAW_K = 0.0052;    // рад на пиксель по горизонтали
  const DRAG_PITCH_K = 0.0034;  // рад на пиксель по вертикали
  const spin = {
    yaw: 0, pitch: 0,          // накопленный поворот группы
    velYaw: 0, velPitch: 0,    // угловые скорости (инерция), рад/с
    dragging: false,
    lastX: 0, lastY: 0,
    idle: 0                    // секунд без взаимодействия — возврат автовращения
  };

  const AUTO_YAW = reduceMotion ? 0 : 0.12;    // рад/с базовое автовращение
  const AUTO_PITCH = reduceMotion ? 0 : 0.045;

  if (hero) {
    hero.style.touchAction = 'pan-y';
    hero.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, a, input, textarea, select, [role="button"], .auth-overlay')) return;
      spin.dragging = true;
      spin.lastX = e.clientX;
      spin.lastY = e.clientY;
      spin.idle = 0;
      spin.velYaw = 0;
      spin.velPitch = 0;
      document.body.classList.add('is-dragging-scene');
      try { hero.setPointerCapture(e.pointerId); } catch (err) {}
    });
    hero.addEventListener('pointermove', (e) => {
      if (!spin.dragging) return;
      const dx = e.clientX - spin.lastX;
      const dy = e.clientY - spin.lastY;
      spin.lastX = e.clientX;
      spin.lastY = e.clientY;

      // прямое управление: объект следует за рукой
      spin.yaw += dx * DRAG_YAW_K;
      spin.pitch += dy * DRAG_PITCH_K;
      spin.pitch = Math.max(-0.55, Math.min(0.55, spin.pitch));

      // оценка мгновенной скорости для инерции (события ≈ по кадрам)
      const estYaw = dx * DRAG_YAW_K * 60;
      const estPitch = dy * DRAG_PITCH_K * 60;
      spin.velYaw += (estYaw - spin.velYaw) * 0.4;
      spin.velPitch += (estPitch - spin.velPitch) * 0.4;
    });
    const endDrag = () => {
      if (!spin.dragging) return;
      spin.dragging = false;
      spin.idle = 0;
      document.body.classList.remove('is-dragging-scene');
    };
    hero.addEventListener('pointerup', endDrag);
    hero.addEventListener('pointercancel', endDrag);
    hero.addEventListener('pointerleave', endDrag);
  }

  /* ── скролл ────────────────────────────────────────────────── */
  let scrollTarget = 0;
  let scrollSmooth = 0;
  function readScroll() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    scrollTarget = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  }
  window.addEventListener('scroll', readScroll, { passive: true });
  readScroll();

  /* ── цикл ─────────────────────────────────────────────────── */
  const clock = new THREE.Clock();
  let framesCount = 0;
  let elapsed = 0;
  let degraded = false;
  let lastOpacity = -1;
  let hudTick = 0;
  let introAt = -1;                 // момент снятия прелоадера — старт каскадного входа
  let cheapTick = 0;                // прорежение кадров, когда hero вне экрана

  function smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  function render() {
    requestAnimationFrame(render);

    if (contextLost) return;   // GPU сбросил контекст — не дёргаем мёртвый renderer

    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const at = reduceMotion ? 0 : t;

    /* экономия GPU: hero полностью ушел вверх — рендерим каждый третий кадр,
       чтобы сцена не душила страницу внизу (тарифы, FAQ) */
    cheapTick++;
    if (window.scrollY > window.innerHeight * 1.3 && (cheapTick % 3) !== 0) return;

    /* адаптивное качество */
    framesCount++;
    elapsed += dt;
    if (framesCount === 110) {
      if (elapsed / 110 > 0.031 && !degraded && DPR > 1.01) {
        degraded = true;
        renderer.setPixelRatio(1);
        resize();
      }
      framesCount = 0;
      elapsed = 0;
    }

    const kPtr = 1 - Math.exp(-dt * 3.2);
    pointer.x += (pointer.tx - pointer.x) * kPtr;
    pointer.y += (pointer.ty - pointer.y) * kPtr;

    // наклон телефона плавно ведёт камеру (между касаниями)
    if (tilt.on) {
      const kT = 1 - Math.exp(-dt * 2.2);
      tilt.sx += (tilt.tx - tilt.sx) * kT;
      tilt.sy += (tilt.ty - tilt.sy) * kT;
      pointer.tx = tilt.sx;
      pointer.ty = tilt.sy;
    }

    const kScroll = 1 - Math.exp(-dt * 4.5);
    scrollSmooth += (scrollTarget - scrollSmooth) * kScroll;

    const heroFade = 1 - smoothstep(0.006, 0.075, scrollSmooth);  // 1 в hero → 0 ниже
    const speed = reduceMotion ? 0.6 : 2.3 + scrollSmooth * 5.0;

    /* физика вращения */
    spin.idle += dt;
    if (!spin.dragging) {
      const damp = Math.pow(0.09, dt);            // затухание инерции после броска
      spin.velYaw *= damp;
      spin.velPitch *= damp;
      // автовращение плавно возвращается, когда инерция утихла
      const idleK = smoothstep(0.9, 2.8, spin.idle);
      spin.yaw += spin.velYaw * dt + AUTO_YAW * (0.3 + 0.7 * idleK) * dt;
      spin.pitch += spin.velPitch * dt + AUTO_PITCH * idleK * dt;
      spin.pitch = Math.max(-0.55, Math.min(0.55, spin.pitch));
      spin.pitch *= Math.pow(0.5, dt * 0.1);      // pitch медленно возвращается к нулю
    }
    const spinEnergy = Math.min(1, Math.abs(spin.velYaw) * 3 + Math.abs(spin.velPitch) * 4);

    /* камера */
    camera.position.x = pointer.x * 0.55;
    camera.position.y = -pointer.y * 0.38;
    camera.position.z = CAM_Z - (reduceMotion ? 0 : Math.sin(at * 0.24) * 0.25);
    camera.lookAt(1.7 * 0.35 * (window.innerWidth < 900 ? 0 : 1), 0, -12);
    camera.rotation.z = pointer.x * 0.012;

    /* каскадный вход после прелоадера */
    if (introAt < 0 && (document.body.classList.contains('booted') || t > 4)) introAt = t;
    const introT = introAt < 0 ? 0 : t - introAt;

    /* гироскоп */
    gyro.rotation.y = spin.yaw;
    gyro.rotation.x = spin.pitch;
    gyro.rotation.z = (reduceMotion ? 0 : Math.sin(at * 0.1) * 0.02) + scrollSmooth * 0.08;

    // уход гироскопа при скролле — объект «отпускает» страницу
    gyro.position.y = (window.innerWidth < 900 ? 1.6 : 0) + scrollSmooth * 10.0;
    const gyroScale = (window.innerWidth < 900 ? 0.8 : 1) * (1 - scrollSmooth * 0.35);
    gyro.scale.setScalar(gyroScale);

    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      r.mesh.rotation.z = reduceMotion ? r.phase : at * r.spin + r.phase;
      r.holder.rotation.z = r.baseTilt.z + (reduceMotion ? 0 : at * r.prec * 0.35);
      const wave = 0.8 + 0.2 * Math.sin(at * 0.8 + r.phase);
      const introK = smoothstep(0, 0.75, introT - r.idx * 0.1);
      r.mesh.scale.setScalar(0.9 + 0.1 * introK);
      r.mesh.material.uniforms.uOpacity.value = r.wave * wave * (0.68 + spinEnergy * 0.3) * (0.35 + 0.65 * heroFade) * introK;
      r.mesh.material.uniforms.uTime.value = at;
    }

    coreMat.uniforms.uTime.value = at;
    coreMat.uniforms.uBoost.value = spinEnergy * 0.8;
    coreMat.uniforms.uIntro.value = smoothstep(0, 0.6, introT);

    /* аллея рамок */
    for (let i = 0; i < alleyFrames.length; i++) {
      const f = alleyFrames[i];
      const m = f.mesh;

      m.position.z += speed * dt;
      if (m.position.z > CAM_Z - 1) m.position.z -= ALLEY_TOTAL;

      const dist = CAM_Z - m.position.z;
      // ближние рамки гасим раньше — иначе они становятся полосами во всю ширину
      const nearFade = smoothstep(2.6, 7.2, dist);
      const farFade = 1 - smoothstep(26.0, 46.0, dist);
      const wave = 0.82 + 0.18 * Math.sin(at * 0.8 + f.phase);

      m.material.uniforms.uOpacity.value = nearFade * farFade * wave * 0.32 * (0.3 + 0.7 * heroFade) * (0.35 + 0.65 * smoothstep(0, 0.5, introT));
      m.material.uniforms.uTime.value = at;
      m.rotation.z = f.baseRot + (reduceMotion ? 0 : Math.sin(at * 0.16 + f.phase) * 0.03);
    }
    alley.rotation.z = (reduceMotion ? 0 : Math.sin(at * 0.1) * 0.015) + scrollSmooth * 0.05;
    alley.rotation.y = pointer.x * 0.05;

    bgMat.uniforms.uTime.value = at;
    bgMat.uniforms.uScroll.value = scrollSmooth;
    bgMat.uniforms.uSpin.value = spinEnergy;

    /* HUD телеметрии */
    if (hud) {
      hudTick += dt;
      if (hudTick > 0.12) {
        hudTick = 0;
        const deg = ((spin.yaw * 57.2958) % 360 + 360) % 360;
        const vel = (spin.velYaw * 57.2958).toFixed(0);
        hud.textContent =
          'GYRO θ ' + String(Math.round(deg)).padStart(3, '0') + '°' +
          ' · φ ' + (spin.pitch * 57.2958).toFixed(1) + '°' +
          ' · ω ' + (vel >= 0 ? '+' : '') + vel + '°/s';
      }
    }

    /* затухание сцены под контентом */
    const op = 1 - 0.72 * smoothstep(0.006, 0.075, scrollSmooth);
    const opR = Math.round(op * 40) / 40;
    if (opR !== lastOpacity) {
      canvas.style.opacity = opR.toFixed(2);
      lastOpacity = opR;
    }

    /* рендер */
    renderer.autoClear = true;
    renderer.setRenderTarget(rtScene);
    quad.material = bgMat;
    renderer.render(quadScene, quadCam);

    renderer.autoClear = false;
    renderer.render(scene, camera);
    renderer.autoClear = true;

    quad.material = brightMat;
    brightMat.uniforms.tDiffuse.value = rtScene.texture;
    renderer.setRenderTarget(rtBright);
    renderer.render(quadScene, quadCam);

    quad.material = blurMat;
    blurMat.uniforms.tDiffuse.value = rtBright.texture;
    blurMat.uniforms.uDir.value.set(1 / rtBright.width, 0);
    renderer.setRenderTarget(rtBlurA);
    renderer.render(quadScene, quadCam);

    blurMat.uniforms.tDiffuse.value = rtBlurA.texture;
    blurMat.uniforms.uDir.value.set(0, 1 / rtBright.height);
    renderer.setRenderTarget(rtBlurB);
    renderer.render(quadScene, quadCam);

    blurMat.uniforms.tDiffuse.value = rtBlurB.texture;
    blurMat.uniforms.uDir.value.set(2.4 / rtBright.width, 0);
    renderer.setRenderTarget(rtBlurA);
    renderer.render(quadScene, quadCam);

    blurMat.uniforms.tDiffuse.value = rtBlurA.texture;
    blurMat.uniforms.uDir.value.set(0, 2.4 / rtBright.height);
    renderer.setRenderTarget(rtBlurB);
    renderer.render(quadScene, quadCam);

    compositeMat.uniforms.tBase.value = rtScene.texture;
    compositeMat.uniforms.tBloom.value = rtBlurB.texture;
    compositeMat.uniforms.uTime.value = t;

    renderer.setRenderTarget(null);
    quad.material = compositeMat;
    renderer.render(quadScene, quadCam);
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  });

  render();
})();
