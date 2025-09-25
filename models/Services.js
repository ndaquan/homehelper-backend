const { executeQuery } = require("../config/database");

class Services {
  // Get all services
  static async getAllServices() {
    try {
      const query = `
                SELECT 
                    s.service_id,
                    s.name,
                    s.description,
                    (
                        SELECT JSON_QUERY((
                            SELECT 
                                sv.variant_id,
                                sv.service_id,
                                sv.variant_name,
                                sv.pricing_type,
                sv.price_min,
                sv.price_max,
                                sv.specific_price,
                                sv.unit
                            FROM ServiceVariants sv
                            WHERE sv.service_id = s.service_id
                            FOR JSON PATH
                        ))
                    ) as variants
                FROM Services s
                ORDER BY s.service_id`;

      const result = await executeQuery(query);
      return result.recordset.map((record) => ({
        ...record,
        variants: JSON.parse(record.variants || "[]"),
      }));
    } catch (error) {
      console.error("Error getting services:", error);
      throw error;
    }
  }

  // Get service by ID with its variants
  static async getServiceById(serviceId) {
    try {
      const query = `
                SELECT 
                    s.service_id,
                    s.name,
                    s.description,
                    (
                        SELECT JSON_QUERY((
                            SELECT 
                                sv.variant_id,
                                sv.service_id,
                                sv.variant_name,
                                sv.pricing_type,
                sv.price_min,
                sv.price_max,
                                sv.specific_price,
                                sv.unit
                            FROM ServiceVariants sv
                            WHERE sv.service_id = s.service_id
                            FOR JSON PATH
                        ))
                    ) as variants
                FROM Services s
                WHERE s.service_id = @param1`;

      const result = await executeQuery(query, [serviceId]);
      const service = result.recordset[0];
      if (service) {
        service.variants = JSON.parse(service.variants || "[]");
      }
      return service;
    } catch (error) {
      console.error("Error getting service:", error);
      throw error;
    }
  }
  //Get services without return variants
  static async findAll() {
    const query = `
      SELECT service_id, name, description
      FROM Services
      ORDER BY name ASC
    `;
    const result = await executeQuery(query);
    return result.recordset || [];
  }
}

module.exports = Services;
