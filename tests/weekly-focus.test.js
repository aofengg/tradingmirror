const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = process.env.FOCUS_PROJECT_ROOT || path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const config = {_id: 'test_config', _openid: 'test_owner', is_deleted: false, data_schema_version: 2, current_focus: 'legacy'};
const records = {user_config: {[config._id]: config}, weekly_focus: {}};
let transactions = 0;
const db = {
  command: {set: value => value},
  serverDate: () => new Date(),
  collection(name) {
    const rows = records[name] || (records[name] = {});
    return {
      where(filter) {this.filter = filter; return this;},
      limit() {return this;},
      async get() {return {data: Object.values(rows).filter(row => Object.keys(this.filter).every(key => row[key] === this.filter[key]))};},
      doc(id) {return {
        async set({data}) {rows[id] = Object.assign({_id: id}, data);},
        async update({data}) {Object.assign(rows[id], data);}
      };}
    };
  },
  async runTransaction(callback) {transactions++; return callback(db);}
};
const backend = {exports: {}, console, require(name) {
  if (name === 'wx-server-sdk') return {init() {}, database: () => db, getWXContext: () => ({OPENID: 'test_owner'})};
  if (name === './asset-tracking') return require(path.join(root, 'cloudfunctions/tradeData/asset-tracking'));
  return require(name);
}};
vm.runInNewContext(read('cloudfunctions/tradeData/index.js'), backend);
let requests = 0, failNext = false;
const api = {call(action, payload) {
  requests++;
  if (failNext) {failNext = false; return Promise.resolve({success: false, error: 'OFFLINE'});}
  // Real cloud calls return serialized copies, never the server's mutable object.
  return backend.exports.main({action, payload}).then(result => JSON.parse(JSON.stringify(result)));
}};
const user = {module: {exports: {}}, wx: {getStorageSync: () => ({})}, require(name) {
  if (name.indexOf('cloud-api') >= 0) return api;
  if (name.indexOf('constants') >= 0) return require(path.join(root, 'miniprogram/config/constants'));
  return {};
}};
vm.runInNewContext(read('miniprogram/services/user-service.js'), user);
const service = {module: {exports: {}}, require(name) {
  if (name.indexOf('trade-options') >= 0) return require(path.join(root, 'miniprogram/config/trade-options'));
  if (name.indexOf('cloud-api') >= 0) return api;
  if (name.indexOf('user-service') >= 0) return user.module.exports;
  return {};
}};
vm.runInNewContext(read('miniprogram/services/trade-service.js'), service);
let pageDefinition, invalidations = [];
const app = {invalidatePages: pages => invalidations.push(pages), getPageRevision: () => invalidations.length, waitForLogin: () => Promise.resolve()};
vm.runInNewContext(read('miniprogram/pages/review/index.js'), {
  Page(value) {pageDefinition = value;},
  console: {error() {}},
  getApp: () => app,
  require(name) {
    if (name.indexOf('trade-service') >= 0) return service.module.exports;
    if (name.indexOf('toast') >= 0) return {showSuccess() {}, showError() {}};
    return {};
  }
});
const tick = () => new Promise(setImmediate);
(async () => {
  // Both normal periods and periods with a plan-related recommendation must retain the new option.
  const event = {_id: 'e', plan_status: 'impulsive', reason_key: 'cannot_stand_volatility', reason_label: '忍不住波动'};
  const summary = backend.buildPeriodSummary([event], [], 'week');
  const recommended = backend.buildPeriodSummary([event], [{trade_event_id: 'e', feeling: 'regret', regret_reason: 'broke_plan'}], 'week');
  for (const item of [summary, recommended, backend.buildPeriodSummary([], [], 'week')]) {
    assert.equal(item.focuses.filter(focus => focus.key === 'delayed_reduce').length, 1);
    assert.equal(item.focuses.find(focus => focus.key === 'delayed_reduce').label, '拖延减仓');
    assert.equal(new Set(item.focusKeys).size, item.focusKeys.length);
  }
  assert.equal(recommended.focusKeys[0], 'panic_sell', 'existing recommendation order survives');
  assert(recommended.focusKeys.includes('follow_plan'));
  const page = Object.assign({}, pageDefinition, {
    data: Object.assign({}, pageDefinition.data, {summary, focusExpanded: true}),
    _reviewCache: {week: {}},
    setData(patch) {Object.assign(this.data, patch);}
  });
  await user.module.exports.getConfig();
  assert.equal(user.module.exports.getCachedConfig().current_focus, 'legacy');
  const tap = {currentTarget: {dataset: {key: 'delayed_reduce'}}};
  failNext = true;
  page.chooseFocus(tap); await tick();
  assert.equal(page.data.focusSaving, false);
  assert.equal(page.data.focusExpanded, true, 'failure keeps choices available to retry');
  assert.equal(page.data.selectedFocus, '', 'failed save never marks selection');
  assert.equal(transactions, 0);
  assert.equal(user.module.exports.getCachedConfig().current_focus, 'legacy', 'failed saves preserve shared cache');
  const before = requests;
  page.chooseFocus(tap); page.chooseFocus(tap); await tick();
  assert.equal(requests - before, 1, 'rapid taps share one save');
  assert.equal(page.data.selectedFocus, 'delayed_reduce');
  assert.equal(page.data.selectedFocusLabel, '拖延减仓');
  assert.equal(page.data.focusExpanded, false, 'success collapses choices immediately');
  assert.equal(page._reviewCache.week.currentFocus.key, 'delayed_reduce');
  assert.equal(invalidations.length, 1);
  assert.equal(config.current_focus.key, 'delayed_reduce');
  assert.equal(config.current_focus.label, '拖延减仓');
  assert.equal(user.module.exports.getCachedConfig().current_focus.label, '拖延减仓', 'saving through trade service synchronizes user config');
  let todayDefinition;
  vm.runInNewContext(read('miniprogram/pages/today/index.js'), {
    Page(value) {todayDefinition = value;},
    Date, console: {error() {}}, getApp: () => app,
    wx: {stopPullDownRefresh() {}},
    require(name) {
      if (name.indexOf('user-service') >= 0) return user.module.exports;
      if (name.indexOf('trade-service') >= 0) return {
        getPendingIntentQueue: () => Promise.resolve({success: false}),
        getPendingReflectionQueue: () => Promise.resolve({success: false}),
        getRecentEvents: () => Promise.resolve({success: false})
      };
      return {};
    }
  });
  const today = Object.assign({}, todayDefinition, {
    data: Object.assign({}, todayDefinition.data, {hasLoaded: true, currentFocus: {key: 'panic_sell', label: '恐慌卖出'}}),
    _loadedRevision: 0, _lastLoadedAt: Date.now(),
    setData(patch) {Object.assign(this.data, patch);}
  });
  today.onShow();
  assert.equal(today.data.currentFocus.label, '拖延减仓', 'returning home updates before network reads complete');
  await tick();
  assert.equal(today.data.loadError, true);
  assert.equal(today.data.currentFocus.label, '拖延减仓', 'failed queue reload cannot hide the newly saved focus');
  today._loadedRevision = app.getPageRevision();
  today._lastLoadedAt = Date.now();
  today.data.currentFocus = {label: '旧提醒'};
  const beforeFastShow = requests;
  today.onShow();
  assert.equal(today.data.currentFocus.label, '拖延减仓', 'cached-page fast path also synchronizes focus');
  assert.equal(requests, beforeFastShow, 'immediate focus update adds no cloud requests');

  const saved = Object.values(records.weekly_focus);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]._openid, 'test_owner');
  assert.equal(saved[0].behavior_key, 'delayed_reduce');
  assert.equal(saved[0].behavior_label, '拖延减仓');
  page.data.focusExpanded = true; page.chooseFocus(tap); await tick();
  assert.equal(requests - before, 1, 'selected option does not write again');
  assert.equal(page.data.focusExpanded, false);
  const invalid = await service.module.exports.saveWeeklyFocus('unknown');
  assert.equal(invalid.success, false);
  const backendInvalid = await backend.exports.main({action: 'saveWeeklyFocus', payload: {key: 'unknown'}});
  assert.equal(backendInvalid.success, false);
  assert.equal(transactions, 1, 'invalid options cause no writes');
  const legacy = await service.module.exports.saveWeeklyFocus('panic_sell');
  assert.equal(legacy.success, true);
  assert.equal(config.current_focus.label, '恐慌卖出');
  assert.equal(Object.keys(records.weekly_focus).length, 1, 'one focus per week is maintained');
  console.log('Weekly focus: visible choices, frontend/backend validation, atomic saved labels, retry, rapid taps, shared cache, immediate home refresh, offline home, fast return and legacy options passed');
})().catch(error => {console.error(error); process.exitCode = 1;});
