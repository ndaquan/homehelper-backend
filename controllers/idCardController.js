const multer = require('multer');
const path = require('path');
const fs = require('fs');
const User = require('../models/User');
const CCCD = require('../models/CCCD');
const pythonOCR = require('../utils/pythonOcr');

// Cấu hình multer để lưu file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/cccd');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ cho phép upload file ảnh!'), false);
    }
  }
});

// Middleware upload cho CCCD
const uploadCccd = upload.fields([
  { name: 'front', maxCount: 1 },
  { name: 'back', maxCount: 1 }
]);

// Submit CCCD để xác minh
const submit = async (req, res) => {
  try {
    console.log('🚀 Bắt đầu xử lý CCCD submission');
    console.log('📋 req.user:', req.user);
    console.log('📋 User ID:', req.user?.id);
    console.log('📋 Body:', req.body);
    console.log('📋 Files:', req.files);

    // Kiểm tra user authentication
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Chưa đăng nhập hoặc token không hợp lệ'
      });
    }

    const userId = req.user.id;
    const { number, full_name, dob, gender, face_cloud_url } = req.body;
    
    console.log('🔍 Received face_cloud_url from frontend:', face_cloud_url);

    // Kiểm tra xem client có gửi sẵn dữ liệu OCR không
    let ocrResult;
    let useClientOCR = false;
    const ocrPayloadRawEarly = req.body.ocr_payload;
    if (ocrPayloadRawEarly) {
      try {
        const parsed = typeof ocrPayloadRawEarly === 'string' ? JSON.parse(ocrPayloadRawEarly) : ocrPayloadRawEarly;
        ocrResult = {
          number: parsed.number || '',
          full_name: parsed.full_name || '',
          dob: parsed.dob || '',
          gender: parsed.gender || '',
          nationality: parsed.nationality || 'Việt Nam',
          place_of_origin: parsed.place_of_origin || '',
          place_of_residence: parsed.place_of_residence || '',
          issued_date: parsed.issued_date || '',
          expiry_date: parsed.expiry_date || '',
          ocr_text_front: parsed.ocr_text_front || parsed.raw_ocr_text || '',
          ocr_text_back: parsed.ocr_text_back || '',
          accuracy: parsed.accuracy || 0.0,
          source: 'client_ocr'
        };
        useClientOCR = true;
        console.log('🧾 Using client-provided OCR payload (early parse)');
      } catch (e) {
        console.warn('⚠️ Invalid ocr_payload JSON at early parse:', e.message);
      }
    }

    // Kiểm tra file upload (chỉ bắt buộc nếu KHÔNG có ocr_payload)
    if (!useClientOCR) {
      if (!req.files || !req.files.front) {
        return res.status(400).json({
          success: false,
          message: 'Vui lòng upload ảnh mặt trước CCCD'
        });
      }
    }

    const frontFile = req.files && req.files.front ? req.files.front[0] : null;
    const backFile = req.files && req.files.back ? req.files.back[0] : null;

    console.log('📸 Front file:', frontFile ? frontFile.filename : 'None');
    console.log('📸 Back file:', backFile ? backFile.filename : 'None');

    // Tùy chọn: dùng dữ liệu OCR do client gửi sẵn để SO SÁNH, bỏ qua gọi Python OCR
    // Frontend (/cccd) sẽ gửi field 'ocr_payload' (JSON string) chứa dữ liệu đã trích xuất
    // Nếu chưa có (do parse early fail) thử parse lần nữa
    if (!ocrResult) {
      const ocrPayloadRaw = req.body.ocr_payload;
      if (ocrPayloadRaw) {
        try {
          const parsed = typeof ocrPayloadRaw === 'string' ? JSON.parse(ocrPayloadRaw) : ocrPayloadRaw;
          ocrResult = {
            number: parsed.number || '',
            full_name: parsed.full_name || '',
            dob: parsed.dob || '',
            gender: parsed.gender || '',
            nationality: parsed.nationality || 'Việt Nam',
            place_of_origin: parsed.place_of_origin || '',
            place_of_residence: parsed.place_of_residence || '',
            issued_date: parsed.issued_date || '',
            expiry_date: parsed.expiry_date || '',
            ocr_text_front: parsed.ocr_text_front || parsed.raw_ocr_text || '',
            ocr_text_back: parsed.ocr_text_back || '',
            accuracy: parsed.accuracy || 0.0,
            source: 'client_ocr'
          };
          useClientOCR = true;
          console.log('🧾 Using client-provided OCR payload');
        } catch (e) {
          console.warn('⚠️ Invalid ocr_payload JSON. Fallback to server OCR. Error:', e.message);
        }
      }
    }

    // Nếu không có ocr_payload hợp lệ, gọi Python OCR như bình thường
    if (!ocrResult) {
      console.log('🤖 Gọi Python OCR...');
      console.log('📸 Front file path:', frontFile ? frontFile.path : 'None');
      console.log('📸 Back file path:', backFile ? backFile.path : 'None');

      try {
        const ocrService = new pythonOCR.PythonOCRService();
        const fieldRes = await ocrService.extractFields(frontFile ? frontFile.path : null, backFile ? backFile.path : null);
        console.log('🤖 Python OCR extractFields response:', JSON.stringify(fieldRes, null, 2));

        if (!fieldRes.success) {
          return res.status(422).json({
            success: false,
            message: fieldRes.error || 'OCR không trích xuất được dữ liệu từ ảnh. Vui lòng chụp rõ hơn cả 2 mặt CCCD và thử lại.'
          });
        }

        ocrResult = {
          number: fieldRes.extracted.number || '',
          full_name: fieldRes.extracted.full_name || '',
          dob: fieldRes.extracted.dob || '',
          gender: fieldRes.extracted.gender || '',
          nationality: fieldRes.extracted.nationality || 'Việt Nam',
          place_of_origin: fieldRes.extracted.place_of_origin || '',
          place_of_residence: fieldRes.extracted.place_of_residence || '',
          issued_date: fieldRes.extracted.issued_date || '',
          expiry_date: fieldRes.extracted.expiry_date || '',
          ocr_text_front: (fieldRes.rawData && fieldRes.rawData.raw_ocr_text) || '',
          ocr_text_back: '',
          accuracy: 0.0,
          source: fieldRes.source || 'python_ocr',
          face_image_path: fieldRes.face_image_path || '/static/results/0.jpg' // Luôn set face_image_path
        };

        if (!ocrResult.number && !ocrResult.full_name && !ocrResult.dob && !ocrResult.gender) {
          return res.status(422).json({
            success: false,
            message: 'OCR không trích xuất được dữ liệu từ ảnh. Vui lòng chụp rõ hơn cả 2 mặt CCCD và thử lại.'
          });
        }
      } catch (error) {
        console.error('❌ Python OCR failed:', error.message);
        return res.status(502).json({
          success: false,
          message: 'Dịch vụ OCR tạm thời không khả dụng. Vui lòng thử lại sau.',
          error: error.message
        });
      }
    }

    // Dữ liệu từ OCR (chỉ để so sánh, KHÔNG ghi đè user input)
    const ocrData = {
      cccd_number: ocrResult.number || '',
      full_name: ocrResult.full_name || '',
      date_of_birth: ocrResult.dob || '',
      gender: ocrResult.gender || '',
      nationality: ocrResult.nationality || 'Việt Nam',
      place_of_origin: ocrResult.place_of_origin || '',
      place_of_residence: ocrResult.place_of_residence || '',
      issued_date: ocrResult.issued_date || '',
      expiry_date: ocrResult.expiry_date || '',
      ocr_text_front: ocrResult.ocr_text_front || '',
      ocr_text_back: ocrResult.ocr_text_back || '',
      ocr_accuracy: ocrResult.accuracy || 0.0
    };

    // Dữ liệu user nhập (ưu tiên, lưu vào database)
    const userInputData = {
      cccd_number: number,
      full_name: full_name,
      date_of_birth: dob,
      gender: gender,
      nationality: 'Việt Nam',
      place_of_origin: '',
      place_of_residence: '',
      issued_date: '',
      expiry_date: '',
      ocr_text_front: ocrResult.ocr_text_front || '',
      ocr_text_back: ocrResult.ocr_text_back || '',
      ocr_accuracy: ocrResult.accuracy || 0.0
    };

    console.log('📊 OCR data (từ ảnh):', ocrData);
    console.log('📊 User input data (user nhập):', userInputData);
    console.log('🖼️ OCR face_image_path:', ocrResult.face_image_path);
    console.log('🖼️ OCR result object:', JSON.stringify(ocrResult, null, 2));
    
        // Upload ảnh từ results lên Cloudinary nếu có
        let faceCloudUrl = null;
        console.log('🔍 Checking face_image_path:', ocrResult.face_image_path);
        console.log('🔍 face_image_path exists:', !!ocrResult.face_image_path);
        console.log('🔍 face_image_path trim:', ocrResult.face_image_path ? ocrResult.face_image_path.trim() : 'null');
        
        if (ocrResult.face_image_path && ocrResult.face_image_path.trim() !== '') {
          try {
            console.log('🖼️ Uploading image from results to Cloudinary:', ocrResult.face_image_path);
            const { cloudinary } = require('../config/cloudinary');
            
            // Nếu face_image_path là URL local, cần convert thành file path
            let faceImagePath = ocrResult.face_image_path;
            if (faceImagePath.startsWith('/static/')) {
              // Convert từ URL static thành file path thực tế
              faceImagePath = faceImagePath.replace('/static/', './cccd-detector/sources/static/');
            }
            
            console.log('🖼️ Image path to upload:', faceImagePath);
            
            const faceUploadResult = await cloudinary.uploader.upload(faceImagePath, {
              folder: `${process.env.CLOUDINARY_FOLDER_BASE || 'homehelper'}/cccd/faces/${userId}`,
              public_id: `face-${Date.now()}`,
              resource_type: 'image',
            });
            
            faceCloudUrl = faceUploadResult.secure_url;
            console.log('✅ Image uploaded to Cloudinary:', faceCloudUrl);
          } catch (faceUploadError) {
            console.warn('⚠️ Image upload failed:', faceUploadError.message);
          }
        } else {
          console.log('⚠️ No face image to upload - face_image_path is empty or null');
          console.log('🔍 ocrResult keys:', Object.keys(ocrResult));
          console.log('🔍 ocrResult.face_image_path type:', typeof ocrResult.face_image_path);
          console.log('🔍 ocrResult.face_image_path value:', ocrResult.face_image_path);
        }

    // So sánh dữ liệu OCR với dữ liệu user nhập
    const comparisonResult = compareData(ocrData, { number, full_name, dob, gender });
    console.log('🔍 Comparison result:', comparisonResult);

    // Tự động quyết định dựa trên tỉ lệ khớp
    const autoStatus = comparisonResult.isMatch ? 'Verified' : 'Rejected';

    // Optional: Upload verified front image to Cloudinary (authenticated delivery) and save PUBLIC ID to user
    let cloudPublicId = null;
    try {
      if (autoStatus === 'Verified' && frontFile) {
        const { cloudinary } = require('../config/cloudinary');
        const uploadResult = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream({
            folder: `${process.env.CLOUDINARY_FOLDER_BASE || 'homehelper'}/cccd/${userId}`,
            resource_type: 'image',
            type: 'authenticated'
          }, (error, result) => {
            if (error) return reject(error);
            resolve(result);
          });
          const fs = require('fs');
          fs.createReadStream(frontFile.path).pipe(uploadStream);
        });
        cloudPublicId = uploadResult && uploadResult.public_id;
      }
    } catch (e) {
      console.warn('⚠️ Cloudinary upload failed:', e.message);
    }

    // Tạo bản ghi CCCD (lưu dữ liệu user nhập, KHÔNG phải OCR)
    console.log('💾 Creating CCCD record with face_image_path:', req.body.face_public_id || face_cloud_url || faceCloudUrl || ocrResult.face_image_path || '');
    
    const cccdRecord = await CCCD.create({
      user_id: userId,
      ...userInputData,
      front_image_path: frontFile ? frontFile.filename : '',
      back_image_path: backFile ? backFile.filename : '',
      // Prefer Cloudinary public_id if provided (secure), otherwise fallback to existing value
      face_image_path: req.body.face_public_id || face_cloud_url || faceCloudUrl || ocrResult.face_image_path || '',
      verification_status: autoStatus,
      verified_at: autoStatus === 'Verified' ? new Date().toISOString() : null,
      verified_by: autoStatus === 'Verified' ? userId : null
    });
    
    console.log('✅ CCCD record created:', cccdRecord);

    // Nếu dữ liệu khớp, cập nhật thông tin user
    if (autoStatus === 'Verified') {
      console.log('✅ Dữ liệu khớp, cập nhật user...');
      // Store public_id instead of direct URL to avoid URL leakage
      await User.updateFromCCCD(userId, { ...userInputData, cccd_url: cloudPublicId || null });
      console.log('✅ User updated successfully');
    }

    // Lấy thông tin user sau khi cập nhật
    const updatedUser = await User.findById(userId);

    res.json({
      success: true,
      message: autoStatus === 'Verified' 
        ? 'Xác minh CCCD thành công!' 
        : 'CCCD không khớp thông tin, đã bị từ chối tự động',
      data: {
        user: updatedUser,
        cccd_record: cccdRecord,
        comparison: comparisonResult,
        ocr_data: ocrData,
        user_input_data: userInputData,
        // Do not expose direct Cloudinary URL; return null here. Use signed-url endpoint instead
        cloud_url: null,
        face_cloud_url: faceCloudUrl || null
      }
    });

  } catch (error) {
    console.error('❌ CCCD submission error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Lỗi xử lý CCCD',
      error: error.message
    });
  }
};

