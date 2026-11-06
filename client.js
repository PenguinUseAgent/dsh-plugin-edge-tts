window.__ModuleLoader__.load({
  id: '@penguinuseagent/dsh-plugin-edge-tts',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const ROUTE = 'api/plugin/edge-tts/synthesize';
    const STATE_ROUTE = 'api/plugin/edge-tts/state';
    const STORAGE_PREFIX = 'dsh.edge-tts.enabled.v1.';
    const NS = 'edgeTtsVoiceOutput';
    const SYNC_INTERVAL_MS = 3000;

    const dictionaries = {
      zh: {
        label: '语音',
        on: '语音输出已开启，回复完成后自动朗读',
        off: '语音输出已关闭',
        gesture: '语音已开启；点击页面任意位置以授权播放声音',
        synthesizing: '正在合成语音…',
        playing: '正在播放语音',
        error: '语音播放失败',
      },
      en: {
        label: 'Voice',
        on: 'Voice output is on — completed replies are read aloud',
        off: 'Voice output is off',
        gesture: 'Voice output is on; click anywhere in this page to allow audio',
        synthesizing: 'Synthesizing speech…',
        playing: 'Playing speech',
        error: 'Voice playback failed',
      },
    };

    const css = `
      .pua-edge-tts { display:inline-flex; align-items:center; min-width:0; }
      .pua-edge-tts__control { display:inline-flex; align-items:center; gap:6px; height:24px; margin:0; padding:0 6px; border:0; border-radius:999px; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; font:inherit; font-size:12px; line-height:18px; min-width:0; }
      .pua-edge-tts__control:hover { background:var(--dsw-alias-bg-layer-2); }
      .pua-edge-tts__control:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
      .pua-edge-tts__control[data-enabled='true'] { color:var(--dsw-alias-brand-primary); }
      .pua-edge-tts__control[data-busy='true'] { color:var(--dsw-alias-state-warn-primary); }
      .pua-edge-tts__control[data-failed='true'] { color:var(--dsw-alias-state-error-primary); }
      .pua-edge-tts__control[data-gesture='true'] { color:var(--dsw-alias-state-warn-primary); }
      .pua-edge-tts__track { position:relative; display:block; width:26px; height:15px; flex:none; border-radius:999px; background:var(--dsw-alias-bg-layer-2); border:1px solid var(--dsw-alias-border-l2); transition:background .16s ease,border-color .16s ease; }
      .pua-edge-tts__track::after { content:''; position:absolute; top:1px; left:1px; width:11px; height:11px; border-radius:50%; background:var(--dsw-alias-label-secondary); transition:transform .16s ease,background .16s ease; }
      .pua-edge-tts__control[data-enabled='true'] .pua-edge-tts__track { background:var(--dsw-alias-brand-primary); border-color:var(--dsw-alias-brand-primary); }
      .pua-edge-tts__control[data-enabled='true'] .pua-edge-tts__track::after { background:var(--dsw-alias-bg-base); transform:translateX(11px); }
      .pua-edge-tts__text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .pua-edge-tts__sr { position:absolute; width:1px; height:1px; margin:-1px; padding:0; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0; }
      @media (max-width: 720px) { .pua-edge-tts__text { display:none; } }
      @media (prefers-reduced-motion: reduce) { .pua-edge-tts__track, .pua-edge-tts__track::after { transition:none; } }
    `;

    function speechText(blocks) {
      return (Array.isArray(blocks) ? blocks : [])
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

    function latestSettledAssistant(snapshot) {
      if (!snapshot || !Array.isArray(snapshot.order) || !snapshot.nodes) return null;
      for (let index = snapshot.order.length - 1; index >= 0; index -= 1) {
        const node = snapshot.nodes.get(snapshot.order[index]);
        if (node && node.kind === 'assistant-step' && node.data && node.data.status === 'settled' && node.data.finalNode) {
          return node.data.finalNode;
        }
      }
      return null;
    }

    function VoiceOutput(props) {
      const { sessionId, useSession, useChat, t, locale } = props;
      const storageKey = STORAGE_PREFIX + (sessionId === undefined || sessionId === null ? 'pending' : sessionId);
      const [enabled, setEnabled] = React.useState(() => localStorage.getItem(storageKey) === '1');
      const [state, setState] = React.useState('idle');
      const [detail, setDetail] = React.useState('');
      const [needsGesture, setNeedsGesture] = React.useState(false);
      const [, refreshLocale] = React.useState(0);
      const running = useSession((snapshot) => snapshot !== undefined && snapshot !== null && snapshot.running === true);
      const latestAssistant = useChat(latestSettledAssistant);
      const armed = React.useRef(false);
      const armBaseline = React.useRef(0);
      const lastPlayedSeq = React.useRef(null);
      const audioContext = React.useRef(null);
      const currentSource = React.useRef(null);
      const requestGeneration = React.useRef(0);
      const enabledRef = React.useRef(enabled);

      React.useEffect(() => { enabledRef.current = enabled; }, [enabled]);
      React.useEffect(() => locale.subscribe(() => refreshLocale((value) => value + 1)), [locale]);

      const mirror = React.useCallback((value) => {
        if (value) localStorage.setItem(storageKey, '1');
        else localStorage.removeItem(storageKey);
      }, [storageKey]);

      React.useEffect(() => {
        const stored = localStorage.getItem(storageKey) === '1';
        enabledRef.current = stored;
        setEnabled(stored);
        setState('idle');
        setDetail('');
        setNeedsGesture(false);
        armed.current = false;
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
        if (audioContext.current.state === 'suspended') {
          try { await audioContext.current.resume(); } catch {}
        }
        setNeedsGesture(audioContext.current.state !== 'running');
        return audioContext.current;
      }, []);

      const postState = React.useCallback(async (value) => {
        if (sessionId === undefined || sessionId === null) return null;
        const response = await fetch(new URL(STATE_ROUTE, document.baseURI), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, enabled: value }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }, [sessionId]);

      const syncState = React.useCallback(async () => {
        if (sessionId === undefined || sessionId === null) return;
        try {
          const url = new URL(STATE_ROUTE, document.baseURI);
          url.searchParams.set('sessionId', sessionId);
          const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
          if (!response.ok) return;
          const data = await response.json();
          if (typeof data.enabled === 'boolean') {
            enabledRef.current = data.enabled;
            setEnabled(data.enabled);
            mirror(data.enabled);
            return;
          }
          // Migrate only a previously enabled local preference; never write an implicit "off".
          if (enabledRef.current) await postState(true);
        } catch {}
      }, [sessionId, mirror, postState]);

      React.useEffect(() => {
        if (sessionId === undefined || sessionId === null) return undefined;
        const tick = () => {
          if (document.visibilityState === 'visible') syncState();
        };
        tick();
        const timer = setInterval(tick, SYNC_INTERVAL_MS);
        const onVisible = () => {
          if (document.visibilityState === 'visible') syncState();
        };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);
        return () => {
          clearInterval(timer);
          document.removeEventListener('visibilitychange', onVisible);
          window.removeEventListener('focus', onVisible);
        };
      }, [sessionId, syncState]);

      React.useEffect(() => {
        const unlock = () => { ensureAudioContext().catch(() => {}); };
        document.addEventListener('pointerdown', unlock, { once: true, capture: true });
        document.addEventListener('keydown', unlock, { once: true, capture: true });
        return () => {
          document.removeEventListener('pointerdown', unlock, true);
          document.removeEventListener('keydown', unlock, true);
        };
      }, [ensureAudioContext]);

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
          if (context.state !== 'running') {
            setState('idle');
            return;
          }
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
        if (running) {
          if (!armed.current) armBaseline.current = latestAssistant === null ? 0 : latestAssistant.seq;
          armed.current = true;
          if (currentSource.current) {
            try { currentSource.current.stop(); } catch {}
            currentSource.current = null;
            setState('idle');
          }
          return;
        }
        if (!armed.current) return;
        if (!latestAssistant || latestAssistant.interrupted) return;
        if (latestAssistant.seq <= armBaseline.current) return;
        if (lastPlayedSeq.current === latestAssistant.seq) return;
        lastPlayedSeq.current = latestAssistant.seq;
        armed.current = false;
        if (!enabled) return;
        playReply(latestAssistant);
      }, [enabled, running, latestAssistant, playReply]);

      const toggle = async () => {
        const next = !enabled;
        enabledRef.current = next;
        setEnabled(next);
        mirror(next);
        setState('idle');
        setDetail('');
        if (next) {
          try { await ensureAudioContext(); } catch {}
        } else {
          requestGeneration.current += 1;
          try { currentSource.current?.stop(); } catch {}
          currentSource.current = null;
        }
        try {
          await postState(next);
        } catch (error) {
          enabledRef.current = !next;
          setEnabled(!next);
          mirror(!next);
          setState('error');
          setDetail(error instanceof Error ? error.message : String(error));
        }
      };

      const statusKey = state === 'synthesizing' ? 'synthesizing'
        : state === 'playing' ? 'playing'
          : state === 'error' ? 'error'
            : enabled && needsGesture ? 'gesture'
              : enabled ? 'on' : 'off';
      const status = t(statusKey);
      const busy = state === 'synthesizing' || state === 'playing';
      return h(React.Fragment, null,
        h('style', null, css),
        h('div', { className: 'pua-edge-tts' },
          h('button', {
            type: 'button',
            className: 'pua-edge-tts__control',
            role: 'switch',
            'aria-checked': enabled,
            'aria-label': t('label'),
            'data-enabled': enabled ? 'true' : 'false',
            'data-busy': busy ? 'true' : 'false',
            'data-failed': state === 'error' ? 'true' : 'false',
            'data-gesture': enabled && needsGesture ? 'true' : 'false',
            title: detail && state === 'error' ? `${status}: ${detail}` : status,
            onClick: toggle,
          },
            h('span', { className: 'pua-edge-tts__track', 'aria-hidden': 'true' }),
            h('span', { className: 'pua-edge-tts__text' }, t('label')),
          ),
          h('span', { className: 'pua-edge-tts__sr', 'aria-live': 'polite' }, status),
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries), 'edge-tts: dictionaries');
        const t = ctx.locale.bind(NS);
        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'penguinuseagent-edge-tts',
          order: 15,
        }, (props) => h(VoiceOutput, { ...props, t, locale: ctx.locale })));
      },
    };
  },
});
