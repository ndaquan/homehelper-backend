// module.exports = TaskerController;
const Address = require("../models/Address");
const axios = require("axios");
const Tasker = require("../models/Tasker");
const TaskerCertification = require("../models/TaskerCertification");
const { executeQuery } = require("../config/database");
const { cloudinary, certificateUpload } = require('../config/cloudinary');
const { extractCertificateFromUrl } = require('../config/gemini.service');
const TaskerApplication = require('../models/TaskerApplication');

// Lấy danh sách variant_id đã đăng ký của tasker
exports.getRegisteredVariantIds = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, message: 'Thiếu tasker_id' });
    const query = 'SELECT variant_id FROM TaskerServiceVariants WHERE tasker_id = @param1';
    const result = await executeQuery(query, [id]);
    const variantIds = (result.recordset || []).map(r => r.variant_id);
    res.json({ success: true, data: variantIds });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
// Check if certificate code exists anywhere in the system
exports.checkCertificateCodeExists = async (req, res) => {
  try {
    const code = (req.query.code || '').toString().trim();
    if (!code) return res.status(400).json({ success: false, message: 'Thiếu mã chứng chỉ' });
    const query = `SELECT cert_id FROM TaskerCertifications WHERE parsed_certificate_code = @param1`;
    const result = await executeQuery(query, [code]);
    const exists = (result.recordset && result.recordset.length > 0);
    res.json({ success: true, exists });
  } catch (error) {
    console.error('checkCertificateCodeExists error:', error);
    res.status(500).json({ success: false, message: 'Lỗi kiểm tra mã chứng chỉ', error: error.message });
  }
};
// Get all approved certificate codes
exports.getApprovedCertificateCodes = async (req, res) => {
  try {
    const query = `SELECT parsed_certificate_code FROM TaskerCertifications WHERE status = 'Approved' AND parsed_certificate_code IS NOT NULL AND parsed_certificate_code <> ''`;
    const result = await executeQuery(query, []);
    const codes = (result.recordset || []).map(r => String(r.parsed_certificate_code).trim());
    res.json({ success: true, codes: Array.from(new Set(codes)) });
  } catch (error) {
    console.error('getApprovedCertificateCodes error:', error);
    res.status(500).json({ success: false, message: 'Lỗi lấy mã chứng chỉ đã duyệt', error: error.message });
  }
};

// Lazy require classifyService when needed to avoid circular or load cost
const TaskerServiceVariants = require("../models/TaskerServiceVariants");
  // Lấy danh sách chứng chỉ đang pending cho staff duyệt
exports.getPendingCertifications = async (req, res) => {
  try {
    const query = `
      SELECT 
          tc.cert_id AS certification_id,
          tc.cert_public_id,
          tc.cert_name AS certificate_name,
          tc.created_at AS registered_at,
          tc.issued_date,
          tc.parsed_holder_name,
          tc.parsed_certificate_code,
          tc.tasker_id,
          u.name AS tasker_name,
          tc.variant_ids_json,
          s.service_id,
          s.name AS service_name,
          v.variant_id,
          v.variant_name,
          v.pricing_type,
          v.price_min,
          v.price_max,
          v.unit
      FROM TaskerCertifications tc
      JOIN Users u 
          ON tc.tasker_id = u.user_id
      LEFT JOIN Services s 
          ON tc.service_id = s.service_id
      OUTER APPLY (
          SELECT 
              STRING_AGG(v2.variant_name, ', ') AS variant_name,
              STRING_AGG(v2.pricing_type, ', ') AS pricing_type,
              MIN(v2.price_min) AS price_min,
              MAX(v2.price_max) AS price_max,
              STRING_AGG(v2.unit, ', ') AS unit,
              STRING_AGG(CONVERT(VARCHAR(10), v2.variant_id), ', ') AS variant_id
          FROM OPENJSON(tc.variant_ids_json)
               WITH (variant_id INT '$') AS jsonIds
          LEFT JOIN ServiceVariants v2
               ON v2.variant_id = jsonIds.variant_id
      ) v
      WHERE tc.status = 'pending'
      ORDER BY tc.created_at DESC;
    `;

    const result = await require('../config/database').executeQuery(query, []);
    res.json({ success: true, data: result.recordset || [] });
  } catch (e) {
    console.error('[getPendingCertifications] error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

// Tạo bản ghi TaskerCertifications với status pending, đồng bộ trường với FE
exports.createPendingCertification = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.user_id;
  const { service_id, variant_ids = [], cert_ids = [], certs = [], status = 'pending' } = req.body;
  // Ensure variant_ids is always an array of numbers
  let variantArr = Array.isArray(variant_ids) ? variant_ids : [];
  if (typeof variant_ids === 'string' && variant_ids.trim()) {
    try {
      variantArr = JSON.parse(variant_ids);
      if (!Array.isArray(variantArr)) {
        variantArr = variant_ids.split(',').map(v => parseInt(v.trim(), 10)).filter(Number.isFinite);
      }
    } catch {
      variantArr = variant_ids.split(',').map(v => parseInt(v.trim(), 10)).filter(Number.isFinite);
    }
  }
    if (!service_id || !Array.isArray(cert_ids) || cert_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Thiếu service_id hoặc danh sách cert_ids' });
    }
    let created = [];
    for (const cert_public_id of cert_ids) {
      // Tìm object chứng chỉ từ danh sách certs FE gửi lên
      let certObj = {};
      if (Array.isArray(certs)) {
        certObj = certs.find(c => c.cert_public_id === cert_public_id) || {};
      }
      // Nếu cert_public_id đã tồn tại thì bỏ qua, chỉ tạo mới nếu chưa có
      const checkQuery = `SELECT cert_id FROM TaskerCertifications WHERE cert_public_id = @param1 AND tasker_id = @param2`;
      const checkResult = await executeQuery(checkQuery, [cert_public_id, userId]);
      if (checkResult.recordset && checkResult.recordset.length > 0) {
        continue; // đã có bản ghi, không tạo lại
      }
      // Lưu variant_ids cho từng chứng chỉ nếu có, ưu tiên certObj.variant_ids nếu có
      let variantJson = JSON.stringify(variantArr);
      if (Array.isArray(certObj.variant_ids) && certObj.variant_ids.length) {
        variantJson = JSON.stringify(certObj.variant_ids);
      }
      // Insert đầy đủ các trường
      const insertQuery = `INSERT INTO TaskerCertifications (
        tasker_id, cert_public_id, service_id, variant_ids_json, status, created_at, cert_name, delivery_type, issued_by, issued_date, extracted_payload, ai_status, needs_review, parsed_cert_name, parsed_issued_by, parsed_issued_date, parsed_holder_name, parsed_grade_or_level, parsed_certificate_code, ai_detected_service, ai_confidence
      ) VALUES (
        @param1, @param2, @param3, @param4, @param5, GETDATE(), @param6, @param7, @param8, @param9, @param10, @param11, @param12, @param13, @param14, @param15, @param16, @param17, @param18, @param19, @param20
      )`;
      await executeQuery(insertQuery, [
        userId,
        cert_public_id,
        service_id,
        variantJson,
        status,
        certObj.cert_name || '',
        certObj.delivery_type || null,
        certObj.issued_by || null,
        certObj.issued_date || null,
        certObj.extracted_payload || null,
        certObj.ai_status || null,
        certObj.needs_review || 0,
        certObj.parsed_cert_name || null,
        certObj.parsed_issued_by || null,
        certObj.parsed_issued_date || null,
        certObj.parsed_holder_name || null,
        certObj.parsed_grade_or_level || null,
        certObj.parsed_certificate_code || null,
        certObj.ai_detected_service || null,
        certObj.ai_confidence || null
      ]);
      created.push(cert_public_id);
    }
    res.json({ success: true, created, status });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// Duyệt chứng chỉ: đổi status và thêm bản ghi dịch vụ/biến thể cho tasker
exports.approveCertificationAndRegisterService = async (req, res) => {
  try {
    const { cert_ids = [], variant_ids = [], tasker_id } = req.body;
    if (!Array.isArray(cert_ids) || cert_ids.length === 0 || !Array.isArray(variant_ids) || variant_ids.length === 0 || !tasker_id) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin duyệt chứng chỉ, dịch vụ hoặc tasker_id' });
    }
    // Đổi status các chứng chỉ sang Approved
    for (const cert_public_id of cert_ids) {
      const query = `UPDATE TaskerCertifications SET status = @param1 WHERE cert_public_id = @param2 AND tasker_id = @param3`;
      await executeQuery(query, ['Approved', cert_public_id, tasker_id]);
    }
    // Thêm bản ghi vào TaskerServiceVariants cho từng variant
    for (const variant_id of variant_ids) {
      await TaskerServiceVariants.add(tasker_id, variant_id);
    }
    res.json({ success: true, message: 'Đã duyệt chứng chỉ và đăng ký biến thể cho tasker', cert_ids, variant_ids, tasker_id });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
function getClassifyService() {
  try { return require('../lib/classifyService').classifyService; } catch (_) { return null; }
}


// Lấy tất cả tasker
exports.getAll = async (req, res) => {
  try {
    const { search = "", serviceId = "" } = req.query;
    console.log("🔍 Fetch all taskers with filters", { search, serviceId });

    const taskers = await Tasker.findAll(search, serviceId);

    res.json({
      success: true,
      message: "Lấy danh sách tasker thành công",
      data: Array.isArray(taskers) ? taskers : [],
    });
  } catch (error) {
    console.error("❌ Lỗi getAll taskers:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy danh sách tasker",
      error: error.message,
    });
  }
};

// Lấy tasker theo id kèm reviews
exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    console.log("🔍 Fetch tasker by id", { id });

    const tasker = await Tasker.findByIdWithReviews(id);

    if (!tasker) {
      return res.status(404).json({
        success: false,
        message: "Tasker không tồn tại",
      });
    }

    res.json({
      success: true,
      message: "Lấy thông tin tasker thành công",
      data: tasker,
    });
  } catch (error) {
    console.error("❌ Lỗi getById tasker:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy tasker",
      error: error.message,
    });
  }
};

