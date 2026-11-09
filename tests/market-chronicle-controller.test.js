const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('path');
const model=require('../miniprogram/utils/market-chronicle'),markets=require('../miniprogram/config/market-indices');
let def,stored={},rows=[],failNext=false,blocked=null,n=0;
let systemResult={entry:null,manifestMissing:true};
const app={globalData:{openid:'owner'},waitForLogin:()=>Promise.resolve()};
const service={owner:()=>app.globalData.openid,readState:()=>structuredClone(stored),writeState:s=>{stored=structuredClone(s);return true;},list:(m,y)=>Promise.resolve({success:true,data:{rows:rows.filter(r=>r.market===m&&r.date.startsWith(y)),today:'2026-11-06'}}),mutate:async(action,p)=>{if(blocked)return blocked;if(failNext){failNext=false;return {success:false,error:'CLOUD_FUNCTION_CALL_FAILED'};}let row={market:p.market,date:p.date,year:p.date.slice(0,4),quotes:{IXIC:{close:p.close,change:p.change}},note:p.note,revision:p.revision+1};rows=rows.filter(r=>r.date!==p.date).concat([row]);return {success:true,data:{row}};}};
const context={Component:v=>def=v,getApp:()=>app,wx:{getStorageSync:()=>null,stopPullDownRefresh(){},pageScrollTo(){},showToast(){},showModal(){}},require:id=>id.includes('market-indices')?markets:id.includes('market-history-service')?{snapshot:()=>null,refresh:()=>Promise.resolve(systemResult)}:id.includes('services/')?service:id.includes('request-id')?{create:()=> 'request_'+(++n)}:model,Date,Math,String,Number,Object,Promise,setTimeout,clearTimeout};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/components/market-chronicle/index.js'),'utf8'),context);
function instance(){let c={data:structuredClone(def.data),setData(p,cb){Object.assign(this.data,p);if(cb)cb();},...def.methods};def.lifetimes.attached.call(c);return c;}
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function input(c,field,value){c.inputField({currentTarget:{dataset:{field}},detail:{value}});}
(async()=>{
 let c=instance();await tick();assert(c.data.loaded);c.openEditor();input(c,'close','12345.67');input(c,'date','2024-05-10');input(c,'note','历史补记');assert.equal(rows.length,0,'typing is never a cloud write');await c.save();await tick();assert.equal(c.data.year,'2024');assert.equal(c.data.rows.length,1);assert.equal(c.data.graph.points.length,1);assert(c.data.graph.points[0].x>=4&&c.data.graph.points[0].x<=96,'historical save uses destination year scale');
 c.openEditor();input(c,'close','22222.33');c.closeEditor();c.openEditor();assert.equal(c.data.draft.close,'22222.33');
 c.togglePicker();c.chooseMarket({currentTarget:{dataset:{market:'US'}}});c.chooseIndex({currentTarget:{dataset:{index:'NDX'}}});c.openEditor();assert.equal(c.data.draft.close,'');c.togglePicker();c.chooseIndex({currentTarget:{dataset:{index:'IXIC'}}});c.openEditor();assert.equal(c.data.draft.close,'22222.33');
 input(c,'date','2024-06-11');failNext=true;await c.save();assert(c.data.pending);assert(c.data.formError);const request=structuredClone(c.data.draft.request);input(c,'close','999');assert.equal(c.data.draft.close,'22222.33','uncertain request is frozen until retry');
 def.lifetimes.detached.call(c);c=instance();await tick();c.openEditor();assert.deepEqual(c.data.draft.request,request);await c.save();assert(!c.data.pending);assert(!c.data.editorOpen);assert.equal(c.data.rows.length,2);
 c.openEditor();input(c,'date','2024-07-10');input(c,'close','33333');let resolve;blocked=new Promise(r=>resolve=r);const pending=c.save();const savedBefore=structuredClone(stored);def.lifetimes.detached.call(c);resolve({success:true,data:{row:{market:'US',date:'2024-07-10',quotes:{IXIC:{close:33333}},revision:1}}});await pending;assert.deepEqual(stored,savedBefore,'late result does not overwrite local state of detached page');blocked=null;
 const next=instance();await tick();next.openEditor();await next.save();next.openEditor();input(next,'close','44444');const original=service.list;let resolver;service.list=()=>new Promise(r=>resolver=r);const slow=next.refresh();await Promise.resolve();next._version++;resolver({success:true,data:{rows:[],today:'2026-11-06'}});await slow;assert.equal(next.data.draft.close,'44444','late load does not erase draft');service.list=original;
 app.globalData.openid='other';const unchanged=structuredClone(stored);next._remember();assert.deepEqual(stored,unchanged,'account switch cannot persist former owner drafts');
 app.globalData.openid='owner';stored={};rows=[{market:'US',date:'2026-05-08',quotes:{SPX:{close:5000,change:0}},note:'market background',revision:1}];const missing=instance();await tick();missing.editRecord({currentTarget:{dataset:{date:'2026-05-08'}}});assert.equal(missing.data.draft.hasQuote,false,'missing index does not expose deletion');input(missing,'close','15000');const previousMutate=service.mutate;service.mutate=async()=>({success:false,error:'INVALID_DATE'});await missing.save();assert.equal(missing.data.pending,false,'definitive validation response permits editing');assert(!missing.data.draft.request);input(missing,'date','2026-05-07');assert.equal(missing.data.draft.date,'2026-05-07');service.mutate=previousMutate;def.lifetimes.detached.call(missing);
 stored={source:'system'};
 const fallback=instance();await tick();
 assert.equal(fallback.data.source,'mine');assert.equal(fallback.data.sourceIndex,2);
 assert.equal(fallback.data.systemFailed,false);assert.equal(fallback.data.rows.length,1);
 fallback._remember();assert.equal(stored.source,'system','automatic fallback keeps the saved preference');
 systemResult={entry:null,failed:true};
 await fallback.refresh();
 assert.equal(fallback.data.source,'system','without a missing signal, use the saved source');
 assert.equal(fallback.data.systemFailed,true);
 systemResult={entry:null,manifestMissing:true};
 await fallback.refresh();
 fallback.chooseSource({detail:{value:2}});
 systemResult={entry:null};
 await fallback.refresh();
 assert.equal(fallback.data.source,'mine','an explicit personal-only choice is preserved');
 def.lifetimes.detached.call(fallback);
 console.log('Market controller: explicit save, cross-year plot, draft isolation, uncertain retry after reopen, detached responses and account boundaries passed.');
})().catch(e=>{console.error(e);process.exit(1);});
