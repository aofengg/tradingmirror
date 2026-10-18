const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const tick=()=>new Promise(setImmediate);
const ok=data=>({success:true,data});
function users(call){const module={exports:{}};vm.runInNewContext(fs.readFileSync('miniprogram/services/user-service.js','utf8'),{module,require:n=>n.includes('cloud-api')?{call}:n.includes('constants')?{DATA_SCHEMA_VERSION:2}:{}});return module.exports;}
function application(userService,wx){let app;vm.runInNewContext(fs.readFileSync('miniprogram/app.js','utf8'),{App:x=>app=x,console:{error(){}},wx,require:n=>n.includes('user-service')?userService:{}});return app;}
(async()=>{
 let ensures=0,migrations=0;
 const afterThrow=users(async action=>{
  if(action==='ensureUserConfig'){ensures++;return ok({data_schema_version:ensures<3?1:2});}
  migrations++;if(migrations===1)throw new Error('CONNECTION_RESET');return ok({});
 });
 await assert.rejects(afterThrow.getConfig(),/CONNECTION_RESET/);
 assert.equal(afterThrow.getCachedConfig(),null,'an unexpected migration rejection must not retain the previous schema in memory');
 assert.equal((await afterThrow.getConfig()).data.data_schema_version,2);assert.equal(migrations,2);

 let freshReads=0;
 const afterFreshFailure=users(async action=>{
  if(action==='migrateUserData')return ok({});
  freshReads++;
  if(freshReads===2)return {success:false,error:'TIMEOUT'};
  return ok({data_schema_version:freshReads===1?1:2});
 });
 const failed=await afterFreshFailure.getConfig();assert.equal(failed.success,false);assert.equal(failed.error,'TIMEOUT','failed reload after migration must not be reported as successful stale config');
 assert.equal(afterFreshFailure.getCachedConfig(),null);
 assert.equal((await afterFreshFailure.getConfig()).data.data_schema_version,2);

 let configReads=0,release;
 const config={getConfig:()=>{configReads++;return new Promise(r=>release=r);}};
 const app=application(config,{getStorageSync:()=> 'cached-owner',cloud:{init(){}}});
 app.onLaunch();const first=app.waitForLogin();assert.equal(configReads,1);
 release({success:false,error:'CONFIG_TIMEOUT'});await assert.rejects(first,/CONFIG_TIMEOUT/);assert.equal(app._loginPromise,null);
 const retry=app.waitForLogin(),same=app.waitForLogin();assert.equal(retry,same);assert.equal(configReads,2);
 release(ok({data_schema_version:2}));await retry;assert.equal(app.globalData.userConfig.data_schema_version,2);
 assert.equal(await app.waitForLogin(),await retry);assert.equal(configReads,2,'completed initialization is retained');

 const errors=[];const unhandled=e=>errors.push(e);process.on('unhandledRejection',unhandled);
 const unsupported=application({}, {showModal(){}});unsupported.onLaunch();await tick();await tick();
 assert.equal(errors.length,0,'unsupported environments cannot emit an unhandled rejection before a page attaches its error handler');
 await assert.rejects(unsupported.waitForLogin(),/CLOUD_UNAVAILABLE/);process.removeListener('unhandledRejection',unhandled);
 console.log('Startup recovery: thrown migration, failed post-migration refresh, config timeout, concurrent retry and unsupported-environment handling passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