// Lấy taskers theo variant_id
exports.getByVariant = async (req, res) => {
  try {
    const { variantId } = req.params;
    if (!variantId) {
      return res.status(400).json({ success: false, message: 'Thiếu variantId' });
    }
    const taskers = await Tasker.findByVariant(variantId);
    res.json({ success: true, data: taskers });
  } catch (error) {
    console.error('❌ Lỗi getByVariant taskers:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi lấy taskers theo biến thể', error: error.message });
  }
};
// Tạo địa chỉ (giữ nguyên)
exports.createAddress = async (req, res) => {
  try {
    const { address: inputAddress } = req.body;
    const user_id = req.user.userId;

    if (!inputAddress || typeof inputAddress !== 'string' || inputAddress.trim().length === 0) {
      return res.status(400).json({ message: 'Địa chỉ là bắt buộc và phải là chuỗi không rỗng' });
    }

    const trimmedAddress = inputAddress.trim();

    // Gọi VietMap Search API v3 để lấy ref_id
    console.log(`🔍 Tìm kiếm địa chỉ: ${trimmedAddress}`);
    const searchResponse = await axios.get('https://maps.vietmap.vn/api/search/v3', {
      params: {
        apikey: process.env.VIETMAP_APIKEY,
        text: trimmedAddress,
        layers: 'ADDRESS',
        focus: '16.054407,108.202166' // Trung tâm Đà Nẵng
      },
      timeout: 5000
    });

    console.log('📊 Search API response:', searchResponse.data);
    if (!searchResponse.data || searchResponse.data.length === 0) {
      console.warn('⚠️ Không tìm thấy kết quả, lưu địa chỉ mà không có tọa độ');
      const newAddress = await Address.create(user_id, trimmedAddress, 0, 0);
      return res.status(201).json({ ...newAddress, message: 'Đã lưu địa chỉ nhưng không tìm thấy tọa độ trên bản đồ. Vui lòng kiểm tra lại định dạng.' });
    }

    // Tìm kết quả chính xác nhất
    const exactMatch = searchResponse.data.find(item => {
      const lowerInput = trimmedAddress.toLowerCase();
      const lowerDisplay = item.display.toLowerCase();
      const lowerName = item.name.toLowerCase();
      const lowerAddress = item.address.toLowerCase();

      if (lowerName === lowerInput || lowerInput.includes(lowerName)) return true;
      if (lowerDisplay === lowerInput || lowerAddress === lowerInput) return true;
      return false;
    });

    if (!exactMatch) {
      console.warn('⚠️ Không tìm thấy kết quả chính xác, lưu địa chỉ mà không có tọa độ');
      const newAddress = await Address.create(user_id, trimmedAddress, 0, 0);
      return res.status(201).json({ ...newAddress, message: 'Đã lưu địa chỉ nhưng không tìm thấy kết quả chính xác. Vui lòng kiểm tra lại.' });
    }

    const refId = exactMatch.ref_id;
    console.log('📌 Kết quả chính xác:', exactMatch);

    if (!refId) {
      console.warn('⚠️ Không tìm thấy ref_id, lưu địa chỉ mà không có tọa độ');
      const newAddress = await Address.create(user_id, trimmedAddress, 0, 0);
      return res.status(201).json({ ...newAddress, message: 'Đã lưu địa chỉ nhưng không tìm thấy ref_id. Vui lòng kiểm tra lại.' });
    }

    // Gọi Place API v3 để lấy lat/lng
    console.log(`🔍 Gọi Place API với refid: ${refId}`);
    const placeResponse = await axios.get('https://maps.vietmap.vn/api/place/v3', {
      params: {
        apikey: process.env.VIETMAP_APIKEY,
        refid: refId
      },
      timeout: 5000
    });

    console.log('📍 Place API status:', placeResponse.status);
    if (placeResponse.data && placeResponse.data.error) {
      console.warn('⚠️ Place API trả về lỗi:', placeResponse.data.error);
    }
    const { lat, lng } = placeResponse.data;

    if (!lat || !lng || lat === 0 || lng === 0) {
      console.warn('⚠️ Không lấy được tọa độ hợp lệ, lưu mặc định 0');
      const newAddress = await Address.create(user_id, trimmedAddress, 0, 0);
      return res.status(201).json({ ...newAddress, message: 'Đã lưu địa chỉ nhưng không lấy được tọa độ hợp lệ. Vui lòng kiểm tra lại.' });
    }

    // Lưu vào DB
    const newAddress = await Address.create(user_id, trimmedAddress, lat, lng);
    res.status(201).json(newAddress);
  } catch (error) {
    console.error('❌ Lỗi khi tạo địa chỉ:', error.response?.data || error.message);
    if (error.response?.status === 401 || error.response?.status === 403) {
      return res.status(401).json({ message: 'Lỗi API VietMap: Key không hợp lệ hoặc hết hạn' });
    }
    if (error.code === 'ECONNABORTED') {
      return res.status(500).json({ message: 'Lỗi kết nối đến VietMap. Vui lòng thử lại sau.' });
    }
    res.status(500).json({ message: 'Mỗi người chỉ 1 địa chỉ', error: error.message });
  }
};

// Cập nhật địa chỉ (giữ nguyên)
exports.updateAddress = async (req, res) => {
  try {
    const { address_id } = req.params;
    const { address: inputAddress } = req.body;
    const user_id = req.user.userId;

    const addressToUpdate = await Address.findById(address_id);
    if (!addressToUpdate || addressToUpdate.user_id !== user_id) {
      return res
        .status(404)
        .json({ message: "Địa chỉ không tồn tại hoặc không được phép" });
    }

    if (
      !inputAddress ||
      typeof inputAddress !== "string" ||
      inputAddress.trim().length === 0
    ) {
      return res
        .status(400)
        .json({ message: "Địa chỉ là bắt buộc và phải là chuỗi không rỗng" });
    }

    const trimmedAddress = inputAddress.trim();

    // Gọi VietMap Search API v3 để lấy ref_id
    console.log(`🔍 Tìm kiếm địa chỉ để cập nhật: ${trimmedAddress}`);
    const searchResponse = await axios.get(
      "https://maps.vietmap.vn/api/search/v3",
      {
        params: {
          apikey: process.env.VIETMAP_APIKEY,
          text: trimmedAddress,
          layers: "ADDRESS",
          focus: "16.054407,108.202166",
        },
        timeout: 5000,
      }
    );

    console.log("📊 Search API response:", searchResponse.data);
    if (!searchResponse.data || searchResponse.data.length === 0) {
      console.warn(
        "⚠️ Không tìm thấy kết quả, cập nhật địa chỉ mà không có tọa độ"
      );
      const updatedAddress = await Address.update( 
        address_id,
        trimmedAddress,
        0,
        0
      );
      return res.json({
        ...updatedAddress,
        message:
          "Đã cập nhật địa chỉ nhưng không tìm thấy tọa độ trên bản đồ. Vui lòng kiểm tra lại định dạng.",
      });
    }

    // Tìm kết quả chính xác nhất
    const exactMatch = searchResponse.data.find((item) => {
      const lowerInput = trimmedAddress.toLowerCase();
      const lowerDisplay = item.display.toLowerCase();
      const lowerName = item.name.toLowerCase();
      const lowerAddress = item.address.toLowerCase();

      if (lowerName === lowerInput || lowerInput.includes(lowerName))
        return true;
      if (lowerDisplay === lowerInput || lowerAddress === lowerInput)
        return true;
      return false;
    });

    if (!exactMatch) {
      console.warn(
        "⚠️ Không tìm thấy kết quả chính xác, cập nhật địa chỉ mà không có tọa độ"
      );
      const updatedAddress = await Address.update(
        address_id,
        trimmedAddress,
        0,
        0
      );
      return res.json({
        ...updatedAddress,
        message:
          "Đã cập nhật địa chỉ nhưng không tìm thấy kết quả chính xác. Vui lòng kiểm tra lại.",
      });
    }

    const refId = exactMatch.ref_id;
    console.log("📌 Kết quả chính xác:", exactMatch);

    if (!refId) {
      console.warn(
        "⚠️ Không tìm thấy ref_id, cập nhật địa chỉ mà không có tọa độ"
      );
      const updatedAddress = await Address.update(
        address_id,
        trimmedAddress,
        0,
        0
      );
      return res.json({
        ...updatedAddress,
        message:
          "Đã cập nhật địa chỉ nhưng không tìm thấy ref_id. Vui lòng kiểm tra lại.",
      });
    }

    // Gọi Place API v3 để lấy lat/lng
    console.log(`🔍 Gọi Place API với refid: ${refId}`);
    const placeResponse = await axios.get(
      "https://maps.vietmap.vn/api/place/v3",
      {
        params: {
          apikey: process.env.VIETMAP_APIKEY,
          refid: refId,
        },
        timeout: 5000,
      }
    );

    console.log("📍 Place API status:", placeResponse.status);
    if (placeResponse.data && placeResponse.data.error) {
      console.warn("⚠️ Place API trả về lỗi:", placeResponse.data.error);
    }
    const { lat, lng } = placeResponse.data;

    if (!lat || !lng || lat === 0 || lng === 0) {
      console.warn("⚠️ Không lấy được tọa độ hợp lệ, cập nhật mặc định 0");
      const updatedAddress = await Address.update(
        address_id,
        trimmedAddress,
        0,
        0
      );
      return res.json({
        ...updatedAddress,
        message:
          "Đã cập nhật địa chỉ nhưng không lấy được tọa độ hợp lệ. Vui lòng kiểm tra lại.",
      });
    }

    // Cập nhật DB
    const updatedAddress = await Address.update(
      address_id,
      trimmedAddress,
      lat,
      lng
    );
    res.json(updatedAddress);
  } catch (error) {
    console.error(
      "❌ Lỗi khi cập nhật địa chỉ:",
      error.response?.data || error.message
    );
    if (error.response?.status === 401 || error.response?.status === 403) {
      return res
        .status(401)
        .json({ message: "Lỗi API VietMap: Key không hợp lệ hoặc hết hạn" });
    }
    if (error.code === "ECONNABORTED") {
      return res
        .status(500)
        .json({ message: "Lỗi kết nối đến VietMap. Vui lòng thử lại sau." });
    }
    res
      .status(500)
      .json({ message: "Lỗi khi cập nhật địa chỉ", error: error.message });
  }
};

// Lấy danh sách địa chỉ theo user_id (giữ nguyên)
exports.getAddressesByUserId = async (req, res) => {
  try {
    const user_id = req.user.userId;

    const addresses = await Address.findByUserId(user_id);
    if (!addresses || addresses.length === 0) {
      return res
        .status(200)
        .json({ message: "Không tìm thấy địa chỉ", addresses: [] });
    }
    res.json({ addresses });
  } catch (error) {
    console.error("Lỗi khi lấy danh sách địa chỉ:", error);
    res
      .status(500)
      .json({ message: "Lỗi khi lấy danh sách địa chỉ", error: error.message });
  }
};

// Xóa địa chỉ (giữ nguyên)
exports.deleteAddress = async (req, res) => {
  try {
    const { address_id } = req.params;
    const user_id = req.user.userId;

    const address = await Address.findById(address_id);
    if (!address || address.user_id !== user_id) {
      return res
        .status(404)
        .json({ message: "Địa chỉ không tồn tại hoặc không được phép" });
    }

    await Address.delete(address_id);
    res.json({ message: "Xóa địa chỉ thành công" });
  } catch (error) {
    console.error("Lỗi khi xóa địa chỉ:", error);
    res
      .status(500)
      .json({ message: "Lỗi khi xóa địa chỉ", error: error.message });
  }
};

