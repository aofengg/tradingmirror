var cache=require('../utils/read-cache');
function call(action,payload){
  return wx.cloud.callFunction({name:'reviewAI',data:{action:action,payload:payload||{}}}).then(function(res){
    var result=res&&res.result;
    if(!result||result.success!==true)return {success:false,error:result&&result.error||'REVIEW_UNAVAILABLE'};
    if(['read','detail','timeline','timelineDetail'].indexOf(action)===-1)cache.clear();
    return result;
  }).catch(function(){return {success:false,error:'REVIEW_UNAVAILABLE'};});
}
module.exports={
  read:function(force){if(force)cache.clear();return cache.read('ai-review',{},function(){return call('read');},15000);},
  timeline:function(options,force){if(force)cache.clear();options=options||{};return cache.read('ai-timeline',options,function(){return call('timeline',options);},15000);},
  timelineDetail:function(options){return call('timelineDetail',options);},
  generate:function(){return call('generate');},detail:function(id){return call('detail',{id:id});},
  feedback:function(id,hidden){return call('feedback',{id:id,hidden:hidden});},
  saveReminder:function(payload){return call('saveReminder',payload);},undoReminder:function(id){return call('undoReminder',{id:id});}
};
