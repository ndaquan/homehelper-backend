const { executeQuery } = require('../config/database');
const { moderateContent } = require('../config/gemini.service');

class Comment {
  constructor(data) {
    this.comment_id = data.comment_id;
    this.post_id = data.post_id;
    this.video_id = data.video_id;
    this.user_id = data.user_id;
    this.parent_comment_id = data.parent_comment_id;
    this.content = data.content;
    this.created_at = data.created_at;

  }

  // Tạo comment mới
  static async create(commentData) {
    const { post_id, video_id, user_id, parent_comment_id = null, content } = commentData;
    try {
      const isContentValid = await moderateContent(content);
      if (!isContentValid) {
        throw new Error('Nội dung bình luận không phù hợp, chứa từ ngữ không được phép');
      }

      if (!post_id && !video_id) {
        throw new Error('Phải cung cấp post_id hoặc video_id');
      }

      const query = `
        INSERT INTO Comments (post_id, video_id, user_id, parent_comment_id, content, created_at)
        OUTPUT INSERTED.comment_id, INSERTED.post_id, INSERTED.video_id, INSERTED.user_id, INSERTED.parent_comment_id, INSERTED.content, INSERTED.created_at
        VALUES (@param1, @param2, @param3, @param4, @param5, GETDATE())
      `;
      const result = await executeQuery(query, [
        post_id || null,
        video_id || null,
        user_id,
        parent_comment_id,
        content
      ]);
      return result.recordset[0];
    } catch (error) {
      throw new Error(`${error.message}`);
    }
  }

