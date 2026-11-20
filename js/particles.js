/* ==========================================================================
   Portfólio · Campo de partículas WebGL 3D (JavaScript puro, sem bibliotecas)
   Inspirado na estética do fable.sparo.com.br:
   - Morfismo 3D contínuo por seção (toro/anel, onda, grade, globo, hélice, halo)
   - Entrada coreografada em condensação
   - Repulsão + vórtice suave seguindo o ponteiro
   - Onda de choque radial ao clicar em áreas livres
   - Respeita prefers-reduced-motion e pausa quando a aba está oculta
   ========================================================================== */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canvas = document.getElementById('bg-particles');
  if (!canvas || reduceMotion) return;

  var gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    depth: false,
    powerPreference: 'high-performance'
  }) || canvas.getContext('experimental-webgl', { alpha: true, depth: false });

  if (!gl) {
    canvas.style.display = 'none';
    return;
  }

  /* Quantidade adaptativa conforme largura da tela */
  var isDesktop = window.innerWidth >= 900;
  var COUNT = isDesktop ? 13000 : 4800;
  var SCULPT_COUNT = Math.floor(COUNT * 0.78);

  /* ---------- Shaders ---------- */
  var VERT_SRC = [
    'precision highp float;',
    'attribute vec3 a_posA;',
    'attribute vec3 a_posB;',
    'attribute vec3 a_seed;',
    '',
    'uniform float u_time;',
    'uniform float u_intro;',
    'uniform float u_morph;',
    'uniform float u_aspect;',
    'uniform float u_dpr;',
    'uniform vec2 u_mouse;',
    'uniform float u_mouseActive;',
    'uniform vec2 u_pulseOrigin;',
    'uniform float u_pulseTime;',
    'uniform float u_hoverEnergy;',
    'uniform vec3 u_accent1;',
    'uniform vec3 u_accent2;',
    'uniform float u_tintBias;',
    'uniform vec2 u_offset;',
    '',
    'varying vec3 v_color;',
    'varying float v_alpha;',
    '',
    'mat2 rot(float a) {',
    '  float s = sin(a), c = cos(a);',
    '  return mat2(c, -s, s, c);',
    '}',
    '',
    'void main() {',
    '  /* Morfismo escalonado com arco orgânico entre formações */',
    '  float stagger = a_seed.x * 0.34;',
    '  float m = clamp((u_morph - stagger) / 0.66, 0.0, 1.0);',
    '  float ease = m < 0.5 ? 4.0 * m * m * m : 1.0 - pow(-2.0 * m + 2.0, 3.0) * 0.5;',
    '  vec3 pos = mix(a_posA, a_posB, ease);',
    '',
    '  float arc = sin(ease * 3.14159265);',
    '  float swirlA = a_seed.x * 6.2831853 + u_time * 0.4;',
    '  pos += vec3(cos(swirlA), sin(swirlA * 1.25), sin(swirlA)) * arc * 0.22;',
    '',
    '  /* Sequência de entrada: dispersão -> faixa luminosa -> forma */',
    '  if (u_intro < 1.0) {',
    '    float it = clamp((u_intro - a_seed.x * 0.32) / 0.68, 0.0, 1.0);',
    '    float iEase = 1.0 - pow(1.0 - it, 3.0);',
    '    vec3 startPos = vec3(',
    '      (a_seed.x - 0.5) * 4.2,',
    '      (a_seed.z - 0.5) * 0.55 + sin(a_seed.x * 20.0) * 0.18,',
    '      (a_seed.y - 1.0) * 2.2',
    '    );',
    '    pos = mix(startPos, pos, iEase);',
    '  }',
    '',
    '  /* Respiração e rotação 3D contínua */',
    '  float breathe = sin(u_time * 0.7 + a_seed.x * 12.566) * 0.016;',
    '  pos.y += breathe;',
    '',
    '  float ry = u_time * 0.13 + u_mouse.x * 0.16 * u_mouseActive;',
    '  float rx = 0.24 - u_mouse.y * 0.11 * u_mouseActive;',
    '  pos.xz = rot(ry) * pos.xz;',
    '  pos.yz = rot(rx) * pos.yz;',
    '',
    '  /* Projeção em perspectiva */',
    '  float z = pos.z + 3.0;',
    '  float fov = 1.52 / max(z, 0.65);',
    '  vec2 ndc = vec2((pos.x * fov) / u_aspect, pos.y * fov) + u_offset;',
    '',
    '  /* Repulsão e vórtice ao redor do cursor */',
    '  vec2 diff = ndc - u_mouse;',
    '  diff.x *= u_aspect;',
    '  float dist = length(diff);',
    '  float radius = 0.30 + u_hoverEnergy * 0.05;',
    '  float force = smoothstep(radius, 0.0, dist) * u_mouseActive;',
    '  vec2 dir = dist > 0.0001 ? diff / dist : vec2(0.0, 1.0);',
    '  vec2 tang = vec2(-dir.y, dir.x);',
    '  vec2 push = (dir * 0.105 + tang * 0.032) * force * force;',
    '  ndc += vec2(push.x / u_aspect, push.y);',
    '',
    '  /* Onda radial ao clicar em área livre */',
    '  float pEnergy = 0.0;',
    '  if (u_pulseTime < 1.0) {',
    '    vec2 pdiff = ndc - u_pulseOrigin;',
    '    pdiff.x *= u_aspect;',
    '    float pdist = length(pdiff);',
    '    float ringR = u_pulseTime * 1.25;',
    '    float ring = exp(-pow((pdist - ringR) * 8.0, 2.0)) * (1.0 - u_pulseTime);',
    '    vec2 pdir = pdist > 0.0001 ? pdiff / pdist : vec2(1.0, 0.0);',
    '    ndc += vec2((pdir.x * ring * 0.11) / u_aspect, pdir.y * ring * 0.11);',
    '    pEnergy = ring;',
    '  }',
    '',
    '  gl_Position = vec4(ndc, 0.0, 1.0);',
    '',
    '  /* Cor fiel à paleta do portfólio (#5eead4 <-> #818cf8) */',
    '  float mixVal = clamp(a_seed.z + u_tintBias + sin(pos.x * 1.4 + u_time * 0.3) * 0.08, 0.0, 1.0);',
    '  vec3 baseCol = mix(u_accent1, u_accent2, mixVal);',
    '  vec3 bright = vec3(0.914, 0.933, 0.965);',
    '  v_color = mix(baseCol, bright, clamp(force * 0.45 + pEnergy * 0.65 + u_hoverEnergy * 0.12, 0.0, 0.75));',
    '',
    '  float depthFade = smoothstep(4.5, 1.8, z);',
    '  float introAlpha = smoothstep(0.0, 0.35, u_intro);',
    '  v_alpha = (0.18 + depthFade * 0.44 + force * 0.28 + pEnergy * 0.38 + u_hoverEnergy * 0.08) * introAlpha;',
    '',
    '  float pt = (1.95 + a_seed.y * 1.85 + force * 1.6 + pEnergy * 2.1) * fov * u_dpr;',
    '  gl_PointSize = clamp(pt, 1.4, 9.5 * u_dpr);',
    '}'
  ].join('\n');

  var FRAG_SRC = [
    'precision mediump float;',
    'varying vec3 v_color;',
    'varying float v_alpha;',
    '',
    'void main() {',
    '  vec2 c = gl_PointCoord - 0.5;',
    '  float d = length(c);',
    '  if (d > 0.5) discard;',
    '  float core = smoothstep(0.5, 0.0, d);',
    '  float glow = pow(core, 2.1);',
    '  gl_FragColor = vec4(v_color, v_alpha * glow);',
    '}'
  ].join('\n');

  function compileShader(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  var vs = compileShader(gl.VERTEX_SHADER, VERT_SRC);
  var fs = compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) return;

  var program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
  gl.useProgram(program);

  /* ---------- PRNG determinístico para formações limpas ---------- */
  var rngState = 133742;
  function rand() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
  }

  /* ---------- Geradores das 6 formações 3D (uma por seção) ---------- */
  function fillAmbient(arr, i) {
    arr[i * 3] = (rand() - 0.5) * 4.4;
    arr[i * 3 + 1] = (rand() - 0.5) * 2.8;
    arr[i * 3 + 2] = (rand() - 0.5) * 2.6;
  }

  // 0. Hero: Toro entrelaçado (Torus Knot 2,3) com anel orbital
  function makeTorusKnot() {
    var arr = new Float32Array(COUNT * 3);
    for (var i = 0; i < COUNT; i++) {
      if (i >= SCULPT_COUNT) { fillAmbient(arr, i); continue; }
      var u = (i / SCULPT_COUNT) * Math.PI * 2 * 3.0;
      var v = rand() * Math.PI * 2;
      var p = 2, q = 3;
      var rCore = 0.72 + 0.28 * Math.cos(q * u);
      var cx = rCore * Math.cos(p * u);
      var cy = rCore * Math.sin(p * u);
      var cz = 0.34 * Math.sin(q * u);
      var tube = 0.14 * Math.sqrt(rand());
      arr[i * 3] = cx + Math.cos(v) * tube;
      arr[i * 3 + 1] = cy + Math.sin(v) * tube;
      arr[i * 3 + 2] = cz + Math.cos(v + u) * tube;
    }
    return arr;
  }

  // 1. Sobre: Onda topográfica 3D (fluxo de dados e performance)
  function makeWaveRibbon() {
    var arr = new Float32Array(COUNT * 3);
    var cols = Math.floor(Math.sqrt(SCULPT_COUNT * 1.45));
    var rows = Math.ceil(SCULPT_COUNT / cols);
    for (var i = 0; i < COUNT; i++) {
      if (i >= SCULPT_COUNT) { fillAmbient(arr, i); continue; }
      var col = i % cols;
      var row = Math.floor(i / cols);
      var nx = (col / (cols - 1) - 0.5) * 2.5;
      var nz = (row / Math.max(rows - 1, 1) - 0.5) * 1.8;
      var ny = Math.sin(nx * 2.6) * 0.28 * Math.cos(nz * 2.1) + Math.cos((nx + nz) * 1.8) * 0.14;
      arr[i * 3] = nx + (rand() - 0.5) * 0.025;
      arr[i * 3 + 1] = ny + (rand() - 0.5) * 0.025;
      arr[i * 3 + 2] = nz + (rand() - 0.5) * 0.025;
    }
    return arr;
  }

  // 2. Projetos: Grade arquitetônica isométrica / blocos modulares
  function makeModularLattice() {
    var arr = new Float32Array(COUNT * 3);
    var blocks = [
      { x: -0.58, y: 0.25, z: 0.15, s: 0.48 },
      { x: 0.42, y: 0.32, z: -0.22, s: 0.52 },
      { x: -0.18, y: -0.42, z: -0.15, s: 0.50 },
      { x: 0.56, y: -0.34, z: 0.28, s: 0.42 }
    ];
    for (var i = 0; i < COUNT; i++) {
      if (i >= SCULPT_COUNT) { fillAmbient(arr, i); continue; }
      var b = blocks[i % blocks.length];
      // Distribui pontos preferencialmente nas arestas e superfícies dos cubos
      var face = i % 6;
      var a = (rand() - 0.5) * b.s;
      var c = (rand() - 0.5) * b.s;
      var h = b.s * 0.5;
      var lx = 0, ly = 0, lz = 0;
      if (face === 0) { lx = h; ly = a; lz = c; }
      else if (face === 1) { lx = -h; ly = a; lz = c; }
      else if (face === 2) { lx = a; ly = h; lz = c; }
      else if (face === 3) { lx = a; ly = -h; lz = c; }
      else if (face === 4) { lx = a; ly = c; lz = h; }
      else { lx = a; ly = c; lz = -h; }
      arr[i * 3] = b.x + lx;
      arr[i * 3 + 1] = b.y + ly;
      arr[i * 3 + 2] = b.z + lz;
    }
    return arr;
  }

  // 3. Stack: Globo Fibonacci com anel orbital (homenagem direta ao globo do Fable)
  function makeGlobe() {
    var arr = new Float32Array(COUNT * 3);
    var ringStart = Math.floor(SCULPT_COUNT * 0.78);
    var golden = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < COUNT; i++) {
      if (i >= SCULPT_COUNT) { fillAmbient(arr, i); continue; }
      if (i < ringStart) {
        var t = i / ringStart;
        var y = 1 - t * 2;
        var rad = Math.sqrt(Math.max(0, 1 - y * y));
        var theta = golden * i;
        var r = 0.92 + (rand() - 0.5) * 0.03;
        arr[i * 3] = Math.cos(theta) * rad * r;
        arr[i * 3 + 1] = y * r;
        arr[i * 3 + 2] = Math.sin(theta) * rad * r;
      } else {
        var ang = ((i - ringStart) / (SCULPT_COUNT - ringStart)) * Math.PI * 2;
        var rr = 1.24 + (rand() - 0.5) * 0.14;
        arr[i * 3] = Math.cos(ang) * rr;
        arr[i * 3 + 1] = Math.sin(ang) * rr * 0.36 + (rand() - 0.5) * 0.03;
        arr[i * 3 + 2] = Math.sin(ang) * rr * 0.92;
      }
    }
    return arr;
  }

  // 4. Trajetória: Dupla hélice ascendente (evolução de carreira)
  function makeHelix() {
    var arr = new Float32Array(COUNT * 3);
    for (var i = 0; i < COUNT; i++) {
      if (i >= SCULPT_COUNT) { fillAmbient(arr, i); continue; }
      var t = i / SCULPT_COUNT;
      var strand = i % 3;
      var turns = t * Math.PI * 5.0;
      var y = (t - 0.5) * 2.15;
      if (strand < 2) {
        var offset = strand * Math.PI;
        var r = 0.62 + (rand() - 0.5) * 0.12;
        arr[i * 3] = Math.cos(turns + offset) * r;
        arr[i * 3 + 1] = y + (rand() - 0.5) * 0.04;
        arr[i * 3 + 2] = Math.sin(turns + offset) * r;
      } else {
        // Barras conectoras sutis entre as duas hélices
        var step = Math.floor(t * 18) / 18;
        var sa = step * Math.PI * 5.0;
        var bridge = (rand() - 0.5) * 1.15;
        arr[i * 3] = Math.cos(sa) * bridge;
        arr[i * 3 + 1] = (step - 0.5) * 2.15 + (rand() - 0.5) * 0.02;
        arr[i * 3 + 2] = Math.sin(sa) * bridge;
      }
    }
    return arr;
  }

  // 5. Contato: Disco orbital / anéis concêntricos (accretion halo)
  function makeHaloDisc() {
    var arr = new Float32Array(COUNT * 3);
    for (var i = 0; i < COUNT; i++) {
      if (i >= SCULPT_COUNT) { fillAmbient(arr, i); continue; }
      var band = i % 4;
      var baseR = 0.42 + band * 0.25 + (rand() - 0.5) * 0.11;
      var ang = rand() * Math.PI * 2;
      arr[i * 3] = Math.cos(ang) * baseR;
      arr[i * 3 + 1] = (rand() - 0.5) * 0.06 * (1.2 - band * 0.15);
      arr[i * 3 + 2] = Math.sin(ang) * baseR;
    }
    return arr;
  }

  var SHAPES = [
    makeTorusKnot(),
    makeWaveRibbon(),
    makeModularLattice(),
    makeGlobe(),
    makeHelix(),
    makeHaloDisc()
  ];

  /* Viés de matiz por seção (mantendo estritamente a paleta verde-água <-> índigo) */
  var SHAPE_TINT = [-0.08, -0.14, -0.04, 0.14, 0.04, -0.10];

  /* Seeds estáveis por partícula */
  var seeds = new Float32Array(COUNT * 3);
  for (var s = 0; s < COUNT; s++) {
    seeds[s * 3] = rand();
    seeds[s * 3 + 1] = 0.55 + rand() * 0.95;
    seeds[s * 3 + 2] = rand();
  }

  /* Buffers WebGL */
  var currentPosA = new Float32Array(SHAPES[0]);
  var currentPosB = new Float32Array(SHAPES[0]);

  var bufA = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bufA);
  gl.bufferData(gl.ARRAY_BUFFER, currentPosA, gl.DYNAMIC_DRAW);

  var bufB = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bufB);
  gl.bufferData(gl.ARRAY_BUFFER, currentPosB, gl.DYNAMIC_DRAW);

  var bufSeed = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bufSeed);
  gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);

  var locPosA = gl.getAttribLocation(program, 'a_posA');
  var locPosB = gl.getAttribLocation(program, 'a_posB');
  var locSeed = gl.getAttribLocation(program, 'a_seed');

  gl.bindBuffer(gl.ARRAY_BUFFER, bufA);
  gl.enableVertexAttribArray(locPosA);
  gl.vertexAttribPointer(locPosA, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, bufB);
  gl.enableVertexAttribArray(locPosB);
  gl.vertexAttribPointer(locPosB, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, bufSeed);
  gl.enableVertexAttribArray(locSeed);
  gl.vertexAttribPointer(locSeed, 3, gl.FLOAT, false, 0, 0);

  var U = {
    time: gl.getUniformLocation(program, 'u_time'),
    intro: gl.getUniformLocation(program, 'u_intro'),
    morph: gl.getUniformLocation(program, 'u_morph'),
    aspect: gl.getUniformLocation(program, 'u_aspect'),
    dpr: gl.getUniformLocation(program, 'u_dpr'),
    mouse: gl.getUniformLocation(program, 'u_mouse'),
    mouseActive: gl.getUniformLocation(program, 'u_mouseActive'),
    pulseOrigin: gl.getUniformLocation(program, 'u_pulseOrigin'),
    pulseTime: gl.getUniformLocation(program, 'u_pulseTime'),
    hoverEnergy: gl.getUniformLocation(program, 'u_hoverEnergy'),
    accent1: gl.getUniformLocation(program, 'u_accent1'),
    accent2: gl.getUniformLocation(program, 'u_accent2'),
    tintBias: gl.getUniformLocation(program, 'u_tintBias'),
    offset: gl.getUniformLocation(program, 'u_offset')
  };

  /* Cores fixas da paleta do portfólio */
  gl.uniform3f(U.accent1, 94 / 255, 234 / 255, 212 / 255);  // #5eead4
  gl.uniform3f(U.accent2, 129 / 255, 140 / 255, 248 / 255); // #818cf8

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.clearColor(0, 0, 0, 0);

  /* ---------- Estado de animação ---------- */
  var activeShape = 0;
  var morphProgress = 1.0;
  var introProgress = 0.0;
  var tintBias = SHAPE_TINT[0];
  var targetTint = SHAPE_TINT[0];

  var mouseTarget = { x: 0, y: 0 };
  var mouseCur = { x: 0, y: 0 };
  var mouseActiveTarget = 0;
  var mouseActive = 0;

  var hoverEnergyTarget = 0;
  var hoverEnergy = 0;

  var pulseOrigin = { x: 0, y: 0 };
  var pulseTime = 1.0;

  var offsetCur = { x: isDesktop ? 0.28 : 0.0, y: 0.0 };
  var offsetTarget = { x: isDesktop ? 0.28 : 0.0, y: 0.0 };

  var dpr = 1;
  var aspect = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = window.innerWidth;
    var h = window.innerHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    aspect = w / Math.max(h, 1);
    isDesktop = w >= 900;
    updateOffsetForShape(activeShape);
  }

  function updateOffsetForShape(idx) {
    if (!isDesktop) {
      offsetTarget.x = 0.0;
      offsetTarget.y = 0.06;
      return;
    }
    // Alterna suavemente o enquadramento da escultura sem disputar leitura com o texto
    var offsets = [
      [0.28, 0.02],   // Hero (enquadra atrás do retrato à direita)
      [0.26, -0.02],  // Sobre
      [-0.24, 0.02],  // Projetos
      [0.26, 0.0],    // Stack
      [0.28, -0.04],  // Trajetória
      [0.0, -0.02]    // Contato
    ];
    var pair = offsets[idx] || [0.24, 0.0];
    offsetTarget.x = pair[0];
    offsetTarget.y = pair[1];
  }

  function setShape(index) {
    var idx = Math.max(0, Math.min(SHAPES.length - 1, index | 0));
    if (idx === activeShape) return;

    // Captura posição atual interpolada como ponto de partida (evita saltos se rolar rápido)
    var t = morphProgress;
    var ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) * 0.5;
    for (var i = 0; i < currentPosA.length; i++) {
      currentPosA[i] = currentPosA[i] + (currentPosB[i] - currentPosA[i]) * ease;
    }
    currentPosB.set(SHAPES[idx]);

    gl.bindBuffer(gl.ARRAY_BUFFER, bufA);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, currentPosA);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufB);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, currentPosB);

    activeShape = idx;
    morphProgress = 0.0;
    targetTint = SHAPE_TINT[idx];
    updateOffsetForShape(idx);
  }

  function triggerPulse(clientX, clientY) {
    pulseOrigin.x = (clientX / window.innerWidth) * 2 - 1;
    pulseOrigin.y = -((clientY / window.innerHeight) * 2 - 1);
    pulseTime = 0.0;
  }

  /* Eventos de ponteiro (pass-through global, sem bloquear cliques na UI) */
  if (window.matchMedia('(hover: hover)').matches) {
    window.addEventListener('pointermove', function (e) {
      mouseTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseTarget.y = -((e.clientY / window.innerHeight) * 2 - 1);
      mouseActiveTarget = 1.0;
    }, { passive: true });

    document.addEventListener('pointerleave', function () {
      mouseActiveTarget = 0.0;
    });
  }

  // Onda radial ao clicar fora de links/botões (como no vazio do Fable)
  document.addEventListener('click', function (e) {
    if (e.target.closest('a, button, input, video')) return;
    triggerPulse(e.clientX, e.clientY);
  });

  window.addEventListener('resize', resize, { passive: true });
  resize();

  /* Loop de renderização com pausa automática fora de foco */
  var rafId = 0;
  var lastTime = performance.now();
  var elapsed = 0;

  function frame(now) {
    rafId = window.requestAnimationFrame(frame);
    var dt = Math.min((now - lastTime) * 0.001, 0.05);
    lastTime = now;
    elapsed += dt;

    if (introProgress < 1.0) {
      introProgress = Math.min(1.0, introProgress + dt * 0.62);
    }
    if (morphProgress < 1.0) {
      morphProgress = Math.min(1.0, morphProgress + dt * 0.68);
    }
    if (pulseTime < 1.0) {
      pulseTime = Math.min(1.0, pulseTime + dt * 0.92);
    }

    var smooth = 1 - Math.exp(-dt * 7.5);
    mouseCur.x += (mouseTarget.x - mouseCur.x) * smooth;
    mouseCur.y += (mouseTarget.y - mouseCur.y) * smooth;
    mouseActive += (mouseActiveTarget - mouseActive) * (1 - Math.exp(-dt * 4.5));
    hoverEnergy += (hoverEnergyTarget - hoverEnergy) * (1 - Math.exp(-dt * 6.0));
    tintBias += (targetTint - tintBias) * (1 - Math.exp(-dt * 3.0));
    offsetCur.x += (offsetTarget.x - offsetCur.x) * (1 - Math.exp(-dt * 3.2));
    offsetCur.y += (offsetTarget.y - offsetCur.y) * (1 - Math.exp(-dt * 3.2));

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(U.time, elapsed);
    gl.uniform1f(U.intro, introProgress);
    gl.uniform1f(U.morph, morphProgress);
    gl.uniform1f(U.aspect, aspect);
    gl.uniform1f(U.dpr, dpr);
    gl.uniform2f(U.mouse, mouseCur.x, mouseCur.y);
    gl.uniform1f(U.mouseActive, mouseActive);
    gl.uniform2f(U.pulseOrigin, pulseOrigin.x, pulseOrigin.y);
    gl.uniform1f(U.pulseTime, pulseTime);
    gl.uniform1f(U.hoverEnergy, hoverEnergy);
    gl.uniform1f(U.tintBias, tintBias);
    gl.uniform2f(U.offset, offsetCur.x, offsetCur.y);

    gl.drawArrays(gl.POINTS, 0, COUNT);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
    } else if (!rafId) {
      lastTime = performance.now();
      rafId = window.requestAnimationFrame(frame);
    }
  });

  rafId = window.requestAnimationFrame(frame);

  /* API mínima para integração com js/main.js */
  window.PortfolioParticles = {
    setShape: setShape,
    pulse: triggerPulse,
    setHoverEnergy: function (val) { hoverEnergyTarget = Math.max(0, Math.min(1, val)); }
  };
})();
