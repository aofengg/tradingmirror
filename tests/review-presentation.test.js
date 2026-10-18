const assert=require('node:assert/strict');
const presentation=require('../miniprogram/utils/review-presentation');
const reason=(key,satisfied,acceptable,regret,unreviewed=0,unknown=0)=>({key,label:key,total:satisfied+acceptable+regret+unreviewed+unknown,distribution:[{key:'satisfied',count:satisfied},{key:'acceptable',count:acceptable},{key:'regret',count:regret},{key:'unknown',count:unknown},{key:'unreviewed',count:unreviewed}]});
let out=presentation.build([reason('常见理由',3,3,0,1),reason('需要对照的理由',3,0,1)]);
assert.equal(out.observation.reason,'需要对照的理由','one observation brings mixed feelings into view even when another reason is more frequent');
assert(out.observation.text.includes('4 次已回看'));assert(out.observation.text.includes('3 次满意'));assert(out.observation.text.includes('1 次懊悔'));
const row=out.rows[0];assert.equal(row.reviewedTotal,6);assert(Math.abs(row.feelings.reduce((n,x)=>n+x.width,0)-100)<.00001);assert(Math.abs(row.feelings.find(x=>x.key==='unreviewed').width-100/7)<.00001,'unreviewed stays visible in the whole-decision denominator');
out=presentation.build([reason('小样本',1,0,1,10)]);assert.equal(out.observation,null,'two feelings do not create a summary observation');assert(out.rows[0].sampleNote);assert.equal(out.rows[0].reviewedTotal,2);
out=presentation.build([reason('尚未回看',0,0,0,6)]);assert.equal(out.observation,null);assert.equal(out.rows[0].feelings.length,1);assert.equal(out.rows[0].feelings[0].width,100);
out=presentation.build([reason('相同感受',3,0,0,2)]);assert(out.observation.text.includes('3 次已回看'));assert(!out.observation.text.includes('5 次已回看'));assert(!/更好|改善|值得保留|成功|正确/.test(out.observation.text));
out=presentation.build([reason('未知',1,0,1,0,5)]);assert.equal(out.observation,null,'unknown feelings cannot satisfy the minimum observation coverage');assert(out.rows[0].feelings.some(x=>x.key==='unknown'&&x.count===5));
assert.equal(presentation.build([]).observation,null);
console.log('Review presentation: one factual mixed-feeling prompt, exact denominators, visible missing reviews, small samples and unknown feelings passed');

const evidence=presentation.evidence([{latest_feeling:'regret',history:[{feeling:'regret',optional_note:'回看备注',regret_reason_label:'卖早了'}]},{latest_feeling:'satisfied',latest_review_note:'新的认可',latest_regret_reason:'旧原因',history:[{feeling:'regret',optional_note:'旧备注'}]},{latest_feeling:'satisfied',history:[]}]);
assert.equal(evidence[0].reviewNote,'回看备注');assert.equal(evidence[0].regretReason,'卖早了');assert.equal(evidence[1].reviewNote,'新的认可');assert.equal(evidence[1].regretReason,'');assert.equal(evidence[2].reviewNote,'');
