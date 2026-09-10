import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(here,'deployment-config.json')));
const ROOT = '/opt/tenet-demo/penecho';
const POLICY = '/opt/tenet-demo/gateway/.state/demo-forced-state.json';
const BACKUP = `/opt/tenet-demo/backups/whiteboard-1.5.0-${config.sourceCommit.slice(0,7)}`;
const receiptPath = path.join(BACKUP,'deployment-receipt.json');
const mode = process.argv[2];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const command = (name,args) => execFileSync(name,args,{encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
const writeJson = (file,value) => fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600});
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
assert.equal(process.getuid(),0,'Run the deployment as root');
assert.equal(fs.realpathSync(ROOT),ROOT);
assert.match(config.sourceCommit,/^[a-f0-9]{40}$/);

function safePath(relative) {
  assert.match(relative,/^[A-Za-z0-9_./-]+$/);
  assert(!relative.startsWith('/') && relative.split('/').every(part=>part && part!=='.' && part!=='..'));
  const destination = path.resolve(ROOT,relative);
  assert(destination.startsWith(ROOT+'/'));
  let current = ROOT;
  for (const part of relative.split('/')) {
    current = path.join(current,part);
    if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(),`Symlink: ${relative}`);
  }
  return destination;
}
function fileHash(file) { return fs.existsSync(file) ? hash(fs.readFileSync(file)) : null; }
function services() { return command('systemctl',['show','penecho-demo','tenet-mobile-auth','caddy','-p','Id','-p','MainPID','-p','ActiveState']); }
function installBytes(destination,bytes,meta) {
  const temporary = destination+'.tenet-runtime-stage';
  assert(!fs.existsSync(temporary));
  fs.writeFileSync(temporary,bytes,{mode:meta.mode,flag:'wx'});
  fs.chownSync(temporary,meta.uid,meta.gid);
  fs.renameSync(temporary,destination);
}
function unarchive(buffer,expected) {
  const files = new Map();
  for (let offset=0;offset+512<=buffer.length;) {
    const header=buffer.subarray(offset,offset+512); offset+=512;
    if(header.every(byte=>byte===0)) break;
    const field=(start,length)=>header.subarray(start,start+length).toString('utf8').replace(/\0.*$/s,'');
    const size=parseInt(field(124,12).trim()||'0',8),type=field(156,1)||'0';
    assert(Number.isSafeInteger(size)&&size>=0&&size<=64*1024*1024&&offset+size<=buffer.length);
    const name=(field(345,155)?field(345,155)+'/':'')+field(0,100);
    const bytes=buffer.subarray(offset,offset+size); offset+=Math.ceil(size/512)*512;
    if(type==='g') { assert(size<4096); continue; }
    if(type==='5') { safePath(name.replace(/\/$/,'')); continue; }
    assert.equal(type,'0','Only ordinary files are allowed');
    safePath(name); assert(expected.has(name)&&!files.has(name),`Unexpected archive entry ${name}`);
    assert.equal(hash(bytes),expected.get(name),`Archive hash mismatch ${name}`);
    files.set(name,bytes);
  }
  assert.equal(files.size,expected.size);
  return files;
}
async function ready() {
  const deadline=Date.now()+90000;
  while(Date.now()<deadline) {
    try {
      const pid=Number(command('systemctl',['show','penecho-demo','--value','-p','MainPID']).trim());
      const state=JSON.parse(fs.readFileSync('/opt/tenet-demo/gateway/.state/penecho-demo.json'));
      assert(pid>0 && state.hostPid===pid);
      for(const port of [3888,3889,3890]) {
        const response=await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(2000)});
        assert.equal(response.status,200);
        await response.arrayBuffer();
      }
      return pid;
    } catch { await pause(500); }
  }
  throw Error('Demo host did not reach ready state');
}
async function verifyServed(receipt,previous=false) {
  const results=[];
  for(const port of [3888,3889]) for(const file of receipt.files.filter(file=>file.path.startsWith('public/')&&(!previous||file.previousSha256))) {
    const target=file.path==='public/index.html'?'':file.path.slice(7);
    const response=await fetch(`http://127.0.0.1:${port}/${target}`,{signal:AbortSignal.timeout(10000)});
    assert.equal(response.status,200);
    const digest=hash(Buffer.from(await response.arrayBuffer()));
    assert.equal(digest,previous?file.previousSha256:file.sha256,`Served mismatch ${port}/${target}`);
    assert.match(response.headers.get('cache-control')||'',/no-store/);
    results.push({port,path:file.path,sha256:digest,status:response.status});
  }
  for(const host of ['district.connect.truemadeai.com','spanish.connect.truemadeai.com']) {
    const response=await fetch(`https://${host}/`,{redirect:'manual',signal:AbortSignal.timeout(15000)});
    assert.equal(response.status,302,`Auth boundary changed for ${host}`);
    results.push({host,unauthenticatedStatus:response.status});
  }
  return results;
}
async function restore(receipt) {
  for(const file of receipt.files) {
    const current=fileHash(safePath(file.path));
    assert(current===file.sha256||current===file.previousSha256,`Refusing to replace later work: ${file.path}`);
  }
  command('systemctl',['stop','penecho-demo']);
  for(const file of receipt.files) {
    const destination=safePath(file.path);
    if(file.previousSha256===null) { if(fs.existsSync(destination)) fs.unlinkSync(destination); }
    else {
      const bytes=fs.readFileSync(path.join(BACKUP,'previous',file.path));
      assert.equal(hash(bytes),file.previousSha256);
      installBytes(destination,bytes,file);
    }
  }
  command('systemctl',['start','penecho-demo']);
  await ready();
  fs.copyFileSync(path.join(BACKUP,'policy-before.json'),POLICY);
  receipt.rollbackServed=await verifyServed(receipt,true);
  receipt.status='rolled-back'; receipt.rolledBackAt=new Date().toISOString();
  writeJson(receiptPath,receipt);
}

