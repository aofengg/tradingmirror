var api=require('../utils/cloud-api');
var cache={};
function owner(){var data=getApp().globalData;return data.userConfig && data.userConfig._openid || data.openid || '';}
function key(market,year){return owner()+':'+market+':'+year;}
function list(market,year,force){
  var k=key(market,year),entry=cache[k];
  if(!force&&entry&&Date.now()-entry.at<30000)return Promise.resolve(entry.result);
  return api.call('listMarketChronicle',{market:market,year:year}).then(function(res){if(res.success)cache[k]={result:res,at:Date.now()};return res;});
}
function mutate(action,p){return api.call(action,p).then(function(res){if(res.success)delete cache[key(p.market,p.date.slice(0,4))];return res;});}
function storageKey(){return 'market_chronicle_v1:'+owner();}
function readState(){var data=wx.getStorageSync(storageKey());return data&&typeof data==='object'?data:{};}
function writeState(state){try{wx.setStorageSync(storageKey(),state);return true;}catch(e){return false;}}
module.exports={owner:owner,list:list,mutate:mutate,readState:readState,writeState:writeState};
