const WalletTx = require('../models/WalletTransaction');

// GET /api/wallet/balance
exports.getBalance = async (req, res) => {
  try {
    const user_id = req.user?.userId;
    if (!user_id) return res.status(401).json({ error: 'unauthorized' });

    const balance = await WalletTx.getBalance(user_id);
    return res.json({ balance });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/wallet/history
exports.getHistory = async (req, res) => {
  try {
    const user_id = req.user?.userId;
    if (!user_id) return res.status(401).json({ error: 'unauthorized' });

    const limit = Number(req.query.limit) || 20;
    const history = await WalletTx.getHistory(user_id, limit);
    return res.json({ history });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