// So sánh dữ liệu OCR với dữ liệu user nhập
function compareData(extracted, userInput) {
  const comparisons = {
    number: compareText(extracted.cccd_number, userInput.number),
    full_name: compareText(extracted.full_name, userInput.full_name),
    dob: compareDate(extracted.date_of_birth, userInput.dob),
    gender: compareText(extracted.gender, userInput.gender)
  };

  const matchCount = Object.values(comparisons).filter(match => match).length;
  const totalFields = Object.keys(comparisons).length;
  const matchRate = matchCount / totalFields;

  return {
    comparisons,
    matchCount,
    totalFields,
    matchRate,
    isMatch: matchRate >= 0.8 // Khớp ít nhất 80%
  };
}

// So sánh text
function compareText(text1, text2) {
  if (!text1 || !text2) return false;
  
  const normalize = (str) => {
    return str.toLowerCase()
      .replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, 'a')
      .replace(/[èéẹẻẽêềếệểễ]/g, 'e')
      .replace(/[ìíịỉĩ]/g, 'i')
      .replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, 'o')
      .replace(/[ùúụủũưừứựửữ]/g, 'u')
      .replace(/[ỳýỵỷỹ]/g, 'y')
      .replace(/đ/g, 'd')
      .replace(/\s+/g, ' ')
      .trim();
  };

  return normalize(text1) === normalize(text2);
}

