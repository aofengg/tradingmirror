function countBy(items, field) {
  var counts = {};
  for (var i = 0; i < items.length; i++) {
    var key = items[i][field];
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function topKey(counts) {
  var keys = Object.keys(counts);
  if (!keys.length) return '';
  keys.sort(function (a, b) { return counts[b] - counts[a]; });
  return keys[0];
}

function buildWeeklySummary(events, reflections, labelMaps) {
  var reflectionByTrade = {};
  var feelingHistoryByTrade = {};
  var eventIds = {};
  events.forEach(function (event) { eventIds[event._id] = true; });
  for (var i = 0; i < reflections.length; i++) {
    var item = reflections[i];
    if (!eventIds[item.trade_event_id]) continue;
    if (!reflectionByTrade[item.trade_event_id]) reflectionByTrade[item.trade_event_id] = item;
    if (!feelingHistoryByTrade[item.trade_event_id]) feelingHistoryByTrade[item.trade_event_id] = [];
    feelingHistoryByTrade[item.trade_event_id].push(item.feeling);
  }

  var impulsiveEvents = events.filter(function (item) { return item.plan_status === 'impulsive'; });
  var latestReflections = Object.keys(reflectionByTrade).map(function (key) { return reflectionByTrade[key]; });
  var regrets = latestReflections.filter(function (item) { return item.feeling === 'regret'; });
  var changedFeelingCount = Object.keys(feelingHistoryByTrade).filter(function (key) {
    var unique = {};
    feelingHistoryByTrade[key].forEach(function (feeling) { unique[feeling] = true; });
    return Object.keys(unique).length > 1;
  }).length;
  var topReasonKey = topKey(countBy(impulsiveEvents, 'reason_key'));
  var topRegretKey = topKey(countBy(regrets, 'regret_reason'));
  var focusKeys = [];

  if (topReasonKey === 'fear_giveback' || topReasonKey === 'cannot_stand_volatility') focusKeys.push('panic_sell');
  if (topReasonKey === 'fear_missing' || topRegretKey === 'chased_high') focusKeys.push('chase_high');
  if (topReasonKey === 'switch_symbol') focusKeys.push('frequent_adjustment');
  if (topRegretKey === 'broke_plan') focusKeys.push('follow_plan');
  ['panic_sell', 'chase_high', 'frequent_adjustment'].forEach(function (key) {
    if (focusKeys.indexOf(key) === -1) focusKeys.push(key);
  });

  var pattern = '';
  if (topReasonKey) {
    pattern = '最常见的临时原因是「' + (labelMaps.reason[topReasonKey] || topReasonKey) + '」。';
  } else if (events.length) {
    pattern = '本周的操作多数按原计划完成。';
  }

  return {
    eventCount: events.length,
    impulsiveCount: impulsiveEvents.length,
    regretCount: regrets.length,
    reviewedCount: Object.keys(reflectionByTrade).length,
    changedFeelingCount: changedFeelingCount,
    pattern: pattern,
    focusKeys: focusKeys.slice(0, 3)
  };
}

module.exports = {
  countBy: countBy,
  topKey: topKey,
  buildWeeklySummary: buildWeeklySummary
};
