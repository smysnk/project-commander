# Home Page Split Plan (Steps 1-10)

## Objective
Split `packages/web/app/page.js` into feature-scoped modules, while preserving behavior and aligning interaction-state patterns with `docs/redux-ui-interactions-migration-plan.md` (Redux-first UI state, minimal prop drilling, deterministic side effects).

## Steps
1. Recover and stabilize `HomePage` baseline to ensure refactor starts from a buildable state. `DONE`
2. Move route entry logic to feature module so `app/page.js` is a thin route adapter. `DONE`
3. Introduce dedicated feature root file: `src/features/home/HomePageContainer.js`. `DONE`
4. Keep route-level file as a re-export only (`app/page.js`), reducing route coupling. `DONE`
5. Identify recursive/isolatable UI parts for first extraction pass. `DONE`
6. Extract debug tree UI into `src/features/home/components/DebugTreeNode.js`. `DONE`
7. Introduce a feature context for extracted recursive UI state flow: `src/features/home/context/DebugTreeContext.js`. `DONE`
8. Replace recursive prop threading with context provider/consumer wiring in `HomePageContainer`. `DONE`
9. Re-verify module boundaries/import paths after relocation from `app/` to `src/features/home/`. `DONE`
10. Validate full web build after split and context extraction. `DONE`

## Implemented Files
- `packages/web/app/page.js`
- `packages/web/src/features/home/HomePageContainer.js`
- `packages/web/src/features/home/components/DebugTreeNode.js`
- `packages/web/src/features/home/context/DebugTreeContext.js`

## Notes
- This execution keeps runtime behavior intact while establishing a safe decomposition pattern (extract + context) that can be repeated for host sidebar, log panel, runtime panel, and terminal panel in follow-up passes.
- Redux interaction-state ownership remains unchanged and compatible with `redux-ui-interactions-migration-plan.md`.
