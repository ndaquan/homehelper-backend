-- SQL Server Database Setup for Blog System
-- Create tables for blog/forum system

USE HomeHelperDB;
GO

-- Posts table: Stores user posts
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Posts]') AND type in (N'U'))
BEGIN
    CREATE TABLE Posts (
        post_id INT IDENTITY(1,1) PRIMARY KEY,
        user_id INT NOT NULL,
        title NVARCHAR(255) NOT NULL,
        content NVARCHAR(MAX),
        post_date DATETIME2 DEFAULT GETDATE(),
        status NVARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
        photo_urls NVARCHAR(MAX), -- List of image URLs as JSON
        likes INT DEFAULT 0, -- Number of likes
        comments_count INT DEFAULT 0, -- Number of comments
        created_at DATETIME2 DEFAULT GETDATE(),
        updated_at DATETIME2 DEFAULT GETDATE(),
        FOREIGN KEY (user_id) REFERENCES Users(user_id)
    );
END
GO

-- PostLikes table: Stores post likes
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[PostLikes]') AND type in (N'U'))
BEGIN
    CREATE TABLE PostLikes (
        post_like_id INT IDENTITY(1,1) PRIMARY KEY,
        post_id INT NOT NULL,
        user_id INT NOT NULL,
        liked_at DATETIME2 DEFAULT GETDATE(),
        FOREIGN KEY (post_id) REFERENCES Posts(post_id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
        UNIQUE (post_id, user_id) -- Ensure each user can like a post only once
    );
END
GO

-- Comments table: Stores comments and replies
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Comments]') AND type in (N'U'))
BEGIN
    CREATE TABLE Comments (
        comment_id INT IDENTITY(1,1) PRIMARY KEY,
        post_id INT NOT NULL,
        user_id INT NOT NULL,
        parent_comment_id INT, -- For replies (child comments)
        content NTEXT NOT NULL,
        created_at DATETIME2 DEFAULT GETDATE(),
        updated_at DATETIME2 DEFAULT GETDATE(),
        FOREIGN KEY (post_id) REFERENCES Posts(post_id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (parent_comment_id) REFERENCES Comments(comment_id)
    );
END
GO

-- Services table
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Services]') AND type in (N'U'))
BEGIN
    CREATE TABLE Services (
        service_id INT IDENTITY(1,1) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        reference_price DECIMAL(10,2)
    );
END
GO

-- ServiceVariants table: Stores service variants
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ServiceVariants]') AND type in (N'U'))
BEGIN
    CREATE TABLE ServiceVariants (
        variant_id INT IDENTITY(1,1) PRIMARY KEY,
        service_id INT NOT NULL,
        variant_name VARCHAR(255) NOT NULL,
        pricing_type VARCHAR(50) NOT NULL CHECK (pricing_type IN ('Hourly', 'Per item', 'By area', 'Package')),
        price_min DECIMAL(10,2),
        price_max DECIMAL(10,2),
        unit VARCHAR(50),
        FOREIGN KEY (service_id) REFERENCES Services(service_id)
    );
END
GO

-- PostServices table: Stores selected services in posts
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[PostServices]') AND type in (N'U'))
BEGIN
    CREATE TABLE PostServices (
        post_service_id INT IDENTITY(1,1) PRIMARY KEY,
        post_id INT NOT NULL,
        service_id INT NOT NULL,
        variant_id INT NOT NULL,
        desired_price DECIMAL(10,2), -- User's desired price for the service
        notes NTEXT, -- Additional notes
        created_at DATETIME2 DEFAULT GETDATE(),
        updated_at DATETIME2 DEFAULT GETDATE(),
        FOREIGN KEY (post_id) REFERENCES Posts(post_id) ON DELETE CASCADE,
        FOREIGN KEY (service_id) REFERENCES Services(service_id) ON DELETE CASCADE,
        FOREIGN KEY (variant_id) REFERENCES ServiceVariants(variant_id)
    );
END
GO

-- Indexes for performance
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Posts_user_id')
BEGIN
    CREATE INDEX IX_Posts_user_id ON Posts(user_id);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Posts_status')
