'use strict';
/* HexaEcom Amazon Bulk Image Renamer (images.hexaecom.com).
   One photo set per colour (or one folder per product) becomes a full set of Amazon file names for every
   ASIN: <ASIN>.<CODE>.<ext>, ready for Seller Central's bulk image upload. Everything runs in the browser:
   photos are never uploaded, and the original files are never changed. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const n = x => Number(x).toLocaleString('en-US');
  const many = (x, one, more) => n(x) + ' ' + (x === 1 ? one : more);
  const root = $('#tool');
  if (!root) return;

  const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif|bmp|tiff?|heic|heif)$/i;
  const CONVERT_EXT = /\.(webp|avif|bmp)$/i;            // Amazon wants JPEG, PNG, TIFF or GIF
  const NO_DECODE = /\.(heic|heif)$/i;                  // most browsers can't read these
  const STANDARD = ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07', 'PT08', 'SWCH'];
  const JUNK = /^(\.|__macosx$)|^(thumbs\.db|desktop\.ini)$/i;
  const ZIP_MAX_BYTES = 950 * 1000 * 1000, ZIP_MAX_FILES = 1000;
  const SIZE_ORDER = ['XXXS', '3XS', 'XXS', '2XS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL', '4XL', '5XL'];

  const S = {
    mode: 'list',              // 'list': colour, size, ASIN rows · 'folders': folders named with ASINs
    rows: [], listNote: '',
    files: [], junk: 0, other: 0,
    opts: { swch: true, jpeg: false, quality: 92, resize: false, maxpx: 3000, layout: 'flat' },
    plan: null, busy: false,
  };

  // ------------------------------------------------------------------ the product list
  function splitLine(line, sep) {
    if (sep === '\t') return line.split('\t');
    const out = []; let cell = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
      else if (c === '"') q = true; else if (c === sep) { out.push(cell); cell = ''; } else cell += c;
    }
    out.push(cell);
    return out;
  }
  function parseList(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim());
    if (!lines.length) return { rows: [], note: '' };
    const first = lines[0];
    const sep = first.includes('\t') ? '\t' : first.includes(',') ? ',' : first.includes(';') ? ';' : '\t';
    let head = splitLine(first, sep).map(h => h.trim().toLowerCase());
    const hasHead = head.some(h => /asin|product id|upc|ean|isbn|colou?r|size/.test(h));
    const find = re => head.findIndex(h => re.test(h));
    let ci, si, ai, fi;
    if (hasHead) {
      ai = find(/^(asin|child asin|product id|product_id|upc|ean|isbn|jan|gtin)$/); if (ai < 0) ai = find(/asin|product id|upc|ean/);
      ci = find(/^(colou?r|color name|colour name|variation|style name)$/); if (ci < 0) ci = find(/colou?r/);
      si = find(/^(size|size name)$/); if (si < 0) si = find(/size/);
      fi = find(/^(folder|main folder|style|parent|product|photo folder|image folder)$/);
    } else {
      head = []; const cols = splitLine(first, sep).length;
      if (cols >= 3) { ci = 0; si = 1; ai = 2; } else if (cols === 2) { ci = 0; si = -1; ai = 1; } else { ci = -1; si = -1; ai = 0; }
      fi = -1;
    }
    const rows = [];
    (hasHead ? lines.slice(1) : lines).forEach((line, i) => {
      const c = splitLine(line, sep).map(x => x.trim());
      const id = (ai >= 0 ? c[ai] : '') || '';
      if (!id && !(ci >= 0 && c[ci])) return;
      rows.push({
        line: i + (hasHead ? 2 : 1),
        colour: ci >= 0 ? c[ci] || '' : '', size: si >= 0 ? c[si] || '' : '',
        folder: fi >= 0 ? c[fi] || '' : '', id: id.replace(/[\s-]/g, '').toUpperCase(),
      });
    });
    const note = rows.length ? `${many(rows.length, 'product', 'products')} in your list` + (fi >= 0 ? ' (with a folder column)' : '') : '';
    return { rows, note };
  }
  function idProblem(id) {
    if (!id) return 'The ASIN is empty';
    if (/^B[0-9A-Z]{9}$/.test(id)) return '';
    if (/^\d{10}$|^\d{12,14}$|^97[89]\d{10}$/.test(id)) return '';   // ISBN-10, UPC, EAN, GTIN, ISBN-13
    return `“${id}” doesn't look like an ASIN (B + 9 letters or numbers), UPC, EAN or ISBN`;
  }

  // ------------------------------------------------------------------ the photo folder
  function addFiles(list) {
    S.files = []; S.junk = 0; S.other = 0;
    list.forEach(({ file, path }) => {
      const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);
      if (parts.some(p => JUNK.test(p))) { S.junk++; return; }
      const name = parts[parts.length - 1];
      if (!IMAGE_EXT.test(name)) { S.other++; return; }
      S.files.push({ file, name, dir: parts.slice(0, -1).join('/'), parts: parts.slice(0, -1) });
    });
    S.plan = null;
    renderFolder();
    refresh();
  }
  function readEntry(entry, out) {
    return new Promise(res => {
      if (entry.isFile) entry.file(f => { out.push({ file: f, path: entry.fullPath }); res(); }, () => res());
      else if (entry.isDirectory) {
        const reader = entry.createReader(), all = [];
        const next = () => reader.readEntries(async batch => {
          if (!batch.length) { for (const e of all) await readEntry(e, out); res(); }
          else { all.push(...batch); next(); }
        }, () => res());
        next();
      } else res();
    });
  }
  function dirs() {
    const m = new Map();
    S.files.forEach(f => { if (!m.has(f.dir)) m.set(f.dir, []); m.get(f.dir).push(f); });
    return m;
  }
  function findFolder(key, map) {
    const want = key.split(/[\/\\]/).map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!want.length) return { error: 'No colour or folder name' };
    const hits = [];
    map.forEach((files, dir) => {
      let segs = dir.split('/').map(s => s.toLowerCase());
      if (segs[segs.length - 1] === 'images') segs = segs.slice(0, -1);
      if (segs.length < want.length) return;
      const tail = segs.slice(segs.length - want.length);
      if (tail.every((s, i) => s === want[i])) hits.push(dir);
    });
    if (!hits.length) return { error: `No photo folder named “${key}”` };
    if (hits.length > 1) return { error: `${hits.length} folders are named “${key}”. Add a Folder column to your list, for example “Style 1/${key}”`, hits };
    return { dir: hits[0] };
  }

  // ------------------------------------------------------------------ names and codes
  function codeOf(name) {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
    const parts = base.split('.');
    let code = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    code = code.trim().toUpperCase().replace(/\s+/g, '');
    let m;
    if (/^MAIN$/.test(code)) code = 'MAIN';
    else if ((m = code.match(/^PT0?(\d{1,2})$/))) code = 'PT' + String(+m[1]).padStart(2, '0');
    else if (/^(SWCH|SWATCH)$/.test(code)) code = 'SWCH';
    else if (parts.length === 1) code = '';               // "IMG_1234.jpg": no code in the name
    return { code, ext: ext === '.jpeg' ? '.jpg' : ext };
  }
  function outExt(f) {
    if (S.opts.jpeg || CONVERT_EXT.test(f.name)) return '.jpg';
    return codeOf(f.name).ext;
  }

  // ------------------------------------------------------------------ the check
  function buildPlan() {
    const map = dirs(), errors = [], warns = [], infos = [], items = [];
    const products = [];
    if (S.mode === 'list') {
      const seen = new Map();
      S.rows.forEach(r => {
        const p = { colour: r.colour, size: r.size, id: r.id, folderKey: r.folder ? r.folder + (r.colour ? '/' + r.colour : '') : r.colour, line: r.line, problems: [] };
        const bad = idProblem(r.id);
        if (bad) p.problems.push(bad);
        if (seen.has(r.id) && r.id) p.problems.push(`Same ASIN as line ${seen.get(r.id)}`); else seen.set(r.id, r.line);
        products.push(p);
      });
    } else {
      map.forEach((files, dir) => {
        const segs = dir.split('/'); let last = segs[segs.length - 1] || '';
        if (last.toLowerCase() === 'images' && segs.length > 1) last = segs[segs.length - 2];
        const id = last.replace(/[\s-]/g, '').toUpperCase();
        if (idProblem(id)) return;
        products.push({ colour: '', size: '', id, dir, problems: [], line: 0 });
      });
      if (!products.length && S.files.length) errors.push('No folder is named with an ASIN. Name each product folder with its ASIN, or use “My list”.');
    }
    const codeWarn = new Set(), noCode = new Set(), dupCode = [];
    products.forEach(p => {
      if (!p.dir && !p.problems.length) {
        const f = findFolder(p.folderKey, map);
        if (f.error) p.problems.push(f.error); else p.dir = f.dir;
      }
      if (p.problems.length) { errors.push(...p.problems.map(x => (p.line ? `Line ${p.line}: ` : '') + x)); p.files = []; return; }
      const src = (map.get(p.dir) || []).slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      if (!src.length) { errors.push(`Line ${p.line}: the folder “${p.dir}” has no photos`); p.files = []; return; }
      const used = new Map();
      p.files = [];
      src.forEach(f => {
        const { code } = codeOf(f.name);
        if (NO_DECODE.test(f.name)) return;             // HEIC: Amazon doesn't accept it (warned below)
        const out = `${p.id}${code ? '.' + code : ''}${outExt(f)}`;
        if (used.has(out)) { dupCode.push(`${p.dir}: ${used.get(out)} and ${f.name} both become ${out}`); return; }
        used.set(out, f.name);
        if (code && !STANDARD.includes(code)) codeWarn.add(code);
        if (!code) noCode.add(p.dir + '/' + f.name);
        p.files.push({ src: f, out, code, copyOf: '' });
      });
      if (S.opts.swch && !p.files.some(x => x.code === 'SWCH')) {
        const main = p.files.find(x => x.code === 'MAIN');
        if (main) p.files.push({ src: main.src, out: `${p.id}.SWCH${outExt(main.src)}`, code: 'SWCH', copyOf: 'MAIN' });
      }
      p.files.forEach(x => items.push({ p, x }));
    });
    [...new Set(dupCode)].forEach(x => errors.push('Two photos get the same name: ' + x));
    if (codeWarn.size) warns.push(`${[...codeWarn].join(', ')} ${codeWarn.size === 1 ? 'is not one of' : 'are not'} Amazon's standard codes (MAIN, PT01 to PT08, SWCH). Check that Amazon accepts ${codeWarn.size === 1 ? 'it' : 'them'} for your category.`);
    if (noCode.size) warns.push(`${many(noCode.size, 'photo has', 'photos have')} no image code in the name (for example ${[...noCode][0]}). Amazon reads a name without a code as the MAIN image.`);
    const conv = new Set(items.filter(i => CONVERT_EXT.test(i.x.src.name)).map(i => i.x.src));
    if (conv.size) infos.push(`${many(conv.size, 'WebP, AVIF or BMP photo', 'WebP, AVIF or BMP photos')} will be converted to JPEG. Amazon accepts JPEG, PNG, TIFF and GIF.`);
    const heic = S.files.filter(f => NO_DECODE.test(f.name)).length;
    if (heic) warns.push(`${many(heic, 'HEIC photo', 'HEIC photos')} found. Amazon doesn't accept HEIC: export ${heic === 1 ? 'it' : 'them'} as JPEG first.`);
    if (S.junk) infos.push(`${many(S.junk, 'Mac or Windows system file was', 'Mac or Windows system files were')} skipped (Amazon rejects them).`);
    const ok = products.filter(p => p.files && p.files.length);
    return { products, ok, items, errors, warns, infos, sizes: [] };
  }

  // Image size check: each source photo once (sizes share the same photos).
  async function sizeCheck(plan, progress) {
    const uniq = [...new Set(plan.items.map(i => i.x.src))];
    const small = [], big = [], heavy = [], unreadable = [], apple = [];
    for (let i = 0; i < uniq.length; i++) {
      const f = uniq[i];
      try {
        const head = new Uint8Array(await f.file.slice(0, 4).arrayBuffer());
        if (head[0] === 0x00 && head[1] === 0x05 && head[2] === 0x16 && head[3] === 0x07) { apple.push(f); continue; }
      } catch (e) { /* unreadable: caught below */ }
      if (f.file.size > 10 * 1024 * 1024) heavy.push(f);
      if (!NO_DECODE.test(f.name) && !/\.tiff?$/i.test(f.name)) {
        try {
          const bmp = await createImageBitmap(f.file);
          const long = Math.max(bmp.width, bmp.height);
          if (long < 1000) small.push(f.dir + '/' + f.name + ` (${bmp.width}×${bmp.height})`);
          if (long > 10000 && !S.opts.resize) big.push(f.dir + '/' + f.name);
          bmp.close && bmp.close();
        } catch (e) { unreadable.push(f.dir + '/' + f.name); }
      }
      if (progress && (i % 5 === 0 || i === uniq.length - 1)) progress(i + 1, uniq.length);
    }
    if (apple.length) {
      const bad = new Set(apple);
      plan.items = plan.items.filter(i => !bad.has(i.x.src));
      plan.products.forEach(p => { if (p.files) p.files = p.files.filter(x => !bad.has(x.src)); });
      plan.infos.push(`${many(apple.length, 'hidden Mac file', 'hidden Mac files')} (AppleDouble) skipped: Amazon rejects them.`);
    }
    const list = a => a.slice(0, 4).join(', ') + (a.length > 4 ? ` and ${a.length - 4} more` : '');
    if (small.length) plan.warns.push(`${many(small.length, 'photo is', 'photos are')} under 1,000 px on the longest side, so Amazon's zoom won't work: ${list(small)}.`);
    if (big.length) plan.warns.push(`${many(big.length, 'photo is', 'photos are')} over 10,000 px, Amazon's limit. Turn on “Shrink large photos”: ${list(big)}.`);
    if (heavy.length) plan.warns.push(`${many(heavy.length, 'photo is', 'photos are')} over 10 MB. Turn on “Convert to JPEG” to make ${heavy.length === 1 ? 'it' : 'them'} smaller.`);
    if (unreadable.length) plan.warns.push(`${many(unreadable.length, 'photo', 'photos')} could not be opened and may be damaged: ${list(unreadable)}.`);
  }

  // ------------------------------------------------------------------ making the files
  const processed = new Map();
  async function blobFor(src) {
    const needs = S.opts.jpeg || S.opts.resize || CONVERT_EXT.test(src.name);
    if (!needs) return src.file;
    const key = src.file;
    if (processed.has(key)) return processed.get(key);
    const job = (async () => {
      let bmp;
      try { bmp = await createImageBitmap(src.file); } catch (e) { return src.file; }   // TIFF and others: keep as is
      let w = bmp.width, h = bmp.height;
      const max = S.opts.resize ? Math.max(500, +S.opts.maxpx || 3000) : 10000;
      if (Math.max(w, h) > max) { const k = max / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d');
      const toJpeg = S.opts.jpeg || CONVERT_EXT.test(src.name) || !/\.(png|gif)$/i.test(src.name);
      if (toJpeg) { cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); }       // transparent parts become white
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(bmp, 0, 0, w, h);
      bmp.close && bmp.close();
      return await new Promise(res => cv.toBlob(b => res(b), toJpeg ? 'image/jpeg' : 'image/png', (+S.opts.quality || 92) / 100));
    })();
    processed.set(key, job);
    return job;
  }
  function outPath(p, x) {
    if (S.opts.layout === 'flat') return x.out;
    const clean = s => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').trim() || '-';
    return S.mode === 'list' ? `${clean(p.colour)}/${clean(p.size)}/${p.id}/${x.out}` : `${p.id}/${x.out}`;
  }
  async function entries(plan, progress) {
    const out = [];
    for (let i = 0; i < plan.items.length; i++) {
      const { p, x } = plan.items[i];
      out.push({ name: outPath(p, x), blob: await blobFor(x.src) });
      if (progress && (i % 10 === 0 || i === plan.items.length - 1)) progress(i + 1, plan.items.length);
    }
    return out;
  }
  function chunks(list) {
    const parts = []; let cur = [], bytes = 0;
    list.forEach(e => {
      const sz = e.blob.size + e.name.length * 2 + 100;
      if (cur.length && (cur.length >= ZIP_MAX_FILES || bytes + sz > ZIP_MAX_BYTES)) { parts.push(cur); cur = []; bytes = 0; }
      cur.push(e); bytes += sz;
    });
    if (cur.length) parts.push(cur);
    return parts;
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
  }
  function stamp() { return new Date().toISOString().slice(0, 10); }

  // ------------------------------------------------------------------ UI
  const ui = {
    status: $('#status'), bar: $('#bar i'), barWrap: $('#bar'),
  };
  function setBusy(on, text) {
    S.busy = on;
    root.classList.toggle('busy', on);
    ui.barWrap.hidden = !on;
    if (text !== undefined) ui.status.textContent = text;
    $$('#tool button, #tool input, #tool textarea, #tool select').forEach(el => { if (!el.closest('.keep')) el.disabled = on; });
    if (!on) {
      $$('[data-out]').forEach(b => { b.disabled = !(S.plan && S.plan.items.length); });
      refresh();
    }
  }
  function prog(label) { return (a, b) => { ui.bar.style.width = (b ? a / b * 100 : 0).toFixed(1) + '%'; ui.status.textContent = `${label} ${n(a)} of ${n(b)}…`; }; }

  function renderList() {
    const parsed = parseList($('#list').value);
    S.rows = parsed.rows; S.listNote = parsed.note;
    $('#listNote').textContent = parsed.note || 'Paste your list, or upload a file.';
    $('#listNote').className = 'found' + (parsed.rows.length ? ' ok' : '');
    S.plan = null; refresh();
  }
  function renderFolder() {
    const map = dirs(), box = $('#folderNote');
    if (!S.files.length) {
      box.className = 'found'; box.textContent = S.junk || S.other ? 'No photos found in that folder.' : 'No folder chosen yet.';
      return;
    }
    const last = d => d.split('/').pop() || '(top folder)';
    const all = [...map.keys()], twice = new Set(all.map(last).filter((x, i, a) => a.indexOf(x) !== i));
    const names = all.map(d => twice.has(last(d)) ? d.split('/').slice(-2).join('/') : last(d));   // "Style 1/White" when names repeat
    box.className = 'found ok';
    box.textContent = `Found ${many(map.size, 'photo folder', 'photo folders')}: ${names.slice(0, 6).join(', ')}${names.length > 6 ? ` and ${names.length - 6} more` : ''} · ${many(S.files.length, 'photo', 'photos')}`;
  }
  function refresh() {
    const ready = S.files.length && (S.mode === 'folders' || S.rows.length);
    $('#check').disabled = !ready || S.busy;
    $('#result').hidden = !S.plan;
  }

  function renderPlan(plan) {
    const box = $('#result');
    const errors = plan.errors.length, warns = plan.warns.length;
    $('#sum').innerHTML =
      `<span class="ok"><b>${n(plan.ok.length)}</b> ${plan.ok.length === 1 ? 'product' : 'products'} ready</span>` +
      `<span><b>${n(plan.items.length)}</b> photos to create</span>` +
      `<span class="${errors ? 'err' : 'ok'}"><b>${n(errors)}</b> ${errors === 1 ? 'problem' : 'problems'}</span>` +
      `<span class="${warns ? 'warn' : ''}"><b>${n(warns)}</b> ${warns === 1 ? 'warning' : 'warnings'}</span>`;
    const msgs = plan.errors.map(m => `<li class="err">${esc(m)}</li>`)
      .concat(plan.warns.map(m => `<li class="warn">${esc(m)}</li>`))
      .concat(plan.infos.map(m => `<li class="info">${esc(m)}</li>`));
    if (!plan.errors.length && plan.ok.length) msgs.unshift(`<li class="ok">${many(plan.ok.length, 'product', 'products')} matched to ${plan.ok.length === 1 ? 'its' : 'their'} photos, no duplicate ASINs</li>`);
    $('#checks').innerHTML = msgs.slice(0, 40).join('') + (msgs.length > 40 ? `<li class="info">and ${n(msgs.length - 40)} more</li>` : '');
    // the new names, grouped by colour
    const groups = new Map();
    plan.ok.forEach(p => { const k = p.colour || p.dir; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
    const order = s => { const i = SIZE_ORDER.indexOf(String(s).toUpperCase()); return i < 0 ? 99 : i; };
    let shown = 0;
    $('#names').innerHTML = [...groups.entries()].map(([k, ps]) => {
      ps.sort((a, b) => order(a.size) - order(b.size));
      return `<details${shown++ < 1 ? ' open' : ''}><summary><b>${esc(k)}</b> <small>${many(ps.length, 'product', 'products')} · ${many(ps.reduce((s, p) => s + p.files.length, 0), 'photo', 'photos')}</small></summary>` +
        ps.map((p, j) => `<div class="asin"><b>${esc(p.size || p.id)}</b>${p.size ? ' · ' + esc(p.id) : ''} <small>${many(p.files.length, 'photo', 'photos')}</small>` +
          (j < 2 ? `<div class="files">${p.files.map(x => `<span>${esc(outPath(p, x))}${x.copyOf ? ' <em>(copy of MAIN)</em>' : ''}</span>`).join('')}</div>` : '') + '</div>').join('') +
        '</details>';
    }).join('') || '<p class="muted">No products are ready yet. Fix the problems on the right, then check again.</p>';
    const can = plan.items.length > 0;
    $$('[data-out]').forEach(b => { b.disabled = !can; });
    $('#saveFolder').hidden = !window.showDirectoryPicker;
    $('#zipNote').textContent = can ? `${many(plan.items.length, 'photo', 'photos')}. Big jobs are split into ZIP files under 1 GB and 1,000 photos each.` : '';
    $('#zips').innerHTML = '';
    box.hidden = false;
  }

  async function runCheck() {
    if (S.busy) return;
    setBusy(true, 'Checking…');
    try {
      const plan = buildPlan();
      await sizeCheck(plan, prog('Checking photo'));
      S.plan = plan;
      renderPlan(plan);
      ui.status.textContent = plan.errors.length ? 'Check done. Fix the problems, or download the products that are ready.' : 'Check done. Ready to download.';
      $('#result').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      track('check', { mode: S.mode, products: plan.ok.length, photos: plan.items.length });
    } catch (e) {
      console.error(e); ui.status.textContent = 'Something went wrong while checking. Please try again.';
    } finally { setBusy(false); refresh(); $('#result').hidden = !S.plan; }
  }

  async function makeZips() {
    if (!S.plan || S.busy) return;
    setBusy(true, 'Preparing photos…');
    try {
      const list = await entries(S.plan, prog('Preparing photo'));
      const parts = chunks(list), links = [];
      for (let i = 0; i < parts.length; i++) {
        const blob = await HXZip.makeZip(parts[i], prog(`ZIP ${i + 1} of ${parts.length}: adding photo`));
        const name = parts.length > 1 ? `amazon-images-${stamp()}-part-${i + 1}-of-${parts.length}.zip` : `amazon-images-${stamp()}.zip`;
        links.push({ blob, name, count: parts[i].length });
      }
      $('#zips').innerHTML = links.map((l, i) => `<button type="button" class="btn keep" data-zip="${i}">Download ${esc(l.name)} <small>${many(l.count, 'photo', 'photos')} · ${(l.blob.size / 1e6).toFixed(1)} MB</small></button>`).join('');
      $$('#zips [data-zip]').forEach(b => b.addEventListener('click', () => { const l = links[+b.dataset.zip]; download(l.blob, l.name); b.classList.add('done'); }));
      if (links.length === 1) download(links[0].blob, links[0].name);
      ui.status.textContent = links.length === 1 ? 'Your ZIP is downloading. Upload it in Seller Central: Catalog, Upload images.' : `${links.length} ZIP files are ready: download each one.`;
      track('download_zip', { parts: links.length, photos: list.length });
      askFeedback();
    } catch (e) {
      console.error(e); ui.status.textContent = 'The ZIP could not be made. Try fewer photos at a time, or use “Save into a folder” in Chrome or Edge.';
    } finally { setBusy(false); }
  }

  async function saveFolder() {
    if (!S.plan || S.busy || !window.showDirectoryPicker) return;
    let dirHandle;
    try { dirHandle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'hx-image-renamer' }); } catch (e) { return; }
    setBusy(true, 'Saving…');
    try {
      const out = await dirHandle.getDirectoryHandle(`Amazon images ${stamp()}`, { create: true });
      const items = S.plan.items, handles = new Map([['', out]]), p = prog('Saving photo');
      for (let i = 0; i < items.length; i++) {
        const path = outPath(items[i].p, items[i].x).split('/');
        let dir = out, at = '';
        for (const seg of path.slice(0, -1)) {
          at += '/' + seg;
          if (!handles.has(at)) handles.set(at, await dir.getDirectoryHandle(seg, { create: true }));
          dir = handles.get(at);
        }
        const fh = await dir.getFileHandle(path[path.length - 1], { create: true });
        const w = await fh.createWritable();
        await w.write(await blobFor(items[i].x.src)); await w.close();
        if (i % 5 === 0 || i === items.length - 1) p(i + 1, items.length);
      }
      ui.status.textContent = `Saved ${many(items.length, 'photo', 'photos')} into the folder “Amazon images ${stamp()}”.`;
      track('save_folder', { photos: items.length });
      askFeedback();
    } catch (e) {
      console.error(e); ui.status.textContent = 'Saving stopped: ' + (e && e.message ? e.message : 'please try again') + '.';
    } finally { setBusy(false); }
  }

  function report() {
    if (!S.plan) return;
    const rows = [['Colour', 'Size', 'ASIN', 'Photo folder', 'Photos', 'Status', 'New file names']];
    S.plan.products.forEach(p => rows.push([p.colour, p.size, p.id, p.dir || '', p.files ? p.files.length : 0,
      p.problems.length ? 'Problem: ' + p.problems.join('; ') : (p.files && p.files.length ? 'Ready' : 'No photos'),
      (p.files || []).map(x => x.out).join(' ')]));
    const cell = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
    download(new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), `image-renamer-report-${stamp()}.csv`);
    track('download_report', {});
  }
  function askFeedback() { if (window.hxFeedback) setTimeout(() => window.hxFeedback.ask('Image Renamer'), 2000); }
  function track(name, params) { try { if (window.track) window.track(name, params); } catch (e) { /* stats off */ } }

  // ------------------------------------------------------------------ example
  const EX_COLOURS = [['White', '#f4f4f2', '#d9d9d6'], ['Black', '#26282c', '#3a3d43'], ['Navy', '#1f2f5a', '#2c3f73']];
  const EX_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];
  const EX_CODES = ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05'];
  function exampleList() {
    let k = 1;
    return ['Colour\tSize\tASIN'].concat(EX_COLOURS.flatMap(([c]) => EX_SIZES.map(s => `${c}\t${s}\tB0EXAMP${String(k++).padStart(3, '0')}`))).join('\n');
  }
  async function examplePhotos() {
    const out = [];
    for (const [name, fill, line] of EX_COLOURS) {
      for (const code of EX_CODES) {
        const cv = document.createElement('canvas'); cv.width = cv.height = 1200;
        const c = cv.getContext('2d');
        c.fillStyle = '#ffffff'; c.fillRect(0, 0, 1200, 1200);
        c.save(); c.translate(600, 640); const sc = code === 'MAIN' ? 1 : 0.8; c.scale(sc, sc);
        c.fillStyle = fill; c.strokeStyle = line; c.lineWidth = 10; c.lineJoin = 'round';
        c.beginPath();
        c.moveTo(-170, -330); c.lineTo(-420, -230); c.lineTo(-340, -40); c.lineTo(-250, -80); c.lineTo(-250, 380);
        c.lineTo(250, 380); c.lineTo(250, -80); c.lineTo(340, -40); c.lineTo(420, -230); c.lineTo(170, -330);
        c.quadraticCurveTo(0, -200, -170, -330); c.closePath(); c.fill(); c.stroke();
        c.restore();
        if (code !== 'MAIN') {
          c.fillStyle = '#3d6bff'; c.font = '700 64px system-ui, sans-serif'; c.fillText(code, 60, 110);
          c.fillStyle = '#5b6782'; c.font = '500 40px system-ui, sans-serif'; c.fillText(name + ' T-shirt', 60, 170);
        }
        const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
        out.push({ file: new File([blob], `photo.${code}.jpg`, { type: 'image/jpeg' }), path: `Example T-shirt/${name}/photo.${code}.jpg` });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ events
  $$('[name=mode]').forEach(r => r.addEventListener('change', () => {
    S.mode = $('[name=mode]:checked').value;
    root.dataset.mode = S.mode; S.plan = null; refresh();
  }));
  $('#list').addEventListener('input', () => { clearTimeout(renderList.t); renderList.t = setTimeout(renderList, 250); });
  $('#listFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      let text;
      if (/\.xlsx?$/i.test(f.name)) {
        if (!window.XLSX) {
          ui.status.textContent = 'Opening the Excel file…';
          await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
        }
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
        text = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: '\t' });
      } else text = await f.text();
      $('#list').value = text.trim(); renderList();
      ui.status.textContent = `Loaded ${f.name}.`;
    } catch (err) { console.error(err); ui.status.textContent = 'That file could not be read. Save it as CSV or Excel (.xlsx) and try again.'; }
    e.target.value = '';
  });
  $('#folderInput').addEventListener('change', e => {
    addFiles(Array.from(e.target.files).map(f => ({ file: f, path: f.webkitRelativePath || f.name })));
    e.target.value = '';
  });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', async e => {
    e.preventDefault();
    const items = Array.from(e.dataTransfer.items || []);
    const out = [];
    if (items.length && items[0].webkitGetAsEntry) {
      ui.status.textContent = 'Reading the folder…';
      for (const it of items) { const en = it.webkitGetAsEntry(); if (en) await readEntry(en, out); }
    } else Array.from(e.dataTransfer.files).forEach(f => out.push({ file: f, path: f.name }));
    addFiles(out); ui.status.textContent = '';
  });
  $$('[data-opt]').forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.opt;
    S.opts[k] = el.type === 'checkbox' ? el.checked : el.type === 'radio' ? $(`[data-opt=${k}]:checked`).value : el.value;
    if (S.plan) { S.plan = null; processed.clear(); $('#result').hidden = true; ui.status.textContent = 'Options changed: check again.'; }
    refresh();
  }));
  $('#check').addEventListener('click', runCheck);
  $('[data-out=zip]').addEventListener('click', makeZips);
  $('#saveFolder').addEventListener('click', saveFolder);
  $('[data-out=report]').addEventListener('click', report);
  $('#tryExample').addEventListener('click', async () => {
    setBusy(true, 'Making example photos…');
    $('[name=mode][value=list]').checked = true; S.mode = 'list'; root.dataset.mode = 'list';
    $('#list').value = exampleList(); renderList();
    addFiles(await examplePhotos());
    setBusy(false); await runCheck();
  });
  $('#clearAll').addEventListener('click', () => {
    $('#list').value = ''; renderList(); addFiles([]); S.plan = null; processed.clear(); refresh();
    ui.status.textContent = '';
  });
  $('#exampleCsv').addEventListener('click', () => {
    download(new Blob(['﻿' + exampleList().replace(/\t/g, ',') + '\r\n'], { type: 'text/csv;charset=utf-8' }), 'image-renamer-example-list.csv');
  });

  renderList(); renderFolder(); refresh();
  root.classList.add('ready');
})();
