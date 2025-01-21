const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { spawn } = require('child_process');

class Transcriber {
    constructor(tempDir) {
        this.tempDir = tempDir;
        this.audioDir = path.join(tempDir, 'audio');
        this.statusCallback = null;
        this.updateCallback = null;
        this.isActive = false;
        this.transcriptionInterval = null;
        this.lastProcessedTime = 0;
        this.minSizeForTranscription = 32 * 1024; // Reduced to 32KB for faster initial transcription
        this.lastFileSize = 0;
        this.noGrowthCount = 0;
        this.totalWordCount = 0;
        this.model = 'base'; // Default model
        this.language = 'auto'; // Default to auto-detect
        this.validModels = ['tiny', 'base', 'small', 'medium', 'large']; // Available Whisper models
        this.validLanguages = ['auto', 'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'zh', 'ja', 'ko', 'ar', 'hi', 'tr']; // Supported languages
        this.transcriptionInProgress = false; // NEW: track concurrency
        this.pendingTranscription = false; // NEW: track if a cycle was skipped

        this.ensureAudioDirectory();
    }

    setStatusCallback(callback) {
        this.statusCallback = callback;
    }

    updateStatus(status) {
        if (this.statusCallback) {
            this.statusCallback(status);
        }
    }

    ensureAudioDirectory() {
        if (!fs.existsSync(this.audioDir)) {
            fs.mkdirSync(this.audioDir, { recursive: true });
        }
    }

    async waitForFile(filePath, timeout = 30000) {
        const startTime = Date.now();
        let lastSize = 0;
        let noGrowthCount = 0;
        let maxNoGrowthCount = 5; // Increased from 2 to 5 to handle stream stalls better

        console.log(`Waiting for file: ${filePath}`);
        console.log(`Current directory: ${process.cwd()}`);
        console.log(`Temp directory: ${this.tempDir}`);

        while (Date.now() - startTime < timeout) {
            try {
                if (fs.existsSync(filePath)) {
                    const stats = fs.statSync(filePath);
                    const currentSize = stats.size;
                    
                    console.log(`File exists. Size: ${currentSize} bytes`);
                    
                    if (currentSize === 0) {
                        console.log('File exists but is empty, waiting...');
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        continue;
                    }

                    // For first transcription, ensure we have enough data but with a lower threshold
                    if (this.lastProcessedTime === 0 && currentSize < this.minSizeForTranscription) {
                        console.log(`File too small. Current: ${(currentSize / 1024).toFixed(2)}KB, Need: ${(this.minSizeForTranscription / 1024).toFixed(2)}KB`);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        continue;
                    }

                    // File is growing or has stabilized
                    if (currentSize > lastSize) {
                        console.log(`File is growing: ${(currentSize / 1024).toFixed(2)}KB`);
                        lastSize = currentSize;
                        noGrowthCount = 0;
                        return true;
                    } else if (currentSize === lastSize) {
                        noGrowthCount++;
                        console.log(`File size stable for ${noGrowthCount}/${maxNoGrowthCount} checks`);
                        if (noGrowthCount >= maxNoGrowthCount) {
                            console.log(`File appears stable at ${(currentSize / 1024).toFixed(2)}KB`);
                            // Even if stable, we'll return true to allow processing
                            return true;
                        }
                    }
                } else {
                    console.log(`File does not exist: ${filePath}`);
                    // List contents of temp directory
                    const tempContents = fs.readdirSync(this.tempDir);
                    console.log('Contents of temp directory:', tempContents);
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.error(`Error checking file: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        // Instead of throwing an error, return false to allow retry
        console.log('Timeout waiting for file, will retry in next cycle');
        return false;
    }

    async extractAudio() {
        const inputPath = path.join(this.tempDir, 'fixed_current.ts');
        const outputPath = path.join(this.audioDir, 'current_segment.wav');

        console.log('Extracting audio:');
        console.log(`Input path: ${inputPath}`);
        console.log(`Output path: ${outputPath}`);

        try {
            // Wait for the input file to be ready
            await this.waitForFile(inputPath);

            this.updateStatus('Starting audio extraction...');
            
            // Extract audio using ffmpeg
            const process = spawn('ffmpeg', [
                '-y',
                '-i', inputPath,
                '-vn',
                '-acodec', 'pcm_s16le',
                '-ar', '16000',
                '-ac', '1',
                outputPath
            ]);

            return new Promise((resolve, reject) => {
                let errorOutput = '';

                process.stderr.on('data', (data) => {
                    const message = data.toString();
                    console.log('FFmpeg output:', message);
                    if (message.includes('error')) {
                        errorOutput += message;
                    }
                });

                process.stdout.on('data', (data) => {
                    console.log('FFmpeg stdout:', data.toString());
                });

                process.on('close', (code) => {
                    console.log(`FFmpeg process exited with code ${code}`);
                    if (code === 0) {
                        // Verify the output file exists and has content
                        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                            const stats = fs.statSync(outputPath);
                            console.log(`Audio extraction successful. Output file size: ${stats.size} bytes`);
                            this.updateStatus('Audio extraction completed successfully');
                            resolve(outputPath);
                        } else {
                            console.error('Audio extraction produced empty or missing file');
                            reject(new Error('Audio extraction produced empty or missing file'));
                        }
                    } else {
                        console.error(`Audio extraction failed with code ${code}:`, errorOutput);
                        reject(new Error(`Audio extraction failed: ${errorOutput}`));
                    }
                });

                process.on('error', (error) => {
                    console.error('FFmpeg process error:', error);
                    reject(new Error(`Audio extraction process error: ${error.message}`));
                });
            });
        } catch (error) {
            console.error('Audio extraction error:', error);
            throw new Error(`Audio extraction error: ${error.message}`);
        }
    }

    setModel(model) {
        if (!this.validModels.includes(model)) {
            throw new Error(`Invalid model. Must be one of: ${this.validModels.join(', ')}`);
        }
        console.log(`Setting Whisper model to: ${model}`);
        this.model = model;
    }

    getAvailableModels() {
        return this.validModels;
    }

    setLanguage(language) {
        if (!this.validLanguages.includes(language)) {
            throw new Error(`Invalid language. Must be one of: ${this.validLanguages.join(', ')}`);
        }
        console.log(`Setting Whisper language to: ${language}`);
        this.language = language;
    }

    getAvailableLanguages() {
        return this.validLanguages;
    }

    async transcribe() {
        console.log('Starting transcription cycle');
        try {
            // Extract audio from the current segment
            console.log('Starting audio extraction');
            const audioPath = await this.extractAudio();
            console.log(`Audio extracted successfully to: ${audioPath}`);

            // Run whisper on the extracted audio
            console.log(`Starting Whisper transcription with model: ${this.model}, language: ${this.language}`);
            this.updateStatus(`Running Whisper transcription with ${this.model} model...`);

            const whisperArgs = [
                '-m', 'whisper',
                audioPath,
                '--model', this.model,
                '--output_dir', this.audioDir,
                '--output_format', 'json',
                '--word_timestamps', 'True'  // Enable word-level timestamps
            ];

            // Only add language parameter if not auto
            if (this.language !== 'auto') {
                whisperArgs.push('--language', this.language);
            }

            console.log('Running Whisper with args:', whisperArgs.join(' '));
            const process = spawn('python', whisperArgs);

            return new Promise((resolve, reject) => {
                let output = '';
                let errorOutput = '';

                process.stdout.on('data', (data) => {
                    const message = data.toString();
                    console.log('Whisper stdout:', message);
                    output += message;
                });

                process.stderr.on('data', (data) => {
                    const message = data.toString();
                    console.log('Whisper stderr:', message);
                    errorOutput += message;
                });

                process.on('close', async (code) => {
                    console.log(`Whisper process exited with code ${code}`);
                    if (code === 0) {
                        try {
                            // Get the JSON output file
                            const jsonFile = path.join(this.audioDir, path.basename(audioPath, '.wav') + '.json');
                            console.log(`Looking for Whisper output at: ${jsonFile}`);
                            
                            if (fs.existsSync(jsonFile)) {
                                const jsonContent = fs.readFileSync(jsonFile, 'utf8');
                                console.log('Whisper output file found and read');
                                const transcription = JSON.parse(jsonContent);
                                
                                console.log('Full segments from Whisper:', transcription.segments);
                                
                                if (transcription && transcription.segments) {
                                    console.log(`Found ${transcription.segments.length} segments in transcription`);
                                    
                                    // Filter segments we haven't processed yet
                                    const newSegments = transcription.segments.filter(
                                        segment => segment.start >= this.lastProcessedTime
                                    );
                                    console.log(`Found ${newSegments.length} new segments to process`);

                                    if (newSegments.length > 0) {
                                        // Process word-level timestamps if available
                                        const processedSegments = newSegments.map(segment => {
                                            const words = segment.words ? segment.words.map(word => ({
                                                text: word.text || word.word,
                                                start: word.start,
                                                end: word.end,
                                                confidence: word.confidence
                                            })) : [];

                                            return {
                                                text: segment.text,
                                                start: segment.start,
                                                end: segment.end,
                                                words,
                                                hasWordTimestamps: words.length > 0
                                            };
                                        });

                                        // Update last processed time
                                        this.lastProcessedTime = newSegments[newSegments.length - 1].end;
                                        console.log(`Updated last processed time to: ${this.lastProcessedTime}`);

                                        // Calculate word count
                                        const newWordCount = processedSegments.reduce((count, segment) => 
                                            count + (segment.words.length || segment.text.trim().split(/\s+/).length), 0);
                                        this.totalWordCount += newWordCount;
                                        
                                        // Emit the update through the callback
                                        if (this.updateCallback) {
                                            console.log('Emitting update with processed segments:', {
                                                segmentCount: processedSegments.length,
                                                wordCount: newWordCount,
                                                hasWordTimestamps: processedSegments.some(s => s.hasWordTimestamps)
                                            });
                                            this.updateCallback({
                                                segments: processedSegments,
                                                totalWordCount: this.totalWordCount,
                                                model: this.model,
                                                language: this.language,
                                                hasWordTimestamps: processedSegments.some(s => s.hasWordTimestamps)
                                            });
                                        } else {
                                            console.warn('No update callback set for transcription updates');
                                        }
                                        
                                        this.updateStatus(`Transcribed ${processedSegments.length} new segments (${newWordCount} words)`);
                                    } else {
                                        console.log('No new segments found in this transcription');
                                    }
                                    
                                    resolve(transcription);
                                } else {
                                    console.error('Invalid transcription format:', transcription);
                                    reject(new Error('Invalid transcription format'));
                                }
                            } else {
                                console.error(`Whisper output file not found at: ${jsonFile}`);
                                reject(new Error('Whisper output file not found'));
                            }
                        } catch (error) {
                            console.error('Error processing Whisper output:', error);
                            reject(error);
                        }
                    } else {
                        console.error(`Whisper failed with code ${code}:`, errorOutput);
                        reject(new Error(`Whisper failed: ${errorOutput}`));
                    }
                });

                process.on('error', (error) => {
                    console.error('Whisper process error:', error);
                    reject(error);
                });
            });
        } catch (error) {
            console.error('Transcription error:', error);
            this.updateStatus(`Transcription error: ${error.message}`);
            throw error;
        }
    }

    async processTranscriptionCycle() {
        if (!this.isActive) {
            console.log('Transcription cycle skipped - not active');
            return;
        }

        // Check if a transcription is already running
        if (this.transcriptionInProgress) {
            console.log('A transcription is still in progress, marking as pending for immediate processing after current one finishes');
            this.pendingTranscription = true;
            return;
        }

        // Mark as in-progress and reset pending flag
        this.transcriptionInProgress = true;
        this.pendingTranscription = false;
        console.log('Starting transcription cycle');

        try {
            await this.transcribe();
            console.log('Transcription cycle completed successfully');
        } catch (error) {
            console.error('Error in transcription cycle:', error);
            this.updateStatus(`Transcription error: ${error.message}`);
        } finally {
            // Mark as done and check if we need to process a pending cycle
            this.transcriptionInProgress = false;
            
            if (this.pendingTranscription && this.isActive) {
                console.log('Processing pending transcription cycle immediately');
                // Use setTimeout to prevent stack overflow from recursive calls
                setTimeout(() => this.processTranscriptionCycle(), 0);
            }
        }
    }

    startTranscription() {
        if (this.isActive) {
            console.log('Transcription already in progress');
            return;
        }

        console.log('Starting transcription process');
        this.isActive = true;
        this.lastProcessedTime = 0;
        this.transcriptionInProgress = false;
        this.pendingTranscription = false; // Reset pending flag

        // Start the transcription cycle immediately
        this.processTranscriptionCycle();

        // Then set up the interval for subsequent cycles
        this.transcriptionInterval = setInterval(() => {
            if (this.isActive) {
                this.processTranscriptionCycle();
            }
        }, 3000);
    }

    stop() {
        this.isActive = false;
        this.transcriptionInProgress = false;
        this.pendingTranscription = false; // Reset pending flag
        if (this.transcriptionInterval) {
            clearInterval(this.transcriptionInterval);
            this.transcriptionInterval = null;
        }
        this.updateStatus('Transcription stopped');
    }

    cleanup() {
        // Clean up temporary audio files
        const audioFile = path.join(this.tempDir, 'audio_segment.wav');
        const jsonFile = path.join(this.tempDir, 'audio_segment.json');

        try {
            if (fs.existsSync(audioFile)) {
                fs.unlinkSync(audioFile);
            }
            if (fs.existsSync(jsonFile)) {
                fs.unlinkSync(jsonFile);
            }
        } catch (error) {
            console.error('Error cleaning up temporary files:', error);
        }
    }
}

module.exports = { Transcriber }; 