// Tìm kiếm người dùng trong phạm vi sử dụng Geofencing (CHỈ TASKER), với filter services và min_rating
exports.searchNearbyUsers = async (req, res) => {
  try {
    const { lat, lng, radius, services = [], min_rating = null } = req.body;

    // Validate input
    if (!lat || !lng || !radius) {
      return res.status(400).json({
        success: false,
        message: "Yêu cầu cung cấp lat, lng và radius",
      });
    }

    if (typeof radius !== "number" || radius < 1000 || radius > 15000) {
      return res.status(400).json({
        success: false,
        message: "Bán kính phải là số từ 1000 đến 15000 mét",
      });
    }

    // Validate min_rating
    if (min_rating !== null) {
      const ratingNum = parseFloat(min_rating);
      if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        return res.status(400).json({
          success: false,
          message: "min_rating phải là số từ 1 đến 5",
        });
      }
    }

    // Validate services
    if (
      services.length > 0 &&
      (!Array.isArray(services) ||
        !services.every((s) => Number.isInteger(s) && s > 0))
    ) {
      return res.status(400).json({
        success: false,
        message: "services phải là array các service_id số nguyên dương",
      });
    }

    // Log input parameters for debugging
    console.log(
      `🔍 Tìm kiếm tasker gần: lat=${lat}, lng=${lng}, radius=${radius}, services=${JSON.stringify(
        services
      )}, min_rating=${min_rating}`
    );

    // Get filtered tasker addresses with their service variants
    const allAddresses = await Address.findFilteredTaskerAddresses(
      min_rating,
      services
    );

    if (allAddresses.length === 0) {
      console.log("⚠️ Không tìm thấy tasker phù hợp với bộ lọc.");
      return res.json({
        success: true,
        users: [],
        total_filtered_before_geofence: 0,
        total_in_range: 0,
      });
    }

    // Calculate distances and filter by radius using Haversine formula
    const usersInRange = allAddresses
      .map((addr) => {
        const R = 6371; // Earth's radius in km
        const dLat = toRad(addr.lat - lat);
        const dLng = toRad(addr.lng - lng);
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(toRad(lat)) *
          Math.cos(toRad(addr.lat)) *
          Math.sin(dLng / 2) *
          Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c * 1000; // Convert to meters

        return {
          user_id: addr.user_id,
          name: addr.name,
          email: addr.email,
          phone: addr.phone,
          role: addr.role,
          cccd_status: addr.cccd_status,
          address: addr.address,
          lat: addr.lat,
          lng: addr.lng,
          rating: addr.rating,
          distance: parseFloat(distance.toFixed(2)), // Round to 2 decimal places
          service_variants: addr.service_variants || [], // Ensure service_variants is always an array
        };
      })
      .filter((user) => user.distance <= radius)
      .sort((a, b) => a.distance - b.distance);

    // Log the final result for debugging
    console.log(
      `✅ Tìm thấy ${usersInRange.length} tasker trong bán kính ${radius}m. Tổng tasker trước khi lọc khoảng cách: ${allAddresses.length}`
    );

    res.json({
      success: true,
      users: usersInRange,
      total_filtered_before_geofence: allAddresses.length,
      total_in_range: usersInRange.length,
    });
  } catch (error) {
    console.error("❌ Lỗi khi tìm kiếm người dùng trong phạm vi:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi tìm kiếm người dùng trong phạm vi",
      error: error.message,
    });
  }
};


// Lấy danh sách Tasker với khoảng cách từ user đăng nhập
exports.getTaskersWithDistance = async (req, res) => {
  try {
    const userId = req.user.user_id; // Lấy từ JWT qua middleware authenticateToken

    // Lấy vị trí user
    const userLocation = await Tasker.getUserLocation(userId);
    if (!userLocation) {
      return res.status(404).json({ error: 'Không tìm thấy địa chỉ của người dùng' });
    }

    const { lat: userLat, lng: userLng } = userLocation;

    // Lấy danh sách Tasker với khoảng cách
    const taskers = await Tasker.getTaskersWithDistance(userLat, userLng);

    res.json(taskers);
  } catch (err) {
    console.error('❌ Lỗi khi lấy danh sách Tasker:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
};
function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

// Lấy tasker theo id kèm danh sách service variants
exports.getWithServices = async (req, res) => {
  try {
    const { id } = req.params;
    console.log("🟡 [Controller] Nhận request id =", id);

    const tasker = await Tasker.findById(id);
    console.log("🟢 [Controller] Tasker:", tasker);

    const allTaskers = await Tasker.findAll("", "");
    console.log("📋 [Controller] Tổng taskers:", allTaskers.length);

    const target = allTaskers.find((t) => t.tasker_id == id);
    console.log("🎯 [Controller] Target tasker:", target);

    const variants = [];
    if (target?.services?.length) {
      target.services.forEach((service) => {
        service.variants.forEach((v) => {
          variants.push({
            ...v,
            service_id: service.service_id,
            service_name: service.name,
          });
        });
      });
    }
    console.log("✅ [Controller] Tổng variants lấy được:", variants.length);

    res.json({ success: true, tasker, variants });
  } catch (error) {
    console.error("❌ [Controller] Lỗi:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Nâng cấp customer -> tasker
exports.upgradeToTasker = async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    // Support both JSON and multipart form-data
    let introduce = "";
    let variant_ids = [];
    let certifications = [];
    let introduction_video = null; // optional video object
    if (req.is('application/json')) {
      const { introduce: introIn = "", variant_ids: variantsIn = [], certifications: certsIn = [], introduction_video: introVideoIn = null } = req.body || {};
      introduce = introIn;
      variant_ids = Array.isArray(variantsIn) ? variantsIn : [];
      certifications = Array.isArray(certsIn) ? certsIn : [];
      introduction_video = introVideoIn && typeof introVideoIn === 'object' ? introVideoIn : null;
    } else {
      // multipart: fields come as strings; variant_ids could be JSON or comma string
      introduce = req.body.introduce || "";
      const rawVariants = req.body.variant_ids;
      if (Array.isArray(rawVariants)) {
        variant_ids = rawVariants.map(v => parseInt(v, 10)).filter(Number.isFinite);
      } else if (typeof rawVariants === 'string' && rawVariants.trim()) {
        try {
          if (rawVariants.trim().startsWith('[')) {
            const parsed = JSON.parse(rawVariants);
            variant_ids = Array.isArray(parsed) ? parsed.map(v => parseInt(v, 10)).filter(Number.isFinite) : [];
          } else {
            variant_ids = rawVariants.split(',').map(v => parseInt(v.trim(), 10)).filter(Number.isFinite);
          }
        } catch (_) { variant_ids = []; }
      }
      // Certifications: can receive meta JSON array in field certifications OR derive from uploaded files
      if (req.body.certifications) {
        try {
          const parsed = JSON.parse(req.body.certifications);
          if (Array.isArray(parsed)) certifications = parsed;
        } catch (_) { /* ignore parse error */ }
      }
      // Merge uploaded files (deprecated path for direct URLs) removed to avoid storing permanent URLs.
      if (req.body.introduction_video) {
        try { const parsedVideo = JSON.parse(req.body.introduction_video); if (parsedVideo && parsedVideo.video_url) introduction_video = parsedVideo; } catch (_) { /* ignore */ }
      }
    }

    // Lấy danh sách dịch vụ tương ứng các variant để kiểm tra yêu cầu chứng chỉ
    let requiredServices = [];
    if (Array.isArray(variant_ids) && variant_ids.length) {
      const variantPlaceholders = variant_ids.map((_, i) => `@param${i + 1}`).join(',');
      const query = `SELECT DISTINCT s.service_id, s.name, s.requires_certificate
                     FROM ServiceVariants sv
                     JOIN Services s ON sv.service_id = s.service_id
                     WHERE sv.variant_id IN (${variantPlaceholders})`;
      const serviceResult = await executeQuery(query, variant_ids);
      requiredServices = serviceResult.recordset || [];
      const needingCert = requiredServices.filter(s => s.requires_certificate);
      if (needingCert.length) {
        // Build map service_id -> hasCert (accept cert_public_id or legacy cert_file_url)
        const map = new Map();
        for (const cert of certifications) {
          if (Number.isInteger(cert.service_id) && (cert.cert_public_id || cert.cert_file_url)) {
            map.set(cert.service_id, true);
          }
        }
        const missing = needingCert.filter(s => !map.get(s.service_id));
        if (missing.length) {
          return res.status(400).json({
            success: false,
            message: `Thiếu chứng chỉ cho các dịch vụ: ${missing.map(m => m.name).join(', ')}. Mỗi dịch vụ bắt buộc phải có ít nhất 1 chứng chỉ đính kèm.`
          });
        }
      }
    }

    // Kiểm tra user tồn tại và chưa có đơn pending/approved
    const userResult = await executeQuery("SELECT role FROM Users WHERE user_id = @param1", [userId]);
    if (!userResult.recordset.length) {
      return res.status(404).json({ success: false, message: "User không tồn tại" });
    }
    const currentRole = userResult.recordset[0].role;
    if (currentRole === 'Tasker') {
      return res.status(400).json({ success: false, message: "Tài khoản đã là Tasker" });
    }
    // Simple TaskerApplications table check / create record (assuming table exists); if not, attempt create.
    try {
      await executeQuery("IF OBJECT_ID('TaskerApplications','U') IS NULL BEGIN CREATE TABLE TaskerApplications (application_id INT IDENTITY(1,1) PRIMARY KEY, user_id INT NOT NULL, introduce NVARCHAR(MAX), variants_json NVARCHAR(MAX), certifications_json NVARCHAR(MAX), video_json NVARCHAR(MAX), status NVARCHAR(50) NOT NULL DEFAULT 'Pending', created_at DATETIME DEFAULT GETDATE(), reviewed_at DATETIME NULL, reviewer_id INT NULL, note NVARCHAR(MAX) NULL) END", []);
    } catch (tableErr) { console.warn('⚠️ Could not ensure TaskerApplications table:', tableErr.message); }
    // Prevent duplicate when there's already a Pending or Approved application
    const existingApp = await executeQuery("SELECT TOP 1 application_id, status FROM TaskerApplications WHERE user_id = @param1 AND status IN ('Pending','Approved') ORDER BY application_id DESC", [userId]);
    if (process.env.NODE_ENV !== 'production') {
      console.log('[upgradeToTasker] userId:', userId, 'existingApp:', existingApp.recordset);
    }
    if (existingApp.recordset.length) {
      const st = existingApp.recordset[0].status;
      if (st === 'Pending') {
        return res.status(400).json({ success:false, message:'Bạn đã gửi đơn và đang chờ duyệt.' });
      }
      if (st === 'Approved') {
        return res.status(400).json({ success:false, message:'Đơn trước đó đã được duyệt. Tài khoản đã là Tasker hoặc không thể gửi thêm đơn mới.' });
      }
    }
    // Insert new application (Pending)
    const appInsert = await executeQuery(
      "INSERT INTO TaskerApplications (user_id, introduce, variants_json, certifications_json, video_json, status) OUTPUT INSERTED.application_id VALUES (@param1, @param2, @param3, @param4, @param5, 'Pending')",
      [userId, introduce, JSON.stringify(variant_ids||[]), JSON.stringify(certifications||[]), JSON.stringify(introduction_video||null)]
    );
    const applicationId = appInsert.recordset?.[0]?.application_id;

    // Persist certificates only AFTER approval in old flow; now we still store ephemeral for future reference if needed.
    // (Optionally skip creating TaskerCertification records here; leaving code for potential audit but not committing role.)
    // 4. (Deferred) persist certificates if you want pre-approval storage – currently we skip DB insertion to avoid polluting TaskerCertification for non-approved.
    const createdCerts = []; // now always empty until approval step implemented
    const existingCerts = certifications.filter(c => c.cert_id);

    // Defer video persistence until approval (optionally keep now if business wants early indexing)

    res.status(201).json({
      success: true,
      message: "Gửi đơn thành công. Đơn đang ở trạng thái Pending chờ Staff duyệt.",
      data: {
        tasker_id: userId,
        introduce,
        variant_ids,
        certifications: [...existingCerts, ...createdCerts],
        application_id: applicationId,
        status: 'Pending',
        introduction_video: introduction_video || null,
        requires_certificate_services: requiredServices.filter(s => s.requires_certificate).map(s => s.service_id)
      },
    });
  } catch (error) {
    console.error('❌ Lỗi upgradeToTasker:', error);
    res.status(500).json({ success: false, message: 'Lỗi nâng cấp tasker', error: error.message });
  }
};

// Simple ping for certifications route health
exports.pingCertifications = (req, res) => {
  res.json({ ok: true, route: '/certifications/ping', time: new Date().toISOString() });
};

// Upload introduction application video (not yet tasker). Does not persist to DB here; returns Cloudinary info for client to include in upgrade payload.
exports.uploadApplicationVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No video file uploaded' });
    }
    const file = req.file;
    // multer-storage-cloudinary exposes path (secure_url), filename (public_id)
    const payload = {
      success: true,
      data: {
        video_url: file.path || file.secure_url || file.url,
        public_id: file.filename || file.public_id,
        bytes: file.bytes,
        format: file.format,
        duration: file.duration,
        resource_type: file.resource_type || 'video'
      }
    };
    res.json(payload);
  } catch (err) {
    console.error('❌ uploadApplicationVideo error:', err);
    res.status(500).json({ success: false, message: 'Upload video failed', error: err.message });
  }
};

