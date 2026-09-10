var assert = require('assert');
var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '../miniprogram');
var appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
var pageDirs = appConfig.pages.map(function (pagePath) {
  return path.dirname(path.join(root, pagePath + '.wxml'));
});

pageDirs.concat([path.join(root, 'custom-tab-bar')]).forEach(function (directory) {
  var wxml = fs.readFileSync(path.join(directory, 'index.wxml'), 'utf8');
  var js = fs.readFileSync(path.join(directory, 'index.js'), 'utf8');
  var bindings = [];
  var matcher = /(?:bindtap|catchtap|bindinput)="([A-Za-z0-9_]+)"/g;
  var match;
  while ((match = matcher.exec(wxml))) bindings.push(match[1]);
  bindings.forEach(function (name) {
    var pattern = new RegExp('(?:^|\\n)\\s*' + name + '\\s*:\\s*function\\s*\\(');
    assert.ok(pattern.test(js), directory + ' missing handler ' + name);
  });
});

console.log('page binding tests passed');
