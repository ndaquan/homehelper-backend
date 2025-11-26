CREATE DATABASE HomeHelperDB37;
GO
USE HomeHelperDB37;
GO

-- =============================================
-- 1. XÓA TẤT CẢ BẢNG THEO THỨ TỰ NGƯỢC (con → cha)
-- =============================================

IF OBJECT_ID('UserBadges') IS NOT NULL DROP TABLE UserBadges;
IF OBJECT_ID('Badges') IS NOT NULL DROP TABLE Badges;
IF OBJECT_ID('VideoModerations') IS NOT NULL DROP TABLE VideoModerations;
IF OBJECT_ID('Videos') IS NOT NULL DROP TABLE Videos;
IF OBJECT_ID('PointMilestones') IS NOT NULL DROP TABLE PointMilestones;
IF OBJECT_ID('UserPoints') IS NOT NULL DROP TABLE UserPoints;
IF OBJECT_ID('RatingHelpful') IS NOT NULL DROP TABLE RatingHelpful;
IF OBJECT_ID('Notifications') IS NOT NULL DROP TABLE Notifications;
IF OBJECT_ID('Messages') IS NOT NULL DROP TABLE Messages;
IF OBJECT_ID('ConversationParticipants') IS NOT NULL DROP TABLE ConversationParticipants;
IF OBJECT_ID('Conversations') IS NOT NULL DROP TABLE Conversations;
IF OBJECT_ID('Quotes') IS NOT NULL DROP TABLE Quotes;
IF OBJECT_ID('PostServices') IS NOT NULL DROP TABLE PostServices;
IF OBJECT_ID('Comments') IS NOT NULL DROP TABLE Comments;
IF OBJECT_ID('PostLikes') IS NOT NULL DROP TABLE PostLikes;
IF OBJECT_ID('Posts') IS NOT NULL DROP TABLE Posts;
IF OBJECT_ID('Ratings') IS NOT NULL DROP TABLE Ratings;
IF OBJECT_ID('Payments') IS NOT NULL DROP TABLE Payments;
IF OBJECT_ID('TaskPhotos') IS NOT NULL DROP TABLE TaskPhotos;
IF OBJECT_ID('Tasks') IS NOT NULL DROP TABLE Tasks;
IF OBJECT_ID('Bookings') IS NOT NULL DROP TABLE Bookings;
IF OBJECT_ID('Contracts') IS NOT NULL DROP TABLE Contracts;
IF OBJECT_ID('WalletTransactions') IS NOT NULL DROP TABLE WalletTransactions;
IF OBJECT_ID('Transactions') IS NOT NULL DROP TABLE Transactions;
IF OBJECT_ID('TaskerServiceVariants') IS NOT NULL DROP TABLE TaskerServiceVariants;
IF OBJECT_ID('ServiceVariants') IS NOT NULL DROP TABLE ServiceVariants;
IF OBJECT_ID('Services') IS NOT NULL DROP TABLE Services;
IF OBJECT_ID('Wishlist') IS NOT NULL DROP TABLE Wishlist;
IF OBJECT_ID('TaskerCertifications') IS NOT NULL DROP TABLE TaskerCertifications;
IF OBJECT_ID('TaskerApplications') IS NOT NULL DROP TABLE TaskerApplications;
IF OBJECT_ID('cccd_verification') IS NOT NULL DROP TABLE cccd_verification;
IF OBJECT_ID('Addresses') IS NOT NULL DROP TABLE Addresses;
IF OBJECT_ID('Taskers') IS NOT NULL DROP TABLE Taskers;
IF OBJECT_ID('Users') IS NOT NULL DROP TABLE Users;
GO

-- =============================================
-- 2. TẠO BẢNG THEO THỨ TỰ ĐÚNG (cha → con)
-- =============================================

-- Users
CREATE TABLE Users (
    user_id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    email NVARCHAR(255) NOT NULL UNIQUE,
    password NVARCHAR(255) NOT NULL,
    role NVARCHAR(20) NOT NULL CHECK (role IN ('Admin', 'Tasker', 'Customer', 'Guest', 'Staff')),
    phone NVARCHAR(20),
    created_at DATETIME2 DEFAULT GETDATE(),
    updated_at DATETIME2 DEFAULT GETDATE(),
    cccd_url NVARCHAR(255),
    cccd_status NVARCHAR(20) DEFAULT 'Chờ xử lý' CHECK (cccd_status IN ('Chờ xử lý', 'Đã xác minh', 'Bị từ chối')),
    cccd_uploaded_at DATETIME2,
    cccd_verified_at DATETIME2,
    cccd_verified_by INT,
    is_banned BIT NOT NULL DEFAULT 0,
    CONSTRAINT FK_Users_VerifiedBy FOREIGN KEY (cccd_verified_by) REFERENCES Users(user_id)
);
GO

-- TaskerApplications
CREATE TABLE TaskerApplications (
    application_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL,
    introduce NVARCHAR(MAX) NULL,
    variants_json NVARCHAR(MAX) NULL,
    certifications_json NVARCHAR(MAX) NULL,
    video_json NVARCHAR(MAX) NULL,
    status NVARCHAR(20) NOT NULL DEFAULT 'Pending',
    created_at DATETIME DEFAULT GETDATE(),
    reviewed_at DATETIME NULL,
    reviewer_id INT NULL,
    note NVARCHAR(MAX) NULL,
    CONSTRAINT FK_TaskerApplications_User FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    CONSTRAINT FK_TaskerApplications_Reviewer FOREIGN KEY (reviewer_id) REFERENCES Users(user_id),
    CONSTRAINT CHK_TaskerApplications_Status CHECK (status IN ('Pending','Approved','Rejected'))
);
GO

CREATE INDEX IX_TaskerApplications_Status ON TaskerApplications(status, created_at);
CREATE INDEX IX_TaskerApplications_User ON TaskerApplications(user_id);
GO

-- Addresses
CREATE TABLE Addresses (
    address_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT,
    address NVARCHAR(MAX),
    lat DECIMAL(9,6),
    lng DECIMAL(9,6),
    created_at DATETIME2 DEFAULT GETDATE(),
    updated_at DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_Addresses_Users FOREIGN KEY (user_id) REFERENCES Users(user_id)
);
GO

-- Taskers
CREATE TABLE Taskers (
    tasker_id INT NOT NULL PRIMARY KEY,
    Introduce NVARCHAR(MAX) NULL,
    certifications NVARCHAR(MAX) NULL,
    status NVARCHAR(20) NULL DEFAULT 'Active',
    rating DECIMAL(3,2) NULL,
    CONSTRAINT FK_Taskers_Users FOREIGN KEY (tasker_id) REFERENCES Users(user_id),
    CONSTRAINT CHK_tasker_status CHECK (status IN ('Active', 'Inactive', 'Banned'))
);
GO

