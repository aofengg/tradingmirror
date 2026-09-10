function create(prefix) {
  var random = Math.random().toString(36).slice(2, 10);
  return String(prefix || 'request') + '_' + Date.now().toString(36) + '_' + random;
}

module.exports = { create: create };
