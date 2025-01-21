/** @jest-environment jsdom */

const { validateYouTubeLiveUrl, formatTime, createTranscriptLine, handleTranscriptClick, clearSelection, updateSelectedRange, setLoading } = require('../frontend/main');

// Mock socket.io-client
jest.mock('socket.io-client', () => {
    const mockSocket = {
        on: jest.fn(),
        emit: jest.fn(),
        _callbacks: {},
        connect: jest.fn(),
        disconnect: jest.fn()
    };
    return jest.fn(() => mockSocket);
});

describe('Frontend', () => {
    let mockSocket;
    let container;

    beforeEach(() => {
        // Setup DOM elements
        document.body.innerHTML = `
            <div id="status" class="disconnected">Disconnected</div>
            <div class="input-group">
                <input type="text" id="youtubeUrl" placeholder="Enter YouTube Live URL (e.g. https://www.youtube.com/live/VIDEO_ID)" />
                <button id="startBtn">Start Processing</button>
                <button id="stopBtn" disabled>Stop</button>
            </div>
            <div id="transcriptContainer"></div>
            <div id="selectedRange"></div>
            <select id="clipQuality">
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
            </select>
            <button id="createClipBtn" disabled>Create Clip</button>
            <div id="clipPreview" style="display: none">
                <video id="clipVideo" controls></video>
                <div class="clip-actions">
                    <button id="downloadClipBtn">Download Clip</button>
                    <button id="copyLinkBtn">Copy Link</button>
                </div>
            </div>
        `;

        // Initialize elements
        container = document.getElementById('transcriptContainer');
        mockSocket = {
            on: jest.fn(),
            emit: jest.fn(),
            connect: jest.fn(),
            disconnect: jest.fn()
        };
    });

    afterEach(() => {
        jest.clearAllMocks();
        document.body.innerHTML = '';
    });

    describe('URL Validation', () => {
        test('validates correct YouTube live URL', () => {
            const validUrl = 'https://www.youtube.com/live/abc123xyz';
            expect(validateYouTubeLiveUrl(validUrl)).toBe(true);
        });

        test('rejects invalid YouTube URL', () => {
            const invalidUrl = 'https://www.youtube.com/watch?v=abc123';
            expect(validateYouTubeLiveUrl(invalidUrl)).toBe(false);
        });
    });

    describe('Time Formatting', () => {
        test('formats time correctly', () => {
            expect(formatTime(65.123)).toBe('01:05.123');
            expect(formatTime(3665.456)).toBe('01:01:05.456');
        });
    });

    describe('Transcript Management', () => {
        it('handles transcript selection', () => {
            const { createTranscriptLine, handleTranscriptClick, initializeElements } = require('../frontend/main');
            
            // Initialize DOM elements
            initializeElements();
            
            // Create test transcript lines
            const line1 = createTranscriptLine({ startTime: 10, endTime: 15, text: 'Test line 1' });
            const line2 = createTranscriptLine({ startTime: 20, endTime: 25, text: 'Test line 2' });
            
            container.appendChild(line1);
            container.appendChild(line2);

            // Click first line
            line1.click();
            expect(line1.classList.contains('selected')).toBe(true);
            expect(document.getElementById('selectedRange').textContent)
                .toContain('Selected: 00:10.000 - 00:15.000');

            // Click second line
            line2.click();
            expect(line2.classList.contains('selected')).toBe(true);
            expect(document.getElementById('selectedRange').textContent)
                .toContain('Selected: 00:10.000 - 00:25.000');
        });

        it('clears selection', () => {
            const { createTranscriptLine, clearSelection, initializeElements } = require('../frontend/main');
            
            // Initialize DOM elements
            initializeElements();
            
            const line = createTranscriptLine({ startTime: 10, endTime: 15, text: 'Test line' });
            container.appendChild(line);
            line.click();
            
            clearSelection();
            expect(line.classList.contains('selected')).toBe(false);
            expect(document.getElementById('selectedRange').textContent).toBe('');
            expect(document.getElementById('createClipBtn').disabled).toBe(true);
        });
    });

    describe('Loading State', () => {
        it('updates button states when loading', () => {
            const { setLoading, initializeElements } = require('../frontend/main');
            
            // Initialize DOM elements
            initializeElements();
            
            setLoading(true);
            expect(document.getElementById('startBtn').disabled).toBe(true);
            expect(document.getElementById('stopBtn').disabled).toBe(false);

            setLoading(false);
            expect(document.getElementById('startBtn').disabled).toBe(false);
            expect(document.getElementById('stopBtn').disabled).toBe(true);
            expect(document.getElementById('selectedRange').textContent).toBe('');
        });
    });
}); 