var tradeService = require('../../services/trade-service');
var tradeOptions = require('../../config/trade-options');
var toast = require('../../utils/toast');
var requestId = require('../../utils/request-id');
var userService = require('../../services/user-service');
var share = require('../../utils/share');

Page({
  data: {
    id: '',
    loading: true,
    event: null,
    reflections: [],
    feelings: tradeOptions.FEELINGS,
    regretReasons: tradeOptions.REGRET_REASONS,
    feeling: '',
    saving: false,
    completed: false,
    eventSupplementExpanded: false,
    showReflectionGuide: false,
    sharedEntry: false
  },

  onLoad: function (options) {
    share.enable();
    var id = options.id || '';
    if (!id) {
      this.setData({ id: '', loading: false, sharedEntry: true });
      return;
    }
    this.setData({ id: id });
    this._loadEvent();
  },

  _loadEvent: function () {
    var self = this;
    getApp().waitForLogin().then(function () {
      return Promise.all([
        tradeService.getEvent(self.data.id),
        tradeService.getReflectionsForTrade(self.data.id),
        userService.getConfig()
      ]);
    }).then(function (results) {
      if (!results[0].success || !results[1].success) throw new Error('LOAD_FAILED');
      self.setData({
        loading: false,
        event: results[0].data,
        reflections: results[1].data,
        showReflectionGuide: results[2].success && userService.hasGuideStep('welcome', results[2].data) && !userService.hasGuideStep('reflection_context', results[2].data)
      });
    }).catch(function () {
      self.setData({ loading: false });
      toast.showError('这条记录暂时打不开');
    });
  },

  chooseFeeling: function (event) {
    var feeling = event.currentTarget.dataset.feeling;
    this.setData({ feeling: feeling });
    if (feeling !== 'regret') this._save(feeling, '');
  },

  chooseRegretReason: function (event) {
    this._save('regret', event.currentTarget.dataset.reason);
  },

  _save: function (feeling, regretReason) {
    if (this.data.saving) return;
    var self = this;
    if (!self._submissionRequestId) self._submissionRequestId = requestId.create('reflection');
    self.setData({ saving: true });
    tradeService.addReflection(self.data.id, feeling, regretReason, self._submissionRequestId).then(function (res) {
      if (!res.success) throw new Error(res.error || 'SAVE_FAILED');
      var snapshot = Object.assign({}, res.data, { relative_label: '刚刚' });
      self.setData({
        saving: false,
        completed: true,
        feeling: feeling,
        reflections: [snapshot].concat(self.data.reflections),
        showReflectionGuide: false
      });
      userService.markGuideStep('reflection_context');
      getApp().invalidatePages(['today', 'records', 'review']);
      self._submissionRequestId = '';
    }).catch(function () {
      self.setData({ saving: false });
      toast.showError('暂时没记下，请重试');
    });
  },

  finish: function () {
    wx.navigateBack();
  },

  dismissReflectionGuide: function () {
    this.setData({ showReflectionGuide: false });
    userService.markGuideStep('reflection_context');
  },

  toggleEventSupplement: function () {
    this.setData({ eventSupplementExpanded: !this.data.eventSupplementExpanded });
  },

  openEventSupplementEditor: function () {
    var editor = this.selectComponent('#eventSupplementEditor');
    if (editor) editor.open();
  },

  previewEventAttachment: function (event) {
    var current = event.currentTarget.dataset.src;
    var urls = (this.data.event.attachments || []).map(function (item) { return item.file_id; }).filter(Boolean);
    if (current && urls.length) wx.previewImage({ current: current, urls: urls });
  },

  previewReflectionAttachment: function (event) {
    var current = event.currentTarget.dataset.src;
    var reflectionId = event.currentTarget.dataset.reflectionId;
    var reflection = this.data.reflections.filter(function (item) { return item._id === reflectionId; })[0];
    var urls = reflection ? (reflection.attachments || []).map(function (item) { return item.file_id; }).filter(Boolean) : [];
    if (current && urls.length) wx.previewImage({ current: current, urls: urls });
  },

  onEventSupplementSaved: function (event) {
    this.setData({
      event: Object.assign({}, this.data.event, event.detail),
      eventSupplementExpanded: true
    });
  },

  onReflectionSupplementSaved: function (event) {
    var list = this.data.reflections.slice();
    if (list.length) list[0] = Object.assign({}, list[0], event.detail);
    this.setData({ reflections: list });
  },

  cancelRegret: function () {
    this.setData({ feeling: '' });
  },

  goHome: function () {
    wx.switchTab({ url: '/pages/today/index' });
  },

  onShareAppMessage: function () {
    return share.appMessage('交易留痕｜过后再看，感受可能不同');
  },

  onShareTimeline: function () {
    return share.timeline('交易留痕｜过后再看，感受可能不同');
  }
});
