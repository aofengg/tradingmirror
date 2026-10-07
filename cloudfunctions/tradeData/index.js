const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const assetTracking = require('./asset-tracking');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const command = db.command;
const SERVER_DATE = () => db.serverDate();
const SCHEMA_VERSION = 2;
const OPTION_SET_VERSION = 1;
const COLLECTIONS = {
  EVENTS: 'trade_events',
  REFLECTIONS: 'reflection_snapshots',
  RULES: 'personal_rules',
  FOCUSES: 'weekly_focus',
  METRICS: 'period_metrics',
  CONFIG: 'user_config'
};

const ACTIONS = { buy: '买入', add: '加仓', reduce: '减仓', exit: '清仓' };
const PLANS = { planned: '按原计划', impulsive: '临时决定', uncertain: '不确定' };
const FEELINGS = { satisfied: '满意', acceptable: '可以接受', regret: '懊悔' };
const FOCUSES = {
  panic_sell: '恐慌卖出',
  chase_high: '冲动追高',
  frequent_adjustment: '频繁调仓',
  follow_plan: '临时改变计划'
};
const ONBOARDING_STEPS = ['welcome', 'record_context', 'record_complete', 'reflection_context', 'trend_generated'];

function ok(data) {
  return { success: true, data: data, error: null };
}

function fail(error, meta) {
  const detail = meta || {};
  return {
    success: false,
    data: null,
    error: error || 'UNKNOWN_ERROR',
    error_code: error || 'UNKNOWN_ERROR',
    error_detail: String(detail.error_detail || '').slice(0, 300),
    platform_error_code: String(detail.platform_error_code || '').slice(0, 80),
    trace_id: String(detail.trace_id || '').slice(0, 32)
  };
}

function tracedError(code, cause) {
  const error = new Error(code);
  error.code = code;
  error.detail = String(cause && (cause.errMsg || cause.message) || '').slice(0, 300);
  error.platformErrorCode = String(cause && (cause.errCode || cause.code) || '').slice(0, 80);
  return error;
}

function classifyError(error) {
  const knownCodes = ['DATABASE_READ_FAILED', 'DATABASE_WRITE_FAILED'];
  const code = error && error.code;
  const message = String(error && (error.detail || error.errMsg || error.message) || '').slice(0, 300);
  if (knownCodes.indexOf(code) !== -1) {
    return {
      error_code: code,
      error_detail: message,
      platform_error_code: error.platformErrorCode || ''
    };
  }
  if (/timeout|time.limit|FUNCTIONS_TIME_LIMIT_EXCEEDED/i.test(message)) {
    return {
      error_code: 'FUNCTION_TIMEOUT',
      error_detail: message,
      platform_error_code: String(error && (error.errCode || error.code) || '').slice(0, 80)
    };
  }
  return {
    error_code: 'CLOUD_INTERNAL_ERROR',
    error_detail: message,
    platform_error_code: String(error && (error.errCode || error.code) || '').slice(0, 80)
  };
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
}

function string(value, max) {
  return String(value || '').trim().slice(0, max || 100);
}

function withoutId(data) {
  const copy = Object.assign({}, data);
  delete copy._id;
  return copy;
}

function normalizeSymbol(value) {
  return string(value, 20).toUpperCase();
}

function inferMarket(symbol) {
  if (/\.(HK)$/.test(symbol) || /^\d{5}$/.test(symbol)) return 'HK';
  if (/\.(SS|SH|SZ)$/.test(symbol) || /^\d{6}$/.test(symbol)) return 'CN';
  if (/\.(L|PA|DE|TO)$/.test(symbol)) return 'OTHER';
  return 'US';
}

function eventId(openid, requestId) {
  return 'event_' + hash(openid + ':' + requestId);
}

function reflectionId(openid, requestId) {
  return 'reflection_' + hash(openid + ':' + requestId);
}

function configId(openid) {
  return 'config_' + hash(openid);
}

function focusId(openid, weekId) {
  return 'focus_' + hash(openid + ':' + weekId);
}

function metricId(openid, periodType, periodId) {
  return 'metric_' + hash(openid + ':' + periodType + ':' + periodId);
}

function defaultConfig(openid) {
  return {
    _id: configId(openid),
    _openid: openid,
    schema_version: SCHEMA_VERSION,
    data_schema_version: SCHEMA_VERSION,
    recent_symbols: ['NVDA', 'AAPL', 'TSLA'],
    recent_assets: [
      { symbol: 'NVDA', market: 'US', asset_type: 'stock' },
      { symbol: 'AAPL', market: 'US', asset_type: 'stock' },
      { symbol: 'TSLA', market: 'US', asset_type: 'stock' }
    ],
    current_focus: '',
    onboarding_completed: false,
    onboarding_steps: {},
    settings: { review_reminder: true },
    created_at: SERVER_DATE(),
    updated_at: SERVER_DATE(),
    is_deleted: false,
    deleted_at: null,
    ext: {}
  };
}

async function findConfig(openid) {
  const result = await db.collection(COLLECTIONS.CONFIG)
    .where({ _openid: openid, is_deleted: false })
    .limit(1)
    .get();
  return result.data && result.data[0] ? result.data[0] : null;
}

async function ensureUserConfig(openid) {
  let config = await findConfig(openid);
  if (config) return config;
  const data = defaultConfig(openid);
  try {
    await db.collection(COLLECTIONS.CONFIG).doc(data._id).set({ data: withoutId(data) });
  } catch (error) {
    config = await findConfig(openid);
    if (config) return config;
    throw error;
  }
  return Object.assign({}, data, { created_at: new Date(), updated_at: new Date() });
}

