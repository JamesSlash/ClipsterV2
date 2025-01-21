const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const { Clipper } = require('./clipper');
const { Downloader } = require('./downloader');
const { Transcriber } = require('./transcriber');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true,
        transports: ['websocket', 'polling']
    },
    allowEIO3: true
});

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
}));
app.use(bodyParser.json());

// Serve frontend static files
const frontendPath = path.join(__dirname, '..', 'frontend');
console.log('Serving frontend from:', frontendPath);
app.use(express.static(frontendPath));

// Serve clips directory
const clipsPath = path.join(__dirname, '..', 'temp', 'clips');
console.log('Serving clips from:', clipsPath);
app.use('/clips', express.static(clipsPath));

// Ensure clips directory exists
if (!fs.existsSync(clipsPath)) {
    fs.mkdirSync(clipsPath, { recursive: true });
}

// Root route for testing
app.get('/', (req, res) => {
    console.log('Received request for root route');
    res.sendFile(path.join(frontendPath, 'index.html'));
});

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, '..', 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
    console.log('Created temp directory:', tempDir);
}

// Initialize components
const downloader = new Downloader(tempDir, (status) => {
    io.emit('downloadStatus', status);
    console.log('Download status:', status);
});

const transcriber = new Transcriber(tempDir);
transcriber.setStatusCallback((status) => {
    io.emit('transcriptionStatus', status);
    console.log('Transcription status:', status);
});

const clipper = new Clipper(tempDir, (status) => {
    io.emit('clipStatus', status);
    console.log('Clip status:', status);
});

// Track active clients
const activeClients = new Set();

io.on('connection', (socket) => {
    console.log('Client connected, ID:', socket.id);
    activeClients.add(socket);
    
    // Emit initial connection status
    socket.emit('connectionStatus', { status: 'connected' });

    // Handle start download request
    socket.on('startDownload', async (data) => {
        try {
            const { url, model, language } = typeof data === 'string' ? { url: data, model: 'base', language: 'auto' } : data;
            console.log('Starting download for URL:', url, 'with model:', model, 'language:', language);
            
            // Set up transcription callbacks before starting
            transcriber.setStatusCallback((status) => {
                console.log('Transcription status update:', status);
                socket.emit('transcriptionStatus', status);
            });

            transcriber.updateCallback = (data) => {
                console.log('Received transcription update:', {
                    segmentCount: data.segments ? data.segments.length : 0,
                    totalWordCount: data.totalWordCount,
                    model: data.model,
                    language: data.language,
                    firstSegment: data.segments && data.segments.length > 0 ? data.segments[0] : null
                });

                if (!data || !data.segments || !Array.isArray(data.segments)) {
                    console.warn('Invalid transcription data structure:', data);
                    return;
                }

                console.log('Emitting transcription update to client');
                socket.emit('transcriptionUpdate', {
                    segments: data.segments,
                    totalWordCount: data.totalWordCount,
                    model: data.model,
                    language: data.language
                });
            };

            // Set the model and language if provided
            if (model) {
                try {
                    transcriber.setModel(model);
                } catch (error) {
                    console.warn('Invalid model specified:', error.message);
                    socket.emit('error', { message: error.message });
                    return;
                }
            }

            if (language) {
                try {
                    transcriber.setLanguage(language);
                } catch (error) {
                    console.warn('Invalid language specified:', error.message);
                    socket.emit('error', { message: error.message });
                    return;
                }
            }

            // Start download
            console.log('Starting download process...');
            await downloader.startDownload(url);
            console.log('Download started successfully');

            // Start transcription
            console.log('Starting transcription process...');
            transcriber.startTranscription();
            console.log('Transcription started successfully');

            // Emit confirmation to client
            socket.emit('processingStarted', { 
                status: 'success',
                model: transcriber.model,
                availableModels: transcriber.getAvailableModels()
            });

        } catch (error) {
            console.error('Error in startDownload handler:', error);
            socket.emit('error', { 
                message: error.message,
                details: error.stack
            });
        }
    });

    // Handle get available models request
    socket.on('getAvailableModels', () => {
        socket.emit('availableModels', transcriber.getAvailableModels());
    });

    // Handle create clip request
    socket.on('createClip', async (data) => {
        try {
            const { id, startTime, endTime, quality } = data;
            console.log(`Creating clip from ${startTime} to ${endTime}, quality: ${quality}`);

            // Set up progress handler
            clipper.setStatusCallback((progress) => {
                if (typeof progress === 'number') {
                    socket.emit('clipProgress', { id, progress });
                }
            });

            // Create the clip
            const clipResult = await clipper.createClip(startTime, endTime, id, quality);
            console.log('Clip created successfully:', clipResult);

            // Generate URLs for clip and thumbnail
            const clipUrl = `/clips/${path.basename(clipResult.clipPath)}`;
            const thumbUrl = `/clips/${path.basename(clipResult.thumbPath)}`;

            // Emit success event with clip details
            socket.emit('clipReady', {
                id,
                clipPath: clipUrl,
                thumbPath: thumbUrl,
                startTime,
                endTime,
                duration: endTime - startTime
            });

        } catch (error) {
            console.error('Error creating clip:', error);
            socket.emit('clipError', {
                id: data.id,
                error: error.message || 'Failed to create clip'
            });
        }
    });

    // Handle client disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected');
        activeClients.delete(socket);
        
        // If no more clients, stop all processes
        if (activeClients.size === 0) {
            console.log('No more clients, stopping all processes');
            downloader.stop();
            transcriber.stop();
            clipper.cleanup();
        }
    });

    // Handle stop request
    socket.on('stop', () => {
        console.log('Stop requested');
        downloader.stop();
        transcriber.stop();
        clipper.cleanup();
        socket.emit('stopped');
    });
});

// Cleanup function for tests
async function cleanup(server) {
    console.log('Starting cleanup...');
    
    // Stop any active downloads
    if (downloader) {
        await downloader.stop();
    }
    
    // Stop any active transcriptions
    if (transcriber) {
        await transcriber.stop();
    }
    
    // Close server if it exists
    if (server) {
        return new Promise((resolve) => {
            server.close(() => {
                console.log('Server closed successfully');
                resolve();
            });
        });
    }
    
    return Promise.resolve();
}

// Start server function for testing
function startServer(port = 8080) {
    return new Promise((resolve, reject) => {
        try {
            console.log('Attempting to start server...');
            process.on('uncaughtException', (error) => {
                console.error('Uncaught Exception:', error);
            });

            process.on('unhandledRejection', (error) => {
                console.error('Unhandled Rejection:', error);
            });

            const serverInstance = server.listen(port, () => {
                console.log(`Server is running on port ${port}`);
                resolve(serverInstance);
            });
            
            serverInstance.on('error', (error) => {
                console.error('Server error:', error);
                reject(error);
            });
        } catch (error) {
            console.error('Error starting server:', error);
            reject(error);
        }
    });
}

// Add immediate invocation of startServer
if (require.main === module) {
    console.log('Starting server directly...');
    startServer().catch(error => {
        console.error('Failed to start server:', error);
        process.exit(1);
    });
}

// Export for testing
module.exports = { server, cleanup, startServer };
