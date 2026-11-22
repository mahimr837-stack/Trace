import { Handle, Position, type NodeProps } from 'reactflow';
import type { CropNodeData } from '../../types/osint';
import { useCanvasStore } from '../../store/useCanvasStore';
import { HANDLE_IDS } from '../../utils/osintGraph';

export function CropNode({ id, data, selected }: NodeProps<CropNodeData>) {
  const updateCropNodeTitle = useCanvasStore(
    (state) => state.updateCropNodeTitle,
  );

  return (
    <div
      data-testid={`crop-node-${id}`}
      className={`relative w-56 rounded-xl border bg-white p-2 transition-shadow duration-150 ${
        selected
          ? 'border-neutral-900 shadow-md'
          : 'border-neutral-200/90 shadow-sm hover:border-neutral-300'
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.CROP_IN}
        aria-label={`Extracted source input for ${data.title || id}`}
        className="!h-3 !w-3 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      <input
        type="text"
        value={data.title}
        onChange={(e) => updateCropNodeTitle(id, e.target.value)}
        placeholder="Name this target..."
        aria-label={`Target name for ${id}`}
        className="nodrag mb-2 w-full rounded-md border border-neutral-200 bg-neutral-50/70 px-2.5 py-1.5 text-xs font-medium text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white focus:outline-none"
      />

      {data.imageUrl && (
        <img
          src={data.imageUrl}
          alt={data.title || 'Extracted target'}
          draggable={false}
          className="block max-h-64 w-full rounded-lg border border-neutral-200/80 bg-[#fafafa] object-contain"
        />
      )}

      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.CROP_OUT}
        aria-label={`Output wire from ${data.title || id}`}
        className="!h-3 !w-3 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />
    </div>
  );
}
