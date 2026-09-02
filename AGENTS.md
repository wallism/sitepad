## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bug diagnosis or root-cause analysis without a requested fix → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec

Repository best-practice routing:
- Bug fixes and regressions → invoke /sitepad-bug-fix plus the applicable implementation and testing skills
- React components and hooks → invoke /sitepad-react
- Redux Toolkit state, selectors, listeners, or side effects → invoke /sitepad-redux
- IndexedDB schema, transactions, migrations, or storage durability → invoke /sitepad-indexeddb
- C# or .NET implementation → invoke /sitepad-dotnet
- React UI unit or component tests → invoke /sitepad-react-unit-tests
- C# unit tests → invoke /sitepad-dotnet-unit-tests
