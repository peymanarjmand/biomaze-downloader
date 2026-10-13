const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
globalThis.window=globalThis;
require('node:vm').runInThisContext('(function(module,exports,require){'+fs.readFileSync(__dirname+'/../extension/vendor/mux.min.js','utf8')+'})(undefined,undefined,undefined)');
require('../extension/mp4-timing.js');
require('../extension/writer.js');
const fixture=process.env.BIOMAZE_FIXTURE_DIR || path.resolve(__dirname,'../local/work/extension-fixture');
if(!fs.existsSync(path.join(fixture,'key.bin')) || !fs.existsSync(path.join(fixture,'video.bin'))) {
  console.error('Private media fixture missing. Set BIOMAZE_FIXTURE_DIR or restore local/work/extension-fixture.');process.exit(1);
}
const key=fs.readFileSync(path.join(fixture,'key.bin'));
const encrypted=fs.readFileSync(path.join(fixture,'video.bin')).subarray(0,615712);
const decipher=crypto.createDecipheriv('aes-128-cbc',key,Buffer.alloc(16));
const ts=Buffer.concat([decipher.update(encrypted),decipher.final()]);
function entries(bytes,start=0,end=bytes.length){
 const out=[];for(let p=start;p<end;){const length=bytes.readUInt32BE(p);assert(length>=8 && p+length<=end);out.push({type:bytes.toString('ascii',p+4,p+8),start:p,body:p+8,end:p+length});p+=length;}return out;
}
(async()=>{
  const mux=new muxjs.mp4.Transmuxer({remux:true,keepOriginalTimestamps:false});
  let segment;mux.on('data',s=>segment=s);mux.push(ts);mux.flush();mux.dispose();assert(segment);
  const timing=new BiomazeMp4Timing(segment.initSegment);
  assert.equal(timing.init.length,segment.initSegment.length+60);
  timing.push(segment.data);const init=Buffer.from(timing.finish());
  const moov=entries(init).find(b=>b.type==='moov'),movie=entries(init,moov.body,moov.end).find(b=>b.type==='mvhd');
  assert.equal(init[movie.body],1);const ticks=init.readBigUInt64BE(movie.body+24);
  assert(ticks>3n*90000n && ticks<5n*90000n);
  // Real mux.js fragments with their decode clocks shifted a full day must not
  // wrap the 32-bit duration field (13h15m at the video's 90 kHz timescale).
  const shifted=Buffer.from(segment.data),day=86400n;
  for(const moof of entries(shifted).filter(b=>b.type==='moof'))for(const traf of entries(shifted,moof.body,moof.end).filter(b=>b.type==='traf')){
    const children=entries(shifted,traf.body,traf.end),tfhd=children.find(b=>b.type==='tfhd'),tfdt=children.find(b=>b.type==='tfdt');
    const track=timing.tracks.get(shifted.readUInt32BE(tfhd.body+4));assert.equal(shifted[tfdt.body],1);
    shifted.writeBigUInt64BE(shifted.readBigUInt64BE(tfdt.body+4)+day*BigInt(track.scale),tfdt.body+4);
  }
  const long=new BiomazeMp4Timing(segment.initSegment);long.push(shifted);
  const longInit=Buffer.from(long.finish());assert.equal(longInit.readBigUInt64BE(movie.body+24),ticks+day*90000n);
  const truncated=new BiomazeMp4Timing(segment.initSegment);assert.throws(()=>truncated.push(segment.data.subarray(0,20)));
  const noSamples=new BiomazeMp4Timing(segment.initSegment);assert.throws(()=>noSamples.finish());
  let closed=false,patchAttempted=false;
  const writer=new BiomazeMp4Writer({write:async data=>{if(data.type==='write'){patchAttempted=true;throw new Error('disk full');}},close:async()=>{closed=true},abort:async()=>{}});
  await writer.push(ts);await assert.rejects(()=>writer.close(),/disk full/);assert(patchAttempted);assert(!closed);await writer.abort();
  console.log('PASS: real B-frame/AAC fragment durations, 64-bit durations over 24 hours, malformed/empty input, finalization disk failure prevents close');
})().catch(e=>{console.error(e);process.exitCode=1;});
