import { memo } from 'react'
import { useAppDispatch, useAppSelector } from '../../app/store'
import { inspectionActions, selectCanEdit } from './inspectionSlice'
import type { InspectionResult } from './inspectionTypes'

const resultOptions: Array<{ value: InspectionResult; label: string }> = [
  { value: 'pass', label: 'Pass' },
  { value: 'fail', label: 'Fail' },
  { value: 'not_applicable', label: 'N/A' },
]

export const ChecklistItemRow = memo(function ChecklistItemRow({ itemId }: { itemId: string }) {
  const dispatch = useAppDispatch()
  const item = useAppSelector((state) =>
    state.inspection.inspection?.items.find((candidate) => candidate.itemId === itemId),
  )
  const canEdit = useAppSelector(selectCanEdit)

  if (!item) return null

  return (
    <article className="checklist-card" aria-labelledby={`${item.itemId}-label`}>
      <h2 id={`${item.itemId}-label`}>{item.label}</h2>
      <div className="result-options" role="group" aria-label={`Result for ${item.label}`}>
        {resultOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`result-button result-${option.value}`}
            aria-pressed={item.result === option.value}
            disabled={!canEdit}
            onClick={() => dispatch(inspectionActions.itemResultChanged({ itemId, result: option.value }))}
          >
            {option.label}
          </button>
        ))}
      </div>
      {item.result === 'fail' && (
        <label className="note-field">
          <span>Failure note</span>
          <textarea
            value={item.note}
            disabled={!canEdit}
            maxLength={2_000}
            rows={3}
            placeholder="What did you find?"
            onChange={(event) => dispatch(inspectionActions.itemNoteChanged({
              itemId,
              note: event.currentTarget.value,
            }))}
          />
        </label>
      )}
    </article>
  )
})
