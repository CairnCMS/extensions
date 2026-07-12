# Live Preview

Live Preview renders your site's page for the item being edited in a resizable pane beside the item editor. You configure a preview URL per collection, and the pane reloads the page every time the item is saved.

Use this when your content has a public or staged frontend and editors want to see the rendered result without leaving CairnCMS.

## Requirements

- CairnCMS 1.3.0 or later.
- A frontend that renders a page for the items you want to preview. The page must be reachable from the editor's browser. Previewing drafts requires a frontend that can render draft content without putting credentials in the Preview URL.
- Admin access to CairnCMS for the one-time configuration.

## Installation

CairnCMS discovers the extension either from the project's `extensions` folder or from its `node_modules`. Pick the method that fits your deployment. After any of them, restart CairnCMS and check that Settings > Extensions shows a Live Preview row with a Normal health indicator.

### Into the extensions folder

Fits the default Docker project from `cairncms init`, which mounts `./extensions` into the container, and any other deployment with a writable extensions folder. Download the published package and unpack it into the folder the loader reads:

```bash
cd <cairncms-project-folder>
npm pack @cairncms/extension-live-preview
mkdir -p extensions/cairncms-extension-live-preview
tar -xzf cairncms-extension-live-preview-*.tgz -C extensions/cairncms-extension-live-preview --strip-components=1
rm cairncms-extension-live-preview-*.tgz
docker compose restart cairncms
```

### As an npm dependency

Fits deployments where you control the CairnCMS project folder and its `node_modules`: an instance running directly on a host, or a platform build step that installs npm packages before starting the instance.

```bash
cd <cairncms-project-folder>
npm install @cairncms/extension-live-preview
```

The loader auto-discovers the package from `node_modules` at startup.

### In a custom Docker image

Fits image-based deployments without writable mounts. Unpack the package into the image's extensions folder at build time:

```dockerfile
FROM node:22-alpine AS extensions
WORKDIR /ext
RUN npm pack @cairncms/extension-live-preview && \
	mkdir -p live-preview && \
	tar -xzf cairncms-extension-live-preview-*.tgz -C live-preview --strip-components=1

FROM cairncms/cairncms:1.3.0
COPY --from=extensions --chown=node:node /ext/live-preview /cairncms/extensions/cairncms-extension-live-preview
```

Build the image and deploy as usual. In a production Dockerfile, pin an exact version, for example `@cairncms/extension-live-preview@0.1.0`, so image rebuilds stay reproducible.

## Allow the preview origin

Browsers block the preview frame unless the CairnCMS content security policy allows your frontend's origin. Set the `frame-src` directive in the deployment environment:

```
CONTENT_SECURITY_POLICY_DIRECTIVES__FRAME_SRC="array:'self',blob:,https://preview.example.com"
```

Keep `'self'` and `blob:` in the list. Setting `frame-src` replaces the browser's fallback to the default directives, so a list without them breaks other framed content in the app.

## Configure a preview URL

1. Open Settings > Data Model and select a collection.
2. In the Extension Settings section below the fields list, find the Live Preview group.
3. Set Preview URL to the page that renders an item of this collection, interpolating item fields with `{{ field }}`:

```
https://preview.example.com/articles/{{slug}}
```

Dot paths reach related values, for example `{{author.slug}}`. Save with the collection page's save button.

Only the path, query, and fragment may interpolate fields. Write the scheme and host literally. A template that interpolates into the host is rejected and the preview stays unavailable for the collection.

The Preview URL is not a secret. CairnCMS delivers it to the browser of every user who can open items in the collection, and the pane displays it. Never put access tokens or other credentials in it. If your frontend needs credentials to render drafts, keep them server side, for example a session cookie or a token held by the preview server.

The pane does not treat draft or archived items differently. It renders the page for the item's saved state whatever its status, and your frontend decides what that page shows. If the frontend needs to branch on workflow state, interpolate the field, for example `https://preview.example.com/articles/{{slug}}?status={{status}}`.

## Use the pane

Open an item in a configured collection. A Live Preview toggle appears on the item page. The pane shows the rendered page with controls to refresh, open the page in a new tab, resize the viewport to fixed dimensions, and zoom. Saving the item reloads the page.

## Behavior and limits

- The preview renders saved values. Unsaved edits do not appear until you save.
- A new item has no preview until its first save. The toggle appears once the item exists.
- Fields referenced in the preview URL are read as the signed-in user. A field the user cannot read renders as an empty value in the address.
- Missing or null fields render as empty values, not errors.
- Interpolated values are URL-encoded, and the rendered address must stay on the template's origin.
- The preview frame is sandboxed and sends no referrer to the preview site.

## License

GPL-3.0-only.
