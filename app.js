let audioEngine, fileUploadSystem, visualizer, backgroundSystem,
    playlistManager, contextMenu, registrationSystem;
let isEcoMode = false;
let lastProgressUpdate = 0;
let lyricsLoadToken = 0;
let coverBgEnabled = false;
let coverAccentEnabled = false;
let currentCoverPalette = null;

function ensureGlobe() {
    if (window.globeView) return window.globeView;
    window.globeView = new GlobeView();
    return window.globeView;
}

class MiniViz {
    constructor(audioEngine) {
        this.audioEngine = audioEngine;
        this.canvas = document.getElementById('topbarViz');
        if (!this.canvas) { this.disabled = true; return; }

        this.canvas.innerHTML = '';
        const c = document.createElement('canvas');
        this.canvas.appendChild(c);
        this.ctx = c.getContext('2d');

        this.mode = 'bars';
        this.modes = ['bars', 'wave', 'pulse'];
        this.animId = null;
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);

        this._resize();
        window.addEventListener('resize', () => this._resize());

        this.canvas.addEventListener('click', () => this._cycleMode());

        this._tick = this._tick.bind(this);
        this._start();
    }

    _resize() {
        if (!this.ctx) return;
        const r = this.canvas.getBoundingClientRect();
        const w = Math.max(1, Math.round(r.width));
        const h = Math.max(1, Math.round(r.height));
        this.canvas.firstElementChild.width  = w * this.dpr;
        this.canvas.firstElementChild.height = h * this.dpr;
        this.canvas.firstElementChild.style.width  = w + 'px';
        this.canvas.firstElementChild.style.height = h + 'px';
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.W = w;
        this.H = h;
    }

    _cycleMode() {
        const i = this.modes.indexOf(this.mode);
        this.mode = this.modes[(i + 1) % this.modes.length];
        this.canvas.title = `Визуализатор: ${this.mode === 'bars' ? 'Столбики' : this.mode === 'wave' ? 'Волна' : 'Пульс'}`;
    }

    _start() {
        if (this.animId || this.disabled) return;
        this.animId = requestAnimationFrame(this._tick);
    }

    _stop() {
        if (this.animId) {
            cancelAnimationFrame(this.animId);
            this.animId = null;
        }
        if (this.ctx) this.ctx.clearRect(0, 0, this.W, this.H);
    }

    _tick() {
        this.animId = requestAnimationFrame(this._tick);
        if (isEcoMode) { this._stop(); return; }

        const eng = this.audioEngine;
        const data = eng && eng.getFrequencyData ? eng.getFrequencyData() : null;
        const playing = eng && eng.isPlaying;

        this.ctx.clearRect(0, 0, this.W, this.H);

        if (!playing || !data || data.length === 0) {
            this._drawIdle();
            return;
        }

        if (this.mode === 'bars')       this._drawBars(data);
        else if (this.mode === 'wave')  this._drawWave(data);
        else                            this._drawPulse(data);
    }

    _drawIdle() {
        const [r, g, b] = (typeof getAccentRGB === 'function') ? getAccentRGB() : [255, 212, 0];
        this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.25)`;
        const W = this.W, H = this.H;
        // три маленькие застывшие полоски
        const bw = 3, gap = 3;
        const totalW = bw * 3 + gap * 2;
        const startX = (W - totalW) / 2;
        const heights = [4, 8, 6];
        heights.forEach((h, i) => {
            this.ctx.fillRect(startX + i * (bw + gap), H - 4 - h, bw, h);
        });
    }

    _drawBars(data) {
        const [r, g, b] = getAccentRGB();
        this.ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;

        const W = this.W, H = this.H;
        const barCount = 3;
        const gap = 3;
        const bw = Math.max(2, Math.floor((W - gap * (barCount - 1) - 8) / barCount));
        const totalW = bw * barCount + gap * (barCount - 1);
        const startX = (W - totalW) / 2;
        const maxH = H - 8;

        for (let i = 0; i < barCount; i++) {
            // низкие частоты берём с индексами 1, 3, 6 (bass/mid/high)
            const idx = Math.floor((i + 1) * data.length / (barCount + 2));
            const v = Math.max(4, (data[idx] / 255) * maxH);
            this.ctx.fillRect(startX + i * (bw + gap), H - 4 - v, bw, v);
        }
    }

    _drawWave(data) {
        const [r, g, b] = getAccentRGB();
        const W = this.W, H = this.H;
        const mid = H / 2;

        // 8 сегментов из данных
        const N = 10;
        const step = Math.max(1, Math.floor(data.length / N));
        const pts = [];
        for (let i = 0; i < N; i++) {
            const v = data[i * step] / 255;
            pts.push({
                x: (i / (N - 1)) * (W - 4) + 2,
                y: mid - v * (mid - 3)
            });
        }

        this.ctx.beginPath();
        this.ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) this.ctx.lineTo(pts[i].x, pts[i].y);

        this.ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
        this.ctx.lineWidth = 1.5;
        this.ctx.lineJoin = 'round';
        this.ctx.lineCap = 'round';
        this.ctx.stroke();

        // отражение снизу (полупрозрачное)
        this.ctx.beginPath();
        this.ctx.moveTo(pts[0].x, mid + (mid - pts[0].y));
        for (let i = 1; i < pts.length; i++) {
            this.ctx.lineTo(pts[i].x, mid + (mid - pts[i].y));
        }
        this.ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.35)`;
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
    }

    _drawPulse(data) {
        const [r, g, b] = getAccentRGB();
        const W = this.W, H = this.H;
        const cx = W / 2, cy = H / 2;

        const bassCount = Math.max(1, Math.floor(data.length / 8));
        let sum = 0;
        for (let i = 0; i < bassCount; i++) sum += data[i];
        const bass = sum / bassCount / 255;

        const radius = 3 + bass * (Math.min(W, H) / 2 - 4);
        const glow = 4 + bass * 8;

        this.ctx.beginPath();
        this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(0.4 + bass * 0.6).toFixed(2)})`;
        this.ctx.fill();

        this.ctx.beginPath();
        this.ctx.arc(cx, cy, radius + 1, 0, Math.PI * 2);
        this.ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${(0.4 * bass).toFixed(2)})`;
        this.ctx.lineWidth = glow * 0.5;
        this.ctx.stroke();
    }
}

async function init() {
    registrationSystem = new RegistrationSystem();
    window.trackStorage = new TrackStorage();
    audioEngine = new AudioEngine();
    audioEngine.setStorage(window.trackStorage);
    playlistManager    = new PlaylistManager();
    fileUploadSystem   = new FileUploadSystem(audioEngine);
    visualizer         = new Visualizer(audioEngine);
    backgroundSystem   = new BackgroundSystem();
    backgroundSystem.setAudioEngine(audioEngine);
    window.trackQueue  = new TrackQueue(audioEngine);
    contextMenu        = new ContextMenu(audioEngine, playlistManager);

    audioEngine.onPlay = () => {
        if (!isEcoMode) visualizer.start();
        if (window.trackQueue) window.trackQueue.update();

        const track = audioEngine.playlist[audioEngine.currentIndex];
        if (track) {
            track.lastPlayedAt = Date.now();
            if (audioEngine.storage) {
                audioEngine.storage.updateMetadata(track).catch(() => {});
            }
            renderSidebarRecent();
            renderSidebarStats();
        }
    };
    
    audioEngine.onPlayCounted = () => {
        renderSidebarRecent();
        renderSidebarStats();
        buildTop100();
        buildChartPlaylists();
    };

    audioEngine.onPause = () => {
        visualizer.stop();
    };

    audioEngine.onTrackChange = (track) => {
        refreshCoverAppearance(track);
        updateStageCover(track);
        const modal = document.getElementById('lyricsModal');
        if (modal && modal.classList.contains('active')) {
            openLyrics(audioEngine.currentIndex, { isRefresh: true });
        }
    };

    window.miniPlayer = new MiniPlayer(audioEngine);
    window.miniViz = new MiniViz(audioEngine);

    let _coverRerenderTimer = null;
    audioEngine.onCoverLoaded = (track) => {
        if (audioEngine.playlist[audioEngine.currentIndex] === track) {
            audioEngine._updatePlayerCover(track);
            refreshCoverAppearance(track);
        }

        clearTimeout(_coverRerenderTimer);
        _coverRerenderTimer = setTimeout(() => {
            if (fileUploadSystem) fileUploadSystem.updateTrackListUI();
            if (window.trackQueue) window.trackQueue.render();
        }, 120);
    };

    window.audioEngine       = audioEngine;
    window.playlistManager   = playlistManager;
    window.fileUploadSystem  = fileUploadSystem;
    window.contextMenu       = contextMenu;
    window.matchMedia('(prefers-reduced-motion: reduce)')
        .addEventListener('change', respectReducedMotion);
    window.equalizerUI = new EqualizerUI(audioEngine);
    loadEcoState();
    const savedPreset = localStorage.getItem('colorPreset') || 'yellow';
    applyColorPreset(savedPreset);
    window.backgroundManager = new BackgroundManager(audioEngine);

    renderColorSwatches();
    buildChartPlaylists();
    buildTop100();
    buildPlaylistsModal();
    loadSettings();
    setupEvents();
    updateCacheSize();
    setupCardTilt();
    setupCustomCursor();
    window.tipPanel = new TipPanel();
    window.LyricsScene = LyricsScene;
    LyricsScene.init();
    audioEngine.updateVolumeUI();

    if (window.electronAPI?.isElectron) {
        document.body.classList.add('is-electron');
        if (window.electronAPI.platform === 'darwin') {
            document.body.classList.add('is-mac');
        }
    }

    audioEngine.audio.addEventListener('loadedmetadata', () => {
        lastBufferPct = 0;
        if (bufferEl) bufferEl.style.width = '0%';
    });

    backgroundSystem.start();

    // запуск глобуса на главной (только если не в эко)
    setTimeout(() => {
        if (isEcoMode) return;
        const g = ensureGlobe();
        if (g) {
            g.onRegionSelect = (regionIdx) => openRegionPage(regionIdx);
        }
        g.resize();
        g.start();
    }, 300);

    let restored = 0;

    try {
        restored = await audioEngine.restoreFromStorage();
    } catch (e) {
        console.warn('Восстановление треков не удалось:', e);
    }

    fileUploadSystem.updateTrackListUI();
    if (window.trackQueue) window.trackQueue.render();

    renderSidebarAll();
    buildChartPlaylists();
    buildTop100();

    if (restored > 0) {
        showNotification(`Загружено треков из хранилища: ${restored}`);
    }

    if (typeof positionBottomNav === 'function') {
        setTimeout(positionBottomNav, 200);
    }

        const bufferEl = document.getElementById('progressBuffer');
    let lastBufferPct = 0;

    function updateLoop(timestamp) {
        if (audioEngine.isPlaying) {
            const threshold = isEcoMode ? 33.33 : 16.66;
            if (timestamp - lastProgressUpdate >= threshold) {
                lastProgressUpdate = timestamp;
                const a = audioEngine.audio;
                const cur = a.currentTime;
                const dur = a.duration || 0;
                const pct = dur > 0 ? (cur / dur) * 100 : 0;
                document.getElementById('progressFill').style.width = pct + '%';
                if (dur > 0 && bufferEl) {
                    let bufEnd = 0;
                    try {
                        if (a.buffered.length > 0) {
                            bufEnd = a.buffered.end(a.buffered.length - 1);
                        }
                    } catch (e) {}

                    const bufPct = bufEnd > 0 ? Math.min(100, (bufEnd / dur) * 100) : 0;
                    if (bufPct > lastBufferPct) {
                        lastBufferPct = bufPct;
                        bufferEl.style.width = bufPct + '%';
                    }
                }

                document.getElementById('currentTime').textContent =
                    audioEngine.formatTime(cur);
                if (dur > 0) {
                    document.getElementById('totalTime').textContent =
                        audioEngine.formatTime(dur);
                }
            }
        }
        requestAnimationFrame(updateLoop);
    }
    requestAnimationFrame(updateLoop);
}

async function updateCacheSize() {
    if (!window.trackStorage) return;
    const est = await window.trackStorage.estimateSize();
    const el = document.getElementById('cacheSize');
    if (!el) return;
    if (est && est.usage) {
        el.textContent = formatBytes(est.usage);
    } else {
        el.textContent = '0 МБ';
    }
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' МБ';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' ГБ';
}

// ===== SIDEBAR: недавнее / статистика / плейлисты =====

