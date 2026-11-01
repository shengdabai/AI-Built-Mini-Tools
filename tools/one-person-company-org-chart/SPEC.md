# SPEC · 46 一人公司组织图

目标用户:用 AI Agent 当员工的个人创业者;付款人:本人。

## 核心任务(必须跑通)

1. 节点录入:岗位名、职责(一句)、输入(从谁来)、输出(给谁)、触发(手动 / 定时 cron 文本 / 事件)、状态(设想 / 已配置 / 在跑 / 停用)、人工干预点(勾选:审批 / 校对 / 付款 / 无)、上级节点、在跑起始日(可选)。
2. 组织图:运行时生成树(div/SVG 连线),根节点是「我」;按状态着色;悬停显示职责与干预点;折叠/展开子树;手机端纵向缩进列表。
3. 自动化度:统计「在跑」节点数、含人工干预点的节点占比、每周人工干预次数估计(用户填);给出「下一个可去掉的干预点」(规则:干预类型为「校对」且节点已在跑 ≥ 30 天 → 候选)。
4. 数据流检查:输出没有接收方 → 警告「产出没人用」;输入来源不存在 → 阻断;环路(A 输出给 B,B 输出给 A)→ 提示但允许。
5. 生成 Markdown 骨架:为每个节点生成一个 `<岗位>/AGENT.md` 文本(职责 / 输入 / 输出 / 触发 / 干预点 / 验收),打包成一个 Markdown 文档(按目录树缩进),可复制、可下载 `.md`。
6. 导出:组织图 SVG、节点 CSV、JSON 备份;导入校验(上级存在、无自指、状态枚举)。

## 不做

不连接任何 Agent 运行时、不执行 cron、不读本机文件。

## core.js 暴露

`buildTree(nodes)` → 树或 `{error}`;`layout(tree)` → 坐标;`automationStats(nodes)`;`nextInterventionToRemove(nodes, today)`;`flowIssues(nodes)`;`toAgentMarkdown(nodes)`;`toSvg`;`toCsv`;`validateImport`;`?today`。

## 示例

合成 12 节点(根 + 4 个部门 + 7 个 Agent):我 → 内容部(写作 Agent、校对 Agent、发布 Agent)、运营部(回复 Agent、周报 Agent)、财务(记账 Agent,干预点付款)、研发(更新检查 Agent 定时 8:00);含一个「产出没人用」和一个环路;标注「合成示例,不是真实配置」。

## 测试点(≥ 12)

buildTree 根唯一;上级不存在拒绝;自指拒绝;layout 无重叠(同层 x 递增);automationStats 占比;nextInterventionToRemove 30 天规则;flowIssues 三种;toAgentMarkdown 每节点一段且目录缩进;toSvg 节点数;CSV 公式防护;状态枚举校验;`?today`;写读校验同源。

## 视觉方向

白 + 深灰连线,状态四色 token;根节点突出;手机端列表。

## 已知限制(写进 README)

只是设计图与骨架,不运行;干预次数自填。
