var ACTIONS = [
  { key: 'buy', label: '买入', hint: '建立一笔新持仓', icon: '/assets/icons/action-buy.svg', tone: 'green' },
  { key: 'add', label: '加仓', hint: '增加现有持仓', icon: '/assets/icons/action-add.svg', tone: 'blue' },
  { key: 'reduce', label: '减仓', hint: '保留一部分仓位', icon: '/assets/icons/action-reduce.svg', tone: 'amber' },
  { key: 'exit', label: '清仓', hint: '完全离开这笔持仓', icon: '/assets/icons/action-exit.svg', tone: 'rose' }
];

var BUY_REASONS = [
  { key: 'follow_plan', label: '符合原来计划', planStatus: 'planned' },
  { key: 'stronger_thesis', label: '逻辑更确定了', planStatus: 'planned' },
  { key: 'target_price', label: '价格到了目标', planStatus: 'planned' },
  { key: 'fear_missing', label: '怕错过机会', planStatus: 'impulsive' },
  { key: 'average_down', label: '跌了想补仓', planStatus: 'uncertain' },
  { key: 'sudden_opportunity', label: '临时看到机会', planStatus: 'impulsive' }
];

var SELL_REASONS = [
  { key: 'target_reached', label: '达到预设目标', planStatus: 'planned' },
  { key: 'thesis_changed', label: '持仓逻辑变了', planStatus: 'planned' },
  { key: 'risk_control', label: '触发风险控制', planStatus: 'planned' },
  { key: 'fear_giveback', label: '担心利润回吐', planStatus: 'impulsive' },
  { key: 'cannot_stand_volatility', label: '忍不住波动', planStatus: 'impulsive' },
  { key: 'switch_symbol', label: '想换另一只', planStatus: 'impulsive' }
];

var FEELINGS = [
  { key: 'satisfied', label: '满意', hint: '符合当时计划', icon: '/assets/icons/feeling-satisfied.svg' },
  { key: 'acceptable', label: '可接受', hint: '有遗憾，但能接受', icon: '/assets/icons/feeling-acceptable.svg' },
  { key: 'regret', label: '懊悔', hint: '想弄清楚为什么', icon: '/assets/icons/feeling-regret.svg' }
];

var REGRET_REASONS = [
  { key: 'sold_early', label: '卖早了' },
  { key: 'bought_early', label: '买早了' },
  { key: 'chased_high', label: '追高了' },
  { key: 'panic_action', label: '恐慌操作' },
  { key: 'position_issue', label: '仓位不当' },
  { key: 'broke_plan', label: '没按计划' },
  { key: 'other', label: '其他' }
];

var CANCELLED_REGRET_REASONS = [
  { key: 'missed_opportunity', label: '错过机会' },
  { key: 'hesitated', label: '犹豫没行动' },
  { key: 'missed_risk_control', label: '没及时控制风险' },
  { key: 'broke_plan', label: '没按计划' },
  { key: 'other', label: '其他' }
];

function canReview(status) {
  return status === 'executed' || status === 'cancelled';
}

function getRegretReasons(status) {
  return status === 'cancelled' ? CANCELLED_REGRET_REASONS : REGRET_REASONS;
}

function getFeelings(status) {
  return FEELINGS.map(function (item) {
    return status === 'cancelled' && item.key === 'satisfied'
      ? Object.assign({}, item, { hint: '认可当时的选择' }) : item;
  });
}

function getReasons(action) {
  return action === 'buy' || action === 'add' ? BUY_REASONS : SELL_REASONS;
}

function findOption(list, key) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].key === key) return list[i];
  }
  return null;
}

module.exports = {
  ACTIONS: ACTIONS,
  FEELINGS: FEELINGS,
  REGRET_REASONS: REGRET_REASONS,
  CANCELLED_REGRET_REASONS: CANCELLED_REGRET_REASONS,
  canReview: canReview,
  getRegretReasons: getRegretReasons,
  getFeelings: getFeelings,
  getReasons: getReasons,
  findOption: findOption
};
