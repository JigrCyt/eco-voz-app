// ---------------------------------------------------------------
// Guion de la sesión
// ---------------------------------------------------------------
const wakeBlocks = [
  { note: 'Di "Econira" con volumen y tono normales, como si llamaras a alguien que está cerca.', n: 5 },
  { note: 'Di "Econira" un poco más alto, como si llamaras desde el otro lado de la habitación.', n: 5 },
  { note: 'Di "Econira" en voz baja, casi susurrando.', n: 5 },
  { note: 'Di "Econira" con una entonación distinta cada vez: como pregunta, como orden seca, rápido, alargado…', n: 5 },
];

const commands = [
  "Econira, congelar imagen", "Econira, descongelar imagen", "Econira, tomar fotografía",
  "Econira, iniciar grabación", "Econira, detener vídeo", "Econira, activar Doppler color",
  "Econira, apagar Doppler", "Econira, activar Doppler pulsado", "Econira, modo B", "Econira, modo M",
  "Econira, activar pantalla dividida", "Econira, alternar en pantalla dividida",
  "Econira, aumentar profundidad", "Econira, disminuir profundidad", "Econira, profundidad máxima",
  "Econira, subir ganancia", "Econira, bajar ganancia", "Econira, ganancia automática",
  "Econira, subir foco", "Econira, bajar foco",
];

const variants = [
  "Econira, frisa la imagen", "Econira, foto", "Econira, grabar",
  "Econira, más ganancia", "Econira, menos profundidad", "Econira, modo be",
];

const negatives = [
  "Vamos a hacer una ecografía abdominal.",
  "El ecógrafo lleva encendido toda la mañana.",
  "Se oye un eco raro en esta sala.",
  "El sonido rebota en la pared y produce eco.",
  "Es un efecto eco muy característico del ultrasonido.",
  "Compramos un ecógrafo nuevo el mes pasado.",
  "Este centro es muy ecológico, todo funciona con paneles solares.",
  "¿Puedes repetir? No se ha oído bien, había mucho eco.",
];

const freeform = "Hoy ha sido un día bastante tranquilo. Por la mañana estuve organizando algunas tareas pendientes y después salí a dar un paseo corto antes de comer. El tiempo estaba nublado pero no hacía frío, así que fue agradable caminar un rato. Por la tarde aproveché para leer un poco y preparar las cosas para mañana. Nada especial, pero ha sido un día productivo y llevadero.";

const steps = [];

steps.push({
  phase: "Silencio", label: "Escucha ambiente", phrase: "Silencio",
  hint: "No hables durante unos 15 segundos. Deja el móvil donde vas a grabar el resto de la sesión — nos ayuda a capturar el ruido de fondo típico de tu casa.",
  note: "Este tramo nos sirve para saber cómo suena tu entorno cuando nadie habla.",
});

wakeBlocks.forEach((block) => {
  for (let i = 0; i < block.n; i++) {
    steps.push({
      phase: "Palabra de activación", label: "Di la palabra", phrase: "Econira",
      hint: "", note: block.note,
    });
  }
});

commands.forEach((phrase) => {
  steps.push({
    phase: "Comandos", label: "Di el comando completo", phrase,
    hint: "", note: "Di la palabra de activación seguida del comando, como lo harías delante del ecógrafo.",
  });
});

variants.forEach((phrase) => {
  steps.push({
    phase: "Formas coloquiales", label: "Forma alternativa del comando", phrase,
    hint: "", note: "Estas son variantes más cortas o coloquiales que la gente usa en la práctica.",
  });
});

negatives.forEach((phrase) => {
  steps.push({
    phase: "Frases sin activación", label: "Léela con naturalidad — no es un comando", phrase,
    hint: "", note: "Contienen la palabra «eco» pero no como orden — nos ayudan a que el sistema no se active por error.",
    negative: true,
  });
});

