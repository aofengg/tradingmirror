var service=require('../../services/ai-review-service');
var userService=require('../../services/user-service');
var requestId=require('../../utils/request-id');
var share=require('../../utils/share');
var toast=require('../../utils/toast');
function message(code,context){return ({AI_QUOTA_EXHAUSTED:'本次AI额度暂时不足，已有复盘仍可查看。',REVIEW_TOO_LARGE:'记录已超出本次整理容量，历史记录仍可查看。',MODEL_EVIDENCE_INVALID:'这次结论的依据没核对好，请重新整理。',MODEL_OUTPUT_INVALID:'这次整理没有完成，请重试。',SOURCE_CHANGED:'记录刚有变化，重新整理即可。',FINDING_OUTDATED:'相关记录已变动，请更新复盘。',REMINDER_CHANGED:'当前提醒已变化，请核对后再保存。'})[code]||(context==='reminder'?'提醒暂时没保存，编辑内容还在，可以重试。':context==='evidence'?'依据暂时没打开，稍后可以重试。':'暂时没整理好，稍后可以重试。');}
function focusText(focus){return focus&&(focus.text||focus.label)||'';}
function dayLabel(value){return value?new Date(Number(value)+28800000).toISOString().slice(0,10):'';}
Page({
  data:{fontScale:1,keyboardHeight:0,loading:true,readError:false,review:null,primary:[],otherFindings:[],generatedLabel:'',generating:false,generationError:'',insufficient:false,sheet:'',selected:null,evidence:[],evidenceLoading:false,evidenceError:'',timelineContext:null,timelineHasMore:false,timelineChanged:false,feedbackSaving:false,reminderText:'',reminderCurrent:'',reminderVersion:'',reminderSaving:false,reminderError:'',undo:null},
  onLoad: function(){share.enable();this._version=0;this._detailVersion=0;this._active=true;this._attempted=false;this._owner=getApp().globalData.openid;},
  onShow: function(){this._active=true;this._applyFontScale();this._checkOwner(getApp().globalData.openid);var bar=this.getTabBar&&this.getTabBar();if(bar)bar.setData({selected:2,hidden:Boolean(this.data.sheet)});this._loadReview(false,true);},
  onHide: function(){this._active=false;this.setData({keyboardHeight:0});clearTimeout(this._pollTimer);},
  onUnload: function(){this._destroyed=true;this._active=false;this._version++;this._detailVersion++;clearTimeout(this._pollTimer);this._setBar(false);},
  onPullDownRefresh: function(){this._loadReview(true,false);},
  _applyFontScale: function(){
    try {var setting=wx.getSystemInfoSync().fontSizeSetting||16;this.setData({fontScale:Math.max(1,Math.min(1.6,setting/16))});}catch(error){}
  },
  _setBar: function(hidden){var bar=this.getTabBar&&this.getTabBar();if(bar)bar.setData({hidden:hidden});},
  _valid: function(version,owner){return !this._destroyed&&version===this._version&&owner===getApp().globalData.openid;},
  _checkOwner: function(owner){
    if(owner&&this._owner&&owner!==this._owner){this._version++;this._detailVersion++;this._generationToken=null;this._readPromise=null;this._generatePromise=null;this._reloadRequested=false;this._initialGenerate=false;this._attempted=false;this._undoSaving=false;clearTimeout(this._pollTimer);this.setData({review:null,primary:[],otherFindings:[],selected:null,evidence:[],sheet:'',reminderCurrent:'',reminderText:'',undo:null,generating:false,generationError:'',reminderSaving:false,feedbackSaving:false,loading:true});this._setBar(false);}
    if(owner)this._owner=owner;
  },
  _apply: function(value){
    var selected={};(value.primary||[]).forEach(function(f){selected[f.id]=true;});
    var label=value.generated_label?value.generated_label.slice(5,7).replace(/^0/,'')+'月'+value.generated_label.slice(8,10).replace(/^0/,'')+'日整理':'全部记录';
    var period=value.scope&&value.scope.first_at?dayLabel(value.scope.first_at)+' — '+dayLabel(value.scope.last_at):'';
    this.setData({review:value,primary:value.primary||[],otherFindings:(value.findings||[]).filter(function(f){return !selected[f.id];}),generatedLabel:label,sourcePeriod:period,loading:false,readError:false,reminderCurrent:focusText(value.reminder),reminderVersion:value.reminder_version});
    userService.applyCurrentFocus(value.reminder);
    this._setBar(Boolean(this.data.sheet));
    if(!value.has_snapshot&&value.first_error&&!this.data.generating)this.setData({generationError:message(value.first_error)});
    if(this.data.sheet==='evidence'&&this.data.selected&&!this._finding(this.data.selected.id)){this._detailVersion++;this.setData({evidence:[],evidenceLoading:false,evidenceError:message('FINDING_OUTDATED')});}
  },
  _loadReview: function(force,initial){
    if(this._destroyed)return Promise.resolve();
    if(this._readPromise){if(force)this._reloadRequested=true;return this._readPromise;}
    var self=this,version=++this._version,owner;
    self.setData({loading:!self.data.review,readError:false});
    this._readPromise=getApp().waitForLogin().then(function(){owner=getApp().globalData.openid;return service.read(force);}).then(function(res){
      if(!self._valid(version,owner)||self._reloadRequested)return;
      if(!res.success)throw new Error(res.error);
      self._apply(res.data);
      if(getApp().globalData._reviewInitialSection==='focus'){getApp().globalData._reviewInitialSection='';self.editReminder();}
      if(res.data.processing){self.setData({generating:true});self._schedulePoll();}
      else if(!self._generatePromise){self.setData({generating:false});}
      if(initial&&!self._attempted&&!res.data.has_snapshot&&res.data.scope.total&&!res.data.first_error&&!res.data.processing){self._attempted=true;self._initialGenerate=true;}
    }).catch(function(){if(!self._destroyed&&version===self._version)self.setData({loading:false,readError:true});}).then(function(){
      if(self._destroyed||version!==self._version)return;
      self._readPromise=null;wx.stopPullDownRefresh();
      if(self._reloadRequested&&!self._destroyed){self._reloadRequested=false;return self._loadReview(true,false);}
      if(self._initialGenerate&&!self._destroyed){self._initialGenerate=false;self.generateReview();}
    });return this._readPromise;
  },
  _schedulePoll: function(){
    var self=this;clearTimeout(this._pollTimer);if(!this._active||this._destroyed)return;
    if(!this._pollStarted)this._pollStarted=Date.now();
    if(Date.now()-this._pollStarted>95000){this.setData({generating:false,generationError:'整理时间较长，稍后点更新查看结果。'});return;}
    this._pollTimer=setTimeout(function(){self._loadReview(true,false).then(function(){if(self.data.review&&self.data.review.processing)self._schedulePoll();else{self._pollStarted=0;self.setData({generating:false});}});},3000);
  },
  generateReview: function(){
    if(this._generatePromise||this.data.generating||this._destroyed)return;
    var self=this,owner=getApp().globalData.openid,token={};this._generationToken=token;this._attempted=true;this._pollStarted=Date.now();
    this.setData({generating:true,generationError:'',insufficient:false});
    this._generatePromise=service.generate().then(function(res){
      if(self._destroyed||owner!==getApp().globalData.openid)return;
      if(!res.success){self.setData({generationError:message(res.error)});return;}
      if(res.data.insufficient)self.setData({insufficient:true});
    }).catch(function(){if(!self._destroyed&&owner===getApp().globalData.openid)self.setData({generationError:message('REVIEW_UNAVAILABLE')});}).then(function(){
      if(token!==self._generationToken)return;self._generatePromise=null;if(self._destroyed||owner!==getApp().globalData.openid)return;
      self.setData({generating:false});return self._loadReview(true,false);
    });return this._generatePromise;
  },
  retryRead: function(){return this._loadReview(true,true);},
  _open: function(sheet){this.setData({sheet:sheet});this._setBar(true);},
  closeSheet: function(){if(this.data.reminderSaving||this.data.feedbackSaving)return;this._detailVersion++;if(this.data.keyboardHeight&&typeof wx.hideKeyboard==='function')wx.hideKeyboard();this.setData({sheet:'',evidenceError:'',keyboardHeight:0});this._setBar(false);},
  keyboardChanged: function(event){if(this.data.sheet==='reminder')this.setData({keyboardHeight:Math.max(0,Number(event.detail.height)||0)});},
  openSources: function(){this._open('sources');},
  openOthers: function(){this._open('others');},
  openHistory: function(){wx.navigateTo({url:'/pages/review-history/index'});},
  _finding: function(id){var r=this.data.review||{};return (r.findings||[]).concat(r.hidden||[]).find(function(f){return f.id===id;});},
  openEvidence: function(event){
    var id=event.currentTarget.dataset.id,f=this._finding(id);if(!f)return;
    this.setData({selected:f,evidence:[],evidenceLoading:true,evidenceError:''});this._open('evidence');return this._readEvidence(id);
  },
  _readEvidence: function(id){
    var self=this,version=++this._detailVersion,owner=getApp().globalData.openid;
    this.setData({evidenceLoading:true,evidenceError:''});
    return service.detail(id).then(function(res){if(self._destroyed||version!==self._detailVersion||owner!==getApp().globalData.openid)return;if(!res.success)throw new Error(res.error);self.setData({selected:res.data.finding,evidence:res.data.items,evidenceLoading:false});}).catch(function(error){if(!self._destroyed&&version===self._detailVersion&&owner===getApp().globalData.openid)self.setData({evidenceLoading:false,evidenceError:message(error.message,'evidence')});});
  },
  retryEvidence: function(){if(this.data.sheet==='timeline')return this._readTimelineRecords(this.data.evidence.length>0,this.data.timelineChanged);if(this.data.selected)return this._readEvidence(this.data.selected.id);},
  openTimelineRecords:function(event){
    this._timelineCursor=0;this.setData({timelineContext:event.detail,selected:null,evidence:[],evidenceError:'',evidenceLoading:false,timelineHasMore:false,timelineChanged:false});this._open('timeline');return this._readTimelineRecords(false,false);
  },
  timelineSourceChanged:function(event){
    if(this.data.sheet==='timeline'&&this.data.timelineContext&&this.data.timelineContext.source_version!==event.detail.source_version){this._detailVersion++;this._timelineCursor=0;this.setData({evidence:[],evidenceLoading:false,evidenceError:'记录已有变化，点此重新加载本周经历。',timelineHasMore:false,timelineChanged:true});}
  },
  loadTimelineMore:function(){if(this.data.timelineHasMore&&!this.data.evidenceLoading)return this._readTimelineRecords(true,false);},
  _readTimelineRecords:function(append,force){
    var context=this.data.timelineContext;if(!context)return Promise.resolve();
    var self=this,version=++this._detailVersion,owner=getApp().globalData.openid;
    this.setData({evidenceLoading:true,evidenceError:''});
    return service.timelineDetail({group:context.group,week:context.week,cursor:append?this._timelineCursor||0:0,source_version:force?'':context.source_version}).then(function(res){
      if(self._destroyed||version!==self._detailVersion||owner!==getApp().globalData.openid)return;
      if(!res.success)throw Error(res.error);
      self._timelineCursor=res.data.cursor;
      self.setData({evidence:append?self.data.evidence.concat(res.data.items):res.data.items,evidenceLoading:false,timelineHasMore:res.data.has_more,timelineChanged:false,timelineContext:Object.assign({},context,{total:res.data.total,source_version:res.data.source_version})});
      if(force&&self.selectComponent){var chart=self.selectComponent('#reviewTimeline');if(chart)chart.refresh();}
    }).catch(function(error){
      if(self._destroyed||version!==self._detailVersion||owner!==getApp().globalData.openid)return;
      if(error.message==='TIMELINE_CHANGED'){self._timelineCursor=0;self.setData({evidence:[],evidenceLoading:false,timelineHasMore:false,timelineChanged:true,evidenceError:'记录已有变化，点此重新加载本周经历。'});}
      else self.setData({evidenceLoading:false,evidenceError:'本周经历暂时没打开，点此重试。'});
    });
  },
  openRecord: function(event){wx.navigateTo({url:'/pages/reflection/index?id='+encodeURIComponent(event.currentTarget.dataset.id)+'&mode=detail'});},
  openReminder: function(event){
    var id=event.currentTarget.dataset.id,f=this._finding(id);if(!f)return;
    this._reminderFinding=id;this._reminderRequest='';this.setData({reminderText:f.reminder,reminderError:''});this._open('reminder');
  },
  editReminder: function(){this._reminderFinding='';this._reminderRequest='';this.setData({reminderText:this.data.reminderCurrent,reminderError:''});this._open('reminder');},
  inputReminder: function(event){if(this.data.reminderSaving)return;this._reminderRequest='';this.setData({reminderText:event.detail.value,reminderError:''});},
  _syncFocus: function(data,owner){if(owner!==getApp().globalData.openid)return;userService.applyCurrentFocus(data.focus);getApp().invalidatePages(['today','review']);},
  saveReminder: function(){
    if(this.data.reminderSaving)return;
    var value=this.data.reminderText.trim();if(!value){this.setData({reminderError:'写下一句提醒，或暂时不改。'});return;}
    if(value===this.data.reminderCurrent){this.closeSheet();return;}
    var self=this,owner=getApp().globalData.openid;
    if(!this._reminderRequest)this._reminderRequest=requestId.create('review-reminder');
    this.setData({reminderSaving:true,reminderError:''});
    return service.saveReminder({text:value,finding_id:this._reminderFinding||'',request_id:this._reminderRequest,expected_version:this.data.reminderVersion}).then(function(res){
      if(!res.success)throw new Error(res.error);
      self._syncFocus(res.data,owner);if(self._destroyed||owner!==getApp().globalData.openid)return;
      self.setData({reminderSaving:false,reminderCurrent:focusText(res.data.focus),reminderVersion:res.data.version,undo:{kind:'reminder',id:res.data.undo_id,text:'已更新当前提醒'}});
      self.closeSheet();return self._loadReview(true,false);
    }).catch(function(error){if(!self._destroyed&&owner===getApp().globalData.openid){self.setData({reminderSaving:false,reminderError:message(error.message,'reminder')});if(error.message==='REMINDER_CHANGED')self._loadReview(true,false);}});
  },
  dismissFinding: function(){
    if(!this.data.selected||this.data.feedbackSaving)return;
    var self=this,id=this.data.selected.id,owner=getApp().globalData.openid;this.setData({feedbackSaving:true});
    return service.feedback(id,true).then(function(res){if(!res.success)throw new Error(res.error);if(self._destroyed||owner!==getApp().globalData.openid)return;self.setData({feedbackSaving:false,undo:{kind:'feedback',id:id,text:'已收起这条发现，原记录仍保留'}});self.closeSheet();return self._loadReview(true,false);}).catch(function(){if(!self._destroyed&&owner===getApp().globalData.openid){self.setData({feedbackSaving:false});toast.showError('暂时没记下，请重试');}});
  },
  restoreFinding: function(event){
    if(this.data.feedbackSaving)return;
    var self=this,owner=getApp().globalData.openid;this.setData({feedbackSaving:true});
    return service.feedback(event.currentTarget.dataset.id,false).then(function(res){if(!res.success)throw new Error(res.error);if(self._destroyed||owner!==getApp().globalData.openid)return;self.setData({feedbackSaving:false});self.closeSheet();return self._loadReview(true,false);}).catch(function(){if(!self._destroyed&&owner===getApp().globalData.openid){self.setData({feedbackSaving:false});toast.showError('暂时没恢复，请重试');}});
  },
  undoChange: function(){
    var undo=this.data.undo;if(!undo||this._undoSaving)return;
    var self=this,owner=getApp().globalData.openid;this._undoSaving=true;
    return (undo.kind==='reminder'?service.undoReminder(undo.id):service.feedback(undo.id,false)).then(function(res){
      if(!res.success)throw new Error(res.error);
      if(undo.kind==='reminder')self._syncFocus(res.data,owner);
      if(!self._destroyed&&owner===getApp().globalData.openid){self.setData({undo:null});return self._loadReview(true,false);}
    }).catch(function(error){
      if(self._destroyed||owner!==getApp().globalData.openid)return;
      if(error.message==='REMINDER_CHANGED'){self.setData({undo:null});toast.showError('提醒已有变化，已保留当前提醒');return self._loadReview(true,false);}
      toast.showError('暂时未能撤回，请重试');
    }).then(function(){if(owner===getApp().globalData.openid)self._undoSaving=false;});
  },
  stopPropagation: function(){},
  preventTouchMove: function(){},
  createRecord: function(){wx.navigateTo({url:'/pages/record/index?stage=after'});},
  onShareAppMessage: function(){return share.appMessage('交易留痕｜记下当时，过后回看','/pages/review/index');},
  onShareTimeline: function(){return share.timeline('交易留痕｜记下当时，过后回看');}
});
