/**
 * Rerun Multi-Recording Viewer
 * A simple viewer for switching between multiple Rerun recordings with on-demand loading
 * 
 * Usage:
 * const viewer = new RerunMultiViewer({
 *     containerId: 'viewer',
 *     statusId: 'status',
 *     baseUrl: 'http://localhost:8888/',
 *     recordings: [
 *         { rrd: 'recording1.rrd', blueprint: 'blueprint1.rbl' },
 *         { rrd: 'recording2.rrd', blueprint: 'blueprint2.rbl' }
 *     ],
 *     maxCacheSize: 5  // Optional: Maximum number of cached recordings (default: 5)
 * });
 */

import { WebViewer } from "https://esm.sh/@rerun-io/web-viewer@0.25.1";

export class RerunMultiViewer {
    constructor(config) {
        this.baseUrl = config.baseUrl || '';
        this.recordings = config.recordings || [];
        this.containerId = config.containerId || 'viewer';
        this.statusId = config.statusId || 'status';
        this.viewer = null;
        this.userScroll = false;
        this.preventScrollJump = config.preventScrollJump !== false; // Default: true
        this.currentRecording = null;
        this.loadedRecordings = new Set(); // Track loaded recordings for cache
        this.loadedRecordingsQueue = []; // Track order of loaded recordings for LRU eviction
        this.maxCacheSize = config.maxCacheSize || 1; // Maximum number of cached recordings
        this.isLoading = false; // Prevent double-clicks

        // Setup scroll prevention if enabled
        if (this.preventScrollJump) {
            this.setupScrollPrevention();
        }

        this.init();
    }

    setupScrollPrevention() {
        // Monitor user scroll events
        window.addEventListener('scroll', () => {
            this.userScroll = true;
        });

        // Prevent unwanted focus events from causing scroll jumps
        const originalFocus = HTMLElement.prototype.focus;
        HTMLElement.prototype.focus = function (options) {
            // Allow focus only for elements marked with 'allow-focus' class
            if (!this.classList.contains('allow-focus')) {
                return; // Block focus calls that might cause scrolling
            }
            originalFocus.call(this, options);
        };

        // Restore scroll position after load if user hasn't scrolled
        window.addEventListener('load', () => {
            if (!this.userScroll) {
                window.scrollTo(0, 0);
            }
        });
    }

    async init() {
        try {
            console.log('🎬 Initializing Rerun viewer...');
            
            // Create viewer instance
            this.viewer = new WebViewer();
            const container = document.getElementById(this.containerId);
            
            // Load the first recording at startup
            if (this.recordings.length > 0) {
                const firstRec = this.recordings[0];
                const rrdFile = typeof firstRec === 'string' ? firstRec : firstRec.rrd;
                const blueprintFile = typeof firstRec === 'object' ? firstRec.blueprint : null;
                
                console.log(`📦 Loading first recording: ${rrdFile}`);
                if (blueprintFile) {
                    console.log(`📋 With blueprint: ${blueprintFile}`);
                }
                
                const startTime = performance.now();
                const urls = [this.baseUrl + rrdFile];
                if (blueprintFile) {
                    urls.push(this.baseUrl + blueprintFile);
                }
                
                await this.viewer.start(urls, container, {
                    render_backend: "webgl",
                    hide_welcome_screen: true,
                    panel_state_overrides: { blueprint: "Hidden", time: "Hidden"}
                });
                
                this.currentRecording = rrdFile;
                this.loadedRecordings.add(rrdFile);
                this.loadedRecordingsQueue.push(rrdFile);
                
                const loadTime = ((performance.now() - startTime) / 1000).toFixed(2);
                console.log(`✓ Viewer initialized in ${loadTime}s (cache: 1/${this.maxCacheSize})`);
                
                this.updateStatus('✓ Ready - Click thumbnails to switch');
                this.generateThumbnails();
                this.activateFirstThumbnail();
                

            } else {
                console.warn('⚠️ No recordings provided');
                // No recordings available
                await this.viewer.start([], container, {
                    render_backend: "webgl",
                    hide_welcome_screen: true,
                    panel_state_overrides: { blueprint: "Hidden", time: "Hidden", top: "Hidden" }
                });
                this.updateStatus('✓ Ready - No recordings');
            }
        } catch (e) {
            console.error("Viewer initialization error:", e);
            this.updateStatus('✗ Error: ' + e.message);
        }
    }

