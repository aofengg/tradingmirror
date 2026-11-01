var service=require('../../services/ai-review-service');
var FEELING_COLORS={satisfied:'#9db9ad',acceptable:'#d4d2c3',regret:'#d5b29f',unknown:'#b8bfcb',unreviewed:'#edeae2'};
var REASON_COLORS=['119,154,137','198,165,119','163,155,179','158,166,157'];
function shiftWeek(key,delta){return new Date(Date.parse(key+'T00:00:00Z')+delta*7*86400000).toISOString().slice(0,10);}
function period(first,last){return first.key.slice(0,4)+'/'+first.label+'—'+(last.end_key.slice(0,4)!==first.key.slice(0,4)?last.end_key.slice(0,4)+'/':'')+last.end_key.slice(5).replace(/^0/,'').replace(/-0?/,'/');}
Component({
  properties:{fontScale:{type:Number,value:1,observer:function(){if(this._attached)this._measure();}},sourceVersion:{type:String,value:'',observer:function(value,old){if(this._attached&&value&&old&&value!==old)this.refresh();}}},
  data:{group:'buy',ready:false,loading:false,error:'',rows:[],weeks:[],selected:null,rangeLabel:'',canPrevious:false,canNext:false,scopeOpen:false,scopeText:'',hasUnknown:false,selectedCounts:'',legend:[{key:'satisfied',label:'满意'},{key:'acceptable',label:'可接受'},{key:'regret',label:'懊悔'},{key:'unknown',label:'其他感受'},{key:'unreviewed',label:'未回看'}]},
  lifetimes:{
    attached:function(){this._attached=true;this._active=true;this._serial=0;this._offset=4;this._measure();this._load(null,false);},
    detached:function(){this._detached=true;this._active=false;this._serial++;}
  },
  pageLifetimes:{
    show:function(){if(!this._attached)return;this._active=true;this._load(this._window&&this._window.end_week,false,this._offset);},
    hide:function(){this._active=false;this._serial++;this.setData({loading:false});}
  },
  methods:{
    _measure:function(){
      var width=390;try{width=wx.getSystemInfoSync().windowWidth||390;}catch(error){}
      var scale=this.properties.fontScale||1;
      var columns=(width*.84-2-72*scale-8-18)/4>=44?4:2;
      if(columns!==this._columns){this._columns=columns;if(this._window){var index=this._window.groups[this.data.group].weeks.findIndex(function(w){return w.key===this._selectedKey;},this);this._offset=index>=0?Math.floor(index/columns)*columns:8-columns;this._show(this._offset,this._selectedKey);}}
    },
    _valid:function(serial,owner){return !this._detached&&this._active&&serial===this._serial&&owner===getApp().globalData.openid;},
    _ownerState:function(owner){
      if(owner!==this._owner){this._owner=owner;this._window=null;this._selectedKey='';this._offset=8-this._columns;var group='buy';try{var stored=wx.getStorageSync('review_timeline_group:'+owner);if(stored==='buy'||stored==='sell')group=stored;}catch(error){}this.setData({group:group,ready:false,weeks:[],rows:[],selected:null,error:'',scopeOpen:false});}
    },
    _load:function(end,force,offset){
      if(this._detached||!this._active)return Promise.resolve();
      var knownOwner=getApp().globalData.openid;if(knownOwner!==this._owner){this._ownerState(knownOwner);end=null;offset=undefined;}
      var self=this,serial=++this._serial,owner;
      this._pending={end:end,offset:offset};this.setData({loading:true,error:''});
      return getApp().waitForLogin().then(function(){owner=getApp().globalData.openid;if(!self._valid(serial,owner))return null;if(owner!==self._owner){self._ownerState(owner);end=null;offset=undefined;}return service.timeline(end?{end_week:end}:{},force);}).then(function(res){
        if(!res||!self._valid(serial,owner))return;
        if(!res.success||!res.data||!res.data.groups)throw Error('TIMELINE_UNAVAILABLE');
        var previousVersion=self._window&&self._window.source_version;self._window=res.data;self._show(offset===undefined?8-self._columns:offset,self._selectedKey);self.setData({loading:false,error:''});if(previousVersion&&previousVersion!==res.data.source_version)self.triggerEvent('sourcechange',{source_version:res.data.source_version});
      }).catch(function(){if(self._valid(serial,owner))self.setData({loading:false,error:'状态变化暂时没打开，点此重试。'});});
    },
    refresh:function(){return this._load(this._window&&this._window.end_week,true,this._offset);},
    retry:function(){var query=this._pending||{};return this._load(query.end,true,query.offset);},
    _show:function(offset,selectedKey){
      var value=this._window;if(!value)return;
      var group=value.groups[this.data.group],count=this._columns||4;
      var displayRows=group.rows.filter(function(row){return row.key!=='other'||group.weeks.some(function(w){return w.rows.some(function(r){return r.key==='other'&&r.count>0;});});});
      this._offset=Math.max(0,Math.min(8-count,Math.floor(offset/count)*count));
      var weeks=group.weeks.slice(this._offset,this._offset+count);
      var selected=weeks.find(function(w){return w.key===selectedKey;});
      if(!selected){selected=weeks.slice().reverse().find(function(w){return w.total;})||weeks[weeks.length-1];}
      this._selectedKey=selected.key;
      var decorated=weeks.map(function(week){return Object.assign({},week,{active:week.key===selected.key,aria:week.period+'，'+week.total+'次操作，'+week.rows.map(function(r){return r.label+r.count+'次';}).join('，')+'，后来'+week.feelings.map(function(f){return f.label+f.count+'次';}).join('，'),cells:week.rows.map(function(row,i){return {key:row.key,count:row.count,color:row.count?'rgba('+REASON_COLORS[i]+','+(.12+.54*row.count/week.total).toFixed(3)+')':'#f4f3ed'};}).filter(function(cell){return displayRows.some(function(row){return row.key===cell.key;});}),segments:week.feelings.filter(function(f){return f.count;}).map(function(f){return {key:f.key,percent:100*f.count/week.total,color:FEELING_COLORS[f.key]};})});});
      var excluded=value.excluded||{},extra=[];
      if(excluded.cancelled)extra.push(excluded.cancelled+'条未执行');if(excluded.pending)extra.push(excluded.pending+'条待确认');
      var other=(excluded.unknown_status||0)+(excluded.unknown_action||0)+(excluded.missing_date||0)+(excluded.future||0);if(other)extra.push(other+'条时间或类型未纳入');
      this.setData({ready:true,weeks:decorated,rows:displayRows,selected:Object.assign({},selected,{periodFull:period(selected,selected)}),rangeLabel:period(weeks[0],weeks[weeks.length-1]),canPrevious:this._offset>0||value.has_earlier,canNext:this._offset+count<8||value.has_later,hasUnknown:weeks.some(function(w){return w.feelings.some(function(f){return f.key==='unknown'&&f.count;});}),selectedCounts:selected.feelings.filter(function(f){return f.count;}).map(function(f){return f.label+' '+f.count;}).join(' · '),scopeText:'仅统计已执行操作，共'+value.executed+'次。'+(extra.length?'另有'+extra.join('、')+'。':'')+'动因来自当时选择的理由，不代表情绪强度；后来感受按原操作周归位，不等同于收益。'});
    },
    changeGroup:function(event){
      var group=event.currentTarget.dataset.group;if((group!=='buy'&&group!=='sell')||group===this.data.group)return;
      this.setData({group:group});try{if(this._owner)wx.setStorageSync('review_timeline_group:'+this._owner,group);}catch(error){}
      this._show(this._offset,this._selectedKey);
    },
    selectWeek:function(event){if(!this._window)return;this._show(this._offset,event.currentTarget.dataset.week);},
    previous:function(){if(this.data.loading||!this.data.canPrevious)return;if(this._offset>0){this._show(this._offset-this._columns,'');return;}return this._load(shiftWeek(this._window.start_week,-1),false,8-this._columns);},
    next:function(){if(this.data.loading||!this.data.canNext)return;if(this._offset+this._columns<8){this._show(this._offset+this._columns,'');return;}return this._load(shiftWeek(this._window.end_week,8),false,0);},
    toggleScope:function(){this.setData({scopeOpen:!this.data.scopeOpen});},
    openRecords:function(){if(!this.data.selected||!this.data.selected.total||this.data.loading)return;this.triggerEvent('openrecords',{group:this.data.group,group_label:this._window.groups[this.data.group].label,week:this.data.selected.key,period:this.data.selected.periodFull,total:this.data.selected.total,source_version:this._window.source_version});}
  }
});
