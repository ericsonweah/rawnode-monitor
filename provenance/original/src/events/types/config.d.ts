import type { AdvancedEventDispatcherOptions } from './index.js';

export interface EventsFrameworkConfiguration {
  profile: 'compat' | 'production' | 'enterprise' | 'strict' | string;
  global?: boolean;
  failFast?: boolean;
  dynamicRegistration?: boolean;
  freezeListeners?: boolean;
  bus?: AdvancedEventDispatcherOptions & Record<string, unknown>;
  listeners?: Record<string, unknown | unknown[]>;
  subscribers?: unknown[];
  lifecycle?: Record<string, unknown>;
  broadcasting?: Record<string, unknown>;
  bridge?: { redis?: Record<string, unknown> } & Record<string, unknown>;
  durable?: Record<string, unknown>;
  queue?: Record<string, unknown>;
  scheduler?: Record<string, unknown>;
  workflows?: Record<string, unknown>;
  sourcing?: ({ memory?: Record<string, unknown>; projections?: Record<string, unknown> } & Record<string, unknown>);
  contracts?: Record<string, unknown>;
  codecs?: Record<string, unknown>;
  [key: string]: unknown;
}

declare const config: Readonly<EventsFrameworkConfiguration>;
export default config;
