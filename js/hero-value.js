/* ==========================================================================
   The hero figure, V13: where does growth actually create value?

   One exhibit, four global industries, one measure: the value-creation
   spread, return on capital less weighted average cost of capital, in
   percentage points, from assets/data/industry-value.js (NYU Stern data,
   stored locally; nothing is fetched or estimated here).

   How it is drawn:
   - it renders to the width it is given (fixed type sizes, a viewBox
     rebuilt on resize) so a phone gets a legible chart, not a shrunk one;
   - straight segments between annual observations, never smoothed;
   - the zero line is the analytical line and is named on the chart;
   - every line is named at its right end with its 2026 value, so colour is
     never the only key, and the four strokes differ in weight and dash;
     labels are de-collided before they are placed;
   - the lines are revealed left to right by a clip that sweeps across each
     one (a dashed stroke cannot be drawn with a dash offset), with a small
     stagger; the end labels fade in as each line arrives and the end dots
     pulse once. Nothing loops. Reduced motion renders it finished.
   - hover, tap and the arrow keys read the values for a year.
   ========================================================================== */

(function () {
  'use strict';

  var doc = document;
  var host = doc.querySelector('[data-hero-value]');
  if (!host) return;
  var frame = host.querySelector('.hero-chart');
  if (!frame) return;
  var DATA = window.INDUSTRY_VALUE;
  if (!DATA || !DATA.years || !DATA.series || !DATA.series.length) { host.setAttribute('hidden', ''); return; }

  var g = window.gsap;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var motion = !!g && !reduce && doc.documentElement.classList.contains('anim');

  var DRAW_S = 2.0;      /* one line, left to right */
  var STAGGER_S = 0.1;   /* between the four starts */
  var delay = parseFloat(host.getAttribute('data-delay') || '0.9');
  if (isNaN(delay) || delay < 0) delay = 0.9;

  /* Stroke treatment per series: weight and dash tell the lines apart
     without colour; Software carries the emphasis. */
  var STYLE = {
    software:        { tone: 'var(--val-software)', width: 2.4, dash: '',    emphasis: true },
    semiconductors:  { tone: 'var(--val-semis)',    width: 1.6, dash: '' },
    pharmaceuticals: { tone: 'var(--val-pharma)',   width: 1.6, dash: '7 4' },
    automotive:      { tone: 'var(--val-auto)',     width: 1.7, dash: '2 4' }
  };

  var years = DATA.years.slice();
  var x0 = years[0], x1 = years[years.length - 1];
  var series = DATA.series.map(function (s, i) {
    var st = STYLE[s.id] || { tone: 'var(--on-dark-mid)', width: 1.6, dash: '' };
    var pts = [];
    s.spread.forEach(function (v, k) { if (typeof v === 'number' && years[k] !== undefined) pts.push({ year: years[k], value: v }); });
    return { id: s.id, order: i, label: s.label, tone: st.tone, width: st.width, dash: st.dash, emphasis: !!st.emphasis, pts: pts, last: pts[pts.length - 1] };
  }).filter(function (s) { return s.pts.length > 1; });
  if (!series.length) { host.setAttribute('hidden', ''); return; }
  /* Emphasis drawn last so it sits on top. */
  var drawOrder = series.slice().sort(function (a, b) { return (a.emphasis ? 1 : 0) - (b.emphasis ? 1 : 0); });

  var NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs) {
    var n = doc.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    return n;
  }
  /* Signed, one decimal, a real minus sign. */
  function fmt(v) {
    var a = Math.abs(v).toFixed(1);
    if (a === '0.0') return '0.0';
    return (v < 0 ? '−' : '+') + a;
  }
  function fmtPP(v) { return fmt(v) + 'pp'; }

  function describe() {
    var ends = series.slice().sort(function (a, b) { return b.last.value - a.last.value; })
      .map(function (s) { return s.label + ' ' + fmt(s.last.value); }).join(', ');
    return 'Line chart of the value-creation spread, return on capital less cost of capital, in percentage points for ' +
      series.length + ' global industries, ' + x0 + ' to ' + x1 + '. In ' + x1 + ': ' + ends +
      ' percentage points. Above zero an industry earns more than its cost of capital. Use the left and right arrow keys to read each year.';
  }

  /* ---------- state that survives a rebuild ---------- */
  var prog = series.map(function () { return 0; });    /* 0..1 reveal per line */
  var done = series.map(function () { return false; }); /* end label shown */
  var built = null;
  var lastWidth = 0;
  var clipSeq = 0;
  var focusYear = x1;

  function measureText(svg, text, cls) {
    var t = el('text', { class: cls, x: -9999, y: -9999 });
    t.textContent = text;
    svg.appendChild(t);
    var w = 0;
    try { w = t.getComputedTextLength(); } catch (e) { w = text.length * 7; }
    svg.removeChild(t);
    return w;
  }

  function build() {
    var width = Math.max(280, Math.round(frame.getBoundingClientRect().width));
    if (!width) return;
    lastWidth = width;
    frame.innerHTML = '';

    var narrow = width < 560;
    var W = width;
    var H = narrow ? Math.round(width * 0.82) : Math.round(width * 0.46);
    H = Math.max(240, Math.min(H, 470));

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', tabindex: '0' });
    svg.setAttribute('aria-label', host.getAttribute('data-alt') || describe());
    var title = el('title'); title.textContent = 'Where does growth actually create value?';
    svg.appendChild(title);
    frame.appendChild(svg);

    /* Right margin reserved for the end labels: measured, not guessed. On a
       narrow screen the label breaks into two lines, name over value. */
    var labelW = 0;
    series.forEach(function (s) {
      var name = measureText(svg, s.label, 'val-label');
      var val = measureText(svg, fmtPP(s.last.value), 'val-label val-num');
      labelW = Math.max(labelW, narrow ? Math.max(name, val) : name + 8 + val);
    });
    labelW = Math.max(labelW, measureText(svg, narrow ? 'Earns cost' : 'Earns cost of capital', 'val-zero-label') - 8);
    var PAD = { t: 22, r: Math.ceil(labelW) + 22, b: 30, l: narrow ? 34 : 40 };

    var vals = [];
    series.forEach(function (s) { s.pts.forEach(function (p) { vals.push(p.value); }); });
    var minV = Math.min.apply(null, vals), maxV = Math.max.apply(null, vals);
    var lo = Math.min(-8, Math.floor(minV) - 2);
    var hi = Math.max(16, Math.ceil(maxV) + 2);

    function X(y) { return PAD.l + (y - x0) / (x1 - x0) * (W - PAD.l - PAD.r); }
    function Y(v) { return PAD.t + (hi - v) / (hi - lo) * (H - PAD.t - PAD.b); }

    /* A few restrained reference lines, then the zero line, which is the
       point of the chart and carries its own name. */
    for (var gv = Math.ceil(lo / 5) * 5; gv <= hi; gv += 5) {
      if (gv === 0 || gv === lo || gv === hi) continue;
      svg.appendChild(el('line', { x1: PAD.l, x2: W - PAD.r, y1: Y(gv), y2: Y(gv), class: 'gridline' }));
      var lab = el('text', { x: PAD.l - 8, y: Y(gv) + 3.5, class: 'axis-label', 'text-anchor': 'end' });
      lab.textContent = fmt(gv).replace('.0', '');
      svg.appendChild(lab);
    }
    svg.appendChild(el('line', { x1: PAD.l, x2: W - PAD.r, y1: Y(0), y2: Y(0), class: 'val-zero' }));
    var zeroLab = el('text', { x: PAD.l - 8, y: Y(0) + 3.5, class: 'axis-label', 'text-anchor': 'end' });
    zeroLab.textContent = '0';
    svg.appendChild(zeroLab);
    var unit = el('text', { x: PAD.l - 8, y: PAD.t - 8, class: 'val-unit', 'text-anchor': 'end' });
    unit.textContent = 'pp';
    svg.appendChild(unit);
    /* The zero line's name sits at its right end, in the label margin,
       where no series can cross it; two lines on a phone. */
    var zeroName = el('text', { x: W - PAD.r + 7, y: Y(0) + (narrow ? -1.5 : 3.5), class: 'val-zero-label' });
    if (narrow) {
      var z1 = el('tspan'); z1.textContent = 'Earns cost';
      var z2 = el('tspan', { x: W - PAD.r + 7, dy: 11 }); z2.textContent = 'of capital';
      zeroName.appendChild(z1); zeroName.appendChild(z2);
    } else {
      zeroName.textContent = 'Earns cost of capital';
    }
    svg.appendChild(zeroName);

    /* year ticks: every second year, or the ends and the middle on a phone */
    years.forEach(function (y) {
      var mid = x0 + Math.round((x1 - x0) / 2);
      if (narrow ? (y !== x0 && y !== x1 && y !== mid) : ((y - x0) % 2 !== 0)) return;
      var t = el('text', { x: X(y), y: H - PAD.b + 19, class: 'axis-label', 'text-anchor': y === x0 ? 'start' : y === x1 ? 'end' : 'middle' });
      t.textContent = String(y);
      svg.appendChild(t);
    });

    function d(pts) {
      return pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.year).toFixed(2) + ' ' + Y(p.value).toFixed(2); }).join(' ');
    }

    /* the lines, each behind its own left-to-right clip */
    var defs = el('defs');
    svg.appendChild(defs);
    var span = W - PAD.r - PAD.l + 8;
    var clips = {};
    drawOrder.forEach(function (s) {
      var id = 'valClip' + (++clipSeq);
      var cp = el('clipPath', { id: id });
      var rect = el('rect', { x: PAD.l - 4, y: 0, width: 0, height: H });
      cp.appendChild(rect);
      defs.appendChild(cp);
      var p = el('path', { d: d(s.pts), class: 'val-line' + (s.emphasis ? ' is-emphasis' : ''), 'clip-path': 'url(#' + id + ')' });
      p.style.stroke = s.tone;
      p.style.strokeWidth = s.width;
      if (s.dash) p.style.strokeDasharray = s.dash;
      svg.appendChild(p);
      clips[s.id] = rect;
    });

    /* end labels, de-collided vertically, with a short leader when moved */
    var ends = series.map(function (s) { return { s: s, x: X(s.last.year), y: Y(s.last.value) }; });
    var minGap = narrow ? 31 : 19;
    var sorted = ends.slice().sort(function (a, b) { return a.y - b.y; });
    sorted.forEach(function (e) { e.ly = e.y; });
    for (var pass = 0; pass < 6; pass++) {
      for (var k = 1; k < sorted.length; k++) {
        if (sorted[k].ly - sorted[k - 1].ly < minGap) sorted[k].ly = sorted[k - 1].ly + minGap;
      }
      var over = sorted[sorted.length - 1].ly - (H - PAD.b - 2);
      if (over > 0) {
        for (var m = sorted.length - 1; m >= 0; m--) {
          sorted[m].ly -= over;
          if (m > 0 && sorted[m].ly - sorted[m - 1].ly >= minGap) break;
        }
      }
      var under = (PAD.t + 6) - sorted[0].ly;
      if (under > 0) {
        for (var q = 0; q < sorted.length; q++) {
          sorted[q].ly += under;
          if (q < sorted.length - 1 && sorted[q + 1].ly - sorted[q].ly >= minGap) break;
        }
      }
    }
    var labels = {};
    ends.forEach(function (e) {
      var grp = el('g', { class: 'val-end' + (e.s.emphasis ? ' is-emphasis' : '') });
      var ring = el('circle', { cx: e.x, cy: e.y, r: 3, class: 'val-pulse' });
      ring.style.stroke = e.s.tone;
      grp.appendChild(ring);
      var dot = el('circle', { cx: e.x, cy: e.y, r: e.s.emphasis ? 3.6 : 3, class: 'val-end-dot' });
      dot.style.fill = e.s.tone;
      grp.appendChild(dot);
      if (Math.abs(e.ly - e.y) > 2) {
        grp.appendChild(el('line', { x1: e.x + 5, x2: e.x + 12, y1: e.y, y2: e.ly, class: 'val-end-rule' }));
      }
      var t = el('text', { x: e.x + 15, y: narrow ? e.ly - 2 : e.ly + 4, class: 'val-label' });
      var name = el('tspan'); name.textContent = e.s.label + (narrow ? '' : '  ');
      var val = el('tspan', { class: 'val-num' });
      if (narrow) { val.setAttribute('x', e.x + 15); val.setAttribute('dy', 14); }
      val.textContent = fmtPP(e.s.last.value);
      t.appendChild(name);
      t.appendChild(val);
      grp.appendChild(t);
      svg.appendChild(grp);
      labels[e.s.id] = { grp: grp, ring: ring, dot: dot };
    });

    function render(i, t) {
      var rect = clips[series[i].id];
      if (rect) rect.setAttribute('width', Math.max(0, span * t).toFixed(1));
    }
    function finish(i, pulse) {
      var l = labels[series[i].id];
      if (!l) return;
      l.grp.classList.add('is-on');
      if (pulse && motion && g) {
        g.fromTo(l.ring, { attr: { r: 3 }, opacity: 0.7 }, { attr: { r: 13 }, opacity: 0, duration: 0.8, ease: 'power2.out' });
      }
    }

    /* ---------- reading a year: pointer, touch, keyboard ---------- */
    var hover = el('g');
    var rule = el('line', { class: 'hover-rule', y1: PAD.t, y2: H - PAD.b });
    rule.style.opacity = 0;
    hover.appendChild(rule);
    var dots = series.map(function (s) {
      var c = el('circle', { class: 'hover-dot', r: 4 });
      c.style.fill = s.tone;
      c.style.opacity = 0;
      hover.appendChild(c);
      return c;
    });
    svg.appendChild(hover);

    var tip = doc.createElement('div');
    tip.className = 'figure-tip';
    tip.setAttribute('aria-hidden', 'true');
    frame.appendChild(tip);
    var live = host.querySelector('[data-value-live]');
    var shown = null;

    function hide() {
      shown = null;
      rule.style.opacity = 0;
      dots.forEach(function (c) { c.style.opacity = 0; });
      tip.classList.remove('is-on');
    }
    function show(year, announce) {
      year = Math.max(x0, Math.min(x1, year));
      shown = year;
      focusYear = year;
      var cx = X(year);
      rule.setAttribute('x1', cx); rule.setAttribute('x2', cx);
      rule.style.opacity = 1;
      var rows = [];
      series.forEach(function (s, i) {
        var pt = null;
        for (var j = 0; j < s.pts.length; j++) if (s.pts[j].year === year) { pt = s.pts[j]; break; }
        if (!pt) { dots[i].style.opacity = 0; return; }
        dots[i].setAttribute('cx', cx);
        dots[i].setAttribute('cy', Y(pt.value));
        dots[i].style.opacity = 1;
        rows.push({ s: s, v: pt.value });
      });
      rows.sort(function (a, b) { return b.v - a.v; });
      var html = '<span class="tip-year">' + year + '</span><span class="tip-measure">Return on capital less cost of capital</span>';
      rows.forEach(function (r) {
        html += '<span class="tip-row"><span class="tip-swatch" style="background:' + r.s.tone + '"></span>' +
                r.s.label + '&nbsp;&nbsp;<b>' + fmtPP(r.v) + '</b></span>';
      });
      tip.innerHTML = html;
      tip.classList.add('is-on');
      var fr = frame.getBoundingClientRect();
      var tx = (cx / W) * fr.width;
      var flip = tx > fr.width * 0.55;
      tip.style.left = tx + 'px';
      tip.style.top = '6px';
      tip.style.transform = 'translateX(' + (flip ? 'calc(-100% - 14px)' : '14px') + ')';
      if (announce && live) {
        live.textContent = year + '. Return on capital less cost of capital. ' +
          rows.map(function (r) { return r.s.label + ' ' + fmt(r.v).replace('−', 'minus ') + ' percentage points'; }).join(', ') + '.';
      }
    }
    function yearAt(ev) {
      var rect = svg.getBoundingClientRect();
      var px = (ev.clientX - rect.left) / rect.width * W;
      if (px < PAD.l - 10 || px > W - PAD.r + 10) return null;
      return Math.round(x0 + (px - PAD.l) / (W - PAD.r - PAD.l) * (x1 - x0));
    }
    svg.addEventListener('pointermove', function (ev) {
      if (ev.pointerType === 'touch') return;
      var y = yearAt(ev);
      if (y === null) hide(); else show(y, false);
    });
    svg.addEventListener('pointerdown', function (ev) {
      if (ev.pointerType !== 'touch') return;
      var y = yearAt(ev);
      if (y !== null) { if (shown === y) hide(); else show(y, false); }
    });
    svg.addEventListener('pointerleave', function (ev) { if (ev.pointerType !== 'touch') hide(); });
    svg.addEventListener('keydown', function (ev) {
      var k = ev.key;
      var cur = shown === null ? focusYear : shown;
      if (k === 'ArrowRight' || k === 'ArrowUp') { show(Math.min(x1, cur + (shown === null ? 0 : 1)), true); }
      else if (k === 'ArrowLeft' || k === 'ArrowDown') { show(Math.max(x0, cur - (shown === null ? 0 : 1)), true); }
      else if (k === 'Home') { show(x0, true); }
      else if (k === 'End') { show(x1, true); }
      else if (k === 'Escape') { hide(); }
      else return;
      ev.preventDefault();
    });
    svg.addEventListener('blur', hide);

    built = { render: render, finish: finish, hide: hide };
    series.forEach(function (s, i) {
      render(i, prog[i]);
      if (done[i]) finish(i, false);
    });
  }

  /* a tap anywhere else puts the flag away */
  doc.addEventListener('pointerdown', function (ev) {
    if (built && ev.pointerType === 'touch' && !frame.contains(ev.target)) built.hide();
  }, { passive: true });

  build();

  /* ---------- the cards: the same four figures, counted into place ---------- */
  var counters = Array.prototype.slice.call(doc.querySelectorAll('[data-value-count]'));
  function orderOf(id) {
    for (var i = 0; i < series.length; i++) if (series[i].id === id) return series[i].order;
    return 0;
  }

  /* ---------- draw on load, in step with the hero timeline ---------- */
  if (!motion) {
    series.forEach(function (s, i) { prog[i] = 1; done[i] = true; built.render(i, 1); built.finish(i, false); });
    counters.forEach(function (node) {
      var v = parseFloat(node.getAttribute('data-value-count'));
      if (!isNaN(v)) node.textContent = fmt(v);
    });
  } else {
    series.forEach(function (s, i) {
      var st = { t: 0 };
      g.to(st, {
        t: 1,
        duration: DRAW_S,
        ease: 'power1.inOut',
        delay: delay + s.order * STAGGER_S,
        onUpdate: function () { prog[i] = st.t; if (built) built.render(i, st.t); },
        onComplete: function () { prog[i] = 1; done[i] = true; if (built) { built.render(i, 1); built.finish(i, true); } }
      });
    });
    counters.forEach(function (node) {
      var target = parseFloat(node.getAttribute('data-value-count'));
      if (isNaN(target)) return;
      var st = { v: 0 };
      node.textContent = fmt(0);
      g.to(st, {
        v: target,
        duration: DRAW_S,
        ease: 'power2.out',
        delay: delay + orderOf(node.getAttribute('data-series')) * STAGGER_S,
        onUpdate: function () { node.textContent = fmt(st.v); },
        onComplete: function () { node.textContent = fmt(target); }
      });
    });
  }

  /* ---------- rebuild on a real width change ---------- */
  var timer = null;
  function onResize() {
    window.clearTimeout(timer);
    timer = window.setTimeout(function () {
      var w = Math.round(frame.getBoundingClientRect().width);
      if (w && Math.abs(w - lastWidth) > 8) build();
    }, 160);
  }
  if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(frame);
  else window.addEventListener('resize', onResize);
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { if (built) build(); });
})();
