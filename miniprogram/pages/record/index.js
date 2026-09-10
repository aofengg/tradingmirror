var tradeOptions = require('../../config/trade-options');
var tradeService = require('../../services/trade-service');
var userService = require('../../services/user-service');
var toast = require('../../utils/toast');
var constants = require('../../config/constants');
var requestId = require('../../utils/request-id');
var share = require('../../utils/share');

Page({
  data: {
    stage: 'after',
    stageLabel: '记录操作',
    step: 1,
    recentSymbols: [],
    symbol: '',
    symbolInput: '',
    actions: tradeOptions.ACTIONS,
    action: '',
    actionLabel: '',
    reasons: [],
    saving: false,
    completed: false,
    createdEvent: null,
    planLabel: '',
    planStatus: '',
    restoredDraft: false,
    showRecordGuide: false,
    showCompletionGuide: false
  },

  onLoad: function (options) {
    share.enable();
    var stage = options.stage === 'before' ? 'before' : 'after';
    this.setData({
      stage: stage,
      stageLabel: stage === 'before' ? '操作前想一想' : '记录刚刚的操作'
    });
    this._restoreDraft(stage);
    this._loadRecentSymbols();
  },

  _restoreDraft: function (stage) {
    var draft = wx.getStorageSync(constants.STORAGE_KEYS.RECORD_DRAFT);
    if (!draft || draft.stage !== stage || !draft.symbol) return;
    var step = Math.min(3, Math.max(1, Number(draft.step) || 1));
    var action = draft.action || '';
    if (step > 1 && !action) step = 1;
    this.setData({
      step: step,
      symbol: draft.symbol,
      symbolInput: draft.symbol,
      action: action,
      actionLabel: action ? (tradeOptions.findOption(tradeOptions.ACTIONS, action) || {}).label || '' : '',
      reasons: action ? tradeOptions.getReasons(action) : [],
      restoredDraft: true
    });
  },

  _saveDraft: function () {
    wx.setStorageSync(constants.STORAGE_KEYS.RECORD_DRAFT, {
      stage: this.data.stage,
      step: this.data.step,
      symbol: this.data.symbol,
      action: this.data.action,
      savedAt: Date.now()
    });
  },

  clearDraft: function () {
    wx.removeStorageSync(constants.STORAGE_KEYS.RECORD_DRAFT);
    this.setData({
      step: 1,
      symbol: '',
      symbolInput: '',
      action: '',
      actionLabel: '',
      reasons: [],
      restoredDraft: false
    });
  },

  _loadRecentSymbols: function () {
    var self = this;
    getApp().waitForLogin().then(function () {
      return userService.getConfig();
    }).then(function (res) {
      if (res.success) self.setData({
        recentSymbols: res.data.recent_symbols || [],
        showRecordGuide: userService.hasGuideStep('welcome', res.data) && !userService.hasGuideStep('record_context', res.data)
      });
    }).catch(function () {});
  },

  chooseSymbol: function (event) {
    var symbol = event.currentTarget.dataset.symbol;
    this.setData({ symbol: symbol, symbolInput: symbol });
    this._submissionRequestId = '';
    this._saveDraft();
  },

  onSymbolInput: function (event) {
    var value = String(event.detail.value || '').trim().toUpperCase().slice(0, 12);
    this.setData({ symbol: value, symbolInput: value });
    this._submissionRequestId = '';
    this._saveDraft();
  },

  nextFromSymbol: function () {
    if (!this.data.symbol) return;
    if (this.data.showRecordGuide) this.dismissRecordGuide();
    this.setData({ step: 2 });
    this._saveDraft();
  },

  chooseAction: function (event) {
    var action = event.currentTarget.dataset.action;
    var actionOption = tradeOptions.findOption(tradeOptions.ACTIONS, action);
    this.setData({
      action: action,
      actionLabel: actionOption ? actionOption.label : '',
      reasons: tradeOptions.getReasons(action),
      step: 3
    });
    this._submissionRequestId = '';
    this._saveDraft();
  },

  chooseReason: function (event) {
    if (this.data.saving) return;
    var reasonKey = event.currentTarget.dataset.reason;
    var reason = tradeOptions.findOption(this.data.reasons, reasonKey);
    if (!reason) return;
    this.setData({ saving: true });
    if (!this._submissionRequestId) this._submissionRequestId = requestId.create('event');
    var self = this;
    getApp().waitForLogin().then(function () {
      return tradeService.createTradeEvent({
        symbol: self.data.symbol,
        action: self.data.action,
        reasonKey: reasonKey,
        stage: self.data.stage,
        clientRequestId: self._submissionRequestId
      });
    }).then(function (res) {
      if (!res.success) throw new Error(res.error || 'SAVE_FAILED');
      self.setData({
        saving: false,
        completed: true,
        createdEvent: res.data,
        planStatus: res.data.plan_status,
        planLabel: tradeService.labels.plans[res.data.plan_status],
        showCompletionGuide: userService.hasGuideStep('welcome') && !userService.hasGuideStep('record_complete')
      });
      wx.removeStorageSync(constants.STORAGE_KEYS.RECORD_DRAFT);
      self._submissionRequestId = '';
      getApp().invalidatePages(['today', 'records', 'review']);
    }).catch(function (error) {
      console.error('保存操作失败', error);
      self.setData({ saving: false });
      toast.showError('暂时没记下，请重试');
    });
  },

  correctPlanStatus: function () {
    var self = this;
    if (!self.data.createdEvent) return;
    var statuses = ['planned', 'impulsive', 'uncertain'];
    wx.showActionSheet({
      itemList: ['按原计划', '临时决定', '不确定'],
      success: function (sheetRes) {
        var next = statuses[sheetRes.tapIndex];
        if (!next || next === self.data.planStatus) return;
        tradeService.updatePlanStatus(self.data.createdEvent._id, next).then(function (res) {
          if (!res.success) { toast.showError('更正失败'); return; }
          self.setData({ planStatus: next, planLabel: tradeService.labels.plans[next] });
        });
      }
    });
  },

  onSupplementSaved: function (event) {
    this.setData({ createdEvent: Object.assign({}, this.data.createdEvent, event.detail) });
  },

  dismissRecordGuide: function () {
    this.setData({ showRecordGuide: false });
    userService.markGuideStep('record_context');
  },

  dismissCompletionGuide: function () {
    this.setData({ showCompletionGuide: false });
    userService.markGuideStep('record_complete');
  },

  previousStep: function () {
    if (this.data.step <= 1) { wx.navigateBack(); return; }
    this.setData({ step: this.data.step - 1 });
    this._saveDraft();
  },

  finish: function () {
    if (this.data.showCompletionGuide) this.dismissCompletionGuide();
    wx.navigateBack();
  },

  onShareAppMessage: function () {
    return share.appMessage('交易留痕｜用 10 秒记下这次决定');
  },

  onShareTimeline: function () {
    return share.timeline('交易留痕｜用 10 秒记下这次决定');
  }
});
