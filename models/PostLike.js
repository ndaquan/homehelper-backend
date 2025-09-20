const { executeQuery } = require('../config/database');

class PostLike {
  constructor(data) {
    this.post_like_id = data.post_like_id;
    this.post_id = data.post_id;
    this.user_id = data.user_id;
    this.liked_at = data.liked_at;
  }

  // Tạo like mới
  static async create(likeData) {
    const { post_id, user_id } = likeData;

    // Kiểm tra xem user đã like bài đăng này chưa
    const existingLike = await PostLike.findByPostAndUser(post_id, user_id);
    if (existingLike) {
      throw new Error('User đã like bài đăng này rồi');
    }

    try {
      // Kiểm tra cột post_like_id có phải IDENTITY không
      const identityCheckQuery = `SELECT COLUMNPROPERTY(OBJECT_ID('PostLikes'), 'post_like_id', 'IsIdentity') AS is_identity`;
      const identityResult = await executeQuery(identityCheckQuery);
      const isIdentity =
        identityResult.recordset &&
        identityResult.recordset[0] &&
        identityResult.recordset[0].is_identity === 1;

      if (isIdentity) {
        const query = `
          INSERT INTO PostLikes (post_id, user_id, liked_at)
          OUTPUT INSERTED.*
          VALUES (@param1, @param2, GETDATE())
        `;
        const result = await executeQuery(query, [post_id, user_id]);
        const created = result.recordset[0];
        await PostLike.updatePostLikesCount(post_id);
        return new PostLike(created);
      }

      // Không phải IDENTITY: tự sinh khóa chính
      const nextIdQuery = `SELECT ISNULL(MAX(post_like_id), 0) + 1 AS next_id FROM PostLikes`;
      const nextIdResult = await executeQuery(nextIdQuery);
      const nextId = nextIdResult.recordset[0].next_id;

      const query = `
        INSERT INTO PostLikes (post_like_id, post_id, user_id, liked_at)
        OUTPUT INSERTED.*
        VALUES (@param1, @param2, @param3, GETDATE())
      `;
      const result = await executeQuery(query, [nextId, post_id, user_id]);
      const created = result.recordset[0];
      await PostLike.updatePostLikesCount(post_id);
      return new PostLike(created);
    } catch (error) {
      throw new Error(`Error creating post like: ${error.message}`);
    }
  }

  // Tìm like theo ID
  static async findById(id) {
    const query = `
      SELECT pl.*, u.name as user_name, u.email as user_email, p.title as post_title
      FROM PostLikes pl
      LEFT JOIN Users u ON pl.user_id = u.user_id
      LEFT JOIN Posts p ON pl.post_id = p.post_id
      WHERE pl.post_like_id = @param1
    `;
    try {
      const result = await executeQuery(query, [id]);
      if (!result.recordset || result.recordset.length === 0) return null;
      
      return new PostLike(result.recordset[0]);
    } catch (error) {
      throw new Error(`Error finding post like: ${error.message}`);
    }
  }

  // Tìm like theo post_id và user_id
  static async findByPostAndUser(postId, userId) {
    const query = 'SELECT * FROM PostLikes WHERE post_id = @param1 AND user_id = @param2';
    try {
      const result = await executeQuery(query, [postId, userId]);
      if (!result.recordset || result.recordset.length === 0) return null;
      
      return new PostLike(result.recordset[0]);
    } catch (error) {
      throw new Error(`Error finding post like: ${error.message}`);
    }
  }

  // Lấy danh sách likes của một bài đăng
  static async findByPostId(postId, options = {}) {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const query = `
      SELECT pl.*, u.name as user_name, u.email as user_email
      FROM PostLikes pl
      LEFT JOIN Users u ON pl.user_id = u.user_id
      WHERE pl.post_id = @param1
      ORDER BY pl.liked_at DESC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
    `;
    
    try {
      const result = await executeQuery(query, [postId]);
      const likes = result.recordset.map(row => new PostLike(row));

      // Get total count
      const countQuery = 'SELECT COUNT(*) as total FROM PostLikes WHERE post_id = @param1';
      const countResult = await executeQuery(countQuery, [postId]);
      const total = countResult.recordset[0].total;
      const totalPages = Math.ceil(total / limit);

      return {
        likes,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems: total,
          itemsPerPage: limit,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      };
    } catch (error) {
      throw new Error(`Error finding post likes: ${error.message}`);
    }
  }

