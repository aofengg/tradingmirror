var attachment = require('../../utils/attachment');
var cloudApi = require('../../utils/cloud-api');

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
          if (!res.success) throw new Error(res.error || 'SAVE_FAILED');
          var saved = res.data;
          self.setData({ saving: false, expanded: false, draftAttachments: saved.attachments || [] });
          self.triggerEvent('saved', saved);
          wx.showToast({ title: '补充已保存', icon: 'success' });
        });
      }).catch(function (error) {
        attachment.cleanup(uploaded);
        self.setData({ saving: false });
        wx.showToast({
          title: error && error.message === 'IMAGE_TOO_LARGE' ? '图片压缩后仍超过5MB' : '暂时没保存，请重试',
          icon: 'none'
        });
      });
    }
  }
});
