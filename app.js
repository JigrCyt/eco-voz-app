// ---------------------------------------------------------------
// Guion de la sesión
// ---------------------------------------------------------------
const wakeBlocks = [
  { note: 'Di "Eco" con volumen y tono normales, como si llamaras a alguien que está cerca.', n: 5 },
  { note: 'Di "Eco" un poco más alto, como si llamaras desde el otro lado de la habitación.', n: 5 },
  { note: 'Di "Eco" en voz baja, casi susurrando.', n: 5 },
  { note: 'Di "Eco" con una entonación distinta cada vez: como pregunta, como orden seca, rápido, alargado…', n: 5 },
];

const commands = [
  "Eco, congelar imagen", "Eco, descongelar imagen", "Eco, tomar fotografía",
  "Eco, iniciar grabación", "Eco, detener vídeo", "Eco, activar Doppler color",
  "Eco, apagar Doppler", "Eco, activar Doppler pulsado", "Eco, modo B", "Eco, modo M",
  "Eco, activar pantalla dividida", "Eco, alternar en pantalla dividida",
  "Eco, aumentar profundidad", "Eco, disminuir profundidad", "Eco, profundidad máxima",
  "Eco, subir ganancia", "Eco, bajar ganancia", "Eco, ganancia automática",
  "Eco, subir foco", "Eco, bajar foco",
];

const variants = [
  "Eco, frisa la imagen", "Eco, foto", "Eco, grabar",
  "Eco, más ganancia", "Eco, menos profundidad", "Eco, modo be",
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
      phase: "Palabra de activación", label: "Di la palabra", phrase: "Eco",
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
  renderStep();
});

el('nextBtn').addEventListener('click', async () => {
  if (current < steps.length - 1) {
    current++;
    renderStep();
  } else {
    clearInterval(clockInterval);
    el('nextBtn').disabled = true;
    el('nextBtn').textContent = 'Enviando…';
    await stopRecording();
    el('clock').hidden = true;
    showScreen('outro');
    submitRecording();
  }
});

el('prevBtn').addEventListener('click', () => {
  if (current > 0) {
    current--;
    renderStep();
  }
});

function updateClock() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const sec = String(elapsed % 60).padStart(2, '0');
  el('clockText').textContent = `${m}:${sec}`;
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
  const blob = new Blob(recordedChunks, { type: recordingMimeType || 'audio/webm' });
  const filename = `eco_voz_${Date.now()}.${ext}`;
  const file = new File([blob], filename, { type: blob.type });

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
setupWave(el('stepWave'), 22);
