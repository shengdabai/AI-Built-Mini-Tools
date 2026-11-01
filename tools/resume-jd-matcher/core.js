'use strict';
/* 求职材料岗位对照 · 纯逻辑(无 DOM)。规则切词,不理解语义。 */
(function () {
  const APP = 'jobmatch';
  const VERSION = 1;

  const REQ_RE = /熟悉|精通|掌握|了解|经验|年以上|优先|必须|具备|加分|更佳|\b(?:required|proficient|experience|familiar|plus|preferred|years?)\b|nice to have/i;
  const MUST_RE = /精通|必须|\b(?:required|proficient)\b/i;
  const BONUS_RE = /优先|加分|更佳|\b(?:plus|preferred|bonus)\b|nice to have/i;

  const EN_STOP = new Set(['required', 'proficient', 'experience', 'experiences', 'familiar', 'plus', 'preferred', 'with', 'in', 'of', 'the', 'a', 'an', 'to', 'for', 'and', 'or', 'strong', 'good', 'knowledge', 'years', 'year', 'ability', 'skills', 'skill', 'working', 'work', 'using', 'use', 'understanding', 'have', 'has', 'having', 'is', 'are', 'be', 'as', 'at', 'on', 'by', 'including', 'etc', 'nice', 'bonus', 'excellent', 'solid', 'proven', 'minimum', 'least', 'experienced', 'hands-on', 'ideally', 'plus']);
  const CJK_STOPS = ['优先考虑', '熟练掌握', '熟练使用', '等相关', '熟练', '熟悉', '精通', '掌握', '了解', '具备', '具有', '拥有', '良好', '优秀', '扎实', '经验', '能力', '相关', '优先', '以上', '至少', '要求', '必须', '加分', '更佳', '使用', '工作']
    .sort((a, b) => b.length - a.length);

  // CI/CD 等整体保留;其余斜杠视为分隔
  const TOKEN_SRC = 'CI\\/CD|TCP\\/IP|UI\\/UX|UI\\/UE|A\\/B|I\\/O|PL\\/SQL|[A-Za-z][A-Za-z0-9+#]*(?:[.\\-][A-Za-z0-9+#]+)*';

  function normalize(s) {
    return String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/[​﻿]/g, '').replace(/\s+/g, '');
  }
  function lightNormalize(s) {
    return String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/[​﻿]/g, '').replace(/\s+/g, ' ').trim();
  }

  function stripBullet(l) {
    return String(l).replace(/^\s*(?:[-*•·●▪◦]|\d{1,2}\s*[.、)）]|[（(]\d{1,2}[)）]|[一二三四五六七八九十]+[、.])\s*/, '').trim();
  }

  function extractRequirementLines(text) {
    if (typeof text !== 'string') return [];
    return text.split(/\r?\n/).map(stripBullet).filter(l => l && REQ_RE.test(l));
  }

  function splitConj(seg) {
    const parts = seg.split(/(以及|和|与|及|或)/);
    const out = [];
    let cur = parts[0];
    for (let i = 1; i < parts.length; i += 2) {
      const sep = parts[i];
      const next = parts[i + 1] || '';
      const ok = cur.length >= 2 && next.length >= 2 && !(sep === '及' && next[0] === '时');
      if (ok) { out.push(cur); cur = next; } else { cur += sep + next; }
    }
    out.push(cur);
    return out;
  }

  function cleanCjk(p) {
    let s = p.replace(/\d+\s*\+?\s*年(?:以上|及以上)?/g, '');
    for (const stop of CJK_STOPS) s = s.split(stop).join('');
    s = s.replace(/^[有对的并等者之将把让]+/, '').replace(/[的等者之]+$/, '');
    s = s.replace(/^(?:[和与或\d\s]|及(?!时))+|[和与及或\d\s]+$/g, '');
    if (s.length < 2 || !/[一-鿿]/.test(s)) return null;
    return s;
  }

  const DELIM_RE = /[\s、,;\/\\()\[\]{}【】《》<>"'“”‘’:：。.!?！？·•|~—–\-_=*&#@]+/;

  function termsOf(clause) {
    const text = clause.normalize('NFKC');
    const items = [];
    const re = new RegExp(TOKEN_SRC, 'gi');
    let last = 0;
    let m;
    const pushCjk = seg0 => {
      const seg = seg0.replace(/\d+\s*\+?\s*年(?:以上|及以上)?/g, ' ');
      for (const piece of seg.split(DELIM_RE)) {
        if (!piece) continue;
        for (const sub of splitConj(piece)) {
          const c = cleanCjk(sub);
          if (c) items.push({ t: c, en: false });
        }
      }
    };
    let prevEnd = -1;
    while ((m = re.exec(text))) {
      pushCjk(text.slice(last, m.index));
      const tok = m[0];
      const low = tok.toLowerCase();
      if (EN_STOP.has(low) || /^\d+$/.test(low)) {
        prevEnd = -1;
        last = m.index + tok.length;
        continue;
      }
      {
        const prev = items[items.length - 1];
        const gap = text.slice(prevEnd, m.index);
        if (prev && prev.en && prevEnd >= 0 && gap === ' ' && /^[A-Z]/.test(prev.t) && /^[A-Z]/.test(tok) && !/[\/]/.test(prev.t + tok)) {
          prev.t += ' ' + tok;
        } else {
          items.push({ t: tok, en: true });
        }
      }
      prevEnd = m.index + tok.length;
      last = prevEnd;
    }
    pushCjk(text.slice(last));
    return items.map(i => i.t);
  }

  function extractKeywords(lines) {
    const map = new Map();
    for (const line of Array.isArray(lines) ? lines : []) {
      for (const clause of String(line).split(/[,，;；。]/)) {
        if (!clause.trim()) continue;
        const bonus = BONUS_RE.test(clause);
        const must = MUST_RE.test(clause);
        const isMust = must || !bonus;
        for (const term of termsOf(clause)) {
          const key = normalize(term);
          if (!key) continue;
          const ex = map.get(key);
          if (ex) { if (isMust) ex.must = true; } else map.set(key, { term, must: isMust });
        }
      }
    }
    return Array.from(map.values());
  }

  /* 以上次提取(baseFound)为基准,统计用户对关键词列表做过的调整 */
  function keywordAdjustments(current, baseFound) {
    const baseMap = new Map((baseFound || []).map(k => [normalize(k.term), k]));
    const curMap = new Map((current || []).map(k => [normalize(k.term), k]));
    const out = { added: [], retyped: [], deleted: [], off: [], count: 0 };
    for (const [key, k] of curMap) {
      const b = baseMap.get(key);
      if (!b) out.added.push(k.term);
      else if (b.must !== k.must) out.retyped.push(k.term);
      if (k.on === false) out.off.push(k.term);
    }
    for (const [key, b] of baseMap) if (!curMap.has(key)) out.deleted.push(b.term);
    out.count = out.added.length + out.retyped.length + out.deleted.length + out.off.length;
    return out;
  }
  /* mode 'keep':保留当前列表里的全部调整,只补入「新出现且没被删过」的词;mode 'replace':整个换成新提取结果 */
  function mergeKeywords(current, baseFound, found, mode) {
    if (mode === 'replace') return (found || []).map(k => ({ term: k.term, must: k.must, on: true }));
    const out = (current || []).map(k => ({ term: k.term, must: k.must, on: k.on }));
    const have = new Set(out.map(k => normalize(k.term)));
    const deleted = new Set(keywordAdjustments(current, baseFound).deleted.map(normalize));
    for (const k of found || []) {
      const key = normalize(k.term);
      if (have.has(key) || deleted.has(key)) continue;
      have.add(key);
      out.push({ term: k.term, must: k.must, on: true });
    }
    return out;
  }

  function parseSynonyms(text) {
    if (Array.isArray(text)) return text.map(g => g.map(String)).filter(g => g.length >= 2);
    const groups = [];
    for (const line of String(text == null ? '' : text).split(/\r?\n/)) {
      const items = line.normalize('NFKC').split('=').map(x => x.trim()).filter(Boolean);
      if (items.length >= 2) groups.push(items);
    }
    return groups;
  }

  function variantsFor(term, groups) {
    const seen = new Map();
    seen.set(normalize(term), term);
    const nt = normalize(term);
    for (const g of groups) {
      if (g.some(x => normalize(x) === nt)) {
        for (const x of g) { const k = normalize(x); if (k && !seen.has(k)) seen.set(k, x); }
      }
    }
    return Array.from(seen.values());
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&'); }

  function makeTester(variant) {
    const light = lightNormalize(variant);
    if (/^[\x20-\x7e]+$/.test(light)) {
      const lastAlnum = /[a-z0-9]$/.test(light);
      // 去空格规则:词内任意两个字符之间允许有空白(S Q L、Google Meet、GoogleMeet 都算同一个词)
      const body = Array.from(light.replace(/\s+/g, '')).map(escapeRe).join('\\s*');
      const re = new RegExp('(?<![a-z0-9])' + body + (lastAlnum ? '(?![a-z0-9+#])' : '(?![a-z0-9])'));
      return (nsp) => re.test(nsp);
    }
    const nv = normalize(variant);
    return (nsp, nfull) => nfull.includes(nv);
  }

  function match(keywords, resume, synonyms) {
    const kws = Array.isArray(keywords) ? keywords : [];
    const groups = parseSynonyms(synonyms);
    const lines = String(resume == null ? '' : resume).split(/\r?\n/).map(l => ({ nsp: lightNormalize(l), nfull: normalize(l) }));
    const items = [];
    const hits = [];
    const missing = [];
    const g = { must: { hit: 0, total: 0, missing: [] }, bonus: { hit: 0, total: 0, missing: [] } };
    for (const kw of kws) {
      const testers = variantsFor(kw.term, groups).map(makeTester);
      const found = [];
      lines.forEach((ln, i) => { if (ln.nfull && testers.some(t => t(ln.nsp, ln.nfull))) found.push(i + 1); });
      const grp = kw.must ? g.must : g.bonus;
      grp.total++;
      items.push({ term: kw.term, must: !!kw.must, hit: found.length > 0, lines: found });
      if (found.length) { hits.push({ term: kw.term, must: !!kw.must, lines: found }); grp.hit++; } else { missing.push(kw.term); grp.missing.push(kw.term); }
    }
    const total = kws.length;
    return {
      hits, missing, items, total, hitCount: hits.length,
      coverage: total ? hits.length / total : 0,
      mustCoverage: g.must.total ? g.must.hit / g.must.total : 0,
      bonusCoverage: g.bonus.total ? g.bonus.hit / g.bonus.total : 0,
      byGroup: g
    };
  }

  function extractFacts(resume) {
    const out = [];
    const seen = new Set();
    String(resume == null ? '' : resume).split(/\r?\n/).forEach((raw, idx) => {
      for (const sentRaw of raw.split(/[。;；!！?？]/)) {
        const text = stripBullet(sentRaw);
        if (!text) continue;
        const probe = text.normalize('NFKC');
        if (/\d[\d.,]*\s*(?:%|年|人|万|倍|亿|\+)/.test(probe)) {
          const key = normalize(text);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ line: idx + 1, text, key });
        }
      }
    });
    return out;
  }

  function diffLines(a, b) {
    const split = s => (s == null || s === '' ? [] : String(s).split('\n').map(l => l.replace(/\r$/, '')));
    const A = split(a), B = split(b);
    const n = A.length, m = B.length;
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push({ type: 'same', text: A[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: A[i] }); i++; }
      else { out.push({ type: 'add', text: B[j] }); j++; }
    }
    while (i < n) out.push({ type: 'del', text: A[i++] });
    while (j < m) out.push({ type: 'add', text: B[j++] });
    return out;
  }

  function versionTrend(versions) {
    const list = (Array.isArray(versions) ? versions : []).map((v, idx) => ({ v, idx, t: Date.parse(v.time) }));
    list.sort((x, y) => (x.t - y.t) || (x.idx - y.idx));
    let prev = null;
    return list.map(({ v }) => {
      const cov = typeof v.coverage === 'number' ? v.coverage : null;
      const delta = cov !== null && prev !== null ? cov - prev : null;
      if (cov !== null) prev = cov;
      return { id: v.id, title: v.title, time: v.time, coverage: cov, mustCoverage: typeof v.mustCoverage === 'number' ? v.mustCoverage : null, delta };
    });
  }

  function guard(s) {
    const str = String(s == null ? '' : s);
    const t = str.replace(/^\s+/, '');
    if (!t) return str;
    const c = t[0];
    if (c === '=' || c === '@' || c === '\t' || c === '\r') return "'" + str;
    if ((c === '+' || c === '-') && t.length > 1) return "'" + str;
    return str;
  }
  function cell(s) { return guard(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }
  function pct(x) { return (Math.round(x * 1000) / 10) + '%'; }

  function toMarkdown(report) {
    const r = report || {};
    const res = r.result || { items: [], total: 0, hitCount: 0, missing: [], byGroup: { must: { hit: 0, total: 0 }, bonus: { hit: 0, total: 0 } }, coverage: 0, mustCoverage: 0, bonusCoverage: 0 };
    const L = [];
    L.push('# 岗位对照报告:' + String(r.jobTitle || '未命名岗位').replace(/\r?\n/g, ' '));
    L.push('');
    if (r.date) L.push('- 日期:' + r.date);
    if (r.resumeLabel) L.push('- 简历:' + String(r.resumeLabel).replace(/\r?\n/g, ' '));
    L.push('- 总覆盖率:' + pct(res.coverage) + '(' + res.hitCount + '/' + res.total + ')');
    L.push('- 必须项覆盖率:' + pct(res.mustCoverage) + '(' + res.byGroup.must.hit + '/' + res.byGroup.must.total + ')');
    L.push('- 加分项覆盖率:' + pct(res.bonusCoverage) + '(' + res.byGroup.bonus.hit + '/' + res.byGroup.bonus.total + ')');
    L.push('');
    L.push('## 关键词对照');
    L.push('');
    L.push('| 关键词 | 类型 | 结果 | 简历命中行 |');
    L.push('|---|---|---|---|');
    for (const it of res.items) {
      L.push('| ' + cell(it.term) + ' | ' + (it.must ? '必须' : '加分') + ' | ' + (it.hit ? '命中' : '缺失') + ' | ' + (it.hit ? it.lines.join(', ') : '-') + ' |');
    }
    L.push('');
    L.push('## 缺失关键词');
    L.push('');
    const miss = res.items.filter(i => !i.hit);
    if (!miss.length) L.push('无缺失。');
    for (const it of miss.filter(i => i.must)) L.push('- ' + cell(it.term) + '(必须)');
    for (const it of miss.filter(i => !i.must)) L.push('- ' + cell(it.term) + '(加分)');
    L.push('');
    L.push('## 事实核验清单');
    L.push('');
    const facts = Array.isArray(r.facts) ? r.facts : [];
    if (!facts.length) L.push('简历中没有抽到含数字的句子。');
    else {
      L.push('| 行 | 语句 | 核验 |');
      L.push('|---|---|---|');
      const label = { ok: '有证据', fix: '需修改' };
      for (const f of facts) L.push('| ' + f.line + ' | ' + cell(f.text) + ' | ' + (label[f.status] || '未核验') + ' |');
    }
    L.push('');
    return L.join('\n');
  }

  function resolveToday(search, fallback) {
    let v = null;
    try { v = new URLSearchParams(String(search || '')).get('today'); } catch (e) { v = null; }
    if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const d = new Date(v + 'T00:00:00Z');
      if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v) return v;
    }
    return fallback;
  }
  function localDateString(d) {
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function stamp(today, d) {
    const p = n => String(n).padStart(2, '0');
    return today + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function emptyJob(id, title) {
    return { id, title: title || '未命名岗位', jd: '', resume: '', synonyms: '', keywords: [], kwFrom: null, factChecks: Object.create(null), versions: [] };
  }
  function exportData(state) {
    return { app: APP, version: VERSION, exportedAt: new Date().toISOString(), currentId: state.currentId || null, jobs: state.jobs };
  }

  const isStr = v => typeof v === 'string';
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  function validateImport(input) {
    let data = input;
    if (typeof input === 'string') {
      try { data = JSON.parse(input); } catch (e) { return { ok: false, error: '不是合法的 JSON 文件。' }; }
    }
    if (!isObj(data)) return { ok: false, error: '顶层必须是对象。' };
    if (data.app !== APP) return { ok: false, error: '不是本工具导出的备份(app 字段应为 ' + APP + ')。' };
    if (data.version !== VERSION) return { ok: false, error: '备份版本不受支持(应为 ' + VERSION + ')。' };
    if (!Array.isArray(data.jobs)) return { ok: false, error: 'jobs 必须是数组。' };
    const ids = new Set();
    const jobs = [];
    for (let ji = 0; ji < data.jobs.length; ji++) {
      const j = data.jobs[ji];
      const at = '第 ' + (ji + 1) + ' 个岗位';
      if (!isObj(j)) return { ok: false, error: at + '不是对象。' };
      if (!isStr(j.id) || !j.id || j.id.length > 80) return { ok: false, error: at + '的 id 缺失或不合法。' };
      if (ids.has(j.id)) return { ok: false, error: at + '的 id 重复:' + j.id };
      ids.add(j.id);
      for (const f of ['title', 'jd', 'resume', 'synonyms']) if (!isStr(j[f])) return { ok: false, error: at + '的 ' + f + ' 必须是字符串。' };
      if (!Array.isArray(j.keywords)) return { ok: false, error: at + '的 keywords 必须是数组。' };
      const kwSeen = new Set();
      const keywords = [];
      for (const k of j.keywords) {
        if (!isObj(k) || !isStr(k.term) || !k.term.trim() || typeof k.must !== 'boolean' || typeof k.on !== 'boolean') return { ok: false, error: at + '的关键词需要 term(非空字符串)、must(布尔)、on(布尔)。' };
        const nk = normalize(k.term);
        if (kwSeen.has(nk)) return { ok: false, error: at + '的关键词重复:' + k.term };
        kwSeen.add(nk);
        keywords.push({ term: k.term, must: k.must, on: k.on });
      }
      if (j.kwFrom !== null && !isStr(j.kwFrom)) return { ok: false, error: at + '的 kwFrom 必须是字符串或 null。' };
      if (!isObj(j.factChecks)) return { ok: false, error: at + '的 factChecks 必须是对象。' };
      const factChecks = Object.create(null);
      for (const key of Object.keys(j.factChecks)) {
        const v = j.factChecks[key];
        if (v !== 'ok' && v !== 'fix') return { ok: false, error: at + '的核验状态只能是 ok 或 fix。' };
        factChecks[key] = v;
      }
      if (!Array.isArray(j.versions)) return { ok: false, error: at + '的 versions 必须是数组。' };
      const vids = new Set();
      const versions = [];
      for (const v of j.versions) {
        if (!isObj(v)) return { ok: false, error: at + '的版本不是对象。' };
        if (!isStr(v.id) || !v.id || v.id.length > 80) return { ok: false, error: at + '的版本 id 不合法。' };
        if (vids.has(v.id)) return { ok: false, error: at + '的版本 id 重复:' + v.id };
        vids.add(v.id);
        if (!isStr(v.title) || !isStr(v.text)) return { ok: false, error: at + '的版本 title/text 必须是字符串。' };
        if (!isStr(v.time) || Number.isNaN(Date.parse(v.time))) return { ok: false, error: at + '的版本 time 不是合法时间。' };
        for (const f of ['coverage', 'mustCoverage']) {
          if (v[f] !== null && !(typeof v[f] === 'number' && v[f] >= 0 && v[f] <= 1)) return { ok: false, error: at + '的版本 ' + f + ' 必须是 0 到 1 的数字或 null。' };
        }
        for (const f of ['hits', 'total']) {
          if (!Number.isInteger(v[f]) || v[f] < 0) return { ok: false, error: at + '的版本 ' + f + ' 必须是非负整数。' };
        }
        versions.push({ id: v.id, title: v.title, time: v.time, text: v.text, coverage: v.coverage, mustCoverage: v.mustCoverage, hits: v.hits, total: v.total });
      }
      jobs.push({ id: j.id, title: j.title, jd: j.jd, resume: j.resume, synonyms: j.synonyms, keywords, kwFrom: j.kwFrom, factChecks, versions });
    }
    let currentId = null;
    if (data.currentId !== null && data.currentId !== undefined) {
      if (!isStr(data.currentId) || !ids.has(data.currentId)) return { ok: false, error: 'currentId 指向不存在的岗位。' };
      currentId = data.currentId;
    }
    return { ok: true, data: { jobs, currentId } };
  }

  const api = {
    APP, VERSION, normalize, extractRequirementLines, extractKeywords, keywordAdjustments, mergeKeywords, parseSynonyms, match, extractFacts,
    diffLines, versionTrend, toMarkdown, guard, validateImport, resolveToday, localDateString, stamp, emptyJob, exportData, pct
  };
  globalThis.JobMatchCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
