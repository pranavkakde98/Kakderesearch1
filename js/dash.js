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
  var RETRIEVED = '13 August 2026';

  /* ---------- the reading frame ---------- */

  var COUNTRIES = {
    IND: 'India', CHN: 'China', USA: 'United States', IDN: 'Indonesia',
    BRA: 'Brazil', MEX: 'Mexico', ZAF: 'South Africa', VNM: 'Vietnam'
  };
  var GLOBAL_SET = ['CHN', 'USA'];
  var EM_SET = ['IDN', 'BRA', 'MEX', 'ZAF', 'VNM'];
  var MAX_PEERS = 3;

  /* Peer tones are assigned by selection order from the fixed ladder, so
     the chart never has to hold more than four lines apart. */
  var PEER_TONES = ['var(--series-peer)', 'var(--series-peer-2)', 'var(--series-peer-3)'];
  var INDIA_TONE = 'var(--series-india)';

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
    var W = 1000, H = 480;
    var PAD = { t: 24, r: 66, b: 34, l: 6 };

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
    for (var ty = x0; ty <= x1; ty++) {
      if (ty !== x0 && ty !== x1 && ty % 5 !== 0) continue;
      if (ty !== x0 && ty !== x1 && (Math.abs(ty - x0) < 2 || Math.abs(ty - x1) < 2)) continue;
      var t = el('text', { x: X(ty), y: H - PAD.b + 20, class: 'axis-label', 'text-anchor': 'middle' });
      t.textContent = String(ty);
      svg.appendChild(t);
    }

    function d(pts) {
      return pts.map(function (p, i) {
        return (i ? 'L' : 'M') + X(p.year).toFixed(2) + ' ' + Y(p.value).toFixed(2);
      }).join(' ');
    }

    var paths = [];
    seriesList.forEach(function (s, i) {
      var isSubject = s.iso === 'IND';
      var p = el('path', { d: d(s.pts), class: isSubject ? 'series-line' : 'series-peer' });
      if (!isSubject) p.style.stroke = s.tone;
      svg.appendChild(p);
      paths.push(p);
    });

    frame.appendChild(svg);

    if (motion && animate) {
      paths.forEach(function (p, i) {
        var L = p.getTotalLength();
        p.style.strokeDasharray = L;
        p.style.strokeDashoffset = L;
        g.to(p, { strokeDashoffset: 0, duration: 0.9, delay: 0.08 * i, ease: 'power2.inOut' });
      });
    }

    buildHover(frame, svg, ind, seriesList, X, Y, x0, x1, PAD, W, H);
  }

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
      seriesList.forEach(function (s, i) {
        var pt = null;
        for (var j = 0; j < s.pts.length; j++) if (s.pts[j].year === year) { pt = s.pts[j]; break; }
        if (!pt) { dots[i].style.opacity = 0; return; }
        dots[i].setAttribute('cx', cx);
        dots[i].setAttribute('cy', Y(pt.value));
        dots[i].style.opacity = 1;
        rows += '<span class="tip-row"><span class="tip-swatch" style="background:' + s.tone + '"></span>' +
                s.label + '&nbsp;&nbsp;' + fmt(ind, pt.value) + '</span>';
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

    var state = {
      mode: 'global',
      indicator: 'gdp_growth',
      peers: ['IDN', 'VNM', 'BRA'],  /* selection order = tone order */
      animate: false                 /* first paint is static; the draw is
                                        spent only where it can be seen */
    };

    /* Mode tabs. */
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var mode = tab.getAttribute('data-mode');
        if (mode === state.mode) return;
        state.mode = mode;
        state.animate = true;
        tabs.forEach(function (t) { t.setAttribute('aria-selected', String(t === tab)); });
        if (state.mode === 'global' && byKey(state.indicator).derived === 'fx') {
          /* fx index has no US line; it stays available in EM mode. */
        }
        buildCountryChips();
        render();
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
        chip.style.setProperty('--sw', at !== -1 ? PEER_TONES[at] : 'transparent');
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
          tone: iso === 'IND' ? INDIA_TONE : PEER_TONES[(i - 1 + PEER_TONES.length) % PEER_TONES.length],
          pts: pts
        });
      });

      if (titleEl) titleEl.textContent = ind.label;
      if (unitEl) unitEl.textContent = ind.unit;

      if (legendEl) {
        legendEl.innerHTML = '';
        seriesList.forEach(function (s) {
          var li = doc.createElement('li');
          var sw = htm('span', 'legend-swatch');
          sw.style.background = s.tone;
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
    var table = htm('table', 'rank-table');
    var caption = htm('caption', null, 'Latest reported observation per country. Shading runs from the highest value in each row (darkest) to the lowest; a rank is a reading order, not a verdict.');
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

      var cells = cols.map(function (iso) {
        var last = latestFor(ind.key, iso);
        var ok = last && last.year >= ind.minFresh;
        return { iso: iso, last: ok ? last : null };
      });
      var ranked = cells.filter(function (c) { return c.last; })
        .slice().sort(function (a, b) { return b.last.value - a.last.value; });

      cells.forEach(function (c) {
        var td = doc.createElement('td');
        if (c.iso === 'IND') td.classList.add('is-india');
        if (!c.last) {
          td.classList.add('is-na');
          td.appendChild(htm('span', 'cell-val', 'n/a'));
        } else {
          var rank = ranked.findIndex(function (r) { return r.iso === c.iso; }) + 1;
          var alpha = ranked.length > 1
            ? 0.03 + 0.13 * (1 - (rank - 1) / (ranked.length - 1))
            : 0.08;
          td.style.background = c.iso === 'IND'
            ? 'rgba(88, 190, 150, ' + (0.05 + alpha * 0.7).toFixed(3) + ')'
            : 'rgba(244, 240, 230, ' + alpha.toFixed(3) + ')';
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