steps.push({
  phase: "Habla libre", label: "Lee el párrafo entero, sin pausas largas", phrase: freeform,
  hint: "", note: "Un poco de habla natural, sin ningún comando, para completar la muestra.",
  negative: true, long: true,
});

// ---------------------------------------------------------------
// Motor de grabación
// ---------------------------------------------------------------
let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordingMimeType = '';

function pickMimeType() {
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

async function beginRecording() {
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  recordingMimeType = pickMimeType();
  mediaRecorder = new MediaRecorder(mediaStream, recordingMimeType ? { mimeType: recordingMimeType } : undefined);
  recordedChunks = [];
  mediaRecorder.addEventListener('dataavailable', (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  });
  mediaRecorder.start(1000);
}

function stopRecording() {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') { resolve(); return; }
    mediaRecorder.addEventListener('stop', () => {
      mediaStream.getTracks().forEach((t) => t.stop());
      resolve();
    }, { once: true });
    mediaRecorder.stop();
  });
}

function micErrorMessage(err) {
  if (err && err.name === 'NotAllowedError') {
    return 'Has bloqueado el acceso al micrófono. Revisa los permisos de este sitio en el navegador (icono de candado junto a la dirección) y vuelve a intentarlo.';
  }
  if (err && err.name === 'NotFoundError') {
    return 'No se ha encontrado ningún micrófono en este dispositivo.';
  }
  return 'No se ha podido acceder al micrófono. Comprueba los permisos del navegador e inténtalo de nuevo.';
}

