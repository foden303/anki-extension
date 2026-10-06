const status = document.querySelector('#status');
async function refresh() {
  status.className = 'status'; status.textContent = 'Checking AnkiConnect…';
  const response = await chrome.runtime.sendMessage({ type: 'status' });
  if (response?.ok) { status.classList.add('ok'); status.textContent = `AnkiConnect ready · ${response.deckCount} decks available`; }
  else { status.classList.add('error'); status.textContent = response?.error || 'AnkiConnect is unavailable.'; }
}
document.querySelector('#settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.querySelector('#retry').addEventListener('click', refresh);
refresh();
