class TrackQueue {
    constructor(audioEngine) {
        this.audioEngine = audioEngine;
        this.container = document.getElementById('trackQueue');
        this.plates = [];
        this.maxVisible = 4;
        this.step = 175;
        this._wheelLock = false;
        this.render();

        if (this.container && typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(() => {
                if (!this.plates.length) return;
                const w = this.container.offsetWidth;
                if (w > 0) {
                    this.recalcStep();
                    this.update();
                }
            });
            this._ro.observe(this.container);
        }

        window.addEventListener('resize', () => {
            this.recalcStep();
            this.update();
        });
    }

    recalcStep() {
        if (!this.plates.length) return;
        const w = this.plates[0].offsetWidth;
        if (w > 0) this.step = w * 0.82;
    }

    render() {
    if (!this.container) return;
    this.container.innerHTML = '';
    this.plates = [];

    const playlist = this.audioEngine.playlist;
    if (playlist.length === 0) {
        this.container.innerHTML = `
            <div class="queue-empty">
                <div class="queue-empty-icon">♪</div>
                <div class="queue-empty-text">Загрузите треки</div>
            </div>
        `;
        return;
    }

    playlist.forEach((track, idx) => {
        const plate = document.createElement('div');
        plate.className = 'queue-plate';
        plate.dataset.index = idx;
        const coverUrl = this.audioEngine.ensureCoverUrl(track);
        const coverStyle = track.coverUrl
            ? `style="background-image:url('${track.coverUrl}')"`
            : '';
        const coverClass = track.coverUrl ? 'queue-plate-cover has-image' : 'queue-plate-cover';

        plate.innerHTML = `
            <div class="queue-plate-num">${(idx + 1).toString().padStart(2, '0')}</div>
            <div class="${coverClass}" ${coverStyle}><span>♪</span></div>
            <div class="queue-plate-info">
                <div class="queue-plate-title">${this.escapeHtml(track.title)}</div>
                    <div class="queue-plate-artist">${this.escapeHtml(track.artist)}</div>
            </div>
        `;
        plate.addEventListener('click', () => {
            if (idx === this.audioEngine.currentIndex && this.audioEngine.isPlaying) return;
            this.audioEngine.currentIndex = idx;
            this.audioEngine.loadCurrentTrack();
            this.audioEngine.play();
        });
        this.container.appendChild(plate);
        this.plates.push(plate);
    });

    requestAnimationFrame(() => {
        this.recalcStep();
        this.update();
    });
}

    update() {
        if (!this.plates.length) return;
        const current = this.audioEngine.currentIndex;

        this.plates.forEach((plate, idx) => {
            const offset = idx - current;
            const absOffset = Math.abs(offset);

            if (absOffset > this.maxVisible) {
                plate.style.opacity = '0';
                plate.style.visibility = 'hidden';
                plate.style.pointerEvents = 'none';
                plate.style.zIndex = '0';
                plate.classList.remove('active');
                return;
            }

            plate.style.visibility = 'visible';
            plate.style.pointerEvents = 'auto';

            const isCurrent = offset === 0;
            const scale = Math.max(0.55, 1 - absOffset * 0.13);
            const xOffset = offset * this.step;
            const zOffset = -absOffset * 40;
            const rotateY = offset * -8;
            const opacity = Math.max(0.3, 1 - absOffset * 0.2);

            plate.style.transform = `
                translate(-50%, -50%)
                translateX(${xOffset}px)
                translateZ(${zOffset}px)
                rotateY(${rotateY}deg)
                scale(${scale})
            `;
            plate.style.opacity = opacity;
            plate.style.zIndex = String(100 - absOffset);

            if (isCurrent) plate.classList.add('active');
            else plate.classList.remove('active');
        });
    }

    escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}