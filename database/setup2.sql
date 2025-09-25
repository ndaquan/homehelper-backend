
-- Tạo database mới
CREATE DATABASE HomeHelperDB;
GO
USE HomeHelperDB;
GO

-- Xóa các bảng nếu đã tồn tại
IF OBJECT_ID('UserBadges') IS NOT NULL DROP TABLE UserBadges;
IF OBJECT_ID('Badges') IS NOT NULL DROP TABLE Badges;
IF OBJECT_ID('Videos') IS NOT NULL DROP TABLE Videos;
IF OBJECT_ID('PointMilestones') IS NOT NULL DROP TABLE PointMilestones;
IF OBJECT_ID('UserPoints') IS NOT NULL DROP TABLE UserPoints;
IF OBJECT_ID('Messages') IS NOT NULL DROP TABLE Messages;
IF OBJECT_ID('ConversationParticipants') IS NOT NULL DROP TABLE ConversationParticipants;
IF OBJECT_ID('Conversations') IS NOT NULL DROP TABLE Conversations;
IF OBJECT_ID('Contracts') IS NOT NULL DROP TABLE Contracts;
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
IF OBJECT_ID('TaskerServiceVariants') IS NOT NULL DROP TABLE TaskerServiceVariants;
IF OBJECT_ID('ServiceVariants') IS NOT NULL DROP TABLE ServiceVariants;
IF OBJECT_ID('Services') IS NOT NULL DROP TABLE Services;
IF OBJECT_ID('Customers') IS NOT NULL DROP TABLE Customers;
IF OBJECT_ID('Taskers') IS NOT NULL DROP TABLE Taskers;
IF OBJECT_ID('Addresses') IS NOT NULL DROP TABLE Addresses;
IF OBJECT_ID('Users') IS NOT NULL DROP TABLE Users;

-- Tạo bảng Users
CREATE TABLE Users (
    user_id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    email NVARCHAR(255) NOT NULL UNIQUE,
    password NVARCHAR(255) NOT NULL,
    role NVARCHAR(20) NOT NULL CHECK (role IN ('Admin', 'Tasker', 'Customer', 'Guest')),
    phone NVARCHAR(20),
    created_at DATETIME2 DEFAULT GETDATE(),
    updated_at DATETIME2 DEFAULT GETDATE(),
    cccd_url NVARCHAR(255),
    cccd_status NVARCHAR(20) DEFAULT 'Chờ xử lý' CHECK (cccd_status IN ('Chờ xử lý', 'Đã xác minh', 'Bị từ chối')),
    cccd_uploaded_at DATETIME2,
    cccd_verified_at DATETIME2,
    cccd_verified_by INT,
    CONSTRAINT FK_Users_VerifiedBy FOREIGN KEY (cccd_verified_by) REFERENCES Users(user_id)
);

-- Tạo bảng Addresses
CREATE TABLE Addresses (
    address_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT,
    address NVARCHAR(MAX),
    lat DECIMAL(9,6),
    lng DECIMAL(9,6),
    created_at DATETIME2 DEFAULT GETDATE(),
    updated_at DATETIME2 DEFAULT GETDATE(),
    FOREIGN KEY (user_id) REFERENCES Users(user_id)
);

-- Tạo bảng Taskers
CREATE TABLE Taskers (
    tasker_id INT PRIMARY KEY,
    Introduce NVARCHAR(MAX),
    certifications NVARCHAR(MAX),
    status NVARCHAR(20) DEFAULT N'Hoạt động',
    rating DECIMAL(3,2),
    FOREIGN KEY (tasker_id) REFERENCES Users(user_id),
    CONSTRAINT CHK_tasker_status CHECK (status IN (N'Hoạt động', N'Không hoạt động', N'Bị chặn'))
);

-- Tạo bảng
CREATE TABLE Customers (
    customer_id INT PRIMARY KEY,
    favorite_taskers NVARCHAR(MAX),
    FOREIGN KEY (customer_id) REFERENCES Users(user_id)
);

-- Tạo bảng Services
CREATE TABLE Services (
    service_id INT PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX)
);

