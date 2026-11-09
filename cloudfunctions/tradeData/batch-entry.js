// Batch-only writes. Existing single-entry APIs retain their original behavior.
const crypto = require('crypto');
const dates = require('./entry-time');
const assetTracking = require('./asset-tracking');
const ACTIONS = {buy:'买入',add:'加仓',reduce:'减仓',exit:'清仓'};
const REASONS = {
  follow_plan:['符合原来计划','planned','buy'],stronger_thesis:['逻辑更确定了','planned','buy'],target_price:['价格到了目标','planned','buy'],
  fear_missing:['怕错过机会','impulsive','buy'],average_down:['跌了想补仓','uncertain','buy'],sudden_opportunity:['临时看到机会','impulsive','buy'],
  target_reached:['达到预设目标','planned','sell'],thesis_changed:['持仓逻辑变了','planned','sell'],risk_control:['触发风险控制','planned','sell'],
  fear_giveback:['担心利润回吐','impulsive','sell'],cannot_stand_volatility:['忍不住波动','impulsive','sell'],switch_symbol:['想换另一只','impulsive','sell']
};
const hash = value => crypto.createHash('sha256').update(value).digest('hex').slice(0,32);
const SERVICE_OWNER = '__batch_entry_service__';
// Technical receipts contain no actual account identity, stock, note, or clock.
// The document ID binds the authenticated owner and a random request nonce.
function receiptData(eventId,fingerprint,status){return {_openid:SERVICE_OWNER,event_id:eventId,fingerprint,status,receipt_version:2};}
const ok = data => ({success:true,data,error:null});
const fail = error => ({success:false,data:null,error});
function normalize(payload, now, assets) {
  if(!payload || !['before','after'].includes(payload.stage))throw Error('VALIDATION_ERROR');
  const symbol = String(payload.symbol || '').trim().toUpperCase();
  const id = payload.client_request_id, action = payload.action, reason = REASONS[payload.reason_key];
  if (!symbol || symbol.length>20 || /[\r\n\u0000]/.test(symbol) || typeof id!=='string' || !/^[A-Za-z0-9_-]{8,80}$/.test(id) || !ACTIONS[action] || !reason || reason[2]!==(['buy','add'].includes(action)?'buy':'sell')) throw Error('VALIDATION_ERROR');
  const stage = payload.stage === 'before' ? 'before' : 'after';
  const clock = payload.occurred_at_precision === 'date' ? '' : String(payload.occurred_time || '');
  let when = dates.build(payload.occurred_date, clock, false, now);
  if(payload.time_mode==='now') {
    const at=dates.time(payload.occurred_at);
    if(!at || at>now+120000 || dates.day(at)!==payload.occurred_date)throw Error('INVALID_DATE');
    when=Object.assign({},when,{occurred_at:new Date(at).toISOString(),occurred_at_precision:'datetime',entry_source:'at_time'});
  }
  if(stage==='before' && payload.time_mode!=='now')throw Error('INVALID_DATE');
  const known = payload.market_source==='existing' && (assets||[]).some(a=>a.symbol===symbol&&a.market===payload.market&&(a.asset_type||'stock')===(payload.asset_type||'stock')&&(a.market_source==='confirmed'||a.market==='CUSTOM'||!/[^A-Z0-9.\-]/.test(symbol)));
  let market = known ? payload.market : /[^A-Z0-9.\-]/.test(symbol) ? 'CUSTOM' : /\.HK$|^\d{5}$/.test(symbol) ? 'HK' : /\.(SH|SZ|SS)$|^\d{6}$/.test(symbol) ? 'CN' : /\.(L|PA|DE|TO)$/.test(symbol) ? 'OTHER' : 'US';
  return Object.assign({symbol,action,reason_key:payload.reason_key,action_label:ACTIONS[action],reason_label:reason[0],plan_status:reason[1],
    stage,execution_status:stage==='before'?'pending':'executed',market,market_source:known?'confirmed':market==='CUSTOM'?'unconfirmed':'inferred',
    asset_type:known && ['stock','etf','option','other'].includes(payload.asset_type)?payload.asset_type:'stock',
    client_request_id:id,optional_note:String(payload.optional_note || '').trim().slice(0,500)},when);
}
module.exports = function createBatchAPI(db, configId, assetLinks = () => ({})) {
  async function get(ref) {
    try { return (await ref.get()).data || null; }
    catch(error) {
      if (/document.*(?:not exist|does not exist)|DOCUMENT_NOT_FOUND/i.test(String(error.errMsg||error.message||''))) return null;
      throw error;
    }
  }
  async function create(owner, payload, assets) {
    const now=Date.now(), value=normalize(payload,now,assets), identity=hash(owner+':'+value.client_request_id);
    const eventId='batch_event_'+identity, receiptId='batch_request_'+identity;
    // Fingerprint original client intent, not the server's fresh clock on retry.
    const fields=[value.symbol,value.action,value.reason_key,value.stage,payload.occurred_date,payload.occurred_at,payload.occurred_time||'',payload.time_mode||'',value.optional_note];
    if (payload.asset_key) fields.push(payload.asset_key);
    const intent=JSON.stringify(fields);
    const fingerprint=hash(owner+':'+value.client_request_id+':'+intent),legacyFingerprint=hash(intent);
    return db.runTransaction(async tx=>{
      const receiptRef=tx.collection('entry_requests').doc(receiptId), eventRef=tx.collection('trade_events').doc(eventId);
      const receipt=await get(receiptRef);
      if(receipt) {
        if((receipt._openid!==SERVICE_OWNER&&receipt._openid!==owner) || receipt.event_id!==eventId)return fail('AUTH_ERROR');
        if(receipt.status==='undone'){if(receipt.receipt_version!==2)await receiptRef.set({data:receiptData(eventId,hash(owner+':'+value.client_request_id+':undone'),'undone')});return ok({cancelled:true,id:eventId});}
        if(receipt.fingerprint!==fingerprint && !(receipt._openid===owner&&receipt.fingerprint===legacyFingerprint))return fail('REQUEST_CONFLICT');
        const existing=await get(eventRef);
        if(existing&&existing._openid!==owner)return fail('AUTH_ERROR');
        if(receipt.receipt_version!==2)await receiptRef.set({data:receiptData(eventId,fingerprint,existing?'saved':'undone')});
        return existing?ok(existing):ok({cancelled:true,id:eventId});
      }
      const existingEvent=await get(eventRef);
      if(existingEvent){
        if(existingEvent._openid!==owner)return fail('AUTH_ERROR');
        // A missing technical receipt must never reset an existing original.
        await receiptRef.set({data:receiptData(eventId,fingerprint,'saved')});
        return ok(existingEvent);
      }
      if (payload.asset_key) {
        const config = await get(tx.collection('user_config').doc(configId(owner)));
        const selected = assetTracking.entryIdentity(payload.asset_key, value.symbol, config && config._openid === owner ? assetLinks(config) : {});
        if (!selected) return fail('INVALID_ASSET');
        Object.assign(value, selected);
      }
      const at=new Date(value.occurred_at), b=dates.bounds(value);
      const record=Object.assign({},value,{schema_version:2,option_set_version:1,occurred_at:at,executed_at:value.stage==='after'?at:null,
        review_due_at:value.stage==='after'?new Date(b.end+18*3600000):null,recorded_at:db.serverDate(),created_at:db.serverDate(),updated_at:db.serverDate(),
        attachments:[],rule_refs:[],reflection_count:0,reflection_request_ids:[],latest_feeling:'',latest_feeling_label:'',latest_reflection_at:null,is_deleted:false,deleted_at:null,ext:{}});
      await receiptRef.set({data:receiptData(eventId,fingerprint,'saved')});
      await eventRef.set({data:Object.assign({_openid:owner},record)});
      return ok(Object.assign({_id:eventId},record,{recorded_at:new Date(now),created_at:new Date(now),updated_at:new Date(now)}));
    });
  }
  async function undo(owner, id) {
    if(typeof id!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(id))return fail('VALIDATION_ERROR');
    const identity=hash(owner+':'+id);
    return db.runTransaction(async tx=>{
      const ref=tx.collection('entry_requests').doc('batch_request_'+identity), receipt=await get(ref);
      // A cancellation arriving before create leaves a minimal tombstone.
      if(!receipt){await ref.set({data:receiptData('batch_event_'+identity,hash(owner+':'+id+':undone'),'undone')});return ok({undone:true});}
      if((receipt._openid!==SERVICE_OWNER&&receipt._openid!==owner) || receipt.event_id!=='batch_event_'+identity)return fail('AUTH_ERROR');
      if(receipt.status==='undone'){if(receipt.receipt_version!==2)await ref.set({data:receiptData(receipt.event_id,hash(owner+':'+id+':undone'),'undone')});return ok({undone:true});}
      const eventRef=tx.collection('trade_events').doc(receipt.event_id), event=await get(eventRef);
      if(event && event._openid!==owner)return fail('AUTH_ERROR');
      if(event && (event.reflection_count || event.supplement_updated_at || (event.attachments||[]).length))return fail('RECORD_CHANGED');
      await ref.set({data:receiptData(receipt.event_id,hash(owner+':'+id+':undone'),'undone')});
      if(event)await eventRef.remove();
      return ok({undone:true});
    });
  }
  async function recent(owner, records) {
    if(!records.length)return;
    await db.runTransaction(async tx=>{
      const target=tx.collection('user_config').doc(configId(owner)), config=await get(target);
      if(!config||config._openid!==owner)return;
      let symbols=config.recent_symbols||[],assets=config.recent_assets||[];
      records.slice().reverse().forEach(item=>{symbols=[item.symbol].concat(symbols.filter(s=>s!==item.symbol));assets=[{symbol:item.symbol,market:item.market,market_source:item.market_source,asset_type:item.asset_type}].concat(assets.filter(a=>a.symbol!==item.symbol));});
      await target.update({data:{recent_symbols:symbols.slice(0,8),recent_assets:assets.slice(0,8),updated_at:db.serverDate()}});
    });
  }
  return async function batch(owner, action, payload) {
    const items=payload.items;
    if(!Array.isArray(items)||!items.length||items.length>3||items.some(i=>!i||typeof i!=='object'))return fail('VALIDATION_ERROR');
    if(action==='createBatchEntries'){try{items.forEach(item=>normalize(item,Date.now()));}catch(e){return fail(e.message);}}
    let assets=[];
    if(action==='createBatchEntries'){const config=await get(db.collection('user_config').doc(configId(owner)));if(config&&config._openid===owner)assets=config.recent_assets||[];}
    const results=await Promise.all(items.map(async item=>{
      const id=action==='undoBatchEntries'?item.client_request_id:item.client_request_id;
      try{return Object.assign({requestId:id},await(action==='undoBatchEntries'?undo(owner,id):create(owner,item,assets)));}
      catch(error){return {requestId:id,success:false,error:'RETRY_REQUIRED'};}
    }));
    let recentWarning=false;
    if(action==='createBatchEntries')try{await recent(owner,results.filter(r=>r.success&&r.data&&!r.data.cancelled).map(r=>r.data));}catch(e){recentWarning=true;}
    return ok({items:results,recentWarning});
  };
};
module.exports.normalize=normalize;
