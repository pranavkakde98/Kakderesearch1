/* ==========================================================================
   Site chrome and motion, V8.

   GSAP 3.13 (vendored, same-origin) drives the choreography. Everything
   here degrades: no JS or reduced motion means the finished page, drawn
   immediately. The html.anim class is the single switch; it is set by the
   inline loader in <head> and revoked here if GSAP failed to arrive.
   ========================================================================== */

(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var g = window.gsap;
  var ST = window.ScrollTrigger;

  /* If the animation library did not load, un-arm the hidden states. */
  if (!g || !ST) {
    root.classList.remove('anim');
  } else {
    g.registerPlugin(ST);
    if (window.SplitText) g.registerPlugin(window.SplitText);
    ST.config({ ignoreMobileResize: true });
  }
  window.__kr_ready = true;

  var motion = root.classList.contains('anim');

  /* ---------- Smooth scroll ----------
     One Lenis for the whole site. It is created here because app.js is the
     only script every page loads, so "the highest client-side level" on a
     static site is this file, once, at the top.

     Two decisions worth keeping:

     It runs on GSAP's ticker, not a second requestAnimationFrame loop. The
     page already has a clock; adding another means Lenis writes the scroll
     position on one frame and ScrollTrigger reads it on the next, which is
     exactly how scrubbed figures end up trailing the page by a beat.

     Touch is left alone (syncTouch off). A phone already interpolates its
     own scrolling and doubling that is what makes a site feel slippery
     rather than smooth. Wheel and trackpad are what Lenis is here for.

     Reduced motion, or a page where GSAP did not arrive, never constructs
     it at all: those readers get the browser's own scrolling, untouched. */

  var lenis = null;

  if (motion && window.Lenis) {
    lenis = new window.Lenis({
      duration: 1.0,
      /* expo-out: covers most of the distance early, so the page answers
         the wheel immediately and only the last few pixels are eased. */
      easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1,
      syncTouch: false,
      autoRaf: false,
      /* In-page links are eased rather than jumped. No offset is passed on
         purpose: Lenis already subtracts the root's scroll-padding-top (and
         any scroll-margin-top on the target) when it resolves an anchor, so
         the stylesheet stays the one place the masthead clearance is set.
         Passing the header height here as well would double-count it and
         drop every anchor 84px too low. */
      anchors: true
    });

    window.__lenis = lenis;

    lenis.on('scroll', ST.update);
    g.ticker.add(function (time) { lenis.raf(time * 1000); });
    /* Lenis integrates real elapsed time; GSAP's lag smoothing rewrites it. */
    g.ticker.lagSmoothing(0);

    /* Teardown on a real unload only. Destroying on every pagehide would
       hand a dead instance back to a reader who pressed Back, so the
       bfcache case re-syncs instead — see the pageshow handler below. */
    window.addEventListener('pagehide', function (e) {
      if (!e.persisted) lenis.destroy();
    });
    window.addEventListener('pageshow', function (e) {
      if (!e.persisted) return;
      lenis.resize();
      lenis.scrollTo(window.scrollY, { immediate: true, force: true });
      ST.refresh();
    });
  }

  /* ---------- Masthead ---------- */

  var header = doc.getElementById('siteHeader');

  if (header) {
    var compact = false;
    var COMPACT_ABOVE = 84, EXPAND_BELOW = 28;
    var ticking = false;
    function syncHeader() {
      var y = window.scrollY;
      var should = compact ? y > EXPAND_BELOW : y > COMPACT_ABOVE;
      if (should !== compact) {
        compact = should;
        header.classList.toggle('is-compact', compact);
      }
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(syncHeader);
    }, { passive: true });
    syncHeader();

    /* Over the dark hero the masthead has no ground of its own; it takes
       one the moment the hero has scrolled past. */
    var hero = doc.querySelector('.hero-dark');
    if (hero && ST) {
      ST.create({
        trigger: hero,
        start: 'bottom 88px',
        onLeave: function () { header.classList.remove('on-hero'); },
        onEnterBack: function () { header.classList.add('on-hero'); }
      });
    } else if (hero) {
      var syncHero = function () {
        var r = hero.getBoundingClientRect();
        header.classList.toggle('on-hero', r.bottom > 88);
      };
      window.addEventListener('scroll', syncHero, { passive: true });
      syncHero();
    }
  }

  /* ---------- Dropdown menus (hover on desktop, click everywhere) ---------- */

  var items = Array.prototype.slice.call(doc.querySelectorAll('.nav-item.has-menu'));
  var hoverable = window.matchMedia('(hover: hover) and (min-width: 901px)');

  function closeAll(except) {
    items.forEach(function (item) {
      if (item === except) return;
      item.classList.remove('is-open');
      var btn = item.querySelector('.nav-drop');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  }

  items.forEach(function (item) {
    var btn = item.querySelector('.nav-drop');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var open = item.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', String(open));
      closeAll(item);
    });
    item.addEventListener('mouseenter', function () {
      if (!hoverable.matches) return;
      item.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
    });
    item.addEventListener('mouseleave', function () {
      if (!hoverable.matches) return;
      item.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
    });
    item.addEventListener('focusout', function (e) {
      if (item.contains(e.relatedTarget)) return;
      item.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
    });
  });

  doc.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAll(null);
  });
  doc.addEventListener('click', function (e) {
    if (!e.target.closest('.nav-item.has-menu')) closeAll(null);
  });

  /* ---------- Mobile nav ---------- */

  var toggle = doc.getElementById('navToggle');
  var nav = doc.getElementById('siteNav');

  if (toggle && nav) {
    var navLinks = Array.prototype.slice.call(nav.children);
    var FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

    /* The overlay behaves as a modal dialog while it is open: the page
       behind it is inert (so neither Tab nor a screen reader can wander
       into it), focus moves to the first link, Tab cycles between the
       toggle and the last link, and Escape hands focus back to the toggle. */
    function setInert(on) {
      Array.prototype.forEach.call(doc.body.children, function (node) {
        if (node === header || node.tagName === 'SCRIPT') return;
        if (on) { node.setAttribute('inert', ''); node.setAttribute('aria-hidden', 'true'); }
        else { node.removeAttribute('inert'); node.removeAttribute('aria-hidden'); }
      });
    }

    /* body.nav-open locks the page behind the overlay. Lenis has to be
       told, or it keeps integrating wheel deltas against a page that
       cannot move and the reader lands somewhere else on closing. */
    function setNav(open) {
      nav.classList.toggle('is-open', open);
      doc.body.classList.toggle('nav-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      if (lenis) { if (open) lenis.stop(); else lenis.start(); }
      setInert(open);
      if (open) {
        var first = nav.querySelector(FOCUSABLE);
        window.setTimeout(function () { if (first && nav.classList.contains('is-open')) first.focus(); }, motion ? 120 : 20);
      }
    }

    toggle.addEventListener('click', function () {
      var open = !nav.classList.contains('is-open');
      setNav(open);
      if (open && motion) {
        g.fromTo(navLinks,
          { y: 26, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: 0.55, ease: 'power3.out', stagger: 0.055, delay: 0.08,
            clearProps: 'visibility,' + CLEAR });
      }
      if (!open) toggle.focus();
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a')) setNav(false);
    });
    doc.addEventListener('keydown', function (e) {
      if (!nav.classList.contains('is-open')) return;
      if (e.key === 'Escape') {
        setNav(false);
        toggle.focus();
        return;
      }
      if (e.key === 'Tab') {
        var nodes = [toggle].concat(Array.prototype.filter.call(nav.querySelectorAll(FOCUSABLE), function (n) {
          return n.offsetParent !== null;
        }));
        if (nodes.length < 2) return;
        var first = nodes[0], last = nodes[nodes.length - 1];
        var active = doc.activeElement;
        if (e.shiftKey && (active === first || nodes.indexOf(active) === -1)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      }
    });
    /* If the viewport grows past the drawer breakpoint while it is open,
       release the page rather than leaving it locked under a desktop nav. */
    var wide = window.matchMedia('(min-width: 901px)');
    var onWide = function (mq) { if (mq.matches && nav.classList.contains('is-open')) setNav(false); };
    if (wide.addEventListener) wide.addEventListener('change', onWide); else if (wide.addListener) wide.addListener(onWide);
  }

  /* ---------- Reveals ----------
     .a-rise and .a-fade are armed (hidden) only under html.anim. Each fires
     once, and each ends with nothing left behind: no inline transform, no
     CSS transform, the element sitting in its own layout box.

     The order below is the whole point. The start state is written inline
     first, then .is-in retires the CSS rule that was holding it, and only
     then does the tween run. Clearing the props at the end therefore lands
     on "no transform" rather than back on translateY(18px). Marking the
     element before the tween instead of after is what stops a reveal from
     finishing with an 18px drop. */

  function markIn(el) { el.classList.add('is-in'); }

  /* Exactly the properties GSAP writes for these tweens, and nothing else.
     Not 'all': dozens of elements across the site carry an authored inline
     style — margin-bottom, max-width, display:flex, aspect-ratio — and
     'all' empties the style attribute, so a heading would lose its 40px
     margin at the moment it finished revealing and the section under it
     would jump up. Clearing by name leaves the markup's own styles alone. */
  var CLEAR = 'opacity,transform,translate,rotate,scale,willChange';

  if (motion) {
    var rises = Array.prototype.slice.call(doc.querySelectorAll('.a-rise'));
    if (rises.length) {
      ST.batch(rises, {
        start: 'top 86%',
        once: true,
        onEnter: function (batch) {
          g.set(batch, { opacity: 0, y: 18 });
          batch.forEach(markIn);
          g.to(batch, {
            opacity: 1, y: 0,
            duration: 0.8, ease: 'power3.out',
            stagger: 0.08, overwrite: true, clearProps: CLEAR
          });
        }
      });
    }
    var fades = Array.prototype.slice.call(doc.querySelectorAll('.a-fade'));
    if (fades.length) {
      ST.batch(fades, {
        start: 'top 88%',
        once: true,
        onEnter: function (batch) {
          g.set(batch, { opacity: 0 });
          batch.forEach(markIn);
          g.to(batch, { opacity: 1, duration: 0.9, ease: 'power2.out', stagger: 0.1, overwrite: true, clearProps: CLEAR });
        }
      });
    }
  }

  /* ---------- Hero choreography ---------- */

  var heroEl = doc.querySelector('.hero-dark');
  if (heroEl && motion) {
    var run = function () {
      var h1 = heroEl.querySelector('h1');
      var tl = g.timeline({ defaults: { ease: 'power3.out' } });

      /* The plate settles as the headline arrives, then drifts down as the
         hero scrolls away. Transform only, and never opacity: the picture
         is the largest paint on the page and must not wait on a script.
         The img is drawn oversized, so neither move shows an edge. */
      var plate = heroEl.querySelector('.hero-plate img');
      if (plate) {
        tl.fromTo(plate, { scale: 1.06 }, { scale: 1, duration: 2.4, ease: 'power2.out' }, 0);
        g.to(plate, {
          yPercent: 5,
          ease: 'none',
          scrollTrigger: { trigger: heroEl, start: 'top top', end: 'bottom top', scrub: 0.4 }
        });
      }

      tl.to(heroEl.querySelector('.hero-dateline'), { opacity: 1, y: 0, duration: 0.6 }, 0.05);

      var usedSplit = false;
      if (window.SplitText && h1) {
        try {
          var split = window.SplitText.create(h1, { type: 'lines', mask: 'lines', linesClass: 'line' });
          /* The masks clip at the line box, and at this line-height the
             serif's descenders (the g, y and f of the italic phrase) fall
             outside it. Each mask window is opened downward by the same
             amount it is pulled back, so the layout holds and nothing is
             cut off, mid-animation or at rest. */
          var masks = split.masks || split.lines.map(function (l) { return l.parentNode; });
          masks.forEach(function (m) {
            if (m && m !== h1) {
              m.style.paddingBottom = '0.22em';
              m.style.marginBottom = '-0.22em';
            }
          });
          g.set(h1, { opacity: 1, y: 0 });
          tl.from(split.lines, { yPercent: 118, duration: 1.0, stagger: 0.09, ease: 'power4.out' }, 0.12);
          usedSplit = true;
        } catch (e) { usedSplit = false; }
      }
      if (!usedSplit && h1) tl.to(h1, { opacity: 1, y: 0, duration: 0.9 }, 0.12);

      tl.to(heroEl.querySelector('.hero-sub'), { opacity: 1, y: 0, duration: 0.7 }, 0.5);
      tl.to(heroEl.querySelector('.hero-actions'), { opacity: 1, y: 0, duration: 0.7 }, 0.62);
      tl.to(heroEl.querySelectorAll('.hero-fig .a-hero-el'), { opacity: 1, y: 0, duration: 0.8, stagger: 0.08 }, 0.55);
      tl.to(heroEl.querySelectorAll('.strip .a-hero-el'), { opacity: 1, y: 0, duration: 0.7, stagger: 0.07 }, 0.9);
      tl.to(heroEl.querySelector('.hero-countries'), { opacity: 1, y: 0, duration: 0.7 }, 1.05);
    };
    /* Split after the webfonts have settled, so lines break where they
       will stay. The race keeps a slow font from holding the page. */
    var started = false;
    var kick = function () { if (!started) { started = true; run(); } };
    if (doc.fonts && doc.fonts.ready) {
      doc.fonts.ready.then(kick);
      window.setTimeout(kick, 400);
    } else {
      kick();
    }
  }

  /* ---------- Article progress ---------- */

  var progress = doc.querySelector('.progress-bar');
  if (progress && motion) {
    g.to(progress, {
      scaleX: 1,
      ease: 'none',
      scrollTrigger: { start: 0, end: 'max', scrub: 0.3 }
    });
  } else if (progress) {
    progress.style.display = 'none';
  }

  /* ---------- Narrative steps (the stage) ---------- */

  if ('IntersectionObserver' in window) {
    var steps = doc.querySelectorAll('.stage-step');
    if (steps.length) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { e.target.classList.toggle('is-on', e.isIntersecting); });
      }, { rootMargin: '-42% 0px -42% 0px' });
      Array.prototype.forEach.call(steps, function (s) { io.observe(s); });
    }

    /* Method steps light their numeral as they arrive. */
    var msteps = doc.querySelectorAll('.method-step');
    if (msteps.length) {
      var mio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('is-on'); mio.unobserve(e.target); }
        });
      }, { threshold: 0.5 });
      Array.prototype.forEach.call(msteps, function (s) { mio.observe(s); });
    }

    /* Anchor rail scrollspy. */
    var rail = doc.querySelector('.anchor-rail');
    if (rail) {
      var railLinks = Array.prototype.slice.call(rail.querySelectorAll('a[href^="#"]'));
      var targets = railLinks.map(function (a) {
        return doc.getElementById(a.getAttribute('href').slice(1));
      }).filter(Boolean);
      var setActive = function (id) {
        railLinks.forEach(function (a) {
          a.classList.toggle('is-active', a.getAttribute('href') === '#' + id);
        });
      };
      var rio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) setActive(e.target.id);
        });
      }, { rootMargin: '-20% 0px -70% 0px' });
      targets.forEach(function (t) { rio.observe(t); });
    }
  }

  /* ---------- Research archive filter ---------- */

  var filterBtns = Array.prototype.slice.call(doc.querySelectorAll('.filter-btn'));
  var papers = Array.prototype.slice.call(doc.querySelectorAll('.idx-row[data-theme]'));

  filterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      filterBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
      var theme = btn.getAttribute('data-filter');
      var shown = [];
      papers.forEach(function (paper) {
        var match = theme === 'all' || (paper.getAttribute('data-theme') || '').split(' ').indexOf(theme) !== -1;
        paper.classList.toggle('is-hidden', !match);
        if (match) shown.push(paper);
      });
      if (motion && shown.length) {
        /* The rows carry .a-rise, so they must be marked in before the
           props are cleared — otherwise filtering restores the armed
           state and the matches land invisible and 18px low. */
        shown.forEach(markIn);
        g.fromTo(shown, { opacity: 0, y: 10 }, {
          opacity: 1, y: 0, duration: 0.45, ease: 'power3.out', stagger: 0.05, clearProps: CLEAR
        });
      }
    });
  });

  /* ---------- Forms: persist submissions through the Vercel API ---------- */

  function contextFields() {
    var params = new URLSearchParams(window.location.search);
    return {
      page_path: window.location.pathname,
      referrer: document.referrer || '',
      utm_source: params.get('utm_source') || '',
      utm_medium: params.get('utm_medium') || '',
      utm_campaign: params.get('utm_campaign') || ''
    };
  }

  var FALLBACK = 'We could not record that just now. Please email inquiries@kakderesearch.com and it will be picked up directly.';

  function confirmOnSubmit(formId, endpoint) {
    var form = doc.getElementById(formId);
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      var submit = form.querySelector('button[type="submit"]');
      var note = form.querySelector('.form-confirm') ||
                 (form.parentElement && form.parentElement.querySelector('.form-confirm'));
      var values = Object.fromEntries(new FormData(form).entries());
      Object.assign(values, contextFields());
      if (submit) { submit.disabled = true; submit.setAttribute('aria-busy', 'true'); }
      fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values), keepalive: true
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (result) {
          if (!response.ok) {
            /* Only a 4xx tells the visitor something they can act on ("Enter a
               valid email address"). A 5xx is our problem, not theirs: never
               show them server internals, and never let the enquiry vanish. */
            throw new Error(response.status < 500 && result.error ? result.error : FALLBACK);
          }
          if (note) { note.textContent = result.message || 'Received.'; note.hidden = false; }
          Array.prototype.slice.call(form.querySelectorAll('input, textarea, select, button')).forEach(function (n) { n.disabled = true; });
        });
      }).catch(function (error) {
        if (note) { note.textContent = error.message || FALLBACK; note.hidden = false; }
        if (submit) { submit.disabled = false; submit.removeAttribute('aria-busy'); }
      });
    });
  }
  confirmOnSubmit('contactForm', '/api/contact');
  confirmOnSubmit('listForm', '/api/newsletter');

  /* Analytics note: the earlier bespoke /api/events beacon (session id +
     per-click tracking) was removed for a privacy-light footprint. The site
     collects only what a visitor submits through a form. If analytics are
     reintroduced, add the disclosure and consent the target jurisdictions
     require, and never place personal data in the payload. */

  /* ---------- Keep layout measurements honest ---------- */

  if (ST && doc.fonts && doc.fonts.ready) {
    doc.fonts.ready.then(function () { ST.refresh(); });
  }
})();
