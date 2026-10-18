const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../cloudfunctions/tradeData');
const config={_id:'config',_openid:'owner',is_deleted:false};
const rows={user_config:[config],personal_rules:[],period_metrics:[],trade_events:Array.from({length:215},(_,i)=>({_id:'e'+String(i).padStart(3,'0'),_openid:'owner',is_deleted:false,execution_status:'executed',symbol:'TEST',action:'buy',reason_key:'follow_plan',reason_label:'符合原来计划',executed_at:new Date('2026-09-01T00:00:00Z')})),reflection_snapshots:Array.from({length:215},(_,i)=>({_id:'r'+String(i).padStart(3,'0'),_openid:'owner',is_deleted:false,trade_event_id:'e'+String(i).padStart(3,'0'),reviewed_at:new Date('2026-10-01T00:00:00Z'),feeling:'satisfied'}))};
rows.trade_events.push({_id:'z-other',_openid:'other',is_deleted:false,reason_key:'private'});rows.reflection_snapshots.push({_id:'z-ref-other',_openid:'other',is_deleted:false,trade_event_id:'e000',feeling:'regret',reviewed_at:new Date()});
let failRead=false,readPages=0;const queries=[];
function collection(name){let filter={},order=[],limit=100,skip=0,fields=null;const list=rows[name]||(rows[name]=[]);return {
 field(v){fields=v;return this;},where(v){filter=v;return this;},orderBy(k,d){order.push([k,d]);return this;},limit(n){limit=n;return this;},skip(n){skip=n;return this;},
 async get(){queries.push({name,filter,fields});if(name==='reflection_snapshots'){readPages++;if(failRead&&filter._id)throw Error('NETWORK_READ_FAILURE');}let values=list.filter(r=>Object.entries(filter).every(([k,v])=>v&&v.in? v.in.includes(r[k]):v&&v.gt!==undefined?r[k]>v.gt:v&&v.gte!==undefined?r[k]>=v.gte:r[k]===v));for(const [k,d]of order.reverse())values.sort((a,b)=>(a[k]>b[k]?1:a[k]<b[k]?-1:0)*(d==='desc'?-1:1));return {data:values.slice(skip,skip+limit).map(row=>fields?Object.fromEntries(Object.keys(fields).filter(k=>fields[k]&&k in row).map(k=>[k,row[k]])):row)};},
 doc(id){return {async get(){return {data:list.find(r=>r._id===id)};},async set({data}){let at=list.findIndex(r=>r._id===id);const next=Object.assign({_id:id},data);if(at<0)list.push(next);else list[at]=next;},async update({data}){Object.assign(list.find(r=>r._id===id),data);}};}
 };}
