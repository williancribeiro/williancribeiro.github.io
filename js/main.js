/* ==========================================================================
   Portfólio · interações (JavaScript puro, sem dependências)
   1. Barra de progresso, header, parallax do hero e progresso das timelines
   2. Revelação ao rolar com IntersectionObserver (com stagger + entrada do hero)
   3. Idioma (PT/EN)
   4. Menu mobile
   5. Seção ativa: navegação + régua lateral + morfismo WebGL 3D
   6. Aura do cursor, spotlight dos cards/blocos, tilt 3D e botões magnéticos
   7. Vídeos dos projetos (tocam só quando visíveis)
   8. Ano atual no rodapé
   ========================================================================== */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canHover = window.matchMedia('(hover: hover)').matches;

  /* PERSONALIZE: intervalo (ms) entre os itens de um grupo [data-stagger] */
  var STAGGER_MS = 95;

  /* ---------- 1. Progresso de leitura, header, parallax e timelines ---------- */
  var bar = document.getElementById('progress-bar');
  var header = document.getElementById('header');
  var heroScroll = document.getElementById('hero-scroll');
  var heroGlow = document.querySelector('.hero__glow');
  var heroPhoto = document.querySelector('.hero__photo');
  var timelines = Array.prototype.slice.call(document.querySelectorAll('.tl'));
  var ticking = false;

  function updateTimelines() {
    var vh = window.innerHeight || 1;
    var anchor = vh * 0.65;
    timelines.forEach(function (tl) {
      var r = tl.getBoundingClientRect();
      var total = Math.max(r.height, 1);
      var progress = Math.max(0, Math.min(1, (anchor - r.top) / total));
      tl.style.setProperty('--tl-progress', progress.toFixed(4));
    });
  }

  function onScroll() {
    var doc = document.documentElement;
    var y = window.scrollY;
    var max = doc.scrollHeight - window.innerHeight;
    var ratio = max > 0 ? Math.min(y / max, 1) : 0;

    bar.style.transform = 'scaleX(' + ratio + ')';
    header.classList.toggle('is-scrolled', y > 24);
    if (heroScroll) heroScroll.classList.toggle('is-hidden', y > 120);

    if (!reduceMotion) {
      if (y < window.innerHeight * 1.2) {
        if (heroGlow) heroGlow.style.setProperty('--hero-parallax', (y * 0.16).toFixed(1) + 'px');
        if (heroPhoto) heroPhoto.style.setProperty('--photo-parallax', (y * 0.06).toFixed(1) + 'px');
      }
      updateTimelines();
    } else {
      timelines.forEach(function (tl) { tl.style.setProperty('--tl-progress', '1'); });
    }

    ticking = false;
  }

  function requestTick() {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(onScroll);
    }
  }

  window.addEventListener('scroll', requestTick, { passive: true });
  window.addEventListener('resize', requestTick, { passive: true });
  onScroll();

  /* ---------- 2. Revelação ao rolar ---------- */
  var revealEls = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

  // Coreografia de entrada escalonada do Hero
  var heroReveals = document.querySelectorAll('.hero .reveal');
  heroReveals.forEach(function (el, i) {
    if (!el.style.getPropertyValue('--d')) {
      var delay = el.classList.contains('hero__photo') ? 180 : i * 85;
      el.style.setProperty('--d', delay + 'ms');
    }
  });

  // Atraso em sequência para os filhos de cada grupo [data-stagger]
  document.querySelectorAll('[data-stagger]').forEach(function (group) {
    group.querySelectorAll('.reveal').forEach(function (el, i) {
      el.style.setProperty('--d', i * STAGGER_MS + 'ms');
    });
  });

  function show(el) {
    el.classList.add('is-visible');
    // Remove o atraso depois da entrada, para o hover e o tilt responderem na hora
    var delay = parseFloat(getComputedStyle(el).getPropertyValue('--d')) || 0;
    window.setTimeout(function () { el.classList.add('is-done'); }, delay + 850);
  }

  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach(function (el) { el.classList.add('is-visible', 'is-done'); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          show(entry.target);
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    revealEls.forEach(function (el) { revealObserver.observe(el); });
  }

  /* ---------- 3. Idioma (PT/EN) ---------- */
  // O português é o próprio HTML; o inglês vem de js/i18n-en.js (window.I18N_EN).
  var EN = window.I18N_EN || {};
  var PT = {
    'meta.title': document.title,
    'menu.open': 'Abrir menu',
    'menu.close': 'Fechar menu'
  };
  var metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) PT['meta.description'] = metaDesc.getAttribute('content');

  var textNodes = Array.prototype.slice.call(document.querySelectorAll('[data-i18n]'));
  var attrNodes = Array.prototype.slice.call(document.querySelectorAll('[data-i18n-attr]'));
  var langButtons = Array.prototype.slice.call(document.querySelectorAll('.lang__btn'));
  var currentLang = 'pt';

  // Guarda os textos originais (PT) antes de qualquer troca
  textNodes.forEach(function (el) { el._pt = el.innerHTML; });
  attrNodes.forEach(function (el) {
    el._attrs = el.getAttribute('data-i18n-attr').split(';').map(function (pair) {
      var parts = pair.split(':');
      return { attr: parts[0].trim(), key: parts[1].trim(), pt: el.getAttribute(parts[0].trim()) };
    });
  });

  function t(key) {
    if (currentLang === 'en' && EN[key] != null) return EN[key];
    return PT[key];
  }

  function setLang(lang, save) {
    currentLang = lang === 'en' ? 'en' : 'pt';
    var en = currentLang === 'en';

    textNodes.forEach(function (el) {
      var value = en ? EN[el.getAttribute('data-i18n')] : el._pt;
      if (value != null) el.innerHTML = value;
    });
    attrNodes.forEach(function (el) {
      el._attrs.forEach(function (a) {
        var value = en ? EN[a.key] : a.pt;
        if (value != null) el.setAttribute(a.attr, value);
      });
    });

    document.documentElement.lang = en ? 'en' : 'pt-BR';
    document.title = t('meta.title');
    if (metaDesc) metaDesc.setAttribute('content', t('meta.description'));

    langButtons.forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-lang') === currentLang));
    });
    updateMenuLabel();
    requestTick(); // a altura da página muda com o idioma
    if (window.PortfolioTitleSmoke) window.PortfolioTitleSmoke.rebuild();

    if (save) {
      try { localStorage.setItem('lang', currentLang); } catch (e) { /* armazenamento indisponível */ }
    }
  }

  langButtons.forEach(function (btn) {
    btn.addEventListener('click', function () { setLang(btn.getAttribute('data-lang'), true); });
  });

  /* ---------- 4. Menu mobile ---------- */
  var toggle = document.getElementById('nav-toggle');
  var toggleLabel = document.getElementById('nav-toggle-label');
  var nav = document.getElementById('nav');

  function updateMenuLabel() {
    if (!toggle) return;
    var open = toggle.getAttribute('aria-expanded') === 'true';
    toggleLabel.textContent = t(open ? 'menu.close' : 'menu.open');
  }

  function setMenu(open) {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    updateMenuLabel();
  }

  toggle.addEventListener('click', function () {
    setMenu(toggle.getAttribute('aria-expanded') !== 'true');
  });
  nav.addEventListener('click', function (e) {
    if (e.target.closest('a')) setMenu(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setMenu(false);
      toggle.focus();
    }
  });

  // Idioma inicial: escolha salva; senão, inglês para navegadores que não estão em português
  var initialLang = null;
  try { initialLang = localStorage.getItem('lang'); } catch (e) { /* armazenamento indisponível */ }
  if (!initialLang) {
    initialLang = /^pt/i.test(navigator.language || 'pt') ? 'pt' : 'en';
  }
  if (initialLang === 'en') setLang('en', false);

  /* ---------- 5. Seção ativa: navegação + régua lateral + WebGL 3D ---------- */
  var links = Array.prototype.slice.call(document.querySelectorAll('.nav__link'));
  var rulerItems = Array.prototype.slice.call(document.querySelectorAll('.ruler__item'));
  var sectionOrder = ['topo', 'sobre', 'projetos', 'stack', 'trajetoria', 'contato'];

  function setActiveSection(id) {
    links.forEach(function (link) {
      var active = link.getAttribute('href') === '#' + id;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });

    rulerItems.forEach(function (item) {
      var active = item.getAttribute('data-section') === id;
      if (active) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    });

    if (window.PortfolioParticles) {
      var idx = sectionOrder.indexOf(id);
      if (idx !== -1) window.PortfolioParticles.setShape(idx);
    }
  }

  if ('IntersectionObserver' in window) {
    var sectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        setActiveSection(entry.target.id);
      });
    }, { rootMargin: '-42% 0px -48% 0px' });

    document.querySelectorAll('main section[id]').forEach(function (s) { sectionObserver.observe(s); });
  }

  /* ---------- 6. Aura do cursor, spotlight, tilt 3D e botões magnéticos ---------- */
  if (canHover && !reduceMotion) {
    // Aura sutil acompanhando o ponteiro no plano de fundo
    var glow = document.getElementById('cursor-glow');
    if (glow) {
      window.addEventListener('pointermove', function (e) {
        glow.style.setProperty('--cx', e.clientX + 'px');
        glow.style.setProperty('--cy', e.clientY + 'px');
        if (!glow.classList.contains('is-active')) glow.classList.add('is-active');
      }, { passive: true });
      document.addEventListener('pointerleave', function () {
        glow.classList.remove('is-active');
      });
    }

    // Spotlight seguindo o cursor nos cards, stats, chips, blocos da trajetória e contato
    var spotlightEls = document.querySelectorAll('.card, .stat, .chip, .company, .contact__item');
    spotlightEls.forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--mx', (e.clientX - r.left).toFixed(1) + 'px');
        el.style.setProperty('--my', (e.clientY - r.top).toFixed(1) + 'px');
      }, { passive: true });
    });

    // Inclinação 3D sutil nos cards de projeto
    document.querySelectorAll('.card').forEach(function (card) {
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        var nx = ((e.clientX - r.left) / r.width) * 2 - 1;
        var ny = ((e.clientY - r.top) / r.height) * 2 - 1;
        card.style.setProperty('--rx', (-ny * 2.4).toFixed(2) + 'deg');
        card.style.setProperty('--ry', (nx * 2.4).toFixed(2) + 'deg');
      }, { passive: true });
      card.addEventListener('pointerleave', function () {
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      });
    });

    // Inclinação 3D + reflexo especular no retrato do Hero
    if (heroPhoto) {
      heroPhoto.addEventListener('pointermove', function (e) {
        var r = heroPhoto.getBoundingClientRect();
        var x = e.clientX - r.left;
        var y = e.clientY - r.top;
        var nx = (x / r.width) * 2 - 1;
        var ny = (y / r.height) * 2 - 1;
        heroPhoto.style.setProperty('--px', x.toFixed(1) + 'px');
        heroPhoto.style.setProperty('--py', y.toFixed(1) + 'px');
        heroPhoto.style.setProperty('--rx', (-ny * 4.2).toFixed(2) + 'deg');
        heroPhoto.style.setProperty('--ry', (nx * 4.2).toFixed(2) + 'deg');
      }, { passive: true });
      heroPhoto.addEventListener('pointerleave', function () {
        heroPhoto.style.setProperty('--rx', '0deg');
        heroPhoto.style.setProperty('--ry', '0deg');
      });
    }

    // Atração magnética sutil nos botões principais e CTA da navegação
    document.querySelectorAll('.btn, .nav__link--cta').forEach(function (btn) {
      btn.addEventListener('pointermove', function (e) {
        var r = btn.getBoundingClientRect();
        var dx = ((e.clientX - r.left) / r.width - 0.5) * 10;
        var dy = ((e.clientY - r.top) / r.height - 0.5) * 8;
        btn.style.setProperty('--mag-x', dx.toFixed(1) + 'px');
        btn.style.setProperty('--mag-y', dy.toFixed(1) + 'px');
      }, { passive: true });
      btn.addEventListener('pointerleave', function () {
        btn.style.setProperty('--mag-x', '0px');
        btn.style.setProperty('--mag-y', '0px');
      });
    });

    // Pulso de energia nas partículas WebGL ao interagir com elementos de destaque
    var energyEls = document.querySelectorAll('.card, .chip, .more__item, .btn, .ruler__item, .contact__item');
    energyEls.forEach(function (el) {
      el.addEventListener('pointerenter', function () {
        if (window.PortfolioParticles) window.PortfolioParticles.setHoverEnergy(0.7);
      });
      el.addEventListener('pointerleave', function () {
        if (window.PortfolioParticles) window.PortfolioParticles.setHoverEnergy(0);
      });
    });
  }

  /* ---------- 7. Vídeos dos projetos ---------- */
  // Tocam só enquanto aparecem na tela; com movimento reduzido, fica a imagem de capa (poster).
  var videos = Array.prototype.slice.call(document.querySelectorAll('.card__video'));
  if (videos.length && !reduceMotion && 'IntersectionObserver' in window) {
    var videoObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var v = entry.target;
        if (entry.isIntersecting) {
          var p = v.play();
          if (p && p.catch) p.catch(function () { /* autoplay bloqueado: mantém o poster */ });
        } else {
          v.pause();
        }
      });
    }, { threshold: 0.35 });
    videos.forEach(function (v) { videoObserver.observe(v); });
  }

  /* ---------- 8. Ano atual ---------- */
  document.getElementById('ano').textContent = new Date().getFullYear();
})();
