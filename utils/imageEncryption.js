const crypto = require('crypto');

// Sử dụng key từ env hoặc default (production phải dùng env!)
const ENCRYPTION_KEY = process.env.IMAGE_ENCRYPTION_KEY || 'homehelper-secret-key-32chars!';
const ALGORITHM = 'aes-256-cbc';

// Đảm bảo key đủ 32 bytes
const KEY = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();

class ImageEncryption {
    // Mã hóa URL
    static encrypt(text) {
        if (!text) return null;

        try {
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
            let encrypted = cipher.update(text, 'utf8', 'hex');
            encrypted += cipher.final('hex');

            // Trả về iv + encrypted (iv cần để decrypt)
            return iv.toString('hex') + ':' + encrypted;
        } catch (error) {
            console.error('Encryption error:', error);
            return text; // Fallback: return original if encryption fails
        }
    }

    // Giải mã URL
    static decrypt(encryptedText) {
        if (!encryptedText) return null;

        try {
            const parts = encryptedText.split(':');
            if (parts.length !== 2) return encryptedText; // Not encrypted format

            const iv = Buffer.from(parts[0], 'hex');
            const encrypted = parts[1];

            const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            return decrypted;
        } catch (error) {
            console.error('Decryption error:', error);
            return encryptedText; // Fallback: return original if decryption fails
        }
    }
}

module.exports = ImageEncryption;
