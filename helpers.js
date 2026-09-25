function guessRegionFromArtist(artist) {
    if (!artist) return -1;
    const key = String(artist).toLowerCase().trim();
    const lookup = window.MBOX_ARTIST_REGIONS || {};
    if (lookup[key] !== undefined) return lookup[key];
    for (const [name, idx] of Object.entries(lookup)) {
        if (key.includes(name)) return idx;
    }
    return -1;
}

function pointInPoly(lon, lat, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1];
        const xj = poly[j][0], yj = poly[j][1];
        if (((yi > lat) !== (yj > lat)) &&
            (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
}

function regionAt(lon, lat) {
    for (let i = 0; i < REGION_DATA.length; i++) {
        const r = REGION_DATA[i];
        if (r.latTest && r.latTest(lat)) return i;
        for (const poly of r.polys) if (pointInPoly(lon, lat, poly)) return i;
    }
    return -1;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pluralTracks(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'трек';
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'трека';
    return 'треков';
}

function showNotification(message, isError = false) {
    const n = document.createElement('div');
    n.textContent = message;
    n.style.cssText = `position: fixed; top: 100px; right: 20px; padding: 16px 24px;
        background: ${isError ? 'rgba(255,59,48,0.9)' : 'rgba(255,255,255,0.15)'};
        backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.2);
        border-radius: 12px; color: white; font-weight: 500; z-index: 10000;
        animation: slideIn 0.3s ease forwards; box-shadow: 0 4px 16px rgba(0,0,0,0.3);`;
    document.body.appendChild(n);
    setTimeout(() => {
        n.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => n.remove(), 300);
    }, 2500);
}

let currentAccentRGB = COLOR_PRESETS.yellow.dark.rgb;

function getAccentRGB() {
    return currentAccentRGB;
}

function applyColorPreset(key) {
    const preset = COLOR_PRESETS[key] || COLOR_PRESETS.yellow;
    const root = document.documentElement;
    root.style.setProperty('--y', preset.dark.y);
    root.style.setProperty('--y-deep', preset.dark.yDeep);
    root.style.setProperty('--y-glow', preset.dark.glow);
    currentAccentRGB = preset.dark.rgb;
    const l = preset.light.y.replace('#', '');
    root.style.setProperty('--y-rgb', preset.dark.rgb.join(','));
    root.style.setProperty('--y-eco-rgb',
        `${parseInt(l.slice(0,2),16)},${parseInt(l.slice(2,4),16)},${parseInt(l.slice(4,6),16)}`);
    localStorage.setItem('colorPreset', key);
    updateSwatchActive();
}

function setCoverBackground(track) {
    const el = document.getElementById('coverBg');
    if (!el) return;

    const enabled = coverBgEnabled;
    document.body.classList.toggle('cover-bg-on', enabled && !!track);

    if (!enabled || !track) {
        el.classList.remove('active');
        return;
    }

    const url = audioEngine?.ensureCoverUrl(track);
    if (url) {
        el.style.backgroundImage = `url("${url}")`;
        el.classList.add('active');
    } else {
        el.classList.remove('active');
    }
}

async function applyCoverAccent(track) {
    if (!coverAccentEnabled) return;
    if (!track) { restoreUserAccent(); return; }

    const palette = await getCoverPalette(track);
    if (!palette) { restoreUserAccent(); return; }

    currentCoverPalette = palette;

    const root = document.documentElement;
    root.style.setProperty('--y', palette.hex);
    root.style.setProperty('--y-deep', palette.hexDeep);
    root.style.setProperty('--y-glow', `rgba(${palette.hexRgb.join(',')}, 0.15)`);
    root.style.setProperty('--y-rgb', palette.hexRgb.join(','));
    currentAccentRGB = palette.hexRgb;
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
}

function restoreUserAccent() {
    currentCoverPalette = null;
    const key = localStorage.getItem('colorPreset') || 'yellow';
    applyColorPreset(key);
}
async function refreshCoverAppearance(track) {
    setCoverBackground(track);
    if (coverAccentEnabled) {
        await applyCoverAccent(track);
    }
}

function renderColorSwatches() {
    const wrap = document.getElementById('colorSwatches');
    if (!wrap) return;
    wrap.innerHTML = '';
    Object.entries(COLOR_PRESETS).forEach(([key, preset]) => {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.dataset.preset = key;
        swatch.style.background = preset.dark.y;
        swatch.title = preset.name;
        swatch.addEventListener('click', () => {
            applyColorPreset(key);
            showNotification(`Акцент: ${preset.name}`);
        });
        wrap.appendChild(swatch);
    });
    updateSwatchActive();
}

function updateSwatchActive() {
    const current = localStorage.getItem('colorPreset') || 'yellow';
    document.querySelectorAll('.color-swatch').forEach(s => {
        s.classList.toggle('active', s.dataset.preset === current);
    });
}
function applyAnimationIntensity(value) {
    const scale = Math.max(0, Math.min(1, value / 100));
    document.documentElement.style.setProperty('--anim-scale', scale);
    const root = document.documentElement;
    if (scale < 0.4) {
        root.style.setProperty('--y-glow', 'transparent');
    } else {
        const key = localStorage.getItem('colorPreset') || 'yellow';
        const preset = COLOR_PRESETS[key] || COLOR_PRESETS.yellow;
        root.style.setProperty('--y-glow', preset.dark.glow);
    }
    if (typeof backgroundSystem !== 'undefined' && backgroundSystem) {
        if (scale < 0.15) {
            backgroundSystem.stop();
        } else if (typeof isEcoMode !== 'undefined' && !isEcoMode
                   && !document.getElementById('disableBgToggle').checked) {
            backgroundSystem.start();
        }
    }
    localStorage.setItem('animIntensity', value);
}

function respectReducedMotion() {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) {
        document.getElementById('animationSlider').value = 30;
        document.getElementById('animationValue').textContent = '30%';
        applyAnimationIntensity(30);
    }
}

