document.getElementById('open').onclick = async () => {
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    await chrome.tabs.sendMessage(tab.id, {type: 'open-panel'}, {frameId: 0});
    window.close();
  } catch {
    document.getElementById('status').textContent = 'صفحهٔ ویدیو در ماز یا Sales Center 24 را باز و یک‌بار تازه‌سازی کن؛ سپس دوباره این دکمه را بزن.';
  }
};
document.getElementById('queue').onclick=async()=>{await chrome.tabs.create({url:chrome.runtime.getURL('queue.html')});window.close();};
document.getElementById('add').onclick=async()=>{
  try {const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const r=await chrome.tabs.sendMessage(tab.id,{type:'add-current-queue'},{frameId:0});if(r?.ok===false)throw new Error(r.error);document.getElementById('status').textContent=r.added?'ویدیو به صف اضافه شد.':'این ویدیو قبلاً در صف است.';}
  catch(e){document.getElementById('status').textContent=e.message || 'صفحهٔ ویدیو را باز و پس از نصب تازه‌سازی کن.';}
};
