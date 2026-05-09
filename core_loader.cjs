const path = require('path');

const CANDIDATES = [
  path.join(__dirname, '..', 'hesi-openapi-core', 'index.cjs'),
  path.join(__dirname, 'vendor', 'hesi-openapi-core', 'index.cjs')
];

function loadCore() {
  const errors = [];
  for (const candidate of CANDIDATES) {
    try {
      return require(candidate);
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND') throw err;
      errors.push(candidate);
    }
  }

  const err = new Error(`Cannot find hesi-openapi-core. Tried: ${errors.join(', ')}`);
  err.code = 'CORE_NOT_FOUND';
  throw err;
}

module.exports = loadCore();
