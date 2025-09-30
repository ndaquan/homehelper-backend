const Wishlist = require("../models/Wishlist");

class WishlistController {
  static async getWishlist(req, res) {
    try {
      const { customerId } = req.params;
      const taskers = await Wishlist.getByCustomerIdWithDetails(
        Number(customerId)
      );
      res.json({ taskers });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  static async upsertWishlist(req, res) {
    try {
      const { customer_id, favorite_taskers } = req.body;
      // favorite_taskers phải là 1 số (id tasker muốn thêm)
      const wishlist = await Wishlist.addTasker(customer_id, favorite_taskers);
      res.json(wishlist);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  static async removeTasker(req, res) {
    try {
      const { customer_id, taskerId } = req.body;
      const wishlist = await Wishlist.removeTasker(customer_id, taskerId);
      if (!wishlist)
        return res.status(404).json({ message: "Wishlist not found" });
      res.json({
        message: "Tasker removed",
        favorite_taskers: wishlist.favorite_taskers,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = WishlistController;
