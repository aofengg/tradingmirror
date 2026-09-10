var rulesRepo = require('../repository/personal-rules-repo');
var cloudApi = require('../utils/cloud-api');

function getActiveRules() {
  return rulesRepo.getList({ where: { active: true }, pageSize: 20 });
}

function saveRule(data) {
  return cloudApi.call('savePersonalRule', {
    key: data.key,
    label: data.label,
    description: data.description || '',
    active: data.active !== false,
    ext: data.ext || {}
  });
}

module.exports = {
  getActiveRules: getActiveRules,
  saveRule: saveRule
};
