'use strict';
// 四层对照卡:纯逻辑,无 DOM。分词与拼音全部委托 globalThis.CnSegment。
(function () {
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const seg = () => {
    if (!globalThis.CnSegment) throw new Error('缺少 CnSegment');
    return globalThis.CnSegment;
  };

  // 多行输入 → 句子数组(每行一句,忽略空行,去首尾空白)
  function parseSentences(text) {
    if (typeof text !== 'string') return [];
    return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }

  function makeCell(token, glossary) {
    const cell = {
      t: token.t,
      kind: token.kind,
      pinyin: token.pinyin || '',
      gloss: '',
      fromGlossary: false
    };
    if (token.level != null) cell.level = token.level;
    if (token.kind !== 'other' && glossary && hasOwn(glossary, token.t) && glossary[token.t].gloss) {
      cell.gloss = glossary[token.t].gloss;
      cell.fromGlossary = true;
    }
    return cell;
  }

  // 一句话 → 一张卡。纯空白的 token 丢弃,标点保留为无拼音、无 gloss 的格子。
  function buildCard(sentence, dict, charMap, glossary) {
    const tokens = seg().segment(String(sentence == null ? '' : sentence), dict || {}, charMap);
    const cells = tokens
      .filter(tk => tk.kind !== 'other' || tk.t.trim() !== '')
      .map(tk => makeCell(tk.kind === 'other' ? { t: tk.t.trim(), kind: 'other' } : tk, glossary));
    return { sentence: String(sentence == null ? '' : sentence), cells, english: '' };
  }

  function cloneCard(card) {
    return { sentence: card.sentence, english: card.english, cells: card.cells.map(c => Object.assign({}, c)) };
  }

  // 合并第 i 与 i+1 格。任一格是标点、或下标越界时原样返回副本。合并后 gloss 清空。
  function mergeCells(card, i, dict, charMap) {
    const out = cloneCard(card);
    if (!Number.isInteger(i) || i < 0 || i + 1 >= out.cells.length) return out;
    const a = out.cells[i], b = out.cells[i + 1];
    if (a.kind === 'other' || b.kind === 'other') return out;
    const m = seg().merge([a, b], dict, charMap);
    const cell = { t: m.t, kind: m.kind, pinyin: m.pinyin || '', gloss: '', fromGlossary: false };
    if (m.level != null) cell.level = m.level;
    out.cells.splice(i, 2, cell);
    return out;
  }

  // 把第 i 格拆成单字。单字或标点不动。拆分后 gloss 清空。
  function splitCell(card, i, charMap) {
    const out = cloneCard(card);
    if (!Number.isInteger(i) || i < 0 || i >= out.cells.length) return out;
    const c = out.cells[i];
    if (c.kind === 'other' || Array.from(c.t).length < 2) return out;
    const parts = seg().split({ t: c.t }, charMap).map(p => ({
      t: p.t, kind: 'char', pinyin: p.pinyin || '', gloss: '', fromGlossary: false
    }));
    out.cells.splice(i, 1, ...parts);
    return out;
  }

  // 个人词典:{ 词: { gloss, count } }。返回新对象,不改入参。空 gloss 不记。
  function learn(glossary, word, gloss) {
    const out = Object.assign({}, glossary || {});
    const g = typeof gloss === 'string' ? gloss.trim() : '';
    if (typeof word !== 'string' || !word || word === '__proto__' || !g) return out;
    const prev = hasOwn(out, word) ? out[word].count : 0;
    out[word] = { gloss: g, count: prev + 1 };
    return out;
  }

  // 词典页改写 gloss,保留次数;空 gloss 或不存在的词原样返回
  function editGloss(glossary, word, gloss) {
    const out = Object.assign({}, glossary || {});
    const g = typeof gloss === 'string' ? gloss.trim() : '';
    if (!hasOwn(out, word) || !g) return out;
    out[word] = { gloss: g, count: out[word].count };
    return out;
  }

  function removeWord(glossary, word) {
    const out = Object.assign({}, glossary || {});
    delete out[word];
    return out;
  }

  // 词典页列表:按次数降序,同次数按词排序
  function glossaryList(glossary) {
    return Object.keys(glossary || {})
      .map(w => ({ word: w, gloss: glossary[w].gloss, count: glossary[w].count }))
      .sort((a, b) => b.count - a.count || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
  }

  function validateGlossary(input) {
    let data = input;
    if (typeof input === 'string') {
      try { data = JSON.parse(input); } catch (e) { return { ok: false, error: '不是有效的 JSON' }; }
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: '词典必须是 { 词: { gloss, count } } 形式的对象' };
    }
    const glossary = {};
    for (const word of Object.keys(data)) {
      if (word === '__proto__') return { ok: false, error: '不允许的词条名:__proto__' };
      const e = data[word];
      if (e === null || typeof e !== 'object' || Array.isArray(e)) return { ok: false, error: `词条「${word}」必须是对象` };
      if (typeof e.gloss !== 'string' || !e.gloss.trim()) return { ok: false, error: `词条「${word}」缺少 gloss` };
      let count = 1;
      if (e.count !== undefined) {
        if (!Number.isInteger(e.count) || e.count < 0) return { ok: false, error: `词条「${word}」的 count 必须是非负整数` };
        count = e.count;
      }
      glossary[word] = { gloss: e.gloss.trim(), count };
    }
    return { ok: true, glossary };
  }

  // 合并导入/载入示例前的预览:返回 {added 新增, overwritten 同词覆盖, same 同词同释义, kept 现有里不受影响的, total 合并后总数}。
  // opts.existingWins 为真(载入示例)时,同词保留现有词条,不算覆盖。
  function previewGlossaryMerge(current, incoming, opts) {
    const cur = current || {}, inc = incoming || {};
    const wins = !!(opts && opts.existingWins);
    let added = 0, overwritten = 0, same = 0;
    for (const w of Object.keys(inc)) {
      if (!hasOwn(cur, w)) added++;
      else if (cur[w].gloss === inc[w].gloss) same++;
      else if (!wins) overwritten++;
    }
    const touched = Object.keys(inc).filter(w => hasOwn(cur, w)).length;
    const kept = Object.keys(cur).length - touched + (wins ? Object.keys(inc).filter(w => hasOwn(cur, w) && cur[w].gloss !== inc[w].gloss).length : 0);
    return { added, overwritten, same, kept, total: Object.keys(cur).length + added };
  }

  const flat = s => String(s == null ? '' : s).replace(/[\t\r\n]+/g, ' ');
  // 电子表格公式前缀防护:以 = + - @ 开头(忽略前导空白)且长度 > 1 的内容前面加单引号;单个 + 或 - 是普通符号,不动
  function safeField(s) {
    const f = flat(s);
    const t = f.trimStart();
    return t.length > 1 && /^[=+\-@]/.test(t) ? "'" + f : f;
  }
  const mdCell = s => safeField(s).replace(/\|/g, '\\|');

  function toMarkdown(cards, opts) {
    const head = opts && opts.sample && (cards || []).length ? '> 合成示例:演示用句子与词条,不是真实教学记录。\n\n' : '';
    return head + (cards || []).map((card, n) => {
      const row = (label, vals) => '| ' + [label].concat(vals).map(mdCell).join(' | ') + ' |';
      const k = card.cells.length;
      const blanks = Array(Math.max(k - 1, 0)).fill('');
      return [
        '### ' + (n + 1) + '. ' + flat(card.sentence),
        '',
        row('Chinese', card.cells.map(c => c.t)),
        '| ' + Array(k + 1).fill('---').join(' | ') + ' |',
        row('Pinyin', card.cells.map(c => c.pinyin)),
        row('Word-by-Word', card.cells.map(c => c.gloss)),
        row('English', k ? [card.english].concat(blanks) : [])
      ].join('\n');
    }).join('\n\n') + ((cards || []).length ? '\n' : '');
  }

  function toText(cards, opts) {
    const head = opts && opts.sample && (cards || []).length ? '合成示例:演示用句子与词条,不是真实教学记录\n\n' : '';
    return head + (cards || []).map(card => {
      const line = (label, vals) => [label].concat(vals.map(safeField)).join('\t');
      return [
        line('Chinese', card.cells.map(c => c.t)),
        line('Pinyin', card.cells.map(c => c.pinyin)),
        line('Word-by-Word', card.cells.map(c => c.gloss)),
        line('English', [card.english])
      ].join('\n');
    }).join('\n\n');
  }

  // 按宽度换行。measure(str) 返回像素宽度。英文按词断行;单个片段超宽时按字符继续断。返回行数组(至少 1 行)。
  function wrapText(text, maxWidth, measure) {
    const lines = [];
    let line = '';
    const fits = str => measure(str.trimEnd()) <= maxWidth;
    for (let piece of (String(text == null ? '' : text).match(/[\x21-\x7e]+\s*|\s+|[^\x00-\x7f]/g) || [])) {
      if (fits(line + piece)) { line += piece; continue; }
      if (line) { lines.push(line.trimEnd()); line = ''; }
      piece = piece.trimStart();
      if (fits(piece)) { line = piece; continue; }
      for (const ch of piece) {
        if (line && !fits(line + ch)) { lines.push(line); line = ch; } else line += ch;
      }
    }
    lines.push(line.trimEnd());
    return lines;
  }

  // 恢复缓存时逐项校验。损坏的卡片或词块整卡跳过,返回 { cards, skipped }
  function sanitizeCards(raw) {
    const cards = [];
    let skipped = 0;
    if (!Array.isArray(raw)) return { cards, skipped: raw == null ? 0 : 1 };
    for (const c of raw) {
      const ok = c && typeof c === 'object' && typeof c.sentence === 'string' && Array.isArray(c.cells) && c.cells.length > 0
        && c.cells.every(x => x && typeof x === 'object' && typeof x.t === 'string' && x.t !== '');
      if (!ok) { skipped++; continue; }
      cards.push({
        sentence: c.sentence,
        english: typeof c.english === 'string' ? c.english : '',
        cells: c.cells.map(x => {
          const cell = {
            t: x.t,
            kind: x.kind === 'word' || x.kind === 'other' ? x.kind : 'char',
            pinyin: typeof x.pinyin === 'string' ? x.pinyin : '',
            gloss: typeof x.gloss === 'string' ? x.gloss : '',
            fromGlossary: x.fromGlossary === true
          };
          if (typeof x.level === 'number') cell.level = x.level;
          return cell;
        })
      });
    }
    return { cards, skipped };
  }

  const api = {
    parseSentences, buildCard, mergeCells, splitCell, learn, editGloss, removeWord,
    glossaryList, validateGlossary, previewGlossaryMerge, toMarkdown, toText, safeField, wrapText, sanitizeCards
  };
  globalThis.FourLayerCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
