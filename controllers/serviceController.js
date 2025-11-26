

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

// Create a new service (Staff/Admin only)
const createService = async (req, res) => {
  try {
    const { name, description, requires_certificate } = req.body;

    // Validation
    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Service name is required"
      });
    }

    // Convert requires_certificate to boolean
    const requiresCert = requires_certificate === true || 
                         requires_certificate === 'true' || 
                         requires_certificate === 1 || 
                         requires_certificate === '1';

    const serviceData = {
      name: name.trim(),
      description: description || null,
      requires_certificate: requiresCert
    };

    const newService = await Services.createService(serviceData);
    
    res.status(201).json({
      success: true,
      message: "Service created successfully",
      data: newService
    });
  } catch (error) {
    console.error("Error in createService:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal server error"
    });
  }
};

// Update an existing service (Staff/Admin only)
const updateService = async (req, res) => {
  try {
    const serviceId = req.params.id;
    const { name, description, requires_certificate } = req.body;

    // Validation
    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Service name is required"
      });
    }

    // Convert requires_certificate to boolean
    const requiresCert = requires_certificate === true || 
                         requires_certificate === 'true' || 
                         requires_certificate === 1 || 
                         requires_certificate === '1';

    const serviceData = {
      name: name.trim(),
      description: description || null,
      requires_certificate: requiresCert
    };

    const updatedService = await Services.updateService(serviceId, serviceData);

    if (!updatedService) {
      return res.status(404).json({
        success: false,
        message: "Service not found"
      });
    }

    res.json({
      success: true,
      message: "Service updated successfully",
      data: updatedService
    });
  } catch (error) {
    console.error("Error in updateService:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal server error"
    });
  }
};

// Delete a service (Staff/Admin only)
const deleteService = async (req, res) => {
  try {
    const serviceId = req.params.id;

    const deleted = await Services.deleteService(serviceId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Service not found"
      });
    }

    res.json({
      success: true,
      message: "Service deleted successfully"
    });
  } catch (error) {
    console.error("Error in deleteService:", error);
    
    // Check if error is about foreign key constraint
    if (error.message && error.message.includes("Cannot delete service")) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

// ===== ServiceVariants endpoints =====
const getVariantsByService = async (req, res) => {
  try {
    const serviceId = req.params.id;
    const service = await Services.getServiceById(serviceId);
    if (!service) {
      return res.status(404).json({ success: false, message: "Service not found" });
    }
    const variants = await Services.getVariantsByServiceId(serviceId);
    res.json({ success: true, data: variants });
  } catch (error) {
    console.error("Error in getVariantsByService:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const getVariantById = async (req, res) => {
  try {
    const { variantId } = req.params;
    const variant = await Services.getVariantById(variantId);
    if (!variant) {
      return res.status(404).json({ success: false, message: "Variant not found" });
    }
    res.json({ success: true, data: variant });
  } catch (error) {
    console.error("Error in getVariantById:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const createVariant = async (req, res) => {
  try {
    const serviceId = req.params.id;
  const { variant_name, pricing_type, price_min, price_max, unit } = req.body || {};
  if (!variant_name || !pricing_type) {
      return res.status(400).json({ success: false, message: "variant_name and pricing_type are required" });
    }
    const newVariant = await Services.createVariant(serviceId, {
      variant_name,
      pricing_type,
      price_min,
      price_max,
    unit
    });
    res.status(201).json({ success: true, data: newVariant });
  } catch (error) {
    console.error("Error in createVariant:", error);
    res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

const updateVariant = async (req, res) => {
  try {
  const { variantId } = req.params;
  // only allow relevant fields
  const payload = {
    variant_name: req.body?.variant_name,
    pricing_type: req.body?.pricing_type,
    price_min: req.body?.price_min,
    price_max: req.body?.price_max,
    unit: req.body?.unit
  };
  const updated = await Services.updateVariant(variantId, payload);
    if (!updated) {
      return res.status(404).json({ success: false, message: "Variant not found" });
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error in updateVariant:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const deleteVariant = async (req, res) => {
  try {
    const { variantId } = req.params;
    const deleted = await Services.deleteVariant(variantId);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Variant not found" });
    }
    res.json({ success: true, message: "Variant deleted successfully" });
  } catch (error) {
    console.error("Error in deleteVariant:", error);
    if (error.message && error.message.startsWith("Cannot delete variant")) {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

module.exports = {
  getAllServices,
  getServiceById,
  getAll,
  createService,
  updateService,
  deleteService,
  // variants
  getVariantsByService,
  getVariantById,
  createVariant,
  updateVariant,
  deleteVariant
};
