var assert = require('assert');
var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var cloud = fs.readFileSync(path.join(root, 'cloudfunctions/tradeData/index.js'), 'utf8');
var page = fs.readFileSync(path.join(root, 'miniprogram/pages/review/index.js'), 'utf8');
var template = fs.readFileSync(path.join(root, 'miniprogram/pages/review/index.wxml'), 'utf8');
var chart = fs.readFileSync(path.join(root, 'miniprogram/components/trend-chart/index.js'), 'utf8');

assert.ok(cloud.indexOf('periodDefinition') !== -1);
assert.ok(cloud.indexOf("period_type: 'week'") !== -1);
assert.ok(cloud.indexOf("action === 'getPeriodReview'") !== -1);
assert.ok(cloud.indexOf("METRICS: 'period_metrics'") !== -1);
assert.ok(cloud.indexOf('Math.round(planned.length / events.length * 100)') !== -1, 'discipline score must count only explicitly planned events');
assert.strictEqual(cloud.indexOf('(events.length - impulsive.length) / events.length'), -1, 'uncertain events must not count as planned');
assert.ok(cloud.indexOf('current_focus: command.set(focus)') !== -1, 'weekly focus should replace the legacy string value atomically');
assert.ok(cloud.indexOf("action === 'getPeriodDetail'") !== -1, 'period metrics should expose matching trade details');
assert.ok(cloud.indexOf('reasonDistributionReady: events.length >= 5') !== -1, 'reason distribution must wait for a useful sample');
assert.ok(cloud.indexOf('buildChangeClue') !== -1, 'multi-period changes should be phrased as clues');
// Period APIs remain compatible for existing clients; the current UI has one lightweight view.
assert.ok(page.indexOf("range: 'all'") !== -1);
assert.ok(page.indexOf('chooseRange') !== -1);
assert.ok(template.indexOf('reasonRows') !== -1);
assert.ok(template.indexOf('openRelation') !== -1);
assert.strictEqual(template.indexOf('trend-chart'), -1);
assert.strictEqual(template.indexOf('计划执行率'), -1);
console.log('period review API compatibility and lightweight entry tests passed');