window.addEventListener('beforeunload', (e) => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------------------------------------------------------------
// Detección de voz (mismo esquema que eco_siri/audio_levels.py:
// umbral adaptado al ruido ambiente + histéresis de activación/liberación)
// ---------------------------------------------------------------
const VAD_MIN_THRESHOLD = 0.012;
const VAD_MAX_THRESHOLD = 0.22;
const VAD_NOISE_MULTIPLIER = 4.0;
const VAD_RELEASE_RATIO = 0.8;

let audioCtx = null;
let analyser = null;
let levelBuffer = null;
let levelRAF = null;
let levelHistory = [];
const LEVEL_HISTORY_LEN = 26;

let noiseFloor = 0.02;
let speechThreshold = 0.08;
let hysteresisActive = false;
let speechSegStartMs = null;
let silenceSamples = [];

function setupLevelMeter() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(mediaStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  levelBuffer = new Float32Array(analyser.fftSize);
  loopLevel();
}

function stopLevelMeter() {
  if (levelRAF) cancelAnimationFrame(levelRAF);
  levelRAF = null;
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
}

function computeRms() {
  analyser.getFloatTimeDomainData(levelBuffer);
  let sum = 0;
  for (let i = 0; i < levelBuffer.length; i++) sum += levelBuffer[i] * levelBuffer[i];
  return Math.sqrt(sum / levelBuffer.length);
}

function loopLevel() {
  const level = computeRms();
  handleLevelSample(level);
  updateLevelVisual(level);
  levelRAF = requestAnimationFrame(loopLevel);
}

function handleLevelSample(level) {
  if (current === 0) {
    silenceSamples.push(level);
    return;
  }
  const elapsedMs = Date.now() - startTime;
  if (!hysteresisActive) {
    if (level >= speechThreshold) {
      hysteresisActive = true;
      speechSegStartMs = elapsedMs;
    }
  } else if (level < speechThreshold * VAD_RELEASE_RATIO) {
    hysteresisActive = false;
    currentStepSpeechSegments.push([speechSegStartMs, elapsedMs]);
    speechSegStartMs = null;
  }
}

function finalizeNoiseFloor() {
  if (silenceSamples.length) {
    const sorted = silenceSamples.slice().sort((a, b) => a - b);
    noiseFloor = sorted[Math.floor(sorted.length * 0.2)] || 0.005;
  }
  speechThreshold = Math.min(Math.max(VAD_MIN_THRESHOLD, noiseFloor * VAD_NOISE_MULTIPLIER), VAD_MAX_THRESHOLD);
}

function updateLevelVisual(level) {
  levelHistory.push(level);
  if (levelHistory.length > LEVEL_HISTORY_LEN) levelHistory.shift();
  drawLevelMeter();
  const tag = el('levelTag');
  if (tag) {
    if (current === 0) {
      tag.textContent = 'Calibrando nivel de ruido…';
      tag.classList.remove('speaking');
    } else {
      tag.textContent = hysteresisActive ? 'Te estamos oyendo' : 'En silencio';
      tag.classList.toggle('speaking', hysteresisActive);
    }
  }
}

function drawLevelMeter() {
  const canvas = el('stepWave');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (canvas.width !== Math.round(rect.width * dpr)) {
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);
  const gap = 4;
  const bw = (w - gap * (LEVEL_HISTORY_LEN - 1)) / LEVEL_HISTORY_LEN;
  const activeColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const idleColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim();
  for (let i = 0; i < LEVEL_HISTORY_LEN; i++) {
    const lvl = levelHistory[i] || 0;
    const norm = Math.min(1, lvl / 0.25);
    const bh = Math.max(3, norm * h);
    ctx.fillStyle = hysteresisActive ? activeColor : idleColor;
    const x = i * (bw + gap);
    const y = (h - bh) / 2;
    ctx.fillRect(x, y, bw, bh);
  }
}

// ---------------------------------------------------------------
// Línea de tiempo por paso (para el archivo de marcas)
// ---------------------------------------------------------------
let stepTimeline = [];
let currentStepEntryMs = 0;
let currentStepRetries = 0;
let currentStepSpeechSegments = [];

const CALIBRATION_MS = 15000;
let calibrationTimeout = null;

function openStepTimeline() {
  currentStepEntryMs = Date.now() - startTime;
  currentStepRetries = 0;
  currentStepSpeechSegments = [];
  hysteresisActive = false;
  speechSegStartMs = null;

  clearTimeout(calibrationTimeout);
  calibrationTimeout = null;
  if (current === 0) {
    calibrationTimeout = setTimeout(() => {
      if (current === 0) goToNextStep();
    }, CALIBRATION_MS);
  }
}

function closeCurrentStepTimeline() {
  const s = steps[current];
  const nowMs = Date.now() - startTime;
  if (hysteresisActive && speechSegStartMs !== null) {
    currentStepSpeechSegments.push([speechSegStartMs, nowMs]);
    hysteresisActive = false;
    speechSegStartMs = null;
  }
  stepTimeline.push({
    index: current,
    phase: s.phase,
    phrase: s.phrase,
    negative: !!s.negative,
    t_start_ms: currentStepEntryMs,
    t_end_ms: nowMs,
    retries: currentStepRetries,
    speech_segments_ms: currentStepSpeechSegments,
    flagged_no_speech: current !== 0 && currentStepSpeechSegments.length === 0,
  });
}

// ---------------------------------------------------------------
// Estado y navegación
// ---------------------------------------------------------------
let current = 0;
let startTime = null;
let clockInterval = null;

const el = (id) => document.getElementById(id);
const screens = {
  intro: el('screen-intro'), session: el('screen-session'), outro: el('screen-outro'),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove('active'));
  screens[name].classList.add('active');
}

