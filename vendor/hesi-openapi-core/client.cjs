const fs = require('fs');
const path = require('path');
const { ERR_PROGRAMMATIC, programmatic } = require('./errors.cjs');
const { assertSafeApiRequest, buildTargetUrl, configuredBaseUrl } = require('./safety.cjs');

function defaultTokenCacheFile() {
  return path.join(__dirname, '..', '.expense_token_cache.json');
}

function loadCredentials(env = process.env) {
  const appKey = env.EKUAIBAO_APP_KEY;
  const appSecurity = env.EKUAIBAO_APP_SECURITY;

  if (!appKey || !appSecurity) {
    const err = new Error('Missing EKUAIBAO credentials');
    err.code = ERR_PROGRAMMATIC;
    err.msg = '未找到合思鉴权凭证。请设置 EKUAIBAO_APP_KEY 和 EKUAIBAO_APP_SECURITY 环境变量。';
    throw err;
  }
  return { appKey, appSecurity };
}

function tokenCacheFile(env = process.env) {
  return env.EKUAIBAO_TOKEN_CACHE_FILE || defaultTokenCacheFile();
}

async function getAccessToken(appKey, appSecurity, options = {}) {
  const env = options.env || process.env;
  const cacheFile = options.tokenCacheFile || tokenCacheFile(env);

  if (fs.existsSync(cacheFile)) {
    try {
      const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (cache.expireAt > Date.now() + 5 * 60 * 1000) {
        return cache.accessToken;
      }
    } catch {
      // Ignore bad cache and request a new token.
    }
  }

  const authUrl = `${configuredBaseUrl(env)}/api/openapi/v2/auth/getAccessToken`;
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
    throw programmatic('获取合思 AccessToken 失败: 授权响应中没有 accessToken。');
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

  fs.writeFileSync(cacheFile, JSON.stringify({
    accessToken: token,
    expireAt
  }));

  return token;
}

async function expenseApi(method, apiPath, bodyParams = {}, options = {}) {
  const env = options.env || process.env;
  const targetUrl = buildTargetUrl(apiPath, env);
  const normalizedMethod = assertSafeApiRequest(method, targetUrl, bodyParams, options);
  const { appKey, appSecurity } = loadCredentials(env);
  const token = await getAccessToken(appKey, appSecurity, options);

  const fetchConfig = {
    method: normalizedMethod,
    headers: {
      'Content-Type': 'application/json',
      accessToken: token
    }
  };

  if (fetchConfig.method !== 'GET' && fetchConfig.method !== 'HEAD') {
    fetchConfig.body = JSON.stringify(bodyParams || {});
  }

  targetUrl.searchParams.set('accessToken', token);

  const res = await fetch(targetUrl, fetchConfig);
  return res.text();
}

module.exports = {
  defaultTokenCacheFile,
  expenseApi,
  getAccessToken,
  loadCredentials,
  tokenCacheFile
};