// Staff: list tasker applications (default Pending)
exports.listTaskerApplications = async (req, res) => {
  try {
    const status = req.query.status || 'Pending';
    const apps = await TaskerApplication.findByStatus(status);
    const shaped = apps.map(a => ({
      ...a,
      certifications: Array.isArray(a.certifications) ? a.certifications.map(c => {
        if (c.delivery_type === 'authenticated' || c.cert_public_id) {
          return { ...c, cert_file_url: null, needsSigned: true };
        }
        return c;
      }) : a.certifications
    }));
    res.json({ success:true, data: shaped });
  } catch (e) {
    console.error('listTaskerApplications error', e);
    res.status(500).json({ success:false, message:'Lỗi lấy danh sách đơn', error: e.message });
  }
};

// Staff approve application
exports.approveTaskerApplication = async (req, res) => {
  try {
    const { id } = req.params; const reviewerId = req.user.userId;
    const app = await TaskerApplication.findById(id);
    if (!app) return res.status(404).json({ success:false, message:'Không tìm thấy đơn' });
    // (Removed stray userName declarations introduced by earlier patch; not needed for approve flow.)
    if (app.status !== 'Pending') return res.status(400).json({ success:false, message:'Đơn không ở trạng thái Pending' });
    // Create Tasker account if not already
    // 1. Update user role
    await executeQuery("UPDATE Users SET role='Tasker' WHERE user_id=@param1", [app.user_id]);
    // 2. Insert Taskers row if missing
    const existsTasker = await executeQuery("SELECT tasker_id FROM Taskers WHERE tasker_id=@param1", [app.user_id]);
    if (!existsTasker.recordset.length) {
      await executeQuery("INSERT INTO Taskers (tasker_id, Introduce, certifications, status, rating) VALUES (@param1, @param2, @param3, N'Active', 0)", [app.user_id, app.introduce || '', (app.certifications||[]).map(c=>c.cert_name).join(', ')]);
    }
    // 3. Variants linking
    if (Array.isArray(app.variants) && app.variants.length) {
      for (const variantId of app.variants) {
        await executeQuery("IF NOT EXISTS (SELECT 1 FROM TaskerServiceVariants WHERE tasker_id=@param1 AND variant_id=@param2) INSERT INTO TaskerServiceVariants (tasker_id, variant_id) VALUES (@param1, @param2)", [app.user_id, variantId]);
      }
    }
    // 4. Persist certificates into TaskerCertifications if any not already persisted (looking for cert_id absence)
    if (Array.isArray(app.certifications) && app.certifications.length) {
      const newlyCreatedIds = [];
      const existingIds = [];
      for (const cert of app.certifications) {
        if (cert.cert_id) { existingIds.push(cert.cert_id); continue; } // already in DB
        // We no longer require storing a permanent cert_file_url for authenticated assets.
        // Accept record if either cert_file_url exists (legacy) OR cert_public_id exists (new secure flow).
        if (!cert.cert_file_url && !cert.cert_public_id) continue;
        const initialAI = {};
        const effParsedCertName = cert.parsed_cert_name || cert.cert_name || null;
        const effParsedIssuedBy = cert.parsed_issued_by || cert.issued_by || null;
        const effParsedIssuedDate = cert.parsed_issued_date || cert.issued_date || null;
        if (effParsedCertName) initialAI.parsed_cert_name = effParsedCertName;
        if (effParsedIssuedBy) initialAI.parsed_issued_by = effParsedIssuedBy;
        if (effParsedIssuedDate) initialAI.parsed_issued_date = effParsedIssuedDate;
        if (cert.parsed_holder_name) initialAI.parsed_holder_name = cert.parsed_holder_name;
        if (cert.parsed_grade_or_level) initialAI.parsed_grade_or_level = cert.parsed_grade_or_level;
        if (cert.parsed_certificate_code) initialAI.parsed_certificate_code = cert.parsed_certificate_code;
        if (cert.ai_detected_service) initialAI.ai_detected_service = cert.ai_detected_service;
        if (cert.ai_confidence !== undefined) initialAI.ai_confidence = cert.ai_confidence;
        if (cert.ai_status) initialAI.ai_status = cert.ai_status; else initialAI.ai_status = 'Snapshot';
        if (cert.needs_review !== undefined) initialAI.needs_review = cert.needs_review;
        try {
          const row = await TaskerCertification.create(app.user_id, {
            cert_name: cert.cert_name || effParsedCertName,
            cert_public_id: cert.cert_public_id || null,
            delivery_type: cert.delivery_type || (cert.cert_public_id ? 'authenticated' : null),
            service_id: Number.isInteger(cert.service_id) ? cert.service_id : null,
            issued_by: cert.issued_by || effParsedIssuedBy,
            issued_date: cert.issued_date || effParsedIssuedDate,
            initialAI
          });
          if (row && row.cert_id) newlyCreatedIds.push(row.cert_id);
        } catch (ce) { console.warn('Persist cert on approve failed', ce.message); }
      }
      // Mark certifications as approved (both existing and newly created)
      const toApprove = [...new Set([...
        newlyCreatedIds,
        ...existingIds.filter(id => Number.isInteger(id))
      ])];
      if (toApprove.length) {
        const placeholders = toApprove.map((_,i)=>`@param${i+2}`).join(',');
        try {
          await executeQuery(`UPDATE TaskerCertifications SET verified_at = GETDATE(), verified_by = @param1, status = 'Approved', ai_status = CASE WHEN ai_status IS NULL OR ai_status = 'Snapshot' THEN 'Verified' ELSE ai_status END WHERE cert_id IN (${placeholders})`, [reviewerId, ...toApprove]);
        } catch (verr) { console.warn('Mark approve failed', verr.message); }
      }
    }
    // 5. Persist video if any
    if (app.introduction_video && app.introduction_video.video_url) {
      try {
        await executeQuery(`INSERT INTO Videos (user_id, title, description, video_url, public_id, likes, uploaded_at, is_deleted) VALUES (@param1,@param2,@param3,@param4,@param5,0,GETDATE(),0)`, [app.user_id, app.introduction_video.title || 'Giới thiệu', app.introduction_video.description || '', app.introduction_video.video_url, app.introduction_video.public_id || null]);
      } catch (ve) { console.warn('Persist video on approve failed', ve.message); }
    }
    // 6. Mark application approved
    const updated = await TaskerApplication.approve(id, reviewerId);
    res.json({ success:true, message:'Đã duyệt đơn', data: updated });
  } catch (e) {
    console.error('approveTaskerApplication error', e);
    res.status(500).json({ success:false, message:'Lỗi duyệt đơn', error: e.message });
  }
};

// Staff reject application
exports.rejectTaskerApplication = async (req, res) => {
  try {
    const { id } = req.params; const reviewerId = req.user.userId; const { note } = req.body || {};
    const app = await TaskerApplication.findById(id);
    if (!app) return res.status(404).json({ success:false, message:'Không tìm thấy đơn' });
    if (app.status !== 'Pending') return res.status(400).json({ success:false, message:'Đơn không ở trạng thái Pending' });
    const updated = await TaskerApplication.reject(id, reviewerId, note);
    res.json({ success:true, message:'Đã từ chối đơn', data: updated });
  } catch (e) {
    console.error('rejectTaskerApplication error', e);
    res.status(500).json({ success:false, message:'Lỗi từ chối đơn', error: e.message });
  }
};

// Staff view application detail
exports.getTaskerApplicationDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const app = await TaskerApplication.findById(id);
    if (!app) return res.status(404).json({ success:false, message:'Không tìm thấy đơn' });
    // Fetch user profile basic
  // Removed avatar_url (column not present in current Users schema). Provide NULL as placeholder to keep response shape stable if frontend expects it later.
  const userRes = await executeQuery("SELECT user_id, name, email, phone, role, NULL AS avatar_url FROM Users WHERE user_id=@param1", [app.user_id]);
    const user = userRes.recordset.length ? userRes.recordset[0] : null;
    // Primary address (nếu có 1 record)
    const addrRes = await executeQuery("SELECT TOP 1 address, lat, lng FROM Addresses WHERE user_id=@param1", [app.user_id]);
    const address = addrRes.recordset.length ? addrRes.recordset[0] : null;
    // Enrich variants -> variant_details + services_summary
    let variantDetails = [];
    let servicesSummary = [];
    if (Array.isArray(app.variants) && app.variants.length) {
      const variantIds = app.variants.filter(v => Number.isInteger(v));
      if (variantIds.length) {
        const placeholders = variantIds.map((_,i)=>`@param${i+1}`).join(',');
        const sql = `SELECT sv.variant_id, sv.variant_name, sv.service_id, s.name AS service_name
                     FROM ServiceVariants sv
                     JOIN Services s ON sv.service_id = s.service_id
                     WHERE sv.variant_id IN (${placeholders})`;
        try {
          const vr = await executeQuery(sql, variantIds);
          variantDetails = vr.recordset || [];
          const grouped = new Map();
          for (const vd of variantDetails) {
            if (!grouped.has(vd.service_id)) grouped.set(vd.service_id, { service_id: vd.service_id, service_name: vd.service_name, variants: [] });
            grouped.get(vd.service_id).variants.push({ variant_id: vd.variant_id, variant_name: vd.variant_name });
          }
          servicesSummary = Array.from(grouped.values());
        } catch (enErr) {
          console.warn('Variant enrichment failed', enErr.message);
        }
      }
    }
    // Response shaping for certificates: remove direct cert_file_url if authenticated
    const shapedCerts = Array.isArray(app.certifications) ? app.certifications.map(c => {
      if (c.delivery_type === 'authenticated' || c.cert_public_id) {
        return { ...c, cert_file_url: null, needsSigned: true };
      }
      return c;
    }) : app.certifications;
    const enrichedApp = { ...app, certifications: shapedCerts, variant_details: variantDetails, services_summary: servicesSummary };
    res.json({ success:true, data: { application: enrichedApp, user, address } });
  } catch (e) {
    console.error('getTaskerApplicationDetail error', e);
    res.status(500).json({ success:false, message:'Lỗi lấy chi tiết đơn', error: e.message });
  }
};

