export function varianceOfLaplacian(imageData, width, height) {
      const gray = new Float32Array(width * height);
      for (let i = 0; i < width * height; i++) {
        const r = imageData.data[i * 4];
        const g = imageData.data[i * 4 + 1];
        const b = imageData.data[i * 4 + 2];
        gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      }

      let sum = 0;
      let sumSq = 0;
      let count = 0;

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          const lap =
            gray[idx - width] +      
            gray[idx + width] +      
            gray[idx - 1] +          
            gray[idx + 1] -          
            4 * gray[idx];           

          sum += lap;
          sumSq += lap * lap;
          count++;
        }
      }

      if (count === 0) return 0;
      const mean = sum / count;
      return sumSq / count - mean * mean;
    }
export function calculateFaceQuality(kps) {
      for (let kp of kps) {
        if (kp[0] < 0 || kp[1] < 0) {
          return -10;
        }
      }

      const [leftEye, rightEye, nose, leftMouth, rightMouth] = kps;
      const eyeCenter = [
        (leftEye[0] + rightEye[0]) / 2,
        (leftEye[1] + rightEye[1]) / 2
      ];
      const mouthCenter = [
        (leftMouth[0] + rightMouth[0]) / 2,
        (leftMouth[1] + rightMouth[1]) / 2
      ];

      const eyeDist = Math.sqrt(
        Math.pow(leftEye[0] - rightEye[0], 2) + 
        Math.pow(leftEye[1] - rightEye[1], 2)
      );
      const mouthDist = Math.sqrt(
        Math.pow(leftMouth[0] - rightMouth[0], 2) + 
        Math.pow(leftMouth[1] - rightMouth[1], 2)
      );

      if (eyeDist === 0 || mouthDist === 0) return -10;

      const diffEyeY = Math.abs(leftEye[1] - rightEye[1]) / eyeDist;
      const diffMouthY = Math.abs(leftMouth[1] - rightMouth[1]) / mouthDist;
      const noseOffset = Math.abs(nose[0] - eyeCenter[0]) / eyeDist;
      const mouthOffset = Math.abs(mouthCenter[0] - nose[0]) / mouthDist;
      
      const eyeMouthDist = Math.sqrt(
        Math.pow(mouthCenter[0] - eyeCenter[0], 2) + 
        Math.pow(mouthCenter[1] - eyeCenter[1], 2)
      );
      const verticalRatio = eyeMouthDist > 0 ? (mouthCenter[1] - eyeCenter[1]) / eyeMouthDist : 0;

      const leftEyeToNose = Math.sqrt(
        Math.pow(leftEye[0] - nose[0], 2) + Math.pow(leftEye[1] - nose[1], 2)
      );
      const rightEyeToNose = Math.sqrt(
        Math.pow(rightEye[0] - nose[0], 2) + Math.pow(rightEye[1] - nose[1], 2)
      );
      const diffEyeSymmetry = Math.abs(leftEyeToNose - rightEyeToNose) / eyeDist;

      const leftMouthToNose = Math.sqrt(
        Math.pow(leftMouth[0] - nose[0], 2) + Math.pow(leftMouth[1] - nose[1], 2)
      );
      const rightMouthToNose = Math.sqrt(
        Math.pow(rightMouth[0] - nose[0], 2) + Math.pow(rightMouth[1] - nose[1], 2)
      );
      const diffMouthSymmetry = Math.abs(leftMouthToNose - rightMouthToNose) / mouthDist;

      const scoreEyeY = Math.exp(-diffEyeY);
      const scoreMouthY = Math.exp(-diffMouthY);
      const scoreNoseOffset = Math.exp(-noseOffset);
      const scoreMouthOffset = Math.exp(-mouthOffset);
      const scoreVertical = verticalRatio;
      const scoreSymmetryEye = Math.exp(-diffEyeSymmetry);
      const scoreSymmetryMouth = Math.exp(-diffMouthSymmetry);

      const totalScore = (
        2 * scoreEyeY +
        1 * scoreMouthY +
        1 * scoreNoseOffset +
        2 * scoreMouthOffset +
        2 * scoreVertical +
        2 * scoreSymmetryEye +
        1 * scoreSymmetryMouth
      );

      return totalScore;
    }
    
