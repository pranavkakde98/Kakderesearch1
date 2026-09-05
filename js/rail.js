/* ==========================================================================
   Client perspectives — the rail, homepage only.

   Two behaviours, one markup, the same controls.

   Desktop, motion allowed: the track holds the cards more than once and is
   moved by a transform on every frame at a velocity that eases towards its
   target, so it glides to a halt on hover or Pause and gathers pace again
   on release. It holds still off-screen and on a hidden tab. The previous
   and next buttons step the rail one card at a time, gliding, and pause
   it so the reader keeps the card they asked for; Play sets it moving
   again. The "current" card does not sit on the left edge: it rests a
   quarter of the free width in from the left, with the tail of the card
   before it showing through the edge fade, so it reads comfortably. The
   counter follows that card. Decorative to assistive technology; the same
   entries sit below it as a static list.

   Phones and tablets (900px and below), and any reader who has asked for
   reduced motion: a swipeable carousel, one card per view, snapping, with
   the same previous/next buttons and counter. Nothing moves on its own.
   ========================================================================== */

(function () {
  'use strict';

  var doc = document;
  var rail = doc.getElementById('revRail');
  var viewport = doc.getElementById('railViewport');
  var track = doc.getElementById('railTrack');
  var toggle = doc.getElementById('railToggle');
  var nav = doc.getElementById('railNav');
  if (!rail || !viewport || !track) return;

  var SPEED = 36;          /* px per second at cruise */
  var EASE_IN = 2.2;
  var EASE_OUT = 4.5;
  var GLIDE_MS = 560;      /* one button press, one card */
  var ANCHOR_SHARE = 0.25; /* the current card sits this share of the free width in from the left */
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var small = window.matchMedia('(max-width: 900px)');
  var originals = Array.prototype.slice.call(track.children);
  var n = originals.length;
  if (!n) return;

  var prevBtn = nav ? nav.querySelector('[data-rail-prev]') : null;
  var nextBtn = nav ? nav.querySelector('[data-rail-next]') : null;
  var indexEl = nav ? nav.querySelector('[data-rail-index]') : null;
  var totalEl = nav ? nav.querySelector('[data-rail-total]') : null;
  var countEl = nav ? nav.querySelector('.rail-count') : null;
  if (totalEl) totalEl.textContent = String(n);

  var paused = false, hover = false, offscreen = true, hidden = doc.hidden;
  var pos = 0, vel = 0, raf = null, last = 0;
  var half = 0, total = 0, laps = 0, anchor = 0, stepNow = 0;
  var glideRaf = null, glideTo = 0, lastIdx = -1;
  var dupes = [];

  function manual() { return small.matches || reduce.matches; }
  function step() {
    var card = originals[0];
    var cs = window.getComputedStyle(card);
    return card.getBoundingClientRect().width + (parseFloat(cs.marginRight) || 0);
  }
  function norm(x) { return half > 0 ? ((x % half) + half) % half : x; }

  /* ---------- moving mode ---------- */
  function buildDupes(count) {
    dupes.forEach(function (node) { node.remove(); });
    dupes = [];
    for (var l = 0; l < count; l++) {
      originals.forEach(function (card) {
        var clone = card.cloneNode(true);
        clone.classList.add('is-dup');
        clone.removeAttribute('id');
        track.appendChild(clone);
        dupes.push(clone);
      });
    }
    laps = count;
  }
  /* Where the current card rests: a quarter of the free width in from the
     left, never inside the page's own left margin. */
  function measureAnchor() {
    var vw = viewport.clientWidth;
    var w = originals[0].getBoundingClientRect().width;
    var container = rail.parentNode ? rail.parentNode.querySelector('.container') : null;
    var margin = container ? Math.max(0, container.getBoundingClientRect().left) : 0;
    anchor = Math.round(Math.max(margin, (vw - w) * ANCHOR_SHARE));
  }
  function measure() {
    if (manual()) { half = 0; return; }
    var s = step();
    if (!s) return;
    /* keep the same card at the anchor across a resize or a font load */
    var f = stepNow ? (pos + anchor) / stepNow : 0;
    /* enough laps that a glide never runs off the end of the track */
    var need = Math.max(1, Math.ceil((viewport.clientWidth + 3 * s) / (n * s)));
    if (need !== laps || !dupes.length) buildDupes(need);
    half = dupes[0].offsetLeft - originals[0].offsetLeft;
    total = half * (laps + 1);
    measureAnchor();
    stepNow = s;
    pos = norm(f * s - anchor);
  }
  function paint() {
    track.style.transform = 'translate3d(' + (-pos).toFixed(2) + 'px, 0, 0)';
  }
  function target() {
    return (manual() || paused || hover || offscreen || hidden) ? 0 : SPEED;
  }
  function frame(now) {
    raf = null;
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    var want = target();
    var k = want > vel ? EASE_IN : EASE_OUT;
    vel += (want - vel) * Math.min(1, k * dt);
    if (Math.abs(vel - want) < 0.4) vel = want;
    if (glideRaf === null && half > 0 && vel > 0) {
      pos += vel * dt;
      while (pos >= half) pos -= half;
      paint();
      syncCount();
    }
    if (vel > 0 || want > 0) raf = window.requestAnimationFrame(frame);
    else last = 0;
  }
  function tick() { if (raf === null && !manual()) raf = window.requestAnimationFrame(frame); }

  /* Ease the track to a position, then hand back to the cruise loop. */
  function glide(to) {
    if (glideRaf !== null) window.cancelAnimationFrame(glideRaf);
    var from = pos, dist = to - from, t0 = null;
    glideTo = to;
    function run(now) {
      if (t0 === null) t0 = now;
      var k = Math.min(1, (now - t0) / GLIDE_MS);
      var e = 1 - Math.pow(1 - k, 3);
      pos = from + dist * e;
      if (k >= 1) {
        glideRaf = null;
        pos = norm(to);
        paint();
        syncCount();
        tick();
        return;
      }
      paint();
      syncCount();
      glideRaf = window.requestAnimationFrame(run);
    }
    glideRaf = window.requestAnimationFrame(run);
  }
  function cardIndex() {
    if (!stepNow || half <= 0) return 0;
    var i = Math.round((pos + anchor) / stepNow) % n;
    return (i + n) % n;
  }

  function paintToggle() {
    if (!toggle) return;
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.setAttribute('aria-label', paused ? 'Play the client perspectives' : 'Pause the client perspectives');
    var label = toggle.querySelector('.rail-toggle-text');
    if (label) label.textContent = paused ? 'Play' : 'Pause';
  }

  /* ---------- manual mode: the swipeable carousel ---------- */
  /* Each card's own scroll offset inside the viewport, so a step lands
     exactly on a snap point rather than between two; the last cards can
     only reach as far as the viewport can scroll. */
  function maxLeft() { return Math.max(0, viewport.scrollWidth - viewport.clientWidth); }
  function offsetOf(i) {
    var c = originals[i].getBoundingClientRect();
    var v = viewport.getBoundingClientRect();
    return Math.min(Math.round(c.left - v.left + viewport.scrollLeft), maxLeft());
  }
  function current() {
    var sl = viewport.scrollLeft, best = 0, bd = Infinity;
    for (var i = 0; i < n; i++) {
      var d = Math.abs(offsetOf(i) - sl);
      if (d <= bd) { bd = d; best = i; }
    }
    return best;
  }
  var settleTimer = null, manualTo = -1;
  function goManual(delta) {
    var from = manualTo >= 0 ? manualTo : current();
    var i = Math.max(0, Math.min(n - 1, from + delta));
    var left = offsetOf(i);
    var smooth = !reduce.matches && !doc.hidden;
    window.clearTimeout(settleTimer);
    manualTo = i;
    viewport.scrollTo({ left: left, behavior: smooth ? 'smooth' : 'auto' });
    /* A smooth scroll can stall in a background tab; settle it by hand. */
    if (smooth) {
      settleTimer = window.setTimeout(function () {
        if (Math.abs(viewport.scrollLeft - left) > 2) viewport.scrollLeft = left;
        manualTo = -1;
        paintNav();
      }, 700);
    } else { manualTo = -1; paintNav(); }
  }
  /* a swipe or wheel takes over from a pending button press */
  ['pointerdown', 'touchstart', 'wheel'].forEach(function (type) {
    viewport.addEventListener(type, function () { window.clearTimeout(settleTimer); manualTo = -1; }, { passive: true });
  });

  /* ---------- the shared controls ---------- */
  function syncCount() {
    if (!nav) return;
    var m = manual();
    var i = m ? current() : cardIndex();
    if (i === lastIdx) return;
    lastIdx = i;
    if (indexEl) indexEl.textContent = String(i + 1);
    if (prevBtn) prevBtn.disabled = m && i <= 0;
    if (nextBtn) nextBtn.disabled = m && i >= n - 1;
  }
  function paintNav() { lastIdx = -1; syncCount(); }
  function go(delta) {
    if (manual()) { goManual(delta); return; }
    var s = stepNow;
    if (!s || half <= 0) return;
    if (!paused) { paused = true; paintToggle(); }
    vel = 0;
    /* base a quick second press on the card already in flight */
    var base = glideRaf !== null ? glideTo : pos;
    var idx = Math.round((base + anchor) / s) + delta;
    var to = idx * s - anchor;
    /* the copy of that position nearest to where we are */
    to -= Math.round((to - pos) / half) * half;
    /* keep both ends of the glide on the track; a shift by one lap is
       invisible because the laps are identical */
    var vw = viewport.clientWidth;
    while (Math.min(pos, to) < 0) { pos += half; to += half; }
    while (Math.max(pos, to) + vw > total && Math.min(pos, to) - half >= 0) { pos -= half; to -= half; }
    glide(to);
  }
  if (prevBtn) prevBtn.addEventListener('click', function () { go(-1); });
  if (nextBtn) nextBtn.addEventListener('click', function () { go(1); });
  var scrollTimer = null;
  viewport.addEventListener('scroll', function () {
    if (!rail.classList.contains('is-manual')) return;
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(paintNav, 80);
  }, { passive: true });

  /* ---------- switching between the two ---------- */
  function apply() {
    var m = manual();
    rail.classList.toggle('is-manual', m);
    rail.classList.toggle('is-js', !m);
    if (glideRaf !== null) { window.cancelAnimationFrame(glideRaf); glideRaf = null; }
    window.clearTimeout(settleTimer); manualTo = -1;
    if (nav) nav.hidden = false;
    if (countEl) {
      /* announce the position after a button press, never while cruising */
      if (m) countEl.setAttribute('aria-live', 'polite');
      else countEl.removeAttribute('aria-live');
    }
    if (m) {
      dupes.forEach(function (node) { node.remove(); }); dupes = []; laps = 0;
      if (raf !== null) { window.cancelAnimationFrame(raf); raf = null; }
      vel = 0; pos = 0; last = 0; half = 0; total = 0; stepNow = 0;
      track.style.transform = '';
      viewport.removeAttribute('aria-hidden');
      viewport.setAttribute('role', 'region');
      viewport.setAttribute('aria-label', 'Client perspectives, ' + n + ' entries');
      if (toggle) toggle.hidden = true;
      viewport.scrollLeft = 0;
      paintNav();
    } else {
      viewport.setAttribute('aria-hidden', 'true');
      viewport.removeAttribute('role');
      viewport.removeAttribute('aria-label');
      viewport.scrollLeft = 0;
      if (toggle) toggle.hidden = false;
      stepNow = 0; pos = 0;   /* start with the first card at the anchor */
      measure();
      paint();
      paintToggle();
      paintNav();
      tick();
    }
  }

  if (toggle) toggle.addEventListener('click', function () { paused = !paused; paintToggle(); tick(); });
  rail.addEventListener('mouseenter', function () { hover = true; tick(); });
  rail.addEventListener('mouseleave', function () { hover = false; tick(); });
  doc.addEventListener('visibilitychange', function () { hidden = doc.hidden; tick(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { offscreen = !e.isIntersecting; });
      tick();
    }, { rootMargin: '120px 0px' }).observe(rail);
  } else { offscreen = false; }

  function onMediaChange() { apply(); }
  [reduce, small].forEach(function (mq) {
    if (mq.addEventListener) mq.addEventListener('change', onMediaChange);
    else if (mq.addListener) mq.addListener(onMediaChange);
  });
  var timer = null;
  function remeasure() {
    if (manual()) { paintNav(); return; }
    if (glideRaf !== null) return;   /* a glide in flight settles itself first */
    measure();
    paint();
    paintNav();
  }
  function onResize() {
    window.clearTimeout(timer);
    timer = window.setTimeout(remeasure, 160);
  }
  if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(rail);
  else window.addEventListener('resize', onResize);

  /* ---------- start ---------- */
  apply();
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(remeasure);
})();
