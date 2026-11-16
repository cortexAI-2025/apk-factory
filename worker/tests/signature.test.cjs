const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {verifyApk} = require('../dist/security/verify-apk');
const {stageOutput} = require('../dist/pipeline/stages/06-output');

test('missing verifier, invalid signature and symlink all block delivery', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verify-apk-'));
  const previous = process.env.APKSIGNER_PATH;
  t.after(async () => { if(previous === undefined) delete process.env.APKSIGNER_PATH; else process.env.APKSIGNER_PATH=previous; await fs.rm(root,{recursive:true,force:true}); });
  const apk=path.join(root,'app/build/outputs/apk/release/app-release.apk');
  await fs.mkdir(path.dirname(apk),{recursive:true}); await fs.writeFile(apk,'invalid bytes');
  delete process.env.APKSIGNER_PATH;
  await assert.rejects(verifyApk(apk),/APKSIGNER_PATH/);
  const tool=path.join(root,'verifier');
  await fs.writeFile(tool,'#!/bin/sh\nexit 1\n',{mode:0o700}); process.env.APKSIGNER_PATH=tool;
  await assert.rejects(verifyApk(apk));
  const result=await stageOutput({buildType:'RELEASE',projectRoot:root,log:async()=>{},uploadApk:async()=>assert.fail('must never upload')});
  assert.equal(result.ok,false); assert.match(result.error,/signature verification/);
  await fs.unlink(apk); await fs.symlink(tool,apk); await assert.rejects(verifyApk(apk),/Invalid APK/);
});