-- Wishlist
CREATE TABLE Wishlist (
    customer_id INT PRIMARY KEY,
    favorite_taskers NVARCHAR(MAX),
    CONSTRAINT FK_Wishlist_Users FOREIGN KEY (customer_id) REFERENCES Users(user_id)
);
GO

-- Services
CREATE TABLE Services (
    service_id INT PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX),
    requires_certificate BIT NOT NULL DEFAULT 0
);
GO

-- ServiceVariants
CREATE TABLE ServiceVariants (
    variant_id INT PRIMARY KEY,
    service_id INT,
    variant_name NVARCHAR(255) NOT NULL,
    pricing_type NVARCHAR(50) NOT NULL,
    price_min DECIMAL(10,2),
    price_max DECIMAL(10,2),
    unit NVARCHAR(50),
    CONSTRAINT FK_ServiceVariants_Services FOREIGN KEY (service_id) REFERENCES Services(service_id),
    CONSTRAINT CHK_pricing_type CHECK (pricing_type IN (N'Theo giờ', N'Theo ngày', N'Theo tuần', N'Theo tháng', N'Theo chiếc', N'Theo m²'))
);
GO

-- TaskerServiceVariants
CREATE TABLE TaskerServiceVariants (
    tasker_service_variant_id INT IDENTITY(1,1) PRIMARY KEY,
    tasker_id INT,
    variant_id INT,
    created_at DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_TaskerServiceVariants_Taskers FOREIGN KEY (tasker_id) REFERENCES Taskers(tasker_id),
    CONSTRAINT FK_TaskerServiceVariants_Variants FOREIGN KEY (variant_id) REFERENCES ServiceVariants(variant_id),
    CONSTRAINT UQ_tasker_variant UNIQUE (tasker_id, variant_id)
);
GO

-- TaskerCertifications
CREATE TABLE TaskerCertifications (
    cert_id INT IDENTITY(1,1) PRIMARY KEY,
    tasker_id INT NOT NULL,
    cert_name NVARCHAR(255) NOT NULL,
    cert_public_id NVARCHAR(255) NULL,
    delivery_type NVARCHAR(32) NULL,
    service_id INT NULL,
    issued_by NVARCHAR(255) NULL,
    issued_date DATE NULL,
    status NVARCHAR(20) DEFAULT 'Pending',
    uploaded_at DATETIME DEFAULT GETDATE(),
    verified_at DATETIME NULL,
    verified_by INT NULL,
    extracted_payload NVARCHAR(MAX) NULL,
    ai_model NVARCHAR(50) NULL,
    ai_confidence DECIMAL(5,2) NULL,
    ai_status NVARCHAR(20) NULL,
    needs_review BIT DEFAULT 0,
    parsed_cert_name NVARCHAR(255) NULL,
    parsed_issued_by NVARCHAR(255) NULL,
    parsed_issued_date DATE NULL,
    parsed_holder_name NVARCHAR(255) NULL,
    parsed_grade_or_level NVARCHAR(100) NULL,
    parsed_certificate_code NVARCHAR(120) NULL,
    ai_detected_service NVARCHAR(120) NULL,
    variant_ids_json NVARCHAR(MAX) NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    FOREIGN KEY (tasker_id) REFERENCES Taskers(tasker_id),
    FOREIGN KEY (service_id) REFERENCES Services(service_id),
    FOREIGN KEY (verified_by) REFERENCES Users(user_id),
    CONSTRAINT CHK_tasker_cert_status CHECK (status IN ('Pending','Approved','Rejected'))
);
GO

-- Bookings (không có FK contract_id trước)
CREATE TABLE Bookings (
    booking_id INT IDENTITY(1,1) PRIMARY KEY,
    customer_id INT NULL,
    tasker_id INT NULL,
    service_id INT NULL,
    variant_id INT NULL,
    contract_id INT NULL,
    booking_time DATETIME2(7) NULL DEFAULT GETDATE(),
    start_time DATETIME2(7) NULL,
    end_time DATETIME2(7) NULL,
    location NVARCHAR(255) NULL,
    status NVARCHAR(20) NULL,
    type NVARCHAR(20) NULL,
    work_type NVARCHAR(10) NULL,
    shared BIT NULL DEFAULT 0,
    base_price DECIMAL(10,2) NOT NULL DEFAULT 0,
    surcharge DECIMAL(10,2) NOT NULL DEFAULT 0,
    final_price AS (base_price + surcharge),
    points_earned INT NULL,
    expected_price DECIMAL(12,2) NULL,
    CONSTRAINT FK_Bookings_customer FOREIGN KEY (customer_id) REFERENCES Users(user_id),
    CONSTRAINT FK_Bookings_tasker FOREIGN KEY (tasker_id) REFERENCES Taskers(tasker_id),
    CONSTRAINT FK_Bookings_service FOREIGN KEY (service_id) REFERENCES Services(service_id),
    CONSTRAINT FK_Bookings_variant FOREIGN KEY (variant_id) REFERENCES ServiceVariants(variant_id),
    CONSTRAINT CHK_booking_status CHECK (status IN (N'Chờ xử lý', N'Đã chấp nhận', N'Đang tiến hành', N'Hoàn thành', N'Hủy', N'Đã thanh toán')),
    CONSTRAINT CHK_booking_type CHECK (type IN ('Home','Office','Other'))
);
GO

-- Contracts
CREATE TABLE Contracts (
    contract_id INT PRIMARY KEY,
    booking_id INT,
    customer_id INT,
    tasker_id INT,
    terms NVARCHAR(MAX) NOT NULL,
    customer_signature_url NVARCHAR(255),
    tasker_signature_url NVARCHAR(255),
    start_date DATETIME2 NOT NULL,
    end_date DATETIME2 NOT NULL,
    status NVARCHAR(20) DEFAULT N'Chờ ký',
    created_at DATETIME2 DEFAULT GETDATE(),
    signed_at DATETIME2,
    CONSTRAINT FK_Contracts_Wishlist FOREIGN KEY (customer_id) REFERENCES Wishlist(customer_id),
    CONSTRAINT FK_Contracts_Taskers FOREIGN KEY (tasker_id) REFERENCES Taskers(tasker_id),
    CONSTRAINT CHK_contract_status CHECK (status IN (N'Chờ ký', N'Đã ký', N'Hủy', N'Hết hạn'))
);
GO

