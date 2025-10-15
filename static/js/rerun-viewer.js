/**
 * Rerun Multi-Recording Viewer
 * A simple viewer for switching between multiple Rerun recordings
 * 
 * Usage:
 * const viewer = new RerunMultiViewer({
 *     containerId: 'viewer',
 *     statusId: 'status',
 *     baseUrl: 'http://localhost:8888/',
 *     recordings: [
 *         { rrd: 'recording1.rrd', blueprint: 'blueprint1.rbl' },
 *         { rrd: 'recording2.rrd', blueprint: 'blueprint2.rbl' }
 *     ]
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
        this.loadOnClick = config.loadOnClick === true; // Default: false (preload mode)
        this.currentRecording = null;
        this.loadedRecordings = new Set(); // Track loaded recordings for cache
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
            // Create viewer instance
            this.viewer = new WebViewer();

            if (this.loadOnClick) {
                // On-demand mode: Start with container but no recordings yet
                const container = document.getElementById(this.containerId);
                await this.viewer.start([], container, {
                    render_backend: "webgl",
                    hide_welcome_screen: true,
                    panel_state_overrides: { blueprint: "Hidden", time: "Hidden", top: "Hidden" }
                });
                this.updateStatus('✓ Ready - Click to load');
            } else {
                // Preload mode: Load all recording-blueprint pairs at startup
                // Build URLs for all recordings and their blueprints
                const urls = [];
                
                // Reverse order so first recording is shown by default
                const reversedRecordings = [...this.recordings].reverse();
                
                for (const rec of reversedRecordings) {
                    const rrdFile = typeof rec === 'string' ? rec : rec.rrd;
                    const blueprintFile = typeof rec === 'object' ? rec.blueprint : null;
                    
                    urls.push(this.baseUrl + rrdFile);
                    if (blueprintFile) {
                        urls.push(this.baseUrl + blueprintFile);
                    }
                }

                const container = document.getElementById(this.containerId);
                await this.viewer.start(urls, container, {
                    render_backend: "webgl",
                    hide_welcome_screen: true,
                    panel_state_overrides: { blueprint: "Hidden", time: "Hidden", top: "Hidden" }
                });

                this.currentRecording = typeof this.recordings[0] === 'string' 
                    ? this.recordings[0] 
                    : this.recordings[0].rrd;
                this.updateStatus('✓ Ready');
                this.activateFirstThumbnail();
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
                this.updateStatus('✓ Ready');
                return true;
            } catch (e) {
                console.warn("Cache switch failed, reloading:", e);
                this.loadedRecordings.delete(rrdFilename);
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

            this.loadedRecordings.add(rrdFilename);
            this.currentRecording = rrdFilename;

            const loadTime = ((performance.now() - startTime) / 1000).toFixed(2);
            this.updateStatus('✓ Ready');
            console.log(`✓ Loaded ${rrdFilename} in ${loadTime}s`);
            return true;
        } catch (e) {
            console.error("Load error:", e);
            this.updateStatus('✗ Error loading recording');
            return false;
        } finally {
            this.isLoading = false;
        }
    }

    async switchRecording(rrdFilename) {
        if (!this.viewer) {
            console.error("Viewer not initialized");
            return false;
        }

        // Don't switch if already showing this recording
        if (this.currentRecording === rrdFilename) {
            console.log(`Already showing ${rrdFilename}`);
            return true;
        }

        // Extract recording ID from filename (remove .rrd extension)
        const recordingId = rrdFilename.replace('.rrd', '');

        try {
            await this.viewer.set_active_recording_id(recordingId);
            this.currentRecording = rrdFilename;
            console.log(`✓ Switched to ${recordingId}`);
            return true;
        } catch (e) {
            console.error("Switch error:", e);
            return false;
        }
    }

    updateStatus(message) {
        const statusEl = document.getElementById(this.statusId);
        if (statusEl) {
            statusEl.textContent = message;
        }
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

            // Update active state
            document.querySelectorAll('.rerun-thumbnail').forEach(t => t.classList.remove('active'));
            thumb.classList.add('active');

            const rrdFile = thumb.dataset.rrd;
            if (rrdFile) {
                if (this.loadOnClick) {
                    // On-demand mode: Load recording on each click (with caching)
                    await this.loadRecording(rrdFile);
                } else {
                    // Preload mode: Just switch between preloaded recordings
                    await this.switchRecording(rrdFile);
                }
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
