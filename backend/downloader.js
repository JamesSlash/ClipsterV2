const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class Downloader {
    constructor(tempDir, statusCallback) {
        this.tempDir = tempDir;
        this.statusCallback = statusCallback;
        this.isActive = false;
        this.downloadProcess = null;
        this.fixationInterval = null;
        this.lastFixationTime = 0;
        this.lastFileSize = 0;
    }

    isValidUrl(url) {
        return url.match(/^(https?:\/\/)?(www\.)?(youtube\.com\/(live\/|watch\?v=)|.*\.(m3u8|mpd))/) !== null;
    }

    async getManifestUrl(url) {
        return new Promise((resolve, reject) => {
            const args = [
                url,
                '--get-url',
                '--format', '312+234/311+234/best',  // Try 1080p60+audio, fallback to 720p60+audio, then best
                '--no-warnings',
                '--no-check-certificates',
                '--extractor-args', 'youtube:player_client=android',
                '--add-header', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            ];

            console.log('Starting yt-dlp with args:', args.join(' '));
            const process = spawn('yt-dlp', args);
            let manifestUrl = '';
            let errorOutput = '';

            process.stdout.on('data', (data) => {
                const output = data.toString();
                console.log('yt-dlp stdout:', output);
                manifestUrl += output;
            });

            process.stderr.on('data', (data) => {
                const error = data.toString();
                console.error('yt-dlp stderr:', error);
                errorOutput += error;
                
                // Update status with meaningful error messages
                if (error.includes('This live event will begin in')) {
                    this.updateStatus('Stream has not started yet');
                } else if (error.includes('This live event has ended')) {
                    this.updateStatus('Stream has ended');
                } else if (error.includes('Sign in')) {
                    this.updateStatus('Stream requires authentication');
                }
            });

            process.on('close', (code) => {
                console.log('yt-dlp process closed with code:', code);
                if (code === 0 && manifestUrl.trim()) {
                    const urls = manifestUrl.trim().split('\n');
                    if (urls.length >= 2) {
                        // We got both video and audio URLs
                        console.log('Got video and audio URLs:', urls);
                        resolve(urls); // Return array of URLs
                    } else {
                        console.log('Got single URL:', urls[0]);
                        resolve(urls[0]); // Return single URL
                    }
                } else {
                    const error = new Error(`Failed to get manifest URL (exit code: ${code})\nError output: ${errorOutput}`);
                    console.error(error);
                    reject(error);
                }
            });

            process.on('error', (err) => {
                console.error('Failed to start yt-dlp process:', err);
                reject(err);
            });
        });
    }

    async startDownload(url) {
        if (!this.isValidUrl(url)) {
            throw new Error('Invalid URL format');
        }

        this.isActive = true;
        this.updateStatus('Starting download process...');

        try {
            let streamUrl = url;
            let audioUrl = null;
            
            if (url.includes('youtube.com')) {
                this.updateStatus('Getting stream URL...');
                const urls = await this.getManifestUrl(url);
                if (Array.isArray(urls)) {
                    [streamUrl, audioUrl] = urls;
                    this.updateStatus(`Got video and audio URLs`);
                } else {
                    streamUrl = urls;
                    this.updateStatus(`Got stream URL`);
                }
            }

            const outputPath = path.join(this.tempDir, 'live_download.ts');
            let args;

            if (audioUrl) {
                // If we have separate video and audio streams
                args = [
                    '-i', streamUrl,
                    '-i', audioUrl,
                    '-c', 'copy',
                    '-f', 'mpegts',
                    '-y',
                    outputPath
                ];
            } else {
                // Single input stream
                args = [
                    '-i', streamUrl,
                    '-c', 'copy',
                    '-f', 'mpegts',
                    '-y',
                    outputPath
                ];
            }

            this.downloadProcess = spawn('ffmpeg', args);
            this.updateStatus('Started ffmpeg download process');

            this.downloadProcess.stderr.on('data', (data) => {
                console.log('ffmpeg stderr:', data.toString());
            });

            this.downloadProcess.on('error', (err) => {
                console.error('ffmpeg error:', err);
                this.updateStatus(`Download error: ${err.message}`);
                this.stop();
            });

            this.downloadProcess.on('close', (code) => {
                if (code !== null) {
                    console.log(`ffmpeg process exited with code ${code}`);
                    this.updateStatus(`Download process exited with code ${code}`);
                    this.stop();
                }
            });

            // Start file fixation process
            this.startFileFixation();

        } catch (error) {
            console.error('Download error:', error);
            this.updateStatus(`Download error: ${error.message}`);
            this.stop();
            throw error;
        }
    }

    startFileFixation() {
        if (this.fixationInterval) {
            clearInterval(this.fixationInterval);
        }

        this.fixationInterval = setInterval(() => {
            this.fixFile();
        }, 10000); // Fix file every 10 seconds
    }

    async fixFile() {
        const inputPath = path.join(this.tempDir, 'live_download.ts');
        const outputPath = path.join(this.tempDir, 'fixed_current.ts');

        try {
            const stats = await fs.promises.stat(inputPath);
            if (!stats.size) {
                console.log('Input file is empty, skipping fixation');
                return;
            }

            // Always fix if file has grown or if it's been more than 30 seconds since last fix
            const shouldFix = stats.size !== this.lastFileSize || 
                            (Date.now() - this.lastFixationTime) > 30000;

            if (!shouldFix) {
                return;
            }

            console.log(`Fixing file: ${stats.size} bytes (previous: ${this.lastFileSize} bytes)`);
            this.lastFileSize = stats.size;

            const fixProcess = spawn('ffmpeg', [
                '-i', inputPath,
                '-c', 'copy',
                '-y',
                outputPath
            ]);

            let fixationError = '';
            fixProcess.stderr.on('data', (data) => {
                const error = data.toString();
                console.log('Fixation stderr:', error);
                fixationError += error;
            });

            fixProcess.on('error', (err) => {
                console.error('File fixation process error:', err);
                this.updateStatus(`Fixation error: ${err.message}`);
            });

            fixProcess.on('close', (code) => {
                if (code === 0) {
                    this.lastFixationTime = Date.now();
                    console.log('File fixation completed successfully');
                    this.updateStatus('File fixed successfully');
                } else {
                    console.error(`File fixation failed with code ${code}. Error: ${fixationError}`);
                    this.updateStatus(`Fixation failed: code ${code}`);
                }
            });
        } catch (error) {
            console.error('Error during file fixation:', error);
            this.updateStatus(`Fixation error: ${error.message}`);
        }
    }

    updateStatus(status) {
        if (this.statusCallback) {
            this.statusCallback(status);
        }
    }

    stop() {
        this.isActive = false;
        
        if (this.fixationInterval) {
            clearInterval(this.fixationInterval);
            this.fixationInterval = null;
        }

        if (this.downloadProcess) {
            this.downloadProcess.kill();
            this.downloadProcess = null;
        }

        this.updateStatus('Download stopped');
    }

    cleanup() {
        this.stop();
        // Add any cleanup logic here
    }
}

module.exports = { Downloader };
