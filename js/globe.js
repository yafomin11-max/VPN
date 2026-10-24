/* ══════════════════════════════════════════════════════════════
   parallelogram.vpn — интерактивный глобус серверов
   Каркасная сфера + узлы локаций + дуги трафика с бегущими
   импульсами. Вращается перетаскиванием (инерция + автовращение),
   наведение на карточку сервера доворачивает глобус к локации.
   Рендер останавливается, когда секция вне вьюпорта.
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const canvas = document.getElementById('globe');
  if (!canvas || typeof THREE === 'undefined') return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wrap = canvas.parentElement;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: true,
      stencil: false,
      powerPreference: 'low-power'
    });
  } catch (e) {
    wrap.classList.add('globe-fallback');
    return;
  }
  if (!renderer.getContext()) { wrap.classList.add('globe-fallback'); return; }

  renderer.setClearColor(0x000000, 0);
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(DPR);

  // защита от сбоя GPU: теряем контекст — тихо гасим глобус
  let contextLost = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    contextLost = true;
    wrap.classList.add('globe-fallback');
  }, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
  camera.position.set(0, 0, 3.05);

  const world = new THREE.Group();      // вращаемая часть
  scene.add(world);

  /* ── текстуры-спрайты (canvas) ────────────────────────────── */
  function glowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(230,240,255,.55)');
    grad.addColorStop(1, 'rgba(230,240,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  function ringTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,255,255,.95)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(32, 32, 24, 0, Math.PI * 2);
    g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  const TEX_GLOW = glowTexture();
  const TEX_RING = ringTexture();

  /* ── каркасная сфера ──────────────────────────────────────── */
  const R = 1;
  const graticule = new THREE.Group();
  world.add(graticule);

  function addLines(points, opacity) {
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: 0xbfd0ff,
      transparent: true,
      opacity: opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const line = new THREE.Line(geo, mat);
    graticule.add(line);
    return line;
  }

  // широты: каждая — отдельная замкнутая линия
  const LAT_STEP = 15, LON_STEP = 15;
  for (let lat = -75; lat <= 75; lat += LAT_STEP) {
    const ring = [];
    for (let lon = -180; lon <= 180; lon += 4) ring.push(ll2v(lat, lon));
    addLines(ring, Math.abs(lat) === 0 ? 0.34 : 0.16);
  }
  // долготы
  for (let lon = -180; lon < 180; lon += LON_STEP) {
    const ring = [];
    for (let lat = -90; lat <= 90; lat += 4) ring.push(ll2v(lat, lon));
    addLines(ring, 0.16);
  }

  function ll2v(latDeg, lonDeg, r) {
    const lat = latDeg * Math.PI / 180;
    const lon = lonDeg * Math.PI / 180;
    const rr = r === undefined ? R : r;
    return new THREE.Vector3(
      Math.cos(lat) * Math.sin(lon),
      Math.sin(lat),
      Math.cos(lat) * Math.cos(lon)
    ).multiplyScalar(rr);
  }

  /* ── ореол за сферой ──────────────────────────────────────── */
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: TEX_GLOW,
    color: 0x5f708f,
    transparent: true,
    opacity: 0.34,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  }));
  halo.scale.setScalar(3.6);
  scene.add(halo);

  /* ── локации ───────────────────────────────────────────────── */
  const NODES = {
    us: { lat: 40.71, lon: -74.01, label: 'Нью-Йорк', soon: false },
    de: { lat: 50.11, lon: 8.68, label: 'Франкфурт', soon: false },
    nl: { lat: 52.37, lon: 4.90, label: 'Амстердам', soon: true },
    fi: { lat: 60.17, lon: 24.94, label: 'Хельсинки', soon: true }
  };

  const nodeObjs = {};
  Object.keys(NODES).forEach(function (key) {
    const n = NODES[key];
    const pos = ll2v(n.lat, n.lon, R * 1.005);

    const dot = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX_GLOW,
      color: n.soon ? 0x8f8f96 : 0xffffff,
      transparent: true,
      opacity: n.soon ? 0.5 : 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    dot.scale.setScalar(n.soon ? 0.13 : 0.2);
    dot.position.copy(pos);
    world.add(dot);

    // пульсирующее кольцо — только у онлайн-узлов
    let ring = null;
    if (!n.soon) {
      ring = new THREE.Sprite(new THREE.SpriteMaterial({
        map: TEX_RING,
        color: 0xdfe9ff,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      }));
      ring.position.copy(pos);
      ring.scale.setScalar(0.2);
      world.add(ring);
    }

    nodeObjs[key] = { dot: dot, ring: ring, phase: Math.random() * Math.PI * 2, node: n };
  });

  /* ── дуги трафика ──────────────────────────────────────────── */
  const arcs = [];

  function addArc(keyA, keyB) {
    const a = ll2v(NODES[keyA].lat, NODES[keyA].lon, R);
    const b = ll2v(NODES[keyB].lat, NODES[keyB].lon, R);
    const mid = a.clone().add(b).multiplyScalar(0.5).normalize();
    const lift = 1 + 0.28 * a.angleTo(b);
    const ctrl = mid.multiplyScalar(lift);

    const curve = new THREE.QuadraticBezierCurve3(a, ctrl, b);
    const pts = curve.getPoints(48);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({
        color: 0xdfe9ff,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    world.add(line);

    // бегущий импульс
    const pulse = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX_GLOW,
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    pulse.scale.setScalar(0.085);
    world.add(pulse);

    arcs.push({ curve: curve, pulse: pulse, speed: 0.22 + Math.random() * 0.14, offset: Math.random() });
  }

  addArc('us', 'de');
  addArc('de', 'fi');
  addArc('us', 'nl');

  /* ── вращение: drag + инерция + автовращение + доворот ────── */
  const AUTO_SPEED = reduceMotion ? 0 : 0.14;
  const spin = {
    yaw: -0.9, pitch: 0.34,
    velYaw: 0,
    dragging: false,
    lastX: 0, lastY: 0,
    focusYaw: null,     // цель доворота (радианы) или null
    focusT: 0           // 0..1 прогресс доворота
  };

  // долгота точки, которая окажется лицом к камере при данном yaw: -yaw
  function yawForNode(key) {
    return -NODES[key].lon * Math.PI / 180;
  }

  canvas.style.touchAction = 'pan-y';
  canvas.addEventListener('pointerdown', function (e) {
    spin.dragging = true;
    spin.lastX = e.clientX;
    spin.lastY = e.clientY;
    spin.velYaw = 0;
    spin.focusYaw = null;
    wrap.classList.add('is-grabbing');
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!spin.dragging) return;
    const dx = e.clientX - spin.lastX;
    const dy = e.clientY - spin.lastY;
    spin.lastX = e.clientX;
    spin.lastY = e.clientY;
    spin.yaw += dx * 0.0056;
    spin.pitch = Math.max(-1.1, Math.min(1.1, spin.pitch + dy * 0.0032));
    spin.velYaw += (dx * 0.0056 * 60 - spin.velYaw) * 0.4;
  });
  function endDrag() {
    if (!spin.dragging) return;
    spin.dragging = false;
    wrap.classList.remove('is-grabbing');
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // наведение на карточку сервера → доворот глобуса к локации
  document.querySelectorAll('.server[data-node]').forEach(function (card) {
    const key = card.getAttribute('data-node');
    if (!NODES[key]) return;
    card.addEventListener('mouseenter', function () {
      let target = yawForNode(key);
      // кратчайший путь
      while (target - spin.yaw > Math.PI) target -= Math.PI * 2;
      while (target - spin.yaw < -Math.PI) target += Math.PI * 2;
      spin.focusYaw = target;
      spin.focusT = 0;
    });
    card.addEventListener('mouseleave', function () {
      spin.focusYaw = null;
    });
  });

  /* ── HUD-координаты: точка, смотрящая на камеру ────────────── */
  const latEl = document.getElementById('globeLat');
  const front = new THREE.Vector3();

  /* ── размеры ──────────────────────────────────────────────── */
  function resize() {
    const rect = wrap.getBoundingClientRect();
    const size = Math.max(2, Math.round(Math.min(rect.width, rect.height || rect.width)));
    renderer.setSize(size, size, false);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
  }
  resize();

  const ro = ('ResizeObserver' in window) ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(wrap);

  /* ── рендер только при видимости ──────────────────────────── */
  let visible = false;
  let running = false;

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible && !running) { running = true; clock.start(); render(); }
    }, { rootMargin: '80px' });
    io.observe(wrap);
  } else {
    visible = true;
  }

  /* ── цикл ─────────────────────────────────────────────────── */
  const clock = new THREE.Clock();

  function render() {
    if (!visible || contextLost) { running = false; return; }
    requestAnimationFrame(render);

    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    if (spin.focusYaw !== null && !spin.dragging) {
      // плавный доворот к локации
      spin.focusT = Math.min(1, spin.focusT + dt * 1.8);
      const k = 1 - Math.pow(1 - spin.focusT, 3);
      const prev = spin.yaw;
      spin.yaw += (spin.focusYaw - spin.yaw) * (1 - Math.pow(0.001, dt * k * 2));
      if (spin.focusT >= 1 && Math.abs(spin.yaw - prev) < 0.0004) spin.focusYaw = null;
    } else if (!spin.dragging) {
      const damp = Math.pow(0.08, dt);
      spin.velYaw *= damp;
      spin.yaw += spin.velYaw * dt + AUTO_SPEED * dt;
    }

    world.rotation.y = spin.yaw;
    world.rotation.x = spin.pitch * 0.35;

    // мерцание узлов и колец
    Object.keys(nodeObjs).forEach(function (key) {
      const o = nodeObjs[key];
      const tw = 0.75 + 0.25 * Math.sin(t * 1.8 + o.phase);
      o.dot.material.opacity = o.node.soon ? 0.4 * tw : 0.95 * tw;
      if (o.ring) {
        const p = (t * 0.55 + o.phase / (Math.PI * 2)) % 1;
        o.ring.scale.setScalar(0.2 + p * 0.55);
        o.ring.material.opacity = 0.65 * (1 - p);
      }
    });

    // импульсы по дугам
    for (let i = 0; i < arcs.length; i++) {
      const a = arcs[i];
      const tt = (t * a.speed + a.offset) % 1;
      a.pulse.position.copy(a.curve.getPoint(tt));
      a.pulse.material.opacity = 0.35 + 0.6 * Math.sin(tt * Math.PI);
    }

    // координаты «центра взгляда»
    if (latEl) {
      front.set(Math.sin(-spin.yaw) * Math.cos(spin.pitch * 0.35),
                Math.sin(spin.pitch * 0.35),
                Math.cos(-spin.yaw) * Math.cos(spin.pitch * 0.35));
      const latDeg = Math.asin(Math.max(-1, Math.min(1, front.y))) * 57.2958;
      const lonDeg = Math.atan2(front.x, front.z) * 57.2958;
      latEl.textContent =
        Math.abs(latDeg).toFixed(1) + '°' + (latDeg >= 0 ? 'N' : 'S') +
        ' · ' +
        Math.abs(lonDeg).toFixed(1) + '°' + (lonDeg >= 0 ? 'E' : 'W');
    }

    renderer.render(scene, camera);
  }

  if (visible) { running = true; render(); }
})();
