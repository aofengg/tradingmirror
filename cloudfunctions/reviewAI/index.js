const cloud = require('wx-server-sdk');
const model = require('./analysis');
const timeline = require('./timeline');
const crypto = require('crypto');
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV,timeout:65000});
const db=cloud.database();
const LEASE_MS=85000;
const ok=data=>({success:true,data,error:null});
const fail=(error,trace)=>({success:false,data:null,error,trace_id:trace||''});
const snapshotId=owner=>'ai_review_'+model.hash(owner);
async function document(collection,id,transaction=db) {
  try { const result=await transaction.collection(collection).doc(id).get(); return result.data||null; }
  catch(error){if(/document.*(?:not exist|not found)|DATABASE_DOCUMENT_NOT_EXIST|DOCUMENT_NOT_FOUND/i.test(String(error.message||error.errMsg||error.code)))return null;throw error;}
}
async function all(collection,owner) {
  let cursor='';let rows=[];
  while(true){const where={_openid:owner,is_deleted:false};if(cursor)where._id=db.command.gt(cursor);
    const page=await db.collection(collection).where(where).orderBy('_id','asc').limit(100).get();
    const batch=page.data||[];rows=rows.concat(batch);if(batch.length<100)return rows;cursor=batch[batch.length-1]._id;
  }
}
async function readSource(owner) {
  const [events,reflections]=await Promise.all([all('trade_events',owner),all('reflection_snapshots',owner)]);
  return model.source(events,reflections);
}
async function config(owner) {
  const result=await db.collection('user_config').where({_openid:owner,is_deleted:false}).limit(1).get();
  if(!result.data||!result.data[0])throw new Error('CONFIG_NOT_FOUND');return result.data[0];
}
function scopedSnapshot(snapshot,owner){if(snapshot&&snapshot._openid!==owner)throw new Error('AUTH_ERROR');return snapshot;}
function publicReview(snapshot,s,cfg) {
  const usable=snapshot&&snapshot.prompt_version===model.VERSION;
  const findings=usable?model.validFindings(snapshot,s):[];
  const hidden=new Set((cfg.ai_review_hidden||[]).filter(x=>x.version===s.version).map(x=>x.id));
  const visible=findings.filter(f=>!hidden.has(f.id));
  const primary=[];const keep=visible.find(f=>f.kind==='keep');const adjust=visible.find(f=>f.kind==='adjust');
  if(keep)primary.push(keep);if(adjust)primary.push(adjust);
  const running=Boolean(snapshot&&snapshot.generation&&snapshot.generation.expires_at>Date.now());
  return {source_version:s.version,scope:s.scope,analyzed_scope:usable?snapshot.scope:null,generated_at:usable?snapshot.generated_at:null,generated_label:usable?model.date(snapshot.generated_at):'',has_snapshot:Boolean(usable&&snapshot.generated_at),has_new_data:!usable||snapshot.source_version!==s.version,processing:running,first_error:!usable&&snapshot&&snapshot.last_error||'',findings:visible,primary,hidden:findings.filter(f=>hidden.has(f.id)),reminder:cfg.current_focus||null,reminder_version:model.focusVersion(cfg.current_focus),feedback_version:s.version};
}
async function read(owner) {
  const [s,cfg,stored]=await Promise.all([readSource(owner),config(owner),document('period_metrics',snapshotId(owner))]);
  return ok(publicReview(scopedSnapshot(stored,owner),s,cfg));
}
async function readTimeline(owner,p,details) {
  const [events,reflections]=await Promise.all([all('trade_events',owner),all('reflection_snapshots',owner)]);
  const source=timeline.normalize(events,reflections);
  return ok(details?timeline.detail(source,p):timeline.build(source,p));
}
async function generate(owner) {
  const s=await readSource(owner);
  if(!s.input.some(e=>e.status!=='pending'&&(e.note||e.history.some(r=>r.note||r.regret))))return ok({insufficient:true,source_version:s.version});
  const messages=model.prompt(s);
  const id=snapshotId(owner),token=crypto.randomBytes(12).toString('hex');
  const acquired=await db.runTransaction(async tx=>{
    const previous=scopedSnapshot(await document('period_metrics',id,tx),owner)||{};
    if(previous.source_version===s.version&&previous.prompt_version===model.VERSION&&previous.generated_at)return 'cached';
    if(previous.generation&&previous.generation.expires_at>Date.now())return 'processing';
    const data=Object.assign({},previous,{_openid:owner,is_deleted:false,period_type:'ai_review',prompt_version:previous.prompt_version||'',generation:{token,source_version:s.version,expires_at:Date.now()+LEASE_MS},updated_at:new Date()});
    delete data._id;
    await tx.collection('period_metrics').doc(id).set({data});
    return 'acquired';
  });
  if(acquired!=='acquired')return ok({[acquired]:true,source_version:s.version});
  const started=Date.now();
  try{
    const result=await cloud.ai().createModel('cloudbase').generateText({model:model.MODEL,messages,max_tokens:6000,temperature:0.2,thinking:{type:'disabled'},response_format:{type:'json_object'},maxSteps:1});
    if(result.error)throw new Error('MODEL_REQUEST_FAILED');
    const candidates=model.validate(result.text,s);
    const checked=candidates.length?await cloud.ai().createModel('cloudbase').generateText({model:model.MODEL,messages:model.reviewPrompt(candidates,s),max_tokens:4500,temperature:0.1,thinking:{type:'disabled'},response_format:{type:'json_object'},maxSteps:1}):null;
    if(checked&&checked.error)throw new Error('MODEL_REQUEST_FAILED');
    const findings=checked?model.validate(checked.text,s):[];
    const usage={};['prompt_tokens','completion_tokens','total_tokens'].forEach(key=>{usage[key]=Number(result.usage&&result.usage[key]||0)+Number(checked&&checked.usage&&checked.usage[key]||0);});
    const current=await readSource(owner);
    if(current.version!==s.version)throw new Error('SOURCE_CHANGED');
    const wrote=await db.runTransaction(async tx=>{
      const previous=scopedSnapshot(await document('period_metrics',id,tx),owner);
      if(!previous||!previous.generation||previous.generation.token!==token)return false;
      const data={_openid:owner,is_deleted:false,period_type:'ai_review',schema_version:1,model:model.MODEL,prompt_version:model.VERSION,source_version:s.version,scope:s.scope,source_events:s.input,findings,generated_at:new Date(),updated_at:new Date(),generation:null,last_error:'',elapsed_ms:Date.now()-started,usage,model_requests:checked?2:1};
      await tx.collection('period_metrics').doc(id).set({data});return true;
    });
    return wrote?ok({generated:true,source_version:s.version,elapsed_ms:Date.now()-started}):fail('SOURCE_CHANGED');
  }catch(error){
    const code=['SOURCE_CHANGED','MODEL_OUTPUT_INVALID','MODEL_EVIDENCE_INVALID','REVIEW_TOO_LARGE'].includes(error.message)?error.message:/quota|EXCEED|余额|额度/i.test(String(error.message||''))?'AI_QUOTA_EXHAUSTED':'MODEL_REQUEST_FAILED';
    await db.runTransaction(async tx=>{
      const previous=scopedSnapshot(await document('period_metrics',id,tx),owner);
      if(previous&&previous.generation&&previous.generation.token===token)await tx.collection('period_metrics').doc(id).update({data:{generation:null,last_error:code,updated_at:new Date()}});
    });
    console.error('[reviewAI]',code,String(error.code||error.message||'').slice(0,180));return fail(code);
  }
}
async function detail(owner,p) {
  const [s,stored]=await Promise.all([readSource(owner),document('period_metrics',snapshotId(owner))]);
  const snapshot=scopedSnapshot(stored,owner);const f=snapshot&&snapshot.prompt_version===model.VERSION&&model.validFindings(snapshot,s).find(f=>f.id===p.id);
  if(!f)return fail('FINDING_OUTDATED');
  return ok({finding:f,items:model.detail(f,s),source_version:s.version});
}
async function feedback(owner,p) {
  if(!p.id||typeof p.hidden!=='boolean')return fail('VALIDATION_ERROR');
  const [s,stored,cfg]=await Promise.all([readSource(owner),document('period_metrics',snapshotId(owner)),config(owner)]);
  const snapshot=scopedSnapshot(stored,owner);
  if(!snapshot||snapshot.prompt_version!==model.VERSION||!model.validFindings(snapshot,s).some(f=>f.id===p.id))return fail('FINDING_OUTDATED');
  await db.runTransaction(async tx=>{const fresh=await document('user_config',cfg._id,tx);if(!fresh||fresh._openid!==owner)throw new Error('AUTH_ERROR');
    const items=(fresh.ai_review_hidden||[]).filter(x=>x.version===s.version&&x.id!==p.id);
    if(p.hidden)items.push({id:p.id,version:s.version});
    await tx.collection('user_config').doc(cfg._id).update({data:{ai_review_hidden:db.command.set(items),updated_at:new Date()}});
  });return ok({id:p.id,hidden:p.hidden});
}
async function saveReminder(owner,p) {
  const text=typeof p.text==='string'?p.text.trim():'';
  if(!text||text.length>100||typeof p.request_id!=='string'||!p.request_id||p.request_id.length>100||typeof p.expected_version!=='string')return fail('VALIDATION_ERROR');
  const [cfg,s,stored]=await Promise.all([config(owner),readSource(owner),document('period_metrics',snapshotId(owner))]);
  const snapshot=scopedSnapshot(stored,owner);
  const f=p.finding_id&&snapshot&&snapshot.prompt_version===model.VERSION?model.validFindings(snapshot,s).find(f=>f.id===p.finding_id):null;
  if(p.finding_id&&!f)return fail('FINDING_OUTDATED');
  const id='review_reminder_'+model.hash(owner+':'+p.request_id);
  return db.runTransaction(async tx=>{
    const fresh=await document('user_config',cfg._id,tx);if(!fresh||fresh._openid!==owner)throw new Error('AUTH_ERROR');
    const existing=await document('personal_rules',id,tx);
    if(existing){if(existing._openid!==owner)throw new Error('AUTH_ERROR');return ok({focus:fresh.current_focus||null,version:model.focusVersion(fresh.current_focus),duplicate:true,undo_id:existing._id});}
    if(model.focusVersion(fresh.current_focus)!==p.expected_version)return fail('REMINDER_CHANGED');
    const previous=fresh.current_focus||null;
    const focus={id,key:'review_custom',kind:'review',label:text,text,actions:f?f.actions:(previous&&Array.isArray(previous.actions)&&previous.actions.length?previous.actions:Object.keys(model.ACTIONS)),finding_id:f?f.id:(previous&&previous.finding_id||null),updated_at:new Date()};
    await tx.collection('personal_rules').doc(id).set({data:{_openid:owner,is_deleted:false,rule_key:'review_custom',schema_version:1,text,actions:focus.actions,source_finding_id:focus.finding_id,source_event_ids:f?[...new Set(f.evidence.map(e=>e.event_id))]:[],previous_focus:previous,created_at:new Date()}});
    await tx.collection('user_config').doc(cfg._id).update({data:{current_focus:db.command.set(focus),updated_at:new Date()}});
    return ok({focus,version:model.focusVersion(focus),undo_id:id});
  });
}
async function undoReminder(owner,p) {
  if(!p.id)return fail('VALIDATION_ERROR');const cfg=await config(owner);
  return db.runTransaction(async tx=>{
    const [fresh,rule]=await Promise.all([document('user_config',cfg._id,tx),document('personal_rules',String(p.id),tx)]);
    if(!fresh||fresh._openid!==owner||!rule||rule._openid!==owner)return fail('NOT_FOUND');
    const current=fresh.current_focus||null;
    if(!current||current.id!==p.id)return fail('REMINDER_CHANGED');
    const previous=rule.previous_focus||null;
    await tx.collection('personal_rules').doc('undo_'+model.hash(owner+':'+p.id)).set({data:{_openid:owner,is_deleted:false,rule_key:'review_reminder_undo',undo_rule_id:p.id,created_at:new Date()}});
    await tx.collection('user_config').doc(cfg._id).update({data:{current_focus:db.command.set(previous),updated_at:new Date()}});
    return ok({focus:previous,version:model.focusVersion(previous)});
  });
}
exports.main=async event=>{
  const owner=cloud.getWXContext().OPENID;if(!owner)return fail('AUTH_ERROR');
  const action=event&&event.action,p=event&&event.payload||{};
  try{
    if(action==='read')return await read(owner);
    if(action==='timeline')return await readTimeline(owner,p,false);
    if(action==='timelineDetail')return await readTimeline(owner,p,true);
    if(action==='generate')return await generate(owner);
    if(action==='detail')return await detail(owner,p);
    if(action==='feedback')return await feedback(owner,p);
    if(action==='saveReminder')return await saveReminder(owner,p);
    if(action==='undoReminder')return await undoReminder(owner,p);
    return fail('UNKNOWN_ACTION');
  }catch(error){const trace=crypto.randomBytes(5).toString('hex');console.error('[reviewAI]',trace,error.code||error.message);return fail(['AUTH_ERROR','REVIEW_TOO_LARGE','CONFIG_NOT_FOUND','VALIDATION_ERROR','TIMELINE_CHANGED'].includes(error.message)?error.message:'REVIEW_UNAVAILABLE',trace);}
};
