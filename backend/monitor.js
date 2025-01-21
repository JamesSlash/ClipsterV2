const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class SystemMonitor {
    constructor(tempDir, services) {
        this.tempDir = tempDir;
        this.services = services; // { downloader, transcriber, clipper }
        this.statusCallback = null;
        this.checkInterval = null;
        this.lastCheck = {
            diskSpace: null,
            ffmpegRunning: false,
            whisperRunning: false,
            ytdlpRunning: false
        };
        this.DISK_SPACE_THRESHOLD = 500 * 1024 * 1024; // 500MB minimum
    }

    setStatusCallback(callback) {
        this.statusCallback = callback;
    }

    updateStatus(status) {
        if (this.statusCallback) {
            this.statusCallback(status);
        }
    }

    async startMonitoring() {
        // Check system health every 30 seconds
        this.checkInterval = setInterval(async () => {
            try {
                await this.checkSystemHealth();
            } catch (error) {
                console.error('Health check error:', error);
            }
        }, 30000);

        // Initial check
        await this.checkSystemHealth();
    }

    stopMonitoring() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    async checkSystemHealth() {
        const health = {
            diskSpace: await this.checkDiskSpace(),
            dependencies: await this.checkDependencies(),
            services: this.checkServices(),
            tempFiles: await this.checkTempFiles()
        };

        // Handle any issues
        await this.handleHealthIssues(health);

        return health;
    }

    async checkDiskSpace() {
        return new Promise((resolve) => {
            if (process.platform === 'win32') {
                // Windows disk space check
                const diskpart = spawn('powershell', ['Get-PSDrive', this.tempDir[0]]);
                let output = '';
                
                diskpart.stdout.on('data', (data) => {
                    output += data.toString();
                });

                diskpart.on('close', () => {
                    try {
                        const free = parseInt(output.match(/Free\s+:\s+(\d+)/)[1]) * 1024;
                        resolve({ free, sufficient: free > this.DISK_SPACE_THRESHOLD });
                    } catch (error) {
                        resolve({ free: 0, sufficient: false, error: error.message });
                    }
                });
            } else {
                // Unix disk space check
                const df = spawn('df', ['-B1', this.tempDir]);
                let output = '';

                df.stdout.on('data', (data) => {
                    output += data.toString();
                });

                df.on('close', () => {
                    try {
                        const free = parseInt(output.split('\n')[1].split(/\s+/)[3]);
                        resolve({ free, sufficient: free > this.DISK_SPACE_THRESHOLD });
                    } catch (error) {
                        resolve({ free: 0, sufficient: false, error: error.message });
                    }
                });
            }
        });
    }

    async checkDependencies() {
        const dependencies = {
            ffmpeg: await this.checkCommand('ffmpeg -version'),
            ytdlp: await this.checkCommand('yt-dlp --version'),
            whisper: await this.checkCommand('whisper --help')
        };

        return dependencies;
    }

    async checkCommand(command) {
        return new Promise((resolve) => {
            const [cmd, ...args] = command.split(' ');
            const process = spawn(cmd, args);
            
            process.on('error', () => {
                resolve(false);
            });

            process.on('close', (code) => {
                resolve(code === 0);
            });
        });
    }

    checkServices() {
        return {
            downloader: this.services.downloader.isActive(),
            transcriber: this.services.transcriber.isTranscribing,
            clipper: true // Clipper is stateless
        };
    }

    async checkTempFiles() {
        const files = {
            download: fs.existsSync(path.join(this.tempDir, 'live_download.ts')),
            fixed: fs.existsSync(path.join(this.tempDir, 'fixed_current.ts')),
            clips: fs.existsSync(path.join(this.tempDir, 'clips'))
        };

        // Check for corrupt files
        if (files.download) {
            const stats = fs.statSync(path.join(this.tempDir, 'live_download.ts'));
            files.downloadSize = stats.size;
            files.downloadHealthy = stats.size > 0;
        }

        return files;
    }

    async handleHealthIssues(health) {
        // Handle disk space issues
        if (!health.diskSpace.sufficient) {
            this.updateStatus({
                type: 'warning',
                message: 'Low disk space. Cleaning up old clips...'
            });
            await this.cleanupOldFiles();
        }

        // Handle missing dependencies
        const missingDeps = Object.entries(health.dependencies)
            .filter(([, installed]) => !installed)
            .map(([dep]) => dep);

        if (missingDeps.length > 0) {
            this.updateStatus({
                type: 'error',
                message: `Missing dependencies: ${missingDeps.join(', ')}`
            });
        }

        // Handle corrupt files
        if (health.tempFiles.download && !health.tempFiles.downloadHealthy) {
            this.updateStatus({
                type: 'warning',
                message: 'Corrupt download file detected. Restarting download...'
            });
            await this.handleCorruptDownload();
        }
    }

    async cleanupOldFiles() {
        // Force cleanup of old clips
        this.services.clipper.cleanup();
        
        // Remove any temporary files
        const tempFiles = ['audio_segment.wav', 'audio_segment.json'];
        tempFiles.forEach(file => {
            const filePath = path.join(this.tempDir, file);
            if (fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                } catch (error) {
                    console.error(`Error cleaning up ${file}:`, error);
                }
            }
        });
    }

    async handleCorruptDownload() {
        if (this.services.downloader.isActive()) {
            // Stop current download
            this.services.downloader.stop();
            
            // Clean up corrupt file
            const downloadPath = path.join(this.tempDir, 'live_download.ts');
            if (fs.existsSync(downloadPath)) {
                fs.unlinkSync(downloadPath);
            }

            // Restart download with same URL
            const currentUrl = this.services.downloader.getCurrentUrl();
            if (currentUrl) {
                await this.services.downloader.startDownload(currentUrl);
            }
        }
    }

    getSystemStatus() {
        return {
            lastCheck: this.lastCheck,
            isMonitoring: !!this.checkInterval
        };
    }
}

module.exports = SystemMonitor; 