-- Thêm FK vòng
ALTER TABLE Contracts 
ADD CONSTRAINT FK_Contracts_Bookings 
FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id);
GO

ALTER TABLE Bookings 
ADD CONSTRAINT FK_Bookings_contract 
FOREIGN KEY (contract_id) REFERENCES Contracts(contract_id);
GO

-- Transactions
CREATE TABLE [dbo].[Transactions](
    [id] [bigint] IDENTITY(1,1) NOT NULL,
    [order_id] [nvarchar](255) NOT NULL,
    [request_id] [nvarchar](255) NULL,
    [user_id] [int] NULL,
    [provider] [nvarchar](100) NULL,
    [amount] [bigint] NOT NULL,
    [currency] [nvarchar](10) NOT NULL DEFAULT 'VND',
    [status] [nvarchar](50) NOT NULL,
    [trans_id] [nvarchar](255) NULL,
    [pay_type] [nvarchar](100) NULL,
    [message] [nvarchar](1000) NULL,
    [result_code] [int] NULL,
    [extra_data] [nvarchar](max) NULL,
    [signature] [nvarchar](500) NULL,
    [created_at] [datetime2](7) NOT NULL DEFAULT (sysutcdatetime()),
    [updated_at] [datetime2](7) NULL,
    [paid_at] [datetime2](7) NULL,
    PRIMARY KEY CLUSTERED ([id] ASC)
);
GO

ALTER TABLE [dbo].[Transactions] 
ADD CONSTRAINT [FK_Transactions_Users] 
FOREIGN KEY([user_id]) REFERENCES [dbo].[Users] ([user_id]);
GO

-- WalletTransactions
CREATE TABLE [dbo].[WalletTransactions](
    [id] [int] IDENTITY(1,1) NOT NULL,
    [user_id] [int] NOT NULL,
    [amount] [bigint] NOT NULL,
    [type] [nvarchar](50) NOT NULL,
    [purpose] [nvarchar](255) NULL,
    [related_id] [nvarchar](255) NULL,
    [note] [nvarchar](1000) NULL,
    [created_at] [datetime2](7) NOT NULL DEFAULT (sysutcdatetime()),
    PRIMARY KEY CLUSTERED ([id] ASC)
);
GO

ALTER TABLE [dbo].[WalletTransactions] 
ADD CONSTRAINT [FK_WalletTransactions_Users] 
FOREIGN KEY([user_id]) REFERENCES [dbo].[Users] ([user_id]);
GO

-- Tasks
CREATE TABLE Tasks (
    task_id INT IDENTITY(1,1) PRIMARY KEY,
    booking_id INT,
    description NVARCHAR(MAX),
    checklist NVARCHAR(MAX),
    photos NVARCHAR(MAX) NULL,
    completed BIT DEFAULT 0,
    CONSTRAINT FK_Tasks_Bookings FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id) ON DELETE CASCADE,
    CONSTRAINT UQ_Tasks_Booking UNIQUE (booking_id)
);
GO

-- TaskPhotos
CREATE TABLE TaskPhotos (
    photo_id INT NOT NULL PRIMARY KEY CLUSTERED,
    task_id INT NOT NULL,
    photo_url NVARCHAR(MAX) NULL,
    photo_type NVARCHAR(20) NULL,
    uploaded_at DATETIME2(7) NULL,
    uploaded_by INT NULL,
    CONSTRAINT FK_TaskPhotos_Tasks FOREIGN KEY (task_id) REFERENCES Tasks(task_id) ON DELETE CASCADE,
    CONSTRAINT FK_TaskPhotos_upload_by FOREIGN KEY (uploaded_by) REFERENCES Users(user_id),
    CONSTRAINT CHK_photo_type CHECK (photo_type IN ('Before', 'After', 'Evidence'))
);
GO

ALTER TABLE TaskPhotos 
ADD CONSTRAINT DF_TaskPhoto_uplo_at_02084FDA 
DEFAULT (SYSDATETIME()) FOR uploaded_at;
GO

-- Payments
CREATE TABLE Payments (
    payment_id INT PRIMARY KEY,
    booking_id INT,
    amount DECIMAL(10,2) NOT NULL,
    payment_method NVARCHAR(50) NOT NULL,
    payment_date DATETIME2 DEFAULT GETDATE(),
    status NVARCHAR(20) DEFAULT N'Chờ xử lý',
    CONSTRAINT FK_Payments_Bookings FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id),
    CONSTRAINT CHK_payment_method CHECK (payment_method IN (N'Tiền mặt', N'Ngân hàng', N'Ví điện tử')),
    CONSTRAINT CHK_payment_status CHECK (status IN (N'Chờ xử lý', N'Hoàn thành', N'Thất bại'))
);
GO

-- Ratings
CREATE TABLE dbo.Ratings (
    rating_id INT IDENTITY(1,1) PRIMARY KEY,
    booking_id INT NULL,
    reviewer_id INT NULL,
    reviewee_id INT NULL,
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment NVARCHAR(MAX) NULL,
    created_at DATETIME2(7) DEFAULT SYSDATETIME(),
    status NVARCHAR(10) CHECK (status IN (N'0', N'1', N'2')),
    helpful INT NOT NULL DEFAULT 0,
    staff_reply NVARCHAR(MAX) NULL,
    staff_reply_date DATETIME2(7) NULL,
    UNIQUE (booking_id, reviewer_id),
    CONSTRAINT FK_Ratings_Bookings FOREIGN KEY (booking_id) REFERENCES dbo.Bookings(booking_id),
    CONSTRAINT FK_Ratings_Reviewer FOREIGN KEY (reviewer_id) REFERENCES dbo.Users(user_id),
    CONSTRAINT FK_Ratings_Reviewee FOREIGN KEY (reviewee_id) REFERENCES dbo.Users(user_id)
);
GO

-- RatingHelpful
CREATE TABLE RatingHelpful (
    helpful_id INT IDENTITY(1,1) PRIMARY KEY,
    rating_id INT NOT NULL,
    user_id INT NOT NULL,
    created_at DATETIME DEFAULT GETDATE(),
    CONSTRAINT FK_RatingHelpful_Rating FOREIGN KEY (rating_id) REFERENCES Ratings(rating_id) ON DELETE CASCADE,
    CONSTRAINT FK_RatingHelpful_User FOREIGN KEY (user_id) REFERENCES Users(user_id),
    CONSTRAINT UQ_RatingHelpful UNIQUE (rating_id, user_id)
);
GO