function _relativeTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1)  return 'только что';
    if (m < 60) return `${m} мин`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} ч`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d} дн`;
    return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function renderSidebarRecent() {
    const wrap = document.getElementById('sidebarRecent');
    if (!wrap || !audioEngine) return;

    const items = audioEngine.playlist
        .filter(t => t.lastPlayedAt)
        .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
        .slice(0, 5);

    if (items.length === 0) {
        wrap.innerHTML = `<div class="sidebar-empty">Ещё ничего<br>не слушали</div>`;
        return;
    }

    wrap.innerHTML = '';
    items.forEach(track => {
        const row = document.createElement('div');
        row.className = 'sidebar-recent-item';
        const url = audioEngine.ensureCoverUrl(track);
        const coverStyle = url ? `style="background-image:url('${url}')"` : '';
        const coverClass = url ? 'sidebar-recent-cover has-image' : 'sidebar-recent-cover';

        row.innerHTML = `
            <div class="${coverClass}" ${coverStyle}><span>♪</span></div>
            <div class="sidebar-recent-info">
                <div class="sidebar-recent-title">${escapeHtml(track.title)}</div>
                <div class="sidebar-recent-artist">${escapeHtml(track.artist)}</div>
            </div>
            <div class="sidebar-recent-time">${_relativeTime(track.lastPlayedAt)}</div>
        `;

        row.addEventListener('click', () => {
            const idx = audioEngine.playlist.indexOf(track);
            if (idx < 0) return;
            audioEngine.currentIndex = idx;
            audioEngine.loadCurrentTrack();
            audioEngine.play();
        });

        wrap.appendChild(row);
    });
}

function renderSidebarStats() {
    const wrap = document.getElementById('sidebarStats');
    if (!wrap || !audioEngine) return;

    const list = audioEngine.playlist;

    let totalSeconds = 0;
    let totalPlays   = 0;
    const artists = new Set();

    list.forEach(t => {
        const plays = t.playCount || 0;
        totalPlays += plays;
        if (t.duration) totalSeconds += t.duration * plays;
        if (t.artist && t.artist !== 'Неизвестный исполнитель') artists.add(t.artist);
    });

    const hours   = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const timeStr = hours > 0 ? `${hours}ч ${minutes}м` : `${minutes}м`;

    wrap.innerHTML = `
        <div class="sidebar-stat">
            <div class="sidebar-stat-value">${timeStr}</div>
            <div class="sidebar-stat-label">Прослушано</div>
        </div>
        <div class="sidebar-stat">
            <div class="sidebar-stat-value">${list.length}</div>
            <div class="sidebar-stat-label">Треков</div>
        </div>
        <div class="sidebar-stat">
            <div class="sidebar-stat-value">${artists.size}</div>
            <div class="sidebar-stat-label">Артистов</div>
        </div>
        <div class="sidebar-stat">
            <div class="sidebar-stat-value">${totalPlays}</div>
            <div class="sidebar-stat-label">Запусков</div>
        </div>
    `;
}

function renderSidebarPlaylists() {
    const wrap = document.getElementById('sidebarPlaylists');
    const countEl = document.getElementById('sidebarPlaylistsCount');
    if (!wrap || !window.playlistManager) return;

    const playlists = window.playlistManager.getAllPlaylists();

    if (countEl) {
        countEl.textContent = playlists.length > 0 ? String(playlists.length) : '';
    }

    if (playlists.length === 0) {
        wrap.innerHTML = `<div class="sidebar-empty">Плейлистов<br>пока нет</div>`;
        return;
    }

    wrap.innerHTML = '';
    playlists.slice(0, 8).forEach(pl => {
        const row = document.createElement('div');
        row.className = 'sidebar-playlist-item';
        row.innerHTML = `
            <div class="sidebar-playlist-icon">🎵</div>
            <div class="sidebar-playlist-info">
                <div class="sidebar-playlist-name">${escapeHtml(pl.name)}</div>
                <div class="sidebar-playlist-count">${pl.tracks.length} ${pluralTracks(pl.tracks.length)}</div>
            </div>
        `;
        row.addEventListener('click', () => {
            if (typeof window.playPlaylist === 'function') {
                window.playPlaylist(pl);
            }
        });
        wrap.appendChild(row);
    });
}

function renderSidebarAll() {
    renderSidebarRecent();
    renderSidebarStats();
    renderSidebarPlaylists();
}
window.renderSidebarAll = renderSidebarAll;
window.renderSidebarPlaylists = renderSidebarPlaylists;

// ===== BOTTOM NAV (mbox mode) =====

function applyNavMode(mode) {
    const m = (mode === 'mbox') ? 'mbox' : 'classic';
    document.body.classList.toggle('nav-mode-mbox', m === 'mbox');
    localStorage.setItem('navMode', m);

    document.querySelectorAll('#navModeRadio .radio-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.value === m);
    });

    // док: если классика — спрятан и inert; если mbox — покажем на пару секунд
    const nav = document.getElementById('bottomNav');
    if (nav) {
        if (m === 'mbox') {
            nav.removeAttribute('inert');
        } else {
            nav.classList.remove('visible');
            nav.setAttribute('inert', '');
        }
    }

    // после смены layout — пересобрать глобус и перепозиционировать док
    if (window.globeView) {
        setTimeout(() => {
            try { window.globeView.resize(); } catch (e) {}
        }, 120);
    }
    if (typeof positionBottomNav === 'function') {
        setTimeout(positionBottomNav, 150);
    }
}
window.applyNavMode = applyNavMode;

function positionBottomNav() {
    const nav = document.getElementById('bottomNav');
    if (!nav) return;

    const stage = document.getElementById('stageColumn');
    const homePage = document.getElementById('page-home');

    // если на главной и stage виден — центрируем под глобусом
    if (stage && homePage && homePage.classList.contains('active')) {
        const r = stage.getBoundingClientRect();
        if (r.width > 0) {
            nav.style.left = (r.left + r.width / 2) + 'px';
            return;
        }
    }

    // иначе — центр вьюпорта
    nav.style.left = '50%';
}
window.positionBottomNav = positionBottomNav;

function setupBottomNav() {
    const nav = document.getElementById('bottomNav');
    if (!nav) return;

    positionBottomNav();
    window.addEventListener('resize', positionBottomNav);

    let hideTimer = null;

    const setInert = (on) => {
        if (on) nav.setAttribute('inert', '');
        else nav.removeAttribute('inert');
    };

    const show = () => {
        clearTimeout(hideTimer);
        nav.classList.add('visible');
        setInert(false);
    };
    const scheduleHide = (delay = 700) => {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            if (!nav.matches(':hover')) {
                nav.classList.remove('visible');
                setInert(true);
            }
        }, delay);
    };

    document.addEventListener('mousemove', (e) => {
        if (!document.body.classList.contains('nav-mode-mbox')) return;
        const fromBottom = window.innerHeight - e.clientY;
        if (fromBottom < 110) show();
        else if (!nav.matches(':hover')) scheduleHide(900);
    });

    document.addEventListener('mouseleave', () => {
        if (!document.body.classList.contains('nav-mode-mbox')) return;
        scheduleHide(200);
    });

    nav.addEventListener('mouseenter', show);
    nav.addEventListener('mouseleave', () => scheduleHide(500));

    nav.addEventListener('click', () => {
        scheduleHide(400);
    });

    // при старте в mbox-режиме — показываем на 2.5 сек и потом прячем
    if (document.body.classList.contains('nav-mode-mbox')) {
        show();
        scheduleHide(2500);
    } else {
        // по умолчанию (классика) — док спрятан и inert
        setInert(true);
    }
}
window.setupBottomNav = setupBottomNav;

// ===== GLOBAL SEARCH (topbar + Ctrl+K) =====

function setupGlobalSearch() {
    const input     = document.getElementById('globalSearchInput');
    const dropdown  = document.getElementById('topbarSearchDropdown');
    const searchBox = document.getElementById('topbarSearch');
    if (!input || !dropdown) return;

    let activeIdx = -1;
    let results = [];

    const openDropdown = () => {
        dropdown.hidden = false;
        document.body.classList.add('search-open');
    };
    const closeDropdown = () => {
        dropdown.hidden = true;
        dropdown.innerHTML = '';
        activeIdx = -1;
        results = [];
        document.body.classList.remove('search-open');
    };

    const clearSearch = () => {
        input.value = '';
        closeDropdown();
    };

    // ---------- рендер результатов ----------
    const renderResults = (query) => {
        const q = query.trim().toLowerCase();
        if (!q) { closeDropdown(); return; }

        const list = audioEngine?.playlist || [];
        const matched = list
            .map((track, idx) => {
                const t = String(track.title || '').toLowerCase();
                const a = String(track.artist || '').toLowerCase();
                if (!t.includes(q) && !a.includes(q)) return null;
                const score = (t.startsWith(q) ? 3 : 0) + (t.includes(q) ? 1 : 0)
                            + (a.startsWith(q) ? 2 : 0) + (a.includes(q) ? 1 : 0);
                return { track, idx, score };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score)
            .slice(0, 12);

        results = matched;
        activeIdx = matched.length > 0 ? 0 : -1;

        if (matched.length === 0) {
            dropdown.innerHTML = `<div class="sr-status">Ничего не найдено<br>по запросу «<strong>${escapeHtml(query)}</strong>»</div>`;
            openDropdown();
            return;
        }

        const html = [];
        html.push(`<div class="sr-header">${matched.length} ${pluralTracks(matched.length)}</div>`);
        matched.forEach(({ track, idx }, i) => {
            const coverUrl = audioEngine.ensureCoverUrl(track);
            const coverStyle = coverUrl ? `style="background-image:url('${coverUrl}')"` : '';
            const coverClass = coverUrl ? 'sr-cover has-image' : 'sr-cover';
            const dur = track.duration ? audioEngine.formatTime(track.duration) : '';
            html.push(`
                <div class="sr-item ${i === activeIdx ? 'is-active' : ''}" data-idx="${i}" data-track-id="${track.id}">
                    <div class="${coverClass}" ${coverStyle}><span>♪</span></div>
                    <div class="sr-info">
                        <div class="sr-title">${_hl(track.title, query)}</div>
                        <div class="sr-artist">${_hl(track.artist, query)}</div>
                    </div>
                    <div class="sr-meta">
                        ${dur ? `<span class="sr-dur">${dur}</span>` : ''}
                        <span class="sr-play">Играть</span>
                    </div>
                </div>
            `);
        });
        dropdown.innerHTML = html.join('');
        openDropdown();

        // клики по строкам
        dropdown.querySelectorAll('.sr-item').forEach(el => {
            el.addEventListener('mouseenter', () => {
                dropdown.querySelectorAll('.sr-item').forEach(x => x.classList.remove('is-active'));
                el.classList.add('is-active');
                activeIdx = parseInt(el.dataset.idx, 10);
            });
            el.addEventListener('click', () => {
                const trackId = el.dataset.trackId;
                playTrackById(trackId);
                clearSearch();
                input.blur();
            });
        });
    };

    // ---------- подсветка совпадения ----------
    const _hl = (text, query) => {
        const safe = escapeHtml(text || '');
        if (!query) return safe;
        const q = query.toLowerCase();
        const lower = String(text).toLowerCase();
        const idx = lower.indexOf(q);
        if (idx < 0) return safe;
        const before = escapeHtml(String(text).slice(0, idx));
        const match  = escapeHtml(String(text).slice(idx, idx + q.length));
        const after  = escapeHtml(String(text).slice(idx + q.length));
        return `${before}<mark>${match}</mark>${after}`;
    };

    // ---------- воспроизведение по id ----------
    const playTrackById = (trackId) => {
        if (!audioEngine) return;
        const idx = audioEngine.playlist.findIndex(t => t.id === trackId);
        if (idx < 0) return;
        audioEngine.currentIndex = idx;
        audioEngine.loadCurrentTrack();
        audioEngine.play();
        // переключаемся на главную
        const homeBtn = document.querySelector('.nav-item[data-page="home"]');
        if (homeBtn && !homeBtn.classList.contains('active')) homeBtn.click();
    };

    // ---------- события ----------
    input.addEventListener('input', () => renderResults(input.value));
    input.addEventListener('focus', () => { if (input.value.trim()) renderResults(input.value); });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            clearSearch();
            input.blur();
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (results.length === 0) return;
            activeIdx = (activeIdx + 1) % results.length;
            _highlightActive(dropdown, activeIdx);
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (results.length === 0) return;
            activeIdx = (activeIdx - 1 + results.length) % results.length;
            _highlightActive(dropdown, activeIdx);
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            const item = dropdown.querySelector('.sr-item.is-active')
                       || dropdown.querySelector('.sr-item');
            if (item) {
                playTrackById(item.dataset.trackId);
                clearSearch();
                input.blur();
            }
            return;
        }
    });

    document.addEventListener('mousedown', (e) => {
        if (searchBox.contains(e.target)) return;
        if (dropdown.contains(e.target)) return;
        closeDropdown();
    });

    document.addEventListener('scroll', (e) => {
        if (dropdown.hidden) return;
        if (dropdown.contains(e.target)) return;
        closeDropdown();
    }, true);

    input.addEventListener('focus', () => searchBox.classList.add('is-focused'));
    input.addEventListener('blur',  () => searchBox.classList.remove('is-focused'));

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
            e.preventDefault();
            if (document.activeElement === input) {
                clearSearch();
                input.blur();
            } else {
                input.focus();
                input.select();
                if (input.value.trim()) renderResults(input.value);
            }
        }
    });

    // обновляем результаты при смене трека (вдруг обложка догрузилась)
    if (audioEngine) {
        const prevCb = audioEngine.onCoverLoaded;
        audioEngine.onCoverLoaded = (track) => {
            if (typeof prevCb === 'function') prevCb(track);
            if (!dropdown.hidden && input.value.trim()) renderResults(input.value);
        };
    }
}

