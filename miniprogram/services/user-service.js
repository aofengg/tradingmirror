var constants = require('../config/constants');
var cloudApi = require('../utils/cloud-api');
var assetUtil = require('../utils/asset');

var cachedConfig = null;
var GUIDE_STEP_KEYS = ['welcome', 'record_context', 'record_complete', 'reflection_context', 'trend_generated'];

function defaultConfig() {
  return {
    recent_symbols: ['NVDA', 'AAPL', 'TSLA'],
    recent_assets: ['NVDA', 'AAPL', 'TSLA'].map(assetUtil.fromSymbol),
    current_focus: '',
    onboarding_completed: false,
    onboarding_steps: {},
    settings: { review_reminder: true }
  };
}

function localGuideSteps() {
  var value = wx.getStorageSync(constants.STORAGE_KEYS.GUIDE_STEPS);
  return value && typeof value === 'object' ? value : {};
}

function hasGuideStep(step, config) {
  var source = config || cachedConfig || {};
  return Boolean((source.onboarding_steps && source.onboarding_steps[step]) || localGuideSteps()[step]);
}

function markGuideStep(step) {
  if (GUIDE_STEP_KEYS.indexOf(step) === -1) return Promise.resolve({ success: false, data: null, error: 'VALIDATION_ERROR' });
  var local = localGuideSteps();
  local[step] = true;
  wx.setStorageSync(constants.STORAGE_KEYS.GUIDE_STEPS, local);
  if (cachedConfig) {
    cachedConfig.onboarding_steps = Object.assign({}, cachedConfig.onboarding_steps || {});
    cachedConfig.onboarding_steps[step] = true;
    if (step === 'reflection_context') cachedConfig.onboarding_completed = true;
  }
  return cloudApi.call('updateOnboardingStep', { step: step });
}

function getConfig() {
  if (cachedConfig) return Promise.resolve({ success: true, data: cachedConfig, error: null });
  return cloudApi.call('ensureUserConfig').then(function (res) {
    if (!res.success) return res;
    cachedConfig = res.data;
    return { success: true, data: cachedConfig, error: null };
  }).then(function (result) {
    if (!result.success || Number(result.data.data_schema_version || 1) >= constants.DATA_SCHEMA_VERSION) return result;
    return cloudApi.call('migrateUserData').then(function (migration) {
      if (!migration.success) return result;
      cachedConfig = null;
      return cloudApi.call('ensureUserConfig').then(function (fresh) {
        if (!fresh.success) return result;
        cachedConfig = fresh.data;
        return { success: true, data: cachedConfig, error: null };
      });
    });
  });
}

function addRecentSymbol(symbol) {
  var normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) return Promise.resolve({ success: false, data: null, error: 'VALIDATION_ERROR' });
  return getConfig().then(function (res) {
    if (!res.success) return res;
    var asset = assetUtil.fromSymbol(normalized);
    return cloudApi.call('addRecentSymbol', asset).then(function (saveRes) {
      if (saveRes.success) {
        cachedConfig.recent_symbols = saveRes.data.recent_symbols;
        cachedConfig.recent_assets = saveRes.data.recent_assets;
      }
      return saveRes.success ? { success: true, data: saveRes.data.recent_symbols, error: null } : saveRes;
    });
  });
}

function setCurrentFocus(focusKey, focusLabel) {
  return cloudApi.call('saveWeeklyFocus', { key: focusKey }).then(function (saveRes) {
    if (saveRes.success && cachedConfig) cachedConfig.current_focus = saveRes.data;
    return saveRes;
  });
}

function getCachedConfig() {
  return cachedConfig;
}

module.exports = {
  getConfig: getConfig,
  addRecentSymbol: addRecentSymbol,
  setCurrentFocus: setCurrentFocus,
  hasGuideStep: hasGuideStep,
  markGuideStep: markGuideStep,
  getCachedConfig: getCachedConfig
};
