var overview=require('../../services/asset-overview-service');
var chart=require('../../utils/asset-overview');
Component({
  properties:{assetKey:{type:String,value:''},refreshToken:{type:Number,value:0}},
  observers:{'assetKey, refreshToken':function(){if(this._alive)this.refresh();}},
  data:{loading:false,failed:false,collapsed:true,rows:[],links:[],height:0,hasMore:false,total:0},
  lifetimes:{
    attached:function(){this._alive=true;this._version=0;this._measureVersion=0;this._limit=6;this._expanded={};this._measurements={};this.refresh();},
    detached:function(){this._alive=false;this._version++;this._measureVersion++;}
  },
  pageLifetimes:{show:function(){this._measure();},resize:function(){this._measure();}},
  methods:{
    refresh:function(){
      var self=this,key=this.data.assetKey,version=++this._version;
      if(!key)return;
      if(this._key!==key){this._key=key;this._limit=6;this._rows=[];this._expanded={};this._measurements={};this.setData({rows:[],links:[],height:0,total:0,hasMore:false});}
      this._needsRefresh=true;
      if(this.data.collapsed){this.setData({loading:false});return;}
      this.setData({loading:true,failed:false});
      function current(){return self._alive&&version===self._version;}
      overview.load(key,current).then(function(result){
        if(!current()||!result)return;
        self._rows=chart.build(result.events,result.reflections);
        self._measurements={};
        self._needsRefresh=false;
        self._render({loading:false,failed:false});
      }).catch(function(){if(current())self.setData({loading:false,failed:true});});
    },
    _render:function(extra){
      var self=this;
      this._measureVersion++;
      var result=chart.layout(this._rows||[],this._limit,{expanded:this._expanded,measurements:this._measurements});
      this.setData(Object.assign({},extra||{},result),function(){self._measure();});
    },
    _measure:function(){
      if(!this._alive||this.data.collapsed||!this.data.rows.length||!this.createSelectorQuery)return;
      var self=this,version=this._version,measureVersion=++this._measureVersion;
      var query=this.createSelectorQuery();
      query.selectAll('.overview__details').fields({rect:true,size:true,dataset:true});
      query.selectAll('.overview__memo-text').fields({rect:true,size:true,dataset:true,computedStyle:['line-height']});
      query.selectAll('.overview__memo-measure').fields({rect:true,size:true,dataset:true});
      query.selectAll('.overview__memo-toggle').fields({rect:true,size:true,dataset:true});
      query.select('.overview__dot').fields({rect:true,size:true});
      query.exec(function(results){
        if(!self._alive||self.data.collapsed||version!==self._version||measureVersion!==self._measureVersion)return;
        var info=wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        if(!info.windowWidth||!results||!results[0])return;
        function extent(item,axis){
          if(!item)return 0;
          var value=item[axis];
          if(typeof value==='number'&&isFinite(value))return value;
          value=axis==='height' ? item.bottom-item.top : item.right-item.left;
          return isFinite(value) ? Math.max(0,value) : 0;
        }
        // Measure the rendered rpx unit; IDE window reports can differ from its DOM viewport.
        var markerWidth=extent(results[4],'width');
        var scale=markerWidth>0 ? 16/markerWidth : 750/info.windowWidth;
        var next=Object.assign({},self._measurements),memo={},full={},buttons={};
        (results[1]||[]).forEach(function(item){memo[item.dataset.rowId]=item;});
        (results[2]||[]).forEach(function(item){full[item.dataset.rowId]=item;});
        (results[3]||[]).forEach(function(item){buttons[item.dataset.rowId]=item;});
        function rpx(value){return Math.round(value*scale*100)/100;}
        results[0].forEach(function(item){
          var id=item.dataset.rowId,text=memo[id],complete=full[id],button=buttons[id];
          var lineHeight=text ? parseFloat(text['line-height']) : 0;
          var bodyHeight=extent(item,'height'),textHeight=extent(text,'height'),fullHeight=extent(complete,'height');
          if(bodyHeight<=0)return;
          if(text&&(!complete||fullHeight<=0||textHeight<=0||!isFinite(lineHeight)||lineHeight<=0))return;
          next[id]={
            baseHeight:rpx(Math.max(0,bodyHeight-textHeight-extent(button,'height'))),
            fullMemoHeight:complete?rpx(fullHeight):0,
            lineHeight:rpx(lineHeight),
            memoExpandable:!!(complete&&fullHeight>lineHeight*3+0.5)
          };
        });
        self._measurements=next;
        var layout=chart.layout(self._rows||[],self._limit,{expanded:self._expanded,measurements:next});
        function signature(rows){return JSON.stringify(rows.map(function(row){return [row.id,row.top,row.height,row.memoExpandable,row.memoExpanded];}));}
        if(signature(layout.rows)!==signature(self.data.rows))self.setData(layout,function(){self._measure();});
      });
    },
    toggle:function(){var collapsed=!this.data.collapsed;this._measureVersion++;this.setData({collapsed:collapsed});if(!collapsed){if(this._needsRefresh)this.refresh();else this._measure();}},
    more:function(){this._limit+=6;this._render();},
    toggleMemo:function(event){
      var id=event.currentTarget.dataset.rowId;
      var row=this.data.rows.filter(function(item){return item.id===id;})[0];
      if(!row||!row.annotation)return;
      if(!row.memoExpandable){this.open(event);return;}
      this._expanded=this._expanded||{};
      this._expanded[id]=!row.memoExpanded;
      this._render();
    },
    open:function(event){this.triggerEvent('openrecord',{id:event.currentTarget.dataset.id});}
  }
});
