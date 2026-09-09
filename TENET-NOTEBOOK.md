# Tenet Local Notebook

The Tenet whiteboard includes a notebook organizer for saved canvas pages.

## Storage model

- Canvas page content and previews use PenEcho's existing IndexedDB snapshot store.
- Subject assignments and the active subject tab use localStorage under `tenet-notebook-v1`.
- Pages stay on the current browser profile or installed iPad app. They are not sent to Tenet, PenEcho, or a district Gateway.
- Clearing site data or uninstalling the app can remove the local notebook. Cloud sync and managed backup are intentionally not part of this MVP.

## Page workflow

- The first `Save page` creates a device snapshot with a title and subject.
- Changes to an already-saved notebook page autosave after a short idle period.
- Opening or starting another page uses PenEcho's existing unsaved-change confirmation flow.
- Existing device snapshots appear under `Other` until a subject is assigned.

## Subjects and images

- The notebook provides tabs for Math, Science, English, Social Studies, and Other.
- A saved page can be moved between subjects from its page card.
- `Photos & Files` uses the existing bounded canvas image importer.
- `Take a photo` requests the rear camera where the browser or iPad allows it.
- `Pencil Studio` appears inside the native Capacitor app and returns a PencilKit drawing to the same image pipeline.

## Selection tools

- Circle handwriting with the lasso, then choose `Explain`, `Check step`, `Practice`, or `Hint`.
- Selection AI uses the existing isolated-selection request path. The request image is a white-backed crop containing only pixels inside the selected polygon; the rest of the page is not included.
- `Check step` and `Practice` are rejected by the local server unless a valid closed selection accompanies the request.
- Selected ink can be moved, resized, recolored, duplicated, or erased. Touch-friendly controls expose the existing raster undo/redo history.
- Pixel erase remains the freehand eraser. `Erase selection` is the safe lasso-based whole-selection eraser.
- Exact whole-stroke erasing is intentionally not claimed: the persistent raster canvas does not retain stroke identity, so a crossing stroke cannot be distinguished safely from nearby ink without changing the document model.
