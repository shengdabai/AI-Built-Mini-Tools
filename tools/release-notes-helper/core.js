'use strict';
(function () {
  const TYPES = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'style', 'revert'];
  const DOCS_TYPES = ['docs'];
  const CHORE_TYPES = ['chore', 'build', 'ci', 'test', 'style'];
  const REFACTOR_TYPES = ['refactor', 'revert'];
  const GROUP_ORDER = ['breaking', 'feat', 'fix', 'perf', 'other'];
  const GROUP_TITLES = { breaking: '破坏性变更', feat: '新功能', fix: '修复', perf: '性能', other: '其他' };
  const TAB_VALUES = ['preview', 'edit', 'changelog'];
  const CONVENTIONAL_RE = new RegExp('^(' + TYPES.join('|') + ')(?:\\(([^()\\r\\n]*)\\))?(!)?:[ \\t]*(\\S.*)$', 'i');
  const MERGE_RE = /^Merge (?:branch|pull request|remote-tracking branch|tag|commit|pull)\b/i;
  const TRAILER_RE = /^(?:Co-authored-by|Signed-off-by|Reviewed-by|Acked-by|Tested-by|Reported-by|Helped-by|Cc):/i;
  const SHA_RE = /^[0-9a-f]{7,40}$/i;

  const normalize = text => String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const isMergeSubject = s => MERGE_RE.test(String(s || '').trim());

  // ---------- 日期与版本 ----------
  function isValidDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }
  // 合法的 ?today=YYYY-MM-DD 才返回日期,否则 null
  function todayFromParam(search) {
    let q = null;
    try { q = new URLSearchParams(search || '').get('today'); } catch (e) { q = null; }
    return q && isValidDate(q) ? q : null;
  }
  function resolveToday(search, now) {
    const q = todayFromParam(search);
    if (q) return q;
    const d = now instanceof Date ? now : new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function parseSemver(v) {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? '').trim());
    if (!m) return null;
    return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
  }
  function normalizeRepoUrl(u) {
    const s = String(u ?? '').trim();
    if (!s) return null;
    try {
      const x = new URL(s);
      if (x.protocol !== 'http:' && x.protocol !== 'https:') return null;
      if (!x.hostname) return null;
      return (x.origin + x.pathname).replace(/\/+$/, '').replace(/\.git$/i, '');
    } catch (e) { return null; }
  }

  // ---------- 格式识别与解析 ----------
  function prettyParts(line) {
    const parts = line.split('|');
    return parts.length >= 4 && SHA_RE.test(parts[0].trim()) ? parts : null;
  }
  function detectFormat(text) {
    const t = normalize(text);
    if (!t.trim()) return 'empty';
    if (/^commit [0-9a-f]{7,40}\b/im.test(t)) return 'raw';
    const lines = t.split('\n').filter(l => l.trim());
    const half = lines.length / 2;
    if (lines.filter(l => prettyParts(l)).length >= half) return 'pretty';
    if (lines.filter(l => /^[0-9a-f]{7,40}[ \t]+\S/i.test(l)).length >= half) return 'oneline';
    return 'unknown';
  }
  function parseOneline(t) {
    const out = [];
    for (const line of t.split('\n')) {
      const m = /^([0-9a-f]{7,40})[ \t]+(?:\((?:HEAD|tag:|origin\/)[^)]*\)[ \t]+)?(\S.*)$/i.exec(line);
      if (!m) continue;
      out.push({ sha: m[1], subject: m[2].trim(), body: '', author: '', date: '', isMerge: isMergeSubject(m[2]) });
    }
    return out;
  }
  function parsePretty(t) {
    const out = [];
    for (const line of t.split('\n')) {
      if (!line.trim()) continue;
      const p = prettyParts(line);
      if (!p) continue;
      const subject = p.slice(1, -2).join('|').trim();
      if (!subject) continue;
      out.push({ sha: p[0].trim(), subject, body: '', author: p[p.length - 2].trim(), date: p[p.length - 1].trim(), isMerge: isMergeSubject(subject) });
    }
    return out;
  }
  function parseRaw(t) {
    const out = [];
    let cur = null;
    const flush = () => {
      if (!cur) return;
      const msg = cur.msg.map(l => l.replace(/^ {4}/, ''));
      while (msg.length && !msg[msg.length - 1].trim()) msg.pop();
      while (msg.length && !msg[0].trim()) msg.shift();
      const subject = (msg[0] || '').trim();
      const body = msg.slice(1).join('\n').replace(/^\n+/, '').trim();
      out.push({ sha: cur.sha, subject, body, author: cur.author, date: cur.date, isMerge: cur.mergeHeader || isMergeSubject(subject) });
      cur = null;
    };
    for (const line of t.split('\n')) {
      const c = /^commit ([0-9a-f]{7,40})\b/i.exec(line);
      if (c) { flush(); cur = { sha: c[1], author: '', date: '', mergeHeader: false, inMsg: false, msg: [] }; continue; }
      if (!cur) continue;
      if (!cur.inMsg) {
        if (!line.trim()) { cur.inMsg = true; continue; }
        const a = /^Author:\s*(.*?)\s*(?:<[^>]*>)?\s*$/.exec(line);
        if (a) { cur.author = a[1]; continue; }
        const d = /^Date:\s*(.*)$/.exec(line);
        if (d) { cur.date = d[1].trim(); continue; }
        if (/^Merge:/.test(line)) cur.mergeHeader = true;
        continue;
      }
      cur.msg.push(line);
    }
    flush();
    return out;
  }
  function parseLog(text) {
    const t = normalize(text);
    const fmt = detectFormat(t);
    const list = fmt === 'raw' ? parseRaw(t) : fmt === 'pretty' ? parsePretty(t) : fmt === 'oneline' ? parseOneline(t) : [];
    const seen = new Map();
    for (const c of list) {
      const n = (seen.get(c.sha) || 0) + 1;
      seen.set(c.sha, n);
      c.id = n === 1 ? c.sha : `${c.sha}~${n}`;
    }
    return list;
  }

  // ---------- Conventional Commits ----------
  function extractBreakingNote(body) {
    const lines = normalize(body).split('\n');
    const i = lines.findIndex(l => /^BREAKING[ -]CHANGE:/.test(l));
    if (i < 0) return null;
    const parts = [lines[i].replace(/^BREAKING[ -]CHANGE:\s*/, '').trim()];
    for (let k = i + 1; k < lines.length; k++) {
      const l = lines[k];
      if (!l.trim() || /^[A-Za-z][A-Za-z-]*: /.test(l)) break;
      parts.push(l.trim());
    }
    return parts.filter(Boolean).join(' ');
  }
  function extractRefs(subject, body) {
    const refs = [];
    const add = n => { if (!refs.includes(n)) refs.push(n); };
    for (const m of String(subject || '').matchAll(/(?<![\w&/])#(\d+)\b/g)) add(m[1]);
    for (const m of normalize(body).matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\s+#(\d+)\b/gi)) add(m[1]);
    return refs;
  }
  function parseConventional(commit) {
    const subject = String(commit && commit.subject || '').trim();
    const body = String(commit && commit.body || '');
    const m = CONVENTIONAL_RE.exec(subject);
    const note = extractBreakingNote(body);
    const scope = m && m[2] && m[2].trim() ? m[2].trim() : null;
    return {
      type: m ? m[1].toLowerCase() : 'other',
      conventional: !!m,
      scope,
      breaking: !!(m && m[3]) || note !== null,
      breakingNote: note,
      subject: m ? m[4].trim() : subject,
      refs: extractRefs(subject, body)
    };
  }

  // ---------- 用户可读化 ----------
  function linkRefs(text, repoUrl) {
    const repo = normalizeRepoUrl(repoUrl);
    if (!repo) return text;
    return text.replace(/(?<![\w&/])#(\d+)\b/g, (m, n) => `[#${n}](${repo}/issues/${n})`);
  }
  function humanize(subject, options) {
    const opt = options || {};
    const lines = normalize(subject).split('\n').map(l => l.trim()).filter(l => l && !TRAILER_RE.test(l));
    let s = lines[0] || '';
    const m = CONVENTIONAL_RE.exec(s);
    if (m) s = m[4].trim();
    if (/[^.]\.$/.test(s) || /。$/.test(s)) s = s.slice(0, -1).trim();
    if (/^[a-z]/.test(s)) s = s.charAt(0).toUpperCase() + s.slice(1);
    return linkRefs(s, opt.repoUrl);
  }

  // ---------- 分组 ----------
  function group(commits, options) {
    const opt = options || {};
    const actions = new Set(opt.userActions || []);
    const buckets = new Map(GROUP_ORDER.map(k => [k, []]));
    const skipped = [];
    for (const c of commits || []) {
      const p = parseConventional(c);
      const skip = reason => skipped.push({ id: c.id || c.sha, sha: c.sha, subject: c.subject, reason });
      if (!p.subject) { skip('empty'); continue; }
      if (c.isMerge && !opt.includeMerges) { skip('merge'); continue; }
      let key;
      if (p.breaking) key = 'breaking';
      else if (p.type === 'feat' || p.type === 'fix' || p.type === 'perf') key = p.type;
      else if (DOCS_TYPES.includes(p.type)) { if (!opt.includeDocs) { skip('docs'); continue; } key = 'other'; }
      else if (CHORE_TYPES.includes(p.type)) { if (!opt.includeChore) { skip('chore'); continue; } key = 'other'; }
      else if (REFACTOR_TYPES.includes(p.type)) { if (!opt.includeRefactor) { skip('refactor'); continue; } key = 'other'; }
      else key = 'other';
      const id = c.id || c.sha;
      buckets.get(key).push({
        id, sha: c.sha, type: p.type, scope: p.scope, breaking: p.breaking,
        text: humanize(p.subject, opt),
        note: p.breakingNote ? linkRefs(p.breakingNote, opt.repoUrl) : null,
        refs: p.refs, userAction: actions.has(id)
      });
    }
    const groups = GROUP_ORDER.filter(k => buckets.get(k).length).map(k => ({ key: k, title: GROUP_TITLES[k], items: buckets.get(k) }));
    return { groups, skipped };
  }

  // ---------- 版本建议 ----------
  function nextVersion(current, groups) {
    const v = parseSemver(current);
    if (!v) throw new Error('当前版本号格式应为 x.y.z(例如 1.2.3)');
    const list = Array.isArray(groups) ? groups : (groups && groups.groups) || [];
    const has = k => list.some(g => g.key === k && g.items.length);
    let bump = 'none';
    let reason = '没有新功能、修复或性能变更,版本号不变';
    if (v.major === 0) {
      if (has('breaking')) { bump = 'minor'; reason = '有破坏性变更(0.x 约定:升次版本)'; }
      else if (list.some(g => g.items.length)) { bump = 'patch'; reason = '有其他保留下来的变更(0.x 约定:升修订版本)'; }
    } else if (has('breaking')) { bump = 'major'; reason = '有破坏性变更'; }
    else if (has('feat')) { bump = 'minor'; reason = '有新功能'; }
    else if (has('fix') || has('perf')) { bump = 'patch'; reason = '有修复或性能变更'; }
    let { major, minor, patch } = v;
    if (bump === 'major') { major += 1; minor = 0; patch = 0; }
    else if (bump === 'minor') { minor += 1; patch = 0; }
    else if (bump === 'patch') { patch += 1; }
    return { next: `${major}.${minor}.${patch}`, bump, reason, current: `${v.major}.${v.minor}.${v.patch}` };
  }

  // ---------- 输出 ----------
  function byScope(items) {
    const map = new Map();
    const plain = [];
    for (const it of items) {
      if (it.scope) { if (!map.has(it.scope)) map.set(it.scope, []); map.get(it.scope).push(it); }
      else plain.push(it);
    }
    return { scoped: [...map.entries()], plain };
  }
  function itemLines(items, noteLabel, prefixFor) {
    const lines = [];
    const push = (it, indent, scopePrefix) => {
      lines.push(`${indent}- ${scopePrefix}${prefixFor ? prefixFor(it) : ''}${it.text}`);
      if (it.note) lines.push(`${indent}  - ${noteLabel}${it.note}`);
    };
    const { scoped, plain } = byScope(items);
    for (const [scope, list] of scoped) {
      if (list.length === 1) push(list[0], '', `**${scope}**: `);
      else { lines.push(`- **${scope}**`); for (const it of list) push(it, '  ', ''); }
    }
    for (const it of plain) push(it, '', '');
    return lines;
  }
  function toReleaseNotes(groups, options) {
    const opt = options || {};
    const list = Array.isArray(groups) ? groups : (groups && groups.groups) || [];
    const head = `## ${opt.version ? opt.version : '未发布版本'}${opt.date ? ` (${opt.date})` : ''}`;
    const out = [head, ''];
    if (!list.length) out.push('本次没有可写入发布说明的变更。', '');
    for (const g of list) {
      out.push(`### ${g.title}`, ...itemLines(g.items, '说明:'), '');
    }
    const acts = [];
    for (const g of list) for (const it of g.items) if (it.userAction) acts.push(it);
    if (acts.length) {
      out.push('### 升级时需要你操作');
      for (const it of acts) out.push(`- ${it.scope ? `**${it.scope}**: ` : ''}${it.text}${it.note ? `(${it.note})` : ''}`);
      out.push('');
    }
    return out.join('\n').replace(/\n+$/, '\n');
  }
  function changelogSection(it) {
    if (it.type === 'feat') return 'Added';
    if (it.type === 'fix') return 'Fixed';
    if (it.type === 'revert') return 'Removed';
    return 'Changed';
  }
  function toChangelog(groups, version, date, options) {
    if (!parseSemver(version)) throw new Error('版本号格式应为 x.y.z');
    if (!isValidDate(date)) throw new Error('日期格式应为 YYYY-MM-DD 且为真实日期');
    const list = Array.isArray(groups) ? groups : (groups && groups.groups) || [];
    const v = parseSemver(version);
    const sections = new Map([['Added', []], ['Changed', []], ['Removed', []], ['Fixed', []]]);
    for (const g of list) for (const it of g.items) sections.get(changelogSection(it)).push(it);
    const out = [`## [${v.major}.${v.minor}.${v.patch}] - ${date}`, ''];
    let any = false;
    for (const [name, items] of sections) {
      if (!items.length) continue;
      any = true;
      out.push(`### ${name}`, ...itemLines(items, '', it => (it.breaking ? '**BREAKING** ' : '')), '');
    }
    const acts = [];
    for (const g of list) for (const it of g.items) if (it.userAction) acts.push(it);
    if (acts.length) {
      any = true;
      out.push('### Action required');
      for (const it of acts) out.push(`- ${it.scope ? `**${it.scope}**: ` : ''}${it.text}${it.note ? ` (${it.note})` : ''}`);
      out.push('');
    }
    if (!any) out.push('本版本没有记录的变更。', '');
    return out.join('\n').replace(/\n+$/, '\n');
  }

  // ---------- Markdown 预览(只支持本产品输出用到的子集,先转义再替换) ----------
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function inlineMd(s) {
    return escapeHtml(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);
  }
  function renderMarkdown(md) {
    const out = [];
    let depth = -1;
    const closeAll = () => { while (depth >= 0) { out.push('</li></ul>'); depth -= 1; } };
    for (const line of normalize(md).split('\n')) {
      const li = /^( *)- (.*)$/.exec(line);
      if (li) {
        const d = Math.min(Math.floor(li[1].length / 2), depth + 1);
        if (d === depth + 1) { out.push(`<ul><li>${inlineMd(li[2])}`); depth = d; }
        else {
          while (depth > d) { out.push('</li></ul>'); depth -= 1; }
          out.push(`</li><li>${inlineMd(li[2])}`);
        }
        continue;
      }
      closeAll();
      const h = /^(#{2,3}) (.*)$/.exec(line);
      if (h) out.push(`<h${h[1].length + 1}>${inlineMd(h[2])}</h${h[1].length + 1}>`);
      else if (line.trim()) out.push(`<p>${inlineMd(line)}</p>`);
    }
    closeAll();
    return out.join('');
  }

  // ---------- 本机草稿的校验(只拒绝类型/枚举/重复 ID 错误;半成品文本照常恢复,业务校验推迟到生成/导出) ----------
  function defaultState() {
    return {
      log: '', repoUrl: '', current: '', release: '', date: '',
      opts: { docs: false, chore: false, refactor: false, merges: false },
      actions: [], edited: null, editedSig: null, tab: 'preview', sample: false
    };
  }
  function validateState(obj) {
    const bad = msg => ({ ok: false, error: msg });
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return bad('保存的数据不是对象');
    for (const k of ['log', 'repoUrl', 'current', 'release', 'date']) if (typeof obj[k] !== 'string') return bad(`字段 ${k} 应为文本`);
    if (obj.log.length > 2000000) return bad('git log 文本过长');
    // 草稿允许半成品(如版本号输入到 `1.`):格式校验只在生成/导出时做,见 app.js compute()
    const o = obj.opts;
    if (!o || typeof o !== 'object') return bad('缺少 opts');
    for (const k of ['docs', 'chore', 'refactor', 'merges']) if (typeof o[k] !== 'boolean') return bad(`opts.${k} 应为布尔值`);
    if (!Array.isArray(obj.actions) || obj.actions.some(a => typeof a !== 'string')) return bad('actions 应为文本数组');
    if (new Set(obj.actions).size !== obj.actions.length) return bad('actions 含重复 ID');
    if (obj.edited !== null && typeof obj.edited !== 'string') return bad('edited 应为文本或空');
    if (obj.editedSig !== null && typeof obj.editedSig !== 'string') return bad('editedSig 应为文本或空');
    if (!TAB_VALUES.includes(obj.tab)) return bad('tab 取值不合法');
    if (obj.sample !== undefined && typeof obj.sample !== 'boolean') return bad('sample 应为布尔值');
    return {
      ok: true,
      state: {
        log: obj.log, repoUrl: obj.repoUrl, current: obj.current, release: obj.release, date: obj.date,
        opts: { docs: o.docs, chore: o.chore, refactor: o.refactor, merges: o.merges },
        actions: obj.actions.slice(), edited: obj.edited, editedSig: obj.editedSig, tab: obj.tab, sample: obj.sample === true
      }
    };
  }

  // 示例状态下,导出文件首行加注释,脱离界面后仍能看出是合成示例
  function markSample(text, sample) {
    if (typeof text !== 'string' || !sample) return text;
    return '<!-- 合成示例:非真实仓库,内容为虚构,仅用于演示 -->\n' + text;
  }
  // 是否有用户数据:日志、任一字段、勾选、非默认选项、手改。date 等于基准日不算改动
  function hasDraft(state, todayStr) {
    const d = defaultState();
    if (String(state.log || '').trim() !== '') return true;
    if (state.repoUrl || state.current || state.release) return true;
    if (state.date && state.date !== todayStr) return true;
    if ((state.actions || []).length) return true;
    if (state.edited !== null && state.edited !== undefined) return true;
    return ['docs', 'chore', 'refactor', 'merges'].some(k => !!(state.opts && state.opts[k]) !== d.opts[k]);
  }

  const api = {
    detectFormat, parseLog, parseConventional, group, humanize, nextVersion, toReleaseNotes, toChangelog,
    parseSemver, isValidDate, resolveToday, todayFromParam, markSample, hasDraft, normalizeRepoUrl, renderMarkdown, escapeHtml, validateState, defaultState,
    GROUP_TITLES, TAB_VALUES
  };
  globalThis.ReleaseCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
