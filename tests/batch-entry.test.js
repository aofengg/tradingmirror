const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const dates=require('../miniprogram/utils/entry-time');
const factory=require('../cloudfunctions/tradeData/batch-entry');
const choices=require('../miniprogram/config/trade-options');
const tick=()=>new Promise(setImmediate);
const event=(key,value)=>({currentTarget:{dataset:{[key]:value}}});
const json=value=>JSON.parse(JSON.stringify(value));
function payload(id,symbol='腾讯',date='2020-01-03'){
 return {...dates.build(date,'',false),client_request_id:id,symbol,action:'buy',reason_key:'follow_plan',stage:'after',time_mode:'specified',optional_note:'独立验收样本'};
}
async function backend(){
 const tables={entry_requests:{},trade_events:{},user_config:{config:{_id:'config',_openid:'owner',recent_symbols:[],recent_assets:[]}}};
 let chain=Promise.resolve();
 const db={serverDate:()=>new Date(),collection(name){const rows=tables[name]||(tables[name]={});return {doc(id){return {
   async get(){return {data:rows[id]?json(rows[id]):null};},async set({data}){rows[id]={...json(data),_id:id};},
   async update({data}){Object.assign(rows[id],json(data));},async remove(){delete rows[id];}
 };}};},runTransaction(fn){const task=chain.then(()=>fn(db));chain=task.catch(()=>{});return task;}};
 const api=factory(db,()=> 'config',config=>Object.fromEntries((config.asset_links||[]).map(row=>[row.source,row.target])));
 const a=payload('test_request_a'),b=payload('test_request_b','NVDA');
 const [first,duplicate]=await Promise.all([api('owner','createBatchEntries',{items:[a,b]}),api('owner','createBatchEntries',{items:[a,b]})]);
 assert(first.success&&duplicate.success);assert.equal(Object.keys(tables.trade_events).length,2);
 const saved=first.data.items[0].data;
 const receipt=Object.values(tables.entry_requests)[0];assert.equal(receipt._openid,'__batch_entry_service__');assert(!JSON.stringify(receipt).includes('腾讯'));assert(!('created_at' in receipt));
 assert.throws(()=>factory.normalize({...a,stage:'invalid'},Date.now()),/VALIDATION/);
 assert.equal(saved.market,'CUSTOM');assert.equal(saved.reason_label,'符合原来计划');assert.equal(saved.occurred_at_precision,'date');
 assert.equal(new Date(saved.review_due_at).getTime(),dates.start('2020-01-03')+dates.DAY-1+18*3600000);
 assert(dates.label(saved).includes('时刻未填'));assert(!dates.label(saved).includes('00:00'));
 assert.equal(dates.horizon(saved,dates.start('2020-01-04')).hours,null);
 assert.equal((await api('owner','createBatchEntries',{items:[{...a,reason_key:'risk_control'}]})).success,false);
 const changed=await api('owner','createBatchEntries',{items:[{...a,optional_note:'changed'}]});assert.equal(changed.data.items[0].error,'REQUEST_CONFLICT');
 const originalB=json(Object.values(tables.trade_events).find(e=>e.symbol==='NVDA'));const receiptB=Object.keys(tables.entry_requests).find(k=>tables.entry_requests[k].event_id===originalB._id);delete tables.entry_requests[receiptB];
 await api('owner','createBatchEntries',{items:[b]});assert.deepEqual(tables.trade_events[originalB._id],originalB,'recovering a missing receipt never resets original metadata or reflections');
 await api('other','undoBatchEntries',{items:[{client_request_id:a.client_request_id}]});assert.equal(Object.keys(tables.trade_events).length,2,'other account cannot cancel this request');
 await api('owner','undoBatchEntries',{items:[{client_request_id:a.client_request_id}]});assert.equal(Object.keys(tables.trade_events).length,1);
 await api('owner','createBatchEntries',{items:[a]});assert.equal(Object.keys(tables.trade_events).length,1,'replay after undo never resurrects the original');
 const early=payload('test_request_early');await api('owner','undoBatchEntries',{items:[{client_request_id:early.client_request_id}]});
 const cancelled=await api('owner','createBatchEntries',{items:[early]});assert(cancelled.data.items[0].data.cancelled);assert.equal(Object.keys(tables.trade_events).length,1);
 const now=Date.now(),precise={...payload('test_request_now','AAPL',dates.day(now)),...dates.build(dates.day(now),'',true,now-60000),time_mode:'now'};
 const preciseResult=await api('owner','createBatchEntries',{items:[precise]});assert.equal(new Date(preciseResult.data.items[0].data.occurred_at).getTime(),now-60000,'server retry cannot rewrite frozen time');
 assert.throws(()=>factory.normalize({...a,occurred_date:'2020-02-30'},now));
 assert.throws(()=>dates.build(dates.day(now),'23:59',false,dates.start(dates.day(now))+3600000),/FUTURE/);
 const inputKey=JSON.stringify(['CUSTOM','stock','腾讯']);
 const corrected=JSON.stringify(['HK','stock','腾讯']);
 tables.user_config.config.asset_links=[{source:inputKey,target:corrected,kind:'market'}];
 const linked={...payload('test_market_linked'),asset_key:inputKey};
 const savedLinked=(await api('owner','createBatchEntries',{items:[linked]})).data.items[0].data;
 assert.equal(savedLinked.market,'HK');assert.equal(savedLinked.market_source,'confirmed');
 assert.equal((await api('owner','createBatchEntries',{items:[{...linked,asset_key:corrected}]})).data.items[0].error,'REQUEST_CONFLICT');
 delete tables.user_config.config.asset_links;
 assert.equal((await api('owner','createBatchEntries',{items:[linked]})).data.items[0].data.market,'HK','retries keep the original market even after the user edits the mapping');
 const ai=require('../cloudfunctions/reviewAI/analysis');const source=ai.source([saved],[],Date.now());assert.equal(source.input[0].date_precision,'date');assert(ai.prompt(source)[1].content.includes('具体时刻未记录'));
 assert.deepEqual(fs.readFileSync('miniprogram/utils/entry-time.js'),fs.readFileSync('cloudfunctions/tradeData/entry-time.js'));
}
async function queue(){
 const storage={},calls=[];let owner='owner',sequence=0;
 const app={globalData:{openid:owner,userConfig:{recent_symbols:['NVDA'],recent_assets:[]}},invalidatePages(){}};
 const context={module:{exports:{}},getApp:()=>app,wx:{getStorageSync:k=>storage[k],setStorageSync:(k,v)=>{storage[k]=json(v);}},require:n=>n.includes('request-id')?{create:()=> 'job_'+(++sequence)}:{call:(action,payload)=>new Promise(resolve=>calls.push({action,payload,resolve}))}};
 vm.runInNewContext(fs.readFileSync('miniprogram/services/batch-entry-store.js','utf8'),context);
 const store=context.module.exports;
 store.saveDraft(owner,{draftId:'draft_one',stage:'after',symbolInput:'draft'});store.saveDraft(owner,{stage:'before',symbolInput:'idea'});
 const group=store.enqueue(owner,[payload('queue_request_one'),payload('queue_request_two')],'draft_one');assert.equal(calls.length,1);assert.equal(store.load(owner).drafts.before.symbolInput,'idea');assert.equal(store.load(owner).drafts.after,null);
 let notifications=0;const unsubscribe=store.subscribe(owner,()=>notifications++);store.saveDraft(owner,{draftId:'draft_two',stage:'after',symbolInput:'next'});assert.equal(notifications,0,'typing drafts never re-renders the receipt list');assert.equal(store.load(owner).drafts.after.symbolInput,'next');unsubscribe();
 calls[0].resolve({success:false,error:'CLOUD_FUNCTION_CALL_FAILED'});await tick();assert.equal(store.load(owner).jobs[0].items[0].status,'unknown');
 store.retry(owner);assert.equal(calls.length,2);assert.equal(calls[1].payload.items[0].client_request_id,'queue_request_one');
 calls[1].resolve({success:true,data:{items:calls[1].payload.items.map(p=>({requestId:p.client_request_id,success:true,data:{_id:'event_'+p.client_request_id,symbol:'腾讯',market:'CUSTOM',asset_type:'stock'}}))}});await tick();assert.equal(store.load(owner).jobs[0].items.filter(i=>i.status==='saved').length,2);
 assert.equal(app.globalData.userConfig.recent_symbols[0],'腾讯','confirmed batch entries immediately update shared recent choices');assert.equal(app.globalData.userConfig.recent_assets[0].market,'CUSTOM');
 store.undo(owner,group);assert.equal(calls[2].action,'undoBatchEntries');calls[2].resolve({success:true,data:{items:calls[2].payload.items.map(p=>({requestId:p.client_request_id,success:true,data:{undone:true}}))}});await tick();assert(store.load(owner).jobs[0].items.every(i=>i.status==='undone'));
 assert.equal(store.load('other').jobs.length,0);assert.equal(store.load('other').drafts.after,undefined);
 const write=context.wx.setStorageSync;let failureNotice=false;store.subscribe(owner,s=>{if(s.storageError)failureNotice=true;});
 store.enqueue(owner,[payload('queue_result_diskfail')],'draft_three');assert.equal(calls.length,4);context.wx.setStorageSync=()=>{throw Error('disk full');};
 calls[3].resolve({success:true,data:{items:[{requestId:'queue_result_diskfail',success:true,data:{_id:'existing'}}]}});await tick();assert(failureNotice);assert.equal(store.load(owner).jobs[1].items[0].status,'saving');
 context.wx.setStorageSync=write;store.retry(owner);assert.equal(calls.length,5);assert.equal(calls[4].payload.items[0].client_request_id,'queue_result_diskfail');
 calls[4].resolve({success:true,data:{items:[{requestId:'queue_result_diskfail',success:true,data:{_id:'existing'}}]}});await tick();assert.equal(store.load(owner).jobs[1].items[0].status,'saved');
 context.wx.setStorageSync=()=>{throw Error('disk full');};assert.throws(()=>store.enqueue(owner,[payload('queue_storage_fail')]));assert.equal(calls.length,5,'failed durable save never starts cloud writes');
}
async function controller(){
 let definition,submissions=[];const storage={},timers=[];const owner='owner';const app={globalData:{openid:owner,userConfig:{}},waitForLogin:()=>Promise.resolve()};
 const store={load:()=>({drafts:{},jobs:[]}),saveDraft:(o,d)=>{storage[o]=d;},enqueue:(o,entries)=>{submissions.push(json(entries));},subscribe:()=>()=>{},resume(){}};
 vm.runInNewContext(fs.readFileSync('miniprogram/pages/batch-record/index.js','utf8'),{Page:d=>definition=d,Date,console,setTimeout,clearTimeout,getApp:()=>app,
 wx:{hideKeyboard(){},navigateBack(){},navigateTo(){},showModal(){}},require:n=>n.includes('asset-service')?{resolveEntries:async symbols=>symbols.map(symbol=>symbol==='腾讯'?{symbol:'腾讯',market:'HK',asset_type:'stock',key:'["HK","stock","腾讯"]'}:null)}:n.includes('trade-options')?choices:n.includes('batch-entry-store')?store:n.includes('entry-time')?dates:n.includes('request-id')?{create:()=> 'request_'+Math.random().toString(36).slice(2)}:n.includes('share')?{enable(){}}:{getCachedConfig:()=>({recent_symbols:['NVDA']})}});
 const page=Object.assign({},definition,{data:json(definition.data),setData(p){Object.assign(this.data,p);}});page.onLoad({stage:'after'});await tick();
 page.onSymbolInput({detail:{value:'腾讯'}});page.chooseSymbol(event('symbol','NVDA'));page.chooseAction(event('action','buy'));page.chooseReason(event('reason','follow_plan'));assert.equal(submissions.length,0,'reason tap only selects');assert(page.data.canSave);
 page.chooseDate({detail:{value:'2020-01-03'}});assert.equal(page.data.symbolInput,'腾讯');assert.equal(page.data.reasonKey,'follow_plan');const saving=page.save();page.save();await saving;assert.equal(submissions.length,1,'double tap only saves one snapshot');assert.equal(submissions[0].length,2);assert.equal(submissions[0][1].asset_key,'["HK","stock","腾讯"]');assert.equal(submissions[0][0].occurred_at_precision,'date');assert.equal(page.data.selectedDate,'2020-01-03');assert.equal(page.data.symbolInput,'');assert.equal(page.data.reasonKey,'');
 page.onSymbolInput({detail:{value:'nvda'}});page.chooseSymbol(event('symbol','NVDA'));assert.equal(page.data.selectedCount,1,'typed aliases normalize without duplicate');page.onHide();assert.equal(storage[owner].symbolInput,'nvda');page.onUnload();
}
(async()=>{await backend();await queue();await controller();console.log('Batch entry: preserved single flow, explicit submit, date precision, frozen timestamps, account separation, durable retry, cancellation tombstones, input retention and partial recovery passed');})().catch(e=>{console.error(e);process.exitCode=1;});
