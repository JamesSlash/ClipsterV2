const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Transcriber = require('../backend/transcriber');

jest.mock('fs');
jest.mock('child_process');

describe('Transcriber', () => {
    let transcriber;
    let mockCallback;
    const tempDir = '/tmp/clipster';
    const inputFile = path.join(tempDir, 'fixed_current.ts');
    const audioDir = path.join(tempDir, 'audio');
    const startTime = 0;

    beforeEach(() => {
        jest.clearAllMocks();
        mockCallback = jest.fn();
        
        // Mock file existence checks
        fs.existsSync.mockImplementation((path) => {
            if (path === inputFile) return true;
            if (path === audioDir) return false;
            return false;
        });

        transcriber = new Transcriber(tempDir);
        transcriber.setStatusCallback(mockCallback);

        // Mock spawn process
        spawn.mockImplementation(() => {
            const mockProcess = {
                on: jest.fn(),
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() }
            };
            mockProcess.on.mockImplementation((event, callback) => {
                if (event === 'close') setTimeout(() => callback(0), 100);
            });
            return mockProcess;
        });
    });

    describe('extractAudio', () => {
        it('should extract audio successfully', async () => {
            const mockProcess = spawn();
            mockProcess.on.mockImplementation((event, callback) => {
                if (event === 'close') setTimeout(() => callback(0), 100);
            });

            const audioFile = await transcriber.extractAudio(inputFile, startTime);
            expect(audioFile).toMatch(/audio_\d+\.wav$/);
            expect(spawn).toHaveBeenCalledWith('ffmpeg', expect.any(Array));
            expect(mockCallback).toHaveBeenCalledWith('Extracting audio...');
        }, 10000);

        it('should handle non-existent input file', async () => {
            fs.existsSync.mockReturnValue(false);
            await expect(transcriber.extractAudio(inputFile, startTime))
                .rejects.toThrow('Input video file not found');
            expect(mockCallback).toHaveBeenCalledWith('Error: Input video file not found');
        }, 10000);

        it('should handle ffmpeg errors', async () => {
            const mockProcess = spawn();
            mockProcess.on.mockImplementation((event, callback) => {
                if (event === 'error') setTimeout(() => callback(new Error('Failed to extract audio')), 100);
                if (event === 'close') setTimeout(() => callback(1), 200);
            });

            await expect(transcriber.extractAudio(inputFile, startTime))
                .rejects.toThrow('Failed to extract audio');
            expect(mockCallback).toHaveBeenCalledWith('Error: Failed to extract audio');
        }, 10000);
    });

    describe('transcribeAudio', () => {
        const audioFile = path.join(audioDir, 'audio_123.wav');

        it('should transcribe audio successfully', async () => {
            const mockProcess = spawn();
            mockProcess.stdout.on.mockImplementation((event, callback) => {
                if (event === 'data') {
                    callback(Buffer.from(JSON.stringify({
                        text: 'Test transcription',
                        segments: [{ start: 0, end: 5, text: 'Test transcription' }]
                    })));
                }
            });
            mockProcess.on.mockImplementation((event, callback) => {
                if (event === 'close') setTimeout(() => callback(0), 100);
            });

            fs.existsSync.mockReturnValue(true);
            const result = await transcriber.transcribeAudio(audioFile);
            expect(result).toEqual({
                text: 'Test transcription',
                segments: [{ start: 0, end: 5, text: 'Test transcription' }]
            });
            expect(mockCallback).toHaveBeenCalledWith('Transcribing audio...');
        }, 10000);

        it('should handle non-existent audio file', async () => {
            fs.existsSync.mockReturnValue(false);
            await expect(transcriber.transcribeAudio(audioFile))
                .rejects.toThrow('Audio file not found');
            expect(mockCallback).toHaveBeenCalledWith('Error: Audio file not found');
        }, 10000);

        it('should handle whisper errors', async () => {
            const mockProcess = spawn();
            mockProcess.on.mockImplementation((event, callback) => {
                if (event === 'error') setTimeout(() => callback(new Error('Failed to transcribe')), 100);
                if (event === 'close') setTimeout(() => callback(1), 200);
            });

            fs.existsSync.mockReturnValue(true);
            await expect(transcriber.transcribeAudio(audioFile))
                .rejects.toThrow('Failed to transcribe');
            expect(mockCallback).toHaveBeenCalledWith('Error: Failed to transcribe');
        }, 10000);
    });

    describe('cleanup', () => {
        it('should remove all audio files', () => {
            const audioFiles = ['audio_1.wav', 'audio_2.wav'];
            fs.readdirSync.mockReturnValue(audioFiles);
            
            transcriber.cleanup();
            expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
            expect(mockCallback).toHaveBeenCalledWith('Cleaning up audio files...');
        });

        it('should handle cleanup errors', () => {
            fs.readdirSync.mockImplementation(() => {
                throw new Error('Failed to read directory');
            });

            transcriber.cleanup();
            expect(mockCallback).toHaveBeenCalledWith('Error: Failed to read directory');
        });
    });
}); 