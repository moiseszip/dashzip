import saleSound from '@/assets/sale-sound.mp3?url';

const SOUND_KEY = 'dashzip:sale-sound';
let context: AudioContext | undefined;
let soundBuffer: Promise<AudioBuffer> | undefined;
let armed = false;

export function enableSaleSound() {
  armed = true;
  try { localStorage.setItem(SOUND_KEY, '1'); } catch { /* storage is optional */ }
  resumeAudio();
}

export function disableSaleSound() {
  armed = false;
  try { localStorage.removeItem(SOUND_KEY); } catch { /* storage is optional */ }
}

function resumeAudio() {
  try {
    context ??= new AudioContext();
    if (context.state !== 'running') void context.resume().catch(() => undefined);
    void loadSoundBuffer(context).catch(() => undefined);
  } catch {
    // Web Audio is optional. The system push is delivered independently.
  }
}

export function listenForSaleSound() {
  if (!('serviceWorker' in navigator)) return;
  try { armed = localStorage.getItem(SOUND_KEY) === '1'; } catch { /* storage is optional */ }
  // iOS can suspend Web Audio while the app is in the background.
  window.addEventListener('pointerup', () => {
    if (armed && context?.state !== 'running') resumeAudio();
  }, { passive: true });
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'dashzip:sale-push') void playSaleSound();
  });
}

function loadSoundBuffer(audio: AudioContext) {
  soundBuffer ??= fetch(saleSound)
    .then((response) => {
      if (!response.ok) throw new Error('Sale sound unavailable');
      return response.arrayBuffer();
    })
    .then((bytes) => audio.decodeAudioData(bytes))
    .catch((error) => {
      soundBuffer = undefined;
      throw error;
    });
  return soundBuffer;
}

function canPlaySaleSound(audio: AudioContext | undefined): audio is AudioContext {
  return armed && document.visibilityState === 'visible' && audio?.state === 'running';
}

export async function playSaleSound() {
  const audio = context;
  if (!canPlaySaleSound(audio)) return;
  try {
    const buffer = await loadSoundBuffer(audio);
    if (!canPlaySaleSound(audio)) return;
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.destination);
    source.start();
  } catch {
    // The system push is delivered independently of in-app audio.
  }
}