export function alignFace(originalCanvas, kps, bbox, padding = 2){
    if (kps.length !== 5) {
        debugLog("Invalid keypoint count: " + kps.length);
        return null;
    }

    const [leftEye, rightEye] = [kps[0], kps[1]];


    const dy = rightEye[1] - leftEye[1];
    const dx = rightEye[0] - leftEye[0];
    const angleRad = Math.atan2(dy, dx);
    const angleDeg = angleRad * 180.0 / Math.PI;

    const eyeCenterX = (leftEye[0] + rightEye[0]) / 2;
    const eyeCenterY = (leftEye[1] + rightEye[1]) / 2;

    const w = originalCanvas.width;
    const h = originalCanvas.height;  

    const angle = -angleRad; // Canvas rotates opposite to OpenCV
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // Define corners of the original image
    let corners = [
        [0, 0], [w, 0],
        [0, h], [w, h]
    ];

    // Transform corners to find new bounding box
    let transformed = corners.map(([x, y]) => {
        let tx = (x - eyeCenterX) * cosA - (y - eyeCenterY) * sinA + eyeCenterX;
        let ty = (x - eyeCenterX) * sinA + (y - eyeCenterY) * cosA + eyeCenterY;
        return [tx, ty];
    });

    // Calculate new canvas dimensions
    let xs = transformed.map(p => p[0]);
    let ys = transformed.map(p => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const newW = Math.ceil(maxX - minX);
    const newH = Math.ceil(maxY - minY);

    // Create new canvas for rotated image
    const rotatedCanvas = document.createElement('canvas');
    rotatedCanvas.width = newW;
    rotatedCanvas.height = newH;
    const rotCtx = rotatedCanvas.getContext('2d');

    // Adjust translation to prevent cropping
    rotCtx.translate(-minX, -minY);
    rotCtx.translate(eyeCenterX, eyeCenterY);
    rotCtx.rotate(-angleRad); // Opposite direction for canvas
    rotCtx.translate(-eyeCenterX, -eyeCenterY);

    // Draw rotated image
    rotCtx.drawImage(originalCanvas, 0, 0);

    // Transform bounding box
    let bboxCorners = [
        [bbox.x1, bbox.y1],
        [bbox.x2, bbox.y1],
        [bbox.x1, bbox.y2],
        [bbox.x2, bbox.y2]
    ];

    let bboxTrans = bboxCorners.map(([x, y]) => {
        let tx = (x - eyeCenterX) * cosA - (y - eyeCenterY) * sinA + eyeCenterX - minX;
        let ty = (x - eyeCenterX) * sinA + (y - eyeCenterY) * cosA + eyeCenterY - minY;
        return [tx, ty];
    });

    // Calculate new bounding box coordinates with padding
    let bx = bboxTrans.map(p => p[0]);
    let by = bboxTrans.map(p => p[1]);
    const minBx = Math.max(0, Math.floor(Math.min(...bx)) - padding);
    const maxBx = Math.min(newW, Math.ceil(Math.max(...bx)) + padding);
    const minBy = Math.max(0, Math.floor(Math.min(...by)) - padding);
    const maxBy = Math.min(newH, Math.ceil(Math.max(...by)) + padding);

    // Validate bounding box dimensions
    if (maxBx <= minBx || maxBy <= minBy) {
        debugLog("Invalid bounding box dimensions after rotation");
        return null;
    }

    // Crop face from rotated canvas
    const faceCanvas = document.createElement('canvas');
    faceCanvas.width = maxBx - minBx;
    faceCanvas.height = maxBy - minBy;
    const faceCtx = faceCanvas.getContext('2d');
    faceCtx.drawImage(
        rotatedCanvas,
        minBx, minBy, faceCanvas.width, faceCanvas.height,
        0, 0, faceCanvas.width, faceCanvas.height
    );

    return faceCanvas;
}
export function distance2bbox(points, distance, maxShape = null) {
      const bboxes = [];
      for (let i = 0; i < points.length; i++) {
        const [px, py] = points[i];
        let x1 = px - distance[i * 4];
        let y1 = py - distance[i * 4 + 1];
        let x2 = px + distance[i * 4 + 2];
        let y2 = py + distance[i * 4 + 3];
        
        if (maxShape) {
          x1 = Math.max(0, Math.min(x1, maxShape[1]));
          y1 = Math.max(0, Math.min(y1, maxShape[0]));
          x2 = Math.max(0, Math.min(x2, maxShape[1]));
          y2 = Math.max(0, Math.min(y2, maxShape[0]));
        }
        bboxes.push([x1, y1, x2, y2]);
      }
      return bboxes;
    }

export function distance2kps(points, distance, maxShape = null) {
      const numKps = distance.length / (points.length * 2);
      const kpss = [];
      
      for (let i = 0; i < points.length; i++) {
        const [px, py] = points[i];
        const kps = [];
        
        for (let j = 0; j < numKps; j++) {
          let kx = px + distance[i * numKps * 2 + j * 2];
          let ky = py + distance[i * numKps * 2 + j * 2 + 1];
          
          if (maxShape) {
            kx = Math.max(0, Math.min(kx, maxShape[1]));
            ky = Math.max(0, Math.min(ky, maxShape[0]));
          }
          kps.push([kx, ky]);
        }
        kpss.push(kps);
      }
      return kpss;
    }

export  function nms(dets, thresh = 0.4) {
      if (!dets.length) return [];
      
      const sortedDets = dets.map((det, index) => ({ det, index }))
        .sort((a, b) => b.det[4] - a.det[4]);
      
      const keep = [];
      const suppressed = new Set();
      
      for (let i = 0; i < sortedDets.length; i++) {
        const { det: detA, index: idxA } = sortedDets[i];
        if (suppressed.has(idxA)) continue;
        
        keep.push(idxA);
        
        for (let j = i + 1; j < sortedDets.length; j++) {
          const { det: detB, index: idxB } = sortedDets[j];
          if (suppressed.has(idxB)) continue;
          
          const xx1 = Math.max(detA[0], detB[0]);
          const yy1 = Math.max(detA[1], detB[1]);
          const xx2 = Math.min(detA[2], detB[2]);
          const yy2 = Math.min(detA[3], detB[3]);
          
          const w = Math.max(0, xx2 - xx1 + 1);
          const h = Math.max(0, yy2 - yy1 + 1);
          const inter = w * h;
          
          const areaA = (detA[2] - detA[0] + 1) * (detA[3] - detA[1] + 1);
          const areaB = (detB[2] - detB[0] + 1) * (detB[3] - detB[1] + 1);
          const ovr = inter / (areaA + areaB - inter);
          
          if (ovr > thresh) {
            suppressed.add(idxB);
          }
        }
      }
      
      return keep;
    }

