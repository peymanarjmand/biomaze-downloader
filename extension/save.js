globalThis.BiomazeSave = class {
  static async request(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || 'ارتباط با افزونه قطع شد؛ صفحه را تازه‌سازی کن.');
    return response;
  }
  static async create() {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle('biomaze-downloader-temp', {create: true});
    // Clean only this feature's abandoned temporary files, at least a day old.
    // Recent files may belong to a download running in another tab.
    for await (const [oldName, oldHandle] of directory.entries()) {
      const match = /^video-(\d+)-[0-9a-f-]+\.mp4$/.exec(oldName);
      if (match && oldHandle.kind === 'file' && Date.now()-Number(match[1]) > 86400000) {
        const file = await oldHandle.getFile();
        if (Date.now()-file.lastModified > 86400000) await directory.removeEntry(oldName).catch(() => {});
      }
    }
    const name = `video-${Date.now()}-${crypto.randomUUID()}.mp4`;
    const handle = await directory.getFileHandle(name, {create: true});
    const save = new BiomazeSave();
    Object.assign(save, {directory, handle, name, cancelled: false, url: null, id: null});
    try { save.writable = await handle.createWritable(); return save; }
    catch (error) { await directory.removeEntry(name).catch(() => {}); throw error; }
  }
  async finish(filename, saveAs) {
    if (this.cancelled) throw new DOMException('دانلود لغو شد.', 'AbortError');
    // File-backed Blob keeps long lessons on disk instead of assembling a RAM-sized array.
    this.url = URL.createObjectURL(await this.handle.getFile());
    let started;
    try { started = await BiomazeSave.request({type: 'save-video', url: this.url, filename, saveAs}); }
    catch (error) {
      if (/canceled|cancelled|USER_CANCELED/i.test(error.message)) throw new DOMException('ذخیره لغو شد.', 'AbortError');
      throw error;
    }
    this.id = started.id;
    for (;;) {
      if (this.cancelled) {
        await BiomazeSave.request({type: 'cancel-save', id: this.id});
        throw new DOMException('دانلود لغو شد.', 'AbortError');
      }
      const state = await BiomazeSave.request({type: 'download-state', id: this.id});
      if (state.state === 'complete') return state;
      if (state.state === 'interrupted') throw new Error(`ذخیره کامل نشد (${state.error || 'خطای کروم'}).`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  async dispose() {
    if (this.url) URL.revokeObjectURL(this.url);
    await this.writable?.abort().catch(() => {});
    await this.directory.removeEntry(this.name).catch(() => {});
  }
};