async function createTradeEvent(openid, payload) {
  const requestId = string(payload.client_request_id, 80);
  const symbol = normalizeSymbol(payload.symbol);
  const action = string(payload.action, 20);
  const reasonKey = string(payload.reason_key, 50);
  if (!requestId || !symbol || !ACTIONS[action] || !reasonKey) return fail('VALIDATION_ERROR');

  const id = eventId(openid, requestId);
  const existing = await db.collection(COLLECTIONS.EVENTS)
    .where({ _id: id, _openid: openid })
    .limit(1)
    .get();
  if (existing.data && existing.data[0]) return ok(existing.data[0]);

  const stage = payload.stage === 'before' ? 'before' : 'after';
  const executed = stage === 'after';
  const now = new Date();
  const occurredAt = payload.occurred_at ? new Date(payload.occurred_at) : now;
  const market = string(payload.market, 12) || inferMarket(symbol);
  const data = {
    _id: id,
    _openid: openid,
    schema_version: SCHEMA_VERSION,
    client_request_id: requestId,
    symbol: symbol,
    market: market,
    asset_type: string(payload.asset_type, 20) || 'stock',
    asset_name_snapshot: string(payload.asset_name_snapshot, 80),
    action: action,
    action_label: string(payload.action_label, 30) || ACTIONS[action],
    reason_key: reasonKey,
    reason_label: string(payload.reason_label, 80),
    plan_status: PLANS[payload.plan_status] ? payload.plan_status : 'uncertain',
    stage: stage,
    execution_status: executed ? 'executed' : 'pending',
    occurred_at: occurredAt,
    executed_at: executed ? occurredAt : null,
    recorded_at: SERVER_DATE(),
    review_due_at: executed ? new Date(now.getTime() + 18 * 60 * 60 * 1000) : null,
    timezone: string(payload.timezone, 50) || 'Asia/Shanghai',
    option_set_version: Number(payload.option_set_version) || OPTION_SET_VERSION,
    rule_refs: Array.isArray(payload.rule_refs) ? payload.rule_refs.slice(0, 20) : [],
    optional_note: string(payload.optional_note, 500),
    attachments: [],
    reflection_count: 0,
    reflection_request_ids: [],
    latest_feeling: '',
    latest_feeling_label: '',
    latest_reflection_at: null,
    created_at: SERVER_DATE(),
    updated_at: SERVER_DATE(),
    is_deleted: false,
    deleted_at: null,
    ext: payload.ext && typeof payload.ext === 'object' ? payload.ext : {}
  };
  try {
    await db.collection(COLLECTIONS.EVENTS).doc(id).set({ data: withoutId(data) });
  } catch (error) {
    const retry = await db.collection(COLLECTIONS.EVENTS).doc(id).get();
    if (retry.data && retry.data._openid === openid) return ok(retry.data);
    throw error;
  }
  return ok(Object.assign({}, data, { recorded_at: now, created_at: now, updated_at: now }));
}

async function markExecution(openid, payload) {
  const id = string(payload.id, 80);
  const status = payload.status;
  if (!id || (status !== 'pending' && status !== 'executed' && status !== 'cancelled')) return fail('VALIDATION_ERROR');
  const event = await db.collection(COLLECTIONS.EVENTS).doc(id).get();
  if (!event.data || event.data._openid !== openid || event.data.is_deleted) return fail('NOT_FOUND');

  const currentStatus = event.data.execution_status || 'pending';
  if (currentStatus === status) return ok({ updated: 0 });

  // A mistaken execution confirmation can return to pending before reflections exist.
  // Normalize it to a "before" record so the event remains semantically consistent.
  if (status === 'pending') {
    if (Number(event.data.reflection_count || 0) > 0) return fail('REFLECTIONS_EXIST');
    await db.collection(COLLECTIONS.EVENTS).doc(id).update({ data: {
      stage: 'before',
      execution_status: 'pending',
      occurred_at: event.data.recorded_at || event.data.created_at,
      executed_at: null,
      review_due_at: null,
      updated_at: SERVER_DATE()
    } });
    return ok({ updated: 1 });
  }

  if (currentStatus !== 'pending') return fail('INVALID_TRANSITION');
  const update = { execution_status: status, updated_at: SERVER_DATE() };
  if (status === 'executed') {
    const now = new Date();
    update.occurred_at = now;
    update.executed_at = now;
    update.review_due_at = new Date(now.getTime() + 18 * 60 * 60 * 1000);
  } else {
    update.executed_at = null;
    update.review_due_at = null;
  }
  await db.collection(COLLECTIONS.EVENTS).doc(id).update({ data: update });
  return ok({ updated: 1 });
}

async function updatePlanStatus(openid, payload) {
  const id = string(payload.id, 80);
  const status = string(payload.status, 20);
  if (!id || !PLANS[status]) return fail('VALIDATION_ERROR');
  const result = await db.collection(COLLECTIONS.EVENTS)
    .where({ _id: id, _openid: openid, is_deleted: false })
    .update({ data: { plan_status: status, updated_at: SERVER_DATE() } });
  return result.stats.updated ? ok({ updated: result.stats.updated }) : fail('NOT_FOUND');
}

function horizonFor(event, reviewedAt) {
  const base = event.executed_at || event.occurred_at || event.created_at;
  const age = base ? Math.max(0, (reviewedAt.getTime() - new Date(base).getTime()) / 3600000) : 0;
  if (age <= 6) return { key: 'immediate', hours: Math.round(age * 10) / 10 };
  if (age <= 48) return { key: 'next_day', hours: Math.round(age * 10) / 10 };
  if (age <= 240) return { key: 'one_week', hours: Math.round(age * 10) / 10 };
  return { key: 'later', hours: Math.round(age * 10) / 10 };
}

