var assert = require('assert');
var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var miniRoot = path.join(root, 'miniprogram');
var appConfig = JSON.parse(fs.readFileSync(path.join(miniRoot, 'app.json'), 'utf8'));

appConfig.pages.forEach(function (pagePath) {
  ['js', 'json', 'wxml', 'wxss'].forEach(function (extension) {
    var file = path.join(miniRoot, pagePath + '.' + extension);
    assert.ok(fs.existsSync(file), 'missing page file ' + file);
  });
});

appConfig.tabBar.list.forEach(function (tab) {
  assert.ok(appConfig.pages.indexOf(tab.pagePath) !== -1, 'tab page not registered: ' + tab.pagePath);
});

assert.ok(fs.existsSync(path.join(root, 'cloudfunctions/login/index.js')));
assert.ok(fs.existsSync(path.join(root, 'cloudfunctions/tradeData/index.js')));
assert.ok(fs.existsSync(path.join(miniRoot, 'assets/images/app-avatar.png')));
assert.ok(fs.existsSync(path.join(miniRoot, 'components/optional-supplement/index.js')));
assert.ok(fs.existsSync(path.join(miniRoot, 'components/trend-chart/index.js')));

console.log('project structure tests passed');
