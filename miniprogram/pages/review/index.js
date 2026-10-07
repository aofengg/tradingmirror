var tradeService = require('../../services/trade-service');
var toast = require('../../utils/toast');
var userService = require('../../services/user-service');
var share = require('../../utils/share');
var constants = require('../../config/constants');

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
    focusSaving: false,
    trendExpanded: false,
    showTrendGuide: false,
    currentPeriodId: '',
    selectedPeriodId: '',
    viewingHistory: false,
    detailOpen: false,
    detailLoading: false,
    detailError: false,
    detailTitle: '',
    detailItems: [],
    analysisExpanded: false, focusExpanded: false, selectedFocusLabel: ''
  },

  onLoad: function () {
    share.enable();
    this._reviewCache = {};
    this._reviewCacheRevisions = {};
    this._loadVersions={};this._cacheDay={};
  },

  onShow: function () {
    if (typeof this.getTabBar === 'function') {
      var tabBar = this.getTabBar();
      if (tabBar) tabBar.setData({ selected: 2, hidden: this.data.detailOpen });
    }
    var revision = getApp().getPageRevision('review');
    if(getApp().globalData._reviewInitialSection==='focus'){getApp().globalData._reviewInitialSection='';this._scrollToFocus=true;this.setData({periodType:'week',selectedPeriodId:'',focusExpanded:true});}
    if (this._reviewCache[this.data.periodType] && this._reviewCacheRevisions[this.data.periodType] === revision && this._cacheDay[this.data.periodType]===new Date().toDateString()) {
      this._applyResult(this._reviewCache[this.data.periodType]);
      return;
    }
    this._loadReview(this.data.periodType);
  },

  onPullDownRefresh: function () {
    this._loadReview(this.data.periodType, true);
  },

  onUnload: function () {
    this._setTabbarHidden(false);
  },

  switchPeriod: function (event) {
    var type = event.currentTarget.dataset.period === 'month' ? 'month' : 'week';
    if (type === this.data.periodType) return;
    this.closeDetail();
    this.setData({ periodType: type, selectedPeriodId: '', loadError: false, trendExpanded: false, detailOpen: false, analysisExpanded:false, summary:null });
    if (this._reviewCache[type] && this._reviewCacheRevisions[type] === getApp().getPageRevision('review') && this._cacheDay[type]===new Date().toDateString()) {
      this._applyResult(this._reviewCache[type]);
      return;
    }
    this._loadReview(type);
  },

  _loadReview: function (periodType, force) {
    var self = this;
    var revision = getApp().getPageRevision('review');
    if (!force && self._reviewCache[periodType] && self._reviewCacheRevisions[periodType] === revision && self._cacheDay[periodType]===new Date().toDateString()) {
      self._applyResult(self._reviewCache[periodType]);
      return;
    }
    self.setData({ loading: true, loadError: false });
    var version=(self._loadVersions[periodType]||0)+1;self._loadVersions[periodType]=version;
    getApp().waitForLogin().then(function () {
      return tradeService.getPeriodReview(periodType);
    }).then(function (res) {
      if(self._loadVersions[periodType]!==version)return;
      if (!res.success) throw new Error(res.error || 'LOAD_FAILED');
      self._reviewCache[periodType] = res.data;
      self._reviewCacheRevisions[periodType] = revision;
      self._cacheDay[periodType]=new Date().toDateString();
      if (self.data.periodType === periodType) { self._applyResult(res.data);if(self.data.detailOpen)self.retryDetail(); }
    }).catch(function (error) {
      console.error('复盘加载失败', error);
      if (self._loadVersions[periodType]===version && self.data.periodType === periodType) self.setData({ loading: false, loadError: true });
    }).then(function () {
      wx.stopPullDownRefresh();
    });
  },

  _applyResult: function (data) {
    this._periodReviewData = data;
    var activePoints = (data.trend || []).filter(function (item) { return item.value !== null && typeof item.value !== 'undefined'; });
    var latestPoint = activePoints.length ? activePoints[activePoints.length - 1] : null;
    this._trendMeta = {
      trendReady: activePoints.length >= 2,
      trendActiveCount: activePoints.length,
      trendCurrentValue: latestPoint ? latestPoint.value : null,
      trendProgress: Math.min(100, activePoints.length * 50),
      trendSmallSample: activePoints.slice(-2).some(function(point){return Number(point.eventCount||0)<5;})
    };
    this.setData({
      loading: false,
      hasLoaded: true,
      loadError: false,
      trendPointsJson: JSON.stringify(data.trend || []),
      currentPeriodId: data.periodId || '',
      selectedFocus: data.currentFocus && data.currentFocus.key ? data.currentFocus.key : '',
      showTrendGuide: activePoints.length >= 2 && userService.hasGuideStep('welcome') && !userService.hasGuideStep('trend_generated')
    });
    this._applyPeriod(this.data.selectedPeriodId || data.periodId);
  },

  _applyPeriod: function (periodId) {
    var data = this._periodReviewData;
    if (!data) return;
    var selected = (data.periodSummaries || []).filter(function (item) { return item.periodId === periodId; })[0];
    if (!selected) selected = data;
    var viewingHistory = selected.periodId !== data.periodId;
    var self=this;
    this.setData({
      periodLabel: selected.periodLabel || data.periodLabel || '',
      selectedPeriodId: selected.periodId || data.periodId || '',
      viewingHistory: viewingHistory,
      selectedFocusLabel: ((selected.focuses||[]).filter(function(item){return item.key===this.data.selectedFocus;},this)[0]||{}).label || (data.currentFocus&&data.currentFocus.label) || '',
      summary: Object.assign({}, selected, this._trendMeta || {}, {
        disciplineScore: selected.eventCount ? selected.disciplineScore : 0,
        reviewRate: selected.reviewRate || 0,
        pattern: viewingHistory ? (selected.pattern || '').replace(/本周/g, '这周').replace(/本月/g, '这个月') : selected.pattern,
        trendInsight: data.trendInsight,
        changeClueReady: !viewingHistory && data.changeClueReady,
        changeClue: !viewingHistory ? data.changeClue : ''
      })
    },function(){if(self._scrollToFocus){self._scrollToFocus=false;wx.pageScrollTo({selector:'#focusSection',duration:0});}});
  },

  toggleAnalysis: function () { this.setData({analysisExpanded:!this.data.analysisExpanded}); },
  toggleFocus: function () { this.setData({focusExpanded:!this.data.focusExpanded}); },

  toggleTrend: function () {
    if (!this.data.summary || !this.data.summary.trendReady) return;
    if (this.data.showTrendGuide) userService.markGuideStep('trend_generated');
    this.setData({ trendExpanded: !this.data.trendExpanded, showTrendGuide: false });
  },

  dismissTrendGuide: function () {
    this.setData({ showTrendGuide: false });
    userService.markGuideStep('trend_generated');
  },

  selectTrendPeriod: function (event) {
    var periodId = event.detail && event.detail.periodId;
    if (!periodId || periodId === this.data.selectedPeriodId) return;
    this._applyPeriod(periodId);
  },

  viewSelectedReview: function () {
    wx.pageScrollTo({ scrollTop: 0, duration: 250 });
  },

  returnToCurrentPeriod: function () {
    this._applyPeriod(this.data.currentPeriodId);
  },

  openMetricDetail: function (event) {
    var metric = event.currentTarget.dataset.metric;
    var fields={planned:'plannedCount',impulsive:'impulsiveCount',reviewed:'reviewedCount',regret:'regretCount'};
    if(!this.data.summary || !Number(this.data.summary[fields[metric]]))return;
    var titles = {
      planned: '按计划行动',
      impulsive: '临时决定',
      reviewed: '完成回看',
      regret: '当前懊悔'
    };
    if (!titles[metric]) return;
    this._loadDetail(metric, '', titles[metric]);
  },

  openReasonDetail: function (event) {
    var key = event.currentTarget.dataset.key;
    var label = event.currentTarget.dataset.label;
    if (!key) return;
    this._loadDetail('reason', key, '因为「' + label + '」');
  },

  _loadDetail: function (metric, reasonKey, title) {
    var self = this;
    var requestToken = Date.now() + ':' + Math.random();
    self._detailRequestToken = requestToken;
    self._detailRequest = { metric: metric, reasonKey: reasonKey, title: title };
    self._setTabbarHidden(true);
    self.setData({
      detailOpen: true,
      detailLoading: true,
      detailError: false,
      detailTitle: title,
      detailItems: []
    });
    tradeService.getPeriodDetail(self.data.periodType, self.data.selectedPeriodId, metric, reasonKey).then(function (res) {
      if (!res.success) throw new Error(res.error || 'LOAD_FAILED');
      if (!self.data.detailOpen || self._detailRequestToken !== requestToken) return;
      self.setData({ detailLoading: false, detailItems: res.data.items || [] });
    }).catch(function (error) {
      console.error('复盘明细加载失败', error);
      if (self.data.detailOpen && self._detailRequestToken === requestToken) self.setData({ detailLoading: false, detailError: true });
    });
  },

  retryDetail: function () {
    var request = this._detailRequest;
    if (request) this._loadDetail(request.metric, request.reasonKey, request.title);
  },

  closeDetail: function () {
    this._detailRequestToken = '';
    this.setData({ detailOpen: false });
    this._setTabbarHidden(false);
  },

  openDetailRecord: function (event) {
    var id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: constants.ROUTES.REFLECTION + '?id=' + encodeURIComponent(id) });
  },

  _setTabbarHidden: function (hidden) {
    if (typeof this.getTabBar !== 'function') return;
    var tabBar = this.getTabBar();
    if (tabBar) tabBar.setData({ hidden: hidden });
  },

  stopPropagation: function () {},

  preventTouchMove: function () {},

  chooseFocus: function (event) {
    var self = this;
    var key = event.currentTarget.dataset.key;
    if (self.data.focusSaving) return;
    if (key === self.data.selectedFocus) {self.setData({focusExpanded:false});return;}
    self.setData({ focusSaving: true });
    tradeService.saveWeeklyFocus(key).then(function (res) {
      if (!res.success) {
        console.error('提醒保存失败', res.error);
        self.setData({ focusSaving: false });
        toast.showError('提醒保存失败');
        return;
      }
      self.setData({ selectedFocus: key, focusSaving: false, focusExpanded:false, selectedFocusLabel:((self.data.summary.focuses||[]).filter(function(item){return item.key===key;})[0]||{}).label||'' });
      if (self._reviewCache.week) self._reviewCache.week.currentFocus = res.data;
      getApp().invalidatePages(['today']);
      toast.showSuccess('已设为本周提醒');
    }).catch(function (error) {
      console.error('提醒保存异常', error);
      self.setData({ focusSaving: false });
      toast.showError('提醒保存失败');
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
