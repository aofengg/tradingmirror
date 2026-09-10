var tradeService = require('../../services/trade-service');
var userService = require('../../services/user-service');
var constants = require('../../config/constants');
var share = require('../../utils/share');

Page({
  data: {
    loading: true,
    hasLoaded: false,
    loadError: false,
    pending: null,
    pendingIntent: null,
    pendingIntents: [],
    pendingIntentIndex: 0,
    pendingIntentCount: 0,
    intentSaving: false,
    intentLeaving: false,
    intentSwitching: false,
    intentAnimation: '',
    recentCount: 0,
    currentFocus: null,
    showWelcome: false,
    greeting: '',
    dateLabel: ''
  },

  onLoad: function () {
    share.enable();
    this.setData({ greeting: this._getGreeting(), dateLabel: this._getDateLabel() });
  },

  onShow: function () {
    if (typeof this.getTabBar === 'function') {
      var tabBar = this.getTabBar();
      if (tabBar) tabBar.setData({ selected: 0 });
    }
    var app = getApp();
    var needsRefresh = this._loadedRevision !== app.getPageRevision('today');
    if (this.data.hasLoaded && !needsRefresh && this._lastLoadedAt && Date.now() - this._lastLoadedAt < 30000) return;
    this._loadPage();
  },

  onPullDownRefresh: function () {
    this._loadPage();
  },

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

  _loadPage: function () {
    var self = this;
    var revision = getApp().getPageRevision('today');
    self.setData({ loading: !self.data.hasLoaded, loadError: false });
    return getApp().waitForLogin().then(function () {
      return Promise.all([
        tradeService.getPendingIntentQueue(),
        tradeService.getPendingReflection(),
        tradeService.getRecentEvents(20),
        userService.getConfig()
      ]);
    }).then(function (results) {
      if (!results[0].success || !results[1].success || !results[2].success) throw new Error('LOAD_FAILED');
      var showWelcome = results[2].data.length === 0 && results[3].success && !userService.hasGuideStep('welcome', results[3].data);
      self.setData({
        loading: false,
        hasLoaded: true,
        pendingIntent: results[0].data.current,
        pendingIntents: results[0].data.items,
        pendingIntentIndex: 0,
        pendingIntentCount: results[0].data.count,
        intentSaving: false,
        intentLeaving: false,
        intentSwitching: false,
        intentAnimation: '',
        pending: results[1].data,
        recentCount: results[2].data.length,
        currentFocus: results[3].success ? results[3].data.current_focus : null,
        showWelcome: showWelcome
      });
      var tabBar = typeof self.getTabBar === 'function' ? self.getTabBar() : null;
      if (tabBar) tabBar.setData({ hidden: showWelcome });
      self._lastLoadedAt = Date.now();
      self._loadedRevision = revision;
    }).catch(function (error) {
      console.error('首页加载失败', error);
      self.setData({ loading: false, loadError: true });
    }).then(function () {
      wx.stopPullDownRefresh();
    });
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
    wx.navigateTo({ url: constants.ROUTES.REFLECTION + '?id=' + this.data.pending._id });
  },

  confirmIntent: function (event) {
    var self = this;
    if (!self.data.pendingIntent || self.data.intentSaving) return;
    var status = event.currentTarget.dataset.status;
    var remaining = Math.max(0, Number(self.data.pendingIntentCount || 0) - 1);
    self.setData({ intentSaving: true });
    tradeService.markExecution(self.data.pendingIntent._id, status).then(function (res) {
      if (!res.success) throw new Error(res.error || 'SAVE_FAILED');
      getApp().invalidatePages(['today', 'records', 'review']);
      self.setData({ intentLeaving: true });
      wx.showToast({ title: remaining ? '已确认，还剩' + remaining + '条' : '都确认好了', icon: 'none', duration: 1000 });
      setTimeout(function () { self._loadPage(); }, 180);
    }).catch(function () {
      self.setData({ intentSaving: false, intentLeaving: false });
      wx.showToast({ title: '暂时没记下', icon: 'none' });
    });
  },

  showNextIntent: function () {
    var self = this;
    var items = self.data.pendingIntents || [];
    if (items.length < 2 || self.data.intentSaving || self.data.intentSwitching) return;
    var nextIndex = (Number(self.data.pendingIntentIndex || 0) + 1) % items.length;
    self.setData({ intentSwitching: true, intentAnimation: 'page-out' });
    setTimeout(function () {
      self.setData({
        pendingIntent: items[nextIndex],
        pendingIntentIndex: nextIndex,
        intentAnimation: 'page-in'
      });
    }, 160);
    setTimeout(function () {
      self.setData({ intentSwitching: false, intentAnimation: '' });
    }, 380);
  },

  openPendingRecords: function () {
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
