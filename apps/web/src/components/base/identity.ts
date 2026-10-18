import {
  ArrowLeftRight,
  ChartColumn,
  CircleAlert,
  Puzzle,
  SignalLow,
  SignalMedium,
  Wrench,
} from '@lucide/vue';
import type { Component } from 'vue';

// Identity colours (DESIGN.md 2.2.1): who someone is and what kind of thing an item is, always
// in the same hue. Pages take their colours from here instead of picking their own.
export type Hue = 'blue' | 'green' | 'purple' | 'red' | 'yellow' | 'neutral';

const nameHues: Hue[] = ['blue', 'green', 'purple', 'red', 'yellow'];
export function hueOfName(name: string, hues: Hue[] = nameHues): Hue {
  let sum = 0;
  for (const ch of name) sum = (sum * 31 + ch.charCodeAt(0)) >>> 0;
  return hues[sum % hues.length]!;
}

// SAP modules: finance green, sales blue, materials purple, production yellow; the rest by name.
const moduleHues: Record<string, Hue> = {
  FI: 'green',
  CO: 'green',
  FICO: 'green',
  'FI/CO': 'green',
  TR: 'green',
  SD: 'blue',
  CRM: 'blue',
  MM: 'purple',
  WM: 'purple',
  EWM: 'purple',
  PP: 'yellow',
  QM: 'yellow',
  PM: 'yellow',
};
export function moduleHue(module: string): Hue {
  const key = module.trim().toUpperCase();
  return moduleHues[key] ?? hueOfName(key, ['blue', 'green', 'purple', 'yellow']);
}

export const kindIdentity: Record<string, { hue: Hue; icon: Component }> = {
  report: { hue: 'blue', icon: ChartColumn },
  function: { hue: 'purple', icon: Puzzle },
  interface: { hue: 'green', icon: ArrowLeftRight },
  enhancement: { hue: 'yellow', icon: Wrench },
};

export const priorityIdentity: Record<string, { hue: Hue; icon: Component }> = {
  high: { hue: 'red', icon: CircleAlert },
  medium: { hue: 'yellow', icon: SignalMedium },
  low: { hue: 'neutral', icon: SignalLow },
};