-- Posts
CREATE TABLE Posts (
    post_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL,
    title NVARCHAR(255) NOT NULL,
    content NVARCHAR(MAX) NOT NULL,
    related_booking_id INT,
    post_date DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    status VARCHAR(50) NOT NULL DEFAULT 'Pending',
    photo_urls NVARCHAR(MAX),
    likes INT NOT NULL DEFAULT 0,
    comments_count INT NOT NULL DEFAULT 0,
    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_Posts_Users FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    CONSTRAINT FK_Posts_Bookings FOREIGN KEY (related_booking_id) REFERENCES Bookings(booking_id) ON DELETE SET NULL
);
GO

-- PostLikes
CREATE TABLE PostLikes (
    post_like_id INT PRIMARY KEY,
    post_id INT,
    user_id INT,
    liked_at DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_PostLikes_Posts FOREIGN KEY (post_id) REFERENCES Posts(post_id),
    CONSTRAINT FK_PostLikes_Users FOREIGN KEY (user_id) REFERENCES Users(user_id),
    UNIQUE (post_id, user_id)
);
GO

-- Videos
CREATE TABLE Videos (
    video_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT,
    title NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX),
    video_url NVARCHAR(500) NOT NULL,
    public_id NVARCHAR(255),
    likes INT DEFAULT 0,
    status NVARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
    uploaded_at DATETIME2 DEFAULT GETDATE(),
    is_deleted BIT DEFAULT 0,
    text_moderation_status NVARCHAR(20) NULL DEFAULT 'PENDING'
        CONSTRAINT CHK_Videos_TextModerationStatus CHECK (text_moderation_status IN ('GOOD', 'BAD', 'PENDING')),
    text_moderation_reason NVARCHAR(MAX) NULL,
    CONSTRAINT FK_Videos_Users FOREIGN KEY (user_id) REFERENCES Users(user_id)
);
GO

-- VideoModerations
CREATE TABLE VideoModerations (
    mod_id INT IDENTITY(1,1) PRIMARY KEY,
    video_id INT NOT NULL,
    moderated_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    is_safe BIT NOT NULL,
    nudity_score DECIMAL(5,4) NULL,
    weapon_score DECIMAL(5,4) NULL,
    violence_score DECIMAL(5,4) NULL,
    offensive_score DECIMAL(5,4) NULL,
    raw_response NVARCHAR(MAX) NULL,
    rejection_reason NVARCHAR(MAX) NULL,
    CONSTRAINT FK_VideoModerations_Videos FOREIGN KEY (video_id) REFERENCES Videos(video_id) ON DELETE CASCADE
);
GO

CREATE INDEX IX_VideoModerations_VideoID ON VideoModerations(video_id);
GO

-- Comments
CREATE TABLE Comments (
    comment_id INT IDENTITY(1,1) PRIMARY KEY,
    post_id INT,
    video_id INT,
    user_id INT NOT NULL,
    parent_comment_id INT,
    content NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_Comments_Posts FOREIGN KEY (post_id) REFERENCES Posts(post_id),
    CONSTRAINT FK_Comments_Videos FOREIGN KEY (video_id) REFERENCES Videos(video_id),
    CONSTRAINT FK_Comments_Users FOREIGN KEY (user_id) REFERENCES Users(user_id),
    CONSTRAINT FK_Comments_Parent FOREIGN KEY (parent_comment_id) REFERENCES Comments(comment_id)
);
GO

-- PostServices
CREATE TABLE PostServices (
    post_service_id INT PRIMARY KEY,
    post_id INT,
    service_id INT,
    variant_id INT,
    desired_price DECIMAL(10,2),
    notes NVARCHAR(MAX),
    CONSTRAINT FK_PostServices_Posts FOREIGN KEY (post_id) REFERENCES Posts(post_id),
    CONSTRAINT FK_PostServices_Services FOREIGN KEY (service_id) REFERENCES Services(service_id),
    CONSTRAINT FK_PostServices_Variants FOREIGN KEY (variant_id) REFERENCES ServiceVariants(variant_id)
);
GO

-- Quotes
CREATE TABLE Quotes (
    quote_id INT PRIMARY KEY,
    post_id INT,
    tasker_id INT,
    variant_id INT,
    proposed_price DECIMAL(10,2) NOT NULL,
    proposal NVARCHAR(MAX),
    status NVARCHAR(20) DEFAULT N'Chờ xử lý',
    sent_at DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_Quotes_Posts FOREIGN KEY (post_id) REFERENCES Posts(post_id),
    CONSTRAINT FK_Quotes_Taskers FOREIGN KEY (tasker_id) REFERENCES Taskers(tasker_id),
    CONSTRAINT FK_Quotes_Variants FOREIGN KEY (variant_id) REFERENCES ServiceVariants(variant_id),
    CONSTRAINT CHK_quote_status CHECK (status IN (N'Chờ xử lý', N'Chấp nhận', N'Từ chối'))
);
GO

-- Conversations
CREATE TABLE Conversations (
    conversation_id INT IDENTITY(1,1) PRIMARY KEY,
    title NVARCHAR(255),
    type NVARCHAR(50),
    created_by INT NOT NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    updated_at DATETIME2,
    last_message_at DATETIME2,
    is_active BIT DEFAULT 1,
    CONSTRAINT FK_Conversations_Users FOREIGN KEY (created_by) REFERENCES Users(user_id)
);
GO

-- Messages
CREATE TABLE Messages (
    message_id INT IDENTITY(1,1) PRIMARY KEY,
    sender_id INT NOT NULL,
    conversation_id INT NOT NULL,
    content NVARCHAR(MAX),
    message_type NVARCHAR(50),
    file_url NVARCHAR(255),
    file_name NVARCHAR(255),
    file_size INT,
    created_at DATETIME2 DEFAULT GETDATE(),
    updated_at DATETIME2,
    is_edited BIT DEFAULT 0,
    is_deleted BIT DEFAULT 0,
    deleted_at DATETIME2,
    CONSTRAINT FK_Messages_Users FOREIGN KEY (sender_id) REFERENCES Users(user_id),
    CONSTRAINT FK_Messages_Conversations FOREIGN KEY (conversation_id) REFERENCES Conversations(conversation_id)
);
GO

-- ConversationParticipants
CREATE TABLE ConversationParticipants (
    participant_id INT IDENTITY(1,1) PRIMARY KEY,
    conversation_id INT NOT NULL,
    user_id INT NOT NULL,
    joined_at DATETIME2 DEFAULT GETDATE(),
    left_at DATETIME2,
    role NVARCHAR(50),
    is_active BIT DEFAULT 1,
    last_read_at DATETIME2,
    CONSTRAINT FK_ConversationParticipants_Conversations FOREIGN KEY (conversation_id) REFERENCES Conversations(conversation_id),
    CONSTRAINT FK_ConversationParticipants_Users FOREIGN KEY (user_id) REFERENCES Users(user_id),
    UNIQUE (conversation_id, user_id)
);
GO

