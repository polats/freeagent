// The star effect from cosmiclabs.org (index.html, inline script), reused as is: the silver stars
// image (images/allstars.png) is dithered with a 4×4 Bayer matrix into 2px particles — lime for the
// bright pixels, the ground gray for the dark ones — that float idly and scatter from the pointer,
// then drift home. Lines marked FREEAGENT are the only additions (touch input, stop, manual start).
// Main script
class Particle {
    constructor(x, y, isWhite, bayerX, bayerY) {
        this.pos = { x, y };
        this.origin = { x, y };
        this.vel = { x: 0, y: 0 };
        this.dispersed = false;
        this.isStatic = false;
        this.isWhite = isWhite;
        this.baseSize = 2;
        this.maxSize = 3;
        this.currentSize = this.baseSize;
        this.bayerX = bayerX;
        this.bayerY = bayerY;
        this.returnSpeed = 0.05;
        this.lastMouseX = null;
        this.lastMouseY = null;
        this.lastMouseVelX = 0;
        this.lastMouseVelY = 0;

        // Idle floating animation
        this.idleTime = Math.random() * Math.PI * 2; // random phase offset
        this.idleSpeed = 0.8 + Math.random() * 0.6; // faster oscillation
        this.idleAmplitude = 4 + Math.random() * 4; // 4-8px float range
    }

    update(mx, my, dispersionRadius, time) {
        // Idle floating animation when not dispersed
        this.idleTime += 0.016 * this.idleSpeed;
        
        if (this.lastMouseX !== null) {
            this.lastMouseVelX = mx - this.lastMouseX;
            this.lastMouseVelY = my - this.lastMouseY;
        }

        const mouseHasMoved =
            this.lastMouseX !== mx || this.lastMouseY !== my;
        this.lastMouseX = mx;
        this.lastMouseY = my;

        const dx = mx - this.pos.x;
        const dy = my - this.pos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < dispersionRadius) {
            if (!this.dispersed || mouseHasMoved) {
                const impact = 1 - distance / dispersionRadius;
                const angle = Math.atan2(dy, dx);
                let velocityX =
                    -Math.cos(angle) * (3 + Math.random() * 2);
                let velocityY =
                    -Math.sin(angle) * (3 + Math.random() * 2);
                velocityX += this.lastMouseVelX * 0.5;
                velocityY += this.lastMouseVelY * 0.5;
                velocityX += (Math.random() - 0.5) * 2;
                velocityY += (Math.random() - 0.5) * 2;
                this.vel.x = velocityX * impact;
                this.vel.y = velocityY * impact;
                this.dispersed = true;
                this.isStatic = false;
                this.currentSize =
                    this.baseSize +
                    Math.random() * (this.maxSize - this.baseSize);
            }
        }

