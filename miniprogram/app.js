var constants = require('./config/constants');

App({
  globalData: {
    openid: '',
    userConfig: null,
    _pageRevisions: { today: 0, records: 0, review: 0 }
  },

  _loginPromise: null,

  onLaunch: function () {
    if (!wx.cloud) {
      wx.showModal({
        title: '版本过低',
        content: '当前微信版本不支持云开发，请升级后重试。',
        showCancel: false
      });
      this._loginPromise = Promise.reject(new Error('CLOUD_UNAVAILABLE'));
      return;
    }

    var cloudOptions = { traceUser: true };
    if (constants.CLOUD_ENV) cloudOptions.env = constants.CLOUD_ENV;
    wx.cloud.init(cloudOptions);
    this._loginPromise = this._login();
  },

  waitForLogin: function () {
    return this._loginPromise || Promise.resolve();
  },

  invalidatePages: function (pageNames) {
    var revisions = this.globalData._pageRevisions;
    (pageNames || []).forEach(function (name) {
      if (typeof revisions[name] === 'number') revisions[name] += 1;
    });
  },

  getPageRevision: function (pageName) {
    return Number(this.globalData._pageRevisions[pageName] || 0);
  },

  _login: function () {
    var self = this;
    var cachedOpenid = wx.getStorageSync('openid');
    if (cachedOpenid) {
      self.globalData.openid = cachedOpenid;
      return self._loadUserConfig();
    }
    return wx.cloud.callFunction({ name: 'login' }).then(function (res) {
      if (!res.result || !res.result.openid) throw new Error('LOGIN_FAILED');
      self.globalData.openid = res.result.openid;
      wx.setStorageSync('openid', res.result.openid);
      return self._loadUserConfig();
    }).catch(function (error) {
      console.error('登录失败', error);
      throw error;
    });
  },

  _loadUserConfig: function () {
    var self = this;
    var userService = require('./services/user-service');
    return userService.getConfig().then(function (res) {
      if (res.success) self.globalData.userConfig = res.data;
      return res;
    });
  }
});
