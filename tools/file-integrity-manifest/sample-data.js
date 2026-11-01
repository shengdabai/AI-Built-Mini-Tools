'use strict';
/* 合成示例:路径、大小、哈希均为虚构(哈希由路径文本推算),不对应任何真实文件。 */
(function () {
  const C = globalThis.FileCheckCore;
  const h = text => new C.Sha256().update(new TextEncoder().encode(text)).digest();
  const spec = [
    ['README.md', 2140], ['设计稿/home.fig', 8423112], ['设计稿/about.fig', 5120044], ['素材/logo.svg', 9876],
    ['素材/banner.png', 1843200], ['素材/Cover.png', 920311], ['素材/图标:最终版.png', 40960], ['课程/第1课.pdf', 3211000],
    ['课程/第2课.pdf', 2874512], ['课程/第3课.pdf', 3050001], ['视频/intro.mp4', 41230980], ['视频/lesson1.mp4', 88123400],
    ['视频/lesson2.mp4', 90210033], ['字体/Brand-Regular.ttf', 312044], ['授权/license.txt', 1288]
  ];
  const mtime = '2026-10-12T09:30:00.000Z';
  const manifest = C.buildManifest(spec.map(([path, size]) => ({ path, size, sha256: h('合成示例:' + path), mtime })), { generatedAt: '2026-10-12', sample: '合成示例:路径、大小、哈希均为虚构,不对应任何真实文件' });
  const actual = [];
  for (const [path, size] of spec) {
    if (path === '视频/lesson1.mp4' || path === '视频/lesson2.mp4') continue;
    if (path === '素材/Cover.png') { actual.push({ path: '素材/cover.png', size, sha256: h('合成示例:' + path), mtime }); continue; }
    if (path === '课程/第2课.pdf') { actual.push({ path, size, sha256: h('合成示例:被改动的' + path), mtime }); continue; }
    actual.push({ path, size, sha256: h('合成示例:' + path), mtime });
  }
  actual.push({ path: '备份/草稿.txt', size: 530, sha256: h('合成示例:备份/草稿.txt'), mtime });
  actual.push({ path: '.DS_Store', size: 6148, sha256: h('合成示例:.DS_Store'), mtime });
  globalThis.FILECHECK_SAMPLE = { label: '合成示例', manifestName: '示例清单(合成).json', manifest, actual };
  if (typeof module !== 'undefined') module.exports = globalThis.FILECHECK_SAMPLE;
})();
