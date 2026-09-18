let audioEngine, fileUploadSystem, visualizer, backgroundSystem,
    playlistManager, contextMenu, registrationSystem;
let isEcoMode = false;
let lastProgressUpdate = 0;

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

    // Глобальные ссылки для inline-обработчиков
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

    backgroundSystem.start();
    fileUploadSystem.updateTrackListUI();

    try {
        const restored = await audioEngine.restoreFromStorage();
        if (restored > 0) {
            fileUploadSystem.updateTrackListUI();
            if (window.trackQueue) window.trackQueue.render();
            showNotification(`Загружено треков из хранилища: ${restored}`);
        }
    } catch (e) {
        console.warn('Восстановление треков не удалось:', e);
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

    // Треки плейлиста — в начало очереди, остальная библиотека — следом.
    // Ничего не теряется, плейлист играет первым, после него продолжается библиотека.
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

    if (settings.visualizerMode && visualizer) {
        document.getElementById('visualizerMode').value = settings.visualizerMode;
        visualizer.setMode(settings.visualizerMode);
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
    if (settings.colorPreset) {
        applyColorPreset(settings.colorPreset);
    }
    saveSettings();
}

function saveSettings() {
    const settings = {
        quality:       document.querySelector('#qualityRadio .radio-btn.active')?.dataset.value,
        eqPreset:      document.getElementById('eqPreset').value,
        crossfade:     parseInt(document.getElementById('crossfadeSlider').value),
        normalize:     document.getElementById('normalizeToggle').checked,
        automix:       document.getElementById('automixToggle').checked,
        autostart:     document.getElementById('autostartToggle').checked,
        repeatMode:    document.getElementById('repeatMode').value,
        fontSize:      parseInt(document.getElementById('fontSizeSlider').value),
        animation:     parseInt(document.getElementById('animationSlider').value),
        disableBg:     document.getElementById('disableBgToggle').checked,
        visualizerMode: document.getElementById('visualizerMode')?.value,
        colorPreset:   localStorage.getItem('colorPreset') || 'yellow',
        eqCustomGains: window.equalizerUI ? window.equalizerUI.currentGains : undefined,
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

        document.getElementById('disableBgToggle')?.addEventListener('change', (e) => {
            if (e.target.checked) {
                backgroundSystem.stop();
            } else if (!isEcoMode) {
                backgroundSystem.start();
            }
        });
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