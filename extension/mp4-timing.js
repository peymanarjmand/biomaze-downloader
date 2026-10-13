/* Finalize mux.js fragmented MP4 duration headers without changing media timestamps. */
globalThis.BiomazeMp4Timing = (() => {
  const fail = () => { throw new Error('زمان‌بندی فایل MP4 معتبر نیست؛ فایل ناقص ذخیره نشد.'); };
  const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  function boxes(bytes, start = 0, end = bytes.length) {
    const result = [], v = view(bytes);
    while (start < end) {
      if (end - start < 8) fail();
      let size = v.getUint32(start), header = 8;
      if (size === 1) {
        if (end - start < 16) fail();
        size = Number(v.getBigUint64(start + 8)); header = 16;
      } else if (!size) size = end - start;
      if (!Number.isSafeInteger(size) || size < header || start + size > end) fail();
      result.push({type:String.fromCharCode(...bytes.subarray(start+4,start+8)), start, body:start+header, end:start+size});
      start += size;
    }
    return result;
  }
  const children = (bytes, box) => boxes(bytes, box.body, box.end);
  const one = (list, type) => list.find(b => b.type === type) || fail();
  function join(parts) {
    const output = new Uint8Array(parts.reduce((size,b) => size+b.length,0));
    let offset = 0; for (const part of parts) {output.set(part,offset); offset+=part.length;}
    return output;
  }
  function longHeaders(bytes) {
    return join(boxes(bytes).map(box => {
      let payload = bytes.subarray(box.body, box.end);
      if (['moov','trak','mdia'].includes(box.type)) payload = longHeaders(payload);
      else if (['mvhd','tkhd','mdhd'].includes(box.type) && payload[0] === 0) {
        // Reserve 64-bit durations before writing the first byte: even long courses
        // can then be finalized in place without shifting any fragment offsets.
        const old = payload, v = view(old), duration = box.type === 'tkhd' ? 20 : 16;
        payload = new Uint8Array(old.length+12); payload.set(old.subarray(0,4)); payload[0]=1;
        const next = view(payload);
        next.setBigUint64(4,BigInt(v.getUint32(4))); next.setBigUint64(12,BigInt(v.getUint32(8)));
        payload.set(old.subarray(12,duration),20);
        next.setBigUint64(duration+8,0n); payload.set(old.subarray(duration+4),duration+16);
      }
      const out = new Uint8Array(8+payload.length); view(out).setUint32(0,out.length);
      out.set([...box.type].map(c=>c.charCodeAt(0)),4); out.set(payload,8); return out;
    }));
  }
  function durationField(bytes, box) {
    const version = bytes[box.body]; if (version !== 0 && version !== 1) fail();
    const relative = box.type === 'tkhd' ? (version ? 28 : 20) : (version ? 24 : 16);
    const offset = box.body + relative;
    if (offset + (version ? 8 : 4) > box.end) fail();
    return {offset, version};
  }
  function setDuration(bytes, field, ticks) {
    if (ticks < 0n || ticks >= 0xffffffffffffffffn) fail();
    if (field.version) view(bytes).setBigUint64(field.offset,ticks);
    else {if(ticks >= 0xffffffffn) fail(); view(bytes).setUint32(field.offset,Number(ticks));}
  }
  return class {
    constructor(init, {upgrade = true} = {}) {
      this.init = upgrade ? longHeaders(init) : new Uint8Array(init);
      this.tracks = new Map();
      const b = this.init, v = view(b), moov = one(boxes(b),'moov'), list = children(b,moov);
      const movie = one(list,'mvhd'); this.movie = durationField(b,movie);
      this.movieScale = v.getUint32(this.movie.offset-4); if(!this.movieScale) fail();
      for (const trak of list.filter(box=>box.type==='trak')) {
        const tkhd=one(children(b,trak),'tkhd'), mdia=one(children(b,trak),'mdia');
        const mdhd=one(children(b,mdia),'mdhd'), field=durationField(b,mdhd);
        const id=v.getUint32(tkhd.body+(b[tkhd.body] ? 20 : 12));
        const scale=v.getUint32(field.offset-4); if(!scale || this.tracks.has(id)) fail();
        this.tracks.set(id,{scale,field,trackField:durationField(b,tkhd),end:0n,samples:0,defaultDuration:0});
      }
      const mvex=list.find(box=>box.type==='mvex');
      if(mvex) for(const trex of children(b,mvex).filter(box=>box.type==='trex')) {
        const track=this.tracks.get(v.getUint32(trex.body+4));
        if(track) track.defaultDuration=v.getUint32(trex.body+12);
      }
      if(!this.tracks.size) fail();
    }
    push(bytes) {
      const v=view(bytes);
      for(const moof of boxes(bytes).filter(box=>box.type==='moof')) {
        for(const traf of children(bytes,moof).filter(box=>box.type==='traf')) {
          const list=children(bytes,traf), tfhd=one(list,'tfhd'), tfdt=one(list,'tfdt');
          const flags=v.getUint32(tfhd.body)&0xffffff, track=this.tracks.get(v.getUint32(tfhd.body+4));
          // mux.js uses relative fragment offsets; absolute offsets cannot survive an expanded init.
          if(!track || flags&1) fail();
          let offset=tfhd.body+8+(flags&2 ? 4 : 0);
          const duration=flags&8 ? v.getUint32(offset) : track.defaultDuration;
          if(bytes[tfdt.body]!==0 && bytes[tfdt.body]!==1) fail();
          let dts=bytes[tfdt.body] ? v.getBigUint64(tfdt.body+4) : BigInt(v.getUint32(tfdt.body+4));
          for(const trun of list.filter(box=>box.type==='trun')) {
            const version=bytes[trun.body], flags=v.getUint32(trun.body)&0xffffff, count=v.getUint32(trun.body+4);
            if(version!==0 && version!==1) fail();
            offset=trun.body+8+(flags&1 ? 4 : 0)+(flags&4 ? 4 : 0);
            const stride=[256,512,1024,2048].filter(flag=>flags&flag).length*4;
            if(offset+count*stride>trun.end || count>1000000) fail();
            for(let i=0;i<count;i++) {
              const ticks=flags&256 ? v.getUint32(offset) : duration; if(!ticks) fail();
              if(flags&256) offset+=4;
              if(flags&512) offset+=4;
              if(flags&1024) offset+=4;
              let cts=0;
              if(flags&2048) {cts=version ? v.getInt32(offset) : v.getUint32(offset);offset+=4;}
              const end=dts+BigInt(cts)+BigInt(ticks);
              dts+=BigInt(ticks); track.end=track.end>end ? track.end : end; track.samples++;
            }
            if(dts>track.end) track.end=dts;
          }
        }
      }
    }
    finish() {
      let movieEnd=0n;
      for(const track of this.tracks.values()) {
        if(!track.samples || track.end<=0n) fail();
        const scaled=(track.end*BigInt(this.movieScale)+BigInt(track.scale)-1n)/BigInt(track.scale);
        setDuration(this.init,track.field,track.end); setDuration(this.init,track.trackField,scaled);
        if(scaled>movieEnd) movieEnd=scaled;
      }
      setDuration(this.init,this.movie,movieEnd);
      return this.init;
    }
  };
})();
