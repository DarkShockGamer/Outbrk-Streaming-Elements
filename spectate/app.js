(function () {
  // DOM
  const appEl = document.getElementById('app');
  const duoEl = document.getElementById('duo');
  const leftEmbedEl = document.getElementById('embed-left');
  const rightEmbedEl = document.getElementById('embed-right');
  const badgeLeft = document.getElementById('badge-left');
  const badgeRight = document.getElementById('badge-right');

  // Config: URL -> data-attrs fallback
  const params = new URLSearchParams(window.location.search);
  function pick(name, def="") {
    const v = params.get(name);
    if (v !== null && v !== "") return v;
    const d = appEl?.dataset?.[name];
    if (d !== undefined && d !== null && `${d}` !== "") return `${d}`;
    return def;
  }

  const parent = pick('parent', window.location.hostname || '');
  const layoutInitial = (pick('layout','focus') || 'focus').toLowerCase(); // focus | both
  const channelsParam = pick('channels', ''); // comma-separated
  const mutedDefault = (pick('muted','1') !== '0'); // true by default

  // Parse channels, use first two
  const entries = parseChannels(channelsParam);
  const leftEntry = entries[0] || null;
  const rightEntry = entries[1] || null;

  // State
  let mode = layoutInitial === 'both' ? 'both' : 'focus';
  let focusSide = 'left'; // which is larger when mode=focus
  let audioSide = 'none'; // left | right | none

  // Players
  const players = {
    left: null,
    right: null
  };
  const kinds = {
    left: leftEntry?.kind || null,
    right: rightEntry?.kind || null
  };

  // Render badges
  if (leftEntry) badgeLeft.textContent = leftEntry.label || prettyLabel(leftEntry);
  if (rightEntry) badgeRight.textContent = rightEntry.label || prettyLabel(rightEntry);

  // Start
  setMode(mode, false);
  if (leftEntry) mountEmbed('left', leftEntry);
  if (rightEntry) mountEmbed('right', rightEntry);

  // Keyboard controls
  window.addEventListener('keydown', onKey);
  function onKey(e) {
    if (e.repeat) return;
    const key = e.key;
    switch (key) {
      case '1': return focus('left');
      case '2': return focus('right');
      case ' ': // Space
      case 'Tab':
      case 's':
      case 'S':
        e.preventDefault();
        return swap();
      case 'f':
      case 'F': return setMode('focus');
      case 'b':
      case 'B': return setMode('both');
      case 'q':
      case 'Q': return setAudio('left');
      case 'w':
      case 'W': return setAudio('right');
      case '0': return setAudio('none');
    }
  }

  // Optional: accept commands from a BroadcastChannel (for OBS Dock controller)
  let bc = null;
  try { bc = new BroadcastChannel('spectate-control'); } catch {}
  if (bc) {
    bc.onmessage = (ev) => {
      const { cmd, arg } = ev.data || {};
      if (!cmd) return;
      if (cmd === 'mode') setMode(arg);
      if (cmd === 'focus') focus(arg);
      if (cmd === 'swap') swap();
      if (cmd === 'audio') setAudio(arg);
    };
  }

  // Actions
  function setMode(next, animate = true) {
    mode = (next === 'both') ? 'both' : 'focus';
    duoEl.classList.toggle('layout-both', mode === 'both');
    duoEl.classList.toggle('layout-focus', mode === 'focus');
    applyFocusClass();
  }

  function focus(side) {
    if (mode !== 'focus') setMode('focus');
    focusSide = side === 'right' ? 'right' : 'left';
    applyFocusClass();
  }

  function swap() {
    focus(focusSide === 'left' ? 'right' : 'left');
    setAudio(focusSide); // follow focus with audio by default
  }

  function applyFocusClass() {
    duoEl.classList.toggle('focus-left', mode === 'focus' && focusSide === 'left');
    duoEl.classList.toggle('focus-right', mode === 'focus' && focusSide === 'right');
  }

  function setAudio(side) {
    audioSide = (side === 'left' || side === 'right') ? side : 'none';
    // Visual ring
    document.querySelectorAll('.frame').forEach(f => f.classList.remove('audio-active'));
    if (audioSide === 'left') leftEmbedEl.parentElement.classList.add('audio-active');
    if (audioSide === 'right') rightEmbedEl.parentElement.classList.add('audio-active');

    // Mute/unmute via player APIs
    setMuted('left', !(audioSide === 'left'));
    setMuted('right', !(audioSide === 'right'));
  }

  // Embeds
  function mountEmbed(side, entry) {
    const hostEl = side === 'left' ? leftEmbedEl : rightEmbedEl;
    if (!entry) {
      hostEl.innerHTML = placeholder('No channel');
      return;
    }
    switch (entry.kind) {
      case 'twitch:channel':
        mountTwitch(side, hostEl, entry.value);
        break;
      case 'youtube:channel':
      case 'youtube:video':
        mountYouTube(side, hostEl, entry);
        break;
      case 'url':
        hostEl.innerHTML = `<iframe src="${entry.value}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
        break;
      default:
        hostEl.innerHTML = placeholder('Unsupported');
    }
  }

  function mountTwitch(side, el, channel) {
    // Clear existing
    el.innerHTML = '';
    const id = `twitch-${side}-${Math.random().toString(36).slice(2)}`;
    const mount = document.createElement('div');
    mount.id = id;
    mount.style.width = '100%';
    mount.style.height = '100%';
    el.appendChild(mount);

    const embed = new Twitch.Embed(id, {
      channel,
      parent: [parent || window.location.hostname],
      width: '100%',
      height: '100%',
      autoplay: true,
      muted: mutedDefault
    });

    embed.addEventListener(Twitch.Embed.VIDEO_READY, () => {
      const player = embed.getPlayer();
      players[side] = player;
      // Ensure autoplay kicks in muted
      player.setMuted(mutedDefault);
      if (!mutedDefault && side !== audioSide) player.setMuted(true);
    });
  }

  // YouTube support via Iframe API
  let ytReady = false;
  let ytQueue = [];
  window.onYouTubeIframeAPIReady = function() {
    ytReady = true;
    ytQueue.forEach(fn => fn());
    ytQueue = [];
  };

  function mountYouTube(side, el, entry) {
    const run = () => {
      el.innerHTML = '';
      const id = `yt-${side}-${Math.random().toString(36).slice(2)}`;
      const mount = document.createElement('div');
      mount.id = id;
      mount.style.width = '100%';
      mount.style.height = '100%';
      el.appendChild(mount);

      const videoId = entry.kind === 'youtube:video' ? entry.value : null;
      const player = new YT.Player(id, {
        width: '100%',
        height: '100%',
        videoId: videoId || undefined,
        playerVars: videoId ? { autoplay: 1, mute: mutedDefault ? 1 : 0, playsinline: 1 } :
          { autoplay: 1, mute: mutedDefault ? 1 : 0, playsinline: 1, listType: 'playlist' },
        events: {
          onReady: (e) => {
            players[side] = e.target;
            if (mutedDefault) e.target.mute(); else e.target.unMute();
          }
        }
      });

      players[side] = player;
    };
    if (!ytReady) ytQueue.push(run); else run();
  }

  function setMuted(side, muted) {
    const p = players[side];
    if (!p) return;
    const kind = kinds[side];
    if (kind && kind.startsWith('twitch')) {
      try { muted ? p.setMuted(true) : p.setMuted(false); } catch {}
    } else if (kind && kind.startsWith('youtube')) {
      try { muted ? p.mute() : p.unMute(); } catch {}
    }
  }

  // Helpers
  function parseChannels(raw) {
    if (!raw) return [];
    return raw.split(',').map(s => s.trim()).filter(Boolean).map(parseEntry).filter(Boolean);
  }

  function parseEntry(token) {
    // twitch:CHANNEL | youtube:channel:ID | youtube:video:ID | url:https://...
    const [p0, p1, p2] = token.split(':');
    if (p0 === 'url') {
      const url = token.slice('url:'.length);
      return { kind: 'url', value: url, label: hostnameOf(url) || 'URL' };
    }
    if (p0 === 'twitch' && p1) {
      return { kind: 'twitch:channel', value: p1, label: `Twitch/${p1}` };
    }
    if (p0 === 'youtube' && p1 === 'channel' && p2) {
      return { kind: 'youtube:channel', value: p2, label: `YouTube/${shorten(p2)}` };
    }
    if (p0 === 'youtube' && p1 === 'video' && p2) {
      return { kind: 'youtube:video', value: p2, label: `YouTube Video/${shorten(p2)}` };
    }
    if (!token.includes(':')) {
      return { kind: 'twitch:channel', value: token, label: `Twitch/${token}` };
    }
    console.warn('Unrecognized channel token:', token);
    return null;
  }

  function hostnameOf(url) { try { return new URL(url).hostname; } catch { return null; } }
  function shorten(s) { return s.length > 10 ? s.slice(0, 6) + '…' + s.slice(-3) : s; }
  function prettyLabel(e) { return e.label || (e.kind?.split(':')[0] || 'Stream'); }

  // Default audio: follow focus if we have two channels
  setTimeout(() => {
    if (leftEntry && rightEntry) {
      setAudio(focusSide);
    } else if (leftEntry) {
      setAudio('left');
    } else if (rightEntry) {
      setAudio('right');
    }
  }, 750);
})();
