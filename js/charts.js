/* ==========================================================================
   Finance-native figures, V8.

   Every visual drawn here is a chart of a real, sourced series, baked to
   assets/data/macro.js from World Bank Open Data at build time. The page
   draws real numbers without making a network call to anyone.

   The rule this file inherits from V6 and keeps: nothing animates that is
   not a measurement. No decorative motion, no invented series, no implied
   live feed. GSAP drives the clocks; the data drives everything else.
   ========================================================================== */

(function () {
  'use strict';

  var M = window.MACRO;
  var doc = document;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var g = window.gsap;
  var motion = !!g && !reduce && doc.documentElement.classList.contains('anim');

  var stages = Array.prototype.slice.call(doc.querySelectorAll('[data-figure]'));
  var sparkRows = Array.prototype.slice.call(doc.querySelectorAll('[data-spark]'));
  var counters = Array.prototype.slice.call(doc.querySelectorAll('[data-count]'));
  var barFigs = Array.prototype.slice.call(doc.querySelectorAll('.article-figure'));

  if (!M) {
    /* A figure that cannot prove its numbers should not appear at all. */
    stages.forEach(function (s) { s.setAttribute('hidden', ''); });
    sparkRows.forEach(function (s) { s.setAttribute('hidden', ''); });
    return;
  }

  /* ---------- helpers ---------- */

  var NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs) {
    var n = doc.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    return n;
  }
  function seriesToPoints(obj) {
    return Object.keys(obj)
      .map(Number).sort(function (a, b) { return a - b; })
      .map(function (y) { return { year: y, value: obj[String(y)] }; });
  }
  function fmt(mode, v, dp) {
    if (mode === 'usdbn') {
      return v >= 1000 ? '$' + (v / 1000).toFixed(2) + 'tn' : '$' + Math.round(v) + 'bn';
    }
    if (mode === 'pct') {
      return (v > 0 ? '+' : '') + v.toFixed(dp === undefined ? 1 : dp) + '%';
    }
    if (mode === 'pctplain') {
      return v.toFixed(dp === undefined ? 1 : dp) + '%';
    }
    return String(v);
  }
  function axisLabel(mode, v) {
    if (mode === 'usdbn') {
      if (v === 0) return '0';
      return v % 1000 === 0 ? '$' + (v / 1000) + 'tn' : '';
    }
    return v > 0 ? '+' + v : String(v);
  }

  /* ---------- the figure ---------- */

  function buildFigure(stage) {
    var key = stage.getAttribute('data-figure');
    var main = M[key];
    var frame = stage.querySelector('.figure-frame');
    if (!main || !frame) { stage.setAttribute('hidden', ''); return null; }

    var mode = stage.getAttribute('data-mode') || 'pct';
    var pts = seriesToPoints(main);
    var peerKeys = (stage.getAttribute('data-peers') || '').split(',').filter(Boolean);
    var isHero = stage.hasAttribute('data-hero');

    /* A phone-width frame gets a viewBox its own size so the labels stay
       legible; the CSS aspect (4:3 under 720px) is matched so the SVG fills
       the frame without letterboxing. Desktop keeps the 1000-unit canvas. */
    var fw = Math.round(frame.getBoundingClientRect().width);
    var narrow = fw > 0 && fw < 700;
    var W = narrow ? Math.max(300, fw) : 1000;
    var H = narrow ? Math.round(W * 0.75) : (isHero ? 430 : 500);
    var PAD = narrow ? { t: 22, r: 50, b: 30, l: 4 } : { t: 26, r: 62, b: 34, l: 6 };

    var years = pts.map(function (p) { return p.year; });
    var allVals = pts.map(function (p) { return p.value; });
    peerKeys.forEach(function (k) {
      if (M[k]) seriesToPoints(M[k]).forEach(function (p) { allVals.push(p.value); });
    });
    var lo = Math.min.apply(null, allVals), hi = Math.max.apply(null, allVals);
    if (mode === 'usdbn') {
      lo = 0;
      hi = Math.ceil(hi / 500) * 500;
    } else {
      lo = Math.min(0, Math.floor(lo - 1));
      hi = Math.ceil(hi + 1);
    }

    var x0 = Math.min.apply(null, years), x1 = Math.max.apply(null, years);
    function X(y) { return PAD.l + (y - x0) / (x1 - x0) * (W - PAD.l - PAD.r); }
    function Y(v) { return PAD.t + (hi - v) / (hi - lo) * (H - PAD.t - PAD.b); }

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    svg.setAttribute('aria-label', stage.getAttribute('data-alt') || 'Chart of a sourced data series');

    /* gridlines */
    var step = mode === 'usdbn' ? 1000 : Math.ceil((hi - lo) / 6);
    for (var gv = Math.ceil(lo / step) * step; gv <= hi; gv += step) {
      svg.appendChild(el('line', {
        x1: PAD.l, x2: W - PAD.r, y1: Y(gv), y2: Y(gv),
        class: gv === 0 ? 'zeroline' : 'gridline'
      }));
      var lab = el('text', { x: W - PAD.r + 8, y: Y(gv) + 3.5, class: 'axis-label' });
      lab.textContent = axisLabel(mode, gv);
      svg.appendChild(lab);
    }

    /* year ticks: first, last, decades */
    var tickEvery = ((x1 - x0) > 40 || narrow) ? 10 : 5;
    years.forEach(function (y) {
      if (y !== x0 && y !== x1 && y % tickEvery !== 0) return;
      if (y !== x0 && y !== x1 && (Math.abs(y - x0) < (narrow ? 4 : 3) || Math.abs(y - x1) < (narrow ? 4 : 3))) return;
      var t = el('text', { x: X(y), y: H - PAD.b + 20, class: 'axis-label', 'text-anchor': 'middle' });
      t.textContent = String(y);
      svg.appendChild(t);
    });

    function d(points) {
      return points.map(function (p, i) {
        return (i ? 'L' : 'M') + X(p.year).toFixed(2) + ' ' + Y(p.value).toFixed(2);
      }).join(' ');
    }

    /* peers under the subject; fixed tone order; legend built from the
       same loop so it cannot drift out of step with the lines. */
    var PEER_TONES = ['var(--series-peer)', 'var(--series-peer-2)', 'var(--series-peer-3)'];
    var peerLabels = (stage.getAttribute('data-peer-labels') || '').split(',');
    var peerPaths = [];
    var peerSeries = [];
    var legend = [];
    peerKeys.forEach(function (k, i) {
      if (!M[k]) return;
      var tone = PEER_TONES[i % PEER_TONES.length];
      var sp = seriesToPoints(M[k]);
      var p = el('path', { d: d(sp), class: 'series-peer' });
      p.style.stroke = tone;
      svg.appendChild(p);
      peerPaths.push(p);
      peerSeries.push({ label: (peerLabels[i] || k).trim(), pts: sp, tone: tone });
      legend.push({ label: (peerLabels[i] || k).trim(), tone: tone });
    });

    var head = stage.querySelector('.figure-head');
    if (head && peerKeys.length && !stage.querySelector('.figure-legend')) {
      var ul = doc.createElement('ul');
      ul.className = 'figure-legend';
      [{ label: stage.getAttribute('data-subject-label') || 'India', tone: 'var(--series-india)' }]
        .concat(legend).forEach(function (s) {
          var li = doc.createElement('li');
          var sw = doc.createElement('span');
          sw.className = 'legend-swatch';
          sw.style.background = s.tone;
          li.appendChild(sw);
          li.appendChild(doc.createTextNode(s.label));
          ul.appendChild(li);
        });
      head.parentNode.insertBefore(ul, head.nextSibling);
    }

    /* subject: area then line */
    var area = el('path', {
      d: d(pts) + ' L' + X(x1).toFixed(2) + ' ' + Y(Math.max(0, lo)).toFixed(2) +
         ' L' + X(x0).toFixed(2) + ' ' + Y(Math.max(0, lo)).toFixed(2) + ' Z',
      class: 'series-area'
    });
    svg.appendChild(area);
    var line = el('path', { d: d(pts), class: 'series-line' });
    svg.appendChild(line);

    /* annotations: real observations, named honestly */
    var notes = [];
    try { notes = JSON.parse(stage.getAttribute('data-notes') || '[]'); } catch (e) { notes = []; }
    var annots = notes.map(function (n) {
      var pt = pts.filter(function (p) { return p.year === n.year; })[0];
      if (!pt) return null;
      var gEl = el('g', { class: 'annot' });
      var up = Y(pt.value) > H / 2;
      gEl.appendChild(el('line', {
        x1: X(pt.year), x2: X(pt.year),
        y1: Y(pt.value), y2: up ? Y(pt.value) - 44 : Y(pt.value) + 44,
        class: 'annot-rule'
      }));
      gEl.appendChild(el('circle', { cx: X(pt.year), cy: Y(pt.value), class: 'annot-dot' }));
      var ty = up ? Y(pt.value) - 54 : Y(pt.value) + 60;
      /* On a phone-width canvas a note anchored to the right of its point
         runs off the frame, so the flip happens earlier. */
      var anchor = X(pt.year) > W * (narrow ? 0.52 : 0.72) ? 'end' : 'start';
      var t1 = el('text', { x: X(pt.year) + (anchor === 'end' ? -8 : 8), y: ty, class: 'annot-val', 'text-anchor': anchor });
      t1.textContent = fmt(mode, pt.value);
      var t2 = el('text', { x: X(pt.year) + (anchor === 'end' ? -8 : 8), y: ty + 16, class: 'annot-note', 'text-anchor': anchor });
      t2.textContent = n.label;
      gEl.appendChild(t1); gEl.appendChild(t2);
      svg.appendChild(gEl);
      return { g: gEl, at: (pt.year - x0) / (x1 - x0) };
    }).filter(Boolean);

    frame.appendChild(svg);

    var lineLen = line.getTotalLength();
    line.style.strokeDasharray = lineLen;
    var peerLens = peerPaths.map(function (p) {
      var L = p.getTotalLength();
      p.style.strokeDasharray = L;
      return L;
    });

    var figEl = stage.querySelector('[data-readout-fig]');
    var yearEl = stage.querySelector('[data-readout-year]');
    var phases = Array.prototype.slice.call(stage.querySelectorAll('.phase'));
    var areaAlpha = parseFloat(stage.getAttribute('data-area') || '0.08');

    function render(t) {
      line.style.strokeDashoffset = lineLen * (1 - t);
      area.style.opacity = (t * areaAlpha).toFixed(3);
      peerPaths.forEach(function (p, i) {
        p.style.strokeDashoffset = peerLens[i] * (1 - t);
        p.style.opacity = t > 0.55 ? 1 : 0;
        p.style.transition = 'opacity 0.6s';
      });
      var idx = Math.min(pts.length - 1, Math.max(0, Math.round(t * (pts.length - 1))));
      var cur = pts[idx];
      if (figEl) figEl.textContent = fmt(mode, cur.value);
      if (yearEl) yearEl.textContent = String(cur.year);
      annots.forEach(function (a) { a.g.classList.toggle('is-on', t >= a.at - 0.005); });
      phases.forEach(function (ph) {
        var from = +ph.getAttribute('data-from'), to = +ph.getAttribute('data-to');
        ph.classList.toggle('is-on', cur.year >= from && cur.year <= to);
      });
    }

    /* ---------- the hover layer: crosshair + value flag ---------- */
    var allSeries = [{ label: stage.getAttribute('data-subject-label') || 'India', pts: pts, tone: 'var(--series-india)' }]
      .concat(peerSeries);
    buildHover(stage, frame, svg, allSeries, X, Y, x0, x1, mode, PAD, W, H);

    return { render: render, el: stage };
  }

  function buildHover(stage, frame, svg, series, X, Y, x0, x1, mode, PAD, W, H) {
    var hover = el('g', { class: 'figure-hover-g' });
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

    function hide() {
      rule.style.opacity = 0;
      dots.forEach(function (c) { c.style.opacity = 0; });
      tip.classList.remove('is-on');
    }

    svg.addEventListener('pointermove', function (ev) {
      var rect = svg.getBoundingClientRect();
      var px = (ev.clientX - rect.left) / rect.width * W;
      if (px < PAD.l || px > W - PAD.r) { hide(); return; }
      var year = Math.round(x0 + (px - PAD.l) / (W - PAD.r - PAD.l) * (x1 - x0));
      year = Math.max(x0, Math.min(x1, year));
      var cx = X(year);
      rule.setAttribute('x1', cx); rule.setAttribute('x2', cx);
      rule.style.opacity = 1;

      var rows = '<span class="tip-year">' + year + '</span>';
      series.forEach(function (s, i) {
        var pt = null;
        for (var j = 0; j < s.pts.length; j++) if (s.pts[j].year === year) { pt = s.pts[j]; break; }
        if (!pt) { dots[i].style.opacity = 0; return; }
        dots[i].setAttribute('cx', cx);
        dots[i].setAttribute('cy', Y(pt.value));
        dots[i].style.opacity = 1;
        rows += '<span class="tip-row"><span class="tip-swatch" style="background:' + s.tone + '"></span>' +
                s.label + '&nbsp;&nbsp;' + fmt(mode, pt.value) + '</span>';
      });
      tip.innerHTML = rows;
      tip.classList.add('is-on');

      var fr = frame.getBoundingClientRect();
      var tx = (cx / W) * fr.width;
      var flip = tx > fr.width * 0.66;
      tip.style.left = tx + 'px';
      tip.style.top = '8px';
      tip.style.transform = 'translateX(' + (flip ? 'calc(-100% - 14px)' : '14px') + ')';
    });
    svg.addEventListener('pointerleave', hide);
  }

  /* ---------- wire the draw modes ---------- */

  stages.forEach(function (stage) {
    var api = buildFigure(stage);
    if (!api) return;
    var mode = stage.getAttribute('data-draw') || 'enter';

    if (!motion) { api.render(1); return; }

    if (mode === 'load') {
      api.render(0);
      var state = { t: 0 };
      g.to(state, {
        t: 1,
        duration: 2.4,
        ease: 'power2.inOut',
        delay: parseFloat(stage.getAttribute('data-delay') || '0.5'),
        onUpdate: function () { api.render(state.t); }
      });
    } else if (mode === 'scrub') {
      api.render(0);
      window.ScrollTrigger.create({
        trigger: stage,
        start: 'top 70%',
        end: 'bottom bottom',
        scrub: 0.4,
        onUpdate: function (self) { api.render(self.progress); }
      });
    } else {
      api.render(0);
      var state2 = { t: 0 };
      window.ScrollTrigger.create({
        trigger: stage,
        start: 'top 72%',
        once: true,
        onEnter: function () {
          g.to(state2, {
            t: 1, duration: 1.6, ease: 'power2.inOut',
            onUpdate: function () { api.render(state2.t); }
          });
        }
      });
    }
  });

  /* ---------- sparklines ---------- */

  function buildSpark(row) {
    var series = M[row.getAttribute('data-spark')];
    var host = row.querySelector('.uncov-spark');
    if (!series || !host) { row.setAttribute('hidden', ''); return; }

    var pts = seriesToPoints(series);
    var W = 210, H = 48, P = 4;
    var vals = pts.map(function (p) { return p.value; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var span = (hi - lo) || 1;
    var x0 = pts[0].year, x1 = pts[pts.length - 1].year;
    function sx(y) { return P + (y - x0) / (x1 - x0) * (W - P * 2); }
    function sy(v) { return P + (hi - v) / span * (H - P * 2); }

    var d = pts.map(function (p, i) {
      return (i ? 'L' : 'M') + sx(p.year).toFixed(1) + ' ' + sy(p.value).toFixed(1);
    }).join(' ');

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true', focusable: 'false' });
    var path = el('path', { d: d, class: 'spark-line' });
    svg.appendChild(path);
    var end = el('circle', { class: 'spark-end', cx: sx(x1), cy: sy(pts[pts.length - 1].value) });
    svg.appendChild(end);
    host.appendChild(svg);

    var unit = row.getAttribute('data-unit') || '';
    var dp = parseInt(row.getAttribute('data-dp'), 10);
    if (isNaN(dp) || dp < 0 || dp > 4) dp = 0;
    var fromEl = row.querySelector('[data-spark-from]');
    var toEl = row.querySelector('[data-spark-to]');
    if (unit === 'bn') {
      if (fromEl) fromEl.textContent = pts[0].year + '  $' + pts[0].value.toFixed(dp) + 'bn';
      if (toEl) toEl.textContent = x1 + '  $' + pts[pts.length - 1].value.toFixed(dp) + 'bn';
    } else {
      if (fromEl) fromEl.textContent = pts[0].year + '  ' + pts[0].value.toFixed(dp) + unit;
      if (toEl) toEl.textContent = x1 + '  ' + pts[pts.length - 1].value.toFixed(dp) + unit;
    }

    var len = path.getTotalLength();
    if (motion) {
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len;
      end.style.opacity = 0;
      window.ScrollTrigger.create({
        trigger: row,
        start: 'top 78%',
        once: true,
        onEnter: function () {
          g.to(path, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.out' });
          g.to(end, { opacity: 1, duration: 0.3, delay: 0.95 });
        }
      });
    }
  }
  sparkRows.forEach(buildSpark);

  /* ---------- counters: real readouts that settle into place ---------- */

  counters.forEach(function (node) {
    var target = parseFloat(node.getAttribute('data-count'));
    if (isNaN(target)) return;
    var dp = parseInt(node.getAttribute('data-dp') || '0', 10);
    var prefix = node.getAttribute('data-prefix') || '';
    var suffix = node.getAttribute('data-suffix') || '';
    var showSign = node.hasAttribute('data-sign');

    function print(v) {
      var s = v.toFixed(dp);
      if (showSign && v > 0) s = '+' + s;
      node.textContent = prefix + s + suffix;
    }
    if (!motion) { print(target); return; }
    print(0);
    var state = { v: 0 };
    window.ScrollTrigger.create({
      trigger: node,
      start: 'top 88%',
      once: true,
      onEnter: function () {
        g.to(state, {
          v: target,
          duration: 1.4,
          ease: 'power3.out',
          onUpdate: function () { print(state.v); }
        });
      }
    });
  });

  /* ---------- article bar charts ---------- */

  barFigs.forEach(function (fig) {
    var bars = Array.prototype.slice.call(fig.querySelectorAll('.chart-bar'));
    if (!bars.length) return;
    if (!motion) return;
    g.set(bars, { scaleX: 0, transformOrigin: 'left center' });
    window.ScrollTrigger.create({
      trigger: fig,
      start: 'top 80%',
      once: true,
      onEnter: function () {
        g.to(bars, { scaleX: 1, duration: 0.9, ease: 'power3.out', stagger: 0.1 });
      }
    });
  });
})();
