'use strict';
// 合成示例:22 条虚构提交,不来自任何真实仓库。三种 git log 格式由同一份数据生成。
(function () {
  const AUTHOR = 'Synthetic Dev';
  const COMMITS = [
    { s: 'feat(editor)!: replace plugin API with v2 hooks (#142)', d: 'Mon Oct 19 17:20:11 2026 +0800' },
    { s: 'feat(editor): add split view for side-by-side editing', d: 'Mon Oct 19 15:02:43 2026 +0800' },
    { s: 'feat(export): support exporting to PDF (#118)', d: 'Mon Oct 19 11:48:09 2026 +0800' },
    { s: 'fix(export): keep line breaks when exporting plain text (#123)', d: 'Sun Oct 18 20:31:55 2026 +0800' },
    { s: 'fix(sync): retry failed uploads after reconnect', d: 'Sun Oct 18 16:12:30 2026 +0800' },
    { s: 'fix: crash when opening an empty project.', d: 'Sun Oct 18 10:05:02 2026 +0800' },
    { s: 'perf(search): index titles lazily to speed up first open', d: 'Sat Oct 17 19:44:18 2026 +0800' },
    { s: 'perf(render): cache parsed markdown blocks', d: 'Sat Oct 17 14:20:51 2026 +0800' },
    { s: 'Merge pull request #131 from example/split-view', d: 'Sat Oct 17 09:15:00 2026 +0800', merge: true },
    { s: "Merge branch 'main' into feature/export", d: 'Fri Oct 16 18:40:27 2026 +0800', merge: true },
    { s: 'docs: add keyboard shortcut cheat sheet', d: 'Fri Oct 16 15:33:12 2026 +0800' },
    { s: 'docs(readme): update install steps.', d: 'Fri Oct 16 12:10:44 2026 +0800' },
    { s: 'chore(deps): bump markdown parser to 4.2.0', d: 'Thu Oct 15 21:02:19 2026 +0800' },
    { s: 'chore: tidy lint config', d: 'Thu Oct 15 17:25:38 2026 +0800' },
    { s: 'refactor(config): rename config file to app.toml', d: 'Thu Oct 15 13:50:06 2026 +0800',
      body: 'BREAKING CHANGE: config.json is no longer read. Rename it to app.toml\nand move the "theme" key under [ui].\n\nCo-authored-by: Synthetic Dev B <dev-b@example.com>' },
    { s: 'refactor(sync): split queue into small modules', d: 'Wed Oct 14 20:18:47 2026 +0800' },
    { s: 'feat(settings): add dark theme toggle', d: 'Wed Oct 14 16:41:03 2026 +0800' },
    { s: 'fix(settings): remember window size between launches', d: 'Wed Oct 14 11:27:35 2026 +0800' },
    { s: 'update readme typo', d: 'Tue Oct 13 22:09:58 2026 +0800' },
    { s: 'wip: try new layout', d: 'Tue Oct 13 18:36:21 2026 +0800' },
    { s: 'test(core): cover empty project case', d: 'Tue Oct 13 14:03:40 2026 +0800' },
    { s: 'ci: run tests on every push', d: 'Mon Oct 12 10:52:16 2026 +0800' }
  ].map((c, i) => ({
    sha: (0x1a2b3c4 + i * 0x3a7f1).toString(16).padStart(7, '0').slice(-7),
    subject: c.s, body: c.body || '', author: AUTHOR, date: c.d, merge: !!c.merge
  }));

  const oneline = COMMITS.map(c => `${c.sha} ${c.subject}`).join('\n') + '\n';
  const pretty = COMMITS.map(c => `${c.sha}|${c.subject}|${c.author}|${c.date}`).join('\n') + '\n';
  const raw = COMMITS.map(c => {
    const head = [`commit ${c.sha}${c.sha.length === 7 ? '0123456789abcdef0123456789abcdef0' : ''}`];
    if (c.merge) head.push('Merge: 1111111 2222222');
    head.push(`Author: ${c.author} <dev@example.com>`, `Date:   ${c.date}`, '');
    const msg = [c.subject];
    if (c.body) msg.push('', ...c.body.split('\n'));
    return head.concat(msg.map(l => (l ? '    ' + l : ''))).join('\n') + '\n';
  }).join('\n');

  globalThis.RELEASE_SAMPLE = {
    label: '合成示例,非真实仓库',
    repoUrl: 'https://github.com/example/demo-app',
    current: '1.4.2',
    count: COMMITS.length,
    texts: { oneline, pretty, raw }
  };
  if (typeof module !== 'undefined') module.exports = globalThis.RELEASE_SAMPLE;
})();
