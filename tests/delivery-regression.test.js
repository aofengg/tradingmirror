const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const tick=()=>new Promise(setImmediate);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const ok=data=>({success:true,data});
const evt=filter=>({currentTarget:{dataset:{filter}}});
let revision=0;
const app={getPageRevision:()=>revision,waitForLogin:()=>Promise.resolve(),invalidatePages(){revision++;},globalData:{}};
function page(name,dependencies,extra={}){
 let definition;
 vm.runInNewContext(fs.readFileSync('miniprogram/pages/'+name+'/index.js','utf8'),Object.assign({Page:x=>definition=x,require:dependencies,getApp:()=>app,console:{error(){}},setTimeout,clearTimeout,wx:{stopPullDownRefresh(){},showToast(){}}},extra));
 return Object.assign({},definition,{data:JSON.parse(JSON.stringify(definition.data)),setData(p){for(const [k,v]of Object.entries(p)){const m=k.match(/^(\w+)\[(\d+)\]$/);if(m)this.data[m[1]][+m[2]]=v;else this.data[k]=v;}}});
}
const counts={confirm:45,review:40,all:85};
const rows=kind=>Array.from({length:counts[kind]},(_,i)=>({_id:kind+i,kind}));
const lists={confirm:rows('confirm'),review:rows('review')};
const slice=(kind,start)=>({list:lists[kind].slice(start,start+20),hasMore:start+20<counts[kind],nextCursor:start+20<counts[kind]?start+20:null});
(async()=>{
 let todoReads=0,fail=false;
 const service={
  getTodoOverview:async()=>ok({confirmItems:lists.confirm.slice(0,20),reviewItems:lists.review.slice(0,20),counts,pages:{confirm:{cursor:20,more:true},review:{cursor:20,more:true}}}),
  getTodoPage:async(kind,cursor)=>{todoReads++;return fail&&kind==='review'?{success:false}:ok(slice(kind,cursor));},
  getTodoCounts:async()=>ok(counts),getEventPage:async()=>ok({list:[{_id:'initial'}],hasMore:true,nextCursor:'old'})
 };
 const records=page('records',n=>n.includes('trade-service')?service:n.includes('asset-service')?{decorate:x=>x}:{});
 records._eventsVersion=0;records.data.filter='pending';await records._loadEvents();
 assert.equal(records.data.filteredEvents.length,40);assert(records.data.hasMore);
 fail=true;records.onReachBottom();await tick();assert(records.data.moreError);assert.equal(records.data.filteredEvents.length,40,'a partial group failure preserves the entire visible list and both cursors');
 fail=false;records.onReachBottom();await tick();assert.equal(records.data.filteredEvents.length,80);assert(records.data.hasMore);
 records.onReachBottom();await tick();assert.equal(records.data.filteredEvents.length,85);assert(!records.data.hasMore);assert.equal(new Set(records.data.filteredEvents.map(x=>x._id)).size,85);
 records.chooseTodoFilter(evt('review'));assert.equal(records.data.filteredEvents.length,40);assert(!records.data.hasMore,'one finished group cannot inherit another group cursor');
 records.chooseTodoFilter(evt('confirm'));assert.equal(records.data.filteredEvents.length,45);
 records.data.filter='all';await records._loadEvents();
 const refresh=deferred();let eventReads=0;
 service.getEventPage=()=>{eventReads++;return refresh.promise;};
 const loading=records._loadEvents();await tick();records.onReachBottom();assert.equal(eventReads,1,'background refresh blocks appending from the previous cursor');
 refresh.resolve(ok({list:[{_id:'fresh'}],hasMore:false,nextCursor:null}));await loading;
 assert.equal(records.data.filteredEvents[0]._id,'fresh');assert(!records._eventsRefreshing);

 const historyRequest=deferred();let historyReads=0;
 const asset=page('asset-history',n=>n.includes('asset-service')?{history:()=>{historyReads++;return historyRequest.promise;}}:{});
 asset._version=0;asset.data.items=[{_id:'old'}];asset.data.hasMore=true;asset.data.cursor='old';
 const assetLoading=asset.load(false);asset.onReachBottom();asset.load(true);assert.equal(historyReads,1,'direct and scroll pagination both respect the in-progress refresh');
 historyRequest.resolve({list:[{_id:'new',history_year:2026}],hasMore:false,nextCursor:null});await assetLoading;assert.equal(asset.data.items[0]._id,'new');assert(!asset._refreshing);

 // A refresh that interrupts snapshot pagination must release the loading flag even if it fails.
 const reflectionRequest=deferred();let reflectionReads=0;
 const detail=page('reflection',n=>n.includes('trade-service')?{getEvent:async()=>ok({execution_status:'executed'}),getReflectionPage:()=>{reflectionReads++;return reflectionRequest.promise;}}:n.includes('user-service')?{getConfig:async()=>({success:false})}:n.includes('toast')?{showError(){}}:{});
 detail._alive=true;detail._version=0;detail.data.event={};detail.data.reflectionMore=true;detail.data.reflectionLoadingMore=true;
 detail._loadEvent();await tick();detail.loadMoreReflections();assert.equal(reflectionReads,1);
 reflectionRequest.resolve({success:false});await tick();assert(!detail._historyRefreshing);assert(!detail.data.reflectionLoadingMore);assert(detail.data.loadError);

 let loads=[];
 const todayService={
  getPendingIntentQueue:()=>{const d=deferred();loads.push(d);return d.promise;},
  getPendingReflectionQueue:async()=>ok({items:[],current:null,count:0}),getRecentEvents:async()=>ok([])
 };
 const today=page('today',n=>n.includes('trade-service')?todayService:n.includes('user-service')?{getConfig:async()=>({success:false})}:{});
 const first=today._loadPage();await tick();today._loadPage();assert.equal(loads.length,1,'unchanged parallel callers share the read');
 revision++;today._loadPage();loads[0].resolve(ok({items:[{_id:'stale'}],current:{_id:'stale'},count:1}));await tick();
 assert.equal(loads.length,2);assert.equal(today.data.pendingIntent,null,'old data never flashes while waiting for the requested revision');
 loads[1].resolve(ok({items:[{_id:'fresh'}],current:{_id:'fresh'},count:1}));await first;assert.equal(today.data.pendingIntent._id,'fresh');assert.equal(today._loadedRevision,revision);
 const pull=today._loadPage();await tick();today._loadPage(true);loads[2].resolve(ok({items:[],current:null,count:0}));await tick();assert.equal(loads.length,4,'forced refresh queues one fresh read even with the same revision');
 loads[3].resolve(ok({items:[{_id:'pulled'}],current:{_id:'pulled'},count:1}));await pull;assert.equal(today.data.pendingIntent._id,'pulled');

 const intentRows=Array.from({length:21},(_,i)=>({_id:'intent'+i}));
 let cursors=[];
 todayService.getPendingIntentQueue=async cursor=>{cursors.push(cursor);const start=cursor||0;return ok({items:intentRows.slice(start,start+20),current:intentRows[start],count:21,nextCursor:start?null:20});};
 today.setData({pendingIntentCount:21,pendingIntents:intentRows.slice(0,20),pendingIntentIndex:19,pendingIntentOffset:0,pendingIntent:intentRows[19]});today._intentCursor=20;
 today.showNextIntent();await tick();assert.equal(today.data.pendingIntent._id,'intent20');assert.equal(today.data.pendingIntentOffset,20);
 today.showNextIntent();await tick();assert.equal(today.data.pendingIntent._id,'intent0');assert.equal(today.data.pendingIntentOffset,0);assert.deepEqual(cursors,[20,null]);
 const late=deferred();todayService.getPendingIntentQueue=()=>late.promise;
 today.setData({pendingIntents:intentRows.slice(0,20),pendingIntentIndex:19});today._intentCursor=20;
 today.showNextIntent();today.onUnload();let patchesAfterUnload=0;today.setData=()=>patchesAfterUnload++;
 late.resolve(ok({items:[intentRows[20]],current:intentRows[20],count:21}));await tick();assert.equal(patchesAfterUnload,0,'queue response cannot write into an unloaded page');
 // Verify cursor metadata against the actual service contract, including an exact full page.
 const queryOptions=[];
 const serviceModule={exports:{}};
 vm.runInNewContext(fs.readFileSync('miniprogram/services/trade-service.js','utf8'),{module:serviceModule,require:n=>{
  if(n.includes('trade-events-repo'))return {getList:async o=>{queryOptions.push(o);const start=o.cursor||0;return ok({list:Array.from({length:20},(_,i)=>({_id:'row'+(start+i),created_at:new Date(),action:'buy'})),hasMore:true,nextCursor:start+20});},count:async o=>ok(o.where.execution_status==='pending'?20:40)};
  if(n.includes('read-cache'))return {read:(name,args,load)=>load()};
  if(n.includes('/utils/')||n.includes('/config/'))return require(require('path').resolve('miniprogram',n.replace('../','')));
  return {};
 }});
 const actualService=serviceModule.exports;
 const overview=await actualService.getTodoOverview();assert.equal(overview.data.pages.confirm.more,false,'20 rows with total 20 do not advertise another page');assert(overview.data.pages.review.more);
 await actualService.getTodoPage('review',20);assert.equal(queryOptions.at(-1).cursor,20);assert.equal(queryOptions.at(-1).orderBy,'review_due_at');assert.equal(queryOptions.at(-1).order,'asc');
 await actualService.getPendingIntentQueue(20);assert.equal(queryOptions.at(-1).cursor,20);assert.equal(queryOptions.at(-1).order,'asc');

 // A transient startup failure must be recoverable from the page retry action.
 let appDefinition,loginCalls=0;const loginRequests=[];
 vm.runInNewContext(fs.readFileSync('miniprogram/app.js','utf8'),{App:x=>appDefinition=x,console:{error(){}},wx:{getStorageSync:()=>'',setStorageSync(){},cloud:{init(){},callFunction(){loginCalls++;const d=deferred();loginRequests.push(d);return d.promise;}}},require:n=>n.includes('user-service')?{getConfig:async()=>ok({data_schema_version:2})}:{}});
 appDefinition.onLaunch();const failedLogin=appDefinition.waitForLogin();assert.equal(loginCalls,1);
 loginRequests[0].resolve(Promise.reject(new Error('OFFLINE')));await assert.rejects(failedLogin,/OFFLINE/);
 const retryLogin=appDefinition.waitForLogin(),sameRetry=appDefinition.waitForLogin();assert.equal(retryLogin,sameRetry);assert.equal(loginCalls,2);
 loginRequests[1].resolve({result:{openid:'owner'}});await retryLogin;assert.equal(appDefinition.globalData.openid,'owner');
 // Migration failure must not remain cached as a successful configuration forever.
 let ensures=0,migrations=0;const userModule={exports:{}};
 vm.runInNewContext(fs.readFileSync('miniprogram/services/user-service.js','utf8'),{module:userModule,require:n=>n.includes('constants')?{DATA_SCHEMA_VERSION:2}:n.includes('cloud-api')?{call:async action=>{
  if(action==='ensureUserConfig'){ensures++;return ok({data_schema_version:ensures<3?1:2});}
  migrations++;return migrations===1?{success:false,error:'OFFLINE'}:ok({});
 }}:{}});
 assert.equal((await userModule.exports.getConfig()).success,false);
 const repaired=await userModule.exports.getConfig();assert(repaired.success);assert.equal(repaired.data.data_schema_version,2);assert.equal(migrations,2);

 // Draft ownership and idempotency survive leaving while a submission is in progress.
 let stored,requestSerial=0,submissions=[],saveResolvers=[],removed=0;
 const recordDeps=n=>n.includes('trade-service')?{createTradeEvent:payload=>{submissions.push(payload);const d=deferred();saveResolvers.push(d);return d.promise;},labels:{plans:{planned:'按原计划'}}}:n.includes('trade-options')?{ACTIONS:[{key:'buy',label:'买入'}],findOption:(options,key)=>options.find(x=>x.key===key),getReasons:()=>[{key:'target'},{key:'other'}]}:n.includes('request-id')?{create:prefix=>prefix+(++requestSerial)}:n.includes('constants')?{STORAGE_KEYS:{RECORD_DRAFT:'draft'}}:n.includes('user-service')?{hasGuideStep:()=>false}:n.includes('toast')?{showError(){}}:{};
 const storageWx={setStorageSync:(key,v)=>stored=JSON.parse(JSON.stringify(v)),getStorageSync:()=>stored,removeStorageSync:()=>{removed++;stored=undefined;}};
 const record=page('record',recordDeps,{wx:storageWx});
 record.setData({step:3,symbol:'TEST',action:'buy',reasons:[{key:'target'},{key:'other'}]});
 record.chooseReason({currentTarget:{dataset:{reason:'target'}}});await tick();
 assert(stored.draftId);assert.equal(stored.submissionRequestId,submissions[0].clientRequestId);
 saveResolvers[0].resolve({success:false,error:'OFFLINE'});await tick();
 const reopened=page('record',recordDeps,{wx:storageWx});reopened._restoreDraft('after');
 reopened.chooseReason({currentTarget:{dataset:{reason:'target'}}});await tick();assert.equal(submissions[1].clientRequestId,submissions[0].clientRequestId,'retry after reopening is the same server operation');
 reopened.previousStep();reopened.clearDraft();assert.equal(reopened.data.step,3,'in-progress submission cannot be edited or cleared');reopened.onUnload();stored={draftId:'another-draft',submissionRequestId:'another-request',symbol:'OTHER'};
 let deadPatches=0;reopened.setData=()=>deadPatches++;const previousRevision=revision;
 saveResolvers[1].resolve(ok({_id:'saved',plan_status:'planned'}));await tick();
 assert.equal(stored.symbol,'OTHER');assert.equal(removed,0,'late success cannot delete a newer draft');assert.equal(deadPatches,0);assert.equal(revision,previousRevision+1,'a successful background write still invalidates other pages');

 // Completing a reflection after departure invalidates readers without rendering into the dead page.
 const pendingSave=deferred();const saveDetail=page('reflection',n=>n.includes('trade-service')?{addReflection:()=>pendingSave.promise}:n.includes('trade-options')?{canReview:()=>true}:n.includes('request-id')?{create:()=> 'reflection-request'}:{});
 saveDetail._alive=true;saveDetail._version=0;saveDetail.setData({mode:'review',event:{execution_status:'executed'},id:'trade'});saveDetail._save('satisfied','');saveDetail.onUnload();
 let savedDeadPatches=0;saveDetail.setData=()=>savedDeadPatches++;const beforeSaveRevision=revision;
 pendingSave.resolve(ok({_id:'snapshot',feeling:'satisfied'}));await tick();assert.equal(savedDeadPatches,0);assert.equal(revision,beforeSaveRevision+1);
 console.log('Delivery regression: 85 todos, group failure/retry, complete paging, refresh races, queued revisions, forced refresh and unloaded-page guards passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
