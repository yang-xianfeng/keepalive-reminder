# AGENTS.md - Keepalive Reminder AI 协作与维护指南

> **适用对象**：所有接入此仓库的 AI 编码助手（如 Cursor、Claude、Copilot、Antigravity 等）。  
> **核心目标**：协助仓库所有者（@yang-xianfeng）以**零维护负担、零外部依赖、极度健壮**的方式维护卡片与资产保活监控。

---

## 1. 项目定位与核心设计哲学

`keepalive-reminder` 是一个完全运行在 GitHub 内部的个人资产保活倒计时与提醒系统。

### 🚨 绝对红线与不可违背的原则
1. **零外部依赖（Zero External Dependencies）**：
   * 严禁引入任何第三方 npm 包（禁止 `npm install`、禁止引入 `package.json`、禁止引入 `axios`/`moment`/`dayjs`/`chalk`/`yaml` 等）。
   * 严禁引入任何 Python pip 依赖或编译构建链（如 Vite、Webpack、Babel）。
   * 核心检测脚本 `checker.js` 必须仅使用 Node.js 原生标准库（`node:fs`、`node:path`、`node:process`）。
   * 前端 `index.html` 必须保持纯原生单文件 HTML5 + CSS + JavaScript，无任何构建编译步骤。
2. **时区基准一致性（UTC+8 北京时间）**：
   * 所有涉及“今天”的计算，必须严格对齐 UTC+8（北京时间 CST）：
     ```javascript
     const cst = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
     ```
   * 日期格式严格为 `YYYY-MM-DD`。
3. **零外部配置的邮件告警机制（Exit Code 驱动）**：
   * 本项目不依赖任何外部 Webhook（不使用 Telegram、Bark、微信公众号等）。
   * **日常状态**：卡片状态健康时，`checker.js` 必须以 `process.exit(0)` 正常退出，GitHub Actions 成功通过，**绝不发送任何打扰邮件**。
   * **提醒状态**：当卡片剩余天数命中 `remind_days: [30, 7, 3]` 或已逾期（`remainingDays <= 0`）时，`checker.js` 必须以 `process.exit(1)` 失败退出。GitHub 将自动向用户的注册邮箱发送 Action 失败邮件，邮件中直连错误日志与卡片保活指引。
   * **警告**：AI 绝不能将告警分支的退出码改成 0，否则将导致邮件告警失效！

---

## 2. 数据结构规范 (`cards.json`)

所有被监控的资产配置全部保存在项目根目录的 [`cards.json`](cards.json) 中，格式如下：

```json
{
  "cards": [
    {
      "id": "hsbc_debit",
      "name": "汇丰香港蓝狮子扣账卡",
      "category": "银行借记卡",
      "last_used": "2026-05-29",
      "cycle_days": 180,
      "remind_days": [30, 7, 3],
      "guide": "微信/支付宝绑定该卡在内地日常消费一笔（任意小额），或在手机银行 App 内换汇/转账一次。",
      "policy": "官方规定连续12个月无交易冻结为沉睡不动户；建议每180天主动发生一笔账单交易（防范反洗钱动态画像抽检）。"
    },
    {
      "id": "esim_gg",
      "name": "esim.gg 全球漫游电话卡",
      "category": "境外eSIM卡",
      "last_used": "2026-09-05",
      "cycle_days": 365,
      "remind_days": [30, 7, 3],
      "guide": "开启 eSIM 数据漫游接入国内基站（移动/联通）完成联网握手；账户保持 ≥ 5 欧元余额防扣费中断。",
      "policy": "核心网计费系统（OCS）按年评估活跃度；账户有余额且每年产生至少一次基站信令附着即自动顺延一年。"
    }
  ]
}
```

