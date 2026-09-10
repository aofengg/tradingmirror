var assert = require('assert');
var behavior = require('../miniprogram/utils/behavior');

var events = [
  { _id: '1', plan_status: 'impulsive', reason_key: 'fear_giveback' },
  { _id: '2', plan_status: 'impulsive', reason_key: 'fear_giveback' },
  { _id: '3', plan_status: 'planned', reason_key: 'target_reached' }
];

var reflections = [
  { trade_event_id: '1', feeling: 'acceptable', regret_reason: '' },
  { trade_event_id: '1', feeling: 'regret', regret_reason: 'sold_early' },
  { trade_event_id: '2', feeling: 'acceptable', regret_reason: '' },
  { trade_event_id: 'outside-week', feeling: 'regret', regret_reason: 'sold_early' }
];

var summary = behavior.buildWeeklySummary(events, reflections, {
  reason: { fear_giveback: '担心利润回吐' }
});

assert.strictEqual(summary.eventCount, 3);
assert.strictEqual(summary.impulsiveCount, 2);
assert.strictEqual(summary.regretCount, 0);
assert.strictEqual(summary.reviewedCount, 2);
assert.strictEqual(summary.changedFeelingCount, 1);
assert.strictEqual(summary.focusKeys[0], 'panic_sell');
assert.ok(summary.pattern.indexOf('担心利润回吐') !== -1);

console.log('behavior tests passed');
