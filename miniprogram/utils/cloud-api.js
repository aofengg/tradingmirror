function call(action, payload) {
  return wx.cloud.callFunction({
    name: 'tradeData',
    data: {
      action: action,
      payload: payload || {}
    }
  }).then(function (res) {
    var result = res && res.result;
    if (!result || result.success !== true) {
      return {
        success: false,
        data: null,
        error: (result && result.error) || 'CLOUD_WRITE_FAILED'
      };
    }
    return result;
  }).catch(function (error) {
    return {
      success: false,
      data: null,
      error: (error && error.errMsg) || 'CLOUD_WRITE_FAILED'
    };
  });
}

module.exports = { call: call };
