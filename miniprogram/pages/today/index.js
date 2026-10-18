var tradeService = require('../../services/trade-service');
var userService = require('../../services/user-service');
var constants = require('../../config/constants');
var share = require('../../utils/share');
var assetService = require('../../services/asset-service');

Page({
  data: {
    loading: true,
    hasLoaded: false,
    loadError: false,
    pending: null,
    pendingReflections: [],
    pendingReflectionIndex: 0,
    pendingReflectionOffset: 0,
    pendingReflectionCount: 0,
    reflectionSwitching: false,
    pendingIntent: null,
    pendingIntents: [],
    pendingIntentIndex: 0,
    pendingIntentCount: 0,
    pendingIntentOffset: 0,
    intentSaving: false,
    intentLeaving: false,
    intentSwitching: false,
    intentAnimation: '',
    recentCount: 0,
    currentFocus: null,
    showWelcome: false,
    greeting: '',
    dateLabel: '',
    todoTab: 'confirm', showIntentContext: false
  },

  onLoad: function () {
    this._pageVersion = 0;
    share.enable();
    this.setData({ greeting: this._getGreeting(), dateLabel: this._getDateLabel() });
  },

  onShow: function () {
    if (typeof this.getTabBar === 'function') {
      var tabBar = this.getTabBar();
      if (tabBar) tabBar.setData({ selected: 0 });
    }
    var app = getApp();
    var config = userService.getCachedConfig();
    if (config) this.setData({ currentFocus: config.current_focus || null });
    var needsRefresh = this._loadedRevision !== app.getPageRevision('today');
    if (this.data.hasLoaded && !needsRefresh && this._lastLoadedAt && Date.now() - this._lastLoadedAt < 30000) return;
    this._loadPage();
  },

  onPullDownRefresh: function () {
    tradeService.clearReadCache();
    this._loadPage(true);
  },

  onUnload: function () { this._destroyed = true; this._pageVersion++; },

  _getGreeting: function () {
    var hour = new Date().getHours();
    if (hour < 11) return '早上好';
    if (hour < 18) return '下午好';
    return '晚上好';
  },

  _getDateLabel: function () {
    var now = new Date();
    var weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return (now.getMonth() + 1) + '月' + now.getDate() + '日 · 周' + weekdays[now.getDay()];
  },

  _loadPage: function (force) {
    if(this._destroyed)return Promise.resolve();
    if (this._loadingPromise) {
      if(force || this._loadingRevision!==getApp().getPageRevision('today'))this._reloadRequested=true;
      return this._loadingPromise;
    }
    var self = this;
    var version = this._pageVersion = (this._pageVersion || 0) + 1;
    var revision = getApp().getPageRevision('today');
    this._loadingRevision=revision;
    self.setData({ loading: !self.data.hasLoaded, loadError: false });
    this._loadingPromise = getApp().waitForLogin().then(function () {
      return Promise.all([
        tradeService.getPendingIntentQueue(),
        tradeService.getPendingReflectionQueue(),
        tradeService.getRecentEvents(1),
        userService.getConfig()
      ]);
    }).then(function (results) {
      if (self._destroyed || version !== self._pageVersion) return;
      if(self._reloadRequested || revision!==getApp().getPageRevision('today')){self._reloadRequested=true;return;}
      if (!results[0].success || !results[1].success || !results[2].success) throw new Error('LOAD_FAILED');
      var showWelcome = results[2].data.length === 0 && results[3].success && !userService.hasGuideStep('welcome', results[3].data);
      self.setData({
        loading: false,
        hasLoaded: true,
        pendingIntent: results[0].data.current,
        pendingIntents: results[0].data.items,
        pendingIntentIndex: 0,
        pendingIntentOffset: 0,
        pendingIntentCount: results[0].data.count,
        todoTab: results[0].data.count && (self.data.todoTab === 'confirm' || !results[1].data.count) ? 'confirm' : 'review',
        showIntentContext: false,
        intentSaving: false,
        intentLeaving: false,
        intentSwitching: false,
        intentAnimation: '',
        pending: results[1].data.current,
        pendingReflections: results[1].data.items,
        pendingReflectionIndex: 0,
        pendingReflectionOffset: 0,
        pendingReflectionCount: results[1].data.count,
        reflectionSwitching: false,
        recentCount: results[2].data.length,
        currentFocus: results[3].success ? results[3].data.current_focus : null,
        showWelcome: showWelcome
      });
      self._intentCursor=results[0].data.nextCursor || null;
      var tabBar = typeof self.getTabBar === 'function' ? self.getTabBar() : null;
      if (tabBar) tabBar.setData({ hidden: showWelcome });
      self._lastLoadedAt = Date.now();
      self._loadedRevision = revision;
    }).catch(function (error) {
      if (self._destroyed || version !== self._pageVersion) return;
      if(self._reloadRequested || revision!==getApp().getPageRevision('today'))return;
      console.error('首页加载失败', error);
      self.setData({ loading: false, loadError: true });
    }).then(function () {
      self._loadingPromise = null;
      if(!self._destroyed && (self._reloadRequested || revision!==getApp().getPageRevision('today'))) {
        self._reloadRequested=false;
        return self._loadPage();
      }
      wx.stopPullDownRefresh();
    });
    return this._loadingPromise;
  },

  startBefore: function () {
    wx.navigateTo({ url: constants.ROUTES.RECORD + '?stage=before' });
  },

  startAfter: function () {
    wx.navigateTo({ url: constants.ROUTES.RECORD + '?stage=after' });
  },

  startFirstRecord: function () {
    this.setData({ showWelcome: false });
    var tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({ hidden: false });
    userService.markGuideStep('welcome');
    wx.navigateTo({ url: constants.ROUTES.RECORD + '?stage=after&guide=1' });
  },

  dismissWelcome: function () {
    this.setData({ showWelcome: false });
    var tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({ hidden: false });
    userService.markGuideStep('welcome');
  },

  preventTouchMove: function () {},

  openReflection: function () {
    if (!this.data.pending) return;
    wx.navigateTo({ url: constants.ROUTES.REFLECTION + '?id=' + encodeURIComponent(this.data.pending._id) + '&mode=review' });
  },

  chooseTodoTab: function (event) { this.setData({todoTab:event.currentTarget.dataset.tab,showIntentContext:false}); },
  toggleIntentContext: function () { var history=this.selectComponent('#relatedHistory');if(history)history.open(); },
  openFocus: function () { getApp().globalData._reviewInitialSection='focus';wx.switchTab({url:'/pages/review/index'}); },
  openAllTodos: function () { getApp().globalData._recordsInitialFilter='pending';getApp().globalData._recordsInitialTodoFilter='all';wx.switchTab({url:'/pages/records/index'}); },

  openAssetHistory: function (event) {
    var source = event.currentTarget.dataset.source;
    var item = source === 'intent' ? this.data.pendingIntent : source === 'reflection' ? this.data.pending : null;
    if (item && item.symbol) assetService.open(assetService.keyFor(item));
  },

  confirmIntent: function (event) {
    var self = this;
    if (!self.data.pendingIntent || self.data.intentSaving || self.data.intentSwitching) return;
    var status = event.currentTarget.dataset.status;
    if (status !== 'executed' && status !== 'cancelled') return;
    var remaining = Math.max(0, Number(self.data.pendingIntentCount || 0) - 1);
    self.setData({ intentSaving: true });
    tradeService.markExecution(self.data.pendingIntent._id, status).then(function (res) {
      if (!res.success) throw new Error(res.error || 'SAVE_FAILED');
      getApp().invalidatePages(['today', 'records', 'review']);
      if(self._destroyed)return;
      self.setData({ intentLeaving: true });
      wx.showToast({ title: remaining ? '已确认，还剩' + remaining + '条' : '都确认好了', icon: 'none', duration: 1000 });
      setTimeout(function () { if(!self._destroyed)self._loadPage(); }, 180);
    }).catch(function () {
      if(self._destroyed)return;
      self.setData({ intentSaving: false, intentLeaving: false });
      wx.showToast({ title: '暂时没记下', icon: 'none' });
    });
  },

  showNextIntent: function () {
    var self = this;
    var items = self.data.pendingIntents || [];
    if (self.data.pendingIntentCount < 2 || !items.length || self.data.intentSaving || self.data.intentSwitching || self._loadingPromise) return;
    var version=self._pageVersion;
    var nextIndex = Number(self.data.pendingIntentIndex || 0) + 1;
    var offset=Number(self.data.pendingIntentOffset || 0)+items.length;
    if(nextIndex>=items.length && (offset<self.data.pendingIntentCount&&self._intentCursor || self.data.pendingIntentOffset>0)) {
      if(offset>=self.data.pendingIntentCount)offset=0;
      self.setData({intentSwitching:true});
      tradeService.getPendingIntentQueue(offset?self._intentCursor:null).then(function(res){
        if(self._destroyed||version!==self._pageVersion)return;
        if(!res.success)throw new Error('LOAD_FAILED');
        if(!res.data.current){self._loadPage();return;}
        self._intentCursor=res.data.nextCursor || null;
        self.setData({pendingIntent:res.data.current,pendingIntents:res.data.items,pendingIntentIndex:0,pendingIntentOffset:offset,
          pendingIntentCount:res.data.count,intentSwitching:false,showIntentContext:false});
      }).catch(function(){
        if(self._destroyed||version!==self._pageVersion)return;
        self.setData({intentSwitching:false});wx.showToast({title:'暂时没能切换，请重试',icon:'none'});
      });
      return;
    }
    nextIndex=nextIndex%items.length;
    self.setData({ intentSwitching: true, intentAnimation: 'page-out' });
    setTimeout(function () {
      if(self._destroyed||version!==self._pageVersion)return;
      self.setData({
        pendingIntent: items[nextIndex],
        pendingIntentIndex: nextIndex,
        showIntentContext: false,
        intentAnimation: 'page-in'
      });
    }, 160);
    setTimeout(function () {
      if(self._destroyed||version!==self._pageVersion)return;
      self.setData({ intentSwitching: false, intentAnimation: '' });
    }, 380);
  },

  showNextReflection: function () {
    var self = this;
    if (self.data.reflectionSwitching || self.data.pendingReflectionCount < 2 || self._loadingPromise) return;
    var version=self._pageVersion;
    var next = self.data.pendingReflectionIndex + 1;
    if (next < self.data.pendingReflections.length) {
      self.setData({ pendingReflectionIndex: next, pending: self.data.pendingReflections[next] });
      return;
    }
    var offset = self.data.pendingReflectionOffset + self.data.pendingReflections.length;
    if (offset >= self.data.pendingReflectionCount) offset = 0;
    self.setData({ reflectionSwitching: true });
    tradeService.getPendingReflectionQueue(offset).then(function (res) {
      if(self._destroyed||version!==self._pageVersion)return;
      if (!res.success) throw new Error('LOAD_FAILED');
      if (!res.data.current) { self._loadPage(); return; }
      self.setData({ pending: res.data.current, pendingReflections: res.data.items, pendingReflectionIndex: 0,
        pendingReflectionOffset: offset, pendingReflectionCount: res.data.count, reflectionSwitching: false });
    }).catch(function () {
      if(self._destroyed||version!==self._pageVersion)return;
      self.setData({ reflectionSwitching: false });
      wx.showToast({ title: '暂时没能切换，请重试', icon: 'none' });
    });
  },

  openReflectionRecords: function () {
    getApp().globalData._recordsInitialFilter = 'pending';
    getApp().globalData._recordsInitialTodoFilter = 'review';
    wx.switchTab({ url: '/pages/records/index' });
  },

  openPendingRecords: function () {
    getApp().globalData._recordsInitialTodoFilter = 'confirm';
    getApp().globalData._recordsInitialFilter = 'pending';
    wx.switchTab({ url: '/pages/records/index' });
  },

  openRecords: function () {
    wx.switchTab({ url: '/pages/records/index' });
  },

  retry: function () {
    this._loadPage();
  },

  onShareAppMessage: function () {
    return share.appMessage('交易留痕｜少看结果，多看行为');
  },

  onShareTimeline: function () {
    return share.timeline('交易留痕｜少看结果，多看行为');
  }
});
