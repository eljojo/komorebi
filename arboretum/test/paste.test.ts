import { describe, expect, it } from 'vitest';
import { createBody, readLook, versionBody } from '../public/js/paste.js';
import { call, makeToken, makeUser, storedParams } from './helpers';

describe('readLook', () => {
  it('takes a params object as it is', () => {
    const text = '{ "tree_count": 3,\n  "eclipse": false }';
    expect(readLook(`  ${text}\n`)).toEqual({ ok: true, paramsText: text });
  });

  it('takes the params out of { params }, byte for byte', () => {
    const inner = '{ "tree_count": 3.0,\n    "eclipse": false }';
    expect(readLook(`{ "params": ${inner}, "name": "ignored" }`)).toEqual({ ok: true, paramsText: inner });
  });

  it('says what it wants when it is not JSON or not an object', () => {
    expect(readLook('')).toMatchObject({ ok: false, message: expect.stringMatching(/paste/i) });
    expect(readLook('{ nope')).toMatchObject({ ok: false, message: expect.stringMatching(/not valid JSON/) });
    for (const text of ['[1]', '"x"', '3', 'null']) {
      expect(readLook(text)).toMatchObject({ ok: false, message: expect.stringMatching(/params object/) });
    }
  });

  it('leaves a params value that is not an object for the validator to refuse', () => {
    expect(readLook('{"params": 5}')).toEqual({ ok: true, paramsText: '{"params": 5}' });
  });
});

describe('the bodies it builds', () => {
  const paramsText = '{ "tree_count": 3.0,   "eclipse": false }';

  it('puts the params text in verbatim and the rest as JSON', () => {
    const body = createBody(paramsText, { name: 'a "quoted" look', description: '', tags: ['projector'], visibility: 'private' });
    expect(body).toContain(`"params":${paramsText}`);
    expect(JSON.parse(body)).toEqual({ name: 'a "quoted" look', tags: ['projector'], visibility: 'private', params: { tree_count: 3, eclipse: false } });
  });

  it('keeps a description when there is one', () => {
    expect(JSON.parse(createBody(paramsText, { name: 'x', description: 'wet', tags: [], visibility: 'public' })).description).toBe('wet');
  });

  it('builds a version body that is only the params', () => {
    expect(versionBody(paramsText)).toBe(`{"params":${paramsText}}`);
  });

  it('is stored by the API exactly as pasted', async () => {
    const user = await makeUser('paster');
    const token = await makeToken(user);
    const r = await call('POST', '/api/presets', { token, body: createBody(paramsText, { name: 'x', description: '', tags: [], visibility: 'private' }) });
    expect(r.status).toBe(201);
    expect(await storedParams(r.json.id, 1)).toBe(paramsText);
    const v = await call('POST', `/api/presets/${r.json.id}/versions`, { token, body: versionBody('{"tree_count":  4}') });
    expect(v.status).toBe(201);
    expect(await storedParams(r.json.id, 2)).toBe('{"tree_count":  4}');
  });
});
