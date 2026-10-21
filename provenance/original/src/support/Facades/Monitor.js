'use strict';
import { defineFacade } from '../Facade.js';
export const Monitor = defineFacade('Monitor', ['monitor.runtime', 'monitor'], { owner: 'monitor' });
export default Monitor;
