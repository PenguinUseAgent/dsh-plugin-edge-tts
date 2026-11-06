# DSH Edge TTS Voice Output

A persistent [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) Web GUI plugin that reads completed assistant replies aloud with Microsoft Edge TTS.

## Features

- Uses the Microsoft Edge female voice `zh-CN-XiaoxiaoNeural` by default.
- Adds an accessible **Voice / 语音** switch in the composer tool row, visible in both new and existing conversations.
- Stores the switch per session on the DSH host, so every device that opens the same conversation shares one state; a newly created session starts off.
- Synthesizes only after a running turn completes, then plays the MP3 in the browser.
- Uses a same-origin endpoint, so pages opened from another device on the LAN play audio on that device too.
- Polls the shared state every few seconds and on focus, so a toggle on one device reaches the others.
- Coalesces concurrent identical synthesis requests and keeps a small in-memory audio cache.
- Omits reasoning and fenced code from spoken text.

## Prerequisites

Install Python 3 and [`edge-tts`](https://github.com/rany2/edge-tts) on the machine running DSH:

```bash
pipx install edge-tts
# or
python3 -m pip install --user edge-tts
```

Confirm that `edge-tts` is on the DSH process `PATH`:

```bash
edge-tts --version
```

## Install

### From GitHub

In **Settings → Plugins → Install bundle**, use this package specification:

```text
github:PenguinUseAgent/dsh-plugin-edge-tts
```

A direct Git URL is equivalent:

```text
git+https://github.com/PenguinUseAgent/dsh-plugin-edge-tts.git
```

### From a local checkout

Clone the repository and install its absolute directory through the same **Install bundle** dialog:

```bash
git clone https://github.com/PenguinUseAgent/dsh-plugin-edge-tts.git
```

For plugin-development automation, pass the absolute checkout path to the Harness `plugin_manager` `install_bundle` action.

## Use

1. Open a DSH session.
2. Enable **语音** in the composer tool row (next to the model selector). This user gesture also unlocks browser audio.
3. Send a message. When the turn is fully complete, the final assistant reply is synthesized and played.
4. Disable the switch to stop current playback and prevent later automatic playback.

The setting is stored on the DSH host, keyed by session ID, and shared by every connected client; browser `localStorage` only keeps a local cache. Toggling on one device reaches the others within about three seconds, and reloading a page re-reads the shared value. Every new session defaults to off.

Each browser still needs one user gesture before it may play sound. The plugin listens for the first click or key press on the page and unlocks audio then; until that happens the switch shows a hint that a click is required.

## LAN use

The plugin calls `api/plugin/edge-tts/synthesize` and `api/plugin/edge-tts/state` relative to `document.baseURI`; it never hard-codes `127.0.0.1`. Therefore a phone or another computer that opens DSH through a LAN address requests synthesis from the DSH host, plays the returned MP3 locally, and sees the same per-session switch state as every other device.

DSH itself must be configured to listen on a LAN-reachable address (for example `0.0.0.0`) and its normal remote-access policy must admit the device. Do not expose an unauthenticated DSH instance to an untrusted network.

## Configuration

The Host process reads two optional environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `EDGE_TTS_COMMAND` | `edge-tts` | Executable name or absolute path |
| `EDGE_TTS_VOICE` | `zh-CN-XiaoxiaoNeural` | Edge TTS voice identifier |

Examples of other female voices include `zh-CN-XiaoyiNeural` and `en-US-JennyNeural`.

## Shared state

The Host keeps the per-session flags in memory and writes them to:

```text
$DSH_HOME/plugin-data/edge-tts/state.json
```

The write is debounced and atomic (temporary file plus rename), so toggling does not block the UI and a crash cannot truncate the file. At most 500 recent sessions are retained.

If this file is removed, every session starts off again.

## Browser behavior

Modern browsers require a user gesture before audio playback. Enabling the switch creates/resumes a Web Audio context during that gesture. When another device enables the shared switch, or after a full page load, the first click or key press anywhere on the page unlocks audio and later replies are spoken normally.

## Security and limits

- Synthesis and state endpoints accept same-origin requests only.
- JSON request bodies are limited to 64 KiB.
- Spoken text is limited to 12,000 characters per completed reply.
- `edge-tts` subprocesses are killed after 90 seconds.
- Temporary MP3 files are removed after each synthesis.
- The state file is created with mode `0600`.

## Development

```bash
npm test
node --check index.js
node --check client.js
npm pack --dry-run
```

## License

[MIT](LICENSE)
