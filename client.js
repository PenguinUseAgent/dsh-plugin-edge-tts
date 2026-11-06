window.__ModuleLoader__.load({
  id: '@penguinuseagent/dsh-plugin-edge-tts',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const ROUTE = 'api/plugin/edge-tts/synthesize';
    const STORAGE_PREFIX = 'dsh.edge-tts.enabled.v1.';
    const NS = 'edgeTtsVoiceOutput';

    const dictionaries = {
      zh: {
        label: '语音输出',
        on: '已开启，回复完成后自动朗读',
        off: '已关闭',
        synthesizing: '正在合成语音…',
        playing: '正在播放',
        error: '语音播放失败',
      },
      en: {
        label: 'Voice output',
        on: 'On — read completed replies aloud',
        off: 'Off',
        synthesizing: 'Synthesizing speech…',
        playing: 'Playing',
        error: 'Voice playback failed',
      },
    };

    const css = `
      .pua-edge-tts { display:flex; align-items:center; gap:8px; min-height:24px; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; }
      .pua-edge-tts__switch { appearance:none; width:30px; height:18px; margin:0; padding:2px; border:1px solid var(--dsw-alias-border-l2); border-radius:999px; background:var(--dsw-alias-bg-layer-2); cursor:pointer; transition:background .16s ease,border-color .16s ease; }
      .pua-edge-tts__switch::after { content:''; display:block; width:12px; height:12px; border-radius:50%; background:var(--dsw-alias-label-secondary); transition:transform .16s ease,background .16s ease; }
      .pua-edge-tts__switch:checked { border-color:var(--dsw-alias-brand-primary); background:var(--dsw-alias-brand-primary); }
      .pua-edge-tts__switch:checked::after { background:var(--dsw-alias-bg-base); transform:translateX(12px); }
      .pua-edge-tts__switch:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
      .pua-edge-tts__label { color:var(--dsw-alias-label-primary); font-weight:500; }
      .pua-edge-tts__status { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .pua-edge-tts__status[data-error='true'] { color:var(--dsw-alias-state-error-primary); }
      @media (prefers-reduced-motion: reduce) { .pua-edge-tts__switch, .pua-edge-tts__switch::after { transition:none; } }
    `;

    function speechText(blocks) {
      return blocks
        .filter((block) => block && block.kind === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n\n')
        .replace(/```[\s\S]*?```/g, '。')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/^\s*>\s?/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*\d+[.)]\s+/gm, '')
        .replace(/[\*_~]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function VoiceOutput(props) {
      const { sessionId, useSession, useChat, t, locale } = props;
      const storageKey = STORAGE_PREFIX + sessionId;
      const [enabled, setEnabled] = React.useState(() => localStorage.getItem(storageKey) === '1');
      const [state, setState] = React.useState('idle');
      const [detail, setDetail] = React.useState('');
      const [, refreshLocale] = React.useState(0);
      const running = useSession((snapshot) => snapshot.running);
      const latestAssistant = useChat((snapshot) => {
        for (let index = snapshot.order.length - 1; index >= 0; index -= 1) {
          const node = snapshot.nodes.get(snapshot.order[index]);
          if (node?.kind === 'assistant-step' && node.data.status === 'settled' && node.data.finalNode) return node.data.finalNode;
        }
        return null;
      });
      const previousRunning = React.useRef(running);
      const lastPlayedSeq = React.useRef(null);
      const audioContext = React.useRef(null);
      const currentSource = React.useRef(null);
      const requestGeneration = React.useRef(0);

      React.useEffect(() => locale.subscribe(() => refreshLocale((value) => value + 1)), [locale]);
      React.useEffect(() => {
        setEnabled(localStorage.getItem(storageKey) === '1');
        setState('idle');
        setDetail('');
        previousRunning.current = running;
        lastPlayedSeq.current = null;
      }, [storageKey]);
      React.useEffect(() => () => {
        requestGeneration.current += 1;
        try { currentSource.current?.stop(); } catch {}
        audioContext.current?.close().catch(() => {});
      }, []);

      const ensureAudioContext = React.useCallback(async () => {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return null;
        if (!audioContext.current || audioContext.current.state === 'closed') audioContext.current = new AudioContext();
        if (audioContext.current.state === 'suspended') await audioContext.current.resume();
        return audioContext.current;
      }, []);

      const playReply = React.useCallback(async (assistant) => {
        const text = speechText(assistant.blocks || []);
        if (!text) return;
        const generation = ++requestGeneration.current;
        setState('synthesizing');
        setDetail('');
        try {
          const response = await fetch(new URL(ROUTE, document.baseURI), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          });
          if (!response.ok) {
            const failure = await response.json().catch(() => ({}));
            throw new Error(failure.error || `HTTP ${response.status}`);
          }
          const bytes = await response.arrayBuffer();
          if (generation !== requestGeneration.current) return;
          const context = await ensureAudioContext();
          if (!context) throw new Error('Web Audio API is unavailable.');
          const buffer = await context.decodeAudioData(bytes.slice(0));
          if (generation !== requestGeneration.current) return;
          try { currentSource.current?.stop(); } catch {}
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(context.destination);
          source.onended = () => {
            if (currentSource.current === source) {
              currentSource.current = null;
              setState('idle');
            }
          };
          currentSource.current = source;
          source.start();
          setState('playing');
        } catch (error) {
          if (generation !== requestGeneration.current) return;
          setState('error');
          setDetail(error instanceof Error ? error.message : String(error));
        }
      }, [ensureAudioContext]);

      React.useEffect(() => {
        const completed = previousRunning.current === true && running === false;
        previousRunning.current = running;
        if (!enabled || !completed || !latestAssistant || latestAssistant.interrupted) return;
        if (lastPlayedSeq.current === latestAssistant.seq) return;
        lastPlayedSeq.current = latestAssistant.seq;
        playReply(latestAssistant);
      }, [enabled, running, latestAssistant, playReply]);

      const toggle = async (event) => {
        const next = event.target.checked;
        setEnabled(next);
        setState('idle');
        setDetail('');
        if (next) {
          localStorage.setItem(storageKey, '1');
          try { await ensureAudioContext(); } catch {}
        } else {
          localStorage.removeItem(storageKey);
          requestGeneration.current += 1;
          try { currentSource.current?.stop(); } catch {}
          currentSource.current = null;
        }
      };

      const statusKey = state === 'synthesizing' ? 'synthesizing' : state === 'playing' ? 'playing' : state === 'error' ? 'error' : enabled ? 'on' : 'off';
      const status = t(statusKey);
      return h(React.Fragment, null,
        h('style', null, css),
        h('div', { className: 'pua-edge-tts' },
          h('input', {
            className: 'pua-edge-tts__switch',
            type: 'checkbox',
            role: 'switch',
            checked: enabled,
            'aria-checked': enabled,
            'aria-label': t('label'),
            onChange: toggle,
          }),
          h('span', { className: 'pua-edge-tts__label' }, t('label')),
          h('span', {
            className: 'pua-edge-tts__status',
            'data-error': state === 'error' ? 'true' : 'false',
            title: detail || status,
            'aria-live': 'polite',
          }, detail && state === 'error' ? `${status}: ${detail}` : status),
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries), 'edge-tts: dictionaries');
        const t = ctx.locale.bind(NS);
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'penguinuseagent-edge-tts',
          order: 4,
        }, (props) => h(VoiceOutput, { ...props, t, locale: ctx.locale })));
      },
    };
  },
});