function renderStep() {
  const s = steps[current];
  el('phaseTag').textContent = s.phase;
  el('stepCount').textContent = `${current + 1} / ${steps.length}`;
  el('phaseNote').textContent = s.note || '';
  el('promptLabel').textContent = s.label;
  el('promptPhrase').textContent = s.phrase;
  el('promptPhrase').style.fontSize = s.long ? '18px' : (s.phrase.length > 24 ? '24px' : '30px');
  el('promptPhrase').style.textAlign = s.long ? 'left' : 'center';
  el('promptPhrase').style.lineHeight = s.long ? '1.5' : '1.2';
  el('promptHint').textContent = s.hint || '';
  el('promptCard').classList.toggle('is-negative', !!s.negative);
  el('prevBtn').disabled = current === 0;
  el('nextBtn').textContent = current === steps.length - 1 ? 'Terminar sesión →' : 'Ya lo he dicho →';
  el('progressFill').style.width = `${((current + 1) / steps.length) * 100}%`;

  const isCalibration = current === 0;
  el('stepControls').hidden = isCalibration;
  el('retryStepBtn').hidden = isCalibration;
  el('calibCountdown').hidden = !isCalibration;
  if (isCalibration) {
    el('calibCountdown').textContent = `Detectando ruido de fondo… continúa automáticamente en ${CALIBRATION_MS / 1000} s`;
  }
}

el('startBtn').addEventListener('click', async () => {
  const errBox = el('startError');
  errBox.hidden = true;

  if (!el('consent').checked) {
    errBox.textContent = 'Tienes que marcar la casilla de consentimiento para continuar.';
    errBox.hidden = false;
    return;
  }
  if (!el('ageRange').value || !el('gender').value || !el('region').value.trim()) {
    errBox.textContent = 'Completa el rango de edad, género y región antes de continuar.';
    errBox.hidden = false;
    return;
  }
  if (!APPS_SCRIPT_URL) {
    errBox.textContent = 'Esta sesión todavía no está conectada a un servidor de recogida. Avisa a quien te compartió el enlace.';
    errBox.hidden = false;
    return;
  }

  el('startBtn').disabled = true;
  el('startBtn').textContent = 'Pidiendo acceso al micrófono…';
  try {
    await beginRecording();
  } catch (err) {
    errBox.textContent = micErrorMessage(err);
    errBox.hidden = false;
    el('startBtn').disabled = false;
    el('startBtn').textContent = 'Empezar — dar acceso al micrófono';
    return;
  }

  showScreen('session');
  el('clock').hidden = false;
  el('progressTrack').hidden = false;
  startTime = Date.now();
  clockInterval = setInterval(updateClock, 1000);
  setupLevelMeter();
  openStepTimeline();
  renderStep();
});

async function goToNextStep() {
  clearTimeout(calibrationTimeout);
  closeCurrentStepTimeline();
  if (current === 0) finalizeNoiseFloor();

  if (current < steps.length - 1) {
    current++;
    openStepTimeline();
    renderStep();
  } else {
    clearInterval(clockInterval);
    el('nextBtn').disabled = true;
    el('nextBtn').textContent = 'Enviando…';
    el('retryStepBtn').hidden = true;
    await stopRecording();
    stopLevelMeter();
    el('clock').hidden = true;
    showScreen('outro');
    submitRecording();
  }
}

el('nextBtn').addEventListener('click', goToNextStep);

el('retryStepBtn').addEventListener('click', () => {
  currentStepRetries++;
  const btn = el('retryStepBtn');
  btn.textContent = `Marcado (${currentStepRetries}) — repite la frase`;
  clearTimeout(btn._resetTimeout);
  btn._resetTimeout = setTimeout(() => {
    btn.textContent = 'No me ha salido bien — marcar y repetir';
  }, 1800);
});

el('prevBtn').addEventListener('click', () => {
  if (current > 0) {
    current--;
    openStepTimeline();
    renderStep();
  }
});

function updateClock() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const sec = String(elapsed % 60).padStart(2, '0');
  el('clockText').textContent = `${m}:${sec}`;

  if (current === 0) {
    const remaining = Math.max(0, Math.ceil((CALIBRATION_MS - (Date.now() - startTime)) / 1000));
    el('calibCountdown').textContent = `Detectando ruido de fondo… continúa automáticamente en ${remaining} s`;
  }
}

el('statSteps').textContent = steps.length;

// ---------------------------------------------------------------
// Envío al backend (formulario oculto -> Apps Script, sin CORS)
// ---------------------------------------------------------------
let submitTimeout = null;

