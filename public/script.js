const socket = io();
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Secure HTML Escaper to prevent XSS/code tampering on the leaderboard
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

// Responsive canvas resize
function resizeCanvas() { 
    canvas.width = window.innerWidth; 
    canvas.height = window.innerHeight; 
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const WORLD_RADIUS = 2500;
let mouse = { x: 0, y: 0 };
let isBoosting = false;
let myId = null;

let serverPlayers = {};
let localFoods = []; 
let loadedSkins = {};
let particles = [];

// Interpolated camera positions
let camX = 0; 
let camY = 0;

// Graphics Quality state
let graphicsQuality = localStorage.getItem('slither_graphics') || 'high';

// Sound Settings & Synthesizer State
let soundVolume = localStorage.getItem('slither_sound_volume') !== null ? parseFloat(localStorage.getItem('slither_sound_volume')) : 1.0;
let audioCtx = null;
let boostOsc = null;
let boostGain = null;
let boostLfo = null;

function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playEatSound() {
    if (soundVolume === 0) return;
    initAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    let osc = audioCtx.createOscillator();
    let gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(450, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(950, audioCtx.currentTime + 0.08);
    
    gain.gain.setValueAtTime(0.08 * soundVolume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.08);
}

function playDieSound() {
    if (soundVolume === 0) return;
    initAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    let osc = audioCtx.createOscillator();
    let gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(280, audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(40, audioCtx.currentTime + 0.45);
    
    gain.gain.setValueAtTime(0.20 * soundVolume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.45);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.45);
}

function startBoostSound() {
    if (soundVolume === 0 || boostOsc) return;
    initAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    boostOsc = audioCtx.createOscillator();
    boostGain = audioCtx.createGain();
    boostLfo = audioCtx.createOscillator();
    let lfoGain = audioCtx.createGain();
    
    boostOsc.type = 'triangle';
    boostOsc.frequency.setValueAtTime(75, audioCtx.currentTime);
    
    boostLfo.frequency.value = 16; // 16 Hz modulation rumble
    lfoGain.gain.value = 14;
    
    boostLfo.connect(lfoGain);
    lfoGain.connect(boostOsc.frequency);
    
    boostOsc.connect(boostGain);
    boostGain.connect(audioCtx.destination);
    
    boostGain.gain.setValueAtTime(0, audioCtx.currentTime);
    boostGain.gain.linearRampToValueAtTime(0.12 * soundVolume, audioCtx.currentTime + 0.15);
    
    boostLfo.start();
    boostOsc.start();
}

function stopBoostSound() {
    if (!boostOsc) return;
    let currentOsc = boostOsc;
    let currentGain = boostGain;
    let currentLfo = boostLfo;
    boostOsc = null;
    boostGain = null;
    boostLfo = null;
    
    currentGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.1);
    setTimeout(() => {
        try {
            currentOsc.stop();
            currentLfo.stop();
        } catch(e) {}
    }, 150);
}

// Premade skins config
const PREMADE_SKINS = [
    { name: "Purple Slither", colors: ["#8a5ebf", "#9d70d6"] },
    { name: "Neon Blue-Green", colors: ["#00d4ff", "#00ff66"] },
    { name: "Bright Rainbow", colors: ["#ff0000", "#ff7f00", "#ffff00", "#00ff00", "#00d4ff", "#8a5ebf"] },
    { name: "Neon Red", colors: ["#ff0055", "#9900ff"] },
    { name: "USA Patriotic", colors: ["#ff0000", "#ffffff", "#0000ff"] },
    { name: "Zebra", colors: ["#111111", "#ffffff"] },
    { name: "Honey Bee", colors: ["#ffcc00", "#111111"] },
    { name: "Candy Cane", colors: ["#ff0055", "#ffffff", "#ff0055"] },
    { name: "Forest Sprite", colors: ["#00ff66", "#00ff66", "#2e7d32"] },
    { name: "Sunset Fire", colors: ["#ff5500", "#ffcc00", "#ff0055"] }
];

// Custom Builder Palette Colors (30+ colors matching screenshot)
const BUILDER_COLORS = [
    // Row 1
    '#e53935', '#757575', '#1e88e5', '#b71c1c', '#c0ca33', '#8d6e63', '#8e24aa', '#4caf50', '#00bcd4', '#5e35b1', '#0d47a1',
    // Row 2
    '#9c27b0', '#ffeb3b', '#0288d1', '#01579b', '#3f51b5', '#f4511e', '#00acc1', '#9e9e9e', '#2e7d32', '#00e676', '#ff7043',
    // Row 3
    '#e91e63', '#ffffff', '#1565c0', '#212121', '#ffd700', '#1b5e20', '#303f9f', '#29b6f6', '#3f51b5',
    // Row 4
    '#e1bee7', '#bbdefb', '#b2dfdb', '#c8e6c9', '#fff9c4', '#ffe0b2', '#ffccbc', '#ffcdd2'
];

// Skin selection state (initialized from localStorage)
let activeSkinSource = localStorage.getItem('slither_skin_source') || 'premade';
let currentSkinIndex = parseInt(localStorage.getItem('slither_premade_index')) || 0;
let customColorSequence = JSON.parse(localStorage.getItem('slither_custom_colors')) || ['#8e24aa', '#1e88e5'];

// Set saved nickname on load
const nicknameInput = document.getElementById("nickname");
nicknameInput.value = localStorage.getItem('slither_nickname') || 'Hero_Snake';

// Preview Snake states for selector and custom builder
let previewTime = 0;
let previewSnakes = {
    carousel: {
        x: 150, y: 75,
        body: Array(35).fill(null).map((_, idx) => ({ x: 150 - idx * 4, y: 75 })),
        radius: 12,
        angle: 0
    },
    builder: {
        x: 150, y: 75,
        body: Array(35).fill(null).map((_, idx) => ({ x: 150 - idx * 4, y: 75 })),
        radius: 12,
        angle: 0
    }
};

// Canvas references for previews
const skinPreviewCanvas = document.getElementById("skinPreviewCanvas");
const builderPreviewCanvas = document.getElementById("builderPreviewCanvas");

// Controls and Actions event listeners
window.addEventListener('mousemove', (e) => {
    if (joystickActive) return;
    mouse.x = e.clientX - canvas.width / 2;
    mouse.y = e.clientY - canvas.height / 2;
});

// Detect touch screen support
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
const joystickBase = document.getElementById("joystickBase");
const joystickKnob = document.getElementById("joystickKnob");

let joystickActive = false;
let joystickStartX = 0;
let joystickStartY = 0;
const joystickMaxDist = 33;
let activeBoostTouches = new Set();

if (isTouchDevice && joystickBase) {
    joystickBase.addEventListener("touchstart", (e) => {
        joystickActive = true;
        const rect = joystickBase.getBoundingClientRect();
        joystickStartX = rect.left + rect.width / 2;
        joystickStartY = rect.top + rect.height / 2;
        handleJoystickMove(e.targetTouches[0].clientX, e.targetTouches[0].clientY);
    });

    joystickBase.addEventListener("touchmove", (e) => {
        if (!joystickActive) return;
        e.preventDefault();
        handleJoystickMove(e.targetTouches[0].clientX, e.targetTouches[0].clientY);
    }, { passive: false });

    joystickBase.addEventListener("touchend", () => {
        joystickActive = false;
        joystickKnob.style.transform = "translate(0px, 0px)";
    });

    function handleJoystickMove(clientX, clientY) {
        let dx = clientX - joystickStartX;
        let dy = clientY - joystickStartY;
        let dist = Math.hypot(dx, dy);
        
        if (dist > joystickMaxDist) {
            dx = (dx / dist) * joystickMaxDist;
            dy = (dy / dist) * joystickMaxDist;
        }
        
        joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
        
        let angle = Math.atan2(dy, dx);
        mouse.x = Math.cos(angle) * 200;
        mouse.y = Math.sin(angle) * 200;
    }

    // Long-press holding anywhere outside the steering joystick triggers boosting
    window.addEventListener("touchstart", (e) => {
        if (!myId) return; // Only boost active gameplay
        for (let i = 0; i < e.changedTouches.length; i++) {
            let touch = e.changedTouches[i];
            const rect = joystickBase.getBoundingClientRect();
            let isInsideJoystick = (
                touch.clientX >= rect.left &&
                touch.clientX <= rect.right &&
                touch.clientY >= rect.top &&
                touch.clientY <= rect.bottom
            );
            
            if (!isInsideJoystick) {
                activeBoostTouches.add(touch.identifier);
                setBoost(true);
            }
        }
    });

    const removeBoostTouch = (touchId) => {
        activeBoostTouches.delete(touchId);
        if (activeBoostTouches.size === 0) {
            setBoost(false);
        }
    };

    window.addEventListener("touchend", (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            removeBoostTouch(e.changedTouches[i].identifier);
        }
    });

    window.addEventListener("touchcancel", (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            removeBoostTouch(e.changedTouches[i].identifier);
        }
    });
}