async function addReflection(openid, payload) {
  const requestId = string(payload.client_request_id, 80);
  const tradeEventId = string(payload.trade_event_id, 80);
  const feeling = string(payload.feeling, 20);
  if (!requestId || !tradeEventId || !FEELINGS[feeling]) return fail('VALIDATION_ERROR');
  const id = reflectionId(openid, requestId);
  const now = new Date();

  const result = await db.runTransaction(async transaction => {
    const eventResult = await transaction.collection(COLLECTIONS.EVENTS).doc(tradeEventId).get();
    const event = eventResult.data;
    if (!event || event._openid !== openid || event.is_deleted) throw new Error('NOT_FOUND');
    const handledRequests = event.reflection_request_ids || [];
    if (handledRequests.indexOf(requestId) !== -1) {
      const existing = await transaction.collection(COLLECTIONS.REFLECTIONS).doc(id).get();
      if (!existing.data || existing.data._openid !== openid) throw new Error('INCONSISTENT_IDEMPOTENCY_STATE');
      return { duplicate: true, snapshot: existing.data };
    }
    const horizon = horizonFor(event, now);
    const sequenceNo = Number(event.reflection_count || 0) + 1;
    const snapshot = {
      _id: id,
      _openid: openid,
      schema_version: SCHEMA_VERSION,
      client_request_id: requestId,
      trade_event_id: tradeEventId,
      horizon_key: string(payload.horizon_key, 20) || horizon.key,
      sequence_no: sequenceNo,
      feeling: feeling,
      feeling_label: string(payload.feeling_label, 30) || FEELINGS[feeling],
      regret_reason: feeling === 'regret' ? string(payload.regret_reason, 50) : '',
      regret_reason_label: feeling === 'regret' ? string(payload.regret_reason_label, 80) : '',
      optional_note: '',
      attachments: [],
      reviewed_at: SERVER_DATE(),
      event_age_hours: horizon.hours,
      created_at: SERVER_DATE(),
      updated_at: SERVER_DATE(),
      is_deleted: false,
      deleted_at: null,
      ext: {}
    };
    await transaction.collection(COLLECTIONS.REFLECTIONS).doc(id).set({ data: withoutId(snapshot) });
    await transaction.collection(COLLECTIONS.EVENTS).doc(tradeEventId).update({
      data: withoutId({
        reflection_count: sequenceNo,
        reflection_request_ids: handledRequests.concat([requestId]).slice(-200),
        latest_feeling: feeling,
        latest_feeling_label: snapshot.feeling_label,
        latest_reflection_at: SERVER_DATE(),
        updated_at: SERVER_DATE()
      })
    });
    return { duplicate: false, snapshot: snapshot };
  });
  const snapshot = Object.assign({}, result.snapshot, { reviewed_at: now, created_at: now, updated_at: now });
  return ok({ snapshot: snapshot, duplicate: result.duplicate });
}

async function addRecentSymbol(openid, payload) {
  const symbol = normalizeSymbol(payload.symbol);
  if (!symbol) return fail('VALIDATION_ERROR');
  const config = await ensureUserConfig(openid);
  const symbols = (config.recent_symbols || []).filter(item => item !== symbol);
  symbols.unshift(symbol);
  const assets = (config.recent_assets || []).filter(item => item && item.symbol !== symbol);
  assets.unshift({
    symbol: symbol,
    market: string(payload.market, 12) || inferMarket(symbol),
    asset_type: string(payload.asset_type, 20) || 'stock'
  });
  await db.collection(COLLECTIONS.CONFIG).doc(config._id).update({
    data: {
      recent_symbols: symbols.slice(0, 8),
      recent_assets: assets.slice(0, 8),
      schema_version: SCHEMA_VERSION,
      updated_at: SERVER_DATE()
    }
  });
  return ok({ recent_symbols: symbols.slice(0, 8), recent_assets: assets.slice(0, 8) });
}

async function updateOnboardingStep(openid, payload) {
  const step = string(payload.step, 40);
  if (ONBOARDING_STEPS.indexOf(step) === -1) return fail('VALIDATION_ERROR');
  const config = await ensureUserConfig(openid);
  const steps = Object.assign({}, config.onboarding_steps || {});
  steps[step] = true;
  const completed = Boolean(config.onboarding_completed || step === 'reflection_context');
  await db.collection(COLLECTIONS.CONFIG).doc(config._id).update({ data: {
    onboarding_steps: steps,
    onboarding_completed: completed,
    updated_at: SERVER_DATE()
  } });
  return ok({ step: step, onboarding_steps: steps, onboarding_completed: completed });
}

function startOfShanghaiWeek(now) {
  const shifted = new Date(now.getTime() + 8 * 3600000);
  const day = shifted.getUTCDay() || 7;
  shifted.setUTCDate(shifted.getUTCDate() - day + 1);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 8 * 3600000);
}

function dateId(date) {
  const shifted = new Date(date.getTime() + 8 * 3600000);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return shifted.getUTCFullYear() + '-' + month + '-' + day;
}

async function saveWeeklyFocus(openid, payload) {
  const key = string(payload.key, 40);
  if (!FOCUSES[key]) return fail('VALIDATION_ERROR');
  const start = startOfShanghaiWeek(new Date());
  const weekId = dateId(start);
  const config = await ensureUserConfig(openid);
  const focus = { key: key, label: FOCUSES[key], updated_at: new Date() };
  await db.runTransaction(async transaction => {
    await transaction.collection(COLLECTIONS.FOCUSES).doc(focusId(openid, weekId)).set({
      data: withoutId({
        _id: focusId(openid, weekId),
        _openid: openid,
        schema_version: SCHEMA_VERSION,
        week_id: weekId,
        behavior_key: key,
        behavior_label: FOCUSES[key],
        created_at: SERVER_DATE(),
        updated_at: SERVER_DATE(),
        is_deleted: false,
        deleted_at: null,
        ext: {}
      })
    });
    await transaction.collection(COLLECTIONS.CONFIG).doc(config._id).update({
      data: { current_focus: command.set(focus), updated_at: SERVER_DATE() }
    });
  });
  return ok(focus);
}