BEGIN
    CREATE INDEX IX_Posts_status ON Posts(status);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Posts_post_date')
BEGIN
    CREATE INDEX IX_Posts_post_date ON Posts(post_date);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Posts_likes')
BEGIN
    CREATE INDEX IX_Posts_likes ON Posts(likes);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_PostLikes_post_id')
BEGIN
    CREATE INDEX IX_PostLikes_post_id ON PostLikes(post_id);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_PostLikes_user_id')
BEGIN
    CREATE INDEX IX_PostLikes_user_id ON PostLikes(user_id);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_PostLikes_liked_at')
BEGIN
    CREATE INDEX IX_PostLikes_liked_at ON PostLikes(liked_at);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Comments_post_id')
BEGIN
    CREATE INDEX IX_Comments_post_id ON Comments(post_id);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Comments_user_id')
BEGIN
    CREATE INDEX IX_Comments_user_id ON Comments(user_id);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Comments_parent_comment_id')
BEGIN
    CREATE INDEX IX_Comments_parent_comment_id ON Comments(parent_comment_id);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Comments_created_at')
BEGIN
    CREATE INDEX IX_Comments_created_at ON Comments(created_at);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_PostServices_post_id')
BEGIN
    CREATE INDEX IX_PostServices_post_id ON PostServices(post_id);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_PostServices_service_id')
BEGIN
    CREATE INDEX IX_PostServices_service_id ON PostServices(service_id);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_PostServices_desired_price')
BEGIN
    CREATE INDEX IX_PostServices_desired_price ON PostServices(desired_price);
END
GO



-- Insert sample data for Services
INSERT INTO Services (name, description, reference_price) VALUES
('House cleaning', 'Comprehensive house cleaning service', 200000),
('Window washing', 'Interior and exterior window cleaning service', 150000),
('Office cleaning', 'Office and workplace cleaning service', 300000),
('Laundry', 'Clothing washing and ironing service', 100000),
('Cooking', 'Home cooking service', 250000),
('Childcare', 'Childcare and babysitting service', 400000),
('Elderly care', 'Care for senior citizens', 350000),
('Security', 'Asset protection service', 500000);
GO

-- Insert sample data for ServiceVariants
INSERT INTO ServiceVariants (service_id, variant_name, pricing_type, price_min, price_max, unit) VALUES
(1, 'Hourly cleaning', 'Hourly', 80000, 120000, 'hour'),
(1, 'Full house cleaning', 'Package', 500000, 2000000, 'time'),
(2, 'Window washing by area', 'By area', 50000, 200000, 'm2'),
(3, 'Office cleaning by hour', 'Hourly', 100000, 200000, 'hour'),
(3, 'Full office cleaning', 'Package', 1000000, 5000000, 'time'),
(4, 'Laundry per kg', 'Per item', 20000, 50000, 'kg'),
(5, 'Meal preparation per meal', 'Per item', 100000, 500000, 'meal'),
(6, 'Childcare by hour', 'Hourly', 50000, 100000, 'hour'),
(7, 'Elderly care by hour', 'Hourly', 60000, 120000, 'hour'),
(8, 'Security by day', 'Hourly', 300000, 700000, 'day');
GO

