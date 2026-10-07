const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
let componentDefinition;
const calls=[];
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/components/asset-context/index.js'),'utf8'),{
 Component:value=>{componentDefinition=value;},require:()=>({context:options=>new Promise((resolve,reject)=>calls.push({options,resolve,reject})),open(){}}),setTimeout,clearTimeout
});
const component=Object.assign({data:{symbol:'A',assetKey:''},setData(patch){Object.assign(this.data,patch);},triggerEvent(name,value){this.resolved=value;},_alive:true,_version:0},componentDefinition.methods);
(async()=>{
 component.refresh();component.data.symbol='B';component.refresh();
 calls[0].resolve({summary:{symbol:'A'},key:'A'});await tick();assert.notStrictEqual(component.data.summary&&component.data.summary.symbol,'A');
 calls[1].resolve({summary:{symbol:'B'},key:'B'});await tick();assert.strictEqual(component.data.summary.symbol,'B');assert.strictEqual(component.resolved.symbol,'B');
 component.refresh();calls[2].reject(new Error('offline'));await tick();assert.strictEqual(component.data.failed,true);assert.strictEqual(component.data.loading,false);
 component.refresh();component._alive=false;calls[3].resolve({summary:{symbol:'C'},key:'C'});await tick();assert.strictEqual(component.data.summary.symbol,'B');
 let definition,modal,savedDraft,creation,navigation;
 const storage={trade_record_draft:{symbol:'AAPL',stage:'before',step:3,action:'buy'}};
 const routes=[{route:'pages/asset-history/index'},{route:'pages/record/index'}];
 const wx={getStorageSync:key=>storage[key],setStorageSync:(key,value)=>{storage[key]=value;savedDraft=value;},removeStorageSync:key=>delete storage[key],showModal:value=>{modal=value;},navigateBack:()=>{navigation='back';}};
 const trade={createTradeEvent:data=>{creation=data;return Promise.resolve({success:true,data:{_id:'new',plan_status:'planned'}});},labels:{plans:{planned:'按原计划'}}};
 const options={ACTIONS:[{key:'buy',label:'买入'}],findOption:(list,key)=>list.find(x=>x.key===key),getReasons:()=>[{key:'target',label:'价格到了目标'}]};
 const app={waitForLogin:()=>Promise.resolve(),invalidatePages(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/pages/record/index.js'),'utf8'),{
 Page:value=>{definition=value;},wx,getCurrentPages:()=>routes,getApp:()=>app,console,
 require:name=>name.includes('trade-options')?options:name.includes('trade-service')?trade:name.includes('user-service')?{getConfig:()=>Promise.resolve({success:false}),hasGuideStep:()=>false}:name.includes('constants')?{STORAGE_KEYS:{RECORD_DRAFT:'trade_record_draft'}}:name.includes('share')?{enable(){}}:name.includes('request-id')?{create:()=> 'request'}:{}
 });
 const page=Object.assign({},definition,{data:JSON.parse(JSON.stringify(definition.data)),setData(patch){Object.assign(this.data,patch);}});
 const key='["US","stock","NVDA"]';page.onLoad({stage:'after',assetKey:encodeURIComponent(key),fromAsset:'1'});assert(modal);assert.strictEqual(storage.trade_record_draft.symbol,'AAPL','incoming stock cannot overwrite draft before choice');
 modal.success({confirm:true});assert.strictEqual(page.data.symbol,'AAPL');assert.strictEqual(page.data.step,3);assert.strictEqual(page.data.stage,'before');
 page._prefillAsset(encodeURIComponent(key),'after');modal.success({cancel:true});assert.strictEqual(page.data.assetKey,key,'encoded route must become canonical context identity');
 storage.trade_record_draft={symbol:'RKLB',stage:'after',step:2,action:''};page._restoreDraft('after');assert.strictEqual(page.data.step,2,'restore the action step before an action has been selected');
 page.data.symbol='NEW';page.onAssetResolved({detail:{symbol:'OLD',key:'stale'}});assert.notStrictEqual(page.data.resolvedAssetKey,'stale');
 page.data.symbol='NVDA';page.data.resolvedAssetKey=key;page.chooseAction({currentTarget:{dataset:{action:'buy'}}});page.chooseReason({currentTarget:{dataset:{reason:'target'}}});await tick();await tick();assert.strictEqual(creation.symbol,'NVDA');assert.strictEqual(creation.market,'US');assert.strictEqual(page.data.completed,true);assert(!storage.trade_record_draft);
 console.log('asset interactions: stale responses, failure state, detached requests, draft preservation and canonical identity submission passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
