const axios = require("axios");
const fs = require("fs");
const path = require("path");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Model gốc - đang hoạt động với các dịch vụ khác
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
      result = {
        allow: true,
        status: 1, // ✅ đăng luôn, không cần staff duyệt
        message: "Bình luận và rating không khớp, nhưng vẫn được đăng.",
      };
    } else {
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
          { text: prompt },
          { inline_data: { mime_type: "image/png", data: b64 } },
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
async function moderateVideoText(title, description = "") {
  if (!GEMINI_API_KEY) throw new Error("Missing Gemini API key");

  const fullText = `${title} ${description}`.trim();
  if (!fullText) return { isSafe: true, reason: null };

  const prompt = `Bạn là bộ lọc kiểm duyệt nội dung video. Kiểm tra tiêu đề và mô tả sau có chứa nội dung không phù hợp (tục tĩu, khiêu dâm, bạo lực, phân biệt, lừa đảo, quảng cáo trá hình, clickbait quá mức) không?

Nếu CÓ → trả về đúng định dạng:
BAD: [lý do ngắn gọn]

Nếu KHÔNG → trả về:
OK

Không giải thích thêm. Chỉ trả về 1 dòng.

Nội dung:
Tiêu đề: "${title}"
Mô tả: "${description}"`;

  const logDir = path.join(__dirname, "logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, "gemini_video_text.log");

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
      { headers: { "Content-Type": "application/json" } }
    );

    const raw = response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const result = raw?.toUpperCase();

    // Ghi log
    fs.appendFileSync(
      logFile,
      `\n[${new Date().toISOString()}] TITLE: "${title}"\nDESC: "${description}"\nRAW: ${raw}\n`
    );

    // Phân tích kết quả
    if (result?.startsWith("OK")) {
      return { isSafe: true, reason: null };
    }

    if (result?.startsWith("BAD:")) {
      const reason = raw.substring(4).trim(); // Lấy lý do sau "BAD:"
      return { isSafe: false, reason };
    }

    // Nếu không rõ → từ chối an toàn
    return { isSafe: false, reason: "Không thể xác định nội dung" };

  } catch (error) {
    fs.appendFileSync(
      logFile,
      `\n[${new Date().toISOString()}] ERROR: ${error.message}\nRESPONSE: ${JSON.stringify(error.response?.data)}\n`
    );
    return { isSafe: false, reason: "Lỗi kiểm duyệt AI" };
  }
}