function _highlightActive(dropdown, idx) {
    const items = dropdown.querySelectorAll('.sr-item');
    items.forEach((el, i) => el.classList.toggle('is-active', i === idx));
    const active = items[idx];
    if (active && active.scrollIntoView) {
        active.scrollIntoView({ block: 'nearest' });
    }
}


function buildRecommendations() {
    const grid = document.getElementById('recGrid');
    if (!grid) return;
    grid.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">♪</div>
            <div class="empty-state-title">Рекомендаций пока нет</div>
            <div class="empty-state-text">
                Загрузите треки — и здесь появятся подсказки на основе вашей музыки
            </div>
        </div>
    `;
}

function updateStageCover(track) {
    const el      = document.getElementById('stageCover');
    const titleEl = document.getElementById('stageMetaTitle');
    const artEl   = document.getElementById('stageMetaArtist');
    if (!el) return;

    if (!track) {
        el.style.backgroundImage = '';
        el.classList.remove('has-image');
        if (titleEl) titleEl.textContent = 'Загрузите музыку';
        if (artEl)   artEl.textContent   = 'Нажмите кнопку "Загрузить"';
        return;
    }

    const url = window.audioEngine?.ensureCoverUrl(track);
    if (url) {
        el.style.backgroundImage = `url("${url}")`;
        el.classList.add('has-image');
    } else {
        el.style.backgroundImage = '';
        el.classList.remove('has-image');
    }
    if (titleEl) titleEl.textContent = track.title || '—';
    if (artEl)   artEl.textContent   = track.artist || '—';
}
window.updateStageCover = updateStageCover;

// ===== CHARTS: топ 100 + авто-подборки =====

function pluralPlays(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'раз';
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'раза';
    return 'раз';
}

function getTopTracks(limit = 100) {
    const lib = window.audioEngine?.playlist || [];
    return [...lib]
        .filter(t => (t.playCount || 0) > 0)
        .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
        .slice(0, limit);
}

// ===== REGION PAGE =====

const REGION_ICONS = {
    0: '🌎',  // Северная Америка
    1: '🌎',  // Южная Америка
    2: '🏰',  // Европа
    3: '🦁',  // Африка
    4: '🏯',  // Азия
    5: '🦘',  // Австралия
    6: '🐧'   // Антарктида
};

function openRegionPage(regionIdx) {
    if (regionIdx == null || regionIdx < 0) return;
    const modal = document.getElementById('regionModal');
    if (!modal) return;

    const regionName = (typeof REGION_NAMES !== 'undefined' && REGION_NAMES[regionIdx]) || 'Регион';

    const tracks = (audioEngine?.playlist || [])
        .filter(t => t.region === regionIdx)
        .sort((a, b) => (b.playCount || 0) - (a.playCount || 0));

    // --- hero ---
    const avatar = document.getElementById('regionHeroAvatar');
    const name   = document.getElementById('regionHeroName');
    const stats  = document.getElementById('regionHeroStats');

    if (avatar) avatar.textContent = REGION_ICONS[regionIdx] || '🌍';
    if (name)   name.textContent   = regionName;

    const totalTracks  = tracks.length;
    const totalPlays   = tracks.reduce((s, t) => s + (t.playCount || 0), 0);
    const totalSeconds = tracks.reduce((s, t) => s + (t.duration || 0) * (t.playCount || 0), 0);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const timeStr = hours > 0 ? `${hours}ч ${minutes}м` : `${minutes}м`;

    if (stats) {
        stats.innerHTML = `
            <span><b>${totalTracks}</b> ${pluralTracks(totalTracks)}</span>
            <span class="dot"></span>
            <span><b>${totalPlays}</b> ${pluralPlays(totalPlays)}</span>
            <span class="dot"></span>
            <span><b>${timeStr}</b> прослушано</span>
        `;
    }

    // --- actions ---
    const playAllBtn = document.getElementById('regionPlayAllBtn');
    const shuffleBtn = document.getElementById('regionShuffleBtn');

    const newPlayAll = playAllBtn.cloneNode(true);
    playAllBtn.parentElement.replaceChild(newPlayAll, playAllBtn);
    newPlayAll.addEventListener('click', () => {
        if (tracks.length === 0) return;
        playTrackList(tracks, regionName);
        closeRegionModal();
    });

    const newShuffle = shuffleBtn.cloneNode(true);
    shuffleBtn.parentElement.replaceChild(newShuffle, shuffleBtn);
    newShuffle.addEventListener('click', () => {
        if (tracks.length === 0) return;
        const shuffled = [...tracks];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        playTrackList(shuffled, regionName);
        closeRegionModal();
    });

    // --- tracks list ---
    const listEl  = document.getElementById('regionTracks');
    const countEl = document.getElementById('regionTracksCount');
    if (countEl) countEl.textContent = totalTracks > 0 ? String(totalTracks) : '';

    if (!listEl) return;
    listEl.innerHTML = '';

    if (tracks.length === 0) {
        listEl.innerHTML = `<div class="sidebar-empty">В этом регионе<br>пока нет треков</div>`;
    } else {
        tracks.forEach((track, i) => {
            const row = document.createElement('div');
            row.className = 'artist-track-row';
            const coverUrl = audioEngine.ensureCoverUrl(track);
            const coverStyle = coverUrl
                ? `style="background-image:url('${coverUrl}');background-size:cover;background-position:center"`
                : '';
            const coverClass = coverUrl ? 'artist-track-cover has-image' : 'artist-track-cover';
            const dur = track.duration ? audioEngine.formatTime(track.duration) : '';
            const plays = track.playCount || 0;

            row.innerHTML = `
                <div class="artist-track-num">${i + 1}</div>
                <div class="${coverClass}" ${coverStyle}><span>♪</span></div>
                <div class="artist-track-info">
                    <div class="artist-track-title">${escapeHtml(track.title)}</div>
                    <div class="artist-track-meta">
                        <span>${escapeHtml(track.artist)}</span>
                        ${plays > 0 ? `<span class="artist-track-plays">${plays} ${pluralPlays(plays)}</span>` : ''}
                    </div>
                </div>
                ${dur ? `<div class="artist-track-dur">${dur}</div>` : ''}
                <button class="artist-track-play" aria-label="Играть">
                    <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </button>
            `;

            row.addEventListener('click', () => {
                const idx = audioEngine.playlist.indexOf(track);
                if (idx < 0) return;
                audioEngine.currentIndex = idx;
                audioEngine.loadCurrentTrack();
                audioEngine.play();
                closeRegionModal();
                const homeBtn = document.querySelector('.nav-item[data-page="home"]');
                if (homeBtn && !homeBtn.classList.contains('active')) homeBtn.click();
            });

            listEl.appendChild(row);
        });
    }

    modal.classList.add('active');
}

function closeRegionModal() {
    const modal = document.getElementById('regionModal');
    if (modal) modal.classList.remove('active');
}

window.openRegionPage = openRegionPage;
window.closeRegionModal = closeRegionModal;


// ===== ARTIST PAGE =====

function openArtistPage(artistName) {
    if (!artistName) return;
    const modal = document.getElementById('artistModal');
    if (!modal) return;

    const clean = String(artistName).trim();

    const allTracks = (audioEngine?.playlist || []).filter(t => {
        const a = String(t.artist || '').toLowerCase();
        const c = clean.toLowerCase();
        return a === c || a.includes(c) || c.includes(a.split(',')[0].trim());
    });

    // сортируем по playCount, потом по createdAt
    allTracks.sort((a, b) => {
        const dp = (b.playCount || 0) - (a.playCount || 0);
        if (dp !== 0) return dp;
        return (b.createdAt || 0) - (a.createdAt || 0);
    });

    // --- hero ---
    const avatar = document.getElementById('artistHeroAvatar');
    const name   = document.getElementById('artistHeroName');
    const stats  = document.getElementById('artistHeroStats');

    if (avatar) avatar.textContent = clean.charAt(0).toUpperCase();
    if (name)   name.textContent   = clean;

    const uniqueTracks = allTracks.length;
    const totalPlays   = allTracks.reduce((s, t) => s + (t.playCount || 0), 0);
    const totalSeconds = allTracks.reduce((s, t) => s + (t.duration || 0) * (t.playCount || 0), 0);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const timeStr = hours > 0 ? `${hours}ч ${minutes}м` : `${minutes}м`;

    if (stats) {
        stats.innerHTML = `
            <span><b>${uniqueTracks}</b> ${pluralTracks(uniqueTracks)}</span>
            <span class="dot"></span>
            <span><b>${totalPlays}</b> ${pluralPlays(totalPlays)}</span>
            <span class="dot"></span>
            <span><b>${timeStr}</b> прослушано</span>
        `;
    }

    // --- actions ---
    const playAllBtn = document.getElementById('artistPlayAllBtn');
    const shuffleBtn = document.getElementById('artistShuffleBtn');

    // очищаем предыдущие обработчики
    const newPlayAll = playAllBtn.cloneNode(true);
    playAllBtn.parentElement.replaceChild(newPlayAll, playAllBtn);
    newPlayAll.addEventListener('click', () => {
        if (allTracks.length === 0) return;
        playTrackList(allTracks, clean);
        closeArtistModal();
    });

    const newShuffle = shuffleBtn.cloneNode(true);
    shuffleBtn.parentElement.replaceChild(newShuffle, shuffleBtn);
    newShuffle.addEventListener('click', () => {
        if (allTracks.length === 0) return;
        const shuffled = [...allTracks];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        playTrackList(shuffled, clean);
        closeArtistModal();
    });

    // --- tracks list ---
    const listEl = document.getElementById('artistTracks');
    const countEl = document.getElementById('artistTracksCount');
    if (countEl) countEl.textContent = uniqueTracks > 0 ? String(uniqueTracks) : '';

    if (!listEl) return;
    listEl.innerHTML = '';

    if (allTracks.length === 0) {
        listEl.innerHTML = `<div class="sidebar-empty">Треки этого артиста<br>не найдены</div>`;
    } else {
        allTracks.forEach((track, i) => {
            const row = document.createElement('div');
            row.className = 'artist-track-row';
            const coverUrl = audioEngine.ensureCoverUrl(track);
            const coverStyle = coverUrl
                ? `style="background-image:url('${coverUrl}');background-size:cover;background-position:center"`
                : '';
            const coverClass = coverUrl ? 'artist-track-cover has-image' : 'artist-track-cover';
            const dur = track.duration ? audioEngine.formatTime(track.duration) : '';
            const plays = track.playCount || 0;

            row.innerHTML = `
                <div class="artist-track-num">${i + 1}</div>
                <div class="${coverClass}" ${coverStyle}><span>♪</span></div>
                <div class="artist-track-info">
                    <div class="artist-track-title">${escapeHtml(track.title)}</div>
                    <div class="artist-track-meta">
                        ${plays > 0 ? `<span class="artist-track-plays">${plays} ${pluralPlays(plays)}</span>` : ''}
                        ${track.region >= 0 && typeof REGION_NAMES !== 'undefined' ? `<span>${REGION_NAMES[track.region]}</span>` : ''}
                    </div>
                </div>
                ${dur ? `<div class="artist-track-dur">${dur}</div>` : ''}
                <button class="artist-track-play" aria-label="Играть">
                    <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </button>
            `;

            row.addEventListener('click', () => {
                const idx = audioEngine.playlist.indexOf(track);
                if (idx < 0) return;
                audioEngine.currentIndex = idx;
                audioEngine.loadCurrentTrack();
                audioEngine.play();
                closeArtistModal();
                const homeBtn = document.querySelector('.nav-item[data-page="home"]');
                if (homeBtn && !homeBtn.classList.contains('active')) homeBtn.click();
            });

            listEl.appendChild(row);
        });
    }

    modal.classList.add('active');
}

function closeArtistModal() {
    const modal = document.getElementById('artistModal');
    if (modal) modal.classList.remove('active');
}

window.openArtistPage = openArtistPage;
window.closeArtistModal = closeArtistModal;


function buildChartPlaylists() {
    const grid = document.getElementById('playlistsGrid');
    if (!grid) return;

    const lib = window.audioEngine?.playlist || [];
    const lists = [];

    // Лидеры
    const topPlayed = [...lib]
        .filter(t => (t.playCount || 0) > 0)
        .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
        .slice(0, 20);
    if (topPlayed.length > 0) {
        lists.push({ key: 'leader', icon: '🔥', name: 'Лидеры', desc: 'Самые прослушиваемые', tracks: topPlayed });
    }

    // Свежак
    const fresh = [...lib]
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 20);
    if (fresh.length > 0) {
        lists.push({ key: 'fresh', icon: '✨', name: 'Свежак', desc: 'Недавно добавленные', tracks: fresh });
    }

    // Нетронутое
    const unheard = lib
        .filter(t => (t.playCount || 0) === 0)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 20);
    if (unheard.length > 0) {
        lists.push({ key: 'unheard', icon: '🔍', name: 'Нетронутое', desc: 'Ещё не слушали', tracks: unheard });
    }

    // Микс дня (детерминированный по дате — не прыгает при обновлении)
    if (lib.length > 0) {
        const daySeed = new Date().toISOString().slice(0, 10);
        const pool = [...lib];
        let seed = 0;
        for (let i = 0; i < daySeed.length; i++) seed = (seed * 31 + daySeed.charCodeAt(i)) >>> 0;
        for (let i = pool.length - 1; i > 0; i--) {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            const j = seed % (i + 1);
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const mixed = pool.slice(0, 20);
        lists.push({ key: 'mix', icon: '🎲', name: 'Микс дня', desc: 'Случайная двадцатка', tracks: mixed });
    }

    if (lists.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">★</div>
                <div class="empty-state-title">Подборок пока нет</div>
                <div class="empty-state-text">Загрузите треки — подборки появятся автоматически</div>
            </div>
        `;
        return;
    }

    grid.innerHTML = '';
    lists.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'chart-playlist-card';
        card.innerHTML = `
            <div class="chart-playlist-cover pattern-${pl.key}">
                <span class="chart-playlist-icon">${pl.icon}</span>
            </div>
            <div class="chart-playlist-info">
                <div class="chart-playlist-name">${escapeHtml(pl.name)}</div>
                <div class="chart-playlist-desc">${escapeHtml(pl.desc)}</div>
                <div class="chart-playlist-count">${pl.tracks.length} ${pluralTracks(pl.tracks.length)}</div>
            </div>
        `;
        card.addEventListener('click', () => playTrackList(pl.tracks, pl.name));
        grid.appendChild(card);
    });
}

