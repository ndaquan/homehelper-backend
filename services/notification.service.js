const Notification = require('../models/Notification');
const { executeQuery } = require('../config/database');
const CLIENT_BASE_URL = process.env.CORS_ORIGIN || "http://localhost:3000";
// Helper to safely emit a socket event; falls back to broadcast if we can't target user sockets
function emitNewNotification(io, payload) {
  if (!io || !payload || !payload.user_id) return;
  try {
    const room = `user_${payload.user_id}`;
    io.to(room).emit('new_notification', payload);
  } catch (e) {
    // ignore
  }
}

// Generic notification creator + socket push
async function notify(io, { user_id, title, content, type = 'system', data = null, expires_at = null }) {
  // Map FE type -> DB type (respect potential CHECK constraints), but emit FE type
  const normType = (type || 'system').toLowerCase();
  const dbTypeMap = {
    booking: 'Booking',
    payment: 'Payment',
    message: 'Message',
    system: 'System',
    sos: 'Booking', // store as Booking, FE can use data.is_sos to render
    rating: 'rating' // explicit rating type for DB
  };
  const dbType = dbTypeMap[normType] || 'System';
  const notification = await Notification.create({
    user_id,
    title,
    content,
    type: dbType,
    data: typeof data === 'string' ? data : (data ? JSON.stringify(data) : null),
    expires_at
  });
  emitNewNotification(io, {
    user_id,
    type: normType, // FE friendly
    title,
    content,
    data: data || null,
    notification_id: notification.notification_id,
    created_at: notification.created_at
  });
  return notification;
}

async function fetchUserNames({ customer_id, tasker_id }) {
  const ids = [customer_id, tasker_id].filter(Boolean);
  if (ids.length === 0) return { customer_name: undefined, tasker_name: undefined };
  const placeholders = ids.map((_, i) => `@param${i + 1}`).join(',');
  const rs = await executeQuery(
    `SELECT user_id, name FROM Users WHERE user_id IN (${placeholders})`,
    ids
  );
  const map = new Map((rs.recordset || []).map(r => [String(r.user_id), r.name]));
  return {
    customer_name: customer_id ? map.get(String(customer_id)) : undefined,
    tasker_name: tasker_id ? map.get(String(tasker_id)) : undefined,
  };
}

// Rating notifications (customer rates tasker)
async function notifyRatingEvent(io, { booking_id, reviewer_id, reviewee_id, rating, comment }) {
  try {
    const { customer_name, tasker_name } = await fetchUserNames({ customer_id: reviewer_id, tasker_id: reviewee_id });
    const title = 'Bạn vừa nhận một đánh giá';
    const content = `${customer_name || 'Khách hàng'} đã đánh giá ${Number(rating)}★ cho đơn #${booking_id}.`;
    const data = {
      booking_id,
      reviewer_id,
      reviewee_id,
      rating: Number(rating),
      comment,
      url: `${CLIENT_BASE_URL}/ratings`
    };
    return notify(io, {
      user_id: reviewee_id,
      type: 'rating',
      title,
      content,
      data
    });
  } catch (e) {
    // Fall back: send minimal payload
    return notify(io, {
      user_id: reviewee_id,
      type: 'rating',
      title: 'Bạn vừa nhận một đánh giá',
      content: `Khách hàng đã đánh giá ${Number(rating)}★ cho đơn #${booking_id}.`,
      data: { booking_id, reviewer_id, reviewee_id, rating: Number(rating), comment }
    });
  }
}

