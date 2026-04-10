import { commitmentScaleDown } from './functions/scale-down';
import { catalogSync } from './functions/catalog-sync';

export const inngestFunctions = [
  commitmentScaleDown,
  catalogSync,
];
