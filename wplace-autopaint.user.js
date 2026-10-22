// ==UserScript==
// @name         wplace AutoPainter
// @namespace    https://github.com/
// @version      1.0.0
// @description  Batch pixel art drawer for wplace.live
// @match        *://wplace.live/*
// @match        *://*.wplace.live/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    if (win.__wplace_bot) return;
    win.__wplace_bot = true;

    let tileSize = 1000;
    let startTileX = null, startTileY = null, startPixelX = null, startPixelY = null;
    let palette = JSON.parse(localStorage.getItem('wp_palette') || '[]');
    let isPainting = false, stopRequested = false;
    let queue = [];
    let savedProgress = parseInt(localStorage.getItem('wp_progress') || '0');
    let uploadedImage = null;

    const panel = document.createElement('div');
    panel.id = 'wp-drawer-ui';
    panel.style.cssText = `
        position: fixed; top: 16px; right: 16px; z-index: 9999999;
        background: #11141a; color: #e2e8f0; padding: 14px;
        border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        font-family: system-ui, -apple-system, sans-serif; font-size: 12px;
        width: 280px; display: flex; flex-direction: column; gap: 8px;
        border: 1px solid #2d3748;
    `;

    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:13px;color:#38bdf8;">
            <span>wplace AutoPainter</span>
            <span id="wp-min" style="cursor:pointer;color:#94a3b8;font-size:11px;font-weight:400;">_</span>
        </div>
        <div id="wp-body" style="display:flex;flex-direction:column;gap:8px;">
            <div style="background:#1a202c;padding:6px 8px;border-radius:6px;">
                <div id="wp-coords" style="color:#f59e0b;font-weight:500;">Click on canvas to pick origin</div>
                <div id="wp-charges" style="color:#64748b;font-size:11px;margin-top:2px;">Charges: --</div>
            </div>
            <div id="wp-colors-info" style="color:#10b981;font-size:11px;">Colors: scan pending...</div>
            <input type="file" id="wp-file" accept="image/*" style="font-size:11px;color:#94a3b8;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                <label>Width (px):<input type="number" id="wp-w" value="50" min="5" max="300" style="width:100%;background:#0d1117;border:1px solid #30363d;color:#fff;padding:3px 5px;border-radius:4px;box-sizing:border-box;"></label>
                <label>Batch size:<input type="number" id="wp-b" value="80" min="1" max="150" style="width:100%;background:#0d1117;border:1px solid #30363d;color:#fff;padding:3px 5px;border-radius:4px;box-sizing:border-box;"></label>
                <label>Delay (ms):<input type="number" id="wp-d" value="700" min="100" max="3000" style="width:100%;background:#0d1117;border:1px solid #30363d;color:#fff;padding:3px 5px;border-radius:4px;box-sizing:border-box;"></label>
                <label>Start idx:<input type="number" id="wp-idx" value="0" min="0" style="width:100%;background:#0d1117;border:1px solid #30363d;color:#38bdf8;padding:3px 5px;border-radius:4px;box-sizing:border-box;font-weight:600;"></label>
            </div>
            <canvas id="wp-prev" style="width:100%;max-height:120px;object-fit:contain;background:#000;border:1px solid #30363d;border-radius:4px;display:none;"></canvas>
            <div id="wp-progress-wrap" style="display:none;flex-direction:column;gap:3px;">
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;">
                    <span id="wp-pstatus">Sending...</span>
                    <span id="wp-ppct">0%</span>
                </div>
                <div style="width:100%;height:5px;background:#2d3748;border-radius:3px;overflow:hidden;">
                    <div id="wp-pbar" style="width:0%;height:100%;background:#38bdf8;transition:width .15s ease;"></div>
                </div>
            </div>
            <div id="wp-status" style="font-size:11px;color:#94a3b8;">Select start point on map & upload image</div>
            <div style="display:flex;gap:6px;margin-top:2px;">
                <button id="wp-start" style="flex:1;padding:6px;background:#0284c7;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:600;">Start (0)</button>
                <button id="wp-resume" style="flex:1.2;padding:6px;background:#10b981;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:600;">Resume</button>
                <button id="wp-stop" style="padding:6px 12px;background:#dc2626;color:#fff;border:none;border-radius:4px;cursor:pointer;">Stop</button>
            </div>
        </div>
    `;

    function attachUI() {
        if (!document.getElementById('wp-drawer-ui')) {
            const root = document.body || document.documentElement;
            if (root) root.appendChild(panel);
        }
    }
    attachUI();
    setInterval(attachUI, 1000);

    let isMin = false;
    document.getElementById('wp-min').addEventListener('click', () => {
        isMin = !isMin;
        document.getElementById('wp-body').style.display = isMin ? 'none' : 'flex';
        document.getElementById('wp-min').innerText = isMin ? '+' : '_';
    });

    function scanPalette() {
        const wrap = document.querySelector('.paint-colors') || document.querySelector('[class*="paint-colors"]');
        if (!wrap) return false;
        const buttons = Array.from(wrap.querySelectorAll('button[id^="color-"]'));
        if (!buttons.length) return false;

        const res = [];
        for (const btn of buttons) {
            if (btn.querySelector('.paint-swatch-lock') || btn.querySelector('.paint-swatch-lock-badge')) continue;
            const match = btn.id.match(/color-(\d+)/);
            if (!match) continue;
            const id = parseInt(match[1]);
            const bg = window.getComputedStyle(btn).backgroundColor || btn.style.background;
            const m = bg.match(/\d+/g);
            if (m && m.length >= 3) {
                res.push({ id, rgb: [parseInt(m[0]), parseInt(m[1]), parseInt(m[2])] });
            }
        }

        if (res.length) {
            palette = res;
            localStorage.setItem('wp_palette', JSON.stringify(res));
            const el = document.getElementById('wp-colors-info');
            if (el) el.innerText = `Colors: ${palette.length} unlocked`;
            return true;
        }
        return false;
    }

    const origFetch = win.fetch;
    win.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        if (url.includes('/me') && !url.includes('/controls')) {
            setTimeout(async () => {
                try {
                    const me = await (await win.fetch("https://backend.wplace.live/me", { credentials: "include" })).json();
                    if (me?.charges) {
                        const count = Math.floor(me.charges.count || 0);
                        const el = document.getElementById('wp-charges');
                        if (el) el.innerText = `Charges: ${count} / ${me.charges.max || count}`;
                    }
                } catch {}
            }, 500);
        }

        if (url.includes('/s0/pixel/')) {
            const m = url.match(/\/s0\/pixel\/(\d+)\/(\d+)\?x=(\d+)&y=(\d+)/);
            if (m) {
                startTileX = parseInt(m[1]); startTileY = parseInt(m[2]);
                startPixelX = parseInt(m[3]); startPixelY = parseInt(m[4]);
                
                const tImg = new Image();
                tImg.onload = () => { if (tImg.naturalWidth) tileSize = tImg.naturalWidth; };
                tImg.src = `https://backend.wplace.live/files/s0/tiles/${startTileX}/${startTileY}.png`;

                const el = document.getElementById('wp-coords');
                el.innerText = `[${startTileX}, ${startTileY}] @ (${startPixelX}, ${startPixelY})`;
                el.style.color = '#10b981';

                setTimeout(() => {
                    if (scanPalette() && uploadedImage) processImage();
                }, 150);
            }
        }
        return origFetch.apply(this, args);
    };

    function matchColor(rgb) {
        let bestId = palette[0]?.id ?? 1;
        let minDiff = Infinity;
        for (let i = 0; i < palette.length; i++) {
            const c = palette[i].rgb;
            const rmean = (rgb[0] + c[0]) / 2;
            const r = rgb[0] - c[0], g = rgb[1] - c[1], b = rgb[2] - c[2];
            const diff = Math.sqrt((((512 + rmean) * r * r) >> 8) + 4 * g * g + (((767 - rmean) * b * b) >> 8));
            if (diff < minDiff) { minDiff = diff; bestId = palette[i].id; }
        }
        return bestId;
    }

    document.getElementById('wp-file').addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = evt => {
            uploadedImage = new Image();
            uploadedImage.onload = processImage;
            uploadedImage.src = evt.target.result;
        };
        reader.readAsDataURL(file);
    });

    document.getElementById('wp-w').addEventListener('input', () => { if (uploadedImage) processImage(); });

    function processImage() {
        if (!uploadedImage) return;
        scanPalette();
        if (!palette.length) {
            document.getElementById('wp-status').innerText = 'Click canvas to detect palette';
            return;
        }

        const tw = parseInt(document.getElementById('wp-w').value) || 50;
        const th = Math.round(tw * (uploadedImage.height / uploadedImage.width));

        const canvas = document.getElementById('wp-prev');
        canvas.width = tw; canvas.height = th;
        canvas.style.display = 'block';
        const ctx = canvas.getContext('2d');
        ctx.drawImage(uploadedImage, 0, 0, tw, th);

        const imgData = ctx.getImageData(0, 0, tw, th).data;
        queue = [];

        const sx = startPixelX ?? 0, sy = startPixelY ?? 0;
        const tx = startTileX ?? 0, ty = startTileY ?? 0;

        for (let y = 0; y < th; y++) {
            for (let x = 0; x < tw; x++) {
                const idx = (y * tw + x) * 4;
                if (imgData[idx + 3] < 120) continue;

                const rgb = [imgData[idx], imgData[idx + 1], imgData[idx + 2]];
                const colorId = matchColor(rgb);

                const col = palette.find(p => p.id === colorId);
                if (col) {
                    ctx.fillStyle = `rgb(${col.rgb.join(',')})`;
                    ctx.fillRect(x, y, 1, 1);
                }

                const gx = sx + x, gy = sy + y;
                const finalTileX = tx + Math.floor(gx / tileSize);
                const finalTileY = ty + Math.floor(gy / tileSize);
                const localX = ((gx % tileSize) + tileSize) % tileSize;
                const localY = ((gy % tileSize) + tileSize) % tileSize;

                queue.push({ tileX: finalTileX, tileY: finalTileY, x: localX, y: localY, color: colorId });
            }
        }

        if (savedProgress > 0 && savedProgress < queue.length) {
            document.getElementById('wp-idx').value = savedProgress;
        }

        document.getElementById('wp-status').innerText = startTileX === null 
            ? `Ready: ${queue.length} px (pick start point on map)` 
            : `Queue: ${queue.length} px ready`;
    }

    async function sendBatch(batch) {
        const map = {};
        for (const p of batch) {
            const k = `${p.tileX}_${p.tileY}`;
            if (!map[k]) map[k] = { x: p.tileX, y: p.tileY, pixels: { x: [], y: [], colors: [] } };
            map[k].pixels.x.push(p.x);
            map[k].pixels.y.push(p.y);
            map[k].pixels.colors.push(p.color);
        }

        const res = await win.fetch("https://backend.wplace.live/paint", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ season: 0, tiles: Object.values(map) })
        });

        if (!res.ok) throw new Error(`${res.status}`);
        return await res.json().catch(() => ({}));
    }

    async function draw(fromIndex = 0) {
        if (startTileX === null) return alert("Select start location on map first");
        if (!queue.length) return alert("Upload an image first");

        isPainting = true;
        stopRequested = false;

        const batchSize = Math.max(1, parseInt(document.getElementById('wp-b').value) || 80);
        const delayMs = Math.max(100, parseInt(document.getElementById('wp-d').value) || 700);

        const wrap = document.getElementById('wp-progress-wrap');
        const pbar = document.getElementById('wp-pbar');
        const ppct = document.getElementById('wp-ppct');
        const pstatus = document.getElementById('wp-pstatus');
        const status = document.getElementById('wp-status');
        const startInput = document.getElementById('wp-idx');

        wrap.style.display = 'flex';
        status.innerText = 'Drawing in progress...';

        const total = queue.length;
        let placed = Math.min(total, Math.max(0, fromIndex));

        for (let i = placed; i < total; i += batchSize) {
            if (stopRequested) {
                savedProgress = placed;
                localStorage.setItem('wp_progress', placed);
                startInput.value = placed;
                status.innerText = `Paused at ${placed}/${total}`;
                break;
            }

            const chunk = queue.slice(i, i + batchSize);
            try {
                await sendBatch(chunk);
                placed += chunk.length;
                savedProgress = placed;
                localStorage.setItem('wp_progress', placed);
                startInput.value = placed;

                const pct = Math.min(100, Math.round((placed / total) * 100));
                pbar.style.width = `${pct}%`;
                ppct.innerText = `${pct}%`;
                pstatus.innerText = `${placed}/${total} px`;

                await new Promise(r => setTimeout(r, delayMs));
            } catch (err) {
                savedProgress = placed;
                localStorage.setItem('wp_progress', placed);
                startInput.value = placed;
                status.innerText = `Paused at ${placed}/${total} (${err.message.includes('403') ? 'Cloudflare wait 15s' : 'Error ' + err.message})`;
                break;
            }
        }

        if (!stopRequested && placed >= total) {
            status.innerText = `Done! Painted ${placed} pixels.`;
            localStorage.removeItem('wp_progress');
            savedProgress = 0;
            startInput.value = 0;
        }
        isPainting = false;
    }

    document.getElementById('wp-start').addEventListener('click', () => {
        if (!isPainting) {
            document.getElementById('wp-idx').value = 0;
            draw(0);
        }
    });

    document.getElementById('wp-resume').addEventListener('click', () => {
        if (!isPainting) {
            const idx = parseInt(document.getElementById('wp-idx').value) || 0;
            draw(idx);
        }
    });

    document.getElementById('wp-stop').addEventListener('click', () => {
        stopRequested = true;
    });
})();
