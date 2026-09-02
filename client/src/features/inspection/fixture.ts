import type { InspectionSnapshot } from './inspectionTypes'

export const fixtureInspection: InspectionSnapshot = {
  inspectionId: 'inspection-trafalgar-2-88',
  address: '2/88 Trafalgar St',
  inspectionType: 'Final inspection',
  lifecycle: 'in_progress',
  localRevision: 0,
  baseVersion: 1,
  activeOperationId: null,
  lastStorageDiagnostic: null,
  items: [
    { itemId: 'smoke-hallway', label: '3.2 Smoke alarm — hallway', result: 'unanswered', note: '' },
    { itemId: 'smoke-bedroom-2', label: '3.3 Smoke alarm — bedroom 2', result: 'unanswered', note: '' },
    { itemId: 'emergency-lighting', label: '3.4 Emergency lighting', result: 'unanswered', note: '' },
  ],
}

export function cloneInspection(snapshot: InspectionSnapshot): InspectionSnapshot {
  return {
    ...snapshot,
    items: snapshot.items.map((item) => ({ ...item })),
  }
}
