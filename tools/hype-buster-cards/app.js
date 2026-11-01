/* ============================================================
 * app.js — 伪概念照妖镜 UI 控制层
 * 依赖: rules-engine.js (window.HBRules)
 * 存储: localStorage 'hb:evaluations'
 * 离线: cases.json 内嵌兜底(file:// 下 fetch 可能被 CORS 拦截)
 * ============================================================ */
(function () {
  'use strict';

  var STORAGE_KEY = 'hb:evaluations';
  var R = window.HBRules;
  var hasRecovery = typeof ArchiveRecovery !== 'undefined';
  var recovery = hasRecovery ? ArchiveRecovery.create({
    key: STORAGE_KEY, label: '鉴定档案',
    refresh: function () { renderHistory(); renderCompare(); }, notify: toast
  }) : null;

  /* ---------- 内嵌案例兜底(file:// 离线可用) ---------- */
  var EMBEDDED_CASES = window.HB_EMBEDDED_CASES || [];

  /* ---------- 状态 ---------- */
  var state = {
    weights: { expertise: 34, tool: 33, trick: 33 },
    dependencyAnswers: {},
    lastResult: null,
    cases: [],
    caseIndex: 0,
    caseAnswered: false,
    caseFlipTimer: null,
    cmpSelection: []
  };

  /* ---------- 工具函数 ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() { return 'ev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); }

  function pct(v) {
    v = Number(v);
    return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0;
  }
  function cleanEval(e) {
    if (!e || typeof e !== 'object') return null;
    return {
      id: /^ev_[\w-]+$/.test(e.id) ? e.id : uid(),
      concept: String(e.concept || '未命名概念'),
      weights: {
        expertise: pct(e.weights && e.weights.expertise),
        tool: pct(e.weights && e.weights.tool),
        trick: pct(e.weights && e.weights.trick)
      },
      dependencyAnswers: e.dependencyAnswers && typeof e.dependencyAnswers === 'object'
        && !Array.isArray(e.dependencyAnswers) ? Object.assign({}, e.dependencyAnswers) : {},
      verdict: (R.VERDICT_META && R.VERDICT_META[e.verdict]) ? e.verdict : 'caution',
      score: pct(e.score),
      reason: String(e.reason || ''),
      analogy: String(e.analogy || ''),
      ts: Number(e.ts) || Date.now()
    };
  }

  function loadEvals() {
    try {
      var raw = hasRecovery ? null : localStorage.getItem(STORAGE_KEY);
      var arr = hasRecovery ? ArchiveRecovery.readList(STORAGE_KEY) : (raw === null ? [] : JSON.parse(raw));
      if (!Array.isArray(arr)) throw new Error('存档不是记录列表');
      if (recovery) recovery.hide();
      return arr.map(cleanEval).filter(Boolean);
    } catch (e) {
      if (recovery) recovery.show();
      toast('存档无法读取，未覆盖原数据。请先备份并检查浏览器存储。');
      return null;
    }
  }
  function saveEvals(arr) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); return true; }
    catch (e) { toast('存储失败:浏览器可能禁用了 localStorage'); return false; }
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ---------- 导航 ---------- */
  function showView(name) {
    $all('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + name); });
    $all('nav button').forEach(function (b) { b.classList.toggle('active', b.dataset.view === name); });
    if (name === 'history') renderHistory();
    if (name === 'compare') renderCompare();
    if (name === 'practice') renderCase();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ============================================================
   * 拆解工坊
   * ============================================================ */
  function syncSliderUI() {
    var w = R.normalizeWeights({
      expertise: +$('#sl-exp').value,
      tool: +$('#sl-tool').value,
      trick: +$('#sl-trick').value
    });
    $('#pct-exp').textContent = w.expertise + '%';
    $('#pct-tool').textContent = w.tool + '%';
    $('#pct-trick').textContent = w.trick + '%';
    var dominant = w.expertise >= w.tool && w.expertise >= w.trick ? '底层专业'
      : (w.trick >= w.tool ? '技巧话术' : '工具熟练度');
    $('#norm-dominant').textContent = dominant;
    state.weights = w;
  }

  function buildQuestions() {
    var host = $('#qa-host');
    host.innerHTML = R.DEPENDENCY_QUESTIONS.map(function (q) {
      return '<div class="qa-item" data-qid="' + q.id + '">'
        + '<div class="q">' + esc(q.text) + '</div>'
        + '<div class="hint">' + esc(q.hint) + '</div>'
        + '<div class="qa-btns">'
        + '<button data-ans="yes">是</button>'
        + '<button data-ans="no">否</button>'
        + '</div></div>';
    }).join('');
    host.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-ans]');
      if (!btn) return;
      var item = btn.closest('.qa-item');
      var qid = item.dataset.qid;
      var ans = btn.dataset.ans;
      state.dependencyAnswers[qid] = ans;
      $all('.qa-btns button', item).forEach(function (b) {
        b.classList.remove('sel-danger', 'sel-safe');
      });
      // 按"危险语义"着色,而非按答案字面值:
      // 每题的 dangerAnswer 才是会扣健康分的那个选项 -> 标红;另一个标绿。
      var q = R.DEPENDENCY_QUESTIONS.filter(function (x) { return x.id === qid; })[0];
      var dangerAns = q && q.dangerAnswer ? q.dangerAnswer : 'no';
      btn.classList.add(ans === dangerAns ? 'sel-danger' : 'sel-safe');
    });
  }

  function runEvaluation() {
    var concept = $('#concept-input').value.trim();
    if (!concept) { toast('先输入一个要鉴定的概念'); $('#concept-input').focus(); return; }
    var missing = R.DEPENDENCY_QUESTIONS.filter(function(q) { return !['yes', 'no'].includes(state.dependencyAnswers[q.id]); });
    if (missing.length) { toast('还有 ' + missing.length + ' 个追问未回答，请补全后再鉴定'); return; }
    var result = R.evaluate({
      concept: concept,
      weights: state.weights,
      dependencyAnswers: state.dependencyAnswers
    });
    state.lastResult = result;
    renderCert(result);
    showView('cert');
  }

  /* ============================================================
   * 结论卡(鉴定书)
   * ============================================================ */
  function renderCert(result) {
    var host = $('#cert-host');
    if (!result) {
      host.innerHTML = '<div class="empty"><div class="big">⚖</div>还没有鉴定结果。先去「拆解工坊」评估一个概念。</div>';
      return;
    }
    var w = result.weights;
    var meta = R.VERDICT_META[result.verdict];
    var dateStr = new Date().toLocaleDateString('zh-CN');

    host.innerHTML =
      '<div class="cert-wrap"><div class="cert" id="cert-card">'
      + '<div class="verdict-stamp" style="color:' + meta.color + ';border-color:' + meta.color + ';">' + esc(meta.stamp) + '</div>'
      + '<div class="cert-head">'
      +   '<div class="seal-line">伪 概 念 鉴 定 书</div>'
      +   '<h3>照妖镜 · 鉴定结论</h3>'
      +   '<div class="concept">' + esc(result.concept) + '</div>'
      + '</div>'
      + '<div class="cert-divider"></div>'
      + '<div class="bars">' + barRow('底层专业', w.expertise, 'exp') + barRow('工具熟练', w.tool, 'tool') + barRow('技巧话术', w.trick, 'trick') + '</div>'
      + '<div class="cert-divider"></div>'
      + '<div class="verdict-line">'
      +   '<span class="verdict-badge" style="background:' + meta.color + ';">' + esc(meta.label) + '</span>'
      +   '<span class="verdict-score">健康度评分 ' + result.score + ' / 100 · ' + esc(meta.desc) + '</span>'
      + '</div>'
      + '<div class="cert-reason">' + esc(result.reason) + '</div>'
      + '<div class="cert-analogy">「快捷键工程师」类比器:' + esc(result.analogy) + '</div>'
      + '<div class="cert-foot">鉴定日期 ' + dateStr + ' · 依据「专业 &gt; 工具 &gt; 技巧」框架 · 本鉴定不可作呈堂证供,仅供按住钱包用</div>'
      + '</div></div>';
  }

  function barRow(name, val, cls) {
    return '<div class="bar-row">'
      + '<div class="bl"><span>' + name + '</span><span class="v">' + val + '%</span></div>'
      + '<div class="bar-track"><div class="bar-fill ' + cls + '" style="width:0%" data-w="' + val + '"></div></div>'
      + '</div>';
  }

  function animateBars(root) {
    requestAnimationFrame(function () {
      $all('.bar-fill', root).forEach(function (el) {
        el.style.width = (el.dataset.w || 0) + '%';
      });
    });
  }

  function saveCurrentResult() {
    if (!state.lastResult) { toast('没有可保存的结果'); return; }
    var evals = loadEvals();
    if (!evals) return;
    // 去重:同名概念覆盖
    evals = evals.filter(function (e) { return e.concept !== state.lastResult.concept; });
    evals.unshift({
      id: uid(),
      concept: state.lastResult.concept,
      weights: state.lastResult.weights,
      dependencyAnswers: state.lastResult.dependencyAnswers,
      verdict: state.lastResult.verdict,
      score: state.lastResult.score,
      reason: state.lastResult.reason,
      analogy: state.lastResult.analogy,
      ts: Date.now()
    });
    if (saveEvals(evals)) toast('已存入档案库 ✓');
  }

  /* ---------- 导出 PNG(纯 Canvas,无外部库) ---------- */
  function exportCertPNG() {
    if (!state.lastResult) { toast('没有可导出的卡片'); return; }
    var r = state.lastResult;
    var w = r.weights;
    var meta = R.VERDICT_META[r.verdict];
    var scale = 2;
    var W = 560, H = 720;
    var cv = document.createElement('canvas');
    cv.width = W * scale; cv.height = H * scale;
    var ctx = cv.getContext('2d');
    ctx.scale(scale, scale);

    // 纸底
    ctx.fillStyle = '#f4ead4'; ctx.fillRect(0, 0, W, H);
    // 横线纹理
    ctx.strokeStyle = 'rgba(42,36,24,0.05)';
    for (var y = 40; y < H; y += 28) { ctx.beginPath(); ctx.moveTo(24, y); ctx.lineTo(W - 24, y); ctx.stroke(); }
    // 双线边框
    ctx.strokeStyle = 'rgba(42,36,24,0.45)'; ctx.lineWidth = 6;
    ctx.strokeRect(16, 16, W - 32, H - 32);
    ctx.lineWidth = 1; ctx.strokeRect(28, 28, W - 56, H - 56);

    var serif = '"Noto Serif SC", "Songti SC", serif';
    function center(text, y, font, color) {
      ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'center';
      ctx.fillText(text, W / 2, y);
    }
    center('伪 概 念 鉴 定 书', 70, '13px ' + serif, '#8a7642');
    center('照妖镜 · 鉴定结论', 102, 'bold 26px ' + serif, '#2a2418');
    // 概念
    ctx.font = 'bold 22px ' + serif; ctx.fillStyle = '#5a3c1a'; ctx.textAlign = 'center';
    var concept = r.concept.length > 18 ? r.concept.slice(0, 18) + '…' : r.concept;
    ctx.fillText(concept, W / 2, 150);
    ctx.strokeStyle = 'rgba(90,60,26,0.4)'; ctx.lineWidth = 2;
    var cw = ctx.measureText(concept).width;
    ctx.beginPath(); ctx.moveTo(W / 2 - cw / 2 - 10, 160); ctx.lineTo(W / 2 + cw / 2 + 10, 160); ctx.stroke();

    // 印章
    ctx.save();
    ctx.translate(W - 95, 90); ctx.rotate(-0.24);
    ctx.strokeStyle = meta.color; ctx.lineWidth = 3;
    ctx.strokeRect(-44, -22, 88, 44);
    ctx.font = 'bold 18px ' + serif; ctx.fillStyle = meta.color; ctx.textAlign = 'center';
    ctx.fillText(meta.stamp, 0, 7);
    ctx.restore();

    // 三维条形图
    var bx = 60, bw = W - 120, by = 200;
    var bars = [
      { n: '底层专业', v: w.expertise, c: '#c89b3c' },
      { n: '工具熟练', v: w.tool, c: '#5b86b8' },
      { n: '技巧话术', v: w.trick, c: '#b04848' }
    ];
    ctx.textAlign = 'left';
    bars.forEach(function (b, i) {
      var yy = by + i * 46;
      ctx.font = '14px ' + serif; ctx.fillStyle = '#3a3120';
      ctx.fillText(b.n, bx, yy - 6);
      ctx.textAlign = 'right'; ctx.fillStyle = b.c; ctx.font = 'bold 15px ' + serif;
      ctx.fillText(b.v + '%', bx + bw, yy - 6); ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(42,36,24,0.10)'; ctx.fillRect(bx, yy, bw, 16);
      ctx.fillStyle = b.c; ctx.fillRect(bx, yy, bw * b.v / 100, 16);
    });

    // 判定
    var vy = by + 3 * 46 + 28;
    ctx.fillStyle = meta.color; roundRect(ctx, bx, vy, 110, 34, 6); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 17px ' + serif; ctx.textAlign = 'center';
    ctx.fillText(meta.label, bx + 55, vy + 23);
    ctx.fillStyle = '#6b5836'; ctx.font = '13px ' + serif; ctx.textAlign = 'left';
    ctx.fillText('健康度 ' + r.score + '/100 · ' + meta.desc, bx + 124, vy + 22);

    // 理由(自动换行)
    ctx.fillStyle = '#3a3120'; ctx.font = '14px ' + serif;
    wrapText(ctx, r.reason, bx, vy + 64, bw, 23);

    // 类比(斜体感用 serif)
    var ay = vy + 64 + wrapMeasure(ctx, r.reason, bw, 23) * 23 + 18;
    ctx.fillStyle = '#5a3c1a'; ctx.font = '13px ' + serif;
    wrapText(ctx, '类比:' + r.analogy, bx, ay, bw, 22);

    // 脚注
    center('鉴定日期 ' + new Date().toLocaleDateString('zh-CN') + ' · 专业 > 工具 > 技巧', H - 46, '11px ' + serif, '#8a7642');

    // 下载
    try {
      var link = document.createElement('a');
      link.download = '鉴定书_' + r.concept.slice(0, 12) + '.png';
      link.href = cv.toDataURL('image/png');
      link.click();
      toast('鉴定书已导出 PNG ✓');
    } catch (e) { toast('导出失败:' + e.message); }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function wrapText(ctx, text, x, y, maxW, lh) {
    var chars = String(text).split('');
    var line = '', yy = y;
    for (var i = 0; i < chars.length; i++) {
      var test = line + chars[i];
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, yy); line = chars[i]; yy += lh;
      } else { line = test; }
    }
    if (line) ctx.fillText(line, x, yy);
  }
  function wrapMeasure(ctx, text, maxW, lh) {
    var chars = String(text).split(''); var line = '', lines = 1;
    for (var i = 0; i < chars.length; i++) {
      var test = line + chars[i];
      if (ctx.measureText(test).width > maxW && line) { lines++; line = chars[i]; }
      else line = test;
    }
    return lines;
  }

  /* ============================================================
   * 历史档案库
   * ============================================================ */
  function renderHistory() {
    var host = $('#history-host');
    var evals = loadEvals();
    if (!evals) {
      host.textContent = '鉴定档案无法读取，请使用上方恢复面板。';
      host.onclick = null;
      return;
    }
    if (!evals.length) {
      host.innerHTML = '<div class="empty"><div class="big">🗄</div>档案库还是空的。<br>去鉴定几个概念,结论卡里点「存入档案库」即可收藏。</div>';
      return;
    }
    host.innerHTML = '<div class="hist-grid">' + evals.map(function (e) {
      var meta = R.VERDICT_META[e.verdict] || R.VERDICT_META.caution;
      var w = e.weights;
      return '<div class="hist-card" data-id="' + e.id + '">'
        + '<div class="hc-main">'
        +   '<div class="hc-name">' + esc(e.concept) + '</div>'
        +   '<div class="hc-mini-bars">'
        +     '<i class="exp" style="width:' + w.expertise + '%"></i>'
        +     '<i class="tool" style="width:' + w.tool + '%"></i>'
        +     '<i class="trick" style="width:' + w.trick + '%"></i>'
        +   '</div>'
        + '</div>'
        + '<span class="hc-verdict" style="background:' + meta.color + ';">' + esc(meta.label) + ' ' + e.score + '</span>'
        + '<button class="hc-del" data-del="' + e.id + '" title="删除">✕</button>'
        + '</div>';
    }).join('') + '</div>';

    host.onclick = function (ev) {
      var del = ev.target.closest('[data-del]');
      if (del) {
        var id = del.dataset.del;
        var loaded = loadEvals();
        if (!loaded) return;
        var arr = loaded.filter(function (e) { return e.id !== id; });
        if (saveEvals(arr)) { renderHistory(); toast('已删除'); }
        return;
      }
      var card = ev.target.closest('.hist-card');
      if (card) {
        var loaded = loadEvals();
        if (!loaded) return;
        var item = loaded.filter(function (e) { return e.id === card.dataset.id; })[0];
        if (item) { state.lastResult = item; renderCert(item); showView('cert'); }
      }
    };
  }

  /* ============================================================
   * 横向对比
   * ============================================================ */
  function renderCompare() {
    var host = $('#compare-host');
    var evals = loadEvals();
    if (!evals) { host.textContent = '鉴定档案无法读取，请使用上方恢复面板。'; return; }
    if (evals.length < 1) {
      host.innerHTML = '<div class="empty"><div class="big">📊</div>还没有可对比的档案。先去鉴定并保存几个概念。</div>';
      return;
    }
    var rows = evals.map(function (e) {
      var meta = R.VERDICT_META[e.verdict] || R.VERDICT_META.caution;
      var w = e.weights;
      return '<div class="cmp-row">'
        + '<div class="cmp-name">' + esc(e.concept) + '<small>' + esc(meta.label) + ' · ' + e.score + '/100</small></div>'
        + '<div class="cmp-bar-stack">'
        +   '<i class="exp" style="width:' + w.expertise + '%">' + (w.expertise >= 12 ? w.expertise : '') + '</i>'
        +   '<i class="tool" style="width:' + w.tool + '%">' + (w.tool >= 12 ? w.tool : '') + '</i>'
        +   '<i class="trick" style="width:' + w.trick + '%">' + (w.trick >= 12 ? w.trick : '') + '</i>'
        + '</div></div>';
    }).join('');
    host.innerHTML =
      '<div class="legend">'
      + '<span><i class="dot exp"></i>底层专业(金)</span>'
      + '<span><i class="dot tool"></i>工具熟练(钢蓝)</span>'
      + '<span><i class="dot trick"></i>技巧话术(暗红)</span>'
      + '</div>'
      + '<div class="cmp-table">' + rows + '</div>';
  }

  /* ============================================================
   * 批判思维练习
   * ============================================================ */
  function renderCase() {
    clearTimeout(state.caseFlipTimer);
    state.caseFlipTimer = null;
    var host = $('#practice-host');
    var cases = state.cases;
    if (!cases.length) {
      host.innerHTML = '<div class="empty"><div class="big">🃏</div>案例库加载中…若长时间无内容,请确认 cases.json 与页面同目录。</div>';
      return;
    }
    if (state.caseIndex >= cases.length) state.caseIndex = 0;
    var c = cases[state.caseIndex];
    state.caseAnswered = false;
    var typeLabel = { causation: '相关 ≠ 因果', survivorship: '幸存者偏差', hype: '伪概念识别' }[c.type] || c.type;

    host.innerHTML =
      '<div class="case-meta">'
      + '<span class="type-tag">' + esc(typeLabel) + '</span>'
      + '<span class="case-progress">第 ' + (state.caseIndex + 1) + ' / ' + cases.length + ' 题</span>'
      + '</div>'
      + '<div class="flip-scene"><div class="flip-card" id="flip-card">'
      +   '<div class="flip-face flip-front">'
      +     '<div class="case-q">' + esc(c.prompt) + '</div>'
      +     '<div class="opt-list" id="opt-list"></div>'
      +   '</div>'
      +   '<div class="flip-face flip-back" id="flip-back"></div>'
      + '</div></div>'
      + '<div class="btn-row" style="margin-top:18px;">'
      +   '<button class="btn btn-ghost" id="case-next">下一题 →</button>'
      + '</div>';

    var optList = $('#opt-list');
    optList.innerHTML = c.options.map(function (o, i) {
      return '<button class="opt" data-i="' + i + '"><span class="ol">' + esc(o.label) + '</span><span>' + esc(o.text) + '</span></button>';
    }).join('');

    optList.addEventListener('click', function (e) {
      var btn = e.target.closest('.opt');
      if (!btn || state.caseAnswered) return;
      state.caseAnswered = true;
      var i = +btn.dataset.i;
      var picked = c.options[i];
      $all('.opt', optList).forEach(function (b, bi) {
        if (c.options[bi].correct) b.classList.add('correct');
        else if (bi === i) b.classList.add('wrong');
      });
      var ok = !!picked.correct;
      $('#flip-back').innerHTML =
        '<div class="result-head ' + (ok ? 'ok' : 'no') + '">' + (ok ? '✓ 看穿了' : '✗ 中招了') + '</div>'
        + '<div class="explain-title">拆 解</div>'
        + '<div class="explain">' + esc(c.explanation) + '</div>';
      var answeredCard = $('#flip-card');
      state.caseFlipTimer = setTimeout(function () {
        answeredCard.classList.add('flipped');
        state.caseFlipTimer = null;
      }, 480);
    });

    $('#case-next').addEventListener('click', function () {
      state.caseIndex = (state.caseIndex + 1) % cases.length;
      renderCase();
    });
  }

  /* ---------- 案例加载(fetch 优先,内嵌兜底) ---------- */
  function loadCases() {
    // 先用内嵌案例兜底,保证任何时候点开练习页都有内容(含 http 模式下 fetch 未完成时)
    state.cases = EMBEDDED_CASES;
    if (location.protocol === 'file:') {
      return Promise.resolve();
    }
    return fetch('cases.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (Array.isArray(data) && data.length) state.cases = data;
      })
      .catch(function () { /* 保持内嵌兜底 */ })
      .then(function () {
        // 若用户已停留在练习页,加载完成后刷新一次
        if ($('#view-practice').classList.contains('active')) renderCase();
      });
  }

  /* ============================================================
   * 初始化
   * ============================================================ */
  function init() {
    // 导航
    $all('nav button').forEach(function (b) {
      b.addEventListener('click', function () { showView(b.dataset.view); });
    });
    $('.brand').addEventListener('click', function () { showView('workshop'); });

    // 滑杆
    ['sl-exp', 'sl-tool', 'sl-trick'].forEach(function (id) {
      $('#' + id).addEventListener('input', syncSliderUI);
    });
    syncSliderUI();

    // 概念快捷示例
    $all('.chip').forEach(function (c) {
      c.addEventListener('click', function () {
        $('#concept-input').value = c.dataset.concept;
        $('#concept-input').focus();
      });
    });

    buildQuestions();

    $('#run-eval').addEventListener('click', runEvaluation);
    $('#reset-form').addEventListener('click', function () {
      $('#concept-input').value = '';
      $('#sl-exp').value = 34; $('#sl-tool').value = 33; $('#sl-trick').value = 33;
      state.dependencyAnswers = {};
      $all('.qa-btns button').forEach(function (b) { b.classList.remove('sel-danger', 'sel-safe'); });
      syncSliderUI();
      toast('已重置');
    });

    $('#save-cert').addEventListener('click', saveCurrentResult);
    $('#export-cert').addEventListener('click', exportCertPNG);
    $('#back-workshop').addEventListener('click', function () { showView('workshop'); });

    // 渲染时给条形图做动画
    var certObserver = new MutationObserver(function () {
      var card = $('#cert-card');
      if (card) animateBars(card);
    });
    certObserver.observe($('#cert-host'), { childList: true });

    loadCases();
    renderCert(null);
    showView('workshop');
    loadEvals();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
