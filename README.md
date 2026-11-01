# ai-built-mini-tools

**58 small, offline, zero-backend browser tools, each built with AI coding agents (Claude Code and Codex) from a written spec, with unit tests and a scripted browser check.**

Open any `tools/<name>/index.html` by double-clicking it, or try them online: **[https://shengdabai.github.io/ai-built-mini-tools/](https://shengdabai.github.io/ai-built-mini-tools/)**

No login, no server, no tracking, no network requests. Data stays in your browser's `localStorage`. Most tools export and import JSON backups; each tool's `README.md` lists its export formats and limits. The interfaces are in Simplified Chinese.

## Why this exists

These tools are the output of an experiment: how far can one person get by writing a one-page spec and letting AI agents build, test and review a narrow tool? Most folders keep the evidence of that process (a few early tools have no `SPEC.md`), so you can copy the method, not only the code:

- `SPEC.md` — the brief the agent built from: user, core tasks, rules, edge cases.
- `core.js` — pure logic with no DOM access, so it can be unit-tested in Node.
- `tests/` — `node --test` unit tests for `core.js`.
- `shots.cjs` — a Playwright script that drives the real page (load sample → main flow → export → clear), fails on any console error, checks there is no horizontal overflow on desktop and phone widths, and saves screenshots.
- `README.md` — behaviour notes, known limits and the verification log.

Across the collection there are about 1,701 test cases.

## Tools

### AI usage · AI 使用

| Tool | What it does | Try |
|---|---|---|
| [AI Answer Checklist](tools/ai-answer-checklist/) | Split an AI answer into claims, verify each one, then decide whether it can be quoted. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/ai-answer-checklist/) |
| [AI Prompt Spec Builder](tools/ai-prompt-spec-builder/) | Five steps to a prompt with constraints and acceptance criteria, plus an "ask first" variant. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/ai-prompt-spec-builder/) |
| [AI Subscription Ledger](tools/ai-subscription-ledger/) | Monthly AI subscription cost next to the hour-equivalents of work done with it. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/ai-subscription-ledger/) |
| [One-Person Company Org Chart](tools/one-person-company-org-chart/) | Draw your AI-agent "staff" as an org tree; each role is a folder plus an AGENT.md. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/one-person-company-org-chart/) |
| [Agent Delegation Card](tools/agent-delegation-card/) | Write the boundary before handing a task to an AI agent, then record the net minutes saved. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/agent-delegation-card/) |
| [Adversarial Prompt Forge](tools/adversarial-prompt-forge/) | Build "sparring partner" prompts and practise judging AI output quality. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/adversarial-prompt-forge/) |
| [AI Task Effort Ledger](tools/ai-task-effort-ledger/) | Per-task human time, rework, API cost and acceptance result for AI-assisted work. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/ai-task-effort-ledger/) |

### Teaching & learning · 教学与学习

| Tool | What it does | Try |
|---|---|---|
| [HSK Level Checker](tools/hsk-level-checker/) | Colour each word of a Chinese text by HSK level, list words above the target level, rewrite and re-check. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/hsk-level-checker/) |
| [Lesson Billing Reconciler](tools/lesson-billing-reconciler/) | One-to-one lesson ledger: attendance, cancellations, package usage and payments become a monthly statement per student. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/lesson-billing-reconciler/) |
| [Trial Lesson Pipeline](tools/trial-lesson-pipeline/) | Inquiry → trial → paid funnel board for independent teachers. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/trial-lesson-pipeline/) |
| [Four-Layer Gloss Cards](tools/four-layer-gloss-cards/) | Chinese / Pinyin / word-by-word / English interlinear lesson cards. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/four-layer-gloss-cards/) |
| [Cross-Timezone Timetable](tools/timezone-timetable/) | Convert a weekly teaching timetable into each student's local time and flag daylight-saving switch weeks. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/timezone-timetable/) |
| [Rubric Feedback](tools/rubric-feedback/) | Teacher-defined rubric levels assembled into complete written feedback from templates. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/rubric-feedback/) |
| [Quiz Bank Checker](tools/quiz-bank-checker/) | Deterministic QA for multiple-choice banks: out-of-range answers, duplicates, answer-letter imbalance, seeded shuffle. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/quiz-bank-checker/) |
| [Paragraph Reader](tools/paragraph-reader/) | Show one paragraph at a time; record dwell time, unknown words with context, and objections. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/paragraph-reader/) |
| [Mistake Review Loop](tools/mistake-review-loop/) | Teachers log students' real mistakes; students review only the items due today. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/mistake-review-loop/) |

### Business data · 业务数据核对

