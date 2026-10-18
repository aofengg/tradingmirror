// Short-lived, account/revision-scoped reads. Failed reads are never retained.
var entries = {};
function ordered(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== 'object') return value;
  var out = {};
  Object.keys(value).sort().forEach(function (key) { out[key] = ordered(value[key]); });
  return out;
}
function clone(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  var out = {};
  Object.keys(value).forEach(function (key) { out[key] = clone(value[key]); });
  return out;
}
function read(name, options, load, ttl) {
  var app = typeof getApp === 'function' ? getApp() : null;
  if (!app || !app.globalData || !app.globalData.openid) return Promise.resolve().then(load);
  var key = JSON.stringify([app.globalData.openid, app.getPageRevision('records'), app.getPageRevision('review'),
    new Date(Date.now() + 8 * 3600000).toISOString().slice(0,10), name, ordered(options)]);
  var entry = entries[key];
  if (entry && !entry.pending && Date.now() - entry.at >= (ttl || 30000)) entry = null;
  if (!entry) {
    if (Object.keys(entries).length >= 80) entries = {};
    entry = {pending:true};
    entries[key] = entry;
    entry.promise = Promise.resolve().then(load).then(function (result) {
      if (!result || result.success !== true) { if (entries[key] === entry) delete entries[key]; }
      entry.pending = false; entry.at = Date.now();
      return clone(result);
    }).catch(function (error) { if (entries[key] === entry) delete entries[key]; throw error; });
  }
  return entry.promise.then(clone);
}
module.exports = {read:read, clear:function () { entries = {}; }};
