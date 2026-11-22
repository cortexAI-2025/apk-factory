// Regression (CI run 45012681180, HTTP Docker native): AAB metadata was scraped from printable
// bytes of the protobuf manifest and came back as `com.apkfactory.reference"K` / `1.0(`
// (the next field's tag and length byte). The manifest is now decoded as protobuf.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAabManifest } = require('../../e2e/aab-manifest.cjs');

// minimal protobuf encoder for the aapt.pb.XmlNode shapes the parser reads
const varint = (n) => { const o = []; while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); } o.push(n); return Buffer.from(o); };
const ld = (field, buf) => Buffer.concat([varint(field * 8 + 2), varint(buf.length), buf]);
const str = (field, s) => ld(field, Buffer.from(s));
const attr = (name, value) => Buffer.concat([
  str(1, 'http://schemas.android.com/apk/res/android'), str(2, name), str(3, value),
  ld(4, Buffer.concat([str(1, 'AndroidManifest.xml'), ld(2, Buffer.from([8, 3, 16, 5]))])), // source (a message: its tag follows the value)
  Buffer.from([40, 1]), // resource_id varint
]);
const manifest = (attrs) => ld(1, Buffer.concat([str(2, ''), str(3, 'manifest'), ...attrs.map(([k, v]) => ld(4, attr(k, v))), ld(5, ld(1, str(3, 'application')))]));

test('reads package, versionName and versionCode without trailing protobuf bytes', () => {
  const m = parseAabManifest(manifest([['package', 'com.apkfactory.reference'], ['versionCode', '1'], ['versionName', '1.0']]));
  assert.deepEqual(m, { package: 'com.apkfactory.reference', versionName: '1.0', versionCode: '1' });
});

test('the old printable-bytes scraper really produced the CI symptom on this layout', () => {
  const buf = manifest([['package', 'com.apkfactory.reference']]);
  const strings = []; let cur = '';
  for (const b of buf) { if (b >= 0x20 && b <= 0x7e) cur += String.fromCharCode(b); else { if (cur.length >= 2) strings.push(cur); cur = ''; } }
  const i = strings.indexOf('package');
  assert.notEqual(strings[i + 1], 'com.apkfactory.reference'); // value fused with the next field's tag bytes
});

test('rejects garbage and non-manifest roots', () => {
  assert.throws(() => parseAabManifest(Buffer.from('not protobuf at all')));
  assert.throws(() => parseAabManifest(ld(1, str(3, 'application'))), /expected "manifest"/);
});