        if (this.dispersed) {
            if (!mouseHasMoved && distance > dispersionRadius) {
                if (!this.isStatic) {
                    this.isStatic = true;
                    this.vel.x += (Math.random() - 0.5) * 0.3;
                    this.vel.y += (Math.random() - 0.5) * 0.3;
                }
            } else {
                this.isStatic = false;
            }

            if (!this.isStatic) {
                this.pos.x += this.vel.x;
                this.pos.y += this.vel.y;
                this.vel.x += (Math.random() - 0.5) * 0.2;
                this.vel.y += (Math.random() - 0.5) * 0.2;

                if (distance > dispersionRadius * 1.5) {
                    const returnX = this.origin.x - this.pos.x;
                    const returnY = this.origin.y - this.pos.y;
                    const returnDist = Math.sqrt(
                        returnX * returnX + returnY * returnY,
                    );

                    if (returnDist > 2) {
                        this.vel.x += returnX * this.returnSpeed;
                        this.vel.y += returnY * this.returnSpeed;
                    } else {
                        this.reset();
                    }
                }

                this.vel.x *= 0.95;
                this.vel.y *= 0.95;

                const rect = this.canvas.getBoundingClientRect();
                if (this.pos.x < 0 || this.pos.x > rect.width) {
                    this.vel.x *= -0.8;
                    this.pos.x = Math.max(
                        0,
                        Math.min(this.pos.x, rect.width),
                    );
                }
                if (this.pos.y < 0 || this.pos.y > rect.height) {
                    this.vel.y *= -0.8;
                    this.pos.y = Math.max(
                        0,
                        Math.min(this.pos.y, rect.height),
                    );
                }
            }
        }
    }

    reset() {
        this.pos.x = this.origin.x;
        this.pos.y = this.origin.y;
        this.vel.x = 0;
        this.vel.y = 0;
        this.dispersed = false;
        this.isStatic = false;
        this.currentSize = this.baseSize;
    }

    draw(ctx) {
        ctx.fillStyle = this.isWhite ? "#baff00" : "#d9d6d6";
        const offset = (this.currentSize - this.baseSize) / 2;
        
        // Apply idle floating offset when not dispersed
        let drawX = this.pos.x;
        let drawY = this.pos.y;
        if (!this.dispersed) {
            drawY += Math.sin(this.idleTime) * this.idleAmplitude;
            drawX += Math.sin(this.idleTime * 0.7 + this.bayerX) * this.idleAmplitude * 0.5;
        }
        
        ctx.fillRect(
            drawX - offset,
            drawY - offset,
            this.currentSize,
            this.currentSize,
        );
    }
}

class DitheredPixelEffect {
    constructor(containerSelector) {
        // Create container if it doesn't exist
        let container = document.querySelector(containerSelector);
        if (!container) {
            container = document.createElement("div");
            container.className = "dithered-container";
            document.body.appendChild(container);
        }

        this.container = container;

        // Canvas setup
        this.canvas = document.createElement("canvas");
        this.canvas.style.position = "absolute";
        this.canvas.style.top = "0";
        this.canvas.style.left = "0";
        this.canvas.style.width = "100%";
        this.canvas.style.height = "100%";
        this.canvas.style.pointerEvents = "none";
        this.ctx = this.canvas.getContext("2d");

        // Temporary canvas for image processing
        this.tempCanvas = document.createElement("canvas");
        this.tempCtx = this.tempCanvas.getContext("2d");

        // Particle system setup
        this.particles = [];
        this.dispersionRadius = 50;
        this.mousePos = { x: -1000, y: -1000 };

        // Add canvas to container
        this.container.appendChild(this.canvas);

        // Event listeners
        this.container.addEventListener(
            "mousemove",
            this.onMouseMove.bind(this),
        );
        // FREEAGENT: a finger disperses the stars like the mouse does on the site
        this.container.addEventListener("touchstart", this.onTouch.bind(this), { passive: true });
        this.container.addEventListener("touchmove", this.onTouch.bind(this), { passive: true });
        this.container.addEventListener("touchend", this.onMouseLeave.bind(this), { passive: true });
        this.container.addEventListener(
            "mouseleave",
            this.onMouseLeave.bind(this),
        );
        window.addEventListener(
            "resize",
            this.onWindowResize.bind(this),
        );

        // Initial resize
        this.onWindowResize();

        // Start animation
        this.animate();
    }

