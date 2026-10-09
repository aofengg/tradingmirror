const assert=require('assert');
const {decorate}=require('../miniprogram/services/asset-service');
const model=require('../cloudfunctions/tradeData/asset-tracking');
const now=Date.now();
const base={symbol:'RKLB',stage:'after',action:'reduce',created_at:now-86400000,reflection_count:0,review_due_at:now-1000};
function event(patch){return Object.assign({},base,patch);}
assert.strictEqual(decorate(base).review_label,'待回看');
[
 {},{review_due_at:now+3600000},{review_due_at:null},{review_due_at:'invalid'},{review_due_at:0},
 {reflection_count:2,latest_feeling:'regret'},{execution_status:'pending'},{execution_status:'cancelled'},{stage:'before'}
].forEach(patch=>{const raw=event(patch);assert.strictEqual(decorate(raw).review_status==='due',model.due(raw,now),'card status must match the review filter');});
assert.strictEqual(decorate(event({review_due_at:now+3600000})).review_label,'尚未回看');
['satisfied','acceptable','regret'].forEach(key=>{const result=decorate(event({reflection_count:2,latest_feeling:key}));assert.strictEqual(result.review_status,'reviewed');assert.strictEqual(result.history_feeling_key,key);assert(result.history_feeling);});
['可接受','可以接受'].forEach(label=>assert.strictEqual(decorate(event({reflection_count:1,latest_feeling_label:label})).history_feeling_key,'acceptable'));
assert.strictEqual(decorate(event({reflection_count:1,latest_feeling_label:'懊悔'})).history_feeling_key,'regret');
assert.strictEqual(decorate(event({reflection_count:1})).history_feeling,'已回看');
assert.strictEqual(decorate(event({execution_status:'pending'})).review_label,'');
assert.strictEqual(decorate(event({execution_status:'cancelled',reflection_count:1,latest_feeling:'regret'})).review_status,'reviewed');
assert.strictEqual(decorate(event({execution_status:'cancelled'})).review_status,'','unexecuted decisions do not become automatic review tasks');
assert.strictEqual(base.review_status,undefined,'decorating must not mutate the source record');
console.log('asset presentation: review/filter parity, future/missing dates, feelings and legacy labels passed');
