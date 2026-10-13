(() => {
  'use strict';
  const CHANNEL = 'biomaze-personal-downloader-v1';
  const frame = crypto.randomUUID();
  const known = new WeakSet();
  const patched = new WeakSet();
  let player = null, active = null;
  const allowedOrigin = value => BiomazeSites.controllerOrigin(value, location.href);
  let queuePlayerPrepared = false;
  function send(type, body = {}, transfer = []) {
    // Video bytes travel only to this tab's top frame, never to a server.
    window.top.postMessage({channel: CHANNEL, frame, type, ...body}, '*', transfer);
  }
  function status() {
    if (!player || !player.levels?.length) return;
    const levels = player.levels.map((l, index) => ({index, height: l.height || 0, bitrate: l.bitrate || 0}));
    send('status', {levels, busy: !!active});
  }
  function register(hls) {
    if (known.has(hls)) return;
    known.add(hls); player = hls;
    const events = hls.constructor.Events;
    for (const name of ['MANIFEST_PARSED', 'LEVEL_LOADED']) hls.on(events[name], status);
    hls.on(events.DESTROYING, () => {
      if (active?.hls === hls) active.controller.abort();
      if (player === hls) { player = null; send('gone'); }
    });
  }
  function hook(Hls) {
    if (typeof Hls !== 'function' || !Hls.prototype?.loadSource || patched.has(Hls)) return Hls;
    patched.add(Hls);
    for (const name of ['loadSource', 'attachMedia']) {
      const original = Hls.prototype[name];
      Hls.prototype[name] = function (...args) { register(this); return original.apply(this, args); };
    }
    return Hls;
  }
  let HlsValue = hook(window.Hls);
  const descriptor = Object.getOwnPropertyDescriptor(window, 'Hls');
  if (!descriptor || descriptor.configurable) {
    Object.defineProperty(window, 'Hls', {configurable: true, enumerable: true, get: () => HlsValue, set: value => { HlsValue = hook(value); }});
  }
  function abortError() { return new DOMException('لغو شد', 'AbortError'); }
  function check(job) { if (job.controller.signal.aborted) throw abortError(); }
  function bounded(promise, job, ms = 35000) {
    return new Promise((resolve, reject) => {
      const signal = job.controller.signal;
      const abort = () => done(reject, abortError());
      const timer = setTimeout(() => done(reject, new Error('پاسخ سرور به‌موقع نرسید؛ دوباره تلاش کن.')), ms);
      function done(fn, value) { clearTimeout(timer); signal.removeEventListener('abort', abort); fn(value); }
      signal.addEventListener('abort', abort, {once: true});
      if (signal.aborted) return abort();
      promise.then(value => done(resolve, value), error => done(reject, error));
    });
  }
  async function detailsFor(hls, index, job) {
    const present = hls.levels[index]?.details;
    if (present && !present.live && present.fragments?.length) return present;
    const E = hls.constructor.Events;
    let listener, failed;
    const promise = new Promise((resolve, reject) => {
      listener = (_, data) => { if (data.level === index) resolve(data.details); };
      failed = (_, data) => { if (data.fatal) reject(new Error('پلیر نتوانست ویدیو را بارگیری کند.')); };
      hls.on(E.LEVEL_LOADED, listener); hls.on(E.ERROR, failed);
      hls.loadLevel = index; hls.startLoad(-1);
    });
    try { return await bounded(promise, job); }
    finally { hls.off(E.LEVEL_LOADED, listener); hls.off(E.ERROR, failed); }
  }
  function loadFragment(hls, frag, job) {
    return new Promise((resolve, reject) => {
      check(job);
      const Loader = hls.config.fLoader || hls.config.loader;
      const loader = new Loader(hls.config);
      const policy = hls.config.fragLoadPolicy?.default || {maxTimeToFirstByteMs: 15000, maxLoadTimeMs: 30000, timeoutRetry: null, errorRetry: null};
      const context = {frag, part: null, responseType: 'arraybuffer', url: frag.url, headers: {}, rangeStart: 0, rangeEnd: 0};
      if (Number.isFinite(frag.byteRangeStartOffset) && Number.isFinite(frag.byteRangeEndOffset)) {
        context.rangeStart = frag.byteRangeStartOffset; context.rangeEnd = frag.byteRangeEndOffset;
      }
      const signal = job.controller.signal;
      let finished = false;
      const finish = (fn, value) => {
        if (finished) return; finished = true;
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        try { loader.destroy(); } catch {}
        fn(value);
      };
      const abort = () => finish(reject, abortError());
      const timer = setTimeout(() => finish(reject, new Error('زمان دریافت قطعه تمام شد.')), 35000);
      signal.addEventListener('abort', abort, {once: true});
      try {
        loader.load(context, {loadPolicy: policy, timeout: 30000, maxRetry: 0, retryDelay: 0, maxRetryDelay: 0, highWaterMark: Infinity}, {
          onSuccess: response => finish(resolve, response.data),
          onError: response => finish(reject, new Error(`خطای دریافت قطعه (${Number(response?.code) || 'شبکه'}). صفحه را تازه‌سازی کن و دوباره تلاش کن.`)),
          onTimeout: () => finish(reject, new Error('زمان دریافت قطعه تمام شد.')),
          onAbort: abort
        });
      } catch (error) { finish(reject, error); }
    });
  }
  async function plainFragment(hls, frag, job) {
    let decrypt = frag.decryptdata;
    if (decrypt?.method && decrypt.method !== 'NONE') {
      if (decrypt.method !== 'AES-128') throw new Error('این نوع رمزگذاری در نسخهٔ فعلی پشتیبانی نمی‌شود.');
      if (!decrypt.key) {
        const keyLoader = hls.streamController?.keyLoader;
        if (!keyLoader?.load) throw new Error('دسترسی به کلید پخش ممکن نشد؛ پلیر سایت تغییر کرده است.');
        await bounded(keyLoader.load(frag), job);
        decrypt = frag.decryptdata;
      }
      if (!decrypt?.key || decrypt.iv?.length !== 16) throw new Error('اطلاعات کلید پخش کامل نیست.');
    }
    let data = await loadFragment(hls, frag, job);
    if (decrypt?.method === 'AES-128') {
      const key = await crypto.subtle.importKey('raw', decrypt.key, 'AES-CBC', false, ['decrypt']);
      data = await crypto.subtle.decrypt({name: 'AES-CBC', iv: decrypt.iv}, key, data);
    }
    const bytes = new Uint8Array(data);
    if (bytes.length < 188 * 2 || bytes[0] !== 0x47 || bytes[188] !== 0x47) throw new Error('فرمت ویدیو با این نسخه سازگار نیست؛ ذخیره متوقف شد.');
    return bytes;
  }
  async function download(message) {
    if (active) return;
    if (!player?.levels?.[message.level]) return send('failure', {job: message.job, message: 'پلیر آماده نیست. صفحه را تازه‌سازی و ویدیو را یک‌بار پخش کن.'});
    const hls = player;
    const job = {id: message.job, hls, controller: new AbortController(), ack: null, queue:!!message.queue, schedule:message.schedule, manualPause:!!message.manualPause};
    active = job;
    const previousLevel = hls.loadLevel;
    const media = hls.media;
    const wasPlaying = media && !media.paused;
    media?.pause();
    try {
      await waitForWindow(job);
      const details = await detailsFor(hls, message.level, job);
      hls.stopLoad();
      if (details.live) throw new Error('نسخهٔ فعلی برای ویدیوهای بازپخش است.');
      const fragments = [...details.fragments];
      if (!fragments.length || fragments.some(f => !f || f.gap || f.initSegment)) throw new Error('ساختار این ویدیو در نسخهٔ فعلی پشتیبانی نمی‌شود.');
      if (fragments.some(f => f.cc !== fragments[0].cc)) throw new Error('این ویدیو چند بخش زمانی جدا دارد و فعلاً پشتیبانی نمی‌شود.');
      if (hls.audioTracks?.some(t => t.url)) throw new Error('صدای جداگانه در این نسخه پشتیبانی نمی‌شود.');
      for (let index = 0; index < fragments.length; index++) {
        check(job);
        let bytes;
        for (let attempt = 0; attempt < 3; attempt++) {
          await waitForWindow(job);
          try { bytes = await plainFragment(hls, fragments[index], job); break; }
          catch (error) {
            check(job);
            if (attempt === 2 || error.name === 'OperationError' || /پشتیبانی|سازگار/.test(error.message)) throw error;
            await bounded(new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1))), job, 5000);
          }
        }
        check(job);
        const acknowledged = new Promise((resolve, reject) => { job.ack = {index, resolve, reject}; });
        send('chunk', {job: job.id, index, total: fragments.length, seconds: fragments[index].start + fragments[index].duration, duration: details.totalduration, data: bytes.buffer}, [bytes.buffer]);
        await bounded(acknowledged, job, 60000); job.ack = null;
      }
      send('complete', {job: job.id});
    } catch (error) {
      send('failure', {job: job.id, message: error.name === 'AbortError' ? 'دانلود لغو شد.' : error.message || 'دانلود کامل نشد.'});
    } finally {
      if (player === hls && !job.queue) {
        try { hls.loadLevel = previousLevel; hls.startLoad(-1); if (wasPlaying) media.play().catch(() => {}); } catch {}
      }
      active = null; status();
    }
  }
  function windowOpen(s) {
    if(!s?.enabled) return true;
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:s.timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
    const now=Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);
    const minutes=v=>Number(v.slice(0,2))*60+Number(v.slice(3));
    const start=minutes(s.start),end=minutes(s.end);
    return start<end ? now>=start && now<end : now>=start || now<end;
  }
  async function waitForWindow(job) {
    if(!job.queue) return;
    let notified=false;
    while(job.manualPause || !windowOpen(job.schedule)) {
      check(job);
      if(!notified) {send('paused',{job:job.id});notified=true;}
      await bounded(new Promise(resolve=>setTimeout(resolve,1000)),job,5000);
    }
    if(notified) send('resumed',{job:job.id});
    check(job);
  }
  window.addEventListener('message', event => {
    if ((event.source !== window.top && event.source !== window) || !allowedOrigin(event.origin)) return;
    const m = event.data;
    if (!m || m.channel !== CHANNEL || (m.frame && m.frame !== frame)) return;
    if (m.type === 'discover') { status(); for (let i = 0; i < window.frames.length; i++) window.frames[i].postMessage(m, '*'); }
    if (m.type === 'start' && typeof m.job === 'string' && Number.isInteger(m.level)) void download(m);
    if (m.type === 'cancel' && active?.id === m.job) active.controller.abort();
    if (m.type === 'queue-control' && active?.id === m.job && active.queue) {active.schedule=m.schedule;active.manualPause=!!m.manualPause;}
    if (m.type === 'prepare-queue') {
      for (const media of document.querySelectorAll('video')) {media.muted=true;}
      // Sales Center's Vis player creates Hls only after Play. Initialize only in a queue-owned tab.
      if (!queuePlayerPrepared && location.origin === 'https://stream.waterse.ir') {
        const media = Object.values(window.Vis?.libraryMedias?.getAll?.() || {})
          .find(value => typeof value?.api?.actions?.Play === 'function');
        if (media) {
          queuePlayerPrepared = true;
          try { media.api.actions.Play(); } catch { queuePlayerPrepared = false; }
        }
      }
      if(player) { player.media?.pause(); player.startLoad(-1); status(); }
      for(let i=0;i<window.frames.length;i++) window.frames[i].postMessage(m,'*');
    }
    if (m.type === 'ack' && active?.id === m.job && active.ack?.index === m.index) {
      if (m.error) active.ack.reject(new Error('نوشتن فایل ناموفق بود. فضای دیسک را بررسی کن.'));
      else active.ack.resolve();
    }
  });
})();
