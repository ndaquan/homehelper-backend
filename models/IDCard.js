const { executeNonQuery, executeQuery, executeQueryOne } = require('../config/database-sqlite');

class IDCard {
  static async create(data) {
    const {
      user_id,
      number,
      full_name,
      dob,
      gender,
      nationality,
      place_of_origin,
      place_of_residence,
      issued_date,
      features,
      front_image_path,
      back_image_path,
      face_image_path,
      ocr_text_front,
      ocr_text_back,
      verified,
    } = data;

    const query = `
      INSERT INTO id_cards (
        user_id, number, full_name, dob, gender, nationality,
        place_of_origin, place_of_residence, issued_date, features,
        front_image_path, back_image_path, face_image_path,
        ocr_text_front, ocr_text_back, verified
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(number) DO UPDATE SET
        user_id = excluded.user_id,
        full_name = excluded.full_name,
        dob = excluded.dob,
        gender = excluded.gender,
        nationality = excluded.nationality,
        place_of_origin = excluded.place_of_origin,
        place_of_residence = excluded.place_of_residence,
        issued_date = excluded.issued_date,
        features = excluded.features,
        front_image_path = excluded.front_image_path,
        back_image_path = excluded.back_image_path,
        face_image_path = excluded.face_image_path,
        ocr_text_front = excluded.ocr_text_front,
        ocr_text_back = excluded.ocr_text_back,
        verified = excluded.verified,
        updated_at = CURRENT_TIMESTAMP
    `;

    const res = await executeNonQuery(query, [
      user_id, number, full_name, dob, gender, nationality,
      place_of_origin, place_of_residence, issued_date, features,
      front_image_path, back_image_path, face_image_path,
      ocr_text_front, ocr_text_back, verified ? 1 : 0,
    ]);

    return { id: res.insertId, ...data };
  }

  static async findByUserId(userId) {
    const result = await executeQueryOne('SELECT * FROM id_cards WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
    return result.recordset[0] || null;
  }

  static async updateVerification(userId, verified, number) {
    await executeNonQuery('UPDATE users SET cccd_status = ?, cccd_number = ? WHERE id = ?', [verified ? 'Verified' : 'Rejected', number || null, userId]);
  }
}

module.exports = IDCard;


