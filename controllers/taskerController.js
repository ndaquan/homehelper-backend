// module.exports = TaskerController;
const Address = require("../models/Address");
const axios = require("axios");
const Tasker = require("../models/Tasker");
const TaskerCertification = require("../models/TaskerCertification");
const { executeQuery } = require("../config/database");
const { cloudinary, certificateUpload } = require('../config/cloudinary');
const { extractCertificateFromUrl } = require('../config/gemini.service');

// Lazy require classifyService when needed to avoid circular or load cost
function getClassifyService() {
  try { return require('../lib/classifyService').classifyService; } catch(_) { return null; }
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

    // Tìm tasker theo ID
    const tasker = await Tasker.findById(id);
    if (!tasker) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy Tasker" });
    }

    // Lấy toàn bộ Tasker có dịch vụ, rồi lọc ra tasker tương ứng
    const allTaskers = await Tasker.findAll("", ""); // lấy toàn bộ tasker có dịch vụ
    const target = allTaskers.find((t) => t.tasker_id == id);

    const variants = [];
    if (target && target.services.length) {
      target.services.forEach((service) => {
        service.variants.forEach((v) =>
          variants.push({
            ...v,
            service_id: service.service_id,
            service_name: service.name,
          })
        );
      });
    }

    // Trả kết quả JSON
    res.json({
      success: true,
      tasker: {
        tasker_id: tasker.user_id,
        name: tasker.name,
        email: tasker.email,
        phone: tasker.phone,
        avatar_url: `https://i.pravatar.cc/80?u=${tasker.user_id}`,
        rating: target?.rating || 0,
        reviews: target?.reviewsCount || 0,
      },
      variants,
    });
  } catch (error) {
    console.error("❌ Lỗi getWithServices:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi lấy Tasker kèm dịch vụ",
      error: error.message,
    });
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
    if (req.is('application/json')) {
      const { introduce: introIn = "", variant_ids: variantsIn = [], certifications: certsIn = [] } = req.body || {};
      introduce = introIn;
      variant_ids = Array.isArray(variantsIn) ? variantsIn : [];
      certifications = Array.isArray(certsIn) ? certsIn : [];
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
      // Merge uploaded files
      if (req.files && req.files.length) {
        const uploaded = req.files.map(f => ({
          cert_name: f.originalname,
          cert_file_url: f.path || (f.secure_url) || f.location || '',
        })).filter(c => c.cert_file_url);
        certifications = [...certifications, ...uploaded];
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
        // Build map service_id -> hasCert
        const map = new Map();
        for (const cert of certifications) {
          if (Number.isInteger(cert.service_id) && cert.cert_file_url) {
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

    // Kiểm tra user có phải đã là tasker
    const userResult = await executeQuery("SELECT role FROM Users WHERE user_id = @param1", [userId]);
    if (!userResult.recordset.length) {
      return res.status(404).json({ success: false, message: "User không tồn tại" });
    }
    const currentRole = userResult.recordset[0].role;
    if (currentRole === 'Tasker') {
      return res.status(400).json({ success: false, message: "Tài khoản đã là Tasker" });
    }

    // Bắt đầu upgrade trong transaction đơn giản (giả lập)
    // 1. Update role
    await executeQuery("UPDATE Users SET role = 'Tasker' WHERE user_id = @param1", [userId]);
    // 2. Insert Taskers row
    await executeQuery(
      "INSERT INTO Taskers (tasker_id, Introduce, certifications, status, rating) VALUES (@param1, @param2, @param3, N'Hoạt động', 0)",
      [userId, introduce, certifications.map(c => c.cert_name).join(', ')]
    );

    // 3. Gắn service variants
    if (Array.isArray(variant_ids) && variant_ids.length) {
      for (const variantId of variant_ids) {
        await executeQuery(
          "INSERT INTO TaskerServiceVariants (tasker_service_variant_id, tasker_id, variant_id) VALUES ((SELECT ISNULL(MAX(tasker_service_variant_id),0)+1 FROM TaskerServiceVariants), @param1, @param2)",
          [userId, variantId]
        );
      }
    }

    // 4. Persist certificates: all incoming certifications without cert_id are ephemeral -> create now with any parsed AI fields
    let createdCerts = [];
    let existingCerts = certifications.filter(c => c.cert_id);
    if (Array.isArray(certifications) && certifications.length) {
      const ephemeral = certifications.filter(c => !c.cert_id);
      for (const cert of ephemeral) {
        if (!cert.cert_file_url) continue;
        const initialAI = {};
        // Backfill parsed_* from base if parsed missing
        const effParsedCertName = cert.parsed_cert_name || cert.cert_name || null;
        const effParsedIssuedBy = cert.parsed_issued_by || cert.issued_by || null;
        const effParsedIssuedDate = cert.parsed_issued_date || cert.issued_date || null;
        // Derive final base field values (ensure variables exist before use)
        const finalCertName = cert.cert_name || effParsedCertName || null;
        const finalIssuedBy = cert.issued_by || effParsedIssuedBy || null;
        const finalIssuedDate = cert.issued_date || effParsedIssuedDate || null;
        // Fallback classification if ai_detected_service missing but we have parsed fields
        if (!cert.ai_detected_service) {
          try {
            const classifyService = getClassifyService();
            if (classifyService) {
              const svcListRes = await executeQuery('SELECT service_id, name FROM Services');
              const svcList = svcListRes.recordset || [];
              const clsText = [effParsedCertName, effParsedIssuedBy, cert.parsed_holder_name, cert.parsed_grade_or_level].filter(Boolean).join(' ');
              const cls = classifyService({ services: svcList, text: clsText });
              if (cls && cls.detected) {
                cert.ai_detected_service = cls.detected.slug;
                if (!cert.ai_service_score && cls.detected.score !== undefined) cert.ai_service_score = cls.detected.score;
              }
            }
          } catch (clsUpgradeErr) { console.warn('[UPGRADE][CERT] Fallback classify failed', clsUpgradeErr.message); }
        }
        if (cert.extracted_payload) initialAI.extracted_payload = cert.extracted_payload;
        if (cert.ai_model) initialAI.ai_model = cert.ai_model;
        if (cert.ai_confidence !== undefined) initialAI.ai_confidence = cert.ai_confidence;
        if (cert.ai_status) initialAI.ai_status = cert.ai_status; else initialAI.ai_status = 'Extracted';
        if (cert.needs_review !== undefined) initialAI.needs_review = cert.needs_review;
        if (effParsedCertName) initialAI.parsed_cert_name = effParsedCertName;
        if (effParsedIssuedBy) initialAI.parsed_issued_by = effParsedIssuedBy;
        if (effParsedIssuedDate) initialAI.parsed_issued_date = effParsedIssuedDate;
        if (cert.parsed_holder_name) initialAI.parsed_holder_name = cert.parsed_holder_name;
        if (cert.parsed_grade_or_level) initialAI.parsed_grade_or_level = cert.parsed_grade_or_level;
        if (cert.parsed_certificate_code) initialAI.parsed_certificate_code = cert.parsed_certificate_code;
        if (cert.ai_detected_service) initialAI.ai_detected_service = cert.ai_detected_service;
        console.log('[UPGRADE][CERT] Raw incoming ephemeral cert', {
          cert_name: cert.cert_name,
          cert_file_url: cert.cert_file_url,
          service_id: cert.service_id,
          issued_by: cert.issued_by,
          issued_date: cert.issued_date,
          parsed_cert_name: cert.parsed_cert_name,
          parsed_issued_by: cert.parsed_issued_by,
          parsed_issued_date: cert.parsed_issued_date,
          parsed_holder_name: cert.parsed_holder_name,
          parsed_grade_or_level: cert.parsed_grade_or_level,
          parsed_certificate_code: cert.parsed_certificate_code,
          ai_detected_service: cert.ai_detected_service,
          has_extracted_payload: !!cert.extracted_payload,
          ai_confidence: cert.ai_confidence,
          ai_status: cert.ai_status,
          needs_review: cert.needs_review
        });
        console.log('[UPGRADE][CERT] Prepared initialAI before create', initialAI);
        try {
          const row = await TaskerCertification.create(userId, {
            cert_name: finalCertName,
            cert_file_url: cert.cert_file_url,
            service_id: Number.isInteger(cert.service_id) ? cert.service_id : null,
            issued_by: finalIssuedBy,
            issued_date: finalIssuedDate,
            initialAI
          });
          console.log('[UPGRADE][CERT] Created DB row cert_id=', row.cert_id, {
            parsed_holder_name: row.parsed_holder_name,
            parsed_grade_or_level: row.parsed_grade_or_level,
            parsed_certificate_code: row.parsed_certificate_code,
            ai_detected_service: row.ai_detected_service
          });
          createdCerts.push(row);
        } catch (certErr) {
          console.error('[UPGRADE][CERT] Failed to persist cert file_url=', cert.cert_file_url, certErr);
        }
      }
    }

    res.status(201).json({
      success: true,
      message: "Nâng cấp thành công. Tài khoản hiện là Tasker",
      data: {
        tasker_id: userId,
        introduce,
        variant_ids,
    certifications: [...existingCerts, ...createdCerts],
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
      const result = { success: true, data: { files: req.files.map(f => ({ original: f.originalname, url: f.path })) } };
      console.log('✅ Upload (storage) done in', Date.now() - req._startAt, 'ms');
      return res.json(result);
    }
    const userId = (req.user && (req.user.userId || req.user.user_id)) || 'anonymous';
    const folderBase = process.env.CLOUDINARY_FOLDER_BASE || 'homehelper';
    const folder = `${folderBase}/certificates/${userId}`;
    const uploads = await Promise.all(req.files.map(file => new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ folder, resource_type: 'auto' }, (error, result) => {
        if (error) return reject(error);
        resolve(result);
      });
      stream.end(file.buffer);
    })));
    const payload = { success: true, data: { files: uploads.map(u => ({ original: u.original_filename, url: u.secure_url || u.url })) } };
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
    console.log('🔍 [AI-EXTRACT] Start re-extract cert_id', cert.cert_id, 'url=', cert.cert_file_url);
    const { rawText, parsed } = await extractCertificateFromUrl(cert.cert_file_url);
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

// Create (ephemeral by default) certification with AI extraction & validations
exports.createCertification = async (req, res) => {
  try {
    const { service_id, cert_name, cert_file_url, issued_by, issued_date, persist } = req.body;
    if (!cert_file_url) return res.status(400).json({ success:false, message:'Thiếu cert_file_url' });
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
          return res.json({ success:true, data: { cert_id: null, cert_name: cert_name || null, cert_file_url, issued_by: issued_by || null, issued_date: issued_date || null, ai_status: 'Skipped', ai_confidence: null, needs_review: 0, _ephemeral: true, duplication_checked: false }, info: 'Ephemeral mode (no persist) - thiếu GEMINI_API_KEY' });
        }
        console.log('🔍 [AI-CREATE-EPHEMERAL] Start URL', cert_file_url);
        const { rawText, parsed } = await extractCertificateFromUrl(cert_file_url);
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
          return res.status(400).json({ success:false, ai_service_mismatch:true, message:'Chứng chỉ không thuộc nhóm dịch vụ đã chọn', ai_detected_service: aiDetectedService, ai_service_score: aiServiceScore });
        }
        // Duplicate check
        const existing = await executeQuery(`SELECT cert_id, cert_name, cert_file_url, issued_by, issued_date, parsed_cert_name, parsed_issued_by, parsed_issued_date, parsed_certificate_code, extracted_payload FROM TaskerCertifications WHERE tasker_id = @param1`, [userId]);
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
          // 1) Same file URL
          if (row.cert_file_url && row.cert_file_url === cert_file_url) { isDuplicate = true; duplicateCertId = row.cert_id; duplicateReason = 'Trùng file chứng chỉ'; break; }
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
          return res.status(409).json({ success:false, duplicate:true, message: `Chứng chỉ đã tồn tại (cert_id=${duplicateCertId}) - ${duplicateReason}` });
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
              'dieu hoa': ['dieu hoa','may lanh','air','aircon','airconditioner','hvac','lanh'],
              'cham soc nguoi cao tuoi': ['cham soc nguoi cao tuoi','nguoi cao tuoi','elderly care','elderly','old people','cham soc','cham soc nguoi gia','nguoi gia']
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
          cert_file_url,
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
        return res.json({ success:true, data: { cert_id: null, cert_name: cert_name || null, cert_file_url, issued_by: issued_by || null, issued_date: issued_date || null, ai_status: 'Failed', ai_confidence: null, needs_review: 0, _ephemeral: true }, warning: 'AI extraction failed (ephemeral)', error: inner.message });
      }
    }
    // Persist path
    const userId = req.user.userId;
    const base = await TaskerCertification.create(userId, { cert_name: cert_name || null, cert_file_url, service_id: service_id ? parseInt(service_id,10) : null, issued_by: issued_by || null, issued_date: issued_date || null, initialAI: { ai_status: 'Processing' } });
    try {
      if (!process.env.GEMINI_API_KEY) {
        await TaskerCertification.updateAIExtraction(base.cert_id, { ai_status: 'Skipped', extracted_payload: 'No GEMINI_API_KEY provided' });
        return res.json({ success:true, data: { ...base, ai_status: 'Skipped', _persisted: true }, warning: 'Thiếu GEMINI_API_KEY' });
      }
      console.log('🔍 [AI-CREATE-PERSIST] Start cert_id', base.cert_id, 'url=', base.cert_file_url);
      const { rawText, parsed } = await extractCertificateFromUrl(base.cert_file_url);
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
