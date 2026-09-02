import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { App } from './App'
import { createAppStore } from './app/store'
import { acquiredFakeLock, fakeLock, FakeStorage } from './test/fakes'

function renderApp(storage: FakeStorage, editLock = acquiredFakeLock()) {
  const app = createAppStore({ storage })
  const result = render(
    <Provider store={app.store}>
      <App store={app.store} storage={storage} editLock={editLock} />
    </Provider>,
  )
  return { app, ...result }
}

describe('App bootstrap states', () => {
  it('fails closed when Web Locks are unsupported', async () => {
    const { app } = renderApp(new FakeStorage(), fakeLock({ kind: 'unsupported' }))
    expect(await screen.findByText('This browser cannot safely edit offline')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Fail' })).not.toBeInTheDocument()
    app.dispose()
  })

  it('recovers from a non-destructive hydration error on Retry', async () => {
    const user = userEvent.setup()
    const storage = new FakeStorage()
    storage.snapshot.items[0].note = 'Existing committed note'
    storage.hydrationResults.push(
      { kind: 'failed', code: 'read_failed' },
      { kind: 'hydrated', inspection: storage.snapshot },
    )
    const { app } = renderApp(storage)

    expect(await screen.findByText('Couldn’t open this device’s work')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: '2/88 Trafalgar St' })).toBeVisible()
    app.dispose()
  })
})
