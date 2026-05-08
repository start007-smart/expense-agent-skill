#!/usr/bin/env node

/**
 * Local BI demo for boss/finance scenarios.
 *
 * This script intentionally uses bundled demo data only. It does not call
 * Hesi/Ekuaibao OpenAPI and must not be presented as real company data.
 */

const fs = require('fs');
const path = require('path');

const SKILL_DIR = __dirname;
const DEMO_DATA_FILE = path.join(SKILL_DIR, 'demo-data', 'bi-demo.json');
const ERR_PROGRAMMATIC = -100;

const TYPE_LABELS = {
  expense: '报销单',
  requisition: '申请单',
  loan: '借款单',
  payment: '付款单'
};

const STATE_LABELS = {
  approving: '审批中',
  approved: '已通过',
  rejected: '已驳回',
  canceled: '已撤销',
  paid: '已支付',
  closed: '已关闭'
};

function fail(code, msg, extra = {}) {
  process.stderr.write(JSON.stringify({ code, msg, ...extra }, null, 2));
  process.exit(1);
}

function parseJson(raw, fallback = {}) {
  if (!raw || !String(raw).trim()) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    fail(ERR_PROGRAMMATIC, '请求参数不是合法 JSON。');
  }
}

function loadDemoData() {
  return JSON.parse(fs.readFileSync(DEMO_DATA_FILE, 'utf8'));
}

function monthOf(date) {
  return String(date || '').slice(0, 7);
}

function roundMoney(value) {
  return Number((Number(value || 0)).toFixed(2));
}