    async loadRecording(rrdFilename) {
        if (!this.viewer) {
            console.error("Viewer not initialized");
            return false;
        }

        // Prevent double-clicks while loading
        if (this.isLoading) {
            console.log("Already loading, please wait...");
            return false;
        }

        // Don't reload if already showing this recording
        if (this.currentRecording === rrdFilename) {
            console.log(`Already showing ${rrdFilename}`);
            return true;
        }

        // Check if recording is already loaded (cached)
        const recordingId = rrdFilename.replace('.rrd', '');
        if (this.loadedRecordings.has(rrdFilename)) {
            console.log(`Using cached ${rrdFilename}`);
            try {
                await this.viewer.set_active_recording_id(recordingId);
                this.currentRecording = rrdFilename;
                
                // Move to end of queue (most recently used)
                this.loadedRecordingsQueue = this.loadedRecordingsQueue.filter(r => r !== rrdFilename);
                this.loadedRecordingsQueue.push(rrdFilename);
                
                this.updateStatus('✓ Ready');
                return true;
            } catch (e) {
                console.warn("Cache switch failed, reloading:", e);
                this.loadedRecordings.delete(rrdFilename);
                this.loadedRecordingsQueue = this.loadedRecordingsQueue.filter(r => r !== rrdFilename);
            }
        }

        // Find the blueprint for this recording
        const recordingPair = this.recordings.find(rec => {
            const rrdFile = typeof rec === 'string' ? rec : rec.rrd;
            return rrdFile === rrdFilename;
        });
        
        const blueprintFile = (typeof recordingPair === 'object' && recordingPair.blueprint) 
            ? recordingPair.blueprint 
            : null;

        // Load new recording
        try {
            this.isLoading = true;
            this.updateStatus('⏳ Loading...');
            const startTime = performance.now();

            // Build URL array for this recording and its blueprint
            const urls = [this.baseUrl + rrdFilename];
            if (blueprintFile) {
                urls.push(this.baseUrl + blueprintFile);
            }

            // Load the recording using open()
            await this.viewer.open(urls);

            // Evict oldest recording if cache is full
            if (this.loadedRecordings.size >= this.maxCacheSize) {
                const oldestRecording = this.loadedRecordingsQueue.shift();
                const oldestRecordingId = oldestRecording.replace('.rrd', '');
                
                // Close/remove the recording from the viewer
                try {
                    await this.viewer.close(oldestRecordingId);
                    console.log(`🗑️ Evicted ${oldestRecording} from cache (max: ${this.maxCacheSize})`);
                } catch (e) {
                    console.warn(`Failed to close recording ${oldestRecordingId}:`, e);
                }
                
                this.loadedRecordings.delete(oldestRecording);
            }

            this.loadedRecordings.add(rrdFilename);
            this.loadedRecordingsQueue.push(rrdFilename);
            this.currentRecording = rrdFilename;

            const loadTime = ((performance.now() - startTime) / 1000).toFixed(2);
            this.updateStatus('✓ Ready');
            console.log(`✓ Loaded ${rrdFilename} in ${loadTime}s (cache: ${this.loadedRecordings.size}/${this.maxCacheSize})`);
            return true;
        } catch (e) {
            console.error("Load error:", e);
            this.updateStatus('✗ Error loading recording');
            return false;
        } finally {
            this.isLoading = false;
        }
    }

    updateStatus(message) {
        const statusEl = document.getElementById(this.statusId);
        if (statusEl) {
            statusEl.textContent = message;
        }
    }

