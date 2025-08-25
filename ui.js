export class UIController {
      constructor() {
        this.elements = {
          downloadBtn: document.getElementById('downloadBtn'),
          videoBtn:document.getElementById('videoBtn'),
          resetBtn: document.getElementById('resetBtn'),
          statusDisplay: document.getElementById('statusDisplay'),
          progressFill: document.getElementById('progressFill'),
          bestScoreStat: document.getElementById('bestScoreStat'),
          detectedStat: document.getElementById('detectedStat'),
          processedStat: document.getElementById('processedStat'),
          qualityStat: document.getElementById('qualityStat'),
          thresholdInput: document.getElementById('thresholdInput'),
          blurInput: document.getElementById('blurInput'),
          serverInput: document.getElementById('serverInput'),
          bestFaceCanvas: document.getElementById('bestFaceCanvas'),
          bestFaceInfo: document.getElementById('bestFaceInfo'),
          serverResult: document.getElementById('serverResult'),
          debugPanel: document.getElementById('debugPanel')
        };
      }

      updateStatus(message, type = 'info') {
        const statusClasses = {
          success: 'status-success',
          error: 'status-error',
          warning: 'status-warning',
          info: 'status-info'
        };
        
        this.elements.statusDisplay.innerHTML = `<div class="${statusClasses[type] || 'status-info'}">${message}</div>`;
      }

      updateProgress(percentage) {
        this.elements.progressFill.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
      }

      updateBestFace(canvas, info) {
        if (canvas) {
          this.elements.bestFaceCanvas.width = canvas.width;
          this.elements.bestFaceCanvas.height = canvas.height;
          const ctx = this.elements.bestFaceCanvas.getContext('2d');
          ctx.drawImage(canvas, 0, 0);
          this.elements.bestFaceCanvas.style.display = 'block';
          this.elements.downloadBtn.disabled = false;
          
          if (info) {
            this.elements.bestFaceInfo.textContent = `${info.width}×${info.height} | Blur: ${info.blur} | Quality: ${info.quality}`;
          }
        } else {
          this.elements.bestFaceCanvas.style.display = 'none';
          this.elements.downloadBtn.disabled = true;
          this.elements.bestFaceInfo.textContent = '';
        }
      }

      updateDebug(messages) {
        this.elements.debugPanel.textContent = messages.slice(0, 20).join('\n');
      }

      updateServerResponse(response) {
        this.elements.serverResult.textContent = response || 'No server response yet...';
      }

      setButtonState(button, text, disabled = false, loading = false) {
        button.disabled = disabled;
        if (loading) {
          button.innerHTML = `<span class="loading-spinner"></span>${text}`;
        } else {
          button.textContent = text;
        }
      }
      
    }
export    class AppState {
      constructor() {
        this.isSending = false;
        this.bestScore = 0;
        this.bestFaceData = null;
        this.bestFaceInfo = null;
        this.facesDetected = 0;
        this.facesProcessed = 0;
        this.currentQuality = 0;
        this.detectionThreshold = 0.5;
        this.blurThreshold = 50;
        this.serverUrl = 'https://85d0b460fb81.ngrok-free.app/query';
        this.isProcessing = false;
        this.lastDetectionTime = 0;
        this.debugMessages = [];
        this.sendVid=false;
      }

      reset() {
        this.isSending = false;
        this.bestScore = 0;
        this.bestFaceData = null;
        this.bestFaceInfo = null;
        this.facesDetected = 0;
        this.facesProcessed = 0;
        this.currentQuality = 0;
        this.isProcessing = false;
        this.debugMessages = [];
      }

      addDebugMessage(message) {
        const timestamp = new Date().toLocaleTimeString();
        this.debugMessages.unshift(`[${timestamp}] ${message}`);
        if (this.debugMessages.length > 50) {
          this.debugMessages.pop();
        }
      }
    }