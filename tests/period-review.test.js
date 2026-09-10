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
assert.ok(page.indexOf("periodType: 'week'") !== -1);
assert.ok(page.indexOf('switchPeriod') !== -1);
assert.ok(template.indexOf('周复盘') !== -1);
assert.ok(template.indexOf('月复盘') !== -1);
assert.ok(template.indexOf('trend-chart') !== -1);
assert.ok(template.indexOf('再有一个有操作的周期，就能生成趋势') !== -1);
assert.ok(template.indexOf('trend-card--compact') !== -1);
assert.ok(page.indexOf('trendReady: activePoints.length >= 2') !== -1);
assert.ok(page.indexOf('trendPointsJson: JSON.stringify(data.trend || [])') !== -1);
assert.ok(page.indexOf('toggleTrend') !== -1);
assert.ok(chart.indexOf("pointsJson: { type: String") !== -1);
assert.ok(chart.indexOf("compact: { type: Boolean") !== -1);
assert.ok(chart.indexOf("ctx.setStrokeStyle('#2D8065')") !== -1);

console.log('period review tests passed');