// Get my latest application status (for current user)
exports.getMyTaskerApplicationStatus = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.user_id;
    if (!userId) return res.status(401).json({ success:false, message:'Unauthorized' });
    // Ensure table exists
    try {
      await executeQuery("IF OBJECT_ID('TaskerApplications','U') IS NULL BEGIN CREATE TABLE TaskerApplications (application_id INT IDENTITY(1,1) PRIMARY KEY, user_id INT NOT NULL, introduce NVARCHAR(MAX), variants_json NVARCHAR(MAX), certifications_json NVARCHAR(MAX), video_json NVARCHAR(MAX), status NVARCHAR(50) NOT NULL DEFAULT 'Pending', created_at DATETIME DEFAULT GETDATE(), reviewed_at DATETIME NULL, reviewer_id INT NULL, note NVARCHAR(MAX) NULL) END", []);
    } catch(_) {}
    const r = await executeQuery("SELECT TOP 1 application_id, status, created_at, reviewed_at, note FROM TaskerApplications WHERE user_id=@param1 ORDER BY application_id DESC", [userId]);
    if (process.env.NODE_ENV !== 'production') {
      console.log('[getMyTaskerApplicationStatus] userId:', userId, 'result:', r.recordset);
    }
    if (!r.recordset.length) return res.json({ success:true, data: { hasApplication:false, status:null } });
    const row = r.recordset[0];
    return res.json({ success:true, data: { hasApplication:true, application_id: row.application_id, status: row.status, created_at: row.created_at, reviewed_at: row.reviewed_at, note: row.note } });
  } catch (e) {
    console.error('getMyTaskerApplicationStatus error', e);
    res.status(500).json({ success:false, message:'Lỗi lấy trạng thái đơn', error: e.message });
  }
};

// Debug upload without auth (TEMP) – mirrors old route logic
exports.debugUploadCertifications = async (req, res) => {
  try {
    if (!req.files || !req.files.length) return res.status(400).json({ success: false, message: 'No files' });
    if (certificateUpload) {
      return res.json({ success: true, debug: true, files: req.files.map(f => ({ original: f.originalname, url: f.path })) });
    }
    const uploads = await Promise.all(req.files.map(file => new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ folder: 'homehelper/debug', resource_type: 'auto' }, (error, result) => {
        if (error) return reject(error);
        resolve(result);
      });
      stream.end(file.buffer);
    })));
    res.json({ success: true, debug: true, files: uploads.map(u => ({ original: u.original_filename, url: u.secure_url || u.url })) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// Handle certificate file upload (no AI) – storage or fallback stream
exports.uploadCertifications = async (req, res) => {
  req._startAt = Date.now();
  const { certificateUpload: storageEnabled } = require('../config/cloudinary');
  console.log('📥 /certifications/upload hit (controller)', {
    hasFiles: !!req.files, fileCount: req.files?.length, middleware: storageEnabled ? 'cloudinary-storage' : 'memory',
    contentType: req.headers['content-type']
  });
  try {
    if (!req.files || !req.files.length) {
      return res.status(400).json({ success: false, message: 'Chưa chọn file chứng chỉ' });
    }
    if (storageEnabled) {
      // multer-storage-cloudinary puts the cloudinary result JSON into file.path or file.filename? Actually f.path contains the URL.
      // We need public_id but multer-storage-cloudinary exposes it as file.filename (public_id) and path (url).
      const result = { success: true, data: { files: req.files.map(f => ({
        original: f.originalname,
        url: f.path,
        public_id: f.filename, // provided by storage engine
        delivery_type: 'authenticated'
      })) } };
      console.log('✅ Upload (storage) done in', Date.now() - req._startAt, 'ms');
      return res.json(result);
    }
    const userId = (req.user && (req.user.userId || req.user.user_id)) || 'anonymous';
    const folderBase = process.env.CLOUDINARY_FOLDER_BASE || 'homehelper';
    const folder = `${folderBase}/certificates/${userId}`;
    const uploads = await Promise.all(req.files.map(file => new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ folder, resource_type: 'auto', type: 'authenticated' }, (error, result) => {
        if (error) return reject(error);
        resolve(result);
      });
      stream.end(file.buffer);
    })));
    const payload = { success: true, data: { files: uploads.map(u => ({
      original: u.original_filename,
      url: u.secure_url || u.url,
      public_id: u.public_id,
      delivery_type: 'authenticated'
    })) } };
    console.log('✅ Upload (stream) done in', Date.now() - req._startAt, 'ms');
    res.json(payload);
  } catch (err) {
    console.error('❌ Upload certificate error:', err);
    res.status(500).json({ success: false, message: 'Upload chứng chỉ thất bại', error: err.message });
  }
};

// Re-run AI extraction for existing certification
exports.extractAICertification = async (req, res) => {
  try {
    const { cert_id } = req.params;
    const cert = await TaskerCertification.findById(parseInt(cert_id,10));
    if (!cert) return res.status(404).json({ success:false, message:'Không tìm thấy chứng chỉ' });
    if (cert.tasker_id !== req.user.userId) {
      return res.status(403).json({ success:false, message:'Không có quyền với chứng chỉ này' });
    }
    await TaskerCertification.updateAIExtraction(cert.cert_id, { ai_status: 'Processing' });
    // Determine the URL to use for AI: prefer signed URL when using authenticated delivery or when direct URL not stored
    let aiUrl = cert.cert_file_url;
    if ((!aiUrl || cert.delivery_type === 'authenticated') && cert.cert_public_id) {
      try {
        const { generateSignedCertificateUrl } = require('../config/cloudinary');
        const { url } = generateSignedCertificateUrl(cert.cert_public_id, { resource_type: 'image', ttlSeconds: 600 });
        aiUrl = url;
      } catch (signErr) {
        console.warn('Signed URL for re-extract failed:', signErr.message);
      }
    }
    console.log('🔍 [AI-EXTRACT] Start re-extract cert_id', cert.cert_id, 'url=', aiUrl);
    const { rawText, parsed } = await extractCertificateFromUrl(aiUrl);
    const updated = await TaskerCertification.updateAIExtraction(cert.cert_id, {
      extracted_payload: rawText,
      ai_model: 'gemini-2.5-flash',
      ai_confidence: parsed.confidence,
      ai_status: 'Extracted',
      needs_review: parsed.confidence !== null && parsed.confidence < 0.75 ? 1 : 0,
      parsed_cert_name: parsed.cert_name,
      parsed_issued_by: parsed.issued_by,
      parsed_issued_date: parsed.issued_date_iso,
      parsed_holder_name: parsed.holder_name,
      parsed_grade_or_level: parsed.level_or_grade,
      parsed_certificate_code: parsed.certificate_code
    });
    // Backfill base columns if still null and parsed now available
    try {
      const baseUpdateFields = [];
      const baseParams = [];
      if (!cert.cert_name && parsed.cert_name) { baseUpdateFields.push('cert_name = @param1'); baseParams.push(parsed.cert_name); }
      if (!cert.issued_by && parsed.issued_by) { baseUpdateFields.push(`issued_by = @param${baseParams.length+1}`); baseParams.push(parsed.issued_by); }
      if (!cert.issued_date && parsed.issued_date_iso) { baseUpdateFields.push(`issued_date = @param${baseParams.length+1}`); baseParams.push(parsed.issued_date_iso); }
      if (baseUpdateFields.length) {
        baseParams.push(cert.cert_id);
        const q = `UPDATE TaskerCertifications SET ${baseUpdateFields.join(', ')} WHERE cert_id = @param${baseParams.length}`;
        await executeQuery(q, baseParams);
      }
    } catch (bfErr) { console.warn('Backfill base columns failed', bfErr.message); }
    console.log('✅ [AI-EXTRACT] Done cert_id', cert.cert_id, 'parsed_date=', parsed.issued_date_iso);
    res.json({ success:true, data: updated });
  } catch (e) {
    console.error('AI extract error', e);
    res.status(500).json({ success:false, message: e.message });
  }
};

// Generate short-lived signed URL for a stored authenticated certificate
exports.getSignedCertificateUrl = async (req, res) => {
  try {
    const { cert_id } = req.params;
    if (!cert_id) return res.status(400).json({ success:false, message:'Missing cert_id' });
    const cert = await TaskerCertification.findById(parseInt(cert_id,10));
    if (!cert) return res.status(404).json({ success:false, message:'Không tìm thấy chứng chỉ' });
    // Authorization: owner or staff (role check simplified)
  const isOwner = req.user && (req.user.userId === cert.tasker_id || req.user.user_id === cert.tasker_id);
  const roleStr = (req.user && (req.user.role || req.user.roleName)) ? String(req.user.role || req.user.roleName) : '';
  let isStaff = /^(admin|staff)$/i.test(roleStr);
  if (!isStaff) {
    try {
      const auth = req.headers['authorization'] || '';
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (m) {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.decode(m[1]);
        if (decoded && decoded.role && /^(admin|staff)$/i.test(String(decoded.role))) {
          isStaff = true;
        }
      }
    } catch(_) {}
  }
    if (!isOwner && !isStaff) {
      return res.status(403).json({ success:false, message:'Không có quyền truy cập chứng chỉ' });
    }
    if (!cert.cert_public_id || cert.delivery_type !== 'authenticated') {
      return res.status(400).json({ success:false, message:'Chứng chỉ không phải loại authenticated hoặc thiếu public_id' });
    }
    const { generateSignedCertificateUrl } = require('../config/cloudinary');
    const { url, expiresAt } = generateSignedCertificateUrl(cert.cert_public_id, { resource_type: 'image', ttlSeconds: 3600 });
    return res.json({ success:true, data: { url, expiresAt } });
  } catch (e) {
    console.error('getSignedCertificateUrl error', e);
    res.status(500).json({ success:false, message:'Lỗi tạo signed URL', error: e.message });
  }
};

