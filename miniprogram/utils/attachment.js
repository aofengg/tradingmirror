var requestId = require('./request-id');

var MAX_IMAGE_COUNT = 3;
var MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function errorDetail(error) {
  if (!error) return '';
  return String(error.errMsg || error.message || error.errCode || '').slice(0, 300);
}

function createError(code, stage, cause) {
  var error = new Error(code);
  error.code = code;
  error.stage = stage;
  error.detail = errorDetail(cause);
  error.platformCode = cause && cause.errCode ? String(cause.errCode) : '';
  return error;
}

function stat(path) {
  return new Promise(function (resolve, reject) {
    wx.getFileSystemManager().stat({
      path: path,
      success: function (res) { resolve(res.stats); },
      fail: function (error) { reject(createError('IMAGE_FILE_READ_FAILED', 'read', error)); }
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
      fail: function (error) { reject(createError('IMAGE_COMPRESS_FAILED', 'compress', error)); }
    });
  }).then(function (result) {
    if (result.size > MAX_IMAGE_BYTES) throw createError('IMAGE_TOO_LARGE', 'compress');
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
      if (!res || !res.fileID) throw createError('IMAGE_UPLOAD_INVALID_RESPONSE', 'upload');
      return {
        file_id: res.fileID,
        cloud_path: cloudPath,
        size_bytes: compressed.size,
        media_type: 'image',
        uploaded_at: new Date()
      };
    }).catch(function (error) {
      if (error && error.code) throw error;
      throw createError('IMAGE_UPLOAD_FAILED', 'upload', error);
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
