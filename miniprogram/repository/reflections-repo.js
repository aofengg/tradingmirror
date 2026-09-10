var baseRepo = require('./base-repo');
var constants = require('../config/constants');

module.exports = {
  getList: function (options) { return baseRepo.getList(constants.COLLECTIONS.REFLECTION_SNAPSHOTS, options); }
};
