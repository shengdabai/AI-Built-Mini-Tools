'use strict';
// DOM 与交互。逻辑全部来自 core.js;所有用户内容只通过 textContent / value 写入。
(function () {
  const Core = globalThis.FourLayerCore;
  const DICT = globalThis.HSK_WORDS || {};
  const CHARS = globalThis.PINYIN_MAP || {};
  const SAMPLE = globalThis.FOURLAYER_SAMPLE;
  const KEY_GLOSSARY = 'fourlayer.glossary.v1';
  const KEY_CARDS = 'fourlayer.cards.v1';
  const ROWS = [
    { key: 'zh', label: 'Chinese' },
    { key: 'py', label: 'Pinyin' },
    { key: 'gl', label: 'Word-by-Word' },
    { key: 'en', label: 'English' }
  ];

  const state = { text: '', cards: [], glossary: {} };
  const saved = { cards: true, glossary: true }; // 两份数据各自的保存状态:只有都成功,警告才解除
  const ui = { delCard: -1, delWord: null, pendingReplace: null, pendingGl: null, focusFn: null };
  const selection = new Map(); // 卡片下标 -> 选中的格子下标数组(仅界面状态)
  let pngUrl = null;

  const $ = id => document.getElementById(id);

  // ---------- 小工具 ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const k of Object.keys(props || {})) {
      const v = props[k];
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else if (k === 'on') for (const ev of Object.keys(v)) el.addEventListener(ev, v[ev]);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids) if (kid) el.append(kid);
    return el;
  }
  function say(msg, isError, targetId) {
    const el = $(targetId || 'status');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
  }
  // 写入 localStorage,返回是否真的写入成功;失败时显示持续可见的「未保存」提示
  function store(key, value, slot) {
    let ok = true;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { ok = false; }
    saved[slot] = ok;
    const bad = [];
    if (!saved.cards) bad.push('对照卡');
    if (!saved.glossary) bad.push('个人词典');
    $('storage-warning').hidden = bad.length === 0;
    if (bad.length) $('storage-warning-text').textContent = '未保存(' + bad.join('、') + '):浏览器拒绝写入本机存储(可能已满或被禁用),刷新后这部分改动会丢失。';
    return ok;
  }
  function load(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function saveCards() { return store(KEY_CARDS, { text: state.text, cards: state.cards }, 'cards'); }
  function saveGlossary() { return store(KEY_GLOSSARY, state.glossary, 'glossary'); }
  // 输入框宽度:汉字按两个字符宽计
  function sizeOf(v) {
    let n = 0;
    for (const ch of String(v)) n += /[^\x00-\x7f]/.test(ch) ? 2 : 1;
    return Math.max(3, n + 1);
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function isSampleText() { return !!SAMPLE && state.text === SAMPLE.text; }
  function sampleOpts() { return { sample: state.cards.length > 0 && isSampleText() }; }
  function sampleSuffix() { return sampleOpts().sample ? '-合成示例' : ''; }
  // 输入框有尚未「生成」的改动时,导出禁用(导出的是已生成的卡片,与输入框不一致)
  function draftDirty() { return $('input').value !== state.text; }
  function renderExportState() {
    const dirty = state.cards.length > 0 && draftDirty();
    $('draft-hint').hidden = !dirty;
    for (const b of ['export-md', 'copy-text']) $(b).setAttribute('aria-disabled', String(dirty));
    document.querySelectorAll('[data-act="png"]').forEach(b => b.setAttribute('aria-disabled', String(dirty)));
  }
  function exportBlocked() {
    renderExportState();
    if (state.cards.length > 0 && draftDirty()) { say('输入框里有尚未生成的改动:请先点「生成」,或把输入框改回原样,再导出。', true); return true; }
    return false;
  }

  // ---------- 对照卡渲染 ----------
  function selOf(ci) { return (selection.get(ci) || []).slice().sort((a, b) => a - b); }

  function syncToolbar(cardEl, ci) {
    const card = state.cards[ci];
    const sel = selOf(ci);
    const merge = cardEl.querySelector('[data-act="merge"]');
    const split = cardEl.querySelector('[data-act="split"]');
    const adjacent = sel.length === 2 && sel[1] === sel[0] + 1 && card.cells[sel[0]].kind !== 'other' && card.cells[sel[1]].kind !== 'other';
    merge.disabled = !adjacent;
    const one = sel.length === 1 ? card.cells[sel[0]] : null;
    split.disabled = !(one && one.kind !== 'other' && Array.from(one.t).length >= 2);
    cardEl.querySelectorAll('.zh-cell').forEach(b => b.setAttribute('aria-pressed', sel.includes(Number(b.dataset.cell)) ? 'true' : 'false'));
  }

  function toggleSelect(cardEl, ci, i) {
    const sel = selOf(ci);
    const at = sel.indexOf(i);
    if (at >= 0) sel.splice(at, 1); else sel.push(i);
    selection.set(ci, sel);
    syncToolbar(cardEl, ci);
  }

  function onGlossChange(cell, input) {
    const v = input.value.trim();
    if (!v || cell.kind === 'other') return;
    const known = Object.prototype.hasOwnProperty.call(state.glossary, cell.t) ? state.glossary[cell.t].gloss : null;
    if (known === v) return;
    state.glossary = Core.learn(state.glossary, cell.t, v);
    const wrote = saveGlossary();
    renderGlossary();
    if (wrote) say('已记入个人词典:' + cell.t + ' → ' + v);
    else say('「' + cell.t + ' → ' + v + '」只在本页内存里,尚未保存。', true);
  }

  function buildCardEl(card, ci) {
    const n = card.cells.length;
    const cardEl = h('article', { class: 'card', 'data-card': ci });

    const mergeBtn = h('button', { type: 'button', 'data-act': 'merge', disabled: true, text: '合并所选', on: { click: () => doMerge(ci) } });
    const splitBtn = h('button', { type: 'button', 'data-act': 'split', disabled: true, text: '拆分所选', on: { click: () => doSplit(ci) } });
    const pngBtn = h('button', { type: 'button', 'data-act': 'png', text: '导出本卡 PNG', on: { click: () => exportPng(ci) } });
    const delBtn = h('button', { type: 'button', 'data-act': 'delete', class: 'danger', text: '删除此卡', on: { click: () => { ui.delCard = ci; renderCards(); const n = document.querySelector('[data-act="delete-no"]'); if (n) n.focus(); } } });
    cardEl.append(h('div', { class: 'card-head' },
      h('h3', { class: 'card-title', text: card.sentence }),
      h('div', { class: 'card-actions' }, mergeBtn, splitBtn, pngBtn, delBtn)));
    if (ui.delCard === ci) {
      cardEl.append(h('div', { class: 'confirm-inline', role: 'alertdialog' },
        h('p', { text: '确认删除这张卡?「' + card.sentence + '」及其手改的拼音、英文词义和整句英文会一并删除;个人词典不受影响。' }),
        h('div', { class: 'row' },
          h('button', { type: 'button', 'data-act': 'delete-yes', class: 'danger', text: '确认删除此卡', on: { click: () => doDelete(ci) } }),
          h('button', { type: 'button', 'data-act': 'delete-no', text: '取消', on: { click: () => { ui.delCard = -1; renderCards(); const b = document.querySelector('[data-card="' + ci + '"] [data-act="delete"]'); if (b) b.focus(); } } }))));
    }

    const rows = {};
    ROWS.forEach(r => { rows[r.key] = h('tr', { class: 'r-' + r.key }, h('th', { scope: 'row', text: r.label })); });

    card.cells.forEach((cell, i) => {
      const punct = cell.kind === 'other';
      rows.zh.append(h('td', {}, h('button', {
        type: 'button', class: 'zh-cell' + (punct ? ' is-punct' : ''), 'data-cell': i, 'aria-pressed': 'false',
        'aria-label': '选中词块 ' + cell.t, text: cell.t,
        on: { click: e => toggleSelect(cardEl, ci, i) }
      })));

      const py = h('input', {
        type: 'text', class: 'py-input', value: cell.pinyin, size: sizeOf(cell.pinyin), disabled: punct,
        'aria-label': '拼音:' + cell.t, spellcheck: 'false', autocomplete: 'off',
        on: { input: e => { cell.pinyin = e.target.value; e.target.size = sizeOf(cell.pinyin); saveCards(); } }
      });
      rows.py.append(h('td', {}, py));

      if (punct) {
        rows.gl.append(h('td', {}));
      } else {
        const badge = h('span', { class: 'from-dict', text: '来自词典', hidden: !cell.fromGlossary });
        const gl = h('input', {
          type: 'text', class: 'gl-input', value: cell.gloss, size: sizeOf(cell.gloss), 'aria-label': '英文词义:' + cell.t,
          autocomplete: 'off',
          on: {
            input: e => { cell.gloss = e.target.value; cell.fromGlossary = false; badge.hidden = true; e.target.size = sizeOf(cell.gloss); saveCards(); },
            change: e => onGlossChange(cell, e.target)
          }
        });
        rows.gl.append(h('td', {}, h('div', { class: 'gl-wrap' }, gl, badge)));
      }
    });

    const en = h('input', {
      type: 'text', class: 'en-input', value: card.english, 'aria-label': '整句英文', autocomplete: 'off',
      placeholder: '手填整句英文',
      on: { input: e => { card.english = e.target.value; saveCards(); } }
    });
    rows.en.append(h('td', { colspan: n || 1 }, en));

    const tbody = h('tbody', {}, rows.zh, rows.py, rows.gl, rows.en);
    cardEl.append(h('div', { class: 'card-scroll' }, h('table', { class: 'four' }, tbody)));
    syncToolbar(cardEl, ci);
    return cardEl;
  }

  function renderCards(focusCell) {
    const box = $('cards');
    box.replaceChildren();
    const has = state.cards.length > 0;
    $('cards-toolbar').hidden = !has;
    $('sample-badge').hidden = !(has && isSampleText());
    if (!has) {
      const importBtn = h('button', { type: 'button', id: 'empty-import', text: '导入词典 JSON(合并)', on: { click: () => $('gl-file').click() } });
      box.append(h('div', { class: 'empty' },
        h('p', { text: '还没有卡片。第一步:在上方输入中文句子(每行一句)后点「生成」,或点右上角「载入合成示例」看一遍完整流程。已有词典备份可先导入。' }),
        importBtn));
      renderExportState();
      return;
    }
    state.cards.forEach((card, ci) => box.append(buildCardEl(card, ci)));
    renderExportState();
    if (focusCell) {
      const b = box.querySelector(`[data-card="${focusCell.ci}"] .zh-cell[data-cell="${focusCell.i}"]`);
      if (b) b.focus();
    }
  }

  // ---------- 对照卡操作 ----------
  function generate() {
    const sentences = Core.parseSentences($('input').value);
    state.text = $('input').value;
    if (!sentences.length) {
      const e = $('input-error');
      e.textContent = '请先输入至少一句中文(每行一句)。';
      e.hidden = false;
      $('input').setAttribute('aria-invalid', 'true');
      $('input').focus();
      say('请先输入至少一句中文。', true);
      return;
    }
    $('input-error').hidden = true;
    $('input').removeAttribute('aria-invalid');
    state.cards = sentences.map(s => Core.buildCard(s, DICT, CHARS, state.glossary));
    selection.clear();
    saveCards();
    renderCards();
    const pre = state.cards.reduce((n, c) => n + c.cells.filter(x => x.fromGlossary).length, 0);
    say('已生成 ' + state.cards.length + ' 张卡' + (pre ? ',其中 ' + pre + ' 个词块从个人词典预填了 gloss。' : '。'));
  }

  function doMerge(ci) {
    const sel = selOf(ci);
    if (sel.length !== 2) return;
    state.cards[ci] = Core.mergeCells(state.cards[ci], sel[0], DICT, CHARS);
    selection.delete(ci);
    saveCards();
    renderCards({ ci, i: sel[0] });
    say('已合并为「' + state.cards[ci].cells[sel[0]].t + '」,拼音已重算,英文词义已清空,请重填。');
  }

  function doSplit(ci) {
    const sel = selOf(ci);
    if (sel.length !== 1) return;
    const word = state.cards[ci].cells[sel[0]].t;
    state.cards[ci] = Core.splitCell(state.cards[ci], sel[0], CHARS);
    selection.delete(ci);
    saveCards();
    renderCards({ ci, i: sel[0] });
    say('已把「' + word + '」拆成单字,拼音逐字重算,英文词义已清空。');
  }

  function doDelete(ci) {
    state.cards.splice(ci, 1);
    ui.delCard = -1;
    selection.clear();
    saveCards();
    renderCards();
    const next = document.querySelector('[data-card="' + Math.min(ci, state.cards.length - 1) + '"] [data-act="delete"]');
    if (next) next.focus(); else $('input').focus();
    say('已删除 1 张卡。');
  }

  // ---------- 导出 ----------
  function showPreview(kind, text) {
    $('preview').hidden = false;
    if (kind === 'text') {
      $('preview-md').hidden = false;
      $('md-preview').textContent = text;
    }
  }

  function exportMarkdown() {
    if (!state.cards.length || exportBlocked()) return;
    const md = Core.toMarkdown(state.cards, sampleOpts());
    const fname = 'four-layer-cards' + sampleSuffix() + '.md';
    download(new Blob([md], { type: 'text/markdown;charset=utf-8' }), fname);
    $('preview-md-title').textContent = 'Markdown 预览(已下载 ' + fname + ')';
    showPreview('text', md);
    say('已导出 ' + state.cards.length + ' 张卡的 Markdown。');
  }

  async function copyText() {
    if (!state.cards.length || exportBlocked()) return;
    const text = Core.toText(state.cards, sampleOpts());
    $('preview-md-title').textContent = '纯文本预览(制表符分隔,可直接粘贴进表格)';
    showPreview('text', text);
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { ok = false; }
    if (!ok) {
      const ta = h('textarea', { value: text });
      document.body.append(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
    }
    say(ok ? '已复制纯文本到剪贴板。' : '浏览器未允许写剪贴板,请从下方预览中手动复制。', !ok);
  }

  const tok = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const tokNum = name => parseFloat(tok(name));

  // 按 token 绘制四行表格,返回 canvas(2x 像素密度)
  function drawCard(card, sample) {
    const T = {
      scale: tokNum('--export-scale'), pad: tokNum('--export-pad'), cellPad: tokNum('--export-cell-pad'),
      rowPad: tokNum('--export-row-pad'), labelW: tokNum('--export-label-w'), minCell: tokNum('--export-min-cell'),
      minW: tokNum('--export-min-w'), line: tokNum('--border'), leading: tokNum('--leading-tight'),
      zh: tokNum('--t-zh'), py: tokNum('--t-py'), gl: tokNum('--t-gloss'), en: tokNum('--t-en'), label: tokNum('--t-label'),
      font: tok('--font'), wRegular: tok('--weight-regular'), wMedium: tok('--weight-medium'), wBold: tok('--weight-bold'),
      surface: tok('--surface'), ink: tok('--ink'), ink2: tok('--ink-2'), grid: tok('--line-strong'),
      punct: tok('--ink-muted')
    };
    const fontOf = (size, weight) => `${weight} ${size}px ${T.font}`;
    const measure = document.createElement('canvas').getContext('2d');
    const width = (text, size, weight) => { measure.font = fontOf(size, weight); return measure.measureText(text).width; };

    const colW = card.cells.map(c => Math.max(
      T.minCell,
      width(c.t, T.zh, T.wMedium) + 2 * T.cellPad,
      width(c.pinyin || '', T.py, T.wMedium) + 2 * T.cellPad,
      width(c.gloss || '', T.gl, T.wRegular) + 2 * T.cellPad));
    let cellsW = colW.reduce((a, b) => a + b, 0);
    const minCells = Math.max(T.minW - T.labelW - 2 * T.pad, T.minCell);
    if (cellsW < minCells) {
      const extra = (minCells - cellsW) / (colW.length || 1);
      for (let i = 0; i < colW.length; i++) colW[i] += extra;
      cellsW = minCells;
    }
    const tableW = T.labelW + cellsW;

    // 英文行换行:逻辑在 core.wrapText(超长片段按字符拆分),行数决定画布高度
    const enLines = Core.wrapText(card.english || '', cellsW - 2 * T.cellPad, str => width(str, T.en, T.wRegular));

    const rowH = {
      zh: T.zh * T.leading + 2 * T.rowPad,
      py: T.py * T.leading + 2 * T.rowPad,
      gl: T.gl * T.leading + 2 * T.rowPad,
      en: enLines.length * T.en * T.leading + 2 * T.rowPad
    };
    const tableH = rowH.zh + rowH.py + rowH.gl + rowH.en;
    const noteH = sample ? T.label * T.leading + T.rowPad : 0; // 合成示例脚注
    const W = tableW + 2 * T.pad, H = tableH + 2 * T.pad + noteH;

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(W * T.scale);
    canvas.height = Math.ceil(H * T.scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(T.scale, T.scale);
    ctx.fillStyle = T.surface;
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'middle';

    const x0 = T.pad, y0 = T.pad;
    let y = y0;
    const order = [
      { key: 'zh', label: 'Chinese', h: rowH.zh },
      { key: 'py', label: 'Pinyin', h: rowH.py },
      { key: 'gl', label: 'Word-by-Word', h: rowH.gl },
      { key: 'en', label: 'English', h: rowH.en }
    ];
    ctx.lineWidth = T.line;
    ctx.strokeStyle = T.grid;
    for (const r of order) {
      ctx.fillStyle = tok('--row-' + r.key + '-bg');
      ctx.fillRect(x0, y, T.labelW, r.h);
      ctx.fillStyle = tok('--row-' + r.key + '-ink');
      ctx.font = fontOf(T.label, T.wBold);
      ctx.textAlign = 'left';
      ctx.fillText(r.label, x0 + T.cellPad, y + r.h / 2);
      ctx.strokeRect(x0, y, T.labelW, r.h);

      let x = x0 + T.labelW;
      if (r.key === 'en') {
        ctx.strokeRect(x, y, cellsW, r.h);
        ctx.fillStyle = T.ink;
        ctx.font = fontOf(T.en, T.wRegular);
        ctx.textAlign = 'left';
        enLines.forEach((ln, k) => ctx.fillText(ln, x + T.cellPad, y + T.rowPad + (k + 0.5) * T.en * T.leading));
      } else {
        card.cells.forEach((c, i) => {
          ctx.strokeRect(x, y, colW[i], r.h);
          ctx.textAlign = 'center';
          const cx = x + colW[i] / 2, cy = y + r.h / 2;
          if (r.key === 'zh') { ctx.font = fontOf(T.zh, T.wMedium); ctx.fillStyle = c.kind === 'other' ? T.punct : T.ink; ctx.fillText(c.t, cx, cy); }
          if (r.key === 'py') { ctx.font = fontOf(T.py, T.wMedium); ctx.fillStyle = tok('--row-py-ink'); ctx.fillText(c.pinyin || '', cx, cy); }
          if (r.key === 'gl') { ctx.font = fontOf(T.gl, T.wRegular); ctx.fillStyle = T.ink2; ctx.fillText(c.gloss || '', cx, cy); }
          x += colW[i];
        });
      }
      y += r.h;
    }
    if (sample) {
      ctx.fillStyle = T.punct;
      ctx.font = fontOf(T.label, T.wRegular);
      ctx.textAlign = 'left';
      ctx.fillText('合成示例:演示用句子与词条,不是真实教学记录', x0, y0 + tableH + noteH / 2 + T.rowPad / 2);
    }
    return canvas;
  }

  function exportPng(ci) {
    const card = state.cards[ci];
    if (!card || exportBlocked()) return;
    const canvas = drawCard(card, sampleOpts().sample);
    canvas.toBlob(blob => {
      if (!blob) { say('PNG 生成失败。', true); return; }
      download(blob, 'four-layer-card-' + (ci + 1) + sampleSuffix() + '.png');
      if (pngUrl) URL.revokeObjectURL(pngUrl);
      pngUrl = URL.createObjectURL(blob);
      $('png-preview').src = pngUrl;
      $('png-preview').width = Math.round(canvas.width / tokNum('--export-scale'));
      $('preview').hidden = false;
      $('preview-png').hidden = false;
      say('已导出第 ' + (ci + 1) + ' 张卡的 PNG(2x 像素密度)。');
    }, 'image/png');
  }

  // ---------- 个人词典 ----------
  function renderGlossary() {
    const list = Core.glossaryList(state.glossary);
    $('glossary-count').textContent = String(list.length);
    $('gl-empty').hidden = list.length > 0;
    $('gl-table').hidden = list.length === 0;
    const body = $('gl-body');
    body.replaceChildren();
    for (const item of list) {
      const input = h('input', {
        type: 'text', value: item.gloss, 'aria-label': '英文词义:' + item.word, autocomplete: 'off', 'aria-describedby': 'gl-msg',
        on: {
          change: e => {
            const v = e.target.value.trim();
            if (!v) {
              e.target.value = state.glossary[item.word].gloss;
              e.target.setAttribute('aria-invalid', 'true');
              say('英文词义不能为空,已恢复原值。', true, 'gl-msg');
              e.target.focus();
              return;
            }
            e.target.removeAttribute('aria-invalid');
            state.glossary = Core.editGloss(state.glossary, item.word, v);
            if (saveGlossary()) say('已更新:' + item.word + ' → ' + v + '(次数不变)', false, 'gl-msg');
            else say('「' + item.word + '」的修改尚未保存,请导出词典 JSON 备份。', true, 'gl-msg');
          }
        }
      });
      let opCell;
      if (ui.delWord === item.word) {
        opCell = h('div', { class: 'confirm-inline', role: 'alertdialog' },
          h('p', { text: '确认删除词条「' + item.word + ' → ' + item.gloss + '」(卡片学习次数 ' + item.count + ')?已生成的卡片里已填的英文词义不会变。' }),
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'danger', 'data-gl': 'yes', text: '确认删除', on: { click: () => {
              const idx = list.findIndex(x => x.word === item.word);
              ui.delWord = null;
              state.glossary = Core.removeWord(state.glossary, item.word);
              const ok = saveGlossary();
              renderGlossary();
              const rest = document.querySelectorAll('#gl-body [data-gl="del"]');
              if (rest.length) rest[Math.min(idx, rest.length - 1)].focus(); else $('gl-export').focus();
              say(ok ? '已删除:' + item.word : '「' + item.word + '」已从本页删除,但尚未保存。', !ok, 'gl-msg');
            } } }),
            h('button', { type: 'button', 'data-gl': 'no', text: '取消', on: { click: () => {
              ui.delWord = null; renderGlossary();
              const again = Array.from(document.querySelectorAll('#gl-body [data-gl="del"]')).filter(b => b.getAttribute('data-word') === item.word)[0];
              if (again) again.focus();
            } } })));
      } else {
        opCell = h('button', {
          type: 'button', class: 'danger', text: '删除', 'aria-label': '删除词条 ' + item.word, 'data-gl': 'del', 'data-word': item.word,
          on: { click: () => { ui.delWord = item.word; renderGlossary(); const n = document.querySelector('#gl-body [data-gl="no"]'); if (n) n.focus(); } }
        });
      }
      body.append(h('tr', {},
        h('td', { class: 'word', text: item.word }),
        h('td', {}, input),
        h('td', { text: String(item.count) }),
        h('td', {}, opCell)));
    }
  }

  function exportGlossary() {
    download(new Blob([JSON.stringify(state.glossary, null, 2)], { type: 'application/json' }), 'fourlayer-glossary.json');
    say('已导出 ' + Object.keys(state.glossary).length + ' 条词典(当前内存里的全部词条)。', false, 'gl-msg');
  }

  // 导入词典:校验 → 预览数量 → 确认 → 合并写入
  function importGlossary(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const res = Core.validateGlossary(String(reader.result));
      if (!res.ok) { switchTab('glossary'); say('导入失败,现有词典没有改动:' + res.error, true, 'gl-msg'); return; }
      const pv = Core.previewGlossaryMerge(state.glossary, res.glossary);
      ui.pendingGl = res.glossary;
      switchTab('glossary');
      $('gl-confirm-text').textContent = '文件「' + file.name + '」校验通过,共 ' + Object.keys(res.glossary).length + ' 条:新增 ' + pv.added + ' 条,同词覆盖现有英文词义 ' + pv.overwritten + ' 条(同词以文件为准),与现有相同 ' + pv.same + ' 条;现有词典里其余 ' + pv.kept + ' 条保留。合并后共 ' + pv.total + ' 条。确定合并吗?';
      $('gl-confirm').hidden = false;
      $('gl-confirm-no').focus();
    };
    reader.onerror = () => { switchTab('glossary'); say('读取文件失败,现有词典没有改动。', true, 'gl-msg'); };
    reader.readAsText(file);
  }

  // ---------- 全局 ----------
  function switchTab(name) {
    for (const t of ['cards', 'glossary']) {
      $('tab-' + t).setAttribute('aria-selected', String(t === name));
      $('view-' + t).hidden = t !== name;
    }
  }

  function hasUserData() {
    return state.cards.length > 0 || $('input').value.trim() !== '' || Object.keys(state.glossary).length > 0;
  }
  function doLoadSample() {
    const merged = Object.assign({}, SAMPLE.glossary, state.glossary); // 已有词条优先
    state.glossary = merged;
    saveGlossary();
    renderGlossary();
    $('input').value = SAMPLE.text;
    switchTab('cards');
    generate();
    say('已载入合成示例(3 句例句 + 最多 6 条词典预填,已有同词词条优先)。示例不是真实教学记录。');
  }
  function loadSample() {
    if (!SAMPLE) return;
    if (!hasUserData()) { doLoadSample(); return; }
    const pv = Core.previewGlossaryMerge(state.glossary, SAMPLE.glossary, { existingWins: true });
    ui.pendingReplace = true;
    $('replace-text').textContent = '载入合成示例会用 ' + Core.parseSentences(SAMPLE.text).length + ' 张示例卡替换当前 ' + state.cards.length + ' 张卡和输入框内容(含手改的拼音、英文词义和整句英文),未导出的会丢失。个人词典现有 ' + Object.keys(state.glossary).length + ' 条全部保留(同词不改),只补充 ' + pv.added + ' 条示例词条。确定替换吗?';
    $('confirm-replace').hidden = false;
    $('replace-no').focus();
  }

  function clearAll() {
    try { localStorage.removeItem(KEY_GLOSSARY); localStorage.removeItem(KEY_CARDS); } catch (e) { /* 忽略 */ }
    state.text = ''; state.cards = []; state.glossary = {};
    saved.cards = true; saved.glossary = true;
    $('storage-warning').hidden = true;
    ui.delCard = -1; ui.delWord = null; ui.pendingGl = null;
    $('gl-confirm').hidden = true;
    $('confirm-replace').hidden = true;
    selection.clear();
    $('input').value = '';
    $('preview').hidden = true; $('preview-md').hidden = true; $('preview-png').hidden = true;
    $('md-preview').textContent = '';
    if (pngUrl) { URL.revokeObjectURL(pngUrl); pngUrl = null; }
    $('png-preview').removeAttribute('src');
    $('confirm-clear').hidden = true;
    renderCards(); renderGlossary();
    say('已清空所有数据。');
  }

  function init() {
    // 先绑定事件,再恢复缓存渲染,这样缓存损坏时「清空数据」仍可用
    $('generate').addEventListener('click', generate);
    $('load-sample').addEventListener('click', loadSample);
    $('clear-data').addEventListener('click', () => { $('confirm-clear').hidden = false; $('confirm-clear-no').focus(); });
    $('confirm-clear-no').addEventListener('click', () => { $('confirm-clear').hidden = true; $('clear-data').focus(); });
    $('confirm-clear-yes').addEventListener('click', clearAll);
    $('export-md').addEventListener('click', exportMarkdown);
    $('copy-text').addEventListener('click', copyText);
    $('gl-export').addEventListener('click', exportGlossary);
    $('gl-import').addEventListener('click', () => $('gl-file').click());
    $('gl-file').addEventListener('change', e => { const f = e.target.files[0]; if (f) importGlossary(f); e.target.value = ''; });
    $('replace-no').addEventListener('click', () => { ui.pendingReplace = null; $('confirm-replace').hidden = true; $('load-sample').focus(); });
    $('replace-yes').addEventListener('click', () => { ui.pendingReplace = null; $('confirm-replace').hidden = true; doLoadSample(); });
    $('gl-confirm-no').addEventListener('click', () => { ui.pendingGl = null; $('gl-confirm').hidden = true; $('gl-import').focus(); });
    $('gl-confirm-yes').addEventListener('click', () => {
      if (!ui.pendingGl) return;
      const incoming = ui.pendingGl, n = Object.keys(incoming).length;
      ui.pendingGl = null; $('gl-confirm').hidden = true;
      state.glossary = Object.assign({}, state.glossary, incoming);
      const ok = saveGlossary();
      renderGlossary();
      say(ok ? '已合并导入 ' + n + ' 条词典(同词以导入文件为准)。' : '已导入 ' + n + ' 条,但尚未保存到本机,请导出词典 JSON 备份。', !ok, 'gl-msg');
      $('gl-import').focus();
    });
    $('input').addEventListener('input', () => {
      $('input-error').hidden = true;
      $('input').removeAttribute('aria-invalid');
      renderExportState();
    });
    document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

    const notes = [];
    const g = load(KEY_GLOSSARY);
    if (g) {
      const v = Core.validateGlossary(g);
      if (v.ok) state.glossary = v.glossary; else notes.push('个人词典缓存已损坏,未恢复(' + v.error + ')');
    }
    const c = load(KEY_CARDS);
    if (c && typeof c === 'object') {
      const r = Core.sanitizeCards(c.cards);
      state.cards = r.cards;
      state.text = typeof c.text === 'string' ? c.text : '';
      $('input').value = state.text;
      if (r.skipped) notes.push('已跳过 ' + r.skipped + ' 张损坏的卡片');
    }
    try {
      renderCards();
    } catch (e) {
      state.cards = [];
      notes.push('卡片缓存无法显示,已丢弃');
      renderCards();
    }
    renderGlossary();
    if (notes.length) say('恢复本机数据时:' + notes.join(';') + '。', true);
  }

  init();
})();
