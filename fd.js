import * as ort from "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/esm/ort.min.js";
import {nms, distance2kps, distance2bbox} from './evaluate.js';
ort.env.wasm.proxy = false;
ort.env.wasm.numThreads = 3;
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/";
export class EnhancedFaceDetector {
      constructor(session) {
        this.session = session;
        this.nmsThresh = 0.4;
        this.centerCache = new Map();
        this.initializeDetector();
      }

      initializeDetector() {
        const outputs = this.session.outputNames;
        const F = outputs.length;
        
        if (F === 6 || F === 9) {
          this.fmc = 3;
          this.strides = [8, 16, 32];
          this.useKps = F === 9;
          this.numAnchors = 2;
        } else {
          this.fmc = 5;
          this.strides = [8, 16, 32, 64, 128];
          this.useKps = F === 15;
          this.numAnchors = 1;
        }
        
        this.inputName = this.session.inputNames[0];
        this.outputNames = this.session.outputNames;
        this.inputSize = [640, 640];
      }

      static async create(modelUrl) {
        try {
          const session = await ort.InferenceSession.create(modelUrl, {
            executionProviders: ['wasm'],
          });
          return new EnhancedFaceDetector(session);
        } catch (error) {
          console.error("Failed to create face detector:", error);
          throw new Error(`Model loading failed: ${error.message}`);
        }
      }

      async detect(source, threshold = 0.5) {
        if (!source || source.videoWidth === 0 || source.videoHeight === 0) {
          return [];
        }

        try {
          const startTime = performance.now();
          const faces = await this.performDetection(source, threshold);
          const endTime = performance.now();
          
          // Add performance info to faces
          faces.forEach(face => {
            face.detectionTime = endTime - startTime;
          });
          
          return faces;
        } catch (error) {
          console.error("Detection error:", error);
          return [];
        }
      }

      async performDetection(source, threshold) {
        const imgHeight = source.videoHeight;
        const imgWidth = source.videoWidth;
        const [inputWidth, inputHeight] = this.inputSize;
        
        const imRatio = imgHeight / imgWidth;
        const modelRatio = inputHeight / inputWidth;
        
        let newHeight, newWidth, detScale;
        if (imRatio > modelRatio) {
          newHeight = inputHeight;
          newWidth = Math.round(newHeight / imRatio);
        } else {
          newWidth = inputWidth;
          newHeight = Math.round(newWidth * imRatio);
        }
        detScale = newHeight / imgHeight;

        // Prepare input tensor
        const tensor = this.prepareInputTensor(source, inputWidth, inputHeight, newWidth, newHeight);
        
        // Run inference
        const outputs = await this.session.run({ [this.inputName]: tensor });
        
        // Process outputs
        return this.processOutputs(outputs, detScale, threshold, inputHeight, inputWidth);
      }

      prepareInputTensor(source, inputWidth, inputHeight, newWidth, newHeight) {
        const detCanvas = document.createElement('canvas');
        detCanvas.width = inputWidth;
        detCanvas.height = inputHeight;
        const detCtx = detCanvas.getContext('2d');
        
        detCtx.fillStyle = 'black';
        detCtx.fillRect(0, 0, inputWidth, inputHeight);
        detCtx.drawImage(source, 0, 0, newWidth, newHeight);

        const imageData = detCtx.getImageData(0, 0, inputWidth, inputHeight);
        const data = imageData.data;
        const floatData = new Float32Array(inputWidth * inputHeight * 3);

        for (let y = 0; y < inputHeight; y++) {
          for (let x = 0; x < inputWidth; x++) {
            const idx = (y * inputWidth + x) * 4;
            const outIdx = y * inputWidth + x;
            
            floatData[outIdx] = (data[idx + 2] - 127.5) / 128; // B
            floatData[outIdx + inputWidth * inputHeight] = (data[idx + 1] - 127.5) / 128; // G
            floatData[outIdx + inputWidth * inputHeight * 2] = (data[idx] - 127.5) / 128; // R
          }
        }

        return new ort.Tensor('float32', floatData, [1, 3, inputHeight, inputWidth]);
      }

      processOutputs(outputs, detScale, threshold, inputHeight, inputWidth) {
        const scoresList = [];
        const bboxesList = [];
        const kpsList = [];

        for (let idx = 0; idx < this.strides.length; idx++) {
          const stride = this.strides[idx];
          const scores = outputs[this.outputNames[idx]].data;
          const bboxPred = outputs[this.outputNames[idx + this.fmc]].data;
          const kpsPred = this.useKps ? outputs[this.outputNames[idx + 2 * this.fmc]].data : null;

          const scaledBboxPred = Array.from(bboxPred).map(x => x * stride);
          const scaledKpsPred = kpsPred ? Array.from(kpsPred).map(x => x * stride) : null;

          const height = Math.floor(inputHeight / stride);
          const width = Math.floor(inputWidth / stride);
          const key = `${height}-${width}-${stride}`;
          
          let anchorCenters = this.centerCache.get(key);
          if (!anchorCenters) {
            const centers = [];
            for (let y = 0; y < height; y++) {
              for (let x = 0; x < width; x++) {
                centers.push([x * stride, y * stride]);
              }
            }
            
            anchorCenters = this.numAnchors > 1 
              ? centers.flatMap(c => Array(this.numAnchors).fill(c))
              : centers;
            
            this.centerCache.set(key, anchorCenters);
          }

          const posIndices = [];
          for (let i = 0; i < scores.length; i++) {
            if (scores[i] >= threshold) {
              posIndices.push(i);
            }
          }

          if (posIndices.length > 0) {
            const bboxes = distance2bbox(anchorCenters, scaledBboxPred, [inputHeight, inputWidth]);
            const posScores = posIndices.map(i => scores[i]);
            const posBboxes = posIndices.map(i => bboxes[i]);
            
            scoresList.push(posScores);
            bboxesList.push(posBboxes);
            
            if (this.useKps && scaledKpsPred) {
              const kpss = distance2kps(anchorCenters, scaledKpsPred, [inputHeight, inputWidth]);
              const posKpss = posIndices.map(i => kpss[i]);
              kpsList.push(posKpss);
            }
          }
        }

        const allScores = scoresList.flat();
        const allBboxes = bboxesList.flat();
        const allKpss = this.useKps ? kpsList.flat() : [];

        if (allScores.length === 0) {
          return [];
        }

        const dets = allBboxes.map((bbox, i) => [...bbox, allScores[i]]);
        const keepIndices = nms(dets, this.nmsThresh);

        return keepIndices.map(i => {
          const det = dets[i];
          return {
            bbox: [
              det[0] / detScale,
              det[1] / detScale,
              (det[2] - det[0]) / detScale,
              (det[3] - det[1]) / detScale
            ],
            score: det[4],
            kps: this.useKps && allKpss[i] ? allKpss[i].map(([kx, ky]) => [
              kx / detScale,
              ky / detScale
            ]) : []
          };
        });
      }
    }