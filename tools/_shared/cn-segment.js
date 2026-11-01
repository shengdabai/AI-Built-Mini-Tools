'use strict';
// 共享分词：正向最大匹配（FMM），词典为 HSK_WORDS 形态 { 词: { l, p } }。
// 返回 token 列表：{ t: 原文, kind: 'word' | 'char' | 'other', level?: 1..7, pinyin?: string }
// kind: word = 词典命中；char = 汉字但词典无此词（单字回退）；other = 标点、数字、拉丁字母、空白。
(function () {
  const CJK = /[一-鿿]/;
  function isCjk(ch) { return CJK.test(ch); }
  function maxWordLen(dict) {
    let m = 1;
    for (const w of Object.keys(dict)) if (w.length > m) m = w.length;
    return m;
  }
  const lenCache = new WeakMap();
  function segment(text, dict, charMap) {
    if (typeof text !== 'string') return [];
    dict = dict || {};
    let maxLen = lenCache.get(dict);
    if (!maxLen) { maxLen = maxWordLen(dict); lenCache.set(dict, maxLen); }
    const out = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (!isCjk(ch)) {
        // 合并连续的非汉字
        let j = i + 1;
        while (j < text.length && !isCjk(text[j])) j++;
        out.push({ t: text.slice(i, j), kind: 'other' });
        i = j;
        continue;
      }
      let hit = null;
      for (let len = Math.min(maxLen, text.length - i); len >= 1; len--) {
        const cand = text.slice(i, i + len);
        if (!isCjk(cand[len - 1])) continue;
        if (Object.prototype.hasOwnProperty.call(dict, cand)) { hit = cand; break; }
      }
      if (hit) {
        const e = dict[hit];
        out.push({ t: hit, kind: 'word', level: e.l, pinyin: e.p || pinyinByChars(hit, charMap) });
        i += hit.length;
      } else {
        out.push({ t: ch, kind: 'char', pinyin: pinyinByChars(ch, charMap) });
        i += 1;
      }
    }
    return out;
  }
  function pinyinByChars(s, charMap) {
    if (!charMap) return '';
    const parts = [];
    for (const ch of s) parts.push(charMap[ch] || '');
    return parts.every(Boolean) ? parts.join('') : parts.filter(Boolean).join('');
  }
  // 把 token 拆成单字（用于用户手动拆分词块）
  function split(token, charMap) {
    return Array.from(token.t).map(ch => ({ t: ch, kind: isCjk(ch) ? 'char' : 'other', pinyin: isCjk(ch) ? pinyinByChars(ch, charMap) : undefined }));
  }
  // 合并相邻 token（用户手动合并词块）；合并后若词典命中则恢复 word 信息
  function merge(tokens, dict, charMap) {
    const t = tokens.map(x => x.t).join('');
    if (dict && Object.prototype.hasOwnProperty.call(dict, t)) {
      const e = dict[t];
      return { t, kind: 'word', level: e.l, pinyin: e.p || pinyinByChars(t, charMap) };
    }
    const allCjk = Array.from(t).every(isCjk);
    return { t, kind: allCjk ? 'char' : 'other', pinyin: allCjk ? pinyinByChars(t, charMap) : undefined };
  }
  const api = { segment, split, merge, pinyinByChars, isCjk, maxWordLen };
  globalThis.CnSegment = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
