import { Profiler, type ProfilerOnRenderCallback } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { createAppStore } from '../../app/store'
import { FakeStorage } from '../../test/fakes'
import { cloneInspection, fixtureInspection } from './fixture'
import { inspectionActions } from './inspectionSlice'
import { InspectionScreen } from './InspectionScreen'
import { ChecklistItemRow } from './ChecklistItemRow'

function readyApp() {
  const storage = new FakeStorage()
  const app = createAppStore({ storage })
  app.store.dispatch(inspectionActions.inspectionHydrated(cloneInspection(fixtureInspection)))
  return { app, storage }
}

describe('InspectionScreen', () => {
  it('renders an optimistic result immediately and reveals its note field', async () => {
    const user = userEvent.setup()
    const { app } = readyApp()
    render(
      <Provider store={app.store}>
        <InspectionScreen onFailNextWrite={() => undefined} />
      </Provider>,
    )

    const firstItem = screen.getByRole('article', { name: /smoke alarm — hallway/i })
    await user.click(within(firstItem).getByRole('button', { name: 'Fail' }))

    expect(within(firstItem).getByRole('button', { name: 'Fail' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(firstItem).getByRole('textbox', { name: 'Failure note' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('Saving')
    app.dispose()
  })

  it('does not re-render unaffected item rows for one result change', async () => {
    const user = userEvent.setup()
    const { app } = readyApp()
    const renders = new Map<string, number>()
    const count = (id: string): ProfilerOnRenderCallback => () => {
      renders.set(id, (renders.get(id) ?? 0) + 1)
    }

    render(
      <Provider store={app.store}>
        {fixtureInspection.items.map((item) => (
          <Profiler key={item.itemId} id={item.itemId} onRender={count(item.itemId)}>
            <ChecklistItemRow itemId={item.itemId} />
          </Profiler>
        ))}
      </Provider>,
    )
    const initial = new Map(renders)

    const firstItem = screen.getByRole('article', { name: /smoke alarm — hallway/i })
    await user.click(within(firstItem).getByRole('button', { name: 'Pass' }))

    expect(renders.get('smoke-hallway')).toBe((initial.get('smoke-hallway') ?? 0) + 1)
    expect(renders.get('smoke-bedroom-2')).toBe(initial.get('smoke-bedroom-2'))
    expect(renders.get('emergency-lighting')).toBe(initial.get('emergency-lighting'))
    app.dispose()
  })
})
