const content = document.getElementById('content');
const printBtn = document.getElementById('print-btn');
const scaleRange = document.getElementById('scale-range');
const scaleNumber = document.getElementById('scale-number');

const MIN_SCALE = 25;
const MAX_SCALE = 200;
const STEP = 5;
const SCALE_KEY = 'highlightPrint.scale';
let scale = 100;

document.getElementById('close-btn').addEventListener('click', () => window.close());
printBtn.addEventListener('click', () => window.print());

// ---------- print size ----------

// `zoom` (unlike `transform: scale`) reflows the content, so text re-wraps to the
// paper width and page breaks in the printout match what the preview shows.
function setScale(percent, { remember = true } = {}) {
  const p = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(Number(percent) || 100)));
  scale = p;
  content.style.zoom = String(p / 100);
  scaleRange.value = String(p);
  scaleNumber.value = String(p);
  if (remember) {
    try { localStorage.setItem(SCALE_KEY, String(p)); } catch {}
  }
  return p;
}

// Largest size (up to 100%) at which nothing sticks out past the paper's sides.
function fitWidth() {
  const previous = content.style.zoom;
  content.style.zoom = '1';
  const needed = content.scrollWidth;
  const available = content.clientWidth;
  content.style.zoom = previous;
  const fit = needed > available ? Math.floor((available / needed) * 100) : 100;
  setScale(Math.max(MIN_SCALE, fit));
}

scaleRange.addEventListener('input', () => setScale(scaleRange.value));
scaleNumber.addEventListener('change', () => setScale(scaleNumber.value));
document.getElementById('scale-down').addEventListener('click', () => setScale(scale - STEP));
document.getElementById('scale-up').addEventListener('click', () => setScale(scale + STEP));
document.getElementById('scale-fit').addEventListener('click', fitWidth);
document.getElementById('scale-reset').addEventListener('click', () => setScale(100));

// Ctrl/Cmd + / - / 0 resize the printout instead of zooming the whole tab.
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.key === '=' || e.key === '+') setScale(scale + STEP);
  else if (e.key === '-') setScale(scale - STEP);
  else if (e.key === '0') setScale(100);
  else return;
  e.preventDefault();
});

let savedScale = 100;
try { savedScale = Number(localStorage.getItem(SCALE_KEY)) || 100; } catch {}
setScale(savedScale, { remember: false });

function showError(message) {
  document.getElementById('source-title').textContent = 'Nothing to print';
  content.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = message;
  content.appendChild(p);
}

function waitForImages(timeoutMs) {
  const pending = [...content.querySelectorAll('img')]
    .filter((img) => !img.complete)
    .map((img) => new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    }));
  return Promise.race([
    Promise.all(pending),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

async function main() {
  const id = location.hash.slice(1);
  const job = id ? await chrome.runtime.sendMessage({ type: 'getJob', id }) : null;
  if (!job) {
    showError('This print job has expired. Go back to the page, highlight the content, and try again.');
    return;
  }

  document.title = job.title || 'Print selection';
  document.getElementById('source-title').textContent = job.title || 'Selection';
  document.getElementById('source-url').textContent = job.url;

  if (job.fontCss) {
    const style = document.createElement('style');
    style.textContent = job.fontCss;
    document.head.appendChild(style);
  }

  content.innerHTML = job.html;
  content.contentEditable = 'true';

  await Promise.all([waitForImages(10000), document.fonts.ready]);
  printBtn.disabled = false;
  // Wait for the user to pick a size; Print (or Ctrl+P) opens the system dialog.
  printBtn.focus();
}

main().catch((err) => showError(`Something went wrong: ${err.message}`));
