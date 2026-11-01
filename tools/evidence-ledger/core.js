'use strict';
// 证据台账 · 纯逻辑层（无 DOM）。规则见 SPEC.md。
(function () {
  const TYPES = [
    { id: 'official', label: '官方文档', primary: true },
    { id: 'primary', label: '一手数据', primary: true },
    { id: 'secondary', label: '二手转述', primary: false },
    { id: 'observation', label: '个人观察', primary: false },
    { id: 'ai', label: 'AI 生成', primary: false }
  ];
  const STANCES = [
    { id: 'support', label: '支持' },
    { id: 'oppose', label: '反对' },
    { id: 'neutral', label: '不相关' }
  ];
  const STRENGTHS = [
    { id: 'strong', label: '强' },
    { id: 'medium', label: '中' },
    { id: 'weak', label: '弱' }
  ];
  const STATUS = {
    pending: '待验证',
    refuted: '已反驳',
    supported: '已支持',
    unsure: '不确定'
  };
  const ids = list => list.map(x => x.id);
  const labelOf = (list, id) => (list.find(x => x.id === id) || {}).label || id;

  let seq = 0;
  function newId(prefix) {
    seq += 1;
    return `${prefix || 'id'}-${Date.now().toString(36)}-${seq.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  }

  function evidenceOf(claim) {
    return Array.isArray(claim && claim.evidence) ? claim.evidence : [];
  }

  // 状态规则：无证据→待验证；任一强反对→已反驳；任一非 AI 支持→已支持；否则→不确定
  function status(claim) {
    const ev = evidenceOf(claim);
    if (ev.length === 0) return STATUS.pending;
    if (ev.some(e => e.stance === 'oppose' && e.strength === 'strong')) return STATUS.refuted;
    if (ev.some(e => e.stance === 'support' && e.type !== 'ai')) return STATUS.supported;
    return STATUS.unsure;
  }

  function counts(claim) {
    const ev = evidenceOf(claim);
    return {
      support: ev.filter(e => e.stance === 'support').length,
      oppose: ev.filter(e => e.stance === 'oppose').length,
      neutral: ev.filter(e => e.stance === 'neutral').length
    };
  }

  function flags(claim) {
    const ev = evidenceOf(claim);
    const primaryTypes = ids(TYPES.filter(t => t.primary));
    return {
      noPrimary: !ev.some(e => primaryTypes.includes(e.type)),
      aiOnly: ev.length > 0 && ev.every(e => e.type === 'ai')
    };
  }

  function audit(project) {
    const claims = Array.isArray(project && project.claims) ? project.claims : [];
    const out = { claimCount: claims.length, noEvidence: [], aiOnly: [], strongOpposeButSupported: [], missingUrl: [] };
    for (const c of claims) {
      const ev = evidenceOf(c);
      if (ev.length === 0) out.noEvidence.push(c);
      if (flags(c).aiOnly) out.aiOnly.push(c);
      if (status(c) === STATUS.supported && ev.some(e => e.stance === 'oppose' && e.strength === 'strong')) out.strongOpposeButSupported.push(c);
      for (const e of ev) {
        if (e.type !== 'observation' && !(e.url && String(e.url).trim())) out.missingUrl.push({ claim: c, evidence: e });
      }
    }
    return out;
  }

  function search(project, q) {
    const claims = Array.isArray(project && project.claims) ? project.claims : [];
    const needle = String(q || '').trim().toLowerCase();
    if (!needle) return claims.slice();
    return claims.filter(c => {
      const hay = [c.text, c.note, ...evidenceOf(c).flatMap(e => [e.title, e.excerpt, e.limit, e.url])]
        .filter(Boolean).join('\n').toLowerCase();
      return hay.includes(needle);
    });
  }

  function mdEscape(s) {
    return String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  }

  function toMarkdown(project) {
    const claims = Array.isArray(project && project.claims) ? project.claims : [];
    const lines = [];
    lines.push(`## 依据与局限 · ${project.title || '未命名项目'}`);
    if (project.sample) lines.push('', '数据来源：合成示例（虚构主张与证据，不是真实研究）。');
    if (project.question) lines.push('', `研究问题：${project.question}`);
    lines.push('', `整理日期：${project.date || ''}　主张 ${claims.length} 条。状态由台账规则自动判定（无证据=待验证；任一强反对=已反驳；任一非 AI 支持=已支持；其余=不确定），不是通用学术标准。`);
    for (const c of claims) {
      const f = flags(c);
      const warn = [f.noPrimary ? '缺一手证据' : '', f.aiOnly ? '仅有 AI 生成证据' : ''].filter(Boolean).join('；');
      lines.push('', `### ${c.text}`, '', `状态：**${status(c)}**${warn ? `　警示：${warn}` : ''}${c.note ? `　备注：${c.note}` : ''}`);
      const ev = evidenceOf(c);
      if (ev.length === 0) { lines.push('', '（尚无证据）'); continue; }
      lines.push('', '| 类型 | 立场 | 强度 | 来源 | 摘录 | 局限 |', '|---|---|---|---|---|---|');
      for (const e of ev) {
        const link = safeUrl(e.url);
      const src = link ? `[${mdEscape(e.title || link)}](${link})` : mdEscape(e.title || '（无来源）');
        lines.push(`| ${labelOf(TYPES, e.type)} | ${labelOf(STANCES, e.stance)} | ${labelOf(STRENGTHS, e.strength)} | ${src}${e.date ? ` · ${mdEscape(e.date)}` : ''} | ${mdEscape(e.excerpt)} | ${mdEscape(e.limit)} |`);
      }
    }
    return lines.join('\n') + '\n';
  }

  const TYPE_IDS = ids(TYPES), STANCE_IDS = ids(STANCES), STRENGTH_IDS = ids(STRENGTHS);
  // 只接受 http(s) 链接;其他协议(javascript: 等)视为不安全
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : ''; }
  function validateImport(json) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, error: '备份必须是对象' };
    if (json.version !== 1) return { ok: false, error: '备份版本不是 1' };
    if (!Array.isArray(json.projects)) return { ok: false, error: '缺少 projects 数组' };
    const projects = [];
    const projectIds = new Set();
    for (const p of json.projects) {
      if (!p || typeof p !== 'object') return { ok: false, error: '项目必须是对象' };
      if (typeof p.title !== 'string' || !p.title.trim()) return { ok: false, error: '项目缺少标题' };
      if (!Array.isArray(p.claims)) return { ok: false, error: `项目「${p.title}」缺少 claims 字段` };
      if (typeof p.id === 'string') { if (projectIds.has(p.id)) return { ok: false, error: `项目 ID 重复：${p.id}` }; projectIds.add(p.id); }
      const claims = [];
      const claimIds = new Set();
      for (const c of p.claims) {
        if (!c || typeof c.text !== 'string' || !c.text.trim()) return { ok: false, error: `项目「${p.title}」有主张缺少文本` };
        if (!Array.isArray(c.evidence)) return { ok: false, error: `主张「${c.text.trim()}」的 evidence 不是数组，拒绝导入以免丢失证据` };
        if (typeof c.id === 'string') { if (claimIds.has(c.id)) return { ok: false, error: `主张 ID 重复：${c.id}` }; claimIds.add(c.id); }
        const evidence = [];
        const evidenceIds = new Set();
        for (const e of c.evidence) {
          if (!e || typeof e !== 'object') return { ok: false, error: '证据必须是对象' };
          if (typeof e.id === 'string') { if (evidenceIds.has(e.id)) return { ok: false, error: `证据 ID 重复：${e.id}` }; evidenceIds.add(e.id); }
          if (e.url && typeof e.url === 'string' && e.url.trim() && !safeUrl(e.url)) return { ok: false, error: `证据 URL 不是 http(s) 链接：${String(e.url).slice(0, 60)}` };
          if (!TYPE_IDS.includes(e.type)) return { ok: false, error: `证据类型非法：${e.type}` };
          if (!STANCE_IDS.includes(e.stance)) return { ok: false, error: `证据立场非法：${e.stance}` };
          if (!STRENGTH_IDS.includes(e.strength)) return { ok: false, error: `证据强度非法：${e.strength}` };
          evidence.push({
            id: typeof e.id === 'string' ? e.id : newId('e'), type: e.type, stance: e.stance, strength: e.strength,
            title: str(e.title), url: safeUrl(e.url), excerpt: str(e.excerpt), date: str(e.date), limit: str(e.limit)
          });
        }
        claims.push({ id: typeof c.id === 'string' ? c.id : newId('c'), text: c.text.trim(), note: str(c.note), evidence });
      }
      projects.push({ id: typeof p.id === 'string' ? p.id : newId('p'), title: p.title.trim(), question: str(p.question), date: str(p.date), sample: p.sample === true, claims });
    }
    return { ok: true, projects };
  }
  function str(v) { return typeof v === 'string' ? v : ''; }

  function removeEvidence(claim, evidenceId) {
    claim.evidence = evidenceOf(claim).filter(e => e.id !== evidenceId);
    return claim;
  }

  function countOf(p) {
    const claims = Array.isArray(p && p.claims) ? p.claims : [];
    return { id: p.id, title: p.title, claims: claims.length, evidence: claims.reduce((n, c) => n + evidenceOf(c).length, 0) };
  }
  // 导入/载入示例前的预览:新增哪些项目、哪些同 ID 项目会被替换(给出现有的主张与证据数)、哪些原样保留
  function summarizeImport(current, incoming) {
    const cur = Array.isArray(current) ? current : [];
    const byId = new Map(cur.map(p => [p.id, p]));
    const inIds = new Set();
    const added = [], replaced = [];
    for (const p of Array.isArray(incoming) ? incoming : []) {
      inIds.add(p.id);
      if (byId.has(p.id)) replaced.push(countOf(byId.get(p.id)));
      else added.push(countOf(p));
    }
    return { added, replaced, keep: cur.filter(p => !inIds.has(p.id)).map(countOf) };
  }

  // 删除证据前预告:主张状态是否变化。不改原对象。
  function statusAfterRemove(claim, evidenceId) {
    const before = status(claim);
    const after = status({ evidence: evidenceOf(claim).filter(e => e.id !== evidenceId) });
    return { before, after, changed: before !== after };
  }

  // ?today=YYYY-MM-DD:格式 + 真实日历校验;非法回退 realToday,fixed=false
  function parseToday(search, realToday) {
    const m = /(?:^|[?&])today=(\d{4}-\d{2}-\d{2})(?:&|$)/.exec(typeof search === 'string' ? search : '');
    if (m) {
      const [y, mo, d] = m[1].split('-').map(Number);
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) return { date: m[1], fixed: true };
    }
    return { date: realToday, fixed: false };
  }

  const api = { parseToday, summarizeImport, statusAfterRemove, countOf, TYPES, STANCES, STRENGTHS, STATUS, labelOf, newId, status, counts, flags, audit, search, toMarkdown, validateImport, removeEvidence, safeUrl };
  globalThis.EvidenceCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
