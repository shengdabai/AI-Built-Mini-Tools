# 依赖更新影响说明

## 定位
升级依赖前,把新旧 package.json、`git diff package.json` 或 `npm outdated` 贴进来,得到按 semver 分级的影响说明与测试建议清单,可直接贴进 PR 描述。纯前端,双击 index.html 即可使用,无联网、无登录、无支付、无埋点。

## 目标用户
小型开发团队、独立开发者;设想的付款人是技术负责人。

## 核心任务
1. 粘贴输入,自动识别三种格式。
2. 解析新增、移除、升级、降级;升级按 major / minor / patch / 预发布 / 非 semver 分类;范围符号(^、~、>=)变化单独列出并解释。
3. 每项给出确定性模板的影响说明;同一个包同时出现在 dependencies 与 devDependencies、写死版本与范围互相切换会提示。
4. 对 major 升级的包列出通用检查清单(接口签名、配置项、Node 版本要求等)。
5. 导出 Markdown 影响说明与 CSV 变更表。

## 如何打开
双击 `index.html`。第一步:点「载入合成示例:两份 package.json」立刻看到效果,或把自己的内容粘贴进输入框再点「分析依赖变化」。

## 功能说明
- 输入识别:两份 package.json(依次粘贴)、git diff、npm outdated(默认以 Latest 为目标版本)。
- JSON 出错时指出是旧文件还是新文件,以及第几行第几列。
- 输入改动后,结果标记为过期,导出按钮停用,重新分析后恢复。
- 本地存储键 `depimpact.v1`;写入失败时显示持续可见的「未保存」提示并引导导出。
- 导出防公式注入:以 = + - @ 开头的字段加单引号前缀(单独的 + 或 - 不算)。因此 CSV 里 `@scope/pkg` 形式的包名会带前导单引号;Markdown 表格里包名放在反引号内,不受影响。
- 「清空输入框和分析结果」、三个合成示例按钮、「从 TXT 文件载入输入」都使用页内确认,不用 confirm()。判据是:输入框有内容,或 npm outdated 目标列偏离默认(Wanted)。确认文案写明会被替换的行数、字符数和设置。
- 防公式注入会先跳过前导空白、制表符等控制字符,再判断首个字符是否为 = + - @。
- 无前缀的通配写法(1.2.x、1.2)与固定版本视为不同的范围类型,`1.2.x → 1.2.0` 会报范围变化。
- 依赖移动区块的同时升级 major,仍按 major 分类并进入测试建议清单,区块移动作为附注。

## 文件
index.html / styles.css / core.js / app.js / sample-data.js / tests/core.test.cjs / shots.cjs / showcase.html。

## 口径
- 比较基准:两份 package.json 为「旧文件 → 新文件」;git diff 为「- 行 → + 行」;npm outdated 默认「Current → Latest」,可在输入区切换为「Current → Wanted」。Latest 是 registry 上的最新发布版本(可能跨 major),Wanted 是在 package.json 现有范围内能装到的最高版本。结果上方和导出的 Markdown 都写明所用基准。
- 「共 N 项变化」按包计数,每个包算一项;「需要重点关注」是 major、降级、预发布、非 semver、重复声明、移动区块的合计。没有检测到变化时,会写明是「两边完全相同或没有依赖行」。
- 逐包测试清单只为 major 升级生成;没有 major 时页面写「本工具仅为 major 升级生成逐包清单;其余变化请结合上方提示自行检查」。
- 输入改动、或切换目标列后,旧结果标记过期,导出与复制停用,重新分析后恢复。输入与示例文本完全相同才显示「合成示例」标记(刷新后仍在,导出的 Markdown 与 CSV 也标注);改动后消失。
- 保存失败面板里的「下载输入框里的全部原始内容 TXT」始终可用;「从 TXT 文件载入输入」可把它读回来(空白、含空字符、超过 500000 个字符的文件整份拒绝,不截断)。
- 本产品没有 JSON 备份:要保留的只有输入文本,所以用 TXT 下载/载入代替。没有逐条记录,因此没有「删除单条」操作。
- 安全核对(2026-10-20):`app.js` 全部用 `textContent` / `createElement` 渲染,没有 `innerHTML` 拼接。

## 已知限制
- 不联网,不读 registry 或 CHANGELOG;建议是通用模板,不代表具体包的真实变更。
- 不分析代码对依赖的引用。
- 只支持 npm 的 package.json;不处理 yarn / pnpm 的 lockfile。
- git diff 若片段里看不到区块标题(如 `"devDependencies": {`),依赖会归入「未识别区块」,且无法检测重复声明。
- npm outdated 输出不含范围符号,所以不会有范围变化提示。
- 复合范围(`||`、空格分隔)、git 地址、workspace: 等一律归为「非 semver」,不比较大小。
- 暂无浏览器自带的自动复制保证:复制失败时会选中文本请手动复制。

## 验证记录
- 核验日期:2026-10-20。
- `node --test tests/core.test.cjs`:28 个用例全部通过(第五轮新增 5 个:比较基准、无 major 文案、示例标注与 CSV 列、输入范围判断、文件检查;改动前先跑红再修)。
- `node shots.cjs`:退出码 0,55 条断言(新增:比较基准与 Wanted 切换、目标列刷新后保留、示例标记持续可见及导出标注、仅改目标列设置也要确认、清空确认写明范围、错误贴近输入框并聚焦、无 major 文案、TXT 文件载入确认与拒绝、保存失败面板下载原始输入、手机端 radio 尺寸),桌面 1440 与手机 390 的 scrollWidth 均不超出,无 console error / pageerror。
- 截图见 `screenshots/` 与 `showcase.png`。
