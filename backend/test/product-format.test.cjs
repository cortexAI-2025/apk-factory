const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validate}=require('class-validator');
const {CreateBuildDto}=require('../dist/builds/dto/create-build.dto');
const {BuildsService}=require('../dist/builds/builds.service');
test('DTO permits APK debug/release and always refuses AAB',async()=>{
 for(const type of ['DEBUG','RELEASE','AAB']){
  const dto=Object.assign(new CreateBuildDto(),{buildType:type});const errors=await validate(dto);
  assert.equal(errors.length===0,type!=='AAB');
 }
});
test('release flag cannot bypass APK-only policy or enqueue an AAB',async t=>{
 const old=process.env.ENABLE_RELEASE_BUILDS;process.env.ENABLE_RELEASE_BUILDS='true';
 t.after(()=>{if(old===undefined)delete process.env.ENABLE_RELEASE_BUILDS;else process.env.ENABLE_RELEASE_BUILDS=old});
 const prisma={project:{findUnique:async()=>({userId:'owner',sourcePath:'/source'})},user:{findUnique:async()=>({plan:'PRO'})},build:{create:async()=>assert.fail('must not write')}};
 const service=new BuildsService(prisma,{enqueueBuild:async()=>assert.fail('must not enqueue')},{});
 await assert.rejects(service.create('owner','project',{buildType:'AAB'}),/APK files only/);
});
