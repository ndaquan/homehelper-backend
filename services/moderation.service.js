
const { moderateVideo } = require('./sightengine.service');
const Video = require('../models/Video');

async function moderateAndUpdateVideo(videoId, publicId) {
  try {
    console.log(`[MODERATION] Bắt đầu duyệt video ID: ${videoId}`);

    const video = await Video.getVideoById(videoId);
    if (!video) throw new Error('Video không tồn tại');

    // BỎ QUA NẾU ĐÃ DUYỆT HOẶC TỪ CHỐI
    if (video.status === 'Approved' || video.status === 'Rejected') {
      console.log(`[MODERATION] Video ${videoId} đã ở trạng thái ${video.status} → Bỏ qua`);
      return;
    }

    const moderation = await moderateVideo(publicId);
    await Video.logModeration(videoId, moderation);

    let finalStatus = 'Pending';
    if (!moderation.isSafe) {
      finalStatus = 'Rejected';
    } else if (video.text_moderation_status === 'OK') {
      finalStatus = 'Approved';
    }

    await Video.updateVideoStatus(videoId, finalStatus);
    console.log(`[MODERATION] Video ${videoId} → ${finalStatus}`);

  } catch (error) {
    console.error(`[MODERATION] Lỗi duyệt video ${videoId}:`, error.message);
    try {
      await Video.updateVideoStatus(videoId, 'Pending');
    } catch (e) {
      console.error(`[MODERATION] Không thể đặt lại Pending cho video ${videoId}`);
    }
  }
}

module.exports = { moderateAndUpdateVideo };