### 字段合法性与约束
| 字段名 | 类型 | 必填 | 说明与约束 |
| :--- | :--- | :--- | :--- |
| `id` | `string` | 是 | 唯一英文标识，推荐 snake_case（如 `esim_gg`、`giffgaff_sim`） |
| `name` | `string` | 是 | 中文友好名称（如 `汇丰蓝狮子扣账卡`） |
| `category` | `string` | 是 | 资产类别（`银行卡` / `电话卡` / `域名` / `VPS` / `订阅`） |
| `last_used` | `string` | 是 | 严格为 `YYYY-MM-DD` 格式的最近一次保活激活日期 |
| `cycle_days` | `number` | 是 | 保活周期天数（如半年为 `180`，一年为 `365`） |
| `remind_days` | `number[]`| 是 | 提醒天数数组，默认固定为 `[30, 7, 3]`（提前30天、7天、3天） |
| `guide` | `string` | 是 | 简明扼要的操作实操方案，告诉用户收到提醒后具体如何去操作保活 |
| `policy` | `string` | 是 | 官方条例或社区防风控共识说明 |

---

## 3. 自动计算与旧提醒失效原理

* 目标到期日 = `last_used + cycle_days` 天。
* 剩余天数 = `目标到期日 - 今天(CST)`。
* **状态机重置**：只要用户（或 AI）将 `last_used` 改为操作当天的日期，剩余天数自动跃升回 `cycle_days`。原本 pending 的 7 天、3 天提醒自然跳过，无需维护额外的任务队列或标记位。

---

## 4. AI 维护标准操作作业流程 (SOP)

### SOP-1：用户请求更新某张卡的保活日期
> 示例：“我今天把蓝狮子刷了一笔，帮我更新一下” 或 “esim.gg 昨天联网了”

1. **读取数据**：读取 `cards.json`，定位对应的卡片条目。
2. **修改日期**：将 `last_used` 更新为用户指定的日期（若未明确指定则使用当天 CST 日期 `YYYY-MM-DD`）。
3. **本地验证**：在项目根目录下运行验证命令：
   ```bash
   node checker.js --test
   ```
   检查控制台表格中的剩余天数是否已经正确顺延，确认退出码为 0。
4. **提交与推送**：
   ```bash
   git add cards.json
   git commit -m "chore(cards): update <card_id> keepalive date to <YYYY-MM-DD>"
   git push origin main
   ```
5. **回复用户**：清晰告知更新后的新截止日期以及下一次触发提醒的日期（到期前 30 天）。

---

### SOP-2：用户请求新增一张卡片/资产
> 示例：“帮我添加一张英国 Giffgaff 手机卡”

1. **政策检索**：先通过联网搜索检索该卡最新的官方保活规则及社区实践（如 Giffgaff 要求 180 天内有一次消费，发一条短信即可）。
2. **编排条目**：
   * 设定合理的 `cycle_days`（如 180 天）；
   * `remind_days` 统一设置为 `[30, 7, 3]`；
   * 编写清晰明了的 `guide` 实操指南与 `policy` 政策说明。
3. **追加写入**：将新对象追加至 `cards.json` 的 `cards` 列表中。
4. **同步文档**：在 `README.md` 的资产清单表格中同步补充该卡片。
5. **本地验证**：执行 `node checker.js --test` 确保无 JSON 语法错误，计算正常。
6. **提交与推送**：
   ```bash
   git add cards.json README.md
   git commit -m "feat(cards): add <card_name> to keepalive reminder"
   git push origin main
   ```

---

### SOP-3：检查与排错
1. 若用户询问当前有哪些卡即将到期：
   运行 `node checker.js --test`，将输出的 Markdown 表格直接整理汇报给用户。
2. 若 GitHub Actions 报告失败：
   首先确认是否是因为触发了保活提醒而**故意抛出的 `exit 1`**（这是正常的报警机制！）；若是语法或 JSON 解析错误，修复对应代码并测试后推送。

---

## 5. 项目文件索引与职责

```text
keepalive-reminder/
├── AGENTS.md                     # 本规范文档（供 AI 协作者阅读遵循）
├── README.md                     # 项目用户手册与网页展示介绍（供人类用户阅读）
├── cards.json                    # 单一真实数据源（全部卡片状态在此维护）
├── checker.js                    # 纯原生 Node.js 检测引擎（UTC+8、计算逻辑、exit 码分流）
├── index.html                    # 单文件交互式看板网页（发布于 GitHub Pages）
└── .github/workflows/
    └── daily_check.yml           # GitHub Actions 每日 09:00 CST 定时巡检任务
```
