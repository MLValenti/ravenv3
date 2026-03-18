export type LetterboxResult = {
  targetWidth: number;
  targetHeight: number;
  resizedWidth: number;
  resizedHeight: number;
  padX: number;
  padY: number;
  scale: number;
};

export function computeLetterbox(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): LetterboxResult {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return {
      targetWidth,
      targetHeight,
      resizedWidth: 0,
      resizedHeight: 0,
      padX: 0,
      padY: 0,
      scale: 1,
    };
  }

  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const resizedWidth = Math.round(sourceWidth * scale);
  const resizedHeight = Math.round(sourceHeight * scale);
  const padX = Math.floor((targetWidth - resizedWidth) / 2);
  const padY = Math.floor((targetHeight - resizedHeight) / 2);
  return {
    targetWidth,
    targetHeight,
    resizedWidth,
    resizedHeight,
    padX,
    padY,
    scale,
  };
}

export type BBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function mapBboxFromLetterboxToSource(
  box: BBox,
  letterbox: LetterboxResult,
): BBox {
  if (letterbox.scale <= 0) {
    return box;
  }
  const x = (box.x - letterbox.padX) / letterbox.scale;
  const y = (box.y - letterbox.padY) / letterbox.scale;
  const width = box.width / letterbox.scale;
  const height = box.height / letterbox.scale;
  return { x, y, width, height };
}

export function drawLetterboxedFrame(
  source: CanvasImageSource,
  ctx: CanvasRenderingContext2D,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): LetterboxResult {
  const letterbox = computeLetterbox(sourceWidth, sourceHeight, targetWidth, targetHeight);
  ctx.clearRect(0, 0, targetWidth, targetHeight);
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  if (letterbox.resizedWidth <= 0 || letterbox.resizedHeight <= 0) {
    return letterbox;
  }
  ctx.drawImage(
    source,
    0,
    0,
    sourceWidth,
    sourceHeight,
    letterbox.padX,
    letterbox.padY,
    letterbox.resizedWidth,
    letterbox.resizedHeight,
  );
  return letterbox;
}
