const assert=require('node:assert/strict');
const model=require('../cloudfunctions/tradeData/review-analysis');
const now=Date.parse('2026-10-18T12:00:00Z');
const e=(id,symbol,action='buy',extra={})=>({_id:id,symbol,market:'US',asset_type:'stock',action,reason_key:'reason',reason_label:'理由',execution_status:'executed',executed_at:'2026-09-15T00:00:00Z',...extra});
const r=(id,feeling,extra={})=>({_id:'r'+id,trade_event_id:id,feeling,reviewed_at:'2026-10-01T00:00:00Z',...extra});
const project=(events,refs,extra={},links)=>model.project(events,refs,{range:'all',mode:'comparison',reason_key:'reason',...extra},now,null,links);
let events=[e('old-positive','SAME','add'),e('old-regret','SAME','add'),e('new-positive','NEW','buy',{executed_at:'2026-10-17T00:00:00Z'}),e('new-regret','OTHER','exit',{executed_at:'2026-10-17T00:00:00Z'})];
let refs=[r('old-positive','satisfied',{optional_note:'后来认可原来的依据'}),r('old-regret','regret',{regret_reason_label:'没按计划',optional_note:'没等到约定条件'}),r('new-positive','satisfied'),r('new-regret','regret')];
let out=project(events,refs);assert.equal(out.match,'same_asset_action');assert.deepEqual(out.items.map(x=>x._id),['old-positive','old-regret'],'matching context outranks newer unrelated trades');assert.equal(out.items[1].latest_regret_reason,'没按计划');assert.equal(out.items[1].latest_review_note,'没等到约定条件');
// A valid pair can be older than every record in the first detail page.
for(let i=0;i<35;i++){events.push(e('noise'+i,'OTHER'+i,'buy',{executed_at:'2026-10-17T00:00:00Z'}));refs.push(r('noise'+i,'satisfied'));}
assert.equal(project(events,refs).items[0]._id,'old-positive');
out=project([e('a','SAME','buy'),e('b','SAME','exit')],[r('a','satisfied'),r('b','regret')]);assert.equal(out.match,'same_asset');assert(out.context.includes('操作不同'));
out=project([e('a','A','buy'),e('b','B','buy')],[r('a','satisfied'),r('b','regret')]);assert.equal(out.match,'same_action');assert(out.context.includes('标的不同'));
out=project([e('a','A','buy'),e('b','B','exit')],[r('a','satisfied'),r('b','regret')]);assert.equal(out.match,'different_context');assert(out.hint.includes('暂无相同情境'));
out=project([e('a','TEST','buy'),e('b','TEST','buy',{market:'HK'})],[r('a','satisfied'),r('b','regret')]);assert.equal(out.match,'same_action','same symbol in another market is not the same asset');
out=project([e('a','TEST','buy'),e('b','TEST','buy',{asset_type:'option'})],[r('a','satisfied'),r('b','regret')]);assert.equal(out.match,'same_action','asset types remain distinct');
const aliasEvents=[e('a','OLD','buy'),e('b','NEW','buy')],aliasRefs=[r('a','satisfied'),r('b','regret')];out=project(aliasEvents,aliasRefs,{}, {'["US","stock","OLD"]':'["US","stock","NEW"]'});assert.equal(out.match,'same_asset_action','user-confirmed asset aliases share identity');
out=project(events,refs,{range:'month'});assert(!out.items.some(x=>x._id.startsWith('old-')),'comparison stays in current operation period');
out=project([e('a','SAME'),e('b','SAME','buy',{execution_status:'cancelled'})],[r('a','satisfied'),r('b','regret')]);assert.equal(out.match,'incomplete');assert.equal(out.items.length,1);
out=project([e('a','SAME'),e('b','SAME','buy',{reason_key:'different'})],[r('a','satisfied'),r('b','regret')]);assert.equal(out.match,'incomplete','reason is never broadened to manufacture a pair');
const revised=[r('a','regret',{reviewed_at:'2026-09-16T00:00:00Z',regret_reason_label:'old',optional_note:'old note'}),r('a','satisfied',{reviewed_at:'2026-10-17T00:00:00Z',optional_note:'new note'}),r('b','regret')];out=project([e('a','SAME'),e('b','SAME')],revised);assert.equal(out.items[0].latest_review_note,'new note');assert.equal(out.items[0].latest_regret_reason,'','old regret does not leak into latest satisfied review');
assert.throws(()=>project(events,refs,{basis:'first'}),/VALIDATION_ERROR/);
console.log('Review comparison: complete cohorts, contextual matching, honest fallback, asset aliases, current feedback, scope and missing pairs passed');