    loadImage(imageUrl) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = "anonymous";
            image.onload = () => {
                const rect = this.container.getBoundingClientRect();
                const scale = Math.min(
                    (rect.width * 1) / image.width,
                    (rect.height * 1) / image.height,
                );

                this.tempCanvas.width = image.width * scale;
                this.tempCanvas.height = image.height * scale;

                const x = (rect.width - this.tempCanvas.width) / 2;
                const y =
                    (rect.height - this.tempCanvas.height) / 2;

                this.tempCtx.drawImage(
                    image,
                    0,
                    0,
                    this.tempCanvas.width,
                    this.tempCanvas.height,
                );
                this.convertToParticles(x, y);
                resolve();
            };
            image.onerror = reject;
            image.src = imageUrl;
        });
    }

    convertToParticles(offsetX, offsetY) {
        const imageData = this.tempCtx.getImageData(
            0,
            0,
            this.tempCanvas.width,
            this.tempCanvas.height,
        );
        const pixels = imageData.data;
        const width = this.tempCanvas.width;
        const height = this.tempCanvas.height;

        const bayerMatrix = [
            [0.0 / 16.0, 8.0 / 16.0, 2.0 / 16.0, 10.0 / 16.0],
            [12.0 / 16.0, 4.0 / 16.0, 14.0 / 16.0, 6.0 / 16.0],
            [3.0 / 16.0, 11.0 / 16.0, 1.0 / 16.0, 9.0 / 16.0],
            [15.0 / 16.0, 7.0 / 16.0, 13.0 / 16.0, 5.0 / 16.0],
        ];

        const stepSize = 2;
        this.particles = [];

        for (let x = 0; x < width; x += stepSize) {
            for (let y = 0; y < height; y += stepSize) {
                const i = (y * width + x) * 4;
                const r = pixels[i];
                const g = pixels[i + 1];
                const b = pixels[i + 2];
                const a = pixels[i + 3];

                if (a < 128) continue;

                const luminance =
                    (r * 0.299 + g * 0.587 + b * 0.114) / 255;

                if (luminance > 0.05) {
                    const bayerX = Math.floor(x / stepSize) % 4;
                    const bayerY = Math.floor(y / stepSize) % 4;
                    const bayerValue = bayerMatrix[bayerY][bayerX];

                    const normalizedLuminance = Math.pow(
                        luminance,
                        0.8,
                    );
                    const shouldCreateParticle =
                        normalizedLuminance > bayerValue;

                    if (shouldCreateParticle) {
                        const isWhite =
                            luminance >
                            0.5 + (bayerValue - 0.5) * 0.5;
                        if (isWhite || bayerValue > 0.3) {
                            const particle = new Particle(
                                x + offsetX,
                                y + offsetY,
                                isWhite,
                                bayerX,
                                bayerY,
                            );
                            particle.canvas = this.canvas;
                            this.particles.push(particle);
                        }
                    }
                }
            }
        }
    }

    onMouseMove(event) {
        const rect = this.container.getBoundingClientRect();
        this.mousePos.x = event.clientX - rect.left;
        this.mousePos.y = event.clientY - rect.top;
    }

    // FREEAGENT: touch → the same mouse position the effect already reads
    onTouch(event) {
        const touch = event.touches[0];
        if (!touch) return;
        const rect = this.container.getBoundingClientRect();
        this.mousePos.x = touch.clientX - rect.left;
        this.mousePos.y = touch.clientY - rect.top;
    }

    onMouseLeave() {
        this.mousePos.x = -1000;
        this.mousePos.y = -1000;
    }

    onWindowResize() {
        const rect = this.container.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
    }

    // FREEAGENT: the sign-in screen hides once signed in; stop drawing then
    stop() { this.stopped = true; }

    animate() {
        if (this.stopped) return;
        requestAnimationFrame(this.animate.bind(this));
        this.ctx.clearRect(
            0,
            0,
            this.canvas.width,
            this.canvas.height,
        );

        for (const particle of this.particles) {
            particle.update(
                this.mousePos.x,
                this.mousePos.y,
                this.dispersionRadius,
            );
            particle.draw(this.ctx);
        }
    }
}

// FREEAGENT: started by app.js when the sign-in screen is shown (the site starts it on DOMContentLoaded)
window.CosmicStars = {
    effect: null,
    async start(selector) {
        if (this.effect) return;
        this.effect = new DitheredPixelEffect(selector);
        try {
            await this.effect.loadImage("images/allstars.png");
        } catch (error) {
            console.error("Failed to load image:", error);
        }
    },
    stop() {
        if (!this.effect) return;
        this.effect.stop();
        this.effect.canvas.remove();
        this.effect = null;
    },
};
