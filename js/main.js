/* ==========================================================================
   Portfólio · interações (JavaScript puro, sem dependências)
   1. Barra de progresso + header que muda ao rolar
   2. Revelação ao rolar com IntersectionObserver (com stagger)
   3. Idioma (PT/EN)
   4. Menu mobile
   5. Link ativo na navegação
   6. Brilho dos cards seguindo o cursor
   7. Vídeos dos projetos (tocam só quando visíveis)
   8. Ano atual no rodapé
   ========================================================================== */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* PERSONALIZE: intervalo (ms) entre os itens de um grupo [data-stagger] */
  var STAGGER_MS = 110;

  /* ---------- 1. Progresso de leitura + header ---------- */
  var bar = document.getElementById('progress-bar');
  var header = document.getElementById('header');
  var ticking = false;

  function onScroll() {
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    var ratio = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
    bar.style.transform = 'scaleX(' + ratio + ')';
    header.classList.toggle('is-scrolled', window.scrollY > 24);
    ticking = false;
  }

  function requestTick() {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(onScroll);
    }
  }

  window.addEventListener('scroll', requestTick, { passive: true });
  window.addEventListener('resize', requestTick);
  onScroll();

  /* ---------- 2. Revelação ao rolar ---------- */
  var revealEls = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

  // Atraso em sequência para os filhos de cada grupo [data-stagger]
  document.querySelectorAll('[data-stagger]').forEach(function (group) {
    group.querySelectorAll('.reveal').forEach(function (el, i) {
      el.style.setProperty('--d', i * STAGGER_MS + 'ms');
    });
  });

  function show(el) {
    el.classList.add('is-visible');
    // Remove o atraso depois da entrada, para o hover responder na hora
    var delay = parseFloat(getComputedStyle(el).getPropertyValue('--d')) || 0;
    window.setTimeout(function () { el.classList.add('is-done'); }, delay + 800);
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

  /* ---------- 5. Link ativo na navegação ---------- */
  var links = Array.prototype.slice.call(document.querySelectorAll('.nav__link'));
  if ('IntersectionObserver' in window) {
    var sectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (link) {
          var active = link.getAttribute('href') === '#' + entry.target.id;
          link.classList.toggle('is-active', active);
          if (active) link.setAttribute('aria-current', 'true');
          else link.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });

    document.querySelectorAll('main section[id]').forEach(function (s) { sectionObserver.observe(s); });
  }

  /* ---------- 6. Brilho dos cards seguindo o cursor ---------- */
  if (window.matchMedia('(hover: hover)').matches) {
    document.querySelectorAll('.card').forEach(function (card) {
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty('--mx', e.clientX - r.left + 'px');
        card.style.setProperty('--my', e.clientY - r.top + 'px');
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
