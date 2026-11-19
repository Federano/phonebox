// Federano extension, encoder worker: crops a video frame, scales it and encodes it as JPEG. It runs in a worker because
// Chrome delays this work by about a second in the extension's background (offscreen) page; a worker is not held back.
let canvas = null, ctx = null;

self.onmessage = async (e) => {
  const { id, frame, sx, sy, sw, sh, w, h, quality } = e.data;
  try {
    if (!canvas || canvas.width !== w || canvas.height !== h) { canvas = new OffscreenCanvas(w, h); ctx = canvas.getContext('2d', { alpha: false }); }
    ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, w, h);
    frame.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    const buf = await blob.arrayBuffer();
    self.postMessage({ id, buf }, [buf]);
  } catch (err) {
    try { frame.close(); } catch (_) {}
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
