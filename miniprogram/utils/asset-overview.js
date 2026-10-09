var date=require('./date');
function time(value){var n=value ? new Date(value).getTime() : 0;return isFinite(n)?n:0;}
function label(value){if(!value)return '时间未记录';var d=new Date(value);return date.formatDate(value)+' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);}
function feeling(item){
  var labels={satisfied:'满意',acceptable:'可以接受',regret:'懊悔'};
  var legacy={'满意':'satisfied','可接受':'acceptable','可以接受':'acceptable','懊悔':'regret'};
  var key=labels[item.feeling] ? item.feeling : legacy[item.feeling_label]||'unknown';
  return {key:key,label:item.feeling_label||labels[key]||'已回看'};
}
function build(events,reflections){
  var rows=[],byId={},seen={};
  events.forEach(function(event){
    if(event.is_deleted||byId[event._id])return;
    var status=event.execution_status||(event.stage==='before'?'pending':'executed');
    var at=status==='executed' ? time(event.executed_at)||time(event.occurred_at)||time(event.created_at) : time(event.recorded_at)||time(event.created_at)||time(event.occurred_at);
    var node={id:'event:'+event._id,eventId:event._id,kind:'operation',time:at,date:label(at),action:event.action,label:event.action_label||event.action,
      note:event.reason_label||'',status:status,statusLabel:event.execution_label||'',reviewStatus:event.review_status,reviewLabel:event.review_label};
    byId[event._id]=node;rows.push(node);
  });
  var groups={};
  reflections.forEach(function(item){
    var parent=byId[item.trade_event_id];
    if(item.is_deleted||!parent||(parent.status!=='executed' && parent.status!=='cancelled')||seen[item._id])return;
    seen[item._id]=true;(groups[item.trade_event_id]||(groups[item.trade_event_id]=[])).push(item);
  });
  Object.keys(groups).forEach(function(id){
    var parent=byId[id];
    groups[id].sort(function(a,b){return (time(a.reviewed_at)||time(a.created_at))-(time(b.reviewed_at)||time(b.created_at))||String(a._id).localeCompare(String(b._id));}).forEach(function(item,index){
      var emotion=feeling(item),at=time(item.reviewed_at)||time(item.created_at);
      var decisionLabel=parent.label+(parent.status==='cancelled' ? '（未执行）' : '');
      rows.push({id:'reflection:'+item._id,eventId:id,kind:'feeling',time:at,date:label(at),label:emotion.label,feeling:emotion.key,
        reason:String(item.regret_reason_label||'').trim(),memo:String(item.optional_note||'').trim(),
        reviewCount:groups[id].length,executionStatus:parent.status,compactNote:decisionLabel+' · 第'+(index+1)+'次回看',
        note:(parent.time ? date.formatShort(parent.time)+' ' : '')+decisionLabel+' · 第'+(index+1)+'次回看'});
    });
  });
  rows.sort(function(a,b){return b.time-a.time||(a.kind===b.kind?0:a.kind==='feeling'?-1:1)||a.id.localeCompare(b.id);});
  return rows;
}
function layout(rows,limit,options){
  options=options||{};
  var measurements=options.measurements||{},expanded=options.expanded||{};
  var visible=rows.slice(0,limit).map(function(row){return Object.assign({},row);}),positions={},links=[];
  var days={},years={};
  visible.forEach(function(row){if(row.time){var day=date.formatDate(row.time);days[day]=(days[day]||0)+1;years[new Date(row.time).getFullYear()]=true;}});
  visible.forEach(function(row,index){
    if(row.kind==='operation')positions[row.eventId]=index;
    row.shortDate=row.time ? date.formatShort(row.time) : '时间未记';
    var detail=[];
    if(row.time && Object.keys(years).length>1)detail.push(new Date(row.time).getFullYear()+'年');
    if(row.time && days[date.formatDate(row.time)]>1)detail.push(row.date.slice(-5));
    row.dateDetail=detail.join('\n');
  });
  var height=0;
  visible.forEach(function(row){
    var parent=positions[row.eventId];
    if(row.kind==='feeling')row.caption=parent===undefined ? row.note : row.reviewCount>1 || row.executionStatus==='cancelled' ? row.compactNote : '';
    row.top=height;
    row.captionTop=row.dateDetail.split('\n').length>1 ? 101 : row.dateDetail ? 77 : 61;
    // Keep enough space for notes and same-day times, without reserving empty lines.
    row.height=row.kind==='operation' ? 94 : row.caption ? (row.dateDetail ? 110 : 94) : 78;
    if(row.dateDetail.split('\n').length>1)row.height=Math.max(row.height,132);
    if(row.kind==='feeling'){
      row.annotation=[row.reason,row.memo].filter(Boolean).join(' · ');
      var measured=measurements[row.id];
      row.memoExpanded=!!expanded[row.id];
      row.memoExpandable=!!(measured&&measured.memoExpandable);
      if(row.caption||row.annotation){
        var bodyHeight;
        if(measured){
          var memoHeight=row.memoExpanded ? measured.fullMemoHeight : Math.min(measured.fullMemoHeight,measured.lineHeight*3);
          bodyHeight=measured.baseHeight+memoHeight+(row.memoExpandable?60:0);
        }else{
          bodyHeight=(row.caption?25:0)+(row.annotation?82:0);
        }
        row.height=Math.max(row.height,Math.ceil(row.captionTop+bodyHeight+20));
      }
    }
    height+=row.height;
  });
  visible.forEach(function(row){
    var parent=positions[row.eventId];
    if(row.kind!=='feeling'||parent===undefined)return;
    var operation=visible[parent];operation.hasLink=true;
    links.push({id:row.id,top:Math.min(row.top,operation.top)+31,height:Math.abs(operation.top-row.top),reverse:operation.top<row.top,cancelled:operation.status==='cancelled'});
  });
  return {rows:visible,links:links,height:height,hasMore:visible.length<rows.length,total:rows.length};
}
module.exports={build:build,layout:layout};
