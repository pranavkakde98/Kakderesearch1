/* ==========================================================================
   The comparative data desk, V8.

   Two reading modes over the same sourced observations: India against the
   global anchors (China, the United States), and India against the
   emerging markets competing for the same capital (Indonesia, Brazil,
   Mexico, South Africa, Vietnam).

   Every number drawn here comes from assets/data/macro-em.js, baked
   deterministically from World Bank Open Data. Nothing is estimated,
   interpolated or invented; a country with no fresh observation shows
   "n/a" rather than a guess. The rules inherited from charts.js hold:
   nothing animates that is not a measurement.
   ========================================================================== */

(function () {
  'use strict';

  var EM = window.MACRO_EM;
  var doc = document;
  var hosts = Array.prototype.slice.call(doc.querySelectorAll('[data-dash]'));
  var fillers = Array.prototype.slice.call(doc.querySelectorAll('[data-em-latest]'));
  var sparks = Array.prototype.slice.call(doc.querySelectorAll('[data-mini-spark]'));

  if (!EM || !EM.series) {
    /* A dashboard that cannot prove its numbers should not appear — and a
       sentence that quotes the data file falls back to its baked value,
       which the markup carries as static text. Spark hosts give their
       space back rather than reserving it for a drawing that never comes. */
    hosts.forEach(function (h) { h.setAttribute('hidden', ''); });
    sparks.forEach(function (s) { s.setAttribute('hidden', ''); });
    return;
  }

  var g = window.gsap;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var motion = !!g && !reduce && doc.documentElement.classList.contains('anim');
  var S = EM.series;
  /* The retrieval date comes from the dataset itself, never from a string
     typed here, so every caption on the desk agrees with the data file. */
  var RETRIEVED = (function () {
    var iso = EM._meta && EM._meta.retrieved;
    if (!iso) return 'the date in the data file';
    var d = new Date(iso + 'T00:00:00Z');
    try { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }
    catch (e) { return iso; }
  })();

  /* Ranking window: a country is ranked only when its latest observation is
     within this many years of the newest observation in the row. Older
     values are shown as n/a rather than compared as if current. */
  var RANK_WINDOW_YEARS = 3;

  /* ---------- the reading frame ---------- */

  var COUNTRIES = {
    IND: 'India', CHN: 'China', USA: 'United States', IDN: 'Indonesia',
    BRA: 'Brazil', MEX: 'Mexico', ZAF: 'South Africa', VNM: 'Vietnam'
  };
  var GLOBAL_SET = ['CHN', 'USA'];
  var EM_SET = ['IDN', 'BRA', 'MEX', 'ZAF', 'VNM'];
  var MAX_PEERS = 3;

  /* Every country keeps one tone and one dash pattern wherever it appears,
     so a reader never has to relearn the key between selections or pages.
     Dash tells the lines apart without colour; India is the subject and is
     drawn last, on top, in the accent. */
  var COUNTRY_STYLE = {
    IND: { tone: 'var(--series-india)',  dash: '' },
    CHN: { tone: 'var(--series-peer)',   dash: '' },
    USA: { tone: 'var(--series-peer-2)', dash: '7 4' },
    IDN: { tone: 'var(--series-peer)',   dash: '7 4' },
    BRA: { tone: 'var(--series-peer-2)', dash: '' },
    MEX: { tone: 'var(--series-peer-3)', dash: '2 4' },
    ZAF: { tone: 'var(--series-peer)',   dash: '2 4' },
    VNM: { tone: 'var(--series-peer-3)', dash: '' }
  };
  function styleFor(iso) { return COUNTRY_STYLE[iso] || { tone: 'var(--series-peer)', dash: '' }; }
  var INDIA_TONE = COUNTRY_STYLE.IND.tone;

  /* Chartable indicators. minFresh is the oldest observation year the
     ranking will accept before a country reads n/a; a chart shows the
     full series regardless, because a dated line is honest as long as
     its axis says when it ends. */
  var INDICATORS = [
    { key: 'gdp_growth',      label: 'Real GDP growth',          unit: 'annual %',   dp: 1, mode: 'pct',      minFresh: 2023, heat: true },
    { key: 'cpi',             label: 'CPI inflation',            unit: 'annual %',   dp: 1, mode: 'pct',      minFresh: 2023, heat: true },
    { key: 'cab_pct_gdp',     label: 'Current account',          unit: '% of GDP',   dp: 1, mode: 'pct',      minFresh: 2023, heat: true },
    { key: 'reserves_bn',     label: 'FX reserves',              unit: 'US$ bn',     dp: 0, mode: 'usdbn',    minFresh: 2023, heat: true },
    { key: 'fdi_pct_gdp',     label: 'FDI inflows',              unit: '% of GDP',   dp: 1, mode: 'pct',      minFresh: 2023, heat: true },
    { key: 'credit_pct_gdp',  label: 'Private credit',           unit: '% of GDP',   dp: 0, mode: 'pctplain', minFresh: 2021, heat: true,
      note: 'Vietnam’s latest reported observation is 2022.' },
    { key: 'manuf_pct_gdp',   label: 'Manufacturing',            unit: '% of GDP',   dp: 1, mode: 'pctplain', minFresh: 2021, heat: true },
    { key: 'exports_pct_gdp', label: 'Exports',                  unit: '% of GDP',   dp: 1, mode: 'pctplain', minFresh: 2023, heat: true },
    { key: 'rnd_pct_gdp',     label: 'R&D spending',             unit: '% of GDP',   dp: 2, mode: 'pctplain', minFresh: 2019, heat: true,
      note: 'Reported infrequently; latest observations range 2020 to 2024 by country.' },
    { key: 'urban_pct',       label: 'Urban population',         unit: '% of total', dp: 0, mode: 'pctplain', minFresh: 2023, heat: true },
    { key: 'mktcap_pct_gdp',  label: 'Listed market cap',        unit: '% of GDP',   dp: 0, mode: 'pctplain', minFresh: 2023, heat: true,
      omit: { IND: [2025] },
      note: 'India’s 2025 observation in the source series is inconsistent with exchange-reported market capitalisation and is omitted rather than smoothed in; India shows 2024. South Africa’s high ratio reflects large dual-listed groups.' },
    { key: 'npl_pct',         label: 'Bank NPLs',                unit: '% of loans', dp: 1, mode: 'pctplain', minFresh: 2022, heat: true },
    { key: 'gdp_pc_usd',      label: 'GDP per head',             unit: 'current US$', dp: 0, mode: 'usd',     minFresh: 2023, heat: true },
    { key: 'fx_idx',          label: 'Currency vs US dollar',    unit: 'US$ value, 2000 = 100', dp: 0, mode: 'plain', minFresh: 2023, heat: false,
      derived: 'fx', exclude: ['USA'],
      note: 'US-dollar value of each currency, indexed from annual-average official rates (PA.NUS.FCRF). A falling line is depreciation.' }
  ];

  /* The chart's default window. Series with observations before 2000 are
     clipped, not rebased; the axis carries the truth either way. */
  var X_FROM = 2000;

  var NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs) {
    var n = doc.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    return n;
  }
  function htm(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function rawSeries(key, iso) {
    var ind = byKey(key);
    if (ind && ind.derived === 'fx') {
      var fx = S.fx_lcu_usd && S.fx_lcu_usd[iso];
      if (!fx || iso === 'USA') return null;
      var years = Object.keys(fx).map(Number).sort(function (a, b) { return a - b; })
        .filter(function (y) { return y >= X_FROM; });
      if (!years.length) return null;
      var base = fx[String(years[0])];
      var out = {};
      years.forEach(function (y) { out[String(y)] = Math.round(base / fx[String(y)] * 100 * 10) / 10; });
      return out;
    }
    var obj = S[key] && S[key][iso] ? S[key][iso] : null;
    /* Documented omissions only: a source observation inconsistent with
       the rest of its own series is dropped and the note says so. */
    if (obj && ind && ind.omit && ind.omit[iso]) {
      var clone = {};
      Object.keys(obj).forEach(function (y) {
        if (ind.omit[iso].indexOf(Number(y)) === -1) clone[y] = obj[y];
      });
      obj = clone;
    }
    return obj;
  }

  function pointsFor(key, iso) {
    var obj = rawSeries(key, iso);
    if (!obj) return null;
    var pts = Object.keys(obj).map(Number).sort(function (a, b) { return a - b; })
      .filter(function (y) { return y >= X_FROM; })
      .map(function (y) { return { year: y, value: obj[String(y)] }; });
    return pts.length ? pts : null;
  }

  function latestFor(key, iso) {
    var obj = rawSeries(key, iso);
    if (!obj) return null;
    var years = Object.keys(obj).map(Number).sort(function (a, b) { return a - b; });
    if (!years.length) return null;
    var y = years[years.length - 1];
    return { year: y, value: obj[String(y)] };
  }

  function byKey(key) {
    for (var i = 0; i < INDICATORS.length; i++) if (INDICATORS[i].key === key) return INDICATORS[i];
    return null;
  }

  function fmt(ind, v) {
    if (ind.mode === 'usdbn') return v >= 1000 ? '$' + (v / 1000).toFixed(2) + 'tn' : '$' + Math.round(v) + 'bn';
    if (ind.mode === 'usd') return '$' + Math.round(v).toLocaleString('en-US');
    if (ind.mode === 'pct') return (v > 0 ? '+' : '') + v.toFixed(ind.dp) + '%';
    if (ind.mode === 'pctplain') return v.toFixed(ind.dp) + '%';
    return v.toFixed(ind.dp);
  }
  function axisFmt(ind, v) {
    if (ind.mode === 'usdbn') return v >= 1000 ? '$' + (v / 1000) + 'tn' : '$' + v + 'bn';
    if (ind.mode === 'usd') return '$' + (v >= 1000 ? (v / 1000) + 'k' : v);
    if (ind.mode === 'pct') return v > 0 ? '+' + v : String(v);
    return String(v);
  }

  /* Ticks that land on round values whatever the range. */
  function niceStep(span) {
    var raw = span / 5;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = norm >= 5 ? 10 : norm >= 2.5 ? 5 : norm >= 1.2 ? 2 : 1;
    return step * mag;
  }

  /* ---------- the line figure ---------- */

  function drawLine(frame, ind, seriesList, animate) {
    frame.innerHTML = '';
    /* On a phone the frame is a 4:3 box a few hundred pixels wide; drawing
       into a 1000-unit viewBox there would shrink every label to ~3px. So the
       viewBox takes the frame's own size and type stays at its CSS size. */
    var fw = Math.round(frame.getBoundingClientRect().width);
    var narrow = fw > 0 && fw < 700;
    var W = narrow ? Math.max(300, fw) : 1000;
    var H = narrow ? Math.round(W * 0.75) : 480;
    var PAD = narrow ? { t: 20, r: 54, b: 30, l: 4 } : { t: 24, r: 66, b: 34, l: 6 };

    var allVals = [], x0 = Infinity, x1 = -Infinity;
    seriesList.forEach(function (s) {
      s.pts.forEach(function (p) { allVals.push(p.value); });
      x0 = Math.min(x0, s.pts[0].year);
      x1 = Math.max(x1, s.pts[s.pts.length - 1].year);
    });
    if (!allVals.length) return;

    var lo = Math.min.apply(null, allVals), hi = Math.max.apply(null, allVals);
    if (lo > 0 && lo / hi < 0.4) lo = 0;
    if (lo > 0) lo = Math.floor(lo * 0.94);
    if (lo < 0) lo = Math.floor(lo * 1.06);
    hi = Math.ceil(hi * 1.04);
    if (ind.mode === 'pct' || lo < 0) lo = Math.min(lo, 0);

    var step = niceStep(hi - lo);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;

    function X(y) { return PAD.l + (y - x0) / (x1 - x0) * (W - PAD.l - PAD.r); }
    function Y(v) { return PAD.t + (hi - v) / (hi - lo) * (H - PAD.t - PAD.b); }

    var names = seriesList.map(function (s) { return s.label; }).join(', ');
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    svg.setAttribute('aria-label', 'Line chart of ' + ind.label.toLowerCase() + ' (' + ind.unit + ') for ' + names + ', ' + x0 + ' to ' + x1 + '. Values for the latest year are listed beside the chart.');

    for (var gv = lo; gv <= hi + step / 2; gv += step) {
      var yv = Math.round(gv * 100) / 100;
      svg.appendChild(el('line', { x1: PAD.l, x2: W - PAD.r, y1: Y(yv), y2: Y(yv), class: yv === 0 ? 'zeroline' : 'gridline' }));
      var lab = el('text', { x: W - PAD.r + 8, y: Y(yv) + 3.5, class: 'axis-label' });
      lab.textContent = axisFmt(ind, yv);
      svg.appendChild(lab);
    }
    var tickEvery = narrow ? 10 : 5;
    for (var ty = x0; ty <= x1; ty++) {
      if (ty !== x0 && ty !== x1 && ty % tickEvery !== 0) continue;
      if (ty !== x0 && ty !== x1 && (Math.abs(ty - x0) < (narrow ? 4 : 2) || Math.abs(ty - x1) < (narrow ? 4 : 2))) continue;
      var t = el('text', { x: X(ty), y: H - PAD.b + 20, class: 'axis-label', 'text-anchor': 'middle' });
      t.textContent = String(ty);
      svg.appendChild(t);
    }

    /* A missing year breaks the line: successive points are only joined
       when they are consecutive observations. */
    var gaps = false;
    function d(pts) {
      var out = '';
      pts.forEach(function (p, i) {
        var move = i === 0 || (p.year - pts[i - 1].year) > 1;
        if (move && i > 0) gaps = true;
        out += (move ? 'M' : 'L') + X(p.year).toFixed(2) + ' ' + Y(p.value).toFixed(2) + ' ';
      });
      return out.trim();
    }

    var paths = [];
    /* Peers first, the subject last so it sits on top. */
    var ordered = seriesList.slice().sort(function (a, b) { return (a.iso === 'IND' ? 1 : 0) - (b.iso === 'IND' ? 1 : 0); });
    ordered.forEach(function (s) {
      var isSubject = s.iso === 'IND';
      var p = el('path', { d: d(s.pts), class: isSubject ? 'series-line' : 'series-peer' });
      if (!isSubject) p.style.stroke = s.tone;
      if (s.dash) p.style.strokeDasharray = s.dash;
      svg.appendChild(p);
      paths.push(p);
    });
    frame.setAttribute('data-has-gaps', gaps ? 'true' : 'false');

    frame.appendChild(svg);

    if (motion && animate) {
      /* A dashed stroke cannot be drawn with a dash offset, so every line is
         revealed by a clip that sweeps left to right instead. */
      var defs = el('defs', {});
      svg.insertBefore(defs, svg.firstChild);
      paths.forEach(function (p, i) {
        var cid = 'dashClip' + (++clipSeq);
        var cp = el('clipPath', { id: cid });
        var rect = el('rect', { x: PAD.l - 6, y: 0, width: 0, height: H });
        cp.appendChild(rect);
        defs.appendChild(cp);
        p.setAttribute('clip-path', 'url(#' + cid + ')');
        g.to(rect, { attr: { width: W - PAD.r - PAD.l + 12 }, duration: 0.9, delay: 0.08 * i, ease: 'power2.inOut' });
      });
    }

    buildHover(frame, svg, ind, seriesList, X, Y, x0, x1, PAD, W, H);
  }

  var clipSeq = 0;

  /* Reading a year: pointer, touch and keyboard all arrive here. The flag
     is rebuilt only when the year changes; the arrow keys announce the
     reading through a live region that is always in the document. */
  function buildHover(frame, svg, ind, seriesList, X, Y, x0, x1, PAD, W, H) {
    var hover = el('g', {});
    var rule = el('line', { class: 'hover-rule', y1: PAD.t, y2: H - PAD.b });
    rule.style.opacity = 0;
    hover.appendChild(rule);
    var dots = seriesList.map(function (s) {
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
    var live = frame.querySelector('.figure-live');
    if (!live) {
      live = doc.createElement('p');
      live.className = 'visually-hidden figure-live';
      live.setAttribute('aria-live', 'polite');
      frame.appendChild(live);
    }
    svg.setAttribute('tabindex', '0');
    svg.setAttribute('aria-label', svg.getAttribute('aria-label') + ' Use the left and right arrow keys to read each year.');

    var shown = null, focusYear = x1;

    function hide() {
      shown = null;
      rule.style.opacity = 0;
      dots.forEach(function (c) { c.style.opacity = 0; });
      tip.classList.remove('is-on');
    }
    function show(year, announce) {
      year = Math.max(x0, Math.min(x1, year));
      focusYear = year;
      if (year === shown && !announce) return;
      shown = year;
      var cx = X(year);
      rule.setAttribute('x1', cx); rule.setAttribute('x2', cx);
      rule.style.opacity = 1;
      var rows = '<span class="tip-year">' + year + '</span>';
      var spoken = [];
      seriesList.forEach(function (s, i) {
        var pt = null;
        for (var j = 0; j < s.pts.length; j++) if (s.pts[j].year === year) { pt = s.pts[j]; break; }
        if (!pt) { dots[i].style.opacity = 0; spoken.push(s.label + ' no observation'); return; }
        dots[i].setAttribute('cx', cx);
        dots[i].setAttribute('cy', Y(pt.value));
        dots[i].style.opacity = 1;
        rows += '<span class="tip-row"><span class="tip-swatch" style="background:' + s.tone + '"></span>' +
                s.label + '&nbsp;&nbsp;' + fmt(ind, pt.value) + '</span>';
        spoken.push(s.label + ' ' + fmt(ind, pt.value));
      });
      tip.innerHTML = rows;
      tip.classList.add('is-on');
      var fr = frame.getBoundingClientRect();
      var tx = (cx / W) * fr.width;
      var flip = tx > fr.width * 0.66;
      tip.style.left = tx + 'px';
      tip.style.top = '8px';
      tip.style.transform = 'translateX(' + (flip ? 'calc(-100% - 14px)' : '14px') + ')';
      if (announce && live) live.textContent = year + ', ' + ind.label + ' (' + ind.unit + '): ' + spoken.join(', ') + '.';
    }
    function yearAt(ev) {
      var rect = svg.getBoundingClientRect();
      var px = (ev.clientX - rect.left) / rect.width * W;
      if (px < PAD.l - 8 || px > W - PAD.r + 8) return null;
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
      if (k === 'ArrowRight' || k === 'ArrowUp') show(Math.min(x1, cur + (shown === null ? 0 : 1)), true);
      else if (k === 'ArrowLeft' || k === 'ArrowDown') show(Math.max(x0, cur - (shown === null ? 0 : 1)), true);
      else if (k === 'Home') show(x0, true);
      else if (k === 'End') show(x1, true);
      else if (k === 'Escape') hide();
      else return;
      ev.preventDefault();
    });
    svg.addEventListener('blur', hide);
  }

  /* ---------- the dashboard ---------- */

  hosts.forEach(function (host) { buildDash(host); });

  function buildDash(host) {
    var tabs = Array.prototype.slice.call(host.querySelectorAll('.dash-tab'));
    var countryRow = host.querySelector('[data-dash-countries]');
    var indRow = host.querySelector('[data-dash-indicators]');
    var frame = host.querySelector('[data-dash-frame]');
    var titleEl = host.querySelector('[data-dash-title]');
    var unitEl = host.querySelector('[data-dash-unit]');
    var legendEl = host.querySelector('[data-dash-legend]');
    var sourceEl = host.querySelector('[data-dash-source]');
    var readsEl = host.querySelector('[data-dash-reads]');
    var noteEl = host.querySelector('[data-dash-note]');
    if (!frame) return;

    /* The markup names the opening mode by marking one tab selected; a page
       about the EM desk opens on the peer set, the data desk on the anchors. */
    var initialTab = tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0];
    var state = {
      mode: (initialTab && initialTab.getAttribute('data-mode')) || 'global',
      indicator: 'gdp_growth',
      peers: ['IDN', 'VNM', 'BRA'],  /* selection order = tone order */
      animate: false                 /* first paint is static; the draw is
                                        spent only where it can be seen */
    };

    /* Mode tabs: the full tab pattern. One tab stop; the arrow keys move
       between tabs and select; Home and End reach the ends. */
    function selectTab(tab, focus) {
      var mode = tab.getAttribute('data-mode');
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.setAttribute('tabindex', on ? '0' : '-1');
      });
      if (focus) tab.focus();
      if (mode === state.mode) return;
      state.mode = mode;
      state.animate = true;
      buildCountryChips();
      render();
    }
    tabs.forEach(function (tab, i) {
      tab.setAttribute('tabindex', tab.getAttribute('aria-selected') === 'true' ? '0' : '-1');
      tab.addEventListener('click', function () { selectTab(tab, false); });
      tab.addEventListener('keydown', function (ev) {
        var k = ev.key, to = null;
        if (k === 'ArrowRight' || k === 'ArrowDown') to = tabs[(i + 1) % tabs.length];
        else if (k === 'ArrowLeft' || k === 'ArrowUp') to = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (k === 'Home') to = tabs[0];
        else if (k === 'End') to = tabs[tabs.length - 1];
        if (!to) return;
        ev.preventDefault();
        selectTab(to, true);
      });
    });

    /* Country chips (EM mode only; the global anchors are fixed). */
    function buildCountryChips() {
      if (!countryRow) return;
      countryRow.innerHTML = '';
      if (state.mode === 'global') {
        var cap = htm('span', 'chip-caption', 'India · China · United States');
        countryRow.appendChild(cap);
        return;
      }
      var cap2 = htm('span', 'chip-caption', 'Peers, up to three');
      countryRow.appendChild(cap2);
      EM_SET.forEach(function (iso) {
        var chip = htm('button', 'chip');
        chip.type = 'button';
        chip.setAttribute('data-iso', iso);
        var sw = htm('span', 'chip-swatch');
        chip.appendChild(sw);
        chip.appendChild(doc.createTextNode(COUNTRIES[iso]));
        chip.setAttribute('aria-pressed', String(state.peers.indexOf(iso) !== -1));
        chip.addEventListener('click', function () {
          var at = state.peers.indexOf(iso);
          if (at !== -1) {
            if (state.peers.length === 1) return; /* keep one comparison honest */
            state.peers.splice(at, 1);
          } else {
            state.peers.push(iso);
            if (state.peers.length > MAX_PEERS) state.peers.shift();
          }
          state.animate = true;
          syncChips();
          render();
        });
        countryRow.appendChild(chip);
      });
      syncChips();
    }

    function syncChips() {
      if (!countryRow) return;
      Array.prototype.slice.call(countryRow.querySelectorAll('.chip')).forEach(function (chip) {
        var iso = chip.getAttribute('data-iso');
        var at = state.peers.indexOf(iso);
        chip.setAttribute('aria-pressed', String(at !== -1));
        chip.style.setProperty('--sw', at !== -1 ? styleFor(iso).tone : 'transparent');
      });
    }

    /* Indicator chips. */
    if (indRow) {
      INDICATORS.forEach(function (ind) {
        var chip = htm('button', 'chip', ind.label);
        chip.type = 'button';
        chip.setAttribute('data-key', ind.key);
        chip.setAttribute('aria-pressed', String(ind.key === state.indicator));
        chip.addEventListener('click', function () {
          state.indicator = ind.key;
          state.animate = true;
          Array.prototype.slice.call(indRow.querySelectorAll('.chip')).forEach(function (c) {
            c.setAttribute('aria-pressed', String(c === chip));
          });
          render();
        });
        indRow.appendChild(chip);
      });
    }

    function activeSet() {
      var isos = state.mode === 'global' ? GLOBAL_SET.slice() : state.peers.slice();
      return ['IND'].concat(isos);
    }

    function render() {
      var ind = byKey(state.indicator);
      var isos = activeSet();

      var seriesList = [];
      isos.forEach(function (iso, i) {
        var pts = pointsFor(ind.key, iso);
        if (!pts) return;
        seriesList.push({
          iso: iso,
          label: COUNTRIES[iso],
          tone: styleFor(iso).tone,
          dash: styleFor(iso).dash,
          pts: pts
        });
      });

      if (titleEl) titleEl.textContent = ind.label;
      if (unitEl) unitEl.textContent = ind.unit;

      if (legendEl) {
        legendEl.innerHTML = '';
        seriesList.forEach(function (s) {
          var li = doc.createElement('li');
          /* The swatch is the line itself: same tone, same dash. */
          var sw = el('svg', { class: 'legend-swatch legend-line', viewBox: '0 0 28 6', 'aria-hidden': 'true', focusable: 'false' });
          var ln = el('line', { x1: 1, y1: 3, x2: 27, y2: 3 });
          ln.style.stroke = s.tone;
          ln.style.strokeWidth = s.iso === 'IND' ? 2.4 : 1.8;
          if (s.dash) ln.style.strokeDasharray = s.dash;
          sw.appendChild(ln);
          li.appendChild(sw);
          li.appendChild(doc.createTextNode(s.label));
          legendEl.appendChild(li);
        });
      }

      drawLine(frame, ind, seriesList, state.animate);

      if (readsEl) {
        readsEl.innerHTML = '';
        seriesList.forEach(function (s) {
          var last = s.pts[s.pts.length - 1];
          var li = htm('li', 'dash-read');
          var sw = htm('span', 'read-swatch');
          sw.style.setProperty('--sw', s.tone);
          if (s.dash) sw.classList.add('is-dashed');
          li.appendChild(sw);
          li.appendChild(htm('span', 'read-name', s.label));
          li.appendChild(htm('span', 'read-val', fmt(ind, last.value)));
          li.appendChild(htm('span', 'read-yr', String(last.year)));
          readsEl.appendChild(li);
        });
        var missing = isos.filter(function (iso) { return !pointsFor(ind.key, iso); });
        missing.forEach(function (iso) {
          var li = htm('li', 'dash-read');
          li.appendChild(htm('span', 'read-swatch'));
          li.appendChild(htm('span', 'read-name', COUNTRIES[iso]));
          li.appendChild(htm('span', 'read-val', 'n/a'));
          readsEl.appendChild(li);
        });
      }

      if (sourceEl) {
        var id = ind.derived === 'fx' ? 'PA.NUS.FCRF' : (EM._meta.indicators[ind.key] || {}).id || '';
        var freshest = 0;
        seriesList.forEach(function (s) { freshest = Math.max(freshest, s.pts[s.pts.length - 1].year); });
        sourceEl.textContent = 'Source: World Bank Open Data, ' + id + ', retrieved ' + RETRIEVED +
          '. Reported annual observations to ' + freshest + '; each country’s own latest year is shown beside its value.' +
          (frame.getAttribute('data-has-gaps') === 'true' ? ' A line breaks where a year is not reported; nothing is bridged.' : '') +
          (ind.derived === 'fx' ? ' Indexed here from annual-average official rates; 2000 = 100.' : '');
      }

      if (noteEl) noteEl.textContent = ind.note || '';
    }

    buildCountryChips();

    /* The chart exists immediately; the draw animation is spent only when
       the desk first enters the viewport, by re-rendering with the clock
       armed. If ScrollTrigger never fires, the static chart already stands. */
    render();
    if (motion && window.ScrollTrigger) {
      window.ScrollTrigger.create({
        trigger: host,
        start: 'top 80%',
        once: true,
        onEnter: function () {
          state.animate = true;
          render();
        }
      });
    }

    /* ---------- the ranking table ---------- */

    var rankHost = host.querySelector('[data-dash-rank]');
    if (rankHost) buildRank(rankHost);
  }

  function buildRank(hostEl) {
    var cols = ['IND'].concat(EM_SET);
    var rows = INDICATORS.filter(function (i) { return i.heat; });

    var wrap = htm('div', 'rank-scroll');
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'Ranking table; scrolls sideways on a narrow screen');
    var table = htm('table', 'rank-table');
    var caption = htm('caption', null, 'Latest reported observation per country. A country is ranked only when its latest observation is within ' + RANK_WINDOW_YEARS + ' years of the newest in the row; older values read n/a. Shading runs from the highest value in each row (strongest tint) to the lowest, on one scale for every country; a rank is a reading order, not a verdict.');
    table.appendChild(caption);

    var thead = doc.createElement('thead');
    var hr = doc.createElement('tr');
    var corner = doc.createElement('th');
    corner.setAttribute('scope', 'col');
    corner.textContent = 'Indicator';
    hr.appendChild(corner);
    cols.forEach(function (iso) {
      var th = doc.createElement('th');
      th.setAttribute('scope', 'col');
      th.textContent = COUNTRIES[iso];
      if (iso === 'IND') th.className = 'is-india';
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = doc.createElement('tbody');
    rows.forEach(function (ind) {
      var tr = doc.createElement('tr');
      var th = doc.createElement('th');
      th.setAttribute('scope', 'row');
      th.appendChild(doc.createTextNode(ind.label));
      th.appendChild(htm('span', 'row-unit', ind.unit));
      tr.appendChild(th);

      /* Freshness: the row's newest observation sets the window. */
      var newest = 0;
      cols.forEach(function (iso) { var l = latestFor(ind.key, iso); if (l && l.year > newest) newest = l.year; });
      var floor = Math.max(ind.minFresh || 0, newest - RANK_WINDOW_YEARS);
      var cells = cols.map(function (iso) {
        var last = latestFor(ind.key, iso);
        var ok = last && last.year >= floor;
        return { iso: iso, last: ok ? last : null, stale: last && !ok ? last : null };
      });
      var ranked = cells.filter(function (c) { return c.last; })
        .slice().sort(function (a, b) { return b.last.value - a.last.value; });

      cells.forEach(function (c) {
        var td = doc.createElement('td');
        if (c.iso === 'IND') td.classList.add('is-india');
        if (!c.last) {
          td.classList.add('is-na');
          td.appendChild(htm('span', 'cell-val', 'n/a'));
          if (c.stale) td.appendChild(htm('span', 'cell-yr', 'latest ' + c.stale.year));
        } else {
          var rank = ranked.findIndex(function (r) { return r.iso === c.iso; }) + 1;
          /* One scale for every country; India is marked by its edge, not a
             different ramp, so the shading means the same thing in every cell. */
          td.style.background = shade(rank, ranked.length);
          td.appendChild(htm('span', 'cell-val', fmt(ind, c.last.value)));
          td.appendChild(htm('span', 'cell-yr', String(c.last.year)));
          if (c.iso === 'IND') td.appendChild(htm('span', 'rank-badge', rank + ' of ' + ranked.length));
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    hostEl.appendChild(wrap);

    /* The legend is drawn from the same function as the cells. */
    var key = htm('p', 'rank-key');
    key.appendChild(htm('span', 'rank-key-label', 'Highest'));
    for (var k = 1; k <= 5; k++) {
      var swatch = htm('span', 'rank-key-swatch');
      swatch.style.background = shade(k, 5);
      swatch.setAttribute('aria-hidden', 'true');
      key.appendChild(swatch);
    }
    key.appendChild(htm('span', 'rank-key-label', 'Lowest'));
    key.appendChild(htm('span', 'rank-key-note', 'One scale for every country; India is marked by its edge.'));
    hostEl.appendChild(key);
  }

  /* Cell tint for a rank among n ranked countries: strongest for the
     highest value, fading to almost none for the lowest. Used by the cells
     and by the legend, so the two can never disagree. */
  function shade(rank, n) {
    var t = n > 1 ? 1 - (rank - 1) / (n - 1) : 0.5;
    var alpha = 0.04 + 0.16 * t;
    return 'rgba(244, 240, 230, ' + alpha.toFixed(3) + ')';
  }

  /* ---------- copy fillers: real values quoted inline ----------
     <span data-em-latest="manuf_pct_gdp:VNM"></span> renders the latest
     reported observation, so a comparative sentence can never drift from
     the data file it cites. data-em-latest-year renders the year. */

  /* Series quotable in copy but not charted on the dashboard. Formats
     only; the observations still come from macro-em.js like everything
     else. */
  var FILLER_ONLY = [
    { key: 'remit_bn',       label: 'Personal remittances received', unit: 'US$ bn', dp: 0, mode: 'usdbn' },
    { key: 'svc_exports_bn', label: 'Services exports',              unit: 'US$ bn', dp: 0, mode: 'usdbn' }
  ];
  function fillerMeta(key) {
    var ind = byKey(key);
    if (ind) return ind;
    for (var i = 0; i < FILLER_ONLY.length; i++) if (FILLER_ONLY[i].key === key) return FILLER_ONLY[i];
    return null;
  }

  fillers.forEach(function (node) {
    var spec = (node.getAttribute('data-em-latest') || '').split(':');
    var ind = fillerMeta(spec[0]);
    var last = ind && spec[1] ? latestFor(spec[0], spec[1]) : null;
    if (!last) { node.textContent = 'n/a'; return; }
    node.textContent = node.hasAttribute('data-em-latest-year') ? String(last.year) : fmt(ind, last.value);
  });

  /* ---------- mini sparklines (hero strip and elsewhere) ---------- */

  sparks.forEach(function (hostEl) {
    var spec = (hostEl.getAttribute('data-mini-spark') || '').split(':');
    var pts = spec.length === 2 ? pointsFor(spec[0], spec[1]) : null;
    if (!pts || pts.length < 2) { hostEl.setAttribute('hidden', ''); return; }

    var W = 160, H = 26, P = 3;
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
    path.style.fill = 'none';
    svg.appendChild(path);
    var end = el('circle', { class: 'spark-end', cx: sx(x1), cy: sy(pts[pts.length - 1].value), r: 2.4 });
    svg.appendChild(end);
    hostEl.appendChild(svg);

    if (motion && window.ScrollTrigger) {
      var len = path.getTotalLength();
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len;
      end.style.opacity = 0;
      window.ScrollTrigger.create({
        trigger: hostEl,
        start: 'top 92%',
        once: true,
        onEnter: function () {
          g.to(path, { strokeDashoffset: 0, duration: 1.0, ease: 'power2.out', delay: 1.2 });
          g.to(end, { opacity: 1, duration: 0.3, delay: 2.1 });
        }
      });
    }
  });
})();
