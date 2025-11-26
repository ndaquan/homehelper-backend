-- Fix: Cập nhật dữ liệu cũ và constraint cho photo_type
-- Chạy script này để sửa dữ liệu cũ và constraint

-- 1. Cập nhật dữ liệu cũ từ "before"/"after" sang "Trước"/"Sau"
UPDATE TaskPhotos 
SET photo_type = 'Trước' 
WHERE photo_type = 'before' OR photo_type = 'Before' OR photo_type = 'BEFORE';

UPDATE TaskPhotos 
SET photo_type = 'Sau' 
WHERE photo_type = 'after' OR photo_type = 'After' OR photo_type = 'AFTER';

PRINT '✅ Đã cập nhật dữ liệu cũ';

-- 2. Kiểm tra constraint hiện tại
SELECT 
    CONSTRAINT_NAME,
    CHECK_CLAUSE
FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS
WHERE CONSTRAINT_NAME = 'CHK_photo_type';

-- 3. Xóa constraint cũ nếu cần (nếu muốn cho phép cả tiếng Anh và tiếng Việt)
-- ALTER TABLE TaskPhotos DROP CONSTRAINT CHK_photo_type;

-- 4. Tạo lại constraint mới cho phép cả "before"/"after" và "Trước"/"Sau"
-- ALTER TABLE TaskPhotos
-- ADD CONSTRAINT CHK_photo_type CHECK (photo_type IN (N'Trước', N'Sau', N'before', N'after'));

-- Hoặc giữ constraint hiện tại chỉ cho phép tiếng Việt (khuyến nghị)
-- Constraint hiện tại đã đúng, chỉ cần đảm bảo code chuyển đổi đúng

GO


