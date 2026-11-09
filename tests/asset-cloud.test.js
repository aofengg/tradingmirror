const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const model=require('../cloudfunctions/tradeData/asset-tracking');
const events=Array.from({length:215},(_,i)=>({_id:'e'+String(i).padStart(3,'0'),_openid:'owner',is_deleted:false,symbol:'NVDA',market:'US',created_at:new Date(1700000000000),occurred_at:new Date(1700000000000),execution_status:'executed'}));
events.push({_id:'other',_openid:'other',is_deleted:false,symbol:'PRIVATE',created_at:new Date()});
const configs=[{_id:'config',_openid:'owner',is_deleted:false,asset_links:[]}];
let reads=0;
let caller='owner';
function collection(name){let where={},sort=[],limit=100,fields=null;let rows=name==='user_config'?configs:events;return {
 field(value){fields=value;return this;},where(value){where=value;return this;},orderBy(field,order){sort.push([field,order]);return this;},limit(value){limit=value;return this;},
 get(){reads++;let data=rows.filter(r=>Object.keys(where).every(k=>where[k]&&where[k].gt!==undefined?r[k]>where[k].gt:r[k]===where[k]));for(const [field,order] of sort.reverse())data.sort((a,b)=>(a[field]>b[field]?1:a[field]<b[field]?-1:0)*(order==='desc'?-1:1));return Promise.resolve({data:data.slice(0,limit).map(row=>fields?Object.fromEntries(Object.keys(fields).filter(k=>k in row).map(k=>[k,row[k]])):row)});},
 doc(id){return {get:async()=>({data:rows.find(r=>r._id===id)}),set:async({data})=>{const at=rows.findIndex(r=>r._id===id);if(at<0)rows.push({_id:id,...data});else rows[at]={_id:id,...data};},update:async({data})=>{Object.assign(rows.find(r=>r._id===id),data);return {};}};
 } }; }
const db={collection,command:{gt:value=>({gt:value})},serverDate:()=>new Date()};db.runTransaction=fn=>fn(db);
const sandbox={exports:{},console,require:name=>name==='wx-server-sdk'?{init(){},database:()=>db,getWXContext:()=>({OPENID:caller})}:name==='./asset-tracking'?model:name==='./entry-time'?require('../cloudfunctions/tradeData/entry-time'):require(name)};
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
 events[214].attachments=[{file_id:'keep-private',large:'x'.repeat(5000)}];
 response=await sandbox.exports.main({action:'getAssetHistory',payload:{key:target,compact:true}});assert(response.success);
 const compactEvent=response.data.list.find(e=>e._id===events[214]._id);assert.equal(compactEvent.attachment_count,1);assert(!('attachments' in compactEvent));assert.equal(events[214].attachments[0].file_id,'keep-private','projection never mutates the original document');
 response=await sandbox.exports.main({action:'listAssetSummaries',payload:{compact:true}});assert(response.success);assert(response.data.list.every(s=>!('last_executed' in s)),'asset list does not transfer a duplicate event snapshot');
 const call=(action,payload)=>sandbox.exports.main({action,payload:{compact:true,...payload}});
 const freeText=events[events.length-1];
 const hkAlias=JSON.stringify(['HK','stock','英伟达']);
 const marketChange={key:source,market:'HK',requestId:'market_initial'};
 const beforeCorrection=JSON.stringify(events);
 response=await call('changeAssetMarket',marketChange);assert.equal(response.data.key,hkAlias);
 response=await call('changeAssetMarket',marketChange);assert.equal(response.data.key,hkAlias,'same request is idempotent');
 assert.equal(JSON.stringify(events),beforeCorrection,'market correction preserves operation snapshots');
 response=await call('getAssetHistory',{key:source});assert.equal(response.data.summary.market,'HK');assert.equal(response.data.list[0]._id,freeText._id);assert.equal(response.data.merged_sources.length,0,'market correction is not an undoable name alias');
 response=await call('undoAssetMerge',{source,target:hkAlias});assert.equal(response.error,'ASSET_CHANGED');
 response=await call('getAssetContext',{matchSymbol:'英伟达'});assert.equal(response.data.matches[0].key,hkAlias);
 response=await call('listAssetMatches',{symbols:['英伟达','PRIVATE','new']});assert.deepEqual(response.data.matches.map(m=>m.length),[1,0,0]);
 configs.push({_id:'other-config',_openid:'other',is_deleted:false,asset_links:[]});
 caller='other';
 response=await call('changeAssetMarket',marketChange);assert.equal(response.error,'ASSET_CHANGED');
 caller='owner';
 response=await call('createTradeEvent',{client_request_id:'single_market_test',symbol:'英伟达',action:'buy',reason_key:'follow_plan',asset_key:hkAlias});assert.equal(response.data.market,'HK');assert.equal(response.data.market_source,'confirmed');assert.equal(model.identity(response.data),hkAlias);
 const reversed={key:hkAlias,market:'CUSTOM',requestId:'market_reversal'};
 response=await call('changeAssetMarket',reversed);assert.equal(response.data.key,source);
 response=await call('getAssetHistory',{key:hkAlias});assert.equal(response.data.summary.count,2);
 events.push({_id:'dual_us',_openid:'owner',is_deleted:false,symbol:'DUAL',market:'US',created_at:new Date()},
   {_id:'dual_hk',_openid:'owner',is_deleted:false,symbol:'DUAL',market:'HK',created_at:new Date()});
 const dualUS=JSON.stringify(['US','stock','DUAL']);
 const dualHK=JSON.stringify(['HK','stock','DUAL']);
 response=await call('listAssetMatches',{symbols:['DUAL']});assert.deepEqual(response.data.matches[0].map(m=>m.market).sort(),['HK','US']);
 const collision={key:dualUS,market:'HK',requestId:'market_collision'};
 response=await call('changeAssetMarket',collision);assert(response.data.conflict);assert.equal(response.data.count,1);
 response=await call('getAssetHistory',{key:dualUS});assert.equal(response.data.summary.market,'US');
 response=await call('changeAssetMarket',{...collision,mergeTarget:dualHK});assert.equal(response.data.key,dualHK);
 response=await call('getAssetHistory',{key:dualUS});assert.equal(response.data.summary.count,2);
 console.log('asset cloud: >200-row keyset scan and authenticated owner isolation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
