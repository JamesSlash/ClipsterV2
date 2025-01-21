const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

class Clipper {
    constructor() {
        this.clipsDir = path.join(__dirname, '..', 'temp', 'clips');
        // Ensure clips directory exists
        if (!fs.existsSync(this.clipsDir)) {
            fs.mkdirSync(this.clipsDir, { recursive: true });
        }
        this.statusCallback = null;
        this.fixationInterval = null;
        this.lastFixationTime = 0;
    }

    setStatusCallback(callback) {
        this.statusCallback = callback;
    }

    async createClip(startTime, endTime, clipId, quality = 'high') {
        try {
            // Validate timestamps
            if (typeof startTime !== 'number' || typeof endTime !== 'number') {
                throw new Error('Start and end times must be numbers');
            }
            if (startTime >= endTime) {
                throw new Error('Start time must be less than end time');
            }
            if (startTime < 0) {
                throw new Error('Start time cannot be negative');
            }
            const duration = endTime - startTime;
            if (duration > 300) { // 5 minutes max
                throw new Error('Clip duration cannot exceed 300 seconds');
            }
            if (duration < 1) { // 1 second min
                throw new Error('Clip duration must be at least 1 second');
            }

            // Force a file fixation before creating the clip
            await this.fixPartialFile();

            const sourceFile = path.join(__dirname, '..', 'temp', 'fixed_current.ts');
            
            // Check if source file exists and has enough data
            if (!fs.existsSync(sourceFile)) {
                throw new Error('Source video file not found');
            }

            // Get file duration using ffprobe
            const fileDuration = await this._getFileDuration(sourceFile);
            console.log(`Source file duration: ${fileDuration}s, requested end time: ${endTime}s`);
            
            if (endTime > fileDuration) {
                throw new Error(`Requested end time (${endTime}s) exceeds available video duration (${fileDuration}s)`);
            }

            const clipFile = path.join(this.clipsDir, `clip_${clipId}.mp4`);
            const thumbFile = path.join(this.clipsDir, `thumb_${clipId}.jpg`);

            // Create clip
            await this._executeClipCommand(sourceFile, clipFile, startTime, endTime, quality);
            
            // Generate thumbnail
            await this._generateThumbnail(clipFile, thumbFile, startTime);

            return {
                clipPath: clipFile,
                thumbPath: thumbFile
            };
        } catch (error) {
            console.error('Error creating clip:', error);
            throw error;
        }
    }

    async _executeClipCommand(sourceFile, outputFile, startTime, endTime, quality) {
        return new Promise((resolve, reject) => {
            const duration = endTime - startTime;
            console.log(`Creating clip: start=${startTime}, end=${endTime}, duration=${duration}`);
            
            const args = [
                '-i', sourceFile,
                '-ss', startTime.toString(),
                '-t', duration.toString(),
                '-c:v', 'libx264',
                '-preset', quality === 'high' ? 'slow' : 'ultrafast',
                '-c:a', 'aac',
                '-y',
                outputFile
            ];

            console.log('FFmpeg command:', 'ffmpeg', args.join(' '));
            const ffmpeg = spawn('ffmpeg', args);
            let progress = 0;

            ffmpeg.stderr.on('data', (data) => {
                const output = data.toString();
                console.log('FFmpeg output:', output);
                // Parse progress and update through callback
                if (output.includes('time=')) {
                    const match = output.match(/time=(\d{2}):(\d{2}):(\d{2}.\d{2})/);
                    if (match) {
                        const currentTime = (parseInt(match[1]) * 3600) + 
                                         (parseInt(match[2]) * 60) + 
                                         parseFloat(match[3]);
                        progress = Math.min((currentTime / duration) * 100, 100);
                        if (this.statusCallback) {
                            this.statusCallback(progress);
                        }
                    }
                }
            });

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    console.log('Clip creation completed successfully');
                    resolve();
                } else {
                    console.error(`FFmpeg process failed with code ${code}`);
                    reject(new Error(`FFmpeg process exited with code ${code}`));
                }
            });
        });
    }

    async _generateThumbnail(videoFile, thumbFile, timestamp) {
        return new Promise((resolve, reject) => {
            const args = [
                '-ss', timestamp.toString(),
                '-i', videoFile,
                '-vframes', '1',
                '-vf', 'scale=320:-1',
                '-y',
                thumbFile
            ];

            const ffmpeg = spawn('ffmpeg', args);

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Thumbnail generation failed with code ${code}`));
                }
            });
        });
    }

    async fixPartialFile() {
        const sourceFile = path.join(__dirname, '..', 'temp', 'live_download.ts');
        const fixedFile = path.join(__dirname, '..', 'temp', 'fixed_current.ts');
        
        try {
            const stats = fs.statSync(sourceFile);
            if (stats.mtimeMs <= this.lastFixationTime) {
                return; // File hasn't been modified since last fixation
            }

            console.log(`Fixing file: ${stats.size} bytes (previous: ${this.lastFixationSize || 0} bytes)`);
            
            await new Promise((resolve, reject) => {
                const ffmpeg = spawn('ffmpeg', [
                    '-i', sourceFile,
                    '-c', 'copy',
                    '-y',
                    fixedFile
                ]);

                ffmpeg.stderr.on('data', (data) => {
                    console.log('Fixation stderr:', data.toString());
                });

                ffmpeg.on('close', (code) => {
                    if (code === 0) {
                        this.lastFixationTime = stats.mtimeMs;
                        this.lastFixationSize = stats.size;
                        console.log('File fixation completed successfully');
                        resolve();
                    } else {
                        reject(new Error(`Fixation failed with code ${code}`));
                    }
                });
            });
        } catch (error) {
            console.error('Error during file fixation:', error);
            throw error;
        }
    }

    async _getFileDuration(filePath) {
        return new Promise((resolve, reject) => {
            const ffprobe = spawn('ffprobe', [
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                filePath
            ]);

            let output = '';
            ffprobe.stdout.on('data', (data) => {
                output += data.toString();
            });

            ffprobe.on('close', (code) => {
                if (code === 0) {
                    const duration = parseFloat(output);
                    resolve(duration);
                } else {
                    reject(new Error('Failed to get file duration'));
                }
            });
        });
    }

    cleanup() {
        // Clear any pending intervals
        if (this.fixationInterval) {
            clearInterval(this.fixationInterval);
            this.fixationInterval = null;
        }
    }
}

module.exports = { Clipper }; 