async function deleteTradeEvent(openid, payload) {
  const id = string(payload.id, 80);
  if (!id) return fail('VALIDATION_ERROR');
  const event = await db.collection(COLLECTIONS.EVENTS).doc(id).get();
  if (!event.data || event.data._openid !== openid) return fail('NOT_FOUND');
  const reflections = await queryAll(COLLECTIONS.REFLECTIONS, { _openid: openid, trade_event_id: id }, 'created_at');
  const files = (event.data.attachments || []).concat.apply([], reflections.map(item => item.attachments || []))
    .map(item => item && item.file_id).filter(Boolean);
  // Remove child snapshots first so a failed partial attempt can be retried while
  // the parent event still exists. The final parent removal makes the deletion
  // visible to clients only after its dependent documents are gone.
  await Promise.all(reflections.map(reflection =>
    db.collection(COLLECTIONS.REFLECTIONS).doc(reflection._id).remove()
  ));
  await db.collection(COLLECTIONS.EVENTS).doc(id).remove();
  let cleanupWarning = false;
  if (files.length) {
    try { await cloud.deleteFile({ fileList: files }); } catch (error) { cleanupWarning = true; }
  }
  return ok({
    deleted: 1,
    deletedReflections: reflections.length,
    deletedFiles: files.length,
    cleanupWarning: cleanupWarning
  });
}

function validAttachmentDate(value, fallback) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  const safeFallback = fallback instanceof Date ? fallback : new Date(fallback);
  return Number.isNaN(safeFallback.getTime()) ? new Date() : safeFallback;
}

