const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

class PythonOCRService {
  constructor() {
    this.pythonApiUrl = 'http://localhost:8080/api/ocr';
    this.timeout = 30000; // 30 seconds timeout
  }

  /**
   * Check if Python OCR service is running
   */
  async healthCheck() {
    try {
      const response = await axios.get(`${this.pythonApiUrl}/health`, {
        timeout: 5000
      });
      return response.data.status === 'ok';
    } catch (error) {
      console.error('Python OCR service health check failed:', error.message);
      return false;
    }
  }

  /**
   * Process CCCD images using Python OCR
   * @param {string} frontImagePath - Path to front image
   * @param {string} backImagePath - Path to back image (optional)
   * @returns {Object} OCR results
   */
  async processCCCD(frontImagePath, backImagePath = null) {
    try {
      // Check if Python service is running
      const isHealthy = await this.healthCheck();
      if (!isHealthy) {
        throw new Error('Python OCR service is not available');
      }

      // Create form data
      const formData = new FormData();
      
      // Add front image
      if (!fs.existsSync(frontImagePath)) {
        throw new Error(`Front image not found: ${frontImagePath}`);
      }
      formData.append('front_image', fs.createReadStream(frontImagePath));

      // Add back image if provided
      if (backImagePath && fs.existsSync(backImagePath)) {
        formData.append('back_image', fs.createReadStream(backImagePath));
      }

      // Make request to Python API
      const response = await axios.post(`${this.pythonApiUrl}/process`, formData, {
        headers: {
          ...formData.getHeaders(),
        },
        timeout: this.timeout,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      return {
        success: true,
        data: response.data,
        source: 'python_ocr'
      };

    } catch (error) {
      console.error('Python OCR processing failed:', error.message);
      return {
        success: false,
        error: error.message,
        source: 'python_ocr'
      };
    }
  }

  /**
   * Extract fields from CCCD using Python OCR
   * @param {string} frontImagePath - Path to front image
   * @param {string} backImagePath - Path to back image (optional)
   * @returns {Object} Extracted fields
   */
  async extractFields(frontImagePath, backImagePath = null) {
    try {
      const result = await this.processCCCD(frontImagePath, backImagePath);
      
      if (!result.success) {
        return {
          success: false,
          error: result.error,
          extracted: {}
        };
      }

      // Parse Python OCR response and convert to our format
      const pythonData = result.data;
      
      // Extract fields from Python response
      const extracted = {
        number: this.extractField(pythonData, 'number') || '',
        full_name: this.extractField(pythonData, 'full_name') || '',
        dob: this.extractField(pythonData, 'dob') || '',
        gender: this.extractField(pythonData, 'gender') || '',
        nationality: this.extractField(pythonData, 'nationality') || '',
        place_of_origin: this.extractField(pythonData, 'place_of_origin') || '',
        place_of_residence: this.extractField(pythonData, 'place_of_residence') || '',
        expiry_date: this.extractField(pythonData, 'expiry_date') || ''
      };

      return {
        success: true,
        extracted,
        rawData: pythonData,
        source: 'python_ocr'
      };

    } catch (error) {
      console.error('Field extraction failed:', error.message);
      return {
        success: false,
        error: error.message,
        extracted: {}
      };
    }
  }

  /**
   * Extract a specific field from Python OCR response
   * @param {Object} data - Python OCR response data
   * @param {string} fieldName - Field name to extract
   * @returns {string} Extracted field value
   */
  extractField(data, fieldName) {
    try {
      // Handle different possible response structures
      if (data && typeof data === 'object') {
        // Direct field access
        if (data[fieldName]) {
          return data[fieldName].toString().trim();
        }
        
        // Nested structure (e.g., data.front.number)
        if (data.front && data.front[fieldName]) {
          return data.front[fieldName].toString().trim();
        }
        
        // Array structure (e.g., data.fields[0].number)
        if (data.fields && Array.isArray(data.fields)) {
          for (const field of data.fields) {
            if (field.name === fieldName && field.value) {
              return field.value.toString().trim();
            }
          }
        }
      }
      
      return '';
    } catch (error) {
      console.error(`Error extracting field ${fieldName}:`, error.message);
      return '';
    }
  }

  /**
   * Compare extracted data with user input
   * @param {Object} extracted - Extracted data from OCR
   * @param {Object} userInput - User input data
   * @returns {Object} Comparison results
   */
  compareData(extracted, userInput) {
    const fields = ['number', 'full_name', 'dob', 'gender'];
    const comparison = {
      allMatch: true,
      details: {},
      accuracy: 0
    };

    let matchCount = 0;
    
    for (const field of fields) {
      const extractedValue = (extracted[field] || '').toString().trim().toLowerCase();
      const userValue = (userInput[field] || '').toString().trim().toLowerCase();
      
      const isMatch = extractedValue === userValue;
      comparison.details[field] = isMatch;
      
      if (isMatch) {
        matchCount++;
      } else {
        comparison.allMatch = false;
      }
    }

    comparison.accuracy = Math.round((matchCount / fields.length) * 100);
    return comparison;
  }
}

module.exports = PythonOCRService;
