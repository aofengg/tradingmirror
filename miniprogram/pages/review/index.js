var tradeService = require('../../services/trade-service');
var toast = require('../../utils/toast');
var userService = require('../../services/user-service');
var share = require('../../utils/share');

Page({
  data: {
    loading: true,
    hasLoaded: false,
    loadError: false,
    periodType: 'week',
    periodLabel: '',
    summary: null,
    trendPointsJson: '[]',
    selectedFocus: '',
    trendExpanded: false,
    showTrendGuide: false
  },

  onLoad: function () {
    share.enable();
    this._reviewCache = {};
    this._reviewCacheRevisions = {};
  },

  onShow: function () {
    if (typeof this.getTabBar === 'function') {
      var tabBar = this.getTabBar();
      if (tabBar) tabBar.setData({ selected: 2 });
    }
    var revision = getApp().getPageRevision('review');
    if (this._reviewCache[this.data.periodType] && this._reviewCacheRevisions[this.data.periodType] === revision) {
      this._applyResult(this._reviewCache[this.data.periodType]);
      return;
    }
    this._loadReview(this.data.periodType);
  },

  onPullDownRefresh: function () {
    this._loadReview(this.data.periodType, true);
  },

  switchPeriod: function (event) {
    var type = event.currentTarget.dataset.period === 'month' ? 'month' : 'week';
    if (type === this.data.periodType) return;
    this.setData({ periodType: type, loadError: false, trendExpanded: false });
    if (this._reviewCache[type] && this._reviewCacheRevisions[type] === getApp().getPageRevision('review')) {
      this._applyResult(this._reviewCache[type]);
      return;
    }
    this._loadReview(type);
  },

  _loadReview: function (periodType, force) {
    var self = this;
    var revision = getApp().getPageRevision('review');
    if (!force && self._reviewCache[periodType] && self._reviewCacheRevisions[periodType] === revision) {
      self._applyResult(self._reviewCache[periodType]);
      return;
    }
    self.setData({ loading: true, loadError: false });
    getApp().waitForLogin().then(function () {
      return tradeService.getPeriodReview(periodType);
    }).then(function (res) {
      if (!res.success) throw new Error(res.error || 'LOAD_FAILED');
      self._reviewCache[periodType] = res.data;
      self._reviewCacheRevisions[periodType] = revision;
      if (self.data.periodType === periodType) self._applyResult(res.data);
    }).catch(function (error) {
      console.error('复盘加载失败', error);
      if (self.data.periodType === periodType) self.setData({ loading: false, loadError: true });
    }).then(function () {
      wx.stopPullDownRefresh();
    });
  },

  _applyResult: function (data) {
    var activePoints = (data.trend || []).filter(function (item) { return item.value !== null && typeof item.value !== 'undefined'; });
    var latestPoint = activePoints.length ? activePoints[activePoints.length - 1] : null;
    this.setData({
      loading: false,
      hasLoaded: true,
      loadError: false,
      periodLabel: data.periodLabel || '',
      trendPointsJson: JSON.stringify(data.trend || []),
      summary: Object.assign({}, data, {
        disciplineScore: data.eventCount ? data.disciplineScore : 0,
        reviewRate: data.reviewRate || 0,
        trendReady: activePoints.length >= 2,
        trendActiveCount: activePoints.length,
        trendCurrentValue: latestPoint ? latestPoint.value : null,
        trendProgress: Math.min(100, activePoints.length * 50)
      }),
      selectedFocus: data.currentFocus && data.currentFocus.key ? data.currentFocus.key : '',
      showTrendGuide: activePoints.length >= 2 && userService.hasGuideStep('welcome') && !userService.hasGuideStep('trend_generated')
    });
  },

  toggleTrend: function () {
    if (!this.data.summary || !this.data.summary.trendReady) return;
    if (this.data.showTrendGuide) userService.markGuideStep('trend_generated');
    this.setData({ trendExpanded: !this.data.trendExpanded, showTrendGuide: false });
  },

  dismissTrendGuide: function () {
    this.setData({ showTrendGuide: false });
    userService.markGuideStep('trend_generated');
  },

  chooseFocus: function (event) {
    var self = this;
    var key = event.currentTarget.dataset.key;
    if (key === self.data.selectedFocus) return;
    tradeService.saveWeeklyFocus(key).then(function (res) {
      if (!res.success) { toast.showError('提醒保存失败'); return; }
      self.setData({ selectedFocus: key });
      if (self._reviewCache.week) self._reviewCache.week.currentFocus = res.data;
      getApp().invalidatePages(['today']);
      toast.showSuccess('已设为下周提醒');
    });
  },

  retry: function () {
    this._loadReview(this.data.periodType, true);
  },

  onShareAppMessage: function () {
    return share.appMessage('交易留痕｜不拿后来涨跌反推对错', '/pages/review/index');
  },

  onShareTimeline: function () {
    return share.timeline('交易留痕｜不拿后来涨跌反推对错');
  }
});
