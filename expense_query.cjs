#!/usr/bin/env node

/**
 * Controlled business-query entrypoint for the expense agent.
 *
 * The open-source baseline resolves identity and only allows self-service
 * redacted document summaries. Shared sanitizing/summarizing helpers live in
 * hesi-openapi-core/ so commercial BI agents can reuse the same data boundary.
 */

const path = require('path');
const { spawnSync } = require('child_process');
const {
  ERR_FORBIDDEN,
  ERR_PROGRAMMATIC,
  clampCount,
  matchesIdentity,
  sanitizeDoc,
  sanitizeStaff,
  summarizeDocs
} = require('./core_loader.cjs');

const SKILL_DIR = __dirname;
const API_SCRIPT = path.join(SKILL_DIR, 'expense_api.cjs');

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
  const maxPages = Number(process.env.EKUAIBAO_STAFF_MAX_PAGES || 1000);
  const staffs = [];
  let totalCount = null;

  for (let page = 0; page < maxPages; page += 1) {
    const start = page * pageSize;
    const data = runApi('GET', `api/openapi/v2/staffs?start=${start}&count=${pageSize}`);
    const items = Array.isArray(data.items) ? data.items : [];
    const parsedCount = Number(data.count);

    if (Number.isFinite(parsedCount) && parsedCount >= 0) {
      totalCount = parsedCount;
    }

    staffs.push(...items);

    if (!items.length || (totalCount !== null && staffs.length >= totalCount)) {
      break;
    }
  }

  if (totalCount !== null && staffs.length < totalCount) {
    raise(
      ERR_PROGRAMMATIC,
      `人员列表分页未拉取完整：已获取 ${staffs.length}/${totalCount}。可调高 EKUAIBAO_STAFF_MAX_PAGES 后重试。`
    );
  }

  return staffs;
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

function buildSummaryResult(actor, input) {
  const docs = queryDocsByStaffId(actor.id, input.index, input.count || 100);

  return {
    scope: 'self',
    actor: sanitizeStaff(actor),
    summary: summarizeDocs(docs)
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
      'my-summary': '查询本人单据汇总，返回状态、类型、金额和最近单据摘要。',
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

  if (command === 'my-summary') {
    const actor = resolveStaff(input);
    printJson(buildSummaryResult(actor, input));
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
