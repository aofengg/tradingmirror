var repo = require('../repository/trade-events-repo');
var db = require('../utils/db');
var date = require('../utils/date');
var DAY = 86400000;

function queryFor(source) {
  var anchor = new Date(source.occurred_at || source.created_at).getTime();
  if (!source._id || !source.action || !source.reason_key || !isFinite(anchor)) throw new Error('INVALID_SOURCE');
  var command = db.getCommand();
  var where = {
    action: source.action,
    reason_key: source.reason_key,
    execution_status: 'executed',
    executed_at: command.gte(new Date(anchor - 90 * DAY)).and(command.lt(new Date(anchor)))
  };
  // Pending/cancelled sources cannot match executed history. For executed
  // sources the strict time boundary normally excludes the source already.
  // Keep the explicit exclusion for incomplete or inconsistent legacy data.
  var executed = source.executed_at && new Date(source.executed_at).getTime();
  var outsideWindow = isFinite(executed) && source.executed_at &&
    (executed >= anchor || executed < anchor - 90 * DAY);
  if (source.execution_status !== 'pending' && source.execution_status !== 'cancelled' && !outsideWindow) {
    where._id = command.neq(source._id);
  }
  return where;
}
function decorate(item) {
  var executed = new Date(item.executed_at).getTime();
  var reviewed = new Date(item.latest_reflection_at).getTime();
  var hasReflection = !!item.latest_feeling_label && !!item.latest_reflection_at && isFinite(reviewed) && reviewed >= executed;
  var days = hasReflection ? Math.floor((reviewed - executed) / DAY) : 0;
  return Object.assign({}, item, {
    history_date: date.formatDateTime(item.executed_at),
    history_note: item.optional_note || '当时未留备注',
    history_feeling: hasReflection ? item.latest_feeling_label : '尚未回看',
    history_review_time: hasReflection ? (days ? days + '天后回看' : '当天回看') : ''
  });
}
function loadHistory(source, offset) {
  var where;
  try { where = queryFor(source); } catch (e) { return Promise.resolve({ success: false, error: e.message }); }
  return Promise.all([
    repo.getList({ where: where, orderBy: 'executed_at', order: 'desc', pageSize: 20, offset: offset || 0 }),
    repo.count({ where: where })
  ]).then(function (results) {
    if (!results[0].success) return results[0];
    if (!results[1].success) return results[1];
    var list = results[0].data.list.map(decorate);
    return { success: true, data: { items: list, count: results[1].data, hasMore: (offset || 0) + list.length < results[1].data } };
  });
}
// Mini program Object properties turn native Date values into {}. Resolve the
// owned source document by ID when its time cannot cross the view bridge.
function getHistory(source, offset) {
  var anchor = source && (source.occurred_at || source.created_at);
  if (source && source._id && (!anchor || !isFinite(new Date(anchor).getTime()))) {
    return repo.getById(source._id).then(function (res) {
      if (!res.success) return res;
      return loadHistory(res.data, offset);
    });
  }
  return loadHistory(source, offset);
}
module.exports = { getHistory: getHistory, queryFor: queryFor, decorate: decorate };
