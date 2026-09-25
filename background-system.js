
class BackgroundSystem {
    constructor() {
        this.canvas = document.getElementById('bgCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.animId = null;
        this.grid = [];
        this.cellSize = 0;
        this.cols = 0;
        this.rows = 0;
        this.audioEngine = null;
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    setAudioEngine(engine) {
        this.audioEngine = engine;
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.buildGrid();
    }

    buildGrid() {
        const maxDim = Math.max(this.canvas.width, this.canvas.height);
        this.cellSize = Math.max(24, Math.round(maxDim / 32));
        this.cols = Math.ceil(this.canvas.width / this.cellSize);
        this.rows = Math.ceil(this.canvas.height / this.cellSize);

        this.grid = [];
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                this.grid.push({
                    x: c * this.cellSize,
                    y: r * this.cellSize,
                    intensity: Math.random() * 0.15,
                    target: Math.random() * 0.15,
                    phase: Math.random() * Math.PI * 2,
                    speed: 0.0004 + Math.random() * 0.0008
                });
            }
        }
    }

    start() {
        if (this.animId) return;
        const draw = () => {
            if (isEcoMode) { this.stop(); return; }
            this.update();
            this.render();
            this.animId = requestAnimationFrame(draw);
        };
        this.animId = requestAnimationFrame(draw);
    }

    update() {
        const audioActive = this.audioEngine && this.audioEngine.isPlaying;
        const data = audioActive ? this.audioEngine.getFrequencyData() : null;

        if (data && data.length > 0) {
            const N = data.length - 1;
            for (const sq of this.grid) {
                const cx = sq.x / this.canvas.width;
                const cy = sq.y / this.canvas.height;
                const fIdx = Math.floor((cx * 0.7 + (1 - cy) * 0.3) * N);
                const freq = data[fIdx] / 255;
                sq.target = Math.pow(freq, 1.5);
            }
        } else {
            for (const sq of this.grid) {
                sq.phase += sq.speed;
                sq.target = 0.03 + (Math.sin(sq.phase) * 0.5 + 0.5) * 0.12;
            }
        }

        for (const sq of this.grid) {
            sq.intensity += (sq.target - sq.intensity) * 0.2;
        }
    }

    render() {
        const ctx = this.ctx;
        const cs = this.cellSize;
        const gap = 2;
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--ink').trim() || '#0A0A0A';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        for (const sq of this.grid) {
            const i = sq.intensity;
            if (i < 0.02) continue;
            const alpha = Math.min(0.55, i * 0.7);
            const [r, g, b] = getAccentRGB();
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
            ctx.fillRect(sq.x + gap, sq.y + gap, cs - gap * 2, cs - gap * 2);
        }
    }

    stop() {
        if (this.animId) {
            cancelAnimationFrame(this.animId);
            this.animId = null;
        }
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
}