-- Tạo bảng ServiceVariants
CREATE TABLE ServiceVariants (
    variant_id INT PRIMARY KEY,
    service_id INT,
    variant_name NVARCHAR(255) NOT NULL,
    pricing_type NVARCHAR(50) NOT NULL,
    price_min DECIMAL(10,2),
    price_max DECIMAL(10,2),
    unit NVARCHAR(50),
    specific_price DECIMAL(10,2) NULL,
    FOREIGN KEY (service_id) REFERENCES Services(service_id),
    CONSTRAINT CHK_pricing_type CHECK (pricing_type IN (N'Theo giờ', N'Theo ngày', N'Theo tháng', N'Theo chiếc', N'Theo m²', N'Theo gói'))
);

-- Tạo bảng TaskerServiceVariants
CREATE TABLE TaskerServiceVariants (
    tasker_service_variant_id INT PRIMARY KEY,
    tasker_id INT,
    variant_id INT,
    created_at DATETIME2 DEFAULT GETDATE(),
    FOREIGN KEY (tasker_id) REFERENCES Taskers(tasker_id),
    FOREIGN KEY (variant_id) REFERENCES ServiceVariants(variant_id),
    CONSTRAINT UQ_tasker_variant UNIQUE (tasker_id, variant_id)
);

-- Tạo bảng Contracts
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
    FOREIGN KEY (customer_id) REFERENCES Customers(customer_id),
    FOREIGN KEY (tasker_id) REFERENCES Taskers(tasker_id),
    CONSTRAINT CHK_contract_status CHECK (status IN (N'Chờ ký', N'Đã ký', N'Hủy', N'Hết hạn'))
);

-- Tạo bảng Bookings
CREATE TABLE Bookings (
    booking_id INT PRIMARY KEY,
    customer_id INT,
    tasker_id INT,
    service_id INT,
    variant_id INT,
    booking_time DATETIME2 DEFAULT GETDATE(),
    start_time DATETIME2,
    end_time DATETIME2,
    location NVARCHAR(255),
    status NVARCHAR(20) DEFAULT N'Chờ xử lý',
    type NVARCHAR(20) DEFAULT N'Cơ bản',
    shared BIT DEFAULT 0,
    work_type NVARCHAR(10) NULL, -- 'FULL_TIME' | 'PART_TIME'
    base_price DECIMAL(10,2) NOT NULL DEFAULT (0),
    surcharge DECIMAL(10,2) NOT NULL DEFAULT (0),
    final_price AS (base_price + surcharge) PERSISTED,
    points_earned INT,
    contract_id INT,
    FOREIGN KEY (customer_id) REFERENCES Customers(customer_id),
    FOREIGN KEY (tasker_id) REFERENCES Taskers(tasker_id),
    FOREIGN KEY (service_id) REFERENCES Services(service_id),
    FOREIGN KEY (variant_id) REFERENCES ServiceVariants(variant_id),
    CONSTRAINT CHK_booking_status CHECK (status IN (N'Chờ xử lý', N'Đã chấp nhận', N'Đang tiến hành', N'Hoàn thành', N'Hủy')),
    CONSTRAINT CHK_booking_type CHECK (type IN (N'Cơ bản', N'SOS'))
);

-- Thêm khóa ngoại sau khi cả hai bảng đã được tạo
ALTER TABLE Contracts
ADD CONSTRAINT FK_Contracts_Bookings FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id);

ALTER TABLE Bookings
ADD CONSTRAINT FK_Bookings_Contracts FOREIGN KEY (contract_id) REFERENCES Contracts(contract_id);

-- Tạo bảng Tasks
CREATE TABLE Tasks (
    task_id INT PRIMARY KEY,
    booking_id INT,
    description NVARCHAR(MAX),
    checklist NVARCHAR(MAX),
    completed BIT DEFAULT 0,
    FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id)
);

