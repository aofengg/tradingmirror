const assert=require('node:assert/strict');
const create=require('../cloudfunctions/tradeData/market-chronicle');
const crypto=require('crypto');
const ownerKey=owner=>crypto.createHash('sha256').update('market-chronicle:'+owner).digest('hex');
const model=require('../miniprogram/utils/market-chronicle');
const data=new Map();let lock=Promise.resolve();
const clone=v=>structuredClone(v);
function collection(){let where={},order='',limit=100;return {doc(id){return {async get(){if(!data.has(id))throw Error('document does not exist');return {data:Object.assign({_id:id},clone(data.get(id)))};},async set({data:value}){data.set(id,clone(value));}};},where(w){where=w;return this;},orderBy(f){order=f;return this;},limit(n){limit=n;return this;},async get(){return {data:[...data.values()].filter(r=>Object.entries(where).every(([k,v])=>v&&v.gt?r[k]>v.gt:r[k]===v)).sort((a,b)=>a[order].localeCompare(b[order])).slice(0,limit).map(clone)};}};}
const db={collection,command:{gt:v=>({gt:v})},serverDate:()=>new Date(),runTransaction(fn){const p=lock.then(()=>fn({collection}));lock=p.catch(()=>{});return p;}};
const api=create(db);
const p={market:'US',index:'IXIC',date:'2025-03-06',revision:0,request_id:'request_a_0001',close:18000,change:-4.2,note:'人工示例'};
(async()=>{
 let r=await api('owner','saveMarketChronicle',p);assert(r.success);assert.equal(r.data.row.revision,1);
 assert.equal((await api('owner','saveMarketChronicle',p)).data.duplicate,true);
 assert.equal((await api('owner','saveMarketChronicle',{...p,close:1})).error,'REQUEST_CONFLICT');
 assert.equal((await api('owner','saveMarketChronicle',{...p,request_id:'new_request_0001'})).error,'RECORD_CHANGED');
 assert.equal((await api('other','listMarketChronicle',{market:'US',year:'2025'})).data.rows.length,0);
 r=await api('owner','saveMarketChronicle',{...p,index:'SPX',revision:1,close:5500,change:null,request_id:'request_b_0001'});assert(r.success);assert.equal(r.data.row.quotes.IXIC.close,18000);assert.equal(r.data.row.quotes.SPX.change,null);
 assert.equal((await api('owner','undoMarketChronicle',{...p,revision:1})).error,'RECORD_CHANGED');
 r=await api('owner','undoMarketChronicle',{...p,index:'SPX',revision:2,request_id:'request_b_0001'});assert(r.success);assert(!r.data.row.quotes.SPX);assert.equal(r.data.row.quotes.IXIC.change,-4.2);
 assert((await api('owner','undoMarketChronicle',{...p,index:'SPX',revision:2,request_id:'request_b_0001'})).success);
 assert.equal((await api('owner','saveMarketChronicle',{...p,index:'SPX',revision:1,close:5500,change:null,request_id:'request_b_0001'})).error,'REQUEST_UNDONE');
 r=await api('owner','deleteMarketChronicle',{...p,revision:3,request_id:'request_del_001'});assert(r.success);assert.deepEqual(r.data.row.quotes,{});
 r=await api('owner','undoMarketChronicle',{...p,revision:4,request_id:'request_del_001'});assert(r.success);assert.equal(r.data.row.quotes.IXIC.close,18000);
 for(const patch of [{date:'2025-02-30'},{date:'2099-01-01'},{close:0},{close:'bad'},{close:null,change:null},{change:-101},{note:'x'.repeat(201)},{market:'US',index:'HSI'}])assert.equal((await api('owner','saveMarketChronicle',{...p,...patch})).success,false,JSON.stringify(patch));
 assert.equal(create.today('US',new Date('2026-11-06T02:00:00Z')),'2026-11-05');
 assert.equal(create.today('CN',new Date('2026-11-06T02:00:00Z')),'2026-11-06');
 for(let i=0;i<215;i++){let d=new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10);data.set('seed'+i,{_openid:'__market_chronicle_service__',owner_key:ownerKey('owner'),market:'US',year:'2024',date:d,quotes:{IXIC:{close:100+i,change:i===0?null:0}},revision:1});}
 data.set('forged',{_openid:'attacker',owner_key:ownerKey('owner'),market:'US',year:'2024',date:'2024-12-30',quotes:{IXIC:{close:999999}},revision:1});
 r=await api('owner','listMarketChronicle',{market:'US',year:'2024'});assert.equal(r.data.rows.length,215);assert(!('undo' in r.data.rows[0]));assert(!('_openid' in r.data.rows[0]));
 const rows=model.decorate(r.data.rows,'IXIC','time'),graph=model.chart(rows,'2024');assert.equal(graph.points.length,215);assert.equal(rows[0].hasChange,false);assert.equal(rows[1].trend,'flat');
 assert(graph.points.every(p=>p.x>=4&&p.x<=96&&p.y>=4&&p.y<=96));
 const sparse=model.decorate([{date:'2026-01-01',quotes:{IXIC:{close:100,change:1}}},{date:'2026-01-04',quotes:{IXIC:{close:120,change:-1}}},{date:'2026-01-13',quotes:{IXIC:{close:null,change:0}}},{date:'2026-01-16',quotes:{IXIC:{close:110,change:null}}}],'IXIC','time');
 const g=model.chart(sparse,'2026');assert.equal(g.missing,1);assert(Math.abs((g.points[2].x-g.points[1].x)/(g.points[1].x-g.points[0].x)-4)<1e-9);assert.equal(sparse[3].changeText,'涨跌幅未填');assert.equal(sparse[2].trend,'flat');
 const concurrent=await Promise.all([api('fresh','saveMarketChronicle',p),api('fresh','saveMarketChronicle',{...p,request_id:'another_request_001'})]);assert.equal(concurrent.filter(r=>r.success).length,1);
 console.log('Market chronicle: isolation, transactions, idempotency, conflicts, multi-index merge, undo/delete, date zones, 215-row pagination and sparse chart semantics passed.');
})().catch(e=>{console.error(e);process.exit(1);});
