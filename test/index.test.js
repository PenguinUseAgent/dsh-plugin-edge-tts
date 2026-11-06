import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  createSessionStateStore,
  createStateHandler,
  createSynthesisHandler,
  isValidSessionId,
  isSameOriginRequest,
  normalizeSpeechText,
} from '../index.js';

class ResponseMock {
  constructor() {
    this.headers = new Map();
    this.statusCode = 0;
    this.body = Buffer.alloc(0);
  }
  setHeader(name, value) { this.headers.set(name.toLowerCase(), value); }
  end(value = Buffer.alloc(0)) { this.body = Buffer.isBuffer(value) ? value : Buffer.from(value); }
}

function request({ method = 'POST', origin = 'http://192.168.1.20:3080', host = '192.168.1.20:3080', body = {}, url = '/api/plugin/edge-tts/state' } = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = url;
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

test('rejects malformed session ids', () => {
  assert.equal(isValidSessionId('session-1'), true);
  assert.equal(isValidSessionId(''), false);
  assert.equal(isValidSessionId('bad\nid'), false);
  assert.equal(isValidSessionId(null), false);
  assert.equal(isValidSessionId('x'.repeat(201)), false);
});

test('shares per-session state across clients and persists it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-edge-tts-state-'));
  const file = join(directory, 'state.json');
  try {
    const store = createSessionStateStore({ file, writeDelayMs: 0 });
    assert.equal(await store.get('session-a'), null);

    const handler = createStateHandler(store);

    const unknown = new ResponseMock();
    await handler(request({ method: 'GET', url: '/api/plugin/edge-tts/state?sessionId=session-a' }), unknown);
    assert.equal(unknown.statusCode, 200);
    assert.deepEqual(JSON.parse(unknown.body.toString()), { enabled: null });

    const enable = new ResponseMock();
    await handler(request({ body: { sessionId: 'session-a', enabled: true } }), enable);
    assert.equal(enable.statusCode, 200);
    assert.deepEqual(JSON.parse(enable.body.toString()), { enabled: true });

    const secondClient = new ResponseMock();
    await handler(request({ method: 'GET', url: '/api/plugin/edge-tts/state?sessionId=session-a' }), secondClient);
    assert.deepEqual(JSON.parse(secondClient.body.toString()), { enabled: true });

    await store.flush();
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved.sessions['session-a'], true);

    const reopened = createSessionStateStore({ file });
    assert.equal(await reopened.get('session-a'), true);
    assert.equal(await reopened.get('session-b'), null);
    reopened.dispose();
    store.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects invalid shared-state requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-edge-tts-state-'));
  try {
    const store = createSessionStateStore({ file: join(directory, 'state.json') });
    const handler = createStateHandler(store);

    const missingQuery = new ResponseMock();
    await handler(request({ method: 'GET', url: '/api/plugin/edge-tts/state' }), missingQuery);
    assert.equal(missingQuery.statusCode, 400);

    const badBody = new ResponseMock();
    await handler(request({ body: { sessionId: 'session-a', enabled: 'yes' } }), badBody);
    assert.equal(badBody.statusCode, 400);

    const foreign = new ResponseMock();
    await handler(request({ origin: 'https://evil.example', body: { sessionId: 'session-a', enabled: true } }), foreign);
    assert.equal(foreign.statusCode, 403);

    store.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
