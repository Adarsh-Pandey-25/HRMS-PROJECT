import { useState } from 'react';
import {
  DndContext, useDraggable, useDroppable, DragOverlay, PointerSensor,
  useSensor, useSensors, closestCorners,
} from '@dnd-kit/core';
import { cn } from '../../lib/utils';

function Card({ id, children }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn('touch-none cursor-grab active:cursor-grabbing', isDragging && 'opacity-40')}
    >
      {children}
    </div>
  );
}

function Column({ id, label, count, children }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div className="w-[260px] shrink-0 flex flex-col">
      <div className="flex items-center justify-between px-1 mb-2.5">
        <p className="text-xs font-semibold text-fg uppercase tracking-wide">{label}</p>
        <span className="rounded-pill bg-muted text-fg-subtle text-[11px] font-semibold px-2 py-0.5">{count}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 rounded-card p-2 space-y-2 min-h-[120px] transition-colors border border-dashed',
          isOver ? 'bg-primary/8 border-primary/40' : 'bg-muted/30 border-transparent'
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * columns: [{ id, label }]
 * items: [{ id, stage, ... }]
 * renderCard: (item) => JSX
 * onMove: (itemId, toStage) => void
 * onCardClick: (item) => void
 */
export function KanbanBoard({ columns, items, renderCard, onMove, onCardClick }) {
  const [activeId, setActiveId] = useState(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const activeItem = items.find((i) => i.id === activeId);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e) => setActiveId(e.active.id)}
      onDragEnd={(e) => {
        setActiveId(null);
        const { active, over } = e;
        if (over && columns.some((c) => c.id === over.id)) {
          const item = items.find((i) => i.id === active.id);
          if (item && item.stage !== over.id) onMove(active.id, over.id);
        }
      }}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex gap-3 overflow-x-auto pb-3">
        {columns.map((col) => {
          const colItems = items.filter((i) => i.stage === col.id);
          return (
            <Column key={col.id} id={col.id} label={col.label} count={colItems.length}>
              {colItems.map((item) => (
                <Card key={item.id} id={item.id}>
                  <div onClick={() => onCardClick?.(item)}>{renderCard(item)}</div>
                </Card>
              ))}
            </Column>
          );
        })}
      </div>
      <DragOverlay>{activeItem ? <div className="rotate-2">{renderCard(activeItem)}</div> : null}</DragOverlay>
    </DndContext>
  );
}
