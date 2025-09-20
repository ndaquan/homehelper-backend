const { executeQuery } = require('../config/database');

class Comment {
  constructor(data) {
    this.comment_id = data.comment_id;
    this.post_id = data.post_id;
    this.user_id = data.user_id;
    this.parent_comment_id = data.parent_comment_id;
    this.content = data.content;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  // Tạo comment mới
  static async create(commentData) {
    const {
      post_id,
      user_id,
      parent_comment_id = null,
      content
    } = commentData;
    
    try {
      // Kiểm tra comment_id có phải IDENTITY không
      const identityCheckQuery = `SELECT COLUMNPROPERTY(OBJECT_ID('Comments'), 'comment_id', 'IsIdentity') AS is_identity`;
      const identityResult = await executeQuery(identityCheckQuery);
      const isIdentity =
        identityResult.recordset &&
        identityResult.recordset[0] &&
        identityResult.recordset[0].is_identity === 1;

      if (isIdentity) {
        const insertIdentity = `
          INSERT INTO Comments (post_id, user_id, parent_comment_id, content, created_at, updated_at)
          OUTPUT INSERTED.comment_id
          VALUES (@param1, @param2, @param3, @param4, GETDATE(), GETDATE())
        `;
        const result = await executeQuery(insertIdentity, [post_id, user_id, parent_comment_id, content]);
        const commentId = result.recordset[0].comment_id;
        // Cập nhật số lượng comments trong bảng Posts
        await Comment.updatePostCommentsCount(post_id);
        return await Comment.findById(commentId);
      }

      // Không phải IDENTITY: tự sinh comment_id
      const nextIdQuery = `SELECT ISNULL(MAX(comment_id), 0) + 1 AS next_id FROM Comments`;
      const nextIdResult = await executeQuery(nextIdQuery);
      const nextId = nextIdResult.recordset[0].next_id;

      const insertManual = `
        INSERT INTO Comments (comment_id, post_id, user_id, parent_comment_id, content, created_at, updated_at)
        OUTPUT INSERTED.comment_id
        VALUES (@param1, @param2, @param3, @param4, @param5, GETDATE(), GETDATE())
      `;
      const result = await executeQuery(insertManual, [nextId, post_id, user_id, parent_comment_id, content]);
      const commentId = result.recordset[0].comment_id;
      
      // Cập nhật số lượng comments trong bảng Posts
      await Comment.updatePostCommentsCount(post_id);
      
      return await Comment.findById(commentId);
    } catch (error) {
      throw new Error(`Error creating comment: ${error.message}`);
    }
  }

  // Tìm comment theo ID
  static async findById(id) {
    const query = `
      SELECT c.*, u.name as author_name, u.email as author_email, p.title as post_title
      FROM Comments c
      LEFT JOIN Users u ON c.user_id = u.user_id
      LEFT JOIN Posts p ON c.post_id = p.post_id
      WHERE c.comment_id = @param1
    `;
    try {
      const result = await executeQuery(query, [id]);
      if (!result.recordset || result.recordset.length === 0) return null;
      
      return new Comment(result.recordset[0]);
    } catch (error) {
      throw new Error(`Error finding comment: ${error.message}`);
    }
  }

// Lấy danh sách comments của một bài đăng
static async findByPostId(postId, options = {}) {
  const { page = 1, limit = 20, includeReplies = true } = options;
  const offset = (page - 1) * limit;

  let query = `
  SELECT 
    c.comment_id,
    c.post_id,
    c.user_id,
    c.parent_comment_id,
    c.content,
    c.created_at,
    c.updated_at,
    u.name AS author_name,
    u.email AS author_email
  FROM Comments c
  LEFT JOIN Users u ON c.user_id = u.user_id
  WHERE c.post_id = @param1
  `;

  if (!includeReplies) {
    query += ' AND c.parent_comment_id IS NULL';
  }

  query += ` ORDER BY c.created_at ASC OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
  
  try {
    const result = await executeQuery(query, [postId]);
    const comments = result.recordset.map(row => ({
      ...row
    }));

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM Comments WHERE post_id = @param1';
    if (!includeReplies) {
      countQuery += ' AND parent_comment_id IS NULL';
    }
    const countResult = await executeQuery(countQuery, [postId]);
    const total = countResult.recordset[0].total;
    const totalPages = Math.ceil(total / limit);

    return {
      comments,
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
    throw new Error(`Error finding post comments: ${error.message}`);
  }
}


  // Lấy danh sách comments của một user
  static async findByUserId(userId, options = {}) {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const query = `
      SELECT c.*, p.title as post_title, p.content as post_content, p.post_date
      FROM Comments c
      LEFT JOIN Posts p ON c.post_id = p.post_id
      WHERE c.user_id = @param1
      ORDER BY c.created_at DESC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
    `;
    
    try {
      const result = await executeQuery(query, [userId]);
      const comments = result.recordset.map(row => new Comment(row));

      // Get total count
      const countQuery = 'SELECT COUNT(*) as total FROM Comments WHERE user_id = @param1';
      const countResult = await executeQuery(countQuery, [userId]);
      const total = countResult.recordset[0].total;
      const totalPages = Math.ceil(total / limit);

      return {
        comments,
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
      throw new Error(`Error finding user comments: ${error.message}`);
    }
  }

  // Lấy replies của một comment
  static async getReplies(parentCommentId, options = {}) {
    const { page = 1, limit = 10 } = options;
    const offset = (page - 1) * limit;

    const query = `
      SELECT c.*, u.name as author_name, u.email as author_email
      FROM Comments c
      LEFT JOIN Users u ON c.user_id = u.user_id
      WHERE c.parent_comment_id = @param1
      ORDER BY c.created_at ASC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
    `;
    
    try {
      const result = await executeQuery(query, [parentCommentId]);
      const replies = result.recordset.map(row => new Comment(row));

      // Get total count
      const countQuery = 'SELECT COUNT(*) as total FROM Comments WHERE parent_comment_id = @param1';
      const countResult = await executeQuery(countQuery, [parentCommentId]);
      const total = countResult.recordset[0].total;
      const totalPages = Math.ceil(total / limit);

      return {
        replies,
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
      throw new Error(`Error finding comment replies: ${error.message}`);
    }
  }

  // Cập nhật comment
  async update(updateData) {
    const allowedFields = ['content'];
    
    const updates = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        updates.push(`${key} = @param${values.length + 1}`);
        values.push(value);
      }
    }
    
    if (updates.length === 0) {
      throw new Error('No valid fields to update');
    }
    
    updates.push('updated_at = GETDATE()');
    values.push(this.comment_id);
    
    const query = `UPDATE Comments SET ${updates.join(', ')} WHERE comment_id = @param${values.length}`;
    
    try {
      await executeQuery(query, values);
      return await Comment.findById(this.comment_id);
    } catch (error) {
      throw new Error(`Error updating comment: ${error.message}`);
    }
  }

  // Xóa comment
  async delete() {
    const query = 'DELETE FROM Comments WHERE comment_id = @param1';
    try {
      const result = await executeQuery(query, [this.comment_id]);
      
      if (result.rowsAffected[0] === 0) {
        throw new Error('Comment không tồn tại');
      }
      
      // Cập nhật số lượng comments trong bảng Posts
      await Comment.updatePostCommentsCount(this.post_id);
      
      return true;
    } catch (error) {
      throw new Error(`Error deleting comment: ${error.message}`);
    }
  }

  // Cập nhật số lượng comments trong bảng Posts
  static async updatePostCommentsCount(postId) {
    const query = `
      UPDATE Posts 
      SET comments_count = (
        SELECT COUNT(*) 
        FROM Comments 
        WHERE post_id = @param1 AND parent_comment_id IS NULL
      )
      WHERE post_id = @param2
    `;
    
    try {
      await executeQuery(query, [postId, postId]);
    } catch (error) {
      throw new Error(`Error updating post comments count: ${error.message}`);
    }
  }

  // Lấy thống kê comments
  static async getStats(postId = null, userId = null) {
    let query = 'SELECT COUNT(*) as total FROM Comments WHERE 1=1';
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
        totalComments: result.recordset[0].total
      };
    } catch (error) {
      throw new Error(`Error getting comment stats: ${error.message}`);
    }
  }

  // Lấy top users có nhiều comments nhất
  static async getTopCommenters(limit = 10) {
    const query = `
      SELECT TOP ${limit} u.user_id, u.name, u.email, COUNT(c.comment_id) as total_comments
      FROM Users u
      LEFT JOIN Comments c ON u.user_id = c.user_id
      GROUP BY u.user_id, u.name, u.email
      ORDER BY total_comments DESC
    `;
    
    try {
      const result = await executeQuery(query);
      return result.recordset;
    } catch (error) {
      throw new Error(`Error getting top commenters: ${error.message}`);
    }
  }

  // Lấy top posts có nhiều comments nhất
  static async getTopCommentedPosts(limit = 10) {
    const query = `
      SELECT TOP ${limit} p.post_id, p.title, p.content, p.post_date, 
             COUNT(c.comment_id) as total_comments,
             u.name as author_name
      FROM Posts p
      LEFT JOIN Comments c ON p.post_id = c.post_id
      LEFT JOIN Users u ON p.user_id = u.user_id
      WHERE (p.status = 'Approved' OR p.status = N'Đã phê duyệt')
      GROUP BY p.post_id, p.title, p.content, p.post_date, u.name
      ORDER BY total_comments DESC
    `;
    
    try {
      const result = await executeQuery(query);
      return result.recordset;
    } catch (error) {
      throw new Error(`Error getting top commented posts: ${error.message}`);
    }
  }

  // Lấy comment tree (comment và replies)
  static async getCommentTree(postId, options = {}) {
    const { limit = 50 } = options;

    const query = `
      SELECT TOP ${limit} c.*, u.name as author_name, u.email as author_email
      FROM Comments c
      LEFT JOIN Users u ON c.user_id = u.user_id
      WHERE c.post_id = @param1
      ORDER BY 
        CASE WHEN c.parent_comment_id IS NULL THEN c.created_at END ASC,
        CASE WHEN c.parent_comment_id IS NOT NULL THEN c.created_at END ASC
    `;
    
    try {
      const result = await executeQuery(query, [postId]);
      const comments = result.recordset.map(row => new Comment(row));

      // Tạo comment tree
      const commentMap = new Map();
      const rootComments = [];

      // Tạo map cho tất cả comments
      comments.forEach(comment => {
        comment.replies = [];
        commentMap.set(comment.comment_id, comment);
      });

      // Xây dựng tree
      comments.forEach(comment => {
        if (comment.parent_comment_id) {
          const parent = commentMap.get(comment.parent_comment_id);
          if (parent) {
            parent.replies.push(comment);
          }
        } else {
          rootComments.push(comment);
        }
      });

      return rootComments;
    } catch (error) {
      throw new Error(`Error getting comment tree: ${error.message}`);
    }
  }
}

module.exports = Comment;