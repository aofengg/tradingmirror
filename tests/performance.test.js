const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const tick=()=>new Promise(setImmediate);
const event=data=>({currentTarget:{dataset:data}});
let now=1000,revision=0;
const app={globalData:{openid:'owner'},getPageRevision:()=>revision,waitForLogin:()=>Promise.resolve()};
const cacheModule={exports:{}};
vm.runInNewContext(fs.readFileSync('miniprogram/utils/read-cache.js','utf8'),{module:cacheModule,getApp:()=>app,Date:class extends Date{static now(){return now;}}});
const cache=cacheModule.exports;
function page(file,dependencies,extras={}) {
  let definition;
  vm.runInNewContext(fs.readFileSync(file,'utf8'),Object.assign({Page:d=>definition=d,require:dependencies,getApp:()=>app,console,setTimeout,clearTimeout,wx:{stopPullDownRefresh(){}}},extras));
  const patches=[];
  return Object.assign({},definition,{data:JSON.parse(JSON.stringify(definition.data)),patches,setData(patch){
    patches.push(patch);
    for(const [key,value] of Object.entries(patch)) {
      const m=key.match(/^(\w+)\[(\d+)\]$/);
      if(m)this.data[m[1]][Number(m[2])]=value;else this.data[key]=value;
    }
  }});
}
(async()=>{
  const tokens=fs.readFileSync('miniprogram/styles/variables.wxss','utf8'),portal=fs.readFileSync('miniprogram/styles/portal-variables.wxss','utf8');
  assert.equal(portal.slice(portal.indexOf('{')+1,portal.indexOf('}')),tokens.slice(tokens.indexOf('{')+1,tokens.indexOf('}')),'detached component tokens match the app theme');
  let calls=0,resolve;
  const load=()=>{calls++;return new Promise(r=>resolve=r);};
  const a=cache.read('query',{b:2,a:1},load),b=cache.read('query',{a:1,b:2},load);
  await tick();assert.equal(calls,1,'parallel identical reads are coalesced');resolve({success:true,data:{items:[{id:1}]}});
  const aa=await a,bb=await b;aa.data.items[0].id=99;assert.equal(bb.data.items[0].id,1,'consumers cannot mutate shared cached data');
  await cache.read('query',{a:1,b:2},load);assert.equal(calls,1);
  const immediate=()=>{calls++;return Promise.resolve({success:true,data:1});};
  revision++;await cache.read('query',{a:1,b:2},immediate);assert.equal(calls,2);
  app.globalData.openid='other';await cache.read('query',{a:1,b:2},immediate);assert.equal(calls,3,'account boundaries are never shared');
  now+=31000;await cache.read('query',{a:1,b:2},immediate);assert.equal(calls,4);
  await cache.read('error',{},()=>Promise.resolve({success:false,error:'offline'}));
  const retried=await cache.read('error',{},immediate);assert(retried.success,'failed reads remain retryable');
  cache.clear();await cache.read('query',{a:1,b:2},immediate);assert.equal(calls,6,'refresh discards cached queries');

  let configReads=0,resolveConfig;const configModule={exports:{}};
  vm.runInNewContext(fs.readFileSync('miniprogram/services/user-service.js','utf8'),{module:configModule,require:n=>n.includes('cloud-api')?{call:()=>{configReads++;return new Promise(r=>resolveConfig=r);}}:n.includes('constants')?{DATA_SCHEMA_VERSION:2}:{}});
  const c=configModule.exports.getConfig(),d=configModule.exports.getConfig();assert.equal(configReads,1);
  resolveConfig({success:true,data:{data_schema_version:2}});await Promise.all([c,d]);

  let eventReads=0,todoReads=0;
  const incoming=Array.from({length:20},(_,i)=>({_id:'next'+i,symbol:'TEST',optional_note:'memo'.repeat(50)}));
  const records=page('miniprogram/pages/records/index.js',n=>n.includes('trade-service')?{
    getEventPage:()=>{eventReads++;return Promise.resolve({success:true,data:{list:incoming,hasMore:false,nextCursor:null}});},
    getTodoCounts:()=>Promise.resolve({success:true,data:{all:7,confirm:2,review:5}}),
    getTodoOverview:()=>{todoReads++;return Promise.resolve({success:true,data:{confirmItems:[{_id:'intent'}],reviewItems:[{_id:'due'}],counts:{all:7,confirm:2,review:5}}});}
  }:n.includes('asset-service')?{decorate:x=>x}:{});
  records._eventsVersion=0;
  records._events=Array.from({length:500},(_,i)=>({_id:'old'+i,optional_note:'old'.repeat(100)}));
  records.data.filteredEvents=records._events.slice();records.data.nextCursor={id:'cursor'};
  records.onReachBottom();await tick();
  assert.equal(records.data.filteredEvents.length,520);assert.equal(records.data.eventCount,520);
  const append=records.patches.at(-1);assert(!('events' in append));assert(!('filteredEvents' in append),'pagination never re-sends previously rendered cards');
  assert.equal(Object.keys(append).filter(k=>k.startsWith('filteredEvents[')).length,20);
  assert(JSON.stringify(append).length<JSON.stringify(records.data.filteredEvents).length/10,'bridge payload stays proportional to the new page');
  records.chooseFilter(event({filter:'pending'}));await tick();assert.equal(eventReads,1,'opening todos does not also download the regular event list');assert.equal(todoReads,1);assert.equal(records.data.eventCount,7);
  records.chooseFilter(event({filter:'all'}));await tick();assert.equal(eventReads,2);assert.equal(todoReads,1,'regular lists do not fetch hidden todo cards');

  const navigations=[];
  const review=page('miniprogram/pages/review/index.js',()=>({}),{wx:{navigateTo:o=>navigations.push(o)}});
  review.openDetailRecord(event({id:'one'}));review.openDetailRecord(event({id:'one'}));assert.equal(navigations.length,1);
  navigations[0].complete();review.openDetailRecord(event({id:'two'}));assert.equal(navigations.length,2,'navigation unlocks when the transition completes');

  let historyReads=0,failHistory=false;
  const snapshotRows=Array.from({length:121},(_,i)=>({_id:'snapshot'+i,feeling:'acceptable'}));
  const detail=page('miniprogram/pages/reflection/index.js',n=>n.includes('trade-service')?{
    getEvent:()=>Promise.resolve({success:true,data:{reflection_count:121,execution_status:'executed'}}),
    getReflectionPage:(id,cursor)=>{historyReads++;if(failHistory)return Promise.resolve({success:false});const offset=cursor||0;return Promise.resolve({success:true,data:{list:snapshotRows.slice(offset,offset+20),hasMore:offset+20<121,nextCursor:offset+20}});}
  }:n.includes('trade-options')?{canReview:()=>true,getFeelings:()=>[],getRegretReasons:()=>[]}:n.includes('user-service')?{getConfig:()=>Promise.resolve({success:false})}:{},{wx:{setNavigationBarTitle(){}}});
  detail._alive=true;detail._version=0;detail.data.id='event';detail._loadEvent();await tick();
  assert.equal(historyReads,1);assert.equal(detail.data.reflections.length,20);assert.equal(detail.data.reflectionTotal,121);
  failHistory=true;detail.loadMoreReflections();await tick();assert(detail.data.reflectionMoreError);assert.equal(detail.data.reflections.length,20,'failed pagination preserves earlier snapshots');
  failHistory=false;while(detail.data.reflectionMore){detail.loadMoreReflections();await tick();}
  assert.equal(detail.data.reflections.length,121);assert.equal(new Set(detail.data.reflections.map(x=>x._id)).size,121);

  let writes=0,saved;
  const record=page('miniprogram/pages/record/index.js',n=>n.includes('request-id')?{create:()=> 'draft-test'}:n.includes('trade-options')?{}:n.includes('constants')?{STORAGE_KEYS:{RECORD_DRAFT:'draft'}}:{},{wx:{setStorageSync:(key,value)=>{writes++;saved=value;}}});
  record.onSymbolInput({detail:{value:'n'}});record.onSymbolInput({detail:{value:'nv'}});record.onSymbolInput({detail:{value:'nvda'}});assert.equal(writes,0,'typing no longer performs synchronous storage writes on every key');
  record.onHide();assert.equal(writes,1);assert.equal(saved.symbol,'NVDA','leaving immediately flushes the latest draft');
  record.data.completed=true;record._saveDraft();assert.equal(writes,1,'a late timer cannot resurrect a submitted draft');
  console.log('Performance: scoped/deduplicated reads, retry/expiry, concurrent config, 500-row incremental rendering, lazy todos, navigation locks and draft flush passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
