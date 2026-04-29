#!/usr/bin/env node

/**
 * Controlled business-query entrypoint for the expense agent.
 *
 * This script intentionally wraps expense_api.cjs instead of exposing arbitrary
 * OpenAPI paths to ordinary user requests. The open-source baseline resolves
 * identity and only allows self-service redacted document summaries.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const SKILL_DIR = __dirname;
const API_SCRIPT = path.join(SKILL_DIR, 'expense_api.cjs');

const ERR_PROGRAMMATIC = -100;
const ERR_FORBIDDEN = -403;

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

function raise(code, msg, extra = {}) {
  const err = new Error(msg);
  err.code = code;
  err.extra = extra;
  throw err;
}

function parseJson(raw, fallback = {}) {
  if (!raw || !String(raw).trim()) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    raise(ERR_PROGRAMMATIC, '请求参数不是合法 JSON。');
  }
}

function runApi(method, apiPath, body = {}) {
  const result = spawnSync(
    process.execPath,
    [API_SCRIPT, method, apiPath, JSON.stringify(body)],
    { encoding: 'utf8', env: process.env }
  );

  if (result.status !== 0) {
    const raw = (result.stderr || result.stdout || '').trim();
    try {
      const parsed = JSON.parse(raw);
      raise(parsed.code || ERR_PROGRAMMATIC, parsed.msg || '合思接口调用失败。', { detail: parsed });
    } catch (err) {
      if (err.code) throw err;
      raise(ERR_PROGRAMMATIC, raw || '合思接口调用失败。');
    }
  }

  try {
    return JSON.parse(result.stdout || '{}');
  } catch {
    raise(ERR_PROGRAMMATIC, '合思接口返回值不是合法 JSON。');
  }
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function sanitizeStaff(staff) {
  return {
    id: staff.id,
    name: staff.name || '',
    active: Boolean(staff.active),
    authState: Boolean(staff.authState),
    external: Boolean(staff.external)
  };
}

function assertIdentityInput(input) {
  const hasStaffId = Boolean(input.staffId || input.id);
  const hasUserId = Boolean(input.userId);
  const hasEmail = Boolean(input.email);
  const hasFullPhone = Boolean(input.cellphone || input.phone);
  const hasPhoneLast4 = Boolean(input.phoneLast4);
  const hasName = Boolean(input.name);

  if (hasStaffId || hasUserId || hasEmail || hasFullPhone) return;
  if (hasName && hasPhoneLast4) return;

  raise(
    ERR_PROGRAMMATIC,
    '无法确认当前用户身份。请提供 staffId/userId，或提供姓名 + 邮箱，或姓名 + 手机号后四位。'
  );
}

function fetchAllStaffs() {
  const pageSize = 100;
  const maxPages = 20;
  const staffs = [];

  for (let page = 0; page < maxPages; page += 1) {
    const start = page * pageSize;
    const data = runApi('GET', `api/openapi/v2/staffs?start=${start}&count=${pageSize}`);
    const items = Array.isArray(data.items) ? data.items : [];
    staffs.push(...items);

    if (!items.length || (Number.isFinite(data.count) && staffs.length >= data.count)) {
      break;
    }
  }

  return staffs;
}

function matchesIdentity(staff, input) {
  const staffId = normalizeText(input.staffId || input.id);
  const userId = normalizeText(input.userId);
  const name = normalizeText(input.name);
  const email = normalizeText(input.email);
  const fullPhone = normalizeDigits(input.cellphone || input.phone);
  const phoneLast4 = normalizeDigits(input.phoneLast4);

  if (staffId && normalizeText(staff.id) !== staffId) return false;
  if (userId && normalizeText(staff.userId) !== userId) return false;
  if (name && normalizeText(staff.name) !== name) return false;

  if (email) {
    const staffEmails = [staff.email, staff.showEmail].map(normalizeText).filter(Boolean);
    if (!staffEmails.includes(email)) return false;
  }

  const staffPhone = normalizeDigits(staff.cellphone);
  if (fullPhone && staffPhone !== fullPhone) return false;
  if (phoneLast4 && !staffPhone.endsWith(phoneLast4)) return false;

  return true;
}

function resolveStaff(input, roleLabel = '用户') {
  assertIdentityInput(input);

  const matches = fetchAllStaffs().filter((staff) => matchesIdentity(staff, input));
  if (matches.length === 1) return matches[0];

  if (matches.length > 1) {
    raise(
      ERR_PROGRAMMATIC,
      `${roleLabel}身份匹配到多名员工。请补充邮箱、staffId 或完整手机号进行精确匹配。`,
      { matchCount: matches.length }
    );
  }

  raise(ERR_PROGRAMMATIC, `${roleLabel}身份未匹配到员工。请确认姓名、邮箱或手机号后四位。`);
}

function assertCanReadOwnStaffDocs(actor, subject) {
  if (actor.id === subject.id) return;

  raise(ERR_FORBIDDEN, '开源基础版默认只能查询本人信息；查询他人、部门或企业级数据，以及基于合思角色的权限校验，需要升级版支持。');
}

function formatDate(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '';

  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value));
}

function moneyText(money) {
  if (!money || money.standard === undefined || money.standard === null || money.standard === '') {
    return '';
  }
  return `${money.standard}${money.standardUnit || ''}`;
}

function sanitizeDoc(doc) {
  const form = doc.form || {};
  const amount = form.expenseMoney || form.payMoney || form.applyMoney || form.money;

  return {
    code: form.code || '',
    title: form.title || '',
    type: TYPE_LABELS[doc.formType] || doc.formType || '',
    state: STATE_LABELS[doc.state] || doc.state || '',
    amount: moneyText(amount),
    submitTime: formatDate(form.submitDate),
    updateTime: formatDate(doc.updateTime),
    rejectionCount: form.rejectionNum || '0',
    voucherStatus: form.voucherStatus || ''
  };
}

function clampCount(value) {
  const count = Number(value || 10);
  if (!Number.isFinite(count) || count <= 0) return 10;
  return Math.min(Math.floor(count), 100);
}

function queryDocsByStaffId(staffId, index = 0, count = 10) {
  const encodedStaffId = encodeURIComponent(staffId);
  return runApi(
    'GET',
    `api/openapi/v1.1/docs/byFlowId/$${encodedStaffId}?index=${Number(index) || 0}&count=${clampCount(count)}`
  );
}

function buildDocsResult(scope, actor, subject, input) {
  const docs = queryDocsByStaffId(subject.id, input.index, input.count);
  const items = Array.isArray(docs.items) ? docs.items.map(sanitizeDoc) : [];

  return {
    scope,
    actor: sanitizeStaff(actor),
    subject: sanitizeStaff(subject),
    total: docs.count || 0,
    returned: items.length,
    items
  };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp() {
  printJson({
    usage: 'node expense_query.cjs <command> <JSON>',
    commands: {
      'resolve-staff': '解析员工身份，只返回脱敏员工摘要。',
      'my-docs': '查询本人单据。JSON 需提供 staffId/userId/email，或姓名 + 手机号后四位。',
      'staff-docs': '仅当 actor 和 target 是同一员工时允许查询；查他人需要升级版。',
      'company-docs': '企业级单据查询需要升级版接入合思角色/权限接口。'
    }
  });
}

async function main() {
  const [, , command, rawInput = '{}'] = process.argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  const input = parseJson(rawInput);

  if (command === 'resolve-staff') {
    printJson({ staff: sanitizeStaff(resolveStaff(input)) });
    return;
  }

  if (command === 'my-docs') {
    const actor = resolveStaff(input);
    printJson(buildDocsResult('self', actor, actor, input));
    return;
  }

  if (command === 'staff-docs') {
    const actor = resolveStaff(input.actor || {}, '操作者');
    const target = resolveStaff(input.target || {}, '目标员工');
    assertCanReadOwnStaffDocs(actor, target);
    printJson(buildDocsResult('self', actor, target, input));
    return;
  }

  if (command === 'company-docs' || command === 'enterprise-docs') {
    raise(ERR_FORBIDDEN, '开源基础版默认不支持企业级单据查询；该能力需要升级版接入合思角色/权限 API 后再开放。');
  }

  raise(ERR_PROGRAMMATIC, `未知命令：${command}`);
}

main().catch((err) => {
  fail(err.code || ERR_PROGRAMMATIC, err.message || '未知错误', err.extra || {});
});
