const assert=require('assert'),fs=require('fs'),vm=require('vm');
const tick=()=>new Promise(setImmediate);
let revision=0,now=1000;const queue=[];
const app={globalData:{openid:'owner'},getPageRevision:()=>revision,waitForLogin:()=>Promise.resolve()};
const context={module:{exports:{}},getApp:()=>app,Date:class extends Date{static now(){return now;}},require:n=>n.includes('cloud-api')?{call:(action,options)=>new Promise((resolve,reject)=>queue.push({action,options,resolve,reject}))}:n.includes('trade-service')?{decorateEvent:x=>Object.assign({},x)}:n.includes('date')?{formatDateTime:String,formatDate:String}:{normalizeSymbol:x=>x,inferMarket:()=> 'US'}};
vm.runInNewContext(fs.readFileSync('miniprogram/services/asset-service.js','utf8'),context);const assets=context.module.exports;
const result=()=>({success:true,data:{key:'k',summary:null,list:[{_id:'e',symbol:'RKLB',execution_status:'executed'}]}});
(async()=>{
 const a=assets.history({key:'k',direction:'desc'}),b=assets.history({direction:'desc',key:'k'});await tick();assert.equal(queue.length,1,'concurrent and differently ordered equal queries share a read');queue[0].resolve(result());const aa=await a,bb=await b;aa.list[0].symbol='changed';assert.equal(bb.list[0].symbol,'RKLB','cached consumers cannot mutate one another');
 await assets.history({key:'k',direction:'desc'});assert.equal(queue.length,1);
 revision++;const c=assets.history({key:'k',direction:'desc'});await tick();assert.equal(queue.length,2);queue[1].resolve(result());await c;
 const d=assets.history({key:'k',direction:'desc',cursor:{id:'next'}});await tick();assert.equal(queue.length,3,'each history cursor has its own cache key');queue[2].resolve(result());await d;
 now+=31000;const e=assets.history({key:'k',direction:'desc'});await tick();assert.equal(queue.length,4,'expired records are re-read');queue[3].resolve({success:false,error:'offline'});await assert.rejects(e,/offline/);
 const f=assets.history({key:'k',direction:'desc'});await tick();assert.equal(queue.length,5,'a failed read is never cached as an empty history');queue[4].resolve(result());await f;
 const g=assets.history({key:'k',direction:'desc',force:true});await tick();assert(!('force' in queue[5].options));queue[5].resolve(result());await g;
 app.globalData.openid='other';const h=assets.history({key:'k',direction:'desc'});await tick();assert.equal(queue.length,7,'cache is isolated by account');queue[6].resolve(result());await h;
 assets.clearCache();const i=assets.history({key:'k',direction:'desc'});await tick();assert.equal(queue.length,8);queue[7].resolve(result());await i;
 console.log('Asset cache: coalescing, consumer isolation, revisions, cursors, expiry, retry, force, account isolation and refresh passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
