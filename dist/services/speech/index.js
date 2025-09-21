"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpeechService = void 0;
const fs_1 = __importDefault(require("fs"));
const transformers_1 = require("@xenova/transformers");
const wavefile_1 = require("wavefile");
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const ffmpeg_static_1 = __importDefault(require("ffmpeg-static"));
// Initialize the speech recognition pipeline
let transcriber = null;
// Set ffmpeg path
if (ffmpeg_static_1.default) {
    fluent_ffmpeg_1.default.setFfmpegPath(ffmpeg_static_1.default);
}
// Initialize the pipeline lazily
async function getTranscriber() {
    if (!transcriber) {
        console.log('🎤 Initializing Whisper speech recognition...');
        try {
            transcriber = await (0, transformers_1.pipeline)('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
            console.log('✅ Whisper speech recognition initialized successfully');
        }
        catch (error) {
            console.error('❌ Failed to initialize Whisper:', error);
            throw new Error('Failed to initialize speech recognition');
        }
    }
    return transcriber;
}
class SpeechService {
    static async transcribeAudioFile(audioFilePath) {
        try {
            const transcriber = await getTranscriber();
            // Read and process the audio file
            const audioData = await this.processAudioFile(audioFilePath);
            const result = await transcriber(audioData);
            return result.text || '';
        }
        catch (error) {
            console.error('Speech transcription error:', error);
            throw new Error('Failed to transcribe audio file');
        }
    }
    static async convertToWav(inputPath) {
        return new Promise((resolve, reject) => {
            const outputPath = `/tmp/converted_${Date.now()}_${Math.random().toString(36).substring(2, 11)}.wav`;
            (0, fluent_ffmpeg_1.default)(inputPath)
                .toFormat('wav')
                .audioChannels(1) // Convert to mono
                .audioFrequency(16000) // Set sample rate to 16kHz
                .on('end', () => {
                resolve(outputPath);
            })
                .on('error', (err) => {
                reject(new Error(`Audio conversion failed: ${err.message}`));
            })
                .save(outputPath);
        });
    }
    static async processAudioFile(audioFilePath) {
        let wavFilePath = audioFilePath;
        let shouldCleanupWav = false;
        try {
            // Check if the file is already a WAV file
            const fileExtension = audioFilePath.toLowerCase().split('.').pop();
            if (fileExtension !== 'wav') {
                // Convert to WAV format first
                wavFilePath = await this.convertToWav(audioFilePath);
                shouldCleanupWav = true;
            }
            // Read the WAV file
            const buffer = fs_1.default.readFileSync(wavFilePath);
            // Process the audio using wavefile
            const wav = new wavefile_1.WaveFile(buffer);
            wav.toBitDepth('32f'); // Pipeline expects input as a Float32Array
            wav.toSampleRate(16000); // Whisper expects audio with a sampling rate of 16000
            let audioData = wav.getSamples();
            // Handle multi-channel audio by merging to mono
            if (Array.isArray(audioData)) {
                if (audioData.length > 1) {
                    const SCALING_FACTOR = Math.sqrt(2);
                    // Merge channels (into first channel to save memory)
                    for (let i = 0; i < audioData[0].length; ++i) {
                        audioData[0][i] = SCALING_FACTOR * (audioData[0][i] + audioData[1][i]) / 2;
                    }
                }
                // Select first channel
                audioData = audioData[0];
            }
            return new Float32Array(audioData);
        }
        finally {
            // Clean up converted WAV file if we created one
            if (shouldCleanupWav && wavFilePath !== audioFilePath) {
                try {
                    fs_1.default.unlinkSync(wavFilePath);
                }
                catch (cleanupError) {
                    console.warn('Failed to cleanup converted WAV file:', cleanupError);
                }
            }
        }
    }
    static async convertAudioBufferToText(audioBuffer, mimeType) {
        try {
            // For buffer-based transcription, we need to write the buffer to a temporary file
            // and then process it with wavefile
            const tempFilePath = `/tmp/audio_${Date.now()}_${Math.random().toString(36).substring(2, 11)}.${this.getFileExtension(mimeType)}`;
            // Write buffer to temporary file
            fs_1.default.writeFileSync(tempFilePath, audioBuffer);
            try {
                const transcriber = await getTranscriber();
                // Process the audio file
                const audioData = await this.processAudioFile(tempFilePath);
                const result = await transcriber(audioData);
                return result.text || '';
            }
            finally {
                // Clean up temporary file
                try {
                    fs_1.default.unlinkSync(tempFilePath);
                }
                catch (cleanupError) {
                    console.warn('Failed to cleanup temporary file:', cleanupError);
                }
            }
        }
        catch (error) {
            console.error('Speech transcription error:', error);
            throw new Error('Failed to transcribe audio buffer');
        }
    }
    static getFileExtension(mimeType) {
        const mimeToExt = {
            'audio/wav': 'wav',
            'audio/x-wav': 'wav',
            'audio/wave': 'wav',
            'audio/x-pn-wav': 'wav',
            'audio/webm': 'webm',
            'audio/mp3': 'mp3',
            'audio/mpeg': 'mp3',
            'audio/flac': 'flac',
            'audio/ogg': 'ogg',
            'audio/mp4': 'mp4'
        };
        return mimeToExt[mimeType] || 'wav';
    }
    static validateAudioFile(file) {
        // @xenova/transformers supports a wide range of audio formats
        const allowedMimeTypes = [
            'audio/wav',
            'audio/x-wav',
            'audio/wave',
            'audio/x-pn-wav',
            'audio/webm',
            'audio/mp3',
            'audio/mpeg',
            'audio/flac',
            'audio/ogg',
            'audio/mp4',
            'audio/m4a',
            'audio/aac'
        ];
        const maxSize = parseInt(process.env.MAX_FILE_SIZE || '10485760'); // 10MB default
        if (!allowedMimeTypes.includes(file.mimetype)) {
            return {
                valid: false,
                error: `Unsupported audio format. Allowed formats: ${allowedMimeTypes.join(', ')}`
            };
        }
        if (file.size > maxSize) {
            return {
                valid: false,
                error: `File too large. Maximum size: ${maxSize / 1024 / 1024}MB`
            };
        }
        return { valid: true };
    }
}
exports.SpeechService = SpeechService;
//# sourceMappingURL=index.js.map