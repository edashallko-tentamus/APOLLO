// Minimal Excel (.xlsx) writer and reader, no npm packages (an .xlsx file is a zip of XML parts; Node's zlib
// does the compression). Writes one sheet with a bold, frozen header row. Reads the first sheet of any workbook
// saved by Excel (shared or inline strings, numbers, booleans; date cells come back as Excel serial numbers),
// and also reads CSV.
'use strict';
const zlib = require('zlib');

// ---------------------------------------------------------------- zip
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

function zip(files) { // files: [{ name, data: Buffer|string }]
  const locals = []; const centrals = []; let offset = 0;
  for (const f of files) {
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(data); const name = Buffer.from(f.name, 'utf8'); const crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function unzip(buf) { // -> Map(name -> Buffer)
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('This file is not an Excel workbook (.xlsx) or CSV file');
  const count = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const out = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The Excel file is damaged');
    const method = buf.readUInt16LE(p + 10); const csize = buf.readUInt32LE(p + 20); const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30); const clen = buf.readUInt16LE(p + 32); const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.slice(start, start + csize);
    out.set(name, method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : Buffer.alloc(0));
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

// ---------------------------------------------------------------- xml helpers
const escX = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
const unX = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, g) => {
  const k = g.toLowerCase(); if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'quot') return '"'; if (k === 'apos') return "'";
  return String.fromCodePoint(k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
});
const colName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const colIndex = (ref) => { const letters = ref.replace(/\d+/g, ''); let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

// ---------------------------------------------------------------- write
// headers: [text], rows: [[value]] (numbers stay numbers; everything else is text); widths: [chars]
function writeXlsx({ sheetName = 'Sheet1', headers, rows, widths = [] }) {
  const cell = (v, r, c, style) => {
    const ref = colName(c) + (r + 1);
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
    if (typeof v === 'boolean') return `<c r="${ref}" t="inlineStr"${style}><is><t>${v ? 'Yes' : 'No'}</t></is></c>`;
    return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${escX(v)}</t></is></c>`;
  };
  const rowXml = (vals, r, style = '') => `<row r="${r + 1}">${vals.map((v, c) => cell(v, r, c, style)).join('')}</row>`;
  const cols = headers.map((h, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(8, widths[i] || String(h).length + 4))}" customWidth="1"/>`).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols><sheetData>${rowXml(headers, 0, ' s="1"')}${rows.map((r, i) => rowXml(r, i + 1)).join('')}</sheetData>
<autoFilter ref="A1:${colName(Math.max(0, headers.length - 1))}${rows.length + 1}"/></worksheet>`;
  const safeName = escX(String(sheetName).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  return zip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${safeName.replace(/'/g, "''")}'!$A$1:$${colName(Math.max(0, headers.length - 1))}$${rows.length + 1}</definedName></definedNames></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7F5EE"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>` },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
}


