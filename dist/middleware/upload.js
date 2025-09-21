"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupTempFiles = exports.validateAudioFile = exports.handleUploadError = exports.upload = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const speech_1 = require("@/services/speech");
// Ensure upload directory exists
const uploadDir = process.env.UPLOAD_DIR || 'uploads';
if (!fs_1.default.existsSync(uploadDir)) {
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
}
// Configure multer for audio file uploads
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Generate unique filename with timestamp
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path_1.default.extname(file.originalname);
        cb(null, `audio-${uniqueSuffix}${extension}`);
    }
});
// File filter for audio files - updated for @xenova/transformers compatibility
const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = [
        'audio/webm',
        'audio/mp3',
        'audio/wav',
        'audio/x-wav',
        'audio/wave',
        'audio/x-pn-wav',
        'audio/flac',
        'audio/ogg',
        'audio/mpeg',
        'audio/mp4',
        'audio/m4a',
        'audio/aac'
    ];
    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    }
    else {
        cb(new Error(`Invalid file type. Allowed types: ${allowedMimeTypes.join(', ')}`));
    }
};
// Create multer instance
exports.upload = (0, multer_1.default)({
    storage,
    fileFilter,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760'), // 10MB default
        files: 1 // Only allow one file at a time
    }
});
// Middleware to handle file upload errors
const handleUploadError = (error, req, res, next) => {
    if (error instanceof multer_1.default.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                error: 'File too large',
                message: `Maximum file size is ${parseInt(process.env.MAX_FILE_SIZE || '10485760') / 1024 / 1024}MB`
            });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                error: 'Too many files',
                message: 'Only one file is allowed per request'
            });
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                error: 'Unexpected file field',
                message: 'File must be uploaded in the "audio" field'
            });
        }
    }
    if (error.message.includes('Invalid file type')) {
        return res.status(400).json({
            error: 'Invalid file type',
            message: error.message
        });
    }
    next(error);
};
exports.handleUploadError = handleUploadError;
// Middleware to validate uploaded audio file
const validateAudioFile = (req, res, next) => {
    if (!req.file) {
        return next();
    }
    const validation = speech_1.SpeechService.validateAudioFile(req.file);
    if (!validation.valid) {
        // Clean up the uploaded file
        fs_1.default.unlinkSync(req.file.path);
        return res.status(400).json({
            error: 'Invalid audio file',
            message: validation.error
        });
    }
    next();
};
exports.validateAudioFile = validateAudioFile;
// Cleanup middleware to remove temporary files
const cleanupTempFiles = (req, res, next) => {
    const originalSend = res.send;
    res.send = function (data) {
        // Clean up uploaded file after response is sent
        if (req.file && req.file.path) {
            try {
                fs_1.default.unlinkSync(req.file.path);
            }
            catch (error) {
                console.error('Failed to cleanup temp file:', error);
            }
        }
        return originalSend.call(this, data);
    };
    next();
};
exports.cleanupTempFiles = cleanupTempFiles;
//# sourceMappingURL=upload.js.map