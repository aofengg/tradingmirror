var api = require('../utils/cloud-api');
var cache = require('../utils/read-cache');
module.exports = {
  read: function (options) {
    options = Object.assign({compact:true}, options);
    return cache.read('review', options, function () { return api.call('getBehaviorReview', options); });
  },
  clearCache: cache.clear,
  saveReminder: function (options) { return api.call('saveReviewReminder', options); }
};
