const Post = require('../models/Post');
const PostLike = require('../models/PostLike');
const Comment = require('../models/Comment');
const PostService = require('../models/PostService');
const { executeQuery } = require('../config/database');

// Lấy danh sách posts với phân trang
const getPosts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status, // allow client to control status filter; empty string disables default
      user_id = null,
      sortBy = 'post_date',
      sortOrder = 'DESC'
    } = req.query;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      search,
      // Only include status if provided; undefined means use model default ('Approved'),
      // empty string '' will override and disable the filter in the model logic
      ...(typeof status !== 'undefined' ? { status } : {}),
      user_id,
      sortBy,
      sortOrder
    };

    const result = await Post.findAll(options);
    
    // Nếu có user_id, thêm trường isLiked cho từng post
    let posts = result.posts;
    if (user_id) {
      const userId = user_id;
      // Kiểm tra like cho từng post
      await Promise.all(posts.map(async (post) => {
        post.isLiked = await Post.isLikedByUser(post.post_id, userId);
      }));
    }
    res.json({
      success: true,
      data: posts,
      pagination: result.pagination
    });
  } catch (error) {
    console.error('Error getting posts:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching posts',
      error: error.message
    });
  }
};

// Lấy post theo ID
const getPostById = async (req, res) => {
  try {
  const { id } = req.params;
  const { user_id } = req.query;
  const post = await Post.findById(id);
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Lấy thêm thông tin services và comments
    const [services, comments] = await Promise.all([
      post.getServices(),
      post.getComments()
    ]);

    post.services = services;
    post.comments = comments;
    // Nếu có user_id, trả về isLiked
    if (user_id) {
      post.isLiked = await Post.isLikedByUser(post.post_id, user_id);
    }
    res.json({
      success: true,
      data: post
    });
  } catch (error) {
    console.error('Error getting post:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching post',
      error: error.message
    });
  }
};

// Tạo post mới
const createPost = async (req, res) => {
  try {
    const {
      user_id: body_user_id,
      title,
      content,
      status = 'Pending',
      related_booking_id = null,
      photo_urls = null,
      services = []
    } = req.body;

    // Lấy user_id từ token nếu không truyền trong body
    const user_id = body_user_id || (req.user && (req.user.userId || req.user.user_id));

    // Validate required fields
    if (!title || !content || !user_id) {
      return res.status(400).json({
        success: false,
        message: 'Title, content and user_id are required'
      });
    }

    // Nội dung phải là HTML (đơn giản: cho phép mọi chuỗi, frontend đảm bảo HTML). Có thể thêm sanitize tại đây nếu cần.

    const postData = {
      user_id,
      title,
      content,
      status,
      related_booking_id,
      photo_urls
    };

    const post = await Post.create(postData);
    
    // Nếu truyền services thủ công -> tạo theo danh sách
    if (services && Array.isArray(services) && services.length > 0) {
      await PostService.createMultiple(post.post_id, services);
    } else if (related_booking_id) {
      // Không truyền services nhưng có liên kết booking -> tự tạo từ booking
      try {
        const bookingQuery = `
          SELECT service_id, variant_id
          FROM Bookings
          WHERE booking_id = @param1
        `;
        const bookingResult = await executeQuery(bookingQuery, [related_booking_id]);
        const booking = bookingResult.recordset && bookingResult.recordset[0];
        if (booking && booking.service_id) {
          await PostService.create({
            post_id: post.post_id,
            service_id: booking.service_id,
            variant_id: booking.variant_id || null,
            // desired_price có thể để null để PostService tự lấy specific_price nếu có variant
          });
        }
      } catch (err) {
        // Không fail toàn bộ post nếu lỗi khi gắn service từ booking
        console.warn('Không thể gắn service từ booking cho post:', err.message);
      }
    }
    
    res.status(201).json({
      success: true,
      message: 'Post created successfully',
      data: post
    });
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating post',
      error: error.message
    });
  }
};

// Cập nhật post
const updatePost = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const post = await Post.findById(id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const updatedPost = await post.update(updateData);
    
    res.json({
      success: true,
      message: 'Post updated successfully',
      data: updatedPost
    });
  } catch (error) {
    console.error('Error updating post:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating post',
      error: error.message
    });
  }
};

// Xóa post
const deletePost = async (req, res) => {
  try {
    const { id } = req.params;
    
    const post = await Post.findById(id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    await post.delete();
    
    res.json({
      success: true,
      message: 'Post deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting post',
      error: error.message
    });
  }
};

// Lấy posts gần đây
const getRecentPosts = async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    const posts = await Post.findRecent(parseInt(limit));
    
    res.json({
      success: true,
      data: posts
    });
  } catch (error) {
    console.error('Error getting recent posts:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching recent posts',
      error: error.message
    });
  }
};

// Lấy posts phổ biến
const getPopularPosts = async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    const posts = await Post.findPopular(parseInt(limit));
    
    res.json({
      success: true,
      data: posts
    });
  } catch (error) {
    console.error('Error getting popular posts:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching popular posts',
      error: error.message
    });
  }
};

