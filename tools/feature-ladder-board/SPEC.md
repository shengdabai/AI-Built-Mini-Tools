# SPEC · 31 功能阶梯取舍板


## 核心任务(必须跑通)

1. 项目与功能录入:功能名、一句话用户任务(谁在什么情境完成什么)、所属门(1 自用 / 2 他人可用 / 3 付费)、MoSCoW(Must/Should/Could/Won't)、预计小时、依赖功能、验证层(单测/集成/E2E/截图/真实依赖)、状态(未做/做中/已做/已砍)。
2. 规则检查(每条带功能名):
   - 阻断:Must > 7;Must 没有验证层;门 1 阶段出现「登录」「支付」「数据库」「服务端」关键词的功能(用户可改关键词表);依赖环;依赖了「已砍」或「Won't」功能;
   - 警告:Won't 为空(没有真实取舍);Could 多于 Must + Should;单功能 > 16 小时(建议拆);门 3 功能早于门 2 功能排期;
3. 阶梯视图:按门分三列,列内按 MoSCoW 分组;拖拽改门/等级(可用上下按钮替代拖拽);每列显示合计小时。
5. 导出:PRD 片段 Markdown(Must 清单 + 验证层 + Won't);功能表 CSV;JSON 备份。

## 不做

不估工期、不做甘特图、不联网。

## core.js 暴露

`validateFeature`;`check(project)` → `{issues, stats}`;`detectCycle(features)`;`ladder(features)`;`gateStatus(project)`;`move(feature, gate, moscow)`;`toPrdMarkdown`;`toCsv`;`validateImport`。

## 示例

合成一个「课后反馈工具」项目 16 个功能,含:Must 8 个(触发阻断)、门 1 里有「微信登录」、一个依赖环、Won't 为空、一个 24 小时功能;标注「合成示例」。

## 测试点(≥ 12)

Must 上限;验证层缺失;门 1 关键词(可配);依赖环(含自依赖);依赖已砍;Won't 为空;Could 过多;单功能工时;门顺序;gateStatus 三门;move 改变后重算;PRD Markdown 结构;CSV 公式防护;validateImport 枚举。

## 视觉方向

看板感:浅灰底 + 深蓝;三列;手机端三列变纵向分段。

## 已知限制(写进 README)

