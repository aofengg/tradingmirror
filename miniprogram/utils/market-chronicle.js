function known(v) { return typeof v === 'number' && isFinite(v); }
function point(v) { return known(v) ? v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',') : '未填'; }
function percent(v) { return known(v) ? (v>0?'＋':v<0?'−':'')+Math.abs(v).toFixed(2)+'%' : '涨跌幅未填'; }
function trend(v) { return !known(v)?'unknown':v>0?'up':v<0?'down':'flat'; }
function day(v) { return Date.parse(v+'T12:00:00Z'); }
function decorate(rows, index, sort) {
  var list = Array.from(rows).filter(function(r){return Object.keys(r.quotes || {}).length;}).map(function(r) {
    var q = r.quotes[index] || {};
    return {
      date:r.date,shortDate:r.date.slice(5).replace('-','.'),note:r.note||'',
      closeText:point(q.close),hasClose:known(q.close),hasChange:known(q.change),
      changeText:percent(q.change),trend:trend(q.change),
      value:known(q.close)?q.close:null,change:known(q.change)?q.change:null,hasQuote:!!r.quotes[index]
    };
  });
  list.sort(function(a,b){return a.date.localeCompare(b.date);});
  list.forEach(function(r,i){r.gap = i<list.length-1 ? Math.round((day(list[i+1].date)-day(r.date))/86400000) : 0;});
  if(sort==='magnitude')list.sort(function(a,b){return (b.hasChange?Math.abs(b.change):-1)-(a.hasChange?Math.abs(a.change):-1)||a.date.localeCompare(b.date);});
  return list;
}
function chart(rows, year) {
  var points = rows.filter(function(r){return r.hasClose;});
  if (!points.length) return {points:[],ticks:[],xTicks:[],missing:rows.length};
  var values=points.map(function(p){return p.value;}),min=Math.min.apply(null,values),max=Math.max.apply(null,values),pad=(max-min || max*.04)*.15;
  var lo=Math.max(0,min-pad),hi=max+pad,start=day(year+'-01-01'),end=day(year+'-12-31');
  var ticks=[0,1/3,2/3,1].map(function(r){return {y:4+r*92,label:point(hi-r*(hi-lo)).replace(/\.00$/,'')};});
  var xTicks=['01-01','05-01','09-01','12-31'].map(function(d){return {x:4+(day(year+'-'+d)-start)/(end-start)*92,label:d.replace('-','/')};});
  return {points:points.map(function(p){return {date:p.date,x:4+(day(p.date)-start)/(end-start)*92,y:4+(hi-p.value)/(hi-lo)*92,trend:p.trend};}),ticks:ticks,xTicks:xTicks,missing:rows.length-points.length};
}
function validate(d, today) {
  var parsed=Date.parse(d.date+'T12:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '') || !isFinite(parsed) || new Date(parsed).toISOString().slice(0,10)!==d.date || d.date<'1900-01-01' || d.date>today)return '请选择有效的交易日期。';
  var hasClose=d.close!=='',hasChange=d.amount!=='';
  if(!hasClose&&!hasChange)return '收盘点位、涨跌幅，至少填一项。';
  if(hasClose&&(!isFinite(Number(d.close))||Number(d.close)<=0||Number(d.close)>1e9))return '请填写有效的收盘点位。';
  if(hasChange&&(!isFinite(Number(d.amount))||Number(d.amount)<0||Number(d.amount)>1e6||Number(d.amount)>0&&['1','-1'].indexOf(d.sign)===-1))return '请填写幅度，并选择上涨或下跌。';
  if(hasChange&&d.sign==='-1'&&Number(d.amount)>100)return '下跌幅度不能超过100%。';
  if(String(d.note || '').length>200)return '观察最多填写200字。';
  return '';
}
module.exports={known:known,point:point,percent:percent,trend:trend,decorate:decorate,chart:chart,validate:validate};