// Generate short-lived signed URL by public_id (alternative access path)
exports.getSignedCertificateUrlByPublicId = async (req, res) => {
  try {
    const { public_id } = req.query;
    if (!public_id) return res.status(400).json({ success:false, message:'Missing public_id' });
    let cert = await TaskerCertification.findByPublicId(public_id);
  const requester = req.user || req.authUser || {};
  const requesterId = requester.user_id || requester.userId || requester.id;
  const roleStr2 = requester && (requester.role || requester.roleName) ? String(requester.role || requester.roleName) : '';
  let isStaff = /^(admin|staff)$/i.test(roleStr2);
  if (!isStaff) {
    try {
      const auth = req.headers['authorization'] || '';
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (m) {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.decode(m[1]);
        if (decoded && decoded.role && /^(admin|staff)$/i.test(String(decoded.role))) {
          isStaff = true;
        }
      }
    } catch(_) {}
  }

    if (!cert) {
      // Ephemeral path: derive owner from public_id (e.g., homehelper/certificates/{userId}/...)
      const m = String(public_id).match(/certificates\/(\d+)\//);
      const ownerFromPath = m ? parseInt(m[1], 10) : null;
      const isOwnerByPath = ownerFromPath && requesterId && Number(ownerFromPath) === Number(requesterId);
      if (!isStaff && !isOwnerByPath) {
        return res.status(403).json({ success:false, message:'Không có quyền truy cập chứng chỉ (owner mismatch)' });
      }
      const { generateSignedCertificateUrl } = require('../config/cloudinary');
      const signed = generateSignedCertificateUrl(public_id, { resource_type: 'image', ttlSeconds: 3600 });
      if (!signed || !signed.url) return res.status(404).json({ success:false, message:'Không tạo được signed URL' });
      return res.json({ success:true, data: { url: signed.url, expiresAt: signed.expiresAt } });
    }

    // Found in DB: owner or staff
    const isOwner = requesterId && cert.tasker_id && Number(requesterId) === Number(cert.tasker_id);
    if (!isStaff && !isOwner) {
      return res.status(403).json({ success:false, message:'Không có quyền truy cập chứng chỉ' });
    }
    if (!cert.cert_public_id || cert.delivery_type !== 'authenticated') {
      return res.status(400).json({ success:false, message:'Chứng chỉ không phải loại authenticated hoặc thiếu public_id' });
    }
    const { generateSignedCertificateUrl } = require('../config/cloudinary');
    const { url, expiresAt } = generateSignedCertificateUrl(cert.cert_public_id, { resource_type: 'image', ttlSeconds: 3600 });
    return res.json({ success:true, data: { url, expiresAt } });
  } catch (e) {
    console.error('getSignedCertificateUrlByPublicId error', e);
    res.status(500).json({ success:false, message:'Lỗi tạo signed URL', error: e.message });
  }
};

// Create (ephemeral by default) certification with AI extraction & validations
exports.createCertification = async (req, res) => {
  try {
    const { service_id, cert_name, cert_file_url, cert_public_id, delivery_type, issued_by, issued_date, persist } = req.body;
  if (!cert_public_id && !cert_file_url) return res.status(400).json({ success:false, message:'Thiếu thông tin nguồn chứng chỉ (cần cert_public_id hoặc cert_file_url)' });
    const shouldPersist = persist === 1 || persist === '1' || persist === true || persist === 'true';
    if (!shouldPersist) {
      try {
        const userId = req.user.userId;
        // Optional variant_ids passed for service validation
        let variant_ids = [];
        if (req.body.variant_ids) {
          if (Array.isArray(req.body.variant_ids)) variant_ids = req.body.variant_ids.map(v=>parseInt(v,10)).filter(Number.isFinite);
          else if (typeof req.body.variant_ids === 'string') {
            try { const parsedVar = JSON.parse(req.body.variant_ids); if (Array.isArray(parsedVar)) variant_ids = parsedVar.map(v=>parseInt(v,10)).filter(Number.isFinite); } catch(_){ }
          }
        }
        const { executeQuery } = require('../config/database');
        const normalize = (s)=> (s||'').toString().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/[^a-z0-9]+/g,' ').trim();
        if (!process.env.GEMINI_API_KEY) {
          return res.json({ success:true, data: { cert_id: null, cert_name: cert_name || null, cert_file_url: null, cert_public_id: cert_public_id || null, delivery_type: delivery_type || (cert_public_id ? 'authenticated' : null), issued_by: issued_by || null, issued_date: issued_date || null, ai_status: 'Skipped', ai_confidence: null, needs_review: 0, _ephemeral: true, duplication_checked: false }, info: 'Ephemeral mode (no persist) - thiếu GEMINI_API_KEY' });
        }
        // Determine AI source URL: prefer signed URL when authenticated/public_id provided
        let ephemeralUrl = cert_file_url;
        if ((!ephemeralUrl || delivery_type === 'authenticated') && cert_public_id) {
          try {
            const { generateSignedCertificateUrl } = require('../config/cloudinary');
            const { url } = generateSignedCertificateUrl(cert_public_id, { resource_type: 'image', ttlSeconds: 300 });
            ephemeralUrl = url;
          } catch(signErr){ console.warn('Signed URL (ephemeral) failed', signErr.message); }
        }
        console.log('🔍 [AI-CREATE-EPHEMERAL] Start URL', ephemeralUrl);
        const { rawText, parsed } = await extractCertificateFromUrl(ephemeralUrl);
        console.log('✅ [AI-CREATE-EPHEMERAL] Parsed date', parsed.issued_date_iso);
        // AI Service Classification
        let aiDetectedService = null; let aiServiceMatch = true; let aiServiceScore = null; let aiServiceMismatchBlock = false;
        const classifyService = getClassifyService();
        if (classifyService) {
          try {
            const svcListRes = await executeQuery('SELECT service_id, name FROM Services');
            const svcList = svcListRes.recordset || [];
            const certTextForCls = [parsed.cert_name, parsed.issued_by, parsed.holder_name, parsed.level_or_grade].filter(Boolean).join(' ');
            const cls = classifyService({ services: svcList, text: certTextForCls });
            if (cls.detected) {
              aiDetectedService = cls.detected.slug;
              aiServiceScore = cls.detected.score;
              if (service_id) {
                const detectedIds = cls.detected.serviceIds || [];
                aiServiceMatch = detectedIds.includes(parseInt(service_id,10));
                if (!aiServiceMatch) {
                  const requiresRow = await executeQuery('SELECT requires_certificate FROM Services WHERE service_id = @param1', [service_id]);
                  if (requiresRow.recordset && requiresRow.recordset.length && requiresRow.recordset[0].requires_certificate) {
                    aiServiceMismatchBlock = true;
                  }
                }
              }
            }
          } catch (clsErr) { console.warn('Service classification failed', clsErr.message); }
        }
        if (aiServiceMismatchBlock) {
          // Heuristic override: if certificate text clearly relates to the selected service via synonyms, don't block
          try {
            const svcNameRes = await executeQuery('SELECT name FROM Services WHERE service_id = @param1', [service_id]);
            const serviceName = (svcNameRes.recordset && svcNameRes.recordset.length) ? (svcNameRes.recordset[0].name || '') : '';
            const norm = s => (s||'').toString().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/[^a-z0-9]+/g,' ').trim();
            const serviceTokens = norm(serviceName).split(' ').filter(Boolean);
            const synonyms = {
              'dieu hoa': [
                'dieu hoa', 'may lanh', 'air', 'aircon', 'airconditioner', 'hvac', 'lanh', 'air conditioning', 'dien lanh', 'điện lạnh',
                'sua dieu hoa', 'sua chua dieu hoa', 'sua chua may lanh', 'sua chua dien lanh', 'bao tri dieu hoa', 'bao tri may lanh',
                'dien dan dung', 'sua chua dien dan dung', 'dien gia dung', 'sua chua dien gia dung', 'sua chua dien', 'tho dien'
              ],
              'cham soc nguoi cao tuoi': [
                'cham soc nguoi cao tuoi', 'nguoi cao tuoi', 'elderly care', 'elderly',
                'old people', 'cham soc', 'cham soc nguoi gia', 'nguoi gia'
              ],
              'nau an': [
                'nau an', 'nau mon', 'lam mon an', 'am thuc', 'hoc nau an', 'day nau an',
                'khoa hoc nau an', 'lop hoc nau an', 'mon an', 'mon ngon', 'chef', 'cook',
                'cooking', 'culinary', 'culinary arts', 'cooking class', 'cooking course',
                'food preparation', 'recipe', 'dish', 'cuisine', 'baking', 'pastry'
              ]
            };
            let expandedServiceTokens = new Set(serviceTokens);
            for (const key in synonyms) {
              if (norm(serviceName).includes(key)) {
                for (const w of synonyms[key]) expandedServiceTokens.add(norm(w));
              }
            }
            const certText = [parsed.cert_name, parsed.issued_by, parsed.holder_name, parsed.level_or_grade].filter(Boolean).join(' ');
            const certNorm = norm(certText);
            let matchCount = 0;
            for (const token of expandedServiceTokens) { if (!token || token.length < 3) continue; if (certNorm.includes(token)) matchCount++; }
            if (matchCount > 0) {
              aiServiceMismatchBlock = false;
            }
          } catch(_) {}
        }
        if (aiServiceMismatchBlock) {
          return res.status(400).json({ success:false, ai_service_mismatch:true, message:'Chứng chỉ không thuộc nhóm dịch vụ đã chọn', ai_detected_service: aiDetectedService, ai_service_score: aiServiceScore });
        }
        // Duplicate check
  const existing = await executeQuery(`SELECT cert_id, cert_name, cert_public_id, issued_by, issued_date, parsed_cert_name, parsed_issued_by, parsed_issued_date, parsed_certificate_code, extracted_payload FROM TaskerCertifications WHERE tasker_id = @param1`, [userId]);
        const existingRows = existing.recordset || [];
        let isDuplicate = false; let duplicateCertId = null; let duplicateReason = '';
        const newCode = (parsed.certificate_code || '').trim();
        const extractInlineJSON = (raw) => {
          if (!raw) return null;
          try {
            const first = raw.indexOf('{');
            const last = raw.lastIndexOf('}');
            if (first !== -1 && last !== -1 && last > first) {
              return JSON.parse(raw.substring(first, last + 1));
            }
            return JSON.parse(raw);
          } catch { return null; }
        };
        for (const row of existingRows) {
          // 1) Same public id (preferred) or same file URL (legacy)
          if (row.cert_public_id && cert_public_id && row.cert_public_id === cert_public_id) { isDuplicate = true; duplicateCertId = row.cert_id; duplicateReason = 'Trùng file chứng chỉ (public_id)'; break; }
          if (row.cert_file_url && cert_file_url && row.cert_file_url === cert_file_url) { isDuplicate = true; duplicateCertId = row.cert_id; duplicateReason = 'Trùng file chứng chỉ (URL)'; break; }
          // 2) Certificate code comparison (including fallback JSON parse)
          let rowCode = row.parsed_certificate_code;
          if (!rowCode && row.extracted_payload) {
            const parsedPayload = extractInlineJSON(row.extracted_payload);
            if (parsedPayload && parsedPayload.certificate_code) rowCode = parsedPayload.certificate_code;
          }
          if (newCode && rowCode && newCode.toLowerCase() === rowCode.toLowerCase()) { isDuplicate = true; duplicateCertId = row.cert_id; duplicateReason = 'Trùng mã chứng chỉ'; break; }
        }
        if (!isDuplicate) {
          const nName = normalize(parsed.cert_name || cert_name);
          const nIssuer = normalize(parsed.issued_by || issued_by);
          const nDate = (parsed.issued_date_iso || issued_date || '').toString().slice(0,10);
          for (const row of existingRows) {
            const rName = normalize(row.parsed_cert_name || row.cert_name);
            const rIssuer = normalize(row.parsed_issued_by || row.issued_by);
            const rowDateVal = row.parsed_issued_date || row.issued_date || '';
            const rDate = rowDateVal ? rowDateVal.toString().slice(0,10) : '';
            if (nName && rName && nName === rName && nIssuer === rIssuer && nDate === rDate) { isDuplicate = true; duplicateCertId = row.cert_id; duplicateReason = 'Trùng tên + đơn vị cấp + ngày cấp'; break; }
          }
        }
        if (isDuplicate) {
          return res.status(409).json({ success:false, duplicate:true, message: `Chứng chỉ đã tồn tại trong hệ thống. Bạn không được phép dùng chứng chỉ này!` });
        }
        // Service vs variant validation
        let serviceMismatch = false; let allowedServiceIds = [];
        if (variant_ids.length && service_id) {
          const placeholders = variant_ids.map((_,i)=>`@param${i+1}`).join(',');
          const svcQuery = `SELECT DISTINCT s.service_id FROM ServiceVariants sv JOIN Services s ON sv.service_id = s.service_id WHERE sv.variant_id IN (${placeholders})`;
          const svcRes = await executeQuery(svcQuery, variant_ids);
          allowedServiceIds = (svcRes.recordset||[]).map(r=>r.service_id);
          if (!allowedServiceIds.includes(parseInt(service_id,10))) serviceMismatch = true;
        }
        if (serviceMismatch) {
          return res.status(400).json({ success:false, service_mismatch:true, message:'Chứng chỉ không thuộc dịch vụ/biến thể đã chọn' });
        }
        // Semantic content vs service heuristic
        let serviceContentMismatch = false; let contentReason='';
        if (service_id) {
          const svcNameRes = await executeQuery('SELECT name, requires_certificate FROM Services WHERE service_id = @param1', [service_id]);
          if (svcNameRes.recordset && svcNameRes.recordset.length) {
            const serviceName = svcNameRes.recordset[0].name || '';
            const requiresCert = svcNameRes.recordset[0].requires_certificate;
            const norm = s => (s||'').toString().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/[^a-z0-9]+/g,' ').trim();
            const serviceTokens = norm(serviceName).split(' ').filter(Boolean);
            const synonyms = {
              'dieu hoa': [
                'dieu hoa', 'may lanh', 'air', 'aircon', 'airconditioner', 'hvac', 'lanh', 'air conditioning', 'dien lanh', 'điện lạnh',
                // Added repair/maintenance related phrases so certificates like "sửa chữa điện lạnh" or "sửa chữa điện dân dụng" are accepted
                'sua dieu hoa', 'sua chua dieu hoa', 'sua chua may lanh', 'sua chua dien lanh', 'bao tri dieu hoa', 'bao tri may lanh',
                // General electrical repair treated as acceptable background for AC repair
                'dien dan dung', 'sua chua dien dan dung', 'dien gia dung', 'sua chua dien gia dung', 'sua chua dien', 'tho dien'
              ],
              'cham soc nguoi cao tuoi': [
                'cham soc nguoi cao tuoi', 'nguoi cao tuoi', 'elderly care', 'elderly',
                'old people', 'cham soc', 'cham soc nguoi gia', 'nguoi gia'
              ],
              'nau an': [
                'nau an', 'nau mon', 'lam mon an', 'am thuc', 'hoc nau an', 'day nau an',
                'khoa hoc nau an', 'lop hoc nau an', 'mon an', 'mon ngon', 'chef', 'cook',
                'cooking', 'culinary', 'culinary arts', 'cooking class', 'cooking course',
                'food preparation', 'recipe', 'dish', 'cuisine', 'baking', 'pastry'
              ]
            };
            let expandedServiceTokens = new Set(serviceTokens);
            for (const key in synonyms) {
              if (norm(serviceName).includes(key)) { for (const w of synonyms[key]) expandedServiceTokens.add(norm(w)); }
            }
            const certText = [parsed.cert_name, parsed.issued_by, parsed.holder_name, parsed.level_or_grade].filter(Boolean).join(' ');
            const certNorm = norm(certText);
            let matchCount = 0;
            for (const token of expandedServiceTokens) { if (!token || token.length < 3) continue; if (certNorm.includes(token)) matchCount++; }
            if (matchCount === 0 && requiresCert) { serviceContentMismatch = true; contentReason = 'Không tìm thấy từ khóa liên quan đến dịch vụ trong chứng chỉ'; }
            else if (matchCount === 0) {
              const elderlyWords = ['nguoi cao tuoi','elderly','cham soc nguoi cao tuoi','cham soc'];
              const hvacWords = ['dieu hoa','may lanh','airconditioner','hvac'];
              const inElderly = elderlyWords.some(w=>certNorm.includes(w));
              const inHVAC = hvacWords.some(w=>certNorm.includes(w));
              if (inElderly && serviceTokens.some(t=>['dieu','hoa','dieu hoa','may lanh'].includes(t))) { serviceContentMismatch = true; contentReason = 'Nội dung chứng chỉ thuộc lĩnh vực chăm sóc người già'; }
              if (inHVAC && serviceTokens.some(t=>['cham','soc','cham soc','nguoi','cao','tuoi'].includes(t))) { serviceContentMismatch = true; contentReason = 'Nội dung chứng chỉ thuộc lĩnh vực điều hòa'; }
            }
          }
        }
        if (serviceContentMismatch) {
          return res.status(400).json({ success:false, service_content_mismatch:true, message: contentReason || 'Chứng chỉ không khớp nội dung dịch vụ' });
        }
        // Holder name validation
        let holderNameMatch = true; let holderCompare = {};
        if (parsed.holder_name) {
          const userRes = await executeQuery('SELECT name FROM Users WHERE user_id = @param1',[userId]);
          if (userRes.recordset && userRes.recordset.length) {
            const userName = userRes.recordset[0].name || '';
            const nUser = normalize(userName); const nHolder = normalize(parsed.holder_name);
            if (nUser && nHolder && nUser !== nHolder && !nHolder.includes(nUser) && !nUser.includes(nHolder)) {
              holderNameMatch = false; holderCompare = { user_name: userName, extracted_holder_name: parsed.holder_name };
            }
          }
        }
        return res.json({ success:true, data: {
          cert_id: null,
          cert_name: parsed.cert_name || cert_name || null,
          cert_file_url: null,
          cert_public_id: cert_public_id || null,
          delivery_type: delivery_type || (cert_public_id ? 'authenticated' : null),
          service_id: service_id ? parseInt(service_id,10) : null,
          issued_by: parsed.issued_by || issued_by || null,
          issued_date: parsed.issued_date_iso || issued_date || null,
          ai_status: 'Extracted',
          ai_confidence: parsed.confidence,
          needs_review: parsed.confidence !== null && parsed.confidence < 0.75 ? 1 : 0,
          _ephemeral: true,
          raw_ai: rawText,
          // Added explicit parsed_* fields so FE can persist them later
          parsed_cert_name: parsed.cert_name || null,
          parsed_issued_by: parsed.issued_by || null,
          parsed_issued_date: parsed.issued_date_iso || null,
          parsed_holder_name: parsed.holder_name || null,
          parsed_grade_or_level: parsed.level_or_grade || null,
          parsed_certificate_code: parsed.certificate_code || null,
          ai_detected_service: aiDetectedService,
          ai_service_match: aiServiceMatch,
          ai_service_score: aiServiceScore,
          validation: {
            duplicate: false,
            service_mismatch: false,
            holder_name_match: holderNameMatch,
            ...(holderNameMatch?{}: { holder_compare: holderCompare }),
            ai_detected_service: aiDetectedService,
            ai_service_match: aiServiceMatch,
            ai_service_score: aiServiceScore
          }
        }, info: 'Ephemeral certificate (not persisted)'});
      } catch (inner) {
        console.error('Ephemeral AI extract failed', inner);
  return res.json({ success:true, data: { cert_id: null, cert_name: cert_name || null, cert_file_url: (delivery_type === 'authenticated' || cert_public_id) ? null : cert_file_url, cert_public_id: cert_public_id || null, delivery_type: delivery_type || (cert_public_id ? 'authenticated' : null), issued_by: issued_by || null, issued_date: issued_date || null, ai_status: 'Failed', ai_confidence: null, needs_review: 0, _ephemeral: true }, warning: 'AI extraction failed (ephemeral)', error: inner.message });
      }
    }
    // Persist path
    const userId = req.user.userId;
  const effectiveDelivery = delivery_type || (cert_public_id ? 'authenticated' : null);
  const base = await TaskerCertification.create(userId, { cert_name: cert_name || null, cert_public_id: cert_public_id || null, delivery_type: effectiveDelivery, service_id: service_id ? parseInt(service_id,10) : null, issued_by: issued_by || null, issued_date: issued_date || null, initialAI: { ai_status: 'Processing' } });
    try {
      if (!process.env.GEMINI_API_KEY) {
        await TaskerCertification.updateAIExtraction(base.cert_id, { ai_status: 'Skipped', extracted_payload: 'No GEMINI_API_KEY provided' });
        return res.json({ success:true, data: { ...base, ai_status: 'Skipped', _persisted: true }, warning: 'Thiếu GEMINI_API_KEY' });
      }
      let aiSourceUrl = null;
      if (base.delivery_type === 'authenticated' && base.cert_public_id) {
        // Generate a temporary signed URL for AI extraction
        try {
          const { url } = generateSignedCertificateUrl(base.cert_public_id, { resource_type: 'image', ttlSeconds: 300 });
          aiSourceUrl = url;
        } catch(genErr){ console.warn('Failed to generate signed URL for AI extraction', genErr.message); }
      }
      console.log('🔍 [AI-CREATE-PERSIST] Start cert_id', base.cert_id, 'url=', aiSourceUrl);
      const { rawText, parsed } = await extractCertificateFromUrl(aiSourceUrl);
      const updated = await TaskerCertification.updateAIExtraction(base.cert_id, { extracted_payload: rawText, ai_model: 'gemini-2.5-flash', ai_confidence: parsed.confidence, ai_status: 'Extracted', needs_review: parsed.confidence !== null && parsed.confidence < 0.75 ? 1 : 0, parsed_cert_name: parsed.cert_name, parsed_issued_by: parsed.issued_by, parsed_issued_date: parsed.issued_date_iso, parsed_holder_name: parsed.holder_name, parsed_grade_or_level: parsed.level_or_grade, parsed_certificate_code: parsed.certificate_code });
      // Backfill base columns if still null and parsed now available
      try {
        const baseUpdateFields = [];
        const baseParams = [];
        if (!base.cert_name && parsed.cert_name) { baseUpdateFields.push('cert_name = @param1'); baseParams.push(parsed.cert_name); }
        if (!base.issued_by && parsed.issued_by) { baseUpdateFields.push(`issued_by = @param${baseParams.length+1}`); baseParams.push(parsed.issued_by); }
        if (!base.issued_date && parsed.issued_date_iso) { baseUpdateFields.push(`issued_date = @param${baseParams.length+1}`); baseParams.push(parsed.issued_date_iso); }
        if (baseUpdateFields.length) {
          baseParams.push(base.cert_id);
          const q = `UPDATE TaskerCertifications SET ${baseUpdateFields.join(', ')} WHERE cert_id = @param${baseParams.length}`;
          await executeQuery(q, baseParams);
        }
      } catch (bfErr) { console.warn('Backfill base columns failed', bfErr.message); }
      console.log('✅ [AI-CREATE-PERSIST] Done cert_id', base.cert_id, 'parsed_date=', parsed.issued_date_iso);
      return res.json({ success:true, data: { ...updated, _persisted: true } });
    } catch (inner) {
      console.error('Auto AI extract failed', inner);
      await TaskerCertification.updateAIExtraction(base.cert_id, { ai_status: 'Failed', extracted_payload: inner.message });
      return res.json({ success:true, data: { ...base, ai_status: 'Failed', _persisted: true }, warning: 'AI extraction failed', error: inner.message });
    }
  } catch (e) {
    res.status(500).json({ success:false, message:e.message });
  }
};

