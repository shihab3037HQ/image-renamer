'use strict';
/* A small ZIP writer for the browser ("stored", no compression: photos are already compressed).
   The ZIP is built as a Blob made of the original files plus small headers, so even large photo
   sets are not copied into memory. Each file is read once to work out its CRC-32 checksum.
   Names are saved as UTF-8. Keep each ZIP under 4 GB (the tool splits at 1 GB). */
(function () {
  const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crcCache = new WeakMap();

  async function crc32(blob) {
    if (crcCache.has(blob)) return crcCache.get(blob);
    let c = 0xffffffff;
    const CHUNK = 8 * 1024 * 1024;
    for (let pos = 0; pos < blob.size; pos += CHUNK) {
      const buf = new Uint8Array(await blob.slice(pos, pos + CHUNK).arrayBuffer());
      for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    const v = (c ^ 0xffffffff) >>> 0;
    crcCache.set(blob, v);
    return v;
  }

  function dosTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2)),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  // entries: [{ name: 'B0X.MAIN.jpg', blob: File|Blob }]; onProgress(doneCount)
  async function makeZip(entries, onProgress) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const { time, date } = dosTime(new Date());
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const name = enc.encode(e.name);
      const size = e.blob.size;
      const crc = await crc32(e.blob);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true); local.setUint16(10, time, true); local.setUint16(12, date, true);
      local.setUint32(14, crc, true); local.setUint32(18, size, true); local.setUint32(22, size, true);
      local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
      parts.push(local.buffer, name, e.blob);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, 0, true); cen.setUint16(12, time, true); cen.setUint16(14, date, true);
      cen.setUint32(16, crc, true); cen.setUint32(20, size, true); cen.setUint32(24, size, true);
      cen.setUint16(28, name.length, true); cen.setUint16(30, 0, true); cen.setUint16(32, 0, true);
      cen.setUint16(34, 0, true); cen.setUint16(36, 0, true); cen.setUint32(38, 0, true); cen.setUint32(42, offset, true);
      central.push(cen.buffer, name);
      offset += 30 + name.length + size;
      if (onProgress) onProgress(i + 1);
    }
    const cenSize = central.reduce((s, p) => s + (p.byteLength !== undefined ? p.byteLength : p.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end.buffer]), { type: 'application/zip' });
  }

  window.HXZip = { makeZip, crc32 };
})();