| Tool | What it does | Try |
|---|---|---|
| [Shopify CSV Pre-check](tools/shopify-csv-precheck/) | Find the rows in a Shopify product CSV that would fail or be skipped on import. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/shopify-csv-precheck/) |
| [Invoice vs Order Diff](tools/invoice-order-diff/) | Match orders to invoices by order number and list blocking / warning differences with source row numbers. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/invoice-order-diff/) |
| [Multi-Sheet Dedupe](tools/multi-sheet-dedupe/) | Normalise phone, email, name and company across up to five sheets and cluster records of the same person. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/multi-sheet-dedupe/) |
| [Receivables Follow-up](tools/receivables-followup/) | Ageing buckets, who to chase today, and copy-ready reminder drafts. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/receivables-followup/) |
| [Quote Version Diff](tools/quote-version-diff/) | Compare two quote sheets by item code and write a client-facing change note. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/quote-version-diff/) |
| [Inventory Anomaly Check](tools/inventory-anomaly-check/) | Opening + in − out = closing for every row; negative stock, duplicate SKUs, mixed units, below safety stock. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/inventory-anomaly-check/) |
| [Unit Price Compare](tools/unit-price-compare/) | Convert box / bag / drum quotes to one base unit and compare suppliers. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/unit-price-compare/) |
| [Project Margin Sheet](tools/project-margin-sheet/) | Gross margin, margin rate, margin per hour and expected payment date for each project. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/project-margin-sheet/) |

### Productivity · 效率

| Tool | What it does | Try |
|---|---|---|
| [Template Batch Fill](tools/template-batch-fill/) | A `{{field}}` template plus a CSV / TSV table becomes merged text, a zip or a CSV. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/template-batch-fill/) |
| [Notice Reply Tracker](tools/notice-reply-tracker/) | Paste a member list and group-chat replies: who replied, who did not, which nicknames did not match. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/notice-reply-tracker/) |
| [Local Notes Search](tools/local-notes-search/) | In-browser full-text search over a folder of `.md` / `.txt` notes; nothing leaves the page. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/local-notes-search/) |
| [Serial / Parallel Planner](tools/serial-parallel-planner/) | Split tasks into "needs me" and "runs by itself" lanes; Gantt chart and time saved. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/serial-parallel-planner/) |
| [Commitment Extractor](tools/commitment-extractor/) | Turn "I'll send it by Friday" lines from chats and minutes into a follow-up list with calendar export. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/commitment-extractor/) |

### Developer · 开发者

| Tool | What it does | Try |
|---|---|---|
| [Release Notes Helper](tools/release-notes-helper/) | Paste `git log`, get release notes and a CHANGELOG section by Conventional Commits, plus a semver suggestion. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/release-notes-helper/) |
| [Dependency Update Impact](tools/dependency-update-impact/) | Paste old / new `package.json` or `npm outdated` and get an impact summary before upgrading. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/dependency-update-impact/) |
| [File Integrity Manifest](tools/file-integrity-manifest/) | Create a SHA-256 manifest for a folder, then verify missing, extra and changed files on receipt. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/file-integrity-manifest/) |
| [Regex Example Tester](tools/regex-example-tester/) | Write input + expected result first, then verify a regex case by case with groups and positions. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/regex-example-tester/) |
| [i18n Key Checker](tools/i18n-key-checker/) | Compare locale files: missing / extra keys, empty values, placeholder and HTML tag mismatches; export a to-translate sheet. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/i18n-key-checker/) |

### Content · 内容与翻译

| Tool | What it does | Try |
|---|---|---|
| [Subtitle Term Checker](tools/subtitle-term-checker/) | Check SRT / WebVTT against a glossary: wrong terms, case and width variants, timing problems. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/subtitle-term-checker/) |
| [Translation QA](tools/translation-qa/) | Mechanical consistency checks for bilingual drafts: omissions, placeholders, numbers, terms, length ratio. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/translation-qa/) |
| [UTM Link Pre-check](tools/utm-link-precheck/) | Batch-check UTM links, suggest normalised links, and build links from a parameter table. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/utm-link-precheck/) |
| [Chinese Typography Cleaner](tools/chinese-typography-cleaner/) | Normalise Chinese typography (CJK / Latin spacing, full-width punctuation, quotes, ellipses) with a line-by-line diff. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/chinese-typography-cleaner/) |
| [Writing Resale Ledger](tools/writing-resale-ledger/) | Record the hours spent on each piece of writing and every time it is sold again. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/writing-resale-ledger/) |

### Thinking · 思考与决策

| Tool | What it does | Try |
|---|---|---|
| [Evidence Ledger](tools/evidence-ledger/) | Claim – evidence – counter-evidence ledger for personal research. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/evidence-ledger/) |
| [Concept Card Library](tools/concept-card-library/) | One card per concept: definition, counter-example, questions it answers, two-way links, source and status. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/concept-card-library/) |
| [Cause–Effect Chain](tools/cause-effect-chain/) | Build a "because → so → then" chain to review an event calmly. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/cause-effect-chain/) |
| [Hype Buster Cards](tools/hype-buster-cards/) | Critical-thinking cards for testing AI hype claims against expertise > tools > tricks. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/hype-buster-cards/) |
| [Decision Review Workbench](tools/decision-review-workbench/) | Keep predictions and later reviews apart; Brier score for reviewed binary forecasts. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/decision-review-workbench/) |

