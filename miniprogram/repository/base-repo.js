var db = require('../utils/db');
var permission = require('../utils/permission');
var constants = require('../config/constants');

function wrapSuccess(data) {
  return { success: true, data: data, error: null };
}

function wrapError(error) {
  var message = (error && error.errMsg) || (typeof error === 'string' ? error : '未知错误');
  return { success: false, data: null, error: message };
}

function ensureLogin() {
  var result = permission.checkLogin();
  return result.success ? result.data : '';
}

function getById(collectionName, id) {
  var openid = ensureLogin();
  if (!openid) return Promise.resolve(wrapError('AUTH_ERROR'));
  return db.getCollection(collectionName).doc(id).get().then(function (res) {
    if (!res.data || res.data._openid !== openid) return wrapError('AUTH_ERROR');
    return wrapSuccess(res.data);
  }).catch(wrapError);
}

function getList(collectionName, options) {
  var openid = ensureLogin();
  if (!openid) return Promise.resolve(wrapError('AUTH_ERROR'));
  var opts = options || {};
  var where = Object.assign({ _openid: openid, is_deleted: false }, opts.where || {}, { _openid: openid });
  var orderField = opts.orderBy || 'created_at';
  var order = opts.order === 'asc' ? 'asc' : 'desc';
  if (opts.cursor) {
    var cursor = opts.cursor;
    var value = cursor.value || cursor.createdAt;
    if (!cursor.id || !value || (cursor.orderBy && cursor.orderBy !== orderField) || (cursor.order && cursor.order !== order)) return Promise.resolve(wrapError('INVALID_CURSOR'));
    if (orderField !== '_id') value = new Date(value);
    if (orderField !== '_id' && !isFinite(value.getTime())) return Promise.resolve(wrapError('INVALID_CURSOR'));
    var cmd = db.getCommand();
    var compare = order === 'asc' ? 'gt' : 'lt';
    var earlier = {}, tied = {};
    earlier[orderField] = cmd[compare](value);
    tied[orderField] = value;
    tied._id = cmd[compare](cursor.id);
    where = cmd.and([where, orderField === '_id' ? { _id: cmd[compare](cursor.id) } : cmd.or([earlier, tied])]);
  }
  var query = db.getCollection(collectionName)
    .where(where)
    .orderBy(orderField, order)
    .limit(opts.pageSize || constants.PAGE_SIZE);
  if (orderField !== '_id') query = query.orderBy('_id', order);
  // offset 仅为旧待办调用保留；翻页以排序字段和 ID 共同定位。
  if (!opts.cursor && typeof opts.offset === 'number' && opts.offset > 0) query = query.skip(opts.offset);
  if (opts.fields) query = query.field(opts.fields);
  return query.get().then(function (res) {
    var list = res.data || [];
    var last = list.length ? list[list.length - 1] : null;
    return wrapSuccess({
      list: list,
      hasMore: list.length >= (opts.pageSize || constants.PAGE_SIZE),
      nextCursor: last && last[orderField] ? {
        createdAt: last.created_at ? new Date(last.created_at).toISOString() : null,
        value: orderField === '_id' ? last._id : new Date(last[orderField]).toISOString(),
        orderBy: orderField, order: order, id: last._id
      } : null
    });
  }).catch(wrapError);
}

function count(collectionName, options) {
  var openid = ensureLogin();
  if (!openid) return Promise.resolve(wrapError('AUTH_ERROR'));
  var opts = options || {};
  var where = Object.assign({ _openid: openid, is_deleted: false }, opts.where || {}, { _openid: openid });
  return db.getCollection(collectionName).where(where).count().then(function (res) {
    return wrapSuccess(Number(res.total || 0));
  }).catch(wrapError);
}

module.exports = {
  getById: getById,
  getList: getList,
  count: count,
  wrapSuccess: wrapSuccess,
  wrapError: wrapError
};
