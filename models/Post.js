const { executeQuery } = require('../config/database');

class Post {
  constructor(data) {
    this.post_id = data.post_id;
    this.user_id = data.user_id;
    this.title = data.title;
    this.content = data.content;
    this.post_date = data.post_date;
  // Status (English preferred): 'Pending' | 'Approved' | 'Rejected'
  this.status = data.status || 'Pending';
    this.related_booking_id = data.related_booking_id || null;
    this.photo_urls = data.photo_urls;
    this.likes = data.likes || 0;
    this.comments_count = data.comments_count || 0;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  // Tạo bài đăng mới
  static async create(postData) {
    const {
      user_id,
      title,
      content,
      status = 'Pending',
      photo_urls = null,
      related_booking_id = null
    } = postData;

    const query = `
      INSERT INTO Posts (
        user_id, title, content, status, related_booking_id, photo_urls,
        created_at, updated_at
      ) VALUES (@param1, @param2, @param3, @param4, @param5, @param6, GETDATE(), GETDATE());
      
      SELECT SCOPE_IDENTITY() AS post_id;
    `;

    const photoUrlsJson = photo_urls ? JSON.stringify(photo_urls) : null;
    
    try {
      const result = await executeQuery(query, [
        user_id, title, content, status, related_booking_id, photoUrlsJson
      ]);
      
      const postId = result.recordset[0].post_id;
      return await Post.findById(postId);
    } catch (error) {
      throw new Error(`Error creating post: ${error.message}`);
    }
  }

// Tìm bài đăng theo ID
static async findById(id) {
  const query = `
    SELECT p.*, u.name as author_name, u.email as author_email
    FROM Posts p
    LEFT JOIN Users u ON p.user_id = u.user_id
    WHERE p.post_id = @param1
  `;
  try {
    const result = await executeQuery(query, [id]);
    if (!result.recordset || result.recordset.length === 0) return null;
    
    const row = result.recordset[0];
    const post = new Post(row);
    post.photo_urls = JSON.parse(post.photo_urls || '[]');
    // Gán thông tin tác giả vào object trả về
    post.author_name = row.author_name || 'Ẩn danh';
    post.author_email = row.author_email || '';
    return post;
  } catch (error) {
    throw new Error(`Error finding post: ${error.message}`);
  }
}

  // Lấy danh sách bài đăng với phân trang
  static async findAll(options = {}) {
    const {
      page = 1,
      limit = 10,
      // Default to approved posts; if caller passes '' or 'all', disable status filter
      status = 'Approved',
      search = '',
      user_id = null,
      sortBy = 'post_date',
      sortOrder = 'DESC'
    } = options;

    const offset = (page - 1) * limit;
    let query = `
      SELECT 
        p.post_id,
        p.title,
        p.content,
        p.post_date,
        p.status,
        p.photo_urls,
        p.related_booking_id,
        u.name as author_name,
        u.email as author_email,
        (SELECT COUNT(*) FROM PostLikes pl WHERE pl.post_id = p.post_id) as likes_count,
        (SELECT COUNT(*) FROM Comments c WHERE c.post_id = p.post_id AND c.parent_comment_id IS NULL) as comments_count
      FROM Posts p
      LEFT JOIN Users u ON p.user_id = u.user_id
      WHERE 1=1
    `;
    const params = [];

    // Filter by status: if status is undefined use default 'Approved'; if empty string or 'all', skip filtering
    const normalizedStatus = (status || '').toString().trim();
    if (normalizedStatus && normalizedStatus.toLowerCase() !== 'all') {
      // Support both English and legacy Vietnamese values for compatibility
      const vnMap = {
        'Approved': 'Đã phê duyệt',
        'Pending': 'Chờ xử lý',
        'Rejected': 'Bị từ chối'
      };
      const vn = vnMap[normalizedStatus] || null;
      if (vn) {
        query += ' AND (p.status = @param' + (params.length + 1) + ' OR p.status = @param' + (params.length + 2) + ')';
        params.push(normalizedStatus, vn);
      } else {
        query += ' AND p.status = @param' + (params.length + 1);
        params.push(normalizedStatus);
      }
    }

    // Search by title or content
    if (search) {
      query += ' AND (p.title LIKE @param' + (params.length + 1) + ' OR p.content LIKE @param' + (params.length + 2) + ')';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    // Filter by user
    if (user_id) {
      query += ' AND p.user_id = @param' + (params.length + 1);
      params.push(user_id);
    }

    // Group by post_id
  query += ' GROUP BY p.post_id, p.title, p.content, p.post_date, p.status, p.photo_urls, p.related_booking_id, p.likes, p.comments_count, p.created_at, p.updated_at, p.user_id, u.name, u.email';

    // Sorting
    query += ` ORDER BY p.${sortBy} ${sortOrder}`;
    query += ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;

    try {
      const result = await executeQuery(query, params);
      const posts = result.recordset.map(row => {
        const post = new Post(row);
        post.photo_urls = JSON.parse(post.photo_urls || '[]');
        post.likes = row.likes_count;
        post.comments_count = row.comments_count;
        post.author_name = row.author_name || 'Ẩn danh';
        post.author_email = row.author_email || '';
        return post;
      });

      // Get total count
      let countQuery = 'SELECT COUNT(*) as total FROM Posts p WHERE 1=1';
      const countParams = [];
      
      if (normalizedStatus && normalizedStatus.toLowerCase() !== 'all') {
        const vnMap = {
          'Approved': 'Đã phê duyệt',
          'Pending': 'Chờ xử lý',
          'Rejected': 'Bị từ chối'
        };
        const vn = vnMap[normalizedStatus] || null;
        if (vn) {
          countQuery += ' AND (p.status = @param' + (countParams.length + 1) + ' OR p.status = @param' + (countParams.length + 2) + ')';
          countParams.push(normalizedStatus, vn);
        } else {
          countQuery += ' AND p.status = @param' + (countParams.length + 1);
          countParams.push(normalizedStatus);
        }
      }
      
      if (search) {
        countQuery += ' AND (p.title LIKE @param' + (countParams.length + 1) + ' OR p.content LIKE @param' + (countParams.length + 2) + ')';
        const searchTerm = `%${search}%`;
        countParams.push(searchTerm, searchTerm);
      }
      
      if (user_id) {
        countQuery += ' AND p.user_id = @param' + (countParams.length + 1);
        countParams.push(user_id);
      }

      const countResult = await executeQuery(countQuery, countParams);
      const total = countResult.recordset[0].total;
      const totalPages = Math.ceil(total / limit);

      return {
        posts,
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
      throw new Error(`Error finding posts: ${error.message}`);
    }
  }

  // Lấy bài đăng gần đây
  static async findRecent(limit = 5) {
    const query = `
      SELECT TOP ${limit} p.*, u.name as author_name, u.email as author_email,
        COUNT(DISTINCT pl.post_like_id) as likes_count,
        COUNT(DISTINCT CASE WHEN c.parent_comment_id IS NULL THEN c.comment_id END) as comments_count
      FROM Posts p
      LEFT JOIN Users u ON p.user_id = u.user_id
      LEFT JOIN PostLikes pl ON p.post_id = pl.post_id
      LEFT JOIN Comments c ON p.post_id = c.post_id
  WHERE p.status IN ('Approved', N'Đã phê duyệt')
      GROUP BY p.post_id, p.title, p.content, p.post_date, p.status, p.photo_urls, p.related_booking_id, p.likes, p.comments_count, p.created_at, p.updated_at, p.user_id, u.name, u.email
      ORDER BY p.post_date DESC
    `;
    
    try {
      const result = await executeQuery(query);
      return result.recordset.map(row => {
        const post = new Post(row);
        post.photo_urls = JSON.parse(post.photo_urls || '[]');
        post.likes = row.likes_count;
        post.comments_count = row.comments_count;
        return post;
      });
    } catch (error) {
      throw new Error(`Error finding recent posts: ${error.message}`);
    }
  }

  // Lấy bài đăng phổ biến (theo likes)
  static async findPopular(limit = 5) {
    const query = `
      SELECT TOP ${limit} p.*, u.name as author_name, u.email as author_email,
        COUNT(DISTINCT pl.post_like_id) as likes_count,
        COUNT(DISTINCT CASE WHEN c.parent_comment_id IS NULL THEN c.comment_id END) as comments_count
      FROM Posts p
      LEFT JOIN Users u ON p.user_id = u.user_id
      LEFT JOIN PostLikes pl ON p.post_id = pl.post_id
      LEFT JOIN Comments c ON p.post_id = c.post_id
  WHERE p.status IN ('Approved', N'Đã phê duyệt')
      GROUP BY p.post_id, p.title, p.content, p.post_date, p.status, p.photo_urls, p.related_booking_id, p.likes, p.comments_count, p.created_at, p.updated_at, p.user_id, u.name, u.email
      ORDER BY likes_count DESC, p.post_date DESC
    `;
    
    try {
      const result = await executeQuery(query);
      return result.recordset.map(row => {
        const post = new Post(row);
        post.photo_urls = JSON.parse(post.photo_urls || '[]');
        post.likes = row.likes_count;
        post.comments_count = row.comments_count;
        return post;
      });
    } catch (error) {
      throw new Error(`Error finding popular posts: ${error.message}`);
    }
  }

  // Cập nhật bài đăng
  async update(updateData) {
    const allowedFields = [
      'title', 'content', 'status', 'photo_urls', 'related_booking_id'
    ];
    
    const updates = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        updates.push(`${key} = @param${values.length + 1}`);
        if (key === 'photo_urls') {
          values.push(JSON.stringify(value));
        } else {
          values.push(value);
        }
      }
    }
    
    if (updates.length === 0) {
      throw new Error('No valid fields to update');
    }
    
    updates.push('updated_at = GETDATE()');
    values.push(this.post_id);
    
    const query = `UPDATE Posts SET ${updates.join(', ')} WHERE post_id = @param${values.length}`;
    
    try {
      await executeQuery(query, values);
      return await Post.findById(this.post_id);
    } catch (error) {
      throw new Error(`Error updating post: ${error.message}`);
    }
  }

  // Xóa bài đăng
  async delete() {
    const query = 'DELETE FROM Posts WHERE post_id = @param1';
    try {
      await executeQuery(query, [this.post_id]);
      return true;
    } catch (error) {
      throw new Error(`Error deleting post: ${error.message}`);
    }
  }

  // Lấy dịch vụ liên quan đến bài đăng
  async getServices() {
    const query = `
      SELECT ps.*, s.name as name, s.description,
             v.specific_price, v.variant_name, v.price_min, v.price_max, v.unit
      FROM PostServices ps
      LEFT JOIN Services s ON ps.service_id = s.service_id
      LEFT JOIN ServiceVariants v ON ps.variant_id = v.variant_id
      WHERE ps.post_id = @param1
    `;
    
    try {
      const result = await executeQuery(query, [this.post_id]);
      return result.recordset;
    } catch (error) {
      throw new Error(`Error getting post services: ${error.message}`);
    }
  }

  // Lấy comments của bài đăng
  async getComments() {
    const query = `
      SELECT c.*, u.name as author_name, u.email as author_email
      FROM Comments c
      LEFT JOIN Users u ON c.user_id = u.user_id
      WHERE c.post_id = @param1 AND c.parent_comment_id IS NULL
      ORDER BY c.created_at ASC
    `;
    
    try {
      const result = await executeQuery(query, [this.post_id]);
      return result.recordset;
    } catch (error) {
      throw new Error(`Error getting post comments: ${error.message}`);
    }
  }

  // Lấy likes của bài đăng
  async getLikes() {
    const query = `
      SELECT pl.*, u.name as user_name, u.email as user_email
      FROM PostLikes pl
      LEFT JOIN Users u ON pl.user_id = u.user_id
      WHERE pl.post_id = @param1
      ORDER BY pl.liked_at DESC
    `;
    
    try {
      const result = await executeQuery(query, [this.post_id]);
      return result.recordset;
    } catch (error) {
      throw new Error(`Error getting post likes: ${error.message}`);
    }
  }

  // Kiểm tra user đã like bài đăng chưa
  async isLikedByUser(userId) {
    const query = 'SELECT * FROM PostLikes WHERE post_id = @param1 AND user_id = @param2';
    try {
      const result = await executeQuery(query, [this.post_id, userId]);
      return result.recordset.length > 0;
    } catch (error) {
      throw new Error(`Error checking like status: ${error.message}`);
    }
  }

  // Static method để kiểm tra like status
  static async isLikedByUser(postId, userId) {
    const query = 'SELECT * FROM PostLikes WHERE post_id = @param1 AND user_id = @param2';
    try {
      const result = await executeQuery(query, [postId, userId]);
      return result.recordset.length > 0;
    } catch (error) {
      throw new Error(`Error checking like status: ${error.message}`);
    }
  }
}

module.exports = Post;