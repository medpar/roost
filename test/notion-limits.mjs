// Assertions mirroring Notion API request limits, used by tests and the mock API.
import assert from 'node:assert/strict';

export function validateRichText(arr, where) {
  assert.ok(Array.isArray(arr), `${where}: rich_text must be an array`);
  assert.ok(arr.length <= 100, `${where}: ${arr.length} rich text items (max 100)`);
  for (const r of arr) {
    assert.equal(r.type, 'text', `${where}: unexpected rich text type`);
    assert.ok(r.text.content.length <= 2000, `${where}: text content ${r.text.content.length} chars (max 2000)`);
    if (r.text.link) assert.match(r.text.link.url, /^https?:\/\//, `${where}: bad link`);
  }
}

export function validateBlocks(blocks, depth = 1, where = 'blocks') {
  assert.ok(blocks.length <= 100, `${where}: ${blocks.length} children (max 100 per request)`);
  for (const b of blocks) {
    const body = b[b.type];
    assert.ok(body, `${where}: block ${b.type} has no body`);
    if (body.rich_text) validateRichText(body.rich_text, `${where}.${b.type}`);
    if (body.caption) validateRichText(body.caption, `${where}.${b.type}.caption`);
    if (body.children) {
      assert.ok(depth < 2, `${where}: nesting deeper than 2 levels in one request (${b.type})`);
      validateBlocks(body.children, depth + 1, `${where}.${b.type}`);
    }
    if (b.type === 'bookmark') assert.match(body.url, /^https?:\/\//);
    if (b.type === 'image' || b.type === 'video') assert.ok(body.file_upload?.id || body.external?.url, `${where}: media without source`);
  }
}

export function validateProperties(props, schema) {
  for (const [name, v] of Object.entries(props)) {
    const def = schema?.[name];
    if (schema) assert.ok(def, `unknown property ${name}`);
    const type = Object.keys(v)[0];
    if (def) assert.ok(def[type] !== undefined, `property ${name}: type ${type} does not match schema`);
    if (type === 'title' || type === 'rich_text') validateRichText(v[type], `prop ${name}`);
    if (type === 'select' && v.select) assert.ok(!v.select.name.includes(','), `select ${name} contains a comma`);
    if (type === 'multi_select') for (const o of v.multi_select) assert.ok(!o.name.includes(','), `multi_select ${name} contains a comma`);
    if (type === 'url' && v.url) assert.match(v.url, /^https?:\/\//);
  }
}
