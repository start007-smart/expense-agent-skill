#!/usr/bin/env node

/**
 * 合思（易快报）OpenAPI 统一执行脚本 - 开源基础版
 *
 * CLI compatibility wrapper around hesi-openapi-core. Keep this file as the
 * stable command surface for the open-source skill; reusable safety/auth logic
 * lives in hesi-openapi-core/.
 */

const {
  ERR_PROGRAMMATIC,
  expenseApi
} = require('./core_loader.cjs');

function parseBody(raw) {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('invalid JSON body');
    err.code = ERR_PROGRAMMATIC;
    err.msg = '请求 body 不是合法的 JSON。';
    throw err;
  }
}

async function main() {
  const [, , method, apiPath, rawBody = '{}'] = process.argv;

  if (!method || !apiPath) {
    process.stderr.write(JSON.stringify({ code: ERR_PROGRAMMATIC, msg: '缺少必需参数：METHOD 和 API_PATH。' }));
    process.exit(1);
  }

  try {
    const body = parseBody(rawBody);
    const resp = await expenseApi(method, apiPath, body);
    process.stdout.write(resp);
  } catch (err) {
    const code = err.code || ERR_PROGRAMMATIC;
    const msg = err.msg || err.message || '未知错误';
    process.stderr.write(JSON.stringify({ code, msg }));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
