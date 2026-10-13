/* mux.js 6.3.0 is bundled locally under its Apache-2.0 license. */
globalThis.BiomazeMp4Writer = class {
  constructor(writable) {
    this.writable = writable; this.bytes = 0; this.count = 0; this.initialized = false; this.chunks = [];
    this.mux = new muxjs.mp4.Transmuxer({remux: true, keepOriginalTimestamps: false});
    this.mux.on('data', segment => {
      if (segment.type !== 'combined') throw new Error('فایل باید هم صدا و هم تصویر داشته باشد.');
      if (!this.initialized) {
        this.timing = new BiomazeMp4Timing(segment.initSegment);
        this.chunks.push(this.timing.init); this.initialized = true;
      }
      this.timing.push(segment.data);
      this.chunks.push(segment.data); this.count++;
    });
  }
  async push(bytes) {
    const before = this.count;
    this.mux.push(bytes); this.mux.flush();
    if (this.count === before) throw new Error('از قطعهٔ دریافت‌شده تصویر و صدا استخراج نشد.');
    for (const chunk of this.chunks) { await this.writable.write(chunk); this.bytes += chunk.byteLength; }
    this.chunks = [];
  }
  async close() {
    if (!this.count) throw new Error('فایل خالی است.');
    // MSE accepts mux.js's unknown-duration placeholders; saved files need real
    // mvhd/tkhd/mdhd durations for Windows and other standalone players.
    await this.writable.write({type:'write',position:0,data:this.timing.finish()});
    await this.writable.close(); this.mux.dispose();
  }
  async abort() { this.mux.dispose(); try { await this.writable.abort(); } catch {} }
};
