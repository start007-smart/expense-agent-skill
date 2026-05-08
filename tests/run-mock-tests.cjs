#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SKILL_DIR = path.resolve(__dirname, '..');
const API_SCRIPT = path.join(SKILL_DIR, 'expense_api.cjs');
const BI_DEMO_SCRIPT = path.join(SKILL_DIR, 'expense_bi_demo.cjs');
const QUERY_SCRIPT = path.join(SKILL_DIR, 'expense_query.cjs');
const PREFLIGHT_SCRIPT = path.join(SKILL_DIR, 'preflight-check.cjs');
const MOCK_FETCH_SCRIPT = path.join(__dirname, 'mock-fetch.cjs');

function parseJson(raw) {
  return JSON.parse(String(raw || '').trim());
}

function runNode(script, args, env, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: SKILL_DIR,
    encoding: 'utf8',
    env
  });

  assert.strictEqual(
    result.status,
    expectedStatus,
    `Unexpected status for ${path.basename(script)} ${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );

  return result;
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expense-skill-test-'));
  const nodeOptions = [process.env.NODE_OPTIONS, '--require', MOCK_FETCH_SCRIPT].filter(Boolean).join(' ');
  const env = {
    ...process.env,
    EKUAIBAO_APP_KEY: 'test-app-key',
    EKUAIBAO_APP_SECURITY: 'test-app-security',
    EKUAIBAO_BASE_URL: 'https://mock.ekuaibao.local',
    EKUAIBAO_TOKEN_CACHE_FILE: path.join(tmpDir, 'token-cache.json'),
    NODE_OPTIONS: nodeOptions
  };

  try {
    const preflight = parseJson(runNode(PREFLIGHT_SCRIPT, [], env).stdout);
    assert.strictEqual(preflight.ok, true);
    assert.strictEqual(preflight.checks.safetyGate.ok, true);

    const external = parseJson(runNode(API_SCRIPT, ['GET', 'https://example.com/api/openapi/v2/staffs', '{}'], env, 1).stderr);
    assert.strictEqual(external.code, -403);

    const post = parseJson(runNode(API_SCRIPT, ['POST', 'api/openapi/v2/staffs', '{}'], env, 1).stderr);
    assert.strictEqual(post.code, -403);

    const destructive = parseJson(runNode(API_SCRIPT, ['GET', 'api/openapi/v2/staffs/delete?id=1', '{}'], env, 1).stderr);
    assert.strictEqual(destructive.code, -403);

    const docs = parseJson(runNode(QUERY_SCRIPT, ['my-docs', '{"name":"张三","email":"zhangsan@example.com","count":10}'], env).stdout);
    assert.strictEqual(docs.actor.id, 'staff:001');
    assert.strictEqual(docs.returned, 3);
    assert.strictEqual(docs.items[0].code, 'BX-001');
    assert.strictEqual(docs.items[0].amount, '1200.5CNY');
    assert.strictEqual(docs.actor.email, undefined);

    const summary = parseJson(runNode(QUERY_SCRIPT, ['my-summary', '{"staffId":"staff:001"}'], env).stdout);
    assert.strictEqual(summary.summary.total, 3);
    assert.strictEqual(summary.summary.byState['已通过'], 1);
    assert.strictEqual(summary.summary.byState['已驳回'], 1);
    assert.strictEqual(summary.summary.byState['审批中'], 1);
    assert.strictEqual(summary.summary.byType['报销单'], 1);
    assert.strictEqual(summary.summary.amountByUnit.CNY, 2000.5);
    assert.strictEqual(summary.summary.rejectedCount, 1);
    assert.strictEqual(summary.summary.latestItems.length, 3);

    const forbidden = parseJson(runNode(QUERY_SCRIPT, ['staff-docs', '{"actor":{"staffId":"staff:001"},"target":{"staffId":"staff:002"}}'], env, 1).stderr);
    assert.strictEqual(forbidden.code, -403);

    const biSummary = parseJson(runNode(BI_DEMO_SCRIPT, ['company-summary', '{"month":"2026-05"}'], env).stdout);
    assert.strictEqual(biSummary.demo, true);
    assert.strictEqual(biSummary.scope, 'demo-company');
    assert.strictEqual(biSummary.month, '2026-05');
    assert.strictEqual(biSummary.kpis.documentCount, 8);
    assert.strictEqual(biSummary.kpis.approvingCount, 2);
    assert.strictEqual(biSummary.kpis.rejectedCount, 1);
    assert.ok(biSummary.rankings.byDepartment.length > 0);
    assert.ok(biSummary.risks.length > 0);

    const markdown = runNode(BI_DEMO_SCRIPT, ['company-report', '{"month":"2026-05","format":"markdown"}'], env).stdout;
    assert.ok(markdown.includes('AI 财务 BI Demo'));
    assert.ok(markdown.includes('部门费用排行'));

    const htmlPath = path.join(tmpDir, 'bi-demo.html');
    const htmlResult = parseJson(runNode(BI_DEMO_SCRIPT, ['company-report', JSON.stringify({ month: '2026-05', format: 'html', output: htmlPath })], env).stdout);
    assert.strictEqual(htmlResult.ok, true);
    assert.strictEqual(fs.existsSync(htmlPath), true);
    assert.ok(fs.readFileSync(htmlPath, 'utf8').includes('<!doctype html>'));

    process.stdout.write('All mock tests passed.\n');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
