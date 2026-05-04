'use client';

import { useCallback, useState } from 'react';

/**
 * Lightweight HTML5-drag sortable list helper.
 *
 * Why no library: dnd-kit / react-dnd would add ~13-25 KB gzipped for
 * a feature that's used in exactly one list. Native HTML5 drag handles
 * desktop perfectly; touch-drag is mediocre but usable, and the
 * up/down arrow keys (handled by the consumer) are the touch fallback.
 *
 * Two-handler split:
 *   - gripHandlers(id) goes on the grip / handle element (the only
 *     thing the user can grab to initiate a drag). Keeping the
 *     `draggable` flag off the row itself preserves text-selection
 *     and prevents accidental drags from mis-clicks on the body.
 *   - rowDropHandlers(id, index) goes on the row container so the
 *     full-width target area accepts drops, even when the user's
 *     cursor isn't over the grip at drop time.
 *
 * Usage:
 *   const { gripHandlers, rowDropHandlers, dragState, indicator } =
 *     useDragSort({
 *       ids: pendingTasks.map(t => t.id),
 *       onReorder: (newIds) => store.reorderDailyTasks(date, newIds),
 *     });
 *
 *   {pendingTasks.map((t, i) => (
 *     <div {...rowDropHandlers(t.id, i)} key={t.id}>
 *       <span {...gripHandlers(t.id)}><GripVertical /></span>
 *       …
 *     </div>
 *   ))}
 *
 * Drop semantics:
 *   - Indicator (a 2px line) renders above or below the hover target
 *     based on cursor Y vs row midline. Matches the SortableJS / Notion
 *     pattern users already know.
 *   - Drop above row N → insert at index N. Drop below → insert at N+1.
 *   - Dropping over the dragged-self is a no-op.
 *
 * Accessibility: HTML5 drag is keyboard-inaccessible by spec. The
 * consumer should also offer up/down arrow buttons or a context menu
 * that calls `onReorder` directly with a swap — that path covers
 * keyboard + touch users without needing the drag interaction at all.
 */

export type DropPosition = 'above' | 'below';

interface DragSortOpts {
  /** Current id ordering. */
  ids: readonly string[];
  /** Called with the new id sequence when a valid drop completes. */
  onReorder: (newIds: string[]) => void;
}

interface DropIndicator {
  /** Index of the row the drop indicator points at. -1 = nowhere. */
  index: number;
  /** Whether the indicator sits above or below the row at `index`. */
  position: DropPosition;
}

// Exported so consumers can type their own props without restating the
// shape — narrow types here matter because spreading a broader
// HTMLAttributes onto framer-motion's motion.div causes onAnimationStart
// type clashes (motion.div overrides it with a different signature).
export interface GripHandlerProps {
  draggable: true;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

export interface RowDropHandlerProps {
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export function useDragSort({ ids, onReorder }: DragSortOpts) {
  const [dragState, setDragState] = useState<{ draggingId: string | null }>({
    draggingId: null,
  });
  const [indicator, setIndicator] = useState<DropIndicator>({
    index: -1,
    position: 'above',
  });

  const reset = useCallback(() => {
    setDragState({ draggingId: null });
    setIndicator({ index: -1, position: 'above' });
  }, []);

  const gripHandlers = useCallback(
    (rowId: string): GripHandlerProps => ({
      draggable: true,
      onDragStart: (e) => {
        setDragState({ draggingId: rowId });
        e.dataTransfer.effectAllowed = 'move';
        // Some browsers refuse to start a drag without setData. The
        // payload is informational only — we read draggingId from state.
        try { e.dataTransfer.setData('text/plain', rowId); } catch { /* Safari */ }
      },
      onDragEnd: () => {
        // Fires whether or not a successful drop happened (e.g., user
        // dropped outside any row). Always reset to clear the indicator.
        reset();
      },
    }),
    [reset],
  );

  const rowDropHandlers = useCallback(
    (rowId: string, rowIndex: number): RowDropHandlerProps => ({
      onDragOver: (e) => {
        if (!dragState.draggingId || dragState.draggingId === rowId) return;
        e.preventDefault(); // tell the browser drop is allowed here
        e.dataTransfer.dropEffect = 'move';
        // Compute above/below from cursor Y vs row midline.
        const target = e.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        const isAbove = e.clientY < rect.top + rect.height / 2;
        setIndicator({ index: rowIndex, position: isAbove ? 'above' : 'below' });
      },
      onDragLeave: () => {
        // Single-target leave; if the user re-enters another row the
        // next dragOver will set the indicator again. Avoid clearing
        // here to prevent flicker between adjacent rows.
      },
      onDrop: (e) => {
        e.preventDefault();
        const draggingId = dragState.draggingId;
        if (!draggingId || draggingId === rowId) {
          reset();
          return;
        }
        // Recompute the new ordering. The dragged id is removed from
        // its old slot, then re-inserted relative to rowId based on
        // whether the indicator was above or below.
        const without = ids.filter((id) => id !== draggingId);
        const targetIdx = without.indexOf(rowId);
        const insertAt =
          indicator.position === 'above' ? targetIdx : targetIdx + 1;
        const next = [
          ...without.slice(0, insertAt),
          draggingId,
          ...without.slice(insertAt),
        ];
        onReorder(next);
        reset();
      },
    }),
    [dragState.draggingId, ids, indicator.position, onReorder, reset],
  );

  return { dragState, gripHandlers, rowDropHandlers, indicator };
}
