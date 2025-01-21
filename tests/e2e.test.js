const path = require('path');
const fs = require('fs');
const io = require('socket.io-client');

// Constants
const PORT = 3001;
const SERVER_URL = `http://localhost:${PORT}`;
const TEST_LIVE_URL = 'https://www.youtube.com/watch?v=Nx8NVwURzp8';
const MAX_TEST_DURATION = 180000; // 3 minutes
const CLIPS_TO_CREATE = 1;
const TARGET_WORD_COUNT = 100;

// Set Jest timeout
jest.setTimeout(MAX_TEST_DURATION * 2);

describe('End-to-end test for download -> transcribe -> create clip workflow', () => {
    let server = null;
    let socket = null;
    let startTime = null;
    let downloadStarted = false;
    let transcriptionStarted = false;
    let totalWordCount = 0;
    let transcribedSegments = [];

    beforeAll(async () => {
        // Create temp directory if it doesn't exist
        const tempDir = path.join(__dirname, '../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Import and start server
        const { startServer } = require('../backend/server');
        try {
            server = await startServer(PORT);
            console.log('Server running on port', PORT);

            // Initialize socket.io client
            socket = io(SERVER_URL);
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Socket connection timeout'));
                }, 5000);
                
                socket.on('connect', () => {
                    clearTimeout(timeout);
                    console.log('Socket connected');
                    resolve();
                });
                
                socket.on('connect_error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });

            startTime = Date.now();
        } catch (error) {
            console.error('Setup error:', error);
            throw error;
        }
    }, 30000); // 30 seconds for setup

    test('should download, transcribe, and create clip', (done) => {
        // Track test state
        let clipCreated = false;

        // Handle download status updates
        socket.on('downloadStatus', (status) => {
            console.log('Download status:', status);
            if (status === 'Starting download...') {
                downloadStarted = true;
            }
        });

        // Handle transcription status updates
        socket.on('transcriptionStatus', (status) => {
            console.log('Transcription status:', status);
            if (status.includes('Transcribed')) {
                transcriptionStarted = true;
            }
        });

        // Handle transcription updates
        socket.on('transcriptionUpdate', (data) => {
            console.log('Transcription update:', data);
            if (data.segments && data.segments.length > 0) {
                transcribedSegments.push(...data.segments);
                totalWordCount = data.totalWordCount || transcribedSegments.reduce((count, segment) => 
                    count + segment.text.trim().split(/\s+/).length, 0);

                // If we have enough words, create a clip
                if (totalWordCount >= TARGET_WORD_COUNT && !clipCreated) {
                    clipCreated = true;
                    const lastSegment = transcribedSegments[transcribedSegments.length - 1];
                    socket.emit('createClip', {
                        startTime: transcribedSegments[0].start,
                        endTime: lastSegment.end
                    });
                }
            }
        });

        // Handle clip creation
        socket.on('clipCreated', (data) => {
            console.log('Clip created:', data);
            socket.emit('stop');
            done();
        });

        // Handle errors
        socket.on('error', (error) => {
            console.error('Socket error:', error);
            done(new Error(error));
        });

        // Start the download
        socket.emit('startDownload', TEST_LIVE_URL);

        // Set a timeout to fail the test if it takes too long
        setTimeout(() => {
            const elapsedTime = Date.now() - startTime;
            console.log(`Test state after ${elapsedTime}ms:`);
            console.log(`- Download started: ${downloadStarted}`);
            console.log(`- Transcription started: ${transcriptionStarted}`);
            console.log(`- Words transcribed: ${totalWordCount}`);
            console.log(`- Clips created: ${clipCreated ? 1 : 0}/${CLIPS_TO_CREATE}`);
            done(new Error('Test timeout reached'));
        }, MAX_TEST_DURATION);
    });

    afterAll(async () => {
        console.log('=== Starting Cleanup ===');
        
        try {
            // First stop any ongoing operations
            if (socket && socket.connected) {
                console.log('Stopping operations...');
                socket.emit('stop');
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Disconnect socket
            if (socket) {
                console.log('Disconnecting socket...');
                socket.disconnect();
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Clean up temp directory
            const tempDir = path.join(__dirname, '../temp');
            if (fs.existsSync(tempDir)) {
                console.log('Cleaning temp directory...');
                const files = fs.readdirSync(tempDir);
                for (const file of files) {
                    const filePath = path.join(tempDir, file);
                    try {
                        fs.unlinkSync(filePath);
                        console.log('Deleted:', filePath);
                    } catch (error) {
                        console.error(`Error deleting ${filePath}:`, error);
                    }
                }
            }

            // Close server
            if (server) {
                console.log('Closing server...');
                const { cleanup } = require('../backend/server');
                await cleanup(server);
                server = null;
            }

            console.log('=== Cleanup Completed ===');
        } catch (error) {
            console.error('Cleanup error:', error);
            throw error;
        }
    }, 30000); // 30 seconds for cleanup
}); 