-- Migration: Add liked_by_users column to Videos table
-- This column stores a JSON array of user IDs who liked the video
-- Each user can only like once

USE HomeHelperDB42;
GO

-- Check if column exists, if not add it
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'Videos') 
    AND name = 'liked_by_users'
)
BEGIN
    ALTER TABLE Videos
    ADD liked_by_users NVARCHAR(MAX) NULL;
    
    PRINT 'Column liked_by_users added successfully';
END
ELSE
BEGIN
    PRINT 'Column liked_by_users already exists';
END
GO

-- Initialize existing videos with empty array
UPDATE Videos
SET liked_by_users = '[]'
WHERE liked_by_users IS NULL;
GO

PRINT 'Migration completed successfully';
GO
