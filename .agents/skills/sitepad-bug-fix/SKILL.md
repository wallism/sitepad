---
name: sitepad-bug-fix
description: Fix a verified Sitepad bug or regression using root-cause investigation and a strict red-green regression-test loop. Use when asked to fix, patch, or correct broken behavior. Do not use for diagnosis-only requests, new features, or general test-writing tasks.
---

# Sitepad Bug Fix

Prove the bug, prove the regression test detects it, make the smallest safe fix, and prove the same test turns green.

## Required workflow

1. Preserve unrelated working-tree changes and trace the reported symptom to its owning code or configuration seam.
2. Reproduce the problem and establish a specific root-cause hypothesis. Do not edit production code while the cause is still a guess.
3. Select the lowest test layer that can faithfully reproduce the defect. Load the applicable Sitepad implementation and testing skills.
4. Establish **red** before the production fix:
   - Add the smallest regression test that expresses the required behavior, or identify an existing failing test that uniquely reproduces it.
   - Run that exact test and confirm it fails for the expected reason.
   - If it passes, errors before reaching the target behavior, or fails for an unrelated reason, correct the test or hypothesis and run it again. It is not valid red evidence yet.
5. Establish **green**:
   - Make the smallest production change that fixes the confirmed root cause.
   - Run the same regression test and confirm it passes.
   - Do not weaken, delete, skip, or rewrite the assertion merely to make the test green.
6. Run the relevant surrounding suite and any build, typecheck, lint, or analyzer checks appropriate to the changed seam.
7. Re-run the original reproduction when it provides evidence beyond the automated test.

## Test-layer boundary

- Use a unit test for isolated component, reducer, selector, merge, validation, or domain behavior.
- Use an integration or real-browser test when the bug depends on Redux listeners, IndexedDB transactions, schema upgrades, SQLite, HTTP hosting, serialization, or browser lifecycle behavior.
- Do not force an integration defect into a mocked unit test. The test must fail when the real bug is present.
- If no meaningful automated regression test can be made, stop before changing production code. Explain the limitation and ask whether to proceed with a repeatable executable or manual reproduction instead.

## Completion evidence

Report the root cause, regression-test name and location, the red command and expected failure, the green command and pass, broader validation, and any validation that could not be run. Keep local validation distinct from deployment or live proof.
