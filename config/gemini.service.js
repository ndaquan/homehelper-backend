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
// module.exports = { moderateContent };

// -------- Certificate Extraction (multimodal) --------
const axios2 = axios; // reuse
const os = require("os");
const { v4: uuidv4 } = require("uuid");
let pdf2imgAvailable = false;
let PDFImage;
try {
  PDFImage = require("pdf-image").PDFImage; // optional dependency
  pdf2imgAvailable = true;
} catch (_) {
  /* optional */
}

async function downloadToTemp(url) {
  const tempDir = path.join(os.tmpdir(), "homehelper_cert");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const ext = path.extname(url).split("?")[0] || ".bin";
  const filePath = path.join(tempDir, uuidv4() + ext);
  const writer = fs.createWriteStream(filePath);
  const response = await axios2.get(url, { responseType: "stream" });
  await new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
  return filePath;
}

async function convertPdfFirstPageToPng(pdfPath) {
  if (!pdf2imgAvailable)
    throw new Error("PDF to image converter not installed");
  const pdfImage = new PDFImage(pdfPath, {
    convertOptions: { "-resize": "1500x1500" },
  });
  const imagePath = await pdfImage.convertPage(0);
  return imagePath;
}

function extractJSON(str) {
  // Attempt to isolate JSON block
  const first = str.indexOf("{");
  const last = str.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    const candidate = str.substring(first, last + 1);
    try {
      return JSON.parse(candidate);
    } catch (_) {
      /* ignore */
    }
  }
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function normalizeDate(raw) {
  if (!raw) return null;
  const monthMap = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  // Vietnamese month words mapping if model returns (hiếm)
  const viMonthMap = {
    "tháng 1": 1,
    "tháng 2": 2,
    "tháng 3": 3,
    "tháng 4": 4,
    "tháng 5": 5,
    "tháng 6": 6,
    "tháng 7": 7,
    "tháng 8": 8,
    "tháng 9": 9,
    "tháng 10": 10,
    "tháng 11": 11,
    "tháng 12": 12,
  };
  const cleaned = raw
    .replace(/Ngày\s+/i, "")
    .replace(/ngày\s+/i, "")
    .replace(/tháng\s+/gi, (m) => m.toLowerCase())
    .replace(/năm\s+/i, "");
  const trials = [
    raw,
    cleaned,
    raw.replace(/\./g, " "),
    cleaned.replace(/\./g, " "),
  ];
  for (const t of trials) {
    // dd/mm/yyyy or dd-mm-yyyy
    const m1 = t.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
    if (m1) {
      let [, d, M, y] = m1;
      if (y.length === 2) y = parseInt(y, 10) > 50 ? "19" + y : "20" + y;
      return `${y.padStart(4, "0")}-${M.padStart(2, "0")}-${d.padStart(
        2,
        "0"
      )}`;
    }
    // dd Month yyyy (English)
    const m2 = t.match(
      /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d{4})\b/i
    );
    if (m2) {
      const d = m2[1];
      const mon = monthMap[m2[2].toLowerCase()];
      const y = m2[3];
      if (mon)
        return `${y}-${String(mon).padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    // Vietnamese pattern: dd mm yyyy OR dd tháng X yyyy
    const m3 = t.match(/\b(\d{1,2})\s+(tháng\s+)?(\d{1,2})\s+(\d{4})\b/i);
    if (m3) {
      const d = m3[1];
      const M = m3[3];
      const y = m3[4];
      return `${y}-${String(M).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    // Pattern: dd (tháng X) năm yyyy
    const m4 = t.match(/\b(\d{1,2})\s+(tháng\s+\d{1,2})\s+năm\s+(\d{4})\b/i);
    if (m4) {
      const d = m4[1];
      const monPhrase = m4[2].toLowerCase();
      const y = m4[3];
      const mon = viMonthMap[monPhrase];
      if (mon)
        return `${y}-${String(mon).padStart(2, "0")}-${String(d).padStart(
          2,
          "0"
        )}`;
    }
  }
  return null;
}

async function extractCertificateFromUrl(certUrl) {
  if (!GEMINI_API_KEY) throw new Error("Missing Gemini API key");
  const local = await downloadToTemp(certUrl);
  let imagePath = local;
  if (/\.pdf$/i.test(local)) {
    try {
      imagePath = await convertPdfFirstPageToPng(local);
    } catch (e) {
      throw new Error("PDF convert failed: " + e.message);
    }
  }
  const buffer = fs.readFileSync(imagePath);
  const b64 = buffer.toString("base64");
  const prompt = `
Bạn là hệ thống TRÍCH XUẤT THÔNG TIN CHỨNG CHỈ song ngữ (Việt / Anh), có nhiệm vụ nhận diện, hiểu ngữ cảnh và chuẩn hoá dữ liệu chứng chỉ thành JSON chuẩn. 
Phân tích hình ảnh hoặc văn bản của chứng chỉ và TRẢ VỀ DUY NHẤT MỘT JSON hợp lệ theo schema dưới đây (không thêm bình luận, không giải thích, không kèm markdown):

{
  "cert_name": "",           // Tên chứng chỉ đầy đủ. Nếu tiêu đề quá chung như "CHỨNG CHỈ", "GIẤY CHỨNG NHẬN", "CERTIFICATE", "CERTIFICATION", "CERTIFIED", "AWARD", "DIPLOMA" thì PHẢI nối thêm " – " + tên chuyên ngành/chương trình (tiếng Việt). Nếu có bản tiếng Anh tương ứng thì thêm trong ngoặc, ví dụ: "Chứng chỉ đào tạo – Chăm sóc người cao tuổi (Elderly Care)".
  "issued_by": "",           // Tên tổ chức hoặc đơn vị cấp chứng chỉ (Trường, Trung tâm, Học viện, Công ty, Tổ chức quốc tế...).
  "issued_date_raw": "",     // Ngày cấp đúng nguyên bản trên chứng chỉ (ví dụ: "8 tháng 1 năm 2021" hoặc "10 September 2022").
  "issued_date_iso": "",     // Ngày cấp dạng ISO (YYYY-MM-DD), nếu có thể suy ra.
  "holder_name": "",         // Họ tên người được cấp (ưu tiên tiếng Việt nếu song ngữ).
  "level_or_grade": "",      // Xếp loại hoặc cấp độ (ví dụ: Xuất sắc / Giỏi / Khá / Trung bình / Đạt / Pass / Good / Excellent / Distinction / Merit). Nếu song ngữ, ghi "Giỏi (Good)".
  "certificate_code": "",    // Mã số, số hiệu hoặc mã đăng ký (ví dụ: "22YDD0000"). Nếu văn bản chứa "Reg. No:" hoặc "Số:", chỉ lấy phần mã sau dấu ":".
  "graduation_date_raw": "", // Ngày hoàn thành khoá học (nếu khác ngày cấp).
  "course_duration": "",     // Thời lượng khoá học (ví dụ: "75 ngày", "3 tháng", "120 giờ"), nếu có.
  "location": "",            // Nơi cấp hoặc nơi đào tạo (ví dụ: "Đà Nẵng", "Hưng Yên", "Vietnam").
  "language": "vi",          // Ngôn ngữ chính của chứng chỉ: "vi", "en", hoặc "bilingual".
  "confidence": 0.0          // Độ tin cậy (0–1), ước lượng khả năng trích xuất chính xác.
}

YÊU CẦU:
- Chỉ trả về JSON hợp lệ, không thêm chú thích hoặc văn bản ngoài JSON.
- Nếu thông tin không có hoặc không chắc chắn, để giá trị "" hoặc null (không xoá field).
- Luôn cố gắng trích "level_or_grade" nếu có từ tương đương: Distinction, Excellent, Good, Fair, Pass, Xuất sắc, Giỏi, Khá, Trung bình, Đạt, Merit...
- Chuẩn hoá "cert_name" như hướng dẫn: tiêu đề chính + " – " + chuyên ngành, thêm bản dịch tiếng Anh trong ngoặc nếu có.
- Giữ nguyên dấu tiếng Việt, viết hoa chữ cái đầu mỗi cụm quan trọng.
- Không tự suy diễn hoặc bịa thông tin.
- Nếu chứng chỉ song ngữ, chọn bản tiếng Việt làm chính, bản tiếng Anh ghi trong ngoặc.
`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { inline_data: { mime_type: "image/png", data: b64 } },
          { text: prompt },
        ],
      },
    ],
  };
  const { data } = await axios2.post(
    `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
    body,
    { headers: { "Content-Type": "application/json" } }
  );
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const json = extractJSON(raw) || {};
  let iso = json.issued_date_iso || normalizeDate(json.issued_date_raw);
  let dateLineTried = null;
  // Fallback: scan raw text if iso still null
  if (!iso && raw) {
    dateLineTried = raw
      .split(/\n|\\n/)
      .find(
        (l) =>
          /(Ngày|ngày)/.test(l) ||
          /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/.test(l)
      );
    if (dateLineTried) {
      iso = normalizeDate(dateLineTried);
    }
  }
  // ----- Heuristic enrichment for generic cert_name -----
  const parsed = {
    cert_name: json.cert_name || null,
    issued_by: json.issued_by || null,
    issued_date_raw: json.issued_date_raw || null,
    issued_date_iso: iso,
    holder_name: json.holder_name || null,
    level_or_grade: json.level_or_grade || null,
    certificate_code: json.certificate_code || null,
    graduation_date_raw: json.graduation_date_raw || null,
    confidence: typeof json.confidence === "number" ? json.confidence : null,
  };

  // Heuristic fallback: try to extract level/grade if missing
  try {
    if (!parsed.level_or_grade && raw) {
      const lower = raw.toLowerCase();
      const gradePatterns = [
        /xu[aá]t\s*s[aắ]c|distinction|excellent/,
        /giỏi|very\s+good|good\b/,
        /khá|fair\b|above\s+average/,
        /trung\s*bình|average/,
        /đạt|pass(ed)?\b/,
      ];
      const gradeLabels = ["Xuất sắc", "Giỏi", "Khá", "Trung bình", "Đạt"];
      for (let gi = 0; gi < gradePatterns.length; gi++) {
        if (gradePatterns[gi].test(lower)) {
          parsed.level_or_grade = gradeLabels[gi];
          break;
        }
      }
    }
  } catch (_) {
    /* ignore heuristic errors */
  }

  try {
    const genericPatterns = [
      /^chứng\s*chỉ\s*đào\s*tạo$/i,
      /^chứng\s*chỉ$/i,
      /^certificate$/i,
    ];
    const lowerRaw = raw.toLowerCase();
    const programVi = /chăm\s*sóc\s*người\s*cao\s*tuổi/i.test(lowerRaw)
      ? "Chăm sóc người cao tuổi"
      : null;
    const programEn = /elderly\s*care/i.test(lowerRaw) ? "Elderly Care" : null;
    if (
      parsed.cert_name &&
      genericPatterns.some((p) => p.test(parsed.cert_name.trim()))
    ) {
      if (programVi) {
        parsed.cert_name = `Chứng chỉ đào tạo – ${programVi}${
          programEn ? ` (${programEn})` : ""
        }`;
      }
    }
  } catch (_) {
    /* ignore heuristic errors */
  }

  if (process.env.DEBUG_CERT_AI === "1") {
    try {
      const logDir = path.join(__dirname, "logs");
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const logFile = path.join(logDir, "certificate_extraction.log");
      const logEntry = `\n[${new Date().toISOString()}]\nURL: ${certUrl}\nRAW(JSON?): ${raw.substring(
        0,
        2000
      )}\nissued_date_raw(JSON): ${
        json.issued_date_raw
      }\nHeuristic dateLine: ${dateLineTried}\nFinal ISO: ${
        parsed.issued_date_iso
      }\nParsed Name: ${parsed.cert_name}\n`;
      fs.appendFileSync(logFile, logEntry);
      console.log("🧪 CERT_AI_LOG:", {
        certUrl,
        dateRaw: json.issued_date_raw,
        dateLineTried,
        finalISO: parsed.issued_date_iso,
      });
    } catch (e) {
      /* ignore logging errors */
    }
  }

  return { rawText: raw, parsed };
}

module.exports.extractCertificateFromUrl = extractCertificateFromUrl;
