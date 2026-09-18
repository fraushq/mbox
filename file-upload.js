class FileUploadSystem {
    constructor(audioEngine) {
        this.audioEngine = audioEngine;
        this.dropZone = null;
        this.fileInput = null;
        this.init();
    }

    init() {
        const headerBtn = document.getElementById('uploadBtnHeader');
        if (headerBtn) headerBtn.addEventListener('click', () => this.showDropZone());

        const uploadTile = document.getElementById('uploadTile');
        if (uploadTile) uploadTile.addEventListener('click', () => this.showDropZone());

        this.createDropZone();
        this.setupEventListeners();
    }

    createDropZone() {
        this.dropZone = document.createElement('div');
        this.dropZone.className = 'drop-zone';
        this.dropZone.innerHTML = `
            <div class="drop-zone-content">
                <div class="drop-zone-icon">📁</div>
                <div class="drop-zone-title">Перетащите аудиофайлы сюда</div>
                <div class="drop-zone-subtitle">или нажмите для выбора файлов</div>
            </div>
        `;
        this.dropZone.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.85); backdrop-filter: blur(20px);
            z-index: 9999; display: none; align-items: center; justify-content: center;
            cursor: pointer; transition: opacity 0.3s ease;
        `;
        document.body.appendChild(this.dropZone);
    }

    setupEventListeners() {
        this.dropZone.addEventListener('click', () => this.openFilePicker());
        this.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dropZone.querySelector('.drop-zone-content').style.borderColor = 'rgba(255,255,255,0.8)';
        });
        this.dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            this.dropZone.querySelector('.drop-zone-content').style.borderColor = 'rgba(255,255,255,0.3)';
        });
        this.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.handleFiles(Array.from(e.dataTransfer.files));
            this.hideDropZone();
        });
        document.addEventListener('dragover', (e) => e.preventDefault());
        document.addEventListener('drop', (e) => {
            e.preventDefault();
            if (e.target !== this.dropZone && !this.dropZone.contains(e.target)) {
                const files = Array.from(e.dataTransfer.files);
                const audio = files.filter(f => f.type.startsWith('audio/'));
                const images = files.filter(f => f.type.startsWith('image/'));
                if (audio.length) this.handleFiles(audio);
                if (images.length && window.backgroundManager) {
                    images.forEach(f => window.backgroundManager.handleFile(f));
                }
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.hideDropZone();
        });
    }

    showDropZone() { this.dropZone.style.display = 'flex'; }
    hideDropZone() { this.dropZone.style.display = 'none'; }

    openFilePicker() {
        if (!this.fileInput) {
            this.fileInput = document.createElement('input');
            this.fileInput.type = 'file';
            this.fileInput.accept = 'audio/*';
            this.fileInput.multiple = true;
            this.fileInput.style.display = 'none';
            this.fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) this.handleFiles(Array.from(e.target.files));
                this.hideDropZone();
                this.fileInput.value = '';
            });
            document.body.appendChild(this.fileInput);
        }
        this.fileInput.click();
    }

    handleFiles(files) {
        const tracks = this.audioEngine.addTracks(files);
        if (tracks.length > 0) {
            this.showNotification(`✅ Загружено треков: ${tracks.length}`);
            this.updateTrackListUI();
        } else {
            this.showNotification('⚠️ Выберите аудиофайлы', true);
        }
    }

    updateTrackListUI() {
        // ── Последние добавленные ──
        const recentGrid = document.getElementById('recentGrid');
        if (recentGrid) {
            recentGrid.innerHTML = '';
            const recent = [...this.audioEngine.playlist]
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                .slice(0, 8);

            recent.forEach((track) => {
                const actualIndex = this.audioEngine.playlist.indexOf(track);
                const card = document.createElement('div');
                card.className = 'recent-card glass';
                card.innerHTML = `
                    <div class="recent-cover">🎵</div>
                    <div class="recent-info">
                        <div class="recent-title">${escapeHtml(track.title)}</div>
                        <div class="recent-artist">${escapeHtml(track.artist)}</div>
                    </div>
                `;
                card.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    if (window.contextMenu) window.contextMenu.show(e.clientX, e.clientY, actualIndex);
                });
                card.addEventListener('click', () => {
                    this.audioEngine.currentIndex = actualIndex;
                    this.audioEngine.loadCurrentTrack();
                    this.audioEngine.play();
                    document.querySelector('[data-page="home"]').click();
                });
                recentGrid.appendChild(card);
            });
        }

        // ── Счётчик в «Моя музыка» ──
        const likedCount = document.getElementById('likedCount');
        if (likedCount) likedCount.textContent = `${this.audioEngine.playlist.length} треков`;

        // ── Все загруженные треки ──
        const uploaded = document.getElementById('uploadedTracksList');
        if (uploaded) {
            uploaded.innerHTML = '';
            this.audioEngine.playlist.forEach((track, idx) => {
                const item = document.createElement('div');
                item.className = 'track-list-item glass';
                item.innerHTML = `
                    <div>
                        <div style="font-weight:600">${escapeHtml(track.title)}</div>
                        <div style="font-size:12px;color:var(--text-secondary)">${escapeHtml(track.artist)}</div>
                    </div>
                    <div style="color:var(--y)">▶</div>
                `;
                item.addEventListener('click', () => {
                    this.audioEngine.currentIndex = idx;
                    this.audioEngine.loadCurrentTrack();
                    this.audioEngine.play();
                });
                item.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    window.contextMenu?.show(e.clientX, e.clientY, idx);
                });
                uploaded.appendChild(item);
            });
        }

        // ── Счётчик плейлистов ──
        const playlistCount = document.getElementById('playlistCount');
        if (playlistCount && window.playlistManager) {
            const n = window.playlistManager.getPlaylistCount();
            playlistCount.textContent = `${n} ${n === 1 ? 'плейлист' : (n >= 2 && n <= 4 ? 'плейлиста' : 'плейлистов')}`;
        }

    // ── Очередь-карусель ──
    if (window.trackQueue) window.trackQueue.render();
}

    showNotification(message, isError = false) {
        const n = document.createElement('div');
        n.textContent = message;
        n.style.cssText = `position: fixed; top: 100px; right: 20px; padding: 16px 24px; background: ${isError ? 'rgba(255,59,48,0.9)' : 'rgba(76,175,80,0.9)'}; border-radius: 12px; color: white; font-weight: 600; z-index: 10000; box-shadow: 0 8px 32px rgba(0,0,0,0.3); animation: slideIn 0.3s ease forwards;`;
        document.body.appendChild(n);
        setTimeout(() => {
            n.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => n.remove(), 300);
        }, 3000);
    }
}