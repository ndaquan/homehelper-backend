const axios = require("axios");
const fs = require("fs");
const path = require("path");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent";

async function moderateContent(text) {
  if (!GEMINI_API_KEY) throw new Error("Missing Gemini API key");

  const prompt = `Bạn là bộ lọc kiểm duyệt tiếng Việt. Nếu nội dung sau có bất kỳ từ ngữ tục tĩu, chửi bậy, xúc phạm, bạo lực, phân biệt, hãy trả về đúng một từ duy nhất là BAD. Nếu hoàn toàn sạch, trả về đúng một từ duy nhất là OK. Không giải thích, không thêm gì khác. Nội dung: \n"${text}"`;

  // Đảm bảo thư mục logs tồn tại
  const logDir = path.join(__dirname, "logs");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logFile = path.join(logDir, "gemini_moderation.log");

  try {
    const response = await axios.post(
      `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
      {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const result = response.data.candidates?.[0]?.content?.parts?.[0]?.text
      ?.trim()
      .toUpperCase();
    fs.appendFileSync(
      logFile,
      `\n[${new Date().toISOString()}] INPUT: ${text}\nRESULT: ${result}\n`
    );

    if (result === "OK") return true;
    if (result === "BAD") return false;
    return false;
  } catch (error) {
    fs.appendFileSync(
      logFile,
      `\n[${new Date().toISOString()}] ERROR: ${
        error.message
      }\nRESPONSE: ${JSON.stringify(error.response?.data)}\n`
    );
    return false;
  }
}

// --- HÀM XỬ LÝ KIỂM DUYỆT + RATING ---
async function processReview(comment, rating) {
  const logDir = path.join(__dirname, "logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, "review_process.log");

  const isClean = await moderateContent(comment);

  // Ghi log kết quả kiểm duyệt nội dung
  fs.appendFileSync(
    logFile,
    `\n[${new Date().toISOString()}] REVIEW INPUT:\nCOMMENT: "${comment}"\nRATING: ${rating}\nCLEAN: ${isClean}\n`
  );

  // 1️⃣ Nếu bình luận tục tĩu → chặn hoàn toàn
  if (!isClean) {
    const result = {
      allow: false,
      status: null,
      message: "Bình luận chứa từ ngữ không phù hợp, không được phép đăng.",
    };
    fs.appendFileSync(logFile, `[RESULT] ${JSON.stringify(result)}\n`);
    return result;
  }

  // 2️⃣ Kiểm tra sự hợp lý giữa bình luận & rating
  const promptCheck = `
  Bạn là bộ lọc logic. Hãy xác định xem bình luận sau có phù hợp với rating ${rating} sao hay không.
  - Nếu bình luận và rating KHÔNG PHÙ HỢP (chê nhưng 5 sao, khen mà chỉ 1 sao), trả về 0.
  - Nếu PHÙ HỢP, trả về 1.
  Không giải thích thêm.
  Bình luận: "${comment}"
  `;

  try {
    const response = await axios.post(
      `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
      {
        contents: [{ role: "user", parts: [{ text: promptCheck }] }],
      },
      { headers: { "Content-Type": "application/json" } }
    );

    const aiCheck =
      response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const isConsistent = aiCheck === "1";

    let result;
    if (!isConsistent) {
      // 2️⃣ Bình luận & rating trái ngược → chờ duyệt
      result = {
        allow: true,
        status: 0,
        message: "Bình luận và rating không khớp, chuyển vào hàng chờ xử lý.",
      };
    } else {
      // 3️⃣ Bình thường → duyệt ngay
      result = {
        allow: true,
        status: 1,
        message: "Bình luận hợp lệ, đã được duyệt.",
      };
    }

    fs.appendFileSync(
      logFile,
      `[AI CHECK] AI_RESULT=${aiCheck}\n[FINAL RESULT] ${JSON.stringify(
        result
      )}\n`
    );
    return result;
  } catch (error) {
    const result = {
      allow: true,
      status: 0,
      message: "Không thể kiểm tra tính hợp lý, tạm chuyển vào hàng chờ.",
    };
    fs.appendFileSync(
      logFile,
      `[ERROR] ${error.message}\n[FALLBACK RESULT] ${JSON.stringify(result)}\n`
    );
    return result;
  }
}

module.exports = { moderateContent, processReview };
