const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Downloader = require('../backend/downloader');

jest.mock('fs');
jest.mock('child_process');

describe('Downloader', () => {
    let downloader;
    let mockCallback;
    const tempDir = '/tmp/clipster';
    const validUrl = 'https://www.youtube.com/live/abc123';

    beforeEach(() => {
        jest.clearAllMocks();
        mockCallback = jest.fn();
        
        // Mock file existence checks
        fs.existsSync.mockImplementation((path) => {
            if (path === tempDir) return true;
            return false;
        });

        downloader = new Downloader(tempDir);
        downloader.setStatusCallback(mockCallback);

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

    describe('validateLiveStream', () => {
        it('should validate live stream URL', async () => {
            const mockProcess = spawn();
            mockProcess.on.mockImplementation((event, callback) => {
                if (event === 'close') setTimeout(() => callback(0), 100);
            });

            const result = await downloader.validateLiveStream(validUrl);
            expect(result).toBe(true);
            expect(spawn).toHaveBeenCalledWith('yt-dlp', expect.arrayContaining(['--live-from-start']));
        }, 10000);

        it('should handle validation errors', async () => {
            const mockProcess = spawn();
            mockProcess.on.mockImplementation((event, callback) => {
                if (event === 'error') setTimeout(() => callback(new Error('Validation failed')), 100);
                if (event === 'close') setTimeout(() => callback(1), 200);
            });

            const result = await downloader.validateLiveStream('invalid-url');
            expect(result).toBe(false);
            expect(mockCallback).toHaveBeenCalledWith('Error: Not a valid live stream URL');
        }, 10000);
    });

    describe('startDownload', () => {
        it('should start download process', async () => {
            const mockProcess = spawn();
            mockProcess.on.mockImplementation((event, callback) => {
                if (event === 'close') setTimeout(() => callback(0), 100);
            });

            jest.spyOn(downloader, 'validateLiveStream').mockResolvedValue(true);
            await downloader.startDownload(validUrl);
            expect(spawn).toHaveBeenCalledWith('yt-dlp', expect.any(Array));
            expect(mockCallback).toHaveBeenCalledWith('Starting download...');
        }, 10000);

        it('should handle download errors', async () => {
            const mockProcess = spawn();
            mockProcess.on.mockImplementation((event, callback) => {
                if (event === 'error') setTimeout(() => callback(new Error('Download failed')), 100);
                if (event === 'close') setTimeout(() => callback(1), 200);
            });

            jest.spyOn(downloader, 'validateLiveStream').mockResolvedValue(true);
            await expect(downloader.startDownload(validUrl))
                .rejects.toThrow('Download failed');
            expect(mockCallback).toHaveBeenCalledWith('Error: Download failed');
        }, 10000);
    });

    describe('startFileFixation', () => {
        it('should start file fixation', () => {
            const mockProcess = spawn();
            downloader.startFileFixation();
            expect(spawn).toHaveBeenCalledWith('ffmpeg', expect.any(Array));
            expect(mockCallback).toHaveBeenCalledWith('Starting file fixation...');
        });

        it('should handle fixation errors', () => {
            const mockProcess = spawn();
            mockProcess.on.mockImplementation((event, callback) => {
                if (event === 'error') callback(new Error('Failed to fix file'));
            });

            downloader.startFileFixation();
            expect(mockCallback).toHaveBeenCalledWith('Error: Failed to fix file');
        });
    });
}); 