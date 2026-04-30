/* ============================================
   NEON PONG — Game Engine
   ============================================ */

(() => {
    'use strict';

    // ─── DOM References ─────────────────────────────
    const canvas = document.getElementById('pong-canvas');
    const ctx = canvas.getContext('2d');

    const screens = {
        start: document.getElementById('start-screen'),
        game: document.getElementById('game-screen'),
        gameover: document.getElementById('gameover-screen'),
    };

    const ui = {
        startBtn: document.getElementById('start-btn'),
        pauseBtn: document.getElementById('pause-btn'),
        resumeBtn: document.getElementById('resume-btn'),
        quitBtn: document.getElementById('quit-btn'),
        rematchBtn: document.getElementById('rematch-btn'),
        menuBtn: document.getElementById('menu-btn'),
        playerScore: document.getElementById('player-score'),
        aiScore: document.getElementById('ai-score'),
        roundDisplay: document.getElementById('round-display'),
        pauseOverlay: document.getElementById('pause-overlay'),
        gameoverTitle: document.getElementById('gameover-title'),
        finalPlayerScore: document.getElementById('final-player-score'),
        finalAiScore: document.getElementById('final-ai-score'),
        diffBtns: document.querySelectorAll('.diff-btn'),
    };

    // ─── Constants ──────────────────────────────────
    const WINNING_SCORE = 7;
    const PADDLE_WIDTH_RATIO = 0.015;   // relative to canvas width
    const PADDLE_HEIGHT_RATIO = 0.18;   // relative to canvas height
    const BALL_RADIUS_RATIO = 0.012;    // relative to canvas width
    const BALL_BASE_SPEED_RATIO = 0.006; // relative to canvas width
    const BALL_SPEED_INCREMENT = 0.00004; // per-frame acceleration ratio
    const PADDLE_SPEED_RATIO = 0.009;   // relative to canvas height
    const MAX_BOUNCE_ANGLE = Math.PI / 4; // 45 degrees

    const COLORS = {
        cyan: '#00f0ff',
        cyanDim: 'rgba(0, 240, 255, 0.15)',
        magenta: '#ff00e5',
        magentaDim: 'rgba(255, 0, 229, 0.15)',
        blue: '#3366ff',
        white: '#e8e8f0',
        grid: 'rgba(255, 255, 255, 0.03)',
        centerLine: 'rgba(255, 255, 255, 0.06)',
    };

    const AI_DIFFICULTY = {
        easy:   { reactionRate: 0.03, errorMargin: 60, predictionNoise: 80 },
        medium: { reactionRate: 0.06, errorMargin: 30, predictionNoise: 40 },
        hard:   { reactionRate: 0.12, errorMargin: 10, predictionNoise: 12 },
    };

    // ─── Game State ─────────────────────────────────
    let state = {
        difficulty: 'medium',
        paused: false,
        running: false,
        playerScore: 0,
        aiScore: 0,
        round: 1,
    };

    let player, ai, ball;
    let keys = {};
    let touchY = null;
    let animFrameId = null;

    // Trail particles
    let particles = [];

    // ─── Responsive Canvas ──────────────────────────
    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';
        ctx.scale(dpr, dpr);
    }

    function W() { return window.innerWidth; }
    function H() { return window.innerHeight; }

    // ─── Entity Factories ───────────────────────────
    function createPaddle(x, isAI = false) {
        return {
            x,
            y: H() / 2,
            w: Math.max(W() * PADDLE_WIDTH_RATIO, 8),
            h: Math.max(H() * PADDLE_HEIGHT_RATIO, 60),
            speed: H() * PADDLE_SPEED_RATIO,
            targetY: H() / 2,
            isAI,
            glowIntensity: 0,
        };
    }

    function createBall() {
        const speed = Math.max(W() * BALL_BASE_SPEED_RATIO, 3);
        const angle = (Math.random() * Math.PI / 3) - Math.PI / 6; // -30° to +30°
        const dir = Math.random() > 0.5 ? 1 : -1;
        return {
            x: W() / 2,
            y: H() / 2,
            radius: Math.max(W() * BALL_RADIUS_RATIO, 6),
            vx: Math.cos(angle) * speed * dir,
            vy: Math.sin(angle) * speed,
            baseSpeed: speed,
            currentSpeed: speed,
            glowIntensity: 1,
        };
    }

    // ─── Initialization ─────────────────────────────
    function initGame() {
        state.playerScore = 0;
        state.aiScore = 0;
        state.round = 1;
        state.paused = false;
        state.running = true;
        particles = [];

        const paddleMargin = W() * 0.03;
        const pw = Math.max(W() * PADDLE_WIDTH_RATIO, 8);

        player = createPaddle(paddleMargin);
        ai = createPaddle(W() - paddleMargin - pw, true);
        ball = createBall();

        updateHUD();
    }

    function resetBall() {
        ball = createBall();
        particles = [];
    }

    // ─── AI Logic ───────────────────────────────────
    function updateAI(dt) {
        const diff = AI_DIFFICULTY[state.difficulty];

        // Predict where the ball will be when it reaches the AI paddle
        let predictedY = ball.y;
        if (ball.vx > 0) {
            const timeToReach = (ai.x - ball.x) / ball.vx;
            predictedY = ball.y + ball.vy * timeToReach;

            // Add noise for imperfection
            predictedY += (Math.random() - 0.5) * diff.predictionNoise;

            // Bounce prediction off walls
            while (predictedY < 0 || predictedY > H()) {
                if (predictedY < 0) predictedY = -predictedY;
                if (predictedY > H()) predictedY = 2 * H() - predictedY;
            }
        }

        // Add error margin
        const error = (Math.random() - 0.5) * diff.errorMargin;
        ai.targetY = predictedY + error;

        // Smooth movement toward target
        const diff_y = ai.targetY - ai.y;
        ai.y += diff_y * diff.reactionRate;

        // Clamp
        ai.y = Math.max(ai.h / 2, Math.min(H() - ai.h / 2, ai.y));
    }

    // ─── Player Input ───────────────────────────────
    function updatePlayer(dt) {
        let moving = false;

        if (touchY !== null) {
            // Touch control — lerp toward touch position
            const diff = touchY - player.y;
            player.y += diff * 0.12;
            moving = true;
        } else {
            // Keyboard
            if (keys['ArrowUp'] || keys['w'] || keys['W']) {
                player.y -= player.speed * dt;
                moving = true;
            }
            if (keys['ArrowDown'] || keys['s'] || keys['S']) {
                player.y += player.speed * dt;
                moving = true;
            }
        }

        player.y = Math.max(player.h / 2, Math.min(H() - player.h / 2, player.y));
        player.glowIntensity = moving ? Math.min(player.glowIntensity + 0.1, 1.5) : Math.max(player.glowIntensity - 0.05, 0.6);
    }

    // ─── Ball Physics ───────────────────────────────
    function updateBall(dt) {
        // Accelerate over time
        ball.currentSpeed += W() * BALL_SPEED_INCREMENT;
        const speedRatio = ball.currentSpeed / ball.baseSpeed;

        ball.x += ball.vx * dt * speedRatio;
        ball.y += ball.vy * dt * speedRatio;

        // Top/bottom bounce
        if (ball.y - ball.radius <= 0) {
            ball.y = ball.radius;
            ball.vy = Math.abs(ball.vy);
            spawnWallParticles(ball.x, 0);
        }
        if (ball.y + ball.radius >= H()) {
            ball.y = H() - ball.radius;
            ball.vy = -Math.abs(ball.vy);
            spawnWallParticles(ball.x, H());
        }

        // Paddle collision
        checkPaddleCollision(player);
        checkPaddleCollision(ai);

        // Scoring
        if (ball.x < -ball.radius * 2) {
            state.aiScore++;
            state.round++;
            updateHUD();
            animateScore('ai');
            resetBall();
            checkWin();
        }
        if (ball.x > W() + ball.radius * 2) {
            state.playerScore++;
            state.round++;
            updateHUD();
            animateScore('player');
            resetBall();
            checkWin();
        }

        // Trail particles
        if (Math.random() < 0.6) {
            particles.push({
                x: ball.x,
                y: ball.y,
                radius: ball.radius * (0.3 + Math.random() * 0.4),
                alpha: 0.5 + Math.random() * 0.3,
                decay: 0.015 + Math.random() * 0.02,
            });
        }
    }

    function checkPaddleCollision(paddle) {
        const paddleLeft = paddle.x;
        const paddleRight = paddle.x + paddle.w;
        const paddleTop = paddle.y - paddle.h / 2;
        const paddleBottom = paddle.y + paddle.h / 2;

        const ballLeft = ball.x - ball.radius;
        const ballRight = ball.x + ball.radius;
        const ballTop = ball.y - ball.radius;
        const ballBottom = ball.y + ball.radius;

        if (ballRight >= paddleLeft && ballLeft <= paddleRight &&
            ballBottom >= paddleTop && ballTop <= paddleBottom) {

            // Calculate relative hit position (-1 to 1)
            const relativeIntersect = (ball.y - paddle.y) / (paddle.h / 2);
            const bounceAngle = relativeIntersect * MAX_BOUNCE_ANGLE;

            const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
            const dir = paddle.isAI ? -1 : 1;

            ball.vx = Math.cos(bounceAngle) * speed * dir;
            ball.vy = Math.sin(bounceAngle) * speed;

            // Push ball out of paddle
            if (!paddle.isAI) {
                ball.x = paddleRight + ball.radius;
            } else {
                ball.x = paddleLeft - ball.radius;
            }

            // Boost paddle glow
            paddle.glowIntensity = 2;

            // Spawn hit particles
            spawnHitParticles(ball.x, ball.y, paddle.isAI);
        }
    }

    // ─── Particles ──────────────────────────────────
    function spawnHitParticles(x, y, isAI) {
        for (let i = 0; i < 12; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1 + Math.random() * 3;
            particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius: 2 + Math.random() * 3,
                alpha: 0.8,
                decay: 0.02 + Math.random() * 0.03,
                color: isAI ? COLORS.magenta : COLORS.cyan,
                isHit: true,
            });
        }
    }

    function spawnWallParticles(x, y) {
        for (let i = 0; i < 6; i++) {
            const spread = (Math.random() - 0.5) * 60;
            particles.push({
                x: x + spread, y,
                vx: (Math.random() - 0.5) * 2,
                vy: y === 0 ? Math.random() * 2 : -Math.random() * 2,
                radius: 1.5 + Math.random() * 2,
                alpha: 0.5,
                decay: 0.025,
                color: COLORS.blue,
                isHit: true,
            });
        }
    }

    function updateParticles() {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.alpha -= p.decay;
            if (p.isHit) {
                p.x += p.vx;
                p.y += p.vy;
                p.vx *= 0.96;
                p.vy *= 0.96;
            }
            if (p.alpha <= 0) {
                particles.splice(i, 1);
            }
        }
    }

    // ─── Rendering ──────────────────────────────────
    function draw() {
        const w = W();
        const h = H();

        ctx.clearRect(0, 0, w, h);

        // Background
        drawBackground(w, h);

        // Particles (behind everything)
        drawParticles();

        // Paddles
        drawPaddle(player, COLORS.cyan, COLORS.cyanDim);
        drawPaddle(ai, COLORS.magenta, COLORS.magentaDim);

        // Ball
        drawBall();

        // Center line
        drawCenterLine(w, h);
    }

    function drawBackground(w, h) {
        // Subtle grid
        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 1;
        const gridSize = 60;
        for (let x = gridSize; x < w; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        for (let y = gridSize; y < h; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }
    }

    function drawCenterLine(w, h) {
        ctx.save();
        ctx.setLineDash([12, 18]);
        ctx.strokeStyle = COLORS.centerLine;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(w / 2, 0);
        ctx.lineTo(w / 2, h);
        ctx.stroke();
        ctx.restore();
    }

    function drawPaddle(paddle, color, dimColor) {
        const x = paddle.x;
        const y = paddle.y - paddle.h / 2;
        const w = paddle.w;
        const h = paddle.h;
        const glow = paddle.glowIntensity;

        // Outer glow
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 20 * glow;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 4);
        ctx.fill();
        ctx.restore();

        // Inner gradient
        const grad = ctx.createLinearGradient(x, y, x, y + h);
        grad.addColorStop(0, color);
        grad.addColorStop(0.5, dimColor);
        grad.addColorStop(1, color);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 4);
        ctx.fill();

        // Bright core
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 2, w - 2, h - 4, 3);
        ctx.fill();
        ctx.globalAlpha = 1;

        // Decay glow
        paddle.glowIntensity = Math.max(0.6, paddle.glowIntensity * 0.97);
    }

    function drawBall() {
        const { x, y, radius, glowIntensity } = ball;

        // Determine ball color based on direction
        const color = ball.vx > 0 ? COLORS.magenta : COLORS.cyan;
        const speedFactor = ball.currentSpeed / ball.baseSpeed;

        // Large outer glow
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 25 * glowIntensity * Math.min(speedFactor, 2);

        // Ball body
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // White-hot core
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    function drawParticles() {
        for (const p of particles) {
            ctx.fillStyle = p.color || (ball.vx > 0 ? COLORS.magenta : COLORS.cyan);
            ctx.globalAlpha = p.alpha * 0.6;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    // ─── HUD Updates ────────────────────────────────
    function updateHUD() {
        ui.playerScore.textContent = state.playerScore;
        ui.aiScore.textContent = state.aiScore;
        ui.roundDisplay.textContent = `ROUND ${state.round}`;
    }

    function animateScore(who) {
        const el = who === 'player' ? ui.playerScore : ui.aiScore;
        el.classList.remove('score-animate');
        void el.offsetWidth; // trigger reflow
        el.classList.add('score-animate');
    }

    function checkWin() {
        if (state.playerScore >= WINNING_SCORE || state.aiScore >= WINNING_SCORE) {
            state.running = false;
            const playerWon = state.playerScore >= WINNING_SCORE;
            showScreen('gameover');

            ui.gameoverTitle.textContent = playerWon ? 'YOU WIN!' : 'GAME OVER';
            ui.gameoverTitle.className = 'gameover-title ' + (playerWon ? 'win' : 'lose');
            ui.finalPlayerScore.textContent = state.playerScore;
            ui.finalAiScore.textContent = state.aiScore;
        }
    }

    // ─── Screen Management ──────────────────────────
    function showScreen(name) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        screens[name].classList.add('active');
    }

    // ─── Game Loop ──────────────────────────────────
    let lastTime = 0;

    function gameLoop(timestamp) {
        if (!state.running) return;

        animFrameId = requestAnimationFrame(gameLoop);

        if (lastTime === 0) { lastTime = timestamp; return; }
        const rawDt = (timestamp - lastTime) / 1000;
        const dt = Math.min(rawDt, 1 / 30); // cap delta to prevent jumps
        lastTime = timestamp;

        if (state.paused) {
            draw(); // still render, just don't update
            return;
        }

        // Update
        updatePlayer(dt);
        updateAI(dt);
        updateBall(dt);
        updateParticles();

        // Draw
        draw();
    }

    function startGameLoop() {
        lastTime = 0;
        if (animFrameId) cancelAnimationFrame(animFrameId);
        animFrameId = requestAnimationFrame(gameLoop);
    }

    // ─── Event Listeners ────────────────────────────

    // Keyboard
    window.addEventListener('keydown', (e) => {
        keys[e.key] = true;
        if (e.key === 'Escape' && state.running) togglePause();
    });
    window.addEventListener('keyup', (e) => { keys[e.key] = false; });

    // Touch
    canvas.addEventListener('touchstart', handleTouch, { passive: false });
    canvas.addEventListener('touchmove', handleTouch, { passive: false });
    canvas.addEventListener('touchend', () => { touchY = null; });

    function handleTouch(e) {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        touchY = e.touches[0].clientY - rect.top;
    }

    // Mouse (for desktop testing of touch-like controls)
    let mouseDown = false;
    canvas.addEventListener('mousedown', (e) => {
        mouseDown = true;
        touchY = e.clientY - canvas.getBoundingClientRect().top;
    });
    canvas.addEventListener('mousemove', (e) => {
        if (mouseDown) {
            touchY = e.clientY - canvas.getBoundingClientRect().top;
        }
    });
    canvas.addEventListener('mouseup', () => { mouseDown = false; touchY = null; });

    // Resize
    window.addEventListener('resize', () => {
        resizeCanvas();
        if (state.running) {
            // Recalculate paddle dimensions
            player.w = Math.max(W() * PADDLE_WIDTH_RATIO, 8);
            player.h = Math.max(H() * PADDLE_HEIGHT_RATIO, 60);
            player.speed = H() * PADDLE_SPEED_RATIO;

            ai.w = Math.max(W() * PADDLE_WIDTH_RATIO, 8);
            ai.h = Math.max(H() * PADDLE_HEIGHT_RATIO, 60);
            ai.speed = H() * PADDLE_SPEED_RATIO;
            ai.x = W() - W() * 0.03 - ai.w;

            ball.radius = Math.max(W() * BALL_RADIUS_RATIO, 6);
        }
    });

    // ─── UI Buttons ─────────────────────────────────

    // Difficulty selection
    ui.diffBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            ui.diffBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.difficulty = btn.dataset.difficulty;
        });
    });

    // Start
    ui.startBtn.addEventListener('click', () => {
        resizeCanvas();
        initGame();
        showScreen('game');
        startGameLoop();
    });

    // Pause
    ui.pauseBtn.addEventListener('click', togglePause);
    ui.resumeBtn.addEventListener('click', togglePause);

    function togglePause() {
        state.paused = !state.paused;
        ui.pauseOverlay.classList.toggle('hidden', !state.paused);
        ui.pauseBtn.textContent = state.paused ? '▶' : '⏸';
    }

    // Quit
    ui.quitBtn.addEventListener('click', () => {
        state.running = false;
        state.paused = false;
        ui.pauseOverlay.classList.add('hidden');
        if (animFrameId) cancelAnimationFrame(animFrameId);
        showScreen('start');
    });

    // Rematch
    ui.rematchBtn.addEventListener('click', () => {
        resizeCanvas();
        initGame();
        showScreen('game');
        startGameLoop();
    });

    // Menu
    ui.menuBtn.addEventListener('click', () => {
        if (animFrameId) cancelAnimationFrame(animFrameId);
        showScreen('start');
    });

    // ─── Initial Setup ──────────────────────────────
    resizeCanvas();

})();
