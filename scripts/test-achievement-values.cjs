const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const output = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/allblue/allblue.service.ts','utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,experimentalDecorators:true},
}).outputText, {exports:output, console:{log(){}}, require:name=>name==='@nestjs/common'
 ? {Injectable:()=>v=>v,BadRequestException:Error,ForbiddenException:Error}
 : name==='./temporary-user-lock'?{lockTemporaryUser:async()=>{}}:{}});
function fixture(options={}){
 let row=null;const writes=[];
 const tx={
 user:{findUnique:async()=>({profile:{level:options.level||'5'}})},
 license_requirement:{findUnique:async()=>({licenseId:2,reqType:options.type||'MEASURE',unit:options.unit||'METER'})},
 user_license:{findFirst:async()=>options.noCourse?null:{id:1}},
 user_license_achievement:{
  findUnique:async()=>row,
  upsert:async({create,update})=>{writes.push({create,update});row=row?{...row,...update}:{id:1,isCompleted:0,completedBy:null,...create};},
  update:async({data})=>{row={...row,...data};},
  create:async({data})=>{row={id:1,...data};},
 },
 };
 const service=Object.assign(Object.create(output.AllblueService.prototype),{prisma:{...tx,$transaction:fn=>fn(tx)},
 assertDivingLogAccess:async()=>{if(options.denied)throw Error('access denied');}});
 return {service,writes,get row(){return row;}};
}
(async()=>{
 const f=fixture();const value=v=>f.service.saveAchievementValue({requirementId:9,userId:23,value:v},10);
 const check=completed=>f.service.toggleAchievement({requirementId:9,userId:23,completed},10);
 await value(35.5);assert.equal(f.row.isCompleted,0);assert.equal(f.row.measuredValue,35.5);
 await check(true);assert.equal(f.row.measuredValue,35.5);assert.equal(f.row.isCompleted,1);
 await value(40);assert.equal(f.row.isCompleted,1);assert.equal(f.row.completedBy,10);
 await value(null);assert.equal(f.row.isCompleted,1);assert.equal(f.row.measuredValue,null);
 await value(0);await check(false);assert.equal(f.row.measuredValue,0);assert.equal(f.row.isCompleted,0);
 for(const invalid of [-1,NaN,Infinity,undefined,'30',100000,1.234]) await assert.rejects(()=>value(invalid));
 for(const options of [{level:'2'},{type:'SKILL'},{type:'GROUP'},{noCourse:true},{denied:true}]){
  const g=fixture(options);await assert.rejects(()=>g.service.saveAchievementValue({requirementId:9,userId:23,value:20},10));assert.equal(g.writes.length,0);
 }
 const sta=fixture({unit:'SEC'});
 await sta.service.saveAchievementValue({requirementId:9,userId:23,value:241},10);assert.equal(sta.row.measuredValue,241);
 for(const value of [1.5,6000])await assert.rejects(()=>sta.service.saveAchievementValue({requirementId:9,userId:23,value},10));
 console.log('PASS: independent check/value changes, clears, zero, validation, instructor/access/course checks, STA seconds');
})().catch(e=>{console.error(e);process.exitCode=1;});

// Linking temporary students must preserve measurement-only records without checking them.
const linkExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/allblue/temporary-user-link.service.ts','utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,experimentalDecorators:true},
}).outputText,{exports:linkExports,require:name=>name==='@nestjs/common'?{Injectable:()=>v=>v}:{}});
for(const targetValue of [null,0,250]){
 const data={source:{id:2,userId:'temp'},target:{id:3,userId:'member'},participants:[],courses:[],courseLinks:[],forms:[],debriefings:[],friends:[],groups:[],buddies:[],blocks:[],achievements:[
  {id:1,userId:2,requirementId:9,isCompleted:0,measuredValue:241},
  {id:2,userId:3,requirementId:9,isCompleted:0,measuredValue:targetValue},
 ]};
 const updates=linkExports.buildLinkPlan(data).actions.filter(a=>a.action==='update');
 if(targetValue===null){assert.equal(updates.length,1);assert.equal(updates[0].data.measuredValue,241);assert.equal(updates[0].data.isCompleted,undefined);}
 else assert.equal(updates.length,0);
}
console.log('PASS: temporary account linking preserves independent values and existing zero');

// Match the production enum definitions supplied in SHOW CREATE TABLE.
const migration = fs.readFileSync('prisma/manual/replace_aida_2_3_requirements.sql', 'utf8');
const allowedEnums = {
  2: ['PREREQ', 'POOL', 'OPEN_WATER', 'PERFORMANCE'],
  3: ['GROUP', 'SKILL', 'MEASURE'],
  7: ['NONE', 'SEC', 'METER', 'PERCENT', 'COUNT'],
  12: ['OFFICIAL', 'FEDERATION', 'SCHOOL', 'UNPUBLISHED'],
};
const rows = [...migration.matchAll(/VALUES \((.*)\);/g)].map(match =>
  match[1].match(/'(?:''|[^'])*'|[^,]+/g).map(value => value.trim().replace(/^'|'$/g, '')));
assert.equal(rows.length, 53);
for (const row of rows) {
  assert.equal(row.length, 15);
  for (const [index, allowed] of Object.entries(allowedEnums)) {
    assert(allowed.includes(row[index]), `Invalid enum at column ${index}: ${row[index]}`);
  }
}
assert.equal(rows.filter(row => row[3] === 'MEASURE' && row[4] === 'STA' && row[7] === 'SEC').length, 2);
console.log('PASS: all 53 SQL rows match actual req_group, req_type, unit and source_type enums');
