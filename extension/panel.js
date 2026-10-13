(() => {
  'use strict';
  const CHANNEL = 'biomaze-personal-downloader-v1';
  let target = null, job = null, writer = null, working = false, nextIndex = 0, savedLevels = '';
  let staged = null, completed = null, finishing = false, currentName = '', currentSaveAs = true;
  let pendingWrite = Promise.resolve(), positionTouched = false, settingsTouched = false;
  let assignment=null, queueStarting=false, queuePaused=false, lastReport=0, lastProgress=0;
  const host = document.createElement('div');
  host.id = 'biomaze-downloader-panel';
  host.style.cssText = 'all:initial;position:fixed;bottom:20px;left:20px;z-index:2147483647;';
  const isVideoPage = () => { try { BiomazeSites.videoURL(location.href); return true; } catch { return false; } };
  if (!isVideoPage()) host.style.display = 'none';
  const root = host.attachShadow({mode: 'open'});
  root.innerHTML = `<style>
    *{box-sizing:border-box} :host{color-scheme:light} [hidden]{display:none!important} section{width:330px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;direction:rtl;font:13px/1.8 Tahoma,Arial,sans-serif;background:#fff;color:#172037;border:1px solid #dae1ef;border-radius:18px;box-shadow:0 10px 45px #17203730;padding:16px}
    header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}b{font-size:15px}button,select{font:inherit;border-radius:9px;padding:8px 12px;border:1px solid #d1d9e6}button{cursor:pointer;background:#eff3fa;color:#172037}button:focus-visible,select:focus-visible{outline:3px solid #f0b53e;outline-offset:2px}button:disabled{opacity:.5;cursor:default}#start{background:#244bd7;color:white;border-color:#244bd7;flex:1}#close{padding:0 7px;font-size:20px;border:0;background:transparent}select{width:100%;background:white;color:#172037;margin:5px 0 12px}p{margin:10px 0;overflow-wrap:anywhere;font-size:12px;color:#475570}progress{width:100%;height:8px;accent-color:#244bd7}nav{display:flex;gap:8px}small{font-size:11px;color:#64748b}
    #drag{flex:1;border:0;text-align:right;background:transparent;font-weight:bold;font-size:14px;padding:4px;cursor:grab;touch-action:none;user-select:none}#drag:active{cursor:grabbing}#drag span{color:#8290ac;margin-left:5px}input{font:inherit;border-radius:9px;border:1px solid #d1d9e6;padding:8px 10px;width:100%;margin:3px 0 8px;direction:ltr;background:white;color:#172037}input:focus-visible{outline:3px solid #f0b53e;outline-offset:2px}select{margin:3px 0 8px}nav{margin-top:12px}small{display:block}#result{margin-top:12px;border-top:1px solid #e3e8f0;padding-top:10px}#path{direction:ltr;text-align:left;font-size:11px;max-height:80px;overflow:auto}#show-file{width:100%}
  </style><section aria-label="دانلودر ویدیو"><header><button id="drag" title="بکش و جابه‌جا کن؛ کلیدهای جهت هم پنل را حرکت می‌دهند" aria-label="جابه‌جایی پنل دانلود"><span aria-hidden="true">⠿</span>دانلود ویدیو</button><button id="close" aria-label="بستن پنل">×</button></header><label for="quality">کیفیت ویدیو</label><select id="quality" disabled><option>در انتظار پلیر…</option></select>
  <label for="filename">نام فایل</label><input id="filename" maxlength="160" value="Biomaze.mp4">
  <label for="destination">محل ذخیره</label><select id="destination"><option value="ask">هر بار خودم انتخاب کنم</option><option value="default">پوشهٔ دانلودهای Chrome</option></select><small id="destination-hint">پس از دریافت ویدیو، پنجرهٔ انتخاب محل ذخیره باز می‌شود.</small>
  <nav><button id="start" disabled>دانلود MP4</button><button id="cancel" disabled>لغو</button></nav><p id="status" role="status" aria-live="polite">ویدیو را یک‌بار پخش کن تا شناسایی شود.</p><progress id="progress" max="100" value="0" aria-label="پیشرفت دانلود"></progress><small>تا پایان ذخیره، این صفحه را باز نگه دار.</small>
  <nav><button id="add-queue">افزودن به صف</button><button id="open-queue">صف و دانلود شبانه</button></nav><small id="queue-note"></small>
  <div id="result" hidden><small>آخرین فایل ذخیره‌شده</small><p id="path"></p><button id="show-file">نمایش در پوشه</button></div></section>`;
  document.documentElement.append(host);
  const $ = id => root.getElementById(id);
  const tell = text => { $('status').textContent = text; };
  const post = (type, extra = {}) => target?.source.postMessage({channel: CHANNEL, frame: target.frame, type, ...extra}, target.origin);
  function controls(busy) {
    working = busy; $('quality').disabled = busy || !target;
    $('filename').disabled = busy; $('destination').disabled = busy;
    $('start').disabled = busy || !target || !!assignment; $('cancel').disabled = !busy || finishing;
    $('add-queue').disabled=!!assignment || !isVideoPage();
  }
  function videoTitle() {
    if (BiomazeSites.site(location.href) === 'salescenter') return document.title.replace(/\s*[–—|\-]\s*Sales Center 24\s*$/i,'').trim() || 'SalesCenter24';
    const same=[...document.querySelectorAll('a[href]')].find(a=>{try{return new URL(a.href).pathname===location.pathname && a.textContent.trim();}catch{return false;}});
    return same?.textContent.trim() || document.querySelector('main h1,main h2,h1,h2')?.textContent?.trim() || 'Biomaze';
  }
  function filename() {
    const title = videoTitle();
    const id = location.pathname.match(/\/(?:video|topic)\/([^/]+)/)?.[1]?.slice(0,8) || new Date().toISOString().slice(0,10);
    return `${title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').slice(0,90)}-${id}-${$('quality').selectedOptions[0]?.textContent || 'video'}.mp4`;
  }
  function chosenName() {
    let name = $('filename').value.normalize('NFC').trim().replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,'').replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/^[. ]+|[. ]+$/g, '').slice(0,150);
    if (!name) name = filename();
    if (!/\.mp4$/i.test(name)) name += '.mp4';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name)) name = `Biomaze-${name}`;
    $('filename').value = name; return name;
  }
  function updateDestination() {
    $('destination-hint').textContent = $('destination').value === 'ask' ? 'پس از دریافت ویدیو، پنجرهٔ انتخاب محل ذخیره باز می‌شود.' : 'در پوشهٔ پیش‌فرض دانلودهای کروم ذخیره می‌شود.';
  }
  $('quality').onchange = () => { $('filename').value = filename(); };
  $('destination').onchange = () => {
    settingsTouched = true; updateDestination();
    void chrome.storage.local.set({saveDestination:$('destination').value}).catch(() => {});
  };
  function move(left, top) {
    const box = host.getBoundingClientRect();
    const x = Math.max(8, Math.min(Number(left) || 0, Math.max(8, innerWidth - box.width - 8)));
    const y = Math.max(8, Math.min(Number(top) || 0, Math.max(8, innerHeight - box.height - 8)));
    Object.assign(host.style, {left:`${x}px`, top:`${y}px`, bottom:'auto', right:'auto'});
  }
  function rememberPosition() {
    const box = host.getBoundingClientRect();
    void chrome.storage.local.set({panelPosition:{left:box.left,top:box.top}}).catch(() => {});
  }
  let drag = null;
  $('drag').addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const box = host.getBoundingClientRect(); positionTouched = true;
    drag = {id:event.pointerId, dx:event.clientX-box.left, dy:event.clientY-box.top};
    $('drag').setPointerCapture(event.pointerId); event.preventDefault();
  });
  $('drag').addEventListener('pointermove', event => { if (drag?.id === event.pointerId) move(event.clientX-drag.dx,event.clientY-drag.dy); });
  function endDrag(event) { if (drag?.id === event.pointerId) { drag = null; rememberPosition(); } }
  for (const event of ['pointerup','pointercancel','lostpointercapture']) $('drag').addEventListener(event,endDrag);
  $('drag').addEventListener('keydown', event => {
    const offsets = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if (!offsets[event.key]) return;
    event.preventDefault(); positionTouched = true;
    const box = host.getBoundingClientRect(), [dx,dy] = offsets[event.key], step = event.shiftKey ? 40 : 10;
    move(box.left+dx*step,box.top+dy*step); rememberPosition();
  });
  function keepVisible() { if (host.style.display !== 'none' && host.style.top) { const box=host.getBoundingClientRect(); move(box.left,box.top); } }
  window.addEventListener('resize',keepVisible); new ResizeObserver(keepVisible).observe(root.querySelector('section'));
  void chrome.storage.local.get(['panelPosition','saveDestination']).then(settings => {
    if (!settingsTouched && ['ask','default'].includes(settings.saveDestination)) { $('destination').value=settings.saveDestination; updateDestination(); }
    const p=settings.panelPosition;
    if (!positionTouched && Number.isFinite(p?.left) && Number.isFinite(p?.top)) move(p.left,p.top);
  }).catch(() => {});
  $('close').onclick = () => { host.style.display = 'none'; };
  $('open-queue').onclick=event=>{if(event.isTrusted)void BiomazeSave.request({type:'queue-open'}).catch(error=>tell(error.message));};
  async function addCurrent() {
    const quality=Number($('quality').selectedOptions[0]?.textContent.match(/^(\d+)p$/)?.[1]) || 0;
    const result=await BiomazeSave.request({type:'queue-add',items:[{url:location.href,title:videoTitle(),quality,name:chosenName()}]});
    $('queue-note').textContent=result.added?'به صف اضافه شد؛ از مدیریت صف شروع کن.':'این ویدیو قبلاً در صف است.';
    return result;
  }
  $('add-queue').onclick=event=>{if(event.isTrusted)void addCurrent().catch(error=>tell(error.message));};
  $('show-file').onclick = async event => {
    if (!event.isTrusted || !completed) return;
    try { await BiomazeSave.request({type:'show-file',id:completed.id}); } catch (error) { tell(error.message); }
  };
  $('cancel').onclick = () => { if (job && !finishing) { staged.cancelled=true; post('cancel',{job}); tell('در حال لغو…'); } };
  async function reset() {
    await pendingWrite.catch(() => {}); await writer?.abort(); await staged?.dispose();
    writer=null; staged=null; job=null; finishing=false; controls(false);
  }
  async function beginDownload(queued=false) {
    if (working || !target) return;
    controls(true);
    try {
      currentName=chosenName(); currentSaveAs=queued?false:$('destination').value==='ask';
      tell('در حال آماده‌سازی دانلود…'); staged=await BiomazeSave.create();
      writer = new BiomazeMp4Writer(staged.writable);
      job = crypto.randomUUID(); nextIndex = 0; pendingWrite=Promise.resolve();
      $('progress').value = 0; tell('در حال دریافت فهرست ویدیو…');
      post('start', {job, level: Number($('quality').value),queue:queued,schedule:assignment?.schedule,manualPause:assignment?.manualPause});
    } catch (error) {
      await reset(); tell(`ذخیره شروع نشد: ${error.message}`);
      if(queued) await reportQueue('failed',{error:error.message});
    }
  }
  $('start').onclick = async event => {
    if (!event.isTrusted || assignment) return;
    await beginDownload(false);
  };
  async function reportQueue(phase,details={}) {
    if(!assignment) return;
    lastReport=Date.now();
    try {await BiomazeSave.request({type:'queue-report',token:assignment.token,phase,progress:lastProgress,bytes:writer?.bytes||0,title:videoTitle(),actualQuality:$('quality').selectedOptions[0]?.textContent,...details});}
    catch(error) {if(phase==='done' || phase==='failed') tell(`${$('status').textContent} · ارتباط با صف: ${error.message}`);}
  }
  async function tryQueue() {
    if(!assignment || queueStarting || working || !target || assignment.manualPause || !BiomazeQueueCore.inWindow(assignment.schedule)) return;
    queueStarting=true;
    const levels=[...$('quality').options].map(o=>({index:Number(o.value),height:Number(o.textContent.match(/^(\d+)p$/)?.[1])||0,bitrate:0}));
    const selected=BiomazeQueueCore.quality(levels,assignment.item.quality);
    $('quality').value=String(selected.index);
    $('filename').value=assignment.item.name || filename();
    $('destination').value='default';updateDestination();
    $('queue-note').textContent='تب مخصوص صف؛ تا پایان دانلود آن را باز نگه دار.';
    await reportQueue('running'); await beginDownload(true);
  }
  async function helloQueue() {
    if(assignment) return;
    try {
      const r=await BiomazeSave.request({type:'queue-hello'});
      if(r.assignment && !assignment) {assignment=r.assignment; controls(working);window.postMessage({channel:CHANNEL,type:'prepare-queue'},location.origin);void tryQueue();}
    } catch {}
  }
  window.addEventListener('message', async event => {
    const m = event.data;
    let origin;
    try { origin = new URL(event.origin); } catch { return; }
    if (!BiomazeSites.playerOrigin(event.origin, location.href)) return;
    const fromThisPage = event.source === window;
    const fromPlayerFrame = [...document.querySelectorAll('iframe')].some(frame => {
      try { return frame.contentWindow === event.source && new URL(frame.src).origin === event.origin; } catch { return false; }
    });
    if (!fromThisPage && !fromPlayerFrame) return;
    if (!m || m.channel !== CHANNEL) return;
    if (m.type === 'status' && !working && Array.isArray(m.levels) && m.levels.length) {
      target = {source: event.source, origin: event.origin, frame: m.frame};
      const signature = JSON.stringify(m.levels);
      if (signature !== savedLevels) {
        if (!savedLevels) host.style.display = '';
        savedLevels = signature; $('quality').replaceChildren();
        for (const level of [...m.levels].sort((a,b) => b.height - a.height || b.bitrate - a.bitrate)) {
          const option = document.createElement('option'); option.value = level.index;
          option.textContent = level.height ? `${level.height}p` : `${Math.round(level.bitrate / 1000)} kbps`;
          $('quality').append(option);
        }
        tell('ویدیو شناسایی شد. کیفیت و محل ذخیره را انتخاب کن.');
        $('filename').value=filename(); keepVisible();
      }
      controls(false);
      void tryQueue();
    }
    if (!target || event.source !== target.source || m.frame !== target.frame) return;
    if (m.type === 'gone' && !working) { target = null; savedLevels = ''; controls(false); tell('پلیر بسته شد. ویدیوی بعدی را پخش کن.'); }
    if (!job || m.job !== job) return;
    if (m.type === 'chunk') {
      try {
        if (m.index !== nextIndex || !(m.data instanceof ArrayBuffer) || m.data.byteLength > 64 * 1024 * 1024) throw new Error('ترتیب قطعه‌های ویدیو معتبر نیست.');
        pendingWrite=writer.push(new Uint8Array(m.data)); await pendingWrite; nextIndex++;
        if (staged.cancelled) return;
        $('progress').value = Math.round(nextIndex / m.total * 100);
        lastProgress=$('progress').value;
        tell(`قطعهٔ ${nextIndex} از ${m.total} · ${(writer.bytes / 1e6).toFixed(1)} مگابایت`);
        if(assignment && Date.now()-lastReport>1500) void reportQueue('running');
        post('ack', {job, index: m.index});
      } catch (error) {
        post('ack', {job, index: m.index, error: true});
        post('cancel', {job}); job=null; await reset(); tell(error.message);
        if(assignment) await reportQueue('failed',{error:error.message});
      }
    }
    if (m.type === 'complete') {
      finishing=true; controls(true);
      let queueOutcome=null;
      try {
        await writer.close();
        tell(currentSaveAs ? 'دریافت تمام شد؛ محل ذخیره را در پنجرهٔ کروم انتخاب کن.' : 'دریافت تمام شد؛ در حال ذخیرهٔ فایل…');
        completed=await staged.finish(currentName,currentSaveAs);
        $('progress').value=100; $('path').textContent=completed.filename; $('result').hidden=false;
        tell(`فایل MP4 ذخیره شد · ${(writer.bytes / 1e6).toFixed(1)} مگابایت`);
        queueOutcome={phase:'done',downloadId:completed.id};
      } catch (error) { tell(error.name==='AbortError' ? 'ذخیره لغو شد.' : `ذخیرهٔ فایل کامل نشد: ${error.message}`);queueOutcome={phase:'failed',error:error.message}; }
      await reset();
      if(assignment) await reportQueue(queueOutcome.phase,queueOutcome);
    }
    if (m.type === 'failure') {
      job=null; await reset(); tell(m.message || 'دانلود کامل نشد.');
      if(assignment) await reportQueue('failed',{error:m.message});
    }
    if(m.type==='paused') {queuePaused=true; tell('دانلود صف مکث کرده؛ با ادامهٔ صف یا شروع بازهٔ شبانه ادامه می‌یابد.'); void reportQueue('paused');}
    if(m.type==='resumed') {queuePaused=false; tell('دانلود صف ادامه پیدا کرد.');void reportQueue('running');}
  });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if(sender.id!==chrome.runtime.id) return;
    if (message?.type === 'open-panel') { host.style.display = ''; keepVisible(); reply({ok: true}); window.postMessage({channel: CHANNEL, type: 'discover'}, location.origin); }
    if(message?.type==='add-current-queue') {addCurrent().then(reply,error=>reply({ok:false,error:error.message}));return true;}
    if(message?.type==='queue-control' && !sender.tab) {
      if(assignment?.token!==message.token) {void helloQueue();reply({busy:false});return;}
      if(message.action==='cancel') {
        if(working && !finishing) {staged.cancelled=true;post('cancel',{job});}
        else if(!working) void reportQueue('failed',{error:'این مورد از صف لغو شد.'});
      } else {
        assignment.schedule=message.schedule; assignment.manualPause=!!message.manualPause;
        post('queue-control',{job,schedule:assignment.schedule,manualPause:assignment.manualPause}); void tryQueue();
      }
      reply({busy:working,token:assignment.token,finishing});
    }
  });
  setInterval(()=>{
    if(!assignment) void helloQueue();
    else if(working) void reportQueue(finishing?'saving':queuePaused?'paused':'running');
    else void tryQueue();
  },10000);
  void helloQueue();
  // A cross-origin iframe may load after the top page's first queue handshake.
  setInterval(() => {
    if (assignment && !working && !target && !assignment.manualPause && BiomazeQueueCore.inWindow(assignment.schedule)) {
      window.postMessage({channel:CHANNEL,type:'prepare-queue'},location.origin);
      window.postMessage({channel:CHANNEL,type:'discover'},location.origin);
    }
  }, 1000);
  window.addEventListener('beforeunload', event => { if (working) { event.preventDefault(); event.returnValue = ''; } });
  window.postMessage({channel: CHANNEL, type: 'discover'}, location.origin);
})();
