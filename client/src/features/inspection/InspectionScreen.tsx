import { ChecklistItemRow } from './ChecklistItemRow'
import { DeveloperDrawer } from './DeveloperDrawer'
import {
  inspectionActions,
  selectCanComplete,
  selectDurabilityStatus,
  selectInspection,
  selectOutbox,
} from './inspectionSlice'
import { useAppDispatch, useAppSelector } from '../../app/store'

export function InspectionScreen({
  onFailNextWrite,
  onFailNextSend,
  onFailNextResponseWrite,
}: {
  onFailNextWrite?: () => void
  onFailNextSend?: () => void
  onFailNextResponseWrite?: () => void
}) {
  const dispatch = useAppDispatch()
  const inspection = useAppSelector(selectInspection)
  const durabilityStatus = useAppSelector(selectDurabilityStatus)
  const storageError = useAppSelector((state) => state.inspection.storageError)
  const canComplete = useAppSelector(selectCanComplete)
  const outbox = useAppSelector(selectOutbox)

  if (!inspection) return null

  const answered = inspection.items.filter((item) => item.result !== 'unanswered').length
  const failures = inspection.items.filter((item) => item.result === 'fail').length
  const statusClass = storageError || outbox?.status === 'conflicted' || outbox?.status === 'rejected'
    ? 'status-error'
    : ['Saving', 'Finishing on this device\u2026', 'Sending', 'Waiting to send'].includes(durabilityStatus)
      ? 'status-saving'
      : 'status-durable'

  return (
    <main className="app-shell">
      <header className={`durability-bar ${statusClass}`} role="status" aria-live="polite">
        <span className="status-dot" aria-hidden="true" />
        <span>{durabilityStatus}</span>
        {storageError && inspection.lifecycle === 'in_progress' && (
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

      <section className="completion-panel" aria-label="Complete inspection">
        {inspection.lifecycle === 'in_progress' ? (
          <>
            <button
              type="button"
              className="complete-button"
              disabled={!canComplete}
              onClick={() => dispatch(inspectionActions.completionRequested())}
            >
              Complete & queue to send
            </button>
            {!canComplete && <p>Answer every checklist item before completing.</p>}
          </>
        ) : (
          <p className="completion-copy">This inspection is complete. Your local evidence is kept on this device.</p>
        )}
        {outbox?.status === 'retryable' && (
          <button type="button" className="retry-send-button" onClick={() => dispatch(inspectionActions.manualRetryRequested())}>
            Retry now
          </button>
        )}
        {outbox?.status === 'conflicted' && <p>Office changes need review. Resolution arrives in milestone 3.</p>}
        {outbox?.status === 'rejected' && <p>The operation is read-only and remains recoverable on this device.</p>}
      </section>

      {import.meta.env.DEV && onFailNextWrite && (
        <DeveloperDrawer
          onFailNextWrite={onFailNextWrite}
          onFailNextSend={onFailNextSend}
          onFailNextResponseWrite={onFailNextResponseWrite}
        />
      )}
    </main>
  )
}
