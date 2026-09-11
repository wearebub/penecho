# Compact iPad notebook controls

Status: source changes only; not bundled, tested, committed, or published.

## Root cause and requested change

The header exposed four file operations at all times, while a second toolbar
permanently occupied writing space. The user clarified that the collapsible bar
means the drawing-controls row below the title, not Apple's floating palette.

- A three-line notebook button opens New page, Open document, Export PDF, and
  Pages & files as large, labeled actions with icons.
- A separate Tools button expands the existing drawing row. It starts collapsed
  on each page load and does not change the active drawing tool or engine.
- The existing Recent writing / Visible page selector is relocated into Tutor
  view in the notebook menu once the native controls arrive. Its selected value
  and original event handlers remain authoritative.

## Implementation decisions

The existing file buttons are moved, not cloned or replaced. This preserves
native PDF/import hooks, notebook navigation, element IDs, and disabled states.
The dropdown uses a modal dialog for keyboard focus, Escape, and native input
exclusion. Native ink is suspended for the menu and released on close, failed
opening, backgrounding, or teardown. Runtime styles use explicit stable keys
and allow stylesheet unavailability without blocking menu opening.

The toolbar itself remains in its original location with its identity intact.
The existing layout and native exclusion observers can measure the collapsed
or expanded row. A zero collapsed toolbar-height variable avoids reserving the
old toolbar space. Scope attachment observes late DOM insertion only until the
existing selector is found; navigation teardown disconnects it.

## Considered and rejected

- Hiding the native PencilKit palette: explicitly not the requested bar.
- Duplicating file-operation handlers: risks diverging save/import/export paths.
- Deleting the tutor scope choice: it changes context selection, not just style.
- A new AI submit path or changed default scope: neither is part of this UI work.
- A new asset/runtime dependency: styles extend the existing iPad stylesheet.

## Intentionally unchanged

Chromebook/web layouts, the native PencilKit palette, stored pages and ink,
authentication, district policies, AI routing, selected-area requests, and the
current scope value are unchanged. The separate microphone automatic-start fix
and earlier pending hit-area/startup recovery work are preserved.

## Qualification pending

Check both iPad ink engines, collapsed/expanded geometry after rotation, native
Pencil and finger interaction with the file menu, all four original file
operations, scope changes and scoped voice requests, keyboard dismissal, safe
areas, and background/restore. Run the regression suite and rebuild the client
before release. No physical iPad acceptance is claimed from these source edits.
