// Pure projections: one decision per observation, never infer profit or decision quality.
const FEELINGS = { satisfied: '满意', acceptable: '可接受', regret: '懊悔', unknown: '其他感受', unreviewed: '未回看' };
const ACTIONS = { buy: '买入', add: '加仓', reduce: '减仓', exit: '清仓' };
const DAY = 86400000;
function time(value) { const n = value ? new Date(value).getTime() : 0; return Number.isFinite(n) ? n : 0; }
function status(e) { return e.execution_status || (e.stage === 'before' ? 'pending' : 'executed'); }
function eventTime(e) { return status(e) === 'executed' ? time(e.executed_at) || time(e.occurred_at) || time(e.created_at) : time(e.recorded_at) || time(e.created_at); }
function dateLabel(value) { const d = new Date(time(value) + 8 * 3600000); return time(value) ? d.toISOString().slice(0, 16).replace('T', ' ') : '时间未记录'; }
function feeling(r) { return r ? (FEELINGS[r.feeling] && r.feeling !== 'unreviewed' ? r.feeling : 'unknown') : 'unreviewed'; }
function day(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error('INVALID_RANGE'); const n = Date.parse(value + 'T00:00:00+08:00'); if (!Number.isFinite(n) || new Date(n + 8 * 3600000).toISOString().slice(0, 10) !== value) throw new Error('INVALID_RANGE'); return n; }
function range(p, now) {
  const key = p.range || 'all'; const today = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  let start = 0, end = now + 1;
  if (key === '30' || key === '90') start = day(today) - (Number(key) - 1) * DAY;
  else if (key === 'week') start = day(today) - ((new Date(day(today)+8*3600000).getUTCDay()||7)-1)*DAY;
  else if (key === 'month') start = day(today.slice(0,7)+'-01');
  else if (key === 'custom') { start = day(p.start); end = Math.min(day(p.end) + DAY, now + 1); if (start >= end) throw new Error('INVALID_RANGE'); }
  else if (key !== 'all') throw new Error('INVALID_RANGE');
  return { key, start, end, label: key === 'all' ? '全部数据' : key === 'week' ? '本周' : key === 'month' ? '本月' : key === 'custom' ? p.start + ' — ' + p.end : '近' + key + '天' };
}
function prepare(events, reflections, now) {
  const histories = new Map();
  reflections.filter(r => !r.is_deleted && time(r.reviewed_at || r.created_at) <= now).forEach(r => { if (!histories.has(r.trade_event_id)) histories.set(r.trade_event_id, []); histories.get(r.trade_event_id).push(r); });
  histories.forEach(list => list.sort((a,b) => time(a.reviewed_at || a.created_at) - time(b.reviewed_at || b.created_at) || Number(a.sequence_no || 0) - Number(b.sequence_no || 0) || String(a._id).localeCompare(String(b._id))));
  return events.filter(e => !e.is_deleted && eventTime(e) <= now).map(e => {
    const history = histories.get(e._id) || []; const first = feeling(history[0]), latest = feeling(history[history.length - 1]);
    const changed = history.some((r,i) => i > 0 && feeling(r) !== feeling(history[i-1]));
    let change = '';
    if (history.length >= 2) change = !changed ? 'stable' : first === latest ? 'returned' : latest === 'regret' ? 'to_regret' : first === 'regret' && (latest === 'satisfied' || latest === 'acceptable') ? 'from_regret' : 'other_change';
    return { event: e, at: eventTime(e), history, first, latest, change };
  });
}
function counts(rows) { const out = { satisfied:0, acceptable:0, regret:0, unknown:0, unreviewed:0 }; rows.forEach(r => out[r.latest]++); return out; }
function distribution(rows) { const c=counts(rows); return Object.keys(FEELINGS).map(key => ({ key, label:FEELINGS[key], count:c[key], width:rows.length ? c[key]/rows.length*100 : 0 })); }
function timeline(rows, scopeRows, p, now) {
  const bounds=range(p,now), dated=scopeRows.map(r=>r.at).filter(n=>n>0);
  const first=bounds.start || (dated.length?dated.reduce((a,b)=>Math.min(a,b),Infinity):now);
  const startDay=day(dateLabel(first).slice(0,10)), end=bounds.end;
  const days=Math.ceil((end-startDay)/DAY), buckets=[];
  let title;
  function bucket(start,finish,label){const selected=rows.filter(r=>r.at>0&&r.at>=start&&r.at<finish);const c=counts(selected);buckets.push({label,total:selected.length,reviewed:selected.length-c.unreviewed,distribution:distribution(selected)});}
  if(days<=90){
    const step=days<=14?1:7;
    title=(p.range==='all'||!p.range?'全部历史':'所选范围')+' · '+(step===1?'按天':'每7天');
    for(let start=startDay;start<end;start+=step*DAY)bucket(start,Math.min(end,start+step*DAY),dateLabel(start).slice(5,10));
  }else{
    const firstDate=new Date(startDay+8*3600000),lastDate=new Date(end-1+8*3600000);
    const months=(lastDate.getUTCFullYear()-firstDate.getUTCFullYear())*12+lastDate.getUTCMonth()-firstDate.getUTCMonth()+1;
    const step=months<=12?1:months<=36?3:months<=144?12:Math.ceil(months/12);
    let year=firstDate.getUTCFullYear(),month=firstDate.getUTCMonth();
    title=(p.range==='all'||!p.range?'全部历史':'所选范围')+' · '+(step===1?'按月':'每'+step+'个月');
    while(true){const start=Date.UTC(year,month,1)-8*3600000,finish=Date.UTC(year,month+step,1)-8*3600000;if(start>=end)break;bucket(Math.max(start,bounds.start),Math.min(finish,end),dateLabel(start).slice(0,7));month+=step;}
  }
  return {buckets,title};
}
function groupRows(rows) {
  const groups = new Map();
  rows.forEach(r => { const key=r.event.reason_key || '__missing'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); });
  return Array.from(groups, ([key, list]) => {
    const c=counts(list), reviewed=list.length-c.unreviewed;
    const symbols={}; list.forEach(r => { const s=[r.event.market || '',r.event.asset_type || 'stock',r.event.symbol || ''].join(':'); symbols[s]=(symbols[s]||0)+1; });
    const topSymbol=Object.keys(symbols).sort((a,b)=>symbols[b]-symbols[a])[0];
    return { key, label:list[list.length-1].event.reason_label || (key==='__missing' ? '理由未记录' : key), total:list.length, reviewed, regret:c.regret, satisfied:c.satisfied, distribution:distribution(list), coverage:Math.round(reviewed/list.length*100), concentration:symbols[topSymbol]>=3 && symbols[topSymbol]/list.length>=.7 ? '主要集中于 '+(list.find(r=>[r.event.market||'',r.event.asset_type||'stock',r.event.symbol||''].join(':')===topSymbol).event.symbol || '同一标的') : '' };
  }).sort((a,b)=>b.total-a.total || a.key.localeCompare(b.key));
}
function summary(rows, p, now, reminder, allRows, scopeRows) {
  const reasons=groupRows(rows); const c=counts(rows);
  const changes=[['to_regret','后来感到懊悔'],['from_regret','后来能够接受'],['stable','多次感受一致'],['returned','变化后回到最初'],['other_change','其他感受变化']].map(([key,label])=>({key,label,count:rows.filter(r=>r.change===key).length}));
  const insights=[];
  const concern=reasons.filter(r=>r.regret>=3).sort((a,b)=>b.regret-a.regret)[0];
  if (concern) {
    const related=rows.filter(r=>(r.event.reason_key||'__missing')===concern.key && r.latest==='regret');
    const regretReasons={}; related.forEach(r=>{const last=p.basis==='first'?r.history[0]:r.history[r.history.length-1]; if(last.regret_reason_label)regretReasons[last.regret_reason_label]=(regretReasons[last.regret_reason_label]||0)+1;});
    const top=Object.keys(regretReasons).sort((a,b)=>regretReasons[b]-regretReasons[a])[0];
    insights.push({key:concern.key,feeling:'regret',title:'值得留意',text:'因「'+concern.label+'」的 '+concern.reviewed+' 次已回看决定中，'+concern.regret+' 次'+(p.basis==='first'?'首次':'最近')+'感到懊悔。'+(top && regretReasons[top]>=2 ? '其中 '+regretReasons[top]+' 次提到「'+top+'」。' : ''),hint:concern.total+' 次决定 · '+concern.coverage+'% 已回看'+(concern.concentration?' · '+concern.concentration:'')});
  }
  const positive=reasons.filter(r=>r.satisfied>=3).sort((a,b)=>b.satisfied-a.satisfied)[0];
  if (positive) insights.push({key:positive.key,feeling:'satisfied',title:'值得保留',text:'因「'+positive.label+'」的 '+positive.reviewed+' 次已回看决定中，'+positive.satisfied+' 次'+(p.basis==='first'?'首次':'最近')+'感到满意。',hint:positive.total+' 次决定 · '+positive.coverage+'% 已回看'+(positive.concentration?' · '+positive.concentration:'')});
  const paired=rows.filter(r=>r.history.length>=2).length;
  const planGroups=[['planned','按原计划'],['impulsive','临时决定'],['uncertain','不确定']].map(([key,label])=>{const group=rows.filter(r=>(['planned','impulsive'].includes(r.event.plan_status)?r.event.plan_status:'uncertain')===key);return {key,label,total:group.length,reviewed:group.filter(r=>r.history.length).length,distribution:distribution(group)};});
  const output={total:rows.length,reviewed:rows.length-c.unreviewed,unreviewed:c.unreviewed,coverage:rows.length?Math.round((rows.length-c.unreviewed)/rows.length*100):0,counts:c,reasons,insights,changes,planGroups,paired,changed:changes.filter(x=>x.key!=='stable').reduce((n,x)=>n+x.count,0),updatedLabel:dateLabel(now),basis:p.basis||'latest',basisLabel:p.basis==='first'?'首次感受':'最近感受',reminder:null};
  const history=timeline(rows,scopeRows||rows,p,now);
  output.trend=history.buckets;output.trendTitle=history.title;
  output.undatedCount=rows.filter(r=>r.at===0).length;
  if(reminder){const matching=(allRows||rows).filter(r=>status(r.event)==='executed'&&r.event.reason_key===reminder.reason_key&&(!reminder.action||r.event.action===reminder.action));const boundary=time(reminder.created_at);const before=matching.filter(r=>r.at>0&&r.at<boundary),after=matching.filter(r=>r.at>=boundary);output.reminder={id:reminder.id,text:reminder.text,reason_key:reminder.reason_key,reason_label:reminder.reason_label,action:reminder.action,action_label:ACTIONS[reminder.action]||'全部操作',sourceCount:(reminder.source_event_ids||[]).length,createdLabel:dateLabel(reminder.created_at),before:{total:before.length,reviewed:before.length-counts(before).unreviewed,distribution:distribution(before)},after:{total:after.length,reviewed:after.length-counts(after).unreviewed,distribution:distribution(after)}};}
  return output;
}
function selected(allRows,p,now){
  const r=range(p,now), chosenStatus=p.status||'executed'; if(!['executed','cancelled'].includes(chosenStatus)|| (p.action&&!ACTIONS[p.action]))throw new Error('VALIDATION_ERROR');
  return {range:r,rows:allRows.filter(x=>status(x.event)===chosenStatus&&(!p.action||x.event.action===p.action)&&x.at>=r.start&&x.at<r.end)};
}
function scopeEvents(events,p,now) {
  let rows=selected(prepare(events,[],now),p,now).rows;
  if(p.reason_key)rows=rows.filter(r=>(r.event.reason_key||'__missing')===p.reason_key);
  return rows.map(r=>r.event);
}
function detailRow(r) {
  const e=r.event, latest=r.history[r.history.length-1];
  const preview=r.history.length<=4?r.history:[r.history[0],...r.history.slice(-3)];
  return {
    _id:e._id,symbol:e.symbol,market:e.market||'',asset_type:e.asset_type||'stock',
    action:e.action,action_label:e.action_label||ACTIONS[e.action]||e.action,
    reason_key:e.reason_key,reason_label:e.reason_label||'理由未记录',optional_note:e.optional_note||'',
    plan_status:e.plan_status,plan_label:({planned:'按原计划',impulsive:'临时决定',uncertain:'不确定'})[e.plan_status]||'不确定',
    executed_at:e.executed_at||e.occurred_at||e.created_at,execution_status:status(e),created_label:dateLabel(r.at),
    latest_feeling:feeling(latest),latest_feeling_label:FEELINGS[feeling(latest)],
    latest_review_note:latest?latest.optional_note||'':'',
    latest_regret_reason:feeling(latest)==='regret'?latest.regret_reason_label||'':'',
    basis_feeling:r.latest,basis_feeling_label:FEELINGS[r.latest],reflection_count:r.history.length,more_history:r.history.length>4,
    history:preview.map(x=>({_id:x._id,feeling:feeling(x),label:FEELINGS[feeling(x)],at:dateLabel(x.reviewed_at||x.created_at),regret_reason_label:x.regret_reason_label||'',optional_note:x.optional_note||'',age:typeof x.event_age_hours==='number'?(x.event_age_hours<48?Math.round(x.event_age_hours)+'小时后':Math.round(x.event_age_hours/24)+'天后'):''}))
  };
}