// So sánh ngày tháng
function compareDate(date1, date2) {
  if (!date1 || !date2) return false;
  
  const normalizeDate = (dateStr) => {
    // Chuyển đổi các format ngày khác nhau về cùng format
    const formats = [
      /(\d{1,2})\/(\d{1,2})\/(\d{4})/,  // dd/mm/yyyy
      /(\d{4})-(\d{1,2})-(\d{1,2})/,   // yyyy-mm-dd
      /(\d{1,2})-(\d{1,2})-(\d{4})/    // dd-mm-yyyy
    ];
    
    for (const format of formats) {
      const match = dateStr.match(format);
      if (match) {
        const [, day, month, year] = match;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
    }
    
    return dateStr;
  };

  return normalizeDate(date1) === normalizeDate(date2);
}

// Lấy danh sách CCCD của user
const getUserCccd = async (req, res) => {
  try {
    const userId = req.user.id;
    const cccdRecords = await CCCD.findByUserId(userId);
    
    res.json({
      success: true,
      data: cccdRecords
    });
  } catch (error) {
    console.error('❌ Get user CCCD error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Lấy thông tin CCCD mới nhất của user
const getLatestCccd = async (req, res) => {
  try {
    const userId = req.user.id;
    const latestCccd = await CCCD.findLatestByUserId(userId);
    
    res.json({
      success: true,
      data: latestCccd
    });
    } catch (error) {
    console.error('❌ Get latest CCCD error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Cập nhật trạng thái xác minh CCCD (cho admin)
const updateVerificationStatus = async (req, res) => {
  try {
    const { cccdId } = req.params;
    const { status } = req.body;
    const adminId = req.user.id;

    const updatedCccd = await CCCD.updateVerificationStatus(cccdId, status, adminId);
    
    // Nếu xác minh thành công, cập nhật user
    if (status === 'Verified') {
      await User.updateFromCCCD(updatedCccd.user_id, updatedCccd);
    }

    res.json({
      success: true,
      message: 'Cập nhật trạng thái thành công',
      data: updatedCccd
    });
  } catch (error) {
    console.error('❌ Update verification status error:', error);
    res.status(500).json({ 
      success: false,
      message: error.message
    });
  }
};

// Kiểm tra trạng thái CCCD của user
const getCCCDStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const status = await CCCD.getCCCDStatus(userId);
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('❌ Get CCCD status error:', error);
    res.status(500).json({ 
      success: false,
      message: error.message
    });
  }
};

// Kiểm tra user đã có CCCD được duyệt chưa
const checkVerifiedCCCD = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const verifiedCCCD = await CCCD.hasVerifiedCCCD(userId);
    
    res.json({
      success: true,
      data: {
        hasVerified: !!verifiedCCCD,
        cccd: verifiedCCCD
      }
    });
  } catch (error) {
    console.error('❌ Check verified CCCD error:', error);
    res.status(500).json({ 
      success: false,
      message: error.message
    });
  }
};

// Upload ảnh mặt lên Cloudinary
const uploadFaceImage = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { faceImageUrl } = req.body; // URL của ảnh mặt từ Python OCR

    if (!faceImageUrl) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu URL ảnh mặt'
      });
    }

    console.log('🖼️ Uploading face image to Cloudinary:', faceImageUrl);

    // Download ảnh từ Python OCR server
    const axios = require('axios');
    const response = await axios.get(faceImageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000
    });

    // Upload lên Cloudinary
    const { cloudinary } = require('../config/cloudinary');
    
    const uploadResult = await cloudinary.uploader.upload(
      `data:image/jpeg;base64,${Buffer.from(response.data).toString('base64')}`,
      {
        folder: `${process.env.CLOUDINARY_FOLDER_BASE || 'homehelper'}/cccd/faces/${userId}`,
        public_id: `face-${Date.now()}`,
        resource_type: 'image',
        type: 'authenticated'
      }
    );

    console.log('✅ Face image uploaded to Cloudinary:', uploadResult.public_id);

    // Return public_id and a short-lived preview URL for immediate display
    const { generateSignedCertificateUrl } = require('../config/cloudinary');
    const signed = generateSignedCertificateUrl(uploadResult.public_id, { resource_type: 'image', ttlSeconds: 600 });

    res.json({
      success: true,
      message: 'Upload ảnh mặt thành công',
      data: {
        face_public_id: uploadResult.public_id,
        face_signed_url: signed?.url || null,
        expires_at: signed?.expiresAt || null
      }
    });

  } catch (error) {
    console.error('❌ Upload face image failed:', error.message);
    res.status(500).json({
      success: false,
      message: 'Upload ảnh mặt thất bại',
      error: error.message
    });
  }
};

module.exports = {
  submit,
  getUserCccd,
  getLatestCccd,
  updateVerificationStatus,
  getCCCDStatus,
  checkVerifiedCCCD,
  uploadCccd,
  uploadFaceImage
};

// Generate short-lived signed URL for user's verified CCCD image (Cloudinary authenticated asset)
module.exports.getSignedCccdUrl = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.user_id;
    if (!userId) return res.status(401).json({ success:false, message:'Unauthorized' });
    const User = require('../models/User');
    const user = await User.findById(userId);
    const publicId = user?.cccd_url; // stored as public_id now (not direct URL)
    if (!publicId) return res.status(404).json({ success:false, message:'Không có hình CCCD đã duyệt' });
    const { generateSignedCertificateUrl } = require('../config/cloudinary');
    const { url, expiresAt } = generateSignedCertificateUrl(publicId, { resource_type: 'image', ttlSeconds: 600 });
    return res.json({ success:true, data: { url, expires_at: expiresAt } });
  } catch (e) {
    console.error('getSignedCccdUrl error', e);
    return res.status(500).json({ success:false, message:'Không tạo được URL tạm thời' });
  }
};