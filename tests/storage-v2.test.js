var assert = require('assert');
var fs = require('fs');
var path = require('path');
var asset = require('../miniprogram/utils/asset');

var root = path.resolve(__dirname, '..');
var constants = require('../miniprogram/config/constants');
var cloudSource = fs.readFileSync(path.join(root, 'cloudfunctions/tradeData/index.js'), 'utf8');
var serviceSource = fs.readFileSync(path.join(root, 'miniprogram/services/trade-service.js'), 'utf8');
var repoSource = fs.readFileSync(path.join(root, 'miniprogram/repository/base-repo.js'), 'utf8');

assert.strictEqual(constants.DATA_SCHEMA_VERSION, 2);
assert.strictEqual(constants.COLLECTIONS.PERIOD_METRICS, 'period_metrics');
assert.strictEqual(asset.fromSymbol('AAPL').market, 'US');
assert.strictEqual(asset.fromSymbol('00700.HK').market, 'HK');
assert.strictEqual(asset.fromSymbol('600519.SH').market, 'CN');

[
  'client_request_id',
  'schema_version',
  'recorded_at',
  'reviewed_at',
  'horizon_key',
  'event_age_hours',
  'option_set_version',
  'rule_refs',
  'runTransaction',
  'period_metrics',
  'migrateUserData'
].forEach(function (token) {
  assert.ok(cloudSource.indexOf(token) !== -1, 'cloud storage v2 missing ' + token);
});

assert.ok(serviceSource.indexOf("cloudApi.call('addReflection'") !== -1, 'reflection writes must use cloud transaction API');
assert.ok(serviceSource.indexOf('getEventPage') !== -1, 'cursor page API missing');
assert.ok(repoSource.indexOf('opts.cursor') !== -1, 'repository cursor support missing');
assert.ok(repoSource.indexOf('nextCursor') !== -1, 'repository cursor result missing');
assert.strictEqual(repoSource.indexOf('.add({ data:'), -1, 'client repository must not expose direct writes');
assert.strictEqual(repoSource.indexOf('.update({ data:'), -1, 'client repository must not expose direct writes');

console.log('storage v2 tests passed');
