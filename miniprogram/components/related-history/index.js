var history = require('../../services/related-history-service');
Component({
  properties: {
    source: { type: Object, value: null, observer: function () { if (this._ready) {if(this.data.sheetOnly)this.invalidate();else this.refresh();} } },
    sheetOnly: { type: Boolean, value: false },
    compact: { type: Boolean, value: false },
    preview: { type: Boolean, value: false }
  },
  data: { count: 0, items: [], previewItems: [], visible: false, loading: false, failed: false, hasMore: false, checked: false },
  lifetimes: {
    attached: function () { this._ready = true; this._version = 0; if(!this.data.sheetOnly)this.refresh(); },
    detached: function () { this.restoreTabBar(); this._ready = false; this._version++; }
  },
  pageLifetimes: { show: function () { if (this._ready && !this.data.sheetOnly) this.refresh(); }, hide: function () { this.close(); } },
  methods: {
    invalidate: function () {this._version++;this.close();this._refreshedAt=0;this.setData({count:0,items:[],previewItems:[],loading:false,failed:false,checked:false,hasMore:false});},
    sourceKey: function () {var source=this.data.source||{},app=getApp();return JSON.stringify([source._id,source.action,source.reason_key,source.occurred_at||source.created_at,typeof app.getPageRevision==='function'?app.getPageRevision('records'):0]);},
    refresh: function () {
      var self = this;
      var app=getApp();
      var source=this.data.source||{};
      var revision=typeof app.getPageRevision==='function'?app.getPageRevision('records'):0;
      var key=JSON.stringify([source._id,source.action,source.reason_key,source.occurred_at||source.created_at,revision]);
      if(key===this._refreshKey&&(this._refreshing||this._refreshedAt&&Date.now()-this._refreshedAt<30000&&!this.data.failed))return;
      this._refreshKey=key;this._refreshing=true;
      var version = ++this._version;
      this.restoreTabBar();
      this.setData({ count: 0, items: [], previewItems: [], visible: false, loading: false, failed: false, hasMore: false, checked: false });
      if (!this.data.source || !this.data.source._id) {this._refreshing=false;return;}
      this.setData({loading:true});
      getApp().waitForLogin().then(function () { return history.getHistory(self.data.source, 0); }).then(function (res) {
        if (!self._ready || version !== self._version) return;
        if (!res.success) throw new Error('LOAD_FAILED');
        self._refreshing=false;self._refreshedAt=Date.now();self._loadedKey=key;
        self.setData({ loading:false, checked:true, count: res.data.count, items: res.data.items, previewItems: res.data.items.slice(0, 3), hasMore: res.data.hasMore });
      }).catch(function () {if(self._ready&&version===self._version){self._refreshing=false;self.setData({loading:false,failed:true});}});
    },
    open: function () {
      if (!this.data.source || !this.data.source._id || this.data.visible) return;
      var pages = getCurrentPages();
      var page = pages[pages.length - 1];
      var bar = page && typeof page.getTabBar === 'function' ? page.getTabBar() : null;
      if (bar && !this._tabBar) { this._tabBar = bar; this._tabBarHidden = !!bar.data.hidden; bar.setData({ hidden: true }); }
      this.setData({ visible: true });
      if(this.data.checked&&!this.data.failed&&this._loadedKey===this.sourceKey()&&Date.now()-this._refreshedAt<30000)return;
      this.reload();
    },
    close: function () { this.restoreTabBar(); this.setData({ visible: false }); },
    restoreTabBar: function () {
      if (this._tabBar) { this._tabBar.setData({ hidden: this._tabBarHidden }); this._tabBar = null; }
    },
    stop: function () {},
    reload: function () { this.load(false); },
    more: function () { if (this.data.hasMore && !this.data.loading) this.load(true); },
    load: function (append) {
      var self = this;
      var version = ++this._version;
      var key=this.sourceKey();
      var items = append ? this.data.items.slice() : [];
      this.setData({ loading: true, failed: false });
      getApp().waitForLogin().then(function(){return history.getHistory(self.data.source, items.length);}).then(function (res) {
        if (!self._ready || version !== self._version) return;
        if (!res.success) throw new Error('LOAD_FAILED');
        var seen = {};
        var combined = items.concat(res.data.items).filter(function (item) { if (seen[item._id]) return false; seen[item._id] = true; return true; });
        self._refreshedAt=Date.now();self._loadedKey=key;
        self.setData({ loading: false, checked:true, count: res.data.count, items: combined, previewItems: combined.slice(0, 3), hasMore: res.data.hasMore });
      }).catch(function () {
        if (self._ready && version === self._version) self.setData({ loading: false, failed: true });
      });
    },
    openRecord: function (event) {
      var id = event.currentTarget.dataset.id;
      if (!id) return;
      this.close();
      wx.navigateTo({ url: '/pages/reflection/index?id=' + encodeURIComponent(id) });
    }
  }
});