const setBoost = (state) => { 
    if (isBoosting !== state) {
        isBoosting = state; 
        if (isBoosting) {
            startBoostSound();
        } else {
            stopBoostSound();
        }
    }
};
window.addEventListener('mousedown', (e) => { if(e.button===0) setBoost(true); });
window.addEventListener('mouseup', (e) => { if(e.button===0) setBoost(false); });
window.addEventListener('keydown', (e) => { if(e.code==="Space") setBoost(true); });
window.addEventListener('keyup', (e) => { if(e.code==="Space") setBoost(false); });

// Reset server cache on page visibility switch
document.addEventListener("visibilitychange", () => {
    if (!document.hidden && myId && serverPlayers[myId]) {
        let me = serverPlayers[myId];
        camX = me.x; camY = me.y;
        serverPlayers = {}; 
    }
});

// Socket event listeners
socket.on('game_init', (data) => {
    myId = data.id;
    camX = data.x; camY = data.y;
    document.getElementById("startPanel").classList.add("hidden");
    if (isTouchDevice && joystickBase) {
        joystickBase.style.display = "block";
    }
});

socket.on('game_state', (state) => {
    if (document.hidden) return;

    let me = state.players[myId];
    let prevMe = serverPlayers[myId];
    
    // Build an incoming food set for O(1) checks
    let incomingFoodIds = new Set();
    state.foods.forEach(f => incomingFoodIds.add(f.id));

    // Trigger synthesized eat sounds & food pop particles
    if (me && prevMe) {
        localFoods.forEach(lf => {
            let stillExists = incomingFoodIds.has(lf.id);
            if (!stillExists) {
                let dist = Math.hypot(me.x - lf.x, me.y - lf.y);
                if (dist < me.radius + 15) {
                    playEatSound();
                    
                    // Particle explosion burst on eat (capped to prevent CPU lag)
                    let particleCount = graphicsQuality === 'high' ? 4 : 2;
                    for (let k = 0; k < particleCount; k++) {
                        if (particles.length > 250) break;
                        particles.push({
                            x: lf.x, y: lf.y,
                            vx: (Math.random() - 0.5) * 5,
                            vy: (Math.random() - 0.5) * 5,
                            radius: Math.random() * 2 + 1,
                            alpha: 1,
                            color: lf.color
                        });
                    }
                }
            }
        });
    }

    for (let id in state.players) {
        let np = state.players[id];
        if (!serverPlayers[id]) {
            serverPlayers[id] = np;
        } else {
            let sp = serverPlayers[id];
            sp.x = np.x;
            sp.y = np.y;
            sp.angle = np.angle;
            sp.length = np.length;
            sp.radius = np.radius;
            sp.color = np.color;
            sp.colors = np.colors;
            sp.skinUrl = np.skinUrl;
            sp.name = np.name;
            sp.isBoosting = np.isBoosting;
            sp.body = np.body; 
            sp.shortId = np.shortId; // Preserve numeric ID in client
        }
    }
    for (let id in serverPlayers) { 
        if (!state.players[id]) delete serverPlayers[id]; 
    }

    // Efficiently add/update food using Map lookup
    let localFoodMap = new Map();
    localFoods.forEach(lf => localFoodMap.set(lf.id, lf));

    state.foods.forEach(sf => {
        let existing = localFoodMap.get(sf.id);
        if (!existing) {
            localFoodMap.set(sf.id, { 
                id: sf.id, x: sf.x, y: sf.y, color: sf.color, radius: sf.radius, 
                isGlowing: sf.isGlowing, targetX: sf.x, targetY: sf.y 
            });
        } else {
            existing.targetX = sf.x; 
            existing.targetY = sf.y;
        }
    });

    let newLocalFoods = [];
    state.foods.forEach(sf => {
        let f = localFoodMap.get(sf.id);
        if (f) newLocalFoods.push(f);
    });
    localFoods = newLocalFoods;
});