-- UserPoints
CREATE TABLE UserPoints (
    point_id INT PRIMARY KEY,
    user_id INT,
    points INT DEFAULT 0,
    total_booking_amount DECIMAL(10,2) DEFAULT 0,
    last_updated DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_UserPoints_Users FOREIGN KEY (user_id) REFERENCES Users(user_id)
);
GO

-- PointMilestones
CREATE TABLE PointMilestones (
    milestone_id INT PRIMARY KEY,
    points_required INT NOT NULL,
    customer_discount_percent DECIMAL(5,2),
    tasker_commission_increase_percent DECIMAL(5,2),
    description NVARCHAR(255)
);
GO

-- Badges
CREATE TABLE Badges (
    badge_id INT PRIMARY KEY IDENTITY(1,1),
    name NVARCHAR(100) NOT NULL,
    description NVARCHAR(500) NOT NULL,
    icon_url VARCHAR(255),
    criteria_key VARCHAR(50) NOT NULL, 
    criteria_value DECIMAL(10, 2) NOT NULL DEFAULT 0,
    is_active BIT NOT NULL DEFAULT 1
);

GO

-- UserBadges
CREATE TABLE UserBadges (
    user_badge_id BIGINT PRIMARY KEY IDENTITY(1,1),
    user_id INT NOT NULL, 
    badge_id INT NOT NULL, 
    earned_at DATETIME NOT NULL DEFAULT GETDATE(),
    FOREIGN KEY (user_id) REFERENCES Users(user_id),
    FOREIGN KEY (badge_id) REFERENCES Badges(badge_id),
    -- Đảm bảo 1 người chỉ nhận 1 loại huy hiệu 1 lần
    CONSTRAINT UQ_User_Badge UNIQUE (user_id, badge_id) 
);
GO

-- cccd_verification
CREATE TABLE cccd_verification (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL,
    cccd_number NVARCHAR(20),
    full_name NVARCHAR(255),
    date_of_birth DATE,
    gender NVARCHAR(10),
    nationality NVARCHAR(100),
    place_of_origin NVARCHAR(500),
    place_of_residence NVARCHAR(500),
    issued_date DATE,
    expiry_date DATE,
    front_image_path NVARCHAR(500),
    back_image_path NVARCHAR(500),
    face_image_path NVARCHAR(500),
    ocr_text_front NTEXT,
    ocr_text_back NTEXT,
    ocr_accuracy DECIMAL(5,2) DEFAULT 0.0,
    verification_status NVARCHAR(20) DEFAULT 'Pending',
    verified_at DATETIME,
    verified_by INT,
    is_deleted BIT DEFAULT 0,
    created_at DATETIME DEFAULT GETDATE(),
    updated_at DATETIME DEFAULT GETDATE(),
    CONSTRAINT FK_cccd_verification_Users FOREIGN KEY (user_id) REFERENCES Users(user_id),
    CONSTRAINT FK_cccd_verification_VerifiedBy FOREIGN KEY (verified_by) REFERENCES Users(user_id)
);
GO

-- Notifications
CREATE TABLE Notifications (
    notification_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL,
    title NVARCHAR(255) NOT NULL,
    content NVARCHAR(MAX),
    type NVARCHAR(50) NOT NULL,
    data NVARCHAR(MAX),
    is_read BIT NOT NULL DEFAULT 0,
    read_at DATETIME2,
    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    expires_at DATETIME2,
    CONSTRAINT FK_Notifications_Users FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    CONSTRAINT CHK_notification_type CHECK (type IN (N'Message', N'Booking', N'Payment', N'Review'))
);
GO
-- Chèn dữ liệu mẫu
DECLARE @UserID_An INT, @UserID_Hieu INT, @UserID_Cuong INT, @UserID_Dung INT, @UserID_Nam INT, @UserID_Staff INT;
DECLARE @BookingID_1 INT, @BookingID_2 INT;
DECLARE @TaskID_1 INT, @TaskID_2 INT;
DECLARE @ConversationID INT;

-- Users
INSERT INTO Users (name, email, password, role, phone, cccd_url, cccd_status, cccd_uploaded_at, cccd_verified_at, cccd_verified_by, created_at, updated_at)
VALUES
(N'Nguyễn Văn An', 'an.nguyen@email.com', '$2a$12$JkUS4EaDSFbUnUWcLvJNo.hmpmOlPBt6qd24aGhwL3BNTjPszP85e', 'Tasker', '0901234567', 'cccd/nguyen_van_an.jpg', 'Đã xác minh', '2025-09-01 10:00:00', '2025-09-02 15:00:00', NULL, '2025-09-01 10:00:00', '2025-09-01 10:00:00');
SET @UserID_An = SCOPE_IDENTITY();

INSERT INTO Users (name, email, password, role, phone, cccd_url, cccd_status, cccd_uploaded_at, cccd_verified_at, cccd_verified_by, created_at, updated_at)
VALUES
(N'NGUYỄN THANH HIẾU', 'binh.tran@email.com', '$2a$12$JkUS4EaDSFbUnUWcLvJNo.hmpmOlPBt6qd24aGhwL3BNTjPszP85e', 'Tasker', '0912345678', 'https://res.cloudinary.com/dgkkdyrug/image/upload/v1759311794/homehelper/cccd/2/wlwntblvpjdsthbk7w2s.jpg', 'Đã xác minh', '2025-09-03 09:00:00', '2025-10-01 16:41:17.6166667', NULL, '2025-09-03 09:00:00', '2025-10-01 16:41:17.6166667');
SET @UserID_Hieu = SCOPE_IDENTITY();

INSERT INTO Users (name, email, password, role, phone, cccd_url, cccd_status, cccd_uploaded_at, cccd_verified_at, cccd_verified_by, created_at, updated_at)
VALUES
(N'Lê Văn Cường', 'cuong.le@email.com', '$2a$12$JkUS4EaDSFbUnUWcLvJNo.hmpmOlPBt6qd24aGhwL3BNTjPszP85e', 'Tasker', '0923456789', 'cccd/le_van_cuong.jpg', 'Đã xác minh', '2025-09-02 12:00:00', '2025-09-03 14:00:00', @UserID_An, '2025-09-02 12:00:00', '2025-09-02 12:00:00');
SET @UserID_Cuong = SCOPE_IDENTITY();

