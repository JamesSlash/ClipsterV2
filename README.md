# Clipster

A real-time YouTube live stream transcription and clipping tool that allows users to create clips from live streams without using the YouTube API.

## Features

- Real-time transcription of YouTube live streams using Whisper
- Instant clip creation from live streams
- No YouTube API required
- Web-based interface
- Support for multiple languages
- Real-time word-level timestamps

## Requirements

### System Requirements
- Node.js (v14 or higher)
- Python 3.8+
- ffmpeg
- yt-dlp

### Python Dependencies
```bash
pip install -r requirements.txt
```

### Node.js Dependencies
```bash
npm install
```

## Project Structure

```
clipster/
├── backend/
│   ├── server.js
│   ├── clipper.js
│   └── transcriber.js
├── frontend/
│   ├── index.html
│   ├── main.js
│   └── styles.css
└── temp/
    └── (temporary files for downloads and processing)
```

## Development Setup

1. Install system requirements (Node.js, Python, ffmpeg, yt-dlp)
2. Install Python dependencies: `pip install -r requirements.txt`
3. Install Node.js dependencies: `npm install`
4. Start the server: `node backend/server.js`
5. Open `frontend/index.html` in your browser

## Usage

1. Enter a YouTube live stream URL
2. Wait for transcription to begin
3. Select text from the transcript to create a clip
4. Click "Create Clip" to generate a video clip
5. Download or share the generated clip

## How It Works

1. Uses yt-dlp to download the live stream in real-time
2. Periodically creates "fixed" copies of the downloaded stream
3. Transcribes the audio using OpenAI's Whisper
4. Allows users to select portions of the transcript
5. Creates clips using ffmpeg without re-encoding

## License

MIT License 