-- Insert sample data for Posts
INSERT INTO Posts (user_id, title, content, status, photo_urls) VALUES
(1, 'Looking for a cleaner for the weekend', 'I need someone to clean my house this weekend. 3 bedrooms, 2 bathrooms. Reasonable price please.', 'Approved', '["/images/house1.jpg", "/images/house2.jpg"]'),
(2, 'Professional window cleaning service', 'We provide professional window cleaning for homes and offices. 5 years of experience.', 'Approved', '["/images/window1.jpg"]'),
(3, 'Need a cook for my family', 'Looking for someone to cook 3 meals a day. Must know Vietnamese and some Western dishes.', 'Approved', '["/images/cooking1.jpg", "/images/cooking2.jpg"]'),
(4, 'Childcare service available', 'I have experience taking care of children from 2-10 years old. Part-time or full-time.', 'Approved', '["/images/childcare1.jpg"]'),
(5, 'Looking for a part-time cleaner', 'Need someone for 3 sessions a week, 4 hours each. Mainly cleaning and cooking.', 'Approved', '["/images/staff-1.jpg"]'),
(1, 'Office cleaning service', 'Specializing in office cleaning. Professional staff, modern equipment.', 'Approved', '["/images/work-1.jpg", "/images/work-2.jpg"]'),
(2, 'Need a caregiver for the elderly', 'My grandmother is 85 and needs 24/7 care. Must have experience and compassion.', 'Approved', '["/images/staff-2.jpg"]'),
(3, 'Laundry service at home', 'We offer laundry and ironing at your doorstep. Affordable and quality service.', 'Approved', '["/images/work-3.jpg"]'),
(4, 'Looking for a babysitter on weekends', 'Need someone to take care of my 2-year-old on weekends. Must have experience and love for children.', 'Approved', '["/images/staff-3.jpg"]'),
(5, 'Asset protection service', 'We provide security services for your home and assets. Professional guards, armed if necessary.', 'Approved', '["/images/staff-4.jpg"]'),
(1, 'Need a cleaner after the party', 'Looking for someone to clean up after a birthday party. Urgent job, good pay.', 'Approved', '["/images/work-4.jpg"]'),
(2, 'Industrial cleaning service', 'Specializing in industrial cleaning for factories and warehouses. Competitive pricing.', 'Approved', '["/images/work-5.jpg"]'),
(3, 'Need a cook for an event', 'Looking for a cook for a wedding with 200 guests. Must have experience with large events.', 'Approved', '["/images/staff-5.jpg"]'),
(4, 'New house cleaning service', 'Cleaning for newly built houses, ready to move in. Includes thorough cleaning of the entire house.', 'Approved', '["/images/work-6.jpg"]'),
(5, 'Looking for a pet sitter', 'Need someone to take care of my dog and cat for a week. Must love animals.', 'Approved', '["/images/staff-6.jpg"]'),
(1, 'High-rise window cleaning service', 'Specializing in window cleaning for high-rise buildings. Safety equipment and full insurance provided.', 'Approved', '["/images/work-7.jpg"]'),
(2, 'Looking for a long-term maid', 'Need a maid for long-term, stable job. Salary 8 million VND/month, including food and accommodation.', 'Approved', '["/images/staff-7.jpg"]'),
(3, 'Post-construction cleaning service', 'Cleaning after construction or renovation. Includes dust, paint, and debris removal.', 'Approved', '["/images/work-8.jpg"]'),
(4, 'Need a cook for a diabetic patient', 'My father is diabetic and needs a special diet. Must know about nutrition.', 'Approved', '["/images/staff-8.jpg"]'),
(5, 'Air conditioner cleaning service', 'Cleaning and maintenance for air conditioners. Includes gas refill, filter cleaning, and system check.', 'Approved', '["/images/image_1.jpg"]'),
-- Add some posts pending approval
(1, 'Need a cleaner for flood recovery', 'My house was flooded and needs urgent cleaning. Heavy work, good pay.', 'Pending', '["/images/work-1.jpg"]'),
(2, 'Caregiver needed for disabled person', 'Looking for a caregiver for a disabled person with mobility issues. Medical experience required.', 'Pending', '["/images/staff-2.jpg"]'),
(3, 'Cook needed for hospital', 'Hospital requires a cook for patient meals. Must have food safety certification.', 'Pending', '["/images/cooking1.jpg"]'),
(4, 'School cleaning service', 'School needs cleaning after summer break. Large area, need a big team.', 'Pending', '["/images/work-3.jpg"]'),
(5, 'Babysitter needed at home', 'Family needs a babysitter at home for 8 hours a day. Must have experience and love for children.', 'Pending', '["/images/childcare1.jpg"]');
GO

