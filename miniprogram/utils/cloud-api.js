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
      var resultCode = (result && result.error) || 'CLOUD_WRITE_FAILED';
      return {
        success: false,
        data: null,
        error: resultCode,
        error_code: resultCode,
        error_detail: (result && result.error_detail) || '',
        platform_code: (result && result.platform_error_code) || '',
        trace_id: (result && result.trace_id) || ''
      };
    }
    return result;
  }).catch(function (error) {
    var detail = String((error && (error.errMsg || error.message)) || 'CLOUD_WRITE_FAILED').slice(0, 300);
    return {
      success: false,
      data: null,
      error: 'CLOUD_FUNCTION_CALL_FAILED',
      error_code: 'CLOUD_FUNCTION_CALL_FAILED',
      error_detail: detail,
      platform_code: error && error.errCode ? String(error.errCode) : '',
      trace_id: ''
    };
  });
}

module.exports = { call: call };
