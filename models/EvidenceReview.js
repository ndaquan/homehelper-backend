module.exports = (sequelize, DataTypes) => {
  const EvidenceReview = sequelize.define("EvidenceReview", {
    booking_id: DataTypes.INTEGER,
    tasker_id: DataTypes.INTEGER,

    house_number_img: DataTypes.STRING,
    call_screenshot_img: DataTypes.STRING,
    gps_screenshot_img: DataTypes.STRING,
    house_front_img: DataTypes.STRING,

    note: DataTypes.TEXT,
    status: {
      type: DataTypes.ENUM("pending", "approved", "rejected"),
      defaultValue: "pending",
    },

    admin_id: DataTypes.INTEGER,
    reviewed_at: DataTypes.DATE,
  });

  return EvidenceReview;
};
