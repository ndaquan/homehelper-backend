const SystemReport = require('../../models/SystemReport');
const { executeQuery } = require('../../config/database');
const ImageEncryption = require('../../utils/imageEncryption');

// Mock dependencies
jest.mock('../../config/database');
jest.mock('../../utils/imageEncryption');

describe('SystemReport Model Unit Tests', () => {
    
    afterEach(() => {
        jest.clearAllMocks();
    });

    // ==========================================
    // Function 1: User sends issue (create)
    // ==========================================
    describe('create() - User sends system issue', () => {
        const mockData = {
            user_id: 101,
            title: 'Login Error',
            description: 'Cannot login with google',
            image_url: 'http://image.com/error.png'
        };

        it('should create a report successfully with encrypted image', async () => {
            // Arrange
            const encryptedUrl = 'encrypted_string_123';
            const mockDbResult = {
                recordset: [{
                    report_id: 1,
                    ...mockData,
                    image_url: encryptedUrl,
                    status: 'Pending',
                    created_at: new Date(),
                    updated_at: new Date()
                }]
            };

            ImageEncryption.encrypt.mockReturnValue(encryptedUrl);
            executeQuery.mockResolvedValue(mockDbResult);

            // Act
            const result = await SystemReport.create(mockData);

            // Assert
            expect(ImageEncryption.encrypt).toHaveBeenCalledWith(mockData.image_url);
            expect(executeQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO SystemReports'),
                expect.objectContaining({
                    user_id: mockData.user_id,
                    title: mockData.title,
                    description: mockData.description,
                    image_url: encryptedUrl
                })
            );
            expect(result).toEqual(mockDbResult.recordset[0]);
        });

        it('should handle null image_url correctly', async () => {
            // Arrange
            const dataNoImage = { ...mockData, image_url: null };
            const mockDbResult = { recordset: [{ ...dataNoImage, report_id: 2 }] };

            executeQuery.mockResolvedValue(mockDbResult);

            // Act
            await SystemReport.create(dataNoImage);

            // Assert
            expect(ImageEncryption.encrypt).not.toHaveBeenCalled();
            expect(executeQuery).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ image_url: null })
            );
        });

        it('should throw error when database query fails', async () => {
            // Arrange
            const dbError = new Error('Database connection failed');
            executeQuery.mockRejectedValue(dbError);

            // Act & Assert
            await expect(SystemReport.create(mockData))
                .rejects
                .toThrow('Lỗi tạo báo cáo: Database connection failed');
        });
    });

    // ==========================================
    // Function 2: Admin views issues (findAll)
    // ==========================================
    describe('findAll() - Admin views reported issues', () => {
        const mockReports = [
            { report_id: 1, title: 'Issue A', image_url: 'enc_A', status: 'Pending' },
            { report_id: 2, title: 'Issue B', image_url: null, status: 'Resolved' }
        ];

        it('should return paginated reports with decrypted images', async () => {
            // Arrange
            const page = 1;
            const limit = 10;
            
            // Mock count query result
            const mockCountResult = { recordset: [{ total: 20 }] };
            // Mock data query result
            const mockDataResult = { recordset: mockReports };

            // Setup mocks for sequential calls
            executeQuery
                .mockResolvedValueOnce(mockDataResult) // First call: get data
                .mockResolvedValueOnce(mockCountResult); // Second call: get count

            ImageEncryption.decrypt.mockImplementation(url => `decrypted_${url}`);

            // Act
            const result = await SystemReport.findAll(page, limit);

            // Assert
            expect(executeQuery).toHaveBeenCalledTimes(2);
            
            // Verify decryption
            expect(ImageEncryption.decrypt).toHaveBeenCalledWith('enc_A');
            expect(result.reports[0].image_url).toBe('decrypted_enc_A');
            expect(result.reports[1].image_url).toBeNull();
            
            // Verify pagination info
            expect(result.total).toBe(20);
            expect(result.totalPages).toBe(2); // 20 total / 10 limit = 2 pages
        });

        it('should apply status filter when provided', async () => {
            // Arrange
            const status = 'Pending';
            executeQuery.mockResolvedValue({ recordset: [] }); // Return empty for simplicity

            // Act
            await SystemReport.findAll(1, 10, status);

            // Assert
            expect(executeQuery).toHaveBeenCalledWith(
                expect.stringContaining('WHERE r.status = @status'),
                expect.objectContaining({ status: 'Pending' })
            );
        });

        it('should throw error when database fails', async () => {
            // Arrange
            executeQuery.mockRejectedValue(new Error('Query failed'));

            // Act & Assert
            await expect(SystemReport.findAll())
                .rejects
                .toThrow('Lỗi lấy danh sách báo cáo: Query failed');
        });
    });
});
