import { ASPECT_TOLERANCE, type GeometryMapping, type Rect } from '../../contracts/src/application.js';
import { AppError } from '../../contracts/src/errors.js';

export function parseSizeToken(token: string): { width: number; height: number } | { ratio: number } {
  const pixel = /^([1-9][0-9]{0,4})x([1-9][0-9]{0,4})$/i.exec(token.trim());
  if (pixel) return { width: Number(pixel[1]), height: Number(pixel[2]) };
  const ratio = /^([1-9][0-9]{0,3}):([1-9][0-9]{0,3})$/.exec(token.trim());
  if (ratio) return { ratio: Number(ratio[1]) / Number(ratio[2]) };
  throw new AppError(400, 'INVALID_REQUEST', '无法识别的尺寸参数。');
}

export function requestCanvasForSource(
  sourceWidth: number,
  sourceHeight: number,
  sizeToken: string | undefined,
  fallbackEdge: number
): { width: number; height: number } {
  if (!sizeToken || sizeToken === 'auto') {
    const scale = Math.min(1, fallbackEdge / Math.max(sourceWidth, sourceHeight));
    return {
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale))
    };
  }
  const parsed = parseSizeToken(sizeToken);
  if ('width' in parsed) return { width: parsed.width, height: parsed.height };
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = parsed.ratio;
  if (sourceRatio > targetRatio) {
    const width = Math.min(fallbackEdge, Math.max(sourceWidth, 64));
    return { width, height: Math.max(1, Math.round(width / targetRatio)) };
  }
  const height = Math.min(fallbackEdge, Math.max(sourceHeight, 64));
  return { width: Math.max(1, Math.round(height * targetRatio)), height };
}

export function containFit(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): { contentWidth: number; contentHeight: number; padX: number; padY: number; scaleX: number; scaleY: number } {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const contentWidth = Math.max(1, Math.round(sourceWidth * scale));
  const contentHeight = Math.max(1, Math.round(sourceHeight * scale));
  return {
    contentWidth,
    contentHeight,
    padX: Math.floor((targetWidth - contentWidth) / 2),
    padY: Math.floor((targetHeight - contentHeight) / 2),
    scaleX: contentWidth / sourceWidth,
    scaleY: contentHeight / sourceHeight
  };
}

export function aspectMismatch(aW: number, aH: number, bW: number, bH: number): boolean {
  const a = aW / aH;
  const b = bW / bH;
  return Math.abs(a - b) / b > ASPECT_TOLERANCE;
}

export function mappingForReturn(
  sourceWidth: number,
  sourceHeight: number,
  requestWidth: number,
  requestHeight: number,
  returnedWidth: number,
  returnedHeight: number
): GeometryMapping {
  if (aspectMismatch(returnedWidth, returnedHeight, requestWidth, requestHeight)) {
    throw new AppError(422, 'OUTPUT_GEOMETRY_MISMATCH', '返回图像比例与请求不一致，未写入 Photoshop。');
  }
  const fit = containFit(sourceWidth, sourceHeight, requestWidth, requestHeight);
  const sx = returnedWidth / requestWidth;
  const sy = returnedHeight / requestHeight;
  const contentRect: Rect = {
    left: Math.round(fit.padX * sx),
    top: Math.round(fit.padY * sy),
    width: Math.max(1, Math.round(fit.contentWidth * sx)),
    height: Math.max(1, Math.round(fit.contentHeight * sy))
  };
  if (contentRect.left + contentRect.width > returnedWidth) {
    contentRect.width = returnedWidth - contentRect.left;
  }
  if (contentRect.top + contentRect.height > returnedHeight) {
    contentRect.height = returnedHeight - contentRect.top;
  }
  return {
    sourceWidth,
    sourceHeight,
    requestWidth,
    requestHeight,
    contentRect,
    scaleX: fit.scaleX,
    scaleY: fit.scaleY,
    returnedWidth,
    returnedHeight
  };
}

export function canvasContainPlacement(
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number
): Rect {
  const fit = containFit(imageWidth, imageHeight, canvasWidth, canvasHeight);
  return {
    left: fit.padX,
    top: fit.padY,
    width: fit.contentWidth,
    height: fit.contentHeight
  };
}
