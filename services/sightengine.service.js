// services/sightengine.service.js
require('dotenv').config();
const sightengine = require('sightengine')(
  process.env.SIGHTENGINE_API_USER,
  process.env.SIGHTENGINE_API_SECRET
);
const cloudinary = require('cloudinary').v2;
const { getSecureImageUrl, getSecureVideoUrl } = require('../config/cloudinary');

// Cấu hình Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Kiểm duyệt + tự động blur PII trong ảnh
 */

const moderateAndBlurImage = async (publicId) => {
  try {
    const imageUrl = getSecureImageUrl(publicId);

    // GỌI CẢ 2 MODEL ĐỂ ĐẢM BẢO PHÁT HIỆN PII MỌI TRƯỜNG HỢP
    const result = await sightengine.check([
      'faces',
      'text',          // cho chữ viết tay, ảnh AI
      'text-content',  // cho số điện thoại, email, CMND ← BẮT BUỘC
      'nudity-2.0'
    ]).set_url(imageUrl);

    // ĐỌC PII TỪ CẢ 2 MODEL
    const pii1 = result['text-content']?.personal || [];
    const pii2 = result.text?.personal || [];
    const personalPII = [...new Set([...pii1, ...pii2])]; // loại trùng
    const hasPII = personalPII.length > 0;

    const hasFace = Array.isArray(result.faces) && result.faces.length > 0;
    const hasNudity = (result.nudity?.sexual_activity || 0) > 0.7;
    const hasSensitiveContent = hasPII || hasFace || hasNudity;

    console.log('FINAL PII Detection:', {
      hasPII,
      personalPII: personalPII.map(p => ({ type: p.type, match: p.match })),
      source: pii1.length > 0 ? 'text-content' : pii2.length > 0 ? 'text' : 'none',
      hasFace,
      hasNudity
    });

    if (!hasSensitiveContent) {
      return {
        isSafe: true,
        blurred: false,
        url: imageUrl,
        originalUrl: imageUrl,
        originalPublicId: publicId,
        detections: { personalPII, faces: result.faces, nudity: result.nudity }
      };
    }

    // Blur cực mạnh
    const blurredUrl = cloudinary.url(publicId, {
      secure: true,
      transformation: [
        { effect: "pixelate:80" },
        { effect: "blur:4000" },
        { quality: "auto:low" },
        { flags: "progressive" }
      ]
    });

    return {
      isSafe: false,
      blurred: true,
      url: blurredUrl,
      originalUrl: imageUrl,
      originalPublicId: publicId,
      detections: { personalPII, faces: result.faces, nudity: result.nudity },
      reason: hasPII ? 'PII detected' : hasFace ? 'Face' : 'Nudity'
    };

  } catch (error) {
    console.error('SightEngine Error:', error.response?.data || error.message);
    return {
      isSafe: false,
      blurred: false,
      url: getSecureImageUrl(publicId),
      originalUrl: getSecureImageUrl(publicId),
      originalPublicId: publicId,
      error: error.message
    };
  }
};
/**
 * Kiểm duyệt video (giữ nguyên)
 */
const moderateVideo = async (publicId) => {
  try {
    const videoUrl = getSecureVideoUrl(publicId);
    const result = await sightengine.check([
      'nudity-2.0', 'weapon', 'violence', 'offensive'
    ]).video_sync(videoUrl);

    const frames = result.data?.frames || [];
    let maxScores = { nudity: 0, weapon: 0, violence: 0, offensive: 0 };

    frames.forEach(f => {
      maxScores.nudity = Math.max(maxScores.nudity,
        f.nudity?.sexual_activity || 0,
        f.nudity?.sexual_display || 0,
        f.nudity?.erotica || 0,
        f.nudity?.sextoy || 0,
        f.nudity?.suggestive || 0
      );
      maxScores.weapon = Math.max(maxScores.weapon, f.weapon?.classes?.firearm || 0);
      maxScores.violence = Math.max(maxScores.violence, f.violence?.prob || 0);
      maxScores.offensive = Math.max(maxScores.offensive, f.offensive?.prob || 0);
    });

    const isSafe =
      maxScores.nudity < 0.7 &&
      maxScores.weapon < 0.7 &&
      maxScores.violence < 0.7 &&
      maxScores.offensive < 0.7;

    return { isSafe, raw: result };
  } catch (error) {
    console.error('SightEngine Video Error:', error.message);
    return { isSafe: false, error: error.message };
  }
};

module.exports = { moderateAndBlurImage, moderateVideo };