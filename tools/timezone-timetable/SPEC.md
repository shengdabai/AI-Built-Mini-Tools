# SPEC · 14 跨时区课表核对


## 核心任务(必须跑通)

1. 维护学员/对象:姓名、IANA 时区(下拉,列表用 `Intl.supportedValuesOf('timeZone')`,不可用时回退内置 60 个常用时区)。
2. 录入每周固定课表(教师本地时区):星期、开始时间、时长、学员;支持「某日例外」(取消/改时间)。
3. 生成对照表:选一个周(默认本周,`?today` 可固定)→ 每节课显示教师本地时间与学员本地时间(用 `Intl.DateTimeFormat` 以具体日期计算,正确处理夏令时);跨日用「次日/前一日」标注。
4. 夏令时切换提醒:对每个学员时区,计算本周与下周同一课的学员本地时间是否变化;变化则在该学员卡上标「切换周:学员本地时间从 X 变 Y」;另列出未来 60 天内所有切换日期。
5. 导出:本周对照表 Markdown(可直接发学员,每人一段);ICS 文件(教师时区的 VEVENT,带 TZID,学员名在 SUMMARY);JSON 备份导入。

## 不做

不接日历 API、不发消息;时区数据版本以浏览器为准(README 写明)。

## core.js 暴露

`localTimeIn(dateISO, timeHHMM, fromTz, toTz)` → `{date, time, dayOffset}`;`weekSchedule(rules, exceptions, weekStartISO, teacherTz)`;`dstTransitions(tz, fromISO, days)`;`switchWarnings(schedule, nextWeekSchedule)`;`toMarkdown(...)`;`toIcs(...)`;`validateImport(json)`。时区计算必须用 `Intl.DateTimeFormat(...).formatToParts`,不要自己写偏移表。

## 示例

合成 4 位学员(America/New_York、Europe/London、Australia/Sydney、Asia/Tokyo)与 6 节周课;`?today=2026-10-26`(英国 10-25 结束夏令时、美国 11-01 结束)用于演示切换周;标注「合成示例」。

## 测试点(≥ 12)

localTimeIn 跨日(次日/前一日);夏令时前后同一本地时间的目标时间不同;dstTransitions 对 London 2026-10-25、New_York 2026-11-01 命中,Tokyo 无切换;switchWarnings 命中;例外覆盖;weekSchedule 按星期生成日期;ICS 格式(BEGIN/END、TZID、DTSTART 本地格式);Markdown 每人一段;validateImport 拒绝非法时区;`?today` 非法回退;空课表不报错。

## 视觉方向

日历感:浅灰底 + 深蓝,每节课一条双时间卡;切换周用琥珀标签;手机端单列。

## 已知限制(写进 README)

依赖浏览器 Intl 时区数据;ICS 只含教师时区事件;不处理历史时区规则变更。
