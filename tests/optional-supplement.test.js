var assert = require('assert');
var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var attachment = fs.readFileSync(path.join(root, 'miniprogram/utils/attachment.js'), 'utf8');
var component = fs.readFileSync(path.join(root, 'miniprogram/components/optional-supplement/index.js'), 'utf8');
var cloud = fs.readFileSync(path.join(root, 'cloudfunctions/tradeData/index.js'), 'utf8');
var recordWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/record/index.wxml'), 'utf8');
var reflectionWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/reflection/index.wxml'), 'utf8');

assert.ok(attachment.indexOf('MAX_IMAGE_COUNT = 3') !== -1);
assert.ok(attachment.indexOf('MAX_IMAGE_BYTES = 5 * 1024 * 1024') !== -1);
assert.ok(attachment.indexOf('wx.compressImage') !== -1);
assert.ok(attachment.indexOf('wx.cloud.uploadFile') !== -1);
assert.ok(component.indexOf("cloudApi.call('saveSupplement'") !== -1);
assert.ok(cloud.indexOf('sanitizeAttachments') !== -1);
assert.ok(cloud.indexOf("action === 'saveSupplement'") !== -1);
assert.ok(cloud.indexOf('cloud.deleteFile') !== -1);
assert.ok(recordWxml.indexOf('entity-type="trade_event"') !== -1);
assert.ok(reflectionWxml.indexOf('entity-type="reflection"') !== -1);

console.log('optional supplement tests passed');
