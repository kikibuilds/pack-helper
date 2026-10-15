// 在 Depop 页面一开始加载时运行（MAIN world，document_start）：
// 记下页面自己收到的 JSON 数据（只存在这个页面的内存里，不保存、不上传），
// 让扩展能从中找到商品描述，给没有标题的 Depop 商品当商品名。
(() => {
  if (window.__phNet) return;
  const store = (window.__phNet = []);
  const keep = (url, data) => {
    try {
      if (!data || typeof data !== 'object') return;
      store.push({ url: String(url || '').slice(0, 200), data });
      if (store.length > 60) store.shift();
    } catch { /* ignore */ }
  };
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    p.then((res) => {
      try {
        const ct = res.headers.get('content-type') || '';
        if (/json/i.test(ct)) res.clone().json().then((d) => keep(res.url, d)).catch(() => {});
      } catch { /* ignore */ }
    }).catch(() => {});
    return p;
  };
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.addEventListener('load', () => {
      try {
        if (this.responseType === '' || this.responseType === 'text') {
          const t = this.responseText;
          if (t && (t[0] === '{' || t[0] === '[')) keep(url, JSON.parse(t));
        } else if (this.responseType === 'json') keep(url, this.response);
      } catch { /* ignore */ }
    });
    return origOpen.call(this, method, url, ...rest);
  };
})();