function buildTop100() {
    const list = document.getElementById('top100List');
    if (!list) return;

    const top = getTopTracks(100);
    if (top.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">#</div>
                <div class="empty-state-title">Чарт пуст</div>
                <div class="empty-state-text">Слушайте музыку — здесь появится топ по прослушиваниям</div>
            </div>
        `;
        return;
    }

    list.innerHTML = '';
    top.forEach((track, i) => {
        const row = document.createElement('div');
        row.className = 'track-item-chart';
        const coverUrl = audioEngine.ensureCoverUrl(track);
        const coverStyle = coverUrl
            ? `style="background-image:url('${coverUrl}');background-size:cover;background-position:center"`
            : '';
        const coverClass = coverUrl ? 'track-cover-chart has-image' : 'track-cover-chart';
        const dur = track.duration ? audioEngine.formatTime(track.duration) : '';
        const plays = track.playCount || 0;

        row.innerHTML = `
            <div class="track-number-chart">${i + 1}</div>
            <div class="${coverClass}" ${coverStyle}><span>♪</span></div>
            <div class="track-details-chart">
                <div class="track-name-chart">${escapeHtml(track.title)}</div>
                <div class="track-artist-chart">
                    <span class="artist-link" data-artist="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</span>
                </div>
            </div>
            <div class="track-plays-chart" title="Прослушиваний">
                <span class="track-plays-num">${plays}</span>
                <span class="track-plays-label">${pluralPlays(plays)}</span>
            </div>
            ${dur ? `<div class="track-duration-chart">${dur}</div>` : ''}
            <button class="track-play-btn" aria-label="Играть">
                <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </button>
        `;

        row.addEventListener('click', (e) => {
            const artistEl = e.target.closest('.artist-link');
            if (artistEl) {
                e.stopPropagation();
                const artist = artistEl.dataset.artist;
                if (typeof openArtistPage === 'function') {
                    openArtistPage(artist);
                }
                return;
            }
            const idx = audioEngine.playlist.indexOf(track);
            if (idx < 0) return;
            audioEngine.currentIndex = idx;
            audioEngine.loadCurrentTrack();
            audioEngine.play();
        });

        list.appendChild(row);
    });
}

function playTrackList(tracks, name) {
    if (!tracks || tracks.length === 0) {
        showNotification('Список пуст', true);
        return;
    }
    const lib = audioEngine.playlist;
    const ids = new Set(tracks.map(t => t.id));
    const rest = lib.filter(t => !ids.has(t.id));

    audioEngine.playlist = [...tracks, ...rest];
    audioEngine.currentIndex = 0;
    audioEngine.loadCurrentTrack();
    audioEngine.play();

    if (window.fileUploadSystem) window.fileUploadSystem.updateTrackListUI();
    if (window.trackQueue) window.trackQueue.render();

    const homeBtn = document.querySelector('.nav-item[data-page="home"]');
    if (homeBtn && !homeBtn.classList.contains('active')) homeBtn.click();

    showNotification(`▶️ ${name}: ${tracks.length} ${pluralTracks(tracks.length)}`);
}
window.playTrackList = playTrackList;
window.buildChartPlaylists = buildChartPlaylists;
window.buildTop100 = buildTop100;

function buildPlaylistsModal() {
    const grid = document.getElementById('playlistGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const realPlaylists = playlistManager ? playlistManager.getAllPlaylists() : [];

    if (realPlaylists.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-secondary);">
                <div style="font-size: 64px; margin-bottom: 16px; opacity: 0.4;">🎵</div>
                <div style="font-size: 18px; font-weight: 600; margin-bottom: 8px; color: var(--text-primary);">Плейлистов пока нет</div>
                <div style="font-size: 14px; max-width: 420px; margin: 0 auto;">
                    Кликните правой кнопкой мыши по треку и выберите
                    «Добавить в плейлист» → «Создать новый плейлист»
                </div>
            </div>
        `;
        return;
    }

    realPlaylists.forEach((playlist) => {
        const card = document.createElement('div');
        card.className = 'playlist-card glass';
        card.style.position = 'relative';
        card.innerHTML = `
            <div class="playlist-cover">🎵</div>
            <div class="playlist-info">
                <div class="playlist-name">${escapeHtml(playlist.name)}</div>
                <div class="playlist-count">${playlist.tracks.length} ${pluralTracks(playlist.tracks.length)}</div>
            </div>
            <button class="playlist-delete-btn" title="Удалить плейлист" style="
                position: absolute; top: 10px; right: 10px;
                width: 34px; height: 34px; border-radius: 50%;
                background: rgba(255, 59, 48, 0.9); border: none; color: #fff;
                font-size: 20px; line-height: 1; font-weight: 700; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                opacity: 0; transition: opacity 0.2s ease, transform 0.2s ease;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 2;
            ">×</button>
        `;

        const delBtn = card.querySelector('.playlist-delete-btn');
        card.addEventListener('mouseenter', () => {
            delBtn.style.opacity = '1';
            delBtn.style.transform = 'scale(1.05)';
        });
        card.addEventListener('mouseleave', () => {
            delBtn.style.opacity = '0';
            delBtn.style.transform = 'scale(1)';
        });

        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Удалить плейлист "${playlist.name}"?`)) {
                playlistManager.deletePlaylist(playlist.id);
                buildPlaylistsModal();
                updatePlaylistCounters();
                showNotification(`🗑️ Плейлист "${playlist.name}" удалён`);
            }
        });

        card.addEventListener('click', () => {
            playPlaylist(playlist);
        });

        grid.appendChild(card);
    });
}

function updatePlaylistCounters() {
    const countEl = document.getElementById('playlistCount');
    if (countEl && playlistManager) {
        const n = playlistManager.getPlaylistCount();
        const word = n === 1 ? 'плейлист' : (n >= 2 && n <= 4 ? 'плейлиста' : 'плейлистов');
        updateCounter(countEl, n, word);
    }
    if (typeof renderSidebarPlaylists === 'function') renderSidebarPlaylists();
}

function openPlaylistsModal() {
    buildPlaylistsModal();
    document.getElementById('playlistsModal').classList.add('active');
}
window.openPlaylistsModal = openPlaylistsModal;

function playPlaylist(playlist) {
    if (!playlist.tracks || playlist.tracks.length === 0) {
        showNotification('В плейлисте пока нет треков', true);
        return;
    }

    const library = audioEngine.playlist;
    const byId = new Map(library.map(t => [t.id, t]));

    const playlistTracks = [];
    const missing = [];
    playlist.tracks.forEach(pt => {
        const live = byId.get(pt.id);
        if (live) playlistTracks.push(live);
        else missing.push(pt.title || pt.id);
    });

    if (playlistTracks.length === 0) {
        showNotification('Треки из плейлиста не найдены в библиотеке', true);
        return;
    }

    const playlistIds = new Set(playlistTracks.map(t => t.id));
    const rest = library.filter(t => !playlistIds.has(t.id));

    audioEngine.playlist = [...playlistTracks, ...rest];
    audioEngine.currentIndex = 0;
    audioEngine.loadCurrentTrack();
    audioEngine.play();

    if (window.fileUploadSystem) window.fileUploadSystem.updateTrackListUI();
    if (window.trackQueue) window.trackQueue.render();

    closeModal('playlistsModal');
    document.querySelector('[data-page="home"]').click();

    const msg = missing.length
        ? `▶️ "${playlist.name}" — ${missing.length} треков не найдено`
        : `▶️ Воспроизведение плейлиста "${playlist.name}"`;
    showNotification(msg);
}
window.playPlaylist = playPlaylist;

// ===== STAGE MODE (глобус ↔ обложка) — глобально =====

let _stageCoverBeforeEco = null;

function applyStageMode(showCover, opts = {}) {
    const stageColumn = document.getElementById('stageColumn');
    const stageToggle = document.getElementById('stageToggle');
    const stageLabel  = document.getElementById('stageToggleLabel');
    if (!stageColumn) return;

    const currentlyCover = stageColumn.classList.contains('show-cover');
    if (currentlyCover === showCover && !opts.force) return;

    stageColumn.classList.toggle('show-cover', showCover);

    // label
    if (stageLabel) {
        const newText = showCover ? 'Мир' : 'Обложка';
        if (opts.animate === false || !stageLabel.textContent.trim()) {
            stageLabel.textContent = newText;
        } else {
            stageLabel.classList.add('is-out');
            setTimeout(() => {
                stageLabel.textContent = newText;
                stageLabel.classList.remove('is-out');
                stageLabel.classList.add('is-in');
                void stageLabel.offsetWidth;
                stageLabel.classList.remove('is-in');
            }, 320);
        }
    }

    // скрываем hint после первого переключения
    stageToggle?.classList.remove('hint-visible');

    // глобус
    if (showCover) {
        window.globeView?.stop();
    } else {
        const g = ensureGlobe();
        if (g) {
            g.onRegionSelect = (regionIdx) => openRegionPage(regionIdx);
            setTimeout(() => { g.resize(); g.start(); }, 250);
        }
    }
}
window.applyStageMode = applyStageMode;


function toggleEcoMode(enabled) {
    isEcoMode = enabled;
    document.body.classList.toggle('eco-mode', enabled);
    const statusText = document.getElementById('ecoStatusText');
    if (statusText) {
        statusText.textContent = enabled ? 'Включен' : 'Выключен';
        statusText.style.color = enabled ? '#4CAF50' : '#ff3b30';
    }

    if (enabled) {
        visualizer.stop();
        backgroundSystem.stop();

        // принудительно ставим обложку (глобус слишком тяжёлый для эко)
        const stageColumn = document.getElementById('stageColumn');
        if (stageColumn) {
            _stageCoverBeforeEco = stageColumn.classList.contains('show-cover');
            applyStageMode(true, { animate: false });
        }
    } else {
        backgroundSystem.start();
        if (audioEngine.isPlaying) visualizer.start();

        if (window.miniViz) window.miniViz._start();

        // возвращаем тот режим, что был до эко
        if (_stageCoverBeforeEco === false) {
            applyStageMode(false, { animate: false });
        }
        _stageCoverBeforeEco = null;
    }

    localStorage.setItem('ecoMode', enabled ? '1' : '0');
}

function loadEcoState() {
    if (localStorage.getItem('ecoMode') === '1') {
        document.getElementById('ecoToggle').checked = true;
        toggleEcoMode(true);
    }
}

 
function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}
window.closeModal = closeModal;

function openLikedModal() {
    const list = document.getElementById('likedTrackList');
    list.innerHTML = '';
    if (audioEngine.playlist.length === 0) {
        list.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary);">Загрузите треки на странице "Моя музыка"</div>';
    } else {
        audioEngine.playlist.forEach((track, i) => {
            const item = document.createElement('div');
            item.className = 'track-item';
            item.style.setProperty('--i', i);
            item.innerHTML = `
                <div class="track-number">${i + 1}</div>
                <div class="track-cover">🎵</div>
                <div class="track-details">
                    <div class="track-name">${track.title}</div>
                    <div class="track-artist-name">${track.artist}</div>
                </div>
                <div class="track-actions">
                    <button class="action-btn" onclick="playFromModal(${i}); event.stopPropagation();">▶️</button>
                </div>
            `;
            item.addEventListener('click', () => {
                playFromModal(i);
                closeModal('likedModal');
            });
            list.appendChild(item);
        });
    }
    document.getElementById('likedModal').classList.add('active');
}

window.playFromModal = playFromModal;

const WEB3FORMS_KEY = '01027621-2d58-4091-98aa-6f3584033e63';

function openSupportModal() {
    const modal = document.getElementById('supportModal');
    if (!modal) return;
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const nameField = document.getElementById('supportName');
    const emailField = document.getElementById('supportEmail');

    if (user.name && !nameField.value) nameField.value = user.name;
    if (user.email && !emailField.value) emailField.value = user.email;

    document.getElementById('supportStatus').textContent = '';
    document.getElementById('supportStatus').className = 'support-status';
    document.getElementById('errSupportEmail').textContent = '';
    document.getElementById('errSupportMessage').textContent = '';

    modal.classList.add('active');

    setTimeout(() => document.getElementById('supportMessage')?.focus(), 300);
}
window.openSupportModal = openSupportModal;

function setupSupportForm() {
    const form = document.getElementById('supportForm');
    if (!form) return;

    const textarea = document.getElementById('supportMessage');
    const counter  = document.getElementById('supportCharCount');
    textarea?.addEventListener('input', () => {
        counter.textContent = textarea.value.length;
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const status = document.getElementById('supportStatus');
        const submit = document.getElementById('supportSubmit');

        const name    = document.getElementById('supportName').value.trim();
        const email   = document.getElementById('supportEmail').value.trim();
        const topic   = document.getElementById('supportTopic').value;
        const message = textarea.value.trim();
        const bot     = document.getElementById('supportBotCheck').checked;

        let ok = true;
        document.getElementById('errSupportEmail').textContent = '';
        document.getElementById('errSupportMessage').textContent = '';

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            document.getElementById('errSupportEmail').textContent = 'Некорректный email';
            ok = false;
        }
        if (message.length < 10) {
            document.getElementById('errSupportMessage').textContent = 'Минимум 10 символов';
            ok = false;
        }
        if (!ok) return;

        if (bot) {
            status.textContent = 'Отправлено';
            status.className = 'support-status ok';
            return;
        }

        const user = JSON.parse(localStorage.getItem('user') || '{}');
        const payload = {
            access_key: WEB3FORMS_KEY,
            subject: `[mbox] ${topic} — ${name || 'без имени'}`,
            from_name: 'mbox — форма поддержки',

            Имя: name || '—',
            Email: email,
            Ник_на_сайте: user.username ? '@' + user.username : '—',
            Тема: topic,
            Сообщение: message,

            Браузер: navigator.userAgent,
            Страница: location.pathname,
            Время: new Date().toLocaleString('ru-RU'),
            replyto: email,
        };

        submit.classList.add('loading');
        submit.disabled = true;
        submit.textContent = 'Отправка…';
        status.textContent = '';

        try {
            const res = await fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (data.success) {
                status.textContent = '✅ Сообщение отправлено. Спасибо!';
                status.className = 'support-status ok';

                form.reset();
                counter.textContent = '0';

                setTimeout(() => {
                    document.getElementById('supportModal')?.classList.remove('active');
                }, 2500);
            } else {
                throw new Error(data.message || 'Ошибка отправки');
            }
        } catch (err) {
            console.warn('support send failed:', err);
            status.textContent = '❌ Не удалось отправить. Попробуйте позже.';
            status.className = 'support-status error';
        } finally {
            submit.classList.remove('loading');
            submit.disabled = false;
            submit.textContent = 'Отправить';
        }
    });
}

function playFromModal(index) {
    audioEngine.currentIndex = index;
    audioEngine.loadCurrentTrack();
    audioEngine.play();
}
window.playFromModal = playFromModal;

function cleanTrackQuery(str) {
    return String(str || '')
        .replace(/\(feat\.?[^)]*\)/gi, '')
        .replace(/\[feat\.?[^\]]*\]/gi, '')
        .replace(/\(ft\.?[^)]*\)/gi, '')
        .replace(/\[ft\.?[^\]]*\]/gi, '')
        .replace(/\((?:official|lyric|audio|video|clip|remix|radio|edit)[^)]*\)/gi, '')
        .replace(/\[(?:official|lyric|audio|video|clip|remix|radio|edit)[^\]]*\]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function primaryArtist(artist) {
    return String(artist || '').split(',')[0].trim();
}

function parseLRC(lrc) {
    if (!lrc) return null;

    const lines = [];
    const lineRe = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

    for (const raw of String(lrc).split(/\r?\n/)) {
        const marks = [];
        let m;
        lineRe.lastIndex = 0;
        while ((m = lineRe.exec(raw)) !== null) {
            const mm = parseInt(m[1], 10) || 0;
            const ss = parseInt(m[2], 10) || 0;
            const frac = (m[3] || '0').padEnd(3, '0').slice(0, 3);
            const ms = parseInt(frac, 10) || 0;
            marks.push(mm * 60 + ss + ms / 1000);
        }
        if (!marks.length) continue;

        const text = raw.replace(lineRe, '').trim();
        for (const t of marks) {
            lines.push({ time: t, text: text || '\u00A0' });
        }
    }

    if (!lines.length) return null;
    lines.sort((a, b) => a.time - b.time);
    return lines;
}

function geniusSearchUrl(artist, title) {
    const q = encodeURIComponent(`${cleanTrackQuery(artist)} ${cleanTrackQuery(title)}`.trim());
    return `https://genius.com/search?q=${q}`;
}

async function fetchLyrics(artist, name) {
    const q = encodeURIComponent(name);
    const url = `https://lrclib.net/api/search?q=${q}`;

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);

    let results;
    try {
        const r = await fetch(url, {
            signal: ctrl.signal,
            headers: { 'Accept': 'application/json' }
        });
        clearTimeout(t);
        if (!r.ok) return null;
        results = await r.json();
    } catch (e) {
        clearTimeout(t);
        console.warn('lrclib search failed:', e.message);
        return null;
    }

    if (!Array.isArray(results) || results.length === 0) return null;
    const artistL = artist.toLowerCase().trim();
    const nameL   = name.toLowerCase().trim();
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-zа-я0-9]/gi, '');
    const artistN = norm(artistL);
    const nameN   = norm(nameL);
    const scored = results
        .filter(r => r.plainLyrics || r.syncedLyrics)
        .map(r => {
            const rArtist = norm(r.artistName);
            const rTrack  = norm(r.trackName);
            let score = 0;
            if (r.plainLyrics) score += 2;
            if (rArtist.includes(artistN) || artistN.includes(rArtist)) score += 3;
            if (rTrack.includes(nameN) || nameN.includes(rTrack)) score += 3;
            return { r, score };
        })
        .sort((a, b) => b.score - a.score);
    if (scored.length > 0) return scored[0].r;
    return results.find(r => r.syncedLyrics || r.plainLyrics) || results[0];
}

