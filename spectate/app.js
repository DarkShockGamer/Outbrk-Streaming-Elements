(function () {
  // Parse query params
  const params = new URLSearchParams(window.location.search);

  // channels supports comma-separated entries like:
  // twitch:channel1,twitch:channel2,youtube:channel:CHANNEL_ID,youtube:video:VIDEO_ID
  // You can also pass url:https://player.example/your-embed
  const channelsParam = params.get('channels') || '';
  const layout = (params.get('layout') || 'grid').toLowerCase(); // grid | focus
  const cycleSeconds = parseInt(params.get('cycle') || '0', 10); // 0 disables
  const parent = params.get('parent') || ''; // Required for Twitch embeds on the hosting domain
  const muted = (params.get('muted') || '1') !== '0'; // default muted=1
  const startIndex = parseInt(params.get('start') || '0', 10) || 0;

  const appEl = document.getElementById('app');
  const gridEl = document.getElementById('grid');

  const entries = parseChannels(channelsParam);

  if (!entries.length) {
    gridEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;color:#c7d2e0;opacity:.8;">
        No channels provided. Example:
        ?parent=yourdomain.com&layout=focus&cycle=8&channels=twitch:chaser1,twitch:chaser2,youtube:channel:UCxxxx
      </div>`;
    return;
  }

  let focusMode = layout === 'focus';
  let focusedIndex = clamp(startIndex, 0, entries.length - 1);
  let cycleTimer = null;
  let thumbnails = [];

  if (focusMode) {
    renderFocus();
    if (cycleSeconds > 0) startAutoCycle();
  } else {
    renderGrid();
  }

  // Key bindings
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    switch (e.key) {
      case 'f':
      case 'F':
        toggleFocusMode();
        break;
      case 'a':
      case 'A':
        toggleAutoCycle();
        break;
      case 'ArrowRight':
        next();
        break;
      case 'ArrowLeft':
        prev();
        break;
      default:
        // 1–9 focus
        if (e.key >= '1' && e.key <= '9') {
          const idx = parseInt(e.key, 10) - 1;
          if (idx < entries.length) setFocus(idx);
        }
    }
  });

  function toggleFocusMode() {
    focusMode = !focusMode;
    clearAutoCycle();
    if (focusMode) {
      renderFocus();
      if (cycleSeconds > 0) startAutoCycle();
    } else {
      renderGrid();
    }
  }

  function toggleAutoCycle() {
    if (cycleTimer) {
      clearAutoCycle();
    } else if (focusMode && cycleSeconds > 0) {
      startAutoCycle();
    }
  }

  function startAutoCycle() {
    clearAutoCycle();
    if (cycleSeconds > 0) {
      cycleTimer = setInterval(next, cycleSeconds * 1000);
    }
  }

  function clearAutoCycle() {
    if (cycleTimer) {
      clearInterval(cycleTimer);
      cycleTimer = null;
    }
  }

  function next() {
    setFocus((focusedIndex + 1) % entries.length);
  }

  function prev() {
    setFocus((focusedIndex - 1 + entries.length) % entries.length);
  }

  function setFocus(idx) {
    focusedIndex = clamp(idx, 0, entries.length - 1);
    if (focusMode) {
      renderFocus();
    }
  }

  function renderGrid() {
    appEl.classList.remove('focus-mode');
    gridEl.classList.remove('hidden');
    gridEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    entries.forEach((entry, i) => {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.appendChild(makeBadge(entry.label || labelFor(entry, i)));
      tile.appendChild(makeIframe(entry));
      frag.appendChild(tile);
    });
    gridEl.appendChild(frag);
  }

  function renderFocus() {
    appEl.classList.add('focus-mode');
    gridEl.classList.add('hidden');

    // Build focus stage + strip
    const stage = document.createElement('div');
    stage.className = 'focus-stage';
    stage.appendChild(makeBadge(entries[focusedIndex].label || labelFor(entries[focusedIndex], focusedIndex)));
    stage.appendChild(makeIframe(entries[focusedIndex]));

    const strip = document.createElement('div');
    strip.className = 'focus-strip';
    thumbnails = entries.map((entry, i) => {
      const t = document.createElement('div');
      t.className = 'focus-thumb' + (i === focusedIndex ? ' active' : '');
      t.title = entry.label || labelFor(entry, i);
      t.addEventListener('click', () => setFocus(i));
      t.appendChild(makeBadge(entry.label || labelFor(entry, i)));
      t.appendChild(makeIframe(entry, true)); // thumbnails reuse same embed; OBS will handle downscale
      return t;
    });

    strip.append(...thumbnails);

    // Replace app children with focus layout
    appEl.innerHTML = '';
    appEl.appendChild(stage);
    appEl.appendChild(strip);
    appEl.appendChild(document.getElementById('hint')); // reattach hint
  }

  function makeBadge(text) {
    const b = document.createElement('div');
    b.className = 'badge';
    b.textContent = text;
    return b;
  }

  function makeIframe(entry, isThumb = false) {
    const iframe = document.createElement('iframe');
    iframe.allow =
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;

    const commonAuto = muted ? '&autoplay=true&muted=true' : '&autoplay=true';

    switch (entry.kind) {
      case 'twitch:channel': {
        const p = parent ? `&parent=${encodeURIComponent(parent)}` : '';
        iframe.src = `https://player.twitch.tv/?channel=${encodeURIComponent(entry.value)}${p}${commonAuto}`;
        break;
      }
      case 'youtube:channel': {
        // Show live broadcast if any; otherwise YouTube shows "Offline" channel banner
        iframe.src = `https://www.youtube-nocookie.com/embed/live_stream?channel=${encodeURIComponent(entry.value)}${commonAuto}`;
        break;
      }
      case 'youtube:video': {
        iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(entry.value)}?playsinline=1${commonAuto}`;
        break;
      }
      case 'url': {
        iframe.src = entry.value;
        break;
      }
      default: {
        // No-op, keeps an empty tile
        break;
      }
    }
    return iframe;
  }

  function parseChannels(raw) {
    if (!raw) return [];
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(parseEntry)
      .filter(Boolean);
  }

  function parseEntry(token) {
    // Formats:
    // twitch:CHANNEL
    // youtube:channel:CHANNEL_ID
    // youtube:video:VIDEO_ID
    // url:https://...
    const [p0, p1, p2, ...rest] = token.split(':');
    const tail = rest.length ? rest.join(':') : '';
    // url:https://... can include more colons; handle explicitly
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
    // fallback: assume twitch:channel string without prefix
    if (!token.includes(':')) {
      return { kind: 'twitch:channel', value: token, label: `Twitch/${token}` };
    }
    console.warn('Unrecognized channel token:', token);
    return null;
  }

  function labelFor(entry, i) {
    return `Stream ${i + 1}`;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function hostnameOf(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }

  function shorten(s) {
    return s.length > 10 ? s.slice(0, 6) + '…' + s.slice(-3) : s;
  }
})();
