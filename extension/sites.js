'use strict';
globalThis.BiomazeSites = Object.freeze((() => {
  function site(value) {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
      if (u.hostname === 'biomaze.ir' || u.hostname.endsWith('.biomaze.ir')) return 'biomaze';
      if (u.hostname === 'salescenter24.com') return 'salescenter';
    } catch {}
    return null;
  }
  function playerOrigin(value, parentURL) {
    try {
      const u = new URL(value), parent = site(parentURL);
      if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
      if (parent === 'biomaze') return site(value) === 'biomaze';
      return parent === 'salescenter' && (site(value) === 'salescenter' || u.hostname === 'stream.waterse.ir');
    } catch { return false; }
  }
  function controllerOrigin(value, playerURL) {
    try {
      const u = new URL(playerURL);
      if (u.origin === 'https://stream.waterse.ir') return site(value) === 'salescenter';
      return !!site(value) && site(value) === site(playerURL);
    } catch { return false; }
  }
  function videoURL(value) {
    const u = new URL(String(value));
    const valid = (u.hostname === 'biomaze.ir' && /^\/panel\/classes\/[^/]+\/folders\/[^/]+\/sections\/[^/]+\/video\/[^/]+\/?$/.test(u.pathname)) ||
      (u.hostname === 'salescenter24.com' && /^\/panel\/courses\/topic\/\d+\/?$/.test(u.pathname));
    if (!site(u.href) || !valid) throw new Error('لینک صفحهٔ ویدیو در ماز یا Sales Center 24 را وارد کن.');
    u.hash = ''; u.search = ''; u.pathname = u.pathname.replace(/\/$/, '');
    return u.href;
  }
  return {site, playerOrigin, controllerOrigin, videoURL};
})());
