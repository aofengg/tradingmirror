var assert = require('assert');
var repo = require('../miniprogram/repository/trade-events-repo');
var db = require('../miniprogram/utils/db');
var service = require('../miniprogram/services/related-history-service');
function op(kind, value) { return { kind: kind, value: value, and: function (other) { return {kind:'and', values:[this, other]}; } }; }
db.getCommand = function () { return { neq:v=>op('neq',v), gte:v=>op('gte',v), lt:v=>op('lt',v) }; };
var source = { _id:'current', action:'exit', reason_key:'fear_giveback', occurred_at:'2026-09-18T12:00:00Z' };
function matches(row,w) {
 return !row.is_deleted && row._openid === 'self' && (!w._id || row._id !== w._id.value) && row.action === w.action && row.reason_key === w.reason_key && row.execution_status === w.execution_status && new Date(row.executed_at)>=w.executed_at.values[0].value && new Date(row.executed_at)<w.executed_at.values[1].value;
}
var rows = [];
for(var i=0;i<25;i++) rows.push({_id:'r'+i,_openid:'self',action:'exit',reason_key:'fear_giveback',execution_status:'executed',executed_at:new Date(Date.parse(source.occurred_at)-(i+1)*86400000),optional_note:'note',latest_feeling_label:i%2?'满意':'懊悔',latest_reflection_at:new Date(Date.parse(source.occurred_at))});
['pending','cancelled'].forEach(s=>rows.push(Object.assign({},rows[0],{_id:s,execution_status:s})));
rows.push(Object.assign({},rows[0],{_id:'current'}),Object.assign({},rows[0],{_id:'other',_openid:'other'}),Object.assign({},rows[0],{_id:'deleted',is_deleted:true}),Object.assign({},rows[0],{_id:'action',action:'reduce'}),Object.assign({},rows[0],{_id:'reason',reason_key:'risk_control'}),Object.assign({},rows[0],{_id:'old',executed_at:'2025-01-01'}),Object.assign({},rows[0],{_id:'future',executed_at:'2026-09-19'}));
repo.getList = o=>Promise.resolve({success:true,data:{list:rows.filter(x=>matches(x,o.where)).slice(o.offset||0,(o.offset||0)+o.pageSize)}});
repo.count = o=>Promise.resolve({success:true,data:rows.filter(x=>matches(x,o.where)).length});
(async function(){
 // Normal sources do not need a negative ID filter. Legacy inconsistent
 // timestamps still require it, so pagination/count exclusions remain intact.
 ['pending','cancelled'].forEach(status=>assert(!service.queryFor(Object.assign({},source,{execution_status:status}))._id));
 assert(!service.queryFor(Object.assign({},source,{execution_status:'executed',executed_at:source.occurred_at}))._id);
 assert(!service.queryFor(Object.assign({},source,{execution_status:'executed',executed_at:'2026-09-19'}))._id);
 assert(service.queryFor(Object.assign({},source,{execution_status:'executed',executed_at:'2026-09-17'}))._id);
 assert(service.queryFor(Object.assign({},source,{execution_status:'executed',executed_at:{}}))._id);
 var fetchedId;
 repo.getById=id=>{fetchedId=id;return Promise.resolve({success:true,data:source})};
 var bridged=await service.getHistory(Object.assign({},source,{occurred_at:{},created_at:{}}),0);
 assert.equal(bridged.success,true);assert.equal(bridged.data.count,25);assert.equal(fetchedId,source._id);
 repo.getById=()=>Promise.resolve({success:false,error:'AUTH_ERROR'});
 assert.equal((await service.getHistory(Object.assign({},source,{occurred_at:{},created_at:{}}),0)).error,'AUTH_ERROR');
 repo.getById=()=>Promise.resolve({success:true,data:Object.assign({},source,{occurred_at:{},created_at:{}})});
 assert.equal((await service.getHistory(Object.assign({},source,{occurred_at:{},created_at:{}}),0)).success,false);
 var first = await service.getHistory(source,0);
 assert.equal(first.data.count,25);assert.equal(first.data.items.length,20);assert(first.data.hasMore);
 var second = await service.getHistory(source,20);assert.equal(second.data.items.length,5);assert(!second.data.hasMore);
 assert.equal(new Set(first.data.items.concat(second.data.items).map(x=>x._id)).size,25);
 assert(first.data.items.some(x=>x.history_feeling==='满意'));assert(first.data.items.some(x=>x.history_feeling==='懊悔'));
 assert.equal(service.decorate({executed_at:'2026-09-01'}).history_feeling,'尚未回看');
 assert.equal(service.decorate({executed_at:'2026-09-01',latest_reflection_at:'2026-09-04',latest_feeling_label:'可以接受'}).history_review_time,'3天后回看');
 assert.equal((await service.getHistory({})).success,false);
 repo.getList=()=>Promise.resolve({success:false,error:'OFFLINE'});assert.equal((await service.getHistory(source)).success,false);
 // Component lifecycle: a slow response for the prior intent must never replace the current card.
 var definition;global.Component=d=>definition=d;global.getApp=()=>({waitForLogin:()=>Promise.resolve()});global.wx={navigateTo:()=>{}};
 require('../miniprogram/components/related-history/index');
 var resolvers=[];service.getHistory=()=>new Promise(resolve=>resolvers.push(resolve));
 var c={data:{source:source},_ready:true,_version:0,setData:function(v){Object.assign(this.data,v)}};Object.assign(c,definition.methods);
 c.refresh();await Promise.resolve();c.data.source=Object.assign({},source,{_id:'new'});c.refresh();await Promise.resolve();
 resolvers[1]({success:true,data:{count:1,items:[{_id:'new-history'}],hasMore:false}});await new Promise(r=>setImmediate(r));
 resolvers[0]({success:true,data:{count:4,items:[{_id:'stale'}],hasMore:false}});await new Promise(r=>setImmediate(r));
 assert.equal(c.data.items[0]._id,'new-history');assert.equal(c.data.count,1);
 definition.lifetimes.detached.call(c);assert.equal(c._ready,false);
 console.log('related history: matching, 90-day boundary, exclusions, pagination, mixed feelings, missing data, failure and stale responses passed');
})().catch(e=>{console.error(e);process.exitCode=1});
