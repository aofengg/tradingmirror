var history = require('../../services/related-history-service');
Component({
  properties: {
    source: { type: Object, value: null, observer: function () { if (this._ready) this.refresh(); } },
    compact: { type: Boolean, value: false },
    preview: { type: Boolean, value: false }
  },
  data: { count: 0, items: [], previewItems: [], visible: false, loading: false, failed: false, hasMore: false },
  lifetimes: {
    attached: function () { this._ready = true; this._version = 0; this.refresh(); },
    detached: function () { this.restoreTabBar(); this._ready = false; this._version++; }
  },
  pageLifetimes: { show: function () { if (this._ready) this.refresh(); }, hide: function () { this.close(); } },
  methods: {
    refresh: function () {
      var self = this;
      var version = ++this._version;
      this.restoreTabBar();
      this.setData({ count: 0, items: [], previewItems: [], visible: false, loading: false, failed: false, hasMore: false });
      if (!this.data.source || !this.data.source._id) return;
      getApp().waitForLogin().then(function () { return history.getHistory(self.data.source, 0); }).then(function (res) {
        if (!self._ready || version !== self._version) return;
        if (!res.success) return;
        self.setData({ count: res.data.count, items: res.data.items, previewItems: res.data.items.slice(0, 3), hasMore: res.data.hasMore });
      }).catch(function () {});
    },
    open: function () {
      if (!this.data.count) return;
      var pages = getCurrentPages();
      var page = pages[pages.length - 1];
      var bar = page && typeof page.getTabBar === 'function' ? page.getTabBar() : null;
      if (bar && !this._tabBar) { this._tabBar = bar; this._tabBarHidden = !!bar.data.hidden; bar.setData({ hidden: true }); }
      this.setData({ visible: true });
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
      var items = append ? this.data.items.slice() : [];
      this.setData({ loading: true, failed: false });
      history.getHistory(this.data.source, items.length).then(function (res) {
        if (!self._ready || version !== self._version) return;
        if (!res.success) throw new Error('LOAD_FAILED');
        var seen = {};
        var combined = items.concat(res.data.items).filter(function (item) { if (seen[item._id]) return false; seen[item._id] = true; return true; });
        self.setData({ loading: false, count: res.data.count, items: combined, previewItems: combined.slice(0, 3), hasMore: res.data.hasMore });
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