// Staff re-check AI extraction for an application's snapshot certifications (stateless)
exports.recheckApplicationCertifications = async (req, res) => {
  try {
    const { id } = req.params;
    if (!process.env.GEMINI_API_KEY) {
      return res.status(200).json({ success:true, skipped:true, message:'Thiếu GEMINI_API_KEY - bỏ qua re-check' });
    }
    const app = await TaskerApplication.findById(id);
    if (!app) return res.status(404).json({ success:false, message:'Không tìm thấy đơn' });
    // Ensure we have user name for holder comparison
    let userName = null;
    try {
      if (app.user_id) {
        const userRows = await executeQuery('SELECT name FROM Users WHERE user_id = @param1', [app.user_id]);
        if (userRows && userRows.length) userName = userRows[0].name;
      } else if (app.user && app.user.name) {
        userName = app.user.name;
      }
    } catch(fetchUserErr){ console.warn('recheckApplicationCertifications user name fetch warn', fetchUserErr.message); }
    // We allow re-check for any status but primary use is Pending
    const certifications = Array.isArray(app.certifications) ? app.certifications : [];
    if (!certifications.length) {
      return res.json({ success:true, data: { application_id: app.application_id, recheck_at: new Date().toISOString(), certifications: [], overall: { total_certifications:0, total_fields:0, matched_fields:0, accuracy: null } } });
    }
    const normalize = (s) => (s||'').toString().trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/[^a-z0-9]+/g,' ').trim();
    // Map bilingual/synonym forms to canonical tokens
    const mapCanonical = (val, field) => {
      const n = normalize(val);
      if (!n) return n;
      if (field === 'grade_or_level') {
        // canonical ordering: xuatsac, gioi, kha, trungbinh, dat
        if (/xuat sac|distinction|excellent/.test(n)) return 'xuatsac';
        if (/gioi|very good|good\b/.test(n)) return 'gioi';
        if (/kha|fair|above average/.test(n)) return 'kha';
        if (/trung binh|average/.test(n)) return 'trungbinh';
        if (/dat|pass/.test(n)) return 'dat';
      }
      if (field === 'issued_by') {
        // common normalization for institution variations (example pattern)
        if (/daikin air conditioning/.test(n)) return 'daikin air conditioning';
      }
      return n;
    };
    const dateNorm = (d) => {
      if (!d) return '';
      try { return new Date(d).toISOString().slice(0,10); } catch { return (d||'').toString().slice(0,10); }
    };
    const fields = [
      { key:'cert_name', snap:['parsed_cert_name','cert_name'] },
      { key:'issued_by', snap:['parsed_issued_by','issued_by'] },
      { key:'issued_date', snap:['parsed_issued_date','issued_date'], date:true },
      { key:'holder_name', snap:['parsed_holder_name'] },
      { key:'grade_or_level', snap:['parsed_grade_or_level'] },
      { key:'certificate_code', snap:['parsed_certificate_code'] }
    ];
    const results = [];
    for (let i=0;i<certifications.length;i++) {
      const c = certifications[i];
      // Determine recheck URL: prefer signed URL for authenticated snapshots
      let recheckUrl = c.cert_file_url || null;
      if ((!recheckUrl || c.delivery_type === 'authenticated') && c.cert_public_id) {
        try {
          const { generateSignedCertificateUrl } = require('../config/cloudinary');
          const { url } = generateSignedCertificateUrl(c.cert_public_id, { resource_type: 'image', ttlSeconds: 600 });
          recheckUrl = url;
        } catch (signErr) {
          console.warn('recheck signed-url error', signErr.message);
        }
      }
      if (!recheckUrl) {
        results.push({ index:i, cert_file_url: c.cert_file_url || null, error:'Thiếu nguồn chứng chỉ để re-check' });
        continue;
      }
      let parsedNew = {}; let rawText=''; let err=null;
      try {
        const { rawText: rt, parsed } = await extractCertificateFromUrl(recheckUrl);
        rawText = rt; parsedNew = parsed || {}; 
      } catch(e) { err = e; }
      const fieldDiff = {}; let matched=0; let considered=0; const originalSnapshot = {}; const recheckedVals = {};
      for (const f of fields) {
        const orig = f.snap.map(k=> c[k]).find(v=> v !== undefined && v !== null && v !== '');
        if (orig) { // only consider fields that existed in original snapshot
          considered++;
          const newValRaw = (() => {
            switch(f.key) {
              case 'cert_name': return parsedNew.cert_name || null; 
              case 'issued_by': return parsedNew.issued_by || null;
              case 'issued_date': return parsedNew.issued_date_iso || parsedNew.issued_date || null;
              case 'holder_name': return parsedNew.holder_name || null;
              case 'grade_or_level': return parsedNew.level_or_grade || null;
              case 'certificate_code': return parsedNew.certificate_code || null;
              default: return null;
            }
          })();
          const origNormBase = f.date ? dateNorm(orig) : normalize(orig);
          const newNormBase = f.date ? dateNorm(newValRaw) : normalize(newValRaw);
          const origNorm = mapCanonical(origNormBase, f.key);
          const newNorm = mapCanonical(newNormBase, f.key);
          let match = false;
          if (origNorm && newNorm && origNorm === newNorm) match = true; else {
            // Extra tolerance: allow one to contain the other for long descriptive cert_name
            if (f.key==='cert_name' && origNorm && newNorm && (origNorm.includes(newNorm) || newNorm.includes(origNorm))) match = true;
          }
          if (match) matched++;
          fieldDiff[f.key] = { match, original: orig, rechecked: newValRaw, normalized_original: origNorm, normalized_rechecked: newNorm, base_original: origNormBase, base_rechecked: newNormBase };
          originalSnapshot[f.key] = orig;
          recheckedVals[f.key] = newValRaw;
        }
      }
      const accuracy = considered ? matched/considered : null;
      // Holder vs user name comparison (new)
      let holderUserMatch = null; let holderUserOriginal = null; let holderUserRechecked = null;
      if (userName) {
        const nUser = normalize(userName);
        const snapHolder = c.parsed_holder_name || c.holder_name || null;
        const newHolder = parsedNew.holder_name || null;
        holderUserOriginal = snapHolder;
        holderUserRechecked = newHolder;
        const nSnapHolder = normalize(snapHolder);
        const nNewHolder = normalize(newHolder);
        // Prefer rechecked value if available, else snapshot for comparison
        const candidate = nNewHolder || nSnapHolder;
        if (candidate) {
          if (candidate === nUser || candidate.includes(nUser) || nUser.includes(candidate)) holderUserMatch = true; else holderUserMatch = false;
        }
      }
      results.push({
        index: i,
  cert_file_url: c.cert_file_url || null,
        ai_confidence_new: parsedNew.confidence ?? null,
        matches: matched,
        considered,
        accuracy,
        field_diff: fieldDiff,
        original: originalSnapshot,
        rechecked: recheckedVals,
        holder_user: userName ? { user_name: userName, snapshot_holder: c.parsed_holder_name || c.holder_name || null, rechecked_holder: parsedNew.holder_name || null, match: holderUserMatch } : null,
        error: err ? err.message : null
      });
    }
    const overall = results.reduce((acc,r)=>{
      if (r.considered) { acc.total_fields += r.considered; acc.matched_fields += r.matches; }
      acc.total_certifications++;
      return acc;
    }, { total_certifications:0, total_fields:0, matched_fields:0 });
    overall.accuracy = overall.total_fields ? (overall.matched_fields / overall.total_fields) : null;
    const avgAcc = results.filter(r=> r.accuracy !== null).map(r=>r.accuracy);
    overall.average_cert_accuracy = avgAcc.length ? (avgAcc.reduce((a,b)=>a+b,0)/avgAcc.length) : null;
    res.json({ success:true, data:{ application_id: app.application_id, recheck_at: new Date().toISOString(), overall, certifications: results } });
  } catch (e) {
    console.error('recheckApplicationCertifications error', e);
    res.status(500).json({ success:false, message:'Lỗi re-check', error:e.message });
  }
};

