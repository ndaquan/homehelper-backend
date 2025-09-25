# HomeHelper API Documentation

## Authentication
Tất cả API endpoints (trừ auth) đều cần JWT token trong header:
```
Authorization: Bearer <token>
```

## Conversations API

### Tạo cuộc trò chuyện mới
```
POST /api/conversations
```
**Body:**
```json
{
  "title": "Tên cuộc trò chuyện (optional)",
  "type": "direct|group|support",
  "participants": [1, 2, 3]
}
```

### Lấy danh sách cuộc trò chuyện
```
GET /api/conversations?page=1&limit=20
```

### Lấy chi tiết cuộc trò chuyện
```
GET /api/conversations/:conversationId
```

### Cập nhật cuộc trò chuyện
```
PUT /api/conversations/:conversationId
```
**Body:**
```json
{
  "title": "Tên mới"
}
```

### Xóa cuộc trò chuyện
```
DELETE /api/conversations/:conversationId
```

### Thêm participant
```
POST /api/conversations/:conversationId/participants
```
**Body:**
```json
{
  "participantId": 1,
  "role": "member|admin"
}
```

### Xóa participant
```
DELETE /api/conversations/:conversationId/participants/:participantId
```

### Đánh dấu đã đọc
```
POST /api/conversations/:conversationId/read
```

## Messages API

### Lấy tin nhắn trong cuộc trò chuyện
```
GET /api/conversations/:conversationId/messages?page=1&limit=50&beforeMessageId=123
```

### Gửi tin nhắn
```
POST /api/conversations/:conversationId/messages
```
**Body (text message):**
```json
{
  "content": "Nội dung tin nhắn",
  "message_type": "text",

}
```

**Body (file upload):**
```
Content-Type: multipart/form-data
file: <file>
content: "Mô tả file (optional)"
```

### Tìm kiếm tin nhắn
```
GET /api/conversations/:conversationId/messages/search?q=từ khóa&page=1&limit=20
```

### Lấy tin nhắn theo ID
```
GET /api/messages/:messageId
```

### Cập nhật tin nhắn
```
PUT /api/messages/:messageId
```
**Body:**
```json
{
  "content": "Nội dung mới"
}
```

### Xóa tin nhắn
```
DELETE /api/messages/:messageId
```

### Xóa vĩnh viễn tin nhắn (Admin only)
```
DELETE /api/messages/:messageId/permanent
```

### Đếm tin nhắn chưa đọc
```
GET /api/messages/conversations/:conversationId/unread/count
```

### Lấy tin nhắn chưa đọc
```
GET /api/messages/conversations/:conversationId/unread
```

### Lấy tin nhắn mới nhất
```
GET /api/messages/conversations/:conversationId/latest
```

## Notifications API

### Lấy danh sách thông báo
```
GET /api/notifications?page=1&limit=20&type=message&is_read=false
```

### Lấy thông báo theo ID
```
GET /api/notifications/:notificationId
```

### Đánh dấu thông báo đã đọc
```
POST /api/notifications/:notificationId/read
```

### Đánh dấu tất cả thông báo đã đọc
```
POST /api/notifications/read-all
```

### Xóa thông báo
```
DELETE /api/notifications/:notificationId
```

### Xóa tất cả thông báo đã đọc
```
DELETE /api/notifications/read
```

### Đếm thông báo chưa đọc
```
GET /api/notifications/unread/count
```

### Lấy thông báo chưa đọc
```
GET /api/notifications/unread?limit=10
```

### Lấy thống kê thông báo
```
GET /api/notifications/stats
```

### Tạo thông báo mới (Admin only)
```
POST /api/notifications
```
**Body:**
```json
{
  "user_id": 1,
  "title": "Tiêu đề thông báo",
  "content": "Nội dung thông báo",
  "type": "message|booking|payment|system|rating|task",
  "data": "{\"key\": \"value\"}",
  "expires_at": "2024-12-31T23:59:59Z"
}
```

### Tạo thông báo cho nhiều user (Admin only)
```
POST /api/notifications/multiple
```
**Body:**
```json
{
  "user_ids": [1, 2, 3],
  "title": "Tiêu đề thông báo",
  "content": "Nội dung thông báo",
  "type": "system",
  "data": "{\"key\": \"value\"}",
  "expires_at": "2024-12-31T23:59:59Z"
}
```

### Xóa thông báo hết hạn (Admin only)
```
DELETE /api/notifications/expired
```

## Response Format

### Success Response
```json
{
  "message": "Thông báo thành công",
  "data": { ... }
}
```

### Error Response
```json
{
  "error": "Thông báo lỗi"
}
```

## Status Codes

- `200` - OK
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Internal Server Error