// -------- Chatbot cho website HomeHelper --------
const WEBSITE_CONTEXT = `
Bạn là trợ lý AI thân thiện của HomeHelper - nền tảng kết nối khách hàng với các Tasker (người làm dịch vụ gia đình chuyên nghiệp).

=== THÔNG TIN VỀ HOMEHELPER ===
- Slogan: "HomeHelper – Giúp việc dễ dàng, cuộc sống thảnh thơi"
- Khẩu hiệu: "Kết nối nhanh – Dịch vụ chuẩn – Ngôi nhà an tâm"
- Hơn 10,000+ người giúp việc đã được xác minh
- 45 năm kinh nghiệm trong ngành
- 2,342+ khách hàng hài lòng
- Hoạt động tại 30+ khu vực

=== DANH SÁCH DỊCH VỤ VÀ BẢNG GIÁ ===
(Giá tham khảo, có thể thay đổi tùy Tasker)

1. 🍳 NẤU ĂN GIA ĐÌNH (Yêu cầu chứng chỉ)
   - Nấu cho 2-3 người, 2-3 món: 140,000 - 150,000 VNĐ/giờ
   - Nấu cho 5-8 người, 2-3 món: 170,000 - 180,000 VNĐ/giờ
   - Đảm bảo dinh dưỡng và vệ sinh an toàn thực phẩm

2. 🧹 DỌN DẸP NHÀ CỬA THEO GIỜ
   - Giá: 80,000 - 120,000 VNĐ/giờ
   - Lau chùi, giặt giũ, sắp xếp gọn gàng
   - Linh hoạt thời gian theo nhu cầu

3. 📅 GIÚP VIỆC ĐỊNH KỲ
   - Gói định kỳ: 400,000 - 600,000 VNĐ/tuần
   - Giúp việc hàng tuần/tháng
   - Ổn định, tiết kiệm chi phí

4. 👴 CHĂM SÓC NGƯỜI GIÀ & BỆNH NHÂN (Yêu cầu chứng chỉ)
   - Theo ngày: 500,000 - 800,000 VNĐ/ngày
   - Theo tuần: 4,000,000 - 5,000,000 VNĐ/tuần
   - Theo tháng: 5,000,000 - 10,000,000 VNĐ/tháng
   - Theo dõi sức khỏe, đội ngũ được đào tạo

5. 🛋️ VỆ SINH SOFA, NỆM, THẢM, RÈM
   - Sofa vải nỉ: 150,000 - 300,000 VNĐ/chiếc
   - Sofa da: 200,000 - 500,000 VNĐ/chiếc
   - Nệm: 200,000 - 400,000 VNĐ/chiếc
   - Thảm: 50,000 - 100,000 VNĐ/m²
   - Rèm: 100,000 - 200,000 VNĐ/chiếc
   - Công nghệ làm sạch từ Đức, khử mùi & diệt khuẩn

6. ❄️ VỆ SINH ĐIỀU HÒA (Yêu cầu chứng chỉ)
   - Điều hòa treo tường: 300,000 - 400,000 VNĐ/chiếc
   - Điều hòa tủ đứng: 500,000 - 600,000 VNĐ/chiếc
   - Điều hòa âm trần: 700,000 - 800,000 VNĐ/chiếc
   - Vệ sinh dàn nóng/lạnh, kiểm tra gas

7. 🏠 TỔNG VỆ SINH
   - Cho doanh nghiệp: 40,000 - 60,000 VNĐ/m²
   - Vệ sinh tổng thể nhà ở/văn phòng
   - Đội ngũ đông, dụng cụ chuyên nghiệp

8. 👶 CHĂM SÓC TRẺ EM (Yêu cầu chứng chỉ)
   - Theo ngày: 400,000 - 600,000 VNĐ/ngày
   - Theo tuần: 3,000,000 - 4,000,000 VNĐ/tuần
   - Theo tháng: 4,000,000 - 8,000,000 VNĐ/tháng
   - Hỗ trợ học tập, vui chơi, kiên nhẫn & tận tâm

=== LƯU Ý VỀ GIÁ ===
- Giá trên là THAM KHẢO, mỗi Tasker có thể đề xuất giá riêng
- Giá có thể thay đổi tùy vùng, thời điểm, độ khó công việc
- Đơn vị tiền: VNĐ (Việt Nam Đồng)
- Để biết giá chính xác: Xem trang chi tiết dịch vụ hoặc liên hệ Tasker

=== TÍNH NĂNG CHÍNH ===
1. 🔍 TÌM KIẾM TASKER
   - Tìm theo tên
   - Lọc theo dịch vụ
   - Lọc theo khoảng cách (km)
   - Lọc theo đánh giá
   - Tìm kiếm nâng cao

2. 📱 ĐẶT LỊCH DỊCH VỤ
   - Chọn dịch vụ & biến thể
   - Chọn ngày giờ
   - Nhập địa chỉ
   - Xác nhận và thanh toán

3. 💬 CHAT TRỰC TIẾP
   - Nhắn tin với Tasker trước khi đặt lịch
   - Thương lượng giá
   - Trao đổi chi tiết công việc

4. 📝 BÁO GIÁ (QUOTES)
   - Tasker có thể gửi báo giá cho khách
   - Khách có thể chấp nhận hoặc thương lượng

5. ⭐ ĐÁNH GIÁ & REVIEW
   - Đánh giá 1-5 sao sau khi hoàn thành
   - Viết nhận xét
   - Kiểm duyệt nội dung tự động bằng AI

6. ❤️ WISHLIST (Yêu thích)
   - Lưu tasker yêu thích
   - Dễ dàng tìm lại sau

7. 🎬 VIDEO GIỚI THIỆU
   - Tasker upload video giới thiệu kỹ năng
   - Xem video trước khi đặt lịch

8. 📰 BLOG
   - Chia sẻ mẹo vệ sinh
   - Hướng dẫn sử dụng dịch vụ
   - Tin tức & cập nhật

=== THANH TOÁN ===
- 💳 Ví điện tử HomeHelper (nạp tiền vào tài khoản)
- 📱 MoMo
- Thanh toán an toàn, bảo mật

=== CHÍNH SÁCH HOÀN TIỀN (Khi khách hủy) ===
- Hủy trước >24 giờ: Hoàn 100%
- Hủy trước 12-24 giờ: Hoàn 75%
- Hủy trước 4-12 giờ: Hoàn 50%
- Hủy trước <4 giờ: Không hoàn tiền
- Tasker hủy đơn: Khách được hoàn 100%


=== HỆ THỐNG HUY HIỆU TASKER ===
- 🏆 Hoàn thành nhiều công việc
- ⭐ Đánh giá cao (4.5+ sao)
- ✅ Xác minh CCCD
- 📜 Có chứng chỉ chuyên môn
- 🎯 Không hủy đơn trong 30 ngày
- 🎥 Tạo video giới thiệu

=== ĐĂNG KÝ LÀM TASKER ===
Điều kiện:
1. Có tài khoản đã xác minh CCCD
2. Giới thiệu bản thân
3. Chọn dịch vụ muốn cung cấp
4. Upload chứng chỉ (nếu dịch vụ yêu cầu)
5. Upload video giới thiệu
6. Chờ Staff duyệt đơn

Dịch vụ YÊU CẦU chứng chỉ:
- Chăm sóc người già & bệnh nhân
- Chăm sóc trẻ em

=== LIÊN HỆ HỖ TRỢ ===
- Email: support@homehelper.vn
- Hotline: 1900-xxxx
- Địa chỉ: TP. Hồ Chí Minh, Việt Nam
- Facebook, Instagram, Twitter: @HomeHelper

=== QUY TẮC TRẢ LỜI ===
1. Trả lời bằng tiếng Việt, thân thiện và chuyên nghiệp
2. Sử dụng emoji phù hợp để tạo cảm giác thân thiện
3. Nếu không chắc chắn về giá cụ thể, hướng dẫn xem chi tiết trên website hoặc liên hệ hỗ trợ
4. Không trả lời các câu hỏi không liên quan đến HomeHelper hoặc dịch vụ gia đình
5. Giữ câu trả lời ngắn gọn, dễ hiểu (dưới 300 từ)
6. Nếu câu hỏi cần thông tin cá nhân (đơn hàng cụ thể), hướng dẫn đăng nhập hoặc liên hệ hotline
7. Khuyến khích người dùng sử dụng dịch vụ một cách tự nhiên
`;

