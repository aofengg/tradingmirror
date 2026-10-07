var share = require('../../utils/share');

Page({
  data: {},

  onLoad: function () {
    share.enable();
  },

  onShow: function () {
    if (typeof this.getTabBar === 'function') {
      var tabBar = this.getTabBar();
      if (tabBar) tabBar.setData({ selected: 3 });
    }
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
      content: '记下交易决定与后来的感受，帮助你回看自己的行为。只记录决策和感受，不提供投资建议。',
      showCancel: false
    });
  },

  showUsage: function () {
    wx.showModal({title:'怎么使用',content:'准备操作或刚刚操作时，用三步记下标的、动作和原因。\n\n操作前的想法，之后在今日确认是否执行。\n\n从待回看记录进入，留下此刻的感受；每次回看都会保留。',showCancel:false,confirmText:'知道了'});
  },

  onShareAppMessage: function () {
    return share.appMessage('交易留痕｜看见自己的交易行为');
  },

  onShareTimeline: function () {
    return share.timeline('交易留痕｜看见自己的交易行为');
  }
});
