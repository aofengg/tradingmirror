var tradeEventsRepo = require('../repository/trade-events-repo');
var reflectionsRepo = require('../repository/reflections-repo');
var userService = require('./user-service');
var tradeOptions = require('../config/trade-options');
var dateUtil = require('../utils/date');
var db = require('../utils/db');
var constants = require('../config/constants');
var cloudApi = require('../utils/cloud-api');
var requestId = require('../utils/request-id');
var assetUtil = require('../utils/asset');

var ACTION_LABELS = { buy: '买入', add: '加仓', reduce: '减仓', exit: '清仓' };
var PLAN_LABELS = { planned: '按原计划', impulsive: '临时决定', uncertain: '不确定' };
var FEELING_LABELS = { satisfied: '满意', acceptable: '可以接受', regret: '懊悔' };
var FOCUS_LABELS = {
  panic_sell: '恐慌卖出',
  chase_high: '冲动追高',
  frequent_adjustment: '频繁调仓',
  follow_plan: '临时改变计划'
};

function buildReasonLabels() {
  var map = {};
  ['buy', 'exit'].forEach(function (action) {
    tradeOptions.getReasons(action).forEach(function (item) { map[item.key] = item.label; });
  });
  return map;
}

var REASON_LABELS = buildReasonLabels();

function symbolLayout(value) {
  var symbol = String(value || '');
  var visualUnits = 0;
  for (var i = 0; i < symbol.length; i++) {
    visualUnits += symbol.charCodeAt(i) > 255 ? 2 : 1;
  }
  return visualUnits > 10 ? 'long' : 'compact';
}

function createTradeEvent(data) {
  var asset = assetUtil.fromSymbol(data.symbol);
  var symbol = asset.symbol;
  var action = tradeOptions.findOption(tradeOptions.ACTIONS, data.action);
  var reason = tradeOptions.findOption(tradeOptions.getReasons(data.action), data.reasonKey);
  if (!symbol || !action || !reason) {
    return Promise.resolve({ success: false, data: null, error: 'VALIDATION_ERROR' });
  }
  var stage = data.stage === 'before' ? 'before' : 'after';
  var executed = stage === 'after';
  var record = {
    client_request_id: data.clientRequestId || requestId.create('event'),
    symbol: symbol,
    market: data.market || asset.market,
    asset_type: data.assetType || asset.asset_type,
    asset_name_snapshot: data.assetName || '',
    action: action.key,
    action_label: action.label,
    reason_key: reason.key,
    reason_label: reason.label,
    plan_status: reason.planStatus,
    stage: stage,
    occurred_at: data.occurredAt || new Date(),
    timezone: 'Asia/Shanghai',
    option_set_version: constants.OPTION_SET_VERSION,
    rule_refs: data.ruleRefs || [],
    optional_note: '',
    ext: {}
  };
  return cloudApi.call('createTradeEvent', record).then(function (res) {
    if (!res.success) return res;
    userService.addRecentSymbol(symbol).catch(function () {});
    return { success: true, data: res.data, error: null };
  });
}

function markExecution(id, status) {
  if (status !== 'pending' && status !== 'executed' && status !== 'cancelled') {
    return Promise.resolve({ success: false, data: null, error: 'VALIDATION_ERROR' });
  }
  return cloudApi.call('markExecution', { id: id, status: status });
}

function updatePlanStatus(id, status) {
  if (!PLAN_LABELS[status]) return Promise.resolve({ success: false, data: null, error: 'VALIDATION_ERROR' });
  return cloudApi.call('updatePlanStatus', { id: id, status: status });
}

function addReflection(tradeEventId, feeling, regretReason, clientRequestId) {
  if (!FEELING_LABELS[feeling]) return Promise.resolve({ success: false, data: null, error: 'VALIDATION_ERROR' });
  var regret = feeling === 'regret'
    ? tradeOptions.findOption(tradeOptions.REGRET_REASONS, regretReason)
    : null;
  if (feeling === 'regret' && !regret) return Promise.resolve({ success: false, data: null, error: 'VALIDATION_ERROR' });
  var snapshot = {
    client_request_id: clientRequestId || requestId.create('reflection'),
    trade_event_id: tradeEventId,
    feeling: feeling,
    feeling_label: FEELING_LABELS[feeling],
    regret_reason: regret ? regret.key : '',
    regret_reason_label: regret ? regret.label : ''
  };
  return cloudApi.call('addReflection', snapshot).then(function (res) {
    if (!res.success) return res;
    return { success: true, data: res.data.snapshot, error: null, duplicate: res.data.duplicate };
  });
}

