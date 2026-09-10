# Native canvas navigation correction for 1.3.0

## Root cause

The native navigation recognizer required two touches even when only Apple
Pencil was allowed to draw. PKCanvasView also owns an internal scroll view:
disabling its recognizers once during initialization did not enforce the shared
viewport invariant after tool, policy and first-responder transitions. A native
viewport change could move handwriting without moving the web objects behind it.

## Changes

- Pencil-only input uses one direct touch to navigate the shared canvas.
- Finger/stylus input uses one touch to draw and two touches to navigate.
- Both modes retain two-finger pinch zoom, unless navigation is locked.
- Reassert input ownership after policy, picker and visibility changes.
- Pin native offset and zoom to the last accepted JavaScript viewport. Native
  scroll callbacks restore that viewport without changing PKDrawing data.
- Drawing options explain both navigation modes explicitly.

## Considered and rejected

Translating the stored strokes to compensate for a viewport error would change
student work, undo history and the AI stroke baseline. Allowing independent
native scrolling would still detach handwriting from graphs, images and PDFs.
Neither is acceptable; JavaScript remains the single viewport authority.

## Intentionally unchanged

No authentication, Gateway routing, managed-policy permissions, document storage
schema, drawing archives, AI context selection or stroke baseline changes.
Finger inking remains available and can still be denied by managed configuration.
The native drawing recognizer is not made to wait for a two-finger gesture to
fail, preserving low-latency finger and regular-stylus input.

## Qualification boundary

Source contract tests enforce gesture ownership and viewport restoration. Adapter
tests exercise shared pan/zoom. Hosted macOS compilation checks UIKit types and
integration. These checks do not replace real-device touch testing.

On an iPad, place an image and a graph, then draw across their edges. In Pencil-only
mode, scroll with one finger and pinch with two; every layer must stay aligned.
Repeat after using the picker, rotating the iPad and reopening the notebook. In
finger mode, confirm one-finger ink and two-finger navigation. Check native lasso,
undo/redo, toolbar Pencil taps and a managed finger-disabled device separately.
