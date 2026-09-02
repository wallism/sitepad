import { ChecklistItemRow } from './ChecklistItemRow'
import { DeveloperDrawer } from './DeveloperDrawer'
import {
  inspectionActions,
  selectDurabilityStatus,
  selectInspection,
} from './inspectionSlice'
import { useAppDispatch, useAppSelector } from '../../app/store'

export function InspectionScreen({ onFailNextWrite }: { onFailNextWrite?: () => void }) {
  const dispatch = useAppDispatch()
  const inspection = useAppSelector(selectInspection)
  const durabilityStatus = useAppSelector(selectDurabilityStatus)
  const storageError = useAppSelector((state) => state.inspection.storageError)

  if (!inspection) return null

  const answered = inspection.items.filter((item) => item.result !== 'unanswered').length
  const failures = inspection.items.filter((item) => item.result === 'fail').length
  const statusClass = storageError
    ? 'status-error'
    : durabilityStatus === 'Saving'
      ? 'status-saving'
      : 'status-durable'

  return (
    <main className="app-shell">
      <header className={`durability-bar ${statusClass}`} role="status" aria-live="polite">
        <span className="status-dot" aria-hidden="true" />
        <span>{durabilityStatus}</span>
        {storageError && (
          <button type="button" onClick={() => dispatch(inspectionActions.storageRetryRequested())}>
            Retry
          </button>
        )}
      </header>

      <section className="inspection-heading">
        <p className="eyebrow">Today · Inspection 1 of 1</p>
        <h1>{inspection.address}</h1>
        <p>{inspection.inspectionType} · {answered} of {inspection.items.length} done · {failures} fails</p>
      </section>

      <nav className="section-jump" aria-label="Inspection sections">
        <span>Section</span>
        <strong>Safety essentials</strong>
      </nav>

      <section className="checklist" aria-label="Safety essentials checklist">
        {inspection.items.map((item) => <ChecklistItemRow key={item.itemId} itemId={item.itemId} />)}
      </section>

      {import.meta.env.DEV && onFailNextWrite && <DeveloperDrawer onFailNextWrite={onFailNextWrite} />}
    </main>
  )
}
