const { executeQuery } = require('../config/database');

class TaskerCertification {
  static async create(tasker_id, { cert_name, cert_public_id = null, delivery_type = null, service_id = null, issued_by = null, issued_date = null, initialAI = {} }) {
    const hasService = Number.isInteger(service_id);
    const aiCols = [];
    const aiVals = [];
    const aiParams = [];
  const allowedAI = ['extracted_payload','ai_model','ai_confidence','ai_status','needs_review','parsed_cert_name','parsed_issued_by','parsed_issued_date','parsed_holder_name','parsed_grade_or_level','parsed_certificate_code','ai_detected_service'];
    // NOTE: Original implementation used (hasService ? 7 : 6) which produced placeholders
    // that overlapped with base column params (off-by-one). Base param count:
    //  - hasService = true  => 8 base params (@param1..@param8)
    //  - hasService = false => 7 base params (@param1..@param7)
    // First AI placeholder therefore must start at @param9 or @param8 respectively.
    // We compute dynamically based on current aiParams length.
  // Base param count after dropping cert_file_url column:
  //  - hasService = true  => 7 base params (@param1..@param7)
  //  - hasService = false => 6 base params (@param1..@param6)
  const baseCount = hasService ? 7 : 6;
    for (const k of allowedAI) {
      if (Object.prototype.hasOwnProperty.call(initialAI,k) && initialAI[k] !== undefined) {
        aiCols.push(k);
        const nextIndex = baseCount + aiParams.length + 1; // +1 because params are 1-indexed in placeholders
        aiVals.push(`@param${nextIndex}`);
        aiParams.push(initialAI[k]);
      }
    }
    // Extend base columns with optional cert_public_id & delivery_type (no migration guard: assume columns added in DB)
    // Fallback: if DB columns not yet added this will error; caller should ensure migration done.
    const baseCols = hasService
      ? 'tasker_id, cert_name, cert_public_id, delivery_type, service_id, issued_by, issued_date'
      : 'tasker_id, cert_name, cert_public_id, delivery_type, issued_by, issued_date';
    const baseParams = hasService
      ? '@param1,@param2,@param3,@param4,@param5,@param6,@param7'
      : '@param1,@param2,@param3,@param4,@param5,@param6';
    const query = `INSERT INTO TaskerCertifications (${baseCols}${aiCols.length?','+aiCols.join(','):''}) OUTPUT INSERTED.* VALUES (${baseParams}${aiVals.length?','+aiVals.join(','):''})`;
    const params = hasService
      ? [tasker_id, cert_name, cert_public_id, delivery_type, service_id, issued_by, issued_date, ...aiParams]
      : [tasker_id, cert_name, cert_public_id, delivery_type, issued_by, issued_date, ...aiParams];
    const result = await executeQuery(query, params);
    return result.recordset[0];
  }

  static async createMultiple(tasker_id, certs = []) {
    const created = [];
    for (const cert of certs) {
      // Basic validation
      if (!cert.cert_name || !cert.cert_public_id) continue;
      const row = await this.create(tasker_id, cert);
      created.push(row);
    }
    return created;
  }

  static async listByTasker(tasker_id) {
    const query = `SELECT tc.*, s.name AS service_name
                   FROM TaskerCertifications tc
                   LEFT JOIN Services s ON tc.service_id = s.service_id
                   WHERE tc.tasker_id = @param1
                   ORDER BY uploaded_at DESC`;
    const result = await executeQuery(query, [tasker_id]);
    return result.recordset || [];
  }

  static async findById(cert_id) {
    const query = `SELECT * FROM TaskerCertifications WHERE cert_id = @param1`;
    const result = await executeQuery(query, [cert_id]);
    return result.recordset[0] || null;
  }

  static async findByPublicId(cert_public_id) {
    const query = `SELECT TOP 1 * FROM TaskerCertifications WHERE cert_public_id = @param1`;
    const result = await executeQuery(query, [cert_public_id]);
    return result.recordset[0] || null;
  }

  static async updateAIExtraction(cert_id, fields = {}) {
    const allowed = [
      'extracted_payload','ai_model','ai_confidence','ai_status','needs_review',
      'parsed_cert_name','parsed_issued_by','parsed_issued_date','parsed_holder_name',
      'parsed_grade_or_level','parsed_certificate_code','ai_detected_service'
    ];
    const setParts = [];
    const params = [];
    let idx = 1;
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        setParts.push(`${key} = @param${idx}`);
        params.push(fields[key]);
        idx++;
      }
    }
    if (!setParts.length) return null;
    params.push(cert_id);
    const query = `UPDATE TaskerCertifications SET ${setParts.join(', ')} WHERE cert_id = @param${idx}; SELECT * FROM TaskerCertifications WHERE cert_id = @param${idx}`;
    const result = await executeQuery(query, params);
    return result.recordset[0];
  }
}

module.exports = TaskerCertification;