// Booking event notifications
async function notifyBookingEvent(io, { action, booking_id, customer_id, tasker_id, service_name, amount, cancelledBy, refundAmount, compensationAmount }) {
  const { customer_name, tasker_name } = await fetchUserNames({ customer_id, tasker_id });
  const baseData = { booking_id, action, customer_id, tasker_id, customer_name, tasker_name };
  switch (action) {
    case 'created':
      return notify(io, {
        user_id: customer_id,
        type: 'booking',
        title: `Đã tạo yêu cầu dịch vụ${service_name ? ' - ' + service_name : ''}`,
        content: `Đơn #${booking_id} đã được tạo cho ${customer_name || 'khách hàng'}. Chúng tôi sẽ thông báo khi tasker nhận việc.`,
        data: { ...baseData, url: `${CLIENT_BASE_URL}/customer/booking/${booking_id}` }
      });
    case 'created_tasker':
      return notify(io, {
        user_id: tasker_id,
        type: 'booking',
        title: 'Bạn có yêu cầu đặt lịch mới',
        content: `Đơn #${booking_id} từ ${customer_name || 'khách hàng'}. Vui lòng xem chi tiết và chấp nhận nếu phù hợp.`,
        data: { ...baseData, url: `${CLIENT_BASE_URL}/tasker/bookings/${booking_id}` }
      });
    case 'accepted':
      return notify(io, {
        user_id: customer_id,
        type: 'booking',
        title: 'Tasker đã chấp nhận',
        content: `Đơn #${booking_id} đã được ${tasker_name || 'tasker'} chấp nhận.`,
        data: { ...baseData, url: `${CLIENT_BASE_URL}/customer/bookings` }
      });
    case 'started':
      return notify(io, {
        user_id: customer_id,
        type: 'booking',
        title: 'Công việc đã bắt đầu',
        content: `${tasker_name || 'Tasker'} đã bắt đầu thực hiện đơn #${booking_id}.`,
        data: baseData
      });
    case 'completed':
      return notify(io, {
        user_id: customer_id,
        type: 'booking',
        title: 'Công việc đã hoàn thành',
        content: `${tasker_name || 'Tasker'} đã hoàn thành đơn #${booking_id}. Vui lòng kiểm tra và thanh toán nếu còn thiếu.`,
        data: { ...baseData, url: `${CLIENT_BASE_URL}/customer/booking/${booking_id}` }
      });
    case 'paid':
      return notify(io, {
        user_id: tasker_id,
        type: 'payment',
        title: 'Khách hàng đã thanh toán',
        content: `${customer_name || 'Khách'} đã thanh toán cho đơn #${booking_id}${amount ? ` (${amount.toLocaleString('vi-VN')}₫)` : ''}.`,
        data: { ...baseData, amount, url: `${CLIENT_BASE_URL}/tasker/bookings/${booking_id}` }
      });
    case 'cancelled': {
      // Notify customer
      await notify(io, {
        user_id: customer_id,
        type: 'booking',
        title: 'Đơn dịch vụ đã hủy',
        content: `Đơn #${booking_id} đã được hủy${cancelledBy ? ` (bởi ${cancelledBy})` : ''}.`,
        data: { ...baseData, cancelledBy, refundAmount, compensationAmount, url: `${CLIENT_BASE_URL}/customer/bookings` }
      });
      // Notify tasker
      if (tasker_id) {
        await notify(io, {
          user_id: tasker_id,
          type: 'booking',
          title: 'Đơn dịch vụ đã hủy',
          content: `Đơn #${booking_id} đã bị hủy${cancelledBy ? ` (bởi ${cancelledBy})` : ''}.`,
          data: { ...baseData, cancelledBy, refundAmount, compensationAmount, url: `${CLIENT_BASE_URL}/tasker/bookings/${booking_id}` }
        });
      }
      return;
    }
    default:
      return notify(io, {
        user_id: customer_id,
        type: 'booking',
        title: 'Cập nhật đơn dịch vụ',
        content: `Đơn #${booking_id} có cập nhật: ${action}.`,
        data: baseData
      });
  }
}
// Quote event notifications
async function notifyQuoteEvent(io, { action, quote_id, post_id, customer_id, tasker_id, variant_id, proposed_price }) {
  const { customer_name, tasker_name } = await fetchUserNames({ customer_id, tasker_id });
  const baseData = { quote_id, post_id, customer_id, tasker_id, customer_name, tasker_name, variant_id, proposed_price };
  switch (action) {
    case 'sent':
      // Tasker sent a quote -> notify customer (post owner)
      return notify(io, {
        user_id: customer_id,
        type: 'message',
        title: 'Bạn có yêu cầu làm việc mới',
        content: `${tasker_name || 'Tasker'} đã gửi báo giá cho bài viết #${post_id} với giá ${Number(proposed_price).toLocaleString('vi-VN')}₫`,
        data: { ...baseData, url: `${CLIENT_BASE_URL}/blog/${post_id}/quotes` }
      });
    case 'accepted':
      // Customer accepted a quote -> notify tasker
      return notify(io, {
        user_id: tasker_id,
        type: 'message',
        title: 'Yêu cầu làm việc được chấp nhận',
        content: `${customer_name || 'Khách hàng'} đã chấp nhận yêu cầu làm việc của bạn cho bài viết #${post_id}.`,
        data: { ...baseData, url: `${CLIENT_BASE_URL}/tasker/bookings` }
      });
    case 'rejected':
      // Customer rejected a quote -> notify tasker
      return notify(io, {
        user_id: tasker_id,
        type: 'message',
        title: 'Yêu cầu làm việc bị từ chối',
        content: `${customer_name || 'Khách hàng'} đã từ chối yêu cầu làm việc của bạn cho bài viết #${post_id}.`,
        data: { ...baseData, url: `${CLIENT_BASE_URL}/blog/${post_id}` }
      });
    default:
      return;
  }
}
// SOS booking notifications (notify customer + all matching taskers)
async function notifySosRequestToTaskers(io, { booking_id, customer_id, variant_id, service_id, location }) {
  try {
    // Get customer name
    const { customer_name } = await fetchUserNames({ customer_id });

    // Notify the customer that SOS request has been dispatched
    await notify(io, {
      user_id: customer_id,
      type: 'sos',
      title: 'Đã gửi yêu cầu SOS',
      content: 'Yêu cầu SOS của bạn đã được gửi đến các tasker phù hợp. Vui lòng chờ người nhận.',
      data: {
        booking_id,
        customer_id,
        customer_name,
        variant_id,
        service_id,
        location
      }
    });

    // Find taskers who can handle this SERVICE (not just variant)
    // Parse lat/lng from location string (format: "lat,lng")
    let lat = 0, lng = 0;
    if (location && location.includes(',')) {
      [lat, lng] = location.split(',').map(n => parseFloat(n.trim()));
    }

    // Find taskers who can handle this SERVICE (not just variant) within 15km
    let taskerQuery = `
      SELECT DISTINCT tsv.tasker_id, u.name
      FROM TaskerServiceVariants tsv
      JOIN ServiceVariants sv ON tsv.variant_id = sv.variant_id
      JOIN Users u ON u.user_id = tsv.tasker_id
      JOIN Addresses a ON u.user_id = a.user_id
      WHERE sv.service_id = @param1
        AND a.lat != 0 AND a.lng != 0
    `;

    if (lat && lng) {
      taskerQuery += `
        AND (6371000 * 2 * ATN2(SQRT(
          SIN(RADIANS(a.lat - @param2)/2) * SIN(RADIANS(a.lat - @param2)/2) + 
          COS(RADIANS(@param2)) * COS(RADIANS(a.lat)) * 
          SIN(RADIANS(a.lng - @param3)/2) * SIN(RADIANS(a.lng - @param3)/2)
        ), SQRT(1 - (
          SIN(RADIANS(a.lat - @param2)/2) * SIN(RADIANS(a.lat - @param2)/2) + 
          COS(RADIANS(@param2)) * COS(RADIANS(a.lat)) * 
          SIN(RADIANS(a.lng - @param3)/2) * SIN(RADIANS(a.lng - @param3)/2)
        )))) <= 15000
      `;
    }

    const taskersRes = await executeQuery(taskerQuery, [service_id, lat, lng]);

    const rows = taskersRes.recordset || [];
    const dataPayload = {
      booking_id,
      customer_id,
      customer_name,
      variant_id,
      service_id,
      location,
      url: `${CLIENT_BASE_URL}/tasker/bookings`
    };

    // Send individual notifications (allows per-user persistence & future unread counts)
    for (const r of rows) {
      await notify(io, {
        user_id: r.tasker_id,
        type: 'sos',
        title: 'Yêu cầu SOS mới',
        content: `Khách hàng ${customer_name || ''} cần gấp dịch vụ. Đơn #${booking_id}.`,
        data: dataPayload
      });
    }

    // Emit targeted 'sos_created' only to matching taskers (avoid notifying all users)
    try {
      const payload = { booking_id, customer_id, customer_name, variant_id, service_id, location };
      for (const r of rows) {
        const room = `user_${r.tasker_id}`;
        io && io.to && io.to(room).emit('sos_created', payload);
      }
    } catch { }

    return { sent_to_taskers: rows.length };
  } catch (err) {
    console.error('[notifySosRequestToTaskers] Error:', err);
    return { sent_to_taskers: 0, error: err.message };
  }
}

// Withdrawal notifications
async function notifyWithdrawalEvent(io, { user_id, amount, status, admin_note }) {
  const title = status === 'completed' ? 'Yêu cầu rút tiền thành công' : 'Yêu cầu rút tiền bị từ chối';
  const content = status === 'completed'
    ? `Yêu cầu rút ${(amount * 1000).toLocaleString('vi-VN')}₫ của bạn đã được duyệt và chuyển khoản thành công.`
    : `Yêu cầu rút ${(amount * 1000).toLocaleString('vi-VN')}₫ của bạn đã bị từ chối. Lý do: ${admin_note || 'Không có lý do cụ thể'}`;

  return notify(io, {
    user_id,
    type: 'payment',
    title,
    content,
    data: { amount, status, admin_note, url: `${CLIENT_BASE_URL}/withdraw-history` }
  });
}

module.exports = {
  notify,
  notifyBookingEvent,
  notifySosRequestToTaskers,
  notifyQuoteEvent,
  notifyRatingEvent,
  notifyWithdrawalEvent,
};
