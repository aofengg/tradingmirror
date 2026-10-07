// Pure projections of the user's original records. No holdings are inferred.
function normalize(value) { return String(value || '').trim().toUpperCase().slice(0, 20); }
function identity(event) {
  var symbol = normalize(event.symbol);
  var market = event.market || (/\.HK$|^\d{5}$/.test(symbol) ? 'HK' : /\.(SH|SS|SZ)$|^\d{6}$/.test(symbol) ? 'CN' : 'US');
  // Free-form names were historically inferred as US. Keep that uncertainty explicit.
  if (/[^A-Z0-9.\-]/.test(symbol) && event.market_source !== 'confirmed') market = 'CUSTOM';
  return JSON.stringify([market, event.asset_type || 'stock', symbol]);
}
function parse(key) { try { var a = JSON.parse(key); if (Array.isArray(a) && a.length === 3 && a.every(function (v) { return typeof v === 'string' && v.length > 0 && v.length <= 30; })) return { market: a[0], asset_type: a[1], symbol: a[2] }; } catch (e) {} return null; }
function resolve(key, links) {
  var seen = {};
  while (links[key] && !seen[key]) { seen[key] = true; key = links[key]; }
  return key;
}
function time(value) { var n = value ? new Date(value).getTime() : 0; return isFinite(n) ? n : 0; }
function occurred(event) {
  // Earlier versions overwrite occurred_at when an intention is confirmed.
  // recorded_at preserves when that decision was originally left behind.
  if (event.stage === 'before') return time(event.recorded_at) || time(event.created_at) || time(event.occurred_at);
  return time(event.occurred_at) || time(event.recorded_at) || time(event.created_at);
}
function executed(event) { return time(event.executed_at) || occurred(event); }
function status(event) { return event.execution_status || (event.stage === 'before' ? 'pending' : 'executed'); }
function due(event, now) { return status(event) === 'executed' && !Number(event.reflection_count || 0) && time(event.review_due_at) > 0 && time(event.review_due_at) <= now; }
function compare(a, b, field) { var delta = (field || occurred)(a) - (field || occurred)(b); return delta || String(a._id).localeCompare(String(b._id)); }
function build(events, links, now) {
  links = links || {}; now = now || Date.now();
  var groups = {};
  events.filter(function (e) { return !e.is_deleted; }).forEach(function (e) {
    var key = resolve(identity(e), links);
    var group = groups[key] || (groups[key] = { key: key, events: [], aliases: [] });
    group.events.push(e);
    if (group.aliases.indexOf(e.symbol) < 0) group.aliases.push(e.symbol);
  });
  Object.keys(groups).forEach(function (key) {
    var g = groups[key]; var asset = parse(key);
    g.events.sort(function (a,b) { return -compare(a,b); });
    var done = g.events.filter(function (e) { return status(e) === 'executed'; }).sort(function(a,b) { return -compare(a,b,executed); });
    g.summary = Object.assign({}, asset, { key: key, aliases: g.aliases, count: g.events.length, executed_count: done.length,
      pending_count: g.events.filter(function(e){return status(e)==='pending';}).length,
      review_count: g.events.filter(function(e){return due(e,now);}).length,
      first_at: occurred(g.events[g.events.length-1]), last_at: occurred(g.events[0]), last_id: g.events[0]._id,
      latest: g.events[0], last_executed: done[0] || null });
  });
  return groups;
}
function page(items, options, getTime, getId) {
  var asc = options.direction === 'asc'; var cursor = options.cursor;
  items = items.slice().sort(function(a,b) { var d = getTime(a)-getTime(b) || String(getId(a)).localeCompare(String(getId(b))); return asc ? d : -d; });
  if (cursor && typeof cursor.time === 'number' && typeof cursor.id === 'string') items = items.filter(function(item) {
    var d = getTime(item)-cursor.time || String(getId(item)).localeCompare(cursor.id); return asc ? d > 0 : d < 0;
  });
  var limit = Math.max(1,Math.min(50,Number(options.limit)||20));
  var list = items.slice(0,limit); var last = list[list.length-1];
  return { list:list, hasMore:items.length>limit, nextCursor:last ? {time:getTime(last),id:getId(last)} : null };
}
function read(events, links, action, options, now) {
  var groups = build(events,links,now); var key = resolve(options.key || identity(options),links || {}); var group = groups[key];
  if (action === 'listAssetSummaries') {
    var query = normalize(options.query);
    var summaries = Object.keys(groups).map(function(k){return groups[k].summary;}).filter(function(s) {
      return (!options.todoOnly || s.pending_count+s.review_count>0) && (!query || normalize([s.symbol].concat(s.aliases).join(' ')).indexOf(query)>=0 || s.aliases.some(function(a){return normalize(a).indexOf(query)>=0;}));
    });
    var result=page(summaries,options,function(s){return s.last_at;},function(s){return s.key;}); result.count=summaries.length; return result;
  }
  if (action === 'getAssetContext') return { summary:group ? group.summary : null, key:key };
  var items = group ? group.events : [];
  if (options.status === 'review') items=items.filter(function(e){return due(e,now);});
  else if (['executed','pending','cancelled'].indexOf(options.status)>=0) items=items.filter(function(e){return status(e)===options.status;});
  var history=page(items,options,occurred,function(e){return e._id;});
  history.summary=group ? group.summary : null; history.key=key; return history;
}
function merge(links, source, target, existing) {
  var a=parse(source), b=parse(target); var next=Object.assign({},links);
  if (!a || !b || source===target || !existing[source] || !existing[target]) throw new Error('INVALID_ASSET');
  if (a.asset_type!==b.asset_type || (a.market!=='CUSTOM' && b.market!=='CUSTOM' && a.market!==b.market)) throw new Error('MARKET_MISMATCH');
  if (resolve(source,next)!==source || resolve(target,next)!==target) throw new Error('ASSET_CHANGED');
  next[source]=target;
  return next;
}
module.exports={identity:identity,parse:parse,resolve:resolve,time:time,occurred:occurred,executed:executed,status:status,due:due,build:build,page:page,read:read,merge:merge};
