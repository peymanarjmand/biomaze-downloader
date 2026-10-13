import struct,json,sys
from pathlib import Path
U=lambda b,o: struct.unpack_from('>I',b,o)[0]
Q=lambda b,o: struct.unpack_from('>Q',b,o)[0]
def boxes(b,start=0,end=None):
 end=len(b) if end is None else end
 while start<end:
  size=U(b,start);typ=b[start+4:start+8].decode('ascii');hdr=8
  if size==1:size=Q(b,start+8);hdr=16
  if size==0:size=end-start
  assert size>=hdr and start+size<=end,(typ,size,start,end)
  yield typ,start,hdr,size
  start+=size

def inspect(file):
 tracks={};mvh=None;count=0
 with open(file,'rb') as f:
  while True:
   head=f.read(8)
   if not head:break
   size,typ=struct.unpack('>I4s',head);hdr=8
   if size==1:size=struct.unpack('>Q',f.read(8))[0];hdr=16
   if typ not in [b'moov',b'moof']:f.seek(size-hdr,1);continue
   b=f.read(size-hdr)
   if typ==b'moov':
    for t,s,h,z in boxes(b):
     x=s+h
     if t=='mvhd':
      v=b[x];o=x+(20 if v else 12);ts=U(b,o);du=Q(b,o+4) if v else U(b,o+4);mvh={'timescale':ts,'duration':du,'seconds':du/ts}
     if t=='trak':
      tr={}
      for t2,s2,h2,z2 in boxes(b,x,s+z):
       y=s2+h2
       if t2=='tkhd':
        v=b[y];tr['id']=U(b,y+(20 if v else 12));o=y+(28 if v else 20);tr['tkhdDuration']=Q(b,o) if v else U(b,o)
       if t2=='mdia':
        for t3,s3,h3,z3 in boxes(b,y,s2+z2):
         v3=s3+h3
         if t3=='mdhd':
          v=b[v3];o=v3+(20 if v else 12);tr['timescale']=U(b,o);tr['mdhdDuration']=Q(b,o+4) if v else U(b,o+4)
         if t3=='hdlr':tr['kind']=b[v3+8:v3+12].decode()
      tr.update(first=None,last=0,samples=0,fragments=0,maxGap=0)
      tracks[tr['id']]=tr
   else:
    count+=1
    for t,s,h,z in boxes(b):
     if t!='traf':continue
     track=None;base=None;runs=[];defaultDur=0
     for t2,s2,h2,z2 in boxes(b,s+h,s+z):
      x=s2+h2;flags=U(b,x)&0xffffff
      if t2=='tfhd':
       track=tracks[U(b,x+4)];o=x+8
       if flags&1:o+=8
       if flags&2:o+=4
       if flags&8:defaultDur=U(b,o)
      if t2=='tfdt':base=Q(b,x+4) if b[x] else U(b,x+4)
      if t2=='trun':runs.append((x,flags))
     cursor=base
     track['first']=base if track['first'] is None else min(track['first'],base)
     if track['fragments']:track['maxGap']=max(track['maxGap'],abs(base-track['last']))
     for x,flags in runs:
      n=U(b,x+4);o=x+8+(4 if flags&1 else 0)+(4 if flags&4 else 0)
      for _ in range(n):
       dur=U(b,o) if flags&256 else defaultDur
       cursor+=dur;o+=sum(4 for flag in [256,512,1024,2048] if flags&flag)
      track['samples']+=n
     track['last']=max(track['last'],cursor);track['fragments']+=1
 for tr in tracks.values():
  tr['headerSeconds']=tr['mdhdDuration']/tr['timescale'];tr['actualEndSeconds']=tr['last']/tr['timescale'];tr['actualSpanSeconds']=(tr['last']-tr['first'])/tr['timescale'];tr['maxGapSeconds']=tr['maxGap']/tr['timescale']
 return {'file':str(file),'movieHeader':mvh,'fragments':count,'tracks':list(tracks.values())}
if __name__=='__main__':
 for name in sys.argv[1:]:print(json.dumps(inspect(name),ensure_ascii=False,indent=2))