-- Tạo bảng TaskPhotos
CREATE TABLE TaskPhotos (
    photo_id INT PRIMARY KEY,
    task_id INT,
    photo_url NVARCHAR(255),
    photo_type NVARCHAR(20) NOT NULL,
    uploaded_at DATETIME2 DEFAULT GETDATE(),
    uploaded_by INT,
    FOREIGN KEY (task_id) REFERENCES Tasks(task_id),
    FOREIGN KEY (uploaded_by) REFERENCES Users(user_id),
    CONSTRAINT CHK_photo_type CHECK (photo_type IN (N'Trước', N'Sau'))
);

-- Tạo bảng Payments
CREATE TABLE Payments (
    payment_id INT PRIMARY KEY,
    booking_id INT,
    amount DECIMAL(10,2) NOT NULL,
    payment_method NVARCHAR(50) NOT NULL,
    payment_date DATETIME2 DEFAULT GETDATE(),
    status NVARCHAR(20) DEFAULT N'Chờ xử lý',
    FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id),
    CONSTRAINT CHK_payment_method CHECK (payment_method IN (N'Tiền mặt', N'Ngân hàng', N'Ví điện tử')),
    CONSTRAINT CHK_payment_status CHECK (status IN (N'Chờ xử lý', N'Hoàn thành', N'Thất bại'))
);

-- Tạo bảng Ratings
CREATE TABLE Ratings (
    rating_id INT PRIMARY KEY,
    booking_id INT,
    reviewer_id INT,
    reviewee_id INT,
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment NVARCHAR(MAX),
    created_at DATETIME2 DEFAULT GETDATE(),
    UNIQUE (booking_id, reviewer_id),
    FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id),
    FOREIGN KEY (reviewer_id) REFERENCES Users(user_id),
    FOREIGN KEY (reviewee_id) REFERENCES Users(user_id)
);

CREATE TABLE Posts (
    post_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL,
    title NVARCHAR(255) NOT NULL,
    content NVARCHAR(MAX) NOT NULL,
    related_booking_id INT NULL, -- Đặt dịch vụ được tạo từ bài viết
    post_date DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    status VARCHAR(50) NOT NULL DEFAULT 'Pending',
    photo_urls NVARCHAR(MAX) NULL, -- lưu dạng JSON array
    likes INT NOT NULL DEFAULT 0,
    comments_count INT NOT NULL DEFAULT 0,
    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_Posts_Users FOREIGN KEY (user_id)
        REFERENCES Users(user_id)
        ON DELETE CASCADE,
    CONSTRAINT FK_Posts_Bookings FOREIGN KEY (related_booking_id)
        REFERENCES Bookings(booking_id)
        ON DELETE SET NULL
);

-- Tạo bảng PostLikes
CREATE TABLE PostLikes (
    post_like_id INT PRIMARY KEY,
    post_id INT,
    user_id INT,
    liked_at DATETIME2 DEFAULT GETDATE(),
    FOREIGN KEY (post_id) REFERENCES Posts(post_id),
    FOREIGN KEY (user_id) REFERENCES Users(user_id),
    UNIQUE (post_id, user_id)
);

-- Tạo bảng Comments
CREATE TABLE Comments (
    comment_id INT PRIMARY KEY,
    post_id INT,
    user_id INT,
    parent_comment_id INT,
    content NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    updated_at DATETIME2 DEFAULT GETDATE(),
    FOREIGN KEY (post_id) REFERENCES Posts(post_id),
    FOREIGN KEY (user_id) REFERENCES Users(user_id),
    FOREIGN KEY (parent_comment_id) REFERENCES Comments(comment_id)
);

-- Tạo bảng PostServices
CREATE TABLE PostServices (
    post_service_id INT PRIMARY KEY,
    post_id INT,
    service_id INT,
    variant_id INT NULL,
    desired_price DECIMAL(10,2),
    notes NVARCHAR(MAX),
    FOREIGN KEY (post_id) REFERENCES Posts(post_id),
    FOREIGN KEY (service_id) REFERENCES Services(service_id),
    FOREIGN KEY (variant_id) REFERENCES ServiceVariants(variant_id)
);