INSERT INTO Users (name, email, password, role, phone, cccd_url, cccd_status, cccd_uploaded_at, cccd_verified_at, cccd_verified_by, created_at, updated_at)
VALUES
(N'Phạm Thị Dung', 'dung.pham@email.com', '$2a$12$JkUS4EaDSFbUnUWcLvJNo.hmpmOlPBt6qd24aGhwL3BNTjPszP85e', 'Customer', '0934567890', NULL, NULL, NULL, NULL, NULL, '2025-09-01 08:00:00', '2025-09-01 08:00:00');
SET @UserID_Dung = SCOPE_IDENTITY();

INSERT INTO Users (name, email, password, role, phone, cccd_url, cccd_status, cccd_uploaded_at, cccd_verified_at, cccd_verified_by, created_at, updated_at)
VALUES
(N'Hoàng Văn Nam', 'nam.hoang@email.com', '$2a$12$JkUS4EaDSFbUnUWcLvJNo.hmpmOlPBt6qd24aGhwL3BNTjPszP85e', 'Admin', '0945678901', NULL, NULL, NULL, NULL, NULL, '2025-09-01 08:00:00', '2025-09-01 08:00:00');
SET @UserID_Nam = SCOPE_IDENTITY();

INSERT INTO Users (name, email, password, role, phone, cccd_url, cccd_status, cccd_uploaded_at, cccd_verified_at, cccd_verified_by, created_at, updated_at)
VALUES
(N'Staff Kiểm Duyệt', 'staff.review@email.com', '$2a$12$JkUS4EaDSFbUnUWcLvJNo.hmpmOlPBt6qd24aGhwL3BNTjPszP85e', 'Staff', '0987654321', NULL, NULL, NULL, NULL, NULL, '2025-09-05 08:00:00', '2025-09-05 08:00:00');
SET @UserID_Staff = SCOPE_IDENTITY();

-- Addresses
INSERT INTO Addresses (user_id, address, lat, lng, created_at, updated_at)
VALUES
(@UserID_Dung, N'213 Hoài Thanh, Phường Mỹ An, Quận Ngũ Hành Sơn, Thành Phố Đà Nẵng', 16.045189, 108.241212, '2025-09-01 08:00:00', '2025-09-01 08:00:00'),
(@UserID_An, N'456 Nguyễn Huệ, TP Huế', 16.467890, 107.579123, '2025-09-02 09:00:00', '2025-09-02 09:00:00'),
(@UserID_Cuong, N'3 Phan Tứ, Phường Ngũ Hành Sơn, Thành Phố Đà Nẵng', 16.045189, 108.241212, '2025-09-09 21:04:20', '2025-09-09 21:04:20');

-- Taskers
INSERT INTO Taskers (tasker_id, Introduce, certifications, status, rating)
VALUES
(@UserID_An, N'Nấu ăn gia đình, dọn dẹp', N'Chứng chỉ nấu ăn cơ bản', 'Active', 4.50),
(@UserID_Hieu, N'Dọn dẹp, chăm sóc trẻ em, chăm sóc người già', N'Chứng chỉ chăm sóc trẻ em và người già', 'Inactive', 4.20),
(@UserID_Cuong, N'Nấu ăn, chăm sóc trẻ em, vệ sinh điều hòa', N'Chứng chỉ nấu ăn nâng cao và bảo trì điều hòa', 'Active', 4.80);

-- Wishlist
INSERT INTO Wishlist (customer_id, favorite_taskers)
VALUES
(@UserID_Hieu, N'[]'),
(@UserID_Dung, N'[' + CAST(@UserID_An AS NVARCHAR) + N',' + CAST(@UserID_Cuong AS NVARCHAR) + N']');

-- Services
INSERT INTO Services (service_id, name, description, requires_certificate)
VALUES
(1, N'Nấu ăn', N'Dịch vụ nấu ăn gia đình, bao gồm chuẩn bị bữa sáng, trưa, tối', 1),
(2, N'Dọn dẹp nhà cửa', N'Dịch vụ dọn dẹp nhà cửa theo giờ, bao gồm lau chùi và giặt giũ', 0),
(3, N'Giúp việc định kỳ', N'Dịch vụ giúp việc theo gói tuần hoặc tháng', 0),
(4, N'Chăm sóc người già và bệnh nhân', N'Dịch vụ chăm sóc người già hoặc bệnh nhân, theo ngày hoặc tháng', 1),
(5, N'Vệ sinh sofa, nệm, thảm, rèm', N'Dịch vụ vệ sinh sofa, nệm, thảm và rèm với giá tùy loại chất liệu', 0),
(6, N'Vệ sinh điều hòa', N'Dịch vụ vệ sinh điều hòa, bao gồm dàn nóng, dàn lạnh và kiểm tra gas', 1),
(7, N'Tổng vệ sinh', N'Dịch vụ tổng vệ sinh cho doanh nghiệp lớn, tính theo mét vuông', 0),
(8, N'Chăm sóc trẻ em', N'Dịch vụ chăm sóc trẻ em, bao gồm hỗ trợ học tập và vui chơi, theo ngày hoặc tháng', 1);

-- ServiceVariants
INSERT INTO ServiceVariants (variant_id, service_id, variant_name, pricing_type, price_min, price_max, unit)
VALUES
(1, 1, N'Nấu ăn cho 2-3 người, 2-3 món', N'Theo giờ', 140.00, 150.00, N'Giờ'),
(2, 1, N'Nấu ăn cho 5-8 người, 2-3 món', N'Theo giờ', 170.00, 180.00, N'Giờ'),
(3, 2, N'Dọn dẹp nhà cửa theo giờ', N'Theo giờ', 80.00, 120.00, N'Giờ'),
(4, 3, N'Gói giúp việc định kì', N'Theo giờ', 400.00, 600.00, N'Tuần'),
(5, 4, N'Chăm sóc người già theo ngày', N'Theo ngày', 500.00, 800.00, N'Ngày'),
(6, 4, N'Chăm sóc người già theo tuần', N'Theo tuần', 4000.00, 5000.00, N'Tuần'),
(7, 4, N'Chăm sóc người già theo tháng', N'Theo tháng', 5000.00, 10000.00, N'Tháng'),
(8, 5, N'Vệ sinh sofa (vải nỉ)', N'Theo chiếc', 150.00, 300.00, N'Chiếc'),
(9, 5, N'Vệ sinh sofa (da)', N'Theo chiếc', 200.00, 500.00, N'Chiếc'),
(10, 5, N'Vệ sinh nệm', N'Theo chiếc', 200.00, 400.00, N'Chiếc'),
(11, 5, N'Vệ sinh thảm', N'Theo m²', 50.00, 100.00, N'Mét vuông'),
(12, 5, N'Vệ sinh rèm', N'Theo chiếc', 100.00, 200.00, N'Chiếc'),
(13, 6, N'Vệ sinh điều hòa treo tường', N'Theo chiếc', 300.00, 400.00, N'Chiếc'),
(14, 6, N'Vệ sinh điều hòa tủ đứng', N'Theo chiếc', 500.00, 600.00, N'Chiếc'),
(15, 6, N'Vệ sinh điều hòa âm trần', N'Theo chiếc', 700.00, 800.00, N'Chiếc'),
(16, 7, N'Tổng vệ sinh cho doanh nghiệp', N'Theo m²', 40.00, 60.00, N'Mét vuông'),
(17, 8, N'Chăm sóc trẻ em theo ngày', N'Theo ngày', 400.00, 600.00, N'Ngày'),
(18, 8, N'Chăm sóc trẻ em theo tuần', N'Theo tuần', 3000.00, 4000.00, N'Tuần'),
(19, 8, N'Chăm sóc trẻ em theo tháng', N'Theo tháng', 4000.00, 8000.00, N'Tháng');

