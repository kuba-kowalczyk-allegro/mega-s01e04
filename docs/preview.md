# Digest preview: manual GitHub Pages publication

Issue #7 prepares publication, but is not done until the approved public HTTPS link and
plan issues are sent to the reviewer. No deployment, secret change, or message is authorized
by committing this workflow. Do not close #7 just because the implementation is merged.

## Before publication

The digest route must be merged and render `/digest/2026-10-28`. Merge the generated
`pnpm-lock.yaml` too: CI uses Node 24, pnpm **12.18.0**, and a frozen install. No dependency
or package version change is needed for this exporter.

Ask the human for approval before pushing this workflow, changing Pages settings, setting
the secret, dispatching it, or sending a reviewer message. Explain the repository, public
audience, marker exposure, replacement procedure, and intended lifetime. Choosing Pages
alone is not approval to publish. Never put the marker in inputs, CLI arguments, issues,
logs, committed HTML, chat attachments, or a `gh-pages` branch.

After approval, a maintainer must:

1. In repository **Settings → Pages → Build and deployment**, choose **GitHub Actions**.
   This replaces the repository's Pages site; confirm there is no other site to preserve.
2. Set the **repository Actions secret** `LANE_MARKER` through a private secret-entry UI.
   Do not set it as a workflow input or ordinary repository variable.
3. Configure the `github-pages` environment's allowed branch and, where supported, required
   reviewers. Use only reviewed code on the default branch. Manual dispatch requires the
   workflow on that branch. Environment deployment approval is an additional gate, not a
   substitute for permission to create a marker-bearing build artifact.
4. Manually run **Manual digest preview** with `include_marker` checked, only after the
   human approves public marker publication. No push, PR, schedule, or other event triggers it.
5. Confirm the public HTTPS URL shown by the deployment opens the digest, then obtain
   approval to send that URL and the issue list to the reviewer. Send the link, not the HTML.

## Export locally (no publication)

From the repository root with dependencies installed:

```sh
pnpm exec tsx scripts/export-preview.ts
```

The command starts rig's real Hono app on an ephemeral loopback HTTP port, fetches
`/digest/2026-10-28`, closes the listener, and writes **only** `.tmp/preview/index.html`.
It does not start the heartbeat or load `.env`. It reads `LANE_MARKER` only from the process
environment; unset/blank means the banner must read **no marker set**. Missing routes,
non-HTML, missing banners, scripts, and external rendering assets fail without printing HTML.
The directory is ignored by Git. Never force-add it, upload it as a chat attachment, or commit
it on any branch. Local copies must be removed after review too.

## Artifact lifetime and permissions

The workflow uploads only that single HTML file with `actions/upload-pages-artifact@v4`
and deploys with `actions/deploy-pages@v4`. It does not construct a public payload or push a
publishing branch. The intended public marker-bearing copy is the approved Pages site.
The intermediate Actions artifact is downloadable by users with artifact access: it is not
a secret store. It has the minimum **one-day** retention, and a separate job deletes its
exact artifact ID immediately after successful deployment. Deleting the artifact does not
delete the deployed site. GitHub may retain platform-managed deployment data; do not claim
this erases browser caches, downloads, or third-party copies.

If deployment fails, is cancelled, or waits for approval, the upload can remain until expiry.
After approval, delete such artifacts manually if immediate removal is required. Inspect prior
failed/cancelled runs during cleanup. No HTML or marker is placed in job outputs or logs.
Permissions are job-local: build `contents: read`; deploy `pages: write` and `id-token: write`;
upload removal alone `actions: write`. Checkout does not persist credentials.

## Remove the marker at the same URL

After review, ask for explicit approval to overwrite the public site with a marker-free copy.
Run the **same workflow**, from reviewed code, with `include_marker` **unchecked** (the safe
default). This leaves the secret out of the export environment even if it is still configured.
The exporter does not load `.env`, and verifies the **no marker set** banner before upload.
Approve deployment if prompted. Verify the same HTTPS URL now shows that banner and the
upload-removal job succeeded. Do not merely delete the secret or the upload artifact: neither
updates a deployed page. Removing the stored secret is a separate approved action if wanted.
Only then can the cleanup issue be completed; plan archival belongs to that issue, not #7.

To undo publication entirely, ask for approval to unpublish the Pages site in Settings.
To undo marker exposure while retaining the review link, use the marker-free rerun above.

References: [GitHub custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages),
[upload action](https://github.com/actions/upload-pages-artifact),
[deploy action](https://github.com/actions/deploy-pages).