function amountText(value, currency = 'CNY') {
  return `${roundMoney(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function percentText(value) {
  if (!Number.isFinite(value)) return '0.0%';
  return `${(value * 100).toFixed(1)}%`;
}

function latestMonth(docs) {
  return docs.map((doc) => monthOf(doc.date)).sort().at(-1);
}

function previousMonth(month) {
  const [year, rawMonth] = String(month).split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(rawMonth)) return '';
  const date = new Date(Date.UTC(year, rawMonth - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function sumAmount(docs) {
  return roundMoney(docs.reduce((sum, doc) => sum + Number(doc.amount || 0), 0));
}

function groupAmount(docs, key) {
  const groups = new Map();
  for (const doc of docs) {
    const name = doc[key] || '未分类';
    const item = groups.get(name) || { name, amount: 0, count: 0 };
    item.amount += Number(doc.amount || 0);
    item.count += 1;
    groups.set(name, item);
  }

  return [...groups.values()]
    .map((item) => ({ ...item, amount: roundMoney(item.amount) }))
    .sort((left, right) => right.amount - left.amount);
}

function topRows(rows, limit = 5) {
  return rows.slice(0, limit);
}

function stateCount(docs, state) {
  return docs.filter((doc) => doc.state === state).length;
}

function buildTrend(data, selectedMonth) {
  const months = [...new Set(data.docs.map((doc) => monthOf(doc.date)).filter(Boolean))]
    .filter((month) => month <= selectedMonth)
    .sort()
    .slice(-6);

  return months.map((month) => {
    const docs = data.docs.filter((doc) => monthOf(doc.date) === month);
    return {
      month,
      amount: sumAmount(docs),
      count: docs.length
    };
  });
}

function buildBudget(data, month, docs) {
  const budgets = data.budgets.filter((item) => item.month === month);
  const actualByDepartment = groupAmount(docs, 'department');
  const actualMap = new Map(actualByDepartment.map((item) => [item.name, item]));
  const budgetRows = budgets.map((item) => {
    const actual = actualMap.get(item.department) || { amount: 0, count: 0 };
    const usageRate = item.amount > 0 ? actual.amount / item.amount : 0;
    return {
      department: item.department,
      budget: roundMoney(item.amount),
      actual: roundMoney(actual.amount),
      usageRate: roundMoney(usageRate),
      remaining: roundMoney(item.amount - actual.amount),
      count: actual.count,
      currency: item.currency || data.currency
    };
  }).sort((left, right) => right.usageRate - left.usageRate);

  const totalBudget = roundMoney(budgetRows.reduce((sum, row) => sum + row.budget, 0));
  const totalActual = roundMoney(budgetRows.reduce((sum, row) => sum + row.actual, 0));

  return {
    totalBudget,
    totalActual,
    usageRate: totalBudget > 0 ? roundMoney(totalActual / totalBudget) : 0,
    rows: budgetRows
  };
}

function buildRisks(summary, docs) {
  const risks = [];
  const highBudgetRows = summary.budget.rows.filter((row) => row.usageRate >= 0.85);
  const largeDocs = docs.filter((doc) => Number(doc.amount || 0) >= 50000);
  const overdueDocs = docs.filter((doc) => doc.state === 'approving' && Number(doc.approvalHours || 0) >= 72);
  const rejectedDocs = docs.filter((doc) => doc.state === 'rejected');

  if (highBudgetRows.length) {
    risks.push({
      level: highBudgetRows.some((row) => row.usageRate >= 1) ? 'high' : 'medium',
      title: '预算使用率偏高',
      description: highBudgetRows.map((row) => `${row.department} ${percentText(row.usageRate)}`).join('，'),
      count: highBudgetRows.length
    });
  }

  if (largeDocs.length) {
    risks.push({
      level: 'medium',
      title: '大额支出需关注',
      description: `本月 ${largeDocs.length} 张单据金额超过 50,000 CNY。`,
      count: largeDocs.length,
      amount: sumAmount(largeDocs)
    });
  }

  if (overdueDocs.length) {
    risks.push({
      level: 'high',
      title: '审批超时',
      description: `本月 ${overdueDocs.length} 张审批中单据已超过 72 小时。`,
      count: overdueDocs.length,
      amount: sumAmount(overdueDocs)
    });
  }

  if (rejectedDocs.length) {
    risks.push({
      level: 'medium',
      title: '驳回单据',
      description: `本月 ${rejectedDocs.length} 张单据被驳回，建议财务跟进原因。`,
      count: rejectedDocs.length,
      amount: sumAmount(rejectedDocs)
    });
  }

  return risks;
}

function sanitizeDoc(doc) {
  return {
    id: doc.id,
    date: doc.date,
    department: doc.department,
    costCenter: doc.costCenter,
    project: doc.project,
    type: TYPE_LABELS[doc.type] || doc.type,
    category: doc.category,
    state: STATE_LABELS[doc.state] || doc.state,
    amount: roundMoney(doc.amount),
    currency: doc.currency,
    vendor: doc.vendor,
    approvalHours: doc.approvalHours
  };
}

function buildCompanySummary(input) {
  const data = loadDemoData();
  const month = input.month || latestMonth(data.docs);
  const docs = data.docs.filter((doc) => monthOf(doc.date) === month);
  const prevMonth = previousMonth(month);
  const prevDocs = data.docs.filter((doc) => monthOf(doc.date) === prevMonth);
  const totalAmount = sumAmount(docs);
  const prevAmount = sumAmount(prevDocs);
  const budget = buildBudget(data, month, docs);
  const byDepartment = groupAmount(docs, 'department');
  const byCategory = groupAmount(docs, 'category');
  const byCostCenter = groupAmount(docs, 'costCenter');
  const byProject = groupAmount(docs, 'project');

  const summary = {
    scope: 'demo-company',
    demo: true,
    dataSource: 'local-demo-data',
    warning: '演示数据仅用于产品展示，不代表真实合思企业数据；真实公司级查询需要接入企业角色/权限 API。',
    company: data.company,
    month,
    currency: data.currency,
    kpis: {
      totalAmount,
      documentCount: docs.length,
      averageAmount: docs.length ? roundMoney(totalAmount / docs.length) : 0,
      approvingCount: stateCount(docs, 'approving'),
      rejectedCount: stateCount(docs, 'rejected'),
      paidCount: stateCount(docs, 'paid'),
      approvalOverdueCount: docs.filter((doc) => doc.state === 'approving' && Number(doc.approvalHours || 0) >= 72).length,
      budgetUsageRate: budget.usageRate,
      momGrowthRate: prevAmount > 0 ? roundMoney((totalAmount - prevAmount) / prevAmount) : 0
    },
    trend: buildTrend(data, month),
    rankings: {
      byDepartment: topRows(byDepartment),
      byCategory: topRows(byCategory),
      byCostCenter: topRows(byCostCenter),
      byProject: topRows(byProject)
    },
    budget,
    topAmountDocs: docs
      .slice()
      .sort((left, right) => Number(right.amount || 0) - Number(left.amount || 0))
      .slice(0, 5)
      .map(sanitizeDoc)
  };

  summary.risks = buildRisks(summary, docs);
  return summary;
}

function renderRows(rows, formatter) {
  return rows.map(formatter).join('\n');
}

function renderMarkdown(summary) {
  return [
    `# ${summary.company} AI 财务 BI Demo - ${summary.month}`,
    '',
    `> ${summary.warning}`,
    '',
    '## 核心指标',
    '',
    `- 总费用：${amountText(summary.kpis.totalAmount, summary.currency)}`,
    `- 单据数：${summary.kpis.documentCount}`,
    `- 平均单据金额：${amountText(summary.kpis.averageAmount, summary.currency)}`,
    `- 审批中：${summary.kpis.approvingCount}`,
    `- 审批超时：${summary.kpis.approvalOverdueCount}`,
    `- 驳回单据：${summary.kpis.rejectedCount}`,
    `- 预算使用率：${percentText(summary.kpis.budgetUsageRate)}`,
    `- 环比变化：${percentText(summary.kpis.momGrowthRate)}`,
    '',
    '## 部门费用排行',
    '',
    '| 部门 | 金额 | 单据数 |',
    '| --- | ---: | ---: |',
    renderRows(summary.rankings.byDepartment, (row) => `| ${row.name} | ${amountText(row.amount, summary.currency)} | ${row.count} |`),
    '',
    '## 费用类型排行',
    '',
    '| 类型 | 金额 | 单据数 |',
    '| --- | ---: | ---: |',
    renderRows(summary.rankings.byCategory, (row) => `| ${row.name} | ${amountText(row.amount, summary.currency)} | ${row.count} |`),
    '',
    '## 预算使用',
    '',
    '| 部门 | 预算 | 实际 | 使用率 | 剩余 |',
    '| --- | ---: | ---: | ---: | ---: |',
    renderRows(summary.budget.rows, (row) => `| ${row.department} | ${amountText(row.budget, row.currency)} | ${amountText(row.actual, row.currency)} | ${percentText(row.usageRate)} | ${amountText(row.remaining, row.currency)} |`),
    '',
    '## 风险提醒',
    '',
    summary.risks.length
      ? renderRows(summary.risks, (risk) => `- [${risk.level}] ${risk.title}：${risk.description}`)
      : '- 暂无明显风险提醒。',
    '',
    '## 大额单据',
    '',
    '| 单号 | 日期 | 部门 | 类型 | 类别 | 状态 | 金额 |',
    '| --- | --- | --- | --- | --- | --- | ---: |',
    renderRows(summary.topAmountDocs, (doc) => `| ${doc.id} | ${doc.date} | ${doc.department} | ${doc.type} | ${doc.category} | ${doc.state} | ${amountText(doc.amount, doc.currency)} |`),
    ''
  ].join('\n');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tableHtml(headers, rows) {
  return `<table><thead><tr>${headers.map((item) => `<th>${escapeHtml(item)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function renderHtml(summary) {
  const maxDeptAmount = Math.max(...summary.rankings.byDepartment.map((row) => row.amount), 1);
  const departmentRows = summary.rankings.byDepartment.map((row) => {
    const width = Math.max(6, Math.round((row.amount / maxDeptAmount) * 100));
    return `<tr><td>${escapeHtml(row.name)}</td><td>${amountText(row.amount, summary.currency)}</td><td>${row.count}</td><td><span class="bar"><span style="width:${width}%"></span></span></td></tr>`;
  });
  const budgetRows = summary.budget.rows.map((row) => `<tr><td>${escapeHtml(row.department)}</td><td>${amountText(row.budget, row.currency)}</td><td>${amountText(row.actual, row.currency)}</td><td>${percentText(row.usageRate)}</td><td>${amountText(row.remaining, row.currency)}</td></tr>`);
  const riskItems = summary.risks.length
    ? summary.risks.map((risk) => `<li class="${escapeHtml(risk.level)}"><strong>${escapeHtml(risk.title)}</strong><span>${escapeHtml(risk.description)}</span></li>`).join('')
    : '<li><strong>暂无明显风险提醒</strong><span>当前演示数据未触发风险规则。</span></li>';
  const topDocRows = summary.topAmountDocs.map((doc) => `<tr><td>${escapeHtml(doc.id)}</td><td>${escapeHtml(doc.date)}</td><td>${escapeHtml(doc.department)}</td><td>${escapeHtml(doc.category)}</td><td>${escapeHtml(doc.state)}</td><td>${amountText(doc.amount, doc.currency)}</td></tr>`);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(summary.company)} AI 财务 BI Demo</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17202a; background: #f5f7fb; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px 20px 48px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    h2 { margin: 28px 0 12px; font-size: 18px; }
    .muted { color: #64748b; font-size: 13px; }
    .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 20px; }
    .kpi { background: #fff; border: 1px solid #dbe3ef; border-radius: 8px; padding: 14px; }
    .kpi span { display: block; color: #64748b; font-size: 12px; }
    .kpi strong { display: block; margin-top: 6px; font-size: 20px; }
    section { background: #fff; border: 1px solid #dbe3ef; border-radius: 8px; padding: 18px; margin-top: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid #e5ebf3; padding: 10px 8px; text-align: left; }
    th { color: #475569; font-weight: 600; background: #f8fafc; }
    .bar { display: block; width: 100%; height: 8px; background: #edf2f7; border-radius: 999px; overflow: hidden; }
    .bar span { display: block; height: 100%; background: #2563eb; }
    .risks { padding-left: 0; list-style: none; display: grid; gap: 10px; }
    .risks li { border-left: 4px solid #f59e0b; background: #fff7ed; padding: 10px 12px; }
    .risks li.high { border-left-color: #dc2626; background: #fef2f2; }
    .risks strong, .risks span { display: block; }
    @media (max-width: 760px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } table { font-size: 12px; } }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(summary.company)} AI 财务 BI Demo</h1>
    <div class="muted">${escapeHtml(summary.month)} · ${escapeHtml(summary.warning)}</div>
    <div class="kpis">
      <div class="kpi"><span>总费用</span><strong>${amountText(summary.kpis.totalAmount, summary.currency)}</strong></div>
      <div class="kpi"><span>单据数</span><strong>${summary.kpis.documentCount}</strong></div>
      <div class="kpi"><span>预算使用率</span><strong>${percentText(summary.kpis.budgetUsageRate)}</strong></div>
      <div class="kpi"><span>审批超时</span><strong>${summary.kpis.approvalOverdueCount}</strong></div>
    </div>
    <section><h2>部门费用排行</h2>${tableHtml(['部门', '金额', '单据数', '占比'], departmentRows)}</section>
    <section><h2>预算使用</h2>${tableHtml(['部门', '预算', '实际', '使用率', '剩余'], budgetRows)}</section>
    <section><h2>风险提醒</h2><ul class="risks">${riskItems}</ul></section>
    <section><h2>大额单据</h2>${tableHtml(['单号', '日期', '部门', '类别', '状态', '金额'], topDocRows)}</section>
  </main>
</body>
</html>`;
}

function writeOutputIfNeeded(content, input) {
  if (!input.output) return null;
  const outputPath = path.resolve(process.cwd(), input.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf8');
  return outputPath;
}

function printHelp() {
  process.stdout.write(`${JSON.stringify({
    usage: 'node expense_bi_demo.cjs <command> <JSON>',
    commands: {
      'company-summary': '生成本地演示公司级 BI 汇总。format 支持 json、markdown、html。',
      'company-report': 'company-summary 的别名，更适合报表语义。'
    },
    examples: [
      'node expense_bi_demo.cjs company-summary {"month":"2026-05"}',
      'node expense_bi_demo.cjs company-report {"month":"2026-05","format":"markdown"}',
      'node expense_bi_demo.cjs company-report {"month":"2026-05","format":"html","output":"output/bi-demo-2026-05.html"}'
    ]
  }, null, 2)}\n`);
}

function main() {
  const [, , command, rawInput = '{}'] = process.argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command !== 'company-summary' && command !== 'company-report') {
    fail(ERR_PROGRAMMATIC, `未知命令：${command}`);
  }

  const input = parseJson(rawInput);
  const format = String(input.format || 'json').toLowerCase();
  const summary = buildCompanySummary(input);

  if (format === 'json') {
    const content = `${JSON.stringify(summary, null, 2)}\n`;
    const outputPath = writeOutputIfNeeded(content, input);
    if (outputPath) {
      process.stdout.write(`${JSON.stringify({ ok: true, format, output: outputPath, month: summary.month }, null, 2)}\n`);
      return;
    }
    process.stdout.write(content);
    return;
  }

  if (format === 'markdown' || format === 'md') {
    const content = renderMarkdown(summary);
    const outputPath = writeOutputIfNeeded(content, input);
    process.stdout.write(outputPath ? `${JSON.stringify({ ok: true, format: 'markdown', output: outputPath, month: summary.month }, null, 2)}\n` : content);
    return;
  }

  if (format === 'html') {
    const content = renderHtml(summary);
    const outputPath = writeOutputIfNeeded(content, input);
    process.stdout.write(outputPath ? `${JSON.stringify({ ok: true, format, output: outputPath, month: summary.month }, null, 2)}\n` : content);
    return;
  }

  fail(ERR_PROGRAMMATIC, 'format 仅支持 json、markdown、html。');
}

main();
