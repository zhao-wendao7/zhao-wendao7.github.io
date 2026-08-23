const state = { files: [], level: -42, duration: 0.8 };
const $ = (selector) => document.querySelector(selector);
const fileInput = $('#fileInput');
const fileList = $('#fileList');
const emptyState = $('#emptyState');
const processButton = $('#processAll');
const dropzone = $('#dropzone');
const toast = $('#toast');

$('#level').addEventListener('input', (event) => {
  state.level = Number(event.target.value);
  $('#levelValue').textContent = `${state.level} dB`;
});
$('#duration').addEventListener('input', (event) => {
  state.duration = Number(event.target.value);
  $('#durationValue').textContent = `${state.duration.toFixed(2)} 秒`;
});
fileInput.addEventListener('change', (event) => addFiles([...event.target.files]));
['dragenter', 'dragover'].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
  event.preventDefault(); dropzone.classList.add('is-dragging');
}));
['dragleave', 'drop'].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
  event.preventDefault(); dropzone.classList.remove('is-dragging');
}));
dropzone.addEventListener('drop', (event) => addFiles([...event.dataTransfer.files].filter((file) => file.type.startsWith('audio/') || /\.(wav|mp3|m4a|ogg|flac)$/i.test(file.name))));
processButton.addEventListener('click', processAll);

function addFiles(newFiles) {
  newFiles.forEach((file) => {
    if (!state.files.some((entry) => entry.file.name === file.name && entry.file.size === file.size)) {
      state.files.push({ file, status: '待处理', result: null });
    }
  });
  renderFiles();
  if (newFiles.length) showToast(`已添加 ${newFiles.length} 个文件`);
}
function renderFiles() {
  $('#fileCount').textContent = state.files.length;
  emptyState.style.display = state.files.length ? 'none' : 'flex';
  processButton.disabled = !state.files.length;
  fileList.innerHTML = state.files.map((entry, index) => {
    const extension = entry.file.name.split('.').pop().toUpperCase().slice(0, 4);
    const action = entry.result ? `<button class="download-button" title="下载处理后的音频" data-download="${index}">↓</button>` : '';
    return `<article class="file-item"><span class="file-type">${extension}</span><div class="file-meta"><div class="file-name" title="${escapeHtml(entry.file.name)}">${escapeHtml(entry.file.name)}</div><div class="file-status ${entry.status === '已完成' ? 'done' : entry.status === '处理失败' ? 'error' : ''}">${entry.status}${entry.removed ? ` · 已移除 ${formatTime(entry.removed)}` : ''}</div></div><div class="file-actions">${action}<button title="移除文件" data-remove="${index}">×</button></div></article>`;
  }).join('');
  fileList.querySelectorAll('[data-remove]').forEach((button) => button.addEventListener('click', () => { state.files.splice(Number(button.dataset.remove), 1); renderFiles(); }));
  fileList.querySelectorAll('[data-download]').forEach((button) => button.addEventListener('click', () => downloadResult(state.files[Number(button.dataset.download)])));
}
async function processAll() {
  processButton.disabled = true;
  processButton.querySelector('span').textContent = '正在处理...';
  for (const entry of state.files) {
    if (entry.result) continue;
    entry.status = '分析中'; renderFiles();
    try {
      const audioBuffer = await decodeAudio(entry.file);
      const analysis = findSilentRanges(audioBuffer, state.level, state.duration);
      entry.result = encodeWav(removeRanges(audioBuffer, analysis.ranges));
      entry.removed = analysis.removed;
      entry.status = '已完成';
    } catch (error) { console.error(error); entry.status = '处理失败'; }
    renderFiles();
  }
  processButton.querySelector('span').textContent = '处理全部音频';
  processButton.disabled = false;
  if (state.files.every((entry) => entry.result)) showToast('全部音频处理完成');
}
function decodeAudio(file) {
  return file.arrayBuffer().then((data) => new (window.AudioContext || window.webkitAudioContext)().decodeAudioData(data));
}
function findSilentRanges(buffer, thresholdDb, minDuration) {
  const samples = buffer.getChannelData(0);
  const windowSize = Math.max(128, Math.floor(buffer.sampleRate * 0.01));
  const ranges = []; let silentStart = -1; let removed = 0;
  for (let offset = 0; offset < samples.length; offset += windowSize) {
    let sum = 0; const end = Math.min(offset + windowSize, samples.length);
    for (let index = offset; index < end; index++) sum += samples[index] ** 2;
    const db = 20 * Math.log10(Math.sqrt(sum / (end - offset)) || 0.00001);
    if (db < thresholdDb && silentStart < 0) silentStart = offset;
    if ((db >= thresholdDb || end === samples.length) && silentStart >= 0) {
      const silentEnd = db >= thresholdDb ? offset : end;
      if ((silentEnd - silentStart) / buffer.sampleRate >= minDuration) {
        const padding = Math.floor(buffer.sampleRate * 0.02);
        const range = [Math.max(0, silentStart + padding), Math.min(samples.length, silentEnd - padding)];
        if (range[1] > range[0]) { ranges.push(range); removed += (range[1] - range[0]) / buffer.sampleRate; }
      }
      silentStart = -1;
    }
  }
  return { ranges, removed };
}
function removeRanges(buffer, ranges) {
  const kept = []; let cursor = 0;
  ranges.forEach(([start, end]) => { kept.push([cursor, start]); cursor = end; });
  kept.push([cursor, buffer.length]);
  const totalLength = kept.reduce((sum, [start, end]) => sum + end - start, 0);
  const output = new (window.AudioContext || window.webkitAudioContext)().createBuffer(buffer.numberOfChannels, totalLength, buffer.sampleRate);
  let writeAt = 0;
  kept.forEach(([start, end]) => { for (let channel = 0; channel < buffer.numberOfChannels; channel++) output.getChannelData(channel).set(buffer.getChannelData(channel).subarray(start, end), writeAt); writeAt += end - start; });
  return output;
}
function encodeWav(buffer) {
  const channels = buffer.numberOfChannels; const sampleRate = buffer.sampleRate; const bytesPerSample = 2; const dataLength = buffer.length * channels * bytesPerSample;
  const view = new DataView(new ArrayBuffer(44 + dataLength));
  writeString(view, 0, 'RIFF'); view.setUint32(4, 36 + dataLength, true); writeString(view, 8, 'WAVE'); writeString(view, 12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * bytesPerSample, true); view.setUint16(32, channels * bytesPerSample, true); view.setUint16(34, 16, true); writeString(view, 36, 'data'); view.setUint32(40, dataLength, true);
  let offset = 44; for (let index = 0; index < buffer.length; index++) for (let channel = 0; channel < channels; channel++) { const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[index])); view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true); offset += 2; }
  return new Blob([view], { type: 'audio/wav' });
}
function writeString(view, offset, text) { for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index)); }
function downloadResult(entry) { const url = URL.createObjectURL(entry.result); const link = document.createElement('a'); link.href = url; link.download = `${entry.file.name.replace(/\.[^.]+$/, '')}_trimmed.wav`; link.click(); URL.revokeObjectURL(url); }
function formatTime(seconds) { return seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(2)} s`; }
function escapeHtml(value) { return value.replace(/[&<>"']/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[character])); }
let toastTimer;
function showToast(message) { toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2400); }
