var api = require('../utils/cloud-api');
var ids = require('../utils/request-id');
var workers = {}, listeners = {};
var PREFIX = 'batch_entry_v1:';
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function load(owner) {
  var saved = wx.getStorageSync(PREFIX + owner);
  var state=saved && saved.owner === owner && saved.version === 1 ? copy(saved) : {version:1,owner:owner,drafts:{},jobs:[]};
  state.drafts=state.drafts||{};
  if(state.draft){state.drafts[state.draft.stage||'after']=state.draft;delete state.draft;}
  ['before','after'].forEach(function(stage){
    var draft=wx.getStorageSync(PREFIX+owner+':draft:'+stage);
    if(draft!==undefined && draft!=='')state.drafts[stage]=draft;
    if(state.drafts[stage]&&state.drafts[stage].draftId&&state.jobs.some(function(job){return job.draftId===state.drafts[stage].draftId;}))state.drafts[stage]=null;
  });
  return state;
}
function emit(owner, state) { (listeners[owner] || []).slice().forEach(function (fn) { try{fn(copy(state));}catch(e){console.error('批量记录界面更新失败');} }); }
function persist(owner, state) { wx.setStorageSync(PREFIX + owner, state); emit(owner, state); }
function mutate(owner, fn) { var state = load(owner); fn(state); persist(owner, state); return state; }
function terminal(item) { return item.status === 'saved' || item.status === 'undone'; }
function enqueue(owner, entries, draftId) {
  if(!owner || !entries.length || entries.length>20)throw Error('INVALID_BATCH');
  var id=ids.create('batch');
  mutate(owner,function(state){
    var pending=state.jobs.reduce(function(n,j){return n+j.items.filter(function(i){return !terminal(i);}).length;},0);
    if(pending+entries.length>40)throw Error('QUEUE_FULL');
    // Limit retained completed receipts, never pending work or the current draft.
    while(state.jobs.length>=20){var at=state.jobs.findIndex(function(j){return j.items.every(terminal);});if(at<0)throw Error('QUEUE_FULL');state.jobs.splice(at,1);}
    state.jobs.push({id:id,draftId:draftId||'',createdAt:Date.now(),cancelRequested:false,items:entries.map(function(payload){return {id:payload.client_request_id,payload:copy(payload),status:'pending',event:null,error:''};})});
    state.drafts[entries[0].stage||'after']=null;
  });
  pump(owner);return id;
}
function update(owner, jobId, patch) { return mutate(owner,function(state){var job=state.jobs.find(function(j){return j.id===jobId;});if(job)patch(job);}); }
function invalidate(owner) {
  var app=getApp();
  if(app.globalData.openid===owner)app.invalidatePages(['today', 'records', 'review']);
}
function syncRecent(owner, records) {
  var app=getApp(),config=app.globalData.userConfig;
  if(app.globalData.openid!==owner || !config)return;
  records.slice().reverse().forEach(function(item){
    if(!item.symbol)return;
    config.recent_symbols=[item.symbol].concat((config.recent_symbols||[]).filter(function(symbol){return symbol!==item.symbol;})).slice(0,8);
    config.recent_assets=[{symbol:item.symbol,market:item.market,market_source:item.market_source,asset_type:item.asset_type}].concat((config.recent_assets||[]).filter(function(asset){return asset.symbol!==item.symbol;})).slice(0,8);
  });
}
async function pump(owner) {
  if(workers[owner])return;
  workers[owner]=true;
  try {
    while(getApp().globalData.openid===owner) {
      var state=load(owner), job=state.jobs.find(function(j){return j.items.some(function(i){return j.cancelRequested ? i.status!=='undone' && i.status!=='cancel_failed' : i.status==='pending';});});
      if(!job)break;
      var cancel=job.cancelRequested;
      var items=job.items.filter(function(i){return cancel ? i.status!=='undone'&&i.status!=='cancel_failed' : i.status==='pending';}).slice(0,3);
      var selected=items.map(function(i){return i.id;});
      update(owner,job.id,function(j){j.items.forEach(function(i){if(selected.indexOf(i.id)>=0)i.status=cancel?'cancelling':'saving';});});
      var result=await api.call(cancel?'undoBatchEntries':'createBatchEntries',{items:items.map(function(i){return cancel?{client_request_id:i.id}:i.payload;})});
      update(owner,job.id,function(j){
        items.forEach(function(original){
          var item=j.items.find(function(i){return i.id===original.id;});
          var response=result.success && result.data && (result.data.items||[]).find(function(r){return r.requestId===item.id;});
          if(response && response.success){item.status=cancel||response.data.cancelled?'undone':'saved';item.event=cancel?null:response.data;item.error='';}
          else {item.error=response&&response.error||result.error||'RETRY_REQUIRED';item.status=cancel?'cancel_failed':!response||item.error==='RETRY_REQUIRED'?'unknown':'failed';}
        });
      });
      if(!cancel && result.success && result.data)syncRecent(owner,(result.data.items||[]).filter(function(item){return item.success&&item.data&&!item.data.cancelled;}).map(function(item){return item.data;}));
      invalidate(owner);
    }
  } catch(error) {
    // Persisted in-flight records remain immutable and can be safely resumed.
    var recovery=load(owner);recovery.storageError='本机暂未能更新保存状态，确认结果前请保留记录并重试。';emit(owner,recovery);
  } finally { workers[owner]=false; }
}
function resume(owner) {
  if(!owner || workers[owner])return;
  mutate(owner,function(state){state.jobs.forEach(function(job){job.items.forEach(function(item){if(item.status==='saving'||item.status==='unknown')item.status='pending';if(item.status==='cancelling')item.status='saved';});});});
  pump(owner);
}
function retry(owner) {
  mutate(owner,function(state){state.jobs.forEach(function(job){job.items.forEach(function(item){if(item.status==='failed'||item.status==='unknown'||(!workers[owner]&&item.status==='saving'))item.status='pending';if(item.status==='cancel_failed'||(!workers[owner]&&item.status==='cancelling'))item.status='saved';});});});
  pump(owner);
}
function undo(owner,id) { update(owner,id,function(job){job.cancelRequested=true;job.items.forEach(function(item){if(item.status==='cancel_failed')item.status='saved';});});pump(owner); }
function subscribe(owner,fn) { (listeners[owner]||(listeners[owner]=[])).push(fn);return function(){listeners[owner]=(listeners[owner]||[]).filter(function(v){return v!==fn;});}; }
module.exports={load:load,enqueue:enqueue,resume:resume,retry:retry,undo:undo,subscribe:subscribe,
  saveDraft:function(owner,draft){wx.setStorageSync(PREFIX+owner+':draft:'+(draft.stage||'after'),copy(draft));},
  clearDraft:function(owner,stage){wx.setStorageSync(PREFIX+owner+':draft:'+(stage||'after'),null);},_pump:pump};
