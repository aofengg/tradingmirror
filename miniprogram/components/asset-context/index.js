var assets = require('../../services/asset-service');
Component({
  properties: {
    symbol: {type:String,value:'',observer:function(){this.schedule();}},
    assetKey: {type:String,value:'',observer:function(){this.schedule();}},
    compact: {type:Boolean,value:false}
  },
  data:{loading:false,failed:false,summary:null,key:''},
  lifetimes:{attached:function(){this._alive=true;this._version=0;this.schedule();},detached:function(){this._alive=false;clearTimeout(this._timer);this._version++;}},
  pageLifetimes:{show:function(){if(this._alive)this.schedule();}},
  methods:{
    schedule:function(){
      if(!this._alive)return;
      clearTimeout(this._timer);this._version++;
      this.setData({summary:null,failed:false,key:'',loading:!!this.data.symbol});
      if(!this.data.symbol)return;
      var self=this;this._timer=setTimeout(function(){self.refresh();},350);
    },
    refresh:function(){
      var self=this;var version=++this._version;var symbol=this.data.symbol;
      this.setData({loading:true,failed:false});
      assets.context({symbol:symbol,key:this.data.assetKey||undefined}).then(function(result){
        if(!self._alive||version!==self._version)return;
        self.setData({loading:false,summary:result.summary,key:result.key});
        self.triggerEvent('resolved',{key:result.key,symbol:symbol});
      }).catch(function(){if(self._alive&&version===self._version)self.setData({loading:false,failed:true});});
    },
    open:function(){if(this.data.key&&this.data.summary)assets.open(this.data.key,true);}
  }
});
