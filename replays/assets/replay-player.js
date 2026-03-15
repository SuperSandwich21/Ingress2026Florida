(function() {
  const cfgEl = document.getElementById('replay-config');
  const cfg = cfgEl ? JSON.parse(cfgEl.textContent || '{}') : {};
  const replayDataPath = cfg.replayDataPath;
  const iconsPath = cfg.iconsPath;
  const titleEl = document.getElementById('titleText');
  const clockEl = document.getElementById('clock');
  const timelineEl = document.getElementById('timeline');
  const playBtn = document.getElementById('btnPlay');
  const pauseBtn = document.getElementById('btnPause');
  const resetBtn = document.getElementById('btnReset');
  const speedEl = document.getElementById('speed');
  const legendEl = document.getElementById('playersLegend');

  const parseTs = (v) => {
    if (!v) return NaN;
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : NaN;
  };
  const fmt = (ms) => {
    if (!Number.isFinite(ms)) return '--';
    const d = new Date(ms);
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  };

  Promise.all([
    fetch(replayDataPath).then(r => r.json()),
    fetch(iconsPath).then(r => r.json()).catch(() => ({icons:{}}))
  ]).then(([data, iconManifest]) => {
    if (titleEl) titleEl.textContent = data.title || 'Replay';
    const map = L.map('map', { zoomControl: true }).setView([0, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    const icons = (iconManifest && iconManifest.icons) ? iconManifest.icons : {};
    const playerStates = [];
    let minTs = Number.POSITIVE_INFINITY;
    let maxTs = Number.NEGATIVE_INFINITY;
    const allLatLng = [];

    const makeIcon = (player) => {
      const iconMeta = player.icon_key ? icons[player.icon_key] : null;
      const imgSrc = iconMeta ? (iconMeta.data_uri || iconMeta.source_url || '') : '';
      const color = player.color || '#ffffff';
      if (imgSrc) {
        return L.divIcon({
          className: 'player-icon',
          html: '<div style="width:22px;height:22px;border-radius:50%;overflow:hidden;border:2px solid '+color+';box-shadow:0 0 0 1px rgba(0,0,0,.5)"><img src="'+imgSrc+'" style="width:100%;height:100%;object-fit:cover"/></div>',
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        });
      }
      return L.divIcon({
        className: 'player-icon',
        html: '<div style="width:14px;height:14px;border-radius:50%;background:'+color+';border:2px solid rgba(0,0,0,.6)"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });
    };

    (data.players || []).forEach((player) => {
      const events = (player.events || [])
        .map(e => ({...e, _t: parseTs(e.timestamp)}))
        .filter(e => Number.isFinite(e._t) && Number.isFinite(Number(e.portal_lat)) && Number.isFinite(Number(e.portal_lng)))
        .sort((a,b) => a._t - b._t);
      if (!events.length) return;
      minTs = Math.min(minTs, events[0]._t);
      maxTs = Math.max(maxTs, events[events.length - 1]._t);
      const latlngs = events.map(e => [Number(e.portal_lat), Number(e.portal_lng)]);
      allLatLng.push(...latlngs);
      L.polyline(latlngs, { color: player.color || '#ccc', weight: 2, opacity: 0.35 }).addTo(map);
      const marker = L.marker(latlngs[0], { icon: makeIcon(player), title: player.name || 'Player' }).addTo(map);
      playerStates.push({ player, events, marker });
    });

    if (!playerStates.length) {
      if (clockEl) clockEl.textContent = 'No replay data';
      return;
    }
    if (allLatLng.length) {
      map.fitBounds(L.latLngBounds(allLatLng), { padding: [24, 24] });
    }
    if (legendEl) {
      legendEl.innerHTML = playerStates.map(ps =>
        '<span><span class="player-dot" style="background:'+ (ps.player.color || '#fff') +'"></span>'+ (ps.player.name || 'Player') +'</span>'
      ).join('');
    }

    let playing = false;
    let speed = Number(speedEl ? speedEl.value : 1) || 1;
    let currentTs = minTs;
    let lastTick = performance.now();
    if (timelineEl) {
      timelineEl.min = String(minTs);
      timelineEl.max = String(maxTs);
      timelineEl.value = String(minTs);
    }

    const update = () => {
      playerStates.forEach((ps) => {
        const ev = ps.events;
        let i = 0;
        while (i < ev.length - 1 && ev[i + 1]._t <= currentTs) i++;
        const a = ev[i];
        const b = ev[Math.min(i + 1, ev.length - 1)];
        let lat = Number(a.portal_lat);
        let lng = Number(a.portal_lng);
        if (b && b._t > a._t && currentTs > a._t && currentTs < b._t) {
          const t = (currentTs - a._t) / (b._t - a._t);
          lat = Number(a.portal_lat) + (Number(b.portal_lat) - Number(a.portal_lat)) * t;
          lng = Number(a.portal_lng) + (Number(b.portal_lng) - Number(a.portal_lng)) * t;
        }
        ps.marker.setLatLng([lat, lng]);
      });
      if (timelineEl) timelineEl.value = String(currentTs);
      if (clockEl) clockEl.textContent = fmt(currentTs);
    };

    const tick = (now) => {
      const dt = now - lastTick;
      lastTick = now;
      if (playing) {
        currentTs += dt * speed;
        if (currentTs >= maxTs) {
          currentTs = maxTs;
          playing = false;
        }
        update();
      }
      requestAnimationFrame(tick);
    };

    if (playBtn) playBtn.addEventListener('click', () => { playing = true; });
    if (pauseBtn) pauseBtn.addEventListener('click', () => { playing = false; });
    if (resetBtn) resetBtn.addEventListener('click', () => { playing = false; currentTs = minTs; update(); });
    if (speedEl) speedEl.addEventListener('change', () => { speed = Number(speedEl.value) || 1; });
    if (timelineEl) timelineEl.addEventListener('input', () => {
      currentTs = Number(timelineEl.value);
      if (!Number.isFinite(currentTs)) currentTs = minTs;
      update();
    });

    update();
    requestAnimationFrame((t) => { lastTick = t; tick(t); });
  }).catch((err) => {
    const el = document.getElementById('clock');
    if (el) el.textContent = 'Replay load failed';
    console.error('[battle-report-replay] load failed', err);
  });
})();
