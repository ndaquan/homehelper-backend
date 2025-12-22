const { connectDB, executeQuery } = require('../config/database');

async function createSystemReportsTable() {
  try {
    await connectDB();

    const query = `
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='SystemReports' AND xtype='U')
      BEGIN
        CREATE TABLE SystemReports (
          report_id INT IDENTITY(1,1) PRIMARY KEY,
          user_id INT NOT NULL,
          title NVARCHAR(255) NOT NULL,
          description NVARCHAR(MAX) NOT NULL,
          image_url NVARCHAR(MAX),
          status NVARCHAR(50) DEFAULT 'Pending',
          created_at DATETIME DEFAULT SYSUTCDATETIME(),
          updated_at DATETIME DEFAULT SYSUTCDATETIME(),
          FOREIGN KEY (user_id) REFERENCES Users(user_id)
        );
        PRINT 'Table SystemReports created successfully';
      END
      ELSE
      BEGIN
        PRINT 'Table SystemReports already exists';
      END
    `;

    await executeQuery(query);
    console.log("✅ SystemReports table check/creation completed.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error creating table:", error);
    process.exit(1);
  }
}

createSystemReportsTable();
