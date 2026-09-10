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
  var where = Object.assign({ _openid: openid, is_deleted: false }, opts.where || {});
  if (opts.cursor && opts.cursor.createdAt && !where.created_at) {
    where.created_at = db.getCommand().lt(new Date(opts.cursor.createdAt));
  }
  var query = db.getCollection(collectionName)
    .where(where)
    .orderBy(opts.orderBy || 'created_at', opts.order || 'desc')
    .limit(opts.pageSize || constants.PAGE_SIZE);
  // offset 仅为旧调用保留；新页面统一使用 created_at 游标。
  if (!opts.cursor && typeof opts.offset === 'number' && opts.offset > 0) query = query.skip(opts.offset);
  if (opts.fields) query = query.field(opts.fields);
  return query.get().then(function (res) {
    var list = res.data || [];
    var last = list.length ? list[list.length - 1] : null;
    return wrapSuccess({
      list: list,
      hasMore: list.length >= (opts.pageSize || constants.PAGE_SIZE),
      nextCursor: last && last.created_at ? { createdAt: new Date(last.created_at).toISOString(), id: last._id } : null
    });
  }).catch(wrapError);
}

function count(collectionName, options) {
  var openid = ensureLogin();
  if (!openid) return Promise.resolve(wrapError('AUTH_ERROR'));
  var opts = options || {};
  var where = Object.assign({ _openid: openid, is_deleted: false }, opts.where || {});
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
