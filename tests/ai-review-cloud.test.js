const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const model=require('../cloudfunctions/reviewAI/analysis');
const root=path.resolve(__dirname,'../cloudfunctions/reviewAI');
const rows={user_config:[{_id:'cfg',_openid:'owner',is_deleted:false,current_focus:{key:'delayed_reduce',label:'拖延减仓'}}],trade_events:Array.from({length:215},(_,i)=>({_id:'e'+String(i).padStart(3,'0'),_openid:'owner',is_deleted:false,execution_status:'executed',symbol:'TEST'+i,action:'add',executed_at:new Date('2026-10-01'),optional_note:'按预设条件分批处理仓位'})),reflection_snapshots:[],period_metrics:[],personal_rules:[]};
rows.trade_events.push({_id:'other',_openid:'someone',is_deleted:false,execution_status:'executed',optional_note:'别人的隐私'});
let failPage=false,reads=0,owner='owner',modelCalls=0,hold=null;
function collection(name){const list=rows[name]||(rows[name]=[]);let filter={},limit=100;return {
 where(v){filter=v;return this;},orderBy(){return this;},limit(n){limit=n;return this;},
 async get(){reads++;if(failPage&&filter._id)throw Error('OFFLINE');return {data:list.filter(r=>Object.entries(filter).every(([k,v])=>v&&v.gt!==undefined?r[k]>v.gt:r[k]===v)).sort((a,b)=>String(a._id).localeCompare(String(b._id))).slice(0,limit)};},
 doc(id){return {async get(){const data=list.find(r=>r._id===id);if(!data)throw Error('document not found');return {data};},async set({data}){assert(!('_id' in data),'immutable database id must never be included in replacement data');const index=list.findIndex(r=>r._id===id),next={_id:id,...data};if(index<0)list.push(next);else list[index]=next;},async update({data}){const r=list.find(r=>r._id===id);if(!r)throw Error('document not found');Object.assign(r,data);}};}
};}
const db={collection,command:{gt:v=>({gt:v}),set:v=>v}};let txTail=Promise.resolve();db.runTransaction=fn=>{const p=txTail.then(()=>fn(db));txTail=p.catch(()=>{});return p;};
function output(){return {findings:[{kind:'keep',topic:'分批执行',scope:'pattern',title:'按预设条件分批处理',summary:'你在不同记录里写明了分批处理的依据。',reminder:'下一次操作前，核对自己的预设条件。',actions:['add'],limitation:'不据此推断收益。',evidence:['e000','e001'].map(id=>({event_id:id,reflection_id:null,quote:rows.trade_events.find(e=>e._id===id).optional_note,role:'support'}))}]};}
const cloud={init(){},database:()=>db,getWXContext:()=>({OPENID:owner}),ai:()=>({createModel:name=>{assert.equal(name,'cloudbase');return {generateText:async input=>{modelCalls++;assert.equal(input.model,'deepseek-v4.1-flash');assert(!JSON.stringify(input).includes('别人的隐私'));if(hold)await hold;return {text:JSON.stringify(output()),usage:{total_tokens:123}};}};}})};
const sandbox={exports:{},console:{error(){}},require:n=>n==='wx-server-sdk'?cloud:n==='./analysis'?model:n==='./timeline'?require('../cloudfunctions/reviewAI/timeline'):require(n)};
vm.runInNewContext(fs.readFileSync(path.join(root,'index.js'),'utf8'),sandbox);
const call=(action,payload={})=>sandbox.exports.main({action,payload});
(async()=>{
 owner='';assert.equal((await call('read')).error,'AUTH_ERROR');owner='owner';
 let r=await call('read');assert(r.success);assert.equal(r.data.scope.total,215);assert(reads>=5,'all pages are scanned');assert.equal(r.data.has_snapshot,false);
 failPage=true;r=await call('read');assert.equal(r.success,false,'a failed later page cannot produce partial analysis');failPage=false;
 r=await call('timeline',{_openid:'someone',end_week:'2026-10-05'});assert(r.success);assert.equal(r.data.executed,215);assert.equal(modelCalls,0,'the timeline is deterministic and makes no model request');assert.equal(r.data.groups.buy.weeks.reduce((n,w)=>n+w.total,0),215);
 failPage=true;assert.equal((await call('timeline')).success,false,'timeline must reject failed later pages');failPage=false;
 r=await call('timelineDetail',{group:'buy',week:'2026-09-28'});assert(r.success);assert.equal(r.data.items.length,15);assert(r.data.has_more);assert.equal(r.data.total,215);assert(r.data.items.every(e=>e.id!=='other'));
 r=await call('generate',{_openid:'someone'});assert(r.success);assert.equal(modelCalls,2);assert.equal(rows.period_metrics.length,1);
 r=await call('read');assert(r.success);assert.equal(r.data.primary.length,1,'one reliable kind is enough; no forced negative finding');assert.equal(r.data.scope.total,215);const f=r.data.primary[0];
 await call('generate');assert.equal(modelCalls,2,'same data version reuses the model result');
 const oldVersion=r.data.reminder_version;
 let saved=await call('saveReminder',{text:'先核对原计划。',finding_id:f.id,request_id:'save-1',expected_version:oldVersion});assert(saved.success);assert.equal(saved.data.focus.kind,'review');assert.equal(rows.personal_rules.length,1);
 const id=saved.data.undo_id;r=await call('saveReminder',{text:'重复请求不能覆盖',finding_id:f.id,request_id:'save-1',expected_version:oldVersion});assert(r.success);assert(r.data.duplicate);assert.equal(rows.personal_rules.length,1);assert.equal(r.data.focus.text,'先核对原计划。');
 r=await call('saveReminder',{text:'冲突请求',request_id:'conflict',expected_version:oldVersion});assert.equal(r.error,'REMINDER_CHANGED');
 r=await call('undoReminder',{id});assert(r.success);assert.equal(r.data.focus.key,'delayed_reduce','undo restores the original structured legacy reminder');
 r=await call('undoReminder',{id});assert.equal(r.error,'REMINDER_CHANGED','late undo cannot overwrite a newer or already restored focus');
 const manual=await call('saveReminder',{text:'操作前核对自己的条件。',request_id:'manual-1',expected_version:oldVersion});assert(manual.success);assert.equal(manual.data.focus.actions.length,4,'manually written reminders remain usable before operations without another selection step');assert((await call('undoReminder',{id:manual.data.undo_id})).success);
 r=await call('feedback',{id:f.id,hidden:true});assert(r.success);r=await call('read');assert.equal(r.data.primary.length,0);assert.equal(r.data.hidden.length,1);await call('feedback',{id:f.id,hidden:false});
 r=await call('detail',{id:f.id});assert(r.success);assert.equal(r.data.items.length,2);
 const snapshot=rows.period_metrics[0],promptVersion=snapshot.prompt_version;snapshot.prompt_version='retired';assert.equal((await call('detail',{id:f.id})).error,'FINDING_OUTDATED','retired prompt snapshots cannot bypass the public page through evidence ids');snapshot.prompt_version=promptVersion;
 rows.trade_events[0].optional_note+='，条件仍成立';
 r=await call('read');assert(r.success);assert.equal(r.data.has_new_data,true);assert.equal(r.data.findings.length,0,'editing a source immediately removes its stale conclusion');
 let release;hold=new Promise(resolve=>{release=resolve;});const pending=call('generate');
 while(modelCalls<3)await new Promise(setImmediate);
 r=await call('generate');assert(r.success);assert(r.data.processing,'concurrent generations share a lease');assert.equal(modelCalls,3);
 release();hold=null;assert((await pending).success,'an existing snapshot can be replaced without sending immutable id');
 r=await call('read');assert.equal(r.data.has_new_data,false);assert.equal(r.data.findings.length,1);
 owner='someone';rows.user_config.push({_id:'cfg2',_openid:'someone',is_deleted:false});r=await call('detail',{id:f.id});assert.equal(r.error,'FINDING_OUTDATED','other accounts cannot access evidence ids');
 console.log('AI cloud: complete scans, failed pages, account isolation, cached generations, concurrent leases, immutable-id updates, reminder versioning/idempotency/undo and stale evidence passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