exports.getAllCertificationsOfTasker = async (req, res) => {
  const { taskerId } = req.params;
  try {
    const query = `
      SELECT 
          c.cert_id,
          c.cert_public_id,
          c.cert_name,
          c.issued_by,
          c.issued_date,
          c.status,
          c.parsed_certificate_code,
          c.variant_ids_json,
          s.service_id,
          s.name AS service_name,
          v.variant_id,
          v.variant_name,
          v.pricing_type,
          v.price_min,
          v.price_max,
          v.unit
      FROM TaskerCertifications c
      LEFT JOIN Services s 
          ON c.service_id = s.service_id
      OUTER APPLY (
          SELECT STRING_AGG(v2.variant_name, ', ') AS variant_name,
                 STRING_AGG(v2.pricing_type, ', ') AS pricing_type,
                 MIN(v2.price_min) AS price_min,
                 MAX(v2.price_max) AS price_max,
                 STRING_AGG(v2.unit, ', ') AS unit,
                 STRING_AGG(CONVERT(VARCHAR(10), v2.variant_id), ', ') AS variant_id
          FROM OPENJSON(c.variant_ids_json)
               WITH (variant_id INT '$') AS jsonIds
          LEFT JOIN ServiceVariants v2
               ON v2.variant_id = jsonIds.variant_id
      ) v
      WHERE c.tasker_id = @param1
      ORDER BY c.issued_date DESC;
    `;

    const result = await executeQuery(query, [taskerId]);
    res.json({
      success: true,
      data: result.recordset || []
    });
  } catch (e) {
    console.error("Error fetching tasker certifications:", e);
    res.status(500).json({
      success: false,
      message: e.message
    });
  }
};

// Staff reject certifications
exports.rejectCertifications = async (req, res) => {
  try {
    const { cert_ids, variant_ids, tasker_id } = req.body;
    if (!Array.isArray(cert_ids) || !tasker_id) {
      return res.status(400).json({ success: false, message: 'Missing cert_ids or tasker_id' });
    }
    // Update status to 'rejected' for the given cert_public_id(s)
    for (const cert_public_id of cert_ids) {
      await executeQuery(
        `UPDATE TaskerCertifications SET status = 'rejected' WHERE cert_public_id = @param1 AND tasker_id = @param2`,
        [cert_public_id, tasker_id]
      );
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('Reject certifications error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

