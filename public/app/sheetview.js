// The third view: one room laid out as a Room Data Sheet, following the
// Communities and Justice Workplace Design Guidelines template.
//
// The template's rows are held here as data rather than markup, so the same
// definition drives the on-screen sheet and the Word export and the two cannot
// drift apart. Each row names a column by its label; a project that hasn't got
// that column shows the row empty, exactly as the blank template does.
import { state, effectiveValue, visibleRows } from './state.js';
import { esc, normHeader, toast } from './util.js';

const SHEET = [
  { kind: 'field', label: 'Revision' },
  { kind: 'field', label: 'Issue Date' },
  { kind: 'field', label: 'Area' },
  { kind: 'field', label: 'Occupancy' },
  { kind: 'field', label: 'Metric / Density' },
  { kind: 'field', label: 'Space type', column: 'Space Type' },
  { kind: 'field', label: 'Spatial Adjacencies' },
  { kind: 'field', label: 'Acoustic Specification', note: 'Refer to Room Layout Sheet' },
  { kind: 'field', label: 'Door Types', note: 'Refer to Room Layout Sheet' },
  { kind: 'field', label: 'Partitions', note: 'Refer to Room Layout Sheet' },
  { kind: 'field', label: 'Finishes', note: 'Refer to Typical Finishes Schedule' },
  { kind: 'field', label: 'Furniture', note: 'Refer to Typical Furniture Schedule' },
  { kind: 'field', label: 'Joinery', note: 'Refer to Room Layout Sheet for Joinery details' },
  { kind: 'field', label: 'Fittings, Fixtures & Equipment', note: 'Refer to Typical FF&E Schedule' },
  {
    kind: 'group', label: 'Services Specification',
    items: ['Lighting Control', 'Dimming', 'Room Booking Panel', 'Hearing Augmentation'],
  },
  {
    kind: 'group', label: 'Security Specification', note: 'Refer to Workplace Security Specification',
    values: ['Privacy Level', 'Security Level'],
    items: ['Duress alarms', 'Airlock', 'CCTV', 'Swipe card access'],
  },
  {
    kind: 'group', label: 'Technology Specification', note: 'Refer to Workplace Technology Specification',
    items: ['Monitors', 'AV display screens', 'Printer', 'Scanner', 'Phone', 'Soft phone'],
  },
  { kind: 'field', label: 'Signage Specification', note: 'Refer to Workplace Signage Guidelines' },
  { kind: 'field', label: 'Artwork Requirement', note: 'Refer to Workplace Design Guidelines' },
  { kind: 'field', label: 'Ergonomic Specification', note: 'Refer to Workplace Design Guidelines' },
  {
    kind: 'group', label: 'Accessibility & WHS', note: 'Refer to Workplace Design Guidelines',
    items: ['DDA accessibility required'],
  },
];

const byLabel = () => {
  const m = new Map();
  state.fields.forEach(f => m.set(normHeader(f.label), f));
  return m;
};

const fieldFor = (map, label) => map.get(normHeader(label)) || null;

// The value a room shows for a column, inheritance included, or '' if the
// project hasn't got that column at all.
function valueOf(room, map, label) {
  const f = fieldFor(map, label);
  if (!f) return { text: '', field: null };
  const eff = effectiveValue(room, f);
  return { text: eff.value ?? '', field: f, overridden: !!eff.overridden };
}

const ticked = v => v === 'true' || /^(y|yes|true|1)$/i.test(String(v || ''));

export function roomTitle(room) {
  const map = byLabel();
  const num = valueOf(room, map, 'Number').text || valueOf(room, map, 'Room ID').text;
  const name = valueOf(room, map, 'Name').text;
  return [num, name].filter(Boolean).join(' – ') || 'Untitled room';
}

// ---------- on screen ----------

export function sheetHTML(room) {
  const map = byLabel();
  const sub = valueOf(room, map, 'Comments').text;

  const rows = SHEET.map(row => {
    if (row.kind === 'field') {
      const v = valueOf(room, map, row.column || row.label);
      return `<tr>
        <th>${esc(row.label)}${row.note ? `<small>${esc(row.note)}</small>` : ''}</th>
        <td class="${v.overridden ? 'ovr' : ''}">${esc(v.text)}</td></tr>`;
    }
    const vals = (row.values || []).map(l => {
      const v = valueOf(room, map, l);
      return `<span class="lv"><b>${esc(l)}</b> ${esc(v.text) || '—'}</span>`;
    }).join('');
    const boxes = row.items.map(l => {
      const v = valueOf(room, map, l);
      return `<span class="box">${ticked(v.text) ? '☑' : '☐'} ${esc(l)}</span>`;
    }).join('');
    return `<tr>
      <th>${esc(row.label)}${row.note ? `<small>${esc(row.note)}</small>` : ''}</th>
      <td>${vals}${boxes}</td></tr>`;
  }).join('');

  return `<div class="rds-flow" id="rds-flow">
    <header class="rds-head">
      <span>Communities and Justice — Workplace Design Guidelines, Room Data Sheets</span>
    </header>
    <h1>${esc(roomTitle(room))}</h1>
    ${sub ? `<p class="rds-sub">${esc(sub)}</p>` : '<p class="rds-sub muted">No description yet.</p>'}
    <table class="rds-table">${rows}</table>
  </div>`;
}

