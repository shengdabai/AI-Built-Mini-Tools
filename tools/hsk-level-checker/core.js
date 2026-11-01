'use strict';
// HSK 分级改写检查器 · 纯逻辑(无 DOM)。
// 依赖:globalThis.CnSegment(来自 ../_shared/cn-segment.js)。词表与字表由调用方传入。
(function () {
  const LEVELS = [1, 2, 3, 4, 5, 6, 7];
  const SENTENCE_END = /[。！？；!?;\n\r]/;
  const CJK = /[一-鿿]/;

  function levelLabel(level) {
    return level === 7 ? 'HSK 7–9' : 'HSK ' + level;
  }

  function normalizeTarget(target) {
    const n = Number(target);
    return LEVELS.includes(n) ? n : 3;
  }

  // 句子切分:按 。！？；(含英文 ! ? ;)和换行切开;末尾没有标点的尾句也算一句;
  // 只含标点/空白的片段不算句子。
  function splitSentences(text) {
    if (typeof text !== 'string' || !text) return [];
    const out = [];
    let buf = '';
    for (const ch of text) {
      if (SENTENCE_END.test(ch)) {
        if (ch !== '\n' && ch !== '\r') buf += ch;
        push(buf);
        buf = '';
      } else {
        buf += ch;
      }
    }
    push(buf);
    return out;
    function push(s) {
      const t = s.trim();
      if (t && /[A-Za-z0-9一-鿿]/.test(t)) out.push(t);
    }
  }

  function countCjk(text) {
    let n = 0;
    for (const ch of text) if (CJK.test(ch)) n++;
    return n;
  }

  function round1(x) { return Math.round(x * 10) / 10; }

  // 分析一段文本。返回:
  // tokens: 在分词结果上加了 over(高出目标几级,0 表示不超)与 tier('in'|'over1'|'over2'|'over3'|'out'|'other')
  // stats: {charCount, wordCount, inLevelCount, inLevelRatio, overCount, overDistinct, outOfListCount, sentenceCount, avgSentenceLen}
  // overLevel: [{word, level, pinyin, count}]  outOfList: [{text, pinyin, count}]
  function analyze(text, targetLevel, dict, charMap) {
    const target = normalizeTarget(targetLevel);
    const seg = globalThis.CnSegment.segment(typeof text === 'string' ? text : '', dict, charMap);
    const tokens = [];
    const overMap = new Map();
    const outMap = new Map();
    let inLevelCount = 0;
    let overCount = 0;
    let wordCount = 0;
    let outOfListCount = 0;
    let prevChar = null; // 正在合并的词表外汉字串
    const outList = [];

    for (const tk of seg) {
      const t = Object.assign({}, tk);
      if (tk.kind === 'word') {
        prevChar = null;
        wordCount++;
        const over = tk.level > target ? tk.level - target : 0;
        t.over = over;
        if (over === 0) {
          t.tier = 'in';
          inLevelCount++;
        } else {
          t.tier = over >= 3 ? 'over3' : 'over' + over;
          overCount++;
          const e = overMap.get(tk.t);
          if (e) e.count++;
          else overMap.set(tk.t, { word: tk.t, level: tk.level, pinyin: tk.pinyin || '', count: 1 });
        }
      } else if (tk.kind === 'char') {
        t.over = 0;
        t.tier = 'out';
        if (prevChar) {
          prevChar.text += tk.t;
          prevChar.pinyin += tk.pinyin || '';
        } else {
          prevChar = { text: tk.t, pinyin: tk.pinyin || '' };
          outOfListCount++;
          wordCount++;
          outList.push(prevChar);
        }
      } else {
        prevChar = null;
        t.over = 0;
        t.tier = 'other';
      }
      tokens.push(t);
    }
    // 词表外串统计(按文本聚合次数)
    for (const g of outList) {
      const e = outMap.get(g.text);
      if (e) e.count++;
      else outMap.set(g.text, { text: g.text, pinyin: g.pinyin, count: 1 });
    }
    const overLevel = Array.from(overMap.values()).sort(
      (a, b) => b.level - a.level || b.count - a.count || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0)
    );
    const outOfList = Array.from(outMap.values()).sort(
      (a, b) => b.count - a.count || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0)
    );
    const sentences = splitSentences(text);
    const charCount = countCjk(typeof text === 'string' ? text : '');
    const stats = {
      target,
      charCount,
      wordCount,
      inLevelCount,
      inLevelRatio: wordCount ? inLevelCount / wordCount : 0,
      overCount,
      overDistinct: overLevel.length,
      outOfListCount,
      sentenceCount: sentences.length,
      avgSentenceLen: sentences.length ? round1(charCount / sentences.length) : 0,
    };
    return { tokens, stats, overLevel, outOfList };
  }

  // 改写前 → 改写后。差值一律为「后 - 前」;overBetter / ratioBetter 表示方向是否朝好的一边。
  function compare(before, after) {
    const b = (before && before.stats) || before || {};
    const a = (after && after.stats) || after || {};
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
    const overDelta = num(a.overCount) - num(b.overCount);
    const ratioDelta = num(a.inLevelRatio) - num(b.inLevelRatio);
    return {
      overBefore: num(b.overCount),
      overAfter: num(a.overCount),
      overDelta,
      ratioBefore: num(b.inLevelRatio),
      ratioAfter: num(a.inLevelRatio),
      ratioDelta,
      charDelta: num(a.charCount) - num(b.charCount),
      avgSentenceDelta: round1(num(a.avgSentenceLen) - num(b.avgSentenceLen)),
      outOfListDelta: num(a.outOfListCount) - num(b.outOfListCount),
      overBetter: overDelta < 0,
      ratioBetter: ratioDelta > 0,
    };
  }

  function pct(x) { return (Math.round(x * 1000) / 10).toFixed(1) + '%'; }

  function statsLines(label, s) {
    return [
      '### ' + label,
      '',
      '| 指标 | 数值 |',
      '|---|---|',
      '| 汉字数 | ' + s.charCount + ' |',
      '| 词数 | ' + s.wordCount + ' |',
      '| 目标级内词占比 | ' + pct(s.inLevelRatio) + ' |',
      '| 超纲词数 | ' + s.overCount + ' |',
      '| 词表外词数 | ' + s.outOfListCount + ' |',
      '| 句数 | ' + s.sentenceCount + ' |',
      '| 平均句长(字) | ' + s.avgSentenceLen + ' |',
      '',
    ];
  }

  function mdCell(v) {
    return String(v).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
  }

  // Markdown 报告:两版统计 + 超纲词表 + 改写后全文。
  // opts: {target, before, after, rewriteText, date}
  function toMarkdown(opts) {
    const o = opts || {};
    const target = normalizeTarget(o.target);
    const lines = ['# HSK 分级改写检查报告', ''];
    if (o.date) lines.push('日期:' + o.date);
    if (o.sample) lines.push('数据来源:合成示例(演示短文,不是真实学员或教材材料)');
    lines.push('目标级别:' + levelLabel(target), '');
    if (o.before) lines.push(...statsLines('改写前', o.before.stats));
    if (o.after) {
      lines.push(...statsLines('改写后', o.after.stats));
      if (o.before) {
        const c = compare(o.before, o.after);
        const sign = (n) => (n > 0 ? '+' + n : String(n));
        lines.push(
          '### 对比(改写前 → 改写后)',
          '',
          '- 超纲词数:' + c.overBefore + ' → ' + c.overAfter + '(' + sign(c.overDelta) + ')',
          '- 目标级内占比:' + pct(c.ratioBefore) + ' → ' + pct(c.ratioAfter),
          ''
        );
      }
    }
    const last = o.after || o.before;
    lines.push('## 超纲词表' + (o.after ? '(改写后)' : ''), '');
    if (last && last.overLevel.length) {
      lines.push('| 词 | 级别 | 拼音 | 出现次数 |', '|---|---|---|---|');
      for (const r of last.overLevel) {
        lines.push('| ' + mdCell(r.word) + ' | ' + levelLabel(r.level) + ' | ' + mdCell(r.pinyin) + ' | ' + r.count + ' |');
      }
    } else {
      lines.push('没有超纲词。');
    }
    lines.push('');
    if (last && last.outOfList.length) {
      lines.push('## 词表外汉字串', '', last.outOfList.map((r) => r.text + '×' + r.count).join('、'), '');
    }
    lines.push(
      '## 口径',
      '',
      '- 汉字数:文本中的汉字个数,不含标点和字母数字。',
      '- 词数:分词后词表内的词(按出现次数累计,重复出现的词重复计数)+ 词表外汉字串(相邻的词表外汉字合并为一串,算一个词)。',
      '- 目标级内词占比 = 目标级内词数 ÷ 词数(分母为 0 时记 0.0%)。',
      '- 超纲词数:级别高于目标级别的词,按出现次数累计;清单里同一个词只列一行。',
      '- 平均句长 = 汉字数 ÷ 句数;句子按 。！？；(含英文 ! ? ;)和换行切分。',
      ''
    );
    lines.push('## 改写后全文', '', typeof o.rewriteText === 'string' ? o.rewriteText : '', '');
    return lines.join('\n');
  }

  function csvCell(v) {
    const s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // CSV:超纲词表。表头 词,级别,拼音,出现次数
  // opts.sample 为真时多一列「数据来源」,值为「合成示例」。
  function toCsv(overLevel, opts) {
    const sample = !!(opts && opts.sample);
    const rows = ['词,级别,拼音,出现次数' + (sample ? ',数据来源' : '')];
    for (const r of overLevel || []) {
      const cells = [csvCell(r.word), csvCell(levelLabel(r.level)), csvCell(r.pinyin), r.count];
      if (sample) cells.push('合成示例');
      rows.push(cells.join(','));
    }
    return rows.join('\r\n') + '\r\n';
  }

  // 导出前判断结果是否已过期:原文变了,或改写文相对上次检查时变了(含首次改写,此时还没有改写后结果)。
  function isStale(o) {
    const x = o || {};
    if (x.srcNow !== x.srcChecked) return true;
    return x.rewNow !== x.rewChecked;
  }

  // ?today=YYYY-MM-DD:格式 + 真实日期(解析后格式化再比较,拒绝 2026-02-30 这类自动进位)。
  // 返回 {date, fixed};非法时回退 realToday 且 fixed=false。
  function parseToday(search, realToday) {
    const m = /^\??(?:.*&)?today=(\d{4}-\d{2}-\d{2})(?:&.*)?$/.exec(typeof search === 'string' ? search : '');
    if (m) {
      const [y, mo, d] = m[1].split('-').map(Number);
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) return { date: m[1], fixed: true };
    }
    return { date: realToday, fixed: false };
  }

  const api = { isStale, parseToday, LEVELS, levelLabel, normalizeTarget, splitSentences, countCjk, analyze, compare, toMarkdown, toCsv, pct };
  globalThis.HskCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
