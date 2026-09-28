var attachment = require('../../utils/attachment');
var cloudApi = require('../../utils/cloud-api');

var ERROR_MESSAGES = {
  IMAGE_FILE_READ_FAILED: '图片读取失败，请重新选择',
  IMAGE_COMPRESS_FAILED: '图片处理失败，请重新选择',
  IMAGE_TOO_LARGE: '图片压缩后仍超过5MB',
  IMAGE_UPLOAD_FAILED: '图片上传失败，请检查网络',
  IMAGE_UPLOAD_INVALID_RESPONSE: '图片上传异常，请重试',
  CLOUD_FUNCTION_CALL_FAILED: '连接云端失败，请检查网络',
  NOT_FOUND: '记录已变化，请返回后重试',
  VALIDATION_ERROR: '补充内容有误，请重新选择',
  DATABASE_READ_FAILED: '读取记录失败，请稍后重试',
  DATABASE_WRITE_FAILED: '内容写入失败，请稍后重试',
  FUNCTION_TIMEOUT: '保存超时，请稍后重试',
  CLOUD_INTERNAL_ERROR: '云端保存异常，请稍后重试',
  CLOUD_WRITE_FAILED: '内容保存失败，请稍后重试',
  SUPPLEMENT_SAVE_FAILED: '内容保存失败，请稍后重试'
};

function saveError(response) {
  var code = response.error_code || response.error || 'SUPPLEMENT_SAVE_FAILED';
  var error = new Error(code);
  error.code = code;
  error.stage = 'save';
  error.detail = response.error_detail || '';
  error.platformCode = response.platform_code || '';
  error.traceId = response.trace_id || '';
  return error;
}

function normalizedError(error) {
  var rawCode = error && (error.code || error.message);
  var code = rawCode;
  if (!ERROR_MESSAGES[code]) code = 'SUPPLEMENT_SAVE_FAILED';
  return {
    code: code,
    stage: (error && error.stage) || 'unknown',
    detail: String((error && error.detail) || (rawCode !== code ? rawCode : '') || '').slice(0, 300),
    platformCode: (error && error.platformCode) || '',
    traceId: (error && error.traceId) || ''
  };
}

function showFailure(failure) {
  var needsTrace = failure.traceId || /^DATABASE_|^FUNCTION_|^CLOUD_INTERNAL/.test(failure.code);
  if (!needsTrace) {
    wx.showToast({ title: ERROR_MESSAGES[failure.code], icon: 'none' });
    return;
  }
  var lines = [ERROR_MESSAGES[failure.code], '错误码：' + failure.code];
  if (failure.platformCode) lines.push('平台码：' + failure.platformCode);
  if (failure.traceId) lines.push('追踪编号：' + failure.traceId);
  wx.showModal({
    title: '内容保存失败',
    content: lines.join('\n'),
    showCancel: false,
    confirmText: '知道了'
  });
}

Component({
  properties: {
    entityType: { type: String, value: '' },
    entityId: { type: String, value: '' },
    note: { type: String, value: '' },
    attachments: { type: Array, value: [] },
    triggerText: { type: String, value: '' },
    sheetTitle: { type: String, value: '' },
    placeholder: { type: String, value: '' },
    hideTrigger: { type: Boolean, value: false }
  },

  data: {
    expanded: false,
    draftNote: '',
    draftAttachments: [],
    saving: false,
    maxCount: attachment.MAX_IMAGE_COUNT
  },

  methods: {
    open: function () {
      var list = (this.properties.attachments || []).map(function (item) {
        return Object.assign({}, item, { preview_url: item.file_id });
      });
      this.setData({
        expanded: true,
        draftNote: this.properties.note || '',
        draftAttachments: list
      });
    },

    close: function () {
      if (this.data.saving) return;
      this.setData({ expanded: false });
    },

    stop: function () {},

    onNoteInput: function (event) {
      this.setData({ draftNote: event.detail.value });
    },

    chooseImages: function () {
      var self = this;
      var remain = attachment.MAX_IMAGE_COUNT - self.data.draftAttachments.length;
      if (remain <= 0) return;
      wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed']
      }).then(function (res) {
        var additions = (res.tempFiles || []).map(function (file) {
          return {
            local: true,
            temp_path: file.tempFilePath,
            preview_url: file.tempFilePath,
            size_bytes: Number(file.size || 0)
          };
        });
        self.setData({ draftAttachments: self.data.draftAttachments.concat(additions).slice(0, attachment.MAX_IMAGE_COUNT) });
      }).catch(function () {});
    },

    removeImage: function (event) {
      var index = Number(event.currentTarget.dataset.index);
      var list = this.data.draftAttachments.slice();
      list.splice(index, 1);
      this.setData({ draftAttachments: list });
    },

    save: function () {
      var self = this;
      if (self.data.saving || !self.properties.entityId) return;
      self.setData({ saving: true });
      var existing = self.data.draftAttachments.filter(function (item) { return !item.local; });
      var local = self.data.draftAttachments.filter(function (item) { return item.local; });
      var uploaded = [];
      Promise.all(local.map(function (file) {
        return attachment.upload({ tempFilePath: file.temp_path, size: file.size_bytes }, {
          entityType: self.properties.entityType,
          entityId: self.properties.entityId
        }).then(function (item) {
          uploaded.push(item);
          return item;
        });
      })).then(function (newItems) {
        var finalItems = existing.concat(newItems);
        return cloudApi.call('saveSupplement', {
          entity_type: self.properties.entityType,
          entity_id: self.properties.entityId,
          optional_note: self.data.draftNote,
          attachments: finalItems
        }).then(function (res) {
          if (!res.success) throw saveError(res);
          var saved = res.data;
          self.setData({ saving: false, expanded: false, draftAttachments: saved.attachments || [] });
          self.triggerEvent('saved', saved);
          wx.showToast({ title: '补充已保存', icon: 'success' });
        });
      }).catch(function (error) {
        var failure = normalizedError(error);
        attachment.cleanup(uploaded);
        self.setData({ saving: false });
        console.error('[optional-supplement] save failed', {
          error_code: failure.code,
          stage: failure.stage,
          detail: failure.detail,
          platform_code: failure.platformCode,
          trace_id: failure.traceId,
          entity_type: self.properties.entityType,
          entity_id: self.properties.entityId,
          local_image_count: local.length
        });
        showFailure(failure);
      });
    }
  }
});
