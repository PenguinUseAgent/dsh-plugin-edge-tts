import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createSynthesisHandler, isSameOriginRequest, normalizeSpeechText } from '../index.js';

class ResponseMock {
  constructor() {
    this.headers = new Map();
    this.statusCode = 0;
    this.body = Buffer.alloc(0);
  }
  setHeader(name, value) { this.headers.set(name.toLowerCase(), value); }
  end(value = Buffer.alloc(0)) { this.body = Buffer.isBuffer(value) ? value : Buffer.from(value); }
}

function request({ method = 'POST', origin = 'http://192.168.1.20:3080', host = '192.168.1.20:3080', body = {} } = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.headers = { origin, host, 'content-type': 'application/json' };
  return req;
}

test('normalizes and bounds speech text', () => {
  assert.equal(normalizeSpeechText('  hello\r\n\r\n\r\nworld\0  '), 'hello\n\nworld');
  assert.equal(normalizeSpeechText(null), '');
  assert.equal(normalizeSpeechText('x'.repeat(13_000)).length, 12_000);
});

test('accepts same-origin LAN requests and rejects foreign origins', () => {
  assert.equal(isSameOriginRequest(request()), true);
  assert.equal(isSameOriginRequest(request({ origin: 'https://evil.example' })), false);
});

test('synthesizes MP3 bytes and caches identical requests', async () => {
  let calls = 0;
  const handler = createSynthesisHandler({
    voice: 'test-female-voice',
    synthesize: async (text) => {
      calls += 1;
      return Buffer.from(`mp3:${text}`);
    },
  });
  for (let index = 0; index < 2; index += 1) {
    const res = new ResponseMock();
    await handler(request({ body: { text: '你好，世界。' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers.get('content-type'), 'audio/mpeg');
    assert.equal(res.body.toString(), 'mp3:你好，世界。');
  }
  assert.equal(calls, 1);
});

test('reports invalid input and cross-origin calls', async () => {
  const handler = createSynthesisHandler({ synthesize: async () => Buffer.from('unused') });
  const empty = new ResponseMock();
  await handler(request({ body: { text: '   ' } }), empty);
  assert.equal(empty.statusCode, 400);

  const foreign = new ResponseMock();
  await handler(request({ origin: 'https://evil.example', body: { text: 'hello' } }), foreign);
  assert.equal(foreign.statusCode, 403);
});