function deviceInfoString() {
  return [
    navigator.userAgent,
    `${screen.width}x${screen.height}`,
    navigator.language,
  ].join(' | ');
}

function buildTimestampsPayload(baseName) {
  return JSON.stringify({
    base_filename: baseName,
    session_start_iso: new Date(startTime).toISOString(),
    noise_floor_rms: noiseFloor,
    speech_threshold_rms: speechThreshold,
    hysteresis_release_ratio: VAD_RELEASE_RATIO,
    steps: stepTimeline,
  });
}

function submitRecording() {
  const note = el('sendNote');
  note.className = 'note-box';
  note.textContent = 'Enviando…';
  el('retryBtn').hidden = true;

  if (!recordedChunks.length) {
    note.className = 'note-box error';
    note.textContent = 'No hay audio grabado en esta sesión. Recarga la página y vuelve a intentarlo.';
    return;
  }

  el('uploadForm').action = APPS_SCRIPT_URL;
  el('f_consent').value = 'si';
  el('f_contactEmail').value = el('contactEmail').value.trim();
  el('f_ageRange').value = el('ageRange').value;
  el('f_gender').value = el('gender').value;
  el('f_region').value = el('region').value.trim();
  el('f_deviceInfo').value = deviceInfoString();

  const isMp4 = recordingMimeType.startsWith('audio/mp4');
  const ext = isMp4 ? 'mp4' : 'webm';
  const baseName = `eco_voz_${Date.now()}`;
  const blob = new Blob(recordedChunks, { type: recordingMimeType || 'audio/webm' });
  const file = new File([blob], `${baseName}.${ext}`, { type: blob.type });

  el('f_timestamps').value = buildTimestampsPayload(baseName);

  const dt = new DataTransfer();
  dt.items.add(file);
  el('f_audio').files = dt.files;

  el('uploadForm').submit();

  clearTimeout(submitTimeout);
  submitTimeout = setTimeout(() => {
    note.className = 'note-box error';
    note.textContent = 'No hemos recibido confirmación del servidor. Puede que ya se haya enviado igualmente — si no, pulsa reintentar.';
    el('retryBtn').hidden = false;
  }, 15000);
}

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.source !== 'eco-app') return;
  clearTimeout(submitTimeout);
  const note = el('sendNote');
  if (data.status === 'ok') {
    note.className = 'note-box ok';
    note.textContent = data.message || 'Grabación recibida. ¡Gracias!';
    el('outroTitle').textContent = 'Gracias por tu ayuda';
    el('outroLede').textContent = 'Tu grabación se ha enviado correctamente. Ya puedes cerrar esta pestaña.';
    el('retryBtn').hidden = true;
  } else {
    note.className = 'note-box error';
    note.textContent = data.message || 'Ha habido un error al enviar la grabación.';
    el('retryBtn').hidden = false;
  }
});

el('retryBtn').addEventListener('click', submitRecording);

// ---------------------------------------------------------------
// Waveform decorativo (idle), respeta prefers-reduced-motion
// ---------------------------------------------------------------
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function setupWave(canvas, barCount) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  const bars = Array.from({ length: barCount }, () => Math.random());
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();

  function draw(t) {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    ctx.clearRect(0, 0, w, h);
    const gap = 4;
    const bw = (w - gap * (barCount - 1)) / barCount;
    for (let i = 0; i < barCount; i++) {
      const phase = reduceMotion ? bars[i] : (Math.sin(t / 900 + i * 0.6) + 1) / 2 * 0.7 + bars[i] * 0.3;
      const bh = Math.max(3, phase * h);
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.35 + phase * 0.5;
      const x = i * (bw + gap);
      const y = (h - bh) / 2;
      ctx.fillRect(x, y, bw, bh);
    }
    ctx.globalAlpha = 1;
  }

  if (reduceMotion) { draw(0); return; }
  function loop(t) { draw(t); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
}

setupWave(el('heroWave'), 28);
