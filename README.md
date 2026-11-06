# DSH Edge TTS 语音输出

一个常驻的 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) Web 界面插件：在每轮对话结束后，用 Microsoft Edge TTS 朗读助手的最终回复。

[English](README.en.md) · 中文

## 功能

- 默认使用微软 Edge 女声 `zh-CN-XiaoxiaoNeural`。
- 在输入框底部工具栏新增一个可访问的 **语音** 开关，新会话和已有会话中都会显示。
- 开关状态按会话保存在 DSH 主机上，同一会话的所有设备共享同一状态；新建会话默认关闭。
- 只在一轮对话正式结束后合成，然后在浏览器中播放 MP3。
- 请求走同源接口，因此局域网内其他设备打开的页面也会在该设备上播放。
- 每隔几秒轮询共享状态，并在窗口聚焦时立即同步，任一设备切换后其余设备约 3 秒内跟随。
- 相同的并发合成请求会合并，并保留一个小型内存音频缓存。
- 朗读时会剔除思考过程与围栏代码块。

## 前置条件

在运行 DSH 的机器上安装 Python 3 与 [`edge-tts`](https://github.com/rany2/edge-tts)：

```bash
pipx install edge-tts
# 或
python3 -m pip install --user edge-tts
```

确认 `edge-tts` 位于 DSH 进程的 `PATH` 中：

```bash
edge-tts --version
```

## 安装

### 从 GitHub 安装

在 **设置 → 插件 → 安装插件包** 中填入：

```text
github:PenguinUseAgent/dsh-plugin-edge-tts
```

等价的 Git 地址：

```text
git+https://github.com/PenguinUseAgent/dsh-plugin-edge-tts.git
```

### 从本地仓库安装

克隆仓库后，在同一个「安装插件包」对话框中填入该目录的绝对路径：

```bash
git clone https://github.com/PenguinUseAgent/dsh-plugin-edge-tts.git
```

如需自动化安装，可把仓库绝对路径传给 Harness `plugin_manager` 的 `install_bundle` 操作。

## 使用

1. 打开一个 DSH 会话。
2. 在输入框底部工具栏中打开 **语音**（就在模型选择器旁边）。这次点击同时会解锁浏览器音频。
3. 发送消息。整轮结束后，助手最终回复会被合成并播放。
4. 关闭开关会立即停止当前播放，并阻止之后自动朗读。

开关状态保存在 DSH 主机上，按会话 ID 索引，所有已连接客户端共享；浏览器 `localStorage` 只作为本地缓存。在一个设备上切换后，其他设备约 3 秒内同步；刷新页面会重新读取共享值。新建会话默认关闭。

每个浏览器仍然需要一次用户手势才能出声。插件会监听页面上的点击、触摸与按键事件并在此解锁音频；解锁前开关会显示「需要点击」的提示。开启开关时还会立刻朗读一句确认语，方便马上判断该设备能否发声。

## iPhone / iPad

iOS 上所有浏览器（包括 Firefox、Chrome）底层都是 WebKit，有几个额外规则：

- **音频解锁**：在页面任意位置点一下即可恢复音频并预热媒体元素。若首次播放仍被拦截，该条回复会被记住，下一次点击解锁后立即补播。
- **静音开关**：iOS 在响铃/静音开关拨到静音时会静音网页音频。若电脑有声而 iPhone 没声，请关闭静音开关并调大媒体音量。
- **锁屏**：锁屏后 iOS 会挂起页面。页面重新可见时，若隐藏期间到达的回复在 5 分钟以内，会被补播。
- **屏幕常亮**：开关开启且页面可见时，插件会申请屏幕唤醒锁，避免 iOS 在一轮对话进行中挂起页面；不支持 Screen Wake Lock API 的浏览器会直接忽略。

播放优先使用 Web Audio，音频上下文未运行时回退到 `<audio>` 元素。开关开启后，旁边会出现一个小喇叭按钮，可随时重播最新一条回复，这是更换设备或切换共享开关后最快的自检方式。

## 局域网使用

插件按 `document.baseURI` 的相对路径请求 `api/plugin/edge-tts/synthesize` 与 `api/plugin/edge-tts/state`，从不硬编码 `127.0.0.1`。因此手机或另一台电脑通过局域网地址打开 DSH 时，会向 DSH 主机请求合成、在本地播放返回的 MP3，并看到与其他设备一致的按会话开关状态。

DSH 本身需要监听在局域网可达的地址（例如 `0.0.0.0`），并让常规的远程访问策略允许该设备。请勿把无认证的 DSH 暴露到不受信任的网络中。

## 配置

Host 进程读取两个可选环境变量：

| 变量 | 默认值 | 用途 |
|---|---|---|
| `EDGE_TTS_COMMAND` | `edge-tts` | 可执行文件名或绝对路径 |
| `EDGE_TTS_VOICE` | `zh-CN-XiaoxiaoNeural` | Edge TTS 音色标识 |

其他可用的女声示例：`zh-CN-XiaoyiNeural`、`en-US-JennyNeural`。

## 共享状态

Host 在内存中维护各会话的开关，并写入：

```text
$DSH_HOME/plugin-data/edge-tts/state.json
```

写入带防抖且是原子的（临时文件加 rename），因此切换不会阻塞界面，进程崩溃也不会截断文件。最多保留最近 500 个会话。

删除该文件后，所有会话都会回到默认关闭状态。

## 浏览器行为

现代浏览器要求先有用户手势才允许播放声音。打开开关时会在该手势内创建/恢复 Web Audio 上下文，并为 iOS 预热媒体元素。若开关是被其他设备同步打开的，或刚完成整页加载，则页面上第一次点击、触摸或按键会解锁音频，被拦截的回复也会在这次手势中重试。

## 安全与限制

- 合成与状态接口只接受同源请求。
- JSON 请求体上限 64 KiB。
- 单条回复的朗读文本上限 12,000 字符。
- `edge-tts` 子进程超过 90 秒会被终止。
- 每次合成结束后立即删除临时 MP3 文件。
- 状态文件以 `0600` 权限创建。

## 开发

```bash
npm test
node --check index.js
node --check client.js
npm pack --dry-run
```

## 许可证

[MIT](LICENSE)
