'use strict';
const $=id=>document.getElementById(id);
const statusNames={waiting:'در انتظار',loading:'آماده‌سازی پلیر',running:'در حال دریافت',paused:'مکث',saving:'در حال ذخیره',done:'ذخیره شد',failed:'ناموفق',login:'نیاز به ورود',cancelled:'لغو شد'};
let settingsDirty=false, latest=null;
async function request(type,extra={}) {
  const r=await chrome.runtime.sendMessage({type,...extra});
  if(!r?.ok) throw new Error(r?.error || 'ارتباط با افزونه برقرار نشد.'); return r;
}
async function action(type,extra={}) {try {const r=await request(type,extra);if(r.state)render(r.state);return r;} catch(e){$('feedback').textContent=e.message;}}
function addZone(zone) {if(![...$('zone').options].some(o=>o.value===zone)) $('zone').add(new Option(zone==='Asia/Tehran'?'ایران · Asia/Tehran':zone,zone));}
addZone(Intl.DateTimeFormat().resolvedOptions().timeZone);addZone('Asia/Tehran');addZone('UTC');
function render(s) {
  latest=s;
  const count=s.items.filter(i=>i.status==='done').length;
  $('summary').textContent=`${count} از ${s.items.length} ذخیره شده`;
  $('notice').textContent=s.notice || (s.running ? s.schedule.enabled?'صف فعال است؛ بازهٔ شبانه رعایت می‌شود.':'صف در حال اجرا است.':'صف در حالت مکث است.');
  $('pause').disabled=!s.running; $('worker').disabled=!s.active;
  if(!settingsDirty){addZone(s.schedule.timeZone);$('night').checked=s.schedule.enabled;$('start-time').value=s.schedule.start;$('end-time').value=s.schedule.end;$('zone').value=s.schedule.timeZone;$('awake').checked=s.schedule.keepAwake;}
  $('schedule-description').textContent=s.schedule.enabled?`تنظیم ذخیره‌شده: هر روز از ${s.schedule.start} تا ${s.schedule.end} به وقت ${s.schedule.timeZone}`:'تنظیم ذخیره‌شده: شروع دستی، بدون محدودیت ساعت';
  $('empty').hidden=!!s.items.length;
  // Preserve keyboard focus when progress updates replace the list.
  const focusKey=document.activeElement?.dataset.key;
  const list=document.createDocumentFragment();
  for(const [index,item] of s.items.entries()) {
    const row=document.createElement('article');row.className='item';row.dataset.id=item.id;
    const content=document.createElement('div'),title=document.createElement('h3'),link=document.createElement('a');
    link.href=item.url;link.target='_blank';link.rel='noopener';link.textContent=`${index+1}. ${item.title || 'ویدیوی ماز · '+item.url.split('/').at(-1).slice(0,8)}`;title.append(link);content.append(title);
    const meta=document.createElement('div');meta.className='meta';meta.textContent=`${statusNames[item.status]||item.status} · ${Math.round(item.progress||0)}٪ · ${item.actualQuality || (item.quality?item.quality+'p':'بالاترین کیفیت')}${item.bytes?' · '+(item.bytes/1e6).toFixed(1)+' مگابایت':''}`;content.append(meta);
    if(['running','paused','saving'].includes(item.status)){const p=document.createElement('progress');p.max=100;p.value=item.progress||0;p.setAttribute('aria-label','پیشرفت دانلود');content.append(p);}
    if(item.error){const p=document.createElement('p');p.className='meta error';p.textContent=item.error;content.append(p);}
    if(item.filename && item.status==='done'){const p=document.createElement('p');p.className='path';p.textContent=item.filename;content.append(p);}
    const controls=document.createElement('div');controls.className='actions';
    function button(text,type,extra={}) {const b=document.createElement('button');b.textContent=text;b.dataset.key=item.id+type+(extra.direction||'');b.onclick=()=>action(type,{id:item.id,...extra});controls.append(b);return b;}
    if(item.status==='done') button('نمایش در پوشه','queue-show');
    if(['failed','cancelled','login'].includes(item.status)) button('تلاش مجدد','queue-retry');
    if(item.status==='waiting'){button('↑','queue-move',{direction:-1}).setAttribute('aria-label','انتقال به بالا');button('↓','queue-move',{direction:1}).setAttribute('aria-label','انتقال به پایین');}
    button(s.active?.itemId===item.id?'لغو این دانلود':'حذف از فهرست','queue-remove').disabled=item.status==='saving';
    row.append(content,controls);list.append(row);
  }
  $('items').replaceChildren(list);
  if(focusKey)[...$('items').querySelectorAll('button')].find(b=>b.dataset.key===focusKey)?.focus({preventScroll:true});
}
$('add').onclick=async()=>{
  const urls=$('links').value.trim().split(/\s+/).filter(Boolean);
  const r=await action('queue-add',{items:urls.map(url=>({url,quality:Number($('quality').value)}))});
  if(r){$('links').value='';$('feedback').textContent=`${r.added} ویدیو به صف اضافه شد.`;await refresh();}
};
for(const id of ['night','start-time','end-time','zone','awake']) $(id).addEventListener('change',()=>{settingsDirty=true;$('feedback').textContent='برای اعمال تغییرات، ذخیرهٔ تنظیمات را بزن.';});
$('settings').onclick=async()=>{const r=await action('queue-settings',{schedule:{enabled:$('night').checked,start:$('start-time').value,end:$('end-time').value,timeZone:$('zone').value,keepAwake:$('awake').checked}});if(r){settingsDirty=false;render(r.state);$('feedback').textContent='تنظیمات ذخیره شد؛ برای فعال‌کردن صف «شروع / ادامه» را بزن.';}};
$('run').onclick=()=>{if(settingsDirty){$('feedback').textContent='اول تنظیمات تغییرکرده را ذخیره کن.';return;}void action('queue-start');};
$('pause').onclick=()=>action('queue-pause');$('worker').onclick=()=>action('queue-worker');$('clear').onclick=()=>action('queue-clear-done');
async function refresh(){const r=await action('queue-get');if(r)render(r.state);}
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local' && changes.biomazeQueueV1?.newValue)render(changes.biomazeQueueV1.newValue);});
void refresh();