-- Tạo bảng Quotes
CREATE TABLE Quotes (
    quote_id INT PRIMARY KEY,
    post_id INT,
    tasker_id INT,
    variant_id INT,
    proposed_price DECIMAL(10,2) NOT NULL,
    proposal NVARCHAR(MAX),
    status NVARCHAR(20) DEFAULT N'Chờ xử lý',
    sent_at DATETIME2 DEFAULT GETDATE(),
    FOREIGN KEY (post_id) REFERENCES Posts(post_id),
    FOREIGN KEY (tasker_id) REFERENCES Taskers(tasker_id),
    FOREIGN KEY (variant_id) REFERENCES ServiceVariants(variant_id),
    CONSTRAINT CHK_quote_status CHECK (status IN (N'Chờ xử lý', N'Chấp nhận', N'Từ chối'))
);

-- Tạo bảng Conversations
CREATE TABLE Conversations (
    conversation_id INT IDENTITY(1,1) PRIMARY KEY,
    title NVARCHAR(255),
    type NVARCHAR(50),
    created_by INT NOT NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    updated_at DATETIME2,
    last_message_at DATETIME2,
    is_active BIT DEFAULT 1,
    FOREIGN KEY (created_by) REFERENCES Users(user_id)
);

-- Tạo bảng Messages
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
    FOREIGN KEY (sender_id) REFERENCES Users(user_id),
    FOREIGN KEY (conversation_id) REFERENCES Conversations(conversation_id)
);

-- Tạo bảng ConversationParticipants
CREATE TABLE ConversationParticipants (
    participant_id INT IDENTITY(1,1) PRIMARY KEY,
    conversation_id INT NOT NULL,
    user_id INT NOT NULL,
    joined_at DATETIME2 DEFAULT GETDATE(),
    left_at DATETIME2,
    role NVARCHAR(50),
    is_active BIT DEFAULT 1,
    last_read_at DATETIME2,
    FOREIGN KEY (conversation_id) REFERENCES Conversations(conversation_id),
    FOREIGN KEY (user_id) REFERENCES Users(user_id),
    UNIQUE (conversation_id, user_id)
);

-- Tạo bảng UserPoints
CREATE TABLE UserPoints (
    point_id INT PRIMARY KEY,
    user_id INT,
    points INT DEFAULT 0,
    total_booking_amount DECIMAL(10,2) DEFAULT 0,
    last_updated DATETIME2 DEFAULT GETDATE(),
    FOREIGN KEY (user_id) REFERENCES Users(user_id)
);

-- Tạo bảng PointMilestones
CREATE TABLE PointMilestones (
    milestone_id INT PRIMARY KEY,
    points_required INT NOT NULL,
    customer_discount_percent DECIMAL(5,2),
    tasker_commission_increase_percent DECIMAL(5,2),
    description NVARCHAR(255)
);

-- Tạo bảng Videos
CREATE TABLE Videos (
    video_id INT PRIMARY KEY,
    user_id INT,
    title NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX),
    video_url NVARCHAR(255) NOT NULL,
    likes INT DEFAULT 0,
    uploaded_at DATETIME2 DEFAULT GETDATE(),
    FOREIGN KEY (user_id) REFERENCES Users(user_id)
);

-- Tạo bảng Badges
CREATE TABLE Badges (
    badge_id INT PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX),
    required_likes INT NOT NULL,
    icon_url NVARCHAR(255)
);

-- Tạo bảng UserBadges
CREATE TABLE UserBadges (
    user_badge_id INT PRIMARY KEY,
    user_id INT,
    badge_id INT,
    awarded_at DATETIME2 DEFAULT GETDATE(),
    FOREIGN KEY (user_id) REFERENCES Users(user_id),
    FOREIGN KEY (badge_id) REFERENCES Badges(badge_id)
);

-- Tạo bảng Notifications
CREATE TABLE Notifications (
    notification_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL,
    title NVARCHAR(255) NOT NULL,
    content NVARCHAR(MAX) NULL,
    type NVARCHAR(50) NOT NULL,
    data NVARCHAR(MAX) NULL,
    is_read BIT NOT NULL DEFAULT 0,
    read_at DATETIME2 NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    expires_at DATETIME2 NULL,
    CONSTRAINT FK_Notifications_Users FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    CONSTRAINT CHK_notification_type CHECK (type IN (N'Message', N'Booking', N'Payment', N'Review'))
);

