const assert=require('assert'),fs=require('fs'),vm=require('vm');
const options=require('../miniprogram/config/trade-options');
const asset=require('../miniprogram/services/asset-service');
const chart=require('../miniprogram/utils/asset-overview');
const tick=()=>new Promise(setImmediate);
function loadPage(deps,globals){let definition;vm.runInNewContext(fs.readFileSync('miniprogram/pages/reflection/index.js','utf8'),Object.assign({Page:value=>definition=value,require:deps},globals));return Object.assign({},definition,{data:JSON.parse(JSON.stringify(definition.data)),setData(patch){Object.assign(this.data,patch);}});}
(async()=>{
  const titles=[],attempts=[];let fail=true,revision=0;
  const original={_id:'cancelled',execution_status:'cancelled',symbol:'RKLB',reflection_count:0,created_at:new Date(Date.now()-86400000)};
  const reviews=[];
  const trade={getEvent:async()=>({success:true,data:Object.assign({},original,{reflection_count:reviews.length})}),getReflectionsForTrade:async()=>({success:true,data:reviews.slice()}),addReflection:async(id,feeling,reason,requestId)=>{
    attempts.push({id,feeling,reason,requestId});if(fail)return {success:false,error:'offline'};
    const why=options.findOption(options.getRegretReasons('cancelled'),reason);
    const snapshot={_id:'r'+reviews.length,trade_event_id:id,feeling,feeling_label:options.findOption(options.FEELINGS,feeling).label,regret_reason_label:why?why.label:'',reviewed_at:new Date()};reviews.unshift(snapshot);return {success:true,data:snapshot};
  }};
  const app={waitForLogin:()=>Promise.resolve(),getPageRevision:()=>revision,invalidatePages:()=>revision++};
  const p=loadPage(name=>name.includes('trade-options')?options:name.includes('trade-service')?trade:name.includes('user-service')?{getConfig:async()=>({success:false}),markGuideStep(){}}:name.includes('request-id')?{create:()=>String(attempts.length)}:name.includes('toast')?{showError(){}}:name.includes('share')?{enable(){}}:{},{getApp:()=>app,wx:{setNavigationBarTitle:o=>titles.push(o.title),pageScrollTo(){}}});
  p._alive=true;p._version=0;p.data.id='cancelled';p.data.mode='review';p._loadEvent();await tick();
  assert(p.data.canReview);assert.equal(titles.pop(),'回看这次决定');assert.equal(p.data.feelings[0].hint,'认可当时的选择');
  assert(!p.data.regretReasons.some(x=>x.key==='sold_early'));assert(p.data.regretReasons.some(x=>x.key==='missed_risk_control'));
  p.chooseFeeling({currentTarget:{dataset:{feeling:'regret'}}});assert.equal(attempts.length,0);
  p.chooseRegretReason({currentTarget:{dataset:{reason:'missed_opportunity'}}});await tick();assert(!p.data.completed);assert(!p.data.saving);
  fail=false;p.chooseRegretReason({currentTarget:{dataset:{reason:'missed_opportunity'}}});await tick();
  assert.equal(attempts[0].requestId,attempts[1].requestId,'retry must reuse idempotency key');assert(p.data.completed);assert.equal(p.data.event.execution_status,'cancelled');assert.equal(p.data.reflections[0].regret_reason_label,'错过机会');
  p.data.completed=false;p.data.mode='detail';p.startReview();p.chooseFeeling({currentTarget:{dataset:{feeling:'acceptable'}}});await tick();
  assert.equal(p.data.reflections.length,2);assert.equal(p.data.reflections[1].regret_reason_label,'错过机会');assert.equal(original.execution_status,'cancelled');
  p.finish();await tick();assert.equal(p.data.mode,'detail');assert(p.data.historyExpanded);assert.equal(p.data.reflections.length,2);
  const decorated=asset.decorate(Object.assign({},original,{reflection_count:2,latest_feeling:'acceptable'}));
  assert.equal(decorated.review_status,'reviewed');assert.equal(decorated.execution_label,'未执行');assert.equal(decorated.history_feeling_key,'acceptable');
  const rows=chart.build([decorated],reviews);assert.equal(rows.length,3);assert.equal(chart.layout(rows,10).links.length,2);assert(chart.layout(rows,10).rows.filter(x=>x.kind==='feeling').every(x=>x.caption.includes('未执行')));
  p.data.event={execution_status:'pending'};p.data.mode='detail';p.startReview();assert.equal(p.data.mode,'detail');p.data.mode='review';p._save('satisfied','');assert.equal(attempts.length,3,'pending decisions cannot submit a review');
  trade.getEvent=async()=>({success:true,data:{execution_status:'pending'}});p._loadEvent();await tick();assert(!p.data.canReview);assert.equal(p.data.mode,'detail','review URL for pending must show confirmation');

  const payloads=[];const serviceContext={module:{exports:{}},require:name=>name==='../config/trade-options'?options:name==='../utils/cloud-api'?{call:async(action,payload)=>{payloads.push({action,payload});return {success:true,data:{snapshot:payload}};}}:name==='../utils/request-id'?{create:()=> 'request'}:{}};
  vm.runInNewContext(fs.readFileSync('miniprogram/services/trade-service.js','utf8'),serviceContext);
  for(const reason of options.CANCELLED_REGRET_REASONS){const result=await serviceContext.module.exports.addReflection('cancelled','regret',reason.key,'request');assert(result.success);assert.equal(payloads[payloads.length-1].payload.regret_reason_label,reason.label);}
  const invalid=await serviceContext.module.exports.addReflection('cancelled','regret','unknown');assert(!invalid.success);assert.equal(payloads.length,options.CANCELLED_REGRET_REASONS.length);
  assert(payloads.every(x=>x.action==='addReflection' && !('execution_status' in x.payload)));
  const backendEvent=Object.assign({_openid:'owner',is_deleted:false},original),snapshots={},updates=[];
  const db={command:{},serverDate:()=>new Date(),collection(name){return {doc(id){return {get:async()=>({data:name==='trade_events'?backendEvent:snapshots[id]}),set:async({data})=>{snapshots[id]=Object.assign({_id:id},data);},update:async({data})=>{updates.push(data);Object.assign(backendEvent,data);}};}};}};
  db.runTransaction=callback=>callback(db);
  const backend={exports:{},console,require:name=>name==='wx-server-sdk'?{init(){},database:()=>db,getWXContext:()=>({OPENID:'owner'})}:name==='./asset-tracking'?require('../cloudfunctions/tradeData/asset-tracking'):require(name)};
  vm.runInNewContext(fs.readFileSync('cloudfunctions/tradeData/index.js','utf8'),backend);
  const request={action:'addReflection',payload:{client_request_id:'cancelled-review-1',trade_event_id:'cancelled',feeling:'regret',regret_reason:'missed_opportunity',regret_reason_label:'错过机会'}};
  const saved=await backend.exports.main(request);assert(saved.success);assert.equal(saved.data.snapshot.regret_reason_label,'错过机会');assert.equal(backendEvent.execution_status,'cancelled');assert.equal(backendEvent.reflection_count,1);
  const repeated=await backend.exports.main(request);assert(repeated.success);assert(repeated.data.duplicate);assert.equal(Object.keys(snapshots).length,1);assert.equal(updates.length,1,'retries do not create or count extra snapshots');
  assert(updates.every(patch=>!('execution_status' in patch) && !('executed_at' in patch)));
  const metrics=backend.buildPeriodSummary([{_id:'executed',plan_status:'planned'}],Object.values(snapshots),'week');assert.equal(metrics.eventCount,1);assert.equal(metrics.reviewedCount,0);assert.equal(metrics.regretCount,0);assert.equal(metrics.disciplineScore,100,'cancelled feelings cannot alter execution metrics');
  console.log('cancelled review: status preservation, contextual reasons, direct save, failure retry, multiple snapshots, overview links and pending guard passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
