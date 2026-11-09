// Date-only entries use midnight as a partition anchor, never as an actual time.
var DAY = 86400000;
var OFFSET = 28800000;
function day(value) { return new Date((value === undefined ? Date.now() : Number(value)) + OFFSET).toISOString().slice(0, 10); }
function start(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return NaN;
  var at = Date.parse(value + 'T00:00:00+08:00');
  return isFinite(at) && day(at) === value ? at : NaN;
}
function short(value) { return Number(value.slice(5, 7)) + '月' + Number(value.slice(8, 10)) + '日'; }
function build(date, clock, nowMode, now) {
  now = now === undefined ? Date.now() : Number(now);
  var base = start(date);
  if (!isFinite(base) || date > day(now)) throw new Error('INVALID_DATE');
  var precision = 'date', at = base;
  if (nowMode && date === day(now)) { precision = 'datetime'; at = now; }
  else if (clock) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) throw new Error('INVALID_TIME');
    at = base + Number(clock.slice(0, 2)) * 3600000 + Number(clock.slice(3)) * 60000;
    if (at > now) throw new Error('FUTURE_TIME');
    precision = 'datetime';
  }
  return { occurred_at: new Date(at).toISOString(), occurred_date: date, occurred_at_precision: precision,
    entry_source: nowMode && date === day(now) ? 'at_time' : 'retrospective', timezone: 'Asia/Shanghai' };
}
function time(value) { var n = value ? new Date(value).getTime() : 0; return isFinite(n) ? n : 0; }
function bounds(event) {
  var at = time(event.executed_at || event.occurred_at || event.created_at);
  if (event.occurred_at_precision === 'date' && isFinite(start(event.occurred_date))) {
    var base = start(event.occurred_date); return { start: base, end: base + DAY - 1, precision: 'date' };
  }
  return { start: at, end: at, precision: 'datetime' };
}
function label(event, full) {
  var b = bounds(event);
  if (!b.start) return '时间未记录';
  var date = day(b.start);
  var prefix = full ? date : short(date);
  if (b.precision === 'date') return prefix + ' · 时刻未填';
  return prefix + ' ' + new Date(b.start + OFFSET).toISOString().slice(11, 16);
}
function horizon(event, now) {
  var b = bounds(event), min = Math.max(0, (now - b.end) / 3600000), max = Math.max(0, (now - b.start) / 3600000);
  function key(hours) { return hours <= 6 ? 'immediate' : hours <= 48 ? 'next_day' : hours <= 240 ? 'one_week' : 'later'; }
  return { key: key(min) === key(max) ? key(min) : 'date_only', hours: b.precision === 'date' ? null : Math.round(max * 10) / 10,
    min: Math.round(min * 10) / 10, max: Math.round(max * 10) / 10 };
}
module.exports = { day: day, start: start, short: short, build: build, time: time, bounds: bounds, label: label, horizon: horizon, DAY: DAY };
