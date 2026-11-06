# DSH Edge TTS Voice Output

A persistent [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) Web GUI plugin that reads completed assistant replies aloud with Microsoft Edge TTS.

## Features

- Uses the Microsoft Edge female voice `zh-CN-XiaoxiaoNeural` by default.
- Adds an accessible **Voice output / 语音输出** switch below the composer.
- Stores the switch independently for every session; a newly created session starts off.
- Synthesizes only after a running turn completes, then plays the MP3 in the browser.
- Uses a same-origin endpoint, so pages opened from another device on the LAN play audio on that device too.
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
2. Enable **语音输出** below the composer. This user gesture also unlocks browser audio.
3. Send a message. When the turn is fully complete, the final assistant reply is synthesized and played.
4. Disable the switch to stop current playback and prevent later automatic playback.

The setting is stored in browser `localStorage` under a key containing the DSH session ID. It survives navigation and reloads in that browser, while every new session defaults to off. Each browser/device controls its own playback preference.

## LAN use

The plugin calls `api/plugin/edge-tts/synthesize` relative to `document.baseURI`; it never hard-codes `127.0.0.1`. Therefore a phone or another computer that opens DSH through a LAN address requests synthesis from the DSH host and plays the returned MP3 locally.

DSH itself must be configured to listen on a LAN-reachable address (for example `0.0.0.0`) and its normal remote-access policy must admit the device. Do not expose an unauthenticated DSH instance to an untrusted network.

## Configuration

The Host process reads two optional environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `EDGE_TTS_COMMAND` | `edge-tts` | Executable name or absolute path |
| `EDGE_TTS_VOICE` | `zh-CN-XiaoxiaoNeural` | Edge TTS voice identifier |

Examples of other female voices include `zh-CN-XiaoyiNeural` and `en-US-JennyNeural`.

## Browser behavior

Modern browsers require a user gesture before audio playback. Enabling the switch creates/resumes a Web Audio context during that gesture. A restored enabled state after a full browser restart may still require one click or key press before the browser permits sound, depending on browser policy.

## Security and limits

- Synthesis accepts same-origin `POST` requests only.
- JSON request bodies are limited to 64 KiB.
- Spoken text is limited to 12,000 characters per completed reply.
- `edge-tts` subprocesses are killed after 90 seconds.
- Temporary MP3 files are removed after each synthesis.

## Development

```bash
npm test
node --check index.js
node --check client.js
npm pack --dry-run
```

## License

[MIT](LICENSE)
