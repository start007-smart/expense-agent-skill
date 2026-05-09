#!/usr/bin/env node

/**
 * Local preflight checks for the expense agent skill.
 *
 * This command validates runtime, credentials, base URL format and the local
 * safety gate without requiring network access by default.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const { DEFAULT_BASE_URL } = require('./core_loader.cjs');

const SKILL_DIR = __dirname;
const API_SCRIPT = path.join(SKILL_DIR, 'expense_api.cjs');

const MIN_NODE_MAJOR = 18;

function parseArgs(argv) {
  return {
    live: argv.includes('--live')
  };
}

function status(ok, message, extra = {}) {
  return { ok, message, ...extra };
}

function mask(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return '*'.repeat(text.length);
  return `${text.slice(0, 4)}${'*'.repeat(Math.min(text.length - 8, 12))}${text.slice(-4)}`;
}

function checkNodeVersion() {
  const version = process.versions.node;
  const major = Number(version.split('.')[0]);
  return status(
    major >= MIN_NODE_MAJOR,
    major >= MIN_NODE_MAJOR
      ? `Node.js ${version} 满足要求。`
      : `Node.js ${version} 低于要求，请使用 Node.js ${MIN_NODE_MAJOR}+。`,
    { version, minVersion: `${MIN_NODE_MAJOR}.0.0` }
  );
}

function checkCredentials() {
  const appKey = process.env.EKUAIBAO_APP_KEY;
  const appSecurity = process.env.EKUAIBAO_APP_SECURITY;
  const ok = Boolean(appKey && appSecurity);

  return status(
    ok,
    ok
      ? '已检测到合思 OpenAPI 凭证环境变量。'
      : '缺少 EKUAIBAO_APP_KEY 或 EKUAIBAO_APP_SECURITY。',
    {
      appKey: appKey ? mask(appKey) : '',
      appSecurity: appSecurity ? mask(appSecurity) : ''
    }
  );
}

function checkBaseUrl() {
  const rawBaseUrl = process.env.EKUAIBAO_BASE_URL || DEFAULT_BASE_URL;
  try {
    const baseUrl = new URL(rawBaseUrl);
    const ok = baseUrl.protocol === 'https:' || baseUrl.hostname === 'localhost' || baseUrl.hostname === '127.0.0.1';
    return status(
      ok,
      ok
        ? `EKUAIBAO_BASE_URL 可用：${baseUrl.origin}`
        : 'EKUAIBAO_BASE_URL 建议使用 HTTPS，除非是本地 mock 服务。',
      { baseUrl: baseUrl.origin }
    );
  } catch {
    return status(false, 'EKUAIBAO_BASE_URL 不是合法 URL。', { baseUrl: rawBaseUrl });
  }
}

function runApiSafetyCase(method, apiPath, body = '{}') {
  return spawnSync(
    process.execPath,
    [API_SCRIPT, method, apiPath, body],
    {
      cwd: SKILL_DIR,
      encoding: 'utf8',
      env: {
        ...process.env,
        EKUAIBAO_APP_KEY: '',
        EKUAIBAO_APP_SECURITY: '',
        EKUAIBAO_BASE_URL: process.env.EKUAIBAO_BASE_URL || DEFAULT_BASE_URL
      }
    }
  );
}

function parseToolError(result) {
  const raw = (result.stderr || result.stdout || '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    return { code: result.status, msg: raw };
  }
}

function checkSafetyGate() {
  const cases = [
    {
      name: '拒绝外部域名',
      result: runApiSafetyCase('GET', 'https://example.com/api/openapi/v2/staffs')
    },
    {
      name: '拒绝未加入白名单的 POST',
      result: runApiSafetyCase('POST', 'api/openapi/v2/staffs')
    },
    {
      name: '拒绝 DELETE',
      result: runApiSafetyCase('DELETE', 'api/openapi/v2/staffs/1')
    }
  ];

  const failed = cases
    .map((item) => ({ ...item, error: parseToolError(item.result) }))
    .filter((item) => item.result.status === 0 || item.error.code !== -403);

  return status(
    failed.length === 0,
    failed.length === 0
      ? '本地安全拦截检查通过。'
      : '本地安全拦截检查失败。',
    {
      cases: cases.map((item) => ({
        name: item.name,
        passed: item.result.status !== 0 && parseToolError(item.result).code === -403,
        error: parseToolError(item.result)
      }))
    }
  );
}

function checkLiveAccess() {
  const result = spawnSync(
    process.execPath,
    [API_SCRIPT, 'GET', 'api/openapi/v2/staffs?start=0&count=1', '{}'],
    { cwd: SKILL_DIR, encoding: 'utf8', env: process.env }
  );

  if (result.status === 0) {
    return status(true, '合思 OpenAPI 连通性检查通过。');
  }

  const error = parseToolError(result);
  return status(false, `合思 OpenAPI 连通性检查失败：${error.msg || '未知错误'}`, { error });
}

function printResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const checks = {
    node: checkNodeVersion(),
    credentials: checkCredentials(),
    baseUrl: checkBaseUrl(),
    safetyGate: checkSafetyGate()
  };

  if (args.live) {
    checks.liveAccess = checkLiveAccess();
  }

  const ok = Object.values(checks).every((item) => item.ok);
  printResult({ ok, checks });
  if (!ok) process.exit(1);
}

main();
