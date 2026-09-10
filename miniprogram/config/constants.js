module.exports = {
  APP_NAME: '交易留痕',
  CLOUD_ENV: 'cloud1-d0gjfc19ve571942b',
  PAGE_SIZE: 20,
  RECENT_SYMBOL_LIMIT: 8,
  REVIEW_DELAY_HOURS: 18,
  DATA_SCHEMA_VERSION: 2,
  OPTION_SET_VERSION: 1,
  STORAGE_KEYS: {
    RECORD_DRAFT: 'trade_record_draft',
    GUIDE_STEPS: 'trade_guide_steps_v1'
  },
  COLLECTIONS: {
    TRADE_EVENTS: 'trade_events',
    REFLECTION_SNAPSHOTS: 'reflection_snapshots',
    PERSONAL_RULES: 'personal_rules',
    WEEKLY_FOCUS: 'weekly_focus',
    PERIOD_METRICS: 'period_metrics',
    USER_CONFIG: 'user_config'
  },
  ROUTES: {
    RECORD: '/pages/record/index',
    REFLECTION: '/pages/reflection/index'
  }
};
