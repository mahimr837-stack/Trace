import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent,
  type TouchEvent,
} from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Crop, Image as ImageIcon, Upload } from 'lucide-react';
import type { ImageNodeData } from '../../types/osint';
import { useCanvasStore } from '../../store/useCanvasStore';
import { HANDLE_IDS } from '../../utils/osintGraph';
import {
  clientPointToContainerPoint,
  mapDisplaySelectionToSourceRect,
  normalizeSelectionRect,
  type DisplayRect,
} from '../../utils/imageCrop';

export function ImageNode({ id, data, selected }: NodeProps<ImageNodeData>) {
  const updateImageNodeTitle = useCanvasStore(
    (state) => state.updateImageNodeTitle,
  );
  const updateImageNodeImage = useCanvasStore(
    (state) => state.updateImageNodeImage,
  );
  const spawnCropNode = useCanvasStore((state) => state.spawnCropNode);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const [imageError, setImageError] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [selectionRect, setSelectionRect] = useState<DisplayRect | null>(null);

  const hasValidImage = Boolean(data.imageUrl) && !imageError;

  useEffect(() => {
    setImageError(false);
    dragStartRef.current = null;
    setIsCropping(false);
    setDragStart(null);
    setSelectionRect(null);
  }, [data.imageUrl]);

  useEffect(() => {
    if (!isCropping) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dragStartRef.current = null;
        setIsCropping(false);
        setDragStart(null);
        setSelectionRect(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCropping]);

  const loadImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        dragStartRef.current = null;
        setImageError(false);
        setIsCropping(false);
        setDragStart(null);
        setSelectionRect(null);
        updateImageNodeImage(id, reader.result, file.name);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    loadImageFile(file);
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      loadImageFile(file);
    }
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const toggleCropMode = () => {
    if (!hasValidImage) return;
    dragStartRef.current = null;
    setIsCropping((prev) => !prev);
    setDragStart(null);
    setSelectionRect(null);
  };

  const getOverlayPointFromClient = useCallback(
    (
      clientX: number,
      clientY: number,
    ): { point: { x: number; y: number }; width: number; height: number } | null => {
      const svg = overlayRef.current;
      if (!svg) return null;
      const bounds = svg.getBoundingClientRect();
      const parentEl = svg.parentElement;
      return clientPointToContainerPoint(clientX, clientY, {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        localWidth: svg.clientWidth || parentEl?.clientWidth || bounds.width,
        localHeight: svg.clientHeight || parentEl?.clientHeight || bounds.height,
      });
    },
    [],
  );

  const completeCropAtClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      const activeStart = dragStartRef.current;
      if (!activeStart) return;
      dragStartRef.current = null;
      setDragStart(null);

      const info = getOverlayPointFromClient(clientX, clientY);
      const finalRect = info
        ? normalizeSelectionRect(
            activeStart,
            info.point,
            info.width,
            info.height,
          )
        : selectionRect;

      if (!finalRect || !info || !imgRef.current) {
        setSelectionRect(null);
        return;
      }

      if (finalRect.width < 4 || finalRect.height < 4) {
        setSelectionRect(null);
        return;
      }

      const imgEl = imgRef.current;
      const sourceRect = mapDisplaySelectionToSourceRect({
        selection: finalRect,
        containerWidth: info.width,
        containerHeight: info.height,
        naturalWidth: imgEl.naturalWidth || imgEl.width,
        naturalHeight: imgEl.naturalHeight || imgEl.height,
      });

      if (!sourceRect) {
        setSelectionRect(null);
        return;
      }

      try {
        const canvas = document.createElement('canvas');
        canvas.width = sourceRect.sWidth;
        canvas.height = sourceRect.sHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(
          imgEl,
          sourceRect.sx,
          sourceRect.sy,
          sourceRect.sWidth,
          sourceRect.sHeight,
          0,
          0,
          sourceRect.sWidth,
          sourceRect.sHeight,
        );

        const croppedDataUrl = canvas.toDataURL('image/png');
        spawnCropNode({
          parentNodeId: id,
          croppedImageUrl: croppedDataUrl,
        });
      } finally {
        setIsCropping(false);
        setSelectionRect(null);
      }
    },
    [getOverlayPointFromClient, id, selectionRect, spawnCropNode],
  );

  useEffect(() => {
    if (!dragStart) return;

    const handleWindowMouseMove = (event: globalThis.MouseEvent) => {
      const activeStart = dragStartRef.current;
      if (!activeStart) return;
      const info = getOverlayPointFromClient(event.clientX, event.clientY);
      if (!info) return;
      setSelectionRect(
        normalizeSelectionRect(
          activeStart,
          info.point,
          info.width,
          info.height,
        ),
      );
    };

    const handleWindowMouseUp = (event: globalThis.MouseEvent) => {
      completeCropAtClientPoint(event.clientX, event.clientY);
    };

    const handleWindowTouchMove = (event: globalThis.TouchEvent) => {
      const activeStart = dragStartRef.current;
      const touch = event.touches[0];
      if (!activeStart || !touch) return;
      const info = getOverlayPointFromClient(touch.clientX, touch.clientY);
      if (!info) return;
      setSelectionRect(
        normalizeSelectionRect(
          activeStart,
          info.point,
          info.width,
          info.height,
        ),
      );
    };

    const handleWindowTouchEnd = (event: globalThis.TouchEvent) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      completeCropAtClientPoint(touch.clientX, touch.clientY);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    window.addEventListener('touchmove', handleWindowTouchMove, {
      passive: true,
    });
    window.addEventListener('touchend', handleWindowTouchEnd);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('touchmove', handleWindowTouchMove);
      window.removeEventListener('touchend', handleWindowTouchEnd);
    };
  }, [completeCropAtClientPoint, dragStart, getOverlayPointFromClient]);

  const handleCropMouseDown = (event: MouseEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const info = getOverlayPointFromClient(event.clientX, event.clientY);
    if (!info) return;
    dragStartRef.current = info.point;
    setDragStart(info.point);
    setSelectionRect({
      x: info.point.x,
      y: info.point.y,
      width: 0,
      height: 0,
    });
  };

  const handleCropMouseMove = (event: MouseEvent<SVGSVGElement>) => {
    const activeStart = dragStartRef.current;
    if (!activeStart) return;
    event.preventDefault();
    event.stopPropagation();
    const info = getOverlayPointFromClient(event.clientX, event.clientY);
    if (!info) return;
    setSelectionRect(
      normalizeSelectionRect(activeStart, info.point, info.width, info.height),
    );
  };

  const finalizeCrop = (event: MouseEvent<SVGSVGElement>) => {
    if (!dragStartRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    completeCropAtClientPoint(event.clientX, event.clientY);
  };

  const handleCropTouchStart = (event: TouchEvent<SVGSVGElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    event.stopPropagation();
    const info = getOverlayPointFromClient(touch.clientX, touch.clientY);
    if (!info) return;
    dragStartRef.current = info.point;
    setDragStart(info.point);
    setSelectionRect({
      x: info.point.x,
      y: info.point.y,
      width: 0,
      height: 0,
    });
  };

  const handleCropTouchEnd = (event: TouchEvent<SVGSVGElement>) => {
    const touch = event.changedTouches[0];
    if (!dragStartRef.current || !touch) return;
    event.stopPropagation();
    completeCropAtClientPoint(touch.clientX, touch.clientY);
  };

  return (
    <div
      data-testid={`image-node-${id}`}
      data-crop-mode={isCropping ? 'true' : 'false'}
      className={`relative w-64 rounded-xl border bg-white transition-shadow duration-150 ${
        selected
          ? 'border-neutral-900 shadow-md'
          : 'border-neutral-200/90 shadow-sm hover:border-neutral-300'
      }`}
    >
      {/* Left Handle for incoming parent crop connections */}
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.IMAGE_LEFT_IN}
        aria-label={`Image input for ${data.title}`}
        className="!h-3 !w-3 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Top Handle for grouped context */}
      <Handle
        type="target"
        position={Position.Top}
        id={HANDLE_IDS.IMAGE_GROUP_IN}
        aria-label={`Group input for ${data.title}`}
        className="!h-3 !w-3 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Header strip */}
      <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
        <span className="text-[11px] font-medium tracking-wide text-neutral-500">
          Image Source
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!hasValidImage}
            onClick={toggleCropMode}
            data-testid={`crop-btn-${id}`}
            title={
              isCropping
                ? 'Cancel crop selection (Esc)'
                : 'Extract target region into new CropNode'
            }
            aria-label={
              isCropping
                ? `Cancel crop for ${data.title || id}`
                : `Crop image for ${data.title || id}`
            }
            aria-pressed={isCropping}
            className={`nodrag nopan inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 ${
              isCropping
                ? 'bg-[#ff4d4d]/10 text-[#ff4d4d]'
                : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
            }`}
          >
            <Crop className="h-3 w-3" />
            <span>{isCropping ? 'Cancel' : 'Crop'}</span>
          </button>

          <button
            type="button"
            onClick={openFilePicker}
            aria-label={`Upload image for ${data.title || id}`}
            className="nodrag nopan inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          >
            <Upload className="h-3 w-3" />
            <span>Load</span>
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          data-testid={`file-input-${id}`}
          className="hidden"
          aria-hidden="true"
        />
      </div>

      {/* Thumbnail placeholder / uploaded base64 image + Crop Selection Overlay */}
      <div className="p-2.5 pb-2">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          className={`nodrag nopan relative aspect-[4/3] w-full overflow-hidden rounded-lg border transition-colors ${
            isDragOver
              ? 'border-[#ff4d4d] bg-[#ff4d4d]/5'
              : isCropping
                ? 'border-[#ff4d4d] bg-[#fafafa]'
                : 'border-neutral-200/80 bg-[#fafafa]'
          }`}
        >
          {hasValidImage && data.imageUrl ? (
            <>
              <button
                type="button"
                onClick={() => {
                  if (!isCropping) openFilePicker();
                }}
                title={isCropping ? 'Drag on image to crop' : 'Click to replace image'}
                aria-label={`Replace image for ${data.title || id}`}
                className="nodrag nopan group relative block h-full w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-900"
              >
                <img
                  ref={imgRef}
                  src={data.imageUrl}
                  alt={data.title || 'OSINT evidence thumbnail'}
                  referrerPolicy="no-referrer"
                  decoding="async"
                  onLoad={() => setImageError(false)}
                  onError={() => setImageError(true)}
                  className="h-full w-full object-cover transition-opacity duration-150 group-hover:opacity-90"
                  draggable={false}
                />
              </button>

              {isCropping && (
                <>
                  <svg
                    ref={overlayRef}
                    data-testid={`crop-overlay-${id}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={handleCropMouseDown}
                    onMouseMove={handleCropMouseMove}
                    onMouseUp={finalizeCrop}
                    onTouchStart={handleCropTouchStart}
                    onTouchEnd={handleCropTouchEnd}
                    className="nodrag nopan touch-none absolute inset-0 z-10 h-full w-full cursor-crosshair select-none"
                  >
                    <defs>
                      <mask id={`crop-mask-${id}`}>
                        <rect width="100%" height="100%" fill="white" />
                        {selectionRect &&
                          selectionRect.width > 0 &&
                          selectionRect.height > 0 && (
                            <rect
                              x={selectionRect.x}
                              y={selectionRect.y}
                              width={selectionRect.width}
                              height={selectionRect.height}
                              fill="black"
                            />
                          )}
                      </mask>
                    </defs>
                    <rect
                      width="100%"
                      height="100%"
                      fill="rgba(17, 17, 17, 0.48)"
                      mask={`url(#crop-mask-${id})`}
                    />
                    {selectionRect &&
                      selectionRect.width > 1 &&
                      selectionRect.height > 1 && (
                        <rect
                          data-testid={`crop-selection-box-${id}`}
                          x={selectionRect.x}
                          y={selectionRect.y}
                          width={selectionRect.width}
                          height={selectionRect.height}
                          fill="transparent"
                          stroke="#ffffff"
                          strokeWidth={1.5}
                          strokeDasharray="5 3"
                        />
                      )}
                  </svg>

                  {(!selectionRect ||
                    selectionRect.width < 4 ||
                    selectionRect.height < 4) && (
                    <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 rounded-md bg-neutral-900/80 px-2 py-1 text-center text-[10px] font-medium text-white backdrop-blur-xs">
                      Drag across image to crop · Esc to cancel
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={openFilePicker}
              aria-label={`Select image file for ${data.title || id}`}
              className="nodrag nopan flex h-full w-full cursor-pointer flex-col items-center justify-center gap-1.5 text-neutral-400 transition-colors hover:bg-neutral-100/70 hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-900"
            >
              <ImageIcon className="h-6 w-6 stroke-[1.5]" />
              <span className="text-xs font-medium text-neutral-500">
                Click or drop image
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Title Input */}
      <div className="px-2.5 pb-3">
        <input
          type="text"
          value={data.title}
          onChange={(e) => updateImageNodeTitle(id, e.target.value)}
          placeholder="Untitled evidence frame..."
          aria-label={`Title for ${id}`}
          className="nodrag w-full rounded-md border border-neutral-200 bg-neutral-50/70 px-2.5 py-1.5 text-xs font-medium text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white focus:outline-none"
        />
        {(data.sourceLabel || data.dimensions) && (
          <div className="mt-1.5 flex items-center justify-between gap-2 px-0.5 text-[11px] text-neutral-400">
            {data.sourceLabel && (
              <span className="truncate">{data.sourceLabel}</span>
            )}
            {data.dimensions && (
              <span className="font-mono-tabular shrink-0 text-[10px] text-neutral-400">
                {data.dimensions}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Right Handle for connecting to ChatNode */}
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.IMAGE_RIGHT_OUT}
        aria-label={`Output wire from ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Bottom Handle for grouped context */}
      <Handle
        type="source"
        position={Position.Bottom}
        id={HANDLE_IDS.IMAGE_GROUP_OUT}
        aria-label={`Group output for ${data.title}`}
        className="!h-3 !w-3 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />
    </div>
  );
}
