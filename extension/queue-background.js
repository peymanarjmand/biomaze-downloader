'use strict';
const QC=BiomazeQueueCore, QUEUE_KEY='biomazeQueueV1';
let queueSerial=Promise.resolve(), queueData=null;
const extensionPage = sender => sender.id===chrome.runtime.id && !sender.tab?.url?.startsWith('https:') && sender.url?.startsWith(chrome.runtime.getURL(''));
const sitePage = sender => sender.id===chrome.runtime.id && sender.frameId===0 && sender.tab && allowed(sender.url);
function queueTask(fn) {
  const result=queueSerial.catch(()=>{}).then(async()=>{
    queueData ||= (await chrome.storage.local.get(QUEUE_KEY))[QUEUE_KEY] || QC.defaults();
    const value=await fn(queueData);
    await chrome.storage.local.set({[QUEUE_KEY]:queueData});
    await queuePlan(queueData);
    return value;
  });
  queueSerial=result; return result;
}
function currentItem(s) { return s.items.find(i=>i.id===s.active?.itemId); }
function runnable(s) { return s.running && QC.inWindow(s.schedule); }
async function queuePlan(s) {
  const pending=s.items.some(i=>i.status==='waiting') || !!s.active;
  const armed=s.running && pending;
  if (armed && s.schedule.keepAwake) chrome.power.requestKeepAwake('system');
  else chrome.power.releaseKeepAwake();
  const alarm=await chrome.alarms.get('queue-watch');
  if ((s.active || armed) && !alarm) await chrome.alarms.create('queue-watch',{periodInMinutes:0.5});
  else if (!s.active && !armed && alarm) await chrome.alarms.clear('queue-watch');
  const boundary=armed ? QC.nextBoundary(s.schedule) : null;
  const existing=await chrome.alarms.get('queue-boundary');
  if (boundary && Math.abs((existing?.scheduledTime || 0)-boundary)>1000) await chrome.alarms.create('queue-boundary',{when:boundary});
  else if (!boundary && existing) await chrome.alarms.clear('queue-boundary');
  await chrome.action.setBadgeText({text:s.active ? (runnable(s)?'↓':'Ⅱ') : armed?'◷':''});
  await chrome.action.setBadgeBackgroundColor({color:'#244bd7'});
}
async function workerMessage(s, data) {
  if (!s.active?.tabId) return null;
  try { return await chrome.tabs.sendMessage(s.active.tabId,{...data,token:s.active.token},{frameId:0}); } catch { return null; }
}
async function finishItem(s, outcome, details={}) {
  const active=s.active, item=currentItem(s); if(!active || !item) return;
  item.status=outcome==='done'?'done':active.cancelling?'cancelled':outcome;
  item.error=String(details.error || '').slice(0,350); item.updatedAt=Date.now();
  if(outcome==='done') { item.progress=100; item.filename=details.filename || item.filename; item.downloadId=details.downloadId || item.downloadId; }
  s.active=null;
  // Commit completion before closing the disposable worker tab or advancing the queue.
  await chrome.storage.local.set({[QUEUE_KEY]:s});
  if (active.tabId) await chrome.tabs.remove(active.tabId).catch(()=>{});
  await queueTick(s);
}
async function blockQueue(s, text, status='failed') {
  const item=currentItem(s); if(item) { item.status=status; item.error=text; }
  s.running=false; s.notice=text;
  // Keep a login/blocked tab available for the user. Never attempt authentication.
  s.active=null;
}
async function queueTick(s) {
  const item=currentItem(s);
  if (s.active && item) {
    const a=s.active;
    const tab=await chrome.tabs.get(a.tabId).catch(()=>null);
    if(!tab) {
      if(item.downloadId) {
        const [d]=await chrome.downloads.search({id:item.downloadId});
        if(d?.state==='complete') return finishItem(s,'done',{filename:d.filename,downloadId:d.id});
      }
      item.status='waiting'; item.progress=0; item.error='تب دانلود بسته شد؛ این ویدیو از ابتدا دریافت خواهد شد.';
      s.active=null; s.running=false; s.notice='تب مخصوص دانلود بسته شد. برای ادامهٔ صف «شروع / ادامه» را بزن.'; return;
    }
    if(tab.url && /\/login(?:[/?#]|$)/.test(tab.url)) return blockQueue(s,'سایت نیاز به ورود دارد. وارد حساب شو و این مورد را دوباره به صف برگردان.','login');
    if(a.cancelling) { await workerMessage(s,{type:'queue-control',action:'cancel'}); return; }
    const response=await workerMessage(s,{type:'queue-control',action:runnable(s)?'resume':'pause',schedule:s.schedule,manualPause:!s.running});
    if(response?.busy && response.token===a.token) {
      a.lastSeen=Date.now(); a.phase=response.finishing?'saving':runnable(s)?'running':'paused'; item.status=a.phase;
      return;
    }
    if(Date.now()-a.lastSeen>180000) {
      if(item.downloadId) {
        const [d]=await chrome.downloads.search({id:item.downloadId});
        if(d?.state==='complete') return finishItem(s,'done',{filename:d.filename,downloadId:d.id});
      }
      return blockQueue(s,'پلیر آماده نشد یا ارتباط با تب قطع شد. تب را بررسی و سپس تلاش مجدد کن.');
    }
    return;
  }
  if(!runnable(s)) return;
  const next=s.items.find(i=>i.status==='waiting');
  if(!next) { s.running=false; s.notice='صف تمام شد. موارد ناموفق را می‌توانی دوباره امتحان کنی.'; return; }
  next.status='loading'; next.progress=0; next.error=''; next.downloadId=null; next.attempts=(next.attempts||0)+1;
  const tab=await chrome.tabs.create({url:'about:blank',active:false});
  s.active={itemId:next.id,token:crypto.randomUUID(),tabId:tab.id,phase:'loading',lastSeen:Date.now()};
  s.notice='';
  await chrome.storage.local.set({[QUEUE_KEY]:s});
  await chrome.tabs.update(tab.id,{autoDiscardable:false,muted:true,url:next.url});
}
async function queueSaveStarted(tabId,id) {
  return queueTask(async s=>{ if(s.active?.tabId===tabId) { const item=currentItem(s); item.downloadId=id; item.status='saving'; s.active.phase='saving'; } });
}
async function queueHandle(m,sender) {
  const isUI=extensionPage(sender), isSite=sitePage(sender);
  if(!isUI && !isSite) throw new Error('درخواست صف از صفحهٔ نامعتبر است.');
  return queueTask(async s=>{
    if(m.type==='queue-open') { await chrome.tabs.create({url:chrome.runtime.getURL('queue.html')}); return {}; }
    if(m.type==='queue-add') {
      const entries=m.items;
      if(!Array.isArray(entries) || !entries.length || entries.length>200 || s.items.length+entries.length>500) throw new Error('هر بار ۱ تا ۲۰۰ لینک وارد کن؛ حداکثر صف ۵۰۰ مورد است.');
      const prepared=entries.map(v=>({url:QC.videoURL(v.url),title:String(v.title||'').slice(0,160),quality:[0,360,480,720,1080,1440,2160].includes(Number(v.quality))?Number(v.quality):0,name:String(v.name||'').slice(0,160)}));
      let added=0;
      for(const v of prepared) {
        if(s.items.some(i=>i.url===v.url && !['cancelled','failed','login'].includes(i.status))) continue;
        s.items.push({...v,id:crypto.randomUUID(),status:'waiting',progress:0,attempts:0,createdAt:Date.now()}); added++;
      }
      await queueTick(s); return {added};
    }
    if(m.type==='queue-hello') {
      if(!isSite || s.active?.tabId!==sender.tab.id) return {};
      const item=currentItem(s);
      if(/\/login(?:[/?#]|$)/.test(sender.url)) { await blockQueue(s,'برای ادامهٔ صف، دوباره وارد حساب سایت شو.','login'); return {}; }
      let url; try {url=QC.videoURL(sender.url);} catch {return {};}
      if(url!==item.url) {await blockQueue(s,'صفحهٔ تب دانلود تغییر کرده است؛ ویدیوی صف اجرا نشد.'); return {};}
      return {assignment:{token:s.active.token,item,schedule:s.schedule,manualPause:!s.running}};
    }
    if(m.type==='queue-report') {
      if(!isSite || s.active?.tabId!==sender.tab.id || s.active.token!==m.token) return {};
      const item=currentItem(s); s.active.lastSeen=Date.now();
      if(!item.title && typeof m.title==='string') item.title=m.title.slice(0,160);
      if(m.phase==='done') {
        const d=await ownedDownload(m.downloadId,sender.tab.id);
        if(d.state!=='complete') throw new Error('ذخیرهٔ فایل هنوز کامل نشده است.');
        item.bytes=d.fileSize>0?d.fileSize:item.bytes;
        await finishItem(s,'done',{filename:d.filename,downloadId:d.id});
      } else if(m.phase==='failed') await finishItem(s,'failed',{error:m.error});
      else { item.status=['running','paused','saving'].includes(m.phase)?m.phase:item.status; item.progress=Math.max(0,Math.min(100,Number(m.progress)||0)); item.bytes=Number(m.bytes)||0; if(m.actualQuality)item.actualQuality=String(m.actualQuality).slice(0,30); }
      return {};
    }
    if(!isUI) throw new Error('این کار از پنجرهٔ مدیریت صف انجام می‌شود.');
    if(m.type==='queue-get') return {state:s};
    if(m.type==='queue-start') { s.running=true; s.notice=''; await queueTick(s); }
    else if(m.type==='queue-pause') {s.running=false; await queueTick(s);}
    else if(m.type==='queue-settings') {s.schedule=QC.schedule(m.schedule); await queueTick(s);}
    else if(m.type==='queue-retry') {
      const item=s.items.find(i=>i.id===m.id); if(item && ['failed','cancelled','login'].includes(item.status)) {item.status='waiting'; item.progress=0; item.error='';} await queueTick(s);
    } else if(m.type==='queue-remove') {
      if(s.active?.itemId===m.id) {
        if(currentItem(s)?.status==='saving') throw new Error('فایل در حال ذخیرهٔ نهایی است؛ منتظر پایان ذخیره بمان.');
        s.active.cancelling=true;
        const result=await workerMessage(s,{type:'queue-control',action:'cancel'});
        if(result?.finishing) {s.active.cancelling=false;throw new Error('فایل در حال ذخیرهٔ نهایی است؛ منتظر پایان ذخیره بمان.');}
        if(!result?.busy && currentItem(s)?.status==='loading') await finishItem(s,'cancelled');
      }
      else s.items=s.items.filter(i=>i.id!==m.id);
    } else if(m.type==='queue-move') {
      const from=s.items.findIndex(i=>i.id===m.id), to=from+(m.direction===-1?-1:1);
      if(from>=0 && to>=0 && to<s.items.length) {const [item]=s.items.splice(from,1);s.items.splice(to,0,item);}
    } else if(m.type==='queue-clear-done') s.items=s.items.filter(i=>i.status!=='done');
    else if(m.type==='queue-show') {
      const item=s.items.find(i=>i.id===m.id); if(item?.status!=='done' || !Number.isInteger(item.downloadId)) throw new Error('فایل ذخیره‌شده پیدا نشد.');
      const [d]=await chrome.downloads.search({id:item.downloadId});
      if(!d || d.byExtensionId!==chrome.runtime.id || d.state!=='complete' || d.exists===false) throw new Error('فایل حذف یا جابه‌جا شده است.');
      chrome.downloads.show(d.id);
    } else if(m.type==='queue-worker') {if(s.active?.tabId) await chrome.tabs.update(s.active.tabId,{active:true});}
    else throw new Error('درخواست صف شناخته نشد.');
    return {state:s};
  });
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(!m?.type?.startsWith('queue-')) return;
  queueHandle(m,sender).then(value=>reply({ok:true,...value}),error=>reply({ok:false,error:error.message})); return true;
});
chrome.alarms.onAlarm.addListener(a=>{if(a.name.startsWith('queue-')) void queueTask(queueTick).catch(()=>{});});
chrome.tabs.onRemoved.addListener(id=>{void queueTask(async s=>{if(s.active?.tabId===id) await queueTick(s);}).catch(()=>{});});
chrome.runtime.onStartup.addListener(()=>{void queueTask(async s=>{
  if(s.active) { const item=currentItem(s); if(item?.downloadId) { const [d]=await chrome.downloads.search({id:item.downloadId}); if(d?.state==='complete') {item.status='done';item.filename=d.filename;item.progress=100;} else {item.status='waiting';item.progress=0;} } else if(item) {item.status='waiting';item.progress=0;}
    s.active=null; s.running=false; s.notice='مرورگر دوباره باز شده؛ صف محفوظ است. ویدیوی نیمه‌تمام از ابتدا دریافت می‌شود. برای ادامه شروع را بزن.';
  } await queueTick(s);
}).catch(()=>{});});
chrome.runtime.onInstalled.addListener(()=>{void queueTask(queueTick).catch(()=>{});});
void queueTask(async()=>{}).catch(()=>{});
