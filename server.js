export class ServerHandler {
      static async sendBestFace(faceDataUrl, metadata, serverUrl, debugCallback) {
        try {
          debugCallback?.("Preparing server request...");
          
          if (!faceDataUrl || !faceDataUrl.startsWith('data:image/')) {
            throw new Error('Invalid face data URL');
          }
          
          const response = await fetch(faceDataUrl);
          const blob = await response.blob();
          
          if (blob.size === 0) {
            throw new Error('Empty image blob');
          }
          
          if (blob.size > 10 * 1024 * 1024) {
            throw new Error('Image too large (>10MB)');
          }
          
          const formData = new FormData();
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const filename = `best_face_${timestamp}.png`;
          
          formData.append('image', blob, filename);
          formData.append('score', metadata.score.toString());
          formData.append('timestamp', timestamp);
          formData.append('processed_faces', metadata.processedCount.toString());
          formData.append('blur_score', metadata.blurScore?.toString() || '0');
          formData.append('quality_score', metadata.qualityScore?.toString() || '0');
          
          debugCallback?.(`Sending ${filename} to server...`);
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);
          
          const serverResponse = await fetch(serverUrl, {
            method: 'POST',
            body: formData,
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (serverResponse.ok) {
            const result = await serverResponse.text();
            debugCallback?.("Server response received successfully");
            return { success: true, response: result };
          } else {
            const errorText = await serverResponse.text().catch(() => 'Unknown error');
            throw new Error(`Server error ${serverResponse.status}: ${errorText}`);
          }
          
        } catch (error) {
          const errorMessage = error.name === 'AbortError' 
            ? 'Request timeout (30s)' 
            : error.message;
          debugCallback?.(`Server error: ${errorMessage}`);
          return { success: false, error: errorMessage };
        }
      }
    }
