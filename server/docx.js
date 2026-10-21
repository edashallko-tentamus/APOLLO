// Minimal Word (.docx) writer, no npm packages (a .docx file is a zip of XML parts; the zip comes from xlsx.js).
// Enough for a controlled document: title, headings, paragraphs with bold or coloured runs, tables with a shaded header
// row, PNG images with captions, page breaks, a landscape Letter page, and a footer with "Page X of Y".
'use strict';
const { zip } = require('./xlsx');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
const PAGE = { w: 15840, h: 12240, margin: 720 };   // Letter, landscape, half-inch margins (twips)
const USABLE_W = PAGE.w - 2 * PAGE.margin;

function run(r) {
  if (typeof r === 'string') r = { text: r };
  const p = [];
  if (r.bold) p.push('<w:b/>');
  if (r.italic) p.push('<w:i/>');
  if (r.color) p.push(`<w:color w:val="${r.color}"/>`);
  if (r.size) p.push(`<w:sz w:val="${Math.round(r.size * 2)}"/><w:szCs w:val="${Math.round(r.size * 2)}"/>`);
  if (r.mono) p.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
  const lines = String(r.text ?? '').split('\n');
  return `<w:r>${p.length ? `<w:rPr>${p.join('')}</w:rPr>` : ''}${lines.map((l, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(l)}</w:t>`).join('')}</w:r>`;
}
function para(runs, { style, align, spaceAfter, keepNext, breakBefore } = {}) {
  const pp = [];
  if (style) pp.push(`<w:pStyle w:val="${style}"/>`);
  if (keepNext) pp.push('<w:keepNext/>');
  if (breakBefore) pp.push('<w:pageBreakBefore/>');
  if (spaceAfter !== undefined) pp.push(`<w:spacing w:after="${spaceAfter}"/>`);
  if (align) pp.push(`<w:jc w:val="${align}"/>`);
  const rs = (Array.isArray(runs) ? runs : [runs]).map(run).join('');
  return `<w:p>${pp.length ? `<w:pPr>${pp.join('')}</w:pPr>` : ''}${rs}</w:p>`;
}

function docx() {
  const body = []; const images = [];
  const api = {
    title(text, sub) { body.push(para([{ text, bold: true, size: 20, color: '1F3A2C' }], { spaceAfter: 60 })); if (sub) body.push(para([{ text: sub, size: 11, color: '5C6773' }], { spaceAfter: 200 })); return api; },
    h1(text, o = {}) { body.push(para(text, { style: 'Heading1', keepNext: true, breakBefore: o.newPage })); return api; },
    h2(text, o = {}) { body.push(para(text, { style: 'Heading2', keepNext: true, breakBefore: o.newPage })); return api; },
    p(runs, opts) { body.push(para(runs, opts)); return api; },
    pageBreak() { body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'); return api; },
    // rows: arrays of cells; a cell is a string, a run object, or an array of runs. widths: fractions of the page width
    table(rows, { widths, header = true, size = 8, fill } = {}) {
      const n = Math.max(...rows.map((r) => r.length));
      const ws = (widths || Array(n).fill(1 / n)).map((f) => Math.round(f * USABLE_W));
      const cell = (c, i, isHead, shade) => {
        const runs = (Array.isArray(c) ? c : [c]).map((x) => (typeof x === 'object' && x !== null ? { size, ...x, bold: x.bold || isHead } : { text: x, size, bold: isHead }));
        return `<w:tc><w:tcPr><w:tcW w:w="${ws[i]}" w:type="dxa"/>${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}</w:tcPr>${para(runs, { spaceAfter: 0 })}</w:tc>`;
      };
      const trs = rows.map((r, ri) => {
        const isHead = header && ri === 0;
        const shade = isHead ? 'E6ECEF' : fill ? fill(r, ri) : null;
        return `<w:tr>${isHead ? '<w:trPr><w:tblHeader/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>'}${r.map((c, i) => cell(c, i, isHead, shade)).join('')}</w:tr>`;
      }).join('');
      body.push(`<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblW w:w="${USABLE_W}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${ws.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${trs}</w:tbl>`);
      body.push(para('', { spaceAfter: 120 }));
      return api;
    },
    // a PNG scaled to fit the box (inches), keeping its proportions
    image(png, { width, height, maxW = 9.6, maxH = 6.2 } = {}) {
      const w = width || png.readUInt32BE(16); const h = height || png.readUInt32BE(20);
      const k = Math.min(maxW / (w / 96), maxH / (h / 96), 1);
      const cx = Math.round((w / 96) * k * 914400); const cy = Math.round((h / 96) * k * 914400);
      const n = images.length + 1; images.push(png);
      body.push(`<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="60"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Evidence ${n}"/>`
        + '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>'
        + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}.png"/><pic:cNvPicPr/></pic:nvPicPr>`
        + `<pic:blipFill><a:blip r:embed="rImg${n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
        + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`
        + '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>');
      return api;
    },
    build({ footer = '', author = '' } = {}) {
      const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        + 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
      const sect = `<w:sectPr><w:footerReference w:type="default" r:id="rFooter"/><w:pgSz w:w="${PAGE.w}" w:h="${PAGE.h}" w:orient="landscape"/>`
        + `<w:pgMar w:top="${PAGE.margin}" w:right="${PAGE.margin}" w:bottom="${PAGE.margin}" w:left="${PAGE.margin}" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>`;
      const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body.join('')}${sect}</w:body></w:document>`;
      const fld = (code) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
      const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="${USABLE_W}"/></w:tabs><w:rPr><w:sz w:val="16"/></w:rPr></w:pPr>`
        + `${run({ text: footer, size: 8, color: '5C6773' })}<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:tab/><w:t xml:space="preserve">Page </w:t></w:r>${fld('PAGE')}<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve"> of </w:t></w:r>${fld('NUMPAGES')}</w:p></w:ftr>`;
      const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
        + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault>'
        + '<w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
        + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
        + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3A2C"/><w:sz w:val="28"/></w:rPr></w:style>'
        + '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/></w:rPr></w:style>'
        + '<w:style w:type="table" w:styleId="Grid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>'
        + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="BFC7CE"/>`).join('')
        + '</w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>';
      const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + '<Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        + '<Relationship Id="rFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
        + images.map((_, i) => `<Relationship Id="rImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i + 1}.png"/>`).join('')
        + '</Relationships>';
      const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
        + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        + '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
        + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
      const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        + `<dc:title>${esc(footer)}</dc:title><dc:creator>${esc(author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`;
      const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';
      return zip([
        { name: '[Content_Types].xml', data: types }, { name: '_rels/.rels', data: rootRels }, { name: 'docProps/core.xml', data: core },
        { name: 'word/document.xml', data: document }, { name: 'word/styles.xml', data: styles }, { name: 'word/footer1.xml', data: footerXml },
        { name: 'word/_rels/document.xml.rels', data: rels },
        ...images.map((b, i) => ({ name: `word/media/image${i + 1}.png`, data: b })),
      ]);
    },
  };
  return api;
}

module.exports = { docx };