const LyricsView = {
    scroller: null,
    linesEl: null,
    lineEls: [],
    raf: null,
    bound: false,
    _scrollBound: false,
    _controlsSnapshot: null,

    init() {
        this.scroller = document.getElementById('lyricsScroller');
        this.linesEl  = document.getElementById('lyricsLines');
        if (!this.scroller || !this.linesEl) return;

        this._onScroll = this._onScroll.bind(this);
        this._onResize = this._onResize.bind(this);
        window.addEventListener('resize', this._onResize);
        this.bound = true;
    },

    reset() {
        const stage = document.getElementById('lyricsStage');
        if (stage) stage.classList.remove('revealed');
        if (this.linesEl) this.linesEl.innerHTML = '';
        this.lineEls = [];
        if (this.scroller) this.scroller.scrollTop = 0;
        this.restorePlayerControls();
        this._syncLines = null;
        this._activeIdx = -1;
        this._userScrollUntil = 0;
        this._stopSync();
    },

    clearLines() {
        if (this.linesEl) this.linesEl.innerHTML = '';
        this.lineEls = [];
        if (this.scroller) this.scroller.scrollTop = 0;
        const src = document.getElementById('lyricsSource');
        if (src) src.innerHTML = '';
    },

    setCover(track) {
        const coverEl = document.getElementById('lyricsCover');
        if (!coverEl) return;
        coverEl.innerHTML = '';
        const url = window.audioEngine?.ensureCoverUrl(track);
        if (url) {
            const img = document.createElement('img');
            img.src = url;
            img.alt = '';
            coverEl.appendChild(img);
        } else {
            const ph = document.createElement('div');
            ph.className = 'lyrics-cover-ph';
            ph.textContent = '♪';
            coverEl.appendChild(ph);
        }
    },

    setMeta(track) {
        const t = document.getElementById('lyricsMetaTitle');
        const a = document.getElementById('lyricsMetaArtist');
        if (t) t.textContent = track.title;
        if (a) a.textContent = track.artist;
    },
    stealPlayerControls() {
        if (window.innerWidth < 720) return;
        if (this._controlsSnapshot) return;

        const buttonsSlot = document.getElementById('lyricsPlayerButtons');
        const volumeSlot  = document.getElementById('lyricsPlayerVolume');
        if (!buttonsSlot || !volumeSlot) return;

        const moves = [];
        ['prevBtn', 'mainPlayBtn', 'nextBtn'].forEach((id) => {
            const el = document.getElementById(id);
            if (!el || !el.parentElement) return;

            const marker = document.createComment('lyrics-return-' + id);
            el.parentElement.insertBefore(marker, el);
            moves.push({ el, marker });

            buttonsSlot.appendChild(el);
        });

        const vol = document.querySelector('.main-content > .volume-control');
        if (vol && vol.parentElement) {
            const marker = document.createComment('lyrics-return-volume');
            vol.parentElement.insertBefore(marker, vol);
            moves.push({ el: vol, marker });

            volumeSlot.appendChild(vol);
        }

        this._controlsSnapshot = moves;
    },

    restorePlayerControls() {
        if (!this._controlsSnapshot) return;
        for (let i = this._controlsSnapshot.length - 1; i >= 0; i--) {
            const m = this._controlsSnapshot[i];
            try {
                if (m.marker && m.marker.parentElement) {
                    m.marker.parentElement.insertBefore(m.el, m.marker);
                    m.marker.remove();
                }
            } catch (e) {
                console.warn('restore player control failed:', e);
            }
        }
        this._controlsSnapshot = null;
    },

    setStatus(html) {
        const s = document.getElementById('lyricsStatus');
        if (s) s.innerHTML = html;
    },

    showLoading() {
        this.setStatus(`
            <div class="lyrics-spinner"></div>
            <div class="lyrics-status-text">Поиск текста…</div>
        `);
    },

    showNotFound(title, text, track) {
        const stage = document.getElementById('lyricsStage');
        if (stage) stage.classList.remove('revealed');

        const geniusUrl = track ? geniusSearchUrl(track.artist, track.title) : null;
        this.setStatus(`
            <div class="lyrics-notfound-title">${title}</div>
            <div class="lyrics-notfound-text">${text}</div>
            ${geniusUrl ? `
                <a class="lyrics-action-btn" href="${geniusUrl}" target="_blank" rel="noopener">
                    <svg viewBox="0 0 24 24"><path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7zM19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7z"/></svg>
                    Найти на Genius
                </a>` : ''}
        `);
    },

    renderLyrics(text, sourceUrl, syncLines) {
        if (!this.linesEl) return;
        const raw = String(text).split(/\r?\n/);
        this.linesEl.innerHTML = '';
        this.lineEls = [];

        raw.forEach((line, i) => {
            const el = document.createElement('div');
            el.className = 'lyrics-line';
            el.textContent = line.length === 0 ? '\u00A0' : line;
            el.dataset.idx = i;
            el.addEventListener('click', () => this._seekToLine(i));

            if (window.LyricsScene) {
                const s = window.LyricsScene.settings;
                el.style.fontFamily = `'${s.font}', sans-serif`;
                el.style.fontSize   = (20 * (s.size || 1)).toFixed(1) + 'px';
            }

            this.linesEl.appendChild(el);
            this.lineEls.push(el);
        });

        this._syncLines = syncLines || null;
        this._activeIdx = -1;
        this._userScrollUntil = 0;

        const srcEl = document.getElementById('lyricsSource');
        if (srcEl) {
            const syncedTag = this._syncLines
                ? ` · <span style="color:var(--y)">синхр.</span>`
                : '';
            srcEl.innerHTML = sourceUrl
                ? `Источник: <a href="${sourceUrl}" target="_blank" rel="noopener">LRCLIB</a>${syncedTag}`
                : '';
        }

        this._startSync();
    },

    reveal() {
        const stage = document.getElementById('lyricsStage');
        if (!stage) return;
        this._updatePadding();
        if (this.scroller) this.scroller.scrollTop = 0;
        this.stealPlayerControls();
        stage.classList.add('revealed');

        if (this.scroller && !this._scrollBound) {
            this.scroller.addEventListener('scroll', this._onScroll, { passive: true });
            this._bindUserScroll();
            this._scrollBound = true;
        }

        requestAnimationFrame(() => this._updateFocus());
        this._startSync();
    },

    _updatePadding() {
        if (!this.scroller || !this.linesEl) return;
        const h = this.scroller.clientHeight || 480;
        const pad = Math.max(60, h / 2 - 30);
        this.linesEl.style.paddingTop    = pad + 'px';
        this.linesEl.style.paddingBottom = pad + 'px';
    },

    _onScroll() {
        if (this.raf) return;
        this.raf = requestAnimationFrame(() => {
            this.raf = null;
            this._updateFocus();
        });
    },

    _onResize() {
        if (!document.getElementById('lyricsStage')?.classList.contains('revealed')) return;
        this._updatePadding();
        this._updateFocus();
    },

    _updateFocus() {
        if (!this.scroller || !this.lineEls.length) return;

        const scRect = this.scroller.getBoundingClientRect();
        const centerY = scRect.top + scRect.height / 2;
        const maxDist = scRect.height / 2;

        for (const line of this.lineEls) {
            const r = line.getBoundingClientRect();
            const lc = r.top + r.height / 2;
            const dist = Math.abs(lc - centerY);
            const p = Math.min(dist / maxDist, 1);
            const scale   = 1 - p * 0.30;
            const opacity = 1 - p * 0.82;
            const xShift  = p * 12;
            const blur    = p * 0.6;

            line.style.transform = `translateX(${xShift.toFixed(1)}px) scale(${scale.toFixed(3)})`;
            line.style.opacity   = opacity.toFixed(3);
            line.style.filter    = blur > 0.1 ? `blur(${blur.toFixed(2)}px)` : '';
        }
    },

    _bindUserScroll() {
        if (!this.scroller) return;
        const markUserScroll = () => {
            this._userScrollUntil = Date.now() + 4000;
        };
        this.scroller.addEventListener('wheel',       markUserScroll, { passive: true });
        this.scroller.addEventListener('touchstart',  markUserScroll, { passive: true });
        this.scroller.addEventListener('touchmove',   markUserScroll, { passive: true });
        this.scroller.addEventListener('mousedown',   markUserScroll, { passive: true });
        this.scroller.addEventListener('keydown',     markUserScroll, { passive: true });
    },

    _startSync() {
        if (this._syncRaf) return;
        this._syncRaf = requestAnimationFrame(() => this._syncTick());
    },

    _stopSync() {
        if (this._syncRaf) {
            cancelAnimationFrame(this._syncRaf);
            this._syncRaf = null;
        }
    },

    _syncTick() {
        this._syncRaf = requestAnimationFrame(() => this._syncTick());

        const lines = this._syncLines;
        if (!lines || !lines.length) return;

        const stage = document.getElementById('lyricsStage');
        if (!stage || !stage.classList.contains('revealed')) return;

        const audio = window.audioEngine?.audio;
        if (!audio) return;

        const t = audio.currentTime;
        let idx = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].time <= t + 0.05) { idx = i; break; }
        }

        if (idx === this._activeIdx) return;
        this._activeIdx = idx;
        this.lineEls.forEach((el, i) => {
            el.classList.toggle('synced-active', i === idx);
        });

        if (idx < 0) return;
        if (!window.audioEngine.isPlaying) return;
        if (Date.now() < this._userScrollUntil) return;

        this._scrollLineToCenter(idx);
    },

    _scrollLineToCenter(idx) {
        const el = this.lineEls[idx];
        const sc = this.scroller;
        if (!el || !sc) return;

        const target =
            el.offsetTop
            - sc.clientHeight / 2
            + el.clientHeight / 2;

        sc.scrollTo({
            top: Math.max(0, target),
            behavior: 'smooth'
        });
    },

    _seekToLine(idx) {
        const lines = this._syncLines;
        if (!lines || !lines[idx]) return;

        const audio = window.audioEngine?.audio;
        if (!audio) return;

        audio.currentTime = lines[idx].time;

        const el = this.lineEls[idx];
        if (el) {
            el.classList.add('sync-seek');
            setTimeout(() => el.classList.remove('sync-seek'), 400);
        }

        this._userScrollUntil = 0;
        this._activeIdx = -1;
    }
};

