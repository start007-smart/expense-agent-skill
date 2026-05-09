const { forbidden, programmatic } = require('./errors.cjs');

const DEFAULT_BASE_URL = 'https://app.ekuaibao.com';
const BLOCKED_METHODS = new Set(['DELETE', 'PUT', 'PATCH']);
const READONLY_METHODS = new Set(['GET', 'HEAD']);
const DEFAULT_READONLY_POST_PATHS = new Set([
  // Open-source baseline has no confirmed read-only POST business endpoints.
  // Add exact pathname strings here only after verifying the endpoint cannot write data.
]);
const DANGEROUS_API_PATTERNS = [
  /(^|[/?&_.-])(delete|remove|destroy|drop|truncate|erase|purge|del)(?=$|[/?&_.=-])/i,
  /(^|[/?&_.-])(nullify|void|cancel|revoke|withdraw|rollback)(?=$|[/?&_.=-])/i
];

function configuredBaseUrl(env = process.env) {
  return String(env.EKUAIBAO_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function getConfiguredBaseUrl(env = process.env) {
  try {
    return new URL(`${configuredBaseUrl(env)}/`);
  } catch {
    throw programmatic('EKUAIBAO_BASE_URL 不是合法的 URL。');
  }
}

function normalizePathname(pathname) {
  const normalized = String(pathname || '').replace(/\/+$/, '');
  return normalized || '/';
}

function buildTargetUrl(apiPath, env = process.env) {
  const rawPath = String(apiPath || '').trim();
  if (!rawPath) {
    throw programmatic('缺少 API_PATH。');
  }

  const baseUrl = getConfiguredBaseUrl(env);
  let targetUrl;

  try {
    if (/^\/\//.test(rawPath)) {
      throw forbidden('安全策略拒绝调用协议相对 URL。API 请求只能发往 EKUAIBAO_BASE_URL 配置的域名。');
    }

    if (/^[a-z][a-z0-9+.-]*:/i.test(rawPath)) {
      targetUrl = new URL(rawPath);
    } else {
      targetUrl = new URL(rawPath.replace(/^\/+/, ''), baseUrl);
    }
  } catch (err) {
    if (err.code) throw err;
    throw programmatic('API_PATH 不是合法的 URL 或路径。');
  }

  if (targetUrl.origin !== baseUrl.origin) {
    throw forbidden(`安全策略拒绝调用非配置域名：${targetUrl.origin}。API 请求只能发往 ${baseUrl.origin}。`);
  }

  return targetUrl;
}

function isAllowedReadonlyPost(targetUrl, readonlyPostPaths = DEFAULT_READONLY_POST_PATHS) {
  return readonlyPostPaths.has(normalizePathname(targetUrl.pathname));
}

function assertSafeApiRequest(method, targetUrl, bodyParams, options = {}) {
  const normalizedMethod = String(method || '').trim().toUpperCase();
  const readonlyPostPaths = options.readonlyPostPaths || DEFAULT_READONLY_POST_PATHS;

  if (BLOCKED_METHODS.has(normalizedMethod)) {
    throw forbidden(`安全策略拒绝调用 ${normalizedMethod} 接口。当前 skill 只允许只读查询，不允许修改或删除数据。`);
  }

  if (normalizedMethod === 'POST' && !isAllowedReadonlyPost(targetUrl, readonlyPostPaths)) {
    throw forbidden('安全策略拒绝调用未加入只读查询白名单的 POST 接口。当前 skill 不允许通过 POST 创建、提交、审批或修改数据。');
  }

  if (!READONLY_METHODS.has(normalizedMethod) && normalizedMethod !== 'POST') {
    throw forbidden(`安全策略拒绝调用 ${normalizedMethod || 'UNKNOWN'} 接口。当前 skill 只允许 GET/HEAD 查询和已加入白名单的只读 POST 查询。`);
  }

  const bodyText = bodyParams && Object.keys(bodyParams).length
    ? JSON.stringify(bodyParams)
    : '';
  const inspectText = `${targetUrl.pathname}${targetUrl.search}\n${bodyText}`;
  if (DANGEROUS_API_PATTERNS.some((pattern) => pattern.test(inspectText))) {
    throw forbidden('安全策略拒绝调用疑似删除、作废、撤销或回滚数据的接口。');
  }

  return normalizedMethod;
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_READONLY_POST_PATHS,
  assertSafeApiRequest,
  buildTargetUrl,
  configuredBaseUrl,
  getConfiguredBaseUrl,
  normalizePathname
};
