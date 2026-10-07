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
assert.ok(attachment.indexOf("createError('IMAGE_FILE_READ_FAILED', 'read'") !== -1);
assert.ok(attachment.indexOf("createError('IMAGE_COMPRESS_FAILED', 'compress'") !== -1);
assert.ok(attachment.indexOf("createError('IMAGE_UPLOAD_FAILED', 'upload'") !== -1);
assert.ok(component.indexOf("cloudApi.call('saveSupplement'") !== -1);
assert.ok(component.indexOf("CLOUD_FUNCTION_CALL_FAILED: '连接云端失败，请检查网络'") !== -1);
assert.ok(component.indexOf("console.error('[optional-supplement] save failed'") !== -1);
assert.ok(component.indexOf("DATABASE_WRITE_FAILED: '内容写入失败，请稍后重试'") !== -1);
assert.ok(component.indexOf("trace_id: failure.traceId") !== -1);
assert.ok(cloud.indexOf('sanitizeAttachments') !== -1);
assert.ok(cloud.indexOf('validAttachmentDate') !== -1);
assert.ok(cloud.indexOf('updateSupplement') !== -1);
assert.ok(cloud.indexOf('await wait(180)') !== -1);
assert.ok(cloud.indexOf("action === 'saveSupplement'") !== -1);
assert.ok(cloud.indexOf('cloud.deleteFile') !== -1);
assert.ok(cloud.indexOf("tracedError('DATABASE_READ_FAILED'") !== -1);
assert.ok(cloud.indexOf("tracedError('DATABASE_WRITE_FAILED'") !== -1);
assert.ok(cloud.indexOf("crypto.randomBytes(6).toString('hex').toUpperCase()") !== -1);
assert.ok(recordWxml.indexOf('entity-type="trade_event"') !== -1);
assert.ok(reflectionWxml.indexOf('entity-type="reflection"') !== -1);

console.log('optional supplement tests passed');