  // Tìm bình luận theo ID
  static async findById(id) {
    const query = `
      SELECT c.*, u.name as author_name, u.email as author_email, u.avatar_url as author_avatar_url, p.title as post_title
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
      throw new Error(`Lỗi khi tìm bình luận: ${error.message}`);
    }
  }

  // Lấy danh sách bình luận của một bài đăng
  static async findByPostId(postId, options = {}) {
    const { page = 1, limit = 20, includeReplies = true } = options;
    const offset = (page - 1) * limit;

    let query = `
      SELECT 
        c.comment_id,
        c.post_id,
        c.video_id,
        c.user_id,
        c.parent_comment_id,
        c.content,
        c.created_at,
        u.name AS author_name,
        u.email AS author_email,
        u.avatar_url AS author_avatar_url
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
        ...row,
        replies: includeReplies ? [] : undefined
      }));

      if (includeReplies) {
        for (let comment of comments) {
          const repliesResult = await this.getReplies(comment.comment_id);
          comment.replies = repliesResult.replies;
        }
      }

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
      throw new Error(`Lỗi khi lấy bình luận của bài đăng: ${error.message}`);
    }
  }

  // Lấy danh sách bình luận của một video
  static async findByVideoId(videoId, options = {}) {
    const { page = 1, limit = 20, includeReplies = true } = options;
    const offset = (page - 1) * limit;

    let query = `
      SELECT 
        c.comment_id,
        c.post_id,
        c.video_id,
        c.user_id,
        c.parent_comment_id,
        c.content,
        c.created_at,
        u.name AS author_name,
        u.email AS author_email,
        u.avatar_url AS author_avatar_url
      FROM Comments c
      LEFT JOIN Users u ON c.user_id = u.user_id
      WHERE c.video_id = @param1
    `;

    if (!includeReplies) {
      query += ' AND c.parent_comment_id IS NULL';
    }

    query += ` ORDER BY c.created_at ASC OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;

    try {
      const result = await executeQuery(query, [videoId]);
      const comments = result.recordset.map(row => ({
        ...row,
        replies: includeReplies ? [] : undefined
      }));

      if (includeReplies) {
        for (let comment of comments) {
          const repliesResult = await this.getReplies(comment.comment_id);
          comment.replies = repliesResult.replies;
        }
      }

      let countQuery = 'SELECT COUNT(*) as total FROM Comments WHERE video_id = @param1';
      if (!includeReplies) {
        countQuery += ' AND parent_comment_id IS NULL';
      }
      const countResult = await executeQuery(countQuery, [videoId]);
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
      throw new Error(`Lỗi khi lấy bình luận của video: ${error.message}`);
    }
  }

  // Lấy danh sách bình luận của một người dùng
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
      throw new Error(`Lỗi khi lấy bình luận của người dùng: ${error.message}`);
    }
  }

  // Lấy danh sách trả lời (replies) của một bình luận
  static async getReplies(parentCommentId, options = {}) {
    const { page = 1, limit = 10 } = options;
    const offset = (page - 1) * limit;

    const query = `
      SELECT c.*, u.name as author_name, u.email as author_email, u.avatar_url as author_avatar_url
      FROM Comments c
      LEFT JOIN Users u ON c.user_id = u.user_id
      WHERE c.parent_comment_id = @param1
      ORDER BY c.created_at ASC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
    `;

    try {
      const result = await executeQuery(query, [parentCommentId]);
      const replies = result.recordset.map(row => new Comment(row));

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
      throw new Error(`Lỗi khi lấy trả lời bình luận: ${error.message}`);
    }
  }

  // Cập nhật bình luận
  async update(updateData) {
    const allowedFields = ['content'];

    const updates = [];
    const values = [];

    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        if (key === 'content') {
          const isContentValid = await moderateContent(value);
          if (!isContentValid) {
            throw new Error('Nội dung bình luận không phù hợp, chứa từ ngữ không được phép');
          }
        }
        updates.push(`${key} = @param${values.length + 1}`);
        values.push(value);
      }
    }

    if (updates.length === 0) {
      throw new Error('Không có trường hợp lệ để cập nhật');
    }

    values.push(this.comment_id);

    const query = `UPDATE Comments SET ${updates.join(', ')} WHERE comment_id = @param${values.length}`;

    try {
      await executeQuery(query, values);
      return await Comment.findById(this.comment_id);
    } catch (error) {
      throw new Error(`Lỗi khi cập nhật bình luận: ${error.message}`);
    }
  }

  // Xóa bình luận
  async delete() {
    const query = 'DELETE FROM Comments WHERE comment_id = @param1';
    try {
      const result = await executeQuery(query, [this.comment_id]);

      if (result.rowsAffected[0] === 0) {
        throw new Error('Bình luận không tồn tại');
      }

      if (this.post_id) {
        await Comment.updatePostCommentsCount(this.post_id);
      }

      return true;
    } catch (error) {
      throw new Error(`Lỗi khi xóa bình luận: ${error.message}`);
    }
  }

  // Cập nhật số lượng bình luận trong bảng Posts
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
      throw new Error(`Lỗi khi cập nhật số lượng bình luận: ${error.message}`);
    }
  }

  // Lấy thống kê bình luận
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
      throw new Error(`Lỗi khi lấy thống kê bình luận: ${error.message}`);
    }
  }

  // Lấy top người dùng có nhiều bình luận nhất
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
      throw new Error(`Lỗi khi lấy top người bình luận: ${error.message}`);
    }
  }

  // Lấy top bài đăng có nhiều bình luận nhất
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
      throw new Error(`Lỗi khi lấy top bài đăng được bình luận: ${error.message}`);
    }
  }

  // Lấy cây bình luận (bình luận và trả lời)
  static async getCommentTree(videoId, options = {}) {
    const { limit = 50 } = options;

    const query = `
    SELECT 
      c.comment_id, c.post_id, c.video_id, c.user_id,
      c.parent_comment_id, c.content, c.created_at,
      u.name as author_name, u.email as author_email, u.avatar_url as author_avatar_url
    FROM Comments c
    LEFT JOIN Users u ON c.user_id = u.user_id
    WHERE c.video_id = @param1
    ORDER BY c.created_at ASC
  `;

    try {
      const result = await executeQuery(query, [videoId]);
      const comments = result.recordset;

      // Kiểm tra xem buildCommentTree có tồn tại không
      if (typeof this.buildCommentTree !== 'function') {
        throw new Error('buildCommentTree is not a function');
      }

      // Gọi buildCommentTree để tổ chức thành cây
      const tree = this.buildCommentTree(comments);

      return tree.slice(0, limit); // giới hạn số lượng root comments
    } catch (error) {
      throw new Error(`Lỗi khi lấy cây bình luận: ${error.message}`);
    }
  }

  static buildCommentTree(comments) {
    const map = {};
    const roots = [];

    comments.forEach(c => {
      map[c.comment_id] = { ...c, replies: [] };
    });

    comments.forEach(c => {
      if (c.parent_comment_id) {
        if (map[c.parent_comment_id]) {
          map[c.parent_comment_id].replies.push(map[c.comment_id]);
        }
      } else {
        roots.push(map[c.comment_id]);
      }
    });

    return roots;
  }
}

module.exports = Comment;