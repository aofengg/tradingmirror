var assetService = require('../../services/asset-service');
var tradeService = require('../../services/trade-service');
var constants = require('../../config/constants');
var share = require('../../utils/share');

function buildTodoFilters(counts) {
  return [
    { key: 'all', label: '全部', count: counts.all || 0 },
    { key: 'confirm', label: '待确认', count: counts.confirm || 0 },
    { key: 'review', label: '待回看', count: counts.review || 0 }
  ];
}

Page({
  data: {
    viewMode: 'time',
    assetItems: [], assetLoading: false, assetFailed: false, assetMore: false, assetCursor: null,
    assetQuery: '', assetTodoOnly: false,
    loading: true,
    hasLoaded: false,
    loadError: false,
    events: [],
    todoEvents: [],
    filteredEvents: [],
    filter: 'all',
    todoFilter: 'all',
    todoCounts: { all: 0, confirm: 0, review: 0 },
    todoUnavailable: false,
    todoFilters: buildTodoFilters({}),
    draggingSwipeId: '',
    loadingMore: false,
    moreError: false,
    hasMore: true,
    nextCursor: null,
    filters: [
      { key: 'all', label: '全部' },
      { key: 'planned', label: '按计划' },
      { key: 'impulsive', label: '临时决定' },
      { key: 'pending', label: '待办' }
    ]
  },

  onLoad: function () {
    share.enable();
    this._viewScroll = {time:0,asset:0};
    this._assetVersion = 0;
    this._eventsVersion=0;
    this.setData({viewMode:wx.getStorageSync('records_view_mode') === 'asset' ? 'asset' : 'time'});
    var windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this._swipeActionWidth = Math.round(Number(windowInfo.windowWidth || 375) * 148 / 750);
    this._openSwipeId = '';
  },

  onShow: function () {
    if (typeof this.getTabBar === 'function') {
      var tabBar = this.getTabBar();
      if (tabBar) tabBar.setData({ selected: 1 });
    }
    var requestedFilter = getApp().globalData._recordsInitialFilter;
    if (requestedFilter) this.setData({viewMode:'time'});
    else if (this.data.viewMode === 'asset') { this.loadAssets(false, Math.max(20, this.data.assetItems.length)); return; }
    if (requestedFilter) {
      var requestedTodo = getApp().globalData._recordsInitialTodoFilter || 'all';
      this.setData({ filter: requestedFilter, todoFilter: requestedTodo },function(){wx.pageScrollTo({scrollTop:0,duration:0});});
      getApp().globalData._recordsInitialTodoFilter = '';
      getApp().globalData._recordsInitialFilter = '';
      if (this.data.hasLoaded) this._applyFilter();
    }
    var needsRefresh = this._loadedRevision !== getApp().getPageRevision('records');
    if (this.data.hasLoaded && !needsRefresh && this._lastLoadedAt && Date.now() - this._lastLoadedAt < 30000) return;
    this._loadEvents();
  },

  onPullDownRefresh: function () {
    assetService.clearCache();
    if (this.data.viewMode === 'asset') this.loadAssets();
    else this._loadEvents();
  },

  _loadEvents: function () {
    var self = this;
    var revision = getApp().getPageRevision('records');
    var version=++self._eventsVersion;
    var restoreCount=Math.max(20,self.data.events.length);
    var restored=[];
    function readEvents(cursor){return tradeService.getEventPage(20,cursor).then(function(result){
      if(!result.success)throw new Error(result.error||'LOAD_FAILED');
      if(version!==self._eventsVersion)return result;
      restored=restored.concat(result.data.list);
      if(restored.length<restoreCount&&result.data.hasMore&&result.data.nextCursor)return readEvents(result.data.nextCursor);
      return {success:true,data:{list:restored,hasMore:result.data.hasMore,nextCursor:result.data.nextCursor}};
    });}
    self.setData({ loading: !self.data.hasLoaded, loadError: false });
    getApp().waitForLogin().then(function () {
      return Promise.all([
        readEvents(null),
        tradeService.getTodoOverview()
      ]);
    }).then(function (results) {
      if(version!==self._eventsVersion)return;
      var res = results[0];
      var todoRes = results[1];
      if (!res.success) throw new Error(res.error || 'LOAD_FAILED');
      var todoData = todoRes.success ? todoRes.data : {
        confirmItems: [], reviewItems: [], counts: {all:0,confirm:0,review:0}
      };
      var todoEvents = todoData.confirmItems.map(function (item) {
        return Object.assign({}, item, { todo_type: 'confirm' });
      }).concat(todoData.reviewItems.map(function (item) {
        return Object.assign({}, item, { todo_type: 'review' });
      }));
      self.setData({
        loading: false,
        hasLoaded: true,
        events: res.data.list,
        todoEvents: todoEvents,
        todoUnavailable: !todoRes.success,
        todoCounts: todoData.counts,
        todoFilters: buildTodoFilters(todoData.counts),
        hasMore: res.data.hasMore,
        nextCursor: res.data.nextCursor
      });
      self._applyFilter();
      self._lastLoadedAt = Date.now();
      self._loadedRevision = revision;
    }).catch(function (error) {
      if(version!==self._eventsVersion)return;
      console.error('记录加载失败', error);
      self.setData({ loading: false, loadError: true });
    }).then(function () {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom: function () {
    if (this.data.viewMode === 'asset') { if (this.data.assetMore && !this.data.assetLoading) this.loadAssets(true); return; }
    var self = this;
    if (self.data.filter === 'pending') return;
    if (self.data.loadingMore || !self.data.hasMore || !self.data.nextCursor) return;
    self.setData({ loadingMore: true });
    var version=self._eventsVersion;
    tradeService.getEventPage(20, self.data.nextCursor).then(function (res) {
      if(version!==self._eventsVersion)return;
      if (!res.success) throw new Error(res.error || 'LOAD_MORE_FAILED');
      self.setData({
        loadingMore: false,
        moreError: false,
        events: self.data.events.concat(res.data.list),
        hasMore: res.data.hasMore,
        nextCursor: res.data.nextCursor
      });
      self._applyFilter();
    }).catch(function () {
      if(version!==self._eventsVersion)return;
      self.setData({ loadingMore: false, moreError: true });
    });
  },

  chooseFilter: function (event) {
    var nextFilter = event.currentTarget.dataset.filter;
    if(nextFilter===this.data.filter)return;
    var patch = { filter: nextFilter };
    if (nextFilter === 'pending' && this.data.filter !== 'pending') patch.todoFilter = 'all';
    this.setData(patch);
    this._applyFilter();
  },

  chooseTodoFilter: function (event) {
    if(event.currentTarget.dataset.filter===this.data.todoFilter)return;
    this.setData({ todoFilter: event.currentTarget.dataset.filter });
    this._applyFilter();
  },

  _applyFilter: function () {
    var filter = this.data.filter;
    var list;
    if (filter === 'pending') {
      var todoFilter = this.data.todoFilter;
      var confirmItems = this.data.todoEvents.filter(function (item) { return item.todo_type === 'confirm'; });
      var reviewItems = this.data.todoEvents.filter(function (item) { return item.todo_type === 'review'; });
      if (todoFilter === 'confirm') reviewItems = [];
      if (todoFilter === 'review') confirmItems = [];
      list = confirmItems.map(function (item, index) {
        return Object.assign({}, item, {
          todo_group_label: index === 0 ? '待确认' : '',
          todo_group_count: index === 0 ? this.data.todoCounts.confirm : 0
        });
      }, this).concat(reviewItems.map(function (item, index) {
        return Object.assign({}, item, {
          todo_group_label: index === 0 ? '待回看' : '',
          todo_group_count: index === 0 ? this.data.todoCounts.review : 0
        });
      }, this));
    } else {
      list = this.data.events.filter(function (item) {
        if (filter === 'all') return true;
        return item.plan_status === filter;
      });
    }
    this._openSwipeId = '';
    this.setData({
      draggingSwipeId: '',
      filteredEvents: list.map(function (item) {
        return Object.assign({}, assetService.decorate(item), { swipe_offset: 0 });
      })
    });
  },

  onCardTouchStart: function (event) {
    var touch = event.touches && event.touches[0];
    if (!touch) return;
    var index = Number(event.currentTarget.dataset.index);
    var item = this.data.filteredEvents[index];
    if (!item) return;
    this._swipeGesture = {
      id: item._id,
      index: index,
      startX: touch.clientX,
      startY: touch.clientY,
      startOffset: Number(item.swipe_offset || 0),
      horizontal: false
    };
  },

  onCardTouchMove: function (event) {
    var gesture = this._swipeGesture;
    var touch = event.touches && event.touches[0];
    if (!gesture || !touch) return;
    var deltaX = touch.clientX - gesture.startX;
    var deltaY = touch.clientY - gesture.startY;
    if (!gesture.horizontal) {
      if (Math.abs(deltaX) < 8 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
      gesture.horizontal = true;
      if (this._openSwipeId && this._openSwipeId !== gesture.id) this._setSwipeOffset(this._openSwipeId, 0);
    }
    var offset = Math.max(-this._swipeActionWidth, Math.min(0, gesture.startOffset + deltaX));
    var patch = { draggingSwipeId: gesture.id };
    patch['filteredEvents[' + gesture.index + '].swipe_offset'] = offset;
    this.setData(patch);
  },

  onCardTouchEnd: function () {
    var gesture = this._swipeGesture;
    if (!gesture) return;
    this._swipeGesture = null;
    if (!gesture.horizontal) {
      this.setData({ draggingSwipeId: '' });
      return;
    }
    var item = this.data.filteredEvents[gesture.index];
    var shouldOpen = item && Number(item.swipe_offset || 0) < -this._swipeActionWidth * 0.36;
    var patch = { draggingSwipeId: '' };
    patch['filteredEvents[' + gesture.index + '].swipe_offset'] = shouldOpen ? -this._swipeActionWidth : 0;
    this._openSwipeId = shouldOpen ? gesture.id : '';
    this._suppressCardTap = true;
    this.setData(patch);
    var self = this;
    setTimeout(function () { self._suppressCardTap = false; }, 350);
  },

  onCardTouchCancel: function () {
    this.onCardTouchEnd();
  },

  _setSwipeOffset: function (id, offset) {
    var index = this.data.filteredEvents.findIndex(function (item) { return item._id === id; });
    if (index < 0) return;
    var patch = {};
    patch['filteredEvents[' + index + '].swipe_offset'] = offset;
    this.setData(patch);
    if (!offset && this._openSwipeId === id) this._openSwipeId = '';
  },

  onPageScroll: function (event) {
    if (this._viewScroll) this._viewScroll[this.data.viewMode] = event.scrollTop;
  },

  onUnload: function () { clearTimeout(this._assetTimer); this._assetVersion++;this._eventsVersion++; },

  chooseView: function (event) {
    var mode = event.currentTarget.dataset.mode;
    if (mode === this.data.viewMode) return;
    var self=this; var top=this._viewScroll[mode] || 0;
    this.setData({viewMode:mode},function(){wx.pageScrollTo({scrollTop:top,duration:0});});
    wx.setStorageSync('records_view_mode',mode);
    if (mode === 'asset') this.loadAssets(false, Math.max(20, this.data.assetItems.length));
    else if (!this.data.hasLoaded || this._loadedRevision !== getApp().getPageRevision('records')) this._loadEvents();
  },

  searchAssets: function (event) {
    this.setData({assetQuery:event.detail.value,assetCursor:null,assetItems:[],assetMore:false,assetLoading:true});
    this._assetVersion++; clearTimeout(this._assetTimer);
    var self=this; this._assetTimer=setTimeout(function(){self.loadAssets();},350);
  },

  clearAssetSearch: function () {clearTimeout(this._assetTimer);this._assetVersion++;this.setData({assetQuery:'',assetCursor:null,assetItems:[],assetMore:false});this.loadAssets();},

  chooseAssetFilter: function (event) {
    if((event.currentTarget.dataset.filter==='todo')===this.data.assetTodoOnly)return;
    this.setData({assetTodoOnly:event.currentTarget.dataset.filter === 'todo'});
    this.loadAssets();
  },

  loadAssets: function (append, restoreCount) {
    append=append===true;
    var self=this; var version=++this._assetVersion;
    this.setData({assetLoading:true,assetFailed:false});
    var options={query:this.data.assetQuery,todoOnly:this.data.assetTodoOnly,cursor:append?this.data.assetCursor:null};
    var combined=append?this.data.assetItems.slice():[];
    function next(){return assetService.list(options).then(function(result){
      if(version!==self._assetVersion)return;
      combined=combined.concat(result.list);
      if(!append && restoreCount && combined.length<restoreCount && result.hasMore){options.cursor=result.nextCursor;return next();}
      var seen={}; var list=combined.filter(function(item){if(seen[item.key])return false;seen[item.key]=true;return true;});
      self.setData({assetItems:list,assetCursor:result.nextCursor,assetMore:result.hasMore,assetLoading:false});
    });}
    next().catch(function(){if(version===self._assetVersion)self.setData({assetLoading:false,assetFailed:true});}).then(function(){wx.stopPullDownRefresh();});
  },

  openAsset: function (event) {
    var key=event.currentTarget.dataset.key;
    if (!key) { var item=this.data.filteredEvents[event.currentTarget.dataset.index]; if(item) key=assetService.keyFor(item); }
    if(key)assetService.open(key);
  },

  createRecord: function () {
    wx.navigateTo({ url: constants.ROUTES.RECORD + '?stage=after' });
  },

  openReflection: function (event) {
    if (this._suppressCardTap) return;
    if (this._openSwipeId) {
      this._setSwipeOffset(this._openSwipeId, 0);
      return;
    }
    var id = event.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: constants.ROUTES.REFLECTION + '?id=' + encodeURIComponent(id) + '&mode=detail' });
  },

  openConfirmation: function (event) { this.openReflection(event); },
  startReview: function (event) {
    var id=event.currentTarget.dataset.id;
    if(id)wx.navigateTo({url:constants.ROUTES.REFLECTION+'?id='+encodeURIComponent(id)+'&mode=review'});
  },

  openRecordMenu: function (event) {
    var data = event.currentTarget.dataset;
    var actions = [];
    if (data.status === 'pending') {
      actions.push({ label: '已执行', type: 'status', status: 'executed' });
      actions.push({ label: '没有执行', type: 'status', status: 'cancelled' });
    } else if (data.status === 'executed') {
      if (Number(data.reflectionCount || 0) === 0) actions.push({ label: '撤销执行', type: 'status', status: 'pending' });
      else actions.push({ label: '为什么不能撤销？', type: 'explain' });
    } else if (data.status === 'cancelled') {
      actions.push({ label: '恢复待确认', type: 'status', status: 'pending' });
    }
    actions.push({ label: '删除记录', type: 'delete' });

    var self = this;
    wx.showActionSheet({
      itemList: actions.map(function (item) { return item.label; }),
      success: function (res) {
        var action = actions[res.tapIndex];
        if (!action) return;
        if (action.type === 'status') self._changeExecutionStatus(data.id, action.status);
        if (action.type === 'delete') self._confirmDelete(data.id, data.symbol);
        if (action.type === 'explain') self._showRollbackExplanation();
      }
    });
  },

  _showRollbackExplanation: function () {
    wx.showModal({
      title: '已有回看记录',
      content: '这次操作已经留下回看，直接退回会让历史记录相互矛盾。如确实记错，可删除后重新记录。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  _changeExecutionStatus: function (id, status) {
    var self = this;
    tradeService.markExecution(id, status).then(function (res) {
      if (!res.success) {
        var message = res.error === 'REFLECTIONS_EXIST' ? '已有回看，暂不能撤销' : '状态修改失败';
        wx.showToast({ title: message, icon: 'none' });
        return;
      }
      getApp().invalidatePages(['today', 'records', 'review']);
      wx.showToast({ title: status === 'pending' ? '已恢复待确认' : '状态已更新', icon: 'success' });
      self._loadEvents();
    });
  },

  deleteRecord: function (event) {
    if (this._openSwipeId) this._setSwipeOffset(this._openSwipeId, 0);
    this._confirmDelete(event.currentTarget.dataset.id, event.currentTarget.dataset.symbol);
  },

  _confirmDelete: function (id, symbol) {
    var self = this;
    wx.showModal({
      title: '删除这条记录？',
      content: '删除后无法恢复，' + symbol + ' 的这条操作及其回看、备注和图片会一起删除。',
      confirmText: '删除',
      confirmColor: '#B64A45',
      success: function (modalRes) {
        if (!modalRes.confirm) return;
        tradeService.deleteTradeEvent(id).then(function (res) {
          if (!res.success) {
            wx.showToast({ title: '删除失败', icon: 'none' });
            return;
          }
          getApp().invalidatePages(['today', 'records', 'review']);
          self._loadEvents();
        });
      }
    });
  },

  retry: function () {
    this._loadEvents();
  },

  onShareAppMessage: function () {
    return share.appMessage('交易留痕｜记下每次交易决定');
  },

  onShareTimeline: function () {
    return share.timeline('交易留痕｜记下每次交易决定');
  }
});
