import { useAppDispatch, useAppSelector } from '../../app/store'
import { inspectionActions, selectEvents } from './inspectionSlice'

export function DeveloperDrawer({ onFailNextWrite }: { onFailNextWrite: () => void }) {
  const dispatch = useAppDispatch()
  const events = useAppSelector(selectEvents)

  return (
    <details className="developer-drawer">
      <summary>Learning trace</summary>
      <p className="developer-copy">Payload values stay out of this event strip.</p>
      <div className="developer-actions">
        <button type="button" onClick={() => dispatch(inspectionActions.flushRequested())}>
          Flush now
        </button>
        <button type="button" onClick={onFailNextWrite}>
          Fail next write
        </button>
        <button type="button" onClick={() => dispatch(inspectionActions.diagnosticsCleared())}>
          Clear trace
        </button>
      </div>
      <ol className="event-strip" aria-label="Durability event trace">
        {events.map((event) => (
          <li key={event.sequence}>
            <span>{event.source}</span>
            <strong>{event.event}</strong>
            {event.revision !== undefined && <code>r{event.revision}</code>}
            {event.code && <code>{event.code}</code>}
          </li>
        ))}
      </ol>
    </details>
  )
}
