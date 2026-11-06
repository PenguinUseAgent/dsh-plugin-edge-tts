import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export const inject = ['webServer'];

const ROUTE = '/api/plugin/edge-tts/synthesize';
const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TEXT_LENGTH = 12_000;
const CACHE_LIMIT = 20;
const SYNTHESIS_TIMEOUT_MS = 90_000;

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

export function normalizeSpeechText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replaceAll('\u0000', '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

export function isSameOriginRequest(req) {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const host = req.headers.host;
  if (typeof host !== 'string' || host.length === 0) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

export function runEdgeTts(text, options = {}) {
  const command = options.command ?? process.env.EDGE_TTS_COMMAND ?? 'edge-tts';
  const voice = options.voice ?? process.env.EDGE_TTS_VOICE ?? DEFAULT_VOICE;
  const timeoutMs = options.timeoutMs ?? SYNTHESIS_TIMEOUT_MS;

  return mkdtemp(join(tmpdir(), 'dsh-edge-tts-')).then(async (directory) => {
    const output = join(directory, 'speech.mp3');
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(command, ['--voice', voice, '--text', text, '--write-media', output], {
          stdio: ['ignore', 'ignore', 'pipe'],
          windowsHide: true,
        });
        let stderr = '';
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          child.kill('SIGKILL');
          const error = new Error(`edge-tts timed out after ${timeoutMs} ms.`);
          error.code = 'ETIMEDOUT';
          reject(error);
        }, timeoutMs);
        child.stderr.on('data', (chunk) => {
          if (stderr.length < 8_192) stderr += chunk.toString('utf8');
        });
        child.once('error', (error) => {
          settled = true;
          clearTimeout(timer);
          reject(error);
        });
        child.once('exit', (code, signal) => {
          settled = true;
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error(`edge-tts failed (${signal ?? `exit ${code}`}): ${stderr.trim() || 'no diagnostics'}`));
        });
      });
      return await readFile(output);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

export function createSynthesisHandler(options = {}) {
  const cache = new Map();
  const pending = new Map();
  const voice = options.voice ?? process.env.EDGE_TTS_VOICE ?? DEFAULT_VOICE;
  const synthesize = options.synthesize ?? ((text) => runEdgeTts(text, { ...options, voice }));

  function remember(key, audio) {
    cache.delete(key);
    cache.set(key, audio);
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  }

  return async (req, res) => {
    if (req.method === 'GET') {
      return json(res, 200, { ok: true, voice, route: ROUTE });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return json(res, 405, { error: 'Method not allowed.' });
    }
    if (!isSameOriginRequest(req)) return json(res, 403, { error: 'Cross-origin synthesis is not allowed.' });
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      return json(res, 415, { error: 'Content-Type must be application/json.' });
    }

    try {
      const body = await readJsonBody(req);
      const text = normalizeSpeechText(body?.text);
      if (text.length === 0) return json(res, 400, { error: 'A non-empty text field is required.' });
      const key = createHash('sha256').update(voice).update('\0').update(text).digest('hex');
      let audio = cache.get(key);
      if (audio === undefined) {
        let task = pending.get(key);
        if (task === undefined) {
          task = Promise.resolve(synthesize(text));
          pending.set(key, task);
        }
        try {
          audio = await task;
          remember(key, audio);
        } finally {
          pending.delete(key);
        }
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audio.length);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(audio);
    } catch (error) {
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : error?.code === 'ENOENT' ? 503 : 500;
      const message = status === 503
        ? 'edge-tts is not installed or EDGE_TTS_COMMAND is invalid.'
        : error instanceof Error ? error.message : String(error);
      json(res, status, { error: message });
    }
  };
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: createSynthesisHandler(),
  }), 'edge-tts: synthesis endpoint');
}
