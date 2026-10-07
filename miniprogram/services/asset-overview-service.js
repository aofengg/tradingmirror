var assets=require('./asset-service');
var reflections=require('../repository/reflections-repo');
var db=require('../utils/db');

// The overview is independent of the detail filter and needs older decisions too:
// a recent reflection may belong to a decision outside the first history page.
function load(key,isCurrent) {
  var events=[],snapshots=[];
  function active(){return !isCurrent || isCurrent();}
  function history(cursor){
    if(!active())return Promise.resolve(null);
    return assets.history({key:key,limit:50,direction:'desc',cursor:cursor}).then(function(result){
      if(!active())return null;
      events=events.concat(result.list);
      return result.hasMore ? history(result.nextCursor) : readBatch(0);
    });
  }
  function readBatch(offset){
    if(!active())return Promise.resolve(null);
    var ids=events.slice(offset,offset+20).map(function(event){return event._id;});
    if(!ids.length)return Promise.resolve({events:events,reflections:snapshots});
    function page(lastId){
      if(!active())return Promise.resolve(null);
      var where={trade_event_id:db.getCommand().in(ids)};
      if(lastId)where._id=db.getCommand().gt(lastId);
      // _id keysets preserve snapshots sharing exactly the same timestamp.
      return reflections.getList({where:where,orderBy:'_id',order:'asc',pageSize:20,
        fields:{_id:true,trade_event_id:true,feeling:true,feeling_label:true,reviewed_at:true,created_at:true}
      }).then(function(result){
        if(!active())return null;
        if(!result.success)throw new Error(result.error||'REFLECTION_LOAD_FAILED');
        snapshots=snapshots.concat(result.data.list);
        if(result.data.hasMore && result.data.list.length)return page(result.data.list[result.data.list.length-1]._id);
        return readBatch(offset+20);
      });
    }
    return page();
  }
  return history();
}
module.exports={load:load};
