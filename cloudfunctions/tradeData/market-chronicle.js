// Market observations are independent of personal trades and AI review inputs.
const crypto = require('crypto');
const C = 'market_chronicle';
const SERVICE_OWNER = '__market_chronicle_service__';
const ownerKey = owner => crypto.createHash('sha256').update('market-chronicle:'+owner).digest('hex');
const MARKETS = { US:['IXIC','NDX','SPX','DJI'], CN:['CSI300','SHCOMP','CHINEXT'], HK:['HSI','HSTECH'] };
const ZONES = { US:'America/New_York', CN:'Asia/Shanghai', HK:'Asia/Hong_Kong' };
const ok = data => ({success:true,data,error:null});
const fail = error => ({success:false,data:null,error});
function today(market, now) {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:ZONES[market],year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now || new Date());
  const part = type => parts.find(p => p.type === type).value;
  return part('year')+'-'+part('month')+'-'+part('day');
}
function validDate(value) {
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value+'T12:00:00Z')))return false;
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && new Date(value+'T12:00:00Z').toISOString().slice(0,10) === value;
}
function normalize(p, action, now) {
  if (!Object.prototype.hasOwnProperty.call(MARKETS,p.market) || !MARKETS[p.market].includes(p.index)) throw Error('VALIDATION_ERROR');
  if (!validDate(p.date) || p.date > today(p.market,now)) throw Error('INVALID_DATE');
  if (!Number.isInteger(p.revision) || p.revision < 0 || !/^[A-Za-z0-9_-]{8,80}$/.test(p.request_id || '')) throw Error('VALIDATION_ERROR');
  if (action !== 'saveMarketChronicle') return p;
  const absent = v => v === null || v === undefined || v === '';
  const close = absent(p.close) ? null : Number(p.close), change = absent(p.change) ? null : Number(p.change);
  if ((close === null && change === null) || (close !== null && (!Number.isFinite(close) || close <= 0 || close > 1e9)) || (change !== null && (!Number.isFinite(change) || change < -100 || change > 1e6)) || typeof p.note !== 'string' || p.note.length > 200) throw Error('VALIDATION_ERROR');
  return Object.assign({},p,{close,change,note:p.note.trim()});
}
function publicRow(row) {
  return {date:row.date,market:row.market,year:row.year,quotes:row.quotes || {},note:row.note || '',revision:row.revision || 0,source:'manual',recorded_at:row.recorded_at,updated_at:row.updated_at};
}
async function get(ref) {
  try { const res = await ref.get(); return res.data || null; }
  catch (e) { if (/not.exist|not found|does not exist/i.test(String(e.errMsg || e.message))) return null; throw e; }
}
module.exports = function(db) {
  return async function(owner, action, payload) {
    const p = payload || {};
    if (action === 'listMarketChronicle') {
      if (!Object.prototype.hasOwnProperty.call(MARKETS,p.market) || !/^\d{4}$/.test(p.year || '') || Number(p.year)<1900 || Number(p.year)>new Date().getUTCFullYear()+1) return fail('VALIDATION_ERROR');
      let rows = [], cursor = '';
      do {
        const where = {_openid:SERVICE_OWNER,owner_key:ownerKey(owner),market:p.market,year:p.year};
        if (cursor) where.date = db.command.gt(cursor);
        const res = await db.collection(C).where(where).orderBy('date','asc').limit(100).get();
        const page = res.data || [];
        rows = rows.concat(page);
        cursor = page.length === 100 ? page[page.length-1].date : '';
        if (rows.length > 366) throw Error('MARKET_DATA_INTEGRITY');
      } while (cursor);
      return ok({rows:rows.map(publicRow),today:today(p.market)});
    }
    if (!['saveMarketChronicle','deleteMarketChronicle','undoMarketChronicle'].includes(action)) return fail('UNKNOWN_ACTION');
    let value;
    try { value = normalize(p,action); } catch(e) { return fail(e.message); }
    const id = 'market_'+crypto.createHash('sha256').update(owner+':'+p.market+':'+p.date).digest('hex').slice(0,40);
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify([action,p.index,value.close,value.change,value.note,!!p.preserve_note])).digest('hex');
    return db.runTransaction(async tx => {
      const ref = tx.collection(C).doc(id), existing = await get(ref);
      if (existing && (existing._openid !== SERVICE_OWNER || existing.owner_key !== ownerKey(owner))) return fail('AUTH_ERROR');
      if (action === 'undoMarketChronicle') {
        if (existing && existing.undone_request === p.request_id) return ok({row:publicRow(existing),undone:true});
        if (!existing || existing.last_request !== p.request_id || existing.revision !== p.revision || !existing.undo) return fail('RECORD_CHANGED');
        const restored = Object.assign({},existing,{quotes:existing.undo.quotes,note:existing.undo.note,revision:existing.revision+1,undo:null,undone_request:p.request_id,updated_at:db.serverDate()});
        delete restored._id;
        await ref.set({data:restored});
        return ok({row:publicRow(restored),undone:true});
      }
      if (existing && existing.last_request === p.request_id) {
        if (existing.undone_request === p.request_id) return fail('REQUEST_UNDONE');
        return existing.last_fingerprint === fingerprint ? ok({row:publicRow(existing),request_id:p.request_id,duplicate:true}) : fail('REQUEST_CONFLICT');
      }
      if (Number(existing && existing.revision || 0) !== p.revision) return fail('RECORD_CHANGED');
      const quotes = Object.assign({},existing && existing.quotes || {}), previous = {quotes:Object.assign({},quotes),note:existing && existing.note || ''};
      if (action === 'deleteMarketChronicle') {
        if (!quotes[p.index]) return fail('NOT_FOUND');
        delete quotes[p.index];
      } else quotes[p.index] = {close:value.close,change:value.change};
      const note = action === 'saveMarketChronicle' && !(p.preserve_note && !value.note) ? value.note : previous.note;
      const row = {_openid:SERVICE_OWNER,owner_key:ownerKey(owner),schema_version:1,market:p.market,date:p.date,year:p.date.slice(0,4),timezone:ZONES[p.market],source:'manual',quotes,note,
        revision:p.revision+1,last_request:p.request_id,last_fingerprint:fingerprint,undone_request:'',undo:previous,
        recorded_at:existing && existing.recorded_at || db.serverDate(),updated_at:db.serverDate()};
      await ref.set({data:row});
      return ok({row:publicRow(row),request_id:p.request_id});
    });
  };
};
module.exports.normalize = normalize;
module.exports.today = today;
