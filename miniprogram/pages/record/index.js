var assetService = require('../../services/asset-service');
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
    assetKey: '',
    finishLabel: '完成记录',
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
    showCompletionGuide: false,
    showCompletionContext: false,
    currentReviewReminder: ''
  },

  onLoad: function (options) {
    this._destroyed=false;
    share.enable();
    var stage = options.stage === 'before' ? 'before' : 'after';
    this.setData({
      stage: stage,
      stageLabel: stage === 'before' ? '操作前想一想' : '记录刚刚的操作'
    });
    this._fromAsset = options.fromAsset === '1';
    var pages = getCurrentPages(); var previous = pages[pages.length - 2];
    this.setData({finishLabel:this._fromAsset ? '返回个股历史' : previous && previous.route === 'pages/records/index' ? '返回记录' : '回到今日'});
    if (options.assetKey) this._prefillAsset(options.assetKey, stage);
    else this._restoreDraft(stage);
    this._loadRecentSymbols();
  },

  _parseAssetKey: function (key) {
    try { var parts; try { parts=JSON.parse(key); } catch (e) { parts=JSON.parse(decodeURIComponent(key)); } if(parts.length===3 && parts.every(function(v){return typeof v==='string' && v.length>0;}))return {market:parts[0],asset_type:parts[1],symbol:parts[2]}; } catch(e) {}
    return null;
  },

  _prefillAsset: function (key,stage) {
    var identity=this._parseAssetKey(key); if(!identity){this._restoreDraft(stage);return;}
    key=JSON.stringify([identity.market,identity.asset_type,identity.symbol]);
    var self=this;var draft=wx.getStorageSync(constants.STORAGE_KEYS.RECORD_DRAFT);
    function apply(){self.setData({symbol:identity.symbol,symbolInput:identity.symbol,assetKey:key,step:2});self._saveDraft();}
    if(draft && draft.symbol){
      wx.showModal({title:'还有一份未完成的记录',content:draft.symbol+' 的草稿尚未保存。继续原草稿，或放弃它并新建这次记录。',confirmText:'继续草稿',cancelText:'放弃并新建',success:function(result){
        if(result.confirm){var oldStage=draft.stage==='before'?'before':'after';self.setData({stage:oldStage,stageLabel:oldStage==='before'?'操作前想一想':'记录刚刚的操作'});self._restoreDraft(oldStage);}
        else if(result.cancel){wx.removeStorageSync(constants.STORAGE_KEYS.RECORD_DRAFT);apply();}
      }});
    } else apply();
  },

  _restoreDraft: function (stage) {
    var draft = wx.getStorageSync(constants.STORAGE_KEYS.RECORD_DRAFT);
    if (!draft || !draft.symbol) return;
    if(draft.stage!==stage){
      var self=this;
      wx.showModal({title:'还有一份未完成的记录',content:'继续 '+draft.symbol+' 的原草稿，或放弃它并重新开始。',confirmText:'继续草稿',cancelText:'重新开始',success:function(answer){
        if(answer.confirm){var oldStage=draft.stage==='before'?'before':'after';self.setData({stage:oldStage,stageLabel:oldStage==='before'?'操作前想一想':'记录刚刚的操作'});self._restoreDraft(oldStage);}
        else if(answer.cancel)self.clearDraft();
      }});
      return;
    }
    var step = Math.min(3, Math.max(1, Number(draft.step) || 1));
    this._draftId=draft.draftId || '';
    this._submissionRequestId=draft.submissionRequestId || '';
    this._submissionReason=draft.submissionReason || '';
    var action = draft.action || '';
    if (step === 3 && !action) step = 2;
    this.setData({
      step: step,
      symbol: draft.symbol,
      symbolInput: draft.symbol,
      assetKey: draft.assetKey || '',
      action: action,
      actionLabel: action ? (tradeOptions.findOption(tradeOptions.ACTIONS, action) || {}).label || '' : '',
      reasons: action ? tradeOptions.getReasons(action) : [],
      restoredDraft: true
    });
  },

  _saveDraft: function () {
    clearTimeout(this._draftTimer); this._draftTimer=null;
    if (this.data.completed) return;
    if(!this._draftId)this._draftId=requestId.create('draft');
    wx.setStorageSync(constants.STORAGE_KEYS.RECORD_DRAFT, {
      draftId: this._draftId,
      submissionRequestId: this._submissionRequestId || '',
      submissionReason: this._submissionReason || '',
      stage: this.data.stage,
      step: this.data.step,
      symbol: this.data.symbol,
      assetKey: this.data.assetKey,
      action: this.data.action,
      savedAt: Date.now()
    });
  },

  clearDraft: function () {
    if(this.data.saving)return;
    clearTimeout(this._draftTimer); this._draftTimer=null;
    wx.removeStorageSync(constants.STORAGE_KEYS.RECORD_DRAFT);
    this._draftId='';this._submissionRequestId='';this._submissionReason='';
    this.setData({
      step: 1,
      symbol: '',
      symbolInput: '',
      assetKey: '',
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
      if(self._destroyed)return;
      if (res.success) self.setData({
        recentSymbols: res.data.recent_symbols || [],
        showRecordGuide: userService.hasGuideStep('welcome', res.data) && !userService.hasGuideStep('record_context', res.data)
      });
      if(res.success)self._updateReviewReminder(res.data.current_focus);
    }).catch(function () {});
  },

  chooseSymbol: function (event) {
    if (this.data.step !== 1 || this.data.saving) return;
    var symbol = event.currentTarget.dataset.symbol;
    this.setData({ symbol: symbol, symbolInput: symbol, assetKey:'' });
    this._submissionRequestId = '';
    this._saveDraft();
    this.nextFromSymbol();
  },

  onSymbolInput: function (event) {
    var value = String(event.detail.value || '').trim().toUpperCase().slice(0, 12);
    if (value === this.data.symbol) return;
    this.setData({ symbol: value, symbolInput: value,assetKey:'' });
    this._submissionRequestId = '';
    clearTimeout(this._draftTimer);
    var self=this;
    this._draftTimer=setTimeout(function(){self._draftTimer=null;self._saveDraft();},180);
  },

  onHide: function () { this._flushDraft(); },
  onUnload: function () { this._flushDraft();this._destroyed=true; },
  _flushDraft: function () {
    if (!this._draftTimer) return;
    clearTimeout(this._draftTimer); this._draftTimer=null;
    if (!this.data.completed) this._saveDraft();
  },

  nextFromSymbol: function () {
    if (!this.data.symbol || this.data.step !== 1 || this.data.saving) return;
    wx.hideKeyboard();
    if (this.data.showRecordGuide) this.dismissRecordGuide();
    this.setData({ step: 2 });
    this._saveDraft();
  },

  chooseAction: function (event) {
    if(this.data.step!==2||this.data.saving||this.data.completed)return;
    var action = event.currentTarget.dataset.action;
    var actionOption = tradeOptions.findOption(tradeOptions.ACTIONS, action);
    this.setData({
      action: action,
      actionLabel: actionOption ? actionOption.label : '',
      reasons: tradeOptions.getReasons(action),
      step: 3
    });
    this._submissionRequestId = '';
    this._updateReviewReminder((userService.getCachedConfig()||{}).current_focus);
    this._saveDraft();
  },

  _updateReviewReminder: function (focus) {
    var applicable=this.data.stage==='before'&&focus&&focus.kind==='review'&&Array.isArray(focus.actions)&&focus.actions.indexOf(this.data.action)!==-1;
    this.setData({currentReviewReminder:applicable?focus.text||focus.label||'':''});
  },

  chooseReason: function (event) {
    if (this.data.saving || this.data.completed || this.data.step!==3) return;
    var reasonKey = event.currentTarget.dataset.reason;
    var reason = tradeOptions.findOption(this.data.reasons, reasonKey);
    if (!reason) return;
    this.setData({ saving: true });
    if (!this._submissionRequestId || this._submissionReason!==reasonKey) this._submissionRequestId = requestId.create('event');
    this._submissionReason=reasonKey;
    this._saveDraft();
    var submittedDraftId=this._draftId,submittedRequestId=this._submissionRequestId;
    var self = this;
    var explicitKey = this.data.assetKey;
    var symbol = this.data.symbol;
    var owner = getApp().globalData && getApp().globalData.openid;
    function active() { return !self._destroyed && owner === (getApp().globalData && getApp().globalData.openid); }
    var payload={action:this.data.action,reasonKey:reasonKey,stage:this.data.stage,clientRequestId:submittedRequestId};
    getApp().waitForLogin().then(function () {
      owner = owner || (getApp().globalData && getApp().globalData.openid);
      if (!active()) throw Error('ASSET_CANCELLED');
      if (explicitKey) return [Object.assign(self._parseAssetKey(explicitKey),{key:explicitKey})];
      return assetService.resolveEntries([symbol],active);
    }).then(function(entries) {
      if (!active()) throw Error('ASSET_CANCELLED');
      var identity=entries[0];
      return tradeService.createTradeEvent(Object.assign(payload,{symbol:identity?identity.symbol:symbol,
        market:identity&&identity.market,assetType:identity&&identity.asset_type,assetKey:identity&&identity.key}));
    }).then(function (res) {
      if (!res.success) throw new Error(res.error || 'SAVE_FAILED');
      var draft=wx.getStorageSync(constants.STORAGE_KEYS.RECORD_DRAFT);
      if(draft && draft.draftId===submittedDraftId && draft.submissionRequestId===submittedRequestId)wx.removeStorageSync(constants.STORAGE_KEYS.RECORD_DRAFT);
      getApp().invalidatePages(['today', 'records', 'review']);
      if(self._destroyed)return;
      self.setData({
        saving: false,
        completed: true,
        createdEvent: res.data,
        planStatus: res.data.plan_status,
        planLabel: tradeService.labels.plans[res.data.plan_status],
        showCompletionGuide: userService.hasGuideStep('welcome') && !userService.hasGuideStep('record_complete')
      });
      self._submissionRequestId = '';
    }).catch(function (error) {
      if(self._destroyed)return;
      self.setData({ saving: false });
      if (error.message === 'ASSET_CANCELLED') return;
      console.error('保存操作失败', error);
      toast.showError('暂时没记下，请重试');
    });
  },

  toggleCompletionContext: function () { var history=this.selectComponent('#relatedHistory');if(history)history.open(); },

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
          getApp().invalidatePages(['today','records','review']);
        });
      }
    });
  },

  onSupplementSaved: function (event) {
    this.setData({ createdEvent: Object.assign({}, this.data.createdEvent, event.detail) });
    getApp().invalidatePages(['today','records','review']);
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
    if(this.data.saving)return;
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

  openBatchRecord: function () {
    this._flushDraft();
    wx.navigateTo({url:'/pages/batch-record/index?stage='+this.data.stage});
  },

  onShareTimeline: function () {
    return share.timeline('交易留痕｜用 10 秒记下这次决定');
  }
});
