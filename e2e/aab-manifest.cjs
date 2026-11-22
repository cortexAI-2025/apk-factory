// Reads package / versionName / versionCode from the protobuf-encoded base/manifest/AndroidManifest.xml
// of an AAB (aapt.pb.XmlNode). Replaces a printable-bytes scraper that swallowed the next field's
// tag and length byte ("com.apkfactory.reference\"K", "1.0(").
//   XmlNode{ element=1 | text=2 }  XmlElement{ name=3, attribute=4*, child=5* }
//   XmlAttribute{ name=2, value=3 }
'use strict';

function readVarint(buf, pos) {
  let result = 0, shift = 0;
  for (;;) {
    if (pos >= buf.length) throw new Error('truncated varint');
    const b = buf[pos++];
    result += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) return [result, pos];
    shift += 7;
    if (shift > 63) throw new Error('varint too long');
  }
}

/** Returns Map<fieldNumber, Buffer[]> for length-delimited fields; skips the other wire types. */
function fields(buf) {
  const out = new Map();
  let pos = 0;
  while (pos < buf.length) {
    let tag; [tag, pos] = readVarint(buf, pos);
    const field = Math.floor(tag / 8), wire = tag % 8;
    if (wire === 0) { [, pos] = readVarint(buf, pos); }
    else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else if (wire === 2) {
      let len; [len, pos] = readVarint(buf, pos);
      if (pos + len > buf.length) throw new Error('truncated field');
      if (!out.has(field)) out.set(field, []);
      out.get(field).push(buf.subarray(pos, pos + len));
      pos += len;
    } else throw new Error(`unsupported wire type ${wire}`);
  }
  return out;
}

function attributes(element) {
  const attrs = {};
  for (const a of fields(element).get(4) || []) {
    const f = fields(a);
    const name = f.get(2)?.[0]?.toString('utf8');
    if (name) attrs[name] = f.get(3)?.[0]?.toString('utf8') ?? '';
  }
  return attrs;
}

function parseAabManifest(buf) {
  const root = fields(buf).get(1)?.[0]; // XmlNode.element
  if (!root) throw new Error('not an AAB manifest: no root element');
  const name = fields(root).get(3)?.[0]?.toString('utf8');
  if (name !== 'manifest') throw new Error(`root element is "${name}", expected "manifest"`);
  const a = attributes(root);
  return { package: a.package || '', versionName: a.versionName || '', versionCode: a.versionCode || '' };
}

module.exports = { parseAabManifest };