window.LyricsView = LyricsView;

const LYRICS_SCENE_KEY = 'lyricsSceneSettings';

const LYRICS_FONTS = [
    'Space Grotesk',
    'Inter',
    'Bebas Neue',
    'Playfair Display',
    'JetBrains Mono',
    'Unbounded',
    'Caveat',
    'Press Start 2P',
];

const LyricsScene = {
    settings: {
        font:    'Space Grotesk',
        size:    1,
        align:   'left',
        bg:      'dark',
        color:   'auto',
        cover:   'on',
    },

    init() {
        this.load();

        const btn   = document.getElementById('lyricsSettingsBtn');
        const panel = document.getElementById('lyricsPanel');
        const reset = document.getElementById('lyricsPanelReset');
        const closeBtn = document.getElementById('lyricsPanelClose');

        const openPanel = () => {
            panel.classList.add('open');
            panel.setAttribute('aria-hidden', 'false');
            btn.classList.add('active');
        };
        const closePanel = () => {
            panel.classList.remove('open');
            panel.setAttribute('aria-hidden', 'true');
            btn.classList.remove('active');
        };
       
        btn?.addEventListener('click', () => {
            if (panel.classList.contains('open')) closePanel();
            else openPanel();
        });

        closeBtn?.addEventListener('click', closePanel);

        const stage = document.getElementById('lyricsStage');
        stage?.addEventListener('click', (e) => {
            if (!panel.classList.contains('open')) return;
            if (panel.contains(e.target)) return;
            if (e.target.closest('#lyricsSettingsBtn')) return;
            closePanel();
        });

        reset?.addEventListener('click', () => {
            this.settings = {
                font:    'Space Grotesk',
                size:    1,
                align:   'left',
                bg:      'dark',
                color:   'auto',
                cover:   'on',
            };
            this.save();
            this.buildUI();
            this.apply();
        });

        this.buildFontGrid();

        document.querySelectorAll('.lyrics-radio-row').forEach(row => {
            const key = row.dataset.option;
            row.querySelectorAll('.lyrics-radio').forEach(rb => {
                rb.addEventListener('click', () => {
                    row.querySelectorAll('.lyrics-radio').forEach(b => b.classList.remove('active'));
                    rb.classList.add('active');
                    const v = rb.dataset.value;
                    this.settings[key] = key === 'size' ? parseFloat(v) : v;
                    this.save();
                    this.apply();
                });
            });
        });

        this.apply();
    },

    buildFontGrid() {
        const grid = document.getElementById('lyricsFontGrid');
        if (!grid) return;
        grid.innerHTML = '';
        LYRICS_FONTS.forEach(font => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'lyrics-font-btn';
            b.dataset.font = font;
            b.textContent = font;
            b.addEventListener('click', () => {
                grid.querySelectorAll('.lyrics-font-btn').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
                this.settings.font = font;
                this.save();
                this.apply();
            });
            grid.appendChild(b);
        });
    },

    buildUI() {
        document.querySelectorAll('.lyrics-font-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.font === this.settings.font);
        });

        document.querySelectorAll('.lyrics-radio-row').forEach(row => {
            const key = row.dataset.option;
            row.querySelectorAll('.lyrics-radio').forEach(rb => {
                const v = key === 'size' ? String(this.settings[key]) : this.settings[key];
                rb.classList.toggle('active', rb.dataset.value === v);
            });
        });
    },

    apply() {
        const scroller = document.getElementById('lyricsScroller');
        const stage    = document.getElementById('lyricsStage');
        const linesEl  = document.getElementById('lyricsLines');
        if (!scroller || !stage) return;

        const size = this.settings.size || 1;

        scroller.querySelectorAll('.lyrics-line').forEach(el => {
            el.style.fontFamily = `'${this.settings.font}', sans-serif`;
            el.style.fontSize   = (20 * size).toFixed(1) + 'px';
        });
        if (linesEl) {
            linesEl.style.fontFamily = `'${this.settings.font}', sans-serif`;
        }

        scroller.dataset.align = this.settings.align;
        if (linesEl) {
            linesEl.style.textAlign = this.settings.align === 'center' ? 'center' : 'left';
        }

        scroller.dataset.color = this.settings.color;
        stage.classList.toggle('no-cover', this.settings.cover === 'off');
        this.applyBackground();
    },

    applyBackground() {
        const bg = document.getElementById('lyricsBg');
        if (!bg) return;

        const track = window.audioEngine?.playlist?.[window.audioEngine.currentIndex];
        const mode  = this.settings.bg;

        bg.className = 'lyrics-bg';
        bg.removeAttribute('data-mode');
        bg.style.backgroundImage = '';
        bg.style.background = '';

        if (mode === 'dark' || !track) return;

        if (mode === 'blur') {
            const url = window.audioEngine?.ensureCoverUrl(track);
            if (url) {
                bg.style.backgroundImage = `url("${url}")`;
                bg.dataset.mode = 'blur';
                bg.classList.add('active');
            }
            return;
        }

        if (mode === 'gradient') {
            const palette = currentCoverPalette;
            const accent = getComputedStyle(document.documentElement).getPropertyValue('--y').trim() || '#FFD400';
            const c1 = accent;
            const c2 = palette ? `rgb(${palette.hexRgb.join(',')})` : 'var(--y-deep)';
            const c3 = '#0A0A0A';

            bg.style.background = `
                radial-gradient(ellipse at 20% 20%, ${c1} 0%, transparent 55%),
                radial-gradient(ellipse at 80% 70%, ${c2} 0%, transparent 60%),
                ${c3}
            `;
            bg.dataset.mode = 'gradient';
            bg.classList.add('active');
        }
    },

    load() {
        try {
            const saved = JSON.parse(localStorage.getItem(LYRICS_SCENE_KEY) || '{}');
            Object.assign(this.settings, saved);
        } catch (e) {}
    },

    save() {
        localStorage.setItem(LYRICS_SCENE_KEY, JSON.stringify(this.settings));
    },

    refresh() {
        this.apply();
    },
};

window.LyricsScene = LyricsScene;

