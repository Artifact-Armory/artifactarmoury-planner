// backend/src/middleware/upload.ts
// Multer file upload middleware with validation and storage

import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import type { AuthRequest } from './auth';

// ============================================================================
// CONFIGURATION
// ============================================================================

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '104857600'); // 100MB default
const MAX_IMAGE_SIZE = parseInt(process.env.MAX_IMAGE_SIZE || '10485760'); // 10MB default

// Allowed file types
const ALLOWED_MODEL_TYPES = ['.stl', '.obj'];
const ALLOWED_IMAGE_TYPES = ['.jpg', '.jpeg', '.png', '.webp'];

// ============================================================================
// STORAGE CONFIGURATION
// ============================================================================

// Create upload directories if they don't exist
const ensureUploadDirs = async () => {
  const dirs = [
    `${UPLOAD_DIR}/models`,
    `${UPLOAD_DIR}/images`,
    `${UPLOAD_DIR}/thumbnails`,
    `${UPLOAD_DIR}/temp`
  ];

  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      logger.error(`Failed to create upload directory: ${dir}`, { error });
    }
  }
};

ensureUploadDirs();

// ============================================================================
// MULTER STORAGE ENGINES
// ============================================================================

// Storage for 3D model files (STL, OBJ)
const modelStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const userId = (req as AuthRequest).userId;
    const userDir = `${UPLOAD_DIR}/models/${userId}`;
    
    try {
      await fs.mkdir(userDir, { recursive: true });
      cb(null, userDir);
    } catch (error) {
      logger.error('Failed to create user model directory', { error, userId });
      cb(error as Error, userDir);
    }
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-random-originalname
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const ext = path.extname(file.originalname).toLowerCase();
    const basename = path.basename(file.originalname, ext)
      .replace(/[^a-z0-9]/gi, '_')
      .substring(0, 50);
    
    const filename = `${timestamp}-${random}-${basename}${ext}`;
    cb(null, filename);
  }
});

// Storage for images (thumbnails, gallery photos)
const imageStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const userId = (req as AuthRequest).userId;
    const userDir = `${UPLOAD_DIR}/images/${userId}`;
    
    try {
      await fs.mkdir(userDir, { recursive: true });
      cb(null, userDir);
    } catch (error) {
      logger.error('Failed to create user image directory', { error, userId });
      cb(error as Error, userDir);
    }
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const ext = path.extname(file.originalname).toLowerCase();
    const basename = path.basename(file.originalname, ext)
      .replace(/[^a-z0-9]/gi, '_')
      .substring(0, 50);
    
    const filename = `${timestamp}-${random}-${basename}${ext}`;
    cb(null, filename);
  }
});

// Temporary storage (for processing before final location)
const tempStorage = multer.diskStorage({
  destination: `${UPLOAD_DIR}/temp`,
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `temp-${timestamp}-${random}${ext}`;
    cb(null, filename);
  }
});

// ============================================================================
// FILE FILTERS
// ============================================================================

// Filter for 3D model files
const modelFileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (!ALLOWED_MODEL_TYPES.includes(ext)) {
    logger.warn('Invalid model file type attempted', {
      filename: file.originalname,
      mimetype: file.mimetype,
      userId: (req as AuthRequest).userId
    });
    
    cb(new Error(`Invalid file type. Allowed types: ${ALLOWED_MODEL_TYPES.join(', ')}`));
    return;
  }
  
  cb(null, true);
};

// Filter for image files
const imageFileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (!ALLOWED_IMAGE_TYPES.includes(ext)) {
    logger.warn('Invalid image file type attempted', {
      filename: file.originalname,
      mimetype: file.mimetype,
      userId: (req as AuthRequest).userId
    });
    
    cb(new Error(`Invalid file type. Allowed types: ${ALLOWED_IMAGE_TYPES.join(', ')}`));
    return;
  }
  
  cb(null, true);
};

// ============================================================================
// MULTER INSTANCES
// ============================================================================

// Upload 3D model files
export const uploadModel = multer({
  storage: modelStorage,
  fileFilter: modelFileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  }
}).single('model');

// Upload single image
export const uploadImage = multer({
  storage: imageStorage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: MAX_IMAGE_SIZE,
    files: 1
  }
}).single('image');

// Upload multiple images (for model gallery)
export const uploadImages = multer({
  storage: imageStorage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: MAX_IMAGE_SIZE,
    files: 10 // Max 10 images at once
  }
}).array('images', 10);

// Upload model + thumbnail together
export const uploadModelWithThumbnail = multer({
  storage: tempStorage,
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'model') {
      modelFileFilter(req, file, cb);
    } else if (file.fieldname === 'thumbnail') {
      imageFileFilter(req, file, cb);
    } else {
      cb(new Error('Unexpected field'));
    }
  },
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 2
  }
}).fields([
  { name: 'model', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]);

// ============================================================================
// ERROR HANDLING MIDDLEWARE
// ============================================================================

/**
 * Handle Multer upload errors
 * Should be used after upload middleware
 */
export function handleUploadError(
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (error instanceof multer.MulterError) {
    logger.warn('Multer upload error', {
      code: error.code,
      field: error.field,
      message: error.message,
      userId: (req as AuthRequest).userId
    });

    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        res.status(413).json({
          error: 'File too large',
          message: `Maximum file size is ${MAX_FILE_SIZE / 1024 / 1024}MB`,
          maxSize: MAX_FILE_SIZE
        });
        return;

      case 'LIMIT_FILE_COUNT':
        res.status(400).json({
          error: 'Too many files',
          message: 'Maximum number of files exceeded'
        });
        return;

      case 'LIMIT_UNEXPECTED_FILE':
        res.status(400).json({
          error: 'Unexpected field',
          message: `Unexpected file field: ${error.field}`
        });
        return;

      default:
        res.status(400).json({
          error: 'Upload failed',
          message: error.message
        });
        return;
    }
  }

  // Handle other upload errors (like file filter errors)
  if (error) {
    logger.error('File upload error', {
      error: error.message,
      userId: (req as AuthRequest).userId
    });

    res.status(400).json({
      error: 'Upload failed',
      message: error.message
    });
    return;
  }

  next();
}