socket.on('player_died', () => { 
    myId = null; 
    localFoods = []; 
    serverPlayers = {}; 
    stopBoostSound();
    playDieSound();
    document.getElementById("startPanel").classList.remove("hidden"); 
    if (isTouchDevice && joystickBase) {
        joystickBase.style.display = "none";
    }
});

// Listen for name validation / unique checks errors from the server
socket.on('join_error', (data) => {
    const errorMsgDiv = document.getElementById("join-error-msg");
    if (errorMsgDiv) {
        errorMsgDiv.innerText = data.message;
        errorMsgDiv.classList.remove("hidden");
    }
});

// Hide the error box when the user starts re-typing their nickname
document.getElementById("nickname").addEventListener("input", () => {
    const errorMsgDiv = document.getElementById("join-error-msg");
    if (errorMsgDiv) {
        errorMsgDiv.classList.add("hidden");
    }
});

// Join action
function startGame() {
    const name = nicknameInput.value || "Hero";
    localStorage.setItem('slither_nickname', name);

    let activeColors = PREMADE_SKINS[currentSkinIndex].colors;
    if (activeSkinSource === 'custom' && customColorSequence.length > 0) {
        activeColors = customColorSequence;
    }

    socket.emit('join_game', { 
        name: name, 
        colors: activeColors,
        skinUrl: "" 
    });
}

document.getElementById("startBtn").addEventListener("click", startGame);
document.getElementById("respawnBtn").addEventListener("click", () => { 
    document.getElementById("gameOverPanel").classList.add("hidden"); 
    startGame(); 
});

// Particles creator for boosting
function createBoostParticle(x, y, color) {
    particles.push({ 
        x: x, y: y, 
        vx: (Math.random()-0.5)*2, 
        vy: (Math.random()-0.5)*2, 
        radius: Math.random()*3+2, 
        alpha: 1, 
        color: color 
    });
}

