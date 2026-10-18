const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const tick=()=>new Promise(setImmediate);
let definition,dialogs=[],writes=[],invalidations=0;
const app={invalidatePages:()=>invalidations++};
vm.runInNewContext(fs.readFileSync('miniprogram/pages/reflection/index.js','utf8'),{Page:p=>definition=p,getApp:()=>app,wx:{showActionSheet:o=>dialogs.push(o)},require:n=>n.includes('trade-service')?{updatePlanStatus:(id,status)=>new Promise(resolve=>writes.push({id,status,resolve}))}:n.includes('toast')?{showError(){}}:{}});
const page=Object.assign({},definition,{data:JSON.parse(JSON.stringify(definition.data)),_alive:true,setData(p){Object.assign(this.data,p);}});
(async()=>{
 page.data.id='record';page.data.event={plan_status:'planned',plan_label:'按原计划',reason_key:'target_price',optional_note:'original',reflection_count:2};
 page.data.mode='review';page.correctPlanStatus();assert.equal(dialogs.length,0,'review flow adds no required classification question');
 page.data.mode='detail';page.correctPlanStatus();assert.equal(writes.length,0,'opening the choices never writes');dialogs.at(-1).success({tapIndex:0});assert.equal(writes.length,0,'unchanged choice never writes');
 page.correctPlanStatus();dialogs.at(-1).success({tapIndex:1});page.correctPlanStatus();assert.equal(writes.length,1,'saving guard prevents duplicate changes');assert.equal(writes[0].id,'record');assert.equal(writes[0].status,'impulsive');
 writes[0].resolve({success:false});await tick();assert.equal(page.data.event.plan_status,'planned');assert.equal(page.data.planSaving,false);assert.equal(invalidations,0);
 page.correctPlanStatus();dialogs.at(-1).success({tapIndex:2});writes[1].resolve({success:true});await tick();assert.equal(page.data.event.plan_status,'uncertain');assert.equal(page.data.event.reason_key,'target_price');assert.equal(page.data.event.optional_note,'original');assert.equal(page.data.event.reflection_count,2);assert.equal(invalidations,1,'only a successful correction refreshes related pages');
 console.log('Plan correction: optional detail-only choice, no-op, duplicate guard, failure/retry and preservation of original context passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