if(mode==='prepare') {
  assert(!fs.existsSync(BACKUP),'Backup already exists; use its receipt');
  const raw=fs.readFileSync(path.join(here,'release.json'));
  assert.equal(hash(raw),config.manifestSha256);
  const manifest=JSON.parse(raw);
  assert.equal(manifest.tag,'tenet-web-v1.5.0'); assert.equal(manifest.sourceCommit,config.sourceCommit);
  const archiveName='Tenet-Whiteboard-runtime-1.5.0.tar';
  const archive=fs.readFileSync(path.join(here,archiveName));
  assert.equal(hash(archive),config.archiveSha256);
  assert.equal(manifest.artifacts.find(item=>item.name===archiveName)?.sha256,config.archiveSha256);
  const expected=new Map(manifest.provenance.files.map(file=>[file.path,file.sha256]));
  assert.equal(expected.size,29,'Unexpected runtime scope');
  for(const name of expected.keys()) assert(config.baselines.hasOwnProperty(name),`Unqualified path ${name}`);
  const files=unarchive(archive,expected);
  const previousReceipt=JSON.parse(fs.readFileSync(config.previousReceipt));
  assert.equal(previousReceipt.status,'installed');
  for(const file of previousReceipt.files) assert.equal(fileHash(safePath(file.path)),file.sha256,`Live drift ${file.path}`);
  const owner=fs.statSync(ROOT),records=[];
  for(const [name,bytes] of files) {
    const destination=safePath(name),before=fileHash(destination);
    assert.equal(before,config.baselines[name],`Unqualified live baseline ${name}`);
    const stat=before===null?owner:fs.statSync(destination);
    records.push({path:name,sha256:hash(bytes),previousSha256:before,mode:before===null?0o644:stat.mode&0o777,uid:stat.uid,gid:stat.gid});
  }
  const req=createRequire(path.join(ROOT,'package.json'));
  assert(req('sharp')); assert(req('@xmldom/xmldom').DOMParser);
  const policy=fs.readFileSync(POLICY);
  assert.equal(JSON.parse(policy).state,'allow','Nonbaseline demo policy needs a maintenance plan');
  fs.mkdirSync(BACKUP,{mode:0o700});
  for(const file of records) {
    for(const section of ['next',...(file.previousSha256?['previous']:[])]) {
      const destination=path.join(BACKUP,section,file.path); fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});
      fs.writeFileSync(destination,section==='next'?files.get(file.path):fs.readFileSync(safePath(file.path)),{mode:0o600});
    }
  }
  fs.writeFileSync(path.join(BACKUP,'policy-before.json'),policy,{mode:0o600});
  for(const name of ['deploy-runtime.mjs','deployment-config.json','release.json']) fs.copyFileSync(path.join(here,name),path.join(BACKUP,name));
  const receipt={schemaVersion:1,tag:manifest.tag,sourceCommit:manifest.sourceCommit,nativeRelease:config.nativeRelease,workflow:config.workflow,archiveSha256:config.archiveSha256,manifestSha256:config.manifestSha256,previousReceipt:config.previousReceipt,backup:BACKUP,status:'prepared',preparedAt:new Date().toISOString(),files:records,policyBeforeSha256:hash(policy),servicesBefore:services(),packageLockSha256:fileHash(path.join(ROOT,'package-lock.json'))};
  writeJson(receiptPath,receipt);
  console.log(JSON.stringify({status:receipt.status,backup:BACKUP,files:records.length}));
} else if(mode==='install') {
  const receipt=JSON.parse(fs.readFileSync(receiptPath)); assert.equal(receipt.status,'prepared');
  for(const file of receipt.files) assert.equal(fileHash(safePath(file.path)),file.previousSha256,`Live changed after preparation ${file.path}`);
  assert.equal(fileHash(POLICY),receipt.policyBeforeSha256);
  try {
    command('systemctl',['stop','penecho-demo']);
    for(const file of receipt.files.sort((a,b)=>Number(a.path==='public/app.js')-Number(b.path==='public/app.js'))) {
      const bytes=fs.readFileSync(path.join(BACKUP,'next',file.path)); assert.equal(hash(bytes),file.sha256);
      installBytes(safePath(file.path),bytes,file);
    }
    command('systemctl',['start','penecho-demo']);
    receipt.hostPid=await ready();
    fs.copyFileSync(path.join(BACKUP,'policy-before.json'),POLICY);
    assert.equal(fileHash(POLICY),receipt.policyBeforeSha256);
    assert.equal(fileHash(path.join(ROOT,'package-lock.json')),receipt.packageLockSha256);
    receipt.served=await verifyServed(receipt);
    receipt.servicesAfter=services();
    receipt.status='installed'; receipt.installedAt=new Date().toISOString();
    receipt.scope='Whiteboard client and server. Demo host restarted, rotating internal Gateway keys and resetting ephemeral demo state; policy restored exactly. Auth and Caddy were not restarted. No notebook, dependency or native binary changes.';
    writeJson(receiptPath,receipt);
    console.log(JSON.stringify({status:receipt.status,tag:receipt.tag,receipt:receiptPath,hostPid:receipt.hostPid,served:receipt.served}));
  } catch(error) {
    receipt.installFailure=String(error.message);
    writeJson(receiptPath,receipt);
    await restore(receipt);
    throw error;
  }
} else if(mode==='rollback') {
  const receipt=JSON.parse(fs.readFileSync(receiptPath)); assert.equal(receipt.status,'installed');
  await restore(receipt); console.log(JSON.stringify({status:'rolled-back',receipt:receiptPath}));
} else throw Error('Use prepare, install or rollback');
