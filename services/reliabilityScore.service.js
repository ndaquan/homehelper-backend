const { executeQuery } = require("../config/database");

/**
 * Cập nhật điểm uy tín Tasker
 * @param {number} taskerId - ID của Tasker
 * @param {number} delta - Số điểm thay đổi (+5, -10, -20, -30)
 */
async function updateReliabilityScore(taskerId, delta) {
    try {
        // SQL chuẩn để đảm bảo điểm nằm từ 0–100
        const query = `
            UPDATE Taskers
            SET reliability_score = 
                CASE 
                    WHEN reliability_score + @param2 > 100 THEN 100
                    WHEN reliability_score + @param2 < 0 THEN 0
                    ELSE reliability_score + @param2
                END
            WHERE tasker_id = @param1;
        `;

        await executeQuery(query, [taskerId, delta]);
        console.log(`✅ Updated reliability score for tasker ${taskerId} by ${delta}`);
    } catch (error) {
        console.error("❌ Lỗi updateReliabilityScore:", error);
    }
}

module.exports = {
    updateReliabilityScore,
};
