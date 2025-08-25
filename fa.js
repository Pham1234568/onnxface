import * as ort from "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/esm/ort.min.js";
import { alignFace} from './evaluate.js';
import { FaceQualityAnalyzer } from './fqa.js';
import { UIController, AppState } from './ui.js';
import { ServerHandler } from './server.js';
import { EnhancedFaceDetector } from './fd.js';

export class FaceDetectionApp {
  constructor() {
    this.state = new AppState();
    this.ui = new UIController();
    this.detector = null;
    this.video = null;
    this.canvases = {};
    this.animationFrameId = null;
    
    this.initializeElements();
    this.setupEventListeners();
    this.initialize();

    this.autoMode = true;
    this.detectionEnabled = false;
    this.lastCycleStart = 0;
    this.cycleState = 'waiting'; 
    this.detectionDuration = 5000; 
    this.waitingForServerResponse = false;

    this.isVideoMode = false;
    this.videoFileInput = null;
    this.currentVideoUrl = null;
    this.videoEndedHandler = null;
  }

  initializeElements() {
    this.video = document.getElementById('video');
    this.canvases = {
      live: document.getElementById('liveCanvas'),
      results: document.getElementById('resultsCanvas'),
      bestFace: document.getElementById('bestFaceCanvas')
    };
    this.contexts = {
      live: this.canvases.live.getContext('2d'),
      results: this.canvases.results.getContext('2d'),
      bestFace: this.canvases.bestFace.getContext('2d')
    };

    this.createVideoFileInput();
  }

