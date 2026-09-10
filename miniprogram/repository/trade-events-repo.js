var baseRepo = require('./base-repo');
var constants = require('../config/constants');

module.exports = {
  getById: function (id) { return baseRepo.getById(constants.COLLECTIONS.TRADE_EVENTS, id); },
  getList: function (options) { return baseRepo.getList(constants.COLLECTIONS.TRADE_EVENTS, options); },
  count: function (options) { return baseRepo.count(constants.COLLECTIONS.TRADE_EVENTS, options); }
};