async function openLyrics(index, opts = {}) {
    const isRefresh = !!opts.isRefresh;
    const track = audioEngine.playlist[index];
    if (!track) return;
    if (!LyricsView.bound) LyricsView.init();
    const glowEl = document.getElementById('lyricsGlow');
    const modal  = document.getElementById('lyricsModal');

    if (!isRefresh) {
        LyricsView.restorePlayerControls();
        LyricsView.reset();
        LyricsView.setCover(track);
        LyricsView.setMeta(track);
        modal.classList.add('active');
        glowEl?.classList.add('active');

        if (window.miniPlayer) window.miniPlayer.forceHide();

        setTimeout(() => window.LyricsScene?.refresh(), 100);

    } else {
        LyricsView.setCover(track);
        LyricsView.setMeta(track);
        LyricsView.clearLines();

        if (LyricsView.linesEl) {
            const ph = document.createElement('div');
            ph.className = 'lyrics-line';
            ph.style.opacity = '0.4';
            ph.textContent = 'Загрузка текста…';
            LyricsView.linesEl.appendChild(ph);
            LyricsView.lineEls = [ph];
            requestAnimationFrame(() => LyricsView._updateFocus());
        }
    }

    const myToken = ++lyricsLoadToken;

    if (track._lyricsCache) {
        if (myToken !== lyricsLoadToken) return;
        LyricsView.renderLyrics(
            track._lyricsCache.text,
            'https://lrclib.net',
            track._lyricsCache.synced || null
        );
        if (!isRefresh) LyricsView.reveal();
        else requestAnimationFrame(() => LyricsView._updateFocus());
        glowEl?.classList.remove('active');
        return;
    }

    if (!isRefresh) LyricsView.showLoading();

    const artist = cleanTrackQuery(primaryArtist(track.artist));
    const name   = cleanTrackQuery(track.title);

    try {
        const best = await fetchLyrics(artist, name);
        if (myToken !== lyricsLoadToken) return;
        if (!modal.classList.contains('active')) return;

        if (!best) {
            LyricsView.showNotFound('Текст не найден', 'Попробуйте поискать вручную.', track);
            return;
        }
        if (best.instrumental && !best.plainLyrics && !best.syncedLyrics) {
            LyricsView.showNotFound('Инструментальная композиция', 'У этого трека нет текста.', track);
            return;
        }

        const hasSynced = !!(best.syncedLyrics && best.syncedLyrics.trim());
        const plainText = best.plainLyrics
            || (best.syncedLyrics || '').replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, '').trim();

        if (!plainText) {
            LyricsView.showNotFound('Текст пустой', 'Запись нашлась, но без содержимого.', track);
            return;
        }

        const syncLines = hasSynced ? parseLRC(best.syncedLyrics) : null;

        track._lyricsCache = {
            text:   plainText,
            synced: syncLines,
            source: 'lrclib',
            lrclibId: best.id,
            artist: best.artistName || track.artist,
            title:  best.trackName  || track.title
        };

        LyricsView.renderLyrics(plainText, 'https://lrclib.net', syncLines);

        if (!isRefresh) LyricsView.reveal();
        else requestAnimationFrame(() => LyricsView._updateFocus());

    } catch (e) {
        if (myToken !== lyricsLoadToken) return;
        if (!modal.classList.contains('active')) return;
        console.warn('lyrics fetch failed:', e);
        LyricsView.showNotFound('Не удалось загрузить', 'Проверьте интернет или откройте поиск вручную.', track);
    } finally {
        if (myToken === lyricsLoadToken) glowEl?.classList.remove('active');
    }
}
window.openLyrics = openLyrics;

function loadSettings() {
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');

    const navMode = localStorage.getItem('navMode') || 'classic';
    applyNavMode(navMode);

    if (settings.crossfade !== undefined) {
        document.getElementById('crossfadeSlider').value = settings.crossfade;
        document.getElementById('crossfadeValue').textContent = settings.crossfade + ' сек';
    }

    if (settings.fontSize !== undefined) {
        document.getElementById('fontSizeSlider').value = settings.fontSize;
        document.getElementById('fontSizeValue').textContent = settings.fontSize + 'px';
        document.documentElement.style.fontSize = settings.fontSize + 'px';
    }

    if (settings.animation !== undefined) {
        document.getElementById('animationSlider').value = settings.animation;
        document.getElementById('animationValue').textContent = settings.animation + '%';
        applyAnimationIntensity(settings.animation);
    } else {
        respectReducedMotion();
    }

    if (settings.colorPreset) {
        applyColorPreset(settings.colorPreset);
    }

    coverBgEnabled     = !!settings.coverBg;
    coverAccentEnabled = !!settings.coverAccent;

    const bgToggle = document.getElementById('coverBgToggle');
    if (bgToggle) bgToggle.checked = coverBgEnabled;

    const accToggle = document.getElementById('coverAccentToggle');
    if (accToggle) accToggle.checked = coverAccentEnabled;
    if (settings.visualizerMode && visualizer) {
        document.getElementById('visualizerMode').value = settings.visualizerMode;
        visualizer.setMode(settings.visualizerMode);
    }

    if (settings.normalize !== undefined) {
        const toggle = document.getElementById('normalizeToggle');
        if (toggle) toggle.checked = !!settings.normalize;
        if (audioEngine) audioEngine.setNormalize(!!settings.normalize);
    }

    if (settings.quality) {
        const btn = document.querySelector(`#qualityRadio .radio-btn[data-value="${settings.quality}"]`);
        if (btn) {
            document.querySelectorAll('#qualityRadio .radio-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (audioEngine) audioEngine.setQuality(settings.quality);
        }
    }
    if (window.equalizerUI) {
        window.equalizerUI.restore(settings);
    }
    if (settings.crossfade !== undefined && audioEngine) {
        audioEngine.setCrossfade(settings.crossfade);
    }
    if (settings.disableBg === true && backgroundSystem) {
        backgroundSystem.stop();
        const toggle = document.getElementById('disableBgToggle');
        if (toggle) toggle.checked = true;
    }
    const current = audioEngine?.playlist?.[audioEngine.currentIndex];
    if (current) refreshCoverAppearance(current);
    saveSettings();
}

function saveSettings() {
    const settings = {
        quality:       document.querySelector('#qualityRadio .radio-btn.active')?.dataset.value,
        eqPreset:      document.getElementById('eqPreset').value,
        crossfade:     parseInt(document.getElementById('crossfadeSlider').value),
        normalize:     document.getElementById('normalizeToggle').checked,
        fontSize:      parseInt(document.getElementById('fontSizeSlider').value),
        animation:     parseInt(document.getElementById('animationSlider').value),
        disableBg:     document.getElementById('disableBgToggle').checked,
        visualizerMode: document.getElementById('visualizerMode')?.value,
        eqCustomGains: window.equalizerUI ? window.equalizerUI.currentGains : undefined,
        navMode:       localStorage.getItem('navMode') || 'classic',
        coverBg:          document.getElementById('coverBgToggle')?.checked || false,
        coverAccent:      document.getElementById('coverAccentToggle')?.checked || false,
    };
    localStorage.setItem('settings', JSON.stringify(settings));
}

function setupCardTilt() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(hover: hover)').matches) return;

    const CONFIG = {
        '.profile-hero': { max: 8 },
        '.player-cover': { max: 10 },
        '.lyrics-cover': { max: 18 },
    };

    const selectors = Object.keys(CONFIG);
    const state = new Map();

    function getState(el) {
        if (!state.has(el)) {
            state.set(el, { curX: 0, curY: 0, targetX: 0, targetY: 0, rafId: null });
        }
        return state.get(el);
    }

    function apply(el) {
        const s = getState(el);
        s.rafId = null;
        s.curX += (s.targetX - s.curX) * 0.18;
        s.curY += (s.targetY - s.curY) * 0.18;

        el.style.transform =
            `perspective(900px) rotateY(${s.curX.toFixed(2)}deg) rotateX(${s.curY.toFixed(2)}deg)`;
        if (Math.abs(s.targetX - s.curX) > 0.02 || Math.abs(s.targetY - s.curY) > 0.02) {
            s.rafId = requestAnimationFrame(() => apply(el));
        } else {
            if (s.targetX === 0 && s.targetY === 0) el.style.transform = '';
        }
    }

    function tick(el) {
        const s = getState(el);
        if (!s.rafId) s.rafId = requestAnimationFrame(() => apply(el));
    }

    function resetAll() {
        for (const [el, s] of state) {
            s.targetX = 0;
            s.targetY = 0;
            tick(el);
        }
    }

    document.addEventListener('mousemove', (e) => {
        if (typeof isEcoMode !== 'undefined' && isEcoMode) {
            resetAll();
            return;
        }

        for (const [el] of state) {
            if (!document.contains(el)) state.delete(el);
        }

        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (!el) continue;

            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;

            const cfg = CONFIG[sel];
            const s = getState(el);
            const inside =
                e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top  && e.clientY <= rect.bottom;

            if (inside) {
                const relX = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
                const relY = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);

                s.targetX = Math.max(-cfg.max, Math.min(cfg.max, relX * cfg.max));
                s.targetY = Math.max(-cfg.max, Math.min(cfg.max, relY * cfg.max));
            } else {
                s.targetX = 0;
                s.targetY = 0;
            }
            tick(el);
        }
    });

    document.addEventListener('mouseleave', resetAll);
}

function setupCustomCursor() {
    if (!window.matchMedia('(hover: hover)').matches) return;
    
    const dot = document.createElement('div');
    dot.className = 'cursor-dot';
    const ring = document.createElement('div');
    ring.className = 'cursor-ring';
    document.body.append(dot, ring);
    
    let mx = 0, my = 0, rx = 0, ry = 0;
    
    document.addEventListener('mousemove', e => {
        mx = e.clientX; my = e.clientY;
        dot.style.transform = `translate(${mx}px, ${my}px)`;
    });
    
    function loop() {
        rx += (mx - rx) * 0.18;
        ry += (my - ry) * 0.18;
        ring.style.transform = `translate(${rx}px, ${ry}px)`;
        requestAnimationFrame(loop);
    }
    loop();
    
    document.addEventListener('mouseover', e => {
        const interactive = e.target.closest('button, a, .nav-item, .control-btn, .queue-plate, [role="button"]');
        ring.classList.toggle('grow', !!interactive);
    });
}

