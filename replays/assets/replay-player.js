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
  const replayMinuteMs = 60 * 1000;

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
  const esc = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const toNum = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const fmtDist = (km) => {
    const value = Number(km);
    if (!Number.isFinite(value)) return '0.00 km';
    return value.toFixed(2) + ' km';
  };
  const fmtInt = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed).toLocaleString() : '0';
  };
  const fmtRealScale = (speed) => {
    const replayMinutesPerRealSecond = Number(speed) || 1;
    return '1s real = ' + replayMinutesPerRealSecond + 'm replay';
  };
  const debriefHost = document.createElement('div');
  debriefHost.id = 'debrief';
  debriefHost.innerHTML = '<div id="debriefCard"></div>';
  document.body.appendChild(debriefHost);
  const debriefCard = document.getElementById('debriefCard');

  Promise.all([
    fetch(replayDataPath).then(r => r.json()),
    fetch(iconsPath).then(r => r.json()).catch(() => ({icons:{}}))
  ]).then(([data, iconManifest]) => {
    if (titleEl) titleEl.textContent = data.title || 'Replay';
    const map = L.map('map', { zoomControl: true }).setView([0, 0], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, attribution: '&copy; OpenStreetMap &copy; CARTO'
    }).addTo(map);

    const icons = (iconManifest && iconManifest.icons) ? iconManifest.icons : {};
    const effects = (iconManifest && iconManifest.effects) ? iconManifest.effects : {};
    const playerStates = [];
    let minTs = Number.POSITIVE_INFINITY;
    let maxTs = Number.NEGATIVE_INFINITY;
    const allLatLng = [];
    const effectLayer = L.layerGroup().addTo(map);
    let lastEffectTs = null;
    const activeEffectTimeouts = new Set();

    const darkenColor = (color) => {
      const hex = String(color || '#888888').replace('#', '');
      const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex.padEnd(6, '8').slice(0, 6);
      const parts = [0, 2, 4].map((offset) => Math.max(0, Math.min(255, parseInt(full.slice(offset, offset + 2), 16) || 0)));
      return '#' + parts.map((value) => Math.max(0, Math.floor(value * 0.72)).toString(16).padStart(2, '0')).join('');
    };
    const makeIcon = (player) => {
      const iconMeta = player.icon_key ? icons[player.icon_key] : null;
      const imgSrc = iconMeta ? (iconMeta.data_uri || iconMeta.source_url || '') : '';
      const color = player.color || '#ffffff';
      const border = darkenColor(color);
      const size = 36;
      const fontSize = Math.max(10, Math.round(size * 0.39));
      const initials = String(player.name || '?').substring(0, 2).toUpperCase();
      if (imgSrc) {
        return L.divIcon({
          className: 'replay-player-marker',
          html: '<div style="width:'+size+'px;height:'+size+'px;border-radius:50%;background-color:'+color+';border:2px solid '+border+';overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:'+fontSize+'px;text-shadow:1px 1px 2px rgba(0,0,0,0.5);box-shadow:0 2px 5px rgba(0,0,0,0.35)"><img src="'+imgSrc+'" alt="" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:50%;position:absolute;top:0;left:0;"></div>',
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2]
        });
      }
      return L.divIcon({
        className: 'replay-player-marker',
        html: '<div style="width:'+size+'px;height:'+size+'px;border-radius:50%;background-color:'+color+';border:2px solid '+border+';display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:'+fontSize+'px;text-shadow:1px 1px 2px rgba(0,0,0,0.5);box-shadow:0 2px 5px rgba(0,0,0,0.35)">'+esc(initials)+'</div>',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
      });
    };
    const buildPathMetrics = (path) => {
      const points = Array.isArray(path) ? path : [];
      const segmentDistances = [];
      const cumulativeDistances = [];
      let totalDistance = 0;
      for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1];
        const b = points[i];
        const dist = Math.hypot(Number(b[0]) - Number(a[0]), Number(b[1]) - Number(a[1]));
        segmentDistances.push(dist);
        totalDistance += dist;
        cumulativeDistances.push(totalDistance);
      }
      return { segmentDistances, cumulativeDistances, totalDistance };
    };
    const interpolateAlongPath = (pathData, progress) => {
      const pathPoints = Array.isArray(pathData && pathData.path) ? pathData.path : [];
      if (!pathPoints.length) return null;
      if (pathPoints.length === 1) return [Number(pathPoints[0][0]), Number(pathPoints[0][1])];
      if (progress <= 0) return [Number(pathPoints[0][0]), Number(pathPoints[0][1])];
      if (progress >= 1) {
        const last = pathPoints[pathPoints.length - 1];
        return [Number(last[0]), Number(last[1])];
      }
      const metrics = pathData.metrics && Number(pathData.metrics.totalDistance) > 0
        ? pathData.metrics
        : buildPathMetrics(pathPoints);
      if (!metrics.totalDistance || !Array.isArray(metrics.cumulativeDistances) || !metrics.cumulativeDistances.length) {
        const idx = Math.min(pathPoints.length - 2, Math.max(0, Math.floor((pathPoints.length - 1) * progress)));
        const local = ((pathPoints.length - 1) * progress) - idx;
        const a = pathPoints[idx];
        const b = pathPoints[idx + 1];
        return [
          Number(a[0]) + (Number(b[0]) - Number(a[0])) * local,
          Number(a[1]) + (Number(b[1]) - Number(a[1])) * local
        ];
      }
      const targetDistance = metrics.totalDistance * progress;
      let idx = metrics.cumulativeDistances.findIndex((value) => value >= targetDistance);
      if (idx < 0) idx = metrics.cumulativeDistances.length - 1;
      const prevCum = idx === 0 ? 0 : metrics.cumulativeDistances[idx - 1];
      const segDist = metrics.segmentDistances[idx] || 0;
      const local = segDist > 0 ? Math.max(0, Math.min(1, (targetDistance - prevCum) / segDist)) : 0;
      const a = pathPoints[idx];
      const b = pathPoints[Math.min(idx + 1, pathPoints.length - 1)];
      return [
        Number(a[0]) + (Number(b[0]) - Number(a[0])) * local,
        Number(a[1]) + (Number(b[1]) - Number(a[1])) * local
      ];
    };
    const spawnImageEffect = (lat, lng, src, size, durationMs, anchorY) => {
      if (!src || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const marker = L.marker([lat, lng], {
        interactive: false,
        keyboard: false,
        icon: L.icon({
          iconUrl: src,
          iconSize: [size, size],
          iconAnchor: [Math.round(size / 2), anchorY]
        })
      }).addTo(effectLayer);
      const timeoutId = window.setTimeout(() => {
        try { effectLayer.removeLayer(marker); } catch (_) {}
        activeEffectTimeouts.delete(timeoutId);
      }, durationMs);
      activeEffectTimeouts.add(timeoutId);
    };
    const clearEffects = () => {
      effectLayer.clearLayers();
      activeEffectTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      activeEffectTimeouts.clear();
    };
    const maybeEmitEffects = (previousTs, nextTs) => {
      if (!Number.isFinite(previousTs) || !Number.isFinite(nextTs) || nextTs < previousTs) return;
      playerStates.forEach((ps) => {
        ps.events.forEach((event) => {
          const eventTs = event._t;
          if (!(eventTs > previousTs && eventTs <= nextTs)) return;
          const lat = Number(event.portal_lat);
          const lng = Number(event.portal_lng);
          const changeType = String(event.change_type || event.event_type || '').toUpperCase();
          if (changeType === '-RES' && effects.explosion) {
            spawnImageEffect(lat, lng, effects.explosion, 96, 2000, 96);
          }
          if ((changeType === 'CAP' || changeType === '+RES' || changeType === '-RES') && effects.smoke) {
            spawnImageEffect(lat, lng, effects.smoke, 92, 3200, 92);
          }
        });
      });
    };
    const renderDebrief = () => {
      if (!debriefCard) return;
      const debrief = data.debrief || {};
      const playerStats = Array.isArray(debrief.player_stats) ? debrief.player_stats : [];
      const factionRows = Array.isArray(debrief.faction_summary?.rows) ? debrief.faction_summary.rows : [];
      const timeLabel = esc((debrief.time_period && debrief.time_period.display) || '');
      const reportTitle = esc(debrief.title || data.title || 'Replay Debrief');
      const totalCaps = playerStats.reduce((sum, row) => sum + toNum(row.cap_events), 0);
      const totalDistanceKm = playerStats.reduce((sum, row) => sum + toNum(row.distance_km), 0);
      const totalEvents = playerStats.reduce((sum, row) => sum + toNum(row.total_events), 0);
      const playerRows = playerStats.length
        ? playerStats.map((row) => {
            const team = esc(row.team || 'N');
            return '<tr>'
              + '<td>' + esc(row.name || 'Player') + '</td>'
              + '<td><span class="debrief-tag ' + team + '">' + team + '</span></td>'
              + '<td>' + fmtInt(row.cap_events) + '</td>'
              + '<td>' + fmtInt(row.field_events) + '</td>'
              + '<td>' + fmtInt(row.link_events) + '</td>'
              + '<td>' + fmtInt(row.total_events) + '</td>'
              + '<td>' + fmtDist(row.distance_km) + '</td>'
              + '</tr>';
          }).join('')
        : '<tr><td colspan="7">No player statistics available.</td></tr>';
      const factionTable = factionRows.length
        ? '<table class="debrief-table"><thead><tr><th>Faction</th><th>Active</th><th>MU</th><th>Captures</th><th>Enemy Caps</th></tr></thead><tbody>'
          + factionRows.map((row) => '<tr>'
            + '<td>' + esc(row.faction || '') + '</td>'
            + '<td>' + fmtInt(row.active_players && row.active_players.value) + '</td>'
            + '<td>' + fmtInt(row.total_mu && row.total_mu.value) + '</td>'
            + '<td>' + fmtInt(row.portal_captures && row.portal_captures.value) + '</td>'
            + '<td>' + fmtInt(row.enemy_captures && row.enemy_captures.value) + '</td>'
            + '</tr>').join('')
          + '</tbody></table>'
        : '';
      debriefCard.innerHTML = ''
        + '<div class="debrief-header">'
        + '  <div><h2>' + reportTitle + '</h2><div class="debrief-subtitle">' + timeLabel + '</div></div>'
        + '  <button id="debriefCloseBtn" class="btn secondary" type="button">Close</button>'
        + '</div>'
        + '<div class="debrief-grid">'
        + '  <div class="debrief-stat"><div class="debrief-stat-label">CAP Events</div><div class="debrief-stat-value">' + fmtInt(totalCaps) + '</div></div>'
        + '  <div class="debrief-stat"><div class="debrief-stat-label">Distance Traveled</div><div class="debrief-stat-value">' + fmtDist(totalDistanceKm) + '</div></div>'
        + '  <div class="debrief-stat"><div class="debrief-stat-label">Total Events</div><div class="debrief-stat-value">' + fmtInt(totalEvents) + '</div></div>'
        + '  <div class="debrief-stat"><div class="debrief-stat-label">Playback Scale</div><div class="debrief-stat-value" style="font-size:18px;">' + esc(fmtRealScale(speed)) + '</div></div>'
        + '</div>'
        + (factionTable ? '<div class="debrief-section-title">Faction Summary</div>' + factionTable : '')
        + '<div class="debrief-section-title">Player Debrief</div>'
        + '<table class="debrief-table"><thead><tr><th>Player</th><th>Team</th><th>CAP</th><th>Fields</th><th>Links</th><th>Events</th><th>Distance</th></tr></thead><tbody>' + playerRows + '</tbody></table>';
      debriefHost.style.display = 'flex';
      const closeBtn = document.getElementById('debriefCloseBtn');
      if (closeBtn) closeBtn.onclick = () => { debriefHost.style.display = 'none'; };
    };

    (data.players || []).forEach((player) => {
      const events = (player.events || [])
        .map(e => ({...e, _t: parseTs(e.timestamp)}))
        .filter(e => Number.isFinite(e._t) && Number.isFinite(Number(e.portal_lat)) && Number.isFinite(Number(e.portal_lng)))
        .sort((a,b) => a._t - b._t);
      if (!events.length) return;
      minTs = Math.min(minTs, events[0]._t);
      maxTs = Math.max(maxTs, events[events.length - 1]._t);
      const paths = Array.isArray(player.paths) ? player.paths : [];
      const latlngs = paths.length
        ? paths.flatMap((segment) => Array.isArray(segment && segment.path) ? segment.path.map((pt) => [Number(pt[0]), Number(pt[1])]) : [])
        : events.map(e => [Number(e.portal_lat), Number(e.portal_lng)]);
      allLatLng.push(...latlngs);
      if (latlngs.length > 1) {
        L.polyline(latlngs, { color: player.color || '#ccc', weight: 3, opacity: 0.35 }).addTo(map);
      }
      const startLatLng = latlngs[0] || [Number(events[0].portal_lat), Number(events[0].portal_lng)];
      const marker = L.marker(startLatLng, { icon: makeIcon(player), title: player.name || 'Player' }).addTo(map);
      playerStates.push({ player, events, paths, marker });
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
    lastEffectTs = minTs;
    if (timelineEl) {
      timelineEl.min = String(minTs);
      timelineEl.max = String(maxTs);
      timelineEl.value = String(minTs);
    }

    const update = () => {
      playerStates.forEach((ps) => {
        let lat = null;
        let lng = null;
        if (Array.isArray(ps.paths) && ps.paths.length) {
          for (let i = 0; i < ps.paths.length; i += 1) {
            const pathData = ps.paths[i] || {};
            const fromTimeMs = Number(pathData.effectiveFromTimeMs != null ? pathData.effectiveFromTimeMs : pathData.fromTimeMs);
            const toTimeMs = Number(pathData.toTimeMs);
            const movementEndTimeMs = Number(pathData.movementEndTimeMs != null ? pathData.movementEndTimeMs : toTimeMs);
            if (!Number.isFinite(fromTimeMs) || !Number.isFinite(toTimeMs)) continue;
            if (currentTs < fromTimeMs) continue;
            if (currentTs <= toTimeMs) {
              const travelWindowMs = Math.max(0, movementEndTimeMs - fromTimeMs);
              const elapsedTravelMs = Math.max(0, Math.min(currentTs, movementEndTimeMs) - fromTimeMs);
              const progress = travelWindowMs > 0 ? Math.max(0, Math.min(1, elapsedTravelMs / travelWindowMs)) : 1;
              const point = interpolateAlongPath(pathData, progress);
              if (point) {
                lat = point[0];
                lng = point[1];
              }
              break;
            }
            if (i === ps.paths.length - 1 && currentTs > toTimeMs) {
              const lastPoint = Array.isArray(pathData.path) && pathData.path.length ? pathData.path[pathData.path.length - 1] : null;
              if (lastPoint) {
                lat = Number(lastPoint[0]);
                lng = Number(lastPoint[1]);
              }
            }
          }
        }
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          const ev = ps.events;
          let i = 0;
          while (i < ev.length - 1 && ev[i + 1]._t <= currentTs) i++;
          const a = ev[i];
          const b = ev[Math.min(i + 1, ev.length - 1)];
          lat = Number(a.portal_lat);
          lng = Number(a.portal_lng);
          if (b && b._t > a._t && currentTs > a._t && currentTs < b._t) {
            const t = (currentTs - a._t) / (b._t - a._t);
            lat = Number(a.portal_lat) + (Number(b.portal_lat) - Number(a.portal_lat)) * t;
            lng = Number(a.portal_lng) + (Number(b.portal_lng) - Number(a.portal_lng)) * t;
          }
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
        const previousTs = currentTs;
        currentTs += dt * speed * 60;
        if (currentTs >= maxTs) {
          currentTs = maxTs;
          playing = false;
          maybeEmitEffects(lastEffectTs, currentTs);
          lastEffectTs = currentTs;
          update();
          renderDebrief();
        } else {
          maybeEmitEffects(lastEffectTs, currentTs);
          lastEffectTs = currentTs;
          update();
        }
      }
      requestAnimationFrame(tick);
    };

    if (playBtn) playBtn.addEventListener('click', () => { debriefHost.style.display = 'none'; playing = true; });
    if (pauseBtn) pauseBtn.addEventListener('click', () => { playing = false; });
    if (resetBtn) resetBtn.addEventListener('click', () => { playing = false; currentTs = minTs; lastEffectTs = minTs; clearEffects(); debriefHost.style.display = 'none'; update(); });
    if (speedEl) speedEl.addEventListener('change', () => { speed = Number(speedEl.value) || 1; });
    if (timelineEl) timelineEl.addEventListener('input', () => {
      clearEffects();
      currentTs = Number(timelineEl.value);
      if (!Number.isFinite(currentTs)) currentTs = minTs;
      lastEffectTs = currentTs;
      debriefHost.style.display = 'none';
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
