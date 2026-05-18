import { type ReactNode } from 'react';
import denim from '../assets/denim.png';

interface ToolbarProps {
  children: ReactNode;
}

export function Toolbar({ children }: ToolbarProps) {
  return (
    <div
      className="flex items-center gap-2.5 px-4 py-3 bg-[#1a1a1a] border-b border-[#2a2a2a] flex-shrink-0"
      style={{ backgroundImage: `url(${denim})`, backgroundRepeat: 'repeat', backgroundBlendMode: 'screen' }}
    >
      {children}
    </div>
  );
}