-- TaskerServiceVariants (BỎ tasker_service_variant_id)
INSERT INTO TaskerServiceVariants (tasker_id, variant_id, created_at)
VALUES
(@UserID_An, 1, '2025-09-01 08:00:00'),
(@UserID_An, 3, '2025-09-01 08:00:00'),
(@UserID_Hieu, 3, '2025-09-02 09:00:00'),
(@UserID_Hieu, 6, '2025-09-02 09:00:00'),
(@UserID_Hieu, 19, '2025-09-02 09:00:00'),
(@UserID_Cuong, 2, '2025-09-03 10:00:00'),
(@UserID_Cuong, 14, '2025-09-03 10:00:00'),
(@UserID_Cuong, 19, '2025-09-03 10:00:00');

-- Contracts
INSERT INTO Contracts (contract_id, booking_id, customer_id, tasker_id, terms, customer_signature_url, tasker_signature_url, start_date, end_date, status, created_at, signed_at)
VALUES
(1, NULL, @UserID_Dung, @UserID_Hieu, N'Hợp đồng chăm sóc người già theo tháng, làm việc 8h/ngày', NULL, NULL, '2025-10-01 00:00:00', '2025-10-31 23:59:59', N'Chờ ký', '2025-09-05 10:00:00', NULL);

-- Bookings
INSERT INTO Bookings (customer_id, tasker_id, service_id, variant_id, booking_time, start_time, end_time, location, status, type, shared, work_type, base_price, surcharge, points_earned, contract_id, expected_price)
VALUES
(@UserID_Dung, @UserID_An, 1, 1, '2025-09-05 09:00:00', '2025-09-06 08:00:00', '2025-09-06 10:00:00', N'213 Hoài Thanh, Phường Mỹ An, Quận Ngũ Hành Sơn, Thành Phố Đà Nẵng', N'Chờ xử lý', N'Home', 0, NULL, 150.00, 0.00, 10, NULL, 150.00);
SET @BookingID_1 = SCOPE_IDENTITY();

INSERT INTO Bookings (customer_id, tasker_id, service_id, variant_id, booking_time, start_time, end_time, location, status, type, shared, work_type, base_price, surcharge, points_earned, contract_id, expected_price)
VALUES
(@UserID_Dung, @UserID_Hieu, 4, 7, '2025-09-05 10:00:00', '2025-10-01 08:00:00', '2025-10-31 17:00:00', N'213 Hoài Thanh, Phường Mỹ An, Quận Ngũ Hành Sơn, Thành Phố Đà Nẵng', N'Chờ xử lý', N'Home', 0, NULL, 6000.00, 0.00, 50, 1, 6000.00);
SET @BookingID_2 = SCOPE_IDENTITY();

-- Cập nhật contract_id trong bảng Contracts
UPDATE Contracts
SET booking_id = @BookingID_2
WHERE contract_id = 1;

-- Tasks (sử dụng IDENTITY cho task_id)
INSERT INTO Tasks (booking_id, description, checklist, photos, completed)
VALUES
(@BookingID_1, N'Nấu bữa trưa cho 3 người', N'- Chuẩn bị nguyên liệu\n- Nấu 3 món\n- Dọn dẹp bếp', N'["https://res.cloudinary.com/dgkkdyrug/image/upload/v1759311821/homehelper/task_photos/before.jpg","https://res.cloudinary.com/dgkkdyrug/image/upload/v1759311821/homehelper/task_photos/after.jpg","https://res.cloudinary.com/dgkkdyrug/image/upload/v1759311821/homehelper/task_photos/evidence.jpg"]', 0);
SET @TaskID_1 = SCOPE_IDENTITY();

INSERT INTO Tasks (booking_id, description, checklist, photos, completed)
VALUES
(@BookingID_2, N'Chăm sóc người già hàng ngày', N'- Hỗ trợ ăn uống\n- Theo dõi sức khỏe', N'[]', 0);
SET @TaskID_2 = SCOPE_IDENTITY();

-- TaskPhotos (sử dụng task_id từ Tasks)
INSERT INTO TaskPhotos (photo_id, task_id, photo_url, photo_type, uploaded_at, uploaded_by)
VALUES
(1, @TaskID_1, N'https://res.cloudinary.com/dgkkdyrug/image/upload/v1759311821/homehelper/task_photos/before.jpg', 'Before', '2025-09-06 07:30:00', @UserID_An),
(2, @TaskID_1, N'https://res.cloudinary.com/dgkkdyrug/image/upload/v1759311821/homehelper/task_photos/after.jpg', 'After', '2025-09-06 10:30:00', @UserID_An),
(3, @TaskID_1, N'https://res.cloudinary.com/dgkkdyrug/image/upload/v1759311821/homehelper/task_photos/evidence.jpg', 'Evidence', '2025-09-06 10:45:00', @UserID_An);

-- Payments
INSERT INTO Payments (payment_id, booking_id, amount, payment_method, payment_date, status)
VALUES
(1, @BookingID_1, 150.00, N'Tiền mặt', '2025-09-06 11:00:00', N'Chờ xử lý');