// ---------------------------------------------------------------- a workbook of several sheets (0.35.0: the finance report)
// sheets: [{ name, rows: [[cell]], widths: [chars], freeze: rows to keep at the top, filter: true (an AutoFilter on row 1) }]
// a cell is a plain value, or { v, s, f }: s = a style name (STYLE below), f = a formula (written with v as its last value,
// so the file shows numbers even where formulas are not recalculated); { d: 'YYYY-MM-DD' } or { dt: ISO } is a date
const STYLE = { normal: 0, head: 1, title: 2, money: 3, pct: 4, bold: 5, note: 6, moneyb: 7, pctb: 8, int: 9, sub: 10, date: 11, intb: 12, dec: 13, datetime: 14, decb: 15, money0: 16, money0b: 17 };
const serial = (iso) => { const t = Date.parse(iso.length === 10 ? iso + 'T00:00:00Z' : iso); return Number.isFinite(t) ? t / 864e5 + 25569 : null; };
function writeWorkbook({ sheets }) {
  const cellXml = (raw, r, c) => {
    const ref = colName(c) + (r + 1);
    const o = raw !== null && typeof raw === 'object' && !(raw instanceof Date) ? raw : { v: raw };
    let { v } = o; let s = STYLE[o.s] || 0;
    if (o.d !== undefined || o.dt !== undefined) {
      const iso = o.d !== undefined ? o.d : o.dt;
      v = iso ? serial(String(iso)) : null; s = STYLE[o.s] || (o.d !== undefined ? STYLE.date : STYLE.datetime);
      if (v === null) return '';
      v = o.d !== undefined ? Math.round(v) : Math.round(v * 86400) / 86400;
    }
    const st = s ? ` s="${s}"` : '';
    if (o.f) {
      const cached = typeof v === 'number' && Number.isFinite(v) ? `<v>${v}</v>` : (v === null || v === undefined || v === '' ? '' : `<v>${escX(v)}</v>`);
      return `<c r="${ref}"${st}${typeof v === 'string' && v !== '' ? ' t="str"' : ''}><f>${escX(o.f)}</f>${cached}</c>`;
    }
    if (v === null || v === undefined || v === '') return s ? `<c r="${ref}"${st}/>` : '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
    if (typeof v === 'boolean') return `<c r="${ref}" t="inlineStr"${st}><is><t>${v ? 'Yes' : 'No'}</t></is></c>`;
    return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${escX(v)}</t></is></c>`;
  };
  const names = sheets.map((sh) => String(sh.name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  const files = [];
  sheets.forEach((sh, i) => {
    const width = Math.max(1, ...sh.rows.map((r) => r.length));
    const cols = Array.from({ length: width }, (_, c) => `<col min="${c + 1}" max="${c + 1}" width="${Math.min(60, Math.max(6, (sh.widths || [])[c] || 12))}" customWidth="1"/>`).join('');
    const pane = sh.freeze ? `<pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze + 1}" activePane="bottomLeft" state="frozen"/>` : '';
    const data = sh.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cellXml(v, ri, ci)).join('')}</row>`).join('');
    const filter = sh.filter && sh.rows.length ? `<autoFilter ref="A1:${colName(width - 1)}${sh.rows.length}"/>` : '';
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${i === 0 ? ' tabSelected="1"' : ''}${sh.grid === false ? ' showGridLines="0"' : ''}>${pane}</sheetView></sheetViews>
<cols>${cols}</cols><sheetData>${data}</sheetData>${filter}</worksheet>` });
  });
  const defined = sheets.map((sh, i) => (sh.filter && sh.rows.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${escX(names[i]).replace(/'/g, "''")}'!$A$1:$${colName(Math.max(1, ...sh.rows.map((r) => r.length)) - 1)}$${sh.rows.length}</definedName>` : '')).join('');
  return zip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${escX(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
${defined ? `<definedNames>${defined}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="6"><numFmt numFmtId="169" formatCode="&quot;$&quot;#,##0"/><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/><numFmt numFmtId="166" formatCode="yyyy-mm-dd"/><numFmt numFmtId="167" formatCode="0.0"/><numFmt numFmtId="168" formatCode="yyyy-mm-dd hh:mm"/></numFmts>
<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><color rgb="FF14532D"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF5B6770"/><name val="Calibri"/></font><font><b/><sz val="12"/><color rgb="FF14532D"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7F5EE"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF5B6770"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="18">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment wrapText="0"/></xf>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="169" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="169" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
</cellXfs></styleSheet>` },
    ...files,
  ]);
}

// ---------------------------------------------------------------- read
// Returns { headers: [text], rows: [{ __row: n, [header]: value }] } from the first sheet (or a CSV file)
function readTable(buf, fileName = '') {
  if (/\.csv$/i.test(fileName) || (buf.length && buf[0] !== 0x50)) return toObjects(parseCsv(buf.toString('utf8').replace(/^﻿/, '')));
  const files = unzip(buf);
  const get = (n) => { const b = files.get(n); return b ? b.toString('utf8') : null; };
  const wb = get('xl/workbook.xml'); if (!wb) throw new Error('This file is not an Excel workbook (.xlsx)');
  const rid = (wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/) || [])[1];
  const rels = get('xl/_rels/workbook.xml.rels') || '';
  let target = 'worksheets/sheet1.xml';
  if (rid) { const m = rels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`)) || rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`)); if (m) target = m[1]; }
  const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  const sheet = get(path); if (!sheet) throw new Error('The first sheet of the workbook could not be read');
  const shared = [];
  const ss = get('xl/sharedStrings.xml');
  if (ss) for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) || []) shared.push(unX((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<t[^>]*>|<\/t>/g, '')).join('')));
  const grid = [];
  for (const row of sheet.match(/<row\b[\s\S]*?<\/row>|<row\b[^>]*\/>/g) || []) {
    const r = Number((row.match(/\br="(\d+)"/) || [])[1]) - 1; const vals = [];
    for (const c of row.match(/<c\b[^>]*\/>|<c\b[\s\S]*?<\/c>/g) || []) {
      const ref = (c.match(/\br="([A-Z]+\d+)"/) || [])[1]; const t = (c.match(/\bt="(\w+)"/) || [])[1];
      const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = null;
      if (t === 's') val = shared[Number(v)] ?? null;
      else if (t === 'inlineStr') val = unX((c.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((x) => x.replace(/<t[^>]*>|<\/t>/g, '')).join(''));
      else if (t === 'b') val = v === '1';
      else if (t === 'str' || t === 'e') val = v === undefined ? null : unX(v);
      else if (v !== undefined) val = Number(v);
      if (ref) vals[colIndex(ref)] = val;
    }
    grid[r] = vals;
  }
  return toObjects(grid.map((x) => x || []));
}
function toObjects(grid) {
  const hi = grid.findIndex((r) => r && r.some((v) => v !== null && v !== undefined && String(v).trim() !== ''));
  if (hi < 0) return { headers: [], rows: [] };
  const headers = grid[hi].map((h) => (h === null || h === undefined ? '' : String(h).trim()));
  const rows = [];
  for (let i = hi + 1; i < grid.length; i++) {
    const r = grid[i] || []; if (!r.some((v) => v !== null && v !== undefined && String(v).trim() !== '')) continue;
    const o = { __row: i + 1 }; headers.forEach((h, j) => { if (h) o[h] = r[j] === undefined ? null : r[j]; }); rows.push(o);
  }
  return { headers: headers.filter(Boolean), rows };
}
function parseCsv(text) {
  const out = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); out.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); out.push(row); }
  return out.map((r) => r.map((v) => (v === '' ? null : v)));
}
// Excel stores dates as days since 1899-12-30
function serialToDate(n) { const d = new Date(Math.round((n - 25569) * 864e5)); return d.toISOString().slice(0, 10); }

module.exports = { writeXlsx, writeWorkbook, colName, readTable, serialToDate, zip, unzip };
