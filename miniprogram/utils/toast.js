function showError(content) {
  wx.showToast({ title: content || '操作失败', icon: 'none', duration: 2200 });
}

function showSuccess(content) {
  wx.showToast({ title: content || '已完成', icon: 'success', duration: 1500 });
}

module.exports = {
  showError: showError,
  showSuccess: showSuccess
};
