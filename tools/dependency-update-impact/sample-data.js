'use strict';
// 合成示例:包名与版本均为虚构组合,仅用于演示,不对应任何真实项目的升级记录。
(function () {
  const oldPkg = {
    name: 'demo-shop',
    version: '1.4.0',
    dependencies: {
      react: '^18.2.0',
      'react-dom': '^18.2.0',
      express: '^4.18.2',
      axios: '^1.6.0',
      zod: '^3.22.0',
      lodash: '^4.17.20',
      dayjs: '^1.11.9',
      uuid: '^9.0.0',
      pino: '^8.15.0',
      moment: '^2.29.4',
      chalk: '^5.3.0',
      cors: '^2.8.5',
      'internal-ui': 'git+https://example.com/team/internal-ui.git#v1.2.0',
      typescript: '^5.2.0',
    },
    devDependencies: {
      vite: '^5.0.0',
      typescript: '^5.2.0',
      vitest: '^1.0.0',
      eslint: '^8.57.0',
      prettier: '^3.2.0',
      '@types/node': '^20.10.0',
      '@types/express': '^4.17.21',
      tsx: '^4.7.0',
    },
  };
  const newPkg = {
    name: 'demo-shop',
    version: '1.5.0',
    dependencies: {
      react: '^19.0.0',
      'react-dom': '^19.0.0',
      express: '^4.19.0',
      axios: '^1.7.0',
      zod: '^3.23.0',
      lodash: '^4.17.21',
      dayjs: '^1.11.10',
      uuid: '^9.0.1',
      pino: '^8.15.3',
      nanoid: '^5.0.0',
      chalk: '^4.1.2',
      cors: '2.8.5',
      'internal-ui': 'git+https://example.com/team/internal-ui.git#v1.3.0',
      typescript: '^5.2.0',
    },
    devDependencies: {
      vite: '^6.0.0-beta.2',
      typescript: '^5.2.0',
      vitest: '^1.0.0',
      eslint: '^8.57.0',
      prettier: '^3.2.0',
      '@types/node': '^20.10.0',
      '@types/express': '^4.17.21',
      tsx: '^4.7.0',
    },
  };

  const pair = JSON.stringify(oldPkg, null, 2) + '\n\n' + JSON.stringify(newPkg, null, 2) + '\n';

  const diff = [
    'diff --git a/package.json b/package.json',
    'index 3f2a1b0..9c8d7e6 100644',
    '--- a/package.json',
    '+++ b/package.json',
    '@@ -8,9 +8,10 @@ "dependencies": {',
    '     "axios": "^1.6.0",',
    '-    "express": "^4.18.2",',
    '+    "express": "^4.19.0",',
    '-    "react": "^18.2.0",',
    '-    "react-dom": "^18.2.0",',
    '+    "react": "^19.0.0",',
    '+    "react-dom": "^19.0.0",',
    '-    "moment": "^2.29.4",',
    '+    "nanoid": "^5.0.0",',
    '     "zod": "^3.22.0"',
    '   },',
    '   "devDependencies": {',
    '-    "vite": "^5.0.0",',
    '+    "vite": "^6.0.0-beta.2",',
    '-    "tsx": "^4.7.0"',
    '+    "tsx": "^4.6.0"',
    '   }',
    '',
  ].join('\n');

  const outdated = [
    'Package        Current  Wanted  Latest  Location                    Depended by',
    'axios          1.6.0    1.7.9   1.7.9   node_modules/axios          demo-shop',
    'express        4.18.2   4.21.2  5.0.1   node_modules/express        demo-shop',
    'lodash         4.17.20  4.17.21 4.17.21 node_modules/lodash         demo-shop',
    'react          18.2.0   18.3.1  19.0.0  node_modules/react          demo-shop',
    'typescript     5.2.2    5.2.2   5.7.2   node_modules/typescript     demo-shop',
    'vitest         1.0.4    1.6.0   2.1.8   node_modules/vitest         demo-shop',
    '',
  ].join('\n');

  const api = { pair, diff, outdated, oldPkg, newPkg };
  globalThis.DepImpactSample = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