const db={collection,command:{in:v=>({in:v}),gt:v=>({gt:v}),gte:v=>({gte:v}),set:v=>v},serverDate:()=>new Date()};db.runTransaction=fn=>fn(db);
let owner='owner';const sandbox={exports:{},console:{error(){}},require:name=>name==='wx-server-sdk'?{init(){},database:()=>db,getWXContext:()=>({OPENID:owner})}:name.startsWith('./')?require(path.join(root,name)):require(name)};
vm.runInNewContext(fs.readFileSync(path.join(root,'index.js'),'utf8'),sandbox);
const call=(action,payload={})=>sandbox.exports.main({action,payload});
(async()=>{
 let r=await call('getBehaviorReview');assert(r.success);assert.equal(r.data.total,215);assert.equal(r.data.counts.satisfied,215);assert(readPages>=3);assert.equal(r.data.counts.regret,0,'another user cannot inject a reflection');
 r=await call('getBehaviorReview',{mode:'detail',reason_key:'private',_openid:'other'});assert(r.success);assert.equal(r.data.total,0);
 rows.trade_events.push({_id:'older',_openid:'owner',is_deleted:false,execution_status:'executed',symbol:'OLD',action:'buy',reason_key:'follow_plan',reason_label:'符合原来计划',plan_status:'planned',executed_at:new Date('2019-01-01T00:00:00Z')});
 rows.reflection_snapshots.push({_id:'r-older',_openid:'owner',is_deleted:false,trade_event_id:'older',feeling:'regret',reviewed_at:new Date('2026-10-01T00:00:00Z')});
 r=await call('getPeriodReview',{period_type:'all'});assert(r.success);assert.equal(r.data.periodId,'all');assert.equal(r.data.eventCount,216,'all review includes operations outside six-month history');assert.equal(r.data.reviewedCount,216);assert.equal(r.data.trend.reduce((n,p)=>n+p.eventCount,0),216);assert(r.data.periodLabel.includes('2019'));
 const bucket=r.data.periodSummaries.find(x=>x.plannedCount===1);
 r=await call('getPeriodDetail',{period_type:'all',period_id:bucket.periodId,metric:'regret'});assert(r.success);assert.equal(r.data.total,1);assert.equal(r.data.items[0]._id,'older','later reflections join the original historical bucket');
 let cursor=null,allIds=[];
 do {r=await call('getPeriodDetail',{period_type:'all',period_id:'all',metric:'reviewed',cursor,paginated:true});assert(r.success);allIds.push(...r.data.items.map(x=>x._id));cursor=r.data.hasMore?r.data.nextCursor:null;}while(cursor);
 r=await call('getPeriodDetail',{period_type:'all',period_id:'all',metric:'reviewed'});assert.equal(r.data.items.length,216,'old clients retain the complete response unless pagination is explicitly requested');assert(r.data.items[0].executed_at);assert(r.data.items[0].plan_label);
 assert.equal(allIds.length,216);assert.equal(new Set(allIds).size,216,'cumulative details paginate all records without duplicates');
 r=await call('getBehaviorReview',{mode:'comparison',reason_key:'follow_plan'});assert(r.success);assert.equal(r.data.items.length,2);assert(!r.data.items.some(x=>x._id==='z-other'),'comparison remains owner-isolated');
 failRead=true;r=await call('getBehaviorReview');assert.equal(r.success,false,'failed later page must never yield partial aggregate');failRead=false;
 r=await call('saveReviewReminder',{reason_key:'private',text:'bad',client_request_id:'attack'});assert.equal(r.success,false);assert.equal(rows.personal_rules.length,0);
 const payload={reason_key:'follow_plan',action:'buy',text:'先写清依据',client_request_id:'request1'};
 r=await call('saveReviewReminder',payload);assert(r.success);assert.equal(rows.personal_rules.length,1);assert.equal(config.review_reminder.text,'先写清依据');assert.equal(rows.personal_rules[0].source_event_ids.length,10);
 await call('saveReviewReminder',payload);assert.equal(rows.personal_rules.length,1,'retry is idempotent');const first=JSON.stringify(rows.personal_rules[0]);
 await call('saveReviewReminder',{...payload,text:'更新提醒',client_request_id:'request2'});assert.equal(rows.personal_rules.length,2);assert.equal(JSON.stringify(rows.personal_rules[0]),first,'editing keeps immutable previous version');assert.equal(config.review_reminder.text,'更新提醒');
 await call('saveReviewReminder',payload);assert.equal(config.review_reminder.text,'更新提醒','late duplicate cannot resurrect an old reminder');
 // Compact reads retain the exact counts without obsolete chart payloads or attachments.
 rows.trade_events.push({_id:'isolated',_openid:'owner',is_deleted:false,execution_status:'executed',symbol:'ONE',action:'buy',reason_key:'isolated',reason_label:'独立理由',executed_at:new Date('2026-09-01'),optional_note:'当时的完整备注',attachments:[{file_id:'private'}],ext:{large:'x'.repeat(50000)}});
 for(let i=0;i<121;i++)rows.reflection_snapshots.push({_id:'isolated-r'+String(i).padStart(3,'0'),_openid:'owner',is_deleted:false,trade_event_id:'isolated',created_at:new Date('2026-10-01'),reviewed_at:new Date('2026-10-01'),sequence_no:i,feeling:i===120?'regret':'acceptable',regret_reason_label:'卖早了',optional_note:'后来备注'+i,attachments:[{file_id:'private'}]});
 const full=await call('getBehaviorReview');const compact=await call('getBehaviorReview',{compact:true});assert(compact.success);assert.equal(compact.data.total,full.data.total);assert.equal(compact.data.reviewed,full.data.reviewed);assert.deepEqual(compact.data.reasons.map(x=>[x.key,x.distribution]),full.data.reasons.map(x=>[x.key,x.distribution]));assert(!('trend' in compact.data));assert(JSON.stringify(compact).length<JSON.stringify(full).length*.7);
 const q=queries.length;r=await call('getBehaviorReview',{compact:true,mode:'detail',reason_key:'isolated'});assert(r.success);assert.equal(r.data.total,1);assert.equal(r.data.items[0].reflection_count,121,'targeted reads retain every reflection page');assert.equal(r.data.items[0].latest_review_note,'后来备注120');assert.equal(r.data.items[0].latest_regret_reason,'卖早了');assert.equal(r.data.items[0].optional_note,'当时的完整备注');assert(!JSON.stringify(r).includes('private'));
 const targeted=queries.slice(q);assert(targeted.filter(x=>x.name==='trade_events').every(x=>x.filter.reason_key==='isolated'));assert(targeted.filter(x=>x.name==='reflection_snapshots').every(x=>x.filter.trade_event_id.in[0]==='isolated'));assert(targeted.every(x=>x.fields),'compact paths always project their required fields');assert(!targeted.some(x=>x.name==='user_config'),'simple review does not re-read unrelated user configuration');
 r=await call('getBehaviorReview',{compact:true,mode:'detail',reason_key:'private',_openid:'other'});assert.equal(r.data.total,0);
 failRead=true;r=await call('getBehaviorReview',{compact:true,mode:'detail',reason_key:'isolated'});assert.equal(r.success,false,'targeted reads reject a failed later reflection page');failRead=false;
 owner='';r=await call('getBehaviorReview');assert.equal(r.error,'AUTH_ERROR');
 console.log('Review cloud: >200-row scans, owner isolation, failed-page rejection, validated evidence, immutable reminder revisions and idempotent retries passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