// Draw radar minimap matching premium wireframe aesthetics
function drawMinimap() {
    const mapRadius = 75;
    const padding = 20;
    const mapX = canvas.width - mapRadius - padding;
    const mapY = canvas.height - mapRadius - padding - 20; // leaves space for bottom server text

    ctx.save();
    
    // Circular radar grid border
    ctx.beginPath();
    ctx.arc(mapX, mapY, mapRadius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(10, 12, 22, 0.6)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.clip();

    // Radar coordinate lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
    ctx.beginPath();
    ctx.moveTo(mapX - mapRadius, mapY);
    ctx.lineTo(mapX + mapRadius, mapY);
    ctx.moveTo(mapX, mapY - mapRadius);
    ctx.lineTo(mapX, mapY + mapRadius);
    ctx.stroke();

    // Concentric coordinate rings
    ctx.beginPath();
    ctx.arc(mapX, mapY, mapRadius * 0.5, 0, Math.PI * 2);
    ctx.stroke();

    const scale = mapRadius / WORLD_RADIUS;

    // Draw coordinate dots for players
    for (let id in serverPlayers) {
        let s = serverPlayers[id];
        let pX = mapX + s.x * scale;
        let pY = mapY + s.y * scale;

        ctx.beginPath();
        ctx.arc(pX, pY, id === myId ? 3.5 : 1.8, 0, Math.PI * 2);
        if (id === myId) {
            ctx.fillStyle = "#ffffff";
            ctx.shadowBlur = 6;
            ctx.shadowColor = "#ffffff";
        } else {
            ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
            ctx.shadowBlur = 0;
        }
        ctx.fill();
    }
    ctx.restore();
}

// Pointed-top dynamic viewport hexagonal grid renderer
function drawHexagonalGrid(camX, camY) {
    const hexRadius = 45; // size matching screenshot hexes
    const w = hexRadius * Math.sqrt(3); // horiz step
    const h = hexRadius * 1.5; // vert step
    
    // Get visible grid bounds
    const startCol = Math.floor((camX - canvas.width / 2) / w) - 1;
    const endCol = Math.ceil((camX + canvas.width / 2) / w) + 1;
    const startRow = Math.floor((camY - canvas.height / 2) / h) - 1;
    const endRow = Math.ceil((camY + canvas.height / 2) / h) + 1;

    ctx.strokeStyle = '#141829';
    ctx.lineWidth = 1.5;

    for (let row = startRow; row <= endRow; row++) {
        let y = row * h;
        for (let col = startCol; col <= endCol; col++) {
            let x = col * w;
            if (row % 2 !== 0) {
                x += w / 2; // Offset odd rows horizontally
            }
            
            let screenX = x - camX + canvas.width / 2;
            let screenY = y - camY + canvas.height / 2;
            
            // Render hexagon path
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                let angle = (Math.PI / 3) * i - (Math.PI / 6); // Pointed top offset
                let px = screenX + hexRadius * Math.cos(angle);
                let py = screenY + hexRadius * Math.sin(angle);
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();
        }
    }
}

// Live game loop rendering
function drawGame() {
    requestAnimationFrame(drawGame);
    if (document.hidden) return; 

    let me = serverPlayers[myId];
    
    if (!me) {
        // Live floating background when on the start menu
        document.querySelector('.leaderboard').classList.add('hidden');
        document.querySelector('.score-box').classList.add('hidden');
        
        // Slow drifting camera movement
        camX = Math.sin(Date.now() * 0.00003) * 500;
        camY = Math.cos(Date.now() * 0.00003) * 500;
    } else {
        document.querySelector('.leaderboard').classList.remove('hidden');
        document.querySelector('.score-box').classList.remove('hidden');
        
        // Update user movement vector
        let localAngle = Math.atan2(mouse.y, mouse.x);
        socket.emit('player_update', { angle: localAngle, isBoosting: isBoosting });

        // Update score display
        document.getElementById("player-score").innerText = Math.floor(me.length * 10);

        // Lock camera directly to the player to prevent network lag jitter
        camX = me.x;
        camY = me.y;
    }

    // Clear board and draw backgrounds with premium spotlight gradient
    if (graphicsQuality === 'high') {
        let grad = ctx.createRadialGradient(
            canvas.width / 2, canvas.height / 2, 20, 
            canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.85
        );
        grad.addColorStop(0, '#101729'); // Brighter center near player
        grad.addColorStop(1, '#05070c'); // Vignetted edge
        ctx.fillStyle = grad;
    } else {
        ctx.fillStyle = '#0b0f19'; 
    }
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw premium hexagonal grid
    drawHexagonalGrid(camX, camY);

    // Outer Zone boundary border
    let sCenterX = 0 - camX + canvas.width / 2; 
    let sCenterY = 0 - camY + canvas.height / 2;
    ctx.save(); 
    ctx.beginPath(); 
    ctx.arc(sCenterX, sCenterY, WORLD_RADIUS, 0, Math.PI * 2); 
    ctx.strokeStyle = '#ff0055'; 
    ctx.lineWidth = 12; 
    ctx.stroke(); 
    ctx.restore();

    // Render speed boost trail particles
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i]; 
        p.x += p.vx; p.y += p.vy; p.alpha -= 0.02;
        if (p.alpha <= 0) { particles.splice(i, 1); continue; }
        let scrX = p.x - camX + canvas.width/2; 
        let scrY = p.y - camY + canvas.height/2;
        ctx.save(); 
        ctx.globalAlpha = p.alpha; 
        ctx.beginPath(); 
        ctx.arc(scrX, scrY, p.radius, 0, Math.PI * 2); 
        ctx.fillStyle = p.color; 
        if (graphicsQuality === 'high') {
            ctx.shadowBlur = 8;
            ctx.shadowColor = p.color;
        }
        ctx.fill(); 
        ctx.restore();
    }

    // Render glowing food objects with magnetic suction animations
    localFoods.forEach(f => {
        let scrX = f.x - camX + canvas.width / 2;
        let scrY = f.y - camY + canvas.height / 2;

        if (me) {
            let distToHead = Math.hypot(me.x - f.x, me.y - f.y);
            // Magnet suction triggers if within 120 pixels of player head
            if (distToHead < 120) {
                let fAngle = Math.atan2(me.y - f.y, me.x - f.x);
                let pullSpeed = (120 - distToHead) * 0.18; 
                f.x += Math.cos(fAngle) * pullSpeed; 
                f.y += Math.sin(fAngle) * pullSpeed; 
                f.radius -= 0.14;
            } else {
                f.x += (f.targetX - f.x) * 0.1; 
                f.y += (f.targetY - f.y) * 0.1;
            }
        } else {
            f.x += (f.targetX - f.x) * 0.1; 
            f.y += (f.targetY - f.y) * 0.1;
        }

        // Frustum culling (only render visible food items)
    if (scrX >= -20 && scrX <= canvas.width + 20 && scrY >= -20 && scrY <= canvas.height + 20 && f.radius > 0.5) {
        ctx.beginPath(); 
        let pulseRadius = f.radius;
        if (graphicsQuality === 'high') {
            // Twinkling pulsate effect based on coordinates and time
            pulseRadius += Math.sin(Date.now() * 0.007 + f.x * 10 + f.y * 10) * 0.5;
        }
        ctx.arc(scrX, scrY, Math.max(0.3, pulseRadius), 0, Math.PI * 2); 
        ctx.fillStyle = f.color;
            if (graphicsQuality === 'high') {
                ctx.save(); 
                ctx.shadowBlur = f.isGlowing ? 16 : 8; 
                ctx.shadowColor = f.color; 
                ctx.fill(); 
                ctx.restore(); 
            } else {
                if (f.isGlowing) { 
                    ctx.save(); 
                    ctx.shadowBlur = 10; 
                    ctx.shadowColor = f.color; 
                    ctx.fill(); 
                    ctx.restore(); 
                } else { 
                    ctx.fill(); 
                }
            }
        }
    });

    // Render snakes with custom striped color patterns
    for (let id in serverPlayers) {
        let s = serverPlayers[id];
        if (!s.body || s.body.length === 0) continue;

        if (graphicsQuality === 'high') {
            ctx.shadowBlur = 10;
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        }

        // Particle trail during boost
        if (s.isBoosting && Math.random() < 0.45) {
            let tail = s.body[s.body.length - 1]; 
            if(tail) createBoostParticle(tail.x, tail.y, s.color);
        }
        if (s.skinUrl && !loadedSkins[s.skinUrl]) { 
            loadedSkins[s.skinUrl] = new Image(); 
            loadedSkins[s.skinUrl].src = s.skinUrl; 
        }

        // Draw body segments with repeating color sequence cycling
        let sColors = s.colors && s.colors.length > 0 ? s.colors : [s.color || '#ff0055'];
        
        // Stacking segments closely with step 1 to create a smooth continuous 3D tube shape
        for (let i = s.body.length - 1; i >= 0; i -= 1) { 
            let part = s.body[i]; 
            if (!part) continue;
            let scrX = part.x - camX + canvas.width / 2; 
            let scrY = part.y - camY + canvas.height / 2;
            
            if (scrX >= -s.radius && scrX <= canvas.width + s.radius && scrY >= -s.radius && scrY <= canvas.height + s.radius) {
                ctx.beginPath(); 
                ctx.arc(scrX, scrY, s.radius, 0, Math.PI * 2);
                if (s.skinUrl && loadedSkins[s.skinUrl].complete) {
                    ctx.save(); ctx.clip(); 
                    ctx.drawImage(loadedSkins[s.skinUrl], scrX - s.radius, scrY - s.radius, s.radius * 2, s.radius * 2); 
                    ctx.restore();
                } else { 
                    // Stretch color patterns slightly larger since step is 1
                    let colorIdx = Math.floor(i / 2) % sColors.length;
                    let baseColor = sColors[colorIdx];
                    ctx.fillStyle = baseColor; 
                    ctx.fill(); 
                    
                    if (graphicsQuality === 'high') {
                        // Volumetric 3D spherical shading (shadows + glares)
                        let shadowGrad = ctx.createRadialGradient(scrX + s.radius * 0.15, scrY + s.radius * 0.15, s.radius * 0.6, scrX, scrY, s.radius);
                        shadowGrad.addColorStop(0, 'rgba(0,0,0,0)');
                        shadowGrad.addColorStop(1, 'rgba(0,0,0,0.22)');
                        ctx.fillStyle = shadowGrad;
                        ctx.fill();

                        let highlightGrad = ctx.createRadialGradient(scrX - s.radius * 0.22, scrY - s.radius * 0.22, s.radius * 0.05, scrX - s.radius * 0.22, scrY - s.radius * 0.22, s.radius * 0.55);
                        highlightGrad.addColorStop(0, 'rgba(255,255,255,0.38)');
                        highlightGrad.addColorStop(1, 'rgba(255,255,255,0)');
                        ctx.fillStyle = highlightGrad;
                        ctx.fill();
                    }
                }
            }
        }

        // Draw head layered directly above body segments with 3D gradients
        let hScrX = s.x - camX + canvas.width / 2; 
        let hScrY = s.y - camY + canvas.height / 2;
        ctx.save(); 
        ctx.translate(hScrX, hScrY); 
        ctx.rotate(s.angle);
        ctx.beginPath(); 
        ctx.arc(0, 0, s.radius + 1.5, 0, Math.PI * 2);
        if (s.skinUrl && loadedSkins[s.skinUrl].complete) {
            ctx.save(); ctx.clip(); 
            ctx.drawImage(loadedSkins[s.skinUrl], -s.radius-1.5, -s.radius-1.5, (s.radius+1.5)*2, (s.radius+1.5)*2); 
            ctx.restore();
        } else { 
            // Head matches the first primary color
            ctx.fillStyle = sColors[0]; 
            ctx.fill(); 
            
            if (graphicsQuality === 'high') {
                // Head 3D shading
                let shadowGrad = ctx.createRadialGradient(s.radius * 0.15, s.radius * 0.15, s.radius * 0.6, 0, 0, s.radius + 1.5);
                shadowGrad.addColorStop(0, 'rgba(0,0,0,0)');
                shadowGrad.addColorStop(1, 'rgba(0,0,0,0.22)');
                ctx.fillStyle = shadowGrad;
                ctx.fill();

                let highlightGrad = ctx.createRadialGradient(-s.radius * 0.22, -s.radius * 0.22, s.radius * 0.05, -s.radius * 0.22, -s.radius * 0.22, s.radius * 0.55);
                highlightGrad.addColorStop(0, 'rgba(255,255,255,0.38)');
                highlightGrad.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.fillStyle = highlightGrad;
                ctx.fill();
            }
        }
        ctx.closePath();

        // Redesigned: Huge overlapping cartoon eyes with black outlines and pupils highlight dots (exactly like screenshot)
        let eyeOffsetSide = s.radius * 0.3;
        let eyeOffsetFront = s.radius * 0.45;
        let eyeRadius = s.radius * 0.52;
        let pupilRadius = s.radius * 0.32;
        
        ctx.fillStyle = '#fff'; 
        ctx.beginPath(); 
        ctx.arc(eyeOffsetFront, -eyeOffsetSide, eyeRadius, 0, Math.PI * 2); 
        ctx.arc(eyeOffsetFront, eyeOffsetSide, eyeRadius, 0, Math.PI * 2); 
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        
        // Left eye pupil with red/orange glare + white dot
        ctx.save();
        ctx.fillStyle = '#000'; 
        ctx.beginPath(); 
        ctx.arc(eyeOffsetFront + s.radius * 0.1, -eyeOffsetSide, pupilRadius, 0, Math.PI * 2); 
        ctx.fill();
        
        let leftPupilX = eyeOffsetFront + s.radius * 0.1;
        let leftPupilY = -eyeOffsetSide;
        let pupilGradL = ctx.createRadialGradient(
            leftPupilX + pupilRadius * 0.3, leftPupilY + pupilRadius * 0.3, pupilRadius * 0.1,
            leftPupilX, leftPupilY, pupilRadius
        );
        pupilGradL.addColorStop(0, '#ff3300');
        pupilGradL.addColorStop(0.5, '#770000');
        pupilGradL.addColorStop(1, '#000000');
        ctx.fillStyle = pupilGradL;
        ctx.beginPath();
        ctx.arc(leftPupilX, leftPupilY, pupilRadius, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(leftPupilX - pupilRadius * 0.3, leftPupilY - pupilRadius * 0.3, pupilRadius * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Right eye pupil with red/orange glare + white dot
        ctx.save();
        ctx.fillStyle = '#000'; 
        ctx.beginPath(); 
        ctx.arc(eyeOffsetFront + s.radius * 0.1, eyeOffsetSide, pupilRadius, 0, Math.PI * 2); 
        ctx.fill();
        
        let rightPupilX = eyeOffsetFront + s.radius * 0.1;
        let rightPupilY = eyeOffsetSide;
        let pupilGradR = ctx.createRadialGradient(
            rightPupilX + pupilRadius * 0.3, rightPupilY + pupilRadius * 0.3, pupilRadius * 0.1,
            rightPupilX, rightPupilY, pupilRadius
        );
        pupilGradR.addColorStop(0, '#ff3300');
        pupilGradR.addColorStop(0.5, '#770000');
        pupilGradR.addColorStop(1, '#000000');
        ctx.fillStyle = pupilGradR;
        ctx.beginPath();
        ctx.arc(rightPupilX, rightPupilY, pupilRadius, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(rightPupilX - pupilRadius * 0.3, rightPupilY - pupilRadius * 0.3, pupilRadius * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        
        ctx.restore();
        
        if (graphicsQuality === 'high') {
            ctx.shadowBlur = 0;
        }
    }

    // Render bottom right minimap
    drawMinimap();

    // Render leaderboard with secure XSS escaping
    let sorted = Object.values(serverPlayers).sort((a, b) => b.length - a.length);
    let html = '';
    sorted.slice(0, 5).forEach((s, idx) => { 
        html += `<div class="lb-item ${s.id === myId ? 'player' : ''}">
                    <span>${idx + 1}. ${escapeHTML(s.name)}</span>
                    <span>${Math.floor(s.length * 10)}</span>
                 </div>`; 
    });
    document.getElementById("leaderboard-content").innerHTML = html;
}

// ----------------------------------------------------
// UI Modals & Skins customization handlers
// ----------------------------------------------------

const skinSelectorModal = document.getElementById("skinSelectorModal");
const skinBuilderModal = document.getElementById("skinBuilderModal");

// Open skin selector
document.getElementById("changeSkinBtn").addEventListener("click", () => {
    skinSelectorModal.classList.remove("hidden");
});

// Close and save skin selector
document.getElementById("saveSkinBtn").addEventListener("click", () => {
    activeSkinSource = 'premade';
    localStorage.setItem('slither_skin_source', activeSkinSource);
    localStorage.setItem('slither_premade_index', currentSkinIndex);
    skinSelectorModal.classList.add("hidden");
});

// Carousel navigation
document.getElementById("prevSkinBtn").addEventListener("click", () => {
    currentSkinIndex = (currentSkinIndex - 1 + PREMADE_SKINS.length) % PREMADE_SKINS.length;
    activeSkinSource = 'premade';
});

document.getElementById("nextSkinBtn").addEventListener("click", () => {
    currentSkinIndex = (currentSkinIndex + 1) % PREMADE_SKINS.length;
    activeSkinSource = 'premade';
});

// Open custom skin builder
document.getElementById("gotoBuilderBtn").addEventListener("click", () => {
    skinSelectorModal.classList.add("hidden");
    skinBuilderModal.classList.remove("hidden");
    
    // Clear build state or load saved custom pattern
    customColorSequence = JSON.parse(localStorage.getItem('slither_custom_colors')) || [];
    renderPaletteGrid();
});

// Reset builder colors list
document.getElementById("resetBuilderBtn").addEventListener("click", () => {
    customColorSequence = [];
    localStorage.removeItem('slither_custom_colors');
});

// Save builder colors list
document.getElementById("saveBuilderBtn").addEventListener("click", () => {
    activeSkinSource = 'custom';
    localStorage.setItem('slither_skin_source', activeSkinSource);
    
    if (customColorSequence.length === 0) {
        customColorSequence = ['#8e24aa', '#1e88e5']; // fallback
    }
    
    localStorage.setItem('slither_custom_colors', JSON.stringify(customColorSequence));
    skinBuilderModal.classList.add("hidden");
});

// Load color palette grid in Custom Builder modal
function renderPaletteGrid() {
    const paletteGrid = document.getElementById("colorPaletteGrid");
    paletteGrid.innerHTML = '';
    
    BUILDER_COLORS.forEach(color => {
        let bubble = document.createElement("div");
        bubble.className = "color-bubble";
        bubble.style.backgroundColor = color;
        
        bubble.addEventListener("click", () => {
            customColorSequence.push(color);
            // Limit custom colors array to maximum of 14 for styling
            if (customColorSequence.length > 14) {
                customColorSequence.shift();
            }
        });
        
        paletteGrid.appendChild(bubble);
    });
}

// Render loop for slithering snakes in previews
function drawPreviewSnakeLoop() {
    requestAnimationFrame(drawPreviewSnakeLoop);
    
    // Animate Carousel Preview Snake
    if (!skinSelectorModal.classList.contains("hidden")) {
        const premadeColors = PREMADE_SKINS[currentSkinIndex].colors;
        drawPreviewSnake(skinPreviewCanvas, previewSnakes.carousel, premadeColors);
    }
    
    // Animate Custom Skin Builder Preview Snake
    if (!skinBuilderModal.classList.contains("hidden")) {
        const builderColors = customColorSequence.length > 0 ? customColorSequence : ['#4c3c78'];
        drawPreviewSnake(builderPreviewCanvas, previewSnakes.builder, builderColors);
    }
}

// Single preview drawing helper function
function drawPreviewSnake(pCanvas, state, colors) {
    const pCtx = pCanvas.getContext("2d");
    pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
    
    previewTime += 0.05;
    
    // Smooth slither wave path for preview
    state.x = pCanvas.width / 2 + Math.sin(previewTime * 1.5) * 45;
    state.y = pCanvas.height / 2 + Math.cos(previewTime * 3) * 15;
    state.angle = Math.sin(previewTime * 3) * 0.4 + Math.PI;
    
    state.body.unshift({ x: state.x, y: state.y });
    state.body.pop();

    // Draw repeating body segments stack with step 1 and 3D shading
    for (let i = state.body.length - 1; i >= 0; i -= 1) {
        let part = state.body[i];
        if (!part) continue;
        pCtx.beginPath();
        pCtx.arc(part.x, part.y, state.radius, 0, Math.PI * 2);
        
        let colorIdx = Math.floor(i / 2) % colors.length;
        let baseColor = colors[colorIdx];
        pCtx.fillStyle = baseColor;
        pCtx.fill();
        
        // 3D Shading overlays
        let shadowGrad = pCtx.createRadialGradient(part.x + state.radius * 0.15, part.y + state.radius * 0.15, state.radius * 0.6, part.x, part.y, state.radius);
        shadowGrad.addColorStop(0, 'rgba(0,0,0,0)');
        shadowGrad.addColorStop(1, 'rgba(0,0,0,0.22)');
        pCtx.fillStyle = shadowGrad;
        pCtx.fill();

        let highlightGrad = pCtx.createRadialGradient(part.x - state.radius * 0.22, part.y - state.radius * 0.22, state.radius * 0.05, part.x - state.radius * 0.22, part.y - state.radius * 0.22, state.radius * 0.55);
        highlightGrad.addColorStop(0, 'rgba(255,255,255,0.38)');
        highlightGrad.addColorStop(1, 'rgba(255,255,255,0)');
        pCtx.fillStyle = highlightGrad;
        pCtx.fill();
        pCtx.closePath();
    }
    
    // Draw head
    pCtx.save();
    pCtx.translate(state.x, state.y);
    pCtx.rotate(state.angle);
    pCtx.beginPath();
    pCtx.arc(0, 0, state.radius + 1.5, 0, Math.PI * 2);
    pCtx.fillStyle = colors[0];
    pCtx.fill();
    
    // Head 3D shading
    let hShadow = pCtx.createRadialGradient(state.radius * 0.15, state.radius * 0.15, state.radius * 0.6, 0, 0, state.radius + 1.5);
    hShadow.addColorStop(0, 'rgba(0,0,0,0)');
    hShadow.addColorStop(1, 'rgba(0,0,0,0.22)');
    pCtx.fillStyle = hShadow;
    pCtx.fill();

    let hHighlight = pCtx.createRadialGradient(-state.radius * 0.22, -state.radius * 0.22, state.radius * 0.05, -state.radius * 0.22, -state.radius * 0.22, state.radius * 0.55);
    hHighlight.addColorStop(0, 'rgba(255,255,255,0.38)');
    hHighlight.addColorStop(1, 'rgba(255,255,255,0)');
    pCtx.fillStyle = hHighlight;
    pCtx.fill();
    pCtx.closePath();
    
    // Huge overlapping cartoon eyes
    let eyeOffsetSide = state.radius * 0.3;
    let eyeOffsetFront = state.radius * 0.45;
    let eyeRadius = state.radius * 0.52;
    let pupilRadius = state.radius * 0.32;
    
    pCtx.fillStyle = '#fff'; 
    pCtx.beginPath(); 
    pCtx.arc(eyeOffsetFront, -eyeOffsetSide, eyeRadius, 0, Math.PI * 2); 
    pCtx.arc(eyeOffsetFront, eyeOffsetSide, eyeRadius, 0, Math.PI * 2); 
    pCtx.fill();
    pCtx.strokeStyle = '#000';
    pCtx.lineWidth = 1.2;
    pCtx.stroke();
    
    // Left eye pupil with red/orange glare + white dot
    pCtx.save();
    pCtx.fillStyle = '#000';
    pCtx.beginPath();
    pCtx.arc(eyeOffsetFront + state.radius * 0.1, -eyeOffsetSide, pupilRadius, 0, Math.PI * 2);
    pCtx.fill();
    
    let leftPupilX = eyeOffsetFront + state.radius * 0.1;
    let leftPupilY = -eyeOffsetSide;
    let pupilGradL = pCtx.createRadialGradient(
        leftPupilX + pupilRadius * 0.3, leftPupilY + pupilRadius * 0.3, pupilRadius * 0.1,
        leftPupilX, leftPupilY, pupilRadius
    );
    pupilGradL.addColorStop(0, '#ff3300');
    pupilGradL.addColorStop(0.5, '#770000');
    pupilGradL.addColorStop(1, '#000000');
    pCtx.fillStyle = pupilGradL;
    pCtx.beginPath();
    pCtx.arc(leftPupilX, leftPupilY, pupilRadius, 0, Math.PI * 2);
    pCtx.fill();
    
    pCtx.fillStyle = '#fff';
    pCtx.beginPath();
    pCtx.arc(leftPupilX - pupilRadius * 0.3, leftPupilY - pupilRadius * 0.3, pupilRadius * 0.25, 0, Math.PI * 2);
    pCtx.fill();
    pCtx.restore();

    // Right eye pupil with red/orange glare + white dot
    pCtx.save();
    pCtx.fillStyle = '#000';
    pCtx.beginPath();
    pCtx.arc(eyeOffsetFront + state.radius * 0.1, eyeOffsetSide, pupilRadius, 0, Math.PI * 2);
    pCtx.fill();
    
    let rightPupilX = eyeOffsetFront + state.radius * 0.1;
    let rightPupilY = eyeOffsetSide;
    let pupilGradR = pCtx.createRadialGradient(
        rightPupilX + pupilRadius * 0.3, rightPupilY + pupilRadius * 0.3, pupilRadius * 0.1,
        rightPupilX, rightPupilY, pupilRadius
    );
    pupilGradR.addColorStop(0, '#ff3300');
    pupilGradR.addColorStop(0.5, '#770000');
    pupilGradR.addColorStop(1, '#000000');
    pCtx.fillStyle = pupilGradR;
    pCtx.beginPath();
    pCtx.arc(rightPupilX, rightPupilY, pupilRadius, 0, Math.PI * 2);
    pCtx.fill();
    
    pCtx.fillStyle = '#fff';
    pCtx.beginPath();
    pCtx.arc(rightPupilX - pupilRadius * 0.3, rightPupilY - pupilRadius * 0.3, pupilRadius * 0.25, 0, Math.PI * 2);
    pCtx.fill();
    pCtx.restore();
    
    pCtx.restore();
}

// Generate a random server ID on load
document.getElementById("server-id-label").innerText = `server ${Math.floor(1000 + Math.random() * 8999)}`;

// Initialize graphics quality button state
const graphicsToggleBtn = document.getElementById("graphicsToggleBtn");
if (graphicsToggleBtn) {
    graphicsToggleBtn.querySelector("span").innerHTML = `Graphics:<br>${graphicsQuality === 'high' ? 'High quality' : 'Low quality'}`;
    
    graphicsToggleBtn.addEventListener("click", () => {
        graphicsQuality = graphicsQuality === 'high' ? 'low' : 'high';
        localStorage.setItem('slither_graphics', graphicsQuality);
        graphicsToggleBtn.querySelector("span").innerHTML = `Graphics:<br>${graphicsQuality === 'high' ? 'High quality' : 'Low quality'}`;
    });
}

// Initialize sound toggle button state
const soundToggleBtn = document.getElementById("soundToggleBtn");
if (soundToggleBtn) {
    soundToggleBtn.querySelector("span").innerText = `Sound: ${soundVolume > 0 ? 'On' : 'Off'}`;
    
    soundToggleBtn.addEventListener("click", () => {
        soundVolume = soundVolume > 0 ? 0.0 : 1.0;
        localStorage.setItem('slither_sound_volume', soundVolume);
        soundToggleBtn.querySelector("span").innerText = `Sound: ${soundVolume > 0 ? 'On' : 'Off'}`;
        
        // Resume Context on user interaction if turning sound on
        if (soundVolume > 0) {
            initAudio();
            if (audioCtx.state === 'suspended') audioCtx.resume();
        } else {
            stopBoostSound();
        }
    });
}

// Start game and preview rendering loops
drawPreviewSnakeLoop();
requestAnimationFrame(drawGame);