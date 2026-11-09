const {time, date, hash, ACTIONS} = require('./analysis');
const DAY = 86400000;
const WEEK = 7;
const VERSION = 'operation-timeline-1';
const FEELINGS = {satisfied:'满意', acceptable:'可接受', regret:'懊悔', unknown:'其他感受', unreviewed:'未回看'};
const LEGACY_FEELINGS = {'满意':'satisfied','可接受':'acceptable','可以接受':'acceptable','懊悔':'regret'};
const PLANNED = new Set(['follow_plan','stronger_thesis','target_price','target_reached','thesis_changed','risk_control']);
const LEGACY_REASONS = {'符合原来计划':'follow_plan','逻辑更确定了':'stronger_thesis','价格到了目标':'target_price','达到预设目标':'target_reached','持仓逻辑变了':'thesis_changed','触发风险控制':'risk_control','怕错过机会':'fear_missing','担心利润回吐':'fear_giveback','忍不住波动':'cannot_stand_volatility','临时看到机会':'sudden_opportunity'};
const GROUPS = {
  buy:{label:'买入／加仓', actions:['buy','add'], rows:[['planned','计划／条件'],['fear_missing','怕错过'],['sudden_opportunity','临时机会'],['other','其他理由']]},
  sell:{label:'减仓／清仓', actions:['reduce','exit'], rows:[['planned','计划／条件'],['fear_giveback','担心回吐'],['cannot_stand_volatility','难忍波动'],['other','其他理由']]}
};
const text = value => typeof value === 'string' ? value.trim() : '';
const serial = at => Math.floor((at + 28800000) / DAY);
const dayKey = day => new Date(day * DAY).toISOString().slice(0,10);
const monday = day => day - ((new Date(day * DAY).getUTCDay() + 6) % 7);
const short = key => key.slice(5).replace(/^0/,'').replace(/-0?/,'/');
function parseWeek(key) {
  if(typeof key!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(key))throw Error('VALIDATION_ERROR');
  const day=Date.parse(key+'T00:00:00Z')/DAY;
  if(!Number.isInteger(day)||dayKey(day)!==key||monday(day)!==day)throw Error('VALIDATION_ERROR');
  return day;
}
function normalize(events, reflections, now=Date.now()) {
  const excluded={cancelled:0,pending:0,unknown_status:0,unknown_action:0,missing_date:0,future:0};
  const items=[];
  for(const event of events){
    if(event.is_deleted)continue;
    const status=event.execution_status||(event.stage==='before'?'pending':'executed');
    if(status!=='executed'){excluded[status==='cancelled'?'cancelled':status==='pending'?'pending':'unknown_status']++;continue;}
    if(!ACTIONS[event.action]){excluded.unknown_action++;continue;}
    const at=time(event.executed_at)||time(event.occurred_at)||time(event.created_at);
    if(!at||!event._id){excluded.missing_date++;continue;}
    if(at>now){excluded.future++;continue;}
    items.push({id:event._id,symbol:text(event.symbol),action:event.action,action_label:ACTIONS[event.action],status:'executed',at,reason:text(event.reason_label),reason_key:text(event.reason_key)||LEGACY_REASONS[text(event.reason_label)]||'',note:text(event.optional_note),...(event.occurred_at_precision?{date_precision:event.occurred_at_precision,entry_source:event.entry_source||'at_time'}:{}),history:[]});
  }
  const byId=new Map(items.map(item=>[item.id,item]));
  for(const reflection of reflections){
    if(reflection.is_deleted||!byId.has(reflection.trade_event_id))continue;
    const at=time(reflection.reviewed_at)||time(reflection.created_at);
    if(!at||at>now)continue;
    const feeling=['satisfied','acceptable','regret'].includes(reflection.feeling)?reflection.feeling:LEGACY_FEELINGS[reflection.feeling_label]||'unknown';
    byId.get(reflection.trade_event_id).history.push({id:reflection._id,at,sequence:Number(reflection.sequence_no)||0,feeling,feeling_label:FEELINGS[feeling],note:text(reflection.optional_note),regret:text(reflection.regret_reason_label)});
  }
  items.sort((a,b)=>a.at-b.at||String(a.id).localeCompare(String(b.id)));
  for(const item of items)item.history.sort((a,b)=>a.at-b.at||a.sequence-b.sequence||String(a.id).localeCompare(String(b.id)));
  return {items,excluded,version:hash(VERSION+JSON.stringify(items)),now};
}
function reasonRow(item,group) {
  if(PLANNED.has(item.reason_key))return 'planned';
  return GROUPS[group].rows.some(([key])=>key===item.reason_key)?item.reason_key:'other';
}
function belongs(item,group,week) {return GROUPS[group].actions.includes(item.action)&&monday(serial(item.at))===week;}
function weekSummary(source,group,week) {
  const items=source.items.filter(item=>belongs(item,group,week));
  const n=items.length;
  const rows=GROUPS[group].rows.map(([key,label])=>({key,label,count:items.filter(item=>reasonRow(item,group)===key).length}));
  const counts={satisfied:0,acceptable:0,regret:0,unknown:0,unreviewed:0};
  const reasons=new Map();
  for(const item of items){const last=item.history[item.history.length-1];counts[last?last.feeling:'unreviewed']++;const label=item.reason||'理由未记录';reasons.set(label,(reasons.get(label)||0)+1);}
  const reasonCounts=[...reasons].map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
  const end=Math.min(week+6,serial(source.now));
  let summary='这周没有已执行的'+GROUPS[group].label+'，图中保持空白。';
  if(n&&n<3)summary='这周仅'+n+'次操作，先看具体经历，不急着归纳。';
  else if(n){
    const top=reasonCounts[0];
    if(counts.unreviewed===n)summary='这周'+n+'次操作都尚未回看，后来感受暂留空白。';
    else{const known=['satisfied','acceptable','regret','unknown'].sort((a,b)=>counts[b]-counts[a]);summary='“'+top.label+'”出现'+top.count+'次；全周'+n+'次操作中，最近回看有'+counts[known[0]]+'次'+FEELINGS[known[0]]+'。';}
  }
  return {key:dayKey(week),end_key:dayKey(end),label:short(dayKey(week)),period:short(dayKey(week))+'—'+short(dayKey(end)),total:n,rows,feelings:Object.keys(FEELINGS).map(key=>({key,label:FEELINGS[key],count:counts[key]})),reason_counts:reasonCounts,summary};
}
function build(source,p={}) {
  const latest=monday(serial(source.now));
  const earliest=source.items.length?monday(serial(source.items[0].at)):latest;
  let end=p.end_week?parseWeek(p.end_week):latest;
  end=Math.max(earliest,Math.min(latest,end));
  const start=end-7*WEEK;
  const groups={};
  for(const group of Object.keys(GROUPS))groups[group]={label:GROUPS[group].label,rows:GROUPS[group].rows.map(([key,label])=>({key,label})),weeks:Array.from({length:8},(_,i)=>weekSummary(source,group,start+i*WEEK))};
  return {schema_version:1,source_version:source.version,timezone:'Asia/Shanghai',start_week:dayKey(start),end_week:dayKey(end),earliest_week:dayKey(earliest),latest_week:dayKey(latest),has_earlier:earliest<start,has_later:end<latest,executed:source.items.length,excluded:source.excluded,groups};
}
function detail(source,p={}) {
  if(!GROUPS[p.group])throw Error('VALIDATION_ERROR');
  const week=parseWeek(p.week);
  const cursor=p.cursor===undefined?0:p.cursor;
  if(!Number.isInteger(cursor)||cursor<0)throw Error('VALIDATION_ERROR');
  if(p.source_version&&p.source_version!==source.version)throw Error('TIMELINE_CHANGED');
  const items=source.items.filter(item=>belongs(item,p.group,week)).sort((a,b)=>b.at-a.at||String(b.id).localeCompare(String(a.id)));
  const slice=items.slice(cursor,cursor+15).map(item=>({...item,date:item.date_precision==='date'?date(item.at).slice(0,10)+'（时刻未填）':date(item.at),history:item.history.map(r=>({...r,date:date(r.at)}))}));
  return {source_version:source.version,group:p.group,group_label:GROUPS[p.group].label,week:weekSummary(source,p.group,week),total:items.length,items:slice,cursor:cursor+slice.length,has_more:cursor+slice.length<items.length};
}
module.exports={normalize,build,detail,weekSummary,parseWeek,reasonRow,GROUPS,VERSION};