-- Posts
INSERT INTO Posts (user_id, title, content, related_booking_id, post_date, status, photo_urls, likes, comments_count, created_at, updated_at)
VALUES
(@UserID_An, N'Looking for a cleaner for the weekend', N'I need someone to clean my house this weekend. 3 bedrooms, 2 bathrooms. Reasonable price please.', NULL, '2025-10-01 16:27:09.1494776', 'Approved', N'["/images/house1.jpg", "/images/house2.jpg"]', 4, 2, '2025-10-01 16:27:09.1494776', '2025-10-01 16:27:09.1494776'),
(@UserID_Hieu, N'Tutor needed for Math', N'I am looking for an experienced math tutor for high school level. 2 sessions per week.', @BookingID_1, '2025-10-01 16:27:09.1494776', 'Pending', N'["/images/math.jpg"]', 0, 0, '2025-10-01 16:27:09.1494776', '2025-10-01 16:27:09.1494776'),
(@UserID_Cuong, N'Gardening service required', N'Looking for someone to take care of my small garden. Tasks include watering plants and trimming bushes.', NULL, '2025-10-01 16:27:09.1494776', 'Rejected', NULL, 1, 0, '2025-10-01 16:27:09.1494776', '2025-10-01 16:27:09.1494776'),
(@UserID_Hieu, N'shibaaaa', N'<p>hahahaha</p>', NULL, '2025-10-01 16:41:56.3800916', 'Pending', N'["https://res.cloudinary.com/dgkkdyrug/image/upload/v1759311821/homehelper/posts/2/rwopeesm0g2kjvawfjbs.jpg","https://res.cloudinary.com/dgkkdyrug/image/upload/v1759311821/homehelper/posts/2/oxkqrqmloi6xdtze0ith.webp"]', 0, 0, '2025-10-01 16:41:56.3766667', '2025-10-01 16:41:56.3766667');

-- PostLikes
INSERT INTO PostLikes (post_like_id, post_id, user_id, liked_at)
VALUES
(1, 1, @UserID_An, '2025-09-04 09:00:00'),
(2, 1, @UserID_Hieu, '2025-09-04 09:30:00');


-- Comments
INSERT INTO Comments (post_id, video_id, user_id, parent_comment_id, content, created_at)
VALUES
(1, NULL, @UserID_Hieu, NULL, N'hihi', '2025-10-01 16:48:03.163'),
(2, NULL, @UserID_Hieu, 1, N'nice', '2025-10-01 16:48:20.143');

-- PostServices
INSERT INTO PostServices (post_service_id, post_id, service_id, variant_id, desired_price, notes)
VALUES
(1, 1, 2, 3, 100.00, N'Dọn dẹp toàn bộ nhà 50m²'),
(2, 4, 3, 5, 1600.00, N'hhhh');

-- Quotes
INSERT INTO Quotes (quote_id, post_id, tasker_id, variant_id, proposed_price, proposal, status, sent_at)
VALUES
(1, 1, @UserID_An, 3, 120.00, N'Tôi có thể dọn dẹp nhà bạn trong 2 giờ', N'Chờ xử lý', '2025-09-04 09:15:00');



INSERT INTO Conversations (title, type, created_by, created_at, updated_at, last_message_at, is_active)
VALUES
(N'Thảo luận dọn dẹp nhà', N'Nhóm', @UserID_Dung, '2025-09-04 08:30:00', '2025-09-04 09:00:00', '2025-09-04 09:00:00', 1);
SET @ConversationID = SCOPE_IDENTITY();

-- ConversationParticipants
INSERT INTO ConversationParticipants (conversation_id, user_id, joined_at, role, is_active, last_read_at)
VALUES
(@ConversationID, @UserID_Dung, '2025-09-04 08:30:00', N'Customer', 1, '2025-09-04 09:00:00'),
(@ConversationID, @UserID_An, '2025-09-04 08:35:00', N'Tasker', 1, '2025-09-04 09:00:00');

-- Messages
INSERT INTO Messages (sender_id, conversation_id, content, message_type, file_url, file_name, file_size, created_at, updated_at, is_edited, is_deleted, deleted_at)
VALUES
(@UserID_Dung, @ConversationID, N'Chào, bạn có thể dọn nhà vào Chủ nhật không?', N'Text', NULL, NULL, NULL, '2025-09-04 08:40:00', NULL, 0, 0, NULL),
(@UserID_An, @ConversationID, N'Vâng, tôi có thể làm vào sáng Chủ nhật.', N'Text', NULL, NULL, NULL, '2025-09-04 08:45:00', NULL, 0, 0, NULL);

-- UserPoints
INSERT INTO UserPoints (point_id, user_id, points, total_booking_amount, last_updated)
VALUES
(1, @UserID_Dung, 10, 150.00, '2025-09-06 11:00:00');

-- PointMilestones
INSERT INTO PointMilestones (milestone_id, points_required, customer_discount_percent, tasker_commission_increase_percent, description)
VALUES
(1, 50, 5.00, 2.00, N'Khách hàng được giảm 5%, người giúp việc tăng 2% hoa hồng'),
(2, 100, 10.00, 5.00, N'Khách hàng được giảm 10%, người giúp việc tăng 5% hoa hồng');


-- Notifications
INSERT INTO Notifications (user_id, title, content, type, data, is_read, read_at, created_at, expires_at)
VALUES
(@UserID_Hieu, N'Tin nhắn mới từ Thanh Hiếu', N'Xin chào', N'Message', N'{"conversation_id":5,"sender_id":@UserID_An,"type":"message"}', 1, '2025-09-13 00:36:47.9966667', '2025-09-03 18:52:36.4166667', NULL),
(@UserID_Dung, N'Đặt dịch vụ mới', N'Bạn đã đặt dịch vụ nấu ăn thành công!', N'Booking', N'{"booking_id":' + CAST(@BookingID_1 AS NVARCHAR) + N'}', 0, NULL, '2025-09-05 09:10:00', NULL),
(@UserID_An, N'Nhận công việc mới', N'Bạn được giao dịch vụ nấu ăn cho khách hàng Phạm Thị Dung', N'Booking', N'{"booking_id":' + CAST(@BookingID_1 AS NVARCHAR) + N',"customer_name":"Phạm Thị Dung"}', 0, NULL, '2025-09-05 09:15:00', NULL),
(@UserID_Cuong, N'Thanh toán thành công', N'Bạn đã thanh toán dịch vụ dọn dẹp thành công.', N'Payment', N'{"payment_id":2,"amount":500000}', 0, NULL, '2025-09-06 14:20:00', '2025-09-30 23:59:59'),
(@UserID_Hieu, N'Đánh giá mới', N'Bạn nhận được một đánh giá 5 sao từ khách hàng Lê Thị Hoa.', N'Review', N'{"review_id":1,"rating":5}', 0, NULL, '2025-09-07 18:45:00', NULL);