function setupEvents() {
    const pageTransition = new PageTransition();
    
    setupGlobalSearch();

        // нижний док
    setupBottomNav();

    // тумблер режима навигации
    document.querySelectorAll('#navModeRadio .radio-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#navModeRadio .radio-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyNavMode(btn.dataset.value);
            showNotification(btn.dataset.value === 'mbox'
                ? 'Навигация: Mbox (нижний док)'
                : 'Навигация: Классика (в шапке)');
        });
    });

    const savedPage = localStorage.getItem('currentPage');
    if (savedPage && savedPage !== 'home' && document.getElementById('page-' + savedPage)) {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const targetNav = document.querySelector(`.nav-item[data-page="${savedPage}"]`);
        if (targetNav) targetNav.classList.add('active');
        document.getElementById('page-' + savedPage).classList.add('active');

        // Показываем мини-плеер сразу (без анимации)
        if (window.miniPlayer) window.miniPlayer.show();
    }


    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (item.classList.contains('active')) return;

            // ripple
            if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                const rect = item.getBoundingClientRect();
                const ripple = document.createElement('span');
                ripple.className = 'nav-ripple-el';
                const size = Math.max(rect.width, rect.height) * 0.9;
                ripple.style.width = ripple.style.height = size + 'px';
                ripple.style.left = (e.clientX - rect.left) + 'px';
                ripple.style.top  = (e.clientY - rect.top)  + 'px';
                item.appendChild(ripple);
                setTimeout(() => ripple.remove(), 600);
            }
            const targetPage  = item.dataset.page;
            const currentPage = document.querySelector('.nav-item.active')?.dataset.page || 'home';

            if (window.miniPlayer) {
                window.miniPlayer.prepareTransition(currentPage, targetPage);
            }

        if (targetPage === 'home') {
            setTimeout(() => {
                if (isEcoMode) return;
                const g = ensureGlobe();
                if (g) {
                    g.onRegionSelect = (regionIdx) => openRegionPage(regionIdx);
                }
                g.resize();
                g.start();
            }, 900);
        } else if (currentPage === 'home') {
            window.globeView?.stop();
        }

            pageTransition.play(() => {
                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                item.classList.add('active');
                item.classList.remove('nav-pop');
                void item.offsetWidth;   // перезапуск анимации
                item.classList.add('nav-pop');
                setTimeout(() => item.classList.remove('nav-pop'), 500);
                document.getElementById('page-' + targetPage).classList.add('active');
                localStorage.setItem('currentPage', targetPage);

                if (targetPage === 'charts') {
                    buildTop100();
                    buildChartPlaylists();
                }

                // пересчёт позиции нижнего дока под текущую страницу
                setTimeout(positionBottomNav, 100);

                // Запускаем FLIP-анимацию мини-плеера, пока экран закрыт квадратами
                if (window.miniPlayer) {
                    window.miniPlayer.applyTransition(targetPage);
                }
            });
        });
    });

    document.getElementById('ecoToggle').addEventListener('change', (e) => {
        toggleEcoMode(e.target.checked);
    });

    document.getElementById('playBtn').addEventListener('click', () => {
        audioEngine.togglePlay();
    });
    document.getElementById('mainPlayBtn').addEventListener('click', () => {
        document.getElementById('playBtn').click();
    });

        // клик по артисту в плеере и в stage → страница артиста
    ['trackArtist', 'stageMetaArtist'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.cursor = 'pointer';
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const cur = audioEngine?.playlist?.[audioEngine.currentIndex];
            if (cur && cur.artist) openArtistPage(cur.artist);
        });
    });

    document.getElementById('prevBtn').addEventListener('click', () => audioEngine.prev());
    document.getElementById('nextBtn').addEventListener('click', () => audioEngine.next());
    document.getElementById('lyricsBtn')?.addEventListener('click', () => {
        if (audioEngine.playlist.length === 0) {
            showNotification('Сначала загрузите треки', true);
            return;
        }
        openLyrics(audioEngine.currentIndex);
    });
    document.getElementById('shuffleBtn').addEventListener('click', () => {
        const isShuffle = audioEngine.toggleShuffle();
        document.getElementById('shuffleBtn').style.opacity = isShuffle ? '1' : '0.5';
    });
    document.getElementById('repeatBtn').addEventListener('click', () => {
        const mode = audioEngine.cycleRepeat();
        const btn = document.getElementById('repeatBtn');
        btn.style.opacity = mode === 'off' ? '0.5' : '1';
        btn.title = `Повтор: ${mode}`;
    });

    (() => {
        const pw = document.getElementById('progressWrapper');
        const fill = document.getElementById('progressFill');
        let dragging = false;

        const seekTo = (clientX) => {
            const rect = pw.getBoundingClientRect();
            const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
            audioEngine.seek(pct);
            fill.style.width = pct + '%';
            document.getElementById('currentTime').textContent =
                audioEngine.formatTime(audioEngine.audio.currentTime);
        };

        pw.addEventListener('mousedown', (e) => {
            dragging = true;
            document.body.style.userSelect = 'none';
            seekTo(e.clientX);
        });
        window.addEventListener('mousemove', (e) => { if (dragging) seekTo(e.clientX); });
        window.addEventListener('mouseup', () => {
            dragging = false;
            document.body.style.userSelect = '';
        });

        pw.addEventListener('touchstart', (e) => {
            dragging = true;
            seekTo(e.touches[0].clientX);
        }, { passive: true });
        pw.addEventListener('touchmove', (e) => {
            if (dragging) seekTo(e.touches[0].clientX);
        }, { passive: true });
        pw.addEventListener('touchend', () => { dragging = false; });
    })();

    document.getElementById('volumeSlider').addEventListener('input', (e) => {
        audioEngine.setVolume(e.target.value);
    });

    document.getElementById('volumeIconBtn')?.addEventListener('click', () => {
        audioEngine.toggleMute();
    });

    document.getElementById('likedTile').addEventListener('click', openLikedModal);
    document.getElementById('playlistsTile').addEventListener('click', openPlaylistsModal);
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('active');
        });
    });

    document.querySelectorAll('.radio-group').forEach(group => {
        group.querySelectorAll('.radio-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                group.querySelectorAll('.radio-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                if (group.id === 'qualityRadio' && audioEngine) {
                    const value = btn.dataset.value;
                    audioEngine.setQuality(value);
                    const labels = { low: 'Low', normal: 'Normal', high: 'High', lossless: 'Lossless' };
                    showNotification(`Качество звука: ${labels[value]}`);
                }

                saveSettings();
            });
        });
    });

    document.getElementById('disableBgToggle')?.addEventListener('change', (e) => {
        if (e.target.checked) {
            backgroundSystem.stop();
        } else if (!isEcoMode) {
            backgroundSystem.start();
        }
    });

    document.querySelectorAll('.select').forEach(select => {
        select.addEventListener('change', () => saveSettings());
    });

    document.getElementById('crossfadeSlider').addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        document.getElementById('crossfadeValue').textContent = val + ' сек';
        if (audioEngine) audioEngine.setCrossfade(val);
        saveSettings();
    });

    document.getElementById('fontSizeSlider').addEventListener('input', (e) => {
        document.getElementById('fontSizeValue').textContent = e.target.value + 'px';
        document.documentElement.style.fontSize = e.target.value + 'px';
        saveSettings();
    });

    document.getElementById('animationSlider').addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        document.getElementById('animationValue').textContent = val + '%';
        applyAnimationIntensity(val);
        saveSettings();
    });

        document.getElementById('coverBgToggle')?.addEventListener('change', (e) => {
        coverBgEnabled = e.target.checked;
        const current = audioEngine.playlist[audioEngine.currentIndex];
        setCoverBackground(current);
        saveSettings();
        showNotification(e.target.checked
            ? 'Обложка как фон: Вкл'
            : 'Обложка как фон: Выкл');
    });

    document.getElementById('coverAccentToggle')?.addEventListener('change', async (e) => {
        coverAccentEnabled = e.target.checked;
        if (coverAccentEnabled) {
            const current = audioEngine.playlist[audioEngine.currentIndex];
            await applyCoverAccent(current);
        } else {
            restoreUserAccent();
        }
        saveSettings();
        showNotification(e.target.checked
            ? 'Акцент под обложку: Вкл'
            : 'Акцент под обложку: Выкл');
    });

    document.getElementById('reducedMotionToggle')?.addEventListener('change', (e) => {
        const val = e.target.checked ? 20 : 100;
        document.getElementById('animationSlider').value = val;
        document.getElementById('animationValue').textContent = val + '%';
        applyAnimationIntensity(val);
        saveSettings();
    });

    document.getElementById('clearCacheBtn').addEventListener('click', async () => {
        if (!confirm('Удалить все сохранённые треки? Это действие нельзя отменить.')) return;

        if (window.trackStorage) {
            await window.trackStorage.clearAll();
        }

        if (audioEngine) {
            for (const t of audioEngine.playlist) {
                if (t.url && t.url.startsWith('blob:')) {
                    try { URL.revokeObjectURL(t.url); } catch (e) {}
                }
            }
            audioEngine.playlist = [];
            audioEngine.currentIndex = 0;
            audioEngine.pause();
            audioEngine.audio.removeAttribute('src');
            audioEngine.audio.load();
            document.getElementById('trackTitle').textContent = 'Загрузите музыку';
            document.getElementById('trackArtist').textContent = 'Нажмите кнопку "Загрузить"';
        }

        if (window.fileUploadSystem) window.fileUploadSystem.updateTrackListUI();
        if (window.trackQueue) window.trackQueue.render();

        updateCacheSize();
        showNotification('Хранилище очищено');
    });

    const SUPPORT_EMAIL = 'mus.mbox@gmail.com';

    document.querySelectorAll('.account-item').forEach(item => {
        item.addEventListener('click', () => {
            if (item.dataset.action === 'support') {
                openSupportModal();
                return;
            }

            const label = item.querySelector('.account-item-label').textContent;
            showNotification(`Открытие: ${label}`);
        });
    });

    setupSupportForm();

    document.querySelector('.logout-btn').addEventListener('click', () => {
        RegistrationSystem.logout();
    });
    document.querySelectorAll('.genre-tag').forEach(tag => {
        tag.addEventListener('click', () => showNotification(`Жанр: ${tag.textContent}`));
    });
    document.querySelectorAll('.achievement').forEach(ach => {
        ach.addEventListener('click', () => {
            if (!ach.classList.contains('locked')) {
                const name = ach.querySelector('.achievement-name').textContent;
                showNotification(`Достижение: ${name}`);
            }
        });
    });

    document.getElementById('visualizerMode')?.addEventListener('change', (e) => {
        if (visualizer) visualizer.setMode(e.target.value);
        saveSettings();
    });

    document.getElementById('normalizeToggle')?.addEventListener('change', (e) => {
        audioEngine.setNormalize(e.target.checked);
        saveSettings();
        showNotification(e.target.checked
            ? 'Нормализация громкости: Вкл'
            : 'Нормализация громкости: Выкл');
    });

        const lyricsModal = document.getElementById('lyricsModal');
        if (lyricsModal) {
            new MutationObserver(() => {
                if (!lyricsModal.classList.contains('active')) {
                    document.getElementById('lyricsGlow')?.classList.remove('active');
                    if (window.LyricsView) window.LyricsView.reset();
                    if (window.miniPlayer) window.miniPlayer.restoreAfterModal();
                }
            }).observe(lyricsModal, { attributes: true, attributeFilter: ['class'] });
        }

    // artist modal: закрытие
    const artistModal = document.getElementById('artistModal');
    if (artistModal) {
        document.getElementById('artistModalClose')?.addEventListener('click', closeArtistModal);
        artistModal.addEventListener('click', (e) => {
            if (e.target === artistModal) closeArtistModal();
        });
    }

    // region modal: закрытие
    const regionModal = document.getElementById('regionModal');
    if (regionModal) {
        document.getElementById('regionModalClose')?.addEventListener('click', closeRegionModal);
        regionModal.addEventListener('click', (e) => {
            if (e.target === regionModal) closeRegionModal();
        });
    }

    (() => {
        const STORAGE_KEY = 'sidebarCollapsed';
        let state = {};
        try { state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (e) {}

        document.querySelectorAll('.sidebar-block[data-collapsible]').forEach(block => {
            const key = block.dataset.collapsible;
            const btn = block.querySelector('.sidebar-block-toggle');
            if (!btn) return;

            if (state[key]) {
                block.classList.add('is-collapsed');
                btn.setAttribute('aria-expanded', 'false');
            }

            btn.addEventListener('click', () => {
                const collapsed = block.classList.toggle('is-collapsed');
                btn.setAttribute('aria-expanded', String(!collapsed));
                state[key] = collapsed;
                try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
            });
        });
    })();

        // переключатель stage: глобус ↔ обложка
    const stageToggle = document.getElementById('stageToggle');
    const stageColumn = document.getElementById('stageColumn');

    stageToggle?.addEventListener('click', () => {
        if (!stageColumn) return;
        const currentlyCover = stageColumn.classList.contains('show-cover');
        applyStageMode(!currentlyCover, { animate: true });
    });

    // пульс-подсказка: показать на 5 секунд после загрузки
    if (stageToggle && stageColumn) {
        stageToggle.classList.add('hint-visible');
        setTimeout(() => {
            stageToggle.classList.remove('hint-visible');
        }, 5000);
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const am = document.getElementById('artistModal');
            if (am && am.classList.contains('active')) {
                closeArtistModal();
                return;
            }
            const rm = document.getElementById('regionModal');
            if (rm && rm.classList.contains('active')) {
                closeRegionModal();
                return;
            }
        }

        if (e.target.closest('input, select, textarea, button, [contenteditable]')) return;

        if (e.code === 'Space') {
            e.preventDefault();
            document.getElementById('playBtn').click();
        } else if (e.ctrlKey && e.code === 'ArrowRight') {
            e.preventDefault();
            audioEngine.next();
        } else if (e.ctrlKey && e.code === 'ArrowLeft') {
            e.preventDefault();
            audioEngine.prev();
        } else if (e.ctrlKey && e.code === 'ArrowUp') {
            e.preventDefault();
            const vol = Math.min(100, parseInt(document.getElementById('volumeSlider').value) + 5);
            document.getElementById('volumeSlider').value = vol;
            audioEngine.setVolume(vol);
        } else if (e.ctrlKey && e.code === 'ArrowDown') {
            e.preventDefault();
            const vol = Math.max(0, parseInt(document.getElementById('volumeSlider').value) - 5);
            document.getElementById('volumeSlider').value = vol;
            audioEngine.setVolume(vol);
        } else if (e.ctrlKey && e.code === 'KeyE') {
            e.preventDefault();
            const eco = document.getElementById('ecoToggle');
            eco.checked = !eco.checked;
            toggleEcoMode(eco.checked);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    init().catch(e => console.error('Init error:', e));
});