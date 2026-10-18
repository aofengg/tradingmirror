const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const tick = () => new Promise(setImmediate);
const at = new Date('2026-10-18T00:00:00Z');
const rows = Array.from({length:25}, (_,i) => ({_id:'same'+String(i).padStart(2,'0'), _openid:'owner', is_deleted:false, created_at:at, plan_status:'planned', symbol:'TEST', action:'buy'}))
  .concat(Array.from({length:6}, (_,i) => ({_id:'old'+i, _openid:'owner', is_deleted:false, created_at:new Date(at.getTime()-1000-i), plan_status:'impulsive', symbol:'OLD', action:'buy'})))
  .concat([{_id:'foreign', _openid:'other', created_at:at, is_deleted:false}]);
const snapshots = Array.from({length:205}, (_,i) => ({_id:'r'+String(i).padStart(3,'0'), trade_event_id:'test', _openid:'owner', is_deleted:false, created_at:at, feeling:'acceptable'}));
let failRead = false;
const command = {lt:v=>({op:'lt',v}),gt:v=>({op:'gt',v}),and:v=>({op:'and',v}),or:v=>({op:'or',v})};
function matches(row, clause) {
  if (clause.op === 'and') return clause.v.every(c=>matches(row,c));
  if (clause.op === 'or') return clause.v.some(c=>matches(row,c));
  return Object.keys(clause).every(k=>{const v=clause[k];return v && v.op ? v.op === 'lt' ? row[k] < v.v : row[k] > v.v : +row[k] === +v || row[k] === v;});
}
const db = {getCommand:()=>command, getCollection(name) {
  let filter = {}, orders = [], limit = 20, skip = 0;
  const query = {field(){return this;},where(v){filter=v;return this;},orderBy(k,d){orders.push([k,d]);return this;},limit(v){limit=v;return this;},skip(v){skip=v;return this;},async get(){
    if (failRead) {failRead=false;throw new Error('OFFLINE');}
    const list=(name==='refs'?snapshots:rows).filter(row=>matches(row,filter)).sort((a,b)=>{for(const [k,d] of orders){if(a[k]<b[k])return d==='asc'?-1:1;if(a[k]>b[k])return d==='asc'?1:-1;}return 0;});
    return {data:list.slice(skip,skip+limit)};
  },async count(){return {total:rows.filter(r=>matches(r,filter)).length};}};
  return query;
}};
const repoModule={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'miniprogram/repository/base-repo.js'),'utf8'),{module:repoModule,require:n=>n.includes('/db')?db:n.includes('permission')?{checkLogin:()=>({success:true,data:'owner'})}:{PAGE_SIZE:20},Date});
const repo=repoModule.exports;
const serviceModule={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'miniprogram/services/trade-service.js'),'utf8'),{module:serviceModule,require:n=>{
  if(n.includes('trade-events-repo'))return {getList:o=>repo.getList('events',o)};
  if(n.includes('reflections-repo'))return {getList:o=>repo.getList('refs',o)};
  if(n.includes('/db'))return db;
  if(n.includes('/utils/')||n.includes('/config/'))return require(path.join(root,'miniprogram',n.replace('../','')));
  return {};
}});
const service=serviceModule.exports;
const pageService=Object.assign({},service,{getTodoCounts:()=>Promise.resolve({success:true,data:{all:0,confirm:0,review:0}}),getTodoOverview:()=>Promise.resolve({success:true,data:{confirmItems:[],reviewItems:[],counts:{all:0,confirm:0,review:0}}})});
let pageDefinition, revision=0;
const app={waitForLogin:()=>Promise.resolve(),getPageRevision:()=>revision};
vm.runInNewContext(fs.readFileSync(path.join(root,'miniprogram/pages/records/index.js'),'utf8'),{Page:p=>pageDefinition=p,getApp:()=>app,console:{error(){}},wx:{stopPullDownRefresh(){}},require:n=>n.includes('trade-service')?pageService:n.includes('asset-service')?{decorate:x=>x}: {}});
const page=Object.assign({},pageDefinition,{data:JSON.parse(JSON.stringify(pageDefinition.data)),_eventsVersion:0,setData(p){for(const [key,value] of Object.entries(p)){const m=key.match(/^filteredEvents\[(\d+)\]$/);if(m)this.data.filteredEvents[Number(m[1])]=value;else this.data[key]=value;}}});
(async()=>{
  for(const order of ['desc','asc']) {
    let cursor=null, ids=[];
    do {const res=await repo.getList('events',{pageSize:20,cursor,order});assert(res.success);ids.push(...res.data.list.map(x=>x._id));cursor=res.data.hasMore?res.data.nextCursor:null;}while(cursor);
    assert.equal(ids.length,31);assert.equal(new Set(ids).size,31,'tied timestamps never skip or repeat rows in '+order);
  }
  const owner=await repo.getList('events',{where:{_openid:'other'}});assert(owner.data.list.every(r=>r._openid==='owner'),'callers cannot override owner');
  assert.equal((await repo.getList('events',{cursor:{createdAt:'bad',id:'x'}})).success,false);
  const allReflections=await service.getReflectionsForTrade('test');assert(allReflections.success);assert.equal(allReflections.data.length,205,'detail preserves more than 100 reflection snapshots');
  await page._loadEvents();await tick();assert.equal(page.data.eventCount,20);
  page.chooseFilter({currentTarget:{dataset:{filter:'impulsive'}}});await tick();
  assert.equal(page.data.filteredEvents.length,6,'server filter finds matches beyond the initially loaded page');assert(page.data.filteredEvents.every(e=>e.plan_status==='impulsive'));
  failRead=true;page.chooseFilter({currentTarget:{dataset:{filter:'planned'}}});await tick();assert(page.data.loadError,'failed query must not masquerade as an empty category');
  page.retry();await tick();assert.equal(page.data.filteredEvents.length,20);page.onReachBottom();await tick();assert.equal(page.data.filteredEvents.length,25);
  // Resolve the newer category before the old request to exercise the generation guard.
  page.chooseFilter({currentTarget:{dataset:{filter:'all'}}});await tick();
  const deferred=[];
  pageService.getEventPage=(limit,cursor,filter)=>new Promise(resolve=>deferred.push({filter,resolve}));
  page.chooseFilter({currentTarget:{dataset:{filter:'impulsive'}}});await tick();
  page.chooseFilter({currentTarget:{dataset:{filter:'planned'}}});await tick();
  deferred[1].resolve({success:true,data:{list:[rows[0]],hasMore:false,nextCursor:null}});await tick();
  deferred[0].resolve({success:true,data:{list:[rows[25]],hasMore:false,nextCursor:null}});await tick();
  assert.equal(page.data.filter,'planned');assert.equal(page.data.filteredEvents[0]._id,rows[0]._id,'late response cannot replace the selected category');
  console.log('Record pagination: tied timestamps both directions, owner boundary, full snapshots, historical filtering, failure/retry and category revisions passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