class TipPanel {
    constructor() {
        this.el = document.getElementById('tipPanel');
        if (!this.el) return;
        this.titleEl = this.el.querySelector('.tip-panel-title');
        this.descEl  = this.el.querySelector('.tip-panel-desc');

        this.showTimer = null;
        this.hideTimer = null;
        this.active = null;

        this._bind();
    }

    _bind() {
        document.addEventListener('mouseover', (e) => {
            const target = e.target.closest('[data-tip]');
            if (!target || target === this.active) return;
            this._schedule(target);
        });

        document.addEventListener('mouseout', (e) => {
            const target = e.target.closest('[data-tip]');
            if (!target) return;
            const related = e.relatedTarget;
            if (related && target.contains(related)) return;
            if (target === this.active) this._scheduleHide();
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('[data-tip]')) this.hide();
        });
    }

    _schedule(target) {
        clearTimeout(this.hideTimer);
        clearTimeout(this.showTimer);
        this.showTimer = setTimeout(() => this._show(target), 150);
    }

    _scheduleHide() {
        clearTimeout(this.showTimer);
        clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => this.hide(), 120);
    }

    _show(target) {
        this.active = target;
        this.titleEl.textContent = target.dataset.tipTitle || 'Подсказка';
        this.descEl.textContent  = target.dataset.tip || '';
        this.el.classList.add('visible');
    }

    hide() {
        this.active = null;
        this.el.classList.remove('visible');
    }
}

function _rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: h * 360, s, l };
}

function _hslToRgb(h, s, l) {
    h /= 360;
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function _toHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

function extractCoverPalette(coverUrl) {
    return new Promise((resolve) => {
        if (!coverUrl) { resolve(null); return; }

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onerror = () => resolve(null);
        img.onload = () => {
            try {
                const SIZE = 64;
                const canvas = document.createElement('canvas');
                canvas.width = SIZE;
                canvas.height = SIZE;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(img, 0, 0, SIZE, SIZE);

                const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
                const buckets = {};

                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
                    if (a < 128) continue;

                    const max = Math.max(r, g, b);
                    const min = Math.min(r, g, b);
                    const l = (max + min) / 255 / 2;
                    if (l < 0.15 || l > 0.9) continue;   // skip near-black/white
                    const s = max === 0 ? 0 : (max - min) / max;
                    if (s < 0.18) continue;              // skip greys

                    const key = `${(r >> 5)}-${(g >> 5)}-${(b >> 5)}`;
                    if (!buckets[key]) buckets[key] = { n: 0, r: 0, g: 0, b: 0, s: 0 };
                    const k = buckets[key];
                    k.n++; k.r += r; k.g += g; k.b += b; k.s += s;
                }

                let best = null, bestScore = 0;
                for (const k in buckets) {
                    const bkt = buckets[k];
                    const avgS = bkt.s / bkt.n;
                    const score = bkt.n * Math.pow(avgS, 1.4);
                    if (score > bestScore) {
                        bestScore = score;
                        best = {
                            r: Math.round(bkt.r / bkt.n),
                            g: Math.round(bkt.g / bkt.n),
                            b: Math.round(bkt.b / bkt.n)
                        };
                    }
                }

                if (!best) { resolve(null); return; }
                const hsl = _rgbToHsl(best.r, best.g, best.b);
                const tuned = _hslToRgb(hsl.h, Math.min(0.85, hsl.s * 1.35), Math.max(0.42, Math.min(0.62, hsl.l)));

                const hex     = _toHex(tuned.r, tuned.g, tuned.b);
                const deep    = _toHex(
                    Math.round(tuned.r * 0.85),
                    Math.round(tuned.g * 0.85),
                    Math.round(tuned.b * 0.85)
                );
                const hexRgb  = [tuned.r, tuned.g, tuned.b];

                resolve({ r: tuned.r, g: tuned.g, b: tuned.b, hex, hexDeep: deep, hexRgb });
            } catch (e) {
                console.warn('extractCoverPalette error:', e);
                resolve(null);
            }
        };
        img.src = coverUrl;
    });
}
const _paletteCache = new Map();

async function getCoverPalette(track) {
    if (!track) return null;
    if (_paletteCache.has(track.id)) return _paletteCache.get(track.id);

    const url = window.audioEngine?.ensureCoverUrl(track);
    if (!url) return null;

    const palette = await extractCoverPalette(url);
    if (palette) _paletteCache.set(track.id, palette);
    return palette;
}