-- Chèn dữ liệu mẫu
-- Users
DECLARE @UserID_An INT, @UserID_Binh INT, @UserID_Cuong INT, @UserID_Dung INT, @UserID_Nam INT;

INSERT INTO Users (name, email, password, role, phone, cccd_url, cccd_status, cccd_uploaded_at, cccd_verified_at, cccd_verified_by, created_at, updated_at)
VALUES
(N'Nguyễn Văn An', 'an.nguyen@email.com', '$2a$12$JkUS4EaDSFbUnUWcLvJNo.hmpmOlPBt6qd24aGhwL3BNTjPszP85e', 'Tasker', '0901234567', 'cccd/nguyen_van_an.jpg', 'Đã xác minh', '2025-09-01 10:00:00', '2025-09-02 15:00:00', NULL, '2025-09-01 10:00:00', '2025-09-01 10:00:00');
SET @UserID_An = SCOPE_IDENTITY();

INSERT INTO Users (name, email, password, role, phone, cccd_url, cccd_status, cccd_uploaded_at, cccd_verified_at, cccd_verified_by, created_at, updated_at)
VALUES
(N'Trần Thị Bình', 'binh.tran@email.com', '$2a$12$JkUS4EaDSFbUnUWcLvJNo.hmpmOlPBt6qd24aGhwL3BNTjPszP85e', 'Tasker', '0912345678', 'cccd/tran_thi_binh.jpg', 'Chờ xử lý', '2025-09-03 09:00:00', NULL, NULL, '2025-09-03 09:00:00', '2025-09-03 09:00:00');
SET @UserID_Binh = SCOPE_IDENTITY();

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

-- Addresses
INSERT INTO Addresses (user_id, address, lat, lng, created_at, updated_at)
VALUES
(@UserID_Dung, N'213 Hoài Thanh, Phường Mỹ An, Quận Ngũ Hành Sơn, Thành Phố Đà Nẵng', 16.045189, 108.241212, '2025-09-01 08:00:00', '2025-09-01 08:00:00'),
(@UserID_An, N'456 Nguyễn Huệ, TP Huế', 16.467890, 107.579123, '2025-09-02 09:00:00', '2025-09-02 09:00:00'),
(@UserID_Cuong, N'3 Phan Tứ, Phường Ngũ Hành Sơn, Thành Phố Đà Nẵng', 16.045189, 108.241212, '2025-09-09 21:04:20', '2025-09-09 21:04:20');

-- Taskers
INSERT INTO Taskers (tasker_id, introduce, certifications, status, rating)
VALUES
(@UserID_An, N'Nấu ăn gia đình, dọn dẹp', N'Chứng chỉ nấu ăn cơ bản', N'Hoạt động', 4.50),
(@UserID_Binh, N'Dọn dẹp, chăm sóc trẻ em, chăm sóc người già', N'Chứng chỉ chăm sóc trẻ em và người già', N'Hoạt động', 4.20),
(@UserID_Cuong, N'Nấu ăn, chăm sóc trẻ em, vệ sinh điều hòa', N'Chứng chỉ nấu ăn nâng cao và bảo trì điều hòa', N'Hoạt động', 4.80);

-- Customers
INSERT INTO Customers (customer_id, favorite_taskers)
VALUES
(@UserID_Dung, N'[' + CAST(@UserID_An AS NVARCHAR) + N',' + CAST(@UserID_Cuong AS NVARCHAR) + N']');

