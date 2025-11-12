// services/sightengine.service.js
require('dotenv').config();
const sightengine = require('sightengine')(
  process.env.SIGHTENGINE_API_USER,
  process.env.SIGHTENGINE_API_SECRET
);
const { getSecureVideoUrl } = require('../config/cloudinary');
const Video = require('../models/Video');
const moderateVideo = async (publicId) => {
  try {
    const videoUrl = getSecureVideoUrl(publicId);
    const result = await sightengine.check([
      'nudity-2.0', 'weapon', 'violence', 'offensive'
    ]).video_sync(videoUrl);

    const frames = result.data?.frames || [];
    let maxScores = { nudity: 0, weapon: 0, violence: 0, offensive: 0 };

    // Tính max score từ frame
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
    console.error('SightEngine Error:', error.message);
    return { isSafe: false, error: error.message };
  }
};

module.exports = { moderateVideo }; 