/* ==========================================================================
   Portfólio · Título em partículas com efeito "fumaça" (WebGL + Física 2D)
   Inspirado no título interativo "Fable 5.2" de fable.sparo.com.br:
   - Rasteriza o <h1> real ("Willian Ribeiro" + "Desenvolvedor Full Stack")
     respeitando exatamente as fontes carregadas, tamanhos, quebras e cores
   - Ao passar o mouse, abre um rastro fluido com turbulência em vórtice
     transformando os grãos nítidos em fumaça luminosa que retorna suavemente
   - Reage à troca de idioma (PT/EN), redimensionamento e clique
   - Pausa fora da viewport / aba oculta e respeita prefers-reduced-motion
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

  /* Margem generosa ao redor do <h1> para a fumaça expandir livremente sem cortar */
  var PAD = 150;
  var SAMPLE_SCALE = 2;

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
    '  /* Ao virar fumaça, tinge sutilmente com o verde-água/índigo da paleta */',
    '  vec3 mistCol = mix(vec3(0.369, 0.918, 0.831), vec3(0.506, 0.549, 0.973), a_seed.x);',
    '  v_col = mix(a_col, mistCol, smoke * 0.62);',
    '  v_smoke = smoke;',
    '',
    '  /* Grãos densos e nítidos nas letras; partículas mais largas e suaves quando fumaça */',
    '  float baseSize = (1.5 + a_seed.y * 1.15) * (1.0 + smoke * 2.15);',
    '  gl_PointSize = clamp(baseSize * u_dpr, 1.4, 11.5 * u_dpr);',
    '',
    '  float grainAlpha = 0.72 + a_seed.y * 0.24;',
    '  v_alpha = mix(grainAlpha, 0.26, smoke * 0.84) * u_fade;',
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
    '  float softness = mix(1.35, 2.75, v_smoke);',
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

  var bufDyn = gl.createBuffer();
  var bufCol = gl.createBuffer();
  var bufSeed = gl.createBuffer();

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
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

  var canvasW = 1;
  var canvasH = 1;
  var dpr = 1;
  var inView = true;
  var mounted = false;
  var fadeIn = 0;

  /* Estado do ponteiro em coordenadas locais do canvas */
  var pointer = {
    x: -9999,
    y: -9999,
    prevX: -9999,
    prevY: -9999,
    vx: 0,
    vy: 0,
    active: false,
    lastMove: 0
  };

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

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvasW = Math.ceil(titleRect.width + PAD * 2);
    canvasH = Math.ceil(titleRect.height + PAD * 2);

    canvas.width = Math.max(1, Math.floor(canvasW * dpr));
    canvas.height = Math.max(1, Math.floor(canvasH * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);

    /* Canvas 2D offscreen exatamente do tamanho do <h1> em alta resolução */
    var offW = Math.max(1, Math.ceil(titleRect.width * SAMPLE_SCALE));
    var offH = Math.max(1, Math.ceil(titleRect.height * SAMPLE_SCALE));
    var off = document.createElement('canvas');
    off.width = offW;
    off.height = offH;
    var ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, offW, offH);
    ctx.textBaseline = 'alphabetic';

    var textNodes = [];
    collectTextNodes(titleEl, textNodes);
    var range = document.createRange();

    /* Desenha cada caractere exatamente na coordenada medida pelo layout do navegador */
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
        grad.addColorStop(0, '#5eead4');
        grad.addColorStop(1, '#818cf8');
        fillStyle = grad;
      } else if (isRole) {
        fillStyle = '#adbcd0';
      } else {
        fillStyle = '#eef3fa';
      }
      ctx.fillStyle = fillStyle;
      ctx.strokeStyle = fillStyle;
      /* Micro-reforço para que o Manrope weight 200 tenha densidade rica em partículas */
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

    var isDesktop = window.innerWidth >= 900;
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

    var step = totalPixels / count;
    for (var i = 0; i < count; i++) {
      var idx = Math.floor((i * step + rand() * Math.max(step, 1)) % totalPixels) * 6;
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
        /* Entrada inicial: nuvem suave que se condensa no nome */
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

    if (!mounted) {
      titleEl.appendChild(canvas);
      titleEl.classList.add('has-particle-title');
      mounted = true;
    }
  }

  /* ---------- Interação de ponteiro e toque (efeito pincel de fumaça) ---------- */
  function updatePointer(clientX, clientY) {
    if (!inView || !mounted) return;
    var r = titleEl.getBoundingClientRect();
    var lx = clientX - r.left + PAD;
    var ly = clientY - r.top + PAD;

    /* Só ativa quando o ponteiro está dentro da área expandida do título */
    var near = lx >= -40 && lx <= canvasW + 40 && ly >= -40 && ly <= canvasH + 40;
    if (!near) {
      pointer.active = false;
      return;
    }

    if (pointer.active) {
      pointer.vx = Math.max(-45, Math.min(45, (lx - pointer.x) * 0.7 + pointer.vx * 0.3));
      pointer.vy = Math.max(-45, Math.min(45, (ly - pointer.y) * 0.7 + pointer.vy * 0.3));
    } else {
      pointer.vx = 0;
      pointer.vy = 0;
    }
    pointer.prevX = pointer.x;
    pointer.prevY = pointer.y;
    pointer.x = lx;
    pointer.y = ly;
    pointer.active = true;
    pointer.lastMove = performance.now();
  }

  function triggerBurst(clientX, clientY) {
    if (!inView || !mounted || count === 0) return;
    var r = titleEl.getBoundingClientRect();
    if (clientX < r.left - 30 || clientX > r.right + 30 || clientY < r.top - 30 || clientY > r.bottom + 30) return;

    var bx = clientX - r.left + PAD;
    var by = clientY - r.top + PAD;
    var radius = window.innerWidth >= 900 ? 150 : 105;
    var r2 = radius * radius;

    for (var i = 0; i < count; i++) {
      var dx = px[i] - bx;
      var dy = py[i] - by;
      var d2 = dx * dx + dy * dy;
      if (d2 < r2) {
        var d = Math.sqrt(d2) || 0.5;
        var f = (1 - d / radius);
        var power = (16 + seedData[i * 2 + 1] * 9) * f * f;
        var nx = dx / d;
        var ny = dy / d;
        var swirl = (seedData[i * 2] > 0.5 ? 1 : -1) * 5.5 * f;
        vx[i] += nx * power - ny * swirl;
        vy[i] += ny * power + nx * swirl;
      }
    }
  }

  window.addEventListener('pointermove', function (e) {
    updatePointer(e.clientX, e.clientY);
  }, { passive: true });

  document.addEventListener('pointerleave', function () {
    pointer.active = false;
  });

  titleEl.addEventListener('pointerdown', function (e) {
    triggerBurst(e.clientX, e.clientY);
  }, { passive: true });

  /* ---------- Observador de visibilidade (pausa quando fora do Hero) ---------- */
  if ('IntersectionObserver' in window) {
    var visObs = new IntersectionObserver(function (entries) {
      inView = entries[0].isIntersecting;
      if (!inView) pointer.active = false;
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

    var dt60 = dt * 60;
    var drag = Math.pow(0.885, dt60);

    // Suaviza velocidade do ponteiro quando parado
    var idleMs = now - pointer.lastMove;
    if (idleMs > 60) {
      pointer.vx *= 0.82;
      pointer.vy *= 0.82;
    }

    var pActive = pointer.active;
    var mx = pointer.x;
    var my = pointer.y;
    var mvx = pointer.vx;
    var mvy = pointer.vy;
    var speed = Math.sqrt(mvx * mvx + mvy * mvy);
    var baseR = window.innerWidth >= 900 ? 78 : 54;
    var brushR = baseR + Math.min(speed * 0.55, 32);
    var brushR2 = brushR * brushR;

    var sinT = Math.sin(elapsed * 1.4);
    var cosT = Math.cos(elapsed * 1.1);

    for (var i = 0; i < count; i++) {
      var x = px[i];
      var y = py[i];
      var vxi = vx[i];
      var vyi = vy[i];
      var phase = seedData[i * 2];

      /* 1. Escavação + vórtice de fumaça ao redor do ponteiro */
      if (pActive) {
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

          /* Empurrão radial cria a borda luminosa em crescente igual ao Fable */
          var radial = (9.5 + speed * 0.34) * t2 * dt60;
          /* Rotação tangencial + arrasto do movimento dão aspecto de fumaça */
          var spin = (phase > 0.5 ? 1 : -1) * (3.6 + speed * 0.14) * t * dt60;

          vxi += nx * radial - ny * spin + mvx * 0.24 * t * dt60;
          vyi += ny * radial + nx * spin + mvy * 0.24 * t * dt60;
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

        /* Turbulência orgânica + leve flutuação ascendente quando em estado de fumaça */
        if (smoke > 0.04) {
          var curlAngle = (x * 0.024 + sinT) - (y * 0.024 + cosT) + phase * 6.283;
          var turb = (0.42 + phase * 0.38) * smoke * dt60;
          vxi += Math.cos(curlAngle) * turb;
          vyi += Math.sin(curlAngle) * turb - 0.085 * smoke * dt60;
        }

        /* Mola mais solta longe de casa (fumaça demora e ondula) e firme perto (nitidez) */
        var spring = (0.022 + 0.028 / (1 + dist * 0.032)) * dt60;
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

  /* Redimensionamento com debounce para manter alinhamento exato */
  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      if (mounted) buildParticles(false);
    }, 180);
  }, { passive: true });

  /* Inicializa somente após as fontes web (Manrope e Libre Baskerville) estarem prontas */
  function init() {
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

  /* API para o main.js acionar morfismo suave quando o idioma mudar (PT <-> EN) */
  window.PortfolioTitleSmoke = {
    rebuild: function () {
      if (mounted) {
        // Aguarda o próximo frame para o layout do novo idioma já estar calculado
        window.requestAnimationFrame(function () {
          buildParticles(true);
        });
      }
    }
  };
})();