-- Services
INSERT INTO Services (service_id, name, description)
VALUES
(1, N'Nấu ăn', N'Dịch vụ nấu ăn gia đình, bao gồm chuẩn bị bữa sáng, trưa, tối'),
(2, N'Dọn dẹp nhà cửa', N'Dịch vụ dọn dẹp nhà cửa theo giờ, bao gồm lau chùi và giặt giũ'),
(3, N'Giúp việc định kỳ', N'Dịch vụ giúp việc theo gói tuần hoặc tháng'),
(4, N'Chăm sóc người già và bệnh nhân', N'Dịch vụ chăm sóc người già hoặc bệnh nhân, theo ngày hoặc tháng'),
(5, N'Vệ sinh sofa, nệm, thảm, rèm', N'Dịch vụ vệ sinh sofa, nệm, thảm và rèm với giá tùy loại chất liệu'),
(6, N'Vệ sinh điều hòa', N'Dịch vụ vệ sinh điều hòa, bao gồm dàn nóng, dàn lạnh và kiểm tra gas'),
(7, N'Tổng vệ sinh', N'Dịch vụ tổng vệ sinh cho doanh nghiệp lớn, tính theo mét vuông'),
(8, N'Chăm sóc trẻ em', N'Dịch vụ chăm sóc trẻ em, bao gồm hỗ trợ học tập và vui chơi, theo ngày hoặc tháng');

-- ServiceVariants
INSERT INTO ServiceVariants (variant_id, service_id, variant_name, pricing_type, price_min, price_max, unit, specific_price)
VALUES
(1, 1, N'Nấu ăn cho 2-3 người, 2-3 món', N'Theo giờ', 140.00, 150.00, N'Giờ', 145.00),
(2, 1, N'Nấu ăn cho 5-8 người, 2-3 món', N'Theo giờ', 170.00, 180.00, N'Giờ', 175.00),
(3, 2, N'Dọn dẹp nhà cửa theo giờ', N'Theo giờ', 80.00, 120.00, N'Giờ', 100.00),
(4, 3, N'Gói giúp việc hàng tuần', N'Theo gói', 400.00, 600.00, N'Gói', 500.00),
(5, 3, N'Gói giúp việc hàng tháng', N'Theo gói', 1500.00, 2000.00, N'Gói', 1750.00),
(6, 4, N'Chăm sóc người già theo ngày', N'Theo ngày', 500.00, 800.00, N'Ngày', 650.00),
(7, 4, N'Chăm sóc người già theo tháng', N'Theo tháng', 5000.00, 10000.00, N'Tháng', 7500.00),
(8, 4, N'Chăm sóc người già theo giờ', N'Theo giờ', 120.00, 200.00, N'Giờ', 160.00),
(9, 5, N'Vệ sinh sofa (vải nỉ)', N'Theo chiếc', 150.00, 300.00, N'Chiếc', 225.00),
(10, 5, N'Vệ sinh sofa (da)', N'Theo chiếc', 200.00, 500.00, N'Chiếc', 350.00),
(11, 5, N'Vệ sinh nệm', N'Theo chiếc', 200.00, 400.00, N'Chiếc', 300.00),
(12, 5, N'Vệ sinh thảm', N'Theo m²', 50.00, 100.00, N'Mét vuông', 75.00),
(13, 5, N'Vệ sinh rèm', N'Theo chiếc', 100.00, 200.00, N'Chiếc', 150.00),
(14, 6, N'Vệ sinh điều hòa treo tường', N'Theo chiếc', 300.00, 400.00, N'Chiếc', 350.00),
(15, 6, N'Vệ sinh điều hòa tủ đứng', N'Theo chiếc', 500.00, 600.00, N'Chiếc', 550.00),
(16, 6, N'Vệ sinh điều hòa âm trần', N'Theo chiếc', 700.00, 800.00, N'Chiếc', 750.00),
(17, 7, N'Tổng vệ sinh cho doanh nghiệp', N'Theo m²', 40.00, 60.00, N'Mét vuông', 50.00),
(18, 8, N'Chăm sóc trẻ em theo ngày', N'Theo ngày', 400.00, 600.00, N'Ngày', 500.00),
(19, 8, N'Chăm sóc trẻ em theo tháng', N'Theo tháng', 4000.00, 8000.00, N'Tháng', 6000.00),
(20, 8, N'Chăm sóc trẻ em theo giờ', N'Theo giờ', 100.00, 180.00, N'Giờ', 140.00);

