'use strict';
/* 多维竞争力雷达 · 纯逻辑(无 DOM)。
   坐标:第 0 维在正上方,顺时针排列;半径 = 分数/100 × (size/2)。
   面积口径:按分数做半径的多边形面积(分数单位²),满分 n 维多边形为参照。 */
(function () {
  var MIN_DIMS = 3;
  var MAX_DIMS = 10;
  var STATE_VERSION = 1;
  var RING_LEVELS = [20, 40, 60, 80, 100];
  var idCounter = 0;

  function isNum(x) { return typeof x === 'number' && Number.isFinite(x); }
  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function round2(v) { return Math.round(v * 100) / 100; }
  function clampScore(s) { var v = Number(s); if (!Number.isFinite(v)) return 0; return Math.min(100, Math.max(0, v)); }

  /* ---------- 日期 ---------- */
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
  function fmtDate(y, m, d) { return pad(y, 4) + '-' + pad(m, 2) + '-' + pad(d, 2); }
  function isValidDate(s) {
    if (typeof s !== 'string') return false;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    var dt = new Date(0);
    dt.setUTCFullYear(y, mo - 1, d);
    /* 解析后再格式化与原串比较,拒绝 2026-02-30 这类自动进位 */
    return fmtDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()) === s;
  }
  function dayNumber(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    var dt = new Date(0);
    dt.setUTCFullYear(+m[1], +m[2] - 1, +m[3]);
    return Math.round(dt.getTime() / 86400000);
  }
  function localToday(now) {
    var d = now || new Date();
    return fmtDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  /* ?today=YYYY-MM-DD;非法或不存在的日期回退真实今天,不抛错 */
  function todayFromSearch(search, now) {
    var fallback = localToday(now);
    try {
      var v = new URLSearchParams(String(search || '')).get('today');
      return v !== null && isValidDate(v) ? v : fallback;
    } catch (e) { return fallback; }
  }
  function prevMonthKey(iso) {
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7);
    if (m === 1) { y -= 1; m = 12; } else { m -= 1; }
    return pad(y, 4) + '-' + pad(m, 2);
  }

  /* ---------- 几何 ---------- */
  function vertices(scores, size) {
    var n = scores.length, c = size / 2, R = size / 2, out = [];
    for (var i = 0; i < n; i++) {
      var ang = -Math.PI / 2 + (2 * Math.PI * i) / n;
      var r = (R * clampScore(scores[i])) / 100;
      out.push({ x: round2(c + r * Math.cos(ang)), y: round2(c + r * Math.sin(ang)) });
    }
    return out;
  }
  function polygonPoints(scores, size) {
    return vertices(scores, size).map(function (p) { return p.x + ',' + p.y; }).join(' ');
  }
  function area(scores) {
    var n = scores.length;
    if (n < 3) return 0;
    var sum = 0;
    for (var i = 0; i < n; i++) sum += clampScore(scores[i]) * clampScore(scores[(i + 1) % n]);
    return 0.5 * Math.sin((2 * Math.PI) / n) * sum;
  }
  function fullArea(n) { return area(new Array(n).fill(100)); }
  /* 单维满分对照:同一个多边形公式,一个维度 100、其余 0。退化为一条线段,面积恒为 0 */
  function singleDimFullArea(n) { var a = new Array(Math.max(0, n)).fill(0); if (n > 0) a[0] = 100; return area(a); }
  function areaRatio(scores) { var f = fullArea(scores.length); return f > 0 ? area(scores) / f : 0; }

  function compareSingleVsMulti(scores) {
    var n = scores.length, hints = [];
    var hi80 = scores.filter(function (s) { return s >= 80; }).length;
    var lt30 = scores.filter(function (s) { return s < 30; }).length;
    var ge60 = scores.filter(function (s) { return s >= 60; }).length;
    if (n >= 2 && hi80 === 1 && lt30 === n - 1) {
      hints.push({ kind: 'single', text: '单维竞争,只有第一名有意义:只有 1 个维度 ≥ 80,其余都 < 30。' });
    }
    if (ge60 >= 3) {
      hints.push({ kind: 'multi', text: '多维面积已成型:已有 ' + ge60 + ' 个维度 ≥ 60。' });
    }
    return hints;
  }

  /* 把第 i 维提高 1 分时面积的增量 = ½·sin(2π/n)·(相邻两维分数之和) */
  function marginalArea(scores, i) {
    var n = scores.length;
    if (n < 3 || i < 0 || i >= n) return 0;
    var prev = clampScore(scores[(i - 1 + n) % n]);
    var next = clampScore(scores[(i + 1) % n]);
    return 0.5 * Math.sin((2 * Math.PI) / n) * (prev + next);
  }
  /* 只在「还有差距」的维度里挑边际面积最大者;并列取靠前的 */
  function bestMarginal(dims) {
    var scores = dims.map(function (d) { return d.current; });
    var best = null;
    for (var i = 0; i < dims.length; i++) {
      if (!(dims[i].target > dims[i].current) || dims[i].current >= 100) continue;
      var v = marginalArea(scores, i);
      if (best === null || v > best.value) best = { index: i, name: dims[i].name, value: v };
    }
    return best;
  }

  /* 小数位数(至少 2,最多 8):分配按这个精度计,不把输入舍入掉 */
  function decimalsOf(x) {
    var s = Number(x).toFixed(8).replace(/0+$/, '');
    var i = s.indexOf('.');
    return Math.max(2, i < 0 ? 0 : s.length - i - 1);
  }
  /* 分配:权重 = 差距 × 用户权重;按输入的小数精度(至少 0.01 小时)为单位用最大余数法,总和严格等于 hours */
  function allocate(dims, hours, weights) {
    if (!isNum(hours) || hours < 0) throw new RangeError('hours 必须是 ≥ 0 的有限数字');
    var scoreArr = dims.map(function (d, i) {
      var gap = Math.max(0, d.target - d.current);
      var w = weights && weights[i] !== undefined ? Number(weights[i]) : 1;
      if (!Number.isFinite(w) || w < 0) w = 0;
      return { gap: gap, w: w, s: gap * w };
    });
    var total = scoreArr.reduce(function (a, b) { return a + b.s; }, 0);
    var dec = decimalsOf(hours), scale = Math.pow(10, dec);
    var units = Math.round(hours * scale);
    var alloc = scoreArr.map(function () { return 0; });
    var allocated = total > 0 && units > 0;
    if (total > 0) {
      var raw = scoreArr.map(function (x) { return (units * x.s) / total; });
      alloc = raw.map(Math.floor);
      var left = units - alloc.reduce(function (a, b) { return a + b; }, 0);
      var order = raw.map(function (r, i) { return { i: i, rem: r - Math.floor(r) }; })
        .filter(function (o) { return scoreArr[o.i].s > 0; })
        .sort(function (a, b) { return b.rem - a.rem || a.i - b.i; });
      for (var k = 0; k < left && order.length; k++) alloc[order[k % order.length].i] += 1;
    }
    return {
      allocated: total > 0,
      total: units / scale,
      rows: dims.map(function (d, i) {
        return { index: i, name: d.name, gap: scoreArr[i].gap, weight: scoreArr[i].w, hours: alloc[i] / scale };
      })
    };
  }

  /* ---------- 时间线 ---------- */
  function timeline(snapshots) {
    return snapshots.map(function (s) {
      var sc = s.scores.map(function (x) { return x.score; });
      return { date: s.date, n: sc.length, area: area(sc), scores: s.scores };
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  function monthCompare(points, today) {
    var thisKey = today.slice(0, 7), lastKey = prevMonthKey(today);
    function latestIn(key) {
      var found = null;
      points.forEach(function (p) { if (p.date.slice(0, 7) === key && (!found || p.date > found.date)) found = p; });
      return found;
    }
    var t = latestIn(thisKey), l = latestIn(lastKey);
    var res = { thisKey: thisKey, lastKey: lastKey, thisPoint: t, lastPoint: l, comparable: false, delta: null, pct: null, reason: '' };
    var sameAxes = !!(t && l && t.n === l.n && (!t.scores || !l.scores || t.scores.every(function (x, i) { return x.name.trim() === l.scores[i].name.trim(); })));
    if (t && l && !sameAxes) res.reason = t.n !== l.n ? '维度数不同' : '维度名称或顺序不同';
    if (sameAxes) {
      res.comparable = true;
      res.delta = t.area - l.area;
      res.pct = l.area > 0 ? (res.delta / l.area) * 100 : null;
    }
    return res;
  }
  function makeSnapshot(profile, date) {
    return { date: date, scores: profile.dims.map(function (d) { return { name: d.name, score: d.current }; }) };
  }

  /* ---------- 导出 ---------- */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function guardFormula(s) {
    s = String(s);
    if (/^[=+\-@]/.test(s) && s !== '-' && s !== '+') return "'" + s;
    return s;
  }
  function csvCell(v) {
    var s = guardFormula(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(profile) {
    var kind = profile.synthetic ? '合成示例' : '自评';
    var rows = [['档案', '数据性质', '维度', '当前分', '目标分', '差距', '每周小时', '权重', '证据']];
    profile.dims.forEach(function (d) {
      rows.push([profile.name, kind, d.name, d.current, d.target, Math.max(0, d.target - d.current),
        d.hours === null || d.hours === undefined ? '' : d.hours, d.weight, d.evidence]);
    });
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  var THEME_KEYS = ['bg', 'text', 'muted', 'grid', 'font', 'current', 'currentFill', 'target', 'targetFill',
    'compare', 'compareFill', 'strokeThin', 'strokeSeries', 'dash', 'vertexR', 'labelSize'];
  function safeCss(v, key) {
    var s = String(v === undefined ? '' : v).trim();
    if (!s || s.length > 200 || !/^[A-Za-z0-9#(),.%\s'"\-\/]+$/.test(s)) throw new Error('主题值不安全或缺失:' + key);
    return s;
  }
  function themeCss(t) {
    var v = {};
    THEME_KEYS.forEach(function (k) { v[k] = safeCss(t && t[k], k); });
    return 'text{font-family:' + v.font + ';fill:' + v.text + ';font-size:' + v.labelSize + '}' +
      '.bg{fill:' + v.bg + '}.muted{fill:' + v.muted + '}' +
      '.ring,.axis{fill:none;stroke:' + v.grid + ';stroke-width:' + v.strokeThin + '}' +
      '.poly{stroke-width:' + v.strokeSeries + '}' +
      '.poly-current{stroke:' + v.current + ';fill:' + v.currentFill + '}' +
      '.poly-target{stroke:' + v.target + ';fill:' + v.targetFill + ';stroke-dasharray:' + v.dash + '}' +
      '.poly-compare{stroke:' + v.compare + ';fill:' + v.compareFill + '}' +
      '.vtx{r:' + v.vertexR + '}.vtx-current{fill:' + v.current + '}.vtx-target{fill:' + v.target + '}.vtx-compare{fill:' + v.compare + '}' +
      '.key-current{fill:' + v.current + '}.key-target{fill:' + v.target + '}.key-compare{fill:' + v.compare + '}';
  }
  function fillArr(n, v) { return new Array(n).fill(v); }

  /* model: {names, layers:[{key,label,scores}], size, standalone, theme, title}
     inline(默认):类名 + 页面 CSS 上色,无文字;standalone:自带 <style> 与文字标签,可单独保存为 .svg */
  function toSvg(model) {
    var names = model.names || [], layers = model.layers || [], size = model.size || 400, n = names.length;
    var standalone = !!model.standalone;
    layers.forEach(function (l) {
      if (!/^[a-z0-9-]+$/.test(l.key)) throw new Error('非法图层 key:' + l.key);
      if (l.scores.length !== n) throw new Error('图层分数数量与维度数不一致:' + l.key);
    });
    var c = size / 2, p = [];
    RING_LEVELS.forEach(function (lv) { p.push('<polygon class="ring" points="' + polygonPoints(fillArr(n, lv), size) + '"/>'); });
    var ends = vertices(fillArr(n, 100), size);
    ends.forEach(function (e) { p.push('<line class="axis" x1="' + c + '" y1="' + c + '" x2="' + e.x + '" y2="' + e.y + '"/>'); });
    layers.forEach(function (l) {
      p.push('<polygon class="poly poly-' + l.key + '" data-layer="' + l.key + '" points="' + polygonPoints(l.scores, size) + '"/>');
    });
    layers.forEach(function (l) {
      vertices(l.scores, size).forEach(function (v, i) {
        var label = esc(names[i]) + ' ' + l.scores[i] + ' 分';
        p.push('<circle class="vtx vtx-' + l.key + '" data-layer="' + l.key + '" data-i="' + i + '" cx="' + v.x + '" cy="' + v.y +
          '" tabindex="0" role="img" aria-label="' + esc(l.label) + ':' + label + '">' +
          (standalone ? '<title>' + esc(l.label) + ':' + label + '</title>' : '') + '</circle>');
      });
    });
    var title = esc(model.title || '多维竞争力雷达');
    if (!standalone) {
      return '<svg class="radar-svg" viewBox="0 0 ' + size + ' ' + size + '" role="group" aria-label="' + title + '">' + p.join('') + '</svg>';
    }
    var margin = 120, top = 44, legendH = layers.length * 28 + 12;
    var texts = [];
    ends.forEach(function (e, i) {
      var cos = (e.x - c) / (size / 2), sin = (e.y - c) / (size / 2);
      var lx = round2(c + (e.x - c) * 1.08), ly = round2(c + (e.y - c) * 1.08);
      var anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
      var dy = sin < -0.5 ? '-0.2em' : sin > 0.5 ? '0.9em' : '0.35em';
      texts.push('<text x="' + lx + '" y="' + ly + '" text-anchor="' + anchor + '" dy="' + dy + '">' + esc(names[i]) + '</text>');
    });
    layers.forEach(function (l, k) {
      var y = size + margin + 24 + k * 28;
      texts.push('<circle class="vtx key-' + l.key + '" cx="' + (-margin + 8) + '" cy="' + (y - 5) + '"/>' +
        '<text x="' + (-margin + 24) + '" y="' + y + '">' + esc(l.label) + '</text>');
    });
    var w = size + margin * 2, h = size + margin * 2 + top + legendH;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="' + (-margin) + ' ' + (-margin - top) + ' ' + w + ' ' + h + '" role="img" aria-label="' + title + '">' +
      '<style>' + themeCss(model.theme) + '</style>' +
      '<rect class="bg" x="' + (-margin) + '" y="' + (-margin - top) + '" width="' + w + '" height="' + h + '"/>' +
      '<text x="' + c + '" y="' + (-margin - top + 28) + '" text-anchor="middle">' + title + '</text>' +
      p.join('') + texts.join('') + '</svg>';
  }

  /* 面积折线:x 按日期比例,y 按面积;只输出类名,不含文字 */
  function timelineSvg(points, opts) {
    var o = opts || {}, W = o.width || 480, H = o.height || 220, P = o.pad || 24;
    if (!points.length) return '';
    var max = Math.max.apply(null, points.map(function (q) { return q.area; })) * 1.15 || 1;
    var d0 = dayNumber(points[0].date), d1 = dayNumber(points[points.length - 1].date);
    var xs = points.map(function (q) {
      return points.length === 1 || d1 === d0 ? W / 2 : round2(P + ((dayNumber(q.date) - d0) / (d1 - d0)) * (W - 2 * P));
    });
    var ys = points.map(function (q) { return round2(H - P - (q.area / max) * (H - 2 * P)); });
    var line = xs.map(function (x, i) { return x + ',' + ys[i]; }).join(' ');
    var dots = points.map(function (q, i) {
      return '<circle class="tl-dot" cx="' + xs[i] + '" cy="' + ys[i] + '" tabindex="0"><title>' + esc(q.date) + ' 面积 ' + Math.round(q.area) + '</title></circle>';
    }).join('');
    return '<svg class="tl-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="面积随时间变化折线">' +
      '<line class="tl-base" x1="' + P + '" y1="' + (H - P) + '" x2="' + (W - P) + '" y2="' + (H - P) + '"/>' +
      (points.length > 1 ? '<polyline class="tl-line" points="' + line + '"/>' : '') + dots + '</svg>';
  }

  /* ---------- 校验(写入与读取共用) ---------- */
  function validateState(state) {
    var errors = [];
    function err(m) { if (errors.length < 30) errors.push(m); }
    if (!isObj(state)) return { ok: false, errors: ['存档不是对象'] };
    if (state.v !== STATE_VERSION) err('版本号必须是 ' + STATE_VERSION);
    if (!Array.isArray(state.profiles)) { err('profiles 必须是数组'); return { ok: false, errors: errors }; }
    var pids = new Set();
    state.profiles.forEach(function (pr, pi) {
      var at = '档案 ' + (pi + 1);
      if (!isObj(pr)) { err(at + ' 不是对象'); return; }
      if (typeof pr.id !== 'string' || !pr.id) err(at + ' 缺少字符串 id');
      else if (pids.has(pr.id)) err(at + ' 的 id 重复:' + pr.id);
      else pids.add(pr.id);
      if (typeof pr.name !== 'string' || !pr.name.trim()) err(at + ' 的名称必须是非空字符串');
      else at = '档案「' + pr.name + '」';
      if (typeof pr.synthetic !== 'boolean') err(at + ' 的 synthetic 必须是布尔值');
      if (!isNum(pr.weeklyHours) || pr.weeklyHours < 0) err(at + ' 的 weeklyHours 必须是 ≥ 0 的数字');
      if (!Array.isArray(pr.dims)) { err(at + ' 的 dims 必须是数组'); return; }
      if (pr.dims.length < MIN_DIMS || pr.dims.length > MAX_DIMS) err(at + ' 的维度数必须在 ' + MIN_DIMS + '–' + MAX_DIMS + ' 之间,当前 ' + pr.dims.length);
      var dids = new Set(), dnames = new Set();
      pr.dims.forEach(function (d, di) {
        var dt = at + ' 第 ' + (di + 1) + ' 维';
        if (!isObj(d)) { err(dt + ' 不是对象'); return; }
        if (typeof d.id !== 'string' || !d.id) err(dt + ' 缺少字符串 id');
        else if (dids.has(d.id)) err(dt + ' 的 id 重复:' + d.id);
        else dids.add(d.id);
        if (typeof d.name !== 'string' || !d.name.trim()) err(dt + ' 的名称必须是非空字符串');
        else {
          dt = at + ' 维度「' + d.name + '」';
          if (dnames.has(d.name.trim())) err(dt + ' 名称重复');
          dnames.add(d.name.trim());
        }
        if (!isNum(d.current) || d.current < 0 || d.current > 100) err(dt + ' 的当前分必须是 0–100 的数字');
        if (!isNum(d.target) || d.target < 0 || d.target > 100) err(dt + ' 的目标分必须是 0–100 的数字');
        if (typeof d.evidence !== 'string') err(dt + ' 的证据必须是字符串');
        if (!(d.hours === null || (isNum(d.hours) && d.hours >= 0))) err(dt + ' 的每周小时必须是 null 或 ≥ 0 的数字');
        if (!isNum(d.weight) || d.weight < 0) err(dt + ' 的权重必须是 ≥ 0 的数字');
      });
      if (!Array.isArray(pr.snapshots)) { err(at + ' 的 snapshots 必须是数组'); return; }
      var dates = new Set();
      pr.snapshots.forEach(function (s, si) {
        var st = at + ' 第 ' + (si + 1) + ' 个快照';
        if (!isObj(s)) { err(st + ' 不是对象'); return; }
        if (!isValidDate(s.date)) err(st + ' 的日期必须是真实存在的 YYYY-MM-DD');
        else if (dates.has(s.date)) err(st + ' 的日期重复:' + s.date);
        else dates.add(s.date);
        if (!Array.isArray(s.scores) || s.scores.length < MIN_DIMS || s.scores.length > MAX_DIMS) { err(st + ' 的分数条数必须在 ' + MIN_DIMS + '–' + MAX_DIMS + ' 之间'); return; }
        var sn = new Set();
        s.scores.forEach(function (x) {
          if (!isObj(x) || typeof x.name !== 'string' || !x.name.trim()) { err(st + ' 含名称非法的分数项'); return; }
          if (sn.has(x.name.trim())) err(st + ' 的名称重复:' + x.name);
          sn.add(x.name.trim());
          if (!isNum(x.score) || x.score < 0 || x.score > 100) err(st + ' 的「' + x.name + '」分数必须是 0–100 的数字');
        });
      });
    });
    if (state.activeId !== null && typeof state.activeId !== 'string') err('activeId 必须是 null 或字符串');
    else if (state.profiles.length === 0 && state.activeId !== null) err('没有档案时 activeId 必须是 null');
    else if (state.profiles.length > 0 && !pids.has(state.activeId)) err('activeId 不对应任何档案');
    if (state.compareId !== null && typeof state.compareId !== 'string') err('compareId 必须是 null 或字符串');
    else if (state.compareId !== null && !pids.has(state.compareId)) err('compareId 不对应任何档案');
    return { ok: errors.length === 0, errors: errors };
  }
  function validateImport(input) {
    var obj = input;
    if (typeof input === 'string') {
      try { obj = JSON.parse(input); } catch (e) { return { ok: false, errors: ['不是有效的 JSON:' + e.message], state: null }; }
    }
    var r = validateState(obj);
    return { ok: r.ok, errors: r.errors, state: r.ok ? obj : null };
  }

  /* ---------- 构造 ---------- */
  function uid(prefix) {
    idCounter += 1;
    return prefix + '-' + Date.now().toString(36) + '-' + idCounter.toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function emptyState() { return { v: STATE_VERSION, activeId: null, compareId: null, profiles: [] }; }
  function newDim(name, current, target) {
    return { id: uid('d'), name: name, current: current || 0, target: target || 0, evidence: '', hours: null, weight: 1 };
  }
  function newProfile(name) {
    return {
      id: uid('p'), name: name, synthetic: false, weeklyHours: 0,
      dims: [newDim('维度 1'), newDim('维度 2'), newDim('维度 3')], snapshots: []
    };
  }
  function cloneProfile(pr, name) {
    var c = JSON.parse(JSON.stringify(pr));
    c.id = uid('p'); c.name = name; c.synthetic = false;
    c.dims.forEach(function (d) { d.id = uid('d'); });
    return c;
  }
  /* 唯一维度名:「基础名」冲突时追加数字 */
  function uniqueName(base, taken) {
    var set = new Set(taken.map(function (s) { return s.trim(); }));
    if (!set.has(base)) return base;
    for (var i = 2; ; i++) if (!set.has(base + ' ' + i)) return base + ' ' + i;
  }

  var api = {
    MIN_DIMS: MIN_DIMS, MAX_DIMS: MAX_DIMS, STATE_VERSION: STATE_VERSION,
    isValidDate: isValidDate, todayFromSearch: todayFromSearch, localToday: localToday, dayNumber: dayNumber,
    vertices: vertices, polygonPoints: polygonPoints, area: area, fullArea: fullArea,
    singleDimFullArea: singleDimFullArea, areaRatio: areaRatio,
    compareSingleVsMulti: compareSingleVsMulti, marginalArea: marginalArea, bestMarginal: bestMarginal,
    allocate: allocate, decimalsOf: decimalsOf, timeline: timeline, monthCompare: monthCompare, makeSnapshot: makeSnapshot,
    toCsv: toCsv, csvCell: csvCell, toSvg: toSvg, timelineSvg: timelineSvg, esc: esc,
    validateState: validateState, validateImport: validateImport,
    uid: uid, emptyState: emptyState, newDim: newDim, newProfile: newProfile, cloneProfile: cloneProfile, uniqueName: uniqueName
  };
  globalThis.RadarCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
