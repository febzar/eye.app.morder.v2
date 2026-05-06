/**
 * Screen Capture Module
 * Uses screenshot-desktop to capture the primary display and return JPEG buffer
 */
const screenshot = require('screenshot-desktop');
const Jimp = require('jimp');

const CAPTURE_QUALITY = 60; // JPEG quality (0-100), lower = faster/smaller
const CAPTURE_SCALE = 0.75;  // Scale factor to reduce bandwidth

let screenshotAvailable = true;

/**
 * Capture the screen and return a compressed JPEG Buffer
 * @returns {Promise<Buffer>}
 */
async function captureScreen() {
  try {
    if (!screenshotAvailable) return null;

    // Capture raw PNG from primary display
    const imgBuffer = await screenshot({ format: 'png' });

    // Process with Jimp: resize and compress to JPEG
    const image = await Jimp.read(imgBuffer);
    const { width, height } = image.bitmap;

    image.resize(
      Math.round(width * CAPTURE_SCALE),
      Math.round(height * CAPTURE_SCALE)
    );

    const jpegBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
    return jpegBuffer;
  } catch (err) {
    if (err.message.includes('permission') || err.message.includes('denied')) {
      screenshotAvailable = false;
      console.error('[CAPTURE] Screen capture permission denied');
    } else {
      console.error('[CAPTURE] Error:', err.message);
    }
    return null;
  }
}

/**
 * Get screen dimensions
 */
async function getScreenDimensions() {
  try {
    const imgBuffer = await screenshot({ format: 'png' });
    const image = await Jimp.read(imgBuffer);
    return { width: image.bitmap.width, height: image.bitmap.height };
  } catch {
    return { width: 1920, height: 1080 };
  }
}

module.exports = { captureScreen, getScreenDimensions };