-- TaskerServiceVariants
INSERT INTO TaskerServiceVariants (tasker_service_variant_id, tasker_id, variant_id, created_at)
VALUES
(1, @UserID_An, 1, '2025-09-01 08:00:00'),
(2, @UserID_An, 3, '2025-09-01 08:00:00'),
(3, @UserID_Binh, 3, '2025-09-02 09:00:00'),
(4, @UserID_Binh, 6, '2025-09-02 09:00:00'),
(5, @UserID_Binh, 19, '2025-09-02 09:00:00'),
(6, @UserID_Cuong, 2, '2025-09-03 10:00:00'),
(7, @UserID_Cuong, 14, '2025-09-03 10:00:00'),
(8, @UserID_Cuong, 20, '2025-09-03 10:00:00');

-- Contracts
INSERT INTO Contracts (contract_id, booking_id, customer_id, tasker_id, terms, customer_signature_url, tasker_signature_url, start_date, end_date, status, created_at, signed_at)
VALUES
(1, NULL, @UserID_Dung, @UserID_Binh, N'Hợp đồng chăm sóc người già theo tháng, làm việc 8h/ngày', NULL, NULL, '2025-10-01 00:00:00', '2025-10-31 23:59:59', N'Chờ ký', '2025-09-05 10:00:00', NULL);

-- Bookings
INSERT INTO Bookings (booking_id, customer_id, tasker_id, service_id, variant_id, booking_time, start_time, end_time, location, status, type, shared, total_price, points_earned, contract_id)
VALUES
(1, @UserID_Dung, @UserID_An, 1, 1, '2025-09-05 09:00:00', '2025-09-06 08:00:00', '2025-09-06 10:00:00', N'213 Hoài Thanh, Phường Mỹ An, Quận Ngũ Hành Sơn, Thành Phố Đà Nẵng', N'Chờ xử lý', N'Thông thường', 0, 150.00, 10, NULL),
(2, @UserID_Dung, @UserID_Binh, 4, 7, '2025-09-05 10:00:00', '2025-10-01 08:00:00', '2025-10-31 17:00:00', N'213 Hoài Thanh, Phường Mỹ An, Quận Ngũ Hành Sơn, Thành Phố Đà Nẵng', N'Chờ xử lý', N'Định kỳ', 0, 6000.00, 50, 1);

-- Tasks
INSERT INTO Tasks (task_id, booking_id, description, checklist, completed)
VALUES
(1, 1, N'Nấu bữa trưa cho 3 người', N'- Chuẩn bị nguyên liệu\n- Nấu 3 món\n- Dọn dẹp bếp', 0),
(2, 2, N'Chăm sóc người già hàng ngày', N'- Hỗ trợ ăn uống\n- Theo dõi sức khỏe', 0);

-- TaskPhotos
INSERT INTO TaskPhotos (photo_id, task_id, photo_url, photo_type, uploaded_at, uploaded_by)
VALUES
(1, 1, 'photos/task1_before.jpg', N'Trước', '2025-09-06 07:30:00', @UserID_An),
(2, 1, 'photos/task1_after.jpg', N'Sau', '2025-09-06 10:30:00', @UserID_An);

-- Payments
INSERT INTO Payments (payment_id, booking_id, amount, payment_method, payment_date, status)
VALUES
(1, 1, 150.00, N'Tiền mặt', '2025-09-06 11:00:00', N'Chờ xử lý');

-- Ratings
INSERT INTO Ratings (rating_id, booking_id, reviewer_id, reviewee_id, rating, comment, created_at)
VALUES
(1, 1, @UserID_Dung, @UserID_An, 4, N'Nấu ăn ngon, đúng giờ', '2025-09-06 11:30:00');

-- Posts
INSERT INTO Posts (user_id, title, content, related_booking_id, status, photo_urls, likes, comments_count)
VALUES
(1, N'Looking for a cleaner for the weekend', N'I need someone to clean my house this weekend. 3 bedrooms, 2 bathrooms. Reasonable price please.', NULL, 'Approved', N'["/images/house1.jpg", "/images/house2.jpg"]', 4, 2),
(2, N'Tutor needed for Math', N'I am looking for an experienced math tutor for high school level. 2 sessions per week.', 1, 'Pending', N'["/images/math.jpg"]', 0, 0),
(3, N'Gardening service required', N'Looking for someone to take care of my small garden. Tasks include watering plants and trimming bushes.', NULL, 'Rejected', NULL, 1, 0);