function getReflectionsForTrade(tradeEventId) {
  return reflectionsRepo.getList({ where: { trade_event_id: tradeEventId }, pageSize: 100 }).then(function (res) {
    if (!res.success) return res;
    var list = res.data.list.map(function (item) {
      var horizonLabels = { immediate: '当下回看', next_day: '次日回看', one_week: '一周回看', later: '长期回看', legacy: '过往回看' };
      return Object.assign({}, item, {
        schema_version: item.schema_version || 1,
        horizon_key: item.horizon_key || 'legacy',
        horizon_label: horizonLabels[item.horizon_key || 'legacy'],
        reviewed_at: item.reviewed_at || item.created_at,
        optional_note: item.optional_note || '',
        attachments: item.attachments || [],
        created_label: dateUtil.formatDateTime(item.reviewed_at || item.created_at),
        relative_label: dateUtil.relativeTime(item.reviewed_at || item.created_at)
      });
    });
    return { success: true, data: list, error: null };
  });
}

function decorateEvent(item) {
  var executionLabels = { pending: '待确认', executed: '已执行', cancelled: '未执行' };
  return Object.assign({}, item, {
    schema_version: item.schema_version || 1,
    market: item.market || assetUtil.inferMarket(item.symbol),
    asset_type: item.asset_type || 'stock',
    occurred_at: item.occurred_at || item.executed_at || item.created_at,
    recorded_at: item.recorded_at || item.created_at,
    option_set_version: item.option_set_version || 1,
    rule_refs: item.rule_refs || [],
    optional_note: item.optional_note || '',
    attachments: item.attachments || [],
    action_label: item.action_label || ACTION_LABELS[item.action] || item.action,
    symbol_layout: symbolLayout(item.symbol),
    reason_label: item.reason_label || REASON_LABELS[item.reason_key] || item.reason_key,
    plan_label: PLAN_LABELS[item.plan_status] || '不确定',
    created_label: dateUtil.formatDateTime(item.created_at),
    relative_label: dateUtil.relativeTime(item.created_at),
    latest_feeling_label: item.latest_feeling_label || '',
    execution_status: item.execution_status || 'executed',
    execution_label: executionLabels[item.execution_status || 'executed']
  });
}

function getEventPage(limit, cursor) {
  return tradeEventsRepo.getList({ pageSize: limit || 20, cursor: cursor || null }).then(function (result) {
    if (!result.success) return result;
    var list = result.data.list.map(decorateEvent);
    return { success: true, data: { list: list, hasMore: result.data.hasMore, nextCursor: result.data.nextCursor }, error: null };
  });
}

function getRecentEvents(limit) {
  return getEventPage(limit, null).then(function (result) {
    if (!result.success) return result;
    return { success: true, data: result.data.list, error: null };
  });
}

function getEvent(id) {
  return tradeEventsRepo.getById(id).then(function (res) {
    if (!res.success) return res;
    return { success: true, data: decorateEvent(res.data), error: null };
  });
}

function getPendingReflection() {
  var cmd = db.getCommand();
  return tradeEventsRepo.getList({
    where: { execution_status: 'executed', reflection_count: 0, review_due_at: cmd.lte(new Date()) },
    pageSize: 1, orderBy: 'review_due_at', order: 'asc'
  }).then(function (result) {
    if (!result.success) return result;
    return { success: true, data: result.data.list.length ? decorateEvent(result.data.list[0]) : null, error: null };
  });
}

