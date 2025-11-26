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
          s.requires_certificate,
                    (
                        SELECT JSON_QUERY((
                            SELECT 
                                sv.variant_id,
                                sv.service_id,
                                sv.variant_name,
                                sv.pricing_type,
                sv.price_min,
                sv.price_max,
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
          s.requires_certificate,
                    (
                        SELECT JSON_QUERY((
                            SELECT 
                                sv.variant_id,
                                sv.service_id,
                                sv.variant_name,
                                sv.pricing_type,
                sv.price_min,
                sv.price_max,
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
  SELECT service_id, name, description, requires_certificate
      FROM Services
      ORDER BY name ASC
    `;
    const result = await executeQuery(query);
    return result.recordset || [];
  }

  // Create a new service
  static async createService(serviceData) {
    try {
      // Get the next service_id
      const maxIdQuery = `SELECT ISNULL(MAX(service_id), 0) + 1 as next_id FROM Services`;
      const maxIdResult = await executeQuery(maxIdQuery);
      const nextId = maxIdResult.recordset[0].next_id;

      const query = `
        INSERT INTO Services (service_id, name, description, requires_certificate)
        VALUES (@param1, @param2, @param3, @param4)
      `;
      
      const params = [
        nextId,
        serviceData.name,
        serviceData.description || null,
        serviceData.requires_certificate ? 1 : 0
      ];

      await executeQuery(query, params);
      
      // Return the created service
      return await this.getServiceById(nextId);
    } catch (error) {
      console.error("Error creating service:", error);
      throw error;
    }
  }

  // Update an existing service
  static async updateService(serviceId, serviceData) {
    try {
      const query = `
        UPDATE Services 
        SET name = @param1, 
            description = @param2, 
            requires_certificate = @param3
        WHERE service_id = @param4
      `;
      
      const params = [
        serviceData.name,
        serviceData.description || null,
        serviceData.requires_certificate ? 1 : 0,
        serviceId
      ];

      const result = await executeQuery(query, params);
      
      if (result.rowsAffected[0] === 0) {
        return null; // Service not found
      }
      
      // Return the updated service
      return await this.getServiceById(serviceId);
    } catch (error) {
      console.error("Error updating service:", error);
      throw error;
    }
  }

  // Delete a service
  static async deleteService(serviceId) {
    try {
      // First check if service exists
      const service = await this.getServiceById(serviceId);
      if (!service) {
        return false;
      }

      // Check if service has variants (foreign key constraint)
      const checkVariantsQuery = `SELECT COUNT(*) as count FROM ServiceVariants WHERE service_id = @param1`;
      const variantsResult = await executeQuery(checkVariantsQuery, [serviceId]);
      const variantCount = variantsResult.recordset[0].count;

      if (variantCount > 0) {
        throw new Error(`Cannot delete service: Service has ${variantCount} variant(s) associated with it. Please delete variants first.`);
      }

      // Delete the service
      const query = `DELETE FROM Services WHERE service_id = @param1`;
      const result = await executeQuery(query, [serviceId]);
      
      return result.rowsAffected[0] > 0;
    } catch (error) {
      console.error("Error deleting service:", error);
      throw error;
    }
  }

  // ===== ServiceVariants CRUD =====
  static async getVariantById(variantId) {
    const query = `
      SELECT variant_id, service_id, variant_name, pricing_type, price_min, price_max, unit
      FROM ServiceVariants
      WHERE variant_id = @param1
    `;
    const res = await executeQuery(query, [variantId]);
    return res.recordset[0] || null;
  }

  static async getVariantsByServiceId(serviceId) {
    const query = `
      SELECT variant_id, service_id, variant_name, pricing_type, price_min, price_max, unit
      FROM ServiceVariants
      WHERE service_id = @param1
      ORDER BY variant_id
    `;
    const res = await executeQuery(query, [serviceId]);
    return res.recordset || [];
  }

  static async createVariant(serviceId, variantData) {
    // Ensure parent service exists
    const svc = await this.getServiceById(serviceId);
    if (!svc) {
      throw new Error("Service not found");
    }
    // Next variant_id
    const idRes = await executeQuery(`SELECT ISNULL(MAX(variant_id),0)+1 AS next_id FROM ServiceVariants`);
    const nextId = idRes.recordset[0]?.next_id;
    const query = `
      INSERT INTO ServiceVariants (variant_id, service_id, variant_name, pricing_type, price_min, price_max, unit)
      VALUES (@param1, @param2, @param3, @param4, @param5, @param6, @param7)
    `;
    const params = [
      nextId,
      serviceId,
      variantData.variant_name,
      variantData.pricing_type,
      variantData.price_min ?? null,
      variantData.price_max ?? null,
      variantData.unit ?? null
    ];
    await executeQuery(query, params);
    return await this.getVariantById(nextId);
  }

  static async updateVariant(variantId, variantData) {
    // Ensure variant exists
    const existed = await this.getVariantById(variantId);
    if (!existed) {
      return null;
    }
    const query = `
      UPDATE ServiceVariants
      SET variant_name = @param1,
          pricing_type = @param2,
          price_min = @param3,
          price_max = @param4,
          unit = @param5
      WHERE variant_id = @param6
    `;
    const params = [
      variantData.variant_name ?? existed.variant_name,
      variantData.pricing_type ?? existed.pricing_type,
      variantData.price_min ?? existed.price_min,
      variantData.price_max ?? existed.price_max,
      variantData.unit ?? existed.unit,
      variantId
    ];
    const res = await executeQuery(query, params);
    if (res.rowsAffected[0] === 0) return null;
    return await this.getVariantById(variantId);
  }

  static async deleteVariant(variantId) {
    // Ensure variant exists
    const existed = await this.getVariantById(variantId);
    if (!existed) {
      return false;
    }
    // Check references to avoid FK errors
    const queries = [
      { sql: `SELECT COUNT(*) AS c FROM TaskerServiceVariants WHERE variant_id = @param1` },
      { sql: `SELECT COUNT(*) AS c FROM Bookings WHERE variant_id = @param1` },
      { sql: `SELECT COUNT(*) AS c FROM Quotes WHERE variant_id = @param1` },
      { sql: `SELECT COUNT(*) AS c FROM PostServices WHERE variant_id = @param1` }
    ];
    for (const q of queries) {
      const r = await executeQuery(q.sql, [variantId]);
      const count = Number(r.recordset[0]?.c || 0);
      if (count > 0) {
        throw new Error("Cannot delete variant: It is referenced by other records.");
      }
    }
    const del = await executeQuery(`DELETE FROM ServiceVariants WHERE variant_id = @param1`, [variantId]);
    return del.rowsAffected[0] > 0;
  }
}

module.exports = Services;
