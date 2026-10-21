'use strict';

import { SubscriptionBuilder } from './SubscriptionBuilder.js';

/** Backward-compatible constructor order for early enterprise previews. */
export class ListenerBuilder extends SubscriptionBuilder {
  constructor(dispatcher, target, kind = 'exact') { super(dispatcher, kind, target); }
  enabled(value = true) { return this.when(value !== false); }
  tags(values) { return this.tag(...(Array.isArray(values) ? values : [values])); }
  subscribe(listener) { return this.listen(listener); }
}

export default ListenerBuilder;
