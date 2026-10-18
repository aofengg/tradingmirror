var reviewService = require('../../services/review-service');
var tradeService = require('../../services/trade-service');
var userService = require('../../services/user-service');
var share = require('../../utils/share');
var toast = require('../../utils/toast');
var presentation = require('../../utils/review-presentation');

function shanghaiDay() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

Page({
  data: {
    range: 'all',
    rangeChoices: [{key:'all',label:'全部'}, {key:'week',label:'本周'}, {key:'month',label:'本月'}],
    behaviorStatus: 'executed',
    behavior: null,
    behaviorLoading: true,
    behaviorError: false,
    reasonRows: [],
    observation: null,
    reasonCount: 0,
    reasonsExpanded: false,
    relationOpen: false,
    relationTitle: '',
    relationFeeling: '',
    relationFeelingLabel: '全部感受',
    relationRangeLabel: '',
    relationItems: [],
    relationTotal: 0,
    relationMore: false,
    relationLoading: false,
    relationError: false,
    selectedFocus: '',
    selectedFocusLabel: '',
    focusSaving: false
  },

  onLoad: function () {
    share.enable();
    this._behaviorCache = {};
    this._behaviorVersion = 0;
    this._relationVersion = 0;
    this._focusVersion = 0;
  },

  onShow: function () {
    this._setTabbarHidden(this.data.relationOpen);
    var tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({selected:2});
    this._loadBehavior(false);
    this._loadFocus();
  },

  onPullDownRefresh: function () { this._loadBehavior(true); },

  onUnload: function () {
    this._destroyed = true;
    this._behaviorVersion++;
    this._relationVersion++;
    this._focusVersion++;
    this._setTabbarHidden(false);
  },

  _behaviorOptions: function () {
    return {range:this.data.range, status:this.data.behaviorStatus, basis:'latest'};
  },

  _loadBehavior: function (force) {
    var self = this;
    if (force) reviewService.clearCache();
    var options = this._behaviorOptions();
    var revision = getApp().getPageRevision('review');
    var key = JSON.stringify(options);
    if(!force && this._behaviorRequest && this._behaviorRequest.key===key && this._behaviorRequest.revision===revision)return this._behaviorRequest.promise;
    var version = ++this._behaviorVersion;
    var cached = this._behaviorCache[key];
    if (!force && cached && cached.revision === revision && cached.day === shanghaiDay() && Date.now() - cached.at < 60000) {
      if(this._appliedBehavior !== cached.value || !this.data.behavior || this.data.behaviorLoading || this.data.behaviorError)this._applyBehavior(cached.value);
      wx.stopPullDownRefresh();
      return;
    }
    this.setData({behaviorLoading:true, behaviorError:false});
    var promise = getApp().waitForLogin().then(function () {
      return reviewService.read(options);
    }).then(function (res) {
      if (self._destroyed || version !== self._behaviorVersion) return;
      if (!res.success) throw new Error(res.error || 'LOAD_FAILED');
      self._behaviorCache[key] = {value:res.data, revision:revision, day:shanghaiDay(), at:Date.now()};
      self._applyBehavior(res.data);
      if (self.data.relationOpen) self._loadRelation(false, Math.max(15, self.data.relationItems.length));
    }).catch(function () {
      if (!self._destroyed && version === self._behaviorVersion) self.setData({behaviorLoading:false, behaviorError:true});
    }).then(function () {
      if(self._behaviorRequest && self._behaviorRequest.version===version)self._behaviorRequest=null;
      if (!self._destroyed && version === self._behaviorVersion) wx.stopPullDownRefresh();
    });
    this._behaviorRequest={key:key,revision:revision,version:version,promise:promise};
    return promise;
  },

  _applyBehavior: function (value) {
    this._appliedBehavior=value;
    this.setData({behavior:value, behaviorLoading:false, behaviorError:false});
    this._showReasons();
  },

  _showReasons: function () {
    var result = presentation.build((this.data.behavior && this.data.behavior.reasons) || []);
    var rows = result.rows;
    this.setData({reasonCount:rows.length, reasonRows:this.data.reasonsExpanded ? rows : rows.slice(0,4), observation:result.observation});
  },

  toggleReasonRows: function () {
    this.setData({reasonsExpanded:!this.data.reasonsExpanded});
    this._showReasons();
  },

  chooseRange: function (event) {
    var range = event.currentTarget.dataset.key;
    if (['all','week','month'].indexOf(range) === -1 || range === this.data.range) return;
    this.closeRelation();
    this.setData({range:range, behavior:null, reasonRows:[], reasonsExpanded:false});
    this._loadBehavior(false);
  },

  chooseStatus: function () {
    var self = this;
    wx.showActionSheet({
      itemList:['已执行操作', '未执行决定'],
      success:function (result) {
        if (self._destroyed || (result.tapIndex !== 0 && result.tapIndex !== 1)) return;
        var status = result.tapIndex === 1 ? 'cancelled' : 'executed';
        if (status === self.data.behaviorStatus) return;
        self.closeRelation();
        self.setData({behaviorStatus:status, behavior:null, reasonRows:[], reasonsExpanded:false});
        self._loadBehavior(false);
      }
    });
  },

  retryBehavior: function () { this._loadBehavior(true); },

  openRelation: function (event) {
    var data = event.currentTarget.dataset;
    if (!this.data.behavior || Number(data.count) === 0) return;
    this._relationFailedAppend = false;
    this._relationRequest = {reason_key:data.reason || ''};
    var feeling = data.feeling || '';
    this.setData({
      relationOpen:true,
      relationTitle:data.label || '对应的经历',
      relationRangeLabel:this.data.behavior.rangeLabel + ' · ' + (this.data.behaviorStatus === 'cancelled' ? '未执行决定' : '已执行操作'),
      relationFeeling:feeling,
      relationFeelingLabel:this._feelingLabel(feeling),
      relationItems:[], relationTotal:0, relationMore:false
    });
    this._setTabbarHidden(true);
    this._loadRelation(false);
  },

  _feelingLabel: function (key) {
    return ({satisfied:'满意', acceptable:'可接受', regret:'懊悔', unreviewed:'未回看', unknown:'其他感受'})[key] || '全部感受';
  },

  chooseRelationFeeling: function () {
    var self = this;
    var keys = ['', 'satisfied', 'acceptable', 'regret', 'unreviewed', 'unknown'];
    wx.showActionSheet({
      itemList:keys.map(function (key) { return self._feelingLabel(key); }),
      success:function (result) {
        if (self._destroyed || !self.data.relationOpen || !Number.isInteger(result.tapIndex) || !keys[result.tapIndex] && result.tapIndex !== 0) return;
        var key = keys[result.tapIndex];
        if (key === self.data.relationFeeling) return;
        self.setData({relationFeeling:key, relationFeelingLabel:self._feelingLabel(key), relationItems:[]});
        self._loadRelation(false);
      }
    });
  },

  _loadRelation: function (append, restoreCount) {
    if (append && (!this.data.relationMore || this.data.relationLoading)) return;
    var self = this;
    var version = ++this._relationVersion;
    var options = Object.assign({}, this._behaviorOptions(), this._relationRequest, {
      mode:'detail', feeling:this.data.relationFeeling, cursor:append ? this._relationCursor : null
    });
    this.setData({relationLoading:true, relationError:false});
    var restored = [];
    function readNext() {
      return reviewService.read(options).then(function (res) {
        if (self._destroyed || version !== self._relationVersion) return res;
        if (!res.success) throw new Error(res.error || 'LOAD_FAILED');
        restored = restored.concat(res.data.items);
        if (!append && restoreCount && restored.length < restoreCount && res.data.hasMore) {
          options.cursor = res.data.nextCursor;
          return readNext();
        }
        return {success:true, data:Object.assign({}, res.data, {items:restored})};
      });
    }
    getApp().waitForLogin().then(readNext).then(function (res) {
      if (self._destroyed || version !== self._relationVersion || !self.data.relationOpen) return;
      if (!res.success) throw new Error(res.error || 'LOAD_FAILED');
      self._relationCursor = res.data.nextCursor;
      var patch={relationLoading:false,relationTotal:res.data.total,relationMore:res.data.hasMore};
      var evidence=presentation.evidence(res.data.items);
      if(append){var start=self.data.relationItems.length;evidence.forEach(function(item,index){patch['relationItems['+(start+index)+']']=item;});}
      else patch.relationItems=evidence;
      self.setData(patch);
    }).catch(function () {
      if (!self._destroyed && version === self._relationVersion && self.data.relationOpen) {
        self._relationFailedAppend = !!append;
        self.setData({relationLoading:false, relationError:true});
      }
    });
  },

  loadMoreRelations: function () { this._loadRelation(true); },
  retryRelations: function () { this._loadRelation(!!this._relationFailedAppend, Math.max(15,this.data.relationItems.length)); },
  closeRelation: function () {
    this._relationVersion++;
    this.setData({relationOpen:false});
    this._setTabbarHidden(false);
  },
  openDetailRecord: function (event) {
    var id = event.currentTarget.dataset.id;
    if (!id || this._navigating) return;
    var self=this;this._navigating=true;
    wx.navigateTo({url:'/pages/reflection/index?id=' + encodeURIComponent(id) + '&mode=detail',complete:function(){self._navigating=false;}});
  },
  createRecord: function () { wx.navigateTo({url:'/pages/record/index?stage=after'}); },

  // Keep the existing weekly reminder as a single optional footer. No second editor or comparison.
  _loadFocus: function () {
    var self = this;
    var version = ++this._focusVersion;
    getApp().waitForLogin().then(function () { return userService.getConfig(); }).then(function (res) {
      if (self._destroyed || version !== self._focusVersion || !res.success) return;
      var focus = res.data.current_focus || {};
      self.setData({selectedFocus:focus.key || '', selectedFocusLabel:focus.label || ''});
      if (getApp().globalData._reviewInitialSection === 'focus') {
        getApp().globalData._reviewInitialSection = '';
        self.openFocus();
      }
    }).catch(function () {});
  },

  openFocus: function () {
    if (this.data.focusSaving) return;
    var self = this;
    var labels = tradeService.labels.focuses;
    var keys = Object.keys(labels);
    wx.showActionSheet({
      itemList:keys.map(function (key) { return '少一次“' + labels[key] + '”'; }),
      success:function (result) {
        if (!self._destroyed && keys[result.tapIndex]) self.chooseFocus({currentTarget:{dataset:{key:keys[result.tapIndex]}}});
      }
    });
  },

  chooseFocus: function (event) {
    var self = this;
    var key = event.currentTarget.dataset.key;
    if (self.data.focusSaving || key === self.data.selectedFocus || !tradeService.labels.focuses[key]) return;
    self.setData({focusSaving:true});
    tradeService.saveWeeklyFocus(key).then(function (res) {
      if (self._destroyed) return;
      if (!res.success) throw new Error('SAVE_FAILED');
      self._focusVersion++;
      self.setData({selectedFocus:key, selectedFocusLabel:res.data.label || tradeService.labels.focuses[key], focusSaving:false});
      getApp().invalidatePages(['today']);
      toast.showSuccess('已设为本周提醒');
    }).catch(function () {
      if (!self._destroyed) { self.setData({focusSaving:false}); toast.showError('暂时没记下，请重试'); }
    });
  },

  _setTabbarHidden: function (hidden) {
    var tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({hidden:hidden});
  },
  stopPropagation: function () {},
  preventTouchMove: function () {},
  onShareAppMessage: function () { return share.appMessage('交易留痕｜记下当时，过后回看', '/pages/review/index'); },
  onShareTimeline: function () { return share.timeline('交易留痕｜记下当时，过后回看'); }
});