function getPendingReflectionQueue(offset) {
  var where = { execution_status: 'executed', reflection_count: 0, review_due_at: db.getCommand().lte(new Date()) };
  return Promise.all([
    tradeEventsRepo.getList({ where: where, pageSize: 20, offset: offset || 0, orderBy: 'review_due_at', order: 'asc' }),
    tradeEventsRepo.count({ where: where })
  ]).then(function (results) {
    if (!results[0].success) return results[0];
    if (!results[1].success) return results[1];
    var items = results[0].data.list.map(decorateEvent);
    return { success: true, data: { items: items, current: items[0] || null, count: results[1].data, offset: offset || 0 } };
  });
}

function getPendingIntentQueue() {
  var where = { execution_status: 'pending' };
  return Promise.all([
    tradeEventsRepo.getList({ where: where, pageSize: 20, order: 'asc' }),
    tradeEventsRepo.count({ where: where })
  ]).then(function (results) {
    if (!results[0].success) return results[0];
    if (!results[1].success) return results[1];
    var items = results[0].data.list.map(decorateEvent);
    return {
      success: true,
      data: { items: items, current: items.length ? items[0] : null, count: results[1].data },
      error: null
    };
  });
}

function getTodoOverview() {
  var confirmWhere = { execution_status: 'pending' };
  var reviewWhere = { execution_status: 'executed', reflection_count: 0 };
  return Promise.all([
    tradeEventsRepo.getList({ where: confirmWhere, pageSize: 20, order: 'asc' }),
    tradeEventsRepo.getList({ where: reviewWhere, pageSize: 20, order: 'asc' }),
    tradeEventsRepo.count({ where: confirmWhere }),
    tradeEventsRepo.count({ where: reviewWhere })
  ]).then(function (results) {
    for (var i = 0; i < results.length; i++) {
      if (!results[i].success) return results[i];
    }
    var confirmCount = results[2].data;
    var reviewCount = results[3].data;
    return {
      success: true,
      data: {
        confirmItems: results[0].data.list.map(decorateEvent),
        reviewItems: results[1].data.list.map(decorateEvent),
        counts: { all: confirmCount + reviewCount, confirm: confirmCount, review: reviewCount }
      },
      error: null
    };
  });
}

function getWeeklyReview() {
  return cloudApi.call('getWeeklyReview');
}

function getPeriodReview(periodType) {
  return cloudApi.call('getPeriodReview', { period_type: periodType === 'month' ? 'month' : 'week' });
}

function getPeriodDetail(periodType, periodId, metric, reasonKey) {
  return cloudApi.call('getPeriodDetail', {
    period_type: periodType === 'month' ? 'month' : 'week',
    period_id: periodId,
    metric: metric,
    reason_key: reasonKey || ''
  }).then(function (res) {
    if (!res.success) return res;
    var items = (res.data.items || []).map(function (item) {
      return Object.assign({}, item, {
        created_label: dateUtil.formatDateTime(item.executed_at)
      });
    });
    return { success: true, data: Object.assign({}, res.data, { items: items }), error: null };
  });
}

function saveWeeklyFocus(key) {
  var label = FOCUS_LABELS[key];
  if (!label) return Promise.resolve({ success: false, data: null, error: 'VALIDATION_ERROR' });
  return cloudApi.call('saveWeeklyFocus', { key: key });
}

function deleteTradeEvent(id) {
  return cloudApi.call('deleteTradeEvent', { id: id });
}

module.exports = {
  createTradeEvent: createTradeEvent,
  markExecution: markExecution,
  updatePlanStatus: updatePlanStatus,
  addReflection: addReflection,
  getReflectionsForTrade: getReflectionsForTrade,
  getRecentEvents: getRecentEvents,
  getEventPage: getEventPage,
  getEvent: getEvent,
  getPendingReflection: getPendingReflection,
  getPendingReflectionQueue: getPendingReflectionQueue,
  getPendingIntentQueue: getPendingIntentQueue,
  getTodoOverview: getTodoOverview,
  getWeeklyReview: getWeeklyReview,
  getPeriodReview: getPeriodReview,
  getPeriodDetail: getPeriodDetail,
  saveWeeklyFocus: saveWeeklyFocus,
  deleteTradeEvent: deleteTradeEvent,
  labels: {
    actions: ACTION_LABELS,
    plans: PLAN_LABELS,
    feelings: FEELING_LABELS,
    focuses: FOCUS_LABELS,
    reasons: REASON_LABELS
  }
};