function comparison(rows, links) {
  const assets=require('./asset-tracking');
  const ordered=rows.slice().sort((a,b)=>b.at-a.at || (String(a.event._id)<String(b.event._id)?1:-1));
  const positive=ordered.filter(r=>r.latest==='satisfied'), regret=ordered.filter(r=>r.latest==='regret');
  const describe=(pair,match,context,hint)=>({total:rows.length,match,context,hint,
    items:pair.filter(Boolean).map(r=>Object.assign(detailRow(r),{comparisonLabel:r.latest==='regret'?'懊悔的一次':'满意的一次'}))});
  if (!positive.length || !regret.length) return describe([positive[0],regret[0]],'incomplete','暂时不足两种感受','感受可能已更新，可查看全部经历。');
  const identity=r=>r.event.symbol?assets.resolve(assets.identity(r.event),links||{}):'missing:'+r.event._id;
  const action=r=>ACTIONS[r.event.action]?r.event.action:'missing:'+r.event._id;
  // The latest positive and regret in each context suffice; no quadratic pair scan.
  function matched(key) {
    const groups=new Map();
    ordered.forEach(r=>{
      if(r.latest!=='satisfied'&&r.latest!=='regret')return;
      const k=key(r), group=groups.get(k)||{};
      if(!group[r.latest])group[r.latest]=r;
      groups.set(k,group);
    });
    return Array.from(groups.values()).filter(g=>g.satisfied&&g.regret)
      .sort((a,b)=>Math.min(b.satisfied.at,b.regret.at)-Math.min(a.satisfied.at,a.regret.at)||Math.max(b.satisfied.at,b.regret.at)-Math.max(a.satisfied.at,a.regret.at)||String(a.satisfied.event._id).localeCompare(String(b.satisfied.event._id)))
      .map(g=>[g.satisfied,g.regret])[0];
  }
  let pair=matched(r=>JSON.stringify([identity(r),action(r)]));
  if(pair)return describe(pair,'same_asset_action','同一标的 · 同一操作','各取这个情境中最近一笔满意与懊悔的决定。');
  pair=matched(identity);
  if(pair)return describe(pair,'same_asset','同一标的 · 操作不同','没有同一标的、同一操作的配对，以下操作情境不同。');
  pair=matched(action);
  if(pair)return describe(pair,'same_action','同一操作 · 标的不同','没有同一标的的配对，以下来自不同标的。');
  return describe([positive[0],regret[0]],'different_context','标的、操作均不同','暂无相同情境的配对，以下仅作经历对照。');
}
function project(events,reflections,p,now,reminder,assetLinks){
  if(p.basis && !['first','latest'].includes(p.basis))throw new Error('VALIDATION_ERROR');
  const all=prepare(events,reflections,now);
  if(p.reminder_source){if(!reminder)return {total:0,items:[],hasMore:false,nextCursor:null};p=Object.assign({},p,{range:'all',status:'executed',action:reminder.action||'',reason_key:reminder.reason_key});}
  const selection=selected(all,p,now);let rows=selection.rows;
  if(p.basis==='first')rows=rows.map(r=>Object.assign({},r,{latest:r.first}));
  if(p.plan_status){if(!['planned','impulsive','uncertain'].includes(p.plan_status))throw new Error('VALIDATION_ERROR');rows=rows.filter(r=>(['planned','impulsive'].includes(r.event.plan_status)?r.event.plan_status:'uncertain')===p.plan_status);}
  if(p.reminder_source)rows=rows.filter(r=>(reminder.source_event_ids||[]).includes(r.event._id));
  if(p.reason_key)rows=rows.filter(r=>(r.event.reason_key||'__missing')===p.reason_key);
  if(p.reviewed)rows=rows.filter(r=>r.history.length>0);
  if(p.feeling){if(!FEELINGS[p.feeling])throw new Error('VALIDATION_ERROR'); rows=rows.filter(r=>r.latest===p.feeling);}
  if(p.change){if(!['to_regret','from_regret','stable','returned','other_change'].includes(p.change))throw new Error('VALIDATION_ERROR');rows=rows.filter(r=>r.change===p.change);}
  if(p.mode==='comparison'){
    if(!p.reason_key || (p.basis && p.basis!=='latest') || p.feeling)throw new Error('VALIDATION_ERROR');
    return comparison(rows,assetLinks);
  }
  if(p.mode==='detail'){
    rows.sort((a,b)=>b.at-a.at||(String(b.event._id)>String(a.event._id)?1:String(b.event._id)<String(a.event._id)?-1:0));
    let start=0;if(p.cursor){if(!Number.isFinite(p.cursor.at)||typeof p.cursor.id!=='string')throw new Error('INVALID_CURSOR');start=rows.findIndex(r=>r.at<p.cursor.at||(r.at===p.cursor.at&&String(r.event._id)<p.cursor.id));if(start<0)start=rows.length;}
    const page=rows.slice(start,start+(p._legacy_full?rows.length:15)),last=page[page.length-1];return {total:rows.length,items:page.map(detailRow),hasMore:start+page.length<rows.length,nextCursor:last?{at:last.at,id:last.event._id}:null};
  }
  if(p.compact === true) {
    const c=counts(rows);
    return {total:rows.length,reviewed:rows.length-c.unreviewed,unreviewed:c.unreviewed,rangeLabel:selection.range.label,
      reasons:groupRows(rows).map(r=>({key:r.key,label:r.label,total:r.total,distribution:r.distribution}))};
  }
  const out=summary(rows,p,now,reminder,all,selection.rows);out.rangeLabel=selection.range.label;out.pendingCount=all.filter(r=>status(r.event)==='pending').length;return out;
}
module.exports={project,prepare,range,status,eventTime,scopeEvents,FEELINGS};
