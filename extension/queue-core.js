'use strict';
globalThis.BiomazeQueueCore = (() => {
  const formatters=new Map();
  function videoURL(value) {
    return BiomazeSites.videoURL(value);
  }
  function schedule(value) {
    if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.end) || value.start === value.end) throw new Error('ساعت شروع و پایان باید معتبر و متفاوت باشند.');
    new Intl.DateTimeFormat('en', {timeZone:value.timeZone}).format();
    return {enabled:!!value.enabled, start:value.start, end:value.end, timeZone:value.timeZone, keepAwake:!!value.keepAwake};
  }
  function minuteAt(date, zone) {
    if(!formatters.has(zone)) formatters.set(zone,new Intl.DateTimeFormat('en-GB', {timeZone:zone, hour:'2-digit', minute:'2-digit', hourCycle:'h23'}));
    const parts = formatters.get(zone).formatToParts(date);
    return Number(parts.find(p=>p.type==='hour').value)*60 + Number(parts.find(p=>p.type==='minute').value);
  }
  const timeMinute = v => Number(v.slice(0,2))*60+Number(v.slice(3));
  function inWindow(s, now=Date.now()) {
    if (!s.enabled) return true;
    const m=minuteAt(now,s.timeZone), start=timeMinute(s.start), end=timeMinute(s.end);
    return start < end ? m>=start && m<end : m>=start || m<end;
  }
  function nextBoundary(s, now=Date.now()) {
    if (!s.enabled) return null;
    const current=inWindow(s,now), base=Math.floor(now/60000)*60000;
    // Scan real minutes: handles midnight and daylight-saving transitions in the selected zone.
    for(let i=1;i<=1500;i++) if(inWindow(s,base+i*60000)!==current) return base+i*60000;
    return null;
  }
  function defaults() { return {version:1, running:false, items:[], active:null, notice:'', schedule:{enabled:false,start:'02:00',end:'07:00',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',keepAwake:true}}; }
  function quality(levels, wanted) {
    const sorted=[...levels].sort((a,b)=>b.height-a.height || b.bitrate-a.bitrate);
    return (!wanted ? sorted[0] : sorted.find(l=>l.height<=wanted && l.height>0) || sorted.at(-1));
  }
  return {videoURL,schedule,inWindow,nextBoundary,defaults,quality};
})();
