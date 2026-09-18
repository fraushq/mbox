class AudioEngine {
    constructor() {
        this.audio = new Audio();
        this.audio.crossOrigin = 'anonymous';
        this.audio.preload = 'metadata';
        this.playlist = [];
        this.currentIndex = 0;
        this.isPlaying = false;
        this.shuffle = false;
        this.repeatMode = 'off'; // 'off' | 'all' | 'one'
        this.volume = 0.75;
        this.audio.volume = this.volume;
        this.audioCtx = null;
        this.analyser = null;
        this.sourceNode = null;
        this.highpass = null;
        this.lowpass = null;
        this.fadeGain = null;
        this.currentQuality = 'high';
        this.currentEQ = 'flat';
        this.crossfadeDuration = 0;
        this.eqFilters = [];
        this._expectFadeIn = false;
        this._isFadingOut = false;
        this.storage = null;
        this.setupListeners();
    }

        setStorage(storage) {
        this.storage = storage;
    }

    setupListeners() {
        this.audio.addEventListener('ended', () => {
            if (this.repeatMode === 'one') {
                this.audio.currentTime = 0;
                this.audio.play().catch(() => {});
            } else {
                this._expectFadeIn = this.crossfadeDuration > 0;
                this.next(true);
            }
            if (typeof this.onPause === 'function') this.onPause();
        });

        this.audio.addEventListener('timeupdate', () => this.checkCrossfade());

        this.audio.addEventListener('play', () => {
            this.isPlaying = true;
            this.updatePlayButtons();
            if (typeof this.onPlay === 'function') this.onPlay();
        });

        this.audio.addEventListener('pause', () => {
            this.isPlaying = false;
            this.updatePlayButtons();
            if (typeof this.onPause === 'function') this.onPause();
        });

        this.audio.addEventListener('loadedmetadata', () => {
            const totalEl = document.getElementById('totalTime');
            if (totalEl) totalEl.textContent = this.formatTime(this.audio.duration);
            const track = this.playlist[this.currentIndex];
            if (track) {
                track.duration = this.audio.duration;
                if (this.storage) {
                    this.storage.updateMetadata(track).catch(() => {});
                }
            }
        });

        this.audio.addEventListener('error', (e) => {
            console.warn('Audio error:', e);
        });
    }

    initAudioContext() {
        if (this.audioCtx) {
            if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
            return;
        }
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            this.audioCtx = new Ctx();

            this.highpass = this.audioCtx.createBiquadFilter();
            this.highpass.type = 'highpass';
            this.highpass.frequency.value = 20;
            this.highpass.Q.value = 0.7;

            this.lowpass = this.audioCtx.createBiquadFilter();
            this.lowpass.type = 'lowpass';
            this.lowpass.frequency.value = 22050;
            this.lowpass.Q.value = 0.7;

            const bands = [
                { freq: 32,    type: 'lowshelf',  Q: 0.7 },
                { freq: 64,    type: 'peaking',   Q: 1.4 },
                { freq: 125,   type: 'peaking',   Q: 1.4 },
                { freq: 250,   type: 'peaking',   Q: 1.4 },
                { freq: 500,   type: 'peaking',   Q: 1.4 },
                { freq: 1000,  type: 'peaking',   Q: 1.4 },
                { freq: 2000,  type: 'peaking',   Q: 1.4 },
                { freq: 4000,  type: 'peaking',   Q: 1.4 },
                { freq: 8000,  type: 'peaking',   Q: 1.4 },
                { freq: 16000, type: 'highshelf', Q: 0.7 }
            ];
            this.eqFilters = bands.map(b => {
                const f = this.audioCtx.createBiquadFilter();
                f.type = b.type;
                f.frequency.value = b.freq;
                f.Q.value = b.Q;
                f.gain.value = 0;
                return f;
            });

            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8;
            this.fadeGain = this.audioCtx.createGain();
            this.fadeGain.gain.value = 1;
            this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);

            let node = this.sourceNode;
            node.connect(this.highpass); node = this.highpass;
            for (const f of this.eqFilters) { node.connect(f); node = f; }
            node.connect(this.lowpass);   node = this.lowpass;
            node.connect(this.fadeGain);  node = this.fadeGain;
            node.connect(this.analyser);
            this.analyser.connect(this.audioCtx.destination);

            this.applyQuality(this.currentQuality);
            this.applyEQ(this.currentEQ);

        } catch (err) {
            console.warn('AudioContext init failed:', err);
            this.audioCtx = null;
            this.analyser = null;
            this.sourceNode = null;
            this.highpass = null;
            this.lowpass = null;
            this.fadeGain = null;
            this.eqFilters = [];
        }
    }

    getFrequencyData() {
        if (!this.analyser) return null;
        const data = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(data);
        return data;
    }

    setEQPreset(preset) {
        const valid = ['flat', 'bass', 'vocal', 'electronic', 'rock', 'classical'];
        if (!valid.includes(preset)) return;
        this.currentEQ = preset;
        if (this.audioCtx) this.applyEQ(preset);
    }

    applyEQ(preset) {
        if (!this.eqFilters.length) return;
        const gains = EQ_PRESETS[preset] || EQ_PRESETS.flat;
        this.applyEQGains(gains);
    }

    applyEQGains(gainsArray) {
        if (!this.eqFilters.length || !this.audioCtx) return;
        const now = this.audioCtx.currentTime;
        const smooth = 0.05;
        this.eqFilters.forEach((f, i) => {
            const g = Math.max(-12, Math.min(12, gainsArray[i] || 0));
            f.gain.setTargetAtTime(g, now, smooth);
        });
    }

    setEQGains(gainsArray) {
        if (!this.eqFilters.length) return;
        this.applyEQGains(gainsArray);
        this.currentEQ = 'custom';
    }

    getEQGains() {
        if (!this.eqFilters.length) return [...EQ_PRESETS.flat];
        return this.eqFilters.map(f => f.gain.value);
    }

    setQuality(level) {
        if (!['low', 'normal', 'high', 'lossless'].includes(level)) return;
        this.currentQuality = level;
        if (this.audioCtx) this.applyQuality(level);
    }

    applyQuality(level) {
        if (!this.highpass || !this.lowpass || !this.analyser) return;
        const now = this.audioCtx.currentTime;
        const smooth = 0.05;

        switch (level) {
            case 'low':
                this.highpass.frequency.setTargetAtTime(300, now, smooth);
                this.lowpass.frequency.setTargetAtTime(3400, now, smooth);
                this.analyser.fftSize = 128;
                break;
            case 'normal':
                this.highpass.frequency.setTargetAtTime(60, now, smooth);
                this.lowpass.frequency.setTargetAtTime(8000, now, smooth);
                this.analyser.fftSize = 256;
                break;
            case 'high':
                this.highpass.frequency.setTargetAtTime(20, now, smooth);
                this.lowpass.frequency.setTargetAtTime(16000, now, smooth);
                this.analyser.fftSize = 256;
                break;
            case 'lossless':
                this.highpass.frequency.setTargetAtTime(15, now, smooth);
                this.lowpass.frequency.setTargetAtTime(22050, now, smooth);
                this.analyser.fftSize = 256;
                break;
        }
    }

    setCrossfade(seconds) {
        const s = Math.max(0, Math.min(12, parseInt(seconds, 10) || 0));
        this.crossfadeDuration = s;
    }

    checkCrossfade() {
        if (!this.crossfadeDuration || !this.fadeGain) return;
        if (this._isFadingOut) return;

        const dur = this.audio.duration;
        if (!dur || !isFinite(dur) || dur <= 0) return;

        const remain = dur - this.audio.currentTime;
        if (remain <= this.crossfadeDuration && remain > 0.05) {
            this._isFadingOut = true;
            this.fadeOut(this.crossfadeDuration);
        }
    }

    fadeOut(duration) {
        if (!this.fadeGain || !this.audioCtx) return;
        const now = this.audioCtx.currentTime;
        this.fadeGain.gain.cancelScheduledValues(now);
        this.fadeGain.gain.setValueAtTime(this.fadeGain.gain.value, now);
        this.fadeGain.gain.linearRampToValueAtTime(0.0001, now + duration);
    }

    fadeIn(duration) {
        if (!this.fadeGain || !this.audioCtx) return;
        const now = this.audioCtx.currentTime;
        this.fadeGain.gain.cancelScheduledValues(now);
        this.fadeGain.gain.setValueAtTime(0.0001, now);
        this.fadeGain.gain.linearRampToValueAtTime(1, now + duration);
    }

        addTracks(files) {
        const audioFiles = files.filter(f =>
            f.type.startsWith('audio/') ||
            /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm)$/i.test(f.name)
        );
        const added = [];

        audioFiles.forEach((file, i) => {
            const url = URL.createObjectURL(file);
            const baseName = file.name.replace(/\.[^/.]+$/, '');
            let title = baseName;
            let artist = 'Неизвестный исполнитель';

            if (baseName.includes(' - ')) {
                const parts = baseName.split(' - ');
                artist = parts[0].trim() || artist;
                title = parts.slice(1).join(' - ').trim() || title;
            }

            const createdAt = Date.now() + i;

            const track = {
                id: 'trk_' + createdAt + '_' + Math.random().toString(36).slice(2, 8),
                title,
                artist,
                url,
                duration: 0,
                fileName: file.name,
                region: guessRegionFromArtist(artist),
                blob: file,
                createdAt
            };
            this.playlist.push(track);
            added.push(track);

            if (this.storage) {
                this.storage.saveTrack(track).catch(e =>
                    console.warn('Не удалось сохранить трек:', e)
                );
            }
        });

        if (added.length > 0 && this.playlist.length === added.length) {
            this.currentIndex = 0;
            this.loadCurrentTrack();
        }
        return added;
    }

       removeTrack(index) {
        if (index < 0 || index >= this.playlist.length) return;
        const track = this.playlist[index];
        const wasPlaying = this.isPlaying && this.currentIndex === index;

        if (this.storage) {
            this.storage.deleteTrack(track.id).catch(e =>
                console.warn('Не удалось удалить трек:', e)
            );
        }

        if (track.url && track.url.startsWith('blob:')) {
            try { URL.revokeObjectURL(track.url); } catch (e) {}
        }
        this.playlist.splice(index, 1);

        if (this.playlist.length === 0) {
            this.audio.pause();
            this.audio.removeAttribute('src');
            this.audio.load();
            this.isPlaying = false;
            this.updatePlayButtons();
            document.getElementById('trackTitle').textContent = 'Загрузите музыку';
            document.getElementById('trackArtist').textContent = 'Нажмите кнопку "Загрузить"';
            document.getElementById('progressFill').style.width = '0%';
            document.getElementById('currentTime').textContent = '0:00';
            document.getElementById('totalTime').textContent = '0:00';
            return;
        }

        if (index < this.currentIndex) {
            this.currentIndex--;
        } else if (index === this.currentIndex) {
            this.currentIndex = Math.min(this.currentIndex, this.playlist.length - 1);
            this.loadCurrentTrack();
            if (wasPlaying) this.play();
        }
    }
    async restoreFromStorage() {
        if (!this.storage) return 0;

        const records = await this.storage.getAllTracks();
        if (!records.length) return 0;

        for (const t of this.playlist) {
            if (t.url && t.url.startsWith('blob:')) {
                try { URL.revokeObjectURL(t.url); } catch (e) {}
            }
        }
        this.playlist = [];

        records.forEach(rec => {
            this.playlist.push({
                id:        rec.id,
                title:     rec.title,
                artist:    rec.artist,
                url:       null,
                duration:  rec.duration || 0,
                fileName:  rec.fileName || '',
                region:    rec.region ?? -1,
                createdAt: rec.createdAt || Date.now(),
                blob:      rec.blob
            });
        });

        this.currentIndex = 0;
        if (this.playlist.length > 0) {
            this.loadCurrentTrack();
        }
        return this.playlist.length;
    }

    loadCurrentTrack() {
        const track = this.playlist[this.currentIndex];
        if (!track) return;
        this._isFadingOut = false;
        if (track.blob && !track.url) {
            track.url = URL.createObjectURL(track.blob);
        }

        this.audio.src = track.url;
        document.getElementById('trackTitle').textContent = track.title;
        document.getElementById('trackArtist').textContent = track.artist;
        document.getElementById('progressFill').style.width = '0%';
        document.getElementById('currentTime').textContent = '0:00';
    }

        play() {
        if (this.playlist.length === 0) return;
        if (!this.audio.src) this.loadCurrentTrack();
        this.initAudioContext();

        if (!this.fadeGain || !this.audioCtx) {
            this.audio.play().catch(err => console.warn('Play failed:', err));
            return;
        }

        const now = this.audioCtx.currentTime;
        const currentGain = this.fadeGain.gain.value;
        const shouldFadeIn = this._expectFadeIn || currentGain < 0.95;
        const fadeDur = this.crossfadeDuration > 0 ? this.crossfadeDuration : 0.3;

        this._expectFadeIn = false;

        this.audio.play().then(() => {
            if (shouldFadeIn) {
                this.fadeIn(fadeDur);
            } else {
                this.fadeGain.gain.cancelScheduledValues(now);
                this.fadeGain.gain.setValueAtTime(1, now);
            }
        }).catch(err => console.warn('Play failed:', err));
    }

    pause() {
        if (this.fadeGain && this.audioCtx) {
            const now = this.audioCtx.currentTime;
            const currentGain = this.fadeGain.gain.value;
            this.fadeGain.gain.cancelScheduledValues(now);
            this.fadeGain.gain.setValueAtTime(currentGain, now);
        }
        this._isFadingOut = false;
        this.audio.pause();
    }

    togglePlay() {
        if (this.playlist.length === 0) {
            document.getElementById('uploadBtnHeader')?.click();
            return;
        }
        if (this.isPlaying) this.pause();
        else this.play();
    }

    next(autoAdvance = false) {
        if (this.playlist.length === 0) return;

        if (autoAdvance && this.repeatMode === 'off' && !this.shuffle && this.currentIndex >= this.playlist.length - 1) {
            this.isPlaying = false;
            this.updatePlayButtons();
            return;
        }

        if (this.shuffle && this.playlist.length > 1) {
            let next;
            do { next = Math.floor(Math.random() * this.playlist.length); }
            while (next === this.currentIndex);
            this.currentIndex = next;
        } else {
            this.currentIndex = (this.currentIndex + 1) % this.playlist.length;
        }
        this.loadCurrentTrack();
        this.play();
    }

    prev() {
        if (this.playlist.length === 0) return;
        if (this.audio.currentTime > 3) {
            this.audio.currentTime = 0;
            return;
        }
        if (this.shuffle && this.playlist.length > 1) {
            let prev;
            do { prev = Math.floor(Math.random() * this.playlist.length); }
            while (prev === this.currentIndex);
            this.currentIndex = prev;
        } else {
            this.currentIndex = (this.currentIndex - 1 + this.playlist.length) % this.playlist.length;
        }
        this.loadCurrentTrack();
        this.play();
    }

    toggleShuffle() {
        this.shuffle = !this.shuffle;
        return this.shuffle;
    }

    cycleRepeat() {
        const modes = ['off', 'all', 'one'];
        const i = modes.indexOf(this.repeatMode);
        this.repeatMode = modes[(i + 1) % modes.length];
        return this.repeatMode;
    }

    seek(pct) {
        if (!this.audio.duration) return;
        pct = Math.max(0, Math.min(100, pct));
        this.audio.currentTime = (pct / 100) * this.audio.duration;
    }

    setVolume(val) {
        const v = Math.max(0, Math.min(100, parseInt(val, 10) || 0));
        this.volume = v / 100;
        this.audio.volume = this.volume;
    }

    formatTime(sec) {
        if (!isFinite(sec) || sec < 0) return '0:00';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    updatePlayButtons() {
        const playIcon = document.getElementById('mainPlayIcon');
        const pauseIcon = document.getElementById('mainPauseIcon');
        if (playIcon && pauseIcon) {
            playIcon.style.display = this.isPlaying ? 'none' : '';
            pauseIcon.style.display = this.isPlaying ? '' : 'none';
        }
        const sphereBtn = document.getElementById('playBtn');
        if (sphereBtn) sphereBtn.classList.toggle('playing', this.isPlaying);
    }
}
