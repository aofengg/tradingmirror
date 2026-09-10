var COVER = '/assets/images/app-avatar.png';
var HOME = '/pages/today/index';

function enable() {
  if (!wx.showShareMenu) return;
  wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
}

function appMessage(title, path) {
  return {
    title: title || '交易留痕｜少看结果，多看行为',
    path: path || HOME,
    imageUrl: COVER
  };
}

function timeline(title, query) {
  return {
    title: title || '交易留痕｜少看结果，多看行为',
    query: query || '',
    imageUrl: COVER
  };
}

module.exports = {
  enable: enable,
  appMessage: appMessage,
  timeline: timeline
};
