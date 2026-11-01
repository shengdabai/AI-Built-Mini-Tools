/*
 * 课表壁纸生成器 · app.js
 * DOM 交互 + canvas 绘制。布局、颜色分配、文字适配都调用 core.js；壁纸配色只读 core.TEMPLATES。
 */
(function () {
  'use strict';

  var C = globalThis.ScheduleWallpaperCore;
  var SAMPLE = globalThis.ScheduleWallpaperSample;
  var STORAGE_KEY = 'kbwp:schedule:v1';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    title: $('input-title'), subtitle: $('input-subtitle'), weekend: $('toggle-weekend'),
    count: $('filled-count'), emptyHint: $('empty-hint'), head: $('grid-head'), body: $('grid-body'),
    courseList: $('course-list'), periodList: $('period-list'), bulkInput: $('bulk-input'),
    bulkResult: $('bulk-result'), bulkErrors: $('bulk-errors'), templateList: $('template-list'),
    sizeList: $('size-list'), stage: $('stage'), device: $('device'), canvas: $('wallpaper'),
    lockRef: $('lock-ref'), lockDate: $('lock-date'), lockToggle: $('toggle-lock'),
    fileName: $('file-name'), toast: $('toast'), fileImport: $('file-import'),
    storageAlert: $('storage-alert')
  };

  // 本地数据损坏且无法备份时置真：不再写 STORAGE_KEY，避免覆盖用户唯一的原始数据
  var saveBlocked = false;
  var state = load();

  /* ---------- 持久化 ---------- */

  function showStorageAlert(msg) {
    els.storageAlert.textContent = msg;
    els.storageAlert.hidden = false;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { /* localStorage 不可用（隐私模式等）：保存时会提示 */ }
    if (!raw) return C.createEmptySchedule();
    var r = C.parseScheduleJSON(raw);
    if (r.ok) return r.schedule;
    // 损坏或不兼容：先把原文另存，再显示持久提示；另存失败则暂停保存，绝不静默覆盖
    var backupKey = STORAGE_KEY + '.corrupt-' + Date.now();
    try {
      localStorage.setItem(backupKey, raw);
      showStorageAlert('本地保存的课表无法读取（' + r.error + '），已按空课表打开。原始内容已原样备份在浏览器本地存储的「' + backupKey + '」键中；接下来的编辑会正常保存。');
    } catch (e) {
      saveBlocked = true;
      showStorageAlert('本地保存的课表无法读取（' + r.error + '），且备份原始内容失败。为避免覆盖原数据，已暂停自动保存：本次编辑不会保存，请用「导出 JSON」保留。');
    }
    return C.createEmptySchedule();
  }

  /* 同步写入（数据只有几 KB）：关页前的最后一次编辑也不会丢。返回是否真正写入成功 */
  function save() {
    if (saveBlocked) return false;
    try {
      localStorage.setItem(STORAGE_KEY, C.serializeSchedule(state));
      return true;
    } catch (e) {
      toast('保存失败：浏览器不允许本地保存，刷新后数据会丢失');
      return false;
    }
  }

  /* ---------- 提示条 ---------- */

  var toastTimer = null;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove('is-visible'); }, 2600);
  }

  /* ---------- 编辑区 ---------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function periodLabel(p) {
    return p.start && p.end ? p.start + '–' + p.end : (p.start || '');
  }

  function renderEditor() {
    var days = C.visibleDays(state);
    var periods = C.orderedPeriods(state);

    els.head.textContent = '';
    var th0 = el('th', 'col-time', '节次');
    th0.scope = 'col';
    els.head.appendChild(th0);
    days.forEach(function (d) {
      var th = el('th', '', d.label);
      th.scope = 'col';
      els.head.appendChild(th);
    });

    // 运行时数据：显示天数，供 CSS 计算编辑表最小宽度
    els.head.closest('table').style.setProperty('--day-count', String(days.length));
    els.body.textContent = '';
    periods.forEach(function (p, i) {
      if (i > 0 && p.session === 'pm' && periods[i - 1].session === 'am') {
        var br = el('tr', 'break-row');
        var td = el('td', '', '午休');
        td.colSpan = days.length + 1;
        br.appendChild(td);
        els.body.appendChild(br);
      }
      var tr = el('tr');
      var rh = el('th', 'row-label', '第' + (i + 1) + '节');
      rh.scope = 'row';
      var t = periodLabel(p);
      if (t) rh.appendChild(el('small', '', t));
      tr.appendChild(rh);
      days.forEach(function (d) {
        var cell = C.getCell(state, d.key, p.id) || { course: '', room: '' };
        var td = el('td');
        var slot = el('div', 'slot');
        slot.dataset.day = d.key;
        slot.dataset.period = p.id;
        var course = el('input', 'slot-course');
        course.type = 'text';
        course.value = cell.course;
        course.maxLength = 20;
        course.placeholder = '课程';
        course.setAttribute('list', 'course-list');
        course.setAttribute('aria-label', d.label + ' 第' + (i + 1) + '节 课程');
        course.dataset.row = String(i);
        var room = el('input', 'slot-room');
        room.type = 'text';
        room.value = cell.room;
        room.maxLength = 12;
        room.placeholder = '教室';
        room.setAttribute('aria-label', d.label + ' 第' + (i + 1) + '节 教室');
        slot.appendChild(course);
        slot.appendChild(room);
        td.appendChild(slot);
        tr.appendChild(td);
      });
      els.body.appendChild(tr);
    });

    els.weekend.checked = state.showWeekend;
    els.title.value = state.title;
    els.subtitle.value = state.subtitle;
    renderPeriods();
    refreshDerived();
  }

  /* 课程颜色条、计数、空状态、自动补全：随每次输入刷新，不重建输入框（保持焦点） */
  function refreshDerived() {
    var T = C.getTemplate(state.templateId);
    var map = C.assignCourseColors(state, T.palette.length);
    els.body.querySelectorAll('.slot').forEach(function (slot) {
      var c = C.getCell(state, slot.dataset.day, slot.dataset.period);
      var idx = c && c.course ? C.colorIndex(map, c.course) : undefined;
      if (idx === undefined) slot.style.removeProperty('--slot-accent');
      else slot.style.setProperty('--slot-accent', T.palette[idx].fill);
    });
    var n = C.filledCount(state);
    els.count.textContent = '已填 ' + n + ' 格';
    els.emptyHint.hidden = n > 0;
    els.courseList.textContent = '';
    Object.keys(map).forEach(function (name) {
      var o = document.createElement('option');
      o.value = name;
      els.courseList.appendChild(o);
    });
    els.fileName.textContent = C.wallpaperFileName(state.sizeKey, new Date());
  }

  function renderPeriods() {
    var periods = C.orderedPeriods(state);
    els.periodList.textContent = '';
    periods.forEach(function (p, i) {
      if (i > 0 && p.session === 'pm' && periods[i - 1].session === 'am') {
        els.periodList.appendChild(el('li', 'period-break'));
      }
      var li = el('li', 'period-item');
      li.appendChild(el('span', 'period-name', '第' + (i + 1) + '节'));
      li.appendChild(el('span', 'period-session', C.SESSIONS[p.session]));
      var s = el('input');
      s.type = 'text';
      s.className = 'time-input';
      s.inputMode = 'numeric';
      s.maxLength = 5;
      s.placeholder = '08:00';
      s.value = p.start;
      s.setAttribute('aria-label', '第' + (i + 1) + '节 开始时间');
      s.dataset.period = p.id;
      s.dataset.field = 'start';
      var e = el('input');
      e.type = 'text';
      e.className = 'time-input';
      e.inputMode = 'numeric';
      e.maxLength = 5;
      e.placeholder = '08:00';
      e.value = p.end;
      e.setAttribute('aria-label', '第' + (i + 1) + '节 结束时间');
      e.dataset.period = p.id;
      e.dataset.field = 'end';
      var del = el('button', 'btn-text', '删除');
      del.type = 'button';
      del.dataset.remove = p.id;
      del.disabled = periods.length <= 1;
      del.setAttribute('aria-label', '删除第' + (i + 1) + '节');
      li.appendChild(s);
      li.appendChild(el('span', 'period-dash', '至'));
      li.appendChild(e);
      li.appendChild(del);
      els.periodList.appendChild(li);
    });
  }

  /* ---------- 模板与尺寸选择 ---------- */

  function renderChoices() {
    els.templateList.textContent = '';
    C.TEMPLATES.forEach(function (t) {
      var b = el('button', 'choice');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(t.id === state.templateId));
      b.dataset.template = t.id;
      var sw = el('span', 'swatch');
      sw.setAttribute('aria-hidden', 'true');
      // 模板色块：运行时把 core.TEMPLATES 的颜色写入自定义属性（设计数据的唯一来源在 core.js）
      sw.style.setProperty('--swatch-bg', t.bg[0]);
      sw.style.setProperty('--swatch-1', t.palette[0].fill);
      sw.style.setProperty('--swatch-2', t.palette[1].fill);
      sw.style.setProperty('--swatch-3', t.palette[2].fill);
      sw.appendChild(el('i'));
      sw.appendChild(el('i'));
      sw.appendChild(el('i'));
      b.appendChild(sw);
      b.appendChild(el('span', '', t.name));
      els.templateList.appendChild(b);
    });
    els.templateList.setAttribute('role', 'radiogroup');
    els.templateList.setAttribute('aria-label', '模板');

    els.sizeList.textContent = '';
    Object.keys(C.SIZES).forEach(function (k) {
      var s = C.SIZES[k];
      var b = el('button', 'choice');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(k === state.sizeKey));
      b.dataset.size = k;
      b.appendChild(el('span', '', s.label));
      b.appendChild(el('small', '', s.w + '×' + s.h));
      els.sizeList.appendChild(b);
    });
    els.sizeList.setAttribute('role', 'radiogroup');
    els.sizeList.setAttribute('aria-label', '尺寸');
  }

  /* ---------- canvas 绘制 ---------- */

  function font(weight, size) { return weight + ' ' + Math.round(size) + 'px ' + C.WALLPAPER_FONT; }

  function makeMeasure(ctx, weight) {
    return function (str, size) {
      ctx.font = font(weight, size);
      return ctx.measureText(str).width;
    };
  }

  /* 固定种子的伪随机数：同一份课表每次导出完全一致 */
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /* 粉笔线：带轻微抖动的线段 */
  function chalkLine(ctx, x1, y1, x2, y2, rand, width) {
    var len = Math.hypot(x2 - x1, y2 - y1);
    var steps = Math.max(2, Math.round(len / 60));
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var jx = (rand() - 0.5) * width * 0.8;
      var jy = (rand() - 0.5) * width * 0.8;
      var x = x1 + (x2 - x1) * t + (x2 === x1 ? jx : 0);
      var y = y1 + (y2 - y1) * t + (y2 === y1 ? jy : 0);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function drawBackground(ctx, T, L) {
    var g = ctx.createLinearGradient(0, 0, 0, L.height);
    g.addColorStop(0, T.bg[0]);
    g.addColorStop(1, T.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L.width, L.height);
    var m = Math.min(L.width, L.height);

    if (T.style === 'block') {
      // 撞色：右下大圆（同色系，不抢课程色）+ 右上小圆（落在标题上方，不压文字）
      ctx.fillStyle = T.decor[0];
      ctx.beginPath();
      ctx.arc(L.width * 0.95, L.height * 0.97, m * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = T.decor[1];
      ctx.beginPath();
      ctx.arc(L.safe.x + L.safe.w - m * 0.07, L.header.y - m * 0.11, m * 0.07, 0, Math.PI * 2);
      ctx.fill();
    } else if (T.style === 'chalk') {
      // 黑板：擦痕 + 粉笔灰
      var rand = rng(7);
      ctx.fillStyle = T.dust;
      for (var k = 0; k < 14; k++) {
        ctx.globalAlpha = 0.01 + rand() * 0.012;
        ctx.beginPath();
        ctx.ellipse(rand() * L.width, rand() * L.height, m * (0.15 + rand() * 0.3), m * (0.04 + rand() * 0.08), rand() * 0.6 - 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      var dots = Math.round(L.width * L.height / 700);
      for (var d = 0; d < dots; d++) {
        ctx.globalAlpha = 0.03 + rand() * 0.07;
        ctx.fillRect(rand() * L.width, rand() * L.height, 1 + rand() * 2, 1 + rand() * 2);
      }
      ctx.globalAlpha = 1;
    } else if (T.style === 'tint') {
      // 清爽：网格区域衬一块白底面板
      ctx.fillStyle = T.cellFill;
      var pad = L.gap * 3;
      roundRect(ctx, L.grid.x - pad, L.grid.y - pad * 0.5, L.grid.w + pad * 2, L.grid.h + pad * 1.5, m * 0.02);
      ctx.fill();
      ctx.strokeStyle = T.line;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function drawFrame(ctx, T, L) {
    var f = Math.round(Math.min(L.width, L.height) * 0.03);
    ctx.fillStyle = T.frame;
    ctx.fillRect(0, 0, L.width, f);
    ctx.fillRect(0, L.height - f, L.width, f);
    ctx.fillRect(0, 0, f, L.height);
    ctx.fillRect(L.width - f, 0, f, L.height);
    ctx.strokeStyle = T.frameShade;
    ctx.lineWidth = Math.max(3, f * 0.18);
    ctx.strokeRect(f, f, L.width - 2 * f, L.height - 2 * f);
    // 木纹
    var rand = rng(11);
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 2;
    for (var i = 0; i < 6; i++) {
      var o = f * (0.15 + rand() * 0.7);
      ctx.beginPath(); ctx.moveTo(0, o); ctx.lineTo(L.width, o + (rand() - 0.5) * 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, L.height - o); ctx.lineTo(L.width, L.height - o + (rand() - 0.5) * 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(o, 0); ctx.lineTo(o + (rand() - 0.5) * 6, L.height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(L.width - o, 0); ctx.lineTo(L.width - o + (rand() - 0.5) * 6, L.height); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawHeader(ctx, T, L, schedule) {
    var size = L.size;
    // 去首尾空白后再画：纯空格标题回退「本周课表」，纯空格副标题不画
    var texts = C.headerTexts(schedule);
    var measureT = makeMeasure(ctx, T.weights.title);
    var fit = C.fitText(texts.title, L.header.w, size.titleSize * 1.3, { maxSize: size.titleSize, minSize: Math.round(size.titleSize * 0.55), maxLines: 1, lineHeight: 1.2 }, measureT);
    ctx.fillStyle = T.ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(T.weights.title, fit.size);
    var baseY = L.header.y + size.titleSize;
    if (fit.lines.length) ctx.fillText(fit.lines[0], L.header.x, baseY);

    if (texts.subtitle) {
      var measureS = makeMeasure(ctx, T.weights.subtitle);
      var sf = C.fitText(texts.subtitle, L.header.w, size.subtitleSize * 1.3, { maxSize: size.subtitleSize, minSize: Math.round(size.subtitleSize * 0.7), maxLines: 1 }, measureS);
      ctx.fillStyle = T.subInk;
      ctx.font = font(T.weights.subtitle, sf.size);
      if (sf.lines.length) ctx.fillText(sf.lines[0], L.header.x, baseY + size.subtitleSize * 1.65);
    }

    if (T.style === 'bar' || T.style === 'block') {
      // 标题下的短横线
      ctx.fillStyle = T.style === 'block' ? T.palette[0].fill : T.line;
      var lineY = L.header.y + L.header.h - size.dayHeaderH * 0.45;
      ctx.fillRect(L.header.x, lineY, T.style === 'block' ? size.titleSize * 1.4 : L.header.w, T.style === 'block' ? 10 : 2);
    }
  }

  function drawDayHeader(ctx, T, L, days) {
    var sz = Math.round(Math.min(L.dayHeader.h * 0.46, L.colW * 0.26));
    ctx.font = font(T.weights.day, sz);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = T.style === 'bar' ? T.subInk : T.ink;
    var cy = L.dayHeader.y + L.dayHeader.h * 0.5;
    days.forEach(function (d, j) {
      var c = L.cols[j];
      ctx.fillText(d.label, c.x + c.w / 2, cy);
    });
  }

  function drawTimeColumn(ctx, T, L, periods) {
    var tc = L.timeCol;
    periods.forEach(function (p, i) {
      var r = L.rows[i];
      var spec = C.periodLabelLayout(r.h, tc.w, !!p.start, !!p.end, Math.round(L.size.subtitleSize * 0.62));
      var lines = [{ text: String(i + 1), size: spec.numSize, weight: T.weights.period, color: T.ink, lh: 1.1 }];
      if (spec.showStart) lines.push({ text: p.start, size: spec.timeSize, weight: T.weights.meta, color: T.subInk, lh: 1.3 });
      if (spec.showEnd) lines.push({ text: p.end, size: spec.timeSize, weight: T.weights.meta, color: T.subInk, lh: 1.3 });
      var total = lines.reduce(function (a, l) { return a + l.size * l.lh; }, 0);
      var y = r.y + (r.h - total) / 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      lines.forEach(function (l) {
        ctx.font = font(l.weight, l.size);
        ctx.fillStyle = l.color;
        ctx.fillText(l.text, tc.x + tc.w * 0.46, y + l.size * l.lh / 2);
        y += l.size * l.lh;
      });
    });
  }

  function drawBreak(ctx, T, L, rand) {
    if (!L.breakBand) return;
    var b = L.breakBand;
    var sz = Math.round(b.h * 0.42);
    var cy = b.y + b.h / 2;
    var label = '午 休';
    ctx.font = font(T.weights.meta, sz);
    var tw = ctx.measureText(label).width;
    var cx = L.timeCol.x + L.timeCol.w + (b.w - L.timeCol.w) / 2;
    ctx.fillStyle = T.breakInk;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy);
    ctx.strokeStyle = T.style === 'chalk' ? T.line : T.breakInk;
    ctx.globalAlpha = T.style === 'chalk' ? 0.5 : 0.45;
    var x0 = L.timeCol.x + L.timeCol.w + L.gap / 2 + b.h * 0.2;
    var x1 = L.grid.x + L.grid.w - L.gap / 2 - b.h * 0.2;
    if (T.style === 'chalk') {
      ctx.strokeStyle = T.line;
      chalkLine(ctx, x0, cy, cx - tw / 2 - sz, cy, rand, 2);
      chalkLine(ctx, cx + tw / 2 + sz, cy, x1, cy, rand, 2);
    } else {
      ctx.lineWidth = 2;
      ctx.setLineDash([sz * 0.25, sz * 0.35]);
      ctx.beginPath();
      ctx.moveTo(x0, cy); ctx.lineTo(cx - tw / 2 - sz, cy);
      ctx.moveTo(cx + tw / 2 + sz, cy); ctx.lineTo(x1, cy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }

  function drawChalkGrid(ctx, T, L, rand) {
    ctx.strokeStyle = T.line;
    ctx.globalAlpha = 0.55;
    var gx0 = L.grid.x;
    var gx1 = L.grid.x + L.grid.w;
    var w = 3;
    // 表头下横线
    chalkLine(ctx, gx0, L.dayHeader.y + L.dayHeader.h, gx1, L.dayHeader.y + L.dayHeader.h, rand, w);
    ctx.globalAlpha = 0.28;
    L.rows.forEach(function (r, i) {
      var next = L.rows[i + 1];
      if (next && next.y === r.y + r.h) chalkLine(ctx, gx0, r.y + r.h, gx1, r.y + r.h, rand, 2);
    });
    // 竖线：时间列右侧与各天之间
    ctx.globalAlpha = 0.4;
    var top = L.dayHeader.y + L.dayHeader.h * 0.15;
    var bottom = L.grid.y + L.grid.h;
    chalkLine(ctx, L.timeCol.x + L.timeCol.w, top, L.timeCol.x + L.timeCol.w, bottom, rand, w);
    ctx.globalAlpha = 0.22;
    L.cols.forEach(function (c, j) {
      if (j === 0) return;
      chalkLine(ctx, c.x, top, c.x, bottom, rand, 2);
    });
    ctx.globalAlpha = 1;
  }

  function drawCell(ctx, T, L, cellBox, entry, color) {
    var x = cellBox.x, y = cellBox.y, w = cellBox.w, h = cellBox.h;
    var r = T.radius * Math.min(w, h);
    var filled = entry && entry.course;

    if (T.style === 'bar') {
      roundRect(ctx, x, y, w, h, r);
      ctx.fillStyle = filled ? T.cellFill : T.emptyFill;
      ctx.fill();
      if (filled) {
        ctx.save();
        roundRect(ctx, x, y, w, h, r);
        ctx.clip();
        ctx.fillStyle = color.fill;
        ctx.fillRect(x, y, Math.max(6, Math.round(w * 0.045)), h);
        ctx.restore();
      }
    } else if (T.style === 'tint') {
      if (filled) {
        roundRect(ctx, x, y, w, h, r);
        ctx.fillStyle = color.fill;
        ctx.fill();
      }
    } else if (T.style === 'block') {
      ctx.fillStyle = filled ? color.fill : T.emptyFill;
      ctx.fillRect(x, y, w, h);
    }
    if (!entry) return;

    var barW = T.style === 'bar' ? Math.max(6, Math.round(w * 0.045)) : 0;
    var pad = Math.max(8, Math.round(Math.min(w, h) * 0.1));
    var innerX = x + barW + pad;
    var innerW = w - barW - pad * 2;
    var innerH = h - pad * 2;
    var roomSize = Math.round(Math.max(L.size.subtitleSize * 0.55, Math.min(h * 0.16, w * 0.15)));
    var hasRoom = !!entry.room;
    var roomBlock = hasRoom ? roomSize * 1.35 : 0;

    var courseInk = color ? color.ink : T.ink;
    var measureC = makeMeasure(ctx, T.weights.course);
    var maxSize = Math.round(Math.min(h * 0.34, w * 0.26, L.size.titleSize * 0.62));
    var cf = entry.course ? C.fitText(entry.course, innerW, innerH - roomBlock, { maxSize: maxSize, minSize: Math.max(16, Math.round(maxSize * 0.5)), maxLines: 2, lineHeight: 1.18 }, measureC) : { lines: [], size: 0, lineHeight: 0 };
    var rf = null;
    if (hasRoom) {
      var measureR = makeMeasure(ctx, T.weights.meta);
      rf = C.fitText(entry.room, innerW, roomSize * 1.3, { maxSize: roomSize, minSize: Math.max(14, Math.round(roomSize * 0.7)), maxLines: 1 }, measureR);
    }
    var total = cf.lines.length * cf.lineHeight + (rf && rf.lines.length ? roomBlock : 0);
    var cy = y + (h - total) / 2;
    var cx = innerX + innerW / 2;

    // 兜底：文字只画在本格范围内（极窄格子里 fitText 也无法满足时不越界）
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = courseInk;
    ctx.font = font(T.weights.course, cf.size);
    cf.lines.forEach(function (line) {
      ctx.fillText(line, cx, cy + cf.lineHeight / 2);
      cy += cf.lineHeight;
    });
    if (rf && rf.lines.length) {
      ctx.font = font(T.weights.meta, rf.size);
      if (T.style === 'bar') { ctx.fillStyle = color ? color.fill : T.subInk; }
      else if (T.style === 'chalk') { ctx.fillStyle = T.subInk; }
      else { ctx.fillStyle = courseInk; ctx.globalAlpha = 0.72; }
      ctx.fillText(rf.lines[0], cx, cy + roomBlock / 2 + roomSize * 0.08);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* 粉笔颗粒：在前景层上随机擦掉细小斑点 */
  function chalkGrain(ctx, w, h) {
    var rand = rng(23);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    var n = Math.round(w * h / 160);
    for (var i = 0; i < n; i++) {
      ctx.globalAlpha = 0.25 + rand() * 0.45;
      ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 1.8, 1 + rand() * 1.8);
    }
    ctx.restore();
  }

  function drawWallpaper(canvas, schedule) {
    var T = C.getTemplate(schedule.templateId);
    var size = C.SIZES[schedule.sizeKey];
    var days = C.visibleDays(schedule);
    var periods = C.orderedPeriods(schedule);
    var L = C.computeLayout(size.key, { dayCount: days.length, sessions: periods.map(function (p) { return p.session; }), gapRatio: T.gap });
    var colorMap = C.assignCourseColors(schedule, T.palette.length);

    if (canvas.width !== size.w) canvas.width = size.w;
    if (canvas.height !== size.h) canvas.height = size.h;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size.w, size.h);
    drawBackground(ctx, T, L);

    // 前景单独一层：粉笔风需要在前景上做颗粒，其余模板直接合成
    var layer = document.createElement('canvas');
    layer.width = size.w;
    layer.height = size.h;
    var fg = layer.getContext('2d');
    var rand = rng(3);

    drawHeader(fg, T, L, schedule);
    if (T.style === 'chalk') drawChalkGrid(fg, T, L, rand);
    drawDayHeader(fg, T, L, days);
    drawTimeColumn(fg, T, L, periods);
    drawBreak(fg, T, L, rand);
    periods.forEach(function (p, i) {
      days.forEach(function (d, j) {
        var box = L.cells[i * days.length + j];
        var entry = C.getCell(schedule, d.key, p.id);
        var idx = entry && entry.course ? C.colorIndex(colorMap, entry.course) : undefined;
        drawCell(fg, T, L, box, entry, idx === undefined ? null : T.palette[idx]);
      });
    });
    if (T.style === 'chalk') chalkGrain(fg, size.w, size.h);
    ctx.drawImage(layer, 0, 0);
    if (T.style === 'chalk') drawFrame(ctx, T, L);
  }

  /* ---------- 预览 ---------- */

  var drawQueued = false;
  function scheduleDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(function () {
      drawQueued = false;
      drawWallpaper(els.canvas, state);
      fitDevice();
    });
  }

  var WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  function fitDevice() {
    var size = C.SIZES[state.sizeKey];
    var T = C.getTemplate(state.templateId);
    var cs = getComputedStyle(els.stage);
    var aw = els.stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var ah = els.stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    var scale = Math.min(aw / size.w, ah / size.h);
    if (!(scale > 0)) return;
    // 运行时测量值：设备框显示尺寸
    els.device.style.width = Math.floor(size.w * scale) + 'px';
    els.device.style.height = Math.floor(size.h * scale) + 'px';
    els.device.dataset.size = size.key;
    els.device.dataset.tone = T.tone;
    var showLock = size.lockClock && els.lockToggle.checked;
    els.lockRef.hidden = !showLock;
    if (showLock) {
      var dispW = size.w * scale;
      // 锁屏时钟按真实 iPhone 锁屏比例：时间字高约为屏宽的 0.24，位于安全区上部
      els.lockRef.style.setProperty('--lock-top', (size.safe.top * 0.2 / size.h * 100) + '%');
      els.lockRef.style.setProperty('--lock-time-size', Math.round(dispW * 0.24) + 'px');
      els.lockRef.style.setProperty('--lock-date-size', Math.round(dispW * 0.05) + 'px');
      var now = new Date();
      els.lockDate.textContent = (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + WEEK[now.getDay()];
    }
  }

  function renderAll() {
    renderChoices();
    renderEditor();
    scheduleDraw();
  }

  /* 返回本次是否已写入本地；调用方只在 true 时显示成功提示 */
  function commit(next, opts) {
    state = next;
    if (opts && opts.structure) renderEditor(); else refreshDerived();
    scheduleDraw();
    return save();
  }

  /* 成功提示只在真正保存后显示；保存被暂停时说明原因（写入失败时 save() 已提示） */
  function toastIfSaved(saved, msg) {
    if (saved) toast(msg);
    else if (saveBlocked) toast('已在页面上生效，但自动保存已暂停（见页面顶部提示），请导出 JSON 保留');
  }

  /* ---------- 事件 ---------- */

  els.body.addEventListener('input', function (e) {
    var slot = e.target.closest('.slot');
    if (!slot) return;
    var course = slot.querySelector('.slot-course').value;
    var room = slot.querySelector('.slot-room').value;
    commit(C.setCell(state, slot.dataset.day, slot.dataset.period, { course: course, room: room }));
  });

  // 回车跳到同一天的下一节
  els.body.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target.classList.contains('slot-course')) return;
    e.preventDefault();
    var slot = e.target.closest('.slot');
    var inputs = Array.prototype.slice.call(els.body.querySelectorAll('.slot[data-day="' + slot.dataset.day + '"] .slot-course'));
    var i = inputs.indexOf(e.target);
    if (i >= 0 && inputs[i + 1]) inputs[i + 1].focus();
  });

  els.title.addEventListener('input', function () {
    var s = JSON.parse(JSON.stringify(state));
    s.title = els.title.value.slice(0, 30);
    commit(s);
  });
  els.subtitle.addEventListener('input', function () {
    var s = JSON.parse(JSON.stringify(state));
    s.subtitle = els.subtitle.value.slice(0, 30);
    commit(s);
  });

  els.weekend.addEventListener('change', function () {
    var s = JSON.parse(JSON.stringify(state));
    s.showWeekend = els.weekend.checked;
    commit(s, { structure: true });
  });

  els.periodList.addEventListener('change', function (e) {
    var t = e.target;
    if (!t.dataset.field) return;
    // 用文本框 + 24 小时制校验，避免系统 12 小时制时间控件在窄屏里被截断
    if (t.value.trim() && !C.normalizeTime(t.value)) {
      toast('时间请写成 24 小时制，例如 08:00、14:30');
      var p = state.periods.find(function (x) { return x.id === t.dataset.period; });
      t.value = p ? p[t.dataset.field] : '';
      return;
    }
    commit(C.updatePeriodTime(state, t.dataset.period, t.dataset.field, t.value), { structure: true });
  });
  els.periodList.addEventListener('click', function (e) {
    var id = e.target.dataset && e.target.dataset.remove;
    if (!id) return;
    var hasCourses = Object.keys(state.cells).some(function (k) { return k.split('|')[1] === id; });
    if (hasCourses && !window.confirm('这一节已经填了课程，删除后这些课程也会一起删除。继续吗？')) return;
    var r = C.removePeriod(state, id);
    if (r.error) { toast(r.error); return; }
    commit(r.schedule, { structure: true });
  });

  function addPeriod(session) {
    var r = C.addPeriod(state, session);
    if (r.error) { toast(r.error); return; }
    toastIfSaved(commit(r.schedule, { structure: true }), '已在' + C.SESSIONS[session] + '末尾加一节');
  }
  $('btn-add-am').addEventListener('click', function () { addPeriod('am'); });
  $('btn-add-pm').addEventListener('click', function () { addPeriod('pm'); });

  $('btn-bulk').addEventListener('click', function () {
    var r = C.parseBulk(els.bulkInput.value, state);
    els.bulkErrors.textContent = '';
    r.errors.forEach(function (err) {
      els.bulkErrors.appendChild(el('li', '', '第 ' + err.line + ' 行「' + err.text + '」：' + err.reason));
    });
    var msg = '填入 ' + r.applied + ' 格';
    if (r.errors.length) msg += '，' + r.errors.length + ' 行没看懂（见下方）';
    if (r.weekendTurnedOn) msg += '；有周末课程，已打开周六、周日';
    els.bulkResult.textContent = msg;
    if (r.applied > 0) {
      commit(r.schedule, { structure: true });
      if (!r.errors.length) els.bulkInput.value = '';
    }
  });

  els.templateList.addEventListener('click', function (e) {
    var b = e.target.closest('[data-template]');
    if (!b) return;
    var s = JSON.parse(JSON.stringify(state));
    s.templateId = b.dataset.template;
    commit(s);
    renderChoices();
  });
  els.sizeList.addEventListener('click', function (e) {
    var b = e.target.closest('[data-size]');
    if (!b) return;
    var s = JSON.parse(JSON.stringify(state));
    s.sizeKey = b.dataset.size;
    commit(s);
    renderChoices();
  });
  // 单选组的方向键切换
  [els.templateList, els.sizeList].forEach(function (group) {
    group.addEventListener('keydown', function (e) {
      if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].indexOf(e.key) < 0) return;
      var items = Array.prototype.slice.call(group.querySelectorAll('[role="radio"]'));
      var i = items.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      var next = items[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
      next.click();
      var again = group.querySelector('[data-' + (group === els.templateList ? 'template' : 'size') + '="' + (next.dataset.template || next.dataset.size) + '"]');
      if (again) again.focus();
    });
  });

  els.lockToggle.addEventListener('change', fitDevice);

  function loadSample() {
    var base = C.createEmptySchedule();
    base.templateId = state.templateId;
    base.sizeKey = state.sizeKey;
    var r = C.parseBulk(SAMPLE.bulk, base);
    r.schedule.title = SAMPLE.title;
    r.schedule.subtitle = SAMPLE.subtitle;
    toastIfSaved(commit(r.schedule, { structure: true }), '已载入' + SAMPLE.label + '（虚构课表，可直接改）');
  }
  /* 顶栏与空状态两个示例按钮共用：只要有任何用户数据（含隐藏的周末格、标题、节次设置）就先确认 */
  function requestSample() {
    if (C.hasUserData(state) && !window.confirm('载入示例会覆盖当前课表（含课程、标题和节次设置），继续吗？')) return;
    loadSample();
  }
  $('btn-sample').addEventListener('click', requestSample);
  $('btn-sample-inline').addEventListener('click', requestSample);

  $('btn-clear').addEventListener('click', function () {
    if (!window.confirm('清空全部课程、标题和节次设置？此操作不可撤销（建议先导出 JSON 备份）。')) return;
    var s = C.createEmptySchedule();
    s.templateId = state.templateId;
    s.sizeKey = state.sizeKey;
    var saved = commit(s, { structure: true });
    els.bulkResult.textContent = '';
    els.bulkErrors.textContent = '';
    toastIfSaved(saved, '已清空');
  });

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  $('btn-export-png').addEventListener('click', function () {
    drawWallpaper(els.canvas, state);
    var name = C.wallpaperFileName(state.sizeKey, new Date());
    els.canvas.toBlob(function (blob) {
      if (!blob) { toast('导出失败：浏览器没有生成图片'); return; }
      download(blob, name);
      toast('已导出 ' + name);
    }, 'image/png');
  });

  $('btn-export-json').addEventListener('click', function () {
    var name = C.jsonFileName(new Date());
    download(new Blob([C.serializeSchedule(state)], { type: 'application/json' }), name);
    toast('已导出 ' + name);
  });

  els.fileImport.addEventListener('change', function () {
    var f = els.fileImport.files && els.fileImport.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      var r = C.parseScheduleJSON(String(reader.result));
      if (!r.ok) { toast('导入失败：' + r.error); return; }
      // 解析成功后、写入前确认；取消则当前课表与本地存储都不变
      if (C.hasUserData(state) && !window.confirm('导入「' + f.name + '」会替换当前课表（含课程、标题和节次设置），且无法撤销。继续吗？')) {
        toast('已取消导入，当前课表未改动');
        return;
      }
      var saved = commit(r.schedule, { structure: true });
      renderChoices();
      toastIfSaved(saved, '已导入 ' + f.name);
    };
    reader.onerror = function () { toast('读取文件失败'); };
    reader.readAsText(f);
    els.fileImport.value = '';
  });

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitDevice).observe(els.stage);
  else window.addEventListener('resize', fitDevice);

  // 测试钩子：截图脚本用它取出真正导出的 PNG 数据
  globalThis.ScheduleWallpaperApp = {
    getState: function () { return JSON.parse(JSON.stringify(state)); },
    exportDataURL: function () { drawWallpaper(els.canvas, state); return els.canvas.toDataURL('image/png'); }
  };

  renderAll();
})();
