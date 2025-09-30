const sharp = require('sharp');

// Heuristic crop for CCCD front: face is typically on the left area.
async function extractFaceFromFront(imagePath, outputPath) {
  try {
    const image = sharp(imagePath);
    const { width = 0, height = 0 } = await image.metadata();
    if (!width || !height) throw new Error('Invalid image');

    // Candidate regions where the portrait usually exists on VN CCCD front
    const candidates = [
      { left: 0.06, top: 0.18, w: 0.34, h: 0.62 }, // left
      { left: 0.24, top: 0.18, w: 0.34, h: 0.62 }, // slightly right (framing differences)
      { left: 0.12, top: 0.22, w: 0.30, h: 0.58 }, // tighter crop
    ];

    let best = null;
    let bestEntropy = -1;
    for (const area of candidates) {
      const cropWidth = Math.round(width * area.w);
      const cropHeight = Math.round(height * area.h);
      const left = Math.max(0, Math.round(width * area.left));
      const top = Math.max(0, Math.round(height * area.top));
      const buf = await image.extract({ left, top, width: cropWidth, height: cropHeight }).toBuffer();
      const stats = await sharp(buf).stats();
      const entropy = stats.entropy || 0;
      if (entropy > bestEntropy) {
        bestEntropy = entropy;
        best = { left, top, cropWidth, cropHeight };
      }
    }

    const { left, top, cropWidth, cropHeight } = best || {
      left: Math.round(width * 0.14),
      top: Math.round(height * 0.24),
      cropWidth: Math.round(width * 0.26),
      cropHeight: Math.round(height * 0.56),
    };
    await image.extract({ left, top, width: cropWidth, height: cropHeight }).toFile(outputPath);
    return outputPath;
  } catch (err) {
    // Do not copy the whole card; return original path so caller can ignore/collapse
    return imagePath;
  }
}

module.exports = { extractFaceFromFront };


