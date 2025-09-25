# Socket.IO Events Documentation

## Authentication
Tất cả Socket.IO events đều cần JWT token trong auth:
```javascript
const socket = io('http://localhost:3001', {
  auth: {
    token: 'your-jwt-token'
  }
});
```

## Client to Server Events

### Join Conversation
```javascript
socket.emit('join_conversation', {
  conversationId: 123
});
```

### Leave Conversation
```javascript
socket.emit('leave_conversation', {
  conversationId: 123
});
```

### Send Message
```javascript
socket.emit('send_message', {
  conversationId: 123,
  content: 'Hello world!',
  messageType: 'text', // 'text', 'image', 'file'
  replyToMessageId: 456 // optional
});
```

### Typing Start
```javascript
socket.emit('typing_start', {
  conversationId: 123
});
```

### Typing Stop
```javascript
socket.emit('typing_stop', {
  conversationId: 123
});
```

### Message Read
```javascript
socket.emit('message_read', {
  conversationId: 123
});
```

### Notification Read
```javascript
socket.emit('notification_read', {
  notificationId: 789
});
```

## Server to Client Events

### New Message
```javascript
socket.on('new_message', (data) => {
  console.log('New message:', data);
  // data = { message: {...}, conversationId: 123 }
});
```

### User Joined
```javascript
socket.on('user_joined', (data) => {
  console.log('User joined:', data);
  // data = { userId: 1, userName: 'John', conversationId: 123 }
});
```

### User Left
```javascript
socket.on('user_left', (data) => {
  console.log('User left:', data);
  // data = { userId: 1, userName: 'John', conversationId: 123 }
});
```

### User Typing
```javascript
socket.on('user_typing', (data) => {
  console.log('User typing:', data);
  // data = { userId: 1, userName: 'John', conversationId: 123, isTyping: true }
});
```

### Message Read
```javascript
socket.on('message_read', (data) => {
  console.log('Message read:', data);
  // data = { userId: 1, userName: 'John', conversationId: 123, readAt: '2024-01-01T00:00:00Z' }
});
```

### New Notification
```javascript
socket.on('new_notification', (data) => {
  console.log('New notification:', data);
  // data = { type: 'message', conversationId: 123, senderId: 1, senderName: 'John', content: 'Hello!' }
});
```

### User Status Changed
```javascript
socket.on('user_status_changed', (data) => {
  console.log('User status:', data);
  // data = { userId: 1, status: 'online'|'offline', timestamp: '2024-01-01T00:00:00Z' }
});
```

### Error
```javascript
socket.on('error', (data) => {
  console.error('Socket error:', data);
  // data = { message: 'Error message' }
});
```

## Connection Events

### Connect
```javascript
socket.on('connect', () => {
  console.log('Connected to server');
});
```

### Disconnect
```javascript
socket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
});
```

## Example Usage

### Basic Chat Implementation
```javascript
import io from 'socket.io-client';

class ChatService {
  constructor(token) {
    this.socket = io('http://localhost:3001', {
      auth: { token }
    });
    
    this.setupEventListeners();
  }

  setupEventListeners() {
    this.socket.on('connect', () => {
      console.log('Connected to chat server');
    });

    this.socket.on('new_message', (data) => {
      // Handle new message
      this.onNewMessage(data);
    });

    this.socket.on('user_typing', (data) => {
      // Handle typing indicator
      this.onUserTyping(data);
    });

    this.socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  }

  joinConversation(conversationId) {
    this.socket.emit('join_conversation', { conversationId });
  }

  leaveConversation(conversationId) {
    this.socket.emit('leave_conversation', { conversationId });
  }

  sendMessage(conversationId, content, messageType = 'text') {
    this.socket.emit('send_message', {
      conversationId,
      content,
      messageType
    });
  }

  startTyping(conversationId) {
    this.socket.emit('typing_start', { conversationId });
  }

  stopTyping(conversationId) {
    this.socket.emit('typing_stop', { conversationId });
  }

  markAsRead(conversationId) {
    this.socket.emit('message_read', { conversationId });
  }

  onNewMessage(data) {
    // Implement your message handling logic
    console.log('New message received:', data);
  }

  onUserTyping(data) {
    // Implement your typing indicator logic
    console.log('User typing:', data);
  }

  disconnect() {
    this.socket.disconnect();
  }
}

export default ChatService;
```

## Error Handling

### Common Error Scenarios
1. **Authentication Error**: Token không hợp lệ hoặc hết hạn
2. **Permission Error**: User không có quyền truy cập conversation
3. **Validation Error**: Dữ liệu gửi lên không hợp lệ
4. **Connection Error**: Mất kết nối với server

### Error Response Format
```javascript
{
  message: "Error description"
}
```

## Best Practices

1. **Always handle errors**: Listen for 'error' events
2. **Reconnect on disconnect**: Implement reconnection logic
3. **Join/Leave rooms properly**: Always leave rooms when switching conversations
4. **Handle typing indicators**: Implement proper typing start/stop logic
5. **Mark messages as read**: Update read status when user views messages
6. **Validate data**: Always validate data before emitting events
