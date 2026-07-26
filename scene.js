const elementsLayer = document.querySelector("#scene-elements");
const rippleLayer = document.querySelector("#ripple-layer");
const stage = document.querySelector(".stage");

const ARTBOARD_WIDTH = 1920;
const ARTBOARD_HEIGHT = 3840;
const RIPPLE_FPS = 30;
const RIPPLE_FRAME_COUNT = 76;
const RIPPLE_DURATION = RIPPLE_FRAME_COUNT / RIPPLE_FPS;
const RIPPLE_RADIUS = 600;
const WAVE_BAND_WIDTH = 115;
const RIPPLE_SOUND = "./freesound_community-water-splash-1.mp3";
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const audioContext = AudioContextClass
  ? new AudioContextClass({ latencyHint: "interactive" })
  : null;
let audioBuffer = null;
let audioStartOffset = 0;
const nativeSoundPool = Array.from({ length: 4 }, () => {
  const audio = new Audio(RIPPLE_SOUND);
  audio.preload = "auto";
  audio.volume = 0.72;
  audio.setAttribute("playsinline", "");
  audio.load();
  return audio;
});
const audioReady = audioContext
  ? (async () => {
      const response = await fetch(RIPPLE_SOUND);
      const encodedAudio = await response.arrayBuffer();
      audioBuffer = await audioContext.decodeAudioData(encodedAudio);
      audioStartOffset = findAudioOnset(audioBuffer);
    })()
  : Promise.resolve();
let rippleBlob = null;
const rippleReady = fetch("./water-ripple.webp")
  .then((response) => response.blob())
  .then((blob) => {
    rippleBlob = blob;
  });

// All values use the original artwork's 1920 × 3840 coordinate system.
// Keeping the scene data separate makes it straightforward to animate an
// individual lotus leaf or insert the water-ripple sequence later.
const scene = [
  { src: "Lotus Leaf 2.png", name: "顶部大荷叶", x: 305, y: 735, width: 303 },
  { src: "Lotus Leaf 2-1.png", name: "顶部小荷叶", x: 375, y: 1100, width: 161 },

  { src: "small flower.png", name: "左侧小花", x: 256, y: 2467, width: 57 },
  { src: "3 lotus leaves.png", name: "三片小荷叶", x: 184, y: 2606, width: 154 },
  { src: "Lotus leaf  small flower.png", name: "左下荷叶与花", x: 172, y: 2762, width: 192 },

  { src: "Lotus Leaf 1-2.png", name: "右侧小荷叶", x: 1319, y: 2385, width: 170 },
  { src: "Lotus Leaf 1.png", name: "右侧大荷叶", x: 1314, y: 2542, width: 332 },
];

const driftingLeaves = [
  [201, 713], [428, 1034], [499, 1183], [735, 1398],
  [1440, 1485], [659, 2137], [1306, 2245], [175, 2273],
  [267, 2703], [1374, 2746], [1616, 2857], [1617, 2901],
  [1269, 2994], [385, 3320], [1116, 3481],
];

for (const [x, y] of driftingLeaves) {
  scene.push({ src: "leaf.png", name: "漂浮叶片", x, y, width: 40 });
}

const bodies = [];

const imageLoads = scene.map((layer, index) => new Promise((resolve) => {
  const image = document.createElement("img");
  image.className = "scene-element";
  image.src = `./${layer.src}`;
  image.alt = layer.name;
  image.dataset.element = layer.name;
  image.dataset.source = layer.src;
  image.dataset.index = String(index);
  image.style.setProperty("--x", layer.x);
  image.style.setProperty("--y", layer.y);
  image.style.setProperty("--width", layer.width);
  image.draggable = false;
  const body = {
    element: image,
    x: layer.x + layer.width / 2,
    y: layer.y,
    vx: 0,
    vy: 0,
    dx: 0,
    dy: 0,
    angle: 0,
    angularVelocity: 0,
    buoyancy: 0,
    waveInfluence: 0,
    // Large leaves have more inertia than loose petals.
    inverseMass: Math.min(1.25, 54 / layer.width),
  };

  image.addEventListener("load", () => {
    const renderedHeight = image.naturalHeight * layer.width / image.naturalWidth;
    body.y = layer.y + renderedHeight / 2;
    resolve();
  }, { once: true });
  image.addEventListener("error", resolve, { once: true });
  elementsLayer.append(image);
  bodies.push(body);
}));

