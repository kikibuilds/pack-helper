// 打开「加了密、但没有打开密码」的 PDF（eBay 面单：Apache FOP 生成，RC4 加密、只限制复制 / 修改，打印没问题）。
// pdf-lib 不会解密：直接把这种页面复制进合并的面单 PDF，页面内容是乱码（或者读取时报「Failed to parse PDF document」）。
// 这里用空密码（标准安全处理程序，RC4 / AESV2）把每个对象的字符串和数据流解密，去掉 /Encrypt，之后照常复制页面。
// 只处理「打开不要密码」的 PDF；要密码才能打开的不在这里处理（解出来也不对，交给调用方报错）。

const PAD = [0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a];

/** MD5（RFC 1321），输入 / 输出都是 Uint8Array */
export function md5(input) {
  const K = new Int32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0;
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const len = input.length;
  const total = ((len + 8) >> 6) + 1 << 6;
  const m = new Uint8Array(total);
  m.set(input);
  m[len] = 0x80;
  const bits = len * 8;
  for (let i = 0; i < 8; i++) m[total - 8 + i] = Math.floor(bits / 2 ** (8 * i)) & 0xff;
  let a0 = 0x67452301 | 0; let b0 = 0xefcdab89 | 0; let c0 = 0x98badcfe | 0; let d0 = 0x10325476 | 0;
  const w = new Int32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = m[off + i * 4] | (m[off + i * 4 + 1] << 8) | (m[off + i * 4 + 2] << 16) | (m[off + i * 4 + 3] << 24);
    let A = a0; let B = b0; let C = c0; let D = d0;
    for (let i = 0; i < 64; i++) {
      let F; let g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      const s = S[(i >> 4) * 4 + (i % 4)];
      const t = (A + F + K[i] + w[g]) | 0;
      A = D; D = C; C = B;
      B = (B + ((t << s) | (t >>> (32 - s)))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((v, k) => { for (let i = 0; i < 4; i++) out[k * 4 + i] = (v >>> (8 * i)) & 0xff; });
  return out;
}

export function rc4(key, data) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 0xff; const t = s[i]; s[i] = s[j]; s[j] = t; }
  const out = new Uint8Array(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 0xff; j = (j + s[i]) & 0xff;
    const t = s[i]; s[i] = s[j]; s[j] = t;
    out[n] = data[n] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

const cat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0); const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };

async function aesDecrypt(key, data) {
  if (data.length < 32 || data.length % 16) return data.length === 16 ? new Uint8Array(0) : data;
  const k = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: data.slice(0, 16) }, k, data.slice(16)));
}

/**
 * 读取 PDF；如果是空密码加密的，先解密。返回 pdf-lib 的 PDFDocument。
 * PDFLib：批次页里的 window.PDFLib（测试时传 require 进来的）。
 */
