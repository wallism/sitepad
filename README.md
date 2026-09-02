# sitepad
An offline-first inspection tool for people who work where the signal isn’t. Every design decision below answers one question: does the inspector ever have to wonder whether their work is safe?

## Milestone 1

The current build is the local-durability learning slice: React intent → Redux revision → listener middleware → committed IndexedDB transaction. It uses synthetic inspection data only and intentionally has no server or networking.

```powershell
npm --prefix client install
npm --prefix client run dev
```

Verification:

```powershell
npm --prefix client test -- --run
npm --prefix client run test:e2e
npm --prefix client run build
```

See [the Milestone 1 evidence packet](docs/work/20260903-milestone-1-evidence.md) for the action traces, transaction outcomes, reload proof, and gate results.
