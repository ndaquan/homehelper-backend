

const Services = require("../models/Services");

// Lấy tất cả service cơ bản
const getAll = async (req, res) => {
  try {
    const services = await Services.findAll();
    res.json({ success: true, data: services });
  } catch (error) {
    console.error("Error in getAllServicesBasic:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};


const getAllServices = async (req, res) => {
  try {
    const services = await Services.getAllServices();
    res.json({ success: true, data: services });
  } catch (error) {
    console.error("Error in getAllServices:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const getServiceById = async (req, res) => {
  try {
    const serviceId = req.params.id;
    const service = await Services.getServiceById(serviceId);

    if (!service) {
      return res
        .status(404)
        .json({ success: false, message: "Service not found" });
    }

    res.json({ success: true, data: service });
  } catch (error) {
    console.error("Error in getServiceById:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

module.exports = {
  getAllServices,
  getServiceById,
  getAll
};
