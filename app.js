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
    };
    audioEngine.onPause = () => {
        visualizer.stop();
    };

    audioEngine.onTrackChange = (track) => {
        refreshCoverAppearance(track);
        const modal = document.getElementById('lyricsModal');
        if (modal && modal.classList.contains('active')) {
            openLyrics(audioEngine.currentIndex, { isRefresh: true });
        }
    };

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
    buildSphere();
    buildRecommendations();
    buildChartPlaylists();
    buildTop100();
    buildPlaylistsModal();
    loadSettings();
    setupEvents();
    updateCacheSize();
    window.tipPanel = new TipPanel();
    audioEngine.updateVolumeUI();

    
    backgroundSystem.start();
    let restored = 0;
    try {
        restored = await audioEngine.restoreFromStorage();
    } catch (e) {
        console.warn('Восстановление треков не удалось:', e);
    }

    fileUploadSystem.updateTrackListUI();
    if (window.trackQueue) window.trackQueue.render();

    if (restored > 0) {
        showNotification(`Загружено треков из хранилища: ${restored}`);
    }

    function updateLoop(timestamp) {
        if (audioEngine.isPlaying) {
            const threshold = isEcoMode ? 33.33 : 16.66;
            if (timestamp - lastProgressUpdate >= threshold) {
                lastProgressUpdate = timestamp;
                const cur = audioEngine.audio.currentTime;
                const dur = audioEngine.audio.duration || 0;
                const pct = dur > 0 ? (cur / dur) * 100 : 0;
                document.getElementById('progressFill').style.width = pct + '%';
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

function buildSphere() {
    const sphere = document.getElementById('sphere');
    for (let i = 0; i < 60; i++) {
        const el = document.createElement('div');
        el.className = 'sphere-element';
        const phi = Math.acos(1 - 2 * (i + 0.5) / 60);
        const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5);
        const r = 130;
        el.style.transform = `translate3d(${r * Math.sin(phi) * Math.cos(theta)}px, ${r * Math.sin(phi) * Math.sin(theta)}px, ${r * Math.cos(phi)}px)`;
        el.style.animationDelay = `${Math.random() * 3}s`;
        sphere.appendChild(el);
    }
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

function buildRecommendations() {
    const grid = document.getElementById('recGrid');
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

function buildChartPlaylists() {
    const grid = document.getElementById('playlistsGrid');
    grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
            <div class="empty-state-icon">★</div>
            <div class="empty-state-title">Подборки скоро появятся</div>
            <div class="empty-state-text">
                Мы работаем над музыкальными подборками. Пока слушайте свои треки
            </div>
        </div>
    `;
}

function buildTop100() {
    const list = document.getElementById('top100List');
    list.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">#</div>
            <div class="empty-state-title">Чарт пуст</div>
            <div class="empty-state-text">
                Топ 100 появится, когда у нас будет достаточно статистики прослушиваний
            </div>
        </div>
    `;
}

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
        countEl.textContent = `${n} ${n === 1 ? 'плейлист' : (n >= 2 && n <= 4 ? 'плейлиста' : 'плейлистов')}`;
    }
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

function toggleEcoMode(enabled) {
    isEcoMode = enabled;
    document.body.classList.toggle('eco-mode', enabled);
    const statusText = document.getElementById('ecoStatusText');
    statusText.textContent = enabled ? 'Включен' : 'Выключен';
    statusText.style.color = enabled ? '#4CAF50' : '#ff3b30';
    if (enabled) {
        visualizer.stop();
        backgroundSystem.stop();
    } else {
        backgroundSystem.start();
        if (audioEngine.isPlaying) visualizer.start();
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

// Лирика

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

    renderLyrics(text, sourceUrl) {
        if (!this.linesEl) return;
        const raw = String(text).split(/\r?\n/);
        this.linesEl.innerHTML = '';
        this.lineEls = [];

        raw.forEach(line => {
            const el = document.createElement('div');
            el.className = 'lyrics-line';
            el.textContent = line.length === 0 ? '\u00A0' : line;
            this.linesEl.appendChild(el);
            this.lineEls.push(el);
        });

        const srcEl = document.getElementById('lyricsSource');
        if (srcEl) {
            srcEl.innerHTML = sourceUrl
                ? `Источник: <a href="${sourceUrl}" target="_blank" rel="noopener">LRCLIB</a>`
                : '';
        }
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
            this._scrollBound = true;
        }
        requestAnimationFrame(() => this._updateFocus());
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
    }
};

window.LyricsView = LyricsView;

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
        modal.classList.add('active');
        glowEl?.classList.add('active');
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
        LyricsView.renderLyrics(track._lyricsCache.text, 'https://lrclib.net');
        if (!isRefresh) LyricsView.reveal();
        else requestAnimationFrame(() => LyricsView._updateFocus());
        glowEl?.classList.remove('active');
        return;
    }

    const isCyr = (s) => /[а-яё]/i.test(String(s || ''));
    if (isCyr(track.artist) || isCyr(track.title)) {
        if (myToken !== lyricsLoadToken) return;
        LyricsView.showNotFound(
            'Откроем на Genius',
            'Русские треки LRCLIB почти не индексирует. Нажмите кнопку ниже.',
            track
        );
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

        const text = best.plainLyrics
            || (best.syncedLyrics || '').replace(/\[\d+:\d+\.\d+\]/g, '').trim();

        if (!text) {
            LyricsView.showNotFound('Текст пустой', 'Запись нашлась, но без содержимого.', track);
            return;
        }

        track._lyricsCache = {
            text,
            source: 'lrclib',
            lrclibId: best.id,
            artist: best.artistName || track.artist,
            title:  best.trackName  || track.title
        };

        LyricsView.renderLyrics(text, 'https://lrclib.net');
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
        coverBg:          document.getElementById('coverBgToggle')?.checked || false,
        coverAccent:      document.getElementById('coverAccentToggle')?.checked || false,
    };
    localStorage.setItem('settings', JSON.stringify(settings));
}

function setupEvents() {
    const pageTransition = new PageTransition();

    const savedPage = localStorage.getItem('currentPage');
    if (savedPage && savedPage !== 'home' && document.getElementById('page-' + savedPage)) {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const targetNav = document.querySelector(`.nav-item[data-page="${savedPage}"]`);
        if (targetNav) targetNav.classList.add('active');
        document.getElementById('page-' + savedPage).classList.add('active');
    
     if (savedPage === 'world') {
        setTimeout(() => {
            const g = ensureGlobe();
            g.resize();
            g.start();
        }, 200);
    }
}    

    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            if (item.classList.contains('active')) return;
            const targetPage = item.dataset.page;

            if (targetPage === 'world') {
                setTimeout(() => {
                    const g = ensureGlobe();
                    g.resize();
                    g.start();
                }, 900);
            } else {
                window.globeView?.stop();
            }
            pageTransition.play(() => {
                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                item.classList.add('active');
                document.getElementById('page-' + targetPage).classList.add('active');
                localStorage.setItem('currentPage', targetPage);
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

    document.querySelectorAll('.account-item').forEach(item => {
        item.addEventListener('click', () => {
            const label = item.querySelector('.account-item-label').textContent;
            showNotification(`Открытие: ${label}`);
        });
    });
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
                }
            }).observe(lyricsModal, { attributes: true, attributeFilter: ['class'] });
    }

    document.addEventListener('keydown', (e) => {
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