  createVideoFileInput() {
    try {
      const existingInput = document.getElementById('videoFileInput');
      if (existingInput) {
        existingInput.remove();
      }

      this.videoFileInput = document.createElement('input');
      this.videoFileInput.type = 'file';
      this.videoFileInput.accept = 'video/*';
      this.videoFileInput.style.display = 'none';
      this.videoFileInput.id = 'videoFileInput';
      document.body.appendChild(this.videoFileInput);

      this.videoFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          this.processVideoFile(e.target.files[0]);
        }
      });

      this.state.addDebugMessage('Video file input created successfully');
    } catch (error) {
      this.state.addDebugMessage(`Failed to create video file input: ${error.message}`);
      this.videoFileInput = null;
    }
  }

  setupEventListeners() {
    this.ui.elements.downloadBtn.addEventListener('click', () => this.handleDownload());
    this.ui.elements.resetBtn.addEventListener('click', () => this.handleReset());
    
    if (this.ui.elements.videoBtn) {
      this.ui.elements.videoBtn.addEventListener('click', () => this.handleVideo());
    } else {
      console.warn('Video button not found');
    }
    
    this.ui.elements.thresholdInput.addEventListener('change', (e) => {
      this.state.detectionThreshold = parseFloat(e.target.value);
      this.state.addDebugMessage(`Detection threshold: ${this.state.detectionThreshold}`);
    });
    
    this.ui.elements.blurInput.addEventListener('change', (e) => {
      this.state.blurThreshold = parseFloat(e.target.value);
      this.state.addDebugMessage(`Blur threshold: ${this.state.blurThreshold}`);
    });
    
    this.ui.elements.serverInput.addEventListener('change', (e) => {
      this.state.serverUrl = e.target.value.trim();
      this.state.addDebugMessage(`Server URL: ${this.state.serverUrl}`);
    });

    this.video.addEventListener('error', (e) => {
      this.state.addDebugMessage(`Video error: ${e.message}`);
      this.ui.updateStatus('Video stream error', 'error');
    });

  }

  async initialize() {
    try {
      this.ui.updateStatus('Initializing application...', 'info');
      await this.initializeDetector();
      await this.initializeCamera();
      this.startRenderLoop();
      this.startAutoCycle();
      
      this.ui.updateStatus('Auto detection cycle started', 'success');
      this.state.addDebugMessage('Application initialized - Auto cycle active');
      
    } catch (error) {
      console.error('Initialization failed:', error);
      this.state.addDebugMessage(`Initialization failed: ${error.message}`);
      this.ui.updateStatus(`Initialization failed: ${error.message}`, 'error');
    }
  }

  async initializeDetector() {
    try {
      this.state.addDebugMessage('Loading face detection model...');
      this.detector = await EnhancedFaceDetector.create('model_1_kps.onnx');
      this.state.addDebugMessage('Model loaded successfully');
    } catch (error) {
      this.state.addDebugMessage(`Model loading failed: ${error.message}`);
      this.state.addDebugMessage('Using demo detector (model unavailable)');
    }
  }

  async initializeCamera() {
    try {

      this.stopCurrentVideo();
      
      this.state.addDebugMessage('Requesting camera access...');
      
      const constraints = {
        video: {
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 30, max: 60 },
          facingMode: 'user'
        }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = stream;
      this.video.src = null; // Clear any file URL
      
      return new Promise((resolve, reject) => {
        this.video.onloadedmetadata = () => {
          this.video.play()
            .then(() => {
              this.setupCanvases();
              this.isVideoMode = false;
              this.state.addDebugMessage(`Camera initialized: ${this.video.videoWidth}x${this.video.videoHeight}`);
              resolve();
            })
            .catch(reject);
        };
        
        this.video.onerror = reject;
        setTimeout(() => reject(new Error('Camera initialization timeout')), 10000);
      });
      
    } catch (error) {
      throw new Error(`Camera access failed: ${error.message}`);
    }
  }

  setupCanvases() {
    const width = this.video.videoWidth;
    const height = this.video.videoHeight;
    
    Object.values(this.canvases).forEach(canvas => {
      if (canvas !== this.canvases.bestFace) {
        canvas.width = width;
        canvas.height = height;
      }
    });
    
    this.state.addDebugMessage(`Canvas setup: ${width}x${height}`);
  }

  startRenderLoop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    
    const render = async () => {
      try {
        if (this.video.readyState === 4 && this.video.videoWidth > 0) {
          await this.processFrame();
        }
        this.animationFrameId = requestAnimationFrame(render);
      } catch (error) {
        console.error('Render loop error:', error);
        this.state.addDebugMessage(`Render error: ${error.message}`);
      }
    };
    
    render();
  }

  startAutoCycle() {
    this.autoMode = true;
    this.cycleState = 'waiting';
    this.lastCycleStart = performance.now();
    this.state.addDebugMessage('Auto cycle started - waiting for first detection');
    this.ui.updateStatus('Auto cycle: Waiting to start detection...', 'info');
  }

  async processFrame() {
    const currentTime = performance.now();

    this.contexts.live.drawImage(this.video, 0, 0);
    this.contexts.results.drawImage(this.video, 0, 0);

    if (this.autoMode && !this.waitingForServerResponse && !this.isVideoMode) {
      await this.handleAutoCycle(currentTime);
    }
    if (!this.detectionEnabled) {
      return;
    }

    const timeSinceLastDetection = currentTime - this.state.lastDetectionTime;
    if (this.state.isProcessing || timeSinceLastDetection < 100) {
      return;
    }

    this.state.isProcessing = true;
    this.state.lastDetectionTime = currentTime;

    try {
      const faces = await this.detector.detect(this.video, this.state.detectionThreshold);

      if (faces.length > 0) {
        this.state.facesDetected++;
      }

      await this.processFaces(faces);

      this.drawDetectionResults(faces);
      this.updateUI();
      
    } catch (error) {
      this.state.addDebugMessage(`Detection error: ${error.message}`);
    } finally {
      this.state.isProcessing = false;
    }
  }

  async handleAutoCycle(currentTime) {
    const elapsed = currentTime - this.lastCycleStart;

    switch (this.cycleState) {
      case 'waiting':
        if (elapsed >= 2000) {
          this.startDetectionCycle();
        }
        break;

      case 'detecting':
        if (elapsed >= this.detectionDuration) {
          await this.endDetectionCycle();
        } else {
          const remaining = Math.ceil((this.detectionDuration - elapsed) / 1000);
          this.ui.updateStatus(`🔍 Auto detecting... ${remaining}s remaining`, 'info');
        }
        break;

      case 'sending':
        break;
    }
  }

  startDetectionCycle() {
    this.cycleState = 'detecting';
    this.detectionEnabled = true;
    this.state.isCapturing = true;
    this.lastCycleStart = performance.now();
    
    this.state.bestScore = 0;
    this.state.bestFaceData = null;
    this.state.bestFaceInfo = null;
    this.state.facesProcessed = 0;
    this.state.facesDetected = 0;
    
    this.state.addDebugMessage('Detection cycle started');
    this.ui.updateStatus('Auto detecting faces...', 'info');
    this.ui.updateBestFace(null);
  }

  async endDetectionCycle() {
    this.cycleState = 'sending';
    this.detectionEnabled = false;
    this.state.isCapturing = false;
    
    this.state.addDebugMessage(`Detection cycle ended. Processed ${this.state.facesProcessed} faces`);
    
    if (this.state.bestFaceData) {
      this.state.addDebugMessage('Sending best face to server...');
      this.ui.updateStatus('Sending best face to server...', 'info');
      await this.autoSendToServer();
    } else {
      this.state.addDebugMessage('No best face found in this cycle');
      this.ui.updateStatus(' No face found, starting next cycle', 'warning');
      this.startNextCycle();
    }
  }

  async autoSendToServer() {
    if (!this.state.bestFaceData) {
      if (!this.isVideoMode) {
        this.startNextCycle();
      }
      return;
    }

    try {
      this.waitingForServerResponse = true;
      this.state.isSending = true;
      
      const metadata = {
        score: this.state.bestScore,
        processedCount: this.state.facesProcessed,
        blurScore: this.state.bestFaceInfo?.blur,
        qualityScore: this.state.bestFaceInfo?.quality,
        cycle: Date.now(),
        source: this.isVideoMode ? 'video' : 'camera'
      };
      
      const result = await ServerHandler.sendBestFace(
        this.state.bestFaceData,
        metadata,
        this.state.serverUrl,
        (msg) => this.state.addDebugMessage(msg)
      );
      
      if (result.success) {
        this.ui.updateStatus('Server response received!', 'success');
        this.ui.updateServerResponse(result.response);
        this.state.addDebugMessage('Server request completed successfully');
      } else {
        this.ui.updateStatus(`Server error: ${result.error}`, 'error');
        this.ui.updateServerResponse(`Error: ${result.error}`);
        this.state.addDebugMessage(`Server request failed: ${result.error}`);
      }
      
    } catch (error) {
      this.state.addDebugMessage(`Unexpected server error: ${error.message}`);
      this.ui.updateStatus(`Unexpected error: ${error.message}`, 'error');
    } finally {
      this.waitingForServerResponse = false;
      this.state.isSending = false;

      if (this.isVideoMode) {
        setTimeout(async () => {
          await this.switchToCameraMode();
        }, 1000);
      } else {
        setTimeout(() => {
          this.startNextCycle();
        }, 2000);
      }
    }
  }

  startNextCycle() {
    if (!this.isVideoMode) {
      this.cycleState = 'waiting';
      this.lastCycleStart = performance.now();
      this.state.addDebugMessage('Waiting for next cycle...');
      this.ui.updateStatus('Next cycle starting soon...', 'info');
    }
  }

  async processFaces(faces) {
    if (!this.state.isCapturing || faces.length === 0) {
      return;
    }
    
    for (const face of faces) {
      if (face.kps.length >= 5) {
        await this.processSingleFace(face);
      }
    }
  }

  async processSingleFace(face) {
    try {
      this.state.facesProcessed++;
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = this.video.videoWidth;
      sourceCanvas.height = this.video.videoHeight;
      const sourceCtx = sourceCanvas.getContext('2d');
      sourceCtx.drawImage(this.video, 0, 0);
      
      const faceBBox = {
        x1: face.bbox[0],
        y1: face.bbox[1],
        x2: face.bbox[0] + face.bbox[2],
        y2: face.bbox[1] + face.bbox[3]
      };
      
      const alignedCanvas = alignFace(sourceCanvas, face.kps, faceBBox);
      if (!alignedCanvas) {
        this.state.addDebugMessage('Face alignment failed');
        return;
      }
      
      const analysis = FaceQualityAnalyzer.analyzeFace(alignedCanvas, face.kps, face.bbox);
      if (!analysis) {
        this.state.addDebugMessage('Face quality analysis failed');
        return;
      }
      
      this.state.currentQuality = analysis.blur;
    
      if (analysis.blur >= this.state.blurThreshold && analysis.overallScore > this.state.bestScore) {
        this.updateBestFace(alignedCanvas, analysis, face);
        this.state.addDebugMessage(`New best face! Score: ${analysis.overallScore.toFixed(3)}`);
      } else if (analysis.blur < this.state.blurThreshold) {
        this.state.addDebugMessage(`Face too blurry: ${analysis.blur.toFixed(1)} < ${this.state.blurThreshold}`);
      }
      
    } catch (error) {
      this.state.addDebugMessage(`Face processing error: ${error.message}`);
    }
  }

  updateBestFace(canvas, analysis, face) {
    this.state.bestScore = analysis.overallScore;
    this.state.bestFaceData = canvas.toDataURL('image/png');
    this.state.bestFaceInfo = {
      width: analysis.width,
      height: analysis.height,
      blur: analysis.blur.toFixed(1),
      quality: analysis.quality.toFixed(2),
      score: face.score,
      overallScore: analysis.overallScore
    };
    
    this.ui.updateBestFace(canvas, this.state.bestFaceInfo);
  }

  drawDetectionResults(faces) {
    const ctx = this.contexts.results;

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#4CAF50';
    ctx.fillStyle = '#ff4444';
    ctx.font = '14px Arial';
    
    faces.forEach(face => {
      const [x, y, w, h] = face.bbox;
      
      ctx.strokeRect(x, y, w, h);
      

      ctx.fillStyle = '#4CAF50';
      ctx.fillRect(x, y - 25, 60, 20);
      ctx.fillStyle = 'white';
      ctx.fillText(`${(face.score * 100).toFixed(0)}%`, x + 5, y - 10);
      
      if (face.kps && face.kps.length >= 5) {
        ctx.fillStyle = '#ff4444';
        face.kps.forEach(([kx, ky], i) => {
          ctx.beginPath();
          ctx.arc(kx, ky, 3, 0, 2 * Math.PI);
          ctx.fill();
          
          if (i < 5) {
            ctx.fillStyle = 'white';
            ctx.font = '10px Arial';
            ctx.fillText(i.toString(), kx + 5, ky - 5);
            ctx.fillStyle = '#ff4444';
            ctx.font = '14px Arial';
          }
        });
      }
    });
  }

  updateUI() {
    this.ui.updateDebug(this.state.debugMessages);
    
    let progress = 0;
    if (this.isVideoMode && this.state.isCapturing) {
      if (this.video.duration) {
        progress = (this.video.currentTime / this.video.duration) * 100;
      }
    } else if (this.cycleState === 'detecting') {
      const elapsed = performance.now() - this.lastCycleStart;
      progress = Math.min(100, (elapsed / this.detectionDuration) * 100);
    } else if (this.cycleState === 'sending') {
      progress = 100;
    }
    this.ui.updateProgress(progress);
    
  }

  handleVideo() {
    if (this.isVideoMode) {
      this.ui.updateStatus('Already processing video', 'warning');
      return;
    }

    if (this.waitingForServerResponse) {
      this.ui.updateStatus('Please wait for current operation to complete', 'warning');
      return;
    }

    if (!this.videoFileInput) {
      this.state.addDebugMessage('Video file input not found, recreating...');
      this.createVideoFileInput();
      
      if (!this.videoFileInput) {
        this.ui.updateStatus('Failed to create video input', 'error');
        return;
      }
    }

    try {
      this.ui.updateStatus('Select a video file...', 'info');
      this.videoFileInput.value = '';
      this.videoFileInput.click();
    } catch (error) {
      this.state.addDebugMessage(`Error opening file dialog: ${error.message}`);
      this.ui.updateStatus('Failed to open file dialog', 'error');

      this.createVideoFileInput();
    }
  }

  async processVideoFile(file) {
    if (!file) {
      this.ui.updateStatus('No video file selected', 'warning');
      return;
    }

    try {
      this.ui.updateStatus('Loading video file...', 'info');
      this.state.addDebugMessage(`Loading video file: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);

      this.autoMode = false;
      this.detectionEnabled = false;
      this.isVideoMode = true;
      this.state.reset();
      

      this.stopCurrentVideo();

      this.currentVideoUrl = URL.createObjectURL(file);
      this.video.src = this.currentVideoUrl;
      this.video.srcObject = null;
      this.video.loop = false;

      this.videoEndedHandler = async () => {
        this.detectionEnabled = false;
        this.state.isCapturing = false;
        
        this.state.addDebugMessage(`Video processing completed. Found ${this.state.facesProcessed} faces`);
        
        if (this.state.bestFaceData) {
          this.ui.updateStatus('Sending best face from video...', 'info');
          await this.autoSendToServer();
        } else {
          this.state.addDebugMessage('No suitable face found in video');
          this.ui.updateStatus('No face found in video', 'warning');
          setTimeout(async () => {
            await this.switchToCameraMode();
          }, 2000);
        }
      };
      
      this.video.addEventListener('ended', this.videoEndedHandler);
      await new Promise((resolve, reject) => {
        this.video.onloadedmetadata = () => {
          this.setupCanvases();
          this.state.addDebugMessage(`Video loaded: ${this.video.videoWidth}x${this.video.videoHeight}, ${this.video.duration.toFixed(1)}s`);
          resolve();
        };
        this.video.onerror = () => reject(new Error('Failed to load video'));
        setTimeout(() => reject(new Error('Video loading timeout')), 15000);
      });

      this.state.isCapturing = true;
      this.detectionEnabled = true;
      
      this.ui.updateStatus('Processing video for best face...', 'info');
      this.state.addDebugMessage('Started video processing');
      
      await this.video.play();

    } catch (error) {
      this.state.addDebugMessage(`Video processing error: ${error.message}`);
      this.ui.updateStatus(`Video processing failed: ${error.message}`, 'error');
      
      await this.switchToCameraMode();
    }
  }

  stopCurrentVideo() {
    if (this.video.srcObject) {
      const stream = this.video.srcObject;
      const tracks = stream.getTracks();
      tracks.forEach(track => track.stop());
      this.video.srcObject = null;
    }
    
    if (this.currentVideoUrl) {
      URL.revokeObjectURL(this.currentVideoUrl);
      this.currentVideoUrl = null;
    }
    
    if (this.videoEndedHandler) {
      this.video.removeEventListener('ended', this.videoEndedHandler);
      this.videoEndedHandler = null;
    }
    
    this.video.src = '';
  }

  async switchToCameraMode() {
    try {
      this.state.addDebugMessage('Switching back to camera mode...');
      this.ui.updateStatus('Returning to camera mode...', 'info');
      
      this.stopCurrentVideo();
      this.isVideoMode = false;
      
      await this.initializeCamera();

      this.startAutoCycle();
      
      this.ui.updateStatus('Camera mode resumed', 'success');
      this.state.addDebugMessage('Successfully switched to camera mode');
      
    } catch (error) {
      this.state.addDebugMessage(`Failed to switch to camera: ${error.message}`);
      this.ui.updateStatus(`Camera initialization failed: ${error.message}`, 'error');
    }
  }

  async handleCaptureToggle() {
    if (this.autoMode) {
      this.autoMode = false;
      this.detectionEnabled = false;
      this.state.addDebugMessage('Switched to manual mode');
    }

    if (!this.state.isCapturing) {
      this.state.reset();
      this.state.isCapturing = true;
      this.detectionEnabled = true;
      
      this.ui.updateStatus('Manual capture mode - Capturing best face...', 'info');
      this.ui.updateBestFace(null);
      this.ui.updateServerResponse('');
      
      this.state.addDebugMessage('Started manual capturing session');
      
    } else {
      this.detectionEnabled = false;
      
      if (this.state.bestFaceData) {
        this.ui.updateStatus('Manual capture stopped - Best face ready', 'success');
        this.state.addDebugMessage('Manual capturing session ended - best face available');
      } else {
        this.ui.updateStatus('Manual capture stopped - No best face captured', 'warning');
        this.state.addDebugMessage('Manual capturing session ended - no best face found');
      }
    }
  }

  async handleSend2Server() {
    if (this.state.isSending || !this.state.bestFaceData) {
      return;
    }
    await this.autoSendToServer();
  }

  handleDownload() {
    if (!this.state.bestFaceData) {
      this.ui.updateStatus('No best face to download', 'warning');
      return;
    }
    
    try {
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      link.download = `best_face_${timestamp}_score_${this.state.bestScore.toFixed(2)}.png`;
      link.href = this.state.bestFaceData;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      this.ui.updateStatus('Best face downloaded successfully!', 'success');
      this.state.addDebugMessage('Best face downloaded');
      
    } catch (error) {
      this.state.addDebugMessage(`Download error: ${error.message}`);
      this.ui.updateStatus(`Download failed: ${error.message}`, 'error');
    }
  }

  handleReset() {
    if (this.state.isSending) {
      return;
    }

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    
    this.state.reset();
    this.waitingForServerResponse = false;
    
    this.ui.updateStatus('Reset complete - Restarting...', 'success');
    this.ui.updateProgress(0);
    this.ui.updateBestFace(null);
    this.ui.updateServerResponse('No server response yet...');
    this.ui.updateDebug([]);

    if (this.isVideoMode) {
      this.switchToCameraMode();
    } else {
      this.startRenderLoop();
      this.startAutoCycle();
    }
    
    this.state.addDebugMessage('Application reset');
  }

  destroy() {
    this.autoMode = false;
    
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    
    this.stopCurrentVideo();
    
    // Clean up video file input
    if (this.videoFileInput) {
      try {
        if (this.videoFileInput.parentNode) {
          this.videoFileInput.parentNode.removeChild(this.videoFileInput);
        }
        this.videoFileInput = null;
      } catch (error) {
        console.warn('Error removing video file input:', error);
      }
    }
    
    this.state.addDebugMessage('Application destroyed');
  }
}