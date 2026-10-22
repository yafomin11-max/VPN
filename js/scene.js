/* ══════════════════════════════════════════════════════════════
   parallelogram.vpn — 3D-сцена
   Туннель из светящихся параллелограммов: трафик внутри
   зашифрованного канала. Шейдеры + собственный bloom.
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const canvas = document.getElementById('scene');
  if (!canvas || typeof THREE === 'undefined') return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 120);
  const CAM_Z = 9;
  camera.position.set(0, 0, CAM_Z);

  /* ── фон ──────────────────────────────────────────────────── */
  const bgMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uScroll: { value: 0 }
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

        // холодное свечение в глубине туннеля
        vec2 c = vec2(0.17, 0.02);
        float d = length((p - c) * vec2(1.0, 1.35));
        col += vec3(0.055, 0.075, 0.105) * pow(max(0.0, 1.0 - d * 1.25), 3.4);

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

  /* ── туннель параллелограммов ─────────────────────────────── */
  const tunnel = new THREE.Group();
  tunnel.position.x = window.innerWidth < 900 ? 0 : 1.7;
  scene.add(tunnel);

  const FRAME_W = 6.0;
  const FRAME_H = 3.25;
  const COUNT = 9;
  const GAP = 4.6;
  const TOTAL = COUNT * GAP;

  const frameGeo = new THREE.PlaneGeometry(FRAME_W * 2, FRAME_H * 2, 1, 1);

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

      // вторая, внутренняя линия — как рамка на логотипе
      float d2 = abs(sdBox(p, b * 0.78));
      float inner = (1.0 - smoothstep(t * 0.4, t * 1.3, d2)) * 0.22;

      float edgeFade = smoothstep(0.0, 1.2, uSize.x - abs(p.x));

      vec3 col = uColor * (core * 1.35 + halo + inner);
      col *= edgeFade;

      gl_FragColor = vec4(col * uOpacity, 1.0);
    }
  `;

  const frames = [];
  const COLORS = [0xdfe9ff, 0xbfd4ff, 0xeaf2ff, 0xcfe0ff, 0xffffff];

  for (let i = 0; i < COUNT; i++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(COLORS[i % COLORS.length]) },
        uSize: { value: new THREE.Vector2(FRAME_W, FRAME_H) },
        uShear: { value: 0.34 + (i % 3) * 0.06 },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uSeed: { value: i * 0.37 }
      },
      vertexShader: frameVert,
      fragmentShader: frameFrag,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending
    });

    const mesh = new THREE.Mesh(frameGeo, mat);
    mesh.position.set(0, 0, 2 - i * GAP);
    mesh.rotation.z = (i % 2 ? 1 : -1) * 0.035;
    mesh.rotation.y = (i % 3 - 1) * 0.05;
    mesh.frustumCulled = false;
    tunnel.add(mesh);

    frames.push({ mesh: mesh, baseRot: mesh.rotation.z, phase: i * 0.6 });
  }

  /* ── частицы «пакетов» ────────────────────────────────────── */
  const PCOUNT = window.innerWidth < 900 ? 420 : 900;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PCOUNT * 3);
  const pSeed = new Float32Array(PCOUNT);
  const pSize = new Float32Array(PCOUNT);

  for (let i = 0; i < PCOUNT; i++) {
    const r = 1.2 + Math.pow(Math.random(), 0.65) * 6.4;
    const a = Math.random() * Math.PI * 2;
    pPos[i * 3] = Math.cos(a) * r;
    pPos[i * 3 + 1] = Math.sin(a) * r * 0.62;
    pPos[i * 3 + 2] = 8 - Math.random() * 58;
    pSeed[i] = Math.random();
    pSize[i] = 0.4 + Math.random() * 1.5;
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('aSeed', new THREE.BufferAttribute(pSeed, 1));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));

  const pMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: DPR },
      uScroll: { value: 0 }
    },
    vertexShader: `
      attribute float aSeed;
      attribute float aSize;
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uScroll;
      varying float vAlpha;

      void main(){
        vec3 p = position;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;

        float dist = max(-mv.z, 0.5);
        gl_PointSize = aSize * uPixelRatio * (16.0 / dist);
        gl_PointSize = clamp(gl_PointSize, 0.7, 26.0);

        float tw = 0.55 + 0.45 * sin(uTime * (0.7 + aSeed * 2.2) + aSeed * 40.0);
        vAlpha = tw * (0.25 + uScroll * 0.15) * (1.0 - smoothstep(24.0, 44.0, dist));
      }
    `,
    fragmentShader: `
      precision mediump float;
      varying float vAlpha;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.05, d);
        if (a * vAlpha < 0.003) discard;
        gl_FragColor = vec4(vec3(0.82, 0.90, 1.0), a * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  scene.add(points);

  /* ── постобработка ────────────────────────────────────────── */
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
    pMat.uniforms.uPixelRatio.value = dpr;

    if (w < 900) {
      tunnel.scale.setScalar(0.7);
      tunnel.position.set(0, 2.0, 0);
    } else {
      tunnel.scale.setScalar(1);
      tunnel.position.set(1.7, 0, 0);
    }
  }
  resize();

  /* ── интерактив ───────────────────────────────────────────── */
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', (e) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

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

  function smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  function render() {
    requestAnimationFrame(render);

    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const at = reduceMotion ? 0 : t;

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

    const kScroll = 1 - Math.exp(-dt * 4.5);
    scrollSmooth += (scrollTarget - scrollSmooth) * kScroll;

    const speed = reduceMotion ? 0.6 : 2.3 + scrollSmooth * 5.0;

    /* камера */
    camera.position.x = pointer.x * 0.55;
    camera.position.y = -pointer.y * 0.38;
    camera.position.z = CAM_Z - (reduceMotion ? 0 : Math.sin(at * 0.24) * 0.25);
    camera.lookAt(tunnel.position.x * 0.35, 0, -12);
    camera.rotation.z = pointer.x * 0.012;

    /* рамки */
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const m = f.mesh;

      m.position.z += speed * dt;
      if (m.position.z > CAM_Z - 1) m.position.z -= TOTAL;

      const dist = CAM_Z - m.position.z;
      const nearFade = smoothstep(0.6, 4.6, dist);
      const farFade = 1 - smoothstep(26.0, 46.0, dist);
      const wave = 0.82 + 0.18 * Math.sin(at * 0.8 + f.phase);

      m.material.uniforms.uOpacity.value = nearFade * farFade * wave * 0.78;
      m.material.uniforms.uTime.value = at;
      m.rotation.z = f.baseRot + (reduceMotion ? 0 : Math.sin(at * 0.16 + f.phase) * 0.03);
    }

    tunnel.rotation.z = (reduceMotion ? 0 : Math.sin(at * 0.1) * 0.015) + scrollSmooth * 0.05;
    tunnel.rotation.y = pointer.x * 0.05;

    /* частицы */
    const arr = pGeo.attributes.position.array;
    const drift = speed * 0.55;
    for (let i = 0; i < PCOUNT; i++) {
      arr[i * 3 + 2] += (0.6 + pSeed[i] * 1.6) * drift * dt;
      if (arr[i * 3 + 2] > CAM_Z) {
        arr[i * 3 + 2] -= 62;
      }
    }
    pGeo.attributes.position.needsUpdate = true;
    pMat.uniforms.uTime.value = at;
    pMat.uniforms.uScroll.value = scrollSmooth;

    bgMat.uniforms.uTime.value = at;
    bgMat.uniforms.uScroll.value = scrollSmooth;

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
