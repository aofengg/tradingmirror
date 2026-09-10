var requestId = require('./request-id');

var MAX_IMAGE_COUNT = 3;
var MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function stat(path) {
  return new Promise(function (resolve, reject) {
    wx.getFileSystemManager().stat({
      path: path,
      success: function (res) { resolve(res.stats); },
      fail: reject
    });
  });
}

function compress(file) {
  var originalSize = Number(file.size || 0);
  if (originalSize && originalSize <= 900 * 1024) {
    return Promise.resolve({ path: file.tempFilePath, size: originalSize });
  }
  var quality = originalSize > 4 * 1024 * 1024 ? 55 : 72;
  return new Promise(function (resolve, reject) {
    wx.compressImage({
      src: file.tempFilePath,
      quality: quality,
      success: function (res) {
        stat(res.tempFilePath).then(function (info) {
          resolve({ path: res.tempFilePath, size: Number(info.size || 0) });
        }).catch(reject);
      },
      fail: reject
    });
  }).then(function (result) {
    if (result.size > MAX_IMAGE_BYTES) throw new Error('IMAGE_TOO_LARGE');
    return result;
  });
}

function extension(path) {
  var match = String(path || '').match(/\.([a-zA-Z0-9]{2,5})(?:\?|$)/);
  var value = match ? match[1].toLowerCase() : 'jpg';
  return value === 'jpeg' || value === 'png' || value === 'gif' || value === 'webp' ? value : 'jpg';
}

function upload(file, options) {
  return compress(file).then(function (compressed) {
    var now = new Date();
    var month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    var cloudPath = [
      'trade-attachments',
      month,
      options.entityType,
      options.entityId,
      requestId.create('image') + '.' + extension(compressed.path)
    ].join('/');
    return wx.cloud.uploadFile({ cloudPath: cloudPath, filePath: compressed.path }).then(function (res) {
      return {
        file_id: res.fileID,
        cloud_path: cloudPath,
        size_bytes: compressed.size,
        media_type: 'image',
        uploaded_at: new Date()
      };
    });
  });
}

function cleanup(items) {
  var fileList = (items || []).map(function (item) { return item.file_id; }).filter(Boolean);
  if (!fileList.length) return Promise.resolve();
  return wx.cloud.deleteFile({ fileList: fileList }).catch(function () {});
}

module.exports = {
  MAX_IMAGE_COUNT: MAX_IMAGE_COUNT,
  MAX_IMAGE_BYTES: MAX_IMAGE_BYTES,
  upload: upload,
  cleanup: cleanup
};
