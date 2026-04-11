import { commitmentScaleDown } from './functions/scale-down';
import { catalogSync } from './functions/catalog-sync';
import { billingSnapshotGeneration } from './functions/billing-snapshot';

export const inngestFunctions = [
  commitmentScaleDown,
  catalogSync,
  billingSnapshotGeneration,
];
