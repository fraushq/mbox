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

function showNotification(message) {
    const n = document.createElement('div');
    n.textContent = message;
    n.style.cssText = `position: fixed; top: 100px; right: 20px; padding: 16px 24px; background: rgba(255,255,255,0.15); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.2); border-radius: 12px; color: white; font-weight: 500; z-index: 10000; animation: slideIn 0.3s ease forwards; box-shadow: 0 4px 16px rgba(0,0,0,0.3);`;
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