-- Insert sample data for PostServices
INSERT INTO PostServices (post_id, service_id, desired_price, notes) VALUES
(1, 1, 250000, 'Clean the entire house, including bathrooms and kitchen'),
(2, 2, 120000, 'Wash windows inside and out, 1st and 2nd floors'),
(3, 5, 200000, 'Cook 3 meals a day, grocery shopping included'),
(4, 6, 300000, 'Take care of child for 8 hours a day, Mon-Fri'),
(5, 1, 150000, 'Part-time maid 3 times a week, 4 hours each time'),
(6, 3, 400000, 'Office cleaning for 500m2, with professional team'),
(7, 7, 500000, '24/7 elderly care, with medical experience'),
(8, 4, 80000, 'Wash and iron 20kg of clothes and bedding'),
(9, 6, 200000, 'Babysit 2-year-old on weekends, must have experience'),
(10, 8, 600000, '24/7 security service, armed if necessary'),
(11, 1, 300000, 'Clean up after a party for 100 guests, urgent job'),
(12, 3, 500000, 'Industrial cleaning for a factory of 1000m2'),
(13, 5, 800000, 'Cook for a wedding with 200 guests, diverse menu'),
(14, 1, 400000, 'Clean new 3-story house, ready to move in'),
(15, 6, 150000, 'Pet sitting for 1 week, must love animals'),
(16, 2, 200000, 'Clean windows of a 20-story building, safety equipment provided'),
(17, 1, 8000000, 'Long-term maid, stable job with salary of 8 million VND/month'),
(18, 1, 600000, 'Post-construction cleaning, dust and debris removal'),
(19, 5, 250000, 'Cook for a diabetic patient, special diet required'),
(20, 2, 100000, 'Air conditioner cleaning, gas refill, and maintenance'),
-- Add PostServices for new posts
(21, 1, 500000, 'Clean house after flood, heavy work'),
(22, 7, 600000, 'Care for disabled person, medical experience required'),
(23, 5, 300000, 'Cook for hospital patients, food safety certification needed'),
(24, 3, 800000, 'Clean school, large area'),
(25, 6, 400000, 'Babysit at home for 8 hours a day');
GO

-- Insert sample data for PostLikes
INSERT INTO PostLikes (post_id, user_id) VALUES
(1, 2), (1, 3), (2, 1), (3, 4), (4, 5),
(5, 1), (5, 2), (6, 3), (6, 4), (7, 5),
(8, 1), (9, 2), (9, 3), (10, 4), (11, 5),
(12, 1), (12, 2), (13, 3), (14, 4), (15, 5),
(16, 1), (16, 2), (17, 3), (17, 4), (18, 5),
(19, 1), (20, 2), (20, 3),
-- Add likes for popular posts
(1, 4), (1, 5), (3, 1), (3, 2), (6, 5),
(13, 1), (13, 2), (17, 1), (17, 5),
(2, 3), (2, 4), (8, 2), (8, 3), (14, 1), (14, 2);
GO

