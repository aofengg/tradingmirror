const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const model=require('../cloudfunctions/tradeData/asset-tracking');
const events=Array.from({length:215},(_,i)=>({_id:'e'+String(i).padStart(3,'0'),_openid:'owner',is_deleted:false,symbol:'NVDA',market:'US',created_at:new Date(1700000000000),occurred_at:new Date(1700000000000),execution_status:'executed'}));
events.push({_id:'other',_openid:'other',is_deleted:false,symbol:'PRIVATE',created_at:new Date()});
const configs=[{_id:'config',_openid:'owner',is_deleted:false,asset_links:[]}];
let reads=0;
function collection(name){let where={},sort=[],limit=100;let rows=name==='user_config'?configs:events;return {
 where(value){where=value;return this;},orderBy(field,order){sort.push([field,order]);return this;},limit(value){limit=value;return this;},
 get(){reads++;let data=rows.filter(r=>Object.keys(where).every(k=>where[k]&&where[k].gt!==undefined?r[k]>where[k].gt:r[k]===where[k]));for(const [field,order] of sort.reverse())data.sort((a,b)=>(a[field]>b[field]?1:a[field]<b[field]?-1:0)*(order==='desc'?-1:1));return Promise.resolve({data:data.slice(0,limit)});},
 doc(id){return {get:async()=>({data:rows.find(r=>r._id===id)}),update:async({data})=>{Object.assign(rows.find(r=>r._id===id),data);return {};}};
 } }; }
const db={collection,command:{gt:value=>({gt:value})},serverDate:()=>new Date()};db.runTransaction=fn=>fn(db);
const sandbox={exports:{},console,require:name=>name==='wx-server-sdk'?{init(){},database:()=>db,getWXContext:()=>({OPENID:'owner'})}:name==='./asset-tracking'?model:require(name)};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../cloudfunctions/tradeData/index.js'),'utf8'),sandbox);
(async()=>{
 let response=await sandbox.exports.main({action:'listAssetSummaries',payload:{}});assert(response.success);assert.strictEqual(response.data.list.length,1);assert.strictEqual(response.data.list[0].count,215);assert(reads>=4);
 response=await sandbox.exports.main({action:'getAssetHistory',payload:{key:model.identity({symbol:'PRIVATE',market:'US'})}});assert(response.success);assert.strictEqual(response.data.list.length,0,'cannot read another owner by forged identity');
 response=await sandbox.exports.main({action:'mergeAsset',payload:{source:model.identity({symbol:'PRIVATE',market:'US'}),target:model.identity(events[0])}});assert.strictEqual(response.success,false);
 const original=JSON.stringify(events);
 events.push({_id:'alias',_openid:'owner',is_deleted:false,symbol:'英伟达',market:'US',created_at:new Date()});
 const source=model.identity(events[events.length-1]),target=model.identity(events[0]);
 response=await sandbox.exports.main({action:'mergeAsset',payload:{source,target}});assert(response.success);assert(Array.isArray(configs[0].asset_links));
 response=await sandbox.exports.main({action:'getAssetHistory',payload:{key:source}});assert.strictEqual(response.data.summary.count,216);assert.strictEqual(response.data.key,target);
 response=await sandbox.exports.main({action:'undoAssetMerge',payload:{source,target}});assert(response.success);assert.strictEqual(configs[0].asset_links.length,0);
 assert.strictEqual(JSON.stringify(events.slice(0,-1)),original,'merge never mutates original records');
 console.log('asset cloud: >200-row keyset scan and authenticated owner isolation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
