function pad(value) {
  return value < 10 ? '0' + value : String(value);
}

function toDate(value) {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  return new Date(value);
}

function formatDate(value) {
  var date = toDate(value);
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function formatShort(value) {
  var date = toDate(value);
  return (date.getMonth() + 1) + '月' + date.getDate() + '日';
}

function formatDateTime(value) {
  var date = toDate(value);
  return formatShort(date) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function startOfWeek(value) {
  var date = toDate(value);
  var copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  var day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function relativeTime(value) {
  var diff = Date.now() - toDate(value).getTime();
  if (diff < 60 * 60 * 1000) return '刚刚';
  if (diff < 24 * 60 * 60 * 1000) return Math.max(1, Math.floor(diff / 3600000)) + '小时前';
  return Math.max(1, Math.floor(diff / 86400000)) + '天前';
}

module.exports = {
  formatDate: formatDate,
  formatShort: formatShort,
  formatDateTime: formatDateTime,
  startOfWeek: startOfWeek,
  relativeTime: relativeTime
};
