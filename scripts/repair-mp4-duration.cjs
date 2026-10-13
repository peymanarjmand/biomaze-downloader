const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
require('../extension/mp4-timing.js');
const [source,destination]=process.argv.slice(2);
assert(source && destination,'Usage: node scripts/repair-mp4-duration.cjs source destination');
assert.notEqual(path.resolve(source),path.resolve(destination),'Preserve the original file');
const fd=fs.openSync(source,'r'),length=fs.fstatSync(fd).size;
const read=(position,size)=>{const b=Buffer.alloc(size);assert.equal(fs.readSync(fd,b,0,size,position),size);return b;};
let offset=0,init=[],timing,initLength=0,moofs=0;
while(offset<length){
  let head=read(offset,8),size=head.readUInt32BE(0),type=head.toString('ascii',4,8),header=8;
  if(size===1){size=Number(read(offset+8,8).readBigUInt64BE(0));header=16;}
  if(size===0)size=length-offset;
  assert(size>=header && offset+size<=length);
  if(!timing){
    assert(['ftyp','moov','free'].includes(type),'Unexpected layout before movie header');
    init.push(read(offset,size));initLength+=size;
    if(type==='moov')timing=new BiomazeMp4Timing(Buffer.concat(init),{upgrade:false});
  }else if(type==='moof'){timing.push(read(offset,size));moofs++;}
  offset+=size;
}
fs.closeSync(fd);assert(timing && moofs);const fixed=timing.finish();assert.equal(fixed.length,initLength);
fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);
const out=fs.openSync(destination,'r+');fs.writeSync(out,fixed,0,fixed.length,0);fs.closeSync(out);
async function mediaHash(file){
 const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file,{start:initLength}))h.update(chunk);return h.digest('hex');
}
(async()=>{
 const [originalHash,fixedHash]=await Promise.all([mediaHash(source),mediaHash(destination)]);assert.equal(originalHash,fixedHash);
 console.log(JSON.stringify({output:destination,bytes:fs.statSync(destination).size,fragments:moofs,mediaUnchanged:true,tracks:[...timing.tracks].map(([id,t])=>({id,seconds:Number(t.end)/t.scale,samples:t.samples})),sha256Media:fixedHash},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
