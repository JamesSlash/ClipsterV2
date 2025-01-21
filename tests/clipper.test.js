const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Clipper = require('../backend/clipper');

jest.mock('fs');
jest.mock('child_process');

describe('Clipper', () => {
    let clipper;
    let mockCallback;
    const tempDir = '/tmp/clipster';
    const sourceFile = path.join(tempDir, 'fixed_current.ts');
    const clipsDir = path.join(tempDir, 'clips');

    beforeEach(() => {
        jest.clearAllMocks();
        mockCallback = jest.fn();
        
        // Mock file existence checks
        fs.existsSync.mockImplementation((path) => {
            if (path === sourceFile) return true;
            if (path === clipsDir) return false;
            return true;
        });

        clipper = new Clipper(tempDir);
        clipper.setStatusCallback(mockCallback);

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

    describe('createClip', () => {
        it('should create clip successfully', async () => {
            const mockProcess = spawn();
            mockProcess.on.mockImplementation((event, callback) => {
                if (event === 'close') setTimeout(() => callback(0), 100);
            });

            await clipper.createClip(0, 30);
            expect(spawn).toHaveBeenCalledWith('ffmpeg', expect.any(Array));
            expect(mockCallback).toHaveBeenCalledWith('Creating clip...');
        }, 10000);

        it('should handle non-existent source file', async () => {
            fs.existsSync.mockReturnValueOnce(false);
            clipper.setStatusCallback(mockCallback);

            await expect(clipper.createClip(0, 30))
                .rejects.toThrow('Source video file not found');
            expect(mockCallback).toHaveBeenCalledWith('Error: Source video file not found');
        });

        it('should validate clip duration', async () => {
            clipper.setStatusCallback(mockCallback);

            await expect(clipper.createClip(0, 301))
                .rejects.toThrow('Clip duration cannot exceed 300 seconds');
            expect(mockCallback).toHaveBeenCalledWith('Error: Clip duration cannot exceed 300 seconds');

            await expect(clipper.createClip(0, 0))
                .rejects.toThrow('Clip duration must be at least 1 second');
            expect(mockCallback).toHaveBeenCalledWith('Error: Clip duration must be at least 1 second');
        });

        it('should handle ffmpeg errors', async () => {
            const mockProcess = spawn();
            mockProcess.on.mockImplementation((event, callback) => {
                if (event === 'error') setTimeout(() => callback(new Error('Failed to create clip')), 100);
                if (event === 'close') setTimeout(() => callback(1), 200);
            });

            await expect(clipper.createClip(0, 30))
                .rejects.toThrow('Failed to create clip');
            expect(mockCallback).toHaveBeenCalledWith('Error: Failed to create clip');
        }, 10000);
    });

    describe('cleanup', () => {
        it('should remove all clips', () => {
            fs.readdirSync.mockReturnValue(['clip1.mp4', 'clip2.mp4']);
            fs.unlinkSync.mockImplementation(() => {});
            clipper.setStatusCallback(mockCallback);

            clipper.cleanup();
            expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
            expect(mockCallback).toHaveBeenCalledWith('Cleaning up clips...');
        });

        it('should handle cleanup errors', () => {
            fs.readdirSync.mockImplementation(() => {
                throw new Error('Failed to read directory');
            });
            clipper.setStatusCallback(mockCallback);

            clipper.cleanup();
            expect(mockCallback).toHaveBeenCalledWith('Error: Failed to read directory');
        });
    });
}); 