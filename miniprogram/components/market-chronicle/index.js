var markets=require('../../config/market-indices');
var model=require('../../utils/market-chronicle');
var service=require('../../services/market-chronicle-service');
var systemHistory=require('../../utils/market-history');
var systemService=require('../../services/market-history-service');
var requestId=require('../../utils/request-id');
var sources=[{key:'both',label:'叠加看'},{key:'system',label:'只看系统'},{key:'mine',label:'只看我的'}];
function localDate(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
Component({
  data:{markets:markets,market:'US',index:'IXIC',marketLabel:'美股',indexLabel:'纳指',indexName:'纳斯达克综合指数',indices:markets[0].indices,
    year:localDate().slice(0,4),today:localDate(),mode:'chart',sort:'time',pickerOpen:false,pickerMarket:'US',
    loading:true,loaded:false,loadFailed:false,rows:[],graph:{points:[],ticks:[],xTicks:[]},selected:null,selectedDate:'',expanded:'',
    editorOpen:false,draft:{date:'',close:'',amount:'',sign:'',note:''},saveDisabled:true,saving:false,pending:false,conflict:false,formError:'',storageWarning:false,
    message:'',canUndo:false,
    sources:sources,source:'both',sourceIndex:0,systemIndex:true,systemVisible:false,systemLoading:false,systemFailed:false,
    systemAsOf:'',systemRows:[],systemSelected:null,systemDate:'',systemExpanded:'',weekMode:'line',weekTicks:[],weekAxis:[],weekPins:[],weekLabels:[],showWeekTitles:true,weekEventDates:[],weekSelectedX:null,weekReadout:null},
  lifetimes:{
    attached:function(){
      var self=this;self._alive=true;self._version=0;self._records=[];self._drafts={};
      self._system=systemService.snapshot();
      self._renderSystem();self._loadSystem(false);
      getApp().waitForLogin().then(function(){
        if(!self._alive)return;
        self._owner=service.owner();
        var saved=service.readState(),market=markets.find(function(m){return m.key===saved.market;})||markets[0];
        var index=market.indices.find(function(i){return i.key===saved.index;})||market.indices[0];
        self._drafts=saved.drafts&&typeof saved.drafts==='object'?saved.drafts:{};
        self.setData({market:market.key,index:index.key,year:/^\d{4}$/.test(saved.year || '')?saved.year:localDate().slice(0,4),mode:saved.mode==='timeline'?'timeline':'chart',showWeekTitles:self._weekTitlesTouched?self.data.showWeekTitles:saved.showWeekTitles!==false});
        self._context();self._restoreSource(self._sourcePreference||saved.source);self._load(false);
        if(self._sourceTouched)self._remember();
      }).catch(function(){if(self._alive)self.setData({loading:false,loadFailed:true});});
    },
    detached:function(){clearTimeout(this._draftTimer);this._remember(true);this._alive=false;this._version++;}
  },
  pageLifetimes:{show:function(){if(this._owner&&this._live())this._load(false);if(this._alive)this._loadSystem(false);},hide:function(){clearTimeout(this._draftTimer);this._remember();},resize:function(){this._drawWeekChart();}},
  methods:{
    _live:function(){return this._alive&&this._owner===service.owner();},
    _key:function(){return this.data.market+':'+this.data.index+':'+this.data.year;},
    _remember:function(silent){
      clearTimeout(this._draftTimer);
      if(!this._live())return;
      var d=this.data;var saved={market:d.market,index:d.index,year:d.year,mode:d.mode,source:this._sourcePreference||'both',showWeekTitles:d.showWeekTitles,drafts:this._drafts};
      var warning=!service.writeState(saved);
      if(!silent&&warning!==this.data.storageWarning)this.setData({storageWarning:warning});
    },
    _context:function(){
      var market=markets.find(function(m){return m.key===this.data.market;},this),index=market.indices.find(function(i){return i.key===this.data.index;},this);
      this.setData({marketLabel:market.label,indexLabel:index.label,indexName:index.name,indices:market.indices,pickerMarket:market.key,systemIndex:market.key==='US'&&index.key==='IXIC'});
    },
    _load:function(force){
      var self=this,market=self.data.market,year=self.data.year,version=++self._version;
      self.setData({loading:!self.data.rows.length,loadFailed:false});
      return getApp().waitForLogin().then(function(){
        if(!self._owner)self._owner=service.owner();
        return service.list(market,year,force);
      }).then(function(res){
        if(!self._live()||version!==self._version)return;
        if(!res.success)throw Error(res.error);
        self._records=res.data.rows;
        self.setData({loading:false,loaded:true,loadFailed:false,today:res.data.today});self._render();
        if(self.data.editorOpen)self._restoreEditor();
      }).catch(function(){if(self._alive&&version===self._version)self.setData({loading:false,loadFailed:true});}).then(function(){wx.stopPullDownRefresh();});
    },
    refresh:function(){return Promise.all([this._load(true),this._loadSystem(true)]);},
    retrySystem:function(){return this._loadSystem(true);},
    _render:function(){
      var rows=model.decorate(this._records,this.data.index,this.data.sort),selected=rows.find(function(r){return r.date===this.data.selectedDate;},this)||rows.slice().sort(function(a,b){return b.date.localeCompare(a.date);})[0]||null;
      this.setData({rows:rows,graph:model.chart(rows,this.data.year),selected:selected,selectedDate:selected?selected.date:''});
      this._renderSystem();
    },
    _restoreSource:function(key){
      this._sourcePreference=sources.some(function(source){return source.key===key;})?key:'both';
      this.setData(this._sourcePatch());
      this._renderSystem();
      this._loadSystem(false);
    },
    _sourcePatch:function(){
      var key=this._manifestMissing?'mine':this._sourcePreference||'both';
      return {source:key,sourceIndex:sources.findIndex(function(source){return source.key===key;})};
    },
    chooseSource:function(e){
      var key=sources[Number(e.detail.value)];
      if(!key)return;
      this._sourceTouched=true;
      this._sourcePreference=key.key;
      var patch=this._sourcePatch();
      if(key.key==='mine'&&this.data.systemDate)patch.selectedDate=this.data.systemDate;
      this.setData(patch,function(){
        if(!this._alive)return;
        this._render();
        this._loadSystem(this._manifestMissing);
      }.bind(this));
      this._remember();
    },
    _loadSystem:function(force){
      if(!this.data.systemIndex||this._sourcePreference==='mine')return Promise.resolve();
      if(this._systemRequest)return this._systemRequest;
      var self=this;
      self.setData({systemLoading:!self._system,systemFailed:false});
      self._systemRequest=systemService.refresh(force).then(function(result){
        self._systemRequest=null;
        if(!self._alive)return;
        self._system=result.entry;
        self._manifestMissing=!!result.manifestMissing;
        self.setData(Object.assign(self._sourcePatch(),{systemLoading:false,systemFailed:!!result.failed}));
        self._renderSystem();
      });
      return self._systemRequest;
    },
    _renderSystem:function(){
      var d=this.data,entry=this._system;
      if(!d.systemIndex||d.source==='mine'||!entry){
        this._weekChart=null;
        if(d.systemVisible||d.systemAsOf)this.setData({systemVisible:false,systemAsOf:'',systemRows:[],systemSelected:null});
        return;
      }
      if(!this._systemYear||this._systemYear.entry!==entry||this._systemYear.year!==d.year){
        this._systemYear={entry:entry,year:d.year,data:systemHistory.yearHistory(entry.pack,d.year)};
      }
      var year=this._systemYear.data;
      if(!year.weekly.length){
        this._weekChart=null;
        this.setData({systemVisible:false,systemAsOf:entry.manifest.asOf,systemRows:[],systemSelected:null});
        return;
      }
      var personal=d.source==='both'&&this._owner&&this._live()?d.rows:[];
      var rows=systemHistory.timeline(year.events,personal,d.sort);
      var redraw=!d.systemVisible||!this._weekChart||this._weekChart.year!==year||this._weekChart.mode!==d.weekMode;
      if(redraw){
        this._weekChart=systemHistory.chart(year.weekly,d.weekMode);
        this._weekChart.year=year;
        this._weekChart.mode=d.weekMode;
      }
      this._weekGroups=systemHistory.eventsByWeek(year.weekly,rows);
      var axis=this._weekChart.axis.map(function(tick){
        return Object.assign({},tick,{label:tick.date===entry.manifest.asOf?tick.label+' 最新':tick.label});
      });
      var selected=this._systemSelection(rows,year.weekly,d.systemDate);
      this.setData(Object.assign({systemVisible:true,systemAsOf:entry.manifest.asOf,systemRows:rows,
        weekTicks:this._weekChart.ticks,weekAxis:axis,
        weekPins:redraw?[]:d.weekPins,weekLabels:redraw||selected.systemDate!==d.systemDate?[]:d.weekLabels},selected),this._drawWeekChart.bind(this));
    },
    _systemSelection:function(rows,weekly,requestedDate){
      var selected=rows.find(function(row){return row.date===requestedDate;});
      var week=weekly.find(function(bar){return bar.date===requestedDate;});
      if(!selected&&!week)selected=rows.reduce(function(latest,row){
        return !latest||row.date>latest.date?row:latest;
      },null);
      var date=selected?selected.date:week?week.date:weekly[weekly.length-1].date;
      if(selected||!week)week=weekly.find(function(bar){return date>=bar.first&&date<=bar.date;})||null;
      var position=week&&this._weekChart.weeks.find(function(bar){return bar.date===week.date;});
      var group=week&&this._weekGroups[week.date];
      return {
        systemSelected:selected||null,systemDate:date,
        weekSelectedX:position?position.x:null,
        weekEventDates:group?group.dates:[],
        weekReadout:week?{first:week.first,date:week.date,close:model.point(week.close),open:model.point(week.open),
          high:model.point(week.high),low:model.point(week.low)}:null
      };
    },
    chooseWeekMode:function(e){
      this.setData({weekMode:e.currentTarget.dataset.mode});
      this._renderSystem();
    },
    selectSystemDate:function(e){
      var date=e.currentTarget.dataset.date;
      if(!this.data.systemVisible||!this._systemYear)return;
      var selection=this._systemSelection(this.data.systemRows,this._systemYear.data.weekly,date);
      var week=selection.weekReadout&&selection.weekReadout.date;
      this._weekTitleDate=selection.systemSelected?selection.systemDate:'';
      this.setData(Object.assign({selectedDate:date,weekLabels:this._weekLabels(this.data.weekPins,selection.systemDate,week)},selection));
    },
    toggleWeekTitles:function(){
      this._weekTitlesTouched=true;
      this._weekTitleDate='';
      var show=!this.data.showWeekTitles,week=this.data.weekReadout&&this.data.weekReadout.date;
      this.setData({showWeekTitles:show,weekLabels:show?this._weekLabels(this.data.weekPins,this.data.systemDate,week,true):[]});
      this._remember();
    },
    _weekLabels:function(pins,date,week,showAll=this.data.showWeekTitles){
      var size=this._weekPlotSize;
      if(!size||!this._weekGroups||(!showAll&&this._weekTitleDate!==date))return [];
      return systemHistory.weekLabels(pins,this._weekGroups,size.width,size.height,date,week,!showAll);
    },
    toggleSystemEvent:function(e){
      var date=e.currentTarget.dataset.date;
      this.setData({systemExpanded:this.data.systemExpanded===date?'':date});
    },
    selectWeekPin:function(e){this._selectWeek(e.currentTarget.dataset.week);},
    _selectWeek:function(week){
      var group=this._weekGroups[week],date=week;
      if(group){
        var active=group.dates.find(function(day){return day.date===this.data.systemDate;},this);
        date=(active||group.dates[group.dates.length-1]).date;
      }
      this.selectSystemDate({currentTarget:{dataset:{date:date}}});
    },
    selectWeekPlot:function(e){
      var self=this,chart=self._weekChart;
      if(!chart)return;
      var touch=e.changedTouches&&e.changedTouches[0],detail=e.detail||{};
      var clientX=touch?touch.clientX:detail.x,clientY=touch?touch.clientY:detail.y;
      self.createSelectorQuery().select('.mc-week-plot').boundingClientRect(function(rect){
        if(!rect||!rect.width||self._weekChart!==chart||!model.known(clientX))return;
        if(model.known(clientY)){
          var nearestPin=null,distance=22;
          self.data.weekPins.forEach(function(pin){
            var delta=Math.hypot(clientX-rect.left-pin.pixelX,clientY-rect.top-pin.pixelY);
            if(delta<distance){distance=delta;nearestPin=pin;}
          });
          if(nearestPin){self._selectWeek(nearestPin.week);return;}
        }
        var x=(clientX-rect.left)/rect.width*100;
        var nearest=chart.weeks.reduce(function(best,item){
          return Math.abs(item.x-x)<=Math.abs(best.x-x)?item:best;
        });
        self._selectWeek(nearest.date);
      }).exec();
    },
    _drawWeekChart:function(){
      var self=this,chart=self._weekChart;
      if(!chart||self.data.mode!=='chart'||self.data.editorOpen)return;
      var draw=(self._drawVersion||0)+1;
      self._drawVersion=draw;
      self.createSelectorQuery().select('.mc-week-canvas').fields({node:true,size:true}).exec(function(result){
        var canvas=result&&result[0];
        if(!canvas||!canvas.node||!canvas.width||self._weekChart!==chart||self._drawVersion!==draw||!self._alive)return;
        var ratio=Math.min(3,wx.getWindowInfo().pixelRatio||1);
        canvas.node.width=canvas.width*ratio;canvas.node.height=canvas.height*ratio;
        var ctx=canvas.node.getContext('2d');
        ctx.scale(ratio,ratio);
        var width=canvas.width/100,height=canvas.height/100;
        if(self.data.weekMode==='line'){
          ctx.strokeStyle='#477269';ctx.lineWidth=1.8;ctx.lineJoin='round';
          ctx.beginPath();
          chart.weeks.forEach(function(w,i){ctx[i?'lineTo':'moveTo'](w.x*width,w.close*height);});
          ctx.stroke();
          if(chart.weeks.length===1){
            var only=chart.weeks[0];
            ctx.fillStyle='#477269';ctx.fillRect(only.x*width-2,only.close*height-2,4,4);
          }
        }else{
          var candleWidth=Math.max(2,Math.min(8,canvas.width*.54/chart.weeks.length));
          chart.weeks.forEach(function(w){
            var x=w.x*width,color=w.trend==='up'?'#b7473f':w.trend==='down'?'#24734f':'#75847b';
            ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1;
            ctx.beginPath();ctx.moveTo(x,w.high*height);ctx.lineTo(x,w.low*height);ctx.stroke();
            ctx.fillRect(x-candleWidth/2,Math.min(w.open,w.close)*height,candleWidth,Math.max(1,Math.abs(w.open-w.close)*height));
          });
        }
        self._weekPlotSize={width:canvas.width,height:canvas.height};
        var pins=systemHistory.weekPins(chart.weeks,self._weekGroups,canvas.width,canvas.height,chart.mode);
        var week=self.data.weekReadout&&self.data.weekReadout.date;
        self.setData({weekPins:pins,weekLabels:self._weekLabels(pins,self.data.systemDate,week)});
      });
    },
    togglePicker:function(){if(this.data.saving||this.data.pending)return;this.setData({pickerOpen:!this.data.pickerOpen,editorOpen:false},this._drawWeekChart.bind(this));},
    chooseMarket:function(e){
      var m=markets.find(function(m){return m.key===e.currentTarget.dataset.market;});if(!m)return;
      this.setData({pickerMarket:m.key,indices:m.indices});
    },
    chooseIndex:function(e){
      if(this.data.saving||this.data.pending)return;
      var market=this.data.pickerMarket,index=e.currentTarget.dataset.index;
      if(!markets.find(function(m){return m.key===market;}).indices.some(function(i){return i.key===index;}))return;
      var changedMarket=market!==this.data.market;
      this._weekTitleDate='';
      this.setData({market:market,index:index,pickerOpen:false,editorOpen:false,formError:'',conflict:false,message:'',canUndo:false,rows:changedMarket?[]:this.data.rows,selectedDate:'',systemDate:'',systemExpanded:''});
      this._undo=null;this._context();this._remember();
      if(changedMarket){this._records=[];this._load(false);}
      this._render();this._loadSystem(false);
    },
    chooseYear:function(e){
      if(this.data.saving||this.data.pending)return;
      var year=String(e.detail.value).slice(0,4);if(year===this.data.year)return;
      this._weekTitleDate='';
      this.setData({year:year,rows:[],loaded:false,editorOpen:false,selectedDate:'',systemDate:'',systemExpanded:'',message:'',canUndo:false});this._records=[];this._undo=null;this._remember();this._render();this._load(false);
    },
    chooseMode:function(e){this.setData({mode:e.currentTarget.dataset.mode},this._drawWeekChart.bind(this));this._remember();},
    toggleSort:function(){this.setData({sort:this.data.sort==='time'?'magnitude':'time'});this._render();},
    selectDate:function(e){this.setData({selectedDate:e.currentTarget.dataset.date});this._render();},
    selectPlot:function(e){
      var self=this,points=self.data.graph.points;if(!points.length)return;
      self.createSelectorQuery().select('.mc-plot').boundingClientRect(function(rect){
        if(!rect||!self._live())return;var t=e.changedTouches&&e.changedTouches[0],x=(t?t.clientX:e.detail.x)-rect.left,y=(t?t.clientY:e.detail.y)-rect.top;
        var closest=points.slice().sort(function(a,b){return Math.hypot(a.x*rect.width/100-x,a.y*rect.height/100-y)-Math.hypot(b.x*rect.width/100-x,b.y*rect.height/100-y);})[0];
        self.setData({selectedDate:closest.date});self._render();
      }).exec();
    },
    toggleEvent:function(e){var date=e.currentTarget.dataset.date;this.setData({expanded:this.data.expanded===date?'':date});},
    openEditor:function(){
      if(!this._owner){wx.showToast({title:'正在连接，请稍后再试',icon:'none'});return;}
      this.setData({editorOpen:true,pickerOpen:false,message:''});this._restoreEditor();
    },
    _restoreEditor:function(){
      var d=this._drafts[this._key()];
      if(!d){d={date:this.data.year===this.data.today.slice(0,4)?this.data.today:this.data.year+'-12-31',close:'',amount:'',sign:'',note:'',revision:0,editing:false};this._drafts[this._key()]=d;}
      this.setData({draft:d,pending:!!d.request,conflict:!!d.conflict,formError:'',saveDisabled:!!model.validate(d,this.data.today)});
    },
    closeEditor:function(){if(this.data.saving)return;this._remember();this.setData({editorOpen:false},this._drawWeekChart.bind(this));},
    editRecord:function(e){
      if(this.data.saving||this.data.pending)return;
      var date=e.currentTarget.dataset.date||this.data.selectedDate,row=this._records.find(function(r){return r.date===date;});if(!row)return;
      var q=row.quotes[this.data.index]||{};
      var d={date:date,close:model.known(q.close)?String(q.close):'',amount:model.known(q.change)?String(Math.abs(q.change)):'',sign:model.known(q.change)?q.change<0?'-1':'1':'',note:row.note || '',revision:row.revision,editing:true,hasQuote:!!row.quotes[this.data.index]};
      this._drafts[this._key()]=d;this.setData({editorOpen:true,pickerOpen:false,message:''});this._restoreEditor();this._remember();
      wx.pageScrollTo({scrollTop:0,duration:180});
    },
    changeDate:function(e){
      if(this.data.saving||this.data.pending||this.data.draft.editing)return;
      this._input('date',e.detail.value);
    },
    inputField:function(e){if(this.data.saving||this.data.pending)return;this._input(e.currentTarget.dataset.field,e.detail.value);},
    chooseSign:function(e){if(this.data.saving||this.data.pending)return;this._input('sign',e.currentTarget.dataset.sign);},
    _input:function(field,value){
      var d=Object.assign({},this.data.draft);d[field]=value;
      this._drafts[this._key()]=d;this.setData({draft:d,saveDisabled:!!model.validate(d,this.data.today),formError:''});
      clearTimeout(this._draftTimer);var self=this;this._draftTimer=setTimeout(function(){self._remember();},180);
    },
    save:function(){
      if(this.data.saving)return;
      var d=this.data.draft,error=model.validate(d,this.data.today);if(error){this.setData({formError:error});return;}
      var existing=this._records.find(function(r){return r.date===d.date;});
      if(!d.editing&&existing&&existing.quotes[this.data.index]&&!d.request){this.setData({formError:'这一天已有记录，点下面载入后更正。',conflict:true});return;}
      var p=d.request || {market:this.data.market,index:this.data.index,date:d.date,close:d.close===''?null:Number(d.close),change:d.amount===''?null:Number(d.sign || '1')*Number(d.amount),note:d.note,revision:d.editing?d.revision:existing?existing.revision:0,request_id:requestId.create('market')};
      if(!d.request)p.preserve_note=!d.editing;
      d.request=p;this._drafts[this._key()]=d;this._remember();return this._mutate(d.requestAction || 'saveMarketChronicle',p);
    },
    _mutate:function(action,p){
      var self=this,key=self._key();self.setData({saving:true,formError:'',pending:true});
      return service.mutate(action,p).then(function(res){
        if(!self._live())return;
        if(!res.success){
          var conflict=['RECORD_CHANGED','REQUEST_CONFLICT','REQUEST_UNDONE'].indexOf(res.error)>=0;
          var invalid=['VALIDATION_ERROR','INVALID_DATE','NOT_FOUND'].indexOf(res.error)>=0;
          if((conflict||invalid)&&self._drafts[key]){delete self._drafts[key].request;delete self._drafts[key].requestAction;self._drafts[key].conflict=conflict;if(res.error==='NOT_FOUND')self._drafts[key].hasQuote=false;}
          self.setData({draft:self._drafts[key]||self.data.draft,saving:false,pending:!conflict&&!invalid,conflict:conflict,formError:conflict?'这一天的记录已更新，请载入最新内容后再改。':invalid?'请检查交易日期和数值后再保存，输入已保留。':'暂时没能保存，输入已保留，请重试。'});self._remember();return;
        }
        delete self._drafts[key];self._undo={market:p.market,index:p.index,date:p.date,revision:res.data.row.revision,request_id:p.request_id};
        var changedYear=p.date.slice(0,4)!==self.data.year;
        if(changedYear){self._version++;self._records=[];}
        self._records=self._records.filter(function(r){return r.date!==p.date;}).concat([res.data.row]);
        self.setData({year:p.date.slice(0,4),saving:false,pending:false,editorOpen:false,conflict:false,selectedDate:p.date,systemDate:p.date,expanded:p.date,canUndo:true,message:action==='deleteMarketChronicle'?'已删除本指数这一天的记录':'已保存到'+p.date.slice(0,4)+'年大事记'},self._drawWeekChart.bind(self));
        self._render();self._remember();if(changedYear)self._load(true);
      });
    },
    loadLatest:function(){
      var self=this,date=self.data.draft.date;
      self._drafts[self._key()]=Object.assign({},self.data.draft,{request:null,conflict:false});
      self.setData({pending:false,year:date.slice(0,4)});
      return self._load(true).then(function(){if(!self._live()||self.data.loadFailed)return;self.editRecord({currentTarget:{dataset:{date:date}}});});
    },
    undo:function(){
      if(this.data.saving||!this._undo)return;var self=this,p=self._undo;
      self.setData({saving:true});return service.mutate('undoMarketChronicle',p).then(function(res){
        if(!self._live())return;
        self.setData({saving:false});
        if(!res.success){self.setData({message:res.error==='RECORD_CHANGED'?'记录已有后续更改，无法撤销':'撤销暂时失败，点此重试',canUndo:res.error!=='RECORD_CHANGED'});return;}
        self._records=self._records.filter(function(r){return r.date!==p.date;}).concat([res.data.row]);self._undo=null;self.setData({canUndo:false,message:'已撤销刚才的更改'});self._render();
      });
    },
    deleteRecord:function(){
      if(this.data.saving||this.data.pending)return;var self=this,d=self.data.draft;if(!d.editing||!d.hasQuote)return;
      wx.showModal({title:'删除这一天的'+self.data.indexLabel+'记录？',content:'其他指数的数据保留，删除后可撤销。',confirmText:'删除',confirmColor:'#a6534d',success:function(r){if(!r.confirm||!self._live())return;var p={market:self.data.market,index:self.data.index,date:d.date,revision:d.revision,request_id:requestId.create('market_delete')};d.request=p;d.requestAction='deleteMarketChronicle';self._drafts[self._key()]=d;self._remember();self._mutate('deleteMarketChronicle',p);}});
    }
  }
});