### Product · 产品取舍

| Tool | What it does | Try |
|---|---|---|
| [Feature Ladder Board](tools/feature-ladder-board/) | Place features on three gates (self-use / others can use / paid) and let rules force you to cut. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/feature-ladder-board/) |
| [JTBD Statement Board](tools/jtbd-statement-board/) | Write and check Jobs-to-be-Done statements. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/jtbd-statement-board/) |

### Personal growth · 个人成长

| Tool | What it does | Try |
|---|---|---|
| [Résumé vs Job Description](tools/resume-jd-matcher/) | Check which job-description keywords your résumé covers and list the number claims you must be able to prove. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/resume-jd-matcher/) |
| [Rule-Based Practice Ledger](tools/rule-based-practice-ledger/) | Track any fixed-rule, long-term practice (investing, writing, exercise); missed days are reconciled automatically. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/rule-based-practice-ledger/) |
| [Selling-Time Calculator](tools/selling-time-calculator/) | Compare three ways to sell time: sell it once, sell the same hours many times, or buy other people's time. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/selling-time-calculator/) |
| [Attention Ledger](tools/attention-ledger/) | Log your day in time blocks and see whether your best hours go to producing, learning or consuming. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/attention-ledger/) |
| [Compound Growth Simulator](tools/compound-growth-simulator/) | Daily growth rate, duration, rest days and setbacks drawn as a curve against linear growth. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/compound-growth-simulator/) |
| [Multi-Dimension Radar](tools/multi-dimension-radar/) | Competitiveness drawn as the area across several dimensions, not a single ranking. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/multi-dimension-radar/) |
| [Half-Second Script Practice](tools/half-second-script-practice/) | Read a one-line present-tense script aloud for 5 seconds, count practice, and log triggers. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/half-second-script-practice/) |
| [DCA Endurance Simulator](tools/dca-endurance-simulator/) | On synthetic prices, compare never stopping, pausing at −30 % and selling at −30 %. A maths demo, not investment advice. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/dca-endurance-simulator/) |
| [Compound Wall](tools/compound-wall/) | Interactive wall of compounding numbers: small daily changes over a year. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/compound-wall/) |

### Everyday · 日常

| Tool | What it does | Try |
|---|---|---|
| [Recipe Scaler](tools/recipe-scaler/) | Scale a recipe by target yield or by one ingredient ("I only have 350 g of flour"). | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/recipe-scaler/) |
| [Group Order Summary](tools/group-order-summary/) | Paste a menu and chat replies to get dish counts, totals, per-person amounts and an order message. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/group-order-summary/) |
| [Timetable Wallpaper](tools/timetable-wallpaper/) | Enter a class timetable once and export lock-screen, desktop and tablet wallpapers. | [open](https://shengdabai.github.io/ai-built-mini-tools/tools/timetable-wallpaper/) |

## Run the tests

```bash
# unit tests for every tool (Node 20+)
./scripts/test-all.sh

# browser check for one tool (needs Playwright)
npm i -D playwright && npx playwright install chromium
cd tools/hsk-level-checker && node shots.cjs
```

`shots.cjs` uses Playwright's bundled Chromium. Set `CHROME_PATH` to use another Chromium binary.

## Honest notes

- These are working prototypes for one person's use, not maintained products. None has been validated with paying users.
- All sample data is synthetic. Names, phone numbers (`138 0000 xxxx`) and e-mail addresses (`example.com`) are made up.
- Several tools turn ideas from Li Xiaolai's public writing (compounding, selling time, attention, concept cards, the "half-second" scripts) into calculators. They are my interpretations, not his views, and he has not endorsed them.
- `tools/_data/hsk-words.js` is parsed from the published HSK syllabus word list; pinyin is generated by pypinyin and can be wrong for polyphonic words. See [`tools/_data/NOTICE.md`](tools/_data/NOTICE.md).

## 中文说明

58 个纯前端小工具：双击 `index.html` 即用，不联网、不登录、无后端、无埋点，数据只存在浏览器本地，多数工具可导出导入 JSON。每个工具都是先写 `SPEC.md`，再由 AI 编程 Agent（Claude Code 与 Codex）实现、写单元测试、用 Playwright 脚本操作真实页面验收。目录里保留了规格、测试和验证记录，方便你照着这套方法做自己的工具。

示例数据全部是合成的。部分工具把李笑来公开文章里的概念（复利、出售时间、注意力、概念卡片、半秒脚本）做成了可计算的小工具，是我的理解，不代表他本人观点。

## License

Code: MIT, see [LICENSE](LICENSE). Bundled third-party code: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The data files in `tools/_data/` are not covered by the MIT license; see [`tools/_data/NOTICE.md`](tools/_data/NOTICE.md).
