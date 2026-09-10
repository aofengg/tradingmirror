var assert = require('assert');
var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var mini = path.join(root, 'miniprogram');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

var app = JSON.parse(read('miniprogram/app.json'));
var appLogic = read('miniprogram/app.js');
var constants = read('miniprogram/config/constants.js');
var tradeService = read('miniprogram/services/trade-service.js');
var variables = read('miniprogram/styles/variables.wxss');
var reflectionPage = read('miniprogram/pages/reflection/index.wxml');
var todayPage = read('miniprogram/pages/today/index.wxml');
var recordsPage = read('miniprogram/pages/records/index.wxml');
var recordsLogic = read('miniprogram/pages/records/index.js');
var recordLogic = read('miniprogram/pages/record/index.js');
var todayLogic = read('miniprogram/pages/today/index.js');
var tradeCloud = read('cloudfunctions/tradeData/index.js');

assert.ok(/CLOUD_ENV:\s*'cloud1-d0gjfc19ve571942b'/.test(constants), 'cloud environment should be explicit');
assert.ok(variables.indexOf('--color-ink:') !== -1, 'design system should expose ink color');
assert.ok(variables.indexOf('--spacing-xl:') !== -1, 'design system should expose spacing scale');
assert.ok(fs.existsSync(path.join(mini, 'components/state-view/index.wxml')), 'shared state-view component missing');

var recentFunction = tradeService.slice(tradeService.indexOf('function getRecentEvents'), tradeService.indexOf('function getEvent'));
assert.strictEqual(recentFunction.indexOf('reflectionsRepo.getList'), -1, 'recent list must not load all reflections');

var pendingFunction = tradeService.slice(tradeService.indexOf('function getPendingReflection'), tradeService.indexOf('function getPendingIntent'));
assert.ok(pendingFunction.indexOf('reflection_count: 0') !== -1, 'pending reflection should use denormalized count');
assert.strictEqual(pendingFunction.indexOf('reflectionsRepo.getList'), -1, 'pending reflection must not scan snapshots');

assert.strictEqual(reflectionPage.indexOf('<optional-supplement entity-type="trade_event"'), -1, 'reflection flow should not prompt for an empty event supplement');
assert.ok(reflectionPage.indexOf('event.optional_note || event.attachments.length') !== -1, 'existing event supplement should remain available as context');
assert.ok(reflectionPage.indexOf('catchtap="openEventSupplementEditor"') !== -1, 'operation context should retain a lightweight supplement entry');
assert.ok(reflectionPage.indexOf('id="eventSupplementEditor" hide-trigger') !== -1, 'event supplement editor should not create a second outer row');
assert.ok(reflectionPage.indexOf('trigger-text="补充这次回看"') !== -1, 'reflection supplement should be clearly scoped to the current reflection');
assert.ok(reflectionPage.indexOf('bindtap="previewReflectionAttachment"') !== -1, 'reflection images should open the native image preview');
assert.ok(todayPage.indexOf('pendingIntentCount > 1') !== -1, 'home should reveal when multiple intents await confirmation');
assert.ok(todayPage.indexOf('共 {{pendingIntentCount}} 条') !== -1, 'pending intent count should be explicit');
assert.ok(todayPage.indexOf('intent-stack__layer') !== -1, 'multiple pending intents should have a restrained stack affordance');
assert.ok(todayPage.indexOf('catchtap="showNextIntent"') !== -1, 'home should let users inspect the next pending intent without resolving the current one');
assert.ok(read('miniprogram/pages/today/index.wxss').indexOf('@keyframes intentPageOut') !== -1, 'pending intent switch should use a page transition instead of an opacity flash');
assert.ok(recordsPage.indexOf('bindtouchmove="onCardTouchMove"') !== -1, 'record cards should support swipe gestures');
assert.ok(recordsPage.indexOf('record-swipe__delete') !== -1, 'record card swipe should reveal a delete action');
assert.ok(recordsPage.indexOf("filter === 'pending'") !== -1, 'records should retain one primary todo entrance');
assert.ok(recordsPage.indexOf('chooseTodoFilter') !== -1, 'todo records should separate confirmation and reflection');
assert.ok(recordsPage.indexOf('todo_group_label') !== -1, 'todo records should be presented in clear groups');
var physicalDelete = tradeCloud.slice(tradeCloud.indexOf('async function deleteTradeEvent'), tradeCloud.indexOf('function sanitizeAttachments'));
assert.ok(physicalDelete.indexOf('.remove()') !== -1, 'trade deletion should physically remove database documents');
assert.strictEqual(physicalDelete.indexOf('is_deleted: true'), -1, 'trade deletion should not leave soft-deleted documents');
assert.ok(recordsLogic.indexOf('删除后无法恢复') !== -1, 'physical deletion should be explicit in the confirmation copy');
assert.ok(appLogic.indexOf('_pageRevisions') !== -1, 'page caches should use independent revisions');
assert.ok(recordLogic.indexOf("invalidatePages(['today', 'records', 'review'])") !== -1, 'new records should invalidate every affected page');
assert.ok(todayLogic.indexOf("getPageRevision('today')") !== -1, 'home refresh should consume only its own revision');
assert.ok(recordsLogic.indexOf("getPageRevision('records')") !== -1, 'records refresh should not be consumed by another tab');

['today', 'records', 'review'].forEach(function (page) {
  var config = JSON.parse(read('miniprogram/pages/' + page + '/index.json'));
  assert.strictEqual(config.usingComponents['state-view'], '/components/state-view/index');
});

app.pages.forEach(function (pagePath) {
  var wxml = read('miniprogram/' + pagePath + '.wxml');
  assert.strictEqual(wxml.indexOf('quick-action__mark'), -1, pagePath + ' contains a legacy symbol icon');
});

[
  'action-buy.svg', 'action-add.svg', 'action-reduce.svg', 'action-exit.svg',
  'feeling-satisfied.svg', 'feeling-acceptable.svg', 'feeling-regret.svg',
  'shield.svg', 'info.svg'
].forEach(function (name) {
  assert.ok(fs.existsSync(path.join(mini, 'assets/icons', name)), 'missing visual asset ' + name);
});

console.log('quality regression tests passed');
