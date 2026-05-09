const meta = require('./meta.json');

module.exports = {
  CORE_VERSION: meta.version,
  ...require('./client.cjs'),
  ...require('./errors.cjs'),
  ...require('./expense-docs.cjs'),
  ...require('./safety.cjs')
};