-- Insert sample data for Comments
INSERT INTO Comments (post_id, user_id, content) VALUES
(1, 4, 'I can help you with cleaning. Contact me at this number.'),
(1, 2, 'Thank you! I will contact you soon.'),
(2, 3, 'Does your service include insurance?'),
(2, 4, 'Yes, we have liability insurance.'),
(3, 5, 'I can cook for your family. 3 years of cooking experience.'),
(4, 1, 'Can you take care of children under 2 years old?'),
(5, 2, 'I can work as a maid by the hour. 2 years of experience in this field.'),
(6, 3, 'What is the price for cleaning 100m2 of office space?'),
(6, 4, 'Price is 200k/100m2, including equipment and chemicals.'),
(7, 5, 'I have 5 years of experience in elderly care. Available 24/7.'),
(8, 1, 'Does your laundry service accept children\'s clothes?'),
(8, 2, 'Yes, we accept all types of clothes, including children\'s.'),
(9, 3, 'I love children and have 3 years of experience in babysitting.'),
(10, 4, 'Does your security service include insurance?'),
(10, 5, 'Yes, we have full liability insurance.'),
(11, 1, 'I can clean up after the party. 4 years of experience.'),
(12, 2, 'Does your industrial cleaning service accept factories?'),
(12, 3, 'Yes, we specialize in cleaning factories and warehouses.'),
(13, 4, 'I have experience in cooking for large events. Have cooked for many weddings.'),
(14, 5, 'Does your new house cleaning service include window washing?'),
(14, 1, 'Yes, we clean everything, including windows.'),
(15, 2, 'I love animals and have experience in pet sitting.'),
(16, 3, 'Is your high-rise window cleaning service safe?'),
(16, 4, 'Very safe, we have specialized equipment and insurance.'),
(17, 5, 'I can work as a maid long-term. 6 years of experience.'),
(18, 1, 'Does your post-construction cleaning service remove dust?'),
(18, 2, 'Yes, we have specialized equipment to remove dust and debris.'),
(19, 3, 'I have experience cooking for diabetic patients. Knowledgeable about nutrition.'),
(20, 4, 'Does your air conditioner cleaning service include gas refill?'),
(20, 5, 'Yes, we provide gas refill and comprehensive maintenance service.'),
-- Add comments for popular posts
(1, 1, 'This service is very useful! I have used it and am very satisfied.'),
(3, 2, 'The cook is very professional, the food is delicious.'),
(6, 3, 'The office cleaning team is very professional.'),
(13, 4, 'The wedding food was delicious, guests praised it.'),
(17, 5, 'The maid is very dedicated and professional.'),
-- Add response comments
(1, 1, 'I also need a similar service, can you share the information?'),
(3, 3, 'Is the food hygienic?'),
(6, 5, 'Can the price be negotiated?'),
(13, 1, 'Can you cook according to special requests?'),
(17, 2, 'Can I try for 1 month first?');
GO

-- Trigger to update likes and comments count
IF NOT EXISTS (SELECT * FROM sys.triggers WHERE name = 'tr_update_post_likes_count')
BEGIN
    EXEC('
        CREATE TRIGGER tr_update_post_likes_count
        ON PostLikes
        AFTER INSERT, DELETE
        AS
        BEGIN
            SET NOCOUNT ON;
            
            -- Update likes count for affected posts
            UPDATE p
            SET likes = (
                SELECT COUNT(*)
                FROM PostLikes pl
                WHERE pl.post_id = p.post_id
            )
            FROM Posts p
            WHERE p.post_id IN (
                SELECT post_id FROM inserted
                UNION
                SELECT post_id FROM deleted
            );
        END
    ');
END
GO

IF NOT EXISTS (SELECT * FROM sys.triggers WHERE name = 'tr_update_post_comments_count')
BEGIN
    EXEC('
        CREATE TRIGGER tr_update_post_comments_count
        ON Comments
        AFTER INSERT, DELETE
        AS
        BEGIN
            SET NOCOUNT ON;
            
            -- Update comments count for affected posts
            UPDATE p
            SET comments_count = (
                SELECT COUNT(*)
                FROM Comments c
                WHERE c.post_id = p.post_id AND c.parent_comment_id IS NULL
            )
            FROM Posts p
            WHERE p.post_id IN (
                SELECT post_id FROM inserted
                UNION
                SELECT post_id FROM deleted
            );
        END
    ');
END
GO

-- Update likes and comments count for existing posts
UPDATE Posts SET likes = (
    SELECT COUNT(*) FROM PostLikes WHERE post_id = Posts.post_id
);
GO

UPDATE Posts SET comments_count = (
    SELECT COUNT(*) FROM Comments WHERE post_id = Posts.post_id AND parent_comment_id IS NULL
);
GO

PRINT '✅ Blog Database setup complete!';
PRINT '📊 Tables created:';
PRINT '   - Posts (25 posts)';
PRINT '   - PostLikes (40+ likes)';
PRINT '   - Comments (35+ comments)';
PRINT '   - PostServices (25 services)';
PRINT '   - Services (8 types of services)';
PRINT '   - Users (5 sample users)';
PRINT '🔧 Indexes and triggers created';
PRINT '📝 Sample data added:';
PRINT '   - 20 approved posts';
PRINT '   - 5 pending posts';
PRINT '   - Diverse services: cleaning, cooking, caregiving, security';
PRINT '   - Rich interactions: likes, comments, services';
PRINT '🎯 Ready to test frontend!';