// ============================================================================
// VALIDATION MIDDLEWARE
// ============================================================================

/**
 * Validate uploaded model file exists
 */
export function validateModelUpload(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.file) {
    res.status(400).json({
      error: 'No file uploaded',
      message: 'Please upload a 3D model file (.stl or .obj)'
    });
    return;
  }

  // Store file info for later use
  (req as any).uploadedFile = {
    path: req.file.path,
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype
  };

  logger.info('Model file uploaded', {
    filename: req.file.filename,
    size: req.file.size,
    userId: (req as AuthRequest).userId
  });

  next();
}

/**
 * Validate uploaded image file exists
 */
export function validateImageUpload(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.file) {
    res.status(400).json({
      error: 'No file uploaded',
      message: 'Please upload an image file'
    });
    return;
  }

  (req as any).uploadedFile = {
    path: req.file.path,
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype
  };

  logger.info('Image file uploaded', {
    filename: req.file.filename,
    size: req.file.size,
    userId: (req as AuthRequest).userId
  });

  next();
}

/**
 * Validate multiple uploaded images
 */
export function validateImagesUpload(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const files = req.files as Express.Multer.File[];
  
  if (!files || files.length === 0) {
    res.status(400).json({
      error: 'No files uploaded',
      message: 'Please upload at least one image'
    });
    return;
  }

  (req as any).uploadedFiles = files.map(file => ({
    path: file.path,
    filename: file.filename,
    originalName: file.originalname,
    size: file.size,
    mimetype: file.mimetype
  }));

  logger.info('Multiple images uploaded', {
    count: files.length,
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
    userId: (req as AuthRequest).userId
  });

  next();
}

// ============================================================================
// FILE CLEANUP UTILITIES
// ============================================================================

/**
 * Delete uploaded file (for cleanup on error)
 */
export async function deleteUploadedFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
    logger.debug('Deleted uploaded file', { filePath });
  } catch (error) {
    logger.error('Failed to delete uploaded file', { error, filePath });
  }
}

/**
 * Delete multiple uploaded files
 */
export async function deleteUploadedFiles(filePaths: string[]): Promise<void> {
  await Promise.all(filePaths.map(deleteUploadedFile));
}

/**
 * Cleanup middleware - delete uploaded files on error
 * Add this after upload routes to clean up failed uploads
 */
export async function cleanupOnError(
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Delete single file if exists
  if (req.file) {
    await deleteUploadedFile(req.file.path);
  }

  // Delete multiple files if exist
  if (req.files) {
    if (Array.isArray(req.files)) {
      await deleteUploadedFiles(req.files.map(f => f.path));
    } else {
      // Files object with named fields
      const filePaths = Object.values(req.files)
        .flat()
        .map((f: any) => f.path);
      await deleteUploadedFiles(filePaths);
    }
  }

  next(error);
}

// ============================================================================
// TEMP FILE CLEANUP
// ============================================================================

/**
 * Clean up old temporary files (run periodically)
 * Deletes files older than 24 hours from temp directory
 */
export async function cleanupTempFiles(): Promise<void> {
  const tempDir = `${UPLOAD_DIR}/temp`;
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

  try {
    const files = await fs.readdir(tempDir);
    const now = Date.now();

    for (const file of files) {
      const filePath = path.join(tempDir, file);
      
      try {
        const stats = await fs.stat(filePath);
        const age = now - stats.mtimeMs;

        if (age > maxAge) {
          await fs.unlink(filePath);
          logger.debug('Deleted old temp file', { file, ageHours: age / (60 * 60 * 1000) });
        }
      } catch (error) {
        logger.error('Error processing temp file', { error, file });
      }
    }

    logger.info('Temp file cleanup completed');
  } catch (error) {
    logger.error('Failed to cleanup temp files', { error });
  }
}

// Run cleanup daily
setInterval(cleanupTempFiles, 24 * 60 * 60 * 1000);

// ============================================================================
// FILE INFO UTILITIES
// ============================================================================

/**
 * Get file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Get relative path for file (for storing in database)
 */
export function getRelativePath(absolutePath: string): string {
  return absolutePath.replace(UPLOAD_DIR + '/', '');
}

/**
 * Get absolute path from relative path
 */
export function getAbsolutePath(relativePath: string): string {
  return path.join(UPLOAD_DIR, relativePath);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  uploadModel,
  uploadImage,
  uploadImages,
  uploadModelWithThumbnail,
  handleUploadError,
  validateModelUpload,
  validateImageUpload,
  validateImagesUpload,
  cleanupOnError,
  deleteUploadedFile,
  deleteUploadedFiles,
  cleanupTempFiles,
  formatFileSize,
  getRelativePath,
  getAbsolutePath
};