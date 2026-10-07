var overview=require('../../services/asset-overview-service');
var chart=require('../../utils/asset-overview');
Component({
  properties:{assetKey:{type:String,value:''},refreshToken:{type:Number,value:0}},
  observers:{'assetKey, refreshToken':function(){if(this._alive)this.refresh();}},
  data:{loading:false,failed:false,collapsed:true,rows:[],links:[],height:0,hasMore:false,total:0},
  lifetimes:{attached:function(){this._alive=true;this._version=0;this._limit=6;this.refresh();},detached:function(){this._alive=false;this._version++;}},
  methods:{
    refresh:function(){
      var self=this,key=this.data.assetKey,version=++this._version;
      if(!key)return;
      if(this._key!==key){this._key=key;this._limit=6;this._rows=[];this.setData({rows:[],links:[],height:0,total:0,hasMore:false});}
      this._needsRefresh=true;
      if(this.data.collapsed){this.setData({loading:false});return;}
      this.setData({loading:true,failed:false});
      function current(){return self._alive&&version===self._version;}
      overview.load(key,current).then(function(result){
        if(!current()||!result)return;
        self._rows=chart.build(result.events,result.reflections);
        self._needsRefresh=false;
        self.setData(Object.assign({loading:false,failed:false},chart.layout(self._rows,self._limit)));
      }).catch(function(){if(current())self.setData({loading:false,failed:true});});
    },
    toggle:function(){var collapsed=!this.data.collapsed;this.setData({collapsed:collapsed});if(!collapsed&&this._needsRefresh)this.refresh();},
    more:function(){this._limit+=6;this.setData(chart.layout(this._rows||[],this._limit));},
    open:function(event){this.triggerEvent('openrecord',{id:event.currentTarget.dataset.id});}
  }
});