// Like/Unlike post
const toggleLikePost = async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    const post = await Post.findById(id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Kiểm tra xem user đã like chưa
    const isLiked = await post.isLikedByUser(user_id);
    
    if (isLiked) {
      // Unlike
      await PostLike.delete(id, user_id);
      res.json({
        success: true,
        message: 'Post unliked successfully',
        liked: false
      });
    } else {
      // Like
      await PostLike.create({ post_id: id, user_id });
      res.json({
        success: true,
        message: 'Post liked successfully',
        liked: true
      });
    }
  } catch (error) {
    console.error('Error toggling like:', error);
    res.status(500).json({
      success: false,
      message: 'Error toggling like',
      error: error.message
    });
  }
};

// Tạo comment
const createComment = async (req, res) => {
  try {
    const {
      post_id,
      user_id,
      parent_comment_id = null,
      content
    } = req.body;

    if (!post_id || !user_id || !content) {
      return res.status(400).json({
        success: false,
        message: 'Post ID, user ID and content are required'
      });
    }

    const comment = await Comment.create({
      post_id,
      user_id,
      parent_comment_id,
      content
    });

    // Lấy thông tin user để trả về kèm comment
    const userQuery = 'SELECT name, email FROM Users WHERE user_id = @param1';
    const userResult = await require('../config/database').executeQuery(userQuery, [user_id]);
    const author = userResult.recordset[0] || {};
    comment.author_name = author.name || 'Ẩn danh';
    comment.author_email = author.email || '';

    res.status(201).json({
      success: true,
      message: 'Comment created successfully',
      data: comment
    });
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating comment',
      error: error.message
    });
  }
};

// Lấy comments của post kèm tên người dùng
const getPostComments = async (req, res) => {
  try {
    const { id } = req.params; // post_id
    const { page = 1, limit = 20, includeReplies = true } = req.query;

    const result = await Comment.findByPostId(id, {
      page: parseInt(page),
      limit: parseInt(limit),
      includeReplies: includeReplies === 'true'
    });

    res.json({
      success: true,
      data: result.comments,
      pagination: result.pagination
    });
  } catch (error) {
    console.error("Error getting comments:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching comments",
      error: error.message
    });
  }
};


// Cập nhật comment
const updateComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    const comment = await Comment.findById(id);
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    const updatedComment = await comment.update({ content });
    
    res.json({
      success: true,
      message: 'Comment updated successfully',
      data: updatedComment
    });
  } catch (error) {
    console.error('Error updating comment:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating comment',
      error: error.message
    });
  }
};

// Xóa comment
const deleteComment = async (req, res) => {
  try {
    const { id } = req.params;
    
    const comment = await Comment.findById(id);
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    await comment.delete();
    
    res.json({
      success: true,
      message: 'Comment deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting comment',
      error: error.message
    });
  }
};

// Lấy services của post
const getPostServices = async (req, res) => {
  try {
    const { id } = req.params;
    
    const post = await Post.findById(id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const services = await post.getServices();
    
    res.json({
      success: true,
      data: services
    });
  } catch (error) {
    console.error('Error getting post services:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching post services',
      error: error.message
    });
  }
};

// Tìm kiếm posts
const searchPosts = async (req, res) => {
  try {
    const {
      q: search,
      page = 1,
      limit = 10,
      sortBy = 'post_date',
      sortOrder = 'DESC'
    } = req.query;

    if (!search) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      search,
      sortBy,
      sortOrder
    };

    const result = await Post.findAll(options);
    
    res.json({
      success: true,
      data: result.posts,
      pagination: result.pagination,
      searchQuery: search
    });
  } catch (error) {
    console.error('Error searching posts:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching posts',
      error: error.message
    });
  }
};

// Lấy thống kê
const getStats = async (req, res) => {
  try {
    const [postStats, likeStats, commentStats, serviceStats] = await Promise.all([
      Post.findAll({ page: 1, limit: 1 }),
      PostLike.getStats(),
      Comment.getStats(),
      PostService.getStats()
    ]);

    res.json({
      success: true,
      data: {
        totalPosts: postStats.pagination.totalItems,
        totalLikes: likeStats.totalLikes,
        totalComments: commentStats.totalComments,
        totalPostServices: serviceStats.total_post_services,
        postsWithServices: serviceStats.posts_with_services,
        uniqueServicesRequested: serviceStats.unique_services_requested
      }
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching stats',
      error: error.message
    });
  }
};

// Kiểm tra user đã like post chưa
const checkLikeStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    const post = await Post.findById(id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const isLiked = await Post.isLikedByUser(id, user_id);

    res.json({
      success: true,
      data: {
        isLiked,
        postId: parseInt(id),
        userId: parseInt(user_id)
      }
    });
  } catch (error) {
    console.error('Error checking like status:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking like status',
      error: error.message
    });
  }
};

module.exports = {
  getPosts,
  getPostById,
  createPost,
  updatePost,
  deletePost,
  getRecentPosts,
  getPopularPosts,
  toggleLikePost,
  checkLikeStatus,
  createComment,
  getPostComments,
  updateComment,
  deleteComment,
  getPostServices,
  searchPosts,
  getStats
};