  // Lấy danh sách likes của một user
  static async findByUserId(userId, options = {}) {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const query = `
      SELECT pl.*, p.title as post_title, p.content as post_content, p.post_date
      FROM PostLikes pl
      LEFT JOIN Posts p ON pl.post_id = p.post_id
      WHERE pl.user_id = @param1
      ORDER BY pl.liked_at DESC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
    `;
    
    try {
      const result = await executeQuery(query, [userId]);
      const likes = result.recordset.map(row => new PostLike(row));

      // Get total count
      const countQuery = 'SELECT COUNT(*) as total FROM PostLikes WHERE user_id = @param1';
      const countResult = await executeQuery(countQuery, [userId]);
      const total = countResult.recordset[0].total;
      const totalPages = Math.ceil(total / limit);

      return {
        likes,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems: total,
          itemsPerPage: limit,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      };
    } catch (error) {
      throw new Error(`Error finding user likes: ${error.message}`);
    }
  }

  // Xóa like (unlike)
  static async delete(postId, userId) {
    const query = 'DELETE FROM PostLikes WHERE post_id = @param1 AND user_id = @param2';
    try {
      const result = await executeQuery(query, [postId, userId]);
      
      if (result.rowsAffected[0] === 0) {
        throw new Error('Like không tồn tại');
      }
      
      // Cập nhật số lượng likes trong bảng Posts
      await PostLike.updatePostLikesCount(postId);
      
      return true;
    } catch (error) {
      throw new Error(`Error deleting post like: ${error.message}`);
    }
  }

  // Cập nhật số lượng likes trong bảng Posts
  static async updatePostLikesCount(postId) {
    const query = `
      UPDATE Posts 
      SET likes = (
        SELECT COUNT(*) 
        FROM PostLikes 
        WHERE post_id = @param1
      )
      WHERE post_id = @param2
    `;
    
    try {
      await executeQuery(query, [postId, postId]);
    } catch (error) {
      throw new Error(`Error updating post likes count: ${error.message}`);
    }
  }

  // Lấy thống kê likes
  static async getStats(postId = null, userId = null) {
    let query = 'SELECT COUNT(*) as total FROM PostLikes WHERE 1=1';
    const params = [];

    if (postId) {
      query += ' AND post_id = @param' + (params.length + 1);
      params.push(postId);
    }

    if (userId) {
      query += ' AND user_id = @param' + (params.length + 1);
      params.push(userId);
    }

    try {
      const result = await executeQuery(query, params);
      return {
        totalLikes: result.recordset[0].total
      };
    } catch (error) {
      throw new Error(`Error getting like stats: ${error.message}`);
    }
  }

  // Lấy top users có nhiều likes nhất
  static async getTopLikers(limit = 10) {
    const query = `
      SELECT TOP ${limit} u.user_id, u.name, u.email, COUNT(pl.post_like_id) as total_likes
      FROM Users u
      LEFT JOIN PostLikes pl ON u.user_id = pl.user_id
      GROUP BY u.user_id, u.name, u.email
      ORDER BY total_likes DESC
    `;
    
    try {
      const result = await executeQuery(query);
      return result.recordset;
    } catch (error) {
      throw new Error(`Error getting top likers: ${error.message}`);
    }
  }

  // Lấy top posts có nhiều likes nhất
  static async getTopLikedPosts(limit = 10) {
    const query = `
      SELECT TOP ${limit} p.post_id, p.title, p.content, p.post_date, 
             COUNT(pl.post_like_id) as total_likes,
             u.name as author_name
      FROM Posts p
      LEFT JOIN PostLikes pl ON p.post_id = pl.post_id
      LEFT JOIN Users u ON p.user_id = u.user_id
      WHERE (p.status = 'Approved' OR p.status = N'Đã phê duyệt')
      GROUP BY p.post_id, p.title, p.content, p.post_date, u.name
      ORDER BY total_likes DESC
    `;
    
    try {
      const result = await executeQuery(query);
      return result.recordset;
    } catch (error) {
      throw new Error(`Error getting top liked posts: ${error.message}`);
    }
  }
}

module.exports = PostLike;