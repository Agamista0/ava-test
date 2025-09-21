export declare class SpeechService {
    static transcribeAudioFile(audioFilePath: string): Promise<string>;
    private static convertToWav;
    private static processAudioFile;
    static convertAudioBufferToText(audioBuffer: Buffer, mimeType: string): Promise<string>;
    private static getFileExtension;
    static validateAudioFile(file: Express.Multer.File): {
        valid: boolean;
        error?: string;
    };
}
//# sourceMappingURL=index.d.ts.map