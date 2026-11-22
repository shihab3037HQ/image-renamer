'use strict';
/* HexaEcom Amazon Bulk Image Renamer (images.hexaecom.com).
   One photo set per colour (or one folder per product) becomes a full set of Amazon file names for every
   ASIN: <ASIN>.<CODE>.<ext>, ready for Seller Central's bulk image upload. A list can hold many styles
   (parents): each style keeps its own colour folders, its own group in the check, and its own folder or
   ZIP in the download. Everything runs in the browser: photos are never uploaded, and the original files
   are never changed. */
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
  const HEAD_WORD = /\b(asins?|upc|ean|isbn|gtin|jan|sku|colou?rs?|sizes?|styles?|parent|folder|variation|model|product)\b/;

  const S = {
    mode: 'list',              // 'list': style, colour, size, ASIN rows · 'folders': folders named with ASINs
    rows: [], listNote: '',
    files: [], junk: 0, other: 0,
    opts: { swch: true, jpeg: false, quality: 92, resize: false, maxpx: 3000 },
    pack: 'zip',               // the download: 'zip' one ZIP · 'styles' one ZIP per style · 'folders' folders to check
    fill: null, oneStyle: false,   // a Style column that counts up (Excel drag-fill), and the one-tap fix
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
  const cleanId = s => String(s || '').replace(/[\s-]/g, '').toUpperCase();
  function idProblem(id) {
    if (!id) return 'The ASIN is empty';
    if (/^B[0-9A-Z]{9}$/.test(id)) return '';
    if (/^\d{10}$|^\d{12,14}$|^97[89]\d{10}$/.test(id)) return '';   // ISBN-10, UPC, EAN, GTIN, ISBN-13
    return `“${id}” doesn't look like an ASIN (B + 9 letters or numbers), UPC, EAN or ISBN`;
  }
  function parseList(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim());
    if (!lines.length) return { rows: [], note: '', fill: null };
    const first = lines[0];
    const sep = first.includes('\t') ? '\t' : first.includes(',') ? ',' : first.includes(';') ? ';' : '\t';
    const cells = l => splitLine(l, sep).map(x => x.trim());
    const head = cells(first).map(h => h.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim());
    // A header row names its columns and holds no product ID ("Ocean" or "Multicolor" is a colour, not a header)
    const hasHead = head.some(h => HEAD_WORD.test(h)) && !head.some(h => !idProblem(cleanId(h)));
    let ai = -1, ci = -1, si = -1, fi = -1, ti = -1;                 // ASIN, colour, size, folder, style
    if (hasHead) {
      const taken = new Set();
      const find = (...res) => {
        for (const re of res) { const i = head.findIndex((h, j) => !taken.has(j) && re.test(h)); if (i >= 0) { taken.add(i); return i; } }
        return -1;
      };
      ai = find(/^(asin|child asin|product id|upc|ean|isbn|jan|gtin)$/, /^(?!.*parent).*(asin|product id|\bupc\b|\bean\b|gtin)/);
      ci = find(/^(colou?r|colou?r name|variation)$/, /colou?r/);
      si = find(/^(size|size name)$/, /\bsizes?\b/);
      fi = find(/^(folder|main folder|photo folder|image folder|product)$/);
      ti = find(/^(style|parent|style name|parent name|style number|style no|style code|style id|parent sku|parent style|parent asin|model|model name|model number)$/, /\b(styles?|parent)\b/);
    } else {
      // No header: the ASIN column is the one that holds product IDs; the others are (style,) colour, size
      const sample = lines.slice(0, 30).map(cells);
      const cols = Math.max(...sample.map(r => r.length));
      let best = -1, score = 0;
      for (let j = 0; j < cols; j++) {
        const ids = sample.map(r => cleanId(r[j])).filter(x => !idProblem(x));
        const sc = ids.length * 1000 + new Set(ids).size;           // child ASINs are all different, a parent ASIN repeats
        if (ids.length && sc >= score) { score = sc; best = j; }
      }
      ai = best >= 0 ? best : cols - 1;
      let rest = Array.from({ length: cols }, (_, j) => j).filter(j => j !== ai);
      // A second column of product IDs is the parent ASIN: it is the style only when no style name is there
      const spare = rest.filter(j => { const vals = sample.map(r => r[j]).filter(Boolean); return vals.length && vals.every(v => !idProblem(cleanId(v))); });
      const named = rest.filter(j => !spare.includes(j));
      if (spare.length && named.length >= 3) rest = named; else if (spare.length && named.length === 2) rest = [spare[0], ...named];
      if (rest.length >= 3) [ti, ci, si] = rest; else if (rest.length === 2) [ci, si] = rest; else if (rest.length === 1) [ci] = rest;
    }
    const rows = [];
    (hasHead ? lines.slice(1) : lines).forEach((line, i) => {
      const c = cells(line), at = j => (j >= 0 && c[j]) || '';
      const id = at(ai);
      if (!id && !at(ci)) return;
      rows.push({ line: i + (hasHead ? 2 : 1), style: at(ti) || at(fi), colour: at(ci), size: at(si), folder: at(fi), id: cleanId(id) });
    });
    const fill = fillDown(rows);
    if (fill && S.oneStyle) { rows.forEach(r => { if (r.style) r.style = fill.first; }); fill.fixed = true; }
    const styles = [...new Set(rows.map(r => r.style).filter(Boolean))];
    let note = '';
    if (rows.length) {
      note = `${many(rows.length, 'product', 'products')} in your list`;
      if (styles.length) note += ` · ${many(styles.length, 'style', 'styles')}: ${styles.slice(0, 4).join(', ')}${styles.length > 4 ? ` and ${n(styles.length - 4)} more` : ''}`;
    }
    return { rows, note, fill };
  }
  // "AB101, AB102, AB103…" down the Style column is what Excel does when one cell is dragged down
  function fillDown(rows) {
    const part = s => String(s || '').match(/^(.*?)(\d+)$/);
    const styles = [...new Set(rows.map(r => r.style).filter(Boolean))];
    if (styles.length < 3 || styles.some(s => !part(s)) || new Set(styles.map(s => part(s)[1])).size !== 1) return null;
    const nums = styles.map(s => +part(s)[2]).sort((a, b) => a - b);
    if (nums[nums.length - 1] - nums[0] !== nums.length - 1) return null;       // an unbroken run of numbers
    let steps = 0, up = 0;
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i].style || !rows[i - 1].style) continue;
      const a = +part(rows[i - 1].style)[2], b = +part(rows[i].style)[2];
      steps++; if (b === a + 1 || b === nums[0]) up++;                           // one more on every row, or starting again
    }
    if (!steps || up / steps < 0.9) return null;
    const at = k => styles.find(s => +part(s)[2] === k);
    return { first: at(nums[0]), last: at(nums[nums.length - 1]), count: styles.length, fixed: false };
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

  // ------------------------------------------------------------------ finding each product's photos
  // The colour's name finds the folder. Capitals, spaces, dashes and underscores don't matter, the photos may
  // sit in a folder inside the colour folder (for example one finished ASIN), and a style name is only needed
  // to choose between two folders with the same colour.
  const norm = s => String(s || '').toLowerCase().replace(/[_\-\s]+/g, ' ').trim();
  const squash = s => norm(s).replace(/[^\p{L}\p{N}]+/gu, '');
  const wordsOf = s => norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ');
  const hasWords = (name, want) => { const w = wordsOf(want); return !!w && (' ' + wordsOf(name) + ' ').includes(' ' + w + ' '); };
  const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  function near(a, b) {                                   // one or two letters apart: for "did you mean"
    a = squash(a); b = squash(b);
    if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 2) return false;
    let row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row = next;
    }
    return row[b.length] <= 2;
  }

  // Sizes however they are written: S = Small, XL = X-Large = 1XL, 3X = 3XL = XXXL
  function sizeInfo(s) {
    let t = String(s || '').toLowerCase().replace(/[\s._\-\/]+/g, '');
    t = t.replace(/^extra/, 'x').replace(/small$/, 's').replace(/(medium|med)$/, 'm').replace(/(large|lrg|lg)$/, 'l');
    if (t === 's' || t === 'sm') return { key: 's', rank: 40 };
    if (t === 'm' || t === 'md') return { key: 'm', rank: 50 };
    if (t === 'l') return { key: 'l', rank: 60 };
    const m = t.match(/^(\d)?(x+)(s|l)?$/);
    if (!m || (m[1] && m[2].length > 1) || (!m[1] && !m[3])) return null;   // "2xx" and a bare "x" are not sizes
    const n = m[1] ? +m[1] : m[2].length;
    if (!n) return null;
    return m[3] === 's' ? { key: n + 'xs', rank: 40 - n * 10 } : { key: n + 'xl', rank: 60 + n * 10 + (m[3] ? 0 : 1) };   // 3X sorts just after 3XL
  }
  const sizeSame = (a, b) => { if (norm(a) === norm(b)) return 2; const x = sizeInfo(a), y = sizeInfo(b); return x && y && x.key === y.key ? 1 : 0; };
  function bySize(a, b) {                                 // S, M, L, XL, XXL, 3X…; other sizes keep the list's order
    const x = sizeInfo(a.size), y = sizeInfo(b.size);
    return x && y ? x.rank - y.rank : x ? -1 : y ? 1 : 0;
  }

  // Every folder in the drop: its own photos, and the photo folders anywhere inside it
  function folderTree() {
    const nodes = new Map();
    const get = path => {
      if (nodes.has(path)) return nodes.get(path);
      const cut = path.lastIndexOf('/');
      const node = { path, name: path.slice(cut + 1), up: cut < 0 ? null : get(path.slice(0, cut)), own: [], sets: [] };
      nodes.set(path, node);
      return node;
    };
    S.files.forEach(f => get(f.dir).own.push(f));
    nodes.forEach(n => { if (n.own.length) for (let p = n; p; p = p.up) p.sets.push(n); });
    return nodes;
  }
  const namesOf = n => { const out = []; for (let p = n; p; p = p.up) out.unshift(p.name); return out; };
  const isInside = (n, top) => { for (let p = n.up; p; p = p.up) if (p === top) return true; return false; };

  function foldersNamed(name, nodes) {                    // the folders that carry a name and hold photos: best matches only
    const want = norm(name), sq = squash(name), exact = [], loose = [];
    nodes.forEach(n => {
      if (!n.sets.length || !n.name) return;
      if (norm(n.name) === want || (sq && squash(n.name) === sq)) exact.push(n);
      else if (hasWords(n.name, name)) loose.push(n);     // "Black final", "Style 1 Black"
    });
    let hits = exact.length ? exact : loose;
    hits = hits.filter(n => !hits.some(o => isInside(n, o)));   // "Black/Black": the outer one
    return { hits, loose: !exact.length && hits.length > 0 };
  }
  function photosIn(node, p) {                            // the photo folder a product gets from its colour folder
    if (node.own.length) return { set: node };
    const sets = node.sets, depth = namesOf(node).length, below = s => namesOf(s).slice(depth);
    if (sets.length === 1) return { set: sets[0] };
    let hit = sets.filter(s => below(s).some(seg => cleanId(seg) === p.id));          // this product's own folder
    if (hit.length === 1) return { set: hit[0] };
    for (const level of p.size ? [2, 1] : []) {                                       // a folder for its size
      hit = sets.filter(s => below(s).some(seg => sizeSame(seg, p.size) >= level));
      if (hit.length === 1) return { set: hit[0] };
    }
    // several finished sets: the fullest one is the pattern for every product without its own
    return { set: sets.slice().sort((a, b) => b.own.length - a.own.length || natural(a.path, b.path))[0], among: sets.length };
  }
  function findPhotos(p, nodes, ctx) {
    const key = p.colour || p.style;
    if (!key) return ctx.sets.length === 1 ? { set: ctx.sets[0], folder: ctx.sets[0], only: true } : { none: true };
    const name = key.split(/[\/\\]/).filter(Boolean).pop() || key;
    let { hits, loose } = foldersNamed(name, nodes);
    const by = p.folder || (p.colour ? p.style : key !== name ? key : '');
    if (hits.length > 1 && by) {                          // two folders with this colour: the style says which
      const want = by.split(/[\/\\]/).map(norm).filter(Boolean);
      const run = n => { const ns = namesOf(n).map(norm); return ns.some((_, i) => want.every((w, j) => ns[i + j] === w)); };
      let keep = hits.filter(run);
      if (!keep.length) keep = hits.filter(n => namesOf(n).some(seg => hasWords(seg, by)));
      if (keep.length) hits = keep;
    }
    if (hits.length === 1) return Object.assign(photosIn(hits[0], p), { folder: hits[0], loose });
    if (hits.length > 1) return { many: hits };
    if (ctx.sets.length === 1 && ctx.keys.size === 1) return { set: ctx.sets[0], folder: ctx.sets[0], only: true };   // one photo folder, one colour
    return { none: true };
  }

  // ------------------------------------------------------------------ names and codes
  function codeOf(name) {
    const dot = name.lastIndexOf('.');
    let base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
    base = base.replace(/\s*\(\d+\)$/, '').replace(/[\s_-]*copy(\s*\d+)?$/i, '').trim();    // "MAIN (1)", "MAIN copy"
    const std = t => {
      t = t.toUpperCase().replace(/\s+/g, ''); let m;
      if (t === 'MAIN') return 'MAIN';
      if ((m = t.match(/^PT0?(\d{1,2})$/))) return 'PT' + String(+m[1]).padStart(2, '0');
      return t === 'SWCH' || t === 'SWATCH' ? 'SWCH' : '';
    };
    const parts = base.split('.'), last = parts[parts.length - 1];
    let code = std(last), m;
    if (!code && (m = base.match(/(?:^|[._\-\s])([A-Za-z]+\s?\d{0,2})$/))) code = std(m[1]);    // "ASIN_MAIN", "photo-PT01", "pt 1"
    if (!code && parts.length > 1) code = last.trim().toUpperCase().replace(/\s+/g, '');       // another code after a dot: kept, and the check says so
    return { code, ext: ext === '.jpeg' ? '.jpg' : ext };
  }
  function outExt(f) {
    if (S.opts.jpeg || CONVERT_EXT.test(f.name)) return '.jpg';
    return codeOf(f.name).ext;
  }

  // ------------------------------------------------------------------ the check
  function buildPlan() {
    const map = dirs(), errors = [], warns = [], infos = [], oks = [], items = [];
    const nodes = folderTree(), sets = [...nodes.values()].filter(n => n.own.length);
    const products = [], missing = new Map(), doubt = new Map(), notes = new Map();
    if (S.mode === 'list') {
      const seen = new Map();
      const ctx = { sets, keys: new Set(S.rows.map(r => norm(r.colour || r.style)).filter(Boolean)) };
      S.rows.forEach(r => {
        const p = { style: r.style, listStyle: r.style, colour: r.colour, size: r.size, id: r.id, folder: r.folder, line: r.line, problems: [] };
        const bad = idProblem(r.id);
        if (bad) p.problems.push(bad);
        if (seen.has(r.id) && r.id) p.problems.push(`Same ASIN as line ${seen.get(r.id)}`); else seen.set(r.id, r.line);
        products.push(p);
        if (p.problems.length) return;
        const f = findPhotos(p, nodes, ctx), label = p.colour || p.style || '(no colour)';
        if (!f.set) {                                     // gathered by colour, so the check says it once
          const m = f.many ? doubt : missing;
          if (!m.has(label)) m.set(label, { count: 0, hits: f.many });
          m.get(label).count++;
          p.unmatched = f.many ? `${f.many.length} folders are named “${label}”` : `No photo folder named “${label}”`;
          return;
        }
        p.dir = f.set.path;
        if (!p.style && f.folder.up && f.folder.up.name) p.style = f.folder.up.name;      // no Style column: the main folder's name
        if (f.among) notes.set('among ' + f.folder.path, `“${f.folder.name}” has ${f.among} photo folders inside. Products without a folder of their own use “${f.set.name}”.`);
        if (f.loose) notes.set('loose ' + f.folder.path, `“${label}” uses the folder “${f.folder.name}”.`);
        if (f.only && label !== '(no colour)') notes.set('only', `No folder is named “${label}”. The only photo folder, “${f.set.name || f.set.path}”, is used.`);
      });
    } else {
      const found = [];
      map.forEach((files, dir) => {
        const segs = dir.split('/'); let end = segs.length;
        if (end > 1 && segs[end - 1].toLowerCase() === 'images') end--;
        const id = cleanId(segs[end - 1]);
        if (idProblem(id)) return;
        found.push({ id, dir, above: segs.slice(0, end - 1) });
      });
      found.sort((x, y) => x.dir.localeCompare(y.dir, undefined, { numeric: true }));
      // The folders above each ASIN folder, without the part they all share. The first one is the style.
      const common = found.length ? found[0].above.slice() : [];
      found.forEach(f => { let k = 0; while (k < common.length && common[k] === f.above[k]) k++; common.length = k; });
      const seen = new Map();
      found.forEach(f => {
        const rel = f.above.slice(common.length);
        const p = { style: rel[0] || '', colour: '', size: '', id: f.id, dir: f.dir, rel, problems: [], line: 0 };
        if (seen.has(f.id)) p.problems.push(`Two folders are named with the ASIN ${f.id}: “${seen.get(f.id)}” and “${f.dir}”`); else seen.set(f.id, f.dir);
        products.push(p);
      });
      if (!products.length && S.files.length) errors.push('No folder is named with an ASIN. Name each product folder with its ASIN, or use “My list”.');
    }
    const codeWarn = new Set(), noCode = new Set(), dupCode = [], skipped = new Set(), bare = new Set();
    products.forEach(p => {
      if (p.unmatched) { p.problems.push(p.unmatched); p.files = []; return; }
      if (p.problems.length) { errors.push(...p.problems.map(x => (p.line ? `Line ${p.line}: ` : '') + x)); p.files = []; return; }
      const src = (map.get(p.dir) || []).slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      if (!src.length) { errors.push(`Line ${p.line}: the folder “${p.dir}” has no photos`); p.files = []; return; }
      const used = new Map();
      p.files = [];
      const usable = src.filter(f => !NO_DECODE.test(f.name));   // HEIC: Amazon doesn't accept it (warned below)
      const coded = usable.filter(f => codeOf(f.name).code);
      // "Listing Design.jpg" next to MAIN and PT01: left out, not renamed (Amazon reads a name without a code as MAIN)
      if (coded.length) usable.forEach(f => { if (!coded.includes(f)) skipped.add(p.dir + '/' + f.name); });
      else if (usable.length > 1) { bare.add(p.dir); p.problems.push('The photos have no Amazon code in their names'); return; }
      (coded.length ? coded : usable).forEach(f => {
        const { code } = codeOf(f.name);
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
    const ok = products.filter(p => p.files && p.files.length);
    if (S.mode === 'list') {
      // A colour without photos is said once, with the folder names that are there
      const seen = [...new Set([...nodes.values()].filter(f => f.sets.length && f.up).map(f => f.name))].sort(natural);
      missing.forEach((v, label) => {
        const close = seen.find(name => near(name, label));
        errors.push(`No folder is named “${label}” (${many(v.count, 'product', 'products')}).` +
          (close ? ` Did you mean “${close}”? Use the same name in your list and on the folder.`
            : seen.length ? ` Folders in your drop: ${seen.slice(0, 6).join(', ')}${seen.length > 6 ? ` and ${n(seen.length - 6)} more` : ''}.` : ''));
      });
      doubt.forEach((v, label) => errors.push(`${v.hits.length} folders are named “${label}” (${many(v.count, 'product', 'products')}): ${v.hits.slice(0, 3).map(f => f.path).join(', ')}${v.hits.length > 3 ? '…' : ''}. ` +
        `Add a Style column to your list with the name of the folder each one is in, for example “${(v.hits[0].up && v.hits[0].up.name) || 'Style 1'}”.`));
      // Two styles with the same colour: say that each one has its own photos, or warn when they share a folder
      const users = new Map(), byColour = new Map(), mixed = new Set();
      ok.forEach(p => {
        if (!users.has(p.dir)) users.set(p.dir, { colour: p.colour, styles: new Set() });
        if (p.listStyle) users.get(p.dir).styles.add(p.listStyle);
        if (p.style && p.colour) { const k = norm(p.colour); if (!byColour.has(k)) byColour.set(k, { name: p.colour, styles: new Set() }); byColour.get(k).styles.add(p.style); }
      });
      const counting = S.fill && !S.fill.fixed;           // "AB101, AB102, AB103": said once, below
      users.forEach((u, dir) => {
        if (u.styles.size < 2) return;
        mixed.add(norm(u.colour));
        if (!counting) warns.push(`${u.styles.size} styles (${[...u.styles].slice(0, 4).join(', ')}${u.styles.size > 4 ? '…' : ''}) use the same photo folder${u.colour ? ` for “${u.colour}”` : ''}: “${dir}”. Check that this is right.`);
      });
      if (counting) warns.push(`The Style column counts up row by row (${S.fill.first} to ${S.fill.last}). Excel does this when a cell is dragged down. If it is one style, press “Use ${S.fill.first} for every row” under your list, then check again.`);
      const shared = [...byColour.values()].filter(c => c.styles.size > 1 && !mixed.has(norm(c.name)));
      if (shared.length) oks.push(`${shared.slice(0, 3).map(c => `${c.name} is in ${c.styles.size} styles (${[...c.styles].slice(0, 4).join(', ')}${c.styles.size > 4 ? '…' : ''})`).join('. ')}${shared.length > 3 ? `, and ${n(shared.length - 3)} more shared colours` : ''}. Each style uses its own photo folder.`);
      // Folders that were not needed are fine: say how many, and which
      const usedDirs = new Set(ok.map(p => p.dir)), spare = sets.filter(f => !usedDirs.has(f.path)).sort((a, b) => natural(a.path, b.path));
      if (ok.length && spare.length) infos.push(`${many(usedDirs.size, 'photo folder', 'photo folders')} used, ${n(spare.length)} not used: ${spare.slice(0, 5).map(f => spare.filter(o => o.name === f.name).length > 1 ? f.path.split('/').slice(-2).join('/') : f.name || f.path).join(', ')}${spare.length > 5 ? ` and ${n(spare.length - 5)} more` : ''}. They are not in your list.`);
      notes.forEach(m => infos.push(m));
    }
    bare.forEach(d => errors.push(`The photos in “${d}” have no Amazon code in their names (MAIN, PT01, PT02…). Name them like photo.MAIN.jpg and photo.PT01.jpg.`));
    if (skipped.size) infos.push(`${many(skipped.size, 'photo was', 'photos were')} left out because the name has no Amazon code (MAIN, PT01…): ${[...skipped].sort(natural).slice(0, 3).map(x => x.split('/').slice(-2).join('/')).join(', ')}${skipped.size > 3 ? ` and ${n(skipped.size - 3)} more` : ''}.`);
    [...new Set(dupCode)].forEach(x => errors.push('Two photos get the same name: ' + x));
    if (codeWarn.size) warns.push(`${[...codeWarn].join(', ')} ${codeWarn.size === 1 ? 'is not one of' : 'are not'} Amazon's standard codes (MAIN, PT01 to PT08, SWCH). Check that Amazon accepts ${codeWarn.size === 1 ? 'it' : 'them'} for your category.`);
    if (noCode.size) warns.push(`${many(noCode.size, 'photo has', 'photos have')} no image code in the name (for example ${[...noCode][0]}). Amazon reads a name without a code as the MAIN image.`);
    const conv = new Set(items.filter(i => CONVERT_EXT.test(i.x.src.name)).map(i => i.x.src));
    if (conv.size) infos.push(`${many(conv.size, 'WebP, AVIF or BMP photo', 'WebP, AVIF or BMP photos')} will be converted to JPEG. Amazon accepts JPEG, PNG, TIFF and GIF.`);
    const heic = S.files.filter(f => NO_DECODE.test(f.name)).length;
    if (heic) warns.push(`${many(heic, 'HEIC photo', 'HEIC photos')} found. Amazon doesn't accept HEIC: export ${heic === 1 ? 'it' : 'them'} as JPEG first.`);
    if (S.junk) infos.push(`${many(S.junk, 'Mac or Windows system file was', 'Mac or Windows system files were')} skipped (Amazon rejects them).`);
    return { products, ok, items, errors, warns, infos, oks, sizes: [] };
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
      plan.ok = plan.products.filter(p => p.files && p.files.length);
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

  // Where each photo goes in the download. Amazon's ZIP holds loose files; the folders are for checking.
  const clean = s => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/[. ]+$/, '').trim() || '-';
  const styleName = p => p.style ? clean(p.style) : (S.mode === 'list' ? 'No style' : 'Other');
  function folderOf(p) {                                  // Style 1 / Black / S / B0XXXXXXXX
    if (S.mode !== 'list') return (p.rel || []).map(clean).concat(p.id);
    return [p.style, p.colour, p.size].filter(Boolean).map(clean).concat(p.id);
  }
  function pathFor(p, x, pack, onDisk) {
    if (pack === 'folders') return folderOf(p).concat(x.out).join('/');
    if (pack === 'styles' && onDisk) return styleName(p) + '/' + x.out;   // saved straight to disk: one folder per style
    return x.out;
  }
  function styleCount(plan) { return new Set(plan.ok.map(p => p.style || '')).size; }
  function zipSets(plan, pack, blobs) {                   // the ZIP files to make: [{ base, count, list }]
    const day = stamp(), entry = it => ({ name: pathFor(it.p, it.x, pack), blob: blobs ? blobs.get(it) : null });
    if (pack === 'styles') {
      const m = new Map();
      plan.items.forEach(it => { const k = styleName(it.p); if (!m.has(k)) m.set(k, []); m.get(k).push(entry(it)); });
      return [...m].map(([k, list]) => ({ base: `amazon-images-${k.replace(/\s+/g, '-')}-${day}`, count: list.length, list }));
    }
    const list = plan.items.map(entry);
    return [{ base: pack === 'folders' ? `amazon-images-in-folders-${day}` : `amazon-images-${day}`, count: list.length, list }];
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
  function stamp() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

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
    S.rows = parsed.rows; S.listNote = parsed.note; S.fill = parsed.fill;
    $('#listNote').textContent = parsed.note || 'Paste your list, or upload a file.';
    $('#listNote').className = 'found' + (parsed.rows.length ? ' ok' : '');
    const hint = $('#listHint'), f = parsed.fill;
    hint.hidden = !f;
    if (f) hint.innerHTML = f.fixed
      ? `Style is “${esc(f.first)}” on every row now. <button type="button" class="link" data-fill="undo">Undo</button>`
      : `Your Style column counts up row by row (${esc(f.first)} to ${esc(f.last)}). Excel does this when you drag a cell down. Is it one style? <button type="button" class="link" data-fill="fix">Use “${esc(f.first)}” for every row</button>`;
    S.plan = null; refresh();
  }
  function renderFolder() {
    const map = dirs(), box = $('#folderNote');
    if (!S.files.length) {
      box.className = 'found'; box.textContent = S.junk || S.other ? 'No photos found in that folder.' : 'No folder chosen yet.';
      return;
    }
    const last = d => d.split('/').pop() || '(top folder)';
    const all = [...map.keys()].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })), twice = new Set(all.map(last).filter((x, i, a) => a.indexOf(x) !== i));
    const names = all.map(d => twice.has(last(d)) ? d.split('/').slice(-2).join('/') : last(d));   // "Style 1/Black" when names repeat
    box.className = 'found ok';
    box.textContent = `Found ${many(map.size, 'photo folder', 'photo folders')}: ${names.slice(0, 6).join(', ')}${names.length > 6 ? ` and ${names.length - 6} more` : ''} · ${many(S.files.length, 'photo', 'photos')}`;
  }
  function refresh() {
    const ready = S.files.length && (S.mode === 'folders' || S.rows.length);
    $('#check').disabled = !ready || S.busy;
    $('#result').hidden = !S.plan;
  }

  // The download choice: what each one gives, shown with the user's own first product
  function renderPack() {
    const plan = S.plan;
    if (!plan) return;
    const list = S.mode === 'list', groups = styleCount(plan), can = plan.items.length > 0;
    $('#packStyles').hidden = groups < 2;
    if (groups < 2 && S.pack === 'styles') S.pack = 'zip';
    $$('[name=pack]').forEach(r => { r.checked = r.value === S.pack; });
    $('#packStylesName').textContent = list ? 'One ZIP for each style' : 'One ZIP for each main folder';
    $('#packStylesSub').textContent = `Upload one ${list ? 'style' : 'main folder'} at a time. Each ZIP is ready for Amazon.`;
    const levels = list ? [plan.ok.some(p => p.style) && 'style', plan.ok.some(p => p.colour) && 'colour', plan.ok.some(p => p.size) && 'size', 'ASIN'].filter(Boolean) : [];
    $('#packFoldersSub').textContent = (list ? `A folder for each ${levels.length > 1 ? levels.slice(0, -1).join(', ') + ' and ' + levels[levels.length - 1] : 'ASIN'}.` : 'Your own folders, with the renamed photos inside.') +
      ' Look through them, then come back and download the ZIP for Amazon.';
    const line = (text, depth, cls) => `<i${cls ? ` class="${cls}"` : ''} style="--d:${depth}">${esc(text)}</i>`;
    const more = (count, depth, what) => count > 0 ? line(`… and ${n(count)} more ${what}`, depth) : '';
    if (can) {
      const first = plan.ok[0], f0 = first.files[0];
      $('#egZip').innerHTML = line(`amazon-images-${stamp()}.zip`, 0, 'dir') + line(f0.out, 1) + (first.files[1] ? line(first.files[1].out, 1) : '') + more(plan.items.length - Math.min(2, first.files.length), 1, 'photos');
      const sets = zipSets(plan, 'styles');
      $('#egStyles').innerHTML = sets.slice(0, 4).map(s => line(`${s.base}.zip`, 0, 'dir') + line(many(s.count, 'photo', 'photos'), 1)).join('') + more(sets.length - 4, 0, 'ZIP files');
      const segs = folderOf(first), tops = [...new Set(plan.ok.map(p => folderOf(p)[0]))].filter(t => t !== segs[0]);
      $('#egFolders').innerHTML = segs.map((s, i) => line(s + '/', i, 'dir')).join('') + line(f0.out, segs.length) + more(first.files.length - 1, segs.length, 'photos') +
        tops.slice(0, 3).map(t => line(t + '/ …', 0, 'dir')).join('') + more(tops.length - 3, 0, 'folders');
    } else $$('#packs .mini').forEach(el => { el.innerHTML = ''; });
    $('[data-out=zip]').textContent = S.pack === 'styles' ? `Download a ZIP for each ${list ? 'style' : 'main folder'}` : S.pack === 'folders' ? 'Download in folders (ZIP)' : 'Download ZIP for Amazon upload';
    $('#zipNote').textContent = can ? `${many(plan.items.length, 'photo', 'photos')}. Big jobs are split into ZIP files under 1 GB and 1,000 photos each.` : '';
    $('#zips').innerHTML = '';
  }

  function renderPlan(plan) {
    const box = $('#result');
    const errors = plan.errors.length, warns = plan.warns.length, list = S.mode === 'list';
    const styles = new Set(plan.ok.map(p => p.style).filter(Boolean)).size;
    $('#sum').innerHTML =
      `<span class="ok"><b>${n(plan.ok.length)}</b> ${plan.ok.length === 1 ? 'product' : 'products'} ready</span>` +
      (styles > 1 || (styles && plan.ok.some(p => p.listStyle || !list)) ? `<span><b>${n(styles)}</b> ${list ? (styles === 1 ? 'style' : 'styles') : (styles === 1 ? 'main folder' : 'main folders')}</span>` : '') +
      `<span><b>${n(plan.items.length)}</b> photos to create</span>` +
      `<span class="${errors ? 'err' : 'ok'}"><b>${n(errors)}</b> ${errors === 1 ? 'problem' : 'problems'}</span>` +
      `<span class="${warns ? 'warn' : ''}"><b>${n(warns)}</b> ${warns === 1 ? 'warning' : 'warnings'}</span>`;
    const msgs = plan.errors.map(m => `<li class="err">${esc(m)}</li>`)
      .concat(plan.warns.map(m => `<li class="warn">${esc(m)}</li>`))
      .concat(plan.oks.map(m => `<li class="ok">${esc(m)}</li>`))
      .concat(plan.infos.map(m => `<li class="info">${esc(m)}</li>`));
    if (!plan.errors.length && plan.ok.length) msgs.unshift(`<li class="ok">${many(plan.ok.length, 'product', 'products')} matched to ${plan.ok.length === 1 ? 'its' : 'their'} photos, no duplicate ASINs</li>`);
    $('#checks').innerHTML = msgs.slice(0, 40).join('') + (msgs.length > 40 ? `<li class="info">and ${n(msgs.length - 40)} more</li>` : '');
    // the new names: one block per style, and inside it one group per colour
    const byStyle = new Map();
    plan.ok.forEach(p => {
      const s = p.style || '', k = list ? (p.colour || p.dir) : p.dir;
      if (!byStyle.has(s)) byStyle.set(s, new Map());
      if (!byStyle.get(s).has(k)) byStyle.get(s).set(k, []);
      byStyle.get(s).get(k).push(p);
    });
    const photos = ps => ps.reduce((s, p) => s + p.files.length, 0);
    let shown = 0;
    $('#names').innerHTML = [...byStyle].map(([style, groups]) => {
      const all = [...groups.values()].flat(), colours = new Set(all.map(p => p.colour).filter(Boolean)).size;
      const head = styles ? `<div class="style-head"><b>${esc(style || (list ? 'No style' : 'Other'))}</b><small>${colours ? many(colours, 'colour', 'colours') + ' · ' : ''}${many(all.length, 'product', 'products')} · ${many(photos(all), 'photo', 'photos')}</small></div>` : '';
      return `<div class="style-group">${head}` + [...groups].map(([k, ps]) => {
        ps.sort(bySize);
        const label = list ? k : ps[0].rel.slice(1).concat(ps[0].dir.split('/').pop()).join(' / ');
        const from = [...new Set(ps.map(p => p.dir))];
        return `<details${shown++ < 1 ? ' open' : ''}><summary><b>${esc(label)}</b> <small>${many(ps.length, 'product', 'products')} · ${many(photos(ps), 'photo', 'photos')}</small></summary>` +
          (list ? `<small class="from">Photos from: ${esc(from.slice(0, 2).join(', '))}${from.length > 2 ? ` and ${from.length - 2} more` : ''}</small>` : '') +
          ps.map((p, j) => `<div class="asin"><b>${esc(p.size || p.id)}</b>${p.size ? ' · ' + esc(p.id) : ''} <small>${many(p.files.length, 'photo', 'photos')}</small>` +
            (j < 2 ? `<div class="files">${p.files.map(x => `<span>${esc(x.out)}${x.copyOf ? ' <em>(copy of MAIN)</em>' : ''}</span>`).join('')}</div>` : '') + '</div>').join('') +
          '</details>';
      }).join('') + '</div>';
    }).join('') || '<p class="muted">No products are ready yet. Fix the problems on the right, then check again.</p>';
    const can = plan.items.length > 0;
    $$('[data-out]').forEach(b => { b.disabled = !can; });
    $('#saveFolder').hidden = !window.showDirectoryPicker;
    renderPack();
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
      track('check', { mode: S.mode, products: plan.ok.length, photos: plan.items.length, styles: styleCount(plan) });
    } catch (e) {
      console.error(e); ui.status.textContent = 'Something went wrong while checking. Please try again.';
    } finally { setBusy(false); refresh(); $('#result').hidden = !S.plan; }
  }

  const AFTER_FOLDERS = 'Look through them, then choose “One ZIP for Amazon” and download.';
  async function makeZips() {
    if (!S.plan || S.busy) return;
    const plan = S.plan, pack = S.pack;
    setBusy(true, 'Preparing photos…');
    try {
      const blobs = new Map(), p1 = prog('Preparing photo');
      for (let i = 0; i < plan.items.length; i++) {
        blobs.set(plan.items[i], await blobFor(plan.items[i].x.src));
        if (i % 10 === 0 || i === plan.items.length - 1) p1(i + 1, plan.items.length);
      }
      const jobs = [];
      zipSets(plan, pack, blobs).forEach(set => {
        const parts = chunks(set.list);
        parts.forEach((part, i) => jobs.push({ list: part, name: set.base + (parts.length > 1 ? `-part-${i + 1}-of-${parts.length}` : '') + '.zip' }));
      });
      const links = [];
      for (let i = 0; i < jobs.length; i++) {
        const p2 = prog(jobs.length > 1 ? `ZIP ${i + 1} of ${jobs.length}: adding photo` : 'Adding photo'), total = jobs[i].list.length;
        links.push({ blob: await HXZip.makeZip(jobs[i].list, done => p2(done, total)), name: jobs[i].name, count: total });
      }
      $('#zips').innerHTML = links.map((l, i) => `<button type="button" class="btn keep" data-zip="${i}">Download ${esc(l.name)} <small>${many(l.count, 'photo', 'photos')} · ${(l.blob.size / 1e6).toFixed(1)} MB</small></button>`).join('');
      $$('#zips [data-zip]').forEach(b => b.addEventListener('click', () => { const l = links[+b.dataset.zip]; download(l.blob, l.name); b.classList.add('done'); }));
      if (links.length === 1) download(links[0].blob, links[0].name);
      ui.status.textContent = pack === 'folders'
        ? (links.length === 1 ? 'Your photos are downloading in folders. ' : `${links.length} ZIP files with your folders are ready: download each one. `) + AFTER_FOLDERS
        : links.length === 1 ? 'Your ZIP is downloading. Upload it in Seller Central: Catalog, Upload images.'
          : `${links.length} ZIP files are ready${pack === 'styles' ? `, one for each ${S.mode === 'list' ? 'style' : 'main folder'}` : ''}: download each one, then upload them in Seller Central: Catalog, Upload images.`;
      track('download_zip', { parts: links.length, photos: plan.items.length, pack });
      askFeedback();
    } catch (e) {
      console.error(e); ui.status.textContent = 'The ZIP could not be made. Try fewer photos at a time, or use “Save into a folder” in Chrome or Edge.';
    } finally { setBusy(false); }
  }

  async function saveFolder() {
    if (!S.plan || S.busy || !window.showDirectoryPicker) return;
    let dirHandle;
    try { dirHandle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'hx-image-renamer' }); } catch (e) { return; }
    const pack = S.pack, name = `Amazon images ${stamp()}` + (pack === 'folders' ? ' in folders' : pack === 'styles' ? ' by style' : '');
    setBusy(true, 'Saving…');
    try {
      const out = await dirHandle.getDirectoryHandle(name, { create: true });
      const items = S.plan.items, handles = new Map([['', out]]), p = prog('Saving photo');
      for (let i = 0; i < items.length; i++) {
        const path = pathFor(items[i].p, items[i].x, pack, true).split('/');
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
      ui.status.textContent = `Saved ${many(items.length, 'photo', 'photos')} into the folder “${name}”.` + (pack === 'folders' ? ' ' + AFTER_FOLDERS : '');
      track('save_folder', { photos: items.length, pack });
      askFeedback();
    } catch (e) {
      console.error(e); ui.status.textContent = 'Saving stopped: ' + (e && e.message ? e.message : 'please try again') + '.';
    } finally { setBusy(false); }
  }

  function report() {
    if (!S.plan) return;
    const rows = [['Style', 'Colour', 'Size', 'ASIN', 'Photo folder', 'Photos', 'Status', 'New file names']];
    S.plan.products.forEach(p => rows.push([p.style, p.colour, p.size, p.id, p.dir || '', p.files ? p.files.length : 0,
      p.problems.length ? 'Problem: ' + p.problems.join('; ') : (p.files && p.files.length ? 'Ready' : 'No photos'),
      (p.files || []).map(x => x.out).join(' ')]));
    const cell = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
    download(new Blob(['\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), `image-renamer-report-${stamp()}.csv`);
    track('download_report', {});
  }
  function askFeedback() { if (window.hxFeedback) setTimeout(() => window.hxFeedback.ask('Image Renamer'), 2000); }
  function track(name, params) { try { if (window.track) window.track(name, params); } catch (e) { /* stats off */ } }

  // ------------------------------------------------------------------ example: two styles that share a colour
  const EX_WHITE = ['White', '#f4f4f2', '#d9d9d6'], EX_BLACK = ['Black', '#26282c', '#3a3d43'], EX_NAVY = ['Navy', '#1f2f5a', '#2c3f73'];
  const EX_STYLES = [['Style 1', 'T-shirt', [EX_WHITE, EX_BLACK]], ['Style 2', 'Long sleeve', [EX_BLACK, EX_NAVY]]];
  const EX_SIZES = ['S', 'M', 'L', 'XL'];
  const EX_CODES = ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05'];
  function exampleList() {
    let k = 1;
    return ['Style\tColour\tSize\tASIN'].concat(EX_STYLES.flatMap(([style, , colours]) =>
      colours.flatMap(([c]) => EX_SIZES.map(s => `${style}\t${c}\t${s}\tB0EXAMP${String(k++).padStart(3, '0')}`)))).join('\n');
  }
  async function examplePhotos() {
    const out = [];
    for (const [style, kind, colours] of EX_STYLES) {
      for (const [name, fill, line] of colours) {
        for (const code of EX_CODES) {
          const cv = document.createElement('canvas'); cv.width = cv.height = 1200;
          const c = cv.getContext('2d');
          c.fillStyle = '#ffffff'; c.fillRect(0, 0, 1200, 1200);
          c.save(); c.translate(600, 640); const sc = code === 'MAIN' ? 1 : 0.8; c.scale(sc, sc);
          c.fillStyle = fill; c.strokeStyle = line; c.lineWidth = 10; c.lineJoin = 'round';
          c.beginPath();
          if (kind === 'Long sleeve') {
            c.moveTo(-170, -330); c.lineTo(-400, -250); c.lineTo(-480, 300); c.lineTo(-370, 315); c.lineTo(-250, -40); c.lineTo(-250, 380);
            c.lineTo(250, 380); c.lineTo(250, -40); c.lineTo(370, 315); c.lineTo(480, 300); c.lineTo(400, -250); c.lineTo(170, -330);
          } else {
            c.moveTo(-170, -330); c.lineTo(-420, -230); c.lineTo(-340, -40); c.lineTo(-250, -80); c.lineTo(-250, 380);
            c.lineTo(250, 380); c.lineTo(250, -80); c.lineTo(340, -40); c.lineTo(420, -230); c.lineTo(170, -330);
          }
          c.quadraticCurveTo(0, -200, -170, -330); c.closePath(); c.fill(); c.stroke();
          c.restore();
          if (code !== 'MAIN') {
            c.fillStyle = '#3d6bff'; c.font = '700 64px system-ui, sans-serif'; c.fillText(code, 60, 110);
            c.fillStyle = '#5b6782'; c.font = '500 40px system-ui, sans-serif'; c.fillText(`${style} · ${name} ${kind.toLowerCase()}`, 60, 170);
          }
          const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
          out.push({ file: new File([blob], `photo.${code}.jpg`, { type: 'image/jpeg' }), path: `Example photos/${style}/${name}/photo.${code}.jpg` });
        }
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
  $('#listHint').addEventListener('click', e => {
    const b = e.target.closest('[data-fill]'); if (!b) return;
    S.oneStyle = b.dataset.fill === 'fix';
    renderList();
    if (S.files.length) ui.status.textContent = 'List changed: check again.';
  });
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
    S.opts[k] = el.type === 'checkbox' ? el.checked : el.value;
    if (S.plan) { S.plan = null; processed.clear(); $('#result').hidden = true; ui.status.textContent = 'Options changed: check again.'; }
    refresh();
  }));
  // The download choice only changes how the checked files are packed, so the check stays
  $$('[name=pack]').forEach(r => r.addEventListener('change', () => {
    S.pack = $('[name=pack]:checked').value;
    renderPack();
    if (S.plan && !S.busy) ui.status.textContent = 'Check done. Ready to download.';
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
    download(new Blob(['\uFEFF' + exampleList().replace(/\t/g, ',') + '\r\n'], { type: 'text/csv;charset=utf-8' }), 'image-renamer-example-list.csv');
  });

  renderList(); renderFolder(); refresh();
  root.classList.add('ready');
})();
