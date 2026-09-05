#!/usr/bin/env node

/**
 * keepalive-reminder: 纯原生零依赖保活检测引擎
 * 运行环境: Node.js (无需任何 npm install，秒级启动)
 */

const fs = require('fs');
const path = require('path');

// 1. 读取配置文件
const configPath = path.join(__dirname, 'cards.json');
if (!fs.existsSync(configPath)) {
  console.error(`❌ 未找到配置文件: ${configPath}`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const cards = config.cards || [];

// 2. 日期工具函数 (统一采用 UTC+8 北京时间进行天数比对)
function getCSTDate() {
  const now = new Date();
  const cst = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return cst.toISOString().slice(0, 10);
}

function parseDate(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`);
}

function addDays(dateStr, days) {
  const d = parseDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(targetDateStr, baseDateStr) {
  const target = parseDate(targetDateStr);
  const base = parseDate(baseDateStr);
  return Math.round((target.getTime() - base.getTime()) / (1000 * 60 * 60 * 24));
}

// 3. 执行健康检查
const todayStr = getCSTDate();
console.log(`\n======================================================`);
console.log(`📅 今日检测基准日（北京时间）: ${todayStr}`);
console.log(`======================================================\n`);

const repo = process.env.GITHUB_REPOSITORY || 'yang-xianfeng/keepalive-reminder';
const editUrl = `https://github.com/${repo}/edit/main/cards.json`;

const report = [];
const alerts = [];

for (const card of cards) {
  const targetDate = addDays(card.last_used, card.cycle_days);
  const remainingDays = diffDays(targetDate, todayStr);
  const remindDays = card.remind_days || [30, 7, 3];

  let status = 'HEALTHY';
  let badge = '🟢 正常';

  if (remainingDays < 0) {
    status = 'OVERDUE';
    badge = `💀 已逾期 ${Math.abs(remainingDays)} 天`;
  } else if (remindDays.includes(remainingDays) || remainingDays === 0) {
    status = 'ALERT';
    badge = `🚨 触发提醒 (剩余 ${remainingDays} 天)`;
  } else if (remainingDays <= 3) {
    status = 'WARNING';
    badge = `🔴 剩余 ${remainingDays} 天`;
  } else if (remainingDays <= 7) {
    status = 'NOTICE';
    badge = `🟠 剩余 ${remainingDays} 天`;
  } else if (remainingDays <= 30) {
    status = 'INFO';
    badge = `🟡 剩余 ${remainingDays} 天`;
  } else {
    badge = `🟢 剩余 ${remainingDays} 天`;
  }

  const item = {
    ...card,
    targetDate,
    remainingDays,
    status,
    badge
  };

  report.push(item);

  // 判断是否属于今天需要通知的节点（精确命中提醒天数，或已进入逾期）
  if (remindDays.includes(remainingDays) || remainingDays <= 0) {
    alerts.push(item);
  }
}

// 4. 打印控制台看板
console.table(
  report.map(r => ({
    '卡片名称': r.name,
    '类别': r.category,
    '上次使用': r.last_used,
    '截止日期': r.targetDate,
    '剩余天数': `${r.remainingDays} 天`,
    '状态': r.badge
  }))
);

// 5. 生成 GitHub Step Summary (Markdown 格式)
let summaryMd = `## 💳 卡片保活日常检测报告\n\n`;
summaryMd += `> **检测时间**：${todayStr} (北京时间 CST)  \n`;
summaryMd += `> **快捷维护**：[📝 点击直接在 GitHub 修改 cards.json 日期](${editUrl})\n\n`;

if (alerts.length > 0) {
  summaryMd += `### 🚨 今日需处理的保活预警 (${alerts.length} 项)\n\n`;
  summaryMd += `| 卡片名称 | 剩余天数 | 下次截止 | 上次使用 | 保活操作指南 |\n`;
  summaryMd += `| :--- | :--- | :--- | :--- | :--- |\n`;
  for (const a of alerts) {
    summaryMd += `| **${a.name}** | **${a.badge}** | \`${a.targetDate}\` | ${a.last_used} | ${a.guide} |\n`;
  }
  summaryMd += `\n> ⚠️ **请尽快完成保活操作。** 完成后在 \`cards.json\` 中更新对应卡片的 \`last_used\` 为当前日期，后续提醒将自动重置计算。\n\n`;
} else {
  summaryMd += `### ✅ 今日所有卡片状态健康，无需操作\n\n`;
}

summaryMd += `### 📋 全量卡片看板\n\n`;
summaryMd += `| 卡片名称 | 类别 | 周期 | 上次使用 | 下次截止 | 剩余天数 | 状态 |\n`;
summaryMd += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
for (const r of report) {
  summaryMd += `| ${r.name} | ${r.category} | ${r.cycle_days}天 | ${r.last_used} | \`${r.targetDate}\` | ${r.remainingDays}天 | ${r.badge} |\n`;
}

// 写入 GitHub Step Summary 文件（如果在 Actions 环境中运行）
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMd, 'utf8');
}

// 6. 处理工作流退出逻辑
const isTestMode = process.argv.includes('--test') || process.env.DRY_RUN === '1';

if (alerts.length > 0) {
  console.log(`\n======================================================`);
  console.error(`🚨 今日触发保活提醒！共有 ${alerts.length} 项卡片需要处理:`);
  for (const a of alerts) {
    console.error(`  - 【${a.name}】剩余 ${a.remainingDays} 天（截止日期: ${a.targetDate}）`);
    console.error(`    操作指南: ${a.guide}`);
    console.error(`    政策提示: ${a.policy}`);
  }
  console.log(`======================================================\n`);

  if (isTestMode) {
    console.log(`ℹ️ [测试模式] 检测到预警，但由于带有 --test 参数，以 exit 0 退出。`);
    process.exit(0);
  } else {
    console.error(`💥 故意触发工作流失败 (Exit Code 1) -> 触发 GitHub 官方自动邮件推送给仓库拥有者！`);
    process.exit(1);
  }
} else {
  console.log(`\n✅ 检查完毕，所有卡片均未到提醒日，工作流正常通过（Exit Code 0，不发送打扰邮件）。\n`);
  process.exit(0);
}
