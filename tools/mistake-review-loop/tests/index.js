// Node ≥ 21 的 `node --test tests/` 不再展开目录，而是把目录当模块加载（解析到本文件）。
// 这里转载真正的测试文件，使规范要求的命令在新旧 Node 上都能跑。
require('./core.test.cjs');
