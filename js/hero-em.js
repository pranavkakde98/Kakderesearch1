/* ==========================================================================
   The comparative hero figure, V9.

   One exhibit, five emerging markets, one measure: real GDP indexed to a
   common base year, chained from the World Bank's annual real-growth
   series in assets/data/macro-em.js. Nothing here is estimated: each
   point is 100 compounded through the reported growth rates, and the
   figure stops at the last reported year for every line.

   What it does differently from charts.js:
   - it renders to the width it is given (fixed type sizes, a viewBox
     rebuilt on resize) so a phone gets a legible chart, not a shrunk one;
   - every line is named at its right end with its multiple, so colour is
     never the only key; labels are de-collided before they are placed;
   - the subject line (India) is drawn last, heavier, in the accent.
   Motion is opt-in through html.anim like everything else on the site.
   ========================================================================== */

(function () {
  'use strict';

  var doc = document;
  var host = doc.querySelector('[data-hero-em]');
  var EM = window.MACRO_EM;
  if (!host) return;
  if (!EM || !EM.series || !EM.series.gdp_growth) { host.setAttribute('hidden', ''); return; }

  var g = window.gsap;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var motion = !!g && !reduce && doc.documentElement.classList.contains('anim');

  var NAMES = { IND: 'India', CHN: 'China', IDN: 'Indonesia', VNM: 'Vietnam', BRA: 'Brazil', MEX: 'Mexico', ZAF: 'South Africa', USA: 'United States' };
  var TONES = { IND: 'var(--em-ind)', CHN: 'var(--em-chn)', VNM: 'var(--em-vnm)', IDN: 'var(--em-idn)', MEX: 'var(--em-mex)', BRA: 'var(--em-bra)', ZAF: 'var(--em-mex)', USA: 'var(--em-vnm)' };

  var isos = (host.getAttribute('data-series') || 'IND,CHN,VNM,IDN,MEX').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var subject = host.getAttribute('data-subject') || 'IND';
  var base = parseInt(host.getAttribute('data-base') || '2000', 10);
  var frame = host.querySelector('.hero-chart');
  if (!frame) return;

  var NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs) {
    var n = doc.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    return n;
  }

  /* ---------- the index: 100 at the base year, chained forward ---------- */

  function indexSeries(iso) {
    var growth = EM.series.gdp_growth[iso];
    if (!growth) return null;
    var years = Object.keys(growth).map(Number).sort(function (a, b) { return a - b; });
    if (years.indexOf(base) === -1) return null;
    var pts = [{ year: base, value: 100 }];
    var v = 100;
    for (var y = base + 1; y <= years[years.length - 1]; y++) {
      var gr = growth[String(y)];
      if (gr === undefined || gr === null) break;   /* stop at the first gap: never bridge one */
      v = v * (1 + gr / 100);
      pts.push({ year: y, value: v });
    }
    return pts.length > 1 ? pts : null;
  }

  var series = isos.map(function (iso) {
    var pts = indexSeries(iso);
    return pts ? { iso: iso, label: NAMES[iso] || iso, tone: TONES[iso] || 'var(--on-dark-mid)', pts: pts, subject: iso === subject } : null;
  }).filter(Boolean);
  if (!series.length) { host.setAttribute('hidden', ''); return; }

  /* Subject drawn last so it sits on top. */
  series.sort(function (a, b) { return (a.subject ? 1 : 0) - (b.subject ? 1 : 0); });

  var lastYear = Math.min.apply(null, series.map(function (s) { return s.pts[s.pts.length - 1].year; }));
  var yearsAll = series[0].pts.map(function (p) { return p.year; }).filter(function (y) { return y <= lastYear; });
  var x0 = base, x1 = lastYear;

  /* Static text the markup can quote (latest year) — kept honest by the data. */
  Array.prototype.forEach.call(host.querySelectorAll('[data-hero-em-year]'), function (n) { n.textContent = String(lastYear); });

  /* An accessible name that states what the figure shows and where the lines end. */
  function describe() {
    var ends = series.slice().sort(function (a, b) { return b.pts[b.pts.length - 1].value - a.pts[a.pts.length - 1].value; })
      .map(function (s) { return s.label + ' ' + (s.pts[s.pts.length - 1].value / 100).toFixed(1) + ' times'; }).join(', ');
    return 'Line chart of real GDP indexed to ' + base + ' equals 100 for ' + series.length + ' emerging markets, ' + base + ' to ' + lastYear + '. By ' + lastYear + ': ' + ends + '.';
  }

  /* ---------- drawing ---------- */

  var built = null;   /* { render(t), svg, ... } */
  var lastWidth = 0;
  var progress = 0;   /* 0..1 draw progress; preserved across rebuilds */

  function measureText(svg, text, cls) {
    var t = el('text', { class: cls, x: -9999, y: -9999 });
    t.textContent = text;
    svg.appendChild(t);
    var w = 0;
    try { w = t.getComputedTextLength(); } catch (e) { w = text.length * 7; }
    svg.removeChild(t);
    return w;
  }

  function fmtMul(v) { return (v / 100).toFixed(1) + '×'; }

  function build() {
    var width = Math.max(280, Math.round(frame.getBoundingClientRect().width));
    if (!width) return;
    lastWidth = width;
    frame.innerHTML = '';

    var narrow = width < 560;
    var W = width;
    var H = narrow ? Math.round(width * 0.82) : Math.round(width * 0.46);
    H = Math.max(240, Math.min(H, 470));

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img' });
    svg.setAttribute('aria-label', host.getAttribute('data-alt') || describe());
    frame.appendChild(svg);

    /* Right margin reserved for the end labels: measured, not guessed. */
    var labelW = 0;
    series.forEach(function (s) {
      var name = narrow ? s.iso : s.label;
      var w = measureText(svg, name, 'em-label') + 6 + measureText(svg, fmtMul(s.pts[s.pts.length - 1].value), 'em-label em-val');
      labelW = Math.max(labelW, w);
    });
    var PAD = { t: 18, r: Math.ceil(labelW) + 22, b: 30, l: narrow ? 30 : 36 };

    var allVals = [];
    series.forEach(function (s) { s.pts.forEach(function (p) { if (p.year <= lastYear) allVals.push(p.value); }); });
    var lo = 100;   /* baseline is the floor: no space below 100, so the bottom reads horizontal */
    var hi = Math.max.apply(null, allVals);
    var step = hi > 600 ? 100 : hi > 300 ? 50 : 25;
    hi = Math.ceil(hi / step) * step;

    function X(y) { return PAD.l + (y - x0) / (x1 - x0) * (W - PAD.l - PAD.r); }
    function Y(v) { return PAD.t + (hi - v) / (hi - lo) * (H - PAD.t - PAD.b); }

    /* gridlines and left axis: index values */
    for (var gv = 100; gv <= hi; gv += step) {
      var isBase = gv === 100;
      svg.appendChild(el('line', { x1: PAD.l, x2: W - PAD.r, y1: Y(gv), y2: Y(gv), class: isBase ? 'em-baseline' : 'gridline' }));
      var lab = el('text', { x: PAD.l - 8, y: Y(gv) + 3.5, class: 'axis-label', 'text-anchor': 'end' });
      lab.textContent = String(gv);
      svg.appendChild(lab);
    }
    /* year ticks: base, last, and every fifth year between */
    yearsAll.forEach(function (y) {
      if (y !== x0 && y !== x1 && (y % 5 !== 0 || x1 - y < 3)) return;
      var t = el('text', { x: X(y), y: H - PAD.b + 19, class: 'axis-label', 'text-anchor': y === x0 ? 'start' : y === x1 ? 'end' : 'middle' });
      t.textContent = String(y);
      svg.appendChild(t);
    });

    function d(pts) {
      return pts.filter(function (p) { return p.year <= lastYear; }).map(function (p, i) {
        return (i ? 'L' : 'M') + X(p.year).toFixed(2) + ' ' + Y(p.value).toFixed(2);
      }).join(' ');
    }

    /* lines */
    var paths = series.map(function (s) {
      var p = el('path', { d: d(s.pts), class: 'em-line' + (s.subject ? ' is-subject' : '') });
      p.style.stroke = s.tone;
      svg.appendChild(p);
      return p;
    });

    /* end labels, de-collided vertically */
    var ends = series.map(function (s, i) {
      var last = s.pts.filter(function (p) { return p.year <= lastYear; }).pop();
      return { s: s, i: i, y: Y(last.value), x: X(last.year), value: last.value };
    });
    var minGap = 15;
    var sorted = ends.slice().sort(function (a, b) { return a.y - b.y; });
    sorted.forEach(function (e) { e.ly = e.y; });
    for (var pass = 0; pass < 6; pass++) {
      for (var k = 1; k < sorted.length; k++) {
        if (sorted[k].ly - sorted[k - 1].ly < minGap) sorted[k].ly = sorted[k - 1].ly + minGap;
      }
      /* keep the stack inside the frame by pushing up from the bottom */
      var over = sorted[sorted.length - 1].ly - (H - PAD.b - 2);
      if (over > 0) {
        for (var m = sorted.length - 1; m >= 0; m--) {
          sorted[m].ly -= over;
          if (m > 0 && sorted[m].ly - sorted[m - 1].ly >= minGap) break;
        }
      }
    }

    var labels = ends.map(function (e) {
      var grp = el('g', { class: 'em-end' + (e.s.subject ? ' is-subject' : '') });
      var dot = el('circle', { cx: e.x, cy: e.y, class: 'em-end-dot' + (e.s.subject ? ' is-subject' : '') });
      dot.style.fill = e.s.tone;
      grp.appendChild(dot);
      if (Math.abs(e.ly - e.y) > 2) {
        grp.appendChild(el('line', { x1: e.x + 5, x2: e.x + 12, y1: e.y, y2: e.ly, class: 'em-label-rule' }));
      }
      var t = el('text', { x: e.x + 15, y: e.ly + 4, class: 'em-label' + (e.s.subject ? ' is-subject' : '') });
      var name = doc.createTextNode((narrow ? e.s.iso : e.s.label) + '  ');
      var val = el('tspan', { class: 'em-val' });
      val.textContent = fmtMul(e.value);
      t.appendChild(name);
      t.appendChild(val);
      grp.appendChild(t);
      svg.appendChild(grp);
      return grp;
    });

    /* the reading note: base line named once, bottom-left */
    var note = el('text', { x: PAD.l + 6, y: Y(100) - 7, class: 'em-note' });
    note.textContent = base + ' = 100';
    svg.appendChild(note);

    /* draw state */
    var lens = paths.map(function (p) {
      var L = p.getTotalLength();
      p.style.strokeDasharray = L;
      return L;
    });

    function render(t) {
      progress = t;
      paths.forEach(function (p, i) { p.style.strokeDashoffset = lens[i] * (1 - t); });
      labels.forEach(function (l) { l.style.opacity = t >= 0.985 ? 1 : 0; l.style.transition = 'opacity 0.5s'; });
    }

    /* ---------- hover: crosshair + value flag, ranked for the year ---------- */
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
      var html = '<span class="tip-year">' + year + '</span>';
      rows.forEach(function (r) {
        html += '<span class="tip-row"><span class="tip-swatch" style="background:' + r.s.tone + '"></span>' +
                r.s.label + '&nbsp;&nbsp;' + fmtMul(r.v) + '</span>';
      });
      tip.innerHTML = html;
      tip.classList.add('is-on');
      var fr = frame.getBoundingClientRect();
      var tx = (cx / W) * fr.width;
      var flip = tx > fr.width * 0.6;
      tip.style.left = tx + 'px';
      tip.style.top = '6px';
      tip.style.transform = 'translateX(' + (flip ? 'calc(-100% - 14px)' : '14px') + ')';
    });
    svg.addEventListener('pointerleave', hide);

    built = { render: render };
    render(progress);
  }

  build();

  /* ---------- draw on load, in step with the hero timeline ---------- */
  if (!motion) {
    built.render(1);
  } else {
    built.render(0);
    var state = { t: 0 };
    g.to(state, {
      t: 1,
      duration: 2.6,
      ease: 'power2.inOut',
      delay: parseFloat(host.getAttribute('data-delay') || '0.9'),
      onUpdate: function () { if (built) built.render(state.t); }
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
  if ('ResizeObserver' in window) {
    new ResizeObserver(onResize).observe(frame);
  } else {
    window.addEventListener('resize', onResize);
  }
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { if (built) build(); });
})();
