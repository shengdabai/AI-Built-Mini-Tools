'use strict';
(function () {
  var C = globalThis.UrlCheckCore;
  var KEY = 'urlcheck.v1';
  var SHOW_MAX = 300;
  var $ = function (id) { return document.getElementById(id); };

  var data = freshData();
  var checkSnap = null;
  var buildSnap = null;

  function freshData() {
    return { text: '', settings: JSON.parse(JSON.stringify({
      required: C.DEFAULTS.required, lowercaseValues: C.DEFAULTS.lowercaseValues, campaignPattern: C.DEFAULTS.campaignPattern,
      allowedDomains: C.DEFAULTS.allowedDomains, checkOrder: C.DEFAULTS.checkOrder
    })), buildBase: '', buildTable: '', sample: false };
  }

  /* ---------- DOM 小工具(用户内容一律走 textContent) ---------- */
  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function linkP(url) { var p = h('p', 'link'); p.appendChild(h('code', null, url)); return p; }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  /* ---------- 存储 ---------- */
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      $('save-warning').hidden = true;
      return true;
    } catch (e) {
      $('save-warning').hidden = false;
      return false;
    }
  }
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (raw == null) return;
    var reason = '';
    try {
      var o = JSON.parse(raw);
      var v = o && typeof o === 'object' ? C.validateSettings(o.settings) : { ok: false, error: '不是对象' };
      if (!v.ok) reason = v.error;
      else if (typeof o.text !== 'string' || typeof o.buildBase !== 'string' || typeof o.buildTable !== 'string') reason = '文本字段类型不对';
      else data = { text: o.text, settings: v.value, buildBase: o.buildBase, buildTable: o.buildTable, sample: o.sample === true };
    } catch (e) { reason = '不是合法 JSON'; }
    if (reason) {
      var w = $('load-warning');
      w.textContent = '本机保存的数据格式不合法(' + reason + '),已整份忽略,没有被改动或覆盖,下次保存时才会替换。';
      w.hidden = false;
    }
  }

  var flashTimer = null;
  function flash(msg, withSave) {
    var el = $('flash');
    var tail = withSave === undefined ? '' : (withSave ? ' 已保存到本机浏览器。' : ' 但未能保存,请看上方红色提示。');
    el.textContent = msg + tail;
    el.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.hidden = true; }, 6000);
  }

  function renderSampleTags() {
    ['check', 'result', 'build', 'build-result'].forEach(function (k) { $('sample-tag-' + k).hidden = !data.sample; });
  }
  function markReal() {
    if (!data.sample) return;
    data.sample = false;
    renderSampleTags();
  }

  /* ---------- 设置表单 ---------- */
  function splitList(s) { return s.split(/[,，\s]+/).filter(Boolean); }
  function writeSettingsForm(s) {
    $('set-required').value = s.required.join(', ');
    $('set-pattern').value = s.campaignPattern;
    $('set-domains').value = s.allowedDomains.join(', ');
    $('set-lower').checked = s.lowercaseValues;
    $('set-order').checked = s.checkOrder;
  }
  function readSettingsForm(focusOnError) {
    var v = C.validateSettings({
      required: splitList($('set-required').value),
      lowercaseValues: $('set-lower').checked,
      campaignPattern: $('set-pattern').value,
      allowedDomains: splitList($('set-domains').value),
      checkOrder: $('set-order').checked
    });
    var err = $('settings-error');
    if (v.ok) { err.hidden = true; ['set-required', 'set-pattern', 'set-domains'].forEach(function (id) { $(id).removeAttribute('aria-invalid'); }); } else {
      err.textContent = '规则设置不合法:' + v.error + '。修正后才能检查或生成。';
      err.hidden = false;
      $('settings').open = true;
      var bad = /正则/.test(v.error) ? 'set-pattern' : (/域名/.test(v.error) ? 'set-domains' : 'set-required');
      ['set-required', 'set-pattern', 'set-domains'].forEach(function (id) { $(id).setAttribute('aria-invalid', id === bad ? 'true' : 'false'); });
      if (focusOnError) $(bad).focus();
    }
    return v;
  }
  function inputKey() {
    return JSON.stringify([$('links-text').value, $('set-required').value, $('set-pattern').value, $('set-domains').value, $('set-lower').checked, $('set-order').checked]);
  }
  function buildKey() { return JSON.stringify([$('build-base').value, $('build-table').value, $('set-required').value, $('set-lower').checked]); }

  /* ---------- 检查 ---------- */
  function run() {
    var v = readSettingsForm(true);
    if (!v.ok) return false;
    data.settings = v.value;
    data.text = $('links-text').value;
    var entries = C.parseBatch(data.text);
    $('input-error').hidden = !entries.error;
    if (entries.error) { $('input-error').textContent = entries.error + '。修正后才能检查。'; checkSnap = null; renderCheck(); return false; }
    var out = C.check(entries.map(function (e) { return { raw: e.raw, row: e.row }; }), data.settings);
    checkSnap = { key: inputKey(), out: out, entries: entries };
    save();
    renderCheck();
    return true;
  }

  function sampleNote() { return data.sample ? '> 合成示例:链接为虚构数据(example.com),不是真实投放链接。\n\n' : ''; }
  function fname(base, ext) { return base + (data.sample ? '-合成示例' : '') + ext; }
  function isStale() { return !checkSnap || checkSnap.key !== inputKey(); }

  function renderCheck() {
    var has = !!checkSnap;
    var stale = has && isStale();
    $('empty-guide').hidden = has;
    $('result-area').hidden = !has;
    $('stale-note').hidden = !stale;
    var canExport = has && !stale && checkSnap.out.stats.total > 0;
    ['export-csv', 'export-md', 'export-norm-csv', 'export-norm-txt'].forEach(function (id) { $(id).disabled = !canExport; });
    var changed = has ? checkSnap.out.results.filter(function (r) { return r.changed; }).length : 0;
    $('btn-adopt-all').disabled = !(has && !stale && changed > 0);
    if (!has) return;
    var st = checkSnap.out.stats;
    var sum = $('summary');
    clear(sum);
    sum.appendChild(h('span', 'stat', '共 ' + st.total + ' 条链接'));
    sum.appendChild(h('span', 'stat stat--block', '阻断 ' + st.blocked + ' 条'));
    sum.appendChild(h('span', 'stat stat--warn', '仅警告 ' + st.warned + ' 条'));
    sum.appendChild(h('span', 'stat stat--ok', '通过 ' + st.clean + ' 条'));
    st.notes.forEach(function (n) { sum.appendChild(h('span', 'stat stat--warn', n)); });
    $('md-preview').value = sampleNote() + C.issuesToMarkdown(checkSnap.out.issues, st);
    renderSampleTags();
    renderResults();
  }

  function renderResults() {
    var box = $('results');
    clear(box);
    if (!checkSnap) return;
    var out = checkSnap.out;
    var f = $('filter').value;
    var byRow = new Map();
    out.issues.forEach(function (i) {
      if (!byRow.has(i.row)) byRow.set(i.row, []);
      byRow.get(i.row).push(i);
    });
    var list = out.results.filter(function (r) {
      return f === 'all' || (f === 'issues' && r.level !== 'ok') || (f === 'block' && r.level === 'block');
    });
    if (!list.length) box.appendChild(h('p', 'hint', out.stats.total ? '没有符合筛选条件的链接。' : '没有可检查的链接:请先粘贴链接。'));
    list.slice(0, SHOW_MAX).forEach(function (r) {
      var card = h('article', 'result result--' + r.level);
      var head = h('div', 'result__head');
      head.appendChild(h('span', 'badge badge--' + r.level, C.levelLabel(r.level)));
      head.appendChild(h('span', 'result__row', '第 ' + r.row + ' 行'));
      card.appendChild(head);
      card.appendChild(linkP(r.raw));
      var iss = byRow.get(r.row) || [];
      if (iss.length) {
        var ul = h('ul', 'issue-list');
        iss.forEach(function (i) {
          ul.appendChild(h('li', 'issue--' + i.level, C.levelLabel(i.level) + ' · ' + C.RULES[i.code].label + ':' + i.message));
        });
        card.appendChild(ul);
      }
      if (r.changed) {
        var box2 = h('div', 'suggest');
        box2.appendChild(h('span', 'suggest__label', '建议链接'));
        box2.appendChild(linkP(r.normalized));
        var row = h('div', 'row');
        var b = h('button', 'btn btn--secondary', '采用这条建议');
        b.type = 'button';
        b.addEventListener('click', function () { adopt([r.row]); });
        row.appendChild(b);
        box2.appendChild(row);
        card.appendChild(box2);
      }
      box.appendChild(card);
    });
    if (list.length > SHOW_MAX) box.appendChild(h('p', 'hint', '只显示前 ' + SHOW_MAX + ' 条,导出文件包含全部。'));
  }

  function adopt(rows) {
    if (!run()) return;
    var map = new Map();
    checkSnap.out.results.forEach(function (r) {
      if (r.changed && r.normalized && (!rows || rows.indexOf(r.row) >= 0)) map.set(r.row, r.normalized);
    });
    if (!map.size) { flash('没有可采用的建议。'); return; }
    $('links-text').value = C.applyAdoptions($('links-text').value, checkSnap.entries, map);
    run();
    flash('已采用 ' + map.size + ' 条建议链接并重新检查。', save());
  }

  /* ---------- 导出 ---------- */
  function download(name, text, mime, bom) {
    var blob = new Blob([(bom ? '﻿' : '') + text], { type: mime + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function exportIfFresh(fn) {
    if (!checkSnap || isStale()) { flash('结果已过期,请先重新检查。'); renderCheck(); return; }
    fn(checkSnap.out);
  }

  /* ---------- 批量构建 ---------- */
  function buildRun() {
    var v = readSettingsForm(true);
    if (!v.ok) return false;
    data.settings = v.value;
    data.buildBase = $('build-base').value;
    data.buildTable = $('build-table').value;
    var table = C.parseTable(data.buildTable);
    var out = table.errors.length
      ? { ok: false, error: table.errors[0], links: [], errors: [], count: 0 }
      : C.build(data.buildBase, table.rows, data.settings);
    buildSnap = { key: buildKey(), out: out };
    save();
    renderBuild();
    return true;
  }
  function renderBuild() {
    var has = !!buildSnap;
    $('build-area').hidden = !has;
    var stale = has && buildSnap.key !== buildKey();
    $('stale-build').hidden = !stale;
    if (!has) return;
    var out = buildSnap.out;
    $('export-build-csv').disabled = stale || !out.ok || out.count === 0;
    $('build-summary').textContent = out.ok ? '共生成 ' + out.count + ' 条链接(各行取值的全部组合)。' : out.error;
    var ul = $('build-errors');
    clear(ul);
    out.errors.forEach(function (e) { ul.appendChild(h('li', 'issue--block', e.message)); });
    var box = $('build-results');
    clear(box);
    out.links.slice(0, SHOW_MAX).forEach(function (l, i) {
      var card = h('article', 'result result--ok');
      var head = h('div', 'result__head');
      head.appendChild(h('span', 'result__row', '第 ' + (i + 1) + ' 条'));
      head.appendChild(h('span', null, [l.source, l.medium, l.campaign, l.content, l.term].filter(Boolean).join(' / ')));
      card.appendChild(head);
      card.appendChild(linkP(l.url));
      box.appendChild(card);
    });
    if (out.links.length > SHOW_MAX) box.appendChild(h('p', 'hint', '只显示前 ' + SHOW_MAX + ' 条,导出文件包含全部。'));
  }

  /* ---------- 视图与数据操作 ---------- */
  function showView(name) {
    ['check', 'build'].forEach(function (v) { $('view-' + v).hidden = v !== name; });
    document.querySelectorAll('.tab').forEach(function (t) {
      if (t.dataset.view === name) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
  }
  function fillForm() {
    $('links-text').value = data.text;
    writeSettingsForm(data.settings);
    $('build-base').value = data.buildBase;
    $('build-table').value = data.buildTable;
  }
  function loadSample() {
    var S = globalThis.UrlCheckSample;
    var v = C.validateSettings(S.settings);
    data = { text: S.text, settings: v.value, buildBase: S.buildBase, buildTable: S.buildTable, sample: true };
    fillForm();
    run();
    buildRun();
    flash('已载入' + S.label + '(虚构链接,域名 example.com)。', save());
  }

  function hasUserContent() {
    return $('links-text').value.trim() !== '' || $('build-base').value.trim() !== '' || $('build-table').value.trim() !== '' ||
      JSON.stringify(data.settings) !== JSON.stringify(freshData().settings);
  }
  function requestSample() {
    if (hasUserContent()) { $('sample-confirm').hidden = false; $('btn-sample-no').focus(); } else loadSample();
  }
  $('btn-sample').addEventListener('click', requestSample);
  $('btn-sample-2').addEventListener('click', requestSample);
  $('btn-sample-no').addEventListener('click', function () { $('sample-confirm').hidden = true; });
  $('btn-sample-yes').addEventListener('click', function () { $('sample-confirm').hidden = true; loadSample(); });
  $('btn-check').addEventListener('click', function () { if (run()) flash('已检查 ' + checkSnap.out.stats.total + ' 条链接。'); });
  $('btn-adopt-all').addEventListener('click', function () { adopt(null); });
  $('filter').addEventListener('change', renderResults);
  $('btn-build').addEventListener('click', buildRun);
  document.querySelectorAll('.tab').forEach(function (t) { t.addEventListener('click', function () { showView(t.dataset.view); }); });

  $('links-text').addEventListener('input', function () { markReal(); $('input-error').hidden = true; data.text = $('links-text').value; save(); renderCheck(); });
  ['set-required', 'set-pattern', 'set-domains', 'set-lower', 'set-order'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      var v = readSettingsForm();
      if (v.ok) { data.settings = v.value; save(); }
      renderCheck();
      renderBuild();
    });
  });
  ['build-base', 'build-table'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      markReal(); data.buildBase = $('build-base').value; data.buildTable = $('build-table').value; save(); renderBuild();
    });
  });

  $('export-csv').addEventListener('click', function () {
    exportIfFresh(function (o) { download(fname('链接检查结果', '.csv'), C.issuesToCsv(o.issues), 'text/csv', true); });
  });
  $('export-md').addEventListener('click', function () {
    exportIfFresh(function (o) { download(fname('链接检查结果', '.md'), sampleNote() + C.issuesToMarkdown(o.issues, o.stats), 'text/markdown'); });
  });
  $('export-norm-csv').addEventListener('click', function () {
    exportIfFresh(function (o) { download(fname('规范化链接', '.csv'), C.normalizedToCsv(o.results), 'text/csv', true); });
  });
  $('export-norm-txt').addEventListener('click', function () {
    exportIfFresh(function (o) {
      download(fname('规范化链接', '.txt'), (data.sample ? '# 合成示例:虚构链接\n' : '') + o.results.filter(function (r) { return r.normalized; }).map(function (r) { return r.normalized; }).join('\n') + '\n', 'text/plain');
    });
  });
  $('export-build-csv').addEventListener('click', function () {
    if (!buildSnap || buildSnap.key !== buildKey() || !buildSnap.out.ok) { flash('结果已过期,请先重新生成。'); renderBuild(); return; }
    download(fname('构建结果', '.csv'), C.buildToCsv(buildSnap.out.links), 'text/csv', true);
  });

  $('btn-clear').addEventListener('click', function () { $('clear-confirm').hidden = false; $('btn-clear-no').focus(); });
  $('btn-clear-no').addEventListener('click', function () { $('clear-confirm').hidden = true; });
  $('btn-clear-yes').addEventListener('click', function () {
    var removeFailed = '';
    try { localStorage.removeItem(KEY); } catch (e) { removeFailed = e && e.message ? e.message : '浏览器拒绝删除本机存档'; }
    data = freshData();
    checkSnap = null; buildSnap = null;
    fillForm();
    $('settings-error').hidden = true;
    $('clear-confirm').hidden = true;
    $('sample-confirm').hidden = true;
    $('input-error').hidden = true;
    $('load-warning').hidden = true;
    renderCheck(); renderBuild();
    renderSampleTags();
    var cw = $('clear-warning');
    if (removeFailed) {
      cw.textContent = '页面上的内容已清空,但本机存档未能删除(' + removeFailed + ')。刷新页面后原数据可能重新出现。';
      cw.hidden = false;
      flash('页面已清空,本机存档未删除。');
    } else { cw.hidden = true; flash('页面和本机存档都已清空。'); }
  });

  /* ---------- 启动 ---------- */
  load();
  fillForm();
  renderSampleTags();
  renderCheck();
  renderBuild();
})();
