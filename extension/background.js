'use strict';
importScripts('sites.js');
function allowed(url) {
  return !!BiomazeSites.site(url);
}
async function ownedDownload(id, tabId) {
  if (!Number.isInteger(id)) throw new Error('شناسهٔ فایل معتبر نیست.');
  const key = `download-${id}`;
  const record = (await chrome.storage.session.get(key))[key];
  if (record?.tabId !== tabId) throw new Error('این فایل متعلق به دانلودهای این صفحه نیست.');
  const [item] = await chrome.downloads.search({id});
  if (!item || item.byExtensionId !== chrome.runtime.id) throw new Error('فایل در فهرست دانلودهای کروم پیدا نشد.');
  return item;
}
async function handle(message, sender) {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab || !allowed(sender.url)) throw new Error('صفحه معتبر نیست.');
  if (message.type === 'save-video') {
    const url = new URL(message.url);
    if (url.protocol !== 'blob:' || url.origin !== new URL(sender.url).origin) throw new Error('نشانی فایل معتبر نیست.');
    const filename = String(message.filename || 'Biomaze.mp4');
    if (filename.length > 180 || !/\.mp4$/i.test(filename) || /[<>:"/\\|?*\x00-\x1f]/.test(filename) || filename.startsWith('.')) throw new Error('نام فایل معتبر نیست.');
    const id = await chrome.downloads.download({url: message.url, filename, saveAs: message.saveAs !== false, conflictAction: 'uniquify'});
    await chrome.storage.session.set({[`download-${id}`]: {tabId: sender.tab.id}});
    await queueSaveStarted(sender.tab.id,id);
    return {id};
  }
  if (message.type === 'download-state' || message.type === 'show-file' || message.type === 'cancel-save') {
    const item = await ownedDownload(message.id, sender.tab.id);
    if (message.type === 'show-file') {
      if (item.state !== 'complete' || item.exists === false) throw new Error('فایل هنوز ذخیره نشده یا جابه‌جا شده است.');
      await chrome.downloads.show(item.id);
    }
    if (message.type === 'cancel-save' && item.state === 'in_progress') await chrome.downloads.cancel(item.id);
    return {id: item.id, state: item.state, filename: item.filename, error: item.error};
  }
  throw new Error('درخواست شناخته نشد.');
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!['save-video', 'download-state', 'show-file', 'cancel-save'].includes(message?.type)) return;
  handle(message, sender).then(value => reply({ok: true, ...value}), error => reply({ok: false, error: error.message}));
  return true;
});
importScripts('queue-core.js', 'queue-background.js');
