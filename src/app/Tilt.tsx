'use client';

import { useRef, type PointerEvent, type ReactNode } from 'react';

type Props = { as?: 'div' | 'li'; className?: string; children: ReactNode };

/**
 * Publishes the mouse position over the element as --tx / --ty (each -0.5 … 0.5),
 * so CSS can tilt it and its 3D layers. Touch pointers are ignored; the page stays still for them.
 */
export function Tilt({ as: Tag = 'div', className, children }: Props) {
  const ref = useRef<HTMLDivElement & HTMLLIElement>(null);
  const frame = useRef(0);

  function set(x: number, y: number) {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      ref.current?.style.setProperty('--tx', x.toFixed(3));
      ref.current?.style.setProperty('--ty', y.toFixed(3));
    });
  }

  function move(e: PointerEvent) {
    if (e.pointerType === 'touch' || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    set((e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5);
  }

  return (
    <Tag ref={ref} className={className} onPointerMove={move} onPointerLeave={() => set(0, 0)}>
      {children}
    </Tag>
  );
}