export const sheetIndex = () => {
  const n = sheetRooms().length;
  return n ? Math.min(Math.max(0, state.sheetAt | 0), n - 1) : 0;
};
export const sheetRoom = () => sheetRooms()[sheetIndex()] || null;
export function stepSheet(by) {
  const n = sheetRooms().length;
  if (!n) return;
  state.sheetAt = (sheetIndex() + by + n) % n;
}

// Which rooms the view is showing: the selection if there is one, else all of
// them in the order the Instance sheet has them.
export function sheetRooms() {
  const rows = visibleRows();
  if (!state.selected.size) return rows;
  const picked = rows.filter(r => state.selected.has(r.id));
  return picked.length ? picked : rows;
}

// ---------- Word export ----------
//
// A .docx is a zip of XML. Word accepts stored (uncompressed) entries, so the
// whole file can be built here without a zip library and without a build step.

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zip(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  const u16 = n => [n & 0xFF, (n >>> 8) & 0xFF];
  const u32 = n => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

  for (const [name, text] of files) {
    const nameBytes = enc.encode(name), data = enc.encode(text);
    const crc = crc32(data);
    const local = [...u32(0x04034B50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0)];
    chunks.push(new Uint8Array(local), nameBytes, data);
    central.push([[...u32(0x02014B50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length),
      ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)], nameBytes]);
    offset += local.length + nameBytes.length + data.length;
  }

  const dirParts = [];
  let dirSize = 0;
  for (const [head, nameBytes] of central) {
    dirParts.push(new Uint8Array(head), nameBytes);
    dirSize += head.length + nameBytes.length;
  }
  const end = new Uint8Array([...u32(0x06054B50), ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length), ...u32(dirSize), ...u32(offset), ...u16(0)]);
  return new Blob([...chunks, ...dirParts, end], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

const xmlEsc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const para = (text, opts = {}) => `<w:p><w:pPr>${opts.style ? `<w:pStyle w:val="${opts.style}"/>` : ''}${
  opts.after ? `<w:spacing w:after="${opts.after}"/>` : ''}</w:pPr>${
  String(text ?? '').split('\n').filter(Boolean).map((line, i) =>
    `<w:r>${opts.bold ? '<w:rPr><w:b/></w:rPr>' : ''}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEsc(line)}</w:t></w:r>`,
  ).join('') || '<w:r><w:t/></w:r>'}</w:p>`;

const cell = (widthDxa, inner) =>
  `<w:tc><w:tcPr><w:tcW w:w="${widthDxa}" w:type="dxa"/></w:tcPr>${inner}</w:tc>`;

function roomXml(room, map, last) {
  const sub = valueOf(room, map, 'Comments').text;
  const rows = SHEET.map(row => {
    let right;
    if (row.kind === 'field') {
      right = para(valueOf(room, map, row.column || row.label).text);
    } else {
      const vals = (row.values || [])
        .map(l => `${l}: ${valueOf(room, map, l).text || '—'}`).join('\n');
      const boxes = row.items
        .map(l => `${ticked(valueOf(room, map, l).text) ? '☒' : '☐'} ${l}`).join('\n');
      right = para([vals, boxes].filter(Boolean).join('\n'));
    }
    const label = row.note ? `${row.label}\n${row.note}` : row.label;
    return `<w:tr>${cell(3200, para(label, { bold: true }))}${cell(6160, right)}</w:tr>`;
  }).join('');

  return para(roomTitle(room), { style: 'Heading1' })
    + para(sub || '')
    + `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders>${
      ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
        .map(s => `<w:${s} w:val="single" w:sz="4" w:color="BFBFBF"/>`).join('')
    }</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="3200"/><w:gridCol w:w="6160"/></w:tblGrid>${rows}</w:tbl>`
    + (last ? '' : '<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
}

// Split out from the download so the bytes can be checked directly, without a
// file dialog in the way.
export function buildDocx(rooms) {
  const map = byLabel();
  const body = rooms.map((r, i) => roomXml(r, map, i === rooms.length - 1)).join('');

  const files = [
    ['[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`],
    ['_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`],
    ['word/_rels/document.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`],
    ['word/styles.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
</w:styles>`],
    ['word/document.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708"/></w:sectPr>
</w:body></w:document>`],
  ];

  return zip(files);
}

export function exportDocx(rooms) {
  if (!rooms.length) return toast('No rooms to export', true);
  const name = `${(state.project?.name || 'Room data').replace(/[^\w-]+/g, '_')}_room_data_sheets.docx`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(buildDocx(rooms));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Exported ${rooms.length} room${rooms.length === 1 ? '' : 's'} to ${name}`);
}
