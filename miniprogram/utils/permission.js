function getOpenid() {
  var app = getApp();
  return (app && app.globalData && app.globalData.openid) || wx.getStorageSync('openid') || '';
}

function checkLogin() {
  var openid = getOpenid();
  if (!openid) return { success: false, data: null, error: 'AUTH_ERROR' };
  return { success: true, data: openid, error: null };
}

module.exports = {
  getOpenid: getOpenid,
  checkLogin: checkLogin
};
