var api = require('../utils/cloud-api');
var trade = require('./trade-service');
var date = require('../utils/date');
var asset = require('../utils/asset');
var cache = {};
var TTL = 30000;
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function ordered(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  var result = {};
  Object.keys(value).sort().forEach(function(key) { result[key] = ordered(value[key]); });
  return result;
}
function keyFor(item) {
  var symbol=asset.normalizeSymbol(item.symbol);
  var market=item.market || asset.inferMarket(symbol);
  if (/[^A-Z0-9.\-]/.test(symbol) && item.market_source !== 'confirmed') market='CUSTOM';
  return JSON.stringify([market,item.asset_type||'stock',symbol]);
}
function labelTime(value) { return value ? date.formatDateTime(value) : '时间未记录'; }
function decorate(item) {
  var event=trade.decorateEvent(item);
  event.execution_status=item.execution_status || (item.stage==='before'?'pending':'executed');
  event.execution_label={executed:'已执行',pending:'待确认',cancelled:'未执行'}[event.execution_status];
  var at=item.stage === 'before' ? (item.recorded_at||item.created_at||item.occurred_at) : (item.occurred_at||item.recorded_at||item.created_at);
  event.history_date=labelTime(at);
  event.history_year=at ? new Date(at).getFullYear()+'年'+(new Date(at).getMonth()+1)+'月' : '时间未记录';
  event.execution_date=labelTime(item.executed_at||at);
  event.asset_key=keyFor(item);
  event.history_note=item.optional_note||'';
  var reviewed=Number(item.reflection_count || 0) > 0;
  var dueAt=item.review_due_at ? new Date(item.review_due_at).getTime() : 0;
  event.review_status=event.execution_status === 'pending' ? '' : reviewed ? 'reviewed' : event.execution_status === 'cancelled' ? '' : dueAt > 0 && dueAt <= Date.now() ? 'due' : 'waiting';
  event.review_label={reviewed:'已回看',due:'待回看',waiting:'尚未回看'}[event.review_status] || '';
  var feelingLabels={satisfied:'满意',acceptable:'可以接受',regret:'懊悔'};
  var legacyFeelings={'满意':'satisfied','可接受':'acceptable','可以接受':'acceptable','懊悔':'regret'};
  event.history_feeling_key=reviewed ? (feelingLabels[item.latest_feeling] ? item.latest_feeling : legacyFeelings[item.latest_feeling_label] || 'unknown') : '';
  event.history_feeling=reviewed ? (item.latest_feeling_label || feelingLabels[event.history_feeling_key] || '已回看') : event.review_label;
  event.history_review_time=item.latest_reflection_at ? date.formatDateTime(item.latest_reflection_at)+'回看' : '';
  return event;
}
function summary(item) {
  if (!item) return null;
  var out=Object.assign({},item);
  out.market_label={US:'美股',HK:'港股',CN:'A股',OTHER:'其他市场',CUSTOM:'自定义标的'}[item.market]||'自定义标的';
  out.first_label=item.first_at?date.formatDate(item.first_at):'时间未记录';
  out.latest=decorate(item.latest);
  out.last_executed=item.last_executed?decorate(item.last_executed):null;
  out.last=out.last_executed||out.latest;
  return out;
}
function read(action,options) {
  options=Object.assign({},options);
  var force = options.force === true;
  delete options.force;
  if(options.key){try { JSON.parse(options.key); } catch(e) { try { options.key=decodeURIComponent(options.key); } catch(ignored) {} }}
  var app = getApp();
  var revision = typeof app.getPageRevision === 'function' ? app.getPageRevision('records') : 0;
  var owner = app.globalData && app.globalData.openid || '';
  var key = JSON.stringify([owner,revision,action,ordered(options)]);
  var entry = cache[key];
  if (force || (entry && !entry.pending && Date.now() - entry.at >= TTL)) { delete cache[key]; entry = null; }
  if (!entry) {
    if (Object.keys(cache).length >= 64) cache = {};
    entry = { pending: true, at: Date.now() };
    cache[key] = entry;
    entry.promise = app.waitForLogin().then(function(){return api.call(action,options);}).then(function(res){
      if (!res.success) throw new Error(res.error||'LOAD_FAILED');
      entry.pending = false; entry.at = Date.now();
      return res;
    }).catch(function(error){if(cache[key]===entry)delete cache[key];throw error;});
  }
  return entry.promise.then(function(result){
    var res = clone(result);
    if (!res.success) throw new Error(res.error||'LOAD_FAILED');
    var data=res.data;
    if(action==='listAssetSummaries') data.list=data.list.map(summary);
    else {data.summary=summary(data.summary);if(data.list)data.list=data.list.map(decorate);}
    return data;
  });
}
function open(key,fromRecord) {
  var pages=getCurrentPages();
  for(var i=pages.length-1;i>=0;i--) {
    if(pages[i].route==='pages/asset-history/index' && (pages[i].data.key===key || (pages[i].data.mergedSources||[]).some(function(source){return source.key===key;})) && !fromRecord) {wx.navigateBack({delta:pages.length-1-i});return;}
  }
  wx.navigateTo({url:'/pages/asset-history/index?key='+encodeURIComponent(key)+(fromRecord?'&fromRecord=1':'')});
}
module.exports={keyFor:keyFor,decorate:decorate,list:function(o){return read('listAssetSummaries',o);},history:function(o){return read('getAssetHistory',o);},context:function(o){return read('getAssetContext',Object.assign({},o,{key:o.key||keyFor(o)}));},open:open,clearCache:function(){cache={};}};
