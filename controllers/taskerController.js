// module.exports = TaskerController;
const Address = require("../models/Address");
const axios = require("axios");
const Tasker = require("../models/Tasker");


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

function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}
