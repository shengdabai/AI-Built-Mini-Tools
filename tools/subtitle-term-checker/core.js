'use strict';
/* 字幕术语校对 · 纯逻辑(无 DOM)。时间一律用毫秒整数计算。 */
(function () {
  const DEFAULTS = { cpsMax: 20, lineMaxCjk: 20, lineMaxOther: 42, minMs: 700, maxMs: 7000, maxLines: 2, caseSensitive: false };

  const CODE_LABELS = {
    'wrong-term': '术语错写',
    'case-variant': '大小写/全半角变体',
    'empty-text': '空文本',
    'start-after-end': '开始不早于结束',
    'overlap': '与下一条重叠',
    'too-short': '时长过短',
    'too-long': '时长过长',
    'cps': '字速过快',
    'line-long': '单行过长',
    'too-many-lines': '行数过多',
    'seq-gap': '序号不连续'
  };

  function normalizeOptions(o) {
    const out = Object.assign({}, DEFAULTS);
    if (o && typeof o === 'object') {
      for (const k of ['cpsMax', 'lineMaxCjk', 'lineMaxOther', 'minMs', 'maxMs', 'maxLines']) {
        const n = Number(o[k]);
        if (o[k] !== '' && o[k] != null && Number.isFinite(n) && n > 0) out[k] = n;
      }
      out.caseSensitive = o.caseSensitive === true;
    }
    return out;
  }

  // 界面用:逐项校验三个数值选项,不静默回退默认值。blank / 0 / 负数 / 非数字 / 非有限数都报错。
  const OPTION_LABELS = { cpsMax: '字速上限', lineMaxCjk: '单行字数(含中文)', lineMaxOther: '单行字数(其他)' };
  function validateOptions(o) {
    const errors = [];
    const options = Object.assign({}, DEFAULTS);
    const src = o || {};
    for (const k of ['cpsMax', 'lineMaxCjk', 'lineMaxOther']) {
      const raw = src[k];
      const text = raw == null ? '' : String(raw).trim();
      const n = text === '' ? NaN : Number(text);
      if (!Number.isFinite(n) || n <= 0) errors.push({ field: k, message: `${OPTION_LABELS[k]}必须是大于 0 的数字,当前填写:${text === '' ? '空' : text}。` });
      else options[k] = n;
    }
    options.caseSensitive = src.caseSensitive === true;
    return { errors, options };
  }

  // 检查结论:有解析错误就不是「没有发现问题」
  function checkStatus(errorCount, issueCount) {
    if (errorCount > 0) return { complete: false, passed: false, label: `检查未完成:${errorCount} 处解析错误` };
    if (issueCount > 0) return { complete: true, passed: false, label: `${issueCount} 个问题` };
    return { complete: true, passed: true, label: '没有发现问题' };
  }

  // ---------- 时间码 ----------
  const TS = '(?:(\\d+):)?(\\d{1,2}):(\\d{2})[,.](\\d{1,3})';
  const TIMING_RE = new RegExp('^\\s*' + TS + '\\s*-->\\s*' + TS + '(?:\\s+(.*))?\\s*$');

  function toMs(h, m, s, ms) {
    return (Number(h || 0) * 3600 + Number(m) * 60 + Number(s)) * 1000 + Number(String(ms).padEnd(3, '0'));
  }
  function pad(n, w) { return String(n).padStart(w, '0'); }
  function formatTime(ms, sep) {
    const t = Math.max(0, Math.round(ms));
    const h = Math.floor(t / 3600000), m = Math.floor(t / 60000) % 60, s = Math.floor(t / 1000) % 60, r = t % 1000;
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${sep || ','}${pad(r, 3)}`;
  }

  // ---------- 解析 ----------
  function parseSubtitles(text) {
    const src = String(text == null ? '' : text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const all = src.split('\n');
    const firstLine = all.find(l => l.trim() !== '');
    const format = firstLine && /^WEBVTT(\s|$)/.test(firstLine.trim()) ? 'vtt' : 'srt';
    const blocks = [];
    let cur = null;
    all.forEach((t, i) => {
      if (t.trim() === '') { cur = null; return; }
      if (!cur) { cur = { start: i + 1, lines: [] }; blocks.push(cur); }
      cur.lines.push({ n: i + 1, t });
    });

    const cues = [], errors = [];
    blocks.forEach((b, bi) => {
      const head = b.lines[0].t.trim();
      if (format === 'vtt') {
        if (bi === 0 && /^WEBVTT(\s|$)/.test(head)) return;
        if (/^(NOTE|STYLE|REGION)(\s|$)/.test(head)) return;
      }
      // 时间轴只可能是块的第 1 行,或序号/标识行之后的第 2 行;正文里的 "-->" 不算时间轴
      let ti = -1;
      if (b.lines[0].t.includes('-->')) ti = 0;
      else if (b.lines[1] && b.lines[1].t.includes('-->')) ti = 1;
      if (ti < 0) { errors.push({ line: b.start, message: '找不到时间轴(块的第 1 行或序号行之后的一行必须含 "-->")' }); return; }
      const merged = b.lines.findIndex((l, i) => i > ti + 1 && TIMING_RE.test(l.t) && /^\d+$/.test(b.lines[i - 1].t.trim()));
      if (merged > 0) { errors.push({ line: b.lines[merged].n, message: '两条字幕之间缺少空行,无法分开解析' }); return; }
      const idLine = ti === 1 ? b.lines[0] : null;
      if (format === 'srt' && idLine && !/^\d+$/.test(idLine.t.trim())) {
        errors.push({ line: idLine.n, message: `序号必须是整数,实际是 "${idLine.t.trim()}"` }); return;
      }
      const tl = b.lines[ti];
      const m = TIMING_RE.exec(tl.t);
      if (!m) { errors.push({ line: tl.n, message: `时间轴格式无法识别:"${tl.t.trim()}"` }); return; }
      if (Number(m[3]) > 59 || Number(m[2]) > 59 || Number(m[7]) > 59 || Number(m[6]) > 59) {
        errors.push({ line: tl.n, message: `时间值超出范围:"${tl.t.trim()}"` }); return;
      }
      const cue = {
        index: idLine && /^\d+$/.test(idLine.t.trim()) ? Number(idLine.t.trim()) : cues.length + 1,
        start: toMs(m[1], m[2], m[3], m[4]),
        end: toMs(m[5], m[6], m[7], m[8]),
        lines: b.lines.slice(ti + 1).map(l => l.t),
        raw: b.lines.map(l => l.t).join('\n'),
        line: tl.n
      };
      if (format === 'vtt') {
        if (idLine) cue.id = idLine.t.trim();
        if (m[9]) cue.settings = m[9].trim();
      }
      cues.push(cue);
    });
    return { format, cues, errors };
  }

  function serialize(cues, format) {
    const vtt = format === 'vtt';
    const sep = vtt ? '.' : ',';
    const blocks = cues.map(c => {
      const head = vtt ? (c.id !== undefined ? c.id + '\n' : '') : c.index + '\n';
      const timing = `${formatTime(c.start, sep)} --> ${formatTime(c.end, sep)}${vtt && c.settings ? ' ' + c.settings : ''}`;
      return head + timing + (c.lines.length ? '\n' + c.lines.join('\n') : '');
    });
    return (vtt ? 'WEBVTT\n\n' : '') + blocks.join('\n\n') + (blocks.length ? '\n' : '');
  }

  // ---------- 文本度量 ----------
  const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/;
  const plain = s => String(s).replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '');
  const len = s => Array.from(s).length;
  const cueText = c => c.lines.join('\n');
  const isEmptyCue = c => c.lines.every(l => plain(l).trim() === '');

  function cps(cue) {
    const chars = cue.lines.reduce((n, l) => n + len(plain(l).trim()), 0);
    const dur = (cue.end - cue.start) / 1000;
    if (chars === 0) return 0;
    if (dur <= 0) return Infinity;
    return chars / dur;
  }

  // ---------- 术语表 ----------
  function parseGlossary(text) {
    const entries = [], errors = [];
    String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n').forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const m = /[|｜]/.exec(line);
      const canonical = (m ? line.slice(0, m.index) : line).trim();
      if (!canonical) { errors.push({ line: i + 1, message: '缺少标准写法(竖线左边为空)' }); return; }
      const rest = m ? line.slice(m.index + 1) : '';
      const wrongs = [];
      for (const w of rest.split(/[,，、;；]/).map(s => s.trim())) {
        if (w && w !== canonical && !wrongs.includes(w)) wrongs.push(w);
      }
      entries.push({ canonical, wrongs, line: i + 1 });
    });
    return { entries, errors };
  }

  const normWidth = s => s.replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, ' ');
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 只取可见文本:标签 <...> 与控制标记 {\an8} 不参与术语匹配;map 记录每个可见字符在原行中的位置
  function visibleText(line) {
    const re = /<[^>]*>|\{\\[^}]*\}/g;
    let vis = '', last = 0, m;
    const map = [];
    const take = (from, to) => { for (let k = from; k < to; k++) { vis += line[k]; map.push(k); } };
    while ((m = re.exec(line)) !== null) { take(last, m.index); last = m.index + m[0].length; }
    take(last, line.length);
    return { vis, map };
  }

  function termRegex(term, caseSensitive) {
    const t = normWidth(term);
    const pre = /^[A-Za-z0-9]/.test(t) ? '(?<![A-Za-z0-9])' : '';
    const post = /[A-Za-z0-9]$/.test(t) ? '(?![A-Za-z0-9])' : '';
    return new RegExp(pre + escRe(t) + post, caseSensitive ? 'g' : 'gi');
  }

  function makeIssue(cue, pos, kind, code, severity, message, suggestion, extra) {
    return Object.assign({
      id: `${kind}:${code}:${pos}`,
      kind, code, severity, pos,
      cueIndex: cue.index, start: cue.start, end: cue.end,
      time: formatTime(cue.start, ','),
      original: cueText(cue),
      message, suggestion
    }, extra || {});
  }

  function checkTerms(cues, glossary, options) {
    const o = normalizeOptions(options);
    const entries = Array.isArray(glossary) ? glossary : (glossary && glossary.entries) || [];
    const prepared = [];
    for (const e of entries) {
      for (const w of e.wrongs || []) prepared.push({ re: termRegex(w, o.caseSensitive), canonical: e.canonical, wrong: true });
      if (/[A-Za-z]/.test(normWidth(e.canonical))) prepared.push({ re: termRegex(e.canonical, o.caseSensitive), canonical: e.canonical, wrong: false });
    }
    const issues = [];
    cues.forEach((cue, pos) => {
      cue.lines.forEach((line, lineNo) => {
        const { vis, map } = visibleText(line);
        const norm = normWidth(vis);
        const cands = [];
        for (const p of prepared) {
          p.re.lastIndex = 0;
          let m;
          while ((m = p.re.exec(norm)) !== null) {
            if (m[0].length === 0) { p.re.lastIndex++; continue; }
            const from = map[m.index], to = map[m.index + m[0].length - 1] + 1;
            if (to - from !== m[0].length) continue; // 匹配跨越了标签:不改,避免破坏标签
            const found = line.slice(from, to);
            if (found === p.canonical) continue;
            cands.push({ col: from, len: to - from, found, canonical: p.canonical, wrong: p.wrong });
          }
        }
        cands.sort((a, b) => a.col - b.col || b.len - a.len || (b.wrong ? 1 : 0) - (a.wrong ? 1 : 0));
        let edge = -1;
        for (const c of cands) {
          if (c.col < edge) continue;
          edge = c.col + c.len;
          const code = c.wrong ? 'wrong-term' : 'case-variant';
          const msg = c.wrong ? `"${c.found}" 是术语表里的错误写法` : `"${c.found}" 与标准写法的大小写/全半角不一致`;
          issues.push(makeIssue(cue, pos, 'term', code, 'warn', msg, `改为 "${c.canonical}"`, {
            id: `term:${code}:${pos}:${lineNo}:${c.col}`,
            lineNo, col: c.col, found: c.found, replacement: c.canonical
          }));
        }
      });
    });
    return issues;
  }

  // ---------- 时间轴检查 ----------
  function checkTiming(cues, options) {
    const o = normalizeOptions(options);
    const issues = [];
    cues.forEach((cue, pos) => {
      const add = (code, severity, message, suggestion) => issues.push(makeIssue(cue, pos, 'timing', code, severity, message, suggestion));
      const dur = cue.end - cue.start;
      const empty = isEmptyCue(cue);
      if (pos > 0 && cue.index !== cues[pos - 1].index + 1) {
        add('seq-gap', 'warn', `序号 ${cue.index} 接在 ${cues[pos - 1].index} 后面,不连续`, '确认是否漏了字幕,或重新编号');
      }
      if (empty) add('empty-text', 'error', '这条字幕没有文本', '补全文本或删除这一条');
      if (dur <= 0) {
        add('start-after-end', 'error', `开始时间 ${formatTime(cue.start)} 不早于结束时间 ${formatTime(cue.end)}`, '手动修正时间轴(本工具只报不改)');
      } else {
        if (dur < o.minMs) add('too-short', 'warn', `时长 ${(dur / 1000).toFixed(2)} 秒,短于 ${(o.minMs / 1000).toFixed(1)} 秒,观众来不及读`, '延长显示时间或与相邻字幕合并');
        if (dur > o.maxMs) add('too-long', 'warn', `时长 ${(dur / 1000).toFixed(2)} 秒,长于 ${(o.maxMs / 1000).toFixed(1)} 秒`, '拆成两条');
        if (!empty) {
          const v = cps(cue);
          if (v > o.cpsMax) add('cps', 'warn', `字速 ${v.toFixed(1)} 字/秒,高于 ${o.cpsMax}`, '精简文字或延长显示时间');
        }
      }
      if (pos < cues.length - 1) {
        const next = cues[pos + 1];
        if (cue.end > next.start) add('overlap', 'error', `结束时间 ${formatTime(cue.end)} 晚于下一条开始时间 ${formatTime(next.start)},重叠 ${cue.end - next.start} 毫秒`, '手动调整其中一条的时间轴');
      }
      if (!empty) {
        if (cue.lines.length > o.maxLines) add('too-many-lines', 'warn', `共 ${cue.lines.length} 行,多于 ${o.maxLines} 行`, '精简文字或拆成两条');
        cue.lines.forEach((l, i) => {
          const p = plain(l).trim();
          const limit = CJK_RE.test(p) ? o.lineMaxCjk : o.lineMaxOther;
          if (len(p) > limit) add('line-long', 'warn', `第 ${i + 1} 行有 ${len(p)} 个字符,多于 ${limit}`, '在合适处断行');
        });
      }
    });
    // 同一条里同类型的 line-long 可能出现多次,保证 id 唯一
    const seen = new Map();
    for (const it of issues) {
      const n = (seen.get(it.id) || 0) + 1;
      seen.set(it.id, n);
      if (n > 1) it.id += ':' + n;
    }
    return issues;
  }

  function checkAll(cues, glossary, options) {
    return checkTerms(cues, glossary, options).concat(checkTiming(cues, options))
      .sort((a, b) => a.pos - b.pos || (a.kind === b.kind ? 0 : a.kind === 'term' ? -1 : 1));
  }

  // ---------- 替换(只改文本层) ----------
  function applyFixes(cues, accepted) {
    const out = cues.map(c => Object.assign({}, c, { lines: c.lines.slice() }));
    const byPos = new Map();
    for (const it of accepted || []) {
      if (!it || it.kind !== 'term' || !out[it.pos]) continue;
      if (!byPos.has(it.pos)) byPos.set(it.pos, []);
      byPos.get(it.pos).push(it);
    }
    for (const [pos, list] of byPos) {
      const cue = out[pos];
      list.sort((a, b) => b.lineNo - a.lineNo || b.col - a.col);
      for (const it of list) {
        const line = cue.lines[it.lineNo];
        if (line === undefined || line.slice(it.col, it.col + it.found.length) !== it.found) continue;
        cue.lines[it.lineNo] = line.slice(0, it.col) + it.replacement + line.slice(it.col + it.found.length);
      }
      cue.raw = cue.lines.join('\n');
    }
    return out;
  }

  // ---------- 导出 ----------
  // 公式防护:以 = @ 开头,或 + - 后面还有内容,或以制表/回车开头的字段加单引号前缀
  function guard(v) {
    const s = String(v == null ? '' : v);
    return /^(?:[=@\t\r]|[+-](?=[\s\S]))/.test(s) ? "'" + s : s;
  }
  const flat = s => String(s).replace(/\r?\n/g, ' / ');

  function summarize(issues) {
    const m = new Map();
    for (const it of issues) m.set(it.code, (m.get(it.code) || 0) + 1);
    return Array.from(m, ([code, count]) => ({ code, label: CODE_LABELS[code] || code, count }));
  }

  // errors: [{source:'字幕'|'术语表', line, message}],解析阶段的错误也要进报告
  function toMarkdown(issues, errors, meta) {
    const errs = errors || [];
    const src = meta && meta.sample ? ['数据来源:合成示例(虚构数据,仅用于演示)。', ''] : [];
    const cell = v => guard(flat(v)).replace(/\|/g, '\\|');
    const errBlock = errs.length
      ? ['', '## 解析错误', '', '| 来源 | 行号 | 说明 |', '| --- | --- | --- |'].concat(errs.map(e => `| ${cell(e.source)} | ${cell(e.line)} | ${cell(e.message)} |`))
      : [];
    if (!issues.length) {
      const head = '# 字幕校对报告\n\n' + src.map(l => l + '\n').join('');
      return (errs.length ? head + `检查未完成:${errs.length} 处解析错误,出错的内容没有被检查。\n` + errBlock.join('\n') + '\n' : head + '未发现问题。\n');
    }
    const lines = ['# 字幕校对报告', ''].concat(src, [`共 ${issues.length} 条问题${errs.length ? `,另有 ${errs.length} 处解析错误` : ''}。`, '']);
    for (const s of summarize(issues)) lines.push(`- ${s.label}:${s.count}`);
    lines.push('', '| 序号 | 时间 | 类型 | 原文 | 建议 |', '| --- | --- | --- | --- | --- |');
    for (const it of issues) {
      lines.push(`| ${cell(it.cueIndex)} | ${cell(it.time)} | ${cell(CODE_LABELS[it.code] || it.code)} | ${cell(it.original)} | ${cell(it.message + ';' + it.suggestion)} |`);
    }
    return lines.concat(errBlock).join('\n') + '\n';
  }

  function toCsv(issues, errors, meta) {
    const sample = !!(meta && meta.sample);
    const cell = v => {
      const s = guard(flat(v));
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = [['序号', '时间', '类型', '级别', '命中文本', '原文', '问题', '建议'].concat(sample ? ['数据来源'] : [])];
    for (const it of issues) {
      rows.push([it.cueIndex, it.time, CODE_LABELS[it.code] || it.code, it.severity === 'error' ? '错误' : '提示', it.found || '', it.original, it.message, it.suggestion].concat(sample ? ['合成示例'] : []));
    }
    for (const e of errors || []) {
      rows.push(['', `${e.source}第 ${e.line} 行`, '解析错误', '错误', '', '', e.message, '修正该行后重新检查'].concat(sample ? ['合成示例'] : []));
    }
    return '\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\n') + '\n';
  }

  const api = {
    DEFAULTS, CODE_LABELS, normalizeOptions, validateOptions, checkStatus, parseSubtitles, serialize, formatTime, cps,
    parseGlossary, checkTerms, checkTiming, checkAll, applyFixes, summarize, guard, toMarkdown, toCsv
  };
  globalThis.SubtitleCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
