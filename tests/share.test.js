var assert = require('assert');
var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var pages = ['today', 'records', 'review', 'mine', 'record', 'reflection'];
pages.forEach(function (name) {
  var config = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/pages', name, 'index.json'), 'utf8'));
  var script = fs.readFileSync(path.join(root, 'miniprogram/pages', name, 'index.js'), 'utf8');
  assert.strictEqual(config.enableShareAppMessage, true, name + ' should enable friend sharing');
  assert.strictEqual(config.enableShareTimeline, true, name + ' should enable timeline sharing');
  assert.ok(script.indexOf('onShareAppMessage') !== -1, name + ' should define onShareAppMessage');
  assert.ok(script.indexOf('onShareTimeline') !== -1, name + ' should define onShareTimeline');
});

var share = fs.readFileSync(path.join(root, 'miniprogram/utils/share.js'), 'utf8');
var reflection = fs.readFileSync(path.join(root, 'miniprogram/pages/reflection/index.wxml'), 'utf8');
assert.ok(share.indexOf("'/assets/images/app-avatar.png'") !== -1);
assert.ok(share.indexOf("'/pages/today/index'") !== -1);
assert.ok(reflection.indexOf('sharedEntry') !== -1);
assert.ok(reflection.indexOf('打开交易留痕') !== -1);

console.log('share tests passed');
