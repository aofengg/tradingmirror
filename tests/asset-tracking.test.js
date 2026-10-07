const assert=require('assert');
const model=require('../cloudfunctions/tradeData/asset-tracking');
const now=Date.UTC(2026,8,28);
function event(id,patch){return Object.assign({_id:id,_openid:'owner',symbol:'NVDA',market:'US',asset_type:'stock',execution_status:'executed',occurred_at:new Date(now-200*86400000),executed_at:new Date(now-200*86400000),created_at:new Date(now-200*86400000),review_due_at:new Date(now-190*86400000),reflection_count:0,is_deleted:false},patch);}
const all=Array.from({length:65},(_,i)=>event('e'+String(i).padStart(3,'0')));
all.push(event('pending',{execution_status:'pending',occurred_at:new Date(now-1),executed_at:null}));
all.push(event('cancelled',{execution_status:'cancelled',occurred_at:new Date(now),executed_at:null}));
all.push(event('removed',{is_deleted:true}));
const key=model.identity(all[0]);
let summary=model.read(all,{},'getAssetContext',{key},now).summary;
assert.strictEqual(summary.count,67);assert.strictEqual(summary.executed_count,65);assert.strictEqual(summary.pending_count,1);assert.strictEqual(summary.review_count,65);
assert.strictEqual(summary.latest._id,'cancelled');assert.strictEqual(summary.last_executed._id,'e064');
for(const direction of ['asc','desc']){
 let cursor=null,ids=[];do {const res=model.read(all,{},'getAssetHistory',{key,direction,cursor,limit:20},now);ids.push(...res.list.map(e=>e._id));cursor=res.hasMore?res.nextCursor:null;}while(cursor);
 assert.strictEqual(ids.length,67);assert.strictEqual(new Set(ids).size,67);
 assert.strictEqual(ids[direction==='asc'?0:ids.length-1],'e000');
}
assert.strictEqual(model.read(all,{},'getAssetHistory',{key,status:'pending'},now).list.length,1);
assert.strictEqual(model.read([event('later',{review_due_at:new Date(now+1)})],{},'getAssetContext',{key},now).summary.review_count,0);
assert.strictEqual(model.read([event('later',{review_due_at:new Date(now+1)})],{},'getAssetContext',{key},now+2).summary.review_count,1);
const custom=event('alias',{symbol:'英伟达'});const source=model.identity(custom);
let links=model.merge({},source,key,model.build(all.concat(custom),{},now));
assert.strictEqual(model.read(all.concat(custom),links,'getAssetContext',{key:source},now).summary.count,68);
assert.strictEqual(model.read(all.concat(custom),links,'listAssetSummaries',{query:'英伟达'},now).list[0].key,key);
assert.strictEqual(model.read(all.concat(custom),{},'getAssetContext',{key:source},now).summary.count,1,'undo restores original source');
assert.strictEqual(model.identity(event('x',{symbol:' nvda '})),key);
assert.notStrictEqual(model.identity(event('x',{market:'HK'})),key);
assert.throws(()=>model.merge({},key,model.identity(event('hk',{market:'HK'})),model.build([all[0],event('hk',{market:'HK'})],{},now)),/MARKET_MISMATCH/);
assert.throws(()=>model.merge(links,key,source,model.build(all.concat(custom),links,now)),/INVALID_ASSET|ASSET_CHANGED/);
assert.strictEqual(model.read([event('reviewed',{reflection_count:2,latest_reflection_at:new Date(now)})],{},'getAssetContext',{key},now).summary.review_count,0);
assert.strictEqual(model.read(all.filter(e=>e._id!=='e064'),{},'getAssetContext',{key},now).summary.last_executed._id,'e063');
assert.strictEqual(model.read([],{},'getAssetContext',{key},now).summary,null);
assert.strictEqual(model.occurred(event('intent',{stage:'before',recorded_at:new Date(now-10000),occurred_at:new Date(now)})),now-10000,'execution confirmation must not move the original decision');
console.log('asset tracking: full history, tied cursors both directions, execution, due time, alias merge/undo and deletion passed');
