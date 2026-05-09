const ERR_PROGRAMMATIC = -100;
const ERR_FORBIDDEN = -403;

function createError(code, msg, extra = {}) {
  const err = new Error(msg);
  err.code = code;
  err.msg = msg;
  err.extra = extra;
  return err;
}

function programmatic(msg, extra = {}) {
  return createError(ERR_PROGRAMMATIC, msg, extra);
}

function forbidden(msg, extra = {}) {
  return createError(ERR_FORBIDDEN, msg, extra);
}

module.exports = {
  ERR_PROGRAMMATIC,
  ERR_FORBIDDEN,
  createError,
  forbidden,
  programmatic
};
