# Project card GitHub links

## Goal

Add an optional external GitHub link to each card on the Projects landing view while preserving the card's existing navigation to the Relay project briefing.

## Design

Relay will derive repository links live from the local Git workdirs already included in each `ProjectSummary`. For each distinct Git root, the server-side query boundary will read `remote.origin.url`, accept only recognized `github.com` HTTPS or SSH forms, strip credentials and Git-specific suffixes, and normalize the value to an `https://github.com/<owner>/<repository>` URL. Duplicate Git roots within one project will be read once.

A project receives a `githubUrl` only when all recognized GitHub remotes across its observed workdirs resolve to one unique canonical repository. Missing remotes, non-GitHub remotes, malformed values, command failures, or conflicting GitHub repositories result in no link. The value is derived at read time and is not persisted.

The Projects landing card will remain a link to its Relay briefing. A separate GitHub icon link will appear in the card header when `githubUrl` is available, open in a new tab, and include an accessible label naming the repository. The card markup will avoid nested anchors by making the card container non-interactive and placing the internal Relay link and external GitHub link as siblings.

## Boundaries and safety

- Do not expose local paths, arbitrary remote hosts, credentials, remote commands, or raw Git configuration through the new field.
- Do not guess a GitHub URL from a repository name.
- Do not add a database column or collector persistence.
- Preserve the current conservative project grouping and all existing card content.

## Verification

- Unit-test HTTPS, SSH, missing, malformed, non-GitHub, and conflicting remote cases.
- Component-test the external link, accessible label, new-tab attributes, and unchanged Relay briefing link.
- Run `npm run verify` and report unrelated failures separately.
- Browser-check the Projects landing view at desktop and mobile widths, including cards with and without GitHub links.
