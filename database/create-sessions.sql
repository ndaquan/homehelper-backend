-- Create sessions and session_photos tables
IF OBJECT_ID('SessionPhotos') IS NOT NULL DROP TABLE SessionPhotos;
IF OBJECT_ID('Sessions') IS NOT NULL DROP TABLE Sessions;

CREATE TABLE Sessions (
    session_id INT IDENTITY(1,1) PRIMARY KEY,
    booking_id INT NOT NULL,
    day_key NVARCHAR(10) NOT NULL, -- YYYY-MM-DD
    started_at DATETIME2 NULL,
    finished_at DATETIME2 NULL,
    accumulated_ms BIGINT DEFAULT 0,
    done BIT DEFAULT 0,
    created_at DATETIME2 DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Sessions_BookingDay UNIQUE (booking_id, day_key)
);

CREATE TABLE SessionPhotos (
    photo_id INT IDENTITY(1,1) PRIMARY KEY,
    session_id INT NOT NULL,
    booking_id INT NOT NULL,
    [type] NVARCHAR(10) NOT NULL, -- 'before' or 'after'
    photo_url NVARCHAR(1000) NOT NULL,
    storage_path NVARCHAR(1000) NULL,
    file_name NVARCHAR(255) NULL,
    mime NVARCHAR(100) NULL,
    size BIGINT NULL,
    ordinal INT DEFAULT 0,
    uploaded_by INT NULL,
    uploaded_at DATETIME2 DEFAULT SYSUTCDATETIME(),
    created_at DATETIME2 DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 DEFAULT SYSUTCDATETIME()
);

ALTER TABLE SessionPhotos
ADD CONSTRAINT FK_SessionPhotos_Sessions FOREIGN KEY (session_id) REFERENCES Sessions(session_id) ON DELETE CASCADE;

CREATE INDEX IDX_SessionPhotos_Session_Type ON SessionPhotos(session_id, [type]);