export async function loadPdfDecrypted(PDFLib, bytes) {
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFRawStream, PDFNumber, PDFBool } = PDFLib;
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const ctx = doc.context;
  const encRef = ctx.trailerInfo.Encrypt;
  if (!encRef) return doc;
  const enc = ctx.lookup(encRef);
  if (!(enc instanceof PDFDict)) return doc;
  const num = (k, d) => { const v = enc.lookup(PDFName.of(k)); return v instanceof PDFNumber ? v.asNumber() : d; };
  const name = (o, k) => { const v = o && o.lookup(PDFName.of(k)); return v instanceof PDFName ? v.decodeText() : ''; };
  if (name(enc, 'Filter') !== 'Standard') throw new Error('PDF 用了不认识的加密方式，没法合并');
  const V = num('V', 0); const R = num('R', 2);
  let lengthBits = num('Length', 40);
  let aes = false;
  if (V === 4) {
    const cf = enc.lookup(PDFName.of('CF'));
    const std = cf instanceof PDFDict ? cf.lookup(PDFName.of(name(enc, 'StmF') || 'StdCF')) : null;
    const cfm = name(std, 'CFM');
    if (cfm === 'AESV2') aes = true;
    else if (cfm && cfm !== 'V2') throw new Error(`PDF 的加密方式 ${cfm} 不支持，没法合并`);
    const l = std && std.lookup(PDFName.of('Length'));
    if (l instanceof PDFNumber) lengthBits = l.asNumber() <= 32 ? l.asNumber() * 8 : l.asNumber();
  } else if (V !== 1 && V !== 2) {
    throw new Error(`PDF 的加密版本 V${V} 不支持（只支持 RC4 / AES-128），没法合并`);
  }
  const n = V === 1 ? 5 : Math.min(16, Math.max(5, lengthBits >> 3));
  const strBytes = (s) => (s instanceof PDFString || s instanceof PDFHexString ? s.asBytes() : new Uint8Array(0));
  const O = strBytes(enc.lookup(PDFName.of('O'))).slice(0, 32);
  const U = strBytes(enc.lookup(PDFName.of('U')));
  const P = num('P', 0);
  const ids = ctx.trailerInfo.ID ? ctx.lookup(ctx.trailerInfo.ID) : null;
  const id0 = ids instanceof PDFArray && ids.size() ? strBytes(ids.lookup(0)) : new Uint8Array(0);
  const em = enc.lookup(PDFName.of('EncryptMetadata'));
  const encryptMeta = !(em instanceof PDFBool) || em.asBoolean();
  // 算法 2：空密码 → 文件密钥
  let key = md5(cat(Uint8Array.from(PAD), O, Uint8Array.of(P & 0xff, (P >> 8) & 0xff, (P >> 16) & 0xff, (P >>> 24) & 0xff), id0,
    R >= 4 && !encryptMeta ? Uint8Array.of(255, 255, 255, 255) : new Uint8Array(0)));
  if (R >= 3) for (let i = 0; i < 50; i++) key = md5(key.slice(0, n));
  key = key.slice(0, n);
  // 核对空密码对不对（算法 4 / 5）；不对说明这份 PDF 要密码才能打开
  const check = R === 2 ? rc4(key, Uint8Array.from(PAD))
    : (() => { let x = rc4(key, md5(cat(Uint8Array.from(PAD), id0))); for (let i = 1; i <= 19; i++) x = rc4(key.map((b) => b ^ i), x); return x; })();
  const want = R === 2 ? U.slice(0, 32) : U.slice(0, 16);
  if (want.length && !check.slice(0, want.length).every((b, i) => b === want[i])) throw new Error('这份 PDF 要密码才能打开，没法合并');

  const objKey = (ref) => {
    const extra = aes ? Uint8Array.of(0x73, 0x41, 0x6c, 0x54) : new Uint8Array(0);
    const k = md5(cat(key, Uint8Array.of(ref.objectNumber & 0xff, (ref.objectNumber >> 8) & 0xff, (ref.objectNumber >> 16) & 0xff,
      ref.generationNumber & 0xff, (ref.generationNumber >> 8) & 0xff), extra));
    return k.slice(0, Math.min(n + 5, 16));
  };
  const dec = async (k, data) => (aes ? aesDecrypt(k, data) : rc4(k, data));
  const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
  const fix = async (k, v) => {
    if (v instanceof PDFString || v instanceof PDFHexString) return PDFHexString.of(hex(await dec(k, v.asBytes())));
    if (v instanceof PDFArray) { for (let i = 0; i < v.size(); i++) { const r = await fix(k, v.get(i)); if (r) v.set(i, r); } return null; }
    if (v instanceof PDFDict) { for (const [kk, vv] of v.entries()) { const r = await fix(k, vv); if (r) v.set(kk, r); } return null; }
    return null;
  };
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (ref === encRef || (encRef.objectNumber === ref.objectNumber && encRef.generationNumber === ref.generationNumber)) continue;
    const k = objKey(ref);
    if (obj instanceof PDFRawStream) {
      const type = name(obj.dict, 'Type');
      if (type === 'XRef') continue;
      await fix(k, obj.dict);
      if (type === 'Metadata' && !encryptMeta) continue;
      const plain = await dec(k, obj.contents);
      ctx.assign(ref, PDFRawStream.of(obj.dict, plain));
      obj.dict.set(PDFName.of('Length'), PDFNumber.of(plain.length));
    } else {
      await fix(k, obj);
      if (obj instanceof PDFString || obj instanceof PDFHexString) ctx.assign(ref, PDFHexString.of(hex(await dec(k, obj.asBytes()))));
    }
  }
  delete ctx.trailerInfo.Encrypt;
  ctx.delete(encRef);
  return doc;
}
