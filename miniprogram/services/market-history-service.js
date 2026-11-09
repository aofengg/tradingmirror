var history = require('../utils/market-history');

var folder = 'cloud://cloud1-d0gjfc19ve571942b.636c-cloud1-d0gjfc19ve571942b-1481534747/market-chronicle/';
var storageKey = 'market_history_ixic_v1:' + folder;
var checkedAt = 0;
var current;
var pending;
var lastResult;

function cachedEntry() {
  if (current !== undefined) return current;
  current = null;
  try {
    var entry = wx.getStorageSync(storageKey);
    if (entry && history.validPack(entry.manifest, entry.pack)) current = entry;
  } catch (_) {}
  return current;
}

function snapshot() {
  return lastResult && lastResult.manifestMissing ? null : cachedEntry();
}

function readJson(name, limit) {
  return wx.cloud.downloadFile({fileID: folder + name}).then(function(result) {
    if (!result.tempFilePath) throw Object.assign(new Error('MARKET_FILE_UNAVAILABLE'), result);
    var fs = wx.getFileSystemManager();
    var stat = fs.statSync(result.tempFilePath);
    if (stat.size > limit) throw new Error('MARKET_FILE_TOO_LARGE');
    return JSON.parse(fs.readFileSync(result.tempFilePath, 'utf8').replace(/^\uFEFF/, ''));
  });
}

function readManifest() {
  return readJson('manifest.json', 4096).catch(function(error) {
    // WeChat's download API can hide the per-file status behind an empty URL error.
    if (!/empty download url/i.test(String(error && (error.errMsg || error.message) || ''))) throw error;
    return wx.cloud.getTempFileURL({fileList:[folder + 'manifest.json']}).then(function(result) {
      var file = result.fileList && result.fileList[0];
      if (file && file.errMsg === 'STORAGE_FILE_NONEXIST') throw file;
      throw error;
    }, function() { throw error; });
  });
}

function refresh(force) {
  var cached = cachedEntry();
  if (pending) return pending;
  if (!force && Date.now() - checkedAt < 300000) return Promise.resolve(lastResult);
  var readingManifest = true;
  pending = Promise.resolve().then(readManifest).then(function(manifest) {
    if (!history.validManifest(manifest)) throw new Error('MARKET_MANIFEST_INVALID');
    if (cached && cached.manifest.file === manifest.file) return cached;
    readingManifest = false;
    return readJson(manifest.file, 2 * 1024 * 1024).then(function(pack) {
      if (!history.validPack(manifest, pack)) throw new Error('MARKET_HISTORY_INVALID');
      return {manifest: manifest, pack: pack};
    });
  }).then(function(entry) {
    checkedAt = Date.now();
    current = entry;
    if (entry !== cached) {
      try { wx.setStorageSync(storageKey, entry); } catch (_) {}
    }
    return {entry: entry};
  }).catch(function(error) {
    // Cloud Storage can report a missing object as STORAGE_FILE_NONEXIST or NoSuchKey.
    var description = error ? [error.code, error.errCode, error.errMsg, error.message].join(' ') : '';
    var absent = readingManifest && (Number(error && error.statusCode) === 404 || /STORAGE_FILE_NONEXIST|NoSuchKey|file (does not exist|not exist|not found)/i.test(description));
    if (absent) checkedAt = Date.now();
    if (absent || (lastResult && lastResult.manifestMissing)) return {entry: null, manifestMissing: true};
    return {entry: cached, failed: true};
  }).then(function(result) {
    pending = null;
    lastResult = result;
    return result;
  });
  return pending;
}

module.exports = {snapshot: snapshot, refresh: refresh};
