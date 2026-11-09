var options = require('../../config/trade-options');
var assets = require('../../services/asset-service');
var users = require('../../services/user-service');
var store = require('../../services/batch-entry-store');
var dates = require('../../utils/entry-time');
var ids = require('../../utils/request-id');
var share = require('../../utils/share');
function normalized(value) { return String(value || '').trim().toUpperCase().slice(0,20); }
function tap(event,key) { return event.currentTarget.dataset[key]; }
function label(list,key) { var item=options.findOption(list,key);return item?item.label:''; }
Page({
  data:{stage:'after',today:'',selectedDate:'',dateLabel:'今天',nowMode:true,clock:'',symbolInput:'',selectedSymbols:[],symbolChoices:[],
    actions:options.ACTIONS,action:'',reasons:options.getReasons('buy'),reasonKey:'',selectedCount:0,contextLabel:'选好标的、动作和原因，点保存。',canSave:false,
    showSupplement:false,note:'',currentReviewReminder:'',restoredDraft:false,ready:false,loadError:false,message:'',storageError:'',queueError:'',
    savedCount:0,pendingCount:0,cancellingCount:0,retryCount:0,receiptCount:0,undoJobId:'',undoCount:0,showHistory:false,receipts:[],historyLimit:20,hasMoreReceipts:false},
  onLoad:function(route){
    this._alive=true;this._owner='';this._recent=[];this._jobs=[];this._draftId=ids.create('batch_draft');
    var today=dates.day();this.setData({stage:route.stage==='before'?'before':'after',today:today,selectedDate:today});
    share.enable();this._boot();
  },
  _boot:function(){
    var self=this;this.setData({loadError:false});
    getApp().waitForLogin().then(function(){
      if(!self._alive)return;
      var owner=getApp().globalData.openid;if(!owner)throw Error('LOGIN_REQUIRED');
      if(self._owner===owner&&self.data.ready){store.resume(owner);return;}
      if(self._unsubscribe)self._unsubscribe();self._owner=owner;
      var state=store.load(owner),draft=state.drafts[self.data.stage];
      var config=users.getCachedConfig()||getApp().globalData.userConfig||{};
      self._recent=(config.recent_symbols||[]).slice(0,8);
      if(draft)self._restore(draft);
      self.setData({ready:true,loadError:false});self._refreshInput();self._renderJobs(state);
      self._unsubscribe=store.subscribe(owner,function(next){if(self._alive&&getApp().globalData.openid===owner)self._renderJobs(next);});
      store.resume(owner);
    }).catch(function(){if(self._alive)self.setData({loadError:true,ready:false,canSave:false});});
  },
  onShow:function(){
    this._alive=true;var today=dates.day();
    var patch={today:today};
    if(this.data.nowMode)patch.selectedDate=today;
    this.setData(patch);this._refreshInput();
    if(this._owner&&getApp().globalData.openid===this._owner)store.resume(this._owner);
  },
  onHide:function(){this._flushDraft();},
  onUnload:function(){this._flushDraft();this._alive=false;if(this._unsubscribe)this._unsubscribe();},
  retryLogin:function(){this._boot();},
  _currentSymbols:function(){
    var list=this.data.selectedSymbols.slice(),value=normalized(this.data.symbolInput);
    if(value&&list.indexOf(value)<0)list.push(value);return list;
  },
  _refreshInput:function(){
    var symbols=this._currentSymbols(),self=this;
    var choices=this.data.selectedSymbols.concat(this._recent||[]).filter(function(value,index,all){return all.indexOf(value)===index;}).map(function(symbol){return {symbol:symbol,selected:self.data.selectedSymbols.indexOf(symbol)>=0};});
    var date=this.data.selectedDate;
    var dateLabel=date===this.data.today?'今天':date.slice(0,4)===this.data.today.slice(0,4)?dates.short(date):date.replace(/-/g,'/');
    var config=users.getCachedConfig()||{},focus=config.current_focus;
    var reminder=this.data.stage==='before'&&focus&&focus.kind==='review'&&Array.isArray(focus.actions)&&focus.actions.indexOf(this.data.action)>=0?focus.text||focus.label||'':'';
    this.setData({symbolChoices:choices,selectedCount:symbols.length,dateLabel:dateLabel,
      contextLabel:symbols.length&&this.data.action?symbols.join('、')+' · '+label(options.ACTIONS,this.data.action):'选好标的、动作和原因，点保存。',
      currentReviewReminder:reminder,canSave:!!(this.data.ready&&symbols.length&&symbols.length<=20&&this.data.action&&this.data.reasonKey)});
  },
  onSymbolInput:function(event){if(this._enqueuing)return;this.setData({symbolInput:event.detail.value,message:''});this._refreshInput();this._scheduleDraft();},
  chooseSymbol:function(event){if(this._enqueuing)return;
    wx.hideKeyboard();
    var symbol=tap(event,'symbol'),list=this.data.selectedSymbols.slice(),at=list.indexOf(symbol);
    if(at>=0)list.splice(at,1);else if(this._currentSymbols().length<20||symbol===normalized(this.data.symbolInput))list.push(symbol);else {this.setData({message:'一次最多20条，请先保存当前输入。'});return;}
    this.setData({selectedSymbols:list,message:''});this._refreshInput();this._persistDraft();
  },
  addSymbol:function(){if(this._enqueuing)return;
    var value=normalized(this.data.symbolInput);if(!value)return;
    var list=this.data.selectedSymbols.slice();
    if(list.indexOf(value)<0){if(list.length>=20){this.setData({message:'一次最多20条，请先保存当前输入。'});return;}list.push(value);}
    this.setData({selectedSymbols:list,symbolInput:'',message:''});this._refreshInput();this._persistDraft();
  },
  chooseAction:function(event){if(this._enqueuing)return;
    wx.hideKeyboard();
    var action=tap(event,'action');if(!options.findOption(options.ACTIONS,action))return;
    this.setData({action:action,reasons:options.getReasons(action),reasonKey:action===this.data.action?this.data.reasonKey:'',message:''});
    this._refreshInput();this._persistDraft();
  },
  chooseReason:function(event){if(this._enqueuing)return;
    if(!this.data.action)return;var reason=tap(event,'reason');if(!options.findOption(this.data.reasons,reason))return;
    this.setData({reasonKey:reason,message:''});this._refreshInput();this._persistDraft();
  },
  chooseDate:function(event){if(this._enqueuing)return;
    var value=event.detail.value;if(this.data.stage==='before'||!isFinite(dates.start(value))||value>this.data.today)return;
    this.setData({selectedDate:value,clock:'',nowMode:false,message:''});this._refreshInput();this._persistDraft();
  },
  chooseClock:function(event){if(this._enqueuing)return;this.setData({clock:event.detail.value,nowMode:false,message:''});this._persistDraft();},
  clearClock:function(){if(this._enqueuing)return;this.setData({clock:'',nowMode:false});this._persistDraft();},
  toggleSupplement:function(){if(this._enqueuing)return;this.setData({showSupplement:!this.data.showSupplement});this._persistDraft();},
  onNoteInput:function(event){if(this._enqueuing)return;this.setData({note:event.detail.value});this._scheduleDraft();},
  onKeyboardFocus:function(){this._keyboardOpen=true;},
  onKeyboardBlur:function(){this._keyboardOpen=false;this._flushDraft();},
  _snapshot:function(){return {draftId:this._draftId,stage:this.data.stage,symbolInput:this.data.symbolInput,selectedSymbols:this.data.selectedSymbols,action:this.data.action,reasonKey:this.data.reasonKey,
    selectedDate:this.data.selectedDate,clock:this.data.clock,nowMode:this.data.nowMode,note:this.data.note,showSupplement:this.data.showSupplement,savedAt:Date.now()};},
  _scheduleDraft:function(){var self=this;clearTimeout(this._draftTimer);this._draftTimer=setTimeout(function(){self._draftTimer=null;self._persistDraft();},180);},
  _flushDraft:function(){clearTimeout(this._draftTimer);this._draftTimer=null;this._persistDraft();},
  _persistDraft:function(){
    clearTimeout(this._draftTimer);this._draftTimer=null;if(!this._owner||!this._alive||getApp().globalData.openid!==this._owner)return false;
    try{store.saveDraft(this._owner,this._snapshot());if(this.data.storageError)this.setData({storageError:''});return true;}
    catch(error){this.setData({storageError:'草稿暂时未能保存在本机，请保留此页后重试。'});return false;}
  },
  _restore:function(draft){
    this._draftId=draft.draftId||this._draftId;
    var selected=(draft.selectedSymbols||[]).filter(function(v){return typeof v==='string';}).slice(0,20);
    var action=options.findOption(options.ACTIONS,draft.action)?draft.action:'';
    var reasons=options.getReasons(action||'buy'),reason=options.findOption(reasons,draft.reasonKey)?draft.reasonKey:'';
    this.setData({symbolInput:draft.symbolInput||'',selectedSymbols:selected,action:action,reasons:reasons,reasonKey:reason,
      selectedDate:draft.nowMode?this.data.today:isFinite(dates.start(draft.selectedDate))?draft.selectedDate:this.data.today,
      clock:draft.clock||'',nowMode:!!draft.nowMode,note:draft.note||'',showSupplement:!!draft.showSupplement,
      restoredDraft:!!(selected.length||draft.symbolInput||action||draft.note)});
  },
  clearDraft:function(){if(this._enqueuing)return;
    var self=this;
    wx.showModal({title:'重新填写？',content:'只清除尚未保存的输入，已保存记录会保留。',confirmText:'重新填写',success:function(answer){if(!answer.confirm)return;self._resetInput();self._persistDraft();}});
  },
  _resetInput:function(){this._draftId=ids.create('batch_draft');this.setData({symbolInput:'',selectedSymbols:[],action:'',reasonKey:'',reasons:options.getReasons('buy'),note:'',showSupplement:false,restoredDraft:false,message:''});this._refreshInput();},
  save:async function(){
    if(this._enqueuing||!this.data.canSave)return;
    if(getApp().globalData.openid!==this._owner){this.setData({loadError:true,canSave:false});return;}
    this._enqueuing=true;clearTimeout(this._draftTimer);this._draftTimer=null;
    this.setData({resolvingSymbols:true,message:''});
    var owner=this._owner,self=this;
    function active(){return self._alive&&getApp().globalData.openid===owner;}
    try{
      var now=Date.now(),meta=dates.build(this.data.selectedDate,this.data.clock,this.data.nowMode,now);
      var symbols=this._currentSymbols();
      var shared={action:this.data.action,reason_key:this.data.reasonKey,stage:this.data.stage,
        time_mode:this.data.nowMode?'now':'specified',occurred_time:this.data.clock,optional_note:this.data.note};
      var resolved=await assets.resolveEntries(symbols,active);
      if(!active())return;
      var seen=new Set();
      var entries=symbols.map(function(symbol,index){
        var selected=resolved[index],key=selected?selected.key:symbol;
        if(seen.has(key))return null;
        seen.add(key);
        return Object.assign({},meta,shared,{symbol:selected?selected.symbol:symbol,client_request_id:ids.create('batch_event'),
          asset_key:selected?selected.key:undefined});
      }).filter(Boolean);
      store.enqueue(owner,entries,this._draftId);this._resetInput();wx.hideKeyboard();
      if(entries.length<symbols.length)this.setData({message:'相同标的已合为一条，本次提交 '+entries.length+' 条。'});
    }catch(error){
      var messages={FUTURE_TIME:'操作时刻还没有到，请调整后保存。',INVALID_DATE:'请选择有效的操作日期。',INVALID_TIME:'请选择有效的操作时刻。',QUEUE_FULL:'待保存的内容较多，请先重试未完成的记录。'};
      if(active()&&error.message!=='ASSET_CANCELLED')this.setData({message:messages[error.message]||'暂时未能保存，输入已保留，请重试。'});
    }finally{this._enqueuing=false;if(active())this.setData({resolvingSymbols:false});}
  },
  _renderJobs:function(state){
    this._jobs=state.jobs;var rows=[],saved=0,pending=0,retry=0,cancelling=0,last=null,self=this;
    var statuses={pending:'等待保存',saving:'保存中',saved:'已保存',failed:'未保存',unknown:'保存结果待确认',undone:'已撤销',cancelling:'撤销中',cancel_failed:'撤销未完成'};
    state.jobs.forEach(function(job){
      job.items.forEach(function(item){
        if(item.status==='saved')saved++;
        if(item.status==='pending'||item.status==='saving')pending++;
        if(item.status==='cancelling')cancelling++;
        if(['failed','unknown','cancel_failed'].indexOf(item.status)>=0)retry++;
        if(item.status==='saved'&&item.event&&self._recent.indexOf(item.payload.symbol)<0)self._recent.unshift(item.payload.symbol);
        rows.unshift({id:item.id,jobId:job.id,symbol:item.payload.symbol,action:item.payload.action,actionLabel:label(options.ACTIONS,item.payload.action),reasonLabel:label(options.getReasons(item.payload.action),item.payload.reason_key),
          timeLabel:dates.label(item.event||item.payload,false),note:item.payload.optional_note,status:item.status,statusLabel:statuses[item.status],eventId:item.event&&item.event._id||''});
      });
      if(!job.cancelRequested&&job.items.some(function(i){return i.status!=='undone';}))last=job;
    });
    this._recent=this._recent.slice(0,8);this._allReceipts=rows;
    this.setData({queueError:state.storageError||'',savedCount:saved,pendingCount:pending,retryCount:retry,cancellingCount:cancelling,receiptCount:rows.length,
      undoJobId:last?last.id:'',undoCount:last?last.items.length:0,receipts:this.data.showHistory?rows.slice(0,this.data.historyLimit):[],hasMoreReceipts:rows.length>this.data.historyLimit});
  },
  retryPending:function(){if(!this._owner)return;try{this._persistDraft();store.retry(this._owner);}catch(e){this.setData({queueError:'本机暂未能更新保存状态，请稍后重试。'});}},
  undoLast:function(){if(!this.data.undoJobId)return;try{store.undo(this._owner,this.data.undoJobId);}catch(e){this.setData({message:'撤销暂未完成，请重试。'});}},
  toggleHistory:function(){this.setData({showHistory:!this.data.showHistory});this._renderJobs(store.load(this._owner));},
  moreReceipts:function(){this.setData({historyLimit:this.data.historyLimit+20});this._renderJobs(store.load(this._owner));},
  openRecord:function(event){var id=tap(event,'id');if(id)wx.navigateTo({url:'/pages/reflection/index?id='+encodeURIComponent(id)+'&mode=detail'});},
  leave:function(){this._flushDraft();wx.navigateBack();},
  onShareAppMessage:function(){return share.appMessage();},onShareTimeline:function(){return share.timeline();}
});
