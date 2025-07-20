import { saveBlockedKeywords } from '../utils/storage.js';

document.getElementById('saveBtn').addEventListener('click', () => {
  const input = document.getElementById('keyword').value;
  const keywords = input.split(',').map(w => w.trim().toLowerCase());
  saveBlockedKeywords(keywords).then(() => {
    document.getElementById('status').innerText = "Saved!";
  });
});
