/* ==========================================================================
   Portfólio · Título em partículas com efeito "fumaça" (WebGL + Física 2D)
   Inspirado no título interativo "Fable 5.2" de fable.sparo.com.br:
   - Rasteriza o <h1> real ("Willian Ribeiro" + "Desenvolvedor Full Stack")
     respeitando exatamente as fontes carregadas, tamanhos, quebras e cores
   - Desktop (mouse): rastro de fumaça na ponta da seta; ao ficar parado o
     ponteiro fecha e uma onda autônoma continua "rodando" suavemente pelo nome
   - Canto superior esquerdo (desktop): explosão nebulosa luminosa que depois
     se reconstrói suavemente nas letras
   - Celular (Opção B): onda autônoma contínua + rajada orgânica no toque
     rápido (sem conflito com rolagem e sem travar círculo aberto)
   - Reage à troca de idioma (PT/EN), largura da tela e prefers-reduced-motion
   ========================================================================== */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var titleEl = document.querySelector('.hero__title');
  if (!titleEl || reduceMotion) return;

  var canvas = document.createElement('canvas');
  canvas.className = 'hero__title-canvas';
  canvas.setAttribute('aria-hidden', 'true');

  var gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    depth: false,
    premultipliedAlpha: false,
    powerPreference: 'high-performance'
  }) || canvas.getContext('experimental-webgl', { alpha: true, depth: false });

  if (!gl) return;

  var SAMPLE_SCALE = 2;
  var PAD = window.innerWidth >= 900 ? 190 : 120;

  /* ---------- Shaders WebGL ---------- */
  var VERT_SRC = [
    'precision highp float;',
    'attribute vec3 a_dyn;',   // x, y (em CSS px no canvas), smoke (0..1)
    'attribute vec3 a_col;',   // rgb da letra original
    'attribute vec2 a_seed;',  // x: fase aleatória, y: peso de tamanho
    '',
    'uniform vec2 u_res;',
    'uniform float u_dpr;',
    'uniform float u_time;',
    'uniform float u_fade;',
    'uniform float u_flash;',  // brilho nebuloso durante explosão
    '',
    'varying vec3 v_col;',
    'varying float v_alpha;',
    'varying float v_smoke;',
    '',
    'void main() {',
    '  float smoke = a_dyn.z;',
    '  /* Micro-respiração viva muito sutil quando em repouso */',
    '  float jitter = (1.0 - smoke) * 0.22;',
    '  vec2 pos = a_dyn.xy + vec2(',
    '    sin(u_time * 1.9 + a_seed.x * 40.0),',
    '    cos(u_time * 1.6 + a_seed.x * 33.0)',
    '  ) * jitter;',
    '',
    '  vec2 clip = (pos / u_res) * 2.0 - 1.0;',
    '  clip.y = -clip.y;',
    '  gl_Position = vec4(clip, 0.0, 1.0);',
    '',
    '  /* Preserva 100% das cores originais em repouso (#e9eef6, #9aa8bc, gradiente #5eead4 -> #818cf8) */',
    '  /* Quando vira fumaça, adiciona leve véu da paleta nas letras neutras sem lavar o gradiente */',
    '  float sat = max(a_col.r, max(a_col.g, a_col.b)) - min(a_col.r, min(a_col.g, a_col.b));',
    '  float isNeutral = 1.0 - smoothstep(0.08, 0.25, sat);',
    '  vec3 mistCol = mix(vec3(0.369, 0.918, 0.831), vec3(0.506, 0.549, 0.973), a_seed.x);',
    '  vec3 col = mix(a_col, mistCol, smoke * 0.42 * isNeutral);',
    '  /* Realce luminoso sutil na crista da fumaça e durante a explosão sem estourar para branco */',
    '  vec3 glowLift = mix(col, min(col * 1.28 + mistCol * 0.14, vec3(1.0)), smoke * 0.45);',
    '  vec3 flashCol = mix(glowLift, mix(glowLift, mistCol * 1.18 + vec3(0.18), 0.55), u_flash * smoke);',
    '  v_col = clamp(flashCol, 0.0, 1.0);',
    '  v_smoke = smoke;',
    '',
    '  /* Grãos densos e luminosos nas letras (equiparando brilho ao texto sólido); suaves quando fumaça */',
    '  float baseSize = (1.7 + a_seed.y * 1.15) * (1.0 + smoke * (2.0 + u_flash * 0.95));',
    '  gl_PointSize = clamp(baseSize * u_dpr, 1.5, 12.5 * u_dpr);',
    '',
    '  float grainAlpha = 0.88 + a_seed.y * 0.12;',
    '  float smokeAlpha = 0.36 + u_flash * 0.24;',
    '  v_alpha = mix(grainAlpha, smokeAlpha, smoke * 0.82) * u_fade;',
    '}'
  ].join('\n');

  var FRAG_SRC = [
    'precision mediump float;',
    'varying vec3 v_col;',
    'varying float v_alpha;',
    'varying float v_smoke;',
    '',
    'void main() {',
    '  vec2 c = gl_PointCoord - 0.5;',
    '  float d = length(c);',
    '  if (d > 0.5) discard;',
    '  float core = smoothstep(0.5, 0.0, d);',
    '  float softness = mix(0.85, 2.65, v_smoke);',
    '  float a = pow(core, softness) * v_alpha;',
    '  gl_FragColor = vec4(v_col, a);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  var vs = compile(gl.VERTEX_SHADER, VERT_SRC);
  var fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) return;

  var program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
  gl.useProgram(program);

  var locDyn = gl.getAttribLocation(program, 'a_dyn');
  var locCol = gl.getAttribLocation(program, 'a_col');
  var locSeed = gl.getAttribLocation(program, 'a_seed');

  var uRes = gl.getUniformLocation(program, 'u_res');
  var uDpr = gl.getUniformLocation(program, 'u_dpr');
  var uTime = gl.getUniformLocation(program, 'u_time');
  var uFade = gl.getUniformLocation(program, 'u_fade');
  var uFlash = gl.getUniformLocation(program, 'u_flash');

  var bufDyn = gl.createBuffer();
  var bufCol = gl.createBuffer();
  var bufSeed = gl.createBuffer();

  gl.enable(gl.BLEND);
  /* Alpha blending padrão preserva o gradiente #5eead4 -> #818cf8 e o #9aa8bc sem lavar para branco */
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  /* ---------- PRNG rápido ---------- */
  var rng = 987654321;
  function rand() {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return rng / 4294967296;
  }

  /* ---------- Estado da simulação ---------- */
  var count = 0;
  var hx = null, hy = null;
  var px = null, py = null;
  var vx = null, vy = null;
  var dynData = null;
  var colData = null;
  var seedData = null;

  var textW = 1;
  var textH = 1;
  var canvasW = 1;
  var canvasH = 1;
  var dpr = 1;
  var inView = true;
  var mounted = false;
  var fadeIn = 0;
  var lastWidth = window.innerWidth;

  /* Estado do ponteiro (apenas mouse/caneta — touch usa Opção B) */
  var pointer = {
    x: -9999,
    y: -9999,
    vx: 0,
    vy: 0,
    active: false,
    strength: 0,
    lastMove: 0
  };

  /* Estado do pincel autônomo ("rodando" em ciclos espaçados quando ocioso) */
  var autoOrb = {
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    strength: 0,
    idleTime: 0,
    initialized: false
  };

  /* Estado da explosão nebulosa (canto superior esquerdo) */
  var explosionFlash = 0;
  var explosionHold = 0;
  var inTopLeftZone = false;
  var lastExplosionAt = 0;

  /* Estado de toque rápido no celular (Opção B — ignora arrastes/rolagem) */
  var touchTap = null;

  /* ---------- Amostragem pixel-a-pixel do texto real do <h1> ---------- */
  function collectTextNodes(root, out) {
    var child = root.firstChild;
    while (child) {
      if (child.nodeType === 3) {
        if (child.nodeValue && /\S/.test(child.nodeValue)) out.push(child);
      } else if (child.nodeType === 1 && child !== canvas && !child.classList.contains('visually-hidden')) {
        collectTextNodes(child, out);
      }
      child = child.nextSibling;
    }
  }

  function buildParticles(isMorph) {
    var titleRect = titleEl.getBoundingClientRect();
    if (titleRect.width < 10 || titleRect.height < 10) return;

    var isDesktop = window.innerWidth >= 900;
    PAD = isDesktop ? 190 : 120;
    canvas.style.setProperty('--pad', PAD + 'px');

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    textW = titleRect.width;
    textH = titleRect.height;
    canvasW = Math.ceil(textW + PAD * 2);
    canvasH = Math.ceil(textH + PAD * 2);

    canvas.width = Math.max(1, Math.floor(canvasW * dpr));
    canvas.height = Math.max(1, Math.floor(canvasH * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);

    var offW = Math.max(1, Math.ceil(textW * SAMPLE_SCALE));
    var offH = Math.max(1, Math.ceil(textH * SAMPLE_SCALE));
    var off = document.createElement('canvas');
    off.width = offW;
    off.height = offH;
    var ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, offW, offH);
    ctx.textBaseline = 'alphabetic';

    var textNodes = [];
    collectTextNodes(titleEl, textNodes);
    var range = document.createRange();

    for (var n = 0; n < textNodes.length; n++) {
      var node = textNodes[n];
      var parentEl = node.parentElement;
      if (!parentEl) continue;

      var cs = getComputedStyle(parentEl);
      var fontSize = parseFloat(cs.fontSize) || 16;
      var scaledSize = fontSize * SAMPLE_SCALE;
      var isAccent = parentEl.classList.contains('accent');
      var isRole = !isAccent && !!parentEl.closest('.hero__role');

      ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + scaledSize + 'px ' + cs.fontFamily;

      var fillStyle;
      if (isAccent) {
        var ar = parentEl.getBoundingClientRect();
        var gx0 = (ar.left - titleRect.left) * SAMPLE_SCALE;
        var gx1 = (ar.right - titleRect.left) * SAMPLE_SCALE;
        var gy0 = (ar.top - titleRect.top) * SAMPLE_SCALE;
        var gy1 = (ar.bottom - titleRect.top) * SAMPLE_SCALE;
        var grad = ctx.createLinearGradient(gx0, gy0, gx1, gy0 + (gy1 - gy0) * 0.18);
        grad.addColorStop(0, '#6bf3de');
        grad.addColorStop(0.5, '#78cef2');
        grad.addColorStop(1, '#8f9bff');
        fillStyle = grad;
      } else if (isRole) {
        fillStyle = '#a8b6ca';
      } else {
        fillStyle = '#f3f7fd';
      }
      ctx.fillStyle = fillStyle;
      ctx.strokeStyle = fillStyle;
      ctx.lineWidth = (isAccent ? 0.35 : 0.65) * SAMPLE_SCALE;
      ctx.lineJoin = 'round';

      var str = node.nodeValue;
      for (var c = 0; c < str.length; c++) {
        var ch = str[c];
        if (/\s/.test(ch)) continue;
        range.setStart(node, c);
        range.setEnd(node, c + 1);
        var r = range.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;

        var m = ctx.measureText(ch);
        var ascent = (m.fontBoundingBoxAscent != null) ? m.fontBoundingBoxAscent : scaledSize * 0.78;
        var descent = (m.fontBoundingBoxDescent != null) ? m.fontBoundingBoxDescent : scaledSize * 0.22;
        var boxH = r.height * SAMPLE_SCALE;
        var baseY = (r.top - titleRect.top) * SAMPLE_SCALE + (boxH - (ascent + descent)) * 0.5 + ascent;
        var drawX = (r.left - titleRect.left) * SAMPLE_SCALE;

        ctx.strokeText(ch, drawX, baseY);
        ctx.fillText(ch, drawX, baseY);
      }
    }

    var img = ctx.getImageData(0, 0, offW, offH).data;
    var candidates = [];

    for (var y = 0; y < offH; y++) {
      var rowOff = y * offW * 4;
      for (var x = 0; x < offW; x++) {
        var a = img[rowOff + x * 4 + 3];
        if (a > 42) {
          candidates.push(x, y, img[rowOff + x * 4], img[rowOff + x * 4 + 1], img[rowOff + x * 4 + 2], a);
        }
      }
    }

    var totalPixels = candidates.length / 6;
    if (totalPixels < 20) return;

    var targetCount = isDesktop ? 34000 : 14000;
    var newCount = Math.min(targetCount, Math.max(totalPixels, Math.floor(targetCount * 0.88)));

    var prevPx = px, prevPy = py, prevVx = vx, prevVy = vy, prevCount = count;

    count = newCount;
    hx = new Float32Array(count);
    hy = new Float32Array(count);
    px = new Float32Array(count);
    py = new Float32Array(count);
    vx = new Float32Array(count);
    vy = new Float32Array(count);
    dynData = new Float32Array(count * 3);
    colData = new Float32Array(count * 3);
    seedData = new Float32Array(count * 2);

    var stepRatio = totalPixels / count;
    for (var i = 0; i < count; i++) {
      var idx = Math.floor((i * stepRatio + rand() * Math.max(stepRatio, 1)) % totalPixels) * 6;
      var gx = candidates[idx] / SAMPLE_SCALE + (rand() - 0.5) * 0.75 + PAD;
      var gy = candidates[idx + 1] / SAMPLE_SCALE + (rand() - 0.5) * 0.75 + PAD;

      hx[i] = gx;
      hy[i] = gy;

      if (isMorph && prevPx && prevCount > 0) {
        var oldI = i % prevCount;
        px[i] = prevPx[oldI];
        py[i] = prevPy[oldI];
        vx[i] = (prevVx[oldI] || 0) + (rand() - 0.5) * 2.5;
        vy[i] = (prevVy[oldI] || 0) + (rand() - 0.5) * 2.5;
      } else if (!mounted) {
        var ang = rand() * Math.PI * 2;
        var spread = 16 + rand() * 58;
        px[i] = gx + Math.cos(ang) * spread;
        py[i] = gy + Math.sin(ang) * spread * 0.65;
        vx[i] = 0;
        vy[i] = 0;
      } else {
        px[i] = gx;
        py[i] = gy;
        vx[i] = 0;
        vy[i] = 0;
      }

      colData[i * 3] = candidates[idx + 2] / 255;
      colData[i * 3 + 1] = candidates[idx + 3] / 255;
      colData[i * 3 + 2] = candidates[idx + 4] / 255;

      seedData[i * 2] = rand();
      seedData[i * 2 + 1] = 0.45 + rand() * 0.95;

      dynData[i * 3] = px[i];
      dynData[i * 3 + 1] = py[i];
      dynData[i * 3 + 2] = 0;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, bufDyn);
    gl.bufferData(gl.ARRAY_BUFFER, dynData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(locDyn);
    gl.vertexAttribPointer(locDyn, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, bufCol);
    gl.bufferData(gl.ARRAY_BUFFER, colData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(locCol);
    gl.vertexAttribPointer(locCol, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, bufSeed);
    gl.bufferData(gl.ARRAY_BUFFER, seedData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(locSeed);
    gl.vertexAttribPointer(locSeed, 2, gl.FLOAT, false, 0, 0);

    autoOrb.initialized = false;

    if (!mounted) {
      titleEl.appendChild(canvas);
      titleEl.classList.add('has-particle-title');
      mounted = true;
    }
  }

  /* ---------- Explosão nebulosa (canto superior esquerdo no desktop) ---------- */
  function triggerExplosion() {
    if (!inView || !mounted || count === 0) return;
    var now = performance.now();
    if (now - lastExplosionAt < 1800) return;
    lastExplosionAt = now;

    var cx = PAD + textW * 0.5;
    var cy = PAD + textH * 0.5;
    var maxSpan = Math.max(textW * 0.55, 180);

    for (var i = 0; i < count; i++) {
      var ph = seedData[i * 2];
      var sz = seedData[i * 2 + 1];
      var dx = px[i] - cx;
      var dy = py[i] - cy;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = dx / d;
      var ny = dy / d;

      /* Dispersão elíptica ampla em nuvem luminosa (evita borda circular dura) */
      var ang = ph * 6.2831853 + Math.atan2(ny, nx) * 0.45;
      var amp = (7.5 + sz * 15.5) * (0.65 + (d / maxSpan) * 0.55);
      vx[i] += Math.cos(ang) * amp * 1.25 + nx * 6.5;
      vy[i] += Math.sin(ang) * amp * 0.85 + ny * 4.5;
    }

    explosionFlash = 1.0;
    explosionHold = 1.0;
  }

  /* ---------- Rajada orgânica de fumaça (clique no PC / toque rápido no celular) ---------- */
  function triggerBurst(clientX, clientY, isTouch) {
    if (!inView || !mounted || count === 0) return;
    var r = titleEl.getBoundingClientRect();
    if (clientX < r.left - 30 || clientX > r.right + 30 || clientY < r.top - 30 || clientY > r.bottom + 30) return;

    var bx = clientX - r.left + PAD;
    var by = clientY - r.top + PAD;
    var radius = isTouch ? 120 : (window.innerWidth >= 900 ? 150 : 115);
    var r2 = radius * radius;

    for (var i = 0; i < count; i++) {
      var dx = px[i] - bx;
      var dy = py[i] - by;
      var d2 = dx * dx + dy * dy;
      if (d2 < r2) {
        var d = Math.sqrt(d2) || 0.5;
        var f = 1 - d / radius;
        var ph = seedData[i * 2];
        var sz = seedData[i * 2 + 1];
        var nx = dx / d;
        var ny = dy / d;

        /* Modulação angular orgânica para parecer fumaça real e nunca um círculo rígido */
        var angle = Math.atan2(ny, nx);
        var organic = 0.55 + 0.45 * Math.sin(angle * 3.0 + ph * 6.283);
        var power = (isTouch ? 11.5 : 14.5 + sz * 8.5) * f * f * organic;
        var swirl = (ph > 0.5 ? 1 : -1) * (isTouch ? 7.2 : 6.0) * f;

        vx[i] += nx * power - ny * swirl;
        vy[i] += ny * power + nx * swirl - (isTouch ? 1.8 * f : 0.8 * f);
      }
    }
  }

  /* ---------- Interação de mouse (PC) e toque rápido (Opção B no celular) ---------- */
  function updateMousePointer(clientX, clientY) {
    if (!inView || !mounted) return;

    /* Gatilho no canto superior esquerdo da tela (explosão + reconstrução) */
    var inCorner = clientX <= 150 && clientY <= 95;
    if (inCorner && !inTopLeftZone) {
      inTopLeftZone = true;
      triggerExplosion();
    } else if (!inCorner && (clientX > 185 || clientY > 125)) {
      inTopLeftZone = false;
    }

    var r = titleEl.getBoundingClientRect();
    var lx = clientX - r.left + PAD;
    var ly = clientY - r.top + PAD;

    var near = lx >= -40 && lx <= canvasW + 40 && ly >= -40 && ly <= canvasH + 40;
    if (!near) {
      pointer.active = false;
      return;
    }

    var moved = !pointer.active || Math.hypot(lx - pointer.x, ly - pointer.y) > 0.6;
    if (pointer.active) {
      pointer.vx = Math.max(-45, Math.min(45, (lx - pointer.x) * 0.7 + pointer.vx * 0.3));
      pointer.vy = Math.max(-45, Math.min(45, (ly - pointer.y) * 0.7 + pointer.vy * 0.3));
    } else {
      pointer.vx = 0;
      pointer.vy = 0;
    }
    pointer.x = lx;
    pointer.y = ly;
    pointer.active = true;
    if (moved) pointer.lastMove = performance.now();
  }

  /* Mouse / caneta: rastro contínuo intacto no PC; touch é ignorado no pointermove (Opção B) */
  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') {
      if (touchTap && (Math.abs(e.clientX - touchTap.x) > 12 || Math.abs(e.clientY - touchTap.y) > 12)) {
        touchTap = null; // usuário está rolando a tela: cancela tap
      }
      return;
    }
    updateMousePointer(e.clientX, e.clientY);
  }, { passive: true });

  document.addEventListener('pointerleave', function () {
    pointer.active = false;
  });

  titleEl.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'touch') {
      touchTap = { x: e.clientX, y: e.clientY, time: performance.now() };
      return;
    }
    triggerBurst(e.clientX, e.clientY, false);
  }, { passive: true });

  window.addEventListener('pointerup', function (e) {
    if (e.pointerType === 'touch' && touchTap) {
      var dtTap = performance.now() - touchTap.time;
      var distTap = Math.hypot(e.clientX - touchTap.x, e.clientY - touchTap.y);
      if (dtTap < 360 && distTap <= 12) {
        triggerBurst(e.clientX, e.clientY, true);
      }
      touchTap = null;
    }
  }, { passive: true });

  window.addEventListener('pointercancel', function () {
    touchTap = null;
    pointer.active = false;
  }, { passive: true });

  window.addEventListener('scroll', function () {
    touchTap = null;
  }, { passive: true });

  /* ---------- Observador de visibilidade (pausa quando fora do Hero) ---------- */
  if ('IntersectionObserver' in window) {
    var visObs = new IntersectionObserver(function (entries) {
      inView = entries[0].isIntersecting;
      if (!inView) {
        pointer.active = false;
        pointer.strength = 0;
      }
    }, { rootMargin: '120px 0px 120px 0px' });
    visObs.observe(titleEl);
  }

  /* ---------- Loop de física + renderização WebGL ---------- */
  var rafId = 0;
  var lastNow = performance.now();
  var elapsed = 0;

  function step(now) {
    rafId = window.requestAnimationFrame(step);
    var dt = Math.min((now - lastNow) * 0.001, 0.05);
    lastNow = now;

    if (!mounted || !inView || count === 0) return;

    elapsed += dt;
    if (fadeIn < 1) fadeIn = Math.min(1, fadeIn + dt * 2.2);

    if (explosionFlash > 0) explosionFlash = Math.max(0, explosionFlash - dt * 0.85);
    if (explosionHold > 0) explosionHold = Math.max(0, explosionHold - dt * 1.05);

    var dt60 = dt * 60;
    var drag = Math.pow(0.885, dt60);
    var isDesktop = window.innerWidth >= 900;

    /* Decaimento do ponteiro real quando o mouse fica parado (fecha o buraco sob a seta) */
    var idleMs = now - pointer.lastMove;
    if (idleMs > 60) {
      pointer.vx *= 0.82;
      pointer.vy *= 0.82;
    }
    var pointerShouldPull = pointer.active && idleMs < 1150;
    var targetPtrStrength = pointerShouldPull ? 1 : 0;
    pointer.strength += (targetPtrStrength - pointer.strength) * (1 - Math.exp(-dt * (pointerShouldPull ? 14 : 4.2)));

    /* Pincel autônomo ("efeito rodando") com ciclos espaçados:
       ~2,4s de espera inicial, ~4,2s de passagem suave pelas letras e ~5,4s de pausa entre passagens */
    var autoAllowed = elapsed > 1.35 && pointer.strength < 0.25 && explosionHold < 0.15;
    var autoEnvelope = 0;
    if (autoAllowed) {
      autoOrb.idleTime += dt;
      var cycleDur = 9.6;   // duração total do ciclo (4,2s ativo + 5,4s descanso)
      var activeDur = 4.2;  // duração de cada passagem pelo nome
      var initialWait = 2.4;
      if (autoOrb.idleTime > initialWait) {
        var phaseTime = (autoOrb.idleTime - initialWait) % cycleDur;
        if (phaseTime < activeDur) {
          var pNorm = phaseTime / activeDur;
          /* Envelope suave (entra e sai sem cortes bruscos) */
          autoEnvelope = Math.sin(pNorm * Math.PI);
        }
      }
    } else {
      autoOrb.idleTime = 0;
    }
    autoOrb.strength += (autoEnvelope - autoOrb.strength) * (1 - Math.exp(-dt * (autoEnvelope > 0 ? 4.5 : 7.5)));

    /* Trajetória orgânica em figura-8 / órbita atravessando o nome e o cargo */
    var orbT = elapsed * 0.48;
    var targetAx = PAD + textW * (0.5 + 0.45 * Math.sin(orbT));
    var targetAy = PAD + textH * (0.5 + 0.35 * Math.sin(orbT * 2.0 + 0.75));
    if (!autoOrb.initialized) {
      autoOrb.x = targetAx;
      autoOrb.y = targetAy;
      autoOrb.prevX = targetAx;
      autoOrb.prevY = targetAy;
      autoOrb.initialized = true;
    } else {
      autoOrb.prevX = autoOrb.x;
      autoOrb.prevY = autoOrb.y;
      autoOrb.x = targetAx;
      autoOrb.y = targetAy;
    }
    var avx = (autoOrb.x - autoOrb.prevX) / Math.max(dt60, 0.2);
    var avy = (autoOrb.y - autoOrb.prevY) / Math.max(dt60, 0.2);

    var useMouse = pointer.strength > 0.02;
    var pStr = pointer.strength;
    var mx = pointer.x;
    var my = pointer.y;
    var mvx = pointer.vx;
    var mvy = pointer.vy;
    var speed = Math.sqrt(mvx * mvx + mvy * mvy);
    var brushR = (isDesktop ? 78 : 54) + Math.min(speed * 0.55, 32);
    var brushR2 = brushR * brushR;

    var useAuto = autoOrb.strength > 0.02;
    var aStr = autoOrb.strength;
    var ax = autoOrb.x;
    var ay = autoOrb.y;
    var autoR = isDesktop ? 64 : 44;
    var autoR2 = autoR * autoR;

    var sinT = Math.sin(elapsed * 1.4);
    var cosT = Math.cos(elapsed * 1.1);
    /* Durante a explosão, reduz a mola momentaneamente para a nuvem expandir antes de reconstruir */
    var springScale = 1 - explosionHold * 0.78;

    for (var i = 0; i < count; i++) {
      var x = px[i];
      var y = py[i];
      var vxi = vx[i];
      var vyi = vy[i];
      var phase = seedData[i * 2];

      /* 1A. Rastro de fumaça na ponta do mouse (PC) */
      if (useMouse) {
        var dx = x - mx;
        var dy = y - my;
        var d2 = dx * dx + dy * dy;
        if (d2 < brushR2) {
          var d = Math.sqrt(d2) || 0.5;
          var t = 1 - d / brushR;
          var t2 = t * t;
          var invD = 1 / d;
          var nx = dx * invD;
          var ny = dy * invD;

          var radial = (9.5 + speed * 0.34) * t2 * pStr * dt60;
          var spin = (phase > 0.5 ? 1 : -1) * (3.6 + speed * 0.14) * t * pStr * dt60;

          vxi += nx * radial - ny * spin + mvx * 0.24 * t * pStr * dt60;
          vyi += ny * radial + nx * spin + mvy * 0.24 * t * pStr * dt60;
        }
      }

      /* 1B. Onda de fumaça autônoma ("rodando" pelo nome quando o mouse para ou no mobile) */
      if (useAuto) {
        var adx = x - ax;
        var ady = y - ay;
        var ad2 = adx * adx + ady * ady;
        if (ad2 < autoR2) {
          var ad = Math.sqrt(ad2) || 0.5;
          var at = 1 - ad / autoR;
          var at2 = at * at;
          var aInv = 1 / ad;
          var anx = adx * aInv;
          var any = ady * aInv;

          var aRadial = (isDesktop ? 6.4 : 5.2) * at2 * aStr * dt60;
          var aSpin = 2.8 * at * aStr * dt60;

          vxi += anx * aRadial - any * aSpin + avx * 0.35 * at * aStr * dt60;
          vyi += any * aRadial + anx * aSpin + avy * 0.35 * at * aStr * dt60;
        }
      }

      /* 2. Retorno elástico suave + turbulência de fumaça enquanto deslocado */
      var odx = hx[i] - x;
      var ody = hy[i] - y;
      var dist2 = odx * odx + ody * ody;
      var smoke = 0;

      if (dist2 > 0.09 || vxi * vxi + vyi * vyi > 0.04) {
        var dist = Math.sqrt(dist2);
        smoke = dist > 56 ? 1 : dist / 56;

        if (smoke > 0.04) {
          var curlAngle = (x * 0.024 + sinT) - (y * 0.024 + cosT) + phase * 6.283;
          var turb = (0.42 + phase * 0.38) * smoke * dt60;
          vxi += Math.cos(curlAngle) * turb;
          vyi += Math.sin(curlAngle) * turb - 0.085 * smoke * dt60;
        }

        var spring = (0.022 + 0.028 / (1 + dist * 0.032)) * springScale * dt60;
        vxi = (vxi + odx * spring) * drag;
        vyi = (vyi + ody * spring) * drag;

        x += vxi * dt60;
        y += vyi * dt60;
      } else {
        x = hx[i];
        y = hy[i];
        vxi = 0;
        vyi = 0;
      }

      px[i] = x;
      py[i] = y;
      vx[i] = vxi;
      vy[i] = vyi;

      var d3 = i * 3;
      dynData[d3] = x;
      dynData[d3 + 1] = y;
      dynData[d3 + 2] = smoke;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, bufDyn);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, dynData);

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(uRes, canvasW, canvasH);
    gl.uniform1f(uDpr, dpr);
    gl.uniform1f(uTime, elapsed);
    gl.uniform1f(uFade, fadeIn);
    gl.uniform1f(uFlash, explosionFlash);
    gl.drawArrays(gl.POINTS, 0, count);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
    } else if (!rafId) {
      lastNow = performance.now();
      rafId = window.requestAnimationFrame(step);
    }
  });

  /* Redimensionamento inteligente: só reconstrói se a largura mudou (ignora barra mobile) */
  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    if (Math.abs(window.innerWidth - lastWidth) <= 2) return;
    lastWidth = window.innerWidth;
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      if (mounted) buildParticles(false);
    }, 180);
  }, { passive: true });

  function init() {
    lastWidth = window.innerWidth;
    buildParticles(false);
    if (mounted && !rafId) {
      lastNow = performance.now();
      rafId = window.requestAnimationFrame(step);
    }
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(init);
  } else {
    window.addEventListener('load', init);
  }

  window.PortfolioTitleSmoke = {
    rebuild: function () {
      if (mounted) {
        window.requestAnimationFrame(function () {
          buildParticles(true);
        });
      }
    }
  };
})();
