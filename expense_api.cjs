#!/usr/bin/env node

/**
 * 合思（易快报）OpenAPI 统一执行脚本 - 开源基础版
 * 职责：
 * 1. 自动读取 AppKey 和 AppSecurity。
 * 2. 自动调用合思接口获取 accessToken，并进行简单的内存级缓存。
 * 3. 封装通用的 fetch 请求，处理鉴权 Header，并将结果标准化输出。
 */

const fs = require('fs');
const path = require('path');

// 合思开放平台 Base URL，支持私有化部署和多环境（沙箱/生产）域名配置
let BASE_URL = process.env.EKUAIBAO_BASE_URL || 'https://app.ekuaibao.com';
BASE_URL = BASE_URL.replace(/\/+$/, ''); // 清除末尾斜杠防拼接错误

// 错误码约定
const ERR_PROGRAMMATIC = -100;

// 简单的临时缓存文件，用于存 token，避免频繁调用 auth 接口
const TOKEN_CACHE_FILE = path.join(__dirname, '.expense_token_cache.json');

function loadCredentials() {
  const appKey = process.env.EKUAIBAO_APP_KEY;
  const appSecurity = process.env.EKUAIBAO_APP_SECURITY;

  if (!appKey || !appSecurity) {
    const err = new Error('Missing EKUAIBAO credentials');
    err.code = ERR_PROGRAMMATIC;
    err.msg = '未找到合思鉴权凭证。请设置 EKUAIBAO_APP_KEY 和 EKUAIBAO_APP_SECURITY 环境变量。';
    throw err;
  }
  return { appKey, appSecurity };
}

// 获取 Access Token
async function getAccessToken(appKey, appSecurity) {
  // 1. 查缓存
  if (fs.existsSync(TOKEN_CACHE_FILE)) {
    try {
      const cache = JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, 'utf8'));
      // 假设提前 5 分钟过期
      if (cache.expireAt > Date.now() + 5 * 60 * 1000) {
        return cache.accessToken;
      }
    } catch (e) {
      // 忽略缓存读取错误
    }
  }

  // 2. 重新请求
  // 注意：具体的 auth 接口路径需参考你对接的合思 API 文档版本
  const authUrl = `${BASE_URL}/api/openapi/v2/auth/getAccessToken`;

  const res = await fetch(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appKey, appSecurity })
  });

  const data = await res.json();

  if (!res.ok || data.errorCode) {
    const err = new Error('Auth Failed');
    err.code = ERR_PROGRAMMATIC;
    err.msg = `获取合思 AccessToken 失败: ${data.errorMessage || res.statusText}`;
    throw err;
  }

  const tokenInfo = data.value || {};
  const token = tokenInfo.accessToken || tokenInfo.access_token || tokenInfo.token;
  if (!token) {
    const err = new Error('Auth response missing token');
    err.code = ERR_PROGRAMMATIC;
    err.msg = '获取合思 AccessToken 失败: 授权响应中没有 accessToken。';
    throw err;
  }

  const expiresIn = Number(
    tokenInfo.expiresIn ||
    tokenInfo.expires_in ||
    tokenInfo.expireIn ||
    tokenInfo.expire_in
  );
  const expireAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? Date.now() + (expiresIn * 1000)
    : Date.now() + (2 * 60 * 60 * 1000);

  // 3. 写入缓存
  fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify({
    accessToken: token,
    expireAt
  }));

  return token;
}

// 主业务请求函数
async function expenseApi(method, apiPath, bodyParams) {
  const { appKey, appSecurity } = loadCredentials();
  const token = await getAccessToken(appKey, appSecurity);

  const fetchConfig = {
    method: method.toUpperCase(),
    headers: {
      'Content-Type': 'application/json',
      'accessToken': token
    }
  };

  if (fetchConfig.method !== 'GET' && fetchConfig.method !== 'HEAD') {
    fetchConfig.body = JSON.stringify(bodyParams || {});
  }

  const targetUrl = new URL(
    apiPath.startsWith('http') ? apiPath : `${BASE_URL}/${apiPath.replace(/^\//, '')}`
  );
  if (!targetUrl.searchParams.has('accessToken')) {
    targetUrl.searchParams.set('accessToken', token);
  }

  const res = await fetch(targetUrl, fetchConfig);
  const respText = await res.text();

  return respText;
}

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
    process.stdout.write(resp); // 正常结果输出到 stdout
  } catch (err) {
    const code = err.code || ERR_PROGRAMMATIC;
    const msg = err.msg || err.message || '未知错误';
    process.stderr.write(JSON.stringify({ code, msg })); // 错误信息输出到 stderr
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
