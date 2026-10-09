var assetService = require('../../services/asset-service');
var tradeService = require('../../services/trade-service');
var tradeOptions = require('../../config/trade-options');
var toast = require('../../utils/toast');
var requestId = require('../../utils/request-id');
var userService = require('../../services/user-service');
var share = require('../../utils/share');

function reflectionPresentation(item) {
  var keys = { satisfied: true, acceptable: true, regret: true };
  var legacy = { '满意': 'satisfied', '可接受': 'acceptable', '可以接受': 'acceptable', '懊悔': 'regret' };
  var key = keys[item.feeling] === true ? item.feeling : legacy[item.feeling_label];
  return Object.assign({}, item, { feeling_key: keys[key] === true ? key : 'unknown' });
}

Page({
  data: {
    id: '',
    loading: true,
    event: null,
    canReview: false,
    reflections: [],
    feelings: tradeOptions.FEELINGS,
    regretReasons: tradeOptions.REGRET_REASONS,
    feeling: '',
    saving: false,
    completed: false,
    eventSupplementExpanded: false,
    showReflectionGuide: false,
    sharedEntry: false,
    mode: 'detail', historyExpanded: false, contextExpanded: false, loadError: false, reviewFromDetail: false
  },

  onLoad: function (options) {
    share.enable();
    var id = options.id || '';
    if (!id) {
      this.setData({ id: '', loading: false, sharedEntry: true });
      return;
    }
    this._version=0;this._alive=true;
    this.setData({ id: id, mode: options.mode === 'review' ? 'review' : 'detail', historyExpanded:options.mode!=='review', eventSupplementExpanded:options.mode!=='review' });
    this._setTitle();
    this._loadEvent();
  },

  _loadEvent: function () {
    var self = this;
    var version=++this._version;
    var revision=getApp().getPageRevision('records');
    self.setData({loading:!self.data.event,loadError:false});
    getApp().waitForLogin().then(function () {
      return Promise.all([
        tradeService.getEvent(self.data.id),
        tradeService.getReflectionsForTrade(self.data.id),
        userService.getConfig()
      ]);
    }).then(function (results) {
      if(!self._alive||version!==self._version)return;
      if (!results[0].success || !results[1].success) throw new Error('LOAD_FAILED');
      if(!results[0].data)throw new Error('NOT_FOUND');
      self.setData({
        loading: false,
        event: results[0].data,
        canReview: tradeOptions.canReview(results[0].data.execution_status),
        mode: tradeOptions.canReview(results[0].data.execution_status) ? self.data.mode : 'detail',
        feelings: tradeOptions.getFeelings(results[0].data.execution_status),
        regretReasons: tradeOptions.getRegretReasons(results[0].data.execution_status),
        reflections: results[1].data.map(reflectionPresentation),
        showReflectionGuide: results[2].success && userService.hasGuideStep('welcome', results[2].data) && !userService.hasGuideStep('reflection_context', results[2].data)
      });
      self._setTitle();
      self._loadedRevision=revision;
    }).catch(function () {
      if(!self._alive||version!==self._version)return;
      self.setData({ loading: false, loadError: true });
      toast.showError('这条记录暂时打不开');
    });
  },

  onShow: function () { if(this.data.event && this._loadedRevision!==getApp().getPageRevision('records') && !this.data.completed)this._loadEvent(); },
  onUnload: function () { this._alive=false;this._version++; },
  retry: function () { this._loadEvent(); },
  _setTitle: function () { wx.setNavigationBarTitle({title:this.data.mode==='review' ? (this.data.event && this.data.event.execution_status==='cancelled' ? '回看这次决定' : '回看这次操作') : '记录详情'}); },
  startReview: function () {
    if(this.data.saving||!this.data.event||!tradeOptions.canReview(this.data.event.execution_status))return;
    this.setData({mode:'review',canReview:true,feelings:tradeOptions.getFeelings(this.data.event.execution_status),regretReasons:tradeOptions.getRegretReasons(this.data.event.execution_status),feeling:'',historyExpanded:false,eventSupplementExpanded:false,contextExpanded:false,reviewFromDetail:true});this._setTitle();wx.pageScrollTo({scrollTop:0,duration:0});
  },
  leaveReview: function () { if(this.data.saving)return;this.setData({mode:'detail',feeling:'',historyExpanded:true,eventSupplementExpanded:true});this._setTitle();wx.pageScrollTo({scrollTop:0,duration:0}); },
  toggleHistory: function () { this.setData({historyExpanded:!this.data.historyExpanded}); },
  toggleContext: function () { var history=this.selectComponent('#relatedHistory');if(history)history.open(); },

  openAsset: function () {
    if(this.data.event)assetService.open(assetService.keyFor(this.data.event));
  },

  confirmExecution: function (event) {
    if(this.data.saving || !this.data.event || this.data.event.execution_status !== 'pending')return;
    var self=this;var status=event.currentTarget.dataset.status;
    if(status !== 'executed' && status !== 'cancelled')return;
    self.setData({saving:true});
      tradeService.markExecution(self.data.id,status).then(function(result){
        if(!result.success)throw new Error(result.error);
        self.setData({saving:false});getApp().invalidatePages(['today','records','review']);self._loadEvent();
      }).catch(function(){self.setData({saving:false});toast.showError('暂时没能更新');});
  },

  chooseFeeling: function (event) {
    if(this.data.mode!=='review'||this.data.saving)return;
    var feeling = event.currentTarget.dataset.feeling;
    this.setData({ feeling: feeling });
    if (feeling !== 'regret') this._save(feeling, '');
  },

  chooseRegretReason: function (event) {
    this._save('regret', event.currentTarget.dataset.reason);
  },

  _save: function (feeling, regretReason) {
    if (this.data.mode!=='review'||this.data.saving || !this.data.event || !tradeOptions.canReview(this.data.event.execution_status)) return;
    var self = this;
    if (!self._submissionRequestId) self._submissionRequestId = requestId.create('reflection');
    self.setData({ saving: true });
    tradeService.addReflection(self.data.id, feeling, regretReason, self._submissionRequestId).then(function (res) {
      if (!res.success) throw new Error(res.error || 'SAVE_FAILED');
      var snapshot = reflectionPresentation(Object.assign({}, res.data, { feeling: res.data.feeling || feeling, relative_label: '刚刚' }));
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
    if(this.data.reviewFromDetail){this.setData({completed:false,mode:'detail',feeling:'',historyExpanded:true,eventSupplementExpanded:true});this._setTitle();this._loadEvent();wx.pageScrollTo({scrollTop:0,duration:0});return;}
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
    getApp().invalidatePages(['today','records','review']);this._loadedRevision=getApp().getPageRevision('records');
  },

  onReflectionSupplementSaved: function (event) {
    var list = this.data.reflections.slice();
    if (list.length) list[0] = Object.assign({}, list[0], event.detail);
    this.setData({ reflections: list });
    getApp().invalidatePages(['today','records','review']);this._loadedRevision=getApp().getPageRevision('records');
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
