var _db = null;
var _cmd = null;

function getDB() {
  if (!_db) _db = wx.cloud.database();
  return _db;
}

function getCommand() {
  if (!_cmd) _cmd = getDB().command;
  return _cmd;
}

function getCollection(name) {
  return getDB().collection(name);
}

module.exports = {
  getDB: getDB,
  getCommand: getCommand,
  getCollection: getCollection
};
