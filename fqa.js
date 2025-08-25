import {calculateFaceQuality, varianceOfLaplacian} from './evaluate.js';
export class FaceQualityAnalyzer {
      static analyzeFace(alignedCanvas, keypoints, originalBbox) {
        if (!alignedCanvas || !keypoints || keypoints.length < 5) {
          return null;
        }
        
        const ctx = alignedCanvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, alignedCanvas.width, alignedCanvas.height);
        
        const blurScore = varianceOfLaplacian(imageData, alignedCanvas.width, alignedCanvas.height);

        const qualityScore = calculateFaceQuality(keypoints);

        const faceArea = originalBbox[2] * originalBbox[3];
        const imageArea = alignedCanvas.width * alignedCanvas.height;
        const sizeRatio = faceArea / imageArea;
        
        return {
          blur: blurScore,
          quality: qualityScore,
          size: sizeRatio,
          width: alignedCanvas.width,
          height: alignedCanvas.height,
          overallScore: qualityScore
        };
      }
    }