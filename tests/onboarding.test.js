var assert = require('assert');
var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }

var cloud = read('cloudfunctions/tradeData/index.js');
var userService = read('miniprogram/services/user-service.js');
var todayJs = read('miniprogram/pages/today/index.js');
var todayWxml = read('miniprogram/pages/today/index.wxml');
var recordWxml = read('miniprogram/pages/record/index.wxml');
var reflectionWxml = read('miniprogram/pages/reflection/index.wxml');
var reviewWxml = read('miniprogram/pages/review/index.wxml');

assert.ok(cloud.indexOf("action === 'updateOnboardingStep'") !== -1);
assert.ok(cloud.indexOf('onboarding_steps: {}') !== -1);
assert.ok(userService.indexOf('markGuideStep') !== -1);
assert.ok(userService.indexOf('GUIDE_STEPS') !== -1);
assert.ok(todayJs.indexOf('results[2].data.length === 0') !== -1);
assert.ok(todayWxml.indexOf('少看结果，多看行为') !== -1);
assert.ok(todayWxml.indexOf('先随便看看') !== -1);
assert.ok(recordWxml.indexOf('价格、仓位与长篇分析都不是必填') !== -1);
assert.ok(recordWxml.indexOf('等今日出现“待回看”') !== -1);
assert.ok(reflectionWxml.indexOf('不用证明当时对错') !== -1);
assert.ok(reviewWxml.indexOf('再积累一个有操作的周期') !== -1);

console.log('onboarding tests passed');
