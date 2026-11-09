var api = require('../utils/cloud-api');
var trade = require('./trade-service');
var date = require('../utils/date');
var asset = require('../utils/asset');
var entryTime = require('../utils/entry-time');
var cache = {};
var TTL = 30000;
var marketLabels = {US:'美股',HK:'港股',CN:'A股',OTHER:'其他市场',CUSTOM:'自定义标的'};
function marketLabel(market) { return marketLabels[market] || marketLabels.CUSTOM; }
var markets = Object.keys(marketLabels).map(function(key) { return {key:key,label:marketLabel(key)}; });
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
  event.attachment_count=typeof item.attachment_count==='number'?item.attachment_count:(item.attachments||[]).length;
  event.execution_status=item.execution_status || (item.stage==='before'?'pending':'executed');
  event.execution_label={executed:'已执行',pending:'待确认',cancelled:'未执行'}[event.execution_status];
  var at=item.stage === 'before' ? (item.recorded_at||item.created_at||item.occurred_at) : (item.occurred_at||item.recorded_at||item.created_at);
  event.history_date=item.occurred_at_precision === 'date'?entryTime.label(item,true):labelTime(at);
  event.history_year=at ? new Date(at).getFullYear()+'年'+(new Date(at).getMonth()+1)+'月' : '时间未记录';
  event.execution_date=item.occurred_at_precision === 'date'?entryTime.label(item,true):labelTime(item.executed_at||at);
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
function summary(item, listOnly) {
  if (!item) return null;
  var out=Object.assign({},item);
  out.market_label=marketLabel(item.market);
  out.first_label=item.first_at?date.formatDate(item.first_at):'时间未记录';
  out.latest=decorate(item.latest);
  if(!listOnly){out.last_executed=item.last_executed?decorate(item.last_executed):null;out.last=out.last_executed||out.latest;}
  return out;
}
function read(action,options) {
  options=Object.assign({compact:true},options);
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
    if(action==='listAssetSummaries') data.list=data.list.map(function(item){return summary(item,true);});
    else {data.summary=summary(data.summary);if(data.list)data.list=data.list.map(decorate);}
    return data;
  });
}
function chooseEntry(matches, symbol, offset) {
  offset = offset || 0;
  if (matches.length < 2) return Promise.resolve(matches[0] || null);
  var counts = {};
  matches.forEach(function(item) { counts[item.market] = (counts[item.market] || 0) + 1; });
  var types = {stock:'股票',etf:'ETF',option:'期权',other:'其他'};
  var remaining = matches.length - offset;
  var page = matches.slice(offset,offset+(remaining>6?5:6));
  var labels = page.map(function(item) {
    return marketLabel(item.market)+' · '+item.symbol+(counts[item.market]>1?' · '+(types[item.asset_type]||item.asset_type):'');
  });
  if (page.length < remaining) labels.push('更多标的');
  return new Promise(function(resolve,reject) {
    wx.showActionSheet({
      alertText:'选择「'+symbol+'」对应的标的',
      itemList:labels,
      success:function(result){resolve(page[result.tapIndex] || chooseEntry(matches,symbol,offset+page.length));},
      fail:function(error){reject(new Error(/cancel/i.test(error.errMsg || '')?'ASSET_CANCELLED':'ASSET_PICK_FAILED'));}
    });
  });
}
function resolveEntries(symbols, active) {
  var request = symbols.length === 1
    ? read('getAssetContext',{symbol:symbols[0],matchSymbol:symbols[0]}).then(function(result){return [result.matches];})
    : read('listAssetMatches',{symbols:symbols}).then(function(result){return result.matches;});
  return request.then(async function(matches) {
    var entries = [];
    for (var i=0;i<symbols.length;i++) {
      if (active && !active()) throw Error('ASSET_CANCELLED');
      entries.push(await chooseEntry(matches[i],symbols[i]));
    }
    return entries;
  });
}
function updateMarket(action, payload) {
  return api.call(action, Object.assign({compact:true},payload)).then(function(result) {
    if (!result.success) throw Error(result.error || 'ASSET_CHANGED');
    if (!result.data.conflict) {
      cache = {};
      getApp().invalidatePages(['today','records','review']);
    }
    return result.data;
  });
}
function open(key,fromRecord) {
  var pages=getCurrentPages();
  for(var i=pages.length-1;i>=0;i--) {
    if(pages[i].route==='pages/asset-history/index' && (pages[i].data.key===key || (pages[i].data.mergedSources||[]).some(function(source){return source.key===key;})) && !fromRecord) {wx.navigateBack({delta:pages.length-1-i});return;}
  }
  wx.navigateTo({url:'/pages/asset-history/index?key='+encodeURIComponent(key)+(fromRecord?'&fromRecord=1':'')});
}
module.exports={keyFor:keyFor,decorate:decorate,list:function(o){return read('listAssetSummaries',o);},history:function(o){return read('getAssetHistory',o);},context:function(o){return read('getAssetContext',o.key?o:Object.assign({},o,{matchSymbol:o.symbol}));},markets:markets,marketLabel:marketLabel,resolveEntries:resolveEntries,updateMarket:updateMarket,open:open,clearCache:function(){cache={};}};
