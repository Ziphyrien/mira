# Durable drafts

The client-side `draftsWeb` Chord facet owns one `DurableDraft` resource per account host. Its public contract provides an observable `Drafts.buffer`, `Drafts.flush(null)`, and `Drafts.clear(null)`. Conversation, images, and account use these ports; the application host mounts the facet and flushes it before closing resources.

Text and prepared image Blobs are saved in IndexedDB through idb-keyval. The database namespace is a SHA-256 digest of the account key, using the shared key normalization contract. Image previews are recreated and revoked by the images plugin.

Edits enqueue immediately and writes run in order. Asynchronous restoration merges untouched fields. Sending clears the submitted text only while its edit revision still matches. Account switching flushes the current draft; successful deletion seals and removes it before replacing the host. Storage failures leave the composer usable in memory.

The browser suite covers persisted Blob bytes, returning-account drafts, restoration during editing or image preparation, queued writes during deletion, unavailable storage, and disposal cancellation. End-to-end application tests also verify restored previews, clearing sent drafts, and account transitions:

```sh
bun run test:browser
```

Immediate writes and page visibility flushes reduce the save window on browser shutdown. Concurrent edits in separate tabs use the last completed write.
