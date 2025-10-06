const axios = require('axios');
const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent';

async function moderateContent(text) {
  if (!GEMINI_API_KEY) throw new Error('Missing Gemini API key');

  const prompt = `Bạn là bộ lọc kiểm duyệt tiếng Việt. Nếu nội dung sau có bất kỳ từ ngữ tục tĩu, chửi bậy, xúc phạm, bạo lực, phân biệt, hãy trả về đúng một từ duy nhất là BAD. Nếu hoàn toàn sạch, trả về đúng một từ duy nhất là OK. Không giải thích, không thêm gì khác. Nội dung: \n"${text}"`;

  // Đảm bảo thư mục logs tồn tại
  const logDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logFile = path.join(logDir, 'gemini_moderation.log');

  try {
    const response = await axios.post(
      `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
      {
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt }
            ]
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const result = response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase();
    fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] INPUT: ${text}\nRESULT: ${result}\n`);

    if (result === 'OK') return true;
    if (result === 'BAD') return false;
    return false;
  } catch (error) {
    fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] ERROR: ${error.message}\nRESPONSE: ${JSON.stringify(error.response?.data)}\n`);
    return false;
  }
}

module.exports = { moderateContent };

// -------- Certificate Extraction (multimodal) --------
const axios2 = axios; // reuse
const os = require('os');
const { v4: uuidv4 } = require('uuid');
let pdf2imgAvailable = false;
let PDFImage;
try {
  PDFImage = require('pdf-image').PDFImage; // optional dependency
  pdf2imgAvailable = true;
} catch (_) { /* optional */ }

async function downloadToTemp(url) {
  const tempDir = path.join(os.tmpdir(), 'homehelper_cert');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const ext = path.extname(url).split('?')[0] || '.bin';
  const filePath = path.join(tempDir, uuidv4() + ext);
  const writer = fs.createWriteStream(filePath);
  const response = await axios2.get(url, { responseType: 'stream' });
  await new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
  return filePath;
}

async function convertPdfFirstPageToPng(pdfPath) {
  if (!pdf2imgAvailable) throw new Error('PDF to image converter not installed');
  const pdfImage = new PDFImage(pdfPath, { convertOptions: { '-resize': '1500x1500' } });
  const imagePath = await pdfImage.convertPage(0);
  return imagePath;
}

function extractJSON(str) {
  // Attempt to isolate JSON block
  const first = str.indexOf('{');
  const last = str.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    const candidate = str.substring(first, last + 1);
    try { return JSON.parse(candidate); } catch (_) { /* ignore */ }
  }
  try { return JSON.parse(str); } catch { return null; }
}

function normalizeDate(raw) {
  if (!raw) return null;
  const monthMap = {
    january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,
    jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12
  };
  // Vietnamese month words mapping if model returns (hiếm)
  const viMonthMap = {
    'tháng 1':1,'tháng 2':2,'tháng 3':3,'tháng 4':4,'tháng 5':5,'tháng 6':6,'tháng 7':7,'tháng 8':8,'tháng 9':9,'tháng 10':10,'tháng 11':11,'tháng 12':12
  };
  const cleaned = raw
    .replace(/Ngày\s+/i,'')
    .replace(/ngày\s+/i,'')
    .replace(/tháng\s+/ig, m => m.toLowerCase())
    .replace(/năm\s+/i,'');
  const trials = [raw, cleaned, raw.replace(/\./g,' '), cleaned.replace(/\./g,' ')];
  for (const t of trials) {
    // dd/mm/yyyy or dd-mm-yyyy
    const m1 = t.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
    if (m1) {
      let [ , d, M, y ] = m1; if (y.length === 2) y = (parseInt(y,10) > 50 ? '19'+y : '20'+y); return `${y.padStart(4,'0')}-${M.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
    // dd Month yyyy (English)
    const m2 = t.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d{4})\b/i);
    if (m2) {
      const d = m2[1]; const mon = monthMap[m2[2].toLowerCase()]; const y = m2[3];
      if (mon) return `${y}-${String(mon).padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
    // Vietnamese pattern: dd mm yyyy OR dd tháng X yyyy
    const m3 = t.match(/\b(\d{1,2})\s+(tháng\s+)?(\d{1,2})\s+(\d{4})\b/i);
    if (m3) {
      const d = m3[1]; const M = m3[3]; const y = m3[4];
      return `${y}-${String(M).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
    // Pattern: dd (tháng X) năm yyyy
    const m4 = t.match(/\b(\d{1,2})\s+(tháng\s+\d{1,2})\s+năm\s+(\d{4})\b/i);
    if (m4) {
      const d = m4[1]; const monPhrase = m4[2].toLowerCase(); const y = m4[3];
      const mon = viMonthMap[monPhrase]; if (mon) return `${y}-${String(mon).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
  }
  return null;
}

async function extractCertificateFromUrl(certUrl) {
  if (!GEMINI_API_KEY) throw new Error('Missing Gemini API key');
  const local = await downloadToTemp(certUrl);
  let imagePath = local;
  if (/\.pdf$/i.test(local)) {
    try { imagePath = await convertPdfFirstPageToPng(local); } catch (e) { throw new Error('PDF convert failed: '+e.message); }
  }
  const buffer = fs.readFileSync(imagePath);
  const b64 = buffer.toString('base64');
  const prompt = `Bạn là hệ thống trích xuất dữ liệu chứng chỉ (song ngữ Việt/Anh). Hãy phân tích ảnh và TRẢ VỀ DUY NHẤT một JSON theo schema:
{
  "cert_name":"",          // Tiêu đề đầy đủ của chứng chỉ. Nếu tiêu đề chính quá chung chung (ví dụ: "CHỨNG CHỈ", "CHỨNG CHỈ ĐÀO TẠO", "CERTIFICATE") thì PHẢI ghép thêm dấu " – " rồi đến tên chuyên ngành/chương trình đào tạo (tiếng Việt). Nếu có bản tiếng Anh của chuyên ngành (ví dụ Elderly Care) thì thêm vào cuối trong ngoặc đơn. Ví dụ cuối cùng: "Chứng chỉ đào tạo – Chăm sóc người cao tuổi (Elderly Care)"
  "issued_by":"",
  "issued_date_raw":"",
  "issued_date_iso":"",    // YYYY-MM-DD nếu suy ra được
  "holder_name":"",
  "level_or_grade":"",     // cấp độ / loại nếu có
  "certificate_code":"",   // Số hiệu / mã nếu có
  "graduation_date_raw":"",
  "language":"vi",
  "confidence":0.0
}
YÊU CẦU:
- Không giải thích ngoài JSON.
- Nếu có cả cụm "Chăm sóc người cao tuổi" và "Elderly Care" hãy chuẩn hóa như hướng dẫn ở cert_name.
- Giữ nguyên chữ thường/hoa hợp lý: chỉ viết hoa chữ cái đầu mỗi từ tiếng Việt trong cert_name (trừ từ nối), không toàn bộ in HOA.
`;
  const body = {
    contents: [
      { role: 'user', parts: [ { inline_data: { mime_type: 'image/png', data: b64 } }, { text: prompt } ] }
    ]
  };
  const { data } = await axios2.post(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, body, { headers: { 'Content-Type':'application/json' } });
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const json = extractJSON(raw) || {};
  let iso = json.issued_date_iso || normalizeDate(json.issued_date_raw);
  let dateLineTried = null;
  // Fallback: scan raw text if iso still null
  if (!iso && raw) {
    dateLineTried = raw.split(/\n|\\n/).find(l => /(Ngày|ngày)/.test(l) || /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/.test(l));
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
    confidence: typeof json.confidence === 'number' ? json.confidence : null
  };

  try {
    const genericPatterns = [
      /^chứng\s*chỉ\s*đào\s*tạo$/i,
      /^chứng\s*chỉ$/i,
      /^certificate$/i
    ];
    const lowerRaw = raw.toLowerCase();
    const programVi = /chăm\s*sóc\s*người\s*cao\s*tuổi/i.test(lowerRaw) ? 'Chăm sóc người cao tuổi' : null;
    const programEn = /elderly\s*care/i.test(lowerRaw) ? 'Elderly Care' : null;
    if (parsed.cert_name && genericPatterns.some(p=>p.test(parsed.cert_name.trim()))) {
      if (programVi) {
        parsed.cert_name = `Chứng chỉ đào tạo – ${programVi}${programEn?` (${programEn})`:''}`;
      }
    }
  } catch (_) { /* ignore heuristic errors */ }

  if (process.env.DEBUG_CERT_AI === '1') {
    try {
      const logDir = path.join(__dirname, 'logs');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const logFile = path.join(logDir, 'certificate_extraction.log');
      const logEntry = `\n[${new Date().toISOString()}]\nURL: ${certUrl}\nRAW(JSON?): ${raw.substring(0,2000)}\nissued_date_raw(JSON): ${json.issued_date_raw}\nHeuristic dateLine: ${dateLineTried}\nFinal ISO: ${parsed.issued_date_iso}\nParsed Name: ${parsed.cert_name}\n`; 
      fs.appendFileSync(logFile, logEntry);
      console.log('🧪 CERT_AI_LOG:', { certUrl, dateRaw: json.issued_date_raw, dateLineTried, finalISO: parsed.issued_date_iso });
    } catch (e) { /* ignore logging errors */ }
  }

  return { rawText: raw, parsed };
}

module.exports.extractCertificateFromUrl = extractCertificateFromUrl;