class PageTransition {
    constructor() {
        this.busy = false;
        this.overlay = document.createElement('div');
        this.overlay.className = 'page-transition';

        const COLS = 4, ROWS = 4;
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const sq = document.createElement('div');
                sq.className = 'pt-square';
                sq.style.setProperty('--d', r + c);
                this.overlay.appendChild(sq);
            }
        }
        document.body.appendChild(this.overlay);
    }

    async play(switchCallback) {
        if (this.busy) return;
        this.busy = true;
        try {
            this.overlay.classList.add('active');
            void this.overlay.offsetWidth;
            this.overlay.classList.add('covering');
            await this.wait(800);
            if (typeof switchCallback === 'function') switchCallback();
            await this.wait(100);
            this.overlay.classList.remove('covering');
            this.overlay.classList.add('revealing');
            await this.wait(900);
            this.overlay.classList.remove('revealing');
            void this.overlay.offsetWidth;
            this.overlay.classList.remove('active');
        } finally {
            this.busy = false;
        }   
    }       
        wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
}