Promise.all([Promise.all(imageLoads), audioReady, rippleReady]).then(() => {
  document.body.classList.add("is-ready");
}).catch(() => {
  // The visual scene remains usable if a browser blocks optional preloading.
  document.body.classList.add("is-ready");
});

const ripples = [];
let rippleId = 0;
const rippleSession = Date.now().toString(36);

function createRipple(x, y) {
  const image = document.createElement("img");
  const objectUrl = rippleBlob ? URL.createObjectURL(rippleBlob) : null;
  image.className = "water-ripple";
  image.alt = "";
  // Every object URL has an independent animation clock but reuses the WebP
  // already held in memory, avoiding a new network request on each click.
  image.src = objectUrl ||
    `./water-ripple.webp?play=${rippleSession}-${rippleId += 1}`;
  image.style.left = `${x / ARTBOARD_WIDTH * 100}%`;
  image.style.top = `${y / ARTBOARD_HEIGHT * 100}%`;
  rippleLayer.append(image);

  ripples.push({
    x,
    y,
    image,
    objectUrl,
    startedAt: performance.now(),
  });
}

stage.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 && event.pointerType === "mouse") return;

  playRippleSound();

  const bounds = stage.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width * ARTBOARD_WIDTH;
  const y = (event.clientY - bounds.top) / bounds.height * ARTBOARD_HEIGHT;
  createRipple(x, y);
});

function playRippleSound() {
  if (audioContext && audioBuffer) {
    if (audioContext.state === "suspended") {
      // iOS Safari and embedded mobile browsers can defer AudioContext resume.
      // Native audio is started synchronously inside this pointer gesture so
      // the first tap is still audible, while Web Audio unlocks for later taps.
      playNativeRippleSound();
      audioContext.resume().catch(() => {});
      return;
    }

    startDecodedRippleSound();
    return;
  }

  playNativeRippleSound();
}

function startDecodedRippleSound() {
  const player = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;
  const audibleDuration = audioBuffer.duration - audioStartOffset;
  const fadeOutStart = now + Math.max(0.02, audibleDuration - 0.045);

  player.buffer = audioBuffer;
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(0.72, now + 0.004);
  gain.gain.setValueAtTime(0.72, fadeOutStart);
  gain.gain.exponentialRampToValueAtTime(0.001, now + audibleDuration);
  player.connect(gain).connect(audioContext.destination);
  player.start(now, audioStartOffset);
}

function playNativeRippleSound() {
  let audio = nativeSoundPool.find((item) => item.paused || item.ended);
  if (!audio) {
    audio = new Audio(RIPPLE_SOUND);
    audio.preload = "auto";
    audio.volume = 0.72;
    audio.setAttribute("playsinline", "");
    nativeSoundPool.push(audio);
  }

  try {
    audio.currentTime = audioStartOffset;
  } catch {
    audio.currentTime = 0;
  }
  audio.play().catch(() => {
    // The page remains interactive if the device is muted or its host app
    // explicitly forbids media playback.
  });
}