-- PostLikes
INSERT INTO PostLikes (post_like_id, post_id, user_id, liked_at)
VALUES
(1, 1, @UserID_An, '2025-09-04 09:00:00'),
(2, 1, @UserID_Binh, '2025-09-04 09:30:00');

-- Comments
INSERT INTO Comments (comment_id, post_id, user_id, parent_comment_id, content, created_at, updated_at)
VALUES
(1, 1, @UserID_An, NULL, N'Tôi có thể nhận công việc này!', '2025-09-04 09:10:00', '2025-09-04 09:10:00'),
(2, 1, @UserID_Dung, 1, N'Bạn có thể làm vào sáng Chủ nhật không?', '2025-09-04 09:20:00', '2025-09-04 09:20:00');

-- PostServices
INSERT INTO PostServices (post_service_id, post_id, service_id, variant_id, desired_price, notes)
VALUES
(1, 1, 2, 3, 100.00, N'Dọn dẹp toàn bộ nhà 50m²');


-- Quotes
INSERT INTO Quotes (quote_id, post_id, tasker_id, variant_id, proposed_price, proposal, status, sent_at)
VALUES
(1, 1, @UserID_An, 3, 120.00, N'Tôi có thể dọn dẹp nhà bạn trong 2 giờ', N'Chờ xử lý', '2025-09-04 09:15:00');

-- Conversations
DECLARE @ConversationID INT;

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

-- Videos
INSERT INTO Videos (video_id, user_id, title, description, video_url, likes, uploaded_at)
VALUES
(1, @UserID_An, N'Hướng dẫn nấu phở bò', N'Video hướng dẫn nấu phở bò truyền thống', 'videos/pho_bo.mp4', 20, '2025-09-03 10:00:00');

-- Badges
INSERT INTO Badges (badge_id, name, description, required_likes, icon_url)
VALUES
(1, N'Đầu bếp xuất sắc', N'Danh hiệu cho người có video nấu ăn đạt 20 lượt thích', 20, 'icons/chef_badge.png');

-- UserBadges
INSERT INTO UserBadges (user_badge_id, user_id, badge_id, awarded_at)
VALUES
(1, @UserID_An, 1, '2025-09-04 12:00:00');

-- Notifications
INSERT INTO Notifications (user_id, title, content, type, data, is_read, read_at, created_at, expires_at)
VALUES
(@UserID_Binh, N'Tin nhắn mới từ Thanh Hiếu', N'Xin chào', N'Message', N'{"conversation_id":5,"sender_id":@UserID_An,"type":"message"}', 1, '2025-09-13 00:36:47.9966667', '2025-09-03 18:52:36.4166667', NULL),
(@UserID_Dung, N'Đặt dịch vụ mới', N'Bạn đã đặt dịch vụ nấu ăn thành công!', N'Booking', N'{"booking_id":1}', 0, NULL, '2025-09-05 09:10:00', NULL),
(@UserID_An, N'Nhận công việc mới', N'Bạn được giao dịch vụ nấu ăn cho khách hàng Phạm Thị Dung', N'Booking', N'{"booking_id":1,"customer_name":"Phạm Thị Dung"}', 0, NULL, '2025-09-05 09:15:00', NULL),
(@UserID_Cuong, N'Thanh toán thành công', N'Bạn đã thanh toán dịch vụ dọn dẹp thành công.', N'Payment', N'{"payment_id":2,"amount":500000}', 0, NULL, '2025-09-06 14:20:00', '2025-09-30 23:59:59'),
(@UserID_Binh, N'Đánh giá mới', N'Bạn nhận được một đánh giá 5 sao từ khách hàng Lê Thị Hoa.', N'Review', N'{"review_id":1,"rating":5}', 0, NULL, '2025-09-07 18:45:00', NULL);

