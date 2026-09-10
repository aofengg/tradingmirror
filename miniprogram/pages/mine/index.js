var userService = require('../../services/user-service');
var share = require('../../utils/share');

Page({
  data: {
    currentFocus: null,
    recentSymbols: []
  },

  onLoad: function () {
    share.enable();
  },

  onShow: function () {
    if (typeof this.getTabBar === 'function') {
      var tabBar = this.getTabBar();
      if (tabBar) tabBar.setData({ selected: 3 });
    }
    this._loadConfig();
  },

  _loadConfig: function () {
    var self = this;
    getApp().waitForLogin().then(function () {
      return userService.getConfig();
    }).then(function (res) {
      if (!res.success) return;
      self.setData({
        currentFocus: res.data.current_focus || null,
        recentSymbols: res.data.recent_symbols || []
      });
    });
  },

  showDataNotice: function () {
    wx.showModal({
      title: '数据说明',
      content: '你的记录与当前微信账号绑定，仅自己可见。',
      showCancel: false
    });
  },

  showAbout: function () {
    wx.showModal({
      title: '关于交易留痕',
      content: '面向业余交易者的极简交易行为记录与复盘工具。只记录决策和感受，不提供投资建议。',
      showCancel: false
    });
  },

  openReview: function () {
    wx.switchTab({ url: '/pages/review/index' });
  },

  onShareAppMessage: function () {
    return share.appMessage('交易留痕｜看见自己的交易行为');
  },

  onShareTimeline: function () {
    return share.timeline('交易留痕｜看见自己的交易行为');
  }
});
