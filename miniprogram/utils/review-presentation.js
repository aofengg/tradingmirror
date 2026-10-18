// Describe observed feelings, without turning them into a score for the reason.
var KEYS = ['satisfied', 'acceptable', 'regret', 'unknown', 'unreviewed'];
var LABELS = {satisfied:'满意', acceptable:'可接受', regret:'懊悔', unknown:'其他感受', unreviewed:'未回看'};

function decorate(reason) {
  var counts = {};
  (reason.distribution || []).forEach(function (item) {
    if (KEYS.indexOf(item.key) !== -1) counts[item.key] = Number(item.count) || 0;
  });
  var feelings = KEYS.map(function (key) {
    return {key:key, label:LABELS[key], count:counts[key] || 0};
  }).filter(function (item) { return item.count > 0; });
  var total = feelings.reduce(function (sum, item) { return sum + item.count; }, 0);
  var unreviewed = counts.unreviewed || 0;
  var known = (counts.satisfied || 0) + (counts.acceptable || 0) + (counts.regret || 0);
  return Object.assign({}, reason, {
    feelings:feelings.map(function (item) {
      return Object.assign({}, item, {width:total ? item.count / total * 100 : 0});
    }),
    reviewedTotal:total - unreviewed,
    knownTotal:known,
    sampleNote:known < 3 ? (total - unreviewed >= 3 ? '部分感受未识别，先看具体经历' : '回看还少，先看具体经历') : '',
    feelingCounts:counts
  });
}

function observation(rows) {
  var eligible = rows.filter(function (row) { return row.knownTotal >= 3; });
  var mixed = eligible.filter(function (row) { return row.feelingCounts.satisfied && row.feelingCounts.regret; })[0];
  var row = mixed || eligible[0];
  if (!row) return null;
  var phrases = row.feelings.filter(function (item) { return item.key !== 'unreviewed'; }).map(function (item) {
    return item.count + ' 次' + item.label;
  });
  return {
    reason:row.key,
    label:row.label,
    title:mixed ? '同一个理由，也有不同感受' : '这个理由，后来是什么感受？',
    text:'「' + row.label + '」的 ' + row.reviewedTotal + ' 次已回看决定中，' + phrases.join('、') + '。'
  };
}

function evidence(items) {
  return (items || []).map(function (item) {
    var history = item.history || [];
    var last = history[history.length - 1];
    var matches = last && last.feeling === item.latest_feeling;
    return Object.assign({}, item, {
      reviewNote:typeof item.latest_review_note === 'string' ? item.latest_review_note : matches ? last.optional_note || '' : '',
      regretReason:item.latest_feeling !== 'regret' ? '' : typeof item.latest_regret_reason === 'string' ? item.latest_regret_reason : matches ? last.regret_reason_label || '' : ''
    });
  });
}

module.exports = {
  evidence:evidence,
  build:function (reasons) {
    var rows = (reasons || []).map(decorate);
    return {rows:rows, observation:observation(rows)};
  }
};
