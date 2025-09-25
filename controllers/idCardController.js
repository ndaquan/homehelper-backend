const path = require('path');
const fs = require('fs');
const IDCard = require('../models/IDCard');
const { ocrImageToText, parseVietnamIdCardText, cropBackMrzRegion, extractFieldsByTemplate, extractFieldsByPythonOCR, visionClient } = require('../utils/ocr');
const { visionText, parseByLabelsVi } = require('../utils/vision');
const { extractFaceFromFront } = require('../utils/face');

function compareFields(input, parsed) {
  const normalize = (s) => (s || '').toString().trim().replace(/\s+/g, ' ').toLowerCase();
  const fields = ['number', 'full_name', 'dob', 'gender'];
  const result = {};
  let allMatch = true;
  for (const f of fields) {
    const match = normalize(input[f]) && normalize(parsed[f]) && normalize(input[f]) === normalize(parsed[f]);
    result[f] = !!match;
    if (!match) allMatch = false;
  }
  return { allMatch, details: result };
}

exports.submit = async (req, res, next) => {
  try {
    const userId = Number(req.body.user_id);
    const inputInfo = {
      number: req.body.number,
      full_name: req.body.full_name,
      dob: req.body.dob,
      gender: req.body.gender,
    };

    const front = req.files?.front?.[0];
    const back = req.files?.back?.[0];
    if (!front || !back) return res.status(400).json({ error: 'Thiếu ảnh CCCD mặt trước/mặt sau' });

    const uploadsDir = path.join('uploads', 'cccd');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const frontPath = front.path;
    const backPath = back.path;
    let facePath = path.join(uploadsDir, `face_${Date.now()}.jpg`);

    try {
      const extractedPath = await extractFaceFromFront(frontPath, facePath);
      // Only update facePath if extraction was successful
      if (extractedPath && extractedPath !== frontPath) {
        console.log(`Face extracted successfully to: ${facePath}`);
      } else {
        console.warn('Face extraction failed, using front image path');
        facePath = frontPath; // Fallback to front image
      }
    } catch (e) {
      console.error('Face extraction error:', e);
      facePath = frontPath; // Fallback to front image
    }

    let textFront = '';
    let textBack = '';
    try {
      if (visionClient) {
        const [frontText, backTextVision] = await Promise.all([
          visionText(frontPath),
          visionText(backPath),
        ]);
        const frontParsedVision = parseByLabelsVi(frontText);
        const backParsedVision = parseVietnamIdCardText(backTextVision);
        const parsedVision = { ...backParsedVision, ...frontParsedVision };
        textFront = frontText;
        textBack = backTextVision;
        // Use parsedVision directly if has number
        if (parsedVision.number) {
          req._parsedVision = parsedVision;
        }
      } else {
        const { front: tFront, back: tBack } = await extractFieldsByTemplate(frontPath, backPath);
        textFront = Object.values(tFront).join('\n');
        textBack = JSON.stringify(tBack);
      }
    } catch (e) {
      console.error('OCR run error:', e);
    }

    // Try Python OCR first, fallback to Tesseract
    let parsed = {};
    let ocrSource = 'tesseract';
    
    try {
      console.log('🔄 Attempting Python OCR...');
      const pythonResult = await extractFieldsByPythonOCR(frontPath, backPath);
      if (pythonResult.source === 'python_ocr') {
        parsed = pythonResult.front;
        ocrSource = 'python_ocr';
        console.log('✅ Using Python OCR results');
      } else {
        throw new Error('Python OCR not available');
      }
    } catch (error) {
      console.log('⚠️ Python OCR failed, using Tesseract:', error.message);
      // MRZ-first strategy: parse back MRZ reliably, then overlay any front fields we successfully got
      const { back: mrzOnly } = await extractFieldsByTemplate(frontPath, backPath);
      parsed = req._parsedVision ? { ...req._parsedVision } : { ...mrzOnly };
      ocrSource = 'tesseract';
    }

    // Normalize and sanitize number preference: parsed MRZ -> front -> user input (digits only)
    const digits = (val) => (val || '').toString().replace(/\D/g, '');
    const prefer12 = (val) => {
      const m = digits(val).match(/\d{9,12}/);
      return m ? m[0] : '';
    };
    const bodyNum = prefer12(req.body.number);
    const parsedNum = prefer12(parsed.number);
    parsed.number = parsedNum || bodyNum || '';
    // Overlay from template front if present
    try {
      const { front: frontTry } = await extractFieldsByTemplate(frontPath, backPath);
      Object.entries(frontTry).forEach(([k, v]) => {
        if (v && String(v).trim()) parsed[k] = v;
      });
    } catch (_) {}
    const finalNumber = parsed.number || inputInfo.number || '';
    parsed.number = finalNumber;

    const compare = compareFields(inputInfo, parsed);

    const record = await IDCard.create({
      user_id: userId,
      ...parsed,
      features: undefined,
      front_image_path: frontPath,
      back_image_path: backPath,
      face_image_path: facePath,
      ocr_text_front: textFront,
      ocr_text_back: textBack,
      verified: compare.allMatch,
    });

    await IDCard.updateVerification(userId, compare.allMatch, finalNumber);

    // Tính toán độ chính xác OCR
    const extractedFields = {
      number: parsed.number,
      full_name: parsed.full_name,
      dob: parsed.dob,
      gender: parsed.gender,
      nationality: parsed.nationality,
      place_of_origin: parsed.place_of_origin,
      place_of_residence: parsed.place_of_residence,
      expiry_date: parsed.issued_date || parsed.expiry_date
    };

    const fieldAccuracy = {};
    let totalAccuracy = 0;
    let filledFields = 0;

    Object.entries(extractedFields).forEach(([key, value]) => {
      const isFilled = value && value.trim().length > 0;
      fieldAccuracy[key] = {
        value: value,
        filled: isFilled,
        confidence: isFilled ? 'high' : 'low'
      };
      
      if (isFilled) {
        filledFields++;
        totalAccuracy += 100;
      }
    });

    const overallAccuracy = filledFields > 0 ? Math.round(totalAccuracy / Object.keys(extractedFields).length) : 0;

    res.status(200).json({
      success: true,
      message: 'Đã xử lý CCCD thành công',
      data: {
        parsed,
        compare,
        record: {
          id: record.id,
          user_id: record.user_id,
          verified: record.verified,
          created_at: record.created_at
        }
      },
      ocrResults: {
        extractedFields,
        fieldAccuracy,
        overallAccuracy,
        rawText: {
          frontText: textFront,
          backText: textBack
        },
        processingInfo: {
          usedVision: !!req._parsedVision,
          ocrSource: ocrSource,
          frontTextLength: (textFront || '').length,
          backTextLength: (textBack || '').length,
          filledFieldsCount: filledFields,
          totalFieldsCount: Object.keys(extractedFields).length
        }
      },
      debug: {
        usedVision: !!req._parsedVision,
        frontTextLen: (textFront || '').length,
        backTextLen: (textBack || '').length,
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.getByUser = async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    const record = await IDCard.findByUserId(userId);
    if (!record) return res.status(404).json({ error: 'Chưa có dữ liệu CCCD' });
    res.json(record);
  } catch (err) {
    next(err);
  }
};

// Endpoint để test OCR và xem kết quả chi tiết
exports.testOCR = async (req, res, next) => {
  try {
    const front = req.files?.front?.[0];
    const back = req.files?.back?.[0];
    if (!front || !back) return res.status(400).json({ error: 'Thiếu ảnh CCCD mặt trước/mặt sau' });

    const frontPath = front.path;
    const backPath = back.path;

    console.log('=== TESTING OCR ===');
    console.log('Front image:', frontPath);
    console.log('Back image:', backPath);

    // Test Python OCR first
    let pythonResult = null;
    let tesseractResult = null;
    
    try {
      console.log('🔄 Testing Python OCR...');
      pythonResult = await extractFieldsByPythonOCR(frontPath, backPath);
      console.log('✅ Python OCR test successful');
    } catch (error) {
      console.log('❌ Python OCR test failed:', error.message);
    }
    
    // Test OCR với template (Tesseract)
    try {
      console.log('🔄 Testing Tesseract OCR...');
      tesseractResult = await extractFieldsByTemplate(frontPath, backPath);
      console.log('✅ Tesseract OCR test successful');
    } catch (error) {
      console.log('❌ Tesseract OCR test failed:', error.message);
    }
    
    // Test OCR toàn bộ ảnh
    const fullFrontText = await ocrImageToText(frontPath);
    const fullBackText = await ocrImageToText(backPath);

    // Test từng ROI riêng lẻ
    const roiResults = {};
    const FRONT_TEMPLATE_V1 = [
      { key: 'number', left: 0.45, top: 0.25, width: 0.50, height: 0.08 },
      { key: 'full_name', left: 0.45, top: 0.35, width: 0.52, height: 0.08 },
      { key: 'dob', left: 0.45, top: 0.43, width: 0.25, height: 0.06 },
      { key: 'gender', left: 0.70, top: 0.43, width: 0.15, height: 0.06 },
      { key: 'nationality', left: 0.45, top: 0.50, width: 0.25, height: 0.06 },
      { key: 'place_of_origin', left: 0.45, top: 0.57, width: 0.52, height: 0.08 },
      { key: 'place_of_residence', left: 0.45, top: 0.65, width: 0.52, height: 0.10 },
      { key: 'expiry_date', left: 0.45, top: 0.75, width: 0.25, height: 0.06 },
    ];

    // Import ocrByRegions function
    const { ocrByRegions } = require('../utils/ocr');
    
    try {
      const roiTexts = await ocrByRegions(frontPath, FRONT_TEMPLATE_V1);
      roiResults.roiExtraction = roiTexts;
    } catch (e) {
      console.error('ROI extraction failed:', e);
      roiResults.error = e.message;
    }

    res.status(200).json({
      message: 'Kết quả test OCR',
      results: {
        pythonOCR: pythonResult,
        tesseractOCR: tesseractResult,
        templateExtraction: {
          front: tesseractResult?.front || {},
          back: tesseractResult?.back || {}
        },
        fullImageOCR: {
          frontText: fullFrontText,
          backText: fullBackText
        },
        roiExtraction: roiResults,
        imagePaths: {
          front: frontPath,
          back: backPath
        }
      }
    });

  } catch (err) {
    console.error('OCR Test Error:', err);
    res.status(500).json({ 
      error: 'Lỗi khi test OCR', 
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
};


