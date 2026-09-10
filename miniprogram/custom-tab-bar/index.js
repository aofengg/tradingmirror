var TABS = [
  { pagePath: '/pages/today/index', text: '今日', icon: '/assets/icons/tab-today.svg', activeIcon: '/assets/icons/tab-today-active.svg' },
  { pagePath: '/pages/records/index', text: '记录', icon: '/assets/icons/tab-records.svg', activeIcon: '/assets/icons/tab-records-active.svg' },
  { pagePath: '/pages/review/index', text: '复盘', icon: '/assets/icons/tab-review.svg', activeIcon: '/assets/icons/tab-review-active.svg' },
  { pagePath: '/pages/mine/index', text: '我的', icon: '/assets/icons/tab-mine.svg', activeIcon: '/assets/icons/tab-mine-active.svg' }
];

Component({
  data: {
    selected: 0,
    hidden: false,
    tabs: TABS
  },

  methods: {
    switchTab: function (event) {
      var index = Number(event.currentTarget.dataset.index);
      if (index === this.data.selected) return;
      wx.switchTab({ url: event.currentTarget.dataset.path });
    }
  }
});
