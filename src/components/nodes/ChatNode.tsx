import type { KeyboardEvent } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { AlertCircle, ArrowUpRight, Loader2, MessageSquare } from 'lucide-react';
import type { ChatNodeData } from '../../types/osint';
import { useCanvasStore } from '../../store/useCanvasStore';
import { getProviderMeta } from '../../utils/llmProviders';
import { HANDLE_IDS } from '../../utils/osintGraph';

export function ChatNode({ id, data, selected }: NodeProps<ChatNodeData>) {
  const prompt = data.draftPrompt ?? '';

  const chatContext = useCanvasStore((state) => state.chatContextMap[id]);
  const nodes = useCanvasStore((state) => state.nodes);
  const provider = useCanvasStore((state) => state.provider);
  const model = useCanvasStore((state) => state.model);
  const isAnalyzing = useCanvasStore((state) => Boolean(state.analyzingChatIds[id]));
  const chatError = useCanvasStore((state) => state.chatNodeErrors[id] ?? null);
  const analyzeChatNode = useCanvasStore((state) => state.analyzeChatNode);
  const updateChatNodeTitle = useCanvasStore((state) => state.updateChatNodeTitle);
  const updateChatNodeDraftPrompt = useCanvasStore(
    (state) => state.updateChatNodeDraftPrompt,
  );

  const hasActiveContext = Boolean(chatContext?.hasActiveContext);
  const globalIds = [
    ...(chatContext?.globalImageIds ?? []),
    ...(chatContext?.globalEnhanceIds ?? []),
    ...(chatContext?.globalOcrIds ?? []),
    ...(chatContext?.globalExifIds ?? []),
  ].filter((v, idx, arr) => arr.indexOf(v) === idx);

  const specificIds = [
    ...(chatContext?.specificImageIds ?? []),
    ...(chatContext?.specificEnhanceIds ?? []),
    ...(chatContext?.specificOcrIds ?? []),
    ...(chatContext?.specificExifIds ?? []),
  ].filter((v, idx, arr) => arr.indexOf(v) === idx);

  const allSourceIds = [...globalIds, ...specificIds].filter(
    (v, idx, arr) => arr.indexOf(v) === idx,
  );

  const totalConnected = allSourceIds.length;
  const providerMeta = getProviderMeta(provider);

  const resolveTitle = (nodeId: string) => {
    const found = nodes.find((n) => n.id === nodeId);
    if (found) {
      return found.data.title || nodeId;
    }
    return nodeId;
  };

  const handleSubmit = async () => {
    if (isAnalyzing) return;
    await analyzeChatNode(id, prompt);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div
      data-testid={`chat-node-${id}`}
      data-has-context={hasActiveContext ? 'true' : 'false'}
      className={`relative w-[412px] rounded-xl border bg-white transition-all duration-200 ${
        hasActiveContext
          ? 'chat-node-active-glow'
          : selected
            ? 'border-neutral-900 shadow-md'
            : 'border-neutral-200/90 shadow-sm'
      }`}
    >
      {/* Header + Far-Left Edge Global Context Handle (applies to all prompts) */}
      <div className="relative border-b border-neutral-100 px-4 py-3">
        <Handle
          type="target"
          position={Position.Left}
          id={HANDLE_IDS.CHAT_GLOBAL_IN}
          aria-label={`Global Context input for ${data.title}`}
          style={{ top: 28 }}
          className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
        />

        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <MessageSquare className="h-4 w-4 shrink-0 text-neutral-500" />
            <input
              type="text"
              value={data.title}
              onChange={(e) => updateChatNodeTitle(id, e.target.value)}
              aria-label={`Chat thread title for ${id}`}
              className="nodrag w-full truncate bg-transparent text-sm font-semibold text-neutral-900 focus:outline-none"
            />
          </div>
          <span className="shrink-0 text-[11px] font-medium text-neutral-400">
            Global Context
          </span>
        </div>

        {/* Clean unboxed single-line context metadata */}
        <div
          data-testid={`chat-context-summary-${id}`}
          className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-neutral-500"
        >
          {hasActiveContext ? (
            <>
              <span className="shrink-0 whitespace-nowrap font-medium text-[#d93838]">
                {totalConnected} active source{totalConnected === 1 ? '' : 's'}
              </span>
              <span aria-hidden="true" className="shrink-0">
                ·
              </span>
              <span className="min-w-0 truncate">
                {allSourceIds.map(resolveTitle).join(', ')}
              </span>
            </>
          ) : (
            <span>No Global or Specific context wired</span>
          )}
        </div>
      </div>

      {/* Previous Messages List */}
      <div
        data-testid={`chat-messages-${id}`}
        className="nodrag nowheel max-h-56 overflow-y-auto px-4 py-3"
      >
        {data.messages.length === 0 ? (
          <div className="py-6 text-center text-xs text-neutral-400">
            Wire sources to the outer Global edge or the inner Prompt dock below, then ask an OSINT question.
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {data.messages.map((msg) => (
              <div key={msg.id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="mb-1 flex items-center justify-between text-[11px] text-neutral-400">
                  <span className="font-medium text-neutral-600">
                    {msg.role === 'user' ? 'Analyst' : 'OSINT Assistant'}
                  </span>
                  <span className="font-mono-tabular">{msg.timestamp}</span>
                </div>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-neutral-700">
                  {msg.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Prompt Input Area with Internal Specific Context Handle directly beside <textarea> */}
      <div className="border-t border-neutral-100 bg-neutral-50/50 px-4 py-3 rounded-b-xl">
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <label
            htmlFor={`chat-prompt-${id}`}
            className="font-medium text-neutral-600"
          >
            Specific Context Prompt
          </label>
          <span className="text-neutral-400">
            {specificIds.length > 0
              ? `${specificIds.length} scoped to prompt`
              : `${globalIds.length} global · dock ready`}
          </span>
        </div>

        <div className="flex items-stretch gap-2.5">
          {/* Specific Context Handle physically docked INSIDE the node next to textarea */}
          <div
            data-testid={`specific-context-dock-${id}`}
            title="Specific Context — applies only to the prompt currently being typed"
            className={`flex w-11 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border bg-white px-1 py-2 transition-colors ${
              specificIds.length > 0
                ? 'border-[#ff4d4d]/60 bg-[#ff4d4d]/[0.03]'
                : 'border-dashed border-neutral-300'
            }`}
          >
            <div className="relative flex h-4 w-4 items-center justify-center">
              <Handle
                type="target"
                position={Position.Left}
                id={HANDLE_IDS.CHAT_SPECIFIC_IN}
                aria-label={`Specific Context input for ${data.title}`}
                className="!static !h-3.5 !w-3.5 !translate-x-0 !translate-y-0 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
              />
            </div>
            <span className="text-[9px] font-medium leading-none text-neutral-500">
              Prompt
            </span>
          </div>

          <textarea
            id={`chat-prompt-${id}`}
            rows={3}
            value={prompt}
            onChange={(e) => updateChatNodeDraftPrompt(id, e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isAnalyzing}
            placeholder="Inspect markings, sun angle, signage, or cross-reference frames..."
            aria-label={`Prompt input for ${data.title}`}
            className="nodrag min-w-0 flex-1 resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs leading-relaxed text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none disabled:bg-neutral-50 disabled:text-neutral-400"
          />
        </div>

        {chatError && (
          <div
            role="alert"
            data-testid={`chat-error-${id}`}
            className="mt-2.5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50/70 px-3 py-2 text-xs text-red-700"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
            <span className="leading-relaxed">{chatError}</span>
          </div>
        )}

        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span
            data-testid={`chat-active-model-${id}`}
            className="font-mono-tabular truncate text-[11px] text-neutral-400"
          >
            {providerMeta.name} · {model}
          </span>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isAnalyzing}
            aria-label={`Run analysis for ${data.title}`}
            className="nodrag inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Analyzing...</span>
              </>
            ) : (
              <>
                <span>Analyze</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Right Handle to output results */}
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.CHAT_RESULT_OUT}
        aria-label={`Result output for ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />
    </div>
  );
}