function sanitizeAttachments(items, existingItems) {
  if (!Array.isArray(items)) return [];
  const existingById = (existingItems || []).reduce((result, item) => {
    if (item && item.file_id) result[item.file_id] = item;
    return result;
  }, {});
  return items.slice(0, 3).map(item => ({
    file_id: string(item && item.file_id, 500),
    cloud_path: string(item && item.cloud_path, 300),
    size_bytes: Math.max(0, Math.min(Number(item && item.size_bytes) || 0, 5 * 1024 * 1024)),
    media_type: 'image',
    uploaded_at: validAttachmentDate(
      item && item.uploaded_at,
      existingById[item && item.file_id] && existingById[item.file_id].uploaded_at
    )
  })).filter(item => item.file_id.indexOf('cloud://') === 0);
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function updateSupplement(collection, id, data) {
  try {
    return await db.collection(collection).doc(id).update({ data: data });
  } catch (firstError) {
    // The document database can occasionally reject an otherwise valid write.
    // Retry once with fresh server-date commands before surfacing the failure.
    await wait(180);
    try {
      return await db.collection(collection).doc(id).update({ data: Object.assign({}, data, {
        supplement_updated_at: SERVER_DATE(),
        updated_at: SERVER_DATE()
      }) });
    } catch (secondError) {
      secondError.firstAttempt = String(firstError && (firstError.errMsg || firstError.message) || '').slice(0, 200);
      throw secondError;
    }
  }
}

async function saveSupplement(openid, payload) {
  const type = payload.entity_type;
  const id = string(payload.entity_id, 80);
  const collection = type === 'trade_event' ? COLLECTIONS.EVENTS : (type === 'reflection' ? COLLECTIONS.REFLECTIONS : '');
  if (!collection || !id) return fail('VALIDATION_ERROR');
  let result;
  try {
    result = await db.collection(collection).doc(id).get();
  } catch (error) {
    throw tracedError('DATABASE_READ_FAILED', error);
  }
  const document = result.data;
  if (!document || document._openid !== openid || document.is_deleted) return fail('NOT_FOUND');
  const attachments = sanitizeAttachments(payload.attachments, document.attachments);
  const note = string(payload.optional_note, 300);
  const nextIds = attachments.map(item => item.file_id);
  const removed = (document.attachments || []).map(item => item && item.file_id)
    .filter(fileId => fileId && nextIds.indexOf(fileId) === -1);
  try {
    await updateSupplement(collection, id, {
      optional_note: note,
      attachments: attachments,
      supplement_updated_at: SERVER_DATE(),
      updated_at: SERVER_DATE()
    });
  } catch (error) {
    throw tracedError('DATABASE_WRITE_FAILED', error);
  }
  let cleanupWarning = false;
  if (removed.length) {
    try { await cloud.deleteFile({ fileList: removed }); } catch (error) { cleanupWarning = true; }
  }
  return ok({
    entity_type: type,
    entity_id: id,
    optional_note: note,
    attachments: attachments,
    cleanupWarning: cleanupWarning
  });
}

async function savePersonalRule(openid, payload) {
  const key = string(payload.key, 60);
  const label = string(payload.label, 80);
  if (!key || !label) return fail('VALIDATION_ERROR');
  const id = 'rule_' + hash(openid + ':' + key);
  const found = await db.collection(COLLECTIONS.RULES).where({ _id: id, _openid: openid }).limit(1).get();
  const previous = found.data && found.data[0] ? found.data[0] : null;
  const version = previous ? Number(previous.version || 1) + 1 : 1;
  const data = {
    _openid: openid,
    schema_version: SCHEMA_VERSION,
    rule_key: key,
    label: label,
    description: string(payload.description, 300),
    active: payload.active !== false,
    version: version,
    previous_version: previous ? Number(previous.version || 1) : null,
    created_at: previous ? previous.created_at : SERVER_DATE(),
    updated_at: SERVER_DATE(),
    is_deleted: false,
    deleted_at: null,
    ext: payload.ext && typeof payload.ext === 'object' ? payload.ext : {}
  };
  await db.collection(COLLECTIONS.RULES).doc(id).set({ data: data });
  return ok(Object.assign({ _id: id }, data, { updated_at: new Date() }));
}

function countBy(items, field) {
  return items.reduce((result, item) => {
    const key = item[field];
    if (key) result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
}

function topKey(counts) {
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';
}

async function queryAll(collection, where, orderField) {
  const pageSize = 100;
  let offset = 0;
  let all = [];
  while (true) {
    const page = await db.collection(collection).where(where)
      .orderBy(orderField || 'created_at', 'asc')
      .skip(offset)
      .limit(pageSize)
      .get();
    all = all.concat(page.data || []);
    if (!page.data || page.data.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

function startOfShanghaiMonth(now) {
  const shifted = new Date(now.getTime() + 8 * 3600000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - 8 * 3600000);
}

function addDays(date, count) {
  return new Date(date.getTime() + count * 24 * 3600000);
}

function addShanghaiMonths(date, count) {
  const shifted = new Date(date.getTime() + 8 * 3600000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + count, 1) - 8 * 3600000);
}

function shortDate(date) {
  const shifted = new Date(date.getTime() + 8 * 3600000);
  return (shifted.getUTCMonth() + 1) + '/' + shifted.getUTCDate();
}

function monthLabel(date) {
  const shifted = new Date(date.getTime() + 8 * 3600000);
  return (shifted.getUTCMonth() + 1) + '月';
}

function periodDefinition(periodType, now) {
  const type = periodType === 'month' ? 'month' : 'week';
  const currentStart = type === 'month' ? startOfShanghaiMonth(now) : startOfShanghaiWeek(now);
  const count = type === 'month' ? 6 : 8;
  const periods = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const start = type === 'month' ? addShanghaiMonths(currentStart, -i) : addDays(currentStart, -7 * i);
    const end = type === 'month' ? addShanghaiMonths(start, 1) : addDays(start, 7);
    const shifted = new Date(start.getTime() + 8 * 3600000);
    periods.push({
      start: start,
      end: end,
      id: type === 'month' ? dateId(start).slice(0, 7) : dateId(start),
      label: type === 'month' ? monthLabel(start) : shortDate(start),
      fullLabel: type === 'month'
        ? shifted.getUTCFullYear() + '年' + (shifted.getUTCMonth() + 1) + '月'
        : shortDate(start) + '—' + shortDate(addDays(end, -1))
    });
  }
  return { type: type, periods: periods, current: periods[periods.length - 1] };
}

function inPeriod(value, period) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return time >= period.start.getTime() && time < period.end.getTime();
}

function buildPeriodSummary(events, reflections, periodType) {
  const eventIds = events.reduce((result, item) => { result[item._id] = true; return result; }, {});
  const latest = {};
  const histories = {};
  reflections.forEach(item => {
    if (!eventIds[item.trade_event_id]) return;
    latest[item.trade_event_id] = item;
    histories[item.trade_event_id] = histories[item.trade_event_id] || {};
    histories[item.trade_event_id][item.feeling] = true;
  });
  const planned = events.filter(item => item.plan_status === 'planned');
  const impulsive = events.filter(item => item.plan_status === 'impulsive');
  const uncertain = events.filter(item => item.plan_status === 'uncertain');
  const reasonCounts = countBy(events, 'reason_key');
  const reasonLabels = events.reduce((result, item) => {
    if (item.reason_key && item.reason_label) result[item.reason_key] = item.reason_label;
    return result;
  }, {});
  const reasonDistribution = Object.keys(reasonCounts)
    .sort((a, b) => reasonCounts[b] - reasonCounts[a])
    .slice(0, 3)
    .map(key => ({
      key: key,
      label: reasonLabels[key] || key,
      count: reasonCounts[key],
      percentage: events.length ? Math.round(reasonCounts[key] / events.length * 100) : 0
    }));
  const latestList = Object.keys(latest).map(key => latest[key]);
  const regrets = latestList.filter(item => item.feeling === 'regret');
  const topReason = topKey(countBy(impulsive, 'reason_key'));
  const topRegret = topKey(countBy(regrets, 'regret_reason'));
  const focuses = [];
  if (topReason === 'fear_giveback' || topReason === 'cannot_stand_volatility') focuses.push('panic_sell');
  if (topReason === 'fear_missing' || topRegret === 'chased_high') focuses.push('chase_high');
  if (topReason === 'switch_symbol') focuses.push('frequent_adjustment');
  if (topRegret === 'broke_plan') focuses.push('follow_plan');
  ['panic_sell', 'chase_high', 'frequent_adjustment'].forEach(key => {
    if (focuses.indexOf(key) === -1) focuses.push(key);
  });
  const periodName = periodType === 'month' ? '本月' : '本周';
  return {
    eventCount: events.length,
    plannedCount: planned.length,
    impulsiveCount: impulsive.length,
    uncertainCount: uncertain.length,
    regretCount: regrets.length,
    reviewedCount: Object.keys(latest).length,
    changedFeelingCount: Object.keys(histories).filter(key => Object.keys(histories[key]).length > 1).length,
    topReasonKey: topReason,
    topReasonLabel: topReason && impulsive.find(item => item.reason_key === topReason) ? impulsive.find(item => item.reason_key === topReason).reason_label : '',
    disciplineScore: events.length ? Math.round(planned.length / events.length * 100) : null,
    reviewRate: events.length ? Math.round(Object.keys(latest).length / events.length * 100) : 0,
    reasonDistributionReady: events.length >= 5,
    reasonDistribution: reasonDistribution,
    pattern: topReason
      ? periodName + '最常见的临时原因是「' + (impulsive.find(item => item.reason_key === topReason).reason_label || topReason) + '」。'
      : (events.length
        ? (uncertain.length
          ? periodName + '没有临时决定，但有 ' + uncertain.length + ' 次操作归类为「不确定」。'
          : periodName + '的操作都按原计划完成。')
        : ''),
    focusKeys: focuses.slice(0, 3),
    focuses: focuses.slice(0, 3).map(key => ({ key: key, label: FOCUSES[key] }))
  };
}

function trendInsight(points) {
  const active = points.filter(point => point.value !== null);
  if (active.length < 2) return '继续留下记录，满两个有操作的周期后就能看到变化。';
  const delta = active[active.length - 1].value - active[active.length - 2].value;
  if (delta >= 5) return '比上个有记录的周期提高 ' + delta + ' 个百分点。';
  if (delta <= -5) return '最近有所回落，可以看看是哪类临时决定变多了。';
  return '最近两个有记录的周期基本稳定。';
}

function buildChangeClue(periods, summaries, periodType) {
  const activeIndexes = summaries.map((summary, index) => summary.eventCount ? index : -1).filter(index => index >= 0);
  if (activeIndexes.length < 3) return { ready: false, text: '' };
  const currentIndex = activeIndexes[activeIndexes.length - 1];
  if (currentIndex !== periods.length - 1) return { ready: false, text: '' };
  const previousIndex = activeIndexes[activeIndexes.length - 2];
  const current = summaries[currentIndex];
  const previous = summaries[previousIndex];
  const delta = current.disciplineScore - previous.disciplineScore;
  const periodName = periodType === 'month' ? '上个有记录的月份' : '上个有记录的周';
  const direction = delta >= 5 ? '提高' : (delta <= -5 ? '下降' : '基本稳定');
  let text = direction === '基本稳定'
    ? '与' + periodName + '相比，按计划率基本稳定。'
    : '与' + periodName + '相比，按计划率' + direction + '了 ' + Math.abs(delta) + ' 个百分点。';

  const previousReasons = previous.reasonDistribution.reduce((result, item) => { result[item.key] = item; return result; }, {});
  const currentReasons = current.reasonDistribution.reduce((result, item) => { result[item.key] = item; return result; }, {});
  const keys = Object.keys(Object.assign({}, previousReasons, currentReasons));
  const candidates = keys.map(key => {
    const before = previousReasons[key] ? previousReasons[key].count : 0;
    const after = currentReasons[key] ? currentReasons[key].count : 0;
    return {
      key: key,
      label: (currentReasons[key] || previousReasons[key]).label,
      before: before,
      after: after,
      delta: after - before
    };
  });
  candidates.sort((a, b) => {
    if (direction === '提高') return a.delta - b.delta;
    if (direction === '下降') return b.delta - a.delta;
    return Math.abs(b.delta) - Math.abs(a.delta);
  });
  const clue = candidates[0];
  if (clue && clue.delta !== 0) {
    text += '「' + clue.label + '」由 ' + clue.before + ' 次变为 ' + clue.after + ' 次，是一个值得继续观察的线索。';
  }
  return { ready: true, text: text };
}

async function getPeriodReview(openid, payload) {
  const definition = periodDefinition(payload && payload.period_type, new Date());
  const earliest = definition.periods[0].start;
  const events = await queryAll(COLLECTIONS.EVENTS, {
    _openid: openid,
    is_deleted: false,
    execution_status: 'executed',
    executed_at: command.gte(earliest)
  }, 'executed_at');
  const reflections = await queryAll(COLLECTIONS.REFLECTIONS, {
    _openid: openid,
    is_deleted: false,
    reviewed_at: command.gte(earliest)
  }, 'reviewed_at');
  const summaries = definition.periods.map(period => {
    const periodEvents = events.filter(item => inPeriod(item.executed_at, period));
    const periodReflections = reflections.filter(item => inPeriod(item.reviewed_at || item.created_at, period));
    return buildPeriodSummary(periodEvents, periodReflections, definition.type);
  });
  const trend = definition.periods.map((period, index) => ({
    periodId: period.id,
    label: period.label,
    value: summaries[index].disciplineScore,
    eventCount: summaries[index].eventCount
  }));
  const periodSummaries = definition.periods.map((period, index) => Object.assign({
    periodId: period.id,
    periodLabel: period.fullLabel,
    shortLabel: period.label
  }, summaries[index]));
  const current = Object.assign({}, summaries[summaries.length - 1]);
  const changeClue = buildChangeClue(definition.periods, summaries, definition.type);
  const config = await ensureUserConfig(openid);
  current.periodType = definition.type;
  current.periodId = definition.current.id;
  current.periodLabel = definition.current.fullLabel;
  current.trend = trend;
  current.trendInsight = trendInsight(trend);
  current.periodSummaries = periodSummaries;
  current.changeClueReady = changeClue.ready;
  current.changeClue = changeClue.text;
  current.currentFocus = config.current_focus || '';
  current.calculatedAt = new Date();
  const id = metricId(openid, definition.type, definition.current.id);
  await db.collection(COLLECTIONS.METRICS).doc(id).set({
    data: withoutId(Object.assign({
      _id: id,
      _openid: openid,
      schema_version: SCHEMA_VERSION,
      period_type: definition.type,
      period_id: definition.current.id,
      created_at: SERVER_DATE(),
      updated_at: SERVER_DATE(),
      is_deleted: false,
      deleted_at: null,
      ext: {}
    }, current, { calculatedAt: SERVER_DATE() }))
  });
  return ok(current);
}

async function getPeriodDetail(openid, payload) {
  const definition = periodDefinition(payload && payload.period_type, new Date());
  const periodId = string(payload && payload.period_id, 20);
  const metric = string(payload && payload.metric, 30);
  const reasonKey = string(payload && payload.reason_key, 50);
  const period = definition.periods.find(item => item.id === periodId);
  const allowedMetrics = ['planned', 'impulsive', 'reviewed', 'regret', 'reason'];
  if (!period || allowedMetrics.indexOf(metric) === -1 || (metric === 'reason' && !reasonKey)) return fail('VALIDATION_ERROR');

  const eventCandidates = await queryAll(COLLECTIONS.EVENTS, {
    _openid: openid,
    is_deleted: false,
    execution_status: 'executed',
    executed_at: command.gte(period.start)
  }, 'executed_at');
  const events = eventCandidates.filter(item => inPeriod(item.executed_at, period));
  const reflectionCandidates = await queryAll(COLLECTIONS.REFLECTIONS, {
    _openid: openid,
    is_deleted: false,
    reviewed_at: command.gte(period.start)
  }, 'reviewed_at');
  const reflections = reflectionCandidates.filter(item => inPeriod(item.reviewed_at || item.created_at, period));
  const latestByEvent = {};
  reflections.forEach(item => { latestByEvent[item.trade_event_id] = item; });

  const filtered = events.filter(item => {
    if (metric === 'planned') return item.plan_status === 'planned';
    if (metric === 'impulsive') return item.plan_status === 'impulsive';
    if (metric === 'reviewed') return Boolean(latestByEvent[item._id]);
    if (metric === 'regret') return latestByEvent[item._id] && latestByEvent[item._id].feeling === 'regret';
    return item.reason_key === reasonKey;
  }).sort((a, b) => new Date(b.executed_at || b.created_at) - new Date(a.executed_at || a.created_at));

  return ok({
    periodId: period.id,
    periodLabel: period.fullLabel,
    metric: metric,
    items: filtered.map(item => {
      const reflection = latestByEvent[item._id];
      return {
        _id: item._id,
        symbol: item.symbol,
        action: item.action,
        action_label: item.action_label || ACTIONS[item.action] || item.action,
        reason_key: item.reason_key,
        reason_label: item.reason_label || item.reason_key,
        plan_status: item.plan_status,
        plan_label: PLANS[item.plan_status] || '不确定',
        latest_feeling_label: reflection ? reflection.feeling_label : '',
        executed_at: item.executed_at || item.created_at
      };
    })
  });
}

async function migrateUserData(openid) {
  const eventList = await queryAll(COLLECTIONS.EVENTS, { _openid: openid }, 'created_at');
  for (const event of eventList) {
    if (Number(event.schema_version || 1) >= SCHEMA_VERSION) continue;
    const symbol = normalizeSymbol(event.symbol);
    await db.collection(COLLECTIONS.EVENTS).doc(event._id).update({ data: {
      schema_version: SCHEMA_VERSION,
      client_request_id: event.client_request_id || 'legacy_' + event._id,
      market: event.market || inferMarket(symbol),
      asset_type: event.asset_type || 'stock',
      asset_name_snapshot: event.asset_name_snapshot || '',
      occurred_at: event.occurred_at || event.executed_at || event.created_at,
      recorded_at: event.recorded_at || event.created_at,
      timezone: event.timezone || 'Asia/Shanghai',
      option_set_version: event.option_set_version || 1,
      rule_refs: event.rule_refs || [],
      reflection_request_ids: event.reflection_request_ids || [],
      attachments: event.attachments || [],
      deleted_at: event.is_deleted ? (event.updated_at || event.created_at) : null,
      updated_at: SERVER_DATE()
    } });
  }
  const reflectionList = await queryAll(COLLECTIONS.REFLECTIONS, { _openid: openid }, 'created_at');
  const sequence = {};
  for (const reflection of reflectionList) {
    sequence[reflection.trade_event_id] = (sequence[reflection.trade_event_id] || 0) + 1;
    if (Number(reflection.schema_version || 1) >= SCHEMA_VERSION) continue;
    await db.collection(COLLECTIONS.REFLECTIONS).doc(reflection._id).update({ data: {
      schema_version: SCHEMA_VERSION,
      client_request_id: reflection.client_request_id || 'legacy_' + reflection._id,
      horizon_key: reflection.horizon_key || 'legacy',
      sequence_no: reflection.sequence_no || sequence[reflection.trade_event_id],
      reviewed_at: reflection.reviewed_at || reflection.created_at,
      event_age_hours: typeof reflection.event_age_hours === 'number' ? reflection.event_age_hours : null,
      optional_note: reflection.optional_note || '',
      attachments: reflection.attachments || [],
      deleted_at: reflection.is_deleted ? (reflection.updated_at || reflection.created_at) : null,
      updated_at: SERVER_DATE()
    } });
  }
  const config = await ensureUserConfig(openid);
  const focusList = await queryAll(COLLECTIONS.FOCUSES, { _openid: openid }, 'created_at');
  for (const focus of focusList) {
    if (Number(focus.schema_version || 1) >= SCHEMA_VERSION) continue;
    await db.collection(COLLECTIONS.FOCUSES).doc(focus._id).update({ data: {
      schema_version: SCHEMA_VERSION,
      deleted_at: focus.is_deleted ? (focus.updated_at || focus.created_at) : null,
      updated_at: SERVER_DATE()
    } });
  }
  const ruleList = await queryAll(COLLECTIONS.RULES, { _openid: openid }, 'created_at');
  for (const rule of ruleList) {
    if (Number(rule.schema_version || 1) >= SCHEMA_VERSION) continue;
    await db.collection(COLLECTIONS.RULES).doc(rule._id).update({ data: {
      schema_version: SCHEMA_VERSION,
      version: rule.version || 1,
      active: rule.active !== false,
      deleted_at: rule.is_deleted ? (rule.updated_at || rule.created_at) : null,
      updated_at: SERVER_DATE()
    } });
  }
  await db.collection(COLLECTIONS.CONFIG).doc(config._id).update({ data: {
    schema_version: SCHEMA_VERSION,
    data_schema_version: SCHEMA_VERSION,
    recent_assets: config.recent_assets || (config.recent_symbols || []).map(symbol => ({ symbol: symbol, market: inferMarket(symbol), asset_type: 'stock' })),
    deleted_at: null,
    updated_at: SERVER_DATE()
  } });
  return ok({
    migratedEvents: eventList.length,
    migratedReflections: reflectionList.length,
    migratedFocuses: focusList.length,
    migratedRules: ruleList.length,
    schemaVersion: SCHEMA_VERSION
  });
}

async function readAssetEvents(openid) {
  // Keyset scan across the user's entire history; never truncate at the first page.
  let lastId = ''; let items = [];
  while (true) {
    const where = { _openid: openid, is_deleted: false };
    if (lastId) where._id = command.gt(lastId);
    const result = await db.collection(COLLECTIONS.EVENTS).where(where).orderBy('_id', 'asc').limit(100).get();
    const batch = result.data || [];
    items = items.concat(batch);
    if (batch.length < 100) return items;
    lastId = batch[batch.length - 1]._id;
  }
}

function assetLinks(config) {
  const links = {};
  (Array.isArray(config.asset_links) ? config.asset_links : []).forEach(item => {
    if (assetTracking.parse(item.source) && assetTracking.parse(item.target)) links[item.source] = item.target;
  });
  return links;
}

async function assetRequest(openid, action, payload) {
  if (payload.key && !assetTracking.parse(payload.key)) return fail('INVALID_ASSET');
  const config = await ensureUserConfig(openid);
  const events = await readAssetEvents(openid);
  const links = assetLinks(config);
  if (action === 'mergeAsset' || action === 'undoAssetMerge') {
    return db.runTransaction(async transaction => {
      const stored = await transaction.collection(COLLECTIONS.CONFIG).doc(config._id).get();
      const current = assetLinks(stored.data);
      let next;
      if (action === 'mergeAsset') {
        const groups = assetTracking.build(events, current, Date.now());
        try { next = assetTracking.merge(current, payload.source, payload.target, groups); }
        catch (error) { return fail(error.message); }
      } else {
        if (!payload.source || current[payload.source] !== payload.target) return fail('ASSET_CHANGED');
        next = Object.assign({}, current); delete next[payload.source];
      }
      await transaction.collection(COLLECTIONS.CONFIG).doc(config._id).update({data:{asset_links:Object.keys(next).map(source => ({source:source,target:next[source]})),updated_at:SERVER_DATE()}});
      return ok({updated:1});
    });
  }
  const result = assetTracking.read(events, links, action, payload, Date.now());
  if (action === 'getAssetHistory') {
    result.merged_sources = Object.keys(links).filter(key => assetTracking.resolve(key, links) === result.key).map(key => ({key:key,target:links[key],symbol:assetTracking.parse(key).symbol}));
  }
  return ok(result);
}

exports.main = async event => {
  const context = cloud.getWXContext();
  const openid = context.OPENID;
  const traceId = crypto.randomBytes(6).toString('hex').toUpperCase();
  if (!openid) return fail('AUTH_ERROR', { trace_id: traceId });
  const action = event && event.action;
  const payload = event && event.payload ? event.payload : {};
  try {
    if (['listAssetSummaries', 'getAssetHistory', 'getAssetContext', 'mergeAsset', 'undoAssetMerge'].indexOf(action) >= 0) return await assetRequest(openid, action, payload);
    if (action === 'ensureUserConfig') return ok(await ensureUserConfig(openid));
    if (action === 'createTradeEvent') return await createTradeEvent(openid, payload);
    if (action === 'markExecution') return await markExecution(openid, payload);
    if (action === 'updatePlanStatus') return await updatePlanStatus(openid, payload);
    if (action === 'addReflection') return await addReflection(openid, payload);
    if (action === 'addRecentSymbol') return await addRecentSymbol(openid, payload);
    if (action === 'updateOnboardingStep') return await updateOnboardingStep(openid, payload);
    if (action === 'saveWeeklyFocus') return await saveWeeklyFocus(openid, payload);
    if (action === 'deleteTradeEvent') return await deleteTradeEvent(openid, payload);
    if (action === 'saveSupplement') return await saveSupplement(openid, payload);
    if (action === 'savePersonalRule') return await savePersonalRule(openid, payload);
    if (action === 'getWeeklyReview') return await getPeriodReview(openid, { period_type: 'week' });
    if (action === 'getPeriodReview') return await getPeriodReview(openid, payload);
    if (action === 'getPeriodDetail') return await getPeriodDetail(openid, payload);
    if (action === 'migrateUserData') return await migrateUserData(openid);
    return fail('UNKNOWN_ACTION', { trace_id: traceId });
  } catch (error) {
    const failure = classifyError(error);
    console.error('[tradeData][' + traceId + ']', action, failure.error_code, failure.platform_error_code, error);
    return fail(failure.error_code, {
      error_detail: failure.error_detail,
      platform_error_code: failure.platform_error_code,
      trace_id: traceId
    });
  }
};