    generateThumbnails() {
        const thumbnailsContainer = document.getElementById('rerun-thumbnails');
        if (!thumbnailsContainer) {
            console.warn('Thumbnails container not found');
            return;
        }

        // Clear existing thumbnails
        thumbnailsContainer.innerHTML = '';

        // Create wrapper for carousel
        const wrapper = document.createElement('div');
        wrapper.className = 'rerun-thumbnails-wrapper';

        // Create thumbnails container
        const thumbnailsDiv = document.createElement('div');
        thumbnailsDiv.className = 'rerun-thumbnails';
        thumbnailsDiv.id = 'rerun-thumbnails-scroll';

        // Generate thumbnails for each recording
        this.recordings.forEach((recording, index) => {
            const rrdFile = typeof recording === 'string' ? recording : recording.rrd;
            const thumbnailFile = typeof recording === 'object' && recording.thumbnail 
                ? recording.thumbnail 
                : null;

            const thumbnailDiv = document.createElement('div');
            thumbnailDiv.className = 'rerun-thumbnail';
            thumbnailDiv.setAttribute('data-rrd', rrdFile);
            
            if (thumbnailFile) {
                // Use actual thumbnail image
                const img = document.createElement('img');
                img.src = this.baseUrl + thumbnailFile;
                img.alt = `Example ${index + 1}`;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '8px';
                thumbnailDiv.appendChild(img);
            } else {
                // Fallback to gradient placeholder
                thumbnailDiv.style.background = 'linear-gradient(135deg, #667eea, #764ba2)';
                const span = document.createElement('span');
                span.textContent = `Example ${index + 1}`;
                span.style.color = 'white';
                span.style.fontSize = '0.9em';
                thumbnailDiv.appendChild(span);
            }

            thumbnailsDiv.appendChild(thumbnailDiv);
        });

        // Create navigation buttons
        const prevButton = document.createElement('button');
        prevButton.className = 'carousel-button prev';
        prevButton.innerHTML = '‹';
        prevButton.setAttribute('aria-label', 'Previous');

        const nextButton = document.createElement('button');
        nextButton.className = 'carousel-button next';
        nextButton.innerHTML = '›';
        nextButton.setAttribute('aria-label', 'Next');

        // Add carousel navigation
        prevButton.addEventListener('click', () => {
            thumbnailsDiv.scrollBy({ left: -300, behavior: 'smooth' });
        });

        nextButton.addEventListener('click', () => {
            thumbnailsDiv.scrollBy({ left: 300, behavior: 'smooth' });
        });

        // Update button states based on scroll position
        const updateButtonStates = () => {
            const scrollLeft = thumbnailsDiv.scrollLeft;
            const maxScroll = thumbnailsDiv.scrollWidth - thumbnailsDiv.clientWidth;
            
            prevButton.disabled = scrollLeft <= 0;
            nextButton.disabled = scrollLeft >= maxScroll - 1 || maxScroll <= 0;
        };

        thumbnailsDiv.addEventListener('scroll', updateButtonStates);
        
        // Initial update after a short delay to ensure DOM is ready
        setTimeout(updateButtonStates, 100);
        
        // Update again after images load
        const images = thumbnailsDiv.querySelectorAll('img');
        let loadedCount = 0;
        images.forEach(img => {
            if (img.complete) {
                loadedCount++;
            } else {
                img.addEventListener('load', () => {
                    loadedCount++;
                    if (loadedCount === images.length) {
                        updateButtonStates();
                    }
                });
            }
        });
        
        // Fallback: update after all images should be loaded
        if (loadedCount === images.length) {
            updateButtonStates();
        }

        // Assemble carousel with flexbox layout
        wrapper.appendChild(prevButton);
        wrapper.appendChild(thumbnailsDiv);
        wrapper.appendChild(nextButton);

        // Replace the original container with the wrapper
        thumbnailsContainer.parentNode.replaceChild(wrapper, thumbnailsContainer);

        console.log(`✓ Generated ${this.recordings.length} thumbnails with carousel`);
    }

    activateFirstThumbnail() {
        const thumbnails = document.querySelectorAll('.rerun-thumbnail');
        if (thumbnails.length > 0) {
            thumbnails[0].classList.add('active');
        }
    }

    setupThumbnailClicks() {
        document.addEventListener('click', async (e) => {
            const thumb = e.target.closest('.rerun-thumbnail');
            if (!thumb) return;

            // Prevent interaction during loading
            if (this.isLoading) {
                return;
            }

            // Check if already active
            if (thumb.classList.contains('active')) {
                return;
            }

            // Update active state
            document.querySelectorAll('.rerun-thumbnail').forEach(t => t.classList.remove('active'));
            thumb.classList.add('active');

            const rrdFile = thumb.dataset.rrd;
            if (rrdFile) {
                // Load recording on-demand (with caching)
                await this.loadRecording(rrdFile);
            }
        });
    }
}

// Simple initialization function for easy use
export function initRerunViewer(config) {
    const viewer = new RerunMultiViewer(config);
    viewer.setupThumbnailClicks();
    return viewer;
}