function findAudioOnset(buffer) {
  const blockSize = 128;
  let peak = 0;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < samples.length; i += 1) {
      peak = Math.max(peak, Math.abs(samples[i]));
    }
  }

  // Relative threshold adapts to each recording; the absolute floor prevents
  // encoder noise in an otherwise silent MP3 lead-in from counting as sound.
  const threshold = Math.max(0.0025, peak * 0.015);
  let onsetSample = 0;

  search:
  for (let start = 0; start < buffer.length; start += blockSize) {
    const end = Math.min(start + blockSize, buffer.length);
    let energy = 0;

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let i = start; i < end; i += 1) {
        energy = Math.max(energy, Math.abs(samples[i]));
      }
    }

    if (energy >= threshold) {
      onsetSample = start;
      break search;
    }
  }

  // Retain 3 ms before the detected transient to avoid clipping its attack.
  return Math.max(0, onsetSample / buffer.sampleRate - 0.003);
}

let previousTime = performance.now();

function animate(time) {
  const dt = Math.min((time - previousTime) / 1000, 0.034);
  previousTime = time;

  for (const body of bodies) {
    body.waveInfluence = 0;
  }

  for (let i = ripples.length - 1; i >= 0; i -= 1) {
    const ripple = ripples[i];
    const age = (time - ripple.startedAt) / 1000;

    if (age >= RIPPLE_DURATION) {
      ripple.image.remove();
      if (ripple.objectUrl) URL.revokeObjectURL(ripple.objectUrl);
      ripples.splice(i, 1);
      continue;
    }

    const progress = age / RIPPLE_DURATION;
    const waveRadius = RIPPLE_RADIUS * (1 - Math.pow(1 - progress, 1.12));

    for (const body of bodies) {
      const offsetX = body.x + body.dx - ripple.x;
      const offsetY = body.y + body.dy - ripple.y;
      const distance = Math.hypot(offsetX, offsetY);
      const distanceFromCrest = distance - waveRadius;

      if (Math.abs(distanceFromCrest) < WAVE_BAND_WIDTH && distance > 1) {
        const directionX = offsetX / distance;
        const directionY = offsetY / distance;
        const falloff = Math.max(0.3, 1 - distance / RIPPLE_RADIUS);
        const massResponse = Math.sqrt(body.inverseMass);
        const phase = (distanceFromCrest + WAVE_BAND_WIDTH) /
          (WAVE_BAND_WIDTH * 2);
        const envelope = Math.sin(phase * Math.PI) ** 2;
        const force = (230 + 170 * falloff) * massResponse * envelope;

        // The broad sine envelope ramps the force in and out over many frames.
        body.vx += directionX * force * dt;
        body.vy += directionY * force * dt;

        const sideForce = indexNoise(body.x, body.y) * force * 0.16;
        body.vx += -directionY * sideForce * dt;
        body.vy += directionX * sideForce * dt;
        body.angularVelocity +=
          indexNoise(body.y, body.x) * 42 * massResponse * envelope * dt;
        body.waveInfluence = Math.max(body.waveInfluence, envelope);
      }
    }
  }

  const scale = stage.clientWidth / ARTBOARD_WIDTH;

  for (const body of bodies) {
    // Water resistance slows the element without pulling it back home.
    // Its accumulated position and rotation become the new resting state.
    const linearDamping = Math.exp(-1.45 * dt);
    const angularDamping = Math.exp(-1.65 * dt);
    body.vx *= linearDamping;
    body.vy *= linearDamping;
    body.angularVelocity *= angularDamping;

    body.dx += body.vx * dt;
    body.dy += body.vy * dt;
    body.angle += body.angularVelocity * dt;
    const buoyancyEase = 1 - Math.exp(-7 * dt);
    body.buoyancy += (body.waveInfluence - body.buoyancy) * buoyancyEase;

    if (Math.abs(body.vx) < 0.02) body.vx = 0;
    if (Math.abs(body.vy) < 0.02) body.vy = 0;
    if (Math.abs(body.angularVelocity) < 0.01) body.angularVelocity = 0;

    body.element.style.transform =
      `translate(${body.dx * scale}px, ${body.dy * scale}px) ` +
      `rotate(${body.angle}deg) scale(${1 + body.buoyancy * 0.025})`;
  }

  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);

function indexNoise(a, b) {
  const value = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}
