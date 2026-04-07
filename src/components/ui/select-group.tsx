'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface SelectGroupOption {
  value: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
}

interface SelectGroupProps {
  options: SelectGroupOption[];
  value?: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
}

export function SelectGroup({ options, value, onChange, label, className }: SelectGroupProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <label className="block text-sm font-medium text-white/70">{label}</label>
      )}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 3)}, 1fr)` }}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'flex flex-col items-center justify-center rounded-xl p-4 text-center transition-all duration-200 border',
              value === option.value
                ? 'bg-cyan-500/10 border-cyan-500/40 text-white shadow-lg shadow-cyan-500/5'
                : 'bg-white/[0.03] border-white/[0.06] text-white/60 hover:bg-white/[0.06] hover:border-white/10'
            )}
          >
            {option.icon && <span className="mb-2 text-lg">{option.icon}</span>}
            <span className="text-sm font-medium">{option.label}</span>
            {option.description && (
              <span className="text-xs text-white/40 mt-1">{option.description}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
