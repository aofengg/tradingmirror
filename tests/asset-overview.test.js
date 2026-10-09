const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const chart=require('../miniprogram/utils/asset-overview');
const stamp=day=>Date.UTC(2026,8,day,12);
const events=[
 {_id:'add',action:'add',action_label:'加仓',execution_status:'executed',occurred_at:stamp(18)},
 {_id:'reduce',action:'reduce',action_label:'减仓',stage:'before',execution_status:'executed',created_at:stamp(24),executed_at:stamp(25)},
 {_id:'pending',action:'buy',execution_status:'pending',recorded_at:stamp(27)},
 {_id:'cancelled',action:'buy',execution_status:'cancelled',recorded_at:stamp(16)},
 {_id:'deleted',is_deleted:true,occurred_at:stamp(29)}
];
const reviews=[
 {_id:'r1',trade_event_id:'add',feeling:'satisfied',reviewed_at:stamp(22)},
 {_id:'r2',trade_event_id:'reduce',feeling:'regret',reviewed_at:stamp(26)},
 {_id:'r3',trade_event_id:'reduce',feeling:'acceptable',reviewed_at:stamp(28)},
 {_id:'r4',trade_event_id:'pending',feeling:'regret',reviewed_at:stamp(29)},
 {_id:'r5',trade_event_id:'deleted',feeling:'regret',reviewed_at:stamp(29)},
 {_id:'r6',trade_event_id:'add',is_deleted:true,reviewed_at:stamp(30)}
];
const rows=chart.build(events,reviews);
assert.deepStrictEqual(rows.map(x=>x.id),['reflection:r3','event:pending','reflection:r2','event:reduce','reflection:r1','event:add','event:cancelled']);
assert.strictEqual(rows[0].feeling,'acceptable');assert(rows[0].note.includes('第2次回看'));
assert.strictEqual(rows[3].time,stamp(25),'confirmed decisions use actual execution time');
const limited=chart.layout(rows,3);assert.strictEqual(limited.links.length,0,'never draw links to an off-screen or wrong operation');assert(limited.hasMore);
const full=chart.layout(rows,10);assert.strictEqual(full.links.length,3);assert(!full.hasMore);assert(full.links.every(link=>!link.cancelled),'executed operations keep solid links');
assert.strictEqual(full.links.find(x=>x.id==='reflection:r3').height,full.rows[3].top-full.rows[0].top);
assert.strictEqual(full.links.find(x=>x.id==='reflection:r2').height,full.rows[3].top-full.rows[2].top);
assert.strictEqual(full.links.find(x=>x.id==='reflection:r1').height,full.rows[5].top-full.rows[4].top);
const cancelled=chart.build(events,[{_id:'c1',trade_event_id:'cancelled',feeling:'regret',reviewed_at:stamp(28)}]);
assert.strictEqual(cancelled.filter(x=>x.kind==='feeling').length,1);
const cancelledLayout=chart.layout(cancelled,10);assert.strictEqual(cancelledLayout.links.length,1);assert(cancelledLayout.rows[0].caption.includes('未执行'));assert.strictEqual(cancelledLayout.links[0].cancelled,true,'link appearance follows the original decision status');
const reverseCancelled=chart.layout(chart.build([{_id:'c',execution_status:'cancelled',created_at:stamp(28)}],[{_id:'r',trade_event_id:'c',feeling:'regret',reviewed_at:stamp(27)}]),10);
assert(reverseCancelled.links[0].reverse);assert(reverseCancelled.links[0].cancelled,'reverse chronological links preserve the cancelled style');
const legacy=chart.build([{_id:'x',action:'buy',execution_status:'executed',created_at:stamp(1)}],[{_id:'legacy',trade_event_id:'x',feeling_label:'可接受',created_at:stamp(2)}]);
assert.strictEqual(legacy[0].feeling,'acceptable');assert.strictEqual(legacy[0].time,stamp(2));
const tied=chart.build([{_id:'x',created_at:stamp(1)}],[{_id:'b',trade_event_id:'x',created_at:stamp(2)},{_id:'a',trade_event_id:'x',created_at:stamp(2)}]);
assert.deepStrictEqual(tied.map(x=>x.id),['reflection:a','reflection:b','event:x']);
assert.strictEqual(chart.build([{_id:'x',created_at:'invalid'}],[])[0].date,'时间未记录');
function loadService(deps){const context={module:{exports:{}},require:name=>deps[name]};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/services/asset-overview-service.js'),'utf8'),context);return context.module.exports;}
(async()=>{
 const calls=[],historyCalls=[];
 const all=Array.from({length:51},(_,i)=>({_id:'e'+String(i).padStart(2,'0')}));
 const snapshots=Array.from({length:45},(_,i)=>({_id:'r'+String(i).padStart(3,'0'),trade_event_id:'e50',created_at:stamp(28)}));
 const service=loadService({
 './asset-service':{history:async options=>{historyCalls.push(options);const offset=options.cursor?50:0;return {list:all.slice(offset,offset+50),hasMore:offset===0,nextCursor:{id:'e49',time:1}};}},
 '../utils/db':{getCommand:()=>({in:ids=>({ids}),gt:id=>({after:id})})},
 '../repository/reflections-repo':{getList:async options=>{calls.push(options);const eligible=snapshots.filter(x=>options.where.trade_event_id.ids.includes(x.trade_event_id)&&(!options.where._id||x._id>options.where._id.after));return {success:true,data:{list:eligible.slice(0,20),hasMore:eligible.length>=20}};}}
 });
 const result=await service.load('key');assert.strictEqual(result.events.length,51);assert.strictEqual(result.reflections.length,45,'multiple snapshot pages with identical timestamps must all survive');
 assert.strictEqual(historyCalls.length,2);assert(calls.every(x=>x.orderBy==='_id'&&x.pageSize===20));assert.strictEqual(calls.length,5);assert(calls.every(x=>x.fields.regret_reason_label&&x.fields.optional_note&&!x.fields.attachments),'read review text without image metadata');
 assert.strictEqual(await service.load('key',()=>false),null);
 const fail=loadService({'./asset-service':{history:async()=>({list:[{_id:'e'}],hasMore:false})},'../utils/db':{getCommand:()=>({in:x=>x})},'../repository/reflections-repo':{getList:async()=>({success:false,error:'offline'})}});
 await assert.rejects(fail.load('key'),/offline/,'must not display partial reflections as complete');
 let definition,requests=[];
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/components/asset-overview/index.js'),'utf8'),{Component:x=>definition=x,require:name=>name.includes('service')?{load:(key,current)=>new Promise((resolve,reject)=>requests.push({key,current,resolve,reject}))}:chart});
 const component=Object.assign({data:{assetKey:'A',collapsed:false},setData(patch){Object.assign(this.data,patch);},triggerEvent(type,data){this.opened=data;}},definition.methods);
 definition.lifetimes.attached.call(component);component.data.assetKey='B';component.refresh();assert(!requests[0].current());
 requests[0].resolve({events,reviews:[]});requests[1].resolve({events,reflections:reviews});await new Promise(setImmediate);
 assert.strictEqual(component.data.rows.length,6);component.more();assert.strictEqual(component.data.rows.length,7);assert(!component.data.hasMore);
 component.toggle();assert(component.data.collapsed);component.open({currentTarget:{dataset:{id:'reduce'}}});assert.strictEqual(component.opened.id,'reduce');
 component.toggle();component.refresh();requests[2].reject(Error('offline'));await new Promise(setImmediate);assert(component.data.failed);
 component.refresh();definition.lifetimes.detached.call(component);requests[3].resolve({events:[],reflections:[]});await new Promise(setImmediate);assert.strictEqual(component.data.rows.length,7,'detached responses cannot update chart');
 console.log('asset overview: reverse chronology, execution timestamps, multiple reflections, identity links, expansion, full keyset reads, cancellation and retry passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
