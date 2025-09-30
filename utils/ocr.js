const { createWorker } = require('tesseract.js');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const PythonOCRService = require('./pythonOcr');
require('dotenv').config();
let visionClient = null;
try {
  // Allow injecting JSON creds via env GVISION_JSON, or use GOOGLE_APPLICATION_CREDENTIALS path from env/.env
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.GVISION_JSON) {
    const credDir = path.join('uploads', 'cccd', 'tmp');
    if (!fs.existsSync(credDir)) fs.mkdirSync(credDir, { recursive: true });
    const credPath = path.join(credDir, 'gvision.env.json');
    fs.writeFileSync(credPath, process.env.GVISION_JSON, { encoding: 'utf8' });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(credPath);
  }

  const vision = require('@google-cloud/vision');
  const visionDisabled = String(process.env.DISABLE_VISION || '').toLowerCase() === 'true' || String(process.env.VISION_ENABLED || 'true').toLowerCase() === 'false';
  const hasCreds = !!process.env.GOOGLE_APPLICATION_CREDENTIALS || !!process.env.GVISION_JSON;
  if (!visionDisabled && hasCreds) {
    visionClient = new vision.ImageAnnotatorClient();
  }
} catch (_) {
  visionClient = null;
}

async function preprocessForOCR(inputPath) {
  const tmpDir = path.join('uploads', 'cccd', 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const outPath = path.join(tmpDir, `${Date.now()}_ocr.png`);
  
  try {
    // Get image metadata first
    const metadata = await sharp(inputPath).metadata();
    console.log(`Preprocessing image: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);
    
    // Calculate optimal target size for OCR
    const targetWidth = Math.max(2400, metadata.width * 4); // Even larger for better accuracy
    const targetHeight = Math.round(targetWidth * metadata.height / metadata.width);
    
    console.log(`Target size: ${targetWidth}x${targetHeight}`);
    
    // Multi-step preprocessing pipeline for maximum OCR accuracy
    await sharp(inputPath)
      .rotate() // Auto-rotate based on EXIF data
      .resize({ 
        width: targetWidth,
        height: targetHeight,
        withoutEnlargement: false,
        kernel: sharp.kernel.lanczos3 // Best interpolation for text
      })
      .removeAlpha() // Remove alpha channel if present
      .grayscale() // Convert to grayscale
      .normalize({ lower: 1, upper: 99 }) // Extreme contrast enhancement
      .linear(2.5, -40) // Strong brightness/contrast adjustment
      .sharpen({ 
        sigma: 3.0, 
        m1: 1.5, 
        m2: 7.0, 
        x1: 4.0, 
        y2: 20.0 
      }) // Maximum sharpening for text clarity
      .threshold(110) // Lower threshold for better text capture
      .png({ 
        quality: 100, 
        compressionLevel: 0,
        adaptiveFiltering: false,
        force: true
      }) // Save as high-quality PNG
      .toFile(outPath);
    
    console.log(`✅ Preprocessed image saved to: ${outPath}`);
    return outPath;
  } catch (e) {
    console.error('❌ Image preprocessing failed:', e);
    return inputPath;
  }
}

const FRONT_TEMPLATE_V1 = [
  // Adjusted coordinates for smaller images (625x399)
  { key: 'number', left: 0.35, top: 0.25, width: 0.60, height: 0.10 },      // Số/No field - wider area
  { key: 'full_name', left: 0.35, top: 0.38, width: 0.60, height: 0.10 },   // Họ và tên/Full name
  { key: 'dob', left: 0.35, top: 0.50, width: 0.30, height: 0.08 },         // Ngày sinh/Date of birth
  { key: 'gender', left: 0.65, top: 0.50, width: 0.20, height: 0.08 },      // Giới tính/Sex
  { key: 'nationality', left: 0.35, top: 0.60, width: 0.30, height: 0.08 }, // Quốc tịch/Nationality
  { key: 'place_of_origin', left: 0.35, top: 0.70, width: 0.60, height: 0.10 }, // Quê quán/Place of origin
  { key: 'place_of_residence', left: 0.35, top: 0.82, width: 0.60, height: 0.15 }, // Nơi thường trú/Place of residence
  { key: 'expiry_date', left: 0.35, top: 0.95, width: 0.30, height: 0.08 }, // Có giá trị đến/Date of expiry
];

// Validate ROI coordinates to prevent bad extract area errors
function validateROI(roi, imageWidth, imageHeight) {
  const { left, top, width, height } = roi;
  
  // Check if normalized coordinates are valid (0-1 range)
  if (left < 0 || left >= 1 || top < 0 || top >= 1 || 
      width <= 0 || width > 1 || height <= 0 || height > 1) {
    console.error(`Invalid normalized ROI coordinates: ${JSON.stringify(roi)}`);
    return false;
  }
  
  // Check if ROI extends beyond image bounds
  if (left + width > 0.99 || top + height > 0.99) {
    console.error(`ROI extends beyond image bounds: ${JSON.stringify(roi)}`);
    return false;
  }
  
  // Convert to pixel coordinates and validate
  const pixelLeft = Math.round(left * imageWidth);
  const pixelTop = Math.round(top * imageHeight);
  const pixelWidth = Math.round(width * imageWidth);
  const pixelHeight = Math.round(height * imageHeight);
  
  // Ensure minimum size for OCR (at least 20x10 pixels)
  if (pixelWidth < 20 || pixelHeight < 10) {
    console.error(`ROI too small for OCR: ${pixelWidth}x${pixelHeight} pixels`);
    return false;
  }
  
  // Final bounds check
  if (pixelLeft < 0 || pixelTop < 0 || 
      pixelLeft + pixelWidth > imageWidth || 
      pixelTop + pixelHeight > imageHeight) {
    console.error(`ROI pixel coordinates out of bounds: ${pixelLeft},${pixelTop},${pixelWidth},${pixelHeight} (image: ${imageWidth}x${imageHeight})`);
    return false;
  }
  
  return true;
}

async function ocrByRegions(imagePath, regions) {
  const img = sharp(imagePath).rotate();
  const meta = await img.metadata();
  const imgW = meta.width || 0;
  const imgH = meta.height || 0;
  const out = {};
  const tmpDir = path.join('uploads', 'cccd', 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  
  console.log(`Processing image: ${imagePath} (${imgW}x${imgH})`);
  
  for (const r of regions) {
    try {
      // Validate ROI before processing
      if (!validateROI(r, imgW, imgH)) {
        console.warn(`Skipping invalid ROI: ${r.key}`);
        out[r.key] = '';
        continue;
      }
      
      let left = Math.round((r.left || 0) * imgW);
      let top = Math.round((r.top || 0) * imgH);
      let width = Math.round((r.width || 1) * imgW);
      let height = Math.round((r.height || 1) * imgH);

      // Additional safety clamping with buffer
      left = Math.max(1, Math.min(left, imgW - width - 1));
      top = Math.max(1, Math.min(top, imgH - height - 1));
      width = Math.max(20, Math.min(width, imgW - left - 1));
      height = Math.max(10, Math.min(height, imgH - top - 1));

      console.log(`Processing ROI ${r.key}: ${left},${top},${width},${height}`);

      const buf = await img.extract({ left, top, width, height }).toBuffer();
      const tmp = path.join(tmpDir, `${Date.now()}_${r.key}.png`);
      await sharp(buf).grayscale().threshold(165).toFile(tmp);
      const text = await ocrImageToText(tmp);
      
      // Debug: Log extracted text for each ROI
      console.log(`ROI ${r.key} extracted text: "${text}"`);
      
      try { fs.unlinkSync(tmp); } catch (_) {}
      out[r.key] = text;
    } catch (e) {
      console.warn('ROI OCR skip due to area error:', r, e.message);
      out[r.key] = '';
    }
  }
  // If no text was extracted from any ROI, try full image OCR as fallback
  const hasAnyText = Object.values(out).some(text => text && text.trim().length > 0);
  if (!hasAnyText) {
    console.log('No text extracted from ROIs, trying full image OCR...');
    try {
      const fullImageText = await ocrImageToText(imagePath);
      console.log('Full image OCR result:', fullImageText.substring(0, 200) + '...');
      
      // Try to extract specific fields from full text using regex patterns
      const patterns = {
        number: /(?:Số|No)[\s:]*(\d{12})/i,
        full_name: /(?:Họ\s+và\s+tên|Full\s+name)[\s:]*([A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ\s]+)/i,
        dob: /(?:Ngày\s+sinh|Date\s+of\s+birth)[\s:]*(\d{2}\/\d{2}\/\d{4})/i,
        gender: /(?:Giới\s+tính|Sex)[\s:]*([Nn]am|[Nn]ữ|Male|Female)/i,
        nationality: /(?:Quốc\s+tịch|Nationality)[\s:]*([^\n]+)/i,
        place_of_origin: /(?:Quê\s+quán|Place\s+of\s+origin)[\s:]*([^\n]+)/i,
        place_of_residence: /(?:Nơi\s+thường\s+trú|Place\s+of\s+residence)[\s:]*([^\n]+)/i,
        expiry_date: /(?:Có\s+giá\s+trị\s+đến|Date\s+of\s+expiry)[\s:]*(\d{2}\/\d{2}\/\d{4})/i,
      };
      
      for (const [key, pattern] of Object.entries(patterns)) {
        const match = fullImageText.match(pattern);
        if (match && match[1]) {
          out[key] = match[1].trim();
          console.log(`Extracted ${key} from full text: "${out[key]}"`);
        }
      }
    } catch (e) {
      console.error('Full image OCR fallback failed:', e);
    }
  }
  
  return out;
}

function normalizeVietnameseName(s) {
  if (!s) return '';
  // Remove label if OCR included it
  s = s.replace(/Họ\s*và\s*tên\s*[:]?/iu, '');
  // Collapse spaces and uppercase words
  return s.replace(/\s+/g, ' ').trim();
}

// New function using Python OCR
async function extractFieldsByPythonOCR(frontPath, backPath) {
  try {
    const pythonOCR = new PythonOCRService();
    
    // Check if Python service is available
    const isHealthy = await pythonOCR.healthCheck();
    if (!isHealthy) {
      console.log('Python OCR service not available, falling back to Tesseract');
      return await extractFieldsByTemplate(frontPath, backPath);
    }

    console.log('Using Python OCR service for better accuracy...');
    const result = await pythonOCR.extractFields(frontPath, backPath);
    
    if (result.success) {
      console.log('✅ Python OCR extraction successful');
      return {
        front: result.extracted,
        back: {}, // Python OCR handles both front and back
        source: 'python_ocr',
        rawData: result.rawData
      };
    } else {
      console.log('❌ Python OCR failed, falling back to Tesseract:', result.error);
      return await extractFieldsByTemplate(frontPath, backPath);
    }
    
  } catch (error) {
    console.error('Python OCR error:', error.message);
    console.log('Falling back to Tesseract OCR...');
    return await extractFieldsByTemplate(frontPath, backPath);
  }
}

async function extractFieldsByTemplate(frontPath, backPath) {
  const frontTexts = await ocrByRegions(frontPath, FRONT_TEMPLATE_V1);
  const mrzCropped = await cropBackMrzRegion(backPath);
  const backText = await ocrImageToText(mrzCropped);

  // Parse from targeted ROIs
  const parsedFront = {
    number: (frontTexts.number || '').match(/\d{9,12}/)?.[0] || '',
    full_name: normalizeVietnameseName(frontTexts.full_name || ''),
    dob: (frontTexts.dob || '').match(/\d{2}[\/-]\d{2}[\/-]\d{4}/)?.[0] || '',
    gender: /Nam/i.test(frontTexts.gender || '') ? 'Nam' : (/Nữ|Nu/i.test(frontTexts.gender || '') ? 'Nữ' : ''),
    nationality: /Vi[eệ]t\s*Nam/i.test(frontTexts.nationality || '') ? 'Việt Nam' : (frontTexts.nationality || ''),
    place_of_origin: (frontTexts.place_of_origin || '').replace(/Qu[eê]\s*qu[aá]n\s*[:]?/iu, '').replace(/\s+/g, ' ').trim(),
    place_of_residence: (frontTexts.place_of_residence || '').replace(/N[ơo]i\s*th[uư][ơo]ng\s*tr[uú]\s*[:]?/iu, '').replace(/\s+/g, ' ').trim(),
  };

  // Broad fallback block (center-right) to parse by labels if any field missing
  const needsFallback = !parsedFront.full_name || !parsedFront.dob || !parsedFront.gender || !parsedFront.nationality;
  if (needsFallback) {
    const meta = await sharp(frontPath).metadata();
    const left = Math.round(0.36 * (meta.width || 0));
    const top = Math.round(0.28 * (meta.height || 0));
    const width = Math.round(0.60 * (meta.width || 0));
    const height = Math.round(0.62 * (meta.height || 0));
    const tmp = path.join('uploads', 'cccd', 'tmp', `${Date.now()}_front_block.png`);
    await sharp(frontPath).extract({ left, top, width, height }).grayscale().threshold(165).toFile(tmp);
    const blockText = await ocrImageToText(tmp);
    try { fs.unlinkSync(tmp); } catch (_) {}

    const nameM = blockText.match(/Họ\s*và\s*tên\s*[:]?\s*([^\n]+)/iu);
    const dobM = blockText.match(/Ng[aà]y\s*sinh\s*[:]?\s*(\d{2}[\/-]\d{2}[\/-]\d{4})/iu);
    const genM = blockText.match(/Gi[ơo]i\s*t[íi]nh\s*[:]?\s*(Nam|Nữ)/iu);
    const natM = blockText.match(/Qu[ốo]c\s*t[ịi]ch\s*[:]?\s*(Vi[eệ]t\s*Nam)/iu);

    parsedFront.full_name = parsedFront.full_name || normalizeVietnameseName(nameM?.[1] || '');
    parsedFront.dob = parsedFront.dob || (dobM?.[1] || '');
    parsedFront.gender = parsedFront.gender || (genM?.[1] || '');
    parsedFront.nationality = parsedFront.nationality || (natM?.[1] || '');
  }

  // Last resort: OCR toàn bộ mặt trước và parse theo label đầu dòng như bạn yêu cầu
  if (!parsedFront.full_name || !parsedFront.dob || !parsedFront.gender) {
    const pre = await preprocessForOCR(frontPath);
    const text = await ocrImageToText(pre);
    try { if (pre !== frontPath) fs.unlinkSync(pre); } catch(_) {}
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (!parsedFront.full_name && /^Họ\s*và\s*tên/i.test(ln)) {
        parsedFront.full_name = normalizeVietnameseName(ln.replace(/^Họ\s*và\s*tên\s*[:]?/i, '')) || normalizeVietnameseName(lines[i+1] || '');
      }
      if (!parsedFront.dob && /^Ng[aà]y\s*sinh/i.test(ln)) {
        parsedFront.dob = (ln.match(/\d{2}[\/-]\d{2}[\/-]\d{4}/) || [])[0] || (lines[i+1]?.match(/\d{2}[\/-]\d{2}[\/-]\d{4}/) || [])[0] || '';
      }
      if (!parsedFront.gender && /^Gi[ơo]i\s*t[íi]nh/i.test(ln)) {
        parsedFront.gender = /Nam/i.test(ln) ? 'Nam' : (/Nữ|Nu/i.test(ln) ? 'Nữ' : '');
      }
    }
  }

  const parsedBack = parseVietnamIdCardText(backText);
  return { front: parsedFront, back: parsedBack };
}
async function ocrImageToText(imagePath) {
  try {
    const worker = await createWorker();
    let bestResult = { text: '', confidence: 0 };
    
    // Multiple OCR attempts with different configurations
    const ocrConfigs = [
      {
        name: 'Vietnamese + High Accuracy',
        config: {
          language: 'vie',
          tessedit_pageseg_mode: '6',
          tessedit_ocr_engine_mode: '1',
          tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐabcdefghijklmnopqrstuvwxyzàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗờớợởỡùúụủũưừứựửữỳýỵỷỹđ /-:',
          preserve_interword_spaces: 1
        }
      },
      {
        name: 'Vietnamese + English',
        config: {
          language: 'vie+eng',
          tessedit_pageseg_mode: '6',
          tessedit_ocr_engine_mode: '1',
          preserve_interword_spaces: 1
        }
      },
      {
        name: 'English Only',
        config: {
          language: 'eng',
          tessedit_pageseg_mode: '6',
          tessedit_ocr_engine_mode: '1',
          preserve_interword_spaces: 1
        }
      },
      {
        name: 'Auto Page Segmentation',
        config: {
          language: 'vie',
          tessedit_pageseg_mode: '3',
          tessedit_ocr_engine_mode: '1'
        }
      }
    ];
    
    // Try direct OCR first
    console.log('🔍 Attempting direct OCR...');
    for (const ocrConfig of ocrConfigs) {
      try {
        console.log(`  Trying: ${ocrConfig.name}`);
        const { data } = await worker.recognize(imagePath, ocrConfig.config);
        
        if (data.text && data.text.trim().length > 0 && data.confidence > bestResult.confidence) {
          bestResult = { text: data.text, confidence: data.confidence };
          console.log(`  ✅ ${ocrConfig.name}: confidence ${data.confidence}, length ${data.text.length}`);
        }
      } catch (e) {
        console.log(`  ❌ ${ocrConfig.name} failed: ${e.message}`);
      }
    }
    
    await worker.terminate();
    
    // If we got a good result, return it
    if (bestResult.confidence > 50 && bestResult.text.trim().length > 10) {
      console.log(`✅ Best direct OCR result: confidence ${bestResult.confidence}`);
      return bestResult.text;
    }
    
    // Fallback to preprocessing
    console.log('🔄 Trying with enhanced preprocessing...');
    const preprocessed = await preprocessForOCR(imagePath);
    const worker2 = await createWorker();
    
    try {
      const { data } = await worker2.recognize(preprocessed, {
        language: 'vie',
      tessedit_pageseg_mode: '6',
        tessedit_ocr_engine_mode: '1',
        preserve_interword_spaces: 1
      });
      
      console.log(`✅ Preprocessed OCR: confidence ${data.confidence}, length ${data.text.length}`);
      
      // Return the better result
      if (data.confidence > bestResult.confidence && data.text.trim().length > 0) {
        return data.text;
      } else {
        return bestResult.text || data.text || '';
      }
      
    } catch (preprocessError) {
      console.error('❌ Preprocessed OCR failed:', preprocessError.message);
      return bestResult.text || '';
  } finally {
      try { await worker2.terminate(); } catch (_) {}
    if (preprocessed !== imagePath) {
      try { fs.unlinkSync(preprocessed); } catch (_) {}
    }
    }
    
  } catch (err) {
    console.error('❌ OCR error:', err);
    return '';
  }
}

function parseVietnamIdCardText(text) {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const normalized = text.replace(/\r?\n/g, '\n');

  console.log('🔍 Parsing text:', text.substring(0, 200) + '...');

  // Enhanced pattern matching for better accuracy
  const patterns = {
    // CCCD Number - more flexible patterns
    number: [
      /\b(0\d{11})\b/, // Standard 12-digit CCCD
      /\b(\d{9,12})\b/, // General number pattern
      /Số\s*[:]?\s*(\d{9,12})/i,
      /No\s*[:]?\s*(\d{9,12})/i,
      /séine\s*[:]?\s*(\d{9,12})/i,
      /sé\/n0\s*[:]?\s*(\d{9,12})/i // OCR often reads "sé/n0" instead of "Số/No"
    ],
    
    // Full Name - improved patterns
    full_name: [
      /Ho\s*va\s*ten\s*[:]?\s*([A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ\s]+?)(?=\n|INgay|Giditinh|$)/iu, // OCR reads "Ho va ten" - stop at next field
      /Họ\s*và\s*tên\s*[:]?\s*([A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ\s]+?)(?=\n|INgay|Giditinh|$)/iu,
      /Full\s*name\s*[:]?\s*([A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ\s]+?)(?=\n|INgay|Giditinh|$)/iu,
      /([A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]{3,}\s+[A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]{3,})/u
    ],
    
    // Date of Birth - improved patterns
    dob: [
      /Ng[aà]y\s*sinh\s*[:]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/i,
      /Date\s*of\s*birth\s*[:]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/i,
      /Ngay\s*sinh\s*[:]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/i, // OCR reads "Ngay sinh"
      /INgay\s*sinh\s*[:]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/i, // OCR reads "INgay sinh"
      /(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/ // General date pattern
    ],
    
    // Gender - improved patterns
    gender: [
      /Gi[oơ]i\s*t[ií]nh\s*[:]?\s*([Nn]am|[Nn]ữ)/i,
      /Sex\s*[:]?\s*(Male|Female|[Nn]am|[Nn]ữ)/i,
      /Giditinh\s*[:]?\s*([Nn]am|[Nn]ữ)/i, // OCR reads "Giditinh"
      /([Nn]am|[Nn]ữ)\s*Qu[oô][cđ]c/i // "Nam Quốc" pattern
    ],
    
    // Nationality
    nationality: [
      /Qu[oô][cđ]c\s*t[ịi]ch\s*[:]?\s*([^\n]+?)(?=\n|Qué|Noi|$)/i,
      /Nationality\s*[:]?\s*([^\n]+?)(?=\n|Qué|Noi|$)/i,
      /Quéc\s*tich\s*[:]?\s*([^\n]+?)(?=\n|Qué|Noi|$)/i, // OCR reads "Quéc tich"
      /(Vi[eệ]t\s*Nam)/i,
      /(Vigt\s*Nam)/i // OCR reads "Vigt Nam"
    ],
    
    // Place of Origin
    place_of_origin: [
      /Qu[eê]\s*qu[aá]n\s*[:]?\s*([^\n]+)/i,
      /Place\s*of\s*origin\s*[:]?\s*([^\n]+)/i,
      /Qué\s*quan\s*[:]?\s*([^\n]+)/i // OCR reads "Qué quan"
    ],
    
    // Place of Residence
    place_of_residence: [
      /N[oơ][iì]\s*th[uư][oơ]ng\s*tr[uú]\s*[:]?\s*([^\n]+)/i,
      /Place\s*of\s*residence\s*[:]?\s*([^\n]+)/i,
      /Noi\s*thisémg\s*tri\s*[:]?\s*([^\n]+)/i // OCR reads "Noi thisémg tri"
    ],
    
    // Expiry Date
    expiry_date: [
      /Có\s*giá\s*trị\s*đến\s*[:]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/i,
      /Date\s*of\s*expiry\s*[:]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/i,
      /Co\s*gia\s*tri\s*den\s*[:]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/i // OCR reads "Co gia tri den"
    ]
  };

  const result = {};

  // Extract each field using multiple patterns
  Object.entries(patterns).forEach(([field, patternList]) => {
    for (const pattern of patternList) {
      const match = normalized.match(pattern);
      if (match && match[1]) {
        let value = match[1].trim();
        
        // Clean and validate the extracted value
        if (field === 'number') {
          value = value.replace(/\D/g, ''); // Keep only digits
          if (value.length >= 9 && value.length <= 12) {
            result[field] = value;
            console.log(`✅ Extracted ${field}: ${value}`);
            break;
          }
        } else if (field === 'dob') {
          // Validate date format
          if (/\d{1,2}[\/-]\d{1,2}[\/-]\d{4}/.test(value)) {
            result[field] = value;
            console.log(`✅ Extracted ${field}: ${value}`);
            break;
          }
        } else if (field === 'gender') {
          // Normalize gender
          const normalizedGender = /nam/i.test(value) ? 'Nam' : (/nữ|nu/i.test(value) ? 'Nữ' : value);
          result[field] = normalizedGender;
          console.log(`✅ Extracted ${field}: ${normalizedGender}`);
          break;
        } else if (value.length > 2) {
          result[field] = clean(value);
          console.log(`✅ Extracted ${field}: ${clean(value)}`);
          break;
        }
      }
    }
    
    // If no match found, log it
    if (!result[field]) {
      console.log(`❌ Could not extract ${field}`);
    }
  });

  return {
    number: result.number || '',
    full_name: result.full_name || '',
    dob: result.dob || '',
    gender: result.gender || '',
    nationality: result.nationality || '',
    place_of_origin: result.place_of_origin || '',
    place_of_residence: result.place_of_residence || '',
    expiry_date: result.expiry_date || '',
  };
}

async function cropBackMrzRegion(inputPath) {
  try {
    const img = sharp(inputPath);
    const { width = 0, height = 0 } = await img.metadata();
    if (!width || !height) return inputPath;
    const mrzHeight = Math.round(height * 0.28); // bottom 28% where MRZ lives
    const top = height - mrzHeight - Math.round(height * 0.02); // little margin
    const left = Math.round(width * 0.05);
    const cropWidth = Math.round(width * 0.90);
    const outPath = inputPath.replace(/(\.[a-zA-Z]+)$/i, '_mrz$1');
    await img.extract({ left, top: Math.max(0, top), width: cropWidth, height: mrzHeight }).toFile(outPath);
    return outPath;
  } catch (_) {
    return inputPath;
  }
}

module.exports = {
  ocrImageToText,
  parseVietnamIdCardText,
  cropBackMrzRegion,
  extractFieldsByTemplate,
  extractFieldsByPythonOCR, // New Python OCR function
  ocrByRegions,
  visionClient,
};



