var assets=require('../../services/asset-service');
var api=require('../../utils/cloud-api');
Page({
  data:{overviewRefresh:0,key:'',summary:null,items:[],loading:true,loadingMore:false,failed:false,hasMore:false,cursor:null,fromRecord:false,direction:'desc',filter:'all',mergedSources:[],aliasVisible:false,aliasQuery:'',aliasItems:[],aliasLoading:false,aliasFailed:false,aliasMore:false,aliasCursor:null,merging:false,
    filters:[{key:'all',label:'全部'},{key:'executed',label:'已执行'},{key:'pending',label:'待确认'},{key:'review',label:'待回看'},{key:'cancelled',label:'未执行'}]},
  onLoad:function(options){
    this._version=0;this._aliasVersion=0;
    var key=options.key||''; try { key=decodeURIComponent(key); } catch(e) {}
    this.setData({key:key,fromRecord:options.fromRecord==='1'});
  },
  onShow:function(){var revision=getApp().getPageRevision('records');if(this.data.summary&&this._loadedRevision===revision&&Date.now()-this._lastLoadedAt<30000)return;this.setData({overviewRefresh:this.data.overviewRefresh+1});this.load(false,Math.max(20,this.data.items.length));},
  onUnload:function(){this._version++;this._aliasVersion++;clearTimeout(this._aliasTimer);},
  onPullDownRefresh:function(){assets.clearCache();this.setData({overviewRefresh:this.data.overviewRefresh+1});this.load(false,Math.max(20,this.data.items.length));},
  onReachBottom:function(){if(this.data.hasMore&&!this.data.loadingMore&&!this.data.loading)this.load(true);},
  load:function(append,restoreCount){
    append=append===true;var self=this;var version=++this._version;
    var revision=getApp().getPageRevision('records');
    this.setData({loading:!this.data.items.length,loadingMore:append,failed:false});
    var options={key:this.data.key,status:this.data.filter,direction:this.data.direction,cursor:append?this.data.cursor:null};
    var combined=append?this.data.items.slice():[];
    // On return, refresh as many nodes as were visible so the scroll position survives.
    function next(){return assets.history(options).then(function(result){
      if(version!==self._version)return;
      combined=combined.concat(result.list);
      if(!append&&restoreCount&&combined.length<restoreCount&&result.hasMore){options.cursor=result.nextCursor;return next();}
      var seen={};var list=combined.filter(function(e){if(seen[e._id])return false;seen[e._id]=true;return true;});
      list=list.map(function(e,index){return Object.assign({},e,{show_month:index===0||list[index-1].history_year!==e.history_year});});
      self.setData({key:result.key,summary:result.summary,items:list,loading:false,loadingMore:false,hasMore:result.hasMore,cursor:result.nextCursor,mergedSources:result.merged_sources||[]});
      self._loadedRevision=revision;self._lastLoadedAt=Date.now();
    });}
    next().catch(function(){if(version===self._version)self.setData({loading:false,loadingMore:false,failed:true});}).then(function(){wx.stopPullDownRefresh();});
  },
  retry:function(){this.load(false,Math.max(20,this.data.items.length));},
  chooseFilter:function(event){if(event.currentTarget.dataset.filter===this.data.filter)return;this.setData({filter:event.currentTarget.dataset.filter,items:[],cursor:null});this.load();},
  toggleOrder:function(){this.setData({direction:this.data.direction==='desc'?'asc':'desc',items:[],cursor:null});this.load();},
  openRecord:function(event){wx.navigateTo({url:'/pages/reflection/index?id='+encodeURIComponent(event.currentTarget.dataset.id)});},
  openOverviewRecord:function(event){wx.navigateTo({url:'/pages/reflection/index?id='+encodeURIComponent(event.detail.id)});},
  returnToRecord:function(){wx.navigateBack();},
  manageAsset:function(){
    var self=this;if(!this.data.mergedSources.length){this.setData({aliasVisible:true,aliasQuery:'',aliasItems:[]});this.loadAliases();return;}var choices=['归到已有个股'];if(this.data.mergedSources.length)choices.push('撤销标的归并');
    wx.showActionSheet({itemList:choices,success:function(result){
      if(result.tapIndex===0){self.setData({aliasVisible:true,aliasQuery:'',aliasItems:[]});self.loadAliases();}
      else self.chooseUndo();
    }});
  },
  chooseUndo:function(){
    var self=this;var sources=this.data.mergedSources;
    wx.showActionSheet({itemList:sources.map(function(s){return '恢复 '+s.symbol+' 的原始分组';}),success:function(result){
      var source=sources[result.tapIndex];if(!source)return;
      wx.showModal({title:'撤销这次归并？',content:'原来以 '+source.symbol+' 留下的记录将恢复原组，记录与回看都会保留。',confirmText:'恢复原组',success:function(answer){if(answer.confirm)self.mutateAlias('undoAssetMerge',{source:source.key,target:source.target});}});
    }});
  },
  searchAlias:function(event){
    this._aliasVersion++;clearTimeout(this._aliasTimer);this.setData({aliasQuery:event.detail.value,aliasItems:[],aliasMore:false,aliasLoading:true});var self=this;
    this._aliasTimer=setTimeout(function(){self.loadAliases();},350);
  },
  loadAliases:function(append){
    append=append===true;var self=this;var version=++this._aliasVersion;
    this.setData({aliasLoading:true,aliasFailed:false});
    var options={query:this.data.aliasQuery,cursor:append?this.data.aliasCursor:null};
    var list=append?this.data.aliasItems.slice():[],startCount=list.length;
    function next(){return assets.list(options).then(function(result){
      if(version!==self._aliasVersion)return;
      var identity=JSON.parse(self.data.key);
      var seen={};list=list.concat(result.list).filter(function(item){var key;try{key=JSON.parse(item.key);}catch(e){return false;}if(item.key===self.data.key||key[0]!==identity[0]||key[1]!==identity[1]||seen[item.key])return false;seen[item.key]=true;return true;});
      if(list.length===startCount&&result.hasMore){options.cursor=result.nextCursor;return next();}
      self.setData({aliasLoading:false,aliasItems:list,aliasMore:result.hasMore,aliasCursor:result.nextCursor});
    });}
    next().catch(function(){if(version===self._aliasVersion)self.setData({aliasLoading:false,aliasFailed:true});});
  },
  moreAliases:function(){if(this.data.aliasMore&&!this.data.aliasLoading)this.loadAliases(true);},
  mergeInto:function(event){
    if(this.data.merging)return;
    var target=this.data.aliasItems[event.currentTarget.dataset.index];var self=this;
    wx.showModal({title:'归到 '+target.symbol+'？',content:self.data.summary.symbol+' 的 '+self.data.summary.count+' 条记录将和 '+target.symbol+' 的 '+target.count+' 条记录一起展示。原始记录与回看保留，可以撤销。',confirmText:'确认归并',success:function(result){if(result.confirm)self.mutateAlias('mergeAsset',{source:self.data.key,target:target.key});}});
  },
  mutateAlias:function(action,payload){
    if(this.data.merging)return;var self=this;this.setData({merging:true});
    api.call(action,payload).then(function(result){
      if(!result.success)throw new Error(result.error);
      self.setData({merging:false,aliasVisible:false,items:[],key:action==='mergeAsset'?payload.target:self.data.key});
      getApp().invalidatePages(['today','records','review']);self.setData({overviewRefresh:self.data.overviewRefresh+1});self.load();
    }).catch(function(error){self.setData({merging:false});wx.showToast({title:error.message==='MARKET_MISMATCH'?'不同市场或类型不能归并':'暂时没能归并，请刷新重试',icon:'none'});});
  },
  closeAlias:function(){if(this.data.merging)return;this._aliasVersion++;clearTimeout(this._aliasTimer);this.setData({aliasVisible:false});},
  stop:function(){}
});