async function chatbotResponse(userMessage, conversationHistory = []) {
  if (!GEMINI_API_KEY) throw new Error("Missing Gemini API key");

  // Validate input
  if (!userMessage || typeof userMessage !== 'string') {
    throw new Error("Tin nhắn không hợp lệ");
  }

  const trimmedMessage = userMessage.trim();
  if (trimmedMessage.length === 0) {
    throw new Error("Tin nhắn không được để trống");
  }

  if (trimmedMessage.length > 1000) {
    throw new Error("Tin nhắn quá dài (tối đa 1000 ký tự)");
  }

  // Build conversation contents
  const contents = [];

  // Add system context as first message
  contents.push({
    role: "user",
    parts: [{ text: WEBSITE_CONTEXT + "\n\nBắt đầu cuộc hội thoại. Hãy chào đón người dùng." }]
  });
  contents.push({
    role: "model",
    parts: [{ text: "Xin chào! 👋 Tôi là trợ lý AI của HomeHelper - nền tảng kết nối dịch vụ gia đình hàng đầu!\n\nTôi có thể giúp bạn:\n🔍 Tìm hiểu về các dịch vụ (dọn dẹp, nấu ăn, chăm sóc người già, trẻ em...)\n📅 Hướng dẫn đặt lịch\n💰 Giải đáp về giá cả & thanh toán\n🏆 Thông tin chương trình thành viên\n\nBạn cần hỗ trợ gì ạ?" }]
  });

  // Add conversation history (limit to last 10 messages to save tokens)
  const recentHistory = conversationHistory.slice(-10);
  for (const msg of recentHistory) {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    });
  }

  // Add current user message
  contents.push({
    role: "user",
    parts: [{ text: trimmedMessage }]
  });

  const logDir = path.join(__dirname, "logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, "chatbot.log");

  try {
    const response = await axios.post(
      `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
      {
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 500,
          topP: 0.9,
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        ]
      },
      { headers: { "Content-Type": "application/json" }, timeout: 30000 }
    );

    const aiResponse = response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!aiResponse) {
      throw new Error("Không nhận được phản hồi từ AI");
    }

    // Log conversation
    fs.appendFileSync(
      logFile,
      `\n[${new Date().toISOString()}]\nUSER: ${trimmedMessage}\nAI: ${aiResponse}\n${'='.repeat(50)}\n`
    );

    return {
      success: true,
      message: aiResponse,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error("🔴 Chatbot API error:", error.message);
    console.error("🔴 Error details:", error.response?.data || error);
    
    fs.appendFileSync(
      logFile,
      `\n[${new Date().toISOString()}] ERROR: ${error.message}\nUSER_MSG: ${trimmedMessage}\nDETAILS: ${JSON.stringify(error.response?.data || {})}\n`
    );

    // Handle specific errors
    if (error.response?.status === 429) {
      throw new Error("Hệ thống đang bận, vui lòng thử lại sau ít phút");
    }
    if (error.code === 'ECONNABORTED') {
      throw new Error("Kết nối quá lâu, vui lòng thử lại");
    }
    if (error.message?.includes('Missing Gemini API key')) {
      throw new Error("Chưa cấu hình API key");
    }

    throw new Error(error.message || "Có lỗi xảy ra, vui lòng thử lại sau");
  }
}

module.exports = {
  moderateContent,
  processReview,
  extractCertificateFromUrl,
  moderateVideoText,
